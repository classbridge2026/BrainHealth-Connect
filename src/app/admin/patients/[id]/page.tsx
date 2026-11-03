import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/catalog-ui";
import { Notice } from "@/components/admin/portal-ui";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge } from "@/components/status-badge";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadPatientDetail } from "@/lib/admin/directories";
import { formatPlatformDay, formatPlatformWhen, userStatusLabel, userStatusTone } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { GuardianConsentForm } from "./guardian-form";

export const metadata: Metadata = { title: "Patient" };
export const dynamic = "force-dynamic";

function genderLabel(value: string) {
  switch (value) {
    case "FEMALE":
      return "Female";
    case "MALE":
      return "Male";
    case "NON_BINARY":
      return "Non-binary";
    case "PREFER_NOT_TO_SAY":
      return "Prefer not to say";
    default:
      return value;
  }
}

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const { id } = await params;
  const result = await loadPatientDetail(prisma, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const patient = result.patient;
  return (
    <main className="grid gap-6">
      <div className="flex items-center gap-4">
        <ProfilePhoto
          userId={patient.user.id}
          name={patient.fullName}
          version={patient.user.profileImageUpdatedAt ? new Date(patient.user.profileImageUpdatedAt).toISOString() : null}
          size={72}
          alt={`${patient.fullName} profile photo`}
        />
        <PageHeader eyebrow="People and access" title={patient.fullName} description="Registration details. Clinical notes and files are not shown here." />
      </div>
      {patient.archivedAt ? <Notice>This profile is archived. Historical appointments remain available from the appointment directory.</Notice> : null}
      <section className="grid gap-4 rounded-2xl border border-brand-line bg-white p-5 sm:grid-cols-2">
        <p>
          <span className="block text-sm text-brand-muted">Account</span>
          <Link className="font-semibold text-brand-teal" href={`/admin/users/${patient.user.id}`}>
            {patient.user.email}
          </Link>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Status</span>
          <StatusBadge tone={userStatusTone(patient.user.status)}>{userStatusLabel(patient.user.status)}</StatusBadge>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Phone</span>
          <span className="font-semibold text-brand-navy">{patient.user.phoneE164 ?? "Not recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Gender</span>
          <span className="font-semibold text-brand-navy">{genderLabel(patient.gender)}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Date of birth</span>
          <span className="font-semibold text-brand-navy">{patient.dateOfBirth ? formatPlatformDay(patient.dateOfBirth) : "Not recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Nationality</span>
          <span className="font-semibold text-brand-navy">{patient.nationality ?? "Not recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Preferred language</span>
          <span className="font-semibold text-brand-navy">{patient.preferredLanguage ?? "Not recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Address</span>
          <span className="font-semibold text-brand-navy">{patient.residentialAddress ?? "Not recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Emergency contact name</span>
          <span className="font-semibold text-brand-navy">{patient.emergencyContactName ?? "Not recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Appointments</span>
          <Link className="font-semibold text-brand-teal" href={`/admin/appointments?patient=${patient.id}`}>
            {patient._count.appointments}
          </Link>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Registered</span>
          <span className="font-semibold text-brand-navy">{formatPlatformWhen(patient.createdAt)}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Dependent profile</span>
          <span className="font-semibold text-brand-navy">{patient.isDependent ? "Yes" : "No"}</span>
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold text-brand-navy">Guardian relationships</h2>
        {patient.guardianRelationships.length === 0 ? (
          <p className="text-sm text-brand-muted">No guardian relationships are recorded.</p>
        ) : (
          <ul className="grid gap-2">
            {patient.guardianRelationships.map((row) => (
              <li key={row.id} className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm">
                <span className="font-semibold text-brand-navy">{row.guardian.patientProfile?.fullName ?? row.guardian.email}</span>
                <span className="text-brand-muted"> · {row.relationshipType.replaceAll("_", " ").toLowerCase()} · {row.status}</span>
              </li>
            ))}
          </ul>
        )}
        {patient.archivedAt ? null : <GuardianConsentForm patientId={patient.id} />}
      </section>
    </main>
  );
}
