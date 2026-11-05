import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { StatusBadge } from "@/components/status-badge";
import { appointmentStatusLabel, appointmentStatusTone } from "@/lib/admin/labels";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { loadDoctorChart } from "@/lib/doctor/workspace";
import { encounterStatusLabel } from "@/lib/clinical/rules";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Patient chart" };
export const dynamic = "force-dynamic";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "information", label: "Information" },
  { id: "appointments", label: "Appointments" },
  { id: "encounters", label: "Encounters" },
  { id: "summaries", label: "Released summaries" },
  { id: "files", label: "Files" },
  { id: "follow-ups", label: "Follow-ups" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default async function AssignedPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const { id } = await params;
  const query = await searchParams;
  const tab = tabs.some((item) => item.id === query.tab) ? (query.tab as TabId) : "overview";
  const result = await loadDoctorChart(prisma, { patientId: id, actorUserId: portal.user.id, clinicWide: portal.staff });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const patient = result.patient;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px]">
      <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <p className="text-sm text-[#5b6b7c]">Patient chart · ID {patient.reference}</p>
        <div className="mt-3 flex items-center gap-4">
          <ProfilePhoto userId={patient.userId} name={patient.fullName} version={patient.imageVersion} size={64} alt="" />
          <div>
            <h1 className="text-2xl font-semibold text-[#0C2B45]">{patient.fullName}</h1>
            <p className="text-sm text-[#5b6b7c]">{patient.line}</p>
          </div>
        </div>
        <nav className="mt-5 flex gap-2 overflow-x-auto" aria-label="Chart sections">
          {tabs.map((item) => (
            <Link key={item.id} href={`/doctor/patients/${patient.id}?tab=${item.id}`} aria-current={tab === item.id ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.id ? "bg-[#e7f4f2] text-[#0F766E]" : "text-[#5b6b7c]"}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-5">
          {tab === "overview" ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Last visit" value={patient.lastVisit ?? "None recorded"} />
              <Field label="Next visit" value={patient.nextVisit ?? "None scheduled"} />
              <Field label="Working notes" value={`${patient.privateNotes} on your consultation records`} />
              <Field label="Released summaries" value={String(patient.summaries.length)} />
            </dl>
          ) : null}
          {tab === "information" ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Gender" value={patient.gender} />
              <Field label="Date of birth" value={patient.dateOfBirth ?? "Not recorded"} />
              <Field label="Preferred language" value={patient.preferredLanguage ?? "Not recorded"} />
              <Field label="Nationality" value={patient.nationality ?? "Not recorded"} />
              <Field label="Phone" value={patient.phone ?? "Not recorded"} />
              <Field label="Email" value={patient.email} />
              <Field label="Address" value={patient.address ?? "Not recorded"} />
              <Field label="Emergency contact" value={patient.emergencyContactName ?? "Not recorded"} />
              <Field label="Account" value={patient.isDependent ? "Dependent patient" : "Patient"} />
              <Field label="Guardian authorization" value={patient.guardian} />
            </dl>
          ) : null}
          {tab === "appointments" ? <VisitList rows={patient.visits} /> : null}
          {tab === "encounters" ? (
            patient.encounters.length === 0 ? <Empty text="No consultation record is stored for your visits with this patient." /> : (
              <ul className="grid gap-3">
                {patient.encounters.map((row) => (
                  <li key={row.id} className="rounded-xl border border-[#d7e3ee] p-4 text-sm">
                    <Link className="font-semibold text-[#0F766E]" href={`/doctor/appointments/${row.appointmentId}/record`}>{row.service}</Link>
                    <p className="mt-1 text-[#5b6b7c]">{encounterStatusLabel(row.status)} · Opened {row.started} · {row.ended}</p>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {tab === "summaries" ? (
            patient.summaries.length === 0 ? <Empty text="No patient summary has been released for your visits with this patient." /> : (
              <ul className="grid gap-3">
                {patient.summaries.map((row) => (
                  <li key={row.id} className="rounded-xl border border-[#d7e3ee] p-4 text-sm">
                    <p className="font-semibold text-[#0C2B45]">Released {row.when}</p>
                    <p className="mt-2 leading-6 whitespace-pre-wrap">{row.body}</p>
                    <Link className="mt-2 inline-flex font-semibold text-[#0F766E]" href={`/doctor/appointments/${row.appointmentId}/record`}>Open consultation</Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {tab === "files" ? (
            patient.files.length === 0 ? <Empty text="No clinical document is stored for your visits with this patient." /> : (
              <ul className="grid gap-2">
                {patient.files.map((file) => (
                  <li key={file.id} className="rounded-xl border border-[#d7e3ee] p-4 text-sm">
                    {file.removed ? (
                      <p className="font-semibold text-[#0C2B45]">{file.name}</p>
                    ) : (
                      <a className="font-semibold text-[#0F766E]" href={`/api/clinical-files/${file.id}`}>{file.name}</a>
                    )}
                    <p className="mt-1 text-[#5b6b7c]">{file.removed ? "Removed from download. The file is retained." : file.mimeType} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {file.when}</p>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {tab === "follow-ups" ? (
            patient.followUps.length === 0 ? <Empty text="No follow-up visit is linked to your appointments with this patient." /> : <VisitList rows={patient.followUps.map((row) => ({ ...row, mode: "ONLINE", record: false }))} />
          ) : null}
        </div>
      </section>
      <aside className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <div className="flex items-center gap-3">
          <ProfilePhoto userId={patient.userId} name={patient.fullName} version={patient.imageVersion} size={48} alt="" />
          <div>
            <h2 className="font-semibold text-[#0C2B45]">{patient.fullName}</h2>
            <p className="text-sm text-[#5b6b7c]">{patient.line}</p>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <Field label="Phone" value={patient.phone ?? "Not recorded"} />
          <Field label="Email" value={patient.email} />
          <Field label="Last visit" value={patient.lastVisit ?? "None recorded"} />
        </dl>
        <p className="mt-4 text-xs leading-5 text-[#5b6b7c]">Allergies and medication lists are not stored as separate records, so they are not shown here.</p>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[#5b6b7c]">{label}</dt>
      <dd className="mt-1 font-medium text-[#0C2B45]">{value}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm leading-6 text-[#5b6b7c]">{text}</p>;
}

function VisitList({ rows }: { rows: Array<{ id: string; when: string; service: string; status: string; followUp?: boolean; record?: boolean }> }) {
  if (rows.length === 0) return <Empty text="No appointment is stored." />;
  return (
    <ul className="grid gap-3">
      {rows.map((visit) => (
        <li key={visit.id} className="rounded-xl border border-[#d7e3ee] p-4 text-sm">
          <Link className="font-semibold text-[#0F766E]" href={`/doctor/appointments/${visit.id}`}>{visit.when}</Link>
          <p className="mt-1 text-[#5b6b7c]">{visit.service}{visit.followUp ? " · Follow-up" : ""}</p>
          <div className="mt-2"><StatusBadge tone={appointmentStatusTone(visit.status)}>{appointmentStatusLabel(visit.status)}</StatusBadge></div>
          {visit.record ? <Link className="mt-3 inline-flex font-semibold text-[#0F766E]" href={`/doctor/appointments/${visit.id}/record`}>Consultation record</Link> : null}
        </li>
      ))}
    </ul>
  );
}
