"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import type { AdminActionState } from "@/lib/admin/action-state";
import { cancelAppointmentAsAdmin } from "@/lib/admin/mutations";
import { approveBookingRequest, bookingMessage } from "@/lib/appointments/booking";
import { prisma } from "@/lib/db/prisma";

export async function cancelAppointmentAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await cancelAppointmentAsAdmin(
    { appointmentId: String(formData.get("appointmentId") ?? ""), reason: String(formData.get("reason") ?? "") },
    { db: prisma, actor: { userId: user.id, roleCodes: user.roleCodes } },
  );
  revalidatePath("/admin/appointments");
  revalidatePath("/admin");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function approveBookingAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await approveBookingRequest(
    { actorUserId: user.id, appointmentId: String(formData.get("appointmentId") ?? ""), roleCodes: user.roleCodes },
    { db: prisma },
  );
  const appointmentId = result.ok ? result.appointmentId : String(formData.get("appointmentId") ?? "");
  revalidatePath("/admin/appointments");
  revalidatePath(`/admin/appointments/${appointmentId}`);
  revalidatePath("/admin");
  revalidatePath("/doctor");
  revalidatePath("/doctor/appointments");
  revalidatePath(`/doctor/appointments/${appointmentId}`);
  revalidatePath("/patient/appointments");
  revalidatePath(`/patient/appointments/${appointmentId}`);
  if (!result.ok) {
    return {
      message: result.code === "PAST" ? "This requested time has passed. Decline the booking so the patient can choose another time." : bookingMessage(result.code),
      tone: "error",
    };
  }
  return { message: "The booking was approved. The patient can see it under Upcoming.", tone: "ok" };
}
