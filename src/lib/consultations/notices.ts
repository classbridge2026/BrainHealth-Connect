import type { PrismaClient } from "@prisma/client";
import { publicAppOrigin } from "@/lib/brand/metadata-base";
import { loadSystemName } from "@/lib/brand/system-name";
import { sendCareCircleEmail, type DeliveryResult } from "@/lib/auth/delivery";
import { formatBookingWhen } from "@/lib/appointments/time";

type NoticeKind = "consultation.preparation" | "consultation.ready" | "consultation.completed";

const copy: Record<NoticeKind, { title: string; preview: string }> = {
  "consultation.preparation": {
    title: "Prepare for your online consultation",
    preview: "Sign in and open the appointment when it is time to join. This message does not contain a meeting link.",
  },
  "consultation.ready": {
    title: "Your clinician is ready",
    preview: "Sign in and open the appointment to join the online consultation.",
  },
  "consultation.completed": {
    title: "Consultation completed",
    preview: "Sign in to view the appointment. A summary appears only after the clinician releases it.",
  },
};

export async function ensureConsultationNotice(
  db: PrismaClient,
  input: { recipientId: string; appointmentId: string; type: NoticeKind },
) {
  const existing = await db.notification.findFirst({
    where: {
      recipientId: input.recipientId,
      type: input.type,
      entityType: "Appointment",
      entityId: input.appointmentId,
      channel: "IN_APP",
    },
    select: { id: true },
  });
  if (existing) return;
  const notice = copy[input.type];
  await db.notification.create({
    data: {
      recipientId: input.recipientId,
      channel: "IN_APP",
      type: input.type,
      title: notice.title,
      preview: notice.preview,
      entityType: "Appointment",
      entityId: input.appointmentId,
      status: "SENT",
    },
  });
}

export async function notifyConsultationEvent(
  db: PrismaClient,
  input: { appointmentId: string; event: "ready" | "completed" },
  deliver: (message: { to: string; subject: string; text: string; systemName?: string }) => Promise<DeliveryResult> = sendCareCircleEmail,
) {
  const appointment = await db.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      id: true,
      startsAt: true,
      mode: true,
      patient: { select: { userId: true, user: { select: { email: true, status: true, deletedAt: true } } } },
      doctor: { select: { userId: true, user: { select: { email: true, status: true, deletedAt: true } } } },
    },
  });
  if (!appointment || appointment.mode !== "ONLINE") return;
  const type: NoticeKind = input.event === "ready" ? "consultation.ready" : "consultation.completed";
  const notice = copy[type];
  const recipients = input.event === "ready"
    ? [appointment.patient]
    : [appointment.patient, appointment.doctor];
  const systemName = await loadSystemName(db);
  const base = publicAppOrigin();
  for (const party of recipients) {
    if (!party.user || party.user.deletedAt || party.user.status === "DISABLED") continue;
    await ensureConsultationNotice(db, { recipientId: party.userId, appointmentId: appointment.id, type });
    if (!party.user.email.trim()) continue;
    const href = party.userId === appointment.patient.userId
      ? `${base}/patient/appointments/${appointment.id}`
      : `${base}/doctor/appointments/${appointment.id}`;
    const text = [notice.preview, `Time: ${formatBookingWhen(appointment.startsAt)} (Africa/Freetown).`, base ? `Open the appointment after you sign in: ${href}` : "Sign in to the portal and open the appointment."]
      .join("\n");
    let result: DeliveryResult = { delivered: false, reason: "not_configured" };
    try {
      result = await deliver({ to: party.user.email, subject: notice.title, text, systemName });
    } catch {
      result = { delivered: false, reason: "provider_failed" };
    }
    if (result.reason === "not_configured") continue;
    await db.notification.create({
      data: {
        recipientId: party.userId,
        channel: "EMAIL",
        type,
        title: notice.title,
        preview: result.delivered ? "An appointment email was sent." : "An appointment email could not be sent.",
        entityType: "Appointment",
        entityId: appointment.id,
        status: result.delivered ? "SENT" : "FAILED",
      },
    });
  }
}
