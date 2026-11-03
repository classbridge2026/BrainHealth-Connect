import type { Metadata } from "next";
import Link from "next/link";
import { ProfilePhotoEditor } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { loadPatientAccount } from "@/lib/patient/portal";
import { loadReminderPreference } from "@/lib/notifications/delivery";
import { consentLabel, listOwnConsents, MANAGED_CONSENT_TYPES } from "@/lib/clinical/consent";
import { formatPlatformWhen } from "@/lib/admin/labels";
import { ReminderPreferenceForm } from "./preference-form";
import { ConsentActions } from "./consent-form";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const tabs = [
  { id: "personal", label: "Personal information" },
  { id: "medical", label: "Medical information" },
  { id: "account", label: "Account settings" },
] as const;

export default async function PatientProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const query = await searchParams;
  const tab = tabs.some((item) => item.id === query.tab) ? query.tab : "personal";
  const account = await loadPatientAccount(prisma, user.id);
  if (!account.ok) return <RecordsUnavailable code={account.code} />;
  const profile = account.profile;
  const photo = await prisma.user.findUnique({ where: { id: user.id }, select: { profileImageUpdatedAt: true } });
  const reminders = tab === "account" ? await loadReminderPreference(prisma, user.id) : null;
  const consents = tab === "account" ? await listOwnConsents(prisma, user.id) : null;

  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-2xl font-semibold text-[#0C2B45]">My Profile</h1>
        <p className="mt-1 text-sm text-[#5b6b7c]">Your account details. Clinical notes and released summaries cannot be edited here.</p>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Profile sections">
        {tabs.map((item) => (
          <Link key={item.id} href={item.id === "personal" ? "/patient/profile" : `/patient/profile?tab=${item.id}`} aria-current={tab === item.id ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.id ? "bg-[#e7f4f2] text-[#0F766E]" : "text-[#5b6b7c]"}`}>
            {item.label}
          </Link>
        ))}
      </nav>
      {!profile ? (
        <p className="rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm text-[#5b6b7c]">No patient profile is stored for this account.</p>
      ) : tab === "personal" ? (
        <section className="grid gap-5 rounded-2xl border border-[#d7e3ee] bg-white p-5">
          <ProfilePhotoEditor userId={user.id} name={profile.fullName} version={photo?.profileImageUpdatedAt?.toISOString() ?? null} />
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={profile.fullName} />
            <Field label="Email" value={profile.email} note={profile.emailVerified ? "Verified" : "Not verified"} />
            <Field label="Phone" value={profile.phone ?? "Not recorded"} note={profile.phone ? (profile.phoneVerified ? "Verified" : "Not verified") : undefined} />
            <Field label="Date of birth" value={profile.dateOfBirth ?? "Not recorded"} />
            <Field label="Gender" value={profile.gender} />
            <Field label="Address" value={profile.residentialAddress ?? "Not recorded"} />
          </dl>
          <p className="text-sm leading-6 text-[#5b6b7c]">Name, email, phone, and date of birth are fixed after registration. Contact support if a correction is required. Your photo can be updated above.</p>
        </section>
      ) : tab === "medical" ? (
        <section className="grid gap-4 rounded-2xl border border-[#d7e3ee] bg-white p-5 sm:grid-cols-2">
          <Field label="Preferred language" value={profile.preferredLanguage ?? "Not recorded"} />
          <Field label="Nationality" value={profile.nationality ?? "Not recorded"} />
          <Field label="Emergency contact" value={profile.emergencyContactName ?? "Not recorded"} />
          <Field label="Account type" value={profile.isDependent ? "Dependent patient" : "Patient"} />
          <p className="text-sm leading-6 text-[#5b6b7c] sm:col-span-2">Allergies, medications, and clinician notes are not edited by patients. Released summaries are on the Clinical Summaries page. A dependent or a patient under 18 needs an authorized guardian before a doctor can add a clinical record. An administrator records that consent on the patient page.</p>
        </section>
      ) : (
        <section className="grid gap-3 rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm leading-6">
          <h2 className="text-lg font-semibold text-[#0C2B45]">Account settings</h2>
          <p>Password changes use the existing reset flow.</p>
          <Link className="font-semibold text-[#0F766E]" href="/forgot-password">Reset password</Link>
          <p>Email verification is {profile.emailVerified ? "complete" : "not complete"} for {profile.email}.</p>
          {reminders ? <ReminderPreferenceForm emailReminders={reminders.emailReminders} available={reminders.available} /> : null}
          <h2 className="text-lg font-semibold text-[#0C2B45]">Consent</h2>
          <p>These choices apply only to your account. Withdrawing privacy or data-processing consent blocks new clinical records that require it. It does not delete records already stored. Terms of use are not changed here.</p>
          {!consents || !consents.ok ? (
            <p>Consent records could not be loaded.</p>
          ) : (
            <ul className="grid gap-3">
              {MANAGED_CONSENT_TYPES.map((type) => {
                const current = consents.consents.find((row) => row.type === type && row.version === row.currentVersion) ?? consents.consents.find((row) => row.type === type);
                return (
                  <li key={type} className="rounded-xl border border-[#d7e3ee] p-3">
                    <p className="font-semibold text-[#0C2B45]">{consentLabel(type)}</p>
                    <p className="text-[#5b6b7c]">
                      {current
                        ? `${current.active ? "Current" : "Not current"} · version ${current.version}${current.expiresAt ? ` · expires ${formatPlatformWhen(current.expiresAt)}` : ""}`
                        : "Not recorded"}
                    </p>
                    <ConsentActions active={Boolean(current?.active)} consentType={type} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Field({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-sm text-[#5b6b7c]">{label}</dt>
      <dd className="mt-1 font-semibold text-[#0C2B45]">{value}</dd>
      {note ? <dd className="text-xs text-[#5b6b7c]">{note}</dd> : null}
    </div>
  );
}
