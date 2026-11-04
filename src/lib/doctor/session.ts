import { unstable_cache } from "next/cache";
import { cache } from "react";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { isRecordsOffline } from "@/lib/db/offline";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { redirectOffline } from "@/lib/db/offline-redirect";
import { loadInAppNoticeSummary } from "@/lib/notifications/delivery";
import { clinicalAccess, type ClinicalAccess } from "./present";

export const DOCTOR_PORTAL_ROLES = [DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE];

const readDoctorProfileChrome = unstable_cache(
  async (userId: string) => {
    const [account, notices] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          profileImageUpdatedAt: true,
          doctorProfile: {
            select: {
              id: true,
              displayName: true,
              verificationStatus: true,
              specialties: {
                where: { isPrimary: true },
                take: 1,
                select: { specialty: { select: { name: true } } },
              },
            },
          },
        },
      }),
      loadInAppNoticeSummary(prisma, userId, "doctor"),
    ]);
    const profile = account?.doctorProfile;
    return {
      displayName: profile?.displayName ?? null,
      specialtyName: profile?.specialties[0]?.specialty.name ?? null,
      imageVersion: account?.profileImageUpdatedAt?.toISOString() ?? null,
      unread: notices.unread,
      notices: notices.items,
      doctor: profile
        ? { id: profile.id, displayName: profile.displayName, verificationStatus: profile.verificationStatus }
        : null,
    };
  },
  ["doctor-chrome"],
  { revalidate: 30, tags: ["doctor-chrome"] },
);

const loadDoctorAccount = cache(async () => {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  let name = "Clinician";
  let specialty = "Clinician";
  let imageVersion: string | null = null;
  let unread: number | null = null;
  let notices: Awaited<ReturnType<typeof loadInAppNoticeSummary>>["items"] = [];
  let access: ClinicalAccess = "missing";
  let doctor: { id: string; displayName: string; verificationStatus: string } | null = null;
  try {
    const account = await readDoctorProfileChrome(user.id);
    name = account.displayName || name;
    specialty = account.specialtyName || specialty;
    imageVersion = account.imageVersion;
    unread = account.unread;
    notices = account.notices;
    const clinicDoctor = !account.doctor && isPortalAdministrator(user.roleCodes);
    access = clinicDoctor ? "ready" : clinicalAccess(account.doctor?.verificationStatus);
    if (clinicDoctor) {
      name = "Administrator";
      specialty = "Doctor workspace";
    }
    doctor = account.doctor;
  } catch (error) {
    if (isRecordsOffline(error)) await redirectOffline();
    if (!isSchemaMismatch(error)) throw error;
    access = "schema";
  }
  const staff = isPortalAdministrator(user.roleCodes) && !doctor;
  return { user, name, specialty, imageVersion, unread, notices, access, doctor, staff };
});

export async function loadDoctorChrome() {
  const account = await loadDoctorAccount();
  return {
    user: account.user,
    name: account.name,
    specialty: account.specialty,
    imageVersion: account.imageVersion,
    unread: account.unread,
    notices: account.notices,
    access: account.access,
    staff: account.staff,
  };
}

export async function requireClinicalPortal() {
  const account = await loadDoctorAccount();
  return { user: account.user, doctor: account.doctor, access: account.access, staff: account.staff };
}

export async function blockIfUnapproved(userId: string, roleCodes?: readonly string[]): Promise<string | null> {
  try {
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, select: { verificationStatus: true } });
    if (!doctor && roleCodes && isPortalAdministrator([...roleCodes])) return null;
    if (doctor?.verificationStatus !== "APPROVED") {
      return "Clinical actions stay unavailable until an administrator approves this account.";
    }
    return null;
  } catch {
    return "Clinical actions are unavailable right now.";
  }
}
