"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { authorizeGuardianConsent } from "@/lib/clinical/guardian-consent";
import { prisma } from "@/lib/db/prisma";

export type GuardianActionState = { message?: string; tone?: "ok" | "error" };

export async function authorizeGuardianAction(_previous: GuardianActionState, formData: FormData): Promise<GuardianActionState> {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const patientId = String(formData.get("patientId") ?? "");
  const result = await authorizeGuardianConsent(
    {
      patientId,
      guardianEmail: String(formData.get("guardianEmail") ?? ""),
      relationshipType: String(formData.get("relationshipType") ?? ""),
      confirmed: formData.get("confirm") === "yes",
    },
    { db: prisma, actor },
  );
  revalidatePath(`/admin/patients/${patientId}`);
  revalidatePath("/admin/settings");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}
