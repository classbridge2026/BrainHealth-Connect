import { PaymentStatus, type PrismaClient } from "@prisma/client";
import { parseUuid } from "@/lib/catalog/rules";
import { isUniqueConflict } from "@/lib/doctors/errors";
import { notifyAppointmentParties } from "@/lib/appointments/email-notice";
import { saveChannelNotice } from "@/lib/notifications/delivery";
import { notifyAdminsToVerifyPayment } from "./admin-notice";
import { actorMayVerifyPayment, loadVerifierIds } from "./verifiers";
import { giveOriginalSlot } from "./restore-visit";
import { confirmVerifiedPayment } from "@/lib/appointments/payment-holds";
import { AFRIMONEY, normalizeSierraLeoneMsisdn } from "./mobile-money";
import { nextProviderPaymentStatus, paymentAmountsMatch } from "./verification";

export const ORANGE_MONEY_NUMBER_KEY = "ORANGE_MONEY_NUMBER";
const ORANGE_MONEY = "ORANGE_MONEY";

type Db = PrismaClient;

export function orangeDialNumber(input: string): string | null {
  const msisdn = normalizeSierraLeoneMsisdn(input);
  if (!msisdn) return null;
  return `0${msisdn.slice(3)}`;
}

export function formatOrangeDialNumber(dialNumber: string) {
  return dialNumber.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

/** Whole leones when the fee has no cents. Orange Money dials this amount. */
export function ussdAmount(minor: number): string | null {
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  if (minor % 100 === 0) return String(minor / 100);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

export function orangeTransferCode(dialNumber: string, amount: string) {
  return `#144*2*1*${dialNumber}*${amount}*PIN#`;
}

export function orangeDialHref(dialNumber: string, amount: string) {
  return `tel:${encodeURIComponent(`#144*2*1*${dialNumber}*${amount}*`)}`;
}

/** Orange Money IDs look like PP250502.1502.B91020: two letters, the date, the time, then a receipt code. */
const ORANGE_TRANSACTION_ID = /^[A-Z]{2}\d{6}\.\d{4}\.[A-Z]\d{5}$/;

export function parseOrangeTransactionId(input: string): string | null {
  const value = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!ORANGE_TRANSACTION_ID.test(value)) return null;
  return value;
}

export function readStoredOrangeNumber(value: unknown): string | null {
  return typeof value === "string" ? orangeDialNumber(value) : null;
}

export async function loadOrangeDialNumber(db: Db): Promise<string | null> {
  const row = await db.platformSetting.findUnique({ where: { key: ORANGE_MONEY_NUMBER_KEY }, select: { valueJson: true } });
  return readStoredOrangeNumber(row?.valueJson);
}

export async function saveOrangeReceiveNumber(input: string, db: Db, actorUserId: string) {
  const dial = orangeDialNumber(input);
  if (!dial) return { ok: false as const, message: "Enter the Sierra Leone Orange Money number that should receive visit payments." };
  const stored = `232${dial.slice(1)}`;
  await db.$transaction(async (tx) => {
    const saved = await tx.platformSetting.upsert({
      where: { key: ORANGE_MONEY_NUMBER_KEY },
      create: { key: ORANGE_MONEY_NUMBER_KEY, valueJson: stored },
      update: { valueJson: stored },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "settings.orange_number_updated",
        entityType: "PlatformSetting",
        entityId: saved.id,
        metadata: { orangeNumber: dial },
      },
    });
  });
  return { ok: true as const, message: `Visit payments now show Orange Money ${formatOrangeDialNumber(dial)}.`, dial };
}

