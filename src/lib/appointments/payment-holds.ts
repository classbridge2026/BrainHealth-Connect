import {
  AppointmentBookingSource,
  AppointmentStatus,
  ConsultationMode,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { HOLD_MINUTES_MAX, HOLD_MINUTES_MIN } from "@/lib/admin/rules";
import { bookingCatalogDecision } from "@/lib/catalog/rules";
import { snapshotAppointmentFee, visitCharge } from "@/lib/catalog/money";
import { canReceiveNewAppointment } from "@/lib/doctors/rules";
import { prisma } from "@/lib/db/prisma";
import { saveChannelNotice } from "@/lib/notifications/delivery";
import { decidePaymentConfirmation } from "@/lib/payments/verification";
import { notifyAppointmentParties } from "./email-notice";

export const DEFAULT_PAYMENT_HOLD_MINUTES = 15;
export const HOLD_MINUTES_SETTING_KEY = "APPOINTMENT_PAYMENT_HOLD_MINUTES";
const OVERLAP_SQLSTATE = "23P01";

export type SlotUnavailable = { ok: false; code: "SLOT_UNAVAILABLE" };
export type DoctorUnavailable = { ok: false; code: "DOCTOR_UNAVAILABLE" };
export type CatalogUnavailable = { ok: false; code: "CATALOG_UNAVAILABLE" };
export type LatePaymentReview = {
  ok: false;
  code: "LATE_PAYMENT_NEEDS_REVIEW";
  appointmentId: string;
};
export type HoldCreated = {
  ok: true;
  appointmentId: string;
  paymentHoldExpiresAt: Date;
};
export type PaymentConfirmed = {
  ok: true;
  appointmentId: string;
  alreadyConfirmed: boolean;
};

export type CreatePaymentHoldInput = {
  patientProfileId: string;
  doctorProfileId: string;
  specialtyId: string;
  consultationServiceId: string;
  offeringId?: string;
  locationId?: string;
  mode: ConsultationMode;
  startsAt: Date;
  endsAt: Date;
  feeAmountMinor: number;
  currency?: string;
  bookingSource?: AppointmentBookingSource;
  followUpOfId?: string;
};

export function isOverlapError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: string;
    meta?: { code?: string };
    message?: string;
  };
  if (candidate.code === OVERLAP_SQLSTATE) {
    return true;
  }
  if (candidate.meta?.code === OVERLAP_SQLSTATE) {
    return true;
  }
  const databaseError = candidate.meta && "database_error" in candidate.meta ? (candidate.meta as { database_error?: unknown }).database_error : undefined;
  if (typeof databaseError === "string" && databaseError.includes(OVERLAP_SQLSTATE)) {
    return true;
  }
  if (
    typeof candidate.message === "string" &&
    (candidate.message.includes(OVERLAP_SQLSTATE) || candidate.message.includes("Appointment_doctor_occupying_no_overlap"))
  ) {
    return true;
  }
  if (depth < 3 && error instanceof Error && error.cause && error.cause !== error) {
    return isOverlapError(error.cause, depth + 1);
  }
  return false;
}

export async function getPaymentHoldMinutes(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const setting = await client.platformSetting.findUnique({
    where: { key: HOLD_MINUTES_SETTING_KEY },
  });
  const value = setting?.valueJson;
  if (typeof value === "number" && Number.isInteger(value) && value >= HOLD_MINUTES_MIN && value <= HOLD_MINUTES_MAX) {
    return value;
  }
  return DEFAULT_PAYMENT_HOLD_MINUTES;
}

export async function expireOverdueHolds(
  client: Prisma.TransactionClient | typeof prisma = prisma,
  doctorProfileId?: string,
): Promise<string[]> {
  const expired = doctorProfileId
    ? await client.$queryRaw<Array<{ id: string }>>`
        UPDATE "Appointment"
        SET
          "status" = 'EXPIRED_UNPAID',
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "status" = 'PENDING_PAYMENT'
          AND "paymentHoldExpiresAt" IS NOT NULL
          AND "paymentHoldExpiresAt" <= CURRENT_TIMESTAMP
          AND "doctorProfileId" = ${doctorProfileId}::uuid
        RETURNING "id"
      `
    : await client.$queryRaw<Array<{ id: string }>>`
        UPDATE "Appointment"
        SET
          "status" = 'EXPIRED_UNPAID',
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "status" = 'PENDING_PAYMENT'
          AND "paymentHoldExpiresAt" IS NOT NULL
          AND "paymentHoldExpiresAt" <= CURRENT_TIMESTAMP
        RETURNING "id"
      `;

  if (expired.length === 0) {
    return [];
  }

  await client.appointmentEvent.createMany({
    data: expired.map((row) => ({
      appointmentId: row.id,
      fromStatus: AppointmentStatus.PENDING_PAYMENT,
      toStatus: AppointmentStatus.EXPIRED_UNPAID,
      detail: "hold_expired",
    })),
  });

  return expired.map((row) => row.id);
}

