"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { sharedRateLimiter } from "@/lib/auth/rate-limit";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { advanceDoctorAppointment, approveBookingRequest, bookingMessage, cancelOwnAppointment, rescheduleAppointment } from "@/lib/appointments/booking";
import { atMinutes, parseCalendarDate, parseClock } from "@/lib/appointments/time";
import { applyConsultationSideEffects, closeOnlineRoom } from "@/lib/consultations/lifecycle";
import { syncEncounterStatus } from "@/lib/clinical/records";
import { notifyConsultationEvent } from "@/lib/consultations/notices";
import { blockIfUnapproved } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";

const transitionLimit = sharedRateLimiter("consultation-transition", { limit: 20, windowMs: 60_000 });
const portalRoles = [DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE];

async function actingClinician() {
  const user = await requireStoredRoles(portalRoles);
  const blocked = await blockIfUnapproved(user.id, user.roleCodes);
  return { user, blocked };
}

export type DoctorActionState = { message?: string };

export async function doctorStatusAction(_previous: DoctorActionState, formData: FormData): Promise<DoctorActionState> {
  const { user, blocked } = await actingClinician();
  if (blocked) return { message: blocked };
  const to = String(formData.get("to") ?? "");
  if (to !== "CHECKED_IN" && to !== "IN_PROGRESS" && to !== "COMPLETED" && to !== "NO_SHOW") {
    return { message: "That change is not allowed for this appointment." };
  }
  if (to === "COMPLETED" && String(formData.get("confirm")) !== "yes") {
    return { message: "Confirm that the clinical encounter is finished before completing the appointment." };
  }
  if (!transitionLimit.check(user.id).allowed) return { message: "Please wait a moment before trying that again." };
  const result = await advanceDoctorAppointment(
    { actorUserId: user.id, appointmentId: String(formData.get("appointmentId") ?? ""), to, roleCodes: user.roleCodes },
    { db: prisma },
  );
  if (!result.ok) return { message: bookingMessage(result.code) };
  await applyConsultationSideEffects(prisma, { actorUserId: user.id, appointmentId: result.appointmentId, to }, {
    notify: (event, appointmentId) => notifyConsultationEvent(prisma, { appointmentId, event }),
  });
  revalidatePath(`/doctor/appointments/${result.appointmentId}`);
  revalidatePath(`/doctor/appointments/${result.appointmentId}/consultation`);
  revalidatePath(`/patient/appointments/${result.appointmentId}`);
  revalidatePath(`/patient/appointments/${result.appointmentId}/consultation`);
  revalidatePath("/doctor");
  if (to === "COMPLETED") return { message: "The consultation has ended and is marked complete." };
  return { message: "The appointment status was saved." };
}

export async function doctorCancelAction(_previous: DoctorActionState, formData: FormData): Promise<DoctorActionState> {
  const { user, blocked } = await actingClinician();
  if (blocked) return { message: blocked };
  if (String(formData.get("confirm")) !== "yes") return { message: "Confirm the cancellation before it is saved." };
  const result = await cancelOwnAppointment(
    {
      actorUserId: user.id,
      actor: "doctor",
      appointmentId: String(formData.get("appointmentId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      roleCodes: user.roleCodes,
    },
    { db: prisma },
  );
  if (!result.ok) return { message: bookingMessage(result.code) };
  await closeOnlineRoom(prisma, { appointmentId: result.appointmentId, actorUserId: user.id, reason: "cancelled" });
  revalidatePath(`/doctor/appointments/${result.appointmentId}`);
  revalidatePath(`/doctor/appointments/${result.appointmentId}/consultation`);
  return { message: "The appointment was cancelled. Payment records were not changed." };
}

export async function doctorBookingDecisionAction(_previous: DoctorActionState, formData: FormData): Promise<DoctorActionState> {
  const { user, blocked } = await actingClinician();
  if (blocked) return { message: blocked };
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (decision === "decline") {
    if (String(formData.get("confirm")) !== "yes") return { message: "Confirm the decline before it is saved." };
    const result = await cancelOwnAppointment(
      { actorUserId: user.id, actor: "doctor", appointmentId, reason: String(formData.get("reason") ?? ""), roleCodes: user.roleCodes },
      { db: prisma },
    );
    if (!result.ok) return { message: bookingMessage(result.code) };
    await closeOnlineRoom(prisma, { appointmentId: result.appointmentId, actorUserId: user.id, reason: "cancelled" });
    revalidatePath(`/doctor/appointments/${result.appointmentId}`);
    revalidatePath("/patient/appointments");
    revalidatePath(`/patient/appointments/${result.appointmentId}`);
    return { message: "The booking was declined. The patient can see it under Cancelled." };
  }
  if (decision !== "approve") return { message: "That change is not allowed for this appointment." };
  const result = await approveBookingRequest({ actorUserId: user.id, appointmentId, roleCodes: user.roleCodes }, { db: prisma });
  if (!result.ok) {
    if (result.code === "PAST") return { message: "This requested time has passed. Choose another open time and give a reason to approve it." };
    return { message: bookingMessage(result.code) };
  }
  revalidatePath(`/doctor/appointments/${result.appointmentId}`);
  revalidatePath("/doctor/appointments");
  revalidatePath("/admin/appointments");
  revalidatePath(`/admin/appointments/${result.appointmentId}`);
  revalidatePath("/patient/appointments");
  revalidatePath(`/patient/appointments/${result.appointmentId}`);
  return { message: "The booking was approved. The patient can see it under Upcoming." };
}

export async function doctorRescheduleAction(_previous: DoctorActionState, formData: FormData): Promise<DoctorActionState> {
  const { user, blocked } = await actingClinician();
  if (blocked) return { message: blocked };
  if (String(formData.get("confirm")) !== "yes") return { message: "Confirm the new time before the appointment is moved." };
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const selected = new Date(String(formData.get("startsAt") ?? ""));
  const day = parseCalendarDate(String(formData.get("date") ?? ""));
  const minute = parseClock(String(formData.get("time") ?? ""));
  const startsAt = Number.isNaN(selected.getTime()) ? (day && minute !== null ? atMinutes(day, minute) : null) : selected;
  if (!startsAt) return { message: "Choose an open time." };
  const result = await rescheduleAppointment(
    {
      actorUserId: user.id,
      actor: "doctor",
      appointmentId,
      startsAt,
      reason: String(formData.get("reason") ?? ""),
      roleCodes: user.roleCodes,
    },
    { db: prisma },
  );
  if (!result.ok) return { message: bookingMessage(result.code) };
  await syncEncounterStatus(prisma, { appointmentId, status: "CANCELLED", at: new Date() });
  await closeOnlineRoom(prisma, { appointmentId, actorUserId: user.id, reason: "rescheduled" });
  revalidatePath("/doctor/appointments");
  revalidatePath(`/doctor/appointments/${appointmentId}`);
  revalidatePath(`/doctor/appointments/${result.appointmentId}`);
  revalidatePath("/patient/appointments");
  revalidatePath(`/patient/appointments/${appointmentId}`);
  revalidatePath(`/patient/appointments/${result.appointmentId}`);
  redirect(`/doctor/appointments/${result.appointmentId}`);
}