export async function reportOrangeTransfer(
  input: { actorUserId: string; appointmentId: string; reference: string; receipt: { bytes: Uint8Array; mimeType: string } },
  db: Db,
): Promise<{ message: string; tone?: "ok" | "error" }> {
  const appointmentId = parseUuid(input.appointmentId);
  const reference = parseOrangeTransactionId(input.reference);
  if (!appointmentId) return { message: "This visit could not be found.", tone: "error" };
  if (input.receipt.bytes.byteLength === 0 || !input.receipt.mimeType.startsWith("image/")) {
    return { message: "Upload a screenshot of the Orange Money transaction details.", tone: "error" };
  }
  const dial = await loadOrangeDialNumber(db);
  if (!dial) return { message: "The clinic has not saved an Orange Money number yet.", tone: "error" };

  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, patient: { userId: input.actorUserId } },
    select: { id: true, status: true, feeAmountMinor: true, currency: true },
  });
  if (!appointment) return { message: "This visit could not be found.", tone: "error" };
  if (appointment.status !== "CONFIRMED" && appointment.status !== "PENDING_PAYMENT" && appointment.status !== "PENDING_APPROVAL" && appointment.status !== "EXPIRED_UNPAID") {
    return { message: "This visit is not waiting for a payment.", tone: "error" };
  }
  if (appointment.feeAmountMinor <= 0) return { message: "This visit does not have a fee.", tone: "error" };

  const existing = await db.payment.findFirst({
    where: { appointmentId, status: { in: [PaymentStatus.PAID, PaymentStatus.REQUIRES_ACTION, PaymentStatus.PENDING] } },
    select: { status: true },
  });
  if (existing?.status === "PAID") return { message: "This visit is already paid.", tone: "ok" };
  if (existing) return { message: "This transfer is already waiting for the clinic to confirm it.", tone: "ok" };

  try {
    const payment = await db.payment.create({
      data: {
        appointmentId,
        payerUserId: input.actorUserId,
        amountMinor: appointment.feeAmountMinor,
        currency: appointment.currency,
        status: PaymentStatus.REQUIRES_ACTION,
        providerCode: ORANGE_MONEY,
        providerReference: reference,
        providerAccountId: `232${dial.slice(1)}`,
        receiptBytes: Buffer.from(input.receipt.bytes),
        receiptMime: input.receipt.mimeType,
        events: {
          create: {
            providerCode: ORANGE_MONEY,
            providerEventId: reference ? `reported:${reference}` : `reported:receipt:${appointmentId}:${crypto.randomUUID()}`,
            status: PaymentStatus.REQUIRES_ACTION,
            payloadSummary: { source: "orange_ussd", reference },
          },
        },
      },
      select: { id: true },
    });
    await notifyAdminsToVerifyPayment(db, { paymentId: payment.id, wallet: "Orange Money", reference: reference ?? "screenshot" });
  } catch (error) {
    if (isUniqueConflict(error)) return { message: "That Orange Money transaction code is already recorded.", tone: "error" };
    throw error;
  }
  await saveChannelNotice(db, {
    recipientId: input.actorUserId,
    channel: "IN_APP",
    type: "payment.orange_reported",
    title: "Orange Money transfer sent",
    preview: reference ? `Transaction ${reference} is with the clinic.` : "Your payment screenshot is with the clinic.",
    entityType: "Appointment",
    entityId: appointmentId,
    status: "SENT",
  }).catch(() => undefined);
  return { message: "The clinic will confirm this Orange Money transfer.", tone: "ok" };
}

const CONFIRMABLE_VISIT = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"]);

