import Link from "next/link";
import { ArrowRight, Building2, ChevronLeft, Phone, ShieldCheck, Star, Video } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { WarmBooking } from "@/app/patient/book/warm-booking";
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
  const onlineOfferings = doctor.offerings.filter((offering) => offering.mode === "ONLINE");
  const clinicOfferings = doctor.offerings.filter((offering) => offering.mode === "IN_PERSON");
  const chosen = visit === "video" || visit === "audio" ? onlineOfferings : visit === "in-person" ? clinicOfferings : [];
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

  const modeChoices = [
    onlineOfferings.length > 0 ? { id: "video" as const, label: "Video Call", icon: Video } : null,
    clinicOfferings.length > 0 ? { id: "in-person" as const, label: "In-Person", icon: Building2 } : null,
    onlineOfferings.length > 0 ? { id: "audio" as const, label: "Audio", icon: Phone } : null,
  ].filter((mode): mode is { id: "video" | "audio" | "in-person"; label: string; icon: typeof Video } => mode !== null);
  const selectedMode = modeChoices.some((mode) => mode.id === visit) ? (visit as "video" | "audio" | "in-person") : modeChoices[0]?.id;
  const modeOfferings = selectedMode === "in-person" ? clinicOfferings : selectedMode ? onlineOfferings : [];
  const selectedOffering = modeOfferings.find((offering) => offering.id === offer) ?? modeOfferings[0] ?? null;
  const bookOffering = onlineOfferings[0] ?? clinicOfferings[0] ?? null;
  const bookChannel = onlineOfferings.length > 0 ? "video" : "in-person";
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
            <h2>Visit type</h2>
            <p>Choose video, audio, or in person before the times appear. Payment is self-pay.</p>
            <div className="doctor-visits">
              {onlineOfferings.length > 0 ? <Link className={visit === "video" ? "is-on" : ""} href={`/patient/doctors/${doctor.id}?visit=video`}>Video</Link> : null}
              {onlineOfferings.length > 0 ? <Link className={visit === "audio" ? "is-on" : ""} href={`/patient/doctors/${doctor.id}?visit=audio`}>Audio</Link> : null}
              {clinicOfferings.length > 0 ? <Link className={visit === "in-person" ? "is-on" : ""} href={`/patient/doctors/${doctor.id}?visit=in-person`}>In person</Link> : null}
            </div>
          </section>
        )}
        {chosen.length > 0 ? (
          <ul className="doctor-offers">
            {chosen.map((offering) => (
              <li key={offering.id} className="doctor-offer">
                <h2>{offering.service}</h2>
                <p className="doctor-offer-meta">
                  {offering.specialty} · {visit === "audio" ? "Audio" : visit === "video" ? "Video" : "In person"} · {offering.durationMinutes} minutes · {offering.fee}
                </p>
                {offering.description ? <p className="doctor-offer-note">{offering.description}</p> : null}
                <Link href={`/patient/book/${offering.id}?channel=${visit}`}>View available times</Link>
              </li>
            ))}
          </ul>
        ) : doctor.offerings.length > 0 ? (
          <p className="doctor-about">Choose a visit type to see the consultations and open times.</p>
        ) : null}
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
          {modeChoices.length > 0 ? (
            <div className="dm-modes">
              {modeChoices.map((mode) => {
                const Icon = mode.icon;
                return (
                  <span key={mode.id} className={mode.id === bookChannel ? "dm-mode is-on" : "dm-mode"}>
                    <i><Icon size={22} aria-hidden="true" /></i>
                    {mode.label}
                  </span>
                );
              })}
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
          {selectedOffering && selectedMode ? (
            <>
              {modeOfferings.length > 1 ? (
                <div className="dm-services" aria-label="Consultation">
                  {modeOfferings.map((offering) => (
                    <Link key={offering.id} className={offering.id === selectedOffering.id ? "is-on" : ""} href={mobileHref(doctor.id, selectedMode, offering.id)} aria-current={offering.id === selectedOffering.id ? "true" : undefined}>
                      {offering.service}
                    </Link>
                  ))}
                </div>
              ) : null}
              {bookOffering ? (
                <WarmBooking
                  offeringId={bookOffering.id}
                  doctorId={doctor.id}
                  doctorUserId={doctor.userId}
                  doctorImageVersion={doctor.imageVersion}
                  doctorName={doctor.displayName}
                  specialty={bookOffering.specialty}
                  service={bookOffering.service}
                  mode={bookOffering.mode}
                  durationMinutes={bookOffering.durationMinutes}
                  fee={bookOffering.fee}
                  channel={bookChannel}
                />
              ) : null}
              <p className="dm-pay">{selectedOffering.service} · {selectedOffering.fee}</p>
              <Link className="dm-book" href={`/patient/book/${bookOffering?.id ?? selectedOffering.id}?channel=${bookChannel}`} prefetch={true}>
                Book Appointment <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <p className="dm-empty">This doctor has no bookable consultation at the moment.</p>
          )}
        </div>
      </article>
    </div>
  );
}

function mobileHref(doctorId: string, visit: string, offer: string) {
  const params = new URLSearchParams();
  if (visit) params.set("visit", visit);
  if (offer) params.set("offer", offer);
  const query = params.toString();
  return query ? `/patient/doctors/${doctorId}?${query}` : `/patient/doctors/${doctorId}`;
}
