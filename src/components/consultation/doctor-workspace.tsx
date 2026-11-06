"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CalendarPlus,
  ClipboardList,
  CreditCard,
  Lock,
  Stethoscope,
  UserRound,
  Video,
} from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { splitConsultationNote } from "@/lib/doctor/present";
import { doctorStatusAction, type DoctorActionState } from "@/app/doctor/(workspace)/appointments/actions";
import { scheduleFollowUpAction, type FollowUpState } from "@/app/doctor/(workspace)/follow-ups/actions";
import {
  openEncounterAction,
  releaseSummaryAction,
  saveFollowUpRecommendationAction,
  savePatientSummaryAction,
  saveStructuredNoteAction,
  uploadClinicalFileAction,
  type ClinicalActionState,
} from "@/app/doctor/(workspace)/appointments/[id]/record/actions";
import "./doctor-room.css";

const clinicalInitial: ClinicalActionState = {};
const followInitial: FollowUpState = {};
const statusInitial: DoctorActionState = {};

export type DoctorWorkspaceNote = {
  id: string;
  kind: string;
  state: string;
  revision: number;
  body: string;
  release: string;
  releasedWhen: string | null;
  archived: boolean;
  versions: Array<{ id: string; version: number; body: string; amendmentReason: string | null; when: string }>;
};

type Tab = "notes" | "follow-up" | "summary" | "files";

export type DoctorWorkspaceFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  when: string;
  patientVisible: boolean;
  removed: boolean;
};

function Feedback({ message, tone }: { message?: string; tone?: "ok" | "error" }) {
  if (!message) return null;
  return <p className={tone === "error" ? "dr-alert" : "dr-ok"} role={tone === "error" ? "alert" : "status"}>{message}</p>;
}

function useRefreshOnSave(message?: string, tone?: "ok" | "error") {
  const router = useRouter();
  useEffect(() => {
    if (tone === "ok" && message) router.refresh();
  }, [message, router, tone]);
}

export function DoctorWorkspace({
  appointmentId,
  patientName,
  patientUserId,
  patientImageVersion,
  patientLine,
  reference,
  service,
  specialty,
  when,
  until,
  modeLabel,
  statusLabel,
  paymentLabel,
  fee,
  concern = null,
  intake = null,
  encounterLabel,
  canOpen,
  writeBlocked,
  canComplete,
  privateNote,
  summaryNote,
  offerings,
  locations,
  followUps,
  files = [],
  fileNotes = [],
}: {
  appointmentId: string;
  patientName: string;
  patientUserId: string;
  patientImageVersion: string | null;
  patientLine: string;
  reference: string;
  service: string;
  specialty: string;
  when: string;
  until: string;
  modeLabel: string;
  statusLabel: string;
  paymentLabel: string;
  fee: string;
  concern?: string | null;
  intake?: string | null;
  encounterLabel: string | null;
  canOpen: boolean;
  writeBlocked: string | null;
  canComplete: boolean;
  privateNote: DoctorWorkspaceNote | null;
  summaryNote: DoctorWorkspaceNote | null;
  offerings: Array<{ id: string; label: string; mode: "ONLINE" | "IN_PERSON" }>;
  locations: Array<{ id: string; label: string }>;
  followUps: Array<{ id: string; when: string; statusLabel: string }>;
  files?: DoctorWorkspaceFile[];
  fileNotes?: Array<{ id: string; label: string }>;
}) {
  const [tab, setTab] = useState<Tab>("notes");
  return (
    <div>
      <section className="dr-card" aria-label="Patient and appointment">
        <h2>Appointment details</h2>
        <div className="dr-person">
          <ProfilePhoto userId={patientUserId} name={patientName} version={patientImageVersion} size={48} alt="" />
          <div>
            <strong>{patientName}</strong>
            <span className="dr-quiet">{patientLine}</span>
          </div>
        </div>
        <dl className="dr-facts">
          <div><Calendar aria-hidden="true" size={16} /><div><dt>When</dt><dd>{when} – {until}</dd></div></div>
          <div><Stethoscope aria-hidden="true" size={16} /><div><dt>Consultation</dt><dd>{specialty} · {service}</dd></div></div>
          <div><Video aria-hidden="true" size={16} /><div><dt>Mode</dt><dd>{modeLabel}</dd></div></div>
          <div><UserRound aria-hidden="true" size={16} /><div><dt>Status</dt><dd>{statusLabel}{encounterLabel ? ` · ${encounterLabel}` : ""}</dd></div></div>
          <div><CreditCard aria-hidden="true" size={16} /><div><dt>Payment</dt><dd>{paymentLabel} · {fee}</dd></div></div>
        </dl>
        {concern ? <p className="dr-quiet"><strong>Reason. </strong>{concern}</p> : null}
        {intake ? <p className="dr-quiet"><strong>Intake. </strong>{intake}</p> : null}
        <p className="dr-quiet">Patient reference {reference}. This record is limited to your assigned visit.</p>
      </section>
      <div className="dr-tabs" role="tablist" aria-label="Clinical workspace">
        <button type="button" role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>Notes</button>
        <button type="button" role="tab" aria-selected={tab === "follow-up"} onClick={() => setTab("follow-up")}>Follow-up</button>
        <button type="button" role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}>Summary</button>
        <button type="button" role="tab" aria-selected={tab === "files"} onClick={() => setTab("files")}>Files</button>
      </div>
      <div className="dr-card">
        {writeBlocked ? <p className="dr-alert" role="status">{writeBlocked}</p> : null}
        {canOpen ? <OpenRecord appointmentId={appointmentId} /> : null}
        {tab === "notes" ? <NotesTab appointmentId={appointmentId} note={privateNote} locked={Boolean(writeBlocked) || canOpen} /> : null}
        {tab === "follow-up" ? (
          <FollowUpTab
            appointmentId={appointmentId}
            followUps={followUps}
            locations={locations}
            locked={Boolean(writeBlocked) || canOpen}
            note={privateNote}
            offerings={offerings}
          />
        ) : null}
        {tab === "summary" ? <SummaryTab appointmentId={appointmentId} locked={Boolean(writeBlocked) || canOpen} note={summaryNote} /> : null}
        {tab === "files" ? <FilesTab appointmentId={appointmentId} files={files} locked={Boolean(writeBlocked) || canOpen} notes={fileNotes} /> : null}
        {canComplete ? <CompleteVisit appointmentId={appointmentId} /> : null}
      </div>
    </div>
  );
}

