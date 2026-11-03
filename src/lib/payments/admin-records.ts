import { PaymentStatus, type PrismaClient } from "@prisma/client";
import { parseUuid } from "@/lib/catalog/rules";
import { isUniqueConflict } from "@/lib/doctors/errors";
import { appointmentStatusLabel, formatMinorMoney, formatPlatformWhen } from "@/lib/admin/labels";
import { parseAfrimoneyTransactionId } from "./afrimoney-transfer";
import { parseOrangeTransactionId, reviewOrangeTransfer } from "./orange-transfer";
import { actorMayVerifyPayment, loadVerifierIds } from "./verifiers";

const RECORD_STATUSES = ["PENDING", "REQUIRES_ACTION", "PAID", "FAILED", "CANCELLED"] as const;
type RecordStatus = (typeof RECORD_STATUSES)[number];
type Wallet = "ORANGE_MONEY" | "AFRIMONEY";

type Actor = { userId: string; roleCodes: readonly string[] };
type Db = PrismaClient;

export function parsePaymentProvider(value: string): Wallet | null {
  if (value === "ORANGE_MONEY" || value === "AFRIMONEY") return value;
  return null;
}

export function parsePaymentRecordStatus(value: string): RecordStatus | null {
  return RECORD_STATUSES.find((status) => status === value) ?? null;
}

function referenceFor(provider: Wallet, value: string) {
  return provider === "AFRIMONEY" ? parseAfrimoneyTransactionId(value) : parseOrangeTransactionId(value);
}

async function allowed(db: Db, actor: Actor) {
  const verifierIds = await loadVerifierIds(db);
  return actorMayVerifyPayment({ roleCodes: actor.roleCodes, userId: actor.userId, verifierIds });
}

function denied() {
  return { ok: false as const, message: "Only a selected administrator can change a payment. A doctor cannot." };
}

export async function loadPaymentAppointmentChoices(db: Db) {
  const rows = await db.appointment.findMany({
    where: {
      feeAmountMinor: { gt: 0 },
      status: { in: ["PENDING_PAYMENT", "EXPIRED_UNPAID", "PENDING_APPROVAL", "CONFIRMED"] },
    },
    orderBy: { startsAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      startsAt: true,
      feeAmountMinor: true,
      currency: true,
      patient: { select: { fullName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    label: `${row.patient.fullName} · ${formatPlatformWhen(row.startsAt)} · ${formatMinorMoney(row.feeAmountMinor, row.currency)} · ${appointmentStatusLabel(row.status)}`,
  }));
}

export async function createAdminPayment(
  db: Db,
  actor: Actor,
  input: { appointmentId: string; provider: string; reference: string; status: string },
) {
  if (!(await allowed(db, actor))) return denied();
  const appointmentId = parseUuid(input.appointmentId);
  const provider = parsePaymentProvider(input.provider);
  const status = parsePaymentRecordStatus(input.status);
  if (!appointmentId || !provider || !status) return { ok: false as const, message: "Choose a visit, a wallet, and a status." };
  const reference = referenceFor(provider, input.reference);
  if (!reference) return { ok: false as const, message: "Enter the transaction code from the patient's phone. A PIN is not stored." };
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, feeAmountMinor: true, currency: true, patient: { select: { userId: true } } },
  });
  if (!appointment || appointment.feeAmountMinor <= 0) return { ok: false as const, message: "That visit does not have a fee to record." };
  const existing = await db.payment.findFirst({
    where: { appointmentId, status: { in: [PaymentStatus.PAID, PaymentStatus.REQUIRES_ACTION, PaymentStatus.PENDING] } },
    select: { id: true },
  });
  if (existing) return { ok: false as const, message: "This visit already has a payment waiting or verified." };
  try {
    const payment = await db.payment.create({
      data: {
        appointmentId,
        payerUserId: appointment.patient.userId,
        amountMinor: appointment.feeAmountMinor,
        currency: appointment.currency,
        status: status === "PAID" ? PaymentStatus.REQUIRES_ACTION : status,
        providerCode: provider,
        providerReference: reference,
        events: {
          create: {
            providerCode: provider,
            providerEventId: `admin-create:${appointmentId}:${reference}`,
            status: status === "PAID" ? PaymentStatus.REQUIRES_ACTION : status,
            payloadSummary: { source: "admin_record" },
          },
        },
      },
      select: { id: true },
    });
    await db.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: "payment.recorded",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { appointmentId, provider, status },
      },
    });
    if (status !== "PAID") return { ok: true as const, message: "The payment was recorded. It still needs an administrator to verify it before the visit counts as paid." };
    const reviewed = await reviewOrangeTransfer({ actorUserId: actor.userId, paymentId: payment.id, decision: "confirm" }, db);
    return { ok: reviewed.tone === "ok", message: reviewed.message };
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: false as const, message: "That transaction code is already recorded." };
    return { ok: false as const, message: "The payment could not be recorded." };
  }
}

