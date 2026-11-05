"use server";

import { revalidatePath } from "next/cache";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { saveClinicalNote } from "@/lib/clinical/records";
import { blockIfUnapproved, DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";

export type PortalNoteState = { message?: string; tone?: "ok" | "error" };

export async function savePortalNoteAction(_previous: PortalNoteState, formData: FormData): Promise<PortalNoteState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const blocked = await blockIfUnapproved(user.id, user.roleCodes);
  if (blocked) return { message: blocked, tone: "error" };
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await saveClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    kind: String(formData.get("kind") ?? ""),
    body: String(formData.get("body") ?? ""),
  });
  revalidatePath("/doctor/notes");
  revalidatePath(`/doctor/appointments/${appointmentId}/record`);
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}
