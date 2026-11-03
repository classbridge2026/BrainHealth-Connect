"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { updateDefaultCurrency } from "@/lib/catalog/configuration";
import type { AdminActionState } from "@/lib/admin/action-state";
import { updatePaymentHoldMinutes, updateSystemName } from "@/lib/admin/mutations";
import { saveAfrimoneyReceiveNumber } from "@/lib/payments/afrimoney-transfer";
import { saveOrangeReceiveNumber } from "@/lib/payments/orange-transfer";
import { savePublicContact } from "@/lib/public/landing";
import { prisma } from "@/lib/db/prisma";

export async function updateCurrencySettingAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await updateDefaultCurrency(String(formData.get("currency") ?? ""), {
    db: prisma,
    actor: { userId: user.id, roleCodes: user.roleCodes },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/configuration");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function updateSystemNameAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await updateSystemName(String(formData.get("systemName") ?? ""), {
    db: prisma,
    actor: { userId: user.id, roleCodes: user.roleCodes },
  });
  updateTag("system-name");
  revalidatePath("/", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/patient", "layout");
  revalidatePath("/doctor", "layout");
  revalidatePath("/login", "layout");
  revalidatePath("/register", "layout");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function updateOrangeNumberAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  try {
    const result = await saveOrangeReceiveNumber(String(formData.get("orangeNumber") ?? ""), prisma, user.id);
    revalidatePath("/admin/settings");
    revalidatePath("/patient/appointments", "layout");
    return { message: result.message, tone: result.ok ? "ok" : "error" };
  } catch {
    return { message: "The Orange Money number could not be saved.", tone: "error" };
  }
}

export async function updateAfrimoneyNumberAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  try {
    const result = await saveAfrimoneyReceiveNumber(String(formData.get("afrimoneyNumber") ?? ""), prisma, user.id);
    revalidatePath("/admin/settings");
    revalidatePath("/patient/appointments", "layout");
    return { message: result.message, tone: result.ok ? "ok" : "error" };
  } catch {
    return { message: "The Afrimoney number could not be saved.", tone: "error" };
  }
}

export async function updatePublicContactAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  try {
    const result = await savePublicContact(
      {
        email: String(formData.get("publicEmail") ?? ""),
        phone: String(formData.get("publicPhone") ?? ""),
        address: String(formData.get("publicAddress") ?? ""),
      },
      prisma,
      user.id,
    );
    revalidatePath("/admin/settings");
    revalidatePath("/");
    return { message: result.message, tone: result.ok ? "ok" : "error" };
  } catch {
    return { message: "The public contact details could not be saved.", tone: "error" };
  }
}

export async function updateHoldSettingAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await updatePaymentHoldMinutes(String(formData.get("minutes") ?? ""), {
    db: prisma,
    actor: { userId: user.id, roleCodes: user.roleCodes },
  });
  revalidatePath("/admin/settings");
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}
