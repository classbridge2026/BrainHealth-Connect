"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { updateOfferingFee } from "@/lib/catalog/offerings";
import { updateServiceFee } from "@/lib/catalog/services";
import { prisma } from "@/lib/db/prisma";

export type PricingActionState = { message?: string; tone?: "ok" | "error" };

async function actor() {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  return { userId: user.id, roleCodes: user.roleCodes };
}

function finish(result: { ok: boolean; message: string }): PricingActionState {
  revalidatePath("/admin/pricing");
  revalidatePath("/admin/services");
  revalidatePath("/admin/offerings");
  revalidatePath("/");
  revalidatePath("/patient/find");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function updateServiceFeeAction(_previous: PricingActionState, formData: FormData): Promise<PricingActionState> {
  const result = await updateServiceFee(
    {
      id: String(formData.get("id") ?? ""),
      defaultFee: String(formData.get("defaultFee") ?? ""),
      currency: String(formData.get("currency") ?? ""),
    },
    { db: prisma, actor: await actor() },
  );
  return finish(result);
}

export async function updateOfferingFeeAction(_previous: PricingActionState, formData: FormData): Promise<PricingActionState> {
  const result = await updateOfferingFee(
    {
      id: String(formData.get("id") ?? ""),
      fee: String(formData.get("fee") ?? ""),
      currency: String(formData.get("currency") ?? ""),
    },
    { db: prisma, actor: await actor() },
  );
  return finish(result);
}
