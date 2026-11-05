import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { loadClinicianRecord } from "@/lib/clinical/records";
import { encounterStatusLabel, noteChange, noteFinalizeDecision } from "@/lib/clinical/rules";
import { prisma } from "@/lib/db/prisma";
import { FinalizeNoteForm, NewNoteForm, NoteActionForm, OpenEncounterForm, PatientSummaryForm, RetireFileForm, ReviseNoteForm, StructuredNoteForm, UploadFileForm } from "./record-forms";

export const metadata: Metadata = { title: "Clinical record" };
export const dynamic = "force-dynamic";

function kindLabel(kind: string) {
  return kind === "PATIENT_SUMMARY" ? "Patient summary" : "Working note";
}

function noteStateLabel(state: string) {
  return state === "FINALIZED" ? "Finalized" : "Draft";
}

function releaseLabel(release: string) {
  if (release === "RELEASED") return "Released to the patient";
  if (release === "WITHDRAWN") return "Withdrawn";
  return "Not released";
}

export default async function ClinicalRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const user = portal.user;
  const { id } = await params;
  const result = await loadClinicianRecord(prisma, { appointmentId: id, actorUserId: user.id });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const record = result.view;
  const writable = record.writeBlocked === null && record.encounter && !record.encounter.archived && !record.encounter.legalHold;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8">
      <header>
        <p className="text-sm text-brand-teal">{record.specialty}</p>
        <h1 className="mt-2 text-3xl font-semibold text-brand-navy">Clinical record</h1>
        <p className="mt-2 text-sm leading-6 text-brand-muted">
          <Link className="font-semibold text-brand-teal" href={`/doctor/patients/${record.patientId}`}>{record.patientName}</Link>
          {" · "}{record.service}. Working notes stay on this record. A patient summary is visible to the patient only after you release it.
        </p>
      </header>
      <Link className="text-sm font-semibold text-brand-teal" href={`/doctor/appointments/${record.appointmentId}`}>Back to the appointment</Link>
      <Link className="text-sm font-semibold text-brand-teal" href={`/doctor/follow-ups?source=${record.appointmentId}`}>Schedule a follow-up</Link>
      {record.writeBlocked ? <p className="rounded-2xl border border-brand-line bg-white p-5 text-sm leading-6" role="status">{record.writeBlocked}</p> : null}
      {!record.encounter ? (
        record.canOpen ? <OpenEncounterForm appointmentId={record.appointmentId} /> : null
      ) : (
        <section className="grid gap-2 rounded-2xl border border-brand-line bg-white p-5 text-sm leading-6">
          <h2 className="text-lg font-semibold text-brand-navy">Consultation</h2>
          <p>{encounterStatusLabel(record.encounter.status)}</p>
          <p>Opened {record.encounter.startedWhen}</p>
          <p>{record.encounter.endedWhen ? `Ended ${record.encounter.endedWhen}` : "The consultation record is still open."}</p>
          {record.encounter.legalHold ? <p>This record is on legal hold.</p> : null}
          {record.encounter.archived ? <p>This record is archived.</p> : null}
        </section>
      )}
      {record.notes.length === 0 ? <p className="text-sm text-brand-muted">No notes are stored for this visit.</p> : null}
      <ul className="grid gap-4">
        {record.notes.map((note) => {
          const revise = noteChange({ kind: note.kind, summaryReleaseStatus: note.release, archivedAt: note.archived ? new Date() : null, legalHold: note.legalHold, action: "revise" });
          const release = noteChange({ kind: note.kind, summaryReleaseStatus: note.release, archivedAt: note.archived ? new Date() : null, legalHold: note.legalHold, action: "release" });
          const withdraw = noteChange({ kind: note.kind, summaryReleaseStatus: note.release, archivedAt: note.archived ? new Date() : null, legalHold: note.legalHold, action: "withdraw" });
          const archive = noteChange({ kind: note.kind, summaryReleaseStatus: note.release, archivedAt: note.archived ? new Date() : null, legalHold: note.legalHold, action: "archive" });
          const finalize = noteFinalizeDecision({ state: note.state, archivedAt: note.archived ? new Date() : null, legalHold: note.legalHold });
          return (
            <li key={note.id} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
              <div>
                <h2 className="font-semibold text-brand-navy">{kindLabel(note.kind)}</h2>
                <p className="text-sm text-brand-muted">{noteStateLabel(note.state)} · {releaseLabel(note.release)}{note.releasedWhen ? ` · ${note.releasedWhen}` : ""} · {note.createdWhen}</p>
              </div>
              <p className="text-sm leading-7 whitespace-pre-wrap">{note.body}</p>
              {writable ? (
                <div className="flex flex-wrap gap-3">
                  {release.ok ? <NoteActionForm appointmentId={record.appointmentId} intent="release" label="Release to patient" noteId={note.id} /> : null}
                  {withdraw.ok ? <NoteActionForm appointmentId={record.appointmentId} intent="withdraw" label="Withdraw summary" noteId={note.id} /> : null}
                  {finalize.ok ? <FinalizeNoteForm appointmentId={record.appointmentId} noteId={note.id} revision={note.revision} /> : null}
                  {archive.ok ? <NoteActionForm appointmentId={record.appointmentId} intent="archive" label="Archive note" noteId={note.id} /> : null}
                </div>
              ) : null}
              {writable && revise.ok ? (
                <ReviseNoteForm appointmentId={record.appointmentId} finalized={note.state === "FINALIZED"} noteId={note.id} revision={note.revision} />
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-brand-teal">Version history ({note.versions.length})</summary>
                <ol className="mt-3 grid gap-3">
                  {note.versions.map((version) => (
                    <li key={version.id} className="rounded-xl bg-brand-paper p-3 text-sm">
                      <p className="font-semibold text-brand-navy">Version {version.version} · {version.when}</p>
                      <p className="mt-1 leading-6 whitespace-pre-wrap">{version.body}</p>
                      {version.amendmentReason ? <p className="mt-1 text-brand-muted">Amendment: {version.amendmentReason}</p> : null}
                    </li>
                  ))}
                </ol>
              </details>
              {note.releases.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-brand-teal">Release history ({note.releases.length})</summary>
                  <ul className="mt-3 grid gap-2 text-sm">
                    {note.releases.map((release) => (
                      <li key={release.id}>{release.when} · Version {release.version} · {release.event === "RELEASED" ? "Released" : "Withdrawn"}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
      {writable ? <StructuredNoteForm appointmentId={record.appointmentId} /> : null}
      {writable ? <PatientSummaryForm appointmentId={record.appointmentId} /> : null}
      {writable ? <NewNoteForm appointmentId={record.appointmentId} /> : null}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold text-brand-navy">Documents</h2>
        {record.files.length === 0 ? <p className="text-sm text-brand-muted">No clinical document is stored for this visit.</p> : (
          <ul className="grid gap-2">
            {record.files.map((file) => (
              <li key={file.id} className="rounded-2xl border border-brand-line bg-white p-4 text-sm">
                {file.removed ? (
                  <p className="font-semibold text-brand-navy">{file.name}</p>
                ) : (
                  <a className="font-semibold text-brand-teal" href={`/api/clinical-files/${file.id}`}>{file.name}</a>
                )}
                <p className="mt-1 text-brand-muted">{file.removed ? "Removed from download. The file is retained." : file.patientVisible ? "Visible with a released summary." : "Private to the consultation."} · {file.mimeType} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {file.when}</p>
                {writable && !file.removed ? <RetireFileForm appointmentId={record.appointmentId} fileId={file.id} /> : null}
              </li>
            ))}
          </ul>
        )}
        {writable ? (
          <UploadFileForm
            appointmentId={record.appointmentId}
            notes={record.notes.filter((note) => !note.archived).map((note) => ({ id: note.id, label: `${kindLabel(note.kind)} · ${releaseLabel(note.release)}` }))}
          />
        ) : null}
      </section>
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold text-brand-navy">Access trail</h2>
        {record.access.length === 0 ? <p className="text-sm text-brand-muted">No access has been recorded for this consultation.</p> : (
          <ul className="grid gap-2 text-sm">
            {record.access.map((row) => (
              <li key={row.id} className="rounded-xl border border-brand-line bg-white px-4 py-3">{row.when} · {row.actor} · {row.action} · {row.entityType}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
