"use server";

import { revalidatePath } from "next/cache";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";
import { clearOwnInAppNotifications, markOwnNotificationRead } from "@/lib/patient/portal";

export type NotificationActionState = { message?: string; tone?: "ok" | "error" };

export async function markDoctorNotificationRead(_previous: NotificationActionState, formData: FormData): Promise<NotificationActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const result = await markOwnNotificationRead(prisma, {
    userId: user.id,
    notificationId: String(formData.get("notificationId") ?? ""),
  });
  if (!result.ok) return { message: result.message, tone: "error" };
  revalidatePath("/doctor/notifications");
  revalidatePath("/doctor");
  return { message: result.message, tone: "ok" };
}

export async function clearDoctorNotificationsAction(previous: NotificationActionState, formData: FormData): Promise<NotificationActionState> {
  void previous;
  void formData;
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const result = await clearOwnInAppNotifications(prisma, user.id);
  if (!result.ok) return { message: result.message, tone: "error" };
  revalidatePath("/doctor/notifications");
  revalidatePath("/doctor", "layout");
  return { message: result.message, tone: "ok" };
}
