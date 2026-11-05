"use server";

import { revalidatePath } from "next/cache";
import { verificationBadge } from "@/components/status-badge";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import type { AdminActionState } from "@/lib/admin/action-state";
import { loadUserDetail } from "@/lib/admin/directories";
import { accessLabel, formatPlatformWhen, userStatusLabel, userStatusTone, type BadgeTone } from "@/lib/admin/labels";
import { closeUserAccount, createUserAccount, updateUserAccount } from "@/lib/admin/user-accounts";
import { prisma } from "@/lib/db/prisma";

export type UserAccountView = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  timezone: string;
  status: string;
  statusLabel: string;
  statusTone: BadgeTone;
  roleLabel: string;
  createdLabel: string;
  lastLoginLabel: string;
  emailVerifiedLabel: string;
  openSessions: number;
  roles: { code: string; name: string; grantedLabel: string }[];
  patient: { id: string; fullName: string } | null;
  doctor: { id: string; fullName: string; verificationLabel: string; verificationTone: BadgeTone } | null;
  notices: string[];
  canManage: boolean;
  canEdit: boolean;
  imageVersion: string | null;
  forms: {
    canSuspend: boolean;
    canReactivate: boolean;
    canManagePrivileges: boolean;
    grantCodes: string[];
    revokeCodes: string[];
  };
};

function state(result: { ok: boolean; message: string }): AdminActionState {
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

function refresh() {
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/patients");
  revalidatePath("/admin/roles");
}

export async function readUserAccount(userId: string): Promise<{ ok: true; user: UserAccountView } | { ok: false; message: string }> {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await loadUserDetail(prisma, userId);
  if (!result.ok) {
    return {
      ok: false,
      message: result.code === "NOT_FOUND" ? "This account is no longer available." : "Account details are unavailable right now.",
    };
  }
  const user = result.user;
  const codes = user.roles.map((role) => role.code);
  const elevated = codes.includes(ADMIN_ROLE_CODE) || codes.includes(SUPER_ADMIN_ROLE_CODE);
  const isSelf = actor.id === user.id;
  const superAdmin = actor.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
  const canManagePrivileges = superAdmin && !isSelf;
  const doctorBadge = user.doctor ? verificationBadge(user.doctor.verificationStatus) : null;
  const notices = [
    user.status === "PENDING_VERIFICATION" ? "This account becomes active when the holder verifies their contact details." : null,
    user.status === "DISABLED" ? "Disabled accounts are retained. This view does not reactivate them." : null,
    isSelf ? "You cannot change your own status or roles." : null,
    !isSelf && elevated && !canManagePrivileges ? "Only a super administrator can suspend an administrator or change administrator roles." : null,
  ].filter((notice): notice is string => Boolean(notice));
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.patient?.fullName ?? user.doctor?.fullName ?? null,
      phone: user.phone,
      timezone: user.timezone,
      status: user.status,
      statusLabel: userStatusLabel(user.status),
      statusTone: userStatusTone(user.status),
      roleLabel: accessLabel(codes),
      createdLabel: formatPlatformWhen(new Date(user.createdAt)),
      lastLoginLabel: user.lastLoginAt ? formatPlatformWhen(new Date(user.lastLoginAt)) : "None recorded",
      emailVerifiedLabel: user.emailVerifiedAt ? formatPlatformWhen(new Date(user.emailVerifiedAt)) : "Not verified",
      openSessions: user.openSessions.length,
      roles: user.roles.map((role) => ({
        code: role.code,
        name: role.name,
        grantedLabel: formatPlatformWhen(new Date(role.grantedAt)),
      })),
      patient: user.patient,
      doctor: user.doctor && doctorBadge
        ? { id: user.doctor.id, fullName: user.doctor.fullName, verificationLabel: doctorBadge.label, verificationTone: doctorBadge.tone }
        : null,
      notices,
      canManage: !isSelf && (!elevated || superAdmin),
      canEdit: isSelf || (!isSelf && (!elevated || superAdmin)),
      imageVersion: user.imageVersion,
      forms: {
        canSuspend: !isSelf && user.status === "ACTIVE" && (!elevated || canManagePrivileges),
        canReactivate: !isSelf && user.status === "SUSPENDED" && (!elevated || canManagePrivileges),
        canManagePrivileges,
        grantCodes: ["ADMIN", "SUPER_ADMIN"].filter((code) => !codes.includes(code)),
        revokeCodes: ["ADMIN", "SUPER_ADMIN"].filter((code) => codes.includes(code)),
      },
    },
  };
}

export async function createUserAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const result = await createUserAccount(
    {
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      password: String(formData.get("password") ?? ""),
      roleCode: String(formData.get("roleCode") ?? ""),
      gender: String(formData.get("gender") ?? ""),
      dateOfBirth: String(formData.get("dateOfBirth") ?? ""),
    },
    { db: prisma, actor: { userId: actor.id, roleCodes: actor.roleCodes } },
  );
  if (result.ok) refresh();
  return state(result);
}

export async function updateUserAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const userId = String(formData.get("userId") ?? "");
  const result = await updateUserAccount(
    {
      userId,
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
      status: String(formData.get("status") ?? ""),
      password: String(formData.get("password") ?? ""),
    },
    { db: prisma, actor: { userId: actor.id, roleCodes: actor.roleCodes } },
  );
  if (result.ok) {
    refresh();
    revalidatePath(`/admin/users/${userId}`);
  }
  return state(result);
}

export async function deleteUserAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const userId = String(formData.get("userId") ?? "");
  const result = await closeUserAccount(
    { userId },
    { db: prisma, actor: { userId: actor.id, roleCodes: actor.roleCodes } },
  );
  if (result.ok) {
    refresh();
    revalidatePath(`/admin/users/${userId}`);
  }
  return state(result);
}
