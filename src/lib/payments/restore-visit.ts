import { AppointmentStatus, PaymentStatus, type PrismaClient } from "@prisma/client";
import { parseUuid } from "@/lib/catalog/rules";
import { notifyAppointmentParties } from "@/lib/appointments/email-notice";
import { loadBlockingIntervals, loadDoctorRules } from "@/lib/appointments/schedule-data";
import { slotIsOpen } from "@/lib/appointments/slots";
import { addDays, formatBookingWhen, freetownDate, parseCalendarDate } from "@/lib/appointments/time";
import { loadOfferingSlots } from "@/lib/appointments/queries";
import { actorMayVerifyPayment, loadVerifierIds } from "./verifiers";

type Db = PrismaClient;
type Actor = { userId: string; roleCodes: readonly string[] };

const OCCUPYING = ["PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;

/** The original time can be given back only while it is still ahead and nobody else holds it. */
export function releasedVisitChoice(input: { startsAt: Date; now: Date; taken: boolean }): "restore" | "move" {
  if (input.taken || input.startsAt.getTime() <= input.now.getTime()) return "move";
  return "restore";
}

function holdReleased(status: string, hold: Date | null, now: Date) {
  return status === "EXPIRED_UNPAID" || (status === "PENDING_PAYMENT" && hold !== null && hold.getTime() <= now.getTime());
}

async function mayRestore(db: Db, actor: Actor) {
  const verifierIds = await loadVerifierIds(db);
  return actorMayVerifyPayment({ roleCodes: actor.roleCodes, userId: actor.userId, verifierIds });
}

const denied = { ok: false as const, message: "Only a selected administrator can give this time. A doctor cannot." };

async function slotTaken(db: Db, input: { id: string; doctorProfileId: string; startsAt: Date; endsAt: Date; now: Date }) {
  const clash = await db.appointment.findFirst({
    where: {
      doctorProfileId: input.doctorProfileId,
      id: { not: input.id },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      OR: [
        { status: { in: [...OCCUPYING] } },
        { status: "PENDING_PAYMENT", paymentHoldExpiresAt: { gt: input.now } },
      ],
    },
    select: { id: true },
  });
  return Boolean(clash);
}

export async function describeReleasedVisit(db: Db, appointmentId: string, now = new Date()) {
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      paymentHoldExpiresAt: true,
      doctorProfileId: true,
      offeringId: true,
      locationId: true,
    },
  });
  if (!appointment || !holdReleased(appointment.status, appointment.paymentHoldExpiresAt, now)) return null;
  const taken = await slotTaken(db, { ...appointment, now });
  const choice = releasedVisitChoice({ startsAt: appointment.startsAt, now, taken });
  const slots = choice === "move" && appointment.offeringId ? await openSlots(db, appointment, now) : [];
  return { choice, when: formatBookingWhen(appointment.startsAt), slots };
}

async function openSlots(
  db: Db,
  appointment: { id: string; offeringId: string | null; locationId: string | null },
  now: Date,
) {
  if (!appointment.offeringId) return [];
  const start = parseCalendarDate(freetownDate(now)) ?? now;
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index).toISOString().slice(0, 10));
  const lists = await Promise.all(
    days.map((day) =>
      loadOfferingSlots(db, {
        offeringId: appointment.offeringId ?? "",
        day,
        locationId: appointment.locationId,
        now,
        excludeAppointmentId: appointment.id,
      }).catch(() => ({ ok: false as const })),
    ),
  );
  return lists
    .flatMap((result) => (result.ok ? result.slots : []))
    .slice(0, 12)
    .map((slot) => ({ startsAt: slot.startsAt, label: formatBookingWhen(new Date(slot.startsAt)) }));
}

async function markVerified(tx: Db, payment: { id: string; status: string; providerCode: string }) {
  if (payment.status === "PAID") return true;
  if (payment.status !== "REQUIRES_ACTION" && payment.status !== "PENDING") return false;
  const paid = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: [PaymentStatus.REQUIRES_ACTION, PaymentStatus.PENDING] } },
    data: { status: PaymentStatus.PAID },
  });
  if (paid.count !== 1) return false;
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      providerCode: payment.providerCode,
      providerEventId: `restored:${payment.id}`,
      status: PaymentStatus.PAID,
      payloadSummary: { source: "paid_visit_restored" },
    },
  });
  return true;
}

