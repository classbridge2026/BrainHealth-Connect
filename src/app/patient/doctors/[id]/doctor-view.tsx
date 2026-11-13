import Link from "next/link";
import { ChevronLeft, ShieldCheck, Star } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { ServiceMenu } from "./service-menu";
import "./doctor-profile.css";

const QUALIFICATION_KIND: Record<string, string> = {
  MEDICAL_DEGREE: "Medical degree",
  PROFESSIONAL_DIPLOMA: "Professional diploma",
  SPECIALIST_QUALIFICATION: "Specialist qualification",
  BOARD_CERTIFICATION: "Board certification",
  OTHER: "Qualification",
};

export type DoctorProfileData = {
  id: string;
  displayName: string;
  userId: string;
  imageVersion: string | null;
  biography: string | null;
  yearsExperience: number | null;
  qualificationKind: string | null;
  qualificationTitle: string | null;
  qualificationInstitution: string | null;
  qualificationYear: number | null;
  languages: string[];
  specialties: string[];
  offerings: Array<{
    id: string;
    specialty: string;
    service: string;
    description: string | null;
    mode: string;
    durationMinutes: number;
    fee: string;
  }>;
};

export function DoctorProfileView({ doctor, visit, offer }: { doctor: DoctorProfileData; visit: string; offer: string }) {
  const kind = doctor.qualificationKind ? QUALIFICATION_KIND[doctor.qualificationKind] : null;
  const qualification = [kind, doctor.qualificationTitle].filter(Boolean).join(" · ");
  const awarded = [doctor.qualificationInstitution, doctor.qualificationYear].filter(Boolean).join(", ");
  const facts = [
    qualification ? { label: "Qualification", value: qualification } : null,
    awarded ? { label: "Awarded", value: awarded } : null,
    doctor.yearsExperience !== null ? { label: "Experience", value: `${doctor.yearsExperience} years in practice` } : null,
    doctor.specialties.length > 0 ? { label: "Verified specialty", value: doctor.specialties.join(", ") } : null,
    doctor.languages.length > 0 ? { label: "Languages", value: doctor.languages.join(", ") } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  const mobileStats = [
    doctor.languages.length > 0
      ? { value: doctor.languages.join(", "), label: doctor.languages.length === 1 ? "Language" : "Languages" }
      : null,
    doctor.yearsExperience !== null ? { value: `${doctor.yearsExperience}+`, label: "Years Experience" } : null,
  ].filter((stat): stat is { value: string; label: string } => stat !== null);

  return (
    <div className="doctor-page">
      <div className="doctor-desk">
        <article className="doctor-id">
          <div className="doctor-id-band" aria-hidden="true" />
          <ProfilePhoto userId={doctor.userId} name={doctor.displayName} version={doctor.imageVersion} size={96} alt={`${doctor.displayName} profile photo`} />
          <div>
            <p className="doctor-id-kicker">Verified clinician</p>
            <h1>{doctor.displayName}</h1>
            {doctor.specialties[0] ? <p className="doctor-id-role">{doctor.specialties[0]}</p> : null}
            {facts.length > 0 ? (
              <ul className="doctor-id-facts">
                {facts.map((fact) => (
                  <li key={fact.label}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>
        <section className="doctor-about">
          <p>{doctor.biography ?? "No biography has been published."}</p>
        </section>
        {doctor.offerings.length === 0 ? (
          <p className="doctor-about">This doctor has no bookable consultation at the moment.</p>
        ) : (
          <section className="doctor-about">
            <h2>Services</h2>
            <ServiceMenu
              doctorId={doctor.id}
              doctorUserId={doctor.userId}
              doctorImageVersion={doctor.imageVersion}
              doctorName={doctor.displayName}
              visit={visit}
              offer={offer}
              offerings={doctor.offerings}
              layout="desk"
            />
          </section>
        )}
      </div>
      <article className="doctor-mobile">
        <div className="dm-card">
          <header className="dm-hero">
            <Link className="dm-back" href="/patient/find" aria-label="Back">
              <ChevronLeft size={22} aria-hidden="true" />
            </Link>
            <ProfilePhoto userId={doctor.userId} name={doctor.displayName} version={doctor.imageVersion} size={136} alt="" />
          </header>
          <p className="dm-badge"><Star size={14} aria-hidden="true" /> Verified</p>
          <h1 className="dm-name">{doctor.displayName}</h1>
          {doctor.specialties[0] ? (
            <p className="dm-role"><ShieldCheck size={16} aria-hidden="true" /> {doctor.specialties[0]}</p>
          ) : null}
          {mobileStats.length > 0 ? (
            <div className="dm-stats">
              {mobileStats.map((stat) => (
                <p key={stat.label} className="dm-stat">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </p>
              ))}
            </div>
          ) : null}
          <section className="dm-section">
            <h2>About Doctor</h2>
            <p>{doctor.biography ?? "No biography has been published."}</p>
          </section>
          {doctor.specialties.length > 0 ? (
            <section className="dm-section">
              <h2>Specializations</h2>
              <ul className="dm-chips">
                {doctor.specialties.map((name) => <li key={name}>{name}</li>)}
              </ul>
            </section>
          ) : null}
          {doctor.offerings.length > 0 ? (
            <>
              <section className="dm-section">
                <h2>Services</h2>
              </section>
              <ServiceMenu
                doctorId={doctor.id}
                doctorUserId={doctor.userId}
                doctorImageVersion={doctor.imageVersion}
                doctorName={doctor.displayName}
                visit={visit}
                offer={offer}
                offerings={doctor.offerings}
                layout="mobile"
              />
            </>
          ) : (
            <p className="dm-empty">This doctor has no bookable consultation at the moment.</p>
          )}
        </div>
      </article>
    </div>
  );
}

