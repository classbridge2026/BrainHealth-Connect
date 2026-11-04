"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, PATIENT_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { forgetCachedProfileImage } from "@/lib/profile/image-cache";
import { removeProfileImage, saveProfileImage } from "@/lib/profile/image";

export type ProfileImageState = { message?: string; tone?: "ok" | "error" };

const roles = [PATIENT_ROLE_CODE, DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE];

function refresh() {
  revalidatePath("/", "layout");
  revalidatePath("/patient", "layout");
  revalidatePath("/doctor", "layout");
  revalidatePath("/admin", "layout");
}

export async function saveProfileImageAction(_previous: ProfileImageState, formData: FormData): Promise<ProfileImageState> {
  const user = await requireStoredRoles(roles);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "Choose a photo to upload.", tone: "error" };
  }
  const result = await saveProfileImage(
    {
      actorUserId: user.id,
      filename: file.name,
      declaredMime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
    { db: prisma, now: new Date() },
  );
  if (!result.ok) return { message: result.message, tone: "error" };
  await forgetCachedProfileImage(user.id);
  refresh();
  return { message: result.message, tone: "ok" };
}

export async function removeProfileImageAction(_previous: ProfileImageState): Promise<ProfileImageState> {
  const user = await requireStoredRoles(roles);
  const result = await removeProfileImage(user.id, { db: prisma });
  if (!result.ok) return { message: result.message, tone: "error" };
  await forgetCachedProfileImage(user.id);
  refresh();
  return { message: result.message, tone: "ok" };
}