export async function giveOriginalSlot(db: Db, actor: Actor, paymentId: string, now = new Date()) {
  if (!(await mayRestore(db, actor))) return denied;
  const id = parseUuid(paymentId);
  if (!id) return { ok: false as const, message: "That payment was not found." };
  const payment = await db.payment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      providerCode: true,
      appointment: {
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          paymentHoldExpiresAt: true,
          doctorProfileId: true,
        },
      },
    },
  });
  const visit = payment?.appointment;
  if (!payment || !visit || !holdReleased(visit.status, visit.paymentHoldExpiresAt, now)) {
    return { ok: false as const, message: "This visit is not waiting for its paid time to be given back." };
  }
  if (payment.status !== "PAID" && payment.status !== "REQUIRES_ACTION" && payment.status !== "PENDING") {
    return { ok: false as const, message: "This payment cannot be used for the consultation." };
  }
  const taken = await slotTaken(db, { id: visit.id, doctorProfileId: visit.doctorProfileId, startsAt: visit.startsAt, endsAt: visit.endsAt, now });
  if (releasedVisitChoice({ startsAt: visit.startsAt, now, taken }) === "move") {
    return {
      ok: false as const,
      message: taken
        ? "That time has been taken. Choose another time. The patient does not pay again."
        : "That time has passed. Choose another time. The patient does not pay again.",
    };
  }
  try {
    const saved = await db.$transaction(async (tx) => {
      const restored = await tx.appointment.updateMany({
        where: { id: visit.id, status: { in: [AppointmentStatus.EXPIRED_UNPAID, AppointmentStatus.PENDING_PAYMENT] } },
        data: { status: AppointmentStatus.CONFIRMED, paymentHoldExpiresAt: null },
      });
      if (restored.count !== 1) return false;
      if (!(await markVerified(tx as Db, payment))) return false;
      await tx.appointmentEvent.create({
        data: {
          appointmentId: visit.id,
          actorUserId: actor.userId,
          fromStatus: visit.status as AppointmentStatus,
          toStatus: AppointmentStatus.CONFIRMED,
          detail: "paid_slot_restored",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: "payment.visit_restored",
          entityType: "Appointment",
          entityId: visit.id,
          metadata: { paymentId: payment.id },
        },
      });
      return true;
    });
    if (!saved) return { ok: false as const, message: "That time could not be given back." };
    await notifyAppointmentParties(db, { appointmentId: visit.id, event: "confirmed" }).catch(() => undefined);
    return { ok: true as const, message: "The original time is given back. The patient does not pay again." };
  } catch {
    return { ok: false as const, message: "That time could not be given back." };
  }
}

export async function giveAnotherTime(db: Db, actor: Actor, paymentId: string, startsAtInput: string, now = new Date()) {
  if (!(await mayRestore(db, actor))) return denied;
  const id = parseUuid(paymentId);
  const startsAt = new Date(startsAtInput);
  if (!id || Number.isNaN(startsAt.getTime()) || startsAt <= now) {
    return { ok: false as const, message: "Choose an open time that is still ahead." };
  }
  const payment = await db.payment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      providerCode: true,
      appointment: true,
    },
  });
  const visit = payment?.appointment;
  if (!payment || !visit || !visit.offeringId || !holdReleased(visit.status, visit.paymentHoldExpiresAt, now)) {
    return { ok: false as const, message: "This paid visit cannot be moved to another time." };
  }
  if (payment.status !== "PAID" && payment.status !== "REQUIRES_ACTION" && payment.status !== "PENDING") {
    return { ok: false as const, message: "This payment cannot be used for the consultation." };
  }
  const endsAt = new Date(startsAt.getTime() + (visit.endsAt.getTime() - visit.startsAt.getTime()));
  const day = parseCalendarDate(startsAt.toISOString().slice(0, 10));
  if (!day) return { ok: false as const, message: "Choose an open time that is still ahead." };
  const open = slotIsOpen({
    startsAt,
    endsAt,
    mode: visit.mode,
    locationId: visit.locationId,
    offeringId: visit.offeringId,
    rules: await loadDoctorRules(db, visit.doctorProfileId),
    blocks: await loadBlockingIntervals(db, {
      doctorProfileId: visit.doctorProfileId,
      rangeStart: day,
      rangeEnd: addDays(day, 1),
      now,
      excludeAppointmentId: visit.id,
    }),
    now,
  });
  if (!open) return { ok: false as const, message: "That time is not open. Choose another one. The patient does not pay again." };
  try {
    const createdId = await db.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          patientProfileId: visit.patientProfileId,
          doctorProfileId: visit.doctorProfileId,
          specialtyId: visit.specialtyId,
          consultationServiceId: visit.consultationServiceId,
          offeringId: visit.offeringId,
          locationId: visit.locationId,
          mode: visit.mode,
          visitChannel: visit.visitChannel,
          status: AppointmentStatus.CONFIRMED,
          startsAt,
          endsAt,
          paymentHoldExpiresAt: null,
          feeAmount: visit.feeAmount,
          feeAmountMinor: visit.feeAmountMinor,
          currency: visit.currency,
          bookingSource: "ADMIN",
          rescheduledFromId: visit.id,
          patientConcern: visit.patientConcern,
          intakeHistory: visit.intakeHistory,
          consentAcceptedAt: visit.consentAcceptedAt,
        },
        select: { id: true },
      });
      await tx.appointment.update({ where: { id: visit.id }, data: { status: AppointmentStatus.RESCHEDULED } });
      await tx.payment.update({ where: { id: payment.id }, data: { appointmentId: created.id, status: PaymentStatus.PAID } });
      if (payment.status !== "PAID") {
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            providerCode: payment.providerCode,
            providerEventId: `restored:${payment.id}`,
            status: PaymentStatus.PAID,
            payloadSummary: { source: "paid_visit_moved" },
          },
        });
      }
      await tx.appointmentEvent.createMany({
        data: [
          {
            appointmentId: visit.id,
            actorUserId: actor.userId,
            fromStatus: visit.status,
            toStatus: AppointmentStatus.RESCHEDULED,
            detail: "paid_visit_moved",
          },
          {
            appointmentId: created.id,
            actorUserId: actor.userId,
            toStatus: AppointmentStatus.CONFIRMED,
            detail: "paid_visit_without_new_fee",
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: "payment.visit_moved",
          entityType: "Appointment",
          entityId: created.id,
          metadata: { paymentId: payment.id, fromAppointmentId: visit.id },
        },
      });
      return created.id;
    });
    await notifyAppointmentParties(db, { appointmentId: createdId, event: "rescheduled" }).catch(() => undefined);
    return { ok: true as const, message: "The consultation is booked at the new time. The patient does not pay again." };
  } catch {
    return { ok: false as const, message: "That time could not be given. Choose another open time." };
  }
}
