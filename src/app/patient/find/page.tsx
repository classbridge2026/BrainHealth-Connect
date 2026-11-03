import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { BadgeCheck, Building2, Video } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { prisma } from "@/lib/db/prisma";
import { listBookingFilters, searchVerifiedDoctors } from "@/lib/patient/portal";
import { DoctorSearch } from "./search-box";
import "./find.css";

export const metadata: Metadata = { title: "Find a doctor" };
export const dynamic = "force-dynamic";

const readOpenDirectory = unstable_cache(
  async () => {
    const [result, filters] = await Promise.all([searchVerifiedDoctors(prisma, {}), listBookingFilters(prisma)]);
    if (!result.ok) throw new Error(result.code);
    return { result, filters };
  },
  ["patient-find-open"],
  { revalidate: 60 },
);

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
  const specialty = typeof params.specialty === "string" ? params.specialty : "";
  const language = typeof params.language === "string" ? params.language : "";
  const location = typeof params.location === "string" ? params.location : "";
  const visit = typeof params.visit === "string" ? params.visit : "";
  const openSearch = !q && !specialty && !language && !location && !visit;
  const loaded = openSearch
    ? await readOpenDirectory().catch(async () => {
        const [found, choices] = await Promise.all([searchVerifiedDoctors(prisma, {}), listBookingFilters(prisma)]);
        return { result: found, filters: choices };
      })
    : await Promise.all([
        searchVerifiedDoctors(prisma, { q, specialty, language, location, visit }),
        listBookingFilters(prisma),
      ]).then(([found, choices]) => ({ result: found, filters: choices }));
  const { result, filters } = loaded;
  if (!result.ok) return <RecordsUnavailable code={result.code === "NOT_FOUND" ? "NOT_FOUND" : result.code} />;
  const options = filters.ok ? filters : { specialties: [], languages: [], districts: [] };
  const count = result.doctors.length;

  return (
    <div className="find-page">
      <header className="find-head">
        <h1>Find a Doctor</h1>
        <p>Search by concern, specialty, or doctor. Profiles show qualifications, fees, and languages. Visits are self-pay.</p>
      </header>
      <DoctorSearch initialQuery={q} />
      <form className="find-filters" action="/patient/find">
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <label>
          Specialty
          <select name="specialty" defaultValue={specialty}>
            <option value="">Any specialty</option>
            {options.specialties.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Language
          <select name="language" defaultValue={language}>
            <option value="">Any language</option>
            {options.languages.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Location
          <select name="location" defaultValue={location}>
            <option value="">Any location</option>
            {options.districts.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Visit
          <select name="visit" defaultValue={visit}>
            <option value="">Any visit</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="in-person">In person</option>
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>
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
          <h2><Link href={href}>{doctor.displayName}</Link></h2>
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
        <Link className="doc-book" href={href}>Book appointment</Link>
        <Link className="doc-profile" href={href}>View profile</Link>
      </div>
    </li>
  );
}
