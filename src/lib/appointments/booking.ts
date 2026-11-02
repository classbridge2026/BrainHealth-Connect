import {
  AppointmentBookingSource,
  AppointmentStatus,
  Prisma,
  type PrismaClient,
  type VisitChannel,
} from "@prisma/client";
import { isPortalAdministrator, sanitizeMetadata } from "@/lib/admin/rules";
import { createRateLimiter, type RateLimiter } from "@/lib/auth/rate-limit";
import { bookingCatalogDecision, cleanRequiredText, parseUuid } from "@/lib/catalog/rules";
import { snapshotAppointmentFee } from "@/lib/catalog/money";
import { canReceiveNewAppointment } from "@/lib/doctors/rules";
import { isUniqueConflict } from "@/lib/doctors/errors";
import { prisma } from "@/lib/db/prisma";
import { expireOverdueHolds, getPaymentHoldMinutes, isOverlapError } from "./payment-holds";
import { loadBlockingIntervals, loadDoctorRules } from "./schedule-data";
import { slotIsOpen, type SlotMode } from "./slots";
import { addDays, parseCalendarDate } from "./time";
import { syncEncounterStatus } from "@/lib/clinical/records";
import { notifyAppointmentParties } from "./email-notice";
import { canTransition, type AppointmentActor } from "./transitions";

const bookingLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });
const bookingTransaction = { maxWait: 20_000, timeout: 30_000 };

function runBookingTransaction<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(fn, bookingTransaction);
}

export type BookingCode =
  | "NOT_A_PATIENT"
  | "RATE_LIMITED"
  | "DOCTOR_UNAVAILABLE"
  | "CATALOG_UNAVAILABLE"
  | "LOCATION"
  | "PAST"
  | "SLOT_UNAVAILABLE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNSUPPORTED"
  | "REASON"
  | "CONCERN"
  | "CHANNEL"
  | "UNAVAILABLE";

export type BookingResult =
  | { ok: true; appointmentId: string; paymentHoldExpiresAt?: Date }
  | { ok: false; code: BookingCode };

type Deps = { db?: PrismaClient; now?: Date; rateLimiter?: RateLimiter };

function failureCode(error: unknown): BookingCode | null {
  if (isOverlapError(error) || isUniqueConflict(error)) return "SLOT_UNAVAILABLE";
  return null;
}

function logBookingFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "unknown";
  const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "";
  console.error(`appointment_booking_failed code=${code}${message ? ` message=${message}` : ""}`);
}

async function ownPatient(tx: Prisma.TransactionClient, userId: string) {
  return tx.patientProfile.findUnique({
    where: { userId },
    select: { id: true, archivedAt: true, user: { select: { status: true, deletedAt: true } } },
  });
}

