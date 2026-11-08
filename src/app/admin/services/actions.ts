"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { createConsultationService, deleteConsultationService, updateConsultationService } from "@/lib/catalog/services";
import { prisma } from "@/lib/db/prisma";

export type ServiceActionState = { message?: string; tone?: "ok" | "error" };

async function actor() {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  return { userId: user.id, roleCodes: user.roleCodes };
}

function finish(result: { ok: boolean; message: string }): ServiceActionState {
  revalidatePath("/admin/services");
  revalidatePath("/admin/pricing");
  revalidatePath("/admin/offerings");
  revalidatePath("/admin");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function createServiceAction(_previous: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const result = await createConsultationService(
    {
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      description: String(formData.get("description") ?? ""),
      mode: String(formData.get("mode") ?? ""),
      durationMinutes: String(formData.get("durationMinutes") ?? ""),
      defaultFee: String(formData.get("defaultFee") ?? ""),
      currency: String(formData.get("currency") ?? ""),
      preparationInstructions: String(formData.get("preparationInstructions") ?? ""),
    },
    { db: prisma, actor: await actor() },
  );
  return finish(result);
}

export async function updateServiceAction(_previous: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const result = await updateConsultationService(
    {
      id: String(formData.get("id") ?? ""),
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      mode: String(formData.get("mode") ?? ""),
      durationMinutes: String(formData.get("durationMinutes") ?? ""),
      preparationInstructions: String(formData.get("preparationInstructions") ?? ""),
      isActive: formData.get("isActive") === "on",
    },
    { db: prisma, actor: await actor() },
  );
  return finish(result);
}

export async function deleteServiceAction(_previous: ServiceActionState, formData: FormData): Promise<ServiceActionState> {
  const result = await deleteConsultationService(String(formData.get("id") ?? ""), { db: prisma, actor: await actor() });
  return finish(result);
}
