import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Building2, Video } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RecordsOfflineError } from "@/lib/db/offline";
import { rememberFor } from "@/lib/db/remember";
import { prisma } from "@/lib/db/prisma";
import { loadPublicDoctor } from "@/lib/appointments/queries";
import { searchVerifiedDoctors } from "@/lib/patient/portal";
import { DoctorSearch } from "./search-box";
import { WarmProfiles } from "./warm-profiles";
import "./find.css";

export const metadata: Metadata = { title: "Find a doctor" };
export const dynamic = "force-dynamic";

function readOpenDirectory() {
  return rememberFor("patient-find-open", 60_000, async () => {
    const result = await searchVerifiedDoctors(prisma, {});
    if (!result.ok) throw result.code === "SCHEMA" ? new Error("SCHEMA") : new RecordsOfflineError();
    return result;
  });
}

type DoctorCard = {
  id: string;
  displayName: string;
  qualificationTitle: string | null;
  yearsExperience: number | null;
  specialties: string[];
  services: string[];
  modes: Array<"ONLINE" | "IN_PERSON">;
  languages: string[];
  fee: string | null;
  userId: string;
  imageVersion: string | null;
};

export default async function FindDoctorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const result = q
    ? await searchVerifiedDoctors(prisma, { q })
    : await readOpenDirectory().catch((error: unknown) => {
        if (error instanceof Error && error.message === "SCHEMA") return { ok: false as const, code: "SCHEMA" as const };
        return searchVerifiedDoctors(prisma, {});
      });
  if (!result.ok) return <RecordsUnavailable code={result.code === "NOT_FOUND" ? "NOT_FOUND" : result.code} />;
  const profiles = await Promise.all(result.doctors.map((doctor) => loadPublicDoctor(prisma, doctor.id)));
  const ready = profiles.flatMap((profile) => (profile.ok && profile.doctor.bookable ? [profile.doctor] : []));
  const count = result.doctors.length;

  return (
    <div className="find-page">
      <header className="find-head">
        <h1>Find a Doctor</h1>
      </header>
      <DoctorSearch initialQuery={q} />
      <WarmProfiles doctors={ready} />
      <p className="find-count">
        {count} verified doctor{count === 1 ? "" : "s"}
        {q.trim() ? ` matching “${q.trim()}”` : ""}
      </p>
      {count === 0 ? (
        <p className="find-empty">No approved doctor matches that search. Try a specialty, a concern, or another name.</p>
      ) : (
        <ul className="find-list">
          {result.doctors.map((doctor) => (
            <DoctorCard key={doctor.id} doctor={doctor} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DoctorCard({ doctor }: { doctor: DoctorCard }) {
  const href = `/patient/doctors/${doctor.id}`;
  const credentials = [
    doctor.qualificationTitle ?? "Qualification on file",
    doctor.yearsExperience !== null ? `${doctor.yearsExperience} years of experience` : null,
  ].filter(Boolean);
  const specialties = doctor.specialties.slice(0, 3);
  const extraSpecialties = doctor.specialties.length - specialties.length;
  const services = doctor.services.slice(0, 2);

  return (
    <li className="doc-card">
      <ProfilePhoto userId={doctor.userId} name={doctor.displayName} version={doctor.imageVersion} size={84} alt="" />
      <div className="doc-card-body">
        <div className="doc-name-row">
          <h2><Link href={href} prefetch={true}>{doctor.displayName}</Link></h2>
          <span className="doc-verified"><BadgeCheck size={14} aria-hidden="true" /> Verified</span>
        </div>
        <div className="doc-cred">
          <p>{credentials.join(" · ")}</p>
          {doctor.languages.length > 0 ? <p>Languages: {doctor.languages.join(", ")}</p> : null}
        </div>
        <ul className="doc-chips" aria-label="Specialties">
          {specialties.length === 0 ? <li>Specialty not published</li> : specialties.map((name) => <li key={name}>{name}</li>)}
          {extraSpecialties > 0 ? <li>+{extraSpecialties}</li> : null}
        </ul>
        <ul className="doc-modes">
          {doctor.modes.length === 0 ? <li>No consultation open</li> : doctor.modes.map((mode) => (
            <li key={mode}>
              {mode === "ONLINE" ? <Video size={14} aria-hidden="true" /> : <Building2 size={14} aria-hidden="true" />}
              {mode === "ONLINE" ? "Online" : "In person"}
            </li>
          ))}
          {services.map((service) => <li key={service}>{service}</li>)}
        </ul>
        <div className="doc-fees">
          {doctor.fee ? <p className="doc-fee"><span>Consultations from </span>{doctor.fee}</p> : null}
          <p className="doc-fee"><span>Payment </span>Self-pay</p>
        </div>
      </div>
      <div className="doc-actions">
        <Link className="doc-book" href={href} prefetch={true}>Book appointment</Link>
        <Link className="doc-profile" href={href} prefetch={true}>View profile</Link>
      </div>
    </li>
  );
}
