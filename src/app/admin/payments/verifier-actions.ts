"use server";

import { revalidatePath } from "next/cache";
import { SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import type { AdminActionState } from "@/lib/admin/action-state";
import { prisma } from "@/lib/db/prisma";
import { savePaymentVerifiers } from "@/lib/payments/verifiers";

export async function savePaymentVerifiersAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([SUPER_ADMIN_ROLE_CODE]);
  const result = await savePaymentVerifiers(prisma, { userId: user.id, roleCodes: user.roleCodes }, formData.getAll("verifierId").map(String));
  revalidatePath("/admin/payments");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}
