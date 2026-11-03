"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import type { AdminActionState } from "@/lib/admin/action-state";
import { prisma } from "@/lib/db/prisma";
import { reviewOrangeTransfer } from "@/lib/payments/orange-transfer";
import { giveAnotherTime, giveOriginalSlot } from "@/lib/payments/restore-visit";

export async function reviewOrangeTransferAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const decision = formData.get("decision") === "reject" ? "reject" : "confirm";
  const paymentId = String(formData.get("paymentId") ?? "");
  const result = await reviewOrangeTransfer({ actorUserId: user.id, paymentId, decision }, prisma);
  revalidatePath(`/admin/payments/${paymentId}`);
  revalidatePath("/admin/payments");
  revalidatePath("/patient/payments");
  return { message: result.message, tone: result.tone === "ok" ? "ok" : "error" };
}

export async function restorePaidVisitAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const paymentId = String(formData.get("paymentId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const actor = { userId: user.id, roleCodes: user.roleCodes };
  const result = decision === "reject"
    ? await reviewOrangeTransfer({ actorUserId: user.id, paymentId, decision: "reject" }, prisma)
    : decision === "move"
      ? await giveAnotherTime(prisma, actor, paymentId, String(formData.get("startsAt") ?? ""))
      : await giveOriginalSlot(prisma, actor, paymentId);
  revalidatePath(`/admin/payments/${paymentId}`);
  revalidatePath("/admin/payments");
  revalidatePath("/admin/appointments");
  revalidatePath("/patient/appointments");
  revalidatePath("/patient/payments");
  const tone = "tone" in result ? result.tone : result.ok ? "ok" : "error";
  return { message: result.message, tone: tone === "ok" ? "ok" : "error" };
}
