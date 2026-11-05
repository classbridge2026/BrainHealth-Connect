"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";
import { amendAssessment, reviewAssessment } from "@/lib/screening/service";

export async function reviewScreeningAction(formData: FormData) {
  const portal = await requireClinicalPortal();
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return;
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const result = await reviewAssessment(prisma, {
    actorUserId: portal.user.id,
    doctorProfileId: portal.doctor?.id ?? null,
    assessmentId,
    interpretation: String(formData.get("interpretation") ?? ""),
    followUpNote: String(formData.get("followUp") ?? ""),
    clinicWide: portal.staff,
  });
  revalidatePath(`/doctor/screening/${assessmentId}`);
  if (!result.ok) redirect(`/doctor/screening/${assessmentId}?notice=${result.code}`);
}

export async function amendScreeningAction(formData: FormData) {
  const portal = await requireClinicalPortal();
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return;
  const assessmentId = String(formData.get("assessmentId") ?? "");
  await amendAssessment(prisma, {
    actorUserId: portal.user.id,
    doctorProfileId: portal.doctor?.id ?? null,
    assessmentId,
    reason: String(formData.get("reason") ?? ""),
    clinicWide: portal.staff,
  });
  revalidatePath(`/doctor/screening/${assessmentId}`);
}
