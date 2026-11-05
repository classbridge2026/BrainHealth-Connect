"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { updateOwnSignIn } from "@/lib/auth/own-account";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";

export type OwnAccountState = { message?: string; tone?: "ok" | "error" };

export async function updateOwnSignInAction(_previous: OwnAccountState, formData: FormData): Promise<OwnAccountState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  if (!isPortalAdministrator(user.roleCodes)) {
    return { message: "Only an administrator can change this sign-in.", tone: "error" };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? "";
  const result = await updateOwnSignIn(
    prisma,
    {
      userId: user.id,
      email: String(formData.get("email") ?? ""),
      currentPassword: String(formData.get("currentPassword") ?? ""),
      nextPassword: String(formData.get("nextPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
      currentTokenHash: token ? hashSessionToken(token) : null,
    },
    { verifyPassword, hashPassword },
  );
  if (!result.ok) return { message: result.message, tone: "error" };
  revalidatePath("/doctor", "layout");
  revalidatePath("/admin", "layout");
  return { message: result.message, tone: "ok" };
}
