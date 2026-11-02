import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { loadPublicDoctor } from "@/lib/appointments/queries";
import { prisma } from "@/lib/db/prisma";
import "./doctor-profile.css";

export const dynamic = "force-dynamic";

const QUALIFICATION_KIND: Record<string, string> = {
  MEDICAL_DEGREE: "Medical degree",
  PROFESSIONAL_DIPLOMA: "Professional diploma",
  SPECIALIST_QUALIFICATION: "Specialist qualification",
  BOARD_CERTIFICATION: "Board certification",
  OTHER: "Qualification",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPublicDoctor(prisma, id);
  return { title: result.ok && result.doctor.bookable ? result.doctor.displayName : "Doctor" };
}

export default async function PublicDoctorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const visit = typeof query.visit === "string" ? query.visit : "";
  const result = await loadPublicDoctor(prisma, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  if (!result.doctor.bookable) notFound();
  const doctor = result.doctor;
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

  return (
    <div className="doctor-page">
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
  );
}