export async function createPaymentHold(
  input: CreatePaymentHoldInput,
  db: typeof prisma = prisma,
): Promise<HoldCreated | SlotUnavailable | DoctorUnavailable | CatalogUnavailable> {
  if (input.endsAt <= input.startsAt) {
    throw new Error("Appointment end must be after start.");
  }

  try {
    return await db.$transaction(async (tx) => {
      const doctor = await tx.doctorProfile.findUnique({
        where: { id: input.doctorProfileId },
        select: {
          verificationStatus: true,
          user: { select: { status: true, deletedAt: true } },
          specialties: {
            where: { specialtyId: input.specialtyId },
            select: { claimStatus: true, specialty: { select: { isActive: true } } },
          },
        },
      });
      const claim = doctor?.specialties[0];
      if (
        !canReceiveNewAppointment({
          verificationStatus: doctor?.verificationStatus ?? null,
          userStatus: doctor?.user.status ?? null,
          deletedAt: doctor?.user.deletedAt ?? null,
          specialtyClaim: claim?.claimStatus ?? null,
          specialtyActive: claim?.specialty.isActive ?? false,
        })
      ) {
        return { ok: false as const, code: "DOCTOR_UNAVAILABLE" as const };
      }

      const [service, location, offering] = await Promise.all([
        tx.consultationService.findUnique({
          where: { id: input.consultationServiceId },
          select: { isActive: true },
        }),
        input.locationId
          ? tx.location.findUnique({ where: { id: input.locationId }, select: { isActive: true } })
          : Promise.resolve(null),
        input.offeringId
          ? tx.doctorOffering.findUnique({
              where: { id: input.offeringId },
              select: {
                isActive: true,
                doctorProfileId: true,
                consultationServiceId: true,
                specialtyId: true,
                mode: true,
                price: true,
                priceAmountMinor: true,
                currency: true,
                consultationService: { select: { defaultFee: true, currency: true } },
              },
            })
          : Promise.resolve(null),
      ]);
      const catalog = bookingCatalogDecision({
        serviceActive: service?.isActive ?? null,
        locationRequested: Boolean(input.locationId),
        locationActive: input.locationId ? (location?.isActive ?? null) : null,
        offeringRequested: Boolean(input.offeringId),
        offeringActive: input.offeringId ? (offering?.isActive ?? null) : null,
        offeringMatches: Boolean(
          offering &&
            offering.doctorProfileId === input.doctorProfileId &&
            offering.consultationServiceId === input.consultationServiceId &&
            offering.specialtyId === input.specialtyId &&
            offering.mode === input.mode,
        ),
      });
      if (catalog !== "ok") {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }

      const snapshot = offering
        ? visitCharge({
            price: offering.price,
            priceAmountMinor: offering.priceAmountMinor,
            currency: offering.currency,
            defaultFee: offering.consultationService?.defaultFee,
            defaultCurrency: offering.consultationService?.currency,
          })
        : snapshotAppointmentFee({
            offering: null,
            fallbackMinor: input.feeAmountMinor,
            fallbackCurrency: input.currency,
          });
      if (!snapshot) {
        return { ok: false as const, code: "CATALOG_UNAVAILABLE" as const };
      }

      await expireOverdueHolds(tx, input.doctorProfileId);
      const minutes = await getPaymentHoldMinutes(tx);
      const paymentHoldExpiresAt = new Date(Date.now() + minutes * 60_000);

      const appointment = await tx.appointment.create({
        data: {
          patientProfileId: input.patientProfileId,
          doctorProfileId: input.doctorProfileId,
          specialtyId: input.specialtyId,
          consultationServiceId: input.consultationServiceId,
          offeringId: input.offeringId,
          locationId: input.locationId,
          mode: input.mode,
          status: AppointmentStatus.PENDING_PAYMENT,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          paymentHoldExpiresAt,
          feeAmount: snapshot.feeAmount,
          feeAmountMinor: snapshot.feeAmountMinor,
          currency: snapshot.currency,
          bookingSource: input.bookingSource ?? AppointmentBookingSource.WEB,
          followUpOfId: input.followUpOfId,
        },
      });

      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          toStatus: AppointmentStatus.PENDING_PAYMENT,
          detail: "payment_hold_created",
        },
      });

      return {
        ok: true as const,
        appointmentId: appointment.id,
        paymentHoldExpiresAt,
      };
    });
  } catch (error) {
    if (isOverlapError(error)) {
      return { ok: false, code: "SLOT_UNAVAILABLE" };
    }
    throw error;
  }
}

