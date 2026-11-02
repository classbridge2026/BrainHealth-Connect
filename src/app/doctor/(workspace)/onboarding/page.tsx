import type { Metadata } from "next";
import { getSystemName } from "@/lib/brand/system-name";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { ClinicPracticeNote } from "@/components/doctor/restricted";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";
import { missingUploadedCredentials, onboardingSteps, profileFieldGaps, profileIsEditable } from "@/lib/doctors/rules";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { identityDocumentRequired } from "@/lib/doctors/profile";
import { loadOwnDoctor } from "@/lib/doctors/queries";
import { STORAGE_CONFIGURATION_HINT, createPrivateStorage } from "@/lib/storage/private-storage";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Doctor onboarding" };
export const dynamic = "force-dynamic";

function dateValue(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function DoctorOnboardingPage() {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  let profile: Awaited<ReturnType<typeof loadOwnDoctor>> = null;
  try {
    profile = await loadOwnDoctor(prisma, user.id);
  } catch (error) {
    if (!isSchemaMismatch(error)) throw error;
    return <p>Doctor onboarding is not available until the doctor onboarding migration has been applied.</p>;
  }
  if (!profile) {
    if (isPortalAdministrator(user.roleCodes)) return <ClinicPracticeNote />;
    return <p>Your doctor profile is not available.</p>;
  }
  const activeSpecialties = await prisma.specialty.findMany({
    where: { OR: [{ isActive: true }, { doctors: { some: { doctorProfileId: profile.id } } }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });
  const identityRequired = await identityDocumentRequired(prisma);
  const primary = profile.specialties.find((item) => item.isPrimary);
  const fields = {
    fullName: profile.fullName,
    displayName: profile.displayName,
    phoneE164: profile.user.phoneE164,
    email: profile.user.email,
    biography: profile.biography,
    primarySpecialtyId: primary?.specialtyId ?? null,
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
  const steps = onboardingSteps({
    accountActive: profile.user.status === "ACTIVE" && Boolean(profile.user.emailVerifiedAt),
    profileComplete: profileFieldGaps(fields).length === 0,
    credentialsReady: missingUploadedCredentials(profile.credentials, identityRequired).length === 0,
    submitted: profile.verificationStatus !== "DRAFT",
  });
  const completed = steps.filter((step) => step.complete).length;
  const storageReady = createPrivateStorage().configured;
  const systemName = await getSystemName();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="text-sm font-medium tracking-[0.16em] text-brand-teal uppercase">{systemName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-navy">Complete your professional profile</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-brand-muted">
          You can save a draft and return later. Patients cannot be assigned until an administrator verifies the profile.
        </p>
      </header>
      {profile.rejectionReason ? (
        <p role="alert" className="rounded-xl border border-brand-danger/30 bg-[#fdf4f4] px-3 py-3 text-sm">
          The application was rejected: {profile.rejectionReason}. Editing it does not make the account active. Submit it again when the details are ready.
        </p>
      ) : null}
      {profile.correctionNotes ? (
        <p className="rounded-xl border border-brand-line bg-white px-3 py-3 text-sm">Corrections requested: {profile.correctionNotes}</p>
      ) : null}
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.id} className="rounded-2xl border border-brand-line bg-white px-3 py-3">
            <p className="text-xs font-semibold text-brand-teal">
              {index + 1} of {steps.length}
            </p>
            <p className="mt-1 text-sm font-medium text-brand-navy">{step.label}</p>
            <p className="mt-1 text-xs text-brand-muted">{step.complete ? "Complete" : "Still needed"}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-brand-muted">
        Onboarding progress: {completed} of {steps.length} complete.
      </p>
      {storageReady ? null : (
        <p role="alert" className="rounded-xl border border-brand-line bg-white px-3 py-3 text-sm leading-6">
          {STORAGE_CONFIGURATION_HINT}
        </p>
      )}
      <OnboardingForm
        editable={profileIsEditable(profile.verificationStatus)}
        resubmit={profile.verificationStatus === "APPROVED"}
        specialties={activeSpecialties.map((specialty) => ({ id: specialty.id, name: specialty.name, active: specialty.isActive }))}
        selectedAdditional={profile.specialties.filter((item) => !item.isPrimary).map((item) => item.specialtyId)}
        credentials={profile.credentials.map((credential) => ({
          id: credential.id,
          type: credential.type,
          status: credential.status,
          filename: credential.originalFilename ?? "Document",
          archived: Boolean(credential.archivedAt),
          reviewed: Boolean(credential.reviewedAt),
        }))}
        values={{
          fullName: profile.fullName,
          displayName: profile.displayName,
          email: profile.user.email,
          phone: profile.user.phoneE164 ?? "",
          biography: profile.biography ?? "",
          primarySpecialtyId: primary?.specialtyId ?? "",
          qualificationKind: profile.qualificationKind ?? "",
          qualificationTitle: profile.qualificationTitle ?? "",
          qualificationInstitution: profile.qualificationInstitution ?? "",
          qualificationYear: profile.qualificationYear ? String(profile.qualificationYear) : "",
          licenseNumber: profile.licenseNumberNormalized ?? "",
          licenseAuthority: profile.licenseJurisdiction ?? "",
          licenseExpiresOn: dateValue(profile.licenseExpiresOn),
          yearsExperience: profile.yearsExperience === null ? "" : String(profile.yearsExperience),
          languages: profile.languages.join(", "),
          consultationOnline: profile.consultationModes.includes("ONLINE"),
          consultationInPerson: profile.consultationModes.includes("IN_PERSON"),
        }}
      />
    </main>
  );
}
