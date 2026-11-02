import type { Metadata } from "next";
import Link from "next/link";
import { ProfilePhotoEditor } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge, verificationBadge } from "@/components/status-badge";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { ClinicPracticeNote } from "@/components/doctor/restricted";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { loadOwnDoctor } from "@/lib/doctors/queries";
import { profileIsEditable } from "@/lib/doctors/rules";
import { groupAssignedOfferings } from "@/lib/doctors/consultation-preference";
import { OnboardingForm } from "../onboarding/onboarding-form";
import { OfferingPreferenceForm } from "./preference-form";

export const metadata: Metadata = { title: "Doctor profile" };
export const dynamic = "force-dynamic";

export default async function DoctorProfilePage() {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  let profile: Awaited<ReturnType<typeof loadOwnDoctor>> = null;
  try {
    profile = await loadOwnDoctor(prisma, user.id);
  } catch (error) {
    if (!isSchemaMismatch(error)) throw error;
    return <RecordsUnavailable code="SCHEMA" />;
  }
  if (!profile) return isPortalAdministrator(user.roleCodes) ? <ClinicPracticeNote /> : <RecordsUnavailable code="NOT_FOUND" />;
  const photo = await prisma.user.findUnique({ where: { id: user.id }, select: { profileImageUpdatedAt: true } });
  const offerings = await prisma.doctorOffering.findMany({
    where: { doctorProfileId: profile.id },
    select: {
      id: true,
      isActive: true,
      mode: true,
      durationMinutes: true,
      specialtyId: true,
      consultationServiceId: true,
      consultationService: { select: { name: true, mode: true } },
      specialty: { select: { name: true } },
    },
    orderBy: { consultationService: { name: "asc" } },
  });
  const offeringGroups = groupAssignedOfferings(
    offerings.map((row) => ({
      id: row.id,
      mode: row.mode,
      isActive: row.isActive,
      durationMinutes: row.durationMinutes,
      specialtyId: row.specialtyId,
      consultationServiceId: row.consultationServiceId,
      serviceName: row.consultationService.name,
      specialtyName: row.specialty.name,
      serviceMode: row.consultationService.mode,
    })),
  );
  const clinics = await prisma.doctorAvailabilityRule.findMany({
    where: { doctorProfileId: profile.id, isActive: true, locationId: { not: null } },
    select: { locationId: true, location: { select: { name: true, locality: true } } },
    distinct: ["locationId"],
  });
  const verification = verificationBadge(profile.verificationStatus);
  const editable = profileIsEditable(profile.verificationStatus);
  const primary = profile.specialties.find((item) => item.isPrimary);
  const specialties = await prisma.specialty.findMany({
    where: { OR: [{ isActive: true }, { doctors: { some: { doctorProfileId: profile.id } } }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4">
        <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
          <h1 className="text-2xl font-semibold text-[#0C2B45]">Profile</h1>
          <p className="mt-1 text-sm text-[#5b6b7c]">Update your professional details and documents here. An administrator receives a message and verifies the profile before it is approved.</p>
          <div className="mt-4">
            <ProfilePhotoEditor userId={user.id} name={profile.displayName} version={photo?.profileImageUpdatedAt?.toISOString() ?? null} />
          </div>
        </section>
        <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#0C2B45]">Professional details</h2>
          {profile.rejectionReason ? (
            <p role="alert" className="mt-3 rounded-xl border border-[#e7c1c1] bg-[#fdf4f4] px-3 py-3 text-sm">The application was rejected: {profile.rejectionReason}</p>
          ) : null}
          {profile.correctionNotes ? (
            <p className="mt-3 rounded-xl bg-[#F3F8FC] px-3 py-3 text-sm">Corrections requested: {profile.correctionNotes}</p>
          ) : null}
          <div className="mt-4">
            <OnboardingForm
              editable={editable}
              showLicenseFields={false}
              showConsultationPreferences={false}
              resubmit={profile.verificationStatus === "APPROVED"}
              specialties={specialties.map((specialty) => ({ id: specialty.id, name: specialty.name, active: specialty.isActive }))}
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
                licenseExpiresOn: profile.licenseExpiresOn ? profile.licenseExpiresOn.toISOString().slice(0, 10) : "",
                yearsExperience: profile.yearsExperience === null ? "" : String(profile.yearsExperience),
                languages: profile.languages.join(", "),
                consultationOnline: profile.consultationModes.includes("ONLINE"),
                consultationInPerson: profile.consultationModes.includes("IN_PERSON"),
              }}
            />
          </div>
        </section>
        <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#0C2B45]">Consultation services</h2>
          <p className="mt-1 text-sm text-[#5b6b7c]">For each assigned service, choose online, in person, or both. Patients book the options you leave active. Fee and duration stay as the administrator set them.</p>
          {offeringGroups.length === 0 ? <p className="mt-2 text-sm text-[#5b6b7c]">No consultation service is assigned yet.</p> : (
            <div className="mt-3 grid gap-2">
              {offeringGroups.map((group) => (
                <OfferingPreferenceForm
                  key={`${group.consultationServiceId}:${group.specialtyId}`}
                  specialtyId={group.specialtyId}
                  consultationServiceId={group.consultationServiceId}
                  serviceName={group.serviceName}
                  specialtyName={group.specialtyName}
                  serviceMode={group.serviceMode}
                  durationMinutes={group.durationMinutes}
                  preference={group.preference}
                  active={group.active}
                  editable={profile.verificationStatus === "APPROVED"}
                />
              ))}
            </div>
          )}
          <h3 className="mt-5 font-semibold text-[#0C2B45]">Clinics on your hours</h3>
          {clinics.length === 0 ? <p className="mt-2 text-sm text-[#5b6b7c]">No in-person clinic is attached to your weekly hours.</p> : (
            <ul className="mt-2 text-sm text-[#5b6b7c]">
              {clinics.map((row) => row.location ? <li key={row.locationId ?? row.location.name}>{row.location.name}, {row.location.locality}</li> : null)}
            </ul>
          )}
        </section>
      </div>
      <aside className="grid content-start gap-4">
        <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#0C2B45]">Credential status</h2>
          <div className="mt-3"><StatusBadge tone={verification.tone}>{verification.label}</StatusBadge></div>
          {profile.credentials.length === 0 ? <p className="mt-3 text-sm text-[#5b6b7c]">No credential file is stored.</p> : (
            <ul className="mt-3 grid gap-2 text-sm">
              {profile.credentials.map((item) => (
                <li key={item.id} className="rounded-xl bg-[#F3F8FC] px-3 py-2">
                  <span className="font-semibold text-[#0C2B45]">{item.type.replaceAll("_", " ")}</span>
                  <span className="text-[#5b6b7c]"> · {item.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm leading-6 text-[#5b6b7c]">
          <h2 className="text-lg font-semibold text-[#0C2B45]">Account</h2>
          <p className="mt-2">Password changes use the existing reset flow. There is no separate notification-preference record, so delivery follows the appointment notice service already configured for the platform.</p>
          <Link className="mt-3 inline-flex font-semibold text-[#0F766E]" href="/forgot-password">Reset password</Link>
        </section>
      </aside>
    </div>
  );
}

