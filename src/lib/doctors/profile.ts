import type { PrismaClient } from "@prisma/client";
import { formDataToDoctorProfile, parseDoctorProfile } from "@/lib/validation/doctor";
import { IDENTITY_DOCUMENT_SETTING } from "./constants";
import { isUniqueConflict } from "./errors";
import { notifyAdministratorsOfDoctorReview } from "./review-notice";
import {
  canSubmitProfile,
  credentialLabel,
  missingUploadedCredentials,
  profileFieldGaps,
  profileIsEditable,
  type ProfileFields,
} from "./rules";

export async function identityDocumentRequired(db: PrismaClient): Promise<boolean> {
  const setting = await db.platformSetting.findUnique({ where: { key: IDENTITY_DOCUMENT_SETTING } });
  return setting?.valueJson === true;
}

function toFields(
  profile: {
    fullName: string;
    displayName: string;
    biography: string | null;
    qualificationKind: string | null;
    qualificationTitle: string | null;
    qualificationInstitution: string | null;
    qualificationYear: number | null;
    licenseNumberNormalized: string | null;
    licenseJurisdiction: string | null;
    yearsExperience: number | null;
    languages: string[];
    consultationModes: string[];
    specialties: Array<{ specialtyId: string; isPrimary: boolean }>;
    user: { email: string; phoneE164: string | null };
  },
): ProfileFields {
  return {
    fullName: profile.fullName,
    displayName: profile.displayName,
    phoneE164: profile.user.phoneE164,
    email: profile.user.email,
    biography: profile.biography,
    primarySpecialtyId: profile.specialties.find((item) => item.isPrimary)?.specialtyId ?? null,
    qualificationKind: profile.qualificationKind,
    qualificationTitle: profile.qualificationTitle,
    qualificationInstitution: profile.qualificationInstitution,
    qualificationYear: profile.qualificationYear,
    licenseNumber: profile.licenseNumberNormalized,
    licenseAuthority: profile.licenseJurisdiction,
    yearsExperience: profile.yearsExperience,
    languages: profile.languages,
    consultationModes: profile.consultationModes,
  };
}

async function loadOwnedProfile(db: PrismaClient, actorUserId: string) {
  return db.doctorProfile.findUnique({
    where: { userId: actorUserId },
    include: {
      user: { select: { id: true, email: true, phoneE164: true, status: true } },
      specialties: true,
      credentials: { select: { type: true, status: true, archivedAt: true } },
    },
  });
}

