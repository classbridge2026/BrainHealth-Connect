"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { assignDoctorOfferings, deleteDoctorOffering, updateDoctorOffering } from "@/lib/catalog/offerings";
import { prepareSelfDoctor } from "@/lib/catalog/self-doctor";
import { prisma } from "@/lib/db/prisma";

export type OfferingActionState = { message?: string; tone?: "ok" | "error" };

async function actor() {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  return { userId: user.id, roleCodes: user.roleCodes };
}

function finish(result: { ok: boolean; message: string }): OfferingActionState {
  revalidatePath("/admin/offerings");
  revalidatePath("/admin/pricing");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/patient/find");
  revalidatePath("/doctor");
  revalidatePath("/doctor/profile");
  revalidatePath("/doctor/availability");
  revalidatePath("/doctor/notifications");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function createOfferingAction(_previous: OfferingActionState, formData: FormData): Promise<OfferingActionState> {
  const current = await actor();
  const selfAssign = formData.get("selfAssign") === "on";
  let doctorProfileId = String(formData.get("doctorProfileId") ?? "");
  if (selfAssign) {
    const prepared = await prepareSelfDoctor(
      {
        fullName: String(formData.get("fullName") ?? ""),
        specialtyId: String(formData.get("specialtyId") ?? ""),
        mode: String(formData.get("mode") ?? ""),
      },
      { db: prisma, actor: current, now: new Date() },
    );
    if (!prepared.ok) return finish(prepared);
    doctorProfileId = prepared.doctorProfileId;
    updateTag("doctor-chrome");
  }
  const result = await assignDoctorOfferings(
    {
      doctorProfileId,
      specialtyId: String(formData.get("specialtyId") ?? ""),
      consultationServiceIds: formData.getAll("consultationServiceId").map((value) => String(value)),
      mode: String(formData.get("mode") ?? ""),
      durationMinutes: String(formData.get("durationMinutes") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      isActive: formData.get("isActive") === "on",
    },
    { db: prisma, actor: current },
  );
  if (result.ok && selfAssign) {
    return finish({
      ok: true,
      message: `${result.message} Publish weekly hours on Availability so patients can choose a time.`,
    });
  }
  return finish(result);
}

export async function updateOfferingAction(_previous: OfferingActionState, formData: FormData): Promise<OfferingActionState> {
  const result = await updateDoctorOffering(
    {
      id: String(formData.get("id") ?? ""),
      mode: String(formData.get("mode") ?? ""),
      durationMinutes: String(formData.get("durationMinutes") ?? ""),
      fee: String(formData.get("fee") ?? ""),
      currency: String(formData.get("currency") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      isActive: formData.get("isActive") === "on",
    },
    { db: prisma, actor: await actor() },
  );
  return finish(result);
}

export async function deleteOfferingAction(_previous: OfferingActionState, formData: FormData): Promise<OfferingActionState> {
  const result = await deleteDoctorOffering(String(formData.get("id") ?? ""), { db: prisma, actor: await actor() });
  return finish(result);
}