export async function bookScheduledSlot(
  input: { actorUserId: string; offeringId: string; locationId?: string | null; startsAt: Date; concern: string; channel: VisitChannel },
  deps: Deps = {},
): Promise<BookingResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const limiter = deps.rateLimiter ?? bookingLimiter;
  const concern = cleanRequiredText(input.concern, 10, 500, "what is wrong");
  if (!concern.ok) return { ok: false, code: "CONCERN" };
  if (!parseUuid(input.offeringId)) return { ok: false, code: "CATALOG_UNAVAILABLE" };
  if (input.locationId && !parseUuid(input.locationId)) return { ok: false, code: "LOCATION" };
  if (!limiter.check(`book:${input.actorUserId}`, now.getTime()).allowed) return { ok: false, code: "RATE_LIMITED" };
  if (Number.isNaN(input.startsAt.getTime()) || input.startsAt <= now) return { ok: false, code: "PAST" };

  try {
    const saved = await runBookingTransaction(db, async (tx) => {
      const patient = await ownPatient(tx, input.actorUserId);
      if (!patient || patient.archivedAt || patient.user.deletedAt || patient.user.status !== "ACTIVE") {
        return { ok: false as const, code: "NOT_A_PATIENT" as const };
      }
      const offering = await tx.doctorOffering.findUnique({
        where: { id: input.offeringId },
        select: {
          id: true,
          isActive: true,
          doctorProfileId: true,
          consultationServiceId: true,
          specialtyId: true,
          mode: true,
          durationMinutes: true,
          price: true,
          priceAmountMinor: true,
          currency: true,
          validFrom: true,
          validTo: true,
          consultationService: { select: { isActive: true, mode: true } },
          specialty: { select: { isActive: true } },
          doctor: {
            select: {
              verificationStatus: true,
              user: { select: { status: true, deletedAt: true } },
            },
          },
        },
      });
      if (!offering || offering.durationMinutes < 1) return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      const claim = await tx.doctorProfile.findUnique({
        where: { id: offering.doctorProfileId },
        select: {
          specialties: {
            where: { specialtyId: offering.specialtyId },
            select: { claimStatus: true, specialty: { select: { isActive: true } } },
          },
        },
      });
      if (
        !canReceiveNewAppointment({
          verificationStatus: offering.doctor.verificationStatus,
          userStatus: offering.doctor.user.status,
          deletedAt: offering.doctor.user.deletedAt,
          specialtyClaim: claim?.specialties[0]?.claimStatus ?? null,
          specialtyActive: claim?.specialties[0]?.specialty.isActive ?? false,
        })
      ) {
        return { ok: false as const, code: "DOCTOR_UNAVAILABLE" as const };
      }
      if ((offering.validFrom && offering.validFrom > now) || (offering.validTo && offering.validTo <= now)) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const mode = offering.mode;
      if (offering.consultationService.mode && offering.consultationService.mode !== mode) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const locationId = mode === "IN_PERSON" ? input.locationId ?? null : null;
      if (mode === "ONLINE" && input.locationId) return { ok: false as const, code: "LOCATION" as const };
      if (mode === "IN_PERSON" && !locationId) return { ok: false as const, code: "LOCATION" as const };
      const location = locationId ? await tx.location.findUnique({ where: { id: locationId }, select: { isActive: true } }) : null;
      if (
        bookingCatalogDecision({
          serviceActive: offering.consultationService.isActive,
          locationRequested: Boolean(locationId),
          locationActive: locationId ? (location?.isActive ?? null) : null,
          offeringRequested: true,
          offeringActive: offering.isActive,
          offeringMatches: true,
        }) !== "ok"
      ) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const snapshot = snapshotAppointmentFee({
        offering: { price: offering.price, priceAmountMinor: offering.priceAmountMinor, currency: offering.currency },
        fallbackMinor: 0,
      });
      if (!snapshot) return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };

      const endsAt = new Date(input.startsAt.getTime() + offering.durationMinutes * 60_000);
      const day = parseCalendarDate(input.startsAt.toISOString().slice(0, 10));
      if (!day) return { ok: false as const, code: "PAST" as const };
      await expireOverdueHolds(tx, offering.doctorProfileId);
      const open = slotIsOpen({
        startsAt: input.startsAt,
        endsAt,
        mode,
        locationId,
        offeringId: offering.id,
        rules: await loadDoctorRules(tx, offering.doctorProfileId),
        blocks: await loadBlockingIntervals(tx, {
          doctorProfileId: offering.doctorProfileId,
          rangeStart: day,
          rangeEnd: addDays(day, 1),
          now,
        }),
        now,
      });
      if (!open) return { ok: false as const, code: "SLOT_UNAVAILABLE" as const };
      if (mode === "IN_PERSON" && input.channel !== "IN_PERSON") return { ok: false as const, code: "CHANNEL" as const };
      if (mode === "ONLINE" && input.channel !== "VIDEO" && input.channel !== "AUDIO") return { ok: false as const, code: "CHANNEL" as const };

      const payable = snapshot.feeAmountMinor > 0;
      const holdMinutes = payable ? await getPaymentHoldMinutes(tx) : 0;
      const paymentHoldExpiresAt = payable ? new Date(now.getTime() + holdMinutes * 60_000) : null;
      const status = payable ? AppointmentStatus.PENDING_PAYMENT : AppointmentStatus.CONFIRMED;
      const appointment = await tx.appointment.create({
        data: {
          patientProfileId: patient.id,
          doctorProfileId: offering.doctorProfileId,
          specialtyId: offering.specialtyId,
          consultationServiceId: offering.consultationServiceId,
          offeringId: offering.id,
          locationId,
          mode,
          visitChannel: input.channel,
          status,
          startsAt: input.startsAt,
          endsAt,
          paymentHoldExpiresAt,
          feeAmount: snapshot.feeAmount,
          feeAmountMinor: snapshot.feeAmountMinor,
          currency: snapshot.currency,
          bookingSource: AppointmentBookingSource.WEB,
          patientConcern: concern.text,
        },
      });
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          actorUserId: input.actorUserId,
          toStatus: status,
          detail: payable ? "payment_hold_created" : "confirmed_without_fee",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "appointment.booked",
          entityType: "Appointment",
          entityId: appointment.id,
          metadata: sanitizeMetadata({ mode, durationMinutes: offering.durationMinutes, currency: snapshot.currency }) ?? undefined,
        },
      });
      return { ok: true as const, appointmentId: appointment.id, paymentHoldExpiresAt: paymentHoldExpiresAt ?? undefined };
    });
    if (!saved.ok) return saved;
    return notifySaved(db, saved, saved.paymentHoldExpiresAt ? "held" : "confirmed");
  } catch (error) {
    const code = failureCode(error);
    if (code) return { ok: false, code };
    logBookingFailure(error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Books a follow-up for a patient already assigned to the signed-in doctor. No payment is required. */
export async function scheduleAssignedFollowUp(
  input: { actorUserId: string; sourceAppointmentId: string; offeringId: string; locationId?: string | null; startsAt: Date },
  deps: Deps = {},
): Promise<BookingResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const limiter = deps.rateLimiter ?? bookingLimiter;
  if (!parseUuid(input.sourceAppointmentId) || !parseUuid(input.offeringId)) return { ok: false, code: "NOT_FOUND" };
  if (input.locationId && !parseUuid(input.locationId)) return { ok: false, code: "LOCATION" };
  if (!limiter.check(`book:${input.actorUserId}`, now.getTime()).allowed) return { ok: false, code: "RATE_LIMITED" };
  if (Number.isNaN(input.startsAt.getTime()) || input.startsAt <= now) return { ok: false, code: "PAST" };

  try {
    const saved = await runBookingTransaction(db, async (tx) => {
      const source = await tx.appointment.findUnique({
        where: { id: input.sourceAppointmentId },
        select: {
          id: true,
          doctorProfileId: true,
          patientProfileId: true,
          doctor: { select: { userId: true } },
          patient: { select: { archivedAt: true, user: { select: { status: true, deletedAt: true } } } },
        },
      });
      if (!source || source.doctor.userId !== input.actorUserId) return { ok: false as const, code: "NOT_FOUND" as const };
      if (source.patient.archivedAt || source.patient.user.deletedAt || source.patient.user.status !== "ACTIVE") {
        return { ok: false as const, code: "NOT_A_PATIENT" as const };
      }
      const offering = await tx.doctorOffering.findUnique({
        where: { id: input.offeringId },
        select: {
          id: true,
          isActive: true,
          doctorProfileId: true,
          consultationServiceId: true,
          specialtyId: true,
          mode: true,
          durationMinutes: true,
          price: true,
          priceAmountMinor: true,
          currency: true,
          validFrom: true,
          validTo: true,
          consultationService: { select: { isActive: true, mode: true } },
          specialty: { select: { isActive: true } },
          doctor: { select: { verificationStatus: true, user: { select: { status: true, deletedAt: true } } } },
        },
      });
      if (!offering || offering.doctorProfileId !== source.doctorProfileId || offering.durationMinutes < 1) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const claim = await tx.doctorProfile.findUnique({
        where: { id: offering.doctorProfileId },
        select: { specialties: { where: { specialtyId: offering.specialtyId }, select: { claimStatus: true, specialty: { select: { isActive: true } } } } },
      });
      if (
        !canReceiveNewAppointment({
          verificationStatus: offering.doctor.verificationStatus,
          userStatus: offering.doctor.user.status,
          deletedAt: offering.doctor.user.deletedAt,
          specialtyClaim: claim?.specialties[0]?.claimStatus ?? null,
          specialtyActive: claim?.specialties[0]?.specialty.isActive ?? false,
        })
      ) {
        return { ok: false as const, code: "DOCTOR_UNAVAILABLE" as const };
      }
      if ((offering.validFrom && offering.validFrom > now) || (offering.validTo && offering.validTo <= now)) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const mode = offering.mode;
      if (offering.consultationService.mode && offering.consultationService.mode !== mode) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const locationId = mode === "IN_PERSON" ? input.locationId ?? null : null;
      if (mode === "ONLINE" && input.locationId) return { ok: false as const, code: "LOCATION" as const };
      if (mode === "IN_PERSON" && !locationId) return { ok: false as const, code: "LOCATION" as const };
      const location = locationId ? await tx.location.findUnique({ where: { id: locationId }, select: { isActive: true } }) : null;
      if (
        bookingCatalogDecision({
          serviceActive: offering.consultationService.isActive,
          locationRequested: Boolean(locationId),
          locationActive: locationId ? (location?.isActive ?? null) : null,
          offeringRequested: true,
          offeringActive: offering.isActive,
          offeringMatches: true,
        }) !== "ok"
      ) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const snapshot = snapshotAppointmentFee({
        offering: { price: offering.price, priceAmountMinor: offering.priceAmountMinor, currency: offering.currency },
        fallbackMinor: 0,
      });
      if (!snapshot) return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      const endsAt = new Date(input.startsAt.getTime() + offering.durationMinutes * 60_000);
      const day = parseCalendarDate(input.startsAt.toISOString().slice(0, 10));
      if (!day) return { ok: false as const, code: "PAST" as const };
      await expireOverdueHolds(tx, offering.doctorProfileId);
      const open = slotIsOpen({
        startsAt: input.startsAt,
        endsAt,
        mode,
        locationId,
        offeringId: offering.id,
        rules: await loadDoctorRules(tx, offering.doctorProfileId),
        blocks: await loadBlockingIntervals(tx, { doctorProfileId: offering.doctorProfileId, rangeStart: day, rangeEnd: addDays(day, 1), now }),
        now,
      });
      if (!open) return { ok: false as const, code: "SLOT_UNAVAILABLE" as const };
      const appointment = await tx.appointment.create({
        data: {
          patientProfileId: source.patientProfileId,
          doctorProfileId: offering.doctorProfileId,
          specialtyId: offering.specialtyId,
          consultationServiceId: offering.consultationServiceId,
          offeringId: offering.id,
          locationId,
          mode,
          status: AppointmentStatus.CONFIRMED,
          startsAt: input.startsAt,
          endsAt,
          paymentHoldExpiresAt: null,
          feeAmount: snapshot.feeAmount,
          feeAmountMinor: snapshot.feeAmountMinor,
          currency: snapshot.currency,
          bookingSource: AppointmentBookingSource.WEB,
          followUpOfId: source.id,
        },
      });
      await tx.appointmentEvent.create({
        data: { appointmentId: appointment.id, actorUserId: input.actorUserId, toStatus: AppointmentStatus.CONFIRMED, detail: "doctor_follow_up_confirmed" },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "appointment.follow_up_scheduled",
          entityType: "Appointment",
          entityId: appointment.id,
          metadata: sanitizeMetadata({ sourceAppointmentId: source.id, mode }) ?? undefined,
        },
      });
      return { ok: true as const, appointmentId: appointment.id };
    });
    return notifySaved(db, saved, "confirmed");
  } catch (error) {
    const code = failureCode(error);
    if (code) return { ok: false, code };
    logBookingFailure(error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

async function notifySaved(db: PrismaClient, result: BookingResult, event: "held" | "confirmed" | "cancelled" | "rescheduled" | "requested") {
  if (result.ok) {
    await notifyAppointmentParties(db, { appointmentId: result.appointmentId, event });
  }
  return result;
}

const CANCEL_STATUS: Record<"patient" | "doctor", AppointmentStatus> = {
  patient: AppointmentStatus.CANCELLED_BY_PATIENT,
  doctor: AppointmentStatus.CANCELLED_BY_DOCTOR,
};

function actsForAssignedDoctor(actorUserId: string, doctorUserId: string | undefined, roleCodes?: readonly string[]) {
  if (!doctorUserId) return false;
  if (actorUserId === doctorUserId) return true;
  return isPortalAdministrator([...(roleCodes ?? [])]);
}

export async function cancelOwnAppointment(
  input: { actorUserId: string; actor: "patient" | "doctor"; appointmentId: string; reason: string; roleCodes?: readonly string[] },
  deps: Deps = {},
): Promise<BookingResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  if (!parseUuid(input.appointmentId)) return { ok: false, code: "NOT_FOUND" };
  try {
    const saved = await runBookingTransaction<BookingResult>(db, async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: input.appointmentId },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          patient: { select: { userId: true } },
          doctor: { select: { userId: true } },
        },
      });
      const owns =
        input.actor === "doctor"
          ? actsForAssignedDoctor(input.actorUserId, appointment?.doctor.userId, input.roleCodes)
          : appointment?.patient.userId === input.actorUserId;
      if (!appointment || !owns) return { ok: false as const, code: "NOT_FOUND" as const };
      const decision = canTransition({
        actor: input.actor,
        ownsRecord: true,
        from: appointment.status,
        to: CANCEL_STATUS[input.actor],
        now,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        reason: input.reason,
      });
      if (!decision.ok) return { ok: false as const, code: decision.code === "FORBIDDEN" ? "FORBIDDEN" : decision.code === "REASON" ? "REASON" : "UNSUPPORTED" };
      const updated = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status },
        data: { status: CANCEL_STATUS[input.actor], cancelledAt: now, cancellationReason: input.reason.trim() },
      });
      if (updated.count !== 1) return { ok: false as const, code: "UNSUPPORTED" as const };
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          actorUserId: input.actorUserId,
          fromStatus: appointment.status,
          toStatus: CANCEL_STATUS[input.actor],
          detail: input.actor === "patient" ? "cancelled_by_patient" : "cancelled_by_doctor",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.actor === "patient" ? "appointment.cancelled_by_patient" : "appointment.cancelled_by_doctor",
          entityType: "Appointment",
          entityId: appointment.id,
          metadata: sanitizeMetadata({ from: appointment.status }) ?? undefined,
        },
      });
      return { ok: true as const, appointmentId: appointment.id };
    });
    if (saved.ok) await syncEncounterStatus(db, { appointmentId: saved.appointmentId, status: "CANCELLED", at: now });
    return notifySaved(db, saved, "cancelled");
  } catch (error) {
    logBookingFailure(error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function approveBookingRequest(
  input: { actorUserId: string; appointmentId: string; roleCodes?: readonly string[] },
  deps: Deps = {},
): Promise<BookingResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  if (!parseUuid(input.appointmentId)) return { ok: false, code: "NOT_FOUND" };
  try {
    const saved = await runBookingTransaction(db, async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: input.appointmentId },
        select: { id: true, status: true, startsAt: true, endsAt: true, doctor: { select: { userId: true } } },
      });
      if (!appointment || !actsForAssignedDoctor(input.actorUserId, appointment.doctor.userId, input.roleCodes)) {
        return { ok: false as const, code: "NOT_FOUND" as const };
      }
      const actor = appointment.doctor.userId === input.actorUserId ? "doctor" : "admin";
      const decision = canTransition({
        actor,
        ownsRecord: actor === "doctor",
        from: appointment.status,
        to: "CONFIRMED",
        now,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      });
      if (!decision.ok) return { ok: false as const, code: decision.code === "TOO_LATE" ? "PAST" as const : "UNSUPPORTED" as const };
      const updated = await tx.appointment.updateMany({
        where: { id: appointment.id, status: AppointmentStatus.PENDING_APPROVAL },
        data: { status: AppointmentStatus.CONFIRMED },
      });
      if (updated.count !== 1) return { ok: false as const, code: "UNSUPPORTED" as const };
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          actorUserId: input.actorUserId,
          fromStatus: AppointmentStatus.PENDING_APPROVAL,
          toStatus: AppointmentStatus.CONFIRMED,
          detail: actor === "admin" ? "administrator_approved" : "doctor_approved",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "appointment.approved",
          entityType: "Appointment",
          entityId: appointment.id,
        },
      });
      return { ok: true as const, appointmentId: appointment.id };
    });
    return notifySaved(db, saved, "confirmed");
  } catch (error) {
    logBookingFailure(error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function advanceDoctorAppointment(
  input: { actorUserId: string; appointmentId: string; to: "CHECKED_IN" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW"; roleCodes?: readonly string[] },
  deps: Deps = {},
): Promise<BookingResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  if (!parseUuid(input.appointmentId)) return { ok: false, code: "NOT_FOUND" };
  try {
    return await runBookingTransaction(db, async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: input.appointmentId },
        select: { id: true, status: true, startsAt: true, endsAt: true, doctor: { select: { userId: true } } },
      });
      if (!appointment || !actsForAssignedDoctor(input.actorUserId, appointment.doctor.userId, input.roleCodes)) {
        return { ok: false as const, code: "NOT_FOUND" as const };
      }
      const decision = canTransition({
        actor: "doctor",
        ownsRecord: true,
        from: appointment.status,
        to: input.to,
        now,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      });
      if (!decision.ok) return { ok: false as const, code: "UNSUPPORTED" as const };
      const updated = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status },
        data: {
          status: input.to,
          checkedInAt: input.to === "CHECKED_IN" ? now : undefined,
          completedAt: input.to === "COMPLETED" ? now : undefined,
        },
      });
      if (updated.count !== 1) return { ok: false as const, code: "UNSUPPORTED" as const };
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          actorUserId: input.actorUserId,
          fromStatus: appointment.status,
          toStatus: input.to,
          detail: "doctor_status_update",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "appointment.status_updated",
          entityType: "Appointment",
          entityId: appointment.id,
          metadata: sanitizeMetadata({ from: appointment.status, to: input.to }) ?? undefined,
        },
      });
      return { ok: true as const, appointmentId: appointment.id };
    });
  } catch (error) {
    logBookingFailure(error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function rescheduleAppointment(
  input: { actorUserId: string; actor: Exclude<AppointmentActor, "system">; appointmentId: string; startsAt: Date; reason: string; roleCodes?: readonly string[] },
  deps: Deps = {},
): Promise<BookingResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  if (!parseUuid(input.appointmentId) || Number.isNaN(input.startsAt.getTime()) || input.startsAt <= now) {
    return { ok: false, code: input.startsAt <= now ? "PAST" : "NOT_FOUND" };
  }
  try {
    const saved = await runBookingTransaction(db, async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: input.appointmentId },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          offeringId: true,
          locationId: true,
          mode: true,
          patientProfileId: true,
          doctorProfileId: true,
          specialtyId: true,
          consultationServiceId: true,
          patientConcern: true,
          patient: { select: { userId: true } },
          doctor: { select: { userId: true } },
        },
      });
      const owns =
        input.actor === "admin" ||
        (input.actor === "doctor" && actsForAssignedDoctor(input.actorUserId, appointment?.doctor.userId, input.roleCodes)) ||
        (input.actor === "patient" && appointment?.patient.userId === input.actorUserId);
      if (!appointment || !owns || !appointment.offeringId) return { ok: false as const, code: "NOT_FOUND" as const };
      const decision = canTransition({
        actor: input.actor,
        ownsRecord: owns,
        from: appointment.status,
        to: "RESCHEDULED",
        now,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        reason: input.reason,
      });
      if (!decision.ok) {
        const code: BookingCode = decision.code === "REASON" ? "REASON" : decision.code === "TOO_LATE" ? "UNSUPPORTED" : "UNSUPPORTED";
        return { ok: false as const, code };
      }
      const offering = await tx.doctorOffering.findUnique({
        where: { id: appointment.offeringId },
        select: {
          id: true,
          isActive: true,
          doctorProfileId: true,
          mode: true,
          durationMinutes: true,
          price: true,
          priceAmountMinor: true,
          currency: true,
          consultationService: { select: { isActive: true } },
        },
      });
      if (!offering || !offering.isActive || !offering.consultationService.isActive || offering.doctorProfileId !== appointment.doctorProfileId || offering.mode !== appointment.mode) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }
      const snapshot = snapshotAppointmentFee({
        offering: { price: offering.price, priceAmountMinor: offering.priceAmountMinor, currency: offering.currency },
        fallbackMinor: 0,
      });
      if (!snapshot) return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      const endsAt = new Date(input.startsAt.getTime() + offering.durationMinutes * 60_000);
      const day = parseCalendarDate(input.startsAt.toISOString().slice(0, 10));
      if (!day) return { ok: false as const, code: "PAST" as const };
      await expireOverdueHolds(tx, appointment.doctorProfileId);
      const open = slotIsOpen({
        startsAt: input.startsAt,
        endsAt,
        mode: appointment.mode as SlotMode,
        locationId: appointment.locationId,
        offeringId: offering.id,
        rules: await loadDoctorRules(tx, appointment.doctorProfileId),
        blocks: await loadBlockingIntervals(tx, {
          doctorProfileId: appointment.doctorProfileId,
          rangeStart: day,
          rangeEnd: addDays(day, 1),
          now,
          excludeAppointmentId: appointment.id,
        }),
        now,
      });
      if (!open) return { ok: false as const, code: "SLOT_UNAVAILABLE" as const };
      const released = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status },
        data: { status: AppointmentStatus.RESCHEDULED },
      });
      if (released.count !== 1) return { ok: false as const, code: "UNSUPPORTED" as const };
      const created = await tx.appointment.create({
        data: {
          patientProfileId: appointment.patientProfileId,
          doctorProfileId: appointment.doctorProfileId,
          specialtyId: appointment.specialtyId,
          consultationServiceId: appointment.consultationServiceId,
          offeringId: offering.id,
          locationId: appointment.locationId,
          mode: appointment.mode,
          status: AppointmentStatus.CONFIRMED,
          startsAt: input.startsAt,
          endsAt,
          paymentHoldExpiresAt: null,
          feeAmount: snapshot.feeAmount,
          feeAmountMinor: snapshot.feeAmountMinor,
          currency: snapshot.currency,
          bookingSource: input.actor === "admin" ? AppointmentBookingSource.ADMIN : AppointmentBookingSource.WEB,
          rescheduledFromId: appointment.id,
          patientConcern: appointment.patientConcern,
        },
      });
      await tx.appointmentEvent.createMany({
        data: [
          {
            appointmentId: appointment.id,
            actorUserId: input.actorUserId,
            fromStatus: appointment.status,
            toStatus: AppointmentStatus.RESCHEDULED,
            detail: appointment.status === "PENDING_APPROVAL" ? "approved_new_time" : "rescheduled",
          },
          {
            appointmentId: created.id,
            actorUserId: input.actorUserId,
            toStatus: AppointmentStatus.CONFIRMED,
            detail: appointment.status === "PENDING_APPROVAL"
              ? `schedule_reason:${input.reason.trim().replace(/\s+/g, " ").slice(0, 500)}`
              : "rescheduled_without_payment",
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "appointment.rescheduled",
          entityType: "Appointment",
          entityId: created.id,
          metadata: sanitizeMetadata({ fromAppointmentId: appointment.id, reason: input.reason.trim().slice(0, 180) }) ?? undefined,
        },
      });
      return { ok: true as const, appointmentId: created.id };
    });
    return notifySaved(db, saved, "rescheduled");
  } catch (error) {
    const code = failureCode(error);
    if (code) return { ok: false, code };
    logBookingFailure(error);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export function bookingMessage(code: BookingCode): string {
  switch (code) {
    case "NOT_A_PATIENT":
      return "A patient profile is required before booking.";
    case "RATE_LIMITED":
      return "Too many booking attempts. Wait a few minutes and try again.";
    case "DOCTOR_UNAVAILABLE":
      return "That doctor is not available for new bookings.";
    case "CATALOG_UNAVAILABLE":
      return "That consultation is no longer available.";
    case "LOCATION":
      return "Choose a valid clinic for an in-person visit. Online visits do not use a clinic.";
    case "PAST":
      return "Choose a future appointment time.";
    case "SLOT_UNAVAILABLE":
      return "That time is already booked or is not open. Choose another time. A slot booked for another patient cannot be used.";
    case "NOT_FOUND":
      return "That appointment was not found.";
    case "FORBIDDEN":
      return "You cannot change this appointment.";
    case "UNSUPPORTED":
      return "That change is not allowed for this appointment.";
    case "REASON":
      return "Enter a reason between 10 and 500 characters.";
    case "CONCERN":
      return "Describe what is wrong, using 10 to 500 characters, before sending this request.";
    case "CHANNEL":
      return "Choose video, audio, or in person before you confirm.";
    default:
      return "The appointment could not be saved.";
  }
}