export async function reviewOrangeTransfer(
  input: { actorUserId: string; paymentId: string; decision: "confirm" | "reject" },
  db: Db,
): Promise<{ message: string; tone: "ok" | "error" }> {
  const paymentId = parseUuid(input.paymentId);
  if (!paymentId) return { message: "That payment was not found.", tone: "error" };
  const actor = await db.user.findUnique({
    where: { id: input.actorUserId },
    select: { status: true, deletedAt: true, roles: { select: { role: { select: { code: true } } } } },
  });
  const roleCodes = actor?.roles.map((row) => row.role.code) ?? [];
  const allowed = Boolean(
    actor &&
      !actor.deletedAt &&
      actor.status === "ACTIVE" &&
      actorMayVerifyPayment({ roleCodes, userId: input.actorUserId, verifierIds: await loadVerifierIds(db) }),
  );
  if (!allowed) return { message: "Only a selected administrator can verify this payment. A doctor cannot.", tone: "error" };
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      providerCode: true,
      providerReference: true,
      amountMinor: true,
      currency: true,
      appointmentId: true,
      appointment: { select: { status: true, feeAmountMinor: true, currency: true, paymentHoldExpiresAt: true } },
    },
  });
  const phoneTransfer = payment?.providerCode === ORANGE_MONEY || payment?.providerCode === AFRIMONEY;
  if (!payment || !phoneTransfer) {
    return { message: "That phone transfer was not found.", tone: "error" };
  }
  const wallet = payment.providerCode === AFRIMONEY ? "Afrimoney" : "Orange Money";
  if (payment.status === "PAID" && input.decision === "confirm") return { message: "This payment is already confirmed.", tone: "ok" };
  const incoming = input.decision === "confirm" ? "PAID" : "FAILED";
  const next = nextProviderPaymentStatus(payment.status, incoming);
  if ("rejected" in next || !next.changed) return { message: "This payment can no longer be changed.", tone: "error" };
  if (
    !paymentAmountsMatch({
      paymentAmountMinor: payment.amountMinor,
      appointmentFeeMinor: payment.appointment.feeAmountMinor,
      paymentCurrency: payment.currency,
      appointmentCurrency: payment.appointment.currency,
    })
  ) {
    return { message: "The transfer amount does not match the visit fee.", tone: "error" };
  }

  if (input.decision === "confirm" && payment.appointment.status === "PENDING_PAYMENT") {
    const confirmed = await confirmVerifiedPayment({ appointmentId: payment.appointmentId, paymentId: payment.id }, db);
    if (confirmed.ok) return { message: `The ${wallet} transfer is confirmed and the visit is booked.`, tone: "ok" };
    if (confirmed.code === "LATE_PAYMENT_NEEDS_REVIEW" || confirmed.code === "SLOT_UNAVAILABLE") {
      const restored = await giveOriginalSlot(db, { userId: input.actorUserId, roleCodes }, payment.id);
      return { message: restored.message, tone: restored.ok ? "ok" : "error" };
    }
    return { message: "The payment hold has closed, so this visit was not confirmed.", tone: "error" };
  }
  const awaitingApproval = payment.appointment.status === "PENDING_APPROVAL";
  const released = payment.appointment.status === "EXPIRED_UNPAID";
  if (input.decision === "confirm" && released) {
    const restored = await giveOriginalSlot(db, { userId: input.actorUserId, roleCodes }, payment.id);
    return { message: restored.message, tone: restored.ok ? "ok" : "error" };
  }
  if (input.decision === "confirm" && !CONFIRMABLE_VISIT.has(payment.appointment.status) && !awaitingApproval) {
    return { message: "This visit is not waiting for a payment.", tone: "error" };
  }

  const afri = payment.providerCode === AFRIMONEY;
  await db.payment.update({ where: { id: payment.id }, data: { status: next.status as PaymentStatus } });
  await db.paymentEvent.create({
    data: {
      paymentId: payment.id,
      providerCode: payment.providerCode,
      providerEventId: `${input.decision}:${payment.id}`,
      status: next.status as PaymentStatus,
      payloadSummary: { source: "clinic_review" },
    },
  });
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.decision === "confirm"
        ? afri ? "payment.afrimoney_confirmed" : "payment.orange_confirmed"
        : afri ? "payment.afrimoney_rejected" : "payment.orange_rejected",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { appointmentId: payment.appointmentId },
    },
  });
  if (input.decision === "confirm" && awaitingApproval) {
    await notifyAppointmentParties(db, { appointmentId: payment.appointmentId, event: "paid" });
  }
  return {
    message: input.decision === "confirm"
      ? awaitingApproval
        ? `The ${wallet} transfer is confirmed. The doctor can approve the visit.`
        : `The ${wallet} transfer is confirmed.`
      : "The transfer was not accepted. The patient can send it again.",
    tone: "ok",
  };
}