export type PaymentRejected = {
  ok: false;
  code: "NOT_FOUND" | "AMOUNT_MISMATCH" | "PAYMENT_NOT_PAYABLE";
};

class PaymentStateError extends Error {
  constructor() {
    super("PAYMENT_STATE");
  }
}

export async function confirmVerifiedPayment(
  input: { appointmentId: string; paymentId: string },
  db: typeof prisma = prisma,
): Promise<PaymentConfirmed | LatePaymentReview | SlotUnavailable | PaymentRejected> {
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${input.appointmentId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${input.paymentId}::uuid FOR UPDATE`;
      const now = new Date();
      const appointment = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
      const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
      const decision = decidePaymentConfirmation({
        appointmentFound: Boolean(appointment),
        paymentFound: Boolean(payment),
        paymentAppointmentId: payment?.appointmentId ?? "",
        appointmentId: input.appointmentId,
        appointmentStatus: appointment?.status ?? "",
        paymentStatus: payment?.status ?? "",
        holdExpiresAt: appointment?.paymentHoldExpiresAt ?? null,
        now,
        paymentAmountMinor: payment?.amountMinor ?? Number.NaN,
        appointmentFeeMinor: appointment?.feeAmountMinor ?? Number.NaN,
        paymentCurrency: payment?.currency ?? "",
        appointmentCurrency: appointment?.currency ?? "",
      });
      if (!decision.ok) {
        if (decision.code === "LATE_PAYMENT_NEEDS_REVIEW") {
          return { ok: false as const, code: "LATE_PAYMENT_NEEDS_REVIEW" as const, appointmentId: input.appointmentId };
        }
        const code = decision.code;
        return { ok: false as const, code };
      }
      if (decision.action === "already_recorded") {
        return { ok: true as const, appointmentId: input.appointmentId, alreadyConfirmed: true };
      }

      const confirmed = await tx.appointment.updateMany({
        where: {
          id: input.appointmentId,
          status: AppointmentStatus.PENDING_PAYMENT,
          paymentHoldExpiresAt: { gt: now },
        },
        data: { status: AppointmentStatus.CONFIRMED },
      });
      if (confirmed.count !== 1) {
        const again = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
        const paidAgain = await tx.payment.findUnique({ where: { id: input.paymentId } });
        if (
          again?.status === AppointmentStatus.CONFIRMED &&
          paidAgain?.status === PaymentStatus.PAID &&
          paidAgain.appointmentId === input.appointmentId
        ) {
          return { ok: true as const, appointmentId: input.appointmentId, alreadyConfirmed: true };
        }
        return { ok: false as const, code: "LATE_PAYMENT_NEEDS_REVIEW" as const, appointmentId: input.appointmentId };
      }

      if (decision.action === "confirm_and_mark_paid" && payment && appointment) {
        const paid = await tx.payment.updateMany({
          where: {
            id: payment.id,
            appointmentId: appointment.id,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.REQUIRES_ACTION] },
            amountMinor: appointment.feeAmountMinor,
            currency: appointment.currency,
          },
          data: { status: PaymentStatus.PAID },
        });
        if (paid.count !== 1) throw new PaymentStateError();
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            providerCode: payment.providerCode,
            providerEventId: `verified:${payment.id}`,
            status: PaymentStatus.PAID,
            payloadSummary: { source: "verified_confirmation" },
          },
        });
      }

      await tx.appointmentEvent.create({
        data: {
          appointmentId: input.appointmentId,
          fromStatus: AppointmentStatus.PENDING_PAYMENT,
          toStatus: AppointmentStatus.CONFIRMED,
          detail: "payment_verified",
        },
      });
      return { ok: true as const, appointmentId: input.appointmentId, alreadyConfirmed: false };
    });
    if (result.ok && !result.alreadyConfirmed) {
      await notifyAppointmentParties(db, { appointmentId: result.appointmentId, event: "confirmed" });
      await notifyVerifiedPayment(db, result.appointmentId);
    }
    return result;
  } catch (error) {
    if (error instanceof PaymentStateError) return { ok: false, code: "PAYMENT_NOT_PAYABLE" };
    if (isOverlapError(error)) return { ok: false, code: "SLOT_UNAVAILABLE" };
    throw error;
  }
}

async function notifyVerifiedPayment(db: typeof prisma, appointmentId: string) {
  try {
    const appointment = await db.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, patient: { select: { userId: true } } },
    });
    if (!appointment) return;
    await saveChannelNotice(db, {
      recipientId: appointment.patient.userId,
      channel: "IN_APP",
      type: "payment.verified",
      title: "Payment verified",
      preview: "A payment for your appointment was verified. This message does not include card or account numbers.",
      entityType: "Appointment",
      entityId: appointment.id,
      status: "SENT",
    });
  } catch {
    console.error("payment_notice_failed");
  }
}
