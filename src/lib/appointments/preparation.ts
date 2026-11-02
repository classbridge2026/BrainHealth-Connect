import { AppointmentStatus, type PrismaClient } from "@prisma/client";
import { sanitizeMetadata } from "@/lib/admin/rules";
import { cleanRequiredText, parseUuid } from "@/lib/catalog/rules";
import { prisma } from "@/lib/db/prisma";
import { canTransition } from "./transitions";

const PREPARING = new Set(["PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"]);

export async function savePatientIntake(
  input: { actorUserId: string; appointmentId: string; history: string; consent: boolean; now?: Date },
  db: PrismaClient = prisma,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!parseUuid(input.appointmentId)) return { ok: false, message: "That appointment was not found." };
  const history = cleanRequiredText(input.history, 10, 1000, "a short history");
  if (!history.ok) return { ok: false, message: history.message };
  if (!input.consent) return { ok: false, message: "Accept the consultation consent before the visit." };
  const now = input.now ?? new Date();
  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, patient: { userId: input.actorUserId } },
    select: { id: true, status: true },
  });
  if (!appointment || !PREPARING.has(appointment.status)) {
    return { ok: false, message: "This visit is not open for preparation." };
  }
  await db.appointment.update({
    where: { id: appointment.id },
    data: { intakeHistory: history.text, consentAcceptedAt: now },
  });
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: "appointment.intake_saved",
      entityType: "Appointment",
      entityId: appointment.id,
      metadata: sanitizeMetadata({ consent: true }) ?? undefined,
    },
  });
  return { ok: true };
}

export async function checkInPatientVisit(
  input: { actorUserId: string; appointmentId: string; now?: Date },
  db: PrismaClient = prisma,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = input.now ?? new Date();
  if (!parseUuid(input.appointmentId)) return { ok: false, message: "That appointment was not found." };
  const appointment = await db.appointment.findFirst({
    where: { id: input.appointmentId, patient: { userId: input.actorUserId } },
    select: { id: true, status: true, startsAt: true, endsAt: true, consentAcceptedAt: true },
  });
  if (!appointment) return { ok: false, message: "That appointment was not found." };
  if (!appointment.consentAcceptedAt) return { ok: false, message: "Save your history and accept the consent before eCheck-in." };
  const decision = canTransition({
    actor: "patient",
    ownsRecord: true,
    from: appointment.status,
    to: "CHECKED_IN",
    now,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
  });
  if (!decision.ok) {
    if (decision.code === "TOO_EARLY") return { ok: false, message: "eCheck-in opens 15 minutes before the visit." };
    return { ok: false, message: "This visit cannot be checked in now." };
  }
  const updated = await db.appointment.updateMany({
    where: { id: appointment.id, status: AppointmentStatus.CONFIRMED },
    data: { status: AppointmentStatus.CHECKED_IN, checkedInAt: now },
  });
  if (updated.count !== 1) return { ok: false, message: "This visit cannot be checked in now." };
  await db.appointmentEvent.create({
    data: {
      appointmentId: appointment.id,
      actorUserId: input.actorUserId,
      fromStatus: AppointmentStatus.CONFIRMED,
      toStatus: AppointmentStatus.CHECKED_IN,
      detail: "patient_echeckin",
    },
  });
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: "appointment.checked_in",
      entityType: "Appointment",
      entityId: appointment.id,
    },
  });
  return { ok: true };
}