export async function saveDoctorProfile(
  actorUserId: string,
  input: unknown,
  deps: { db: PrismaClient; mode: "draft" | "submit"; now: Date; preserveApproval?: boolean; logError?: (code: string) => void },
): Promise<{ ok: true; message: string } | { ok: false; formMessage?: string; fieldErrors?: Record<string, string> }> {
  const parsed = parseDoctorProfile(input, deps.mode);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: parsed.fieldErrors, formMessage: parsed.formMessage };
  }

  const profile = await loadOwnedProfile(deps.db, actorUserId);
  if (!profile || profile.userId !== actorUserId) {
    return { ok: false, formMessage: "Your doctor profile is not available." };
  }
  if (profile.verificationStatus === "SUSPENDED") {
    return { ok: false, formMessage: "This profile cannot be edited while it is suspended." };
  }
  const verifyNow = deps.preserveApproval === true;
  if (!verifyNow && deps.mode === "draft" && !profileIsEditable(profile.verificationStatus)) {
    return { ok: false, formMessage: "This profile cannot be edited while it is under review or suspended." };
  }
  if (!verifyNow && deps.mode === "submit" && !canSubmitProfile(profile.verificationStatus)) {
    return { ok: false, formMessage: "This profile cannot be submitted in its current state." };
  }
  const wasApproved = profile.verificationStatus === "APPROVED";
  if (deps.mode === "draft" && wasApproved && !verifyNow) {
    return { ok: false, formMessage: "Approved profile changes are sent for verification. Submit the profile instead of saving a draft." };
  }

  const data = parsed.data;
  const specialtyIds = [...new Set([data.primarySpecialtyId, ...data.additionalSpecialtyIds].filter(Boolean))] as string[];
  const specialties = specialtyIds.length
    ? await deps.db.specialty.findMany({ where: { id: { in: specialtyIds } } })
    : [];
  if (specialties.length !== specialtyIds.length) {
    return { ok: false, fieldErrors: { primarySpecialtyId: "Choose a specialty from the list." } };
  }
  for (const specialty of specialties) {
    const alreadyHeld = profile.specialties.some((item) => item.specialtyId === specialty.id);
    if (!specialty.isActive && !alreadyHeld) {
      return { ok: false, fieldErrors: { primarySpecialtyId: "Choose an active specialty." } };
    }
  }

  const identityRequired = await identityDocumentRequired(deps.db);
  if (deps.mode === "submit" && !verifyNow) {
    const preview: ProfileFields = {
      fullName: data.fullName,
      displayName: data.displayName,
      phoneE164: data.phoneE164,
      email: profile.user.email,
      biography: data.biography,
      primarySpecialtyId: data.primarySpecialtyId,
      qualificationKind: data.qualificationKind,
      qualificationTitle: data.qualificationTitle,
      qualificationInstitution: data.qualificationInstitution,
      qualificationYear: data.qualificationYear,
      licenseNumber: data.licenseNumber,
      licenseAuthority: data.licenseAuthority,
      yearsExperience: data.yearsExperience,
      languages: data.languages,
      consultationModes: data.consultationModes,
    };
    const gaps = profileFieldGaps(preview);
    const missing = missingUploadedCredentials(profile.credentials, identityRequired);
    if (gaps.length || missing.length) {
      return {
        ok: false,
        formMessage: [...gaps, ...missing.map((type) => `Upload the ${credentialLabel(type).toLowerCase()}.`)].join(" "),
      };
    }
  }

  let keptSpecialtyInUse = false;
  try {
    await deps.db.$transaction(async (tx) => {
      keptSpecialtyInUse = false;
      if (data.phoneE164 && data.phoneE164 !== profile.user.phoneE164) {
        await tx.user.update({ where: { id: profile.userId }, data: { phoneE164: data.phoneE164 } });
      }
      const fullName = data.fullName || profile.fullName;
      const displayName =
        data.fullName && data.fullName !== profile.fullName && (!data.displayName || data.displayName === profile.displayName)
          ? data.fullName
          : data.displayName || fullName || profile.displayName;
      await tx.doctorProfile.update({
        where: { id: profile.id },
        data: {
          fullName,
          displayName,
          biography: data.biography,
          yearsExperience: data.yearsExperience,
          qualificationKind: data.qualificationKind,
          qualificationTitle: data.qualificationTitle,
          qualificationInstitution: data.qualificationInstitution,
          qualificationYear: data.qualificationYear,
          licenseNumberNormalized: data.licenseNumber,
          licenseJurisdiction: data.licenseAuthority,
          licenseExpiresOn: data.licenseExpiresOn,
          languages: data.languages,
          consultationModes: data.consultationModes,
          ...(verifyNow
            ? {
                verificationStatus: "APPROVED" as const,
                rejectionReason: null,
                correctionNotes: null,
                ...(wasApproved ? {} : { verifiedAt: deps.now }),
              }
            : {
                verificationStatus: profile.verificationStatus,
                ...(deps.mode === "submit"
                  ? {
                      verificationStatus: "SUBMITTED" as const,
                      submittedAt: deps.now,
                      rejectionReason: null,
                    }
                  : {}),
              }),
        },
      });

      const verified = profile.specialties.filter((item) => item.claimStatus === "VERIFIED");
      const removedVerified = verified.filter((item) => !specialtyIds.includes(item.specialtyId));
      if (!verifyNow && specialtyIds.length > 0 && removedVerified.length > 0) {
        throw new Error("VERIFIED_SPECIALTY");
      }

      if (specialtyIds.length === 0 && deps.mode === "submit") {
        throw new Error("SPECIALTY_REQUIRED");
      }

      if (specialtyIds.length > 0) {
        for (const existing of profile.specialties) {
          if (specialtyIds.includes(existing.specialtyId)) continue;
          if (!verifyNow && existing.claimStatus === "VERIFIED") continue;
          const [appointments, offerings] = await Promise.all([
            tx.appointment.count({ where: { doctorProfileId: profile.id, specialtyId: existing.specialtyId } }),
            tx.doctorOffering.count({ where: { doctorProfileId: profile.id, specialtyId: existing.specialtyId } }),
          ]);
          if (appointments + offerings > 0) {
            if (!verifyNow) throw new Error("SPECIALTY_IN_USE");
            keptSpecialtyInUse = true;
            if (existing.isPrimary && existing.specialtyId !== data.primarySpecialtyId) {
              await tx.doctorSpecialty.update({ where: { id: existing.id }, data: { isPrimary: false } });
            }
            continue;
          }
          await tx.doctorSpecialty.delete({ where: { id: existing.id } });
        }

        for (const specialtyId of specialtyIds) {
          const existing = profile.specialties.find((item) => item.specialtyId === specialtyId);
          const isPrimary = specialtyId === data.primarySpecialtyId;
          if (existing) {
            await tx.doctorSpecialty.update({
              where: { id: existing.id },
              data: verifyNow
                ? { isPrimary, claimStatus: "VERIFIED", verifiedAt: deps.now, verifiedByUserId: actorUserId }
                : { isPrimary },
            });
          } else {
            await tx.doctorSpecialty.create({
              data: {
                doctorProfileId: profile.id,
                specialtyId,
                isPrimary,
                claimStatus: verifyNow ? "VERIFIED" : "DECLARED",
                ...(verifyNow ? { verifiedAt: deps.now, verifiedByUserId: actorUserId } : {}),
              },
            });
          }
        }
      }

      if (verifyNow && !wasApproved) {
        await tx.doctorVerificationEvent.create({
          data: {
            doctorProfileId: profile.id,
            actorUserId,
            action: "profile_completed",
            fromStatus: profile.verificationStatus,
            toStatus: "APPROVED",
            reason: "Verified by the administrator on their own profile.",
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: "doctor.verification.completed",
            entityType: "DoctorProfile",
            entityId: profile.id,
          },
        });
      }

      if (deps.mode === "submit" && !verifyNow) {
        await tx.doctorVerificationEvent.create({
          data: {
            doctorProfileId: profile.id,
            actorUserId,
            action: "submitted",
            fromStatus: profile.verificationStatus,
            toStatus: "SUBMITTED",
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: "doctor.verification.submitted",
            entityType: "DoctorProfile",
            entityId: profile.id,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "VERIFIED_SPECIALTY") {
      return { ok: false, formMessage: "A verified specialty cannot be removed from this profile." };
    }
    if (error instanceof Error && error.message === "SPECIALTY_IN_USE") {
      return { ok: false, formMessage: "A specialty that already has appointments or services cannot be removed." };
    }
    if (error instanceof Error && error.message === "SPECIALTY_REQUIRED") {
      return { ok: false, fieldErrors: { primarySpecialtyId: "Choose a primary specialty." } };
    }
    if (isUniqueConflict(error)) {
      return { ok: false, formMessage: "That phone number or registration number is already in use." };
    }
    deps.logError?.("doctor_profile_save_failed");
    return { ok: false, formMessage: "The profile could not be saved. Try again." };
  }

  if (verifyNow) {
    return {
      ok: true,
      message: keptSpecialtyInUse
        ? "Profile saved and verified. A specialty that already has appointments or services was kept."
        : "Profile saved and verified.",
    };
  }
  if (deps.mode === "submit") {
    await notifyAdministratorsOfDoctorReview(deps.db, {
      doctorProfileId: profile.id,
      doctorName: data.displayName || data.fullName || profile.displayName,
      actorUserId,
    });
    return {
      ok: true,
      message: wasApproved
        ? "Your changes were sent for verification. Patients cannot book you until an administrator approves the profile again."
        : "Your profile was submitted for verification. It is not approved until an administrator reviews it.",
    };
  }
  return { ok: true, message: "Draft saved. You can return later to finish the remaining details." };
}

export function profileInputFromForm(formData: FormData) {
  return formDataToDoctorProfile(formData);
}

/** The specialty shown as primary, plus every other specialty already on the profile. */
export function specialtyFormSelection(
  specialties: Array<{ specialtyId: string; isPrimary: boolean }>,
): { primarySpecialtyId: string; additionalSpecialtyIds: string[] } {
  const primary = specialties.find((item) => item.isPrimary) ?? specialties[0];
  const primarySpecialtyId = primary?.specialtyId ?? "";
  return {
    primarySpecialtyId,
    additionalSpecialtyIds: [...new Set(specialties.map((item) => item.specialtyId).filter((id) => id && id !== primarySpecialtyId))],
  };
}

export { toFields };
