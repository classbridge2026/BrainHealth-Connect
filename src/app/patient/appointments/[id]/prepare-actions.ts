"use server";

import { revalidatePath } from "next/cache";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { checkInPatientVisit, savePatientIntake } from "@/lib/appointments/preparation";
import { prisma } from "@/lib/db/prisma";

export type PrepareState = { message?: string; tone?: "ok" | "error" };

export async function saveIntakeAction(_previous: PrepareState, formData: FormData): Promise<PrepareState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await savePatientIntake(
    {
      actorUserId: user.id,
      appointmentId,
      history: String(formData.get("history") ?? ""),
      consent: formData.get("consent") === "on",
    },
    prisma,
  );
  if (!result.ok) return { message: result.message, tone: "error" };
  revalidatePath(`/patient/appointments/${appointmentId}`);
  return { message: "Your history and consent were saved.", tone: "ok" };
}

export async function checkInAction(_previous: PrepareState, formData: FormData): Promise<PrepareState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await checkInPatientVisit({ actorUserId: user.id, appointmentId }, prisma);
  if (!result.ok) return { message: result.message, tone: "error" };
  revalidatePath(`/patient/appointments/${appointmentId}`);
  revalidatePath(`/doctor/appointments/${appointmentId}`);
  return { message: "You are checked in.", tone: "ok" };
}
