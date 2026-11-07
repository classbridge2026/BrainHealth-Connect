import type { PrismaClient } from "@prisma/client";
import { formatBookingWhen } from "@/lib/appointments/time";

export const VISIT_REMINDER_LEAD_MS = 5 * 60_000;

const READY_STATUSES = ["CONFIRMED", "CHECKED_IN"] as const;

export function visitReminderDue(startsAt: Date, now: Date) {
  const lead = startsAt.getTime() - VISIT_REMINDER_LEAD_MS;
  return now.getTime() >= lead && now.getTime() < startsAt.getTime();
}

export async function nextVisitReminder(db: PrismaClient, userId: string, now = new Date()) {
  const doctor = await db.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor) return null;
  const visit = await db.appointment.findFirst({
    where: {
      doctorProfileId: doctor.id,
      status: { in: [...READY_STATUSES] },
      startsAt: {
        gt: now,
        lte: new Date(now.getTime() + VISIT_REMINDER_LEAD_MS),
      },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, patient: { select: { fullName: true } } },
  });
  if (!visit) return null;
  return {
    id: visit.id,
    patientName: visit.patient.fullName,
    when: formatBookingWhen(visit.startsAt),
    href: `/doctor/appointments/${visit.id}/consultation`,
  };
}
