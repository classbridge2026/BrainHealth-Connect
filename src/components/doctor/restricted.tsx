import Link from "next/link";
import type { ClinicalAccess } from "@/lib/doctor/present";

const copy: Record<Exclude<ClinicalAccess, "ready">, { title: string; body: string }> = {
  pending: {
    title: "Verification is still in review",
    body: "An administrator needs to approve your credentials before patient records, appointments, and clinical notes are available.",
  },
  rejected: {
    title: "This clinician account was not approved",
    body: "Clinical records stay hidden. You can review the requested corrections on your professional profile and submit it again.",
  },
  suspended: {
    title: "This clinician account is suspended",
    body: "Clinical records, schedules, and notes stay hidden until an administrator restores the account.",
  },
  incomplete: {
    title: "Finish your professional profile",
    body: "Submit your profile for review before the clinical workspace opens. Patients cannot be assigned until an administrator approves it.",
  },
  missing: {
    title: "No clinician profile is linked to this account",
    body: "Clinical pages stay closed until a doctor profile exists for this sign-in.",
  },
  schema: {
    title: "The clinician workspace is not ready",
    body: "The latest database migration has not been applied, so clinical records cannot be loaded.",
  },
};

export function ClinicPracticeNote() {
  return (
    <section className="mx-auto grid max-w-2xl gap-4 rounded-2xl border border-[#d7e3ee] bg-white p-6">
      <h1 className="text-2xl font-semibold text-[#0C2B45]">Clinic workspace</h1>
      <p className="text-sm leading-6 text-[#5b6b7c]">
        This account covers the clinic. Use the doctor menu for the dashboard, appointments, patients, notes, screening, follow-ups, and each clinician&apos;s hours. Sign-in for this account is on this profile.
      </p>
      <Link className="inline-flex h-11 w-fit items-center rounded-lg bg-[#0F766E] px-4 text-sm font-semibold text-white" href="/doctor/appointments">
        Open appointments
      </Link>
    </section>
  );
}

export function RestrictedPractice({ access }: { access: ClinicalAccess }) {
  const state = access === "ready" ? copy.pending : copy[access];
  return (
    <section className="mx-auto grid max-w-2xl gap-4 rounded-2xl border border-[#d7e3ee] bg-white p-6">
      <h1 className="text-2xl font-semibold text-[#0C2B45]">{state.title}</h1>
      <p className="text-sm leading-6 text-[#5b6b7c]">{state.body}</p>
      <div className="flex flex-wrap gap-3">
        <Link className="inline-flex h-11 items-center rounded-lg bg-[#0F766E] px-4 text-sm font-semibold text-white" href="/doctor/profile">View profile</Link>
        <Link className="inline-flex h-11 items-center rounded-lg border border-[#d7e3ee] px-4 text-sm font-semibold text-[#0C2B45]" href="/doctor/onboarding">Professional profile</Link>
      </div>
    </section>
  );
}
