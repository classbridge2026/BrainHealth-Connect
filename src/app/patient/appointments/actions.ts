"use server";

import { redirect } from "next/navigation";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { bookingMessage, cancelOwnAppointment, rescheduleAppointment } from "@/lib/appointments/booking";
import { closeOnlineRoom } from "@/lib/consultations/lifecycle";
import { prisma } from "@/lib/db/prisma";

export type AppointmentActionState = { message?: string };

export async function cancelPatientAppointmentAction(_previous: AppointmentActionState, formData: FormData): Promise<AppointmentActionState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const result = await cancelOwnAppointment(
    {
      actorUserId: user.id,
      actor: "patient",
      appointmentId: String(formData.get("appointmentId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    },
    { db: prisma },
  );
  if (!result.ok) return { message: bookingMessage(result.code) };
  await closeOnlineRoom(prisma, { appointmentId: result.appointmentId, actorUserId: user.id, reason: "cancelled" });
  redirect(bookingPaymentReturn(formData.get("returnTo"), result.appointmentId) ?? `/patient/appointments/${result.appointmentId}`);
}

function bookingPaymentReturn(value: FormDataEntryValue | null, appointmentId: string) {
  const path = String(value ?? "");
  if (!path.startsWith("/patient/book/") || path.includes("://") || path.includes("\\") || path.includes("//")) return null;
  const query = path.split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  if (params.get("step") !== "payment" || params.get("appointment") !== appointmentId) return null;
  return path;
}

export async function reschedulePatientAppointmentAction(_previous: AppointmentActionState, formData: FormData): Promise<AppointmentActionState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const result = await rescheduleAppointment(
    {
      actorUserId: user.id,
      actor: "patient",
      appointmentId: String(formData.get("appointmentId") ?? ""),
      startsAt: new Date(String(formData.get("startsAt") ?? "")),
      reason: String(formData.get("reason") ?? ""),
    },
    { db: prisma },
  );
  if (!result.ok) return { message: bookingMessage(result.code) };
  redirect(`/patient/appointments/${result.appointmentId}`);
}
