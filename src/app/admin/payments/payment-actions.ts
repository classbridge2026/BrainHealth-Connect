"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import type { AdminActionState } from "@/lib/admin/action-state";
import { prisma } from "@/lib/db/prisma";
import { createAdminPayment, deleteAdminPayment, updateAdminPayment } from "@/lib/payments/admin-records";

async function actor() {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  return { userId: user.id, roleCodes: user.roleCodes };
}

function finish(result: { ok: boolean; message: string }): AdminActionState {
  revalidatePath("/admin/payments");
  revalidatePath("/admin/appointments");
  revalidatePath("/patient/payments");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function createPaymentAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return finish(await createAdminPayment(prisma, await actor(), {
    appointmentId: String(formData.get("appointmentId") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    status: String(formData.get("status") ?? ""),
  }));
}

export async function updatePaymentAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return finish(await updateAdminPayment(prisma, await actor(), {
    id: String(formData.get("id") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    status: String(formData.get("status") ?? ""),
  }));
}

export async function deletePaymentAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return finish(await deleteAdminPayment(prisma, await actor(), String(formData.get("id") ?? "")));
}
