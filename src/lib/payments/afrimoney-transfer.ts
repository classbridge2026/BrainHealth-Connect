import { PaymentStatus, type PrismaClient } from "@prisma/client";
import { parseUuid } from "@/lib/catalog/rules";
import { isUniqueConflict } from "@/lib/doctors/errors";
import { AFRIMONEY } from "./mobile-money";
import { notifyAdminsToVerifyPayment } from "./admin-notice";
import { formatOrangeDialNumber, orangeDialNumber, ussdAmount } from "./orange-transfer";

/** Afrimoney SMS codes vary. A 4-digit PIN is rejected. */
export function parseAfrimoneyTransactionId(input: string): string | null {
  const value = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9.-]{5,39}$/.test(value)) return null;
  if (/^\d{4}$/.test(value)) return null;
  return value;
}

export const AFRIMONEY_NUMBER_KEY = "AFRIMONEY_NUMBER";

type Db = PrismaClient;

function afrimoneyCodeNumber(dialNumber: string) {
  return dialNumber.replace(/\s+/g, "");
}

/** Africell Sierra Leone: *161*1*1*system number*amount*PIN#. The PIN stays on the phone. */
export function afrimoneyTransferCode(dialNumber: string, amount: string) {
  return `*161*1*1*${afrimoneyCodeNumber(dialNumber)}*${amount}*PIN#`;
}

export function afrimoneyDialHref(dialNumber: string, amount: string) {
  return `tel:${encodeURIComponent(`*161*1*1*${afrimoneyCodeNumber(dialNumber)}*${amount}*`)}`;
}

export function readStoredAfrimoneyNumber(value: unknown): string | null {
  return typeof value === "string" ? orangeDialNumber(value) : null;
}

export async function loadAfrimoneyDialNumber(db: Db): Promise<string | null> {
  const row = await db.platformSetting.findUnique({ where: { key: AFRIMONEY_NUMBER_KEY }, select: { valueJson: true } });
  return readStoredAfrimoneyNumber(row?.valueJson);
}

export async function saveAfrimoneyReceiveNumber(input: string, db: Db, actorUserId: string) {
  const dial = orangeDialNumber(input);
  if (!dial) return { ok: false as const, message: "Enter the Sierra Leone Afrimoney number that should receive visit payments." };
  const stored = `232${dial.slice(1)}`;
  await db.$transaction(async (tx) => {
    const saved = await tx.platformSetting.upsert({
      where: { key: AFRIMONEY_NUMBER_KEY },
      create: { key: AFRIMONEY_NUMBER_KEY, valueJson: stored },
      update: { valueJson: stored },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "settings.afrimoney_number_updated",
        entityType: "PlatformSetting",
        entityId: saved.id,
        metadata: { afrimoneyNumber: dial },
      },
    });
  });
  return { ok: true as const, message: `Visit payments now show Afrimoney ${formatOrangeDialNumber(dial)}.`, dial };
}

export async function reportAfrimoneyTransfer(
  input: { actorUserId: string; appointmentId: string; reference: string; receipt: { bytes: Uint8Array; mimeType: string } },
  db: Db,
): Promise<{ message: string; tone?: "ok" | "error" }> {
  const appointmentId = parseUuid(input.appointmentId);
  const reference = parseAfrimoneyTransactionId(input.reference);
  if (!appointmentId) return { message: "This visit could not be found.", tone: "error" };
  if (input.receipt.bytes.byteLength === 0 || !input.receipt.mimeType.startsWith("image/")) {
    return { message: "Upload a screenshot of the Afrimoney transaction details.", tone: "error" };
  }
  const dial = await loadAfrimoneyDialNumber(db);
  if (!dial) return { message: "The clinic has not saved an Afrimoney number yet.", tone: "error" };

  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, patient: { userId: input.actorUserId } },
    select: { id: true, status: true, feeAmountMinor: true, currency: true },
  });
  if (!appointment) return { message: "This visit could not be found.", tone: "error" };
  if (appointment.status !== "CONFIRMED" && appointment.status !== "PENDING_PAYMENT" && appointment.status !== "PENDING_APPROVAL") {
    return { message: "This visit is not waiting for a payment.", tone: "error" };
  }
  if (appointment.feeAmountMinor <= 0) return { message: "This visit does not have a fee.", tone: "error" };
  if (!ussdAmount(appointment.feeAmountMinor)) return { message: "This visit fee cannot be sent by phone.", tone: "error" };

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
        providerCode: AFRIMONEY,
        providerReference: reference,
        providerAccountId: `232${dial.slice(1)}`,
        receiptBytes: Buffer.from(input.receipt.bytes),
        receiptMime: input.receipt.mimeType,
        events: {
          create: {
            providerCode: AFRIMONEY,
            providerEventId: reference ? `reported:${reference}` : `reported:receipt:${appointmentId}:${crypto.randomUUID()}`,
            status: PaymentStatus.REQUIRES_ACTION,
            payloadSummary: { source: "afrimoney_ussd", reference },
          },
        },
      },
      select: { id: true },
    });
    await notifyAdminsToVerifyPayment(db, { paymentId: payment.id, wallet: "Afrimoney", reference: reference ?? "screenshot" });
  } catch (error) {
    if (isUniqueConflict(error)) return { message: "That Afrimoney transaction code is already recorded.", tone: "error" };
    throw error;
  }
  return { message: "The clinic will confirm this Afrimoney transfer.", tone: "ok" };
}