export async function updateAdminPayment(
  db: Db,
  actor: Actor,
  input: { id: string; provider: string; reference: string; status: string },
) {
  if (!(await allowed(db, actor))) return denied();
  const id = parseUuid(input.id);
  const provider = parsePaymentProvider(input.provider);
  const status = parsePaymentRecordStatus(input.status);
  if (!id || !provider || !status) return { ok: false as const, message: "Choose a wallet and a status." };
  const reference = referenceFor(provider, input.reference);
  if (!reference) return { ok: false as const, message: "Enter the transaction code from the patient's phone. A PIN is not stored." };
  const payment = await db.payment.findUnique({
    where: { id },
    select: { id: true, status: true, providerCode: true, providerReference: true, appointmentId: true },
  });
  if (!payment) return { ok: false as const, message: "That payment was not found." };
  if (payment.status === "PAID" || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") {
    return { ok: false as const, message: "A verified payment stays as the administrator recorded it." };
  }
  if (status === "PAID") {
    try {
      await db.payment.update({ where: { id }, data: { providerCode: provider, providerReference: reference } });
    } catch (error) {
      if (isUniqueConflict(error)) return { ok: false as const, message: "That transaction code is already recorded." };
      return { ok: false as const, message: "The payment could not be updated." };
    }
    const reviewed = await reviewOrangeTransfer({ actorUserId: actor.userId, paymentId: id, decision: "confirm" }, db);
    return { ok: reviewed.tone === "ok", message: reviewed.message };
  }
  if (payment.providerCode === provider && payment.providerReference === reference && payment.status === status) {
    return { ok: true as const, message: "No payment changes were saved." };
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { providerCode: provider, providerReference: reference, status } });
      await tx.paymentEvent.create({
        data: {
          paymentId: id,
          providerCode: provider,
          providerEventId: `admin-update:${id}:${status}:${reference}`,
          status,
          payloadSummary: { source: "admin_record" },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: "payment.updated",
          entityType: "Payment",
          entityId: id,
          metadata: { appointmentId: payment.appointmentId, from: payment.status, to: status },
        },
      });
    });
    return { ok: true as const, message: "The payment was updated. The visit counts as paid only after it is verified." };
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: false as const, message: "That transaction code is already recorded." };
    return { ok: false as const, message: "The payment could not be updated." };
  }
}

export async function deleteAdminPayment(db: Db, actor: Actor, paymentId: string) {
  if (!(await allowed(db, actor))) return denied();
  const id = parseUuid(paymentId);
  if (!id) return { ok: false as const, message: "That payment was not found." };
  const payment = await db.payment.findUnique({
    where: { id },
    select: { id: true, status: true, appointmentId: true },
  });
  if (!payment) return { ok: false as const, message: "That payment was not found." };
  if (payment.status === "PAID" || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") {
    return { ok: false as const, message: "A verified payment stays on the visit and cannot be deleted." };
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.paymentEvent.deleteMany({ where: { paymentId: id } });
      await tx.payment.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: "payment.deleted",
          entityType: "Payment",
          entityId: id,
          metadata: { appointmentId: payment.appointmentId, status: payment.status },
        },
      });
    });
    return { ok: true as const, message: "The unverified payment was deleted." };
  } catch {
    return { ok: false as const, message: "The payment could not be deleted." };
  }
}