function OpenRecord({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(openEncounterAction, clinicalInitial);
  useRefreshOnSave(state.message, state.tone);
  return (
    <form action={action} className="dr-actions">
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <button className="dr-secondary" disabled={pending} type="submit">{pending ? "Opening…" : "Open clinical record"}</button>
      <Feedback message={state.message} tone={state.tone} />
    </form>
  );
}

const soapFields = [
  ["complaint", "What the patient said"],
  ["history", "History"],
  ["findings", "What was observed"],
  ["assessment", "Assessment"],
  ["plan", "Plan"],
  ["followUp", "Follow-up"],
] as const;

function NotesTab({ appointmentId, note, locked }: { appointmentId: string; note: DoctorWorkspaceNote | null; locked: boolean }) {
  const [state, action, pending] = useActionState(saveStructuredNoteAction, clinicalInitial);
  useRefreshOnSave(state.message, state.tone);
  const finalized = note?.state === "FINALIZED";
  const soap = splitConsultationNote(note?.body ?? "");
  return (
    <form action={action} key={note ? `${note.id}:${note.revision}` : "new-note"}>
      <h3><Lock aria-hidden="true" size={16} /> Clinical notes</h3>
      <p className="dr-quiet">Private to authorized clinicians. Patients cannot see this note. Save what the patient said, what you observed, the assessment, and the plan.</p>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      {note ? <input name="noteId" type="hidden" value={note.id} /> : null}
      {note ? <input name="expectedRevision" type="hidden" value={String(note.revision)} /> : null}
      {soapFields.map(([name, label]) => (
        <label className="dr-field" key={name}>
          {label}
          <textarea name={name} maxLength={2000} defaultValue={soap[name]} disabled={locked} />
        </label>
      ))}
      {finalized ? (
        <label className="dr-field">
          Reason for the amendment
          <textarea name="amendmentReason" required minLength={8} maxLength={500} disabled={locked} />
        </label>
      ) : null}
      <div className="dr-actions">
        <button className="dr-primary" disabled={pending || locked} type="submit">{pending ? "Saving…" : "Save clinical notes"}</button>
      </div>
      <Feedback message={state.message} tone={state.tone} />
      {note && note.versions.length > 0 ? (
        <details>
          <summary>Version history ({note.versions.length})</summary>
          <ol className="dr-history">
            {note.versions.map((version) => (
              <li key={version.id}>
                <strong>Version {version.version}</strong> · {version.when}
                <div>{version.body}</div>
                {version.amendmentReason ? <div>Amendment: {version.amendmentReason}</div> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </form>
  );
}

function FollowUpTab({
  appointmentId,
  note,
  locked,
  offerings,
  locations,
  followUps,
}: {
  appointmentId: string;
  note: DoctorWorkspaceNote | null;
  locked: boolean;
  offerings: Array<{ id: string; label: string; mode: "ONLINE" | "IN_PERSON" }>;
  locations: Array<{ id: string; label: string }>;
  followUps: Array<{ id: string; when: string; statusLabel: string }>;
}) {
  const [noteState, noteAction, notePending] = useActionState(saveFollowUpRecommendationAction, clinicalInitial);
  const [bookState, bookAction, bookPending] = useActionState(scheduleFollowUpAction, followInitial);
  useRefreshOnSave(noteState.message, noteState.tone);
  useRefreshOnSave(bookState.tone === "ok" ? bookState.message : undefined, bookState.tone);
  const finalized = note?.state === "FINALIZED";
  return (
    <div>
      <h3><ClipboardList aria-hidden="true" size={16} /> Follow-up recommendation</h3>
      <p className="dr-quiet">Recommendations stay on the private clinical note. Scheduling uses the existing booking rules.</p>
      <form action={noteAction}>
        <input name="appointmentId" type="hidden" value={appointmentId} />
        <input name="kind" type="hidden" value="PRIVATE_WORKING" />
        {note ? <input name="noteId" type="hidden" value={note.id} /> : null}
        {note ? <input name="expectedRevision" type="hidden" value={String(note.revision)} /> : null}
        {note ? <input name="currentBody" type="hidden" value={note.body} /> : null}
        <label className="dr-field">
          Recommendation
          <textarea name="followUpText" required maxLength={2000} disabled={locked} placeholder="What should happen next for this patient?" />
        </label>
        <label className="dr-field">
          Recommended date
          <input name="followUpDate" type="date" disabled={locked} />
        </label>
        {finalized ? (
          <label className="dr-field">
            Reason for the amendment
            <textarea name="amendmentReason" required minLength={8} maxLength={500} disabled={locked} />
          </label>
        ) : null}
        <div className="dr-actions">
          <button className="dr-secondary" disabled={notePending || locked} type="submit">{notePending ? "Saving…" : "Save recommendation"}</button>
        </div>
        <Feedback message={noteState.message} tone={noteState.tone} />
      </form>
      <form action={bookAction}>
        <h3><CalendarPlus aria-hidden="true" size={16} /> Add follow-up appointment</h3>
        <input name="sourceAppointmentId" type="hidden" value={appointmentId} />
        {offerings.length === 0 ? <p className="dr-quiet">No active consultation service is assigned, so a follow-up appointment cannot be booked.</p> : (
          <>
            <label className="dr-field">
              Service
              <select name="offeringId" required defaultValue={offerings[0]?.id}>
                {offerings.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
              </select>
            </label>
            <label className="dr-field">
              Date
              <input name="date" type="date" required />
            </label>
            <label className="dr-field">
              Start time
              <input name="time" type="time" required />
            </label>
            <label className="dr-field">
              Clinic, for an in-person service
              <select name="locationId" defaultValue="">
                <option value="">No clinic</option>
                {locations.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
              </select>
            </label>
            <div className="dr-actions">
              <button className="dr-primary" disabled={bookPending} type="submit">{bookPending ? "Saving…" : "Add follow-up"}</button>
            </div>
          </>
        )}
        <Feedback message={bookState.message} tone={bookState.tone} />
      </form>
      {followUps.length > 0 ? (
        <ul className="dr-history">
          {followUps.map((row) => <li key={row.id}>{row.when} · {row.statusLabel}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function SummaryTab({ appointmentId, note, locked }: { appointmentId: string; note: DoctorWorkspaceNote | null; locked: boolean }) {
  const [saveState, saveAction, savePending] = useActionState(savePatientSummaryAction, clinicalInitial);
  const [releaseState, releaseAction, releasePending] = useActionState(releaseSummaryAction, clinicalInitial);
  useRefreshOnSave(saveState.message, saveState.tone);
  useRefreshOnSave(releaseState.message, releaseState.tone);
  const released = note?.release === "RELEASED";
  return (
    <div>
      <h3>Patient-facing summary</h3>
      <p className="dr-quiet">This is separate from private notes. The patient sees it only after you release it.</p>
      <form action={saveAction}>
        <input name="appointmentId" type="hidden" value={appointmentId} />
        <label className="dr-field">Reason for the visit<textarea name="reason" maxLength={2000} disabled={locked} defaultValue="" /></label>
        <label className="dr-field">
          Outcome
          <select name="outcome" defaultValue="" disabled={locked}>
            <option value="">Choose an outcome</option>
            <option>Diagnosis</option>
            <option>Treatment plan</option>
            <option>Prescription</option>
            <option>Lab referral</option>
            <option>Needs an in-person visit</option>
          </select>
        </label>
        <label className="dr-field">What this means for the patient<textarea name="findings" maxLength={2000} disabled={locked} /></label>
        <label className="dr-field">Care plan<textarea name="plan" maxLength={2000} disabled={locked} /></label>
        <label className="dr-field">Prescription<textarea name="prescription" maxLength={2000} disabled={locked} placeholder="Medicine, dose, and how long to take it. Leave blank if there is none." /></label>
        <label className="dr-field">Follow-up<textarea name="followUp" maxLength={2000} disabled={locked} /></label>
        <label className="dr-field">Additional information<textarea name="additional" maxLength={2000} disabled={locked} /></label>
        <div className="dr-actions">
          <button className="dr-primary" disabled={savePending || locked} type="submit">{savePending ? "Saving…" : "Prepare patient summary"}</button>
        </div>
        <Feedback message={saveState.message} tone={saveState.tone} />
      </form>
      {note ? (
        <form action={releaseAction}>
          <p className="dr-quiet">{released ? `Released ${note.releasedWhen ?? ""}`.trim() : "Saved summary, not released."}</p>
          <pre className="dr-history">{note.body}</pre>
          {released ? null : (
            <>
              <input name="appointmentId" type="hidden" value={appointmentId} />
              <input name="noteId" type="hidden" value={note.id} />
              <label className="dr-check">
                <input name="confirm" type="checkbox" value="yes" required />
                I have reviewed this summary and want the patient to see it.
              </label>
              <div className="dr-actions">
                <button className="dr-secondary" disabled={releasePending || locked} type="submit">{releasePending ? "Releasing…" : "Release summary"}</button>
              </div>
            </>
          )}
          <Feedback message={releaseState.message} tone={releaseState.tone} />
        </form>
      ) : null}
    </div>
  );
}

function FilesTab({
  appointmentId,
  files,
  notes,
  locked,
}: {
  appointmentId: string;
  files: DoctorWorkspaceFile[];
  notes: Array<{ id: string; label: string }>;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState(uploadClinicalFileAction, clinicalInitial);
  useRefreshOnSave(state.message, state.tone);
  const visible = files.filter((file) => !file.removed);
  return (
    <div>
      <h3>Consultation files</h3>
      <p className="dr-quiet">PDF, JPEG, or PNG, up to 10 MB. Files go to the private bucket. They stay off the public web and the patient sees them only after they are attached to a released summary.</p>
      {visible.length === 0 ? <p className="dr-quiet">No document is stored for this visit yet.</p> : (
        <ul className="dr-history">
          {visible.map((file) => (
            <li key={file.id}>
              <a href={`/api/clinical-files/${file.id}`}>{file.name}</a>
              <div>{file.patientVisible ? "Visible with a released summary." : "Private to the consultation."} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {file.when}</div>
            </li>
          ))}
        </ul>
      )}
      <form action={action}>
        <input name="appointmentId" type="hidden" value={appointmentId} />
        <label className="dr-field">
          Attach to
          <select name="noteId" defaultValue="" disabled={locked}>
            <option value="">Consultation record only</option>
            {notes.map((note) => (
              <option key={note.id} value={note.id}>{note.label}</option>
            ))}
          </select>
        </label>
        <label className="dr-field">
          Document
          <input accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={locked} name="file" required type="file" />
        </label>
        <div className="dr-actions">
          <button className="dr-primary" disabled={pending || locked} type="submit">{pending ? "Storing…" : "Store in private bucket"}</button>
        </div>
        <Feedback message={state.message} tone={state.tone} />
      </form>
    </div>
  );
}

function CompleteVisit({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(doctorStatusAction, statusInitial);
  const saved = state.message === "The consultation has ended and is marked complete.";
  useRefreshOnSave(saved ? state.message : undefined, saved ? "ok" : undefined);
  return (
    <form action={action}>
      <h3>End consultation</h3>
      <p className="dr-quiet">End the consultation when the visit is finished. The system marks it complete. Ending the call alone leaves the visit open so you can call the patient again.</p>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <input name="to" type="hidden" value="COMPLETED" />
      <label className="dr-check">
        <input name="confirm" type="checkbox" value="yes" required />
        I have finished this consultation.
      </label>
      <div className="dr-actions">
        <button className="dr-leave" disabled={pending} type="submit">{pending ? "Ending…" : "End consultation"}</button>
      </div>
      <Feedback message={state.message} tone={saved ? "ok" : state.message ? "error" : undefined} />
    </form>
  );
}
