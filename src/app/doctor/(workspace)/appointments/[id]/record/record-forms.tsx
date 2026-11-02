"use client";

import { useActionState } from "react";
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass, textAreaClass } from "@/components/form-classes";
import {
  archiveNoteAction,
  finalizeNoteAction,
  openEncounterAction,
  releaseSummaryAction,
  retireFileAction,
  saveNoteAction,
  savePatientSummaryAction,
  saveStructuredNoteAction,
  uploadClinicalFileAction,
  withdrawSummaryAction,
  type ClinicalActionState,
} from "./actions";

const initial: ClinicalActionState = {};

export function OpenEncounterForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(openEncounterAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Opening…" : "Open consultation record"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function NewNoteForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(saveNoteAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Add a note</h2>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <label className="text-sm font-medium text-brand-navy">
        Kind
        <select className="mt-1 h-12 w-full rounded-xl border border-brand-line bg-white px-3" name="kind" defaultValue="PRIVATE_WORKING">
          <option value="PRIVATE_WORKING">Working note, visible only on this clinician record</option>
          <option value="PATIENT_SUMMARY">Patient summary, hidden until you release it</option>
        </select>
      </label>
      <label className="text-sm font-medium text-brand-navy">
        Text
        <textarea className={`${textAreaClass} mt-1`} maxLength={8000} name="body" required />
      </label>
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : "Save note"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function ReviseNoteForm({
  appointmentId,
  noteId,
  revision,
  finalized,
}: {
  appointmentId: string;
  noteId: string;
  revision: number;
  finalized: boolean;
}) {
  const [state, action, pending] = useActionState(saveNoteAction, initial);
  return (
    <form action={action} className="grid gap-3">
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <input name="noteId" type="hidden" value={noteId} />
      <input name="expectedRevision" type="hidden" value={String(revision)} />
      <label className="text-sm font-medium text-brand-navy">
        {finalized ? "Amended text" : "Revised text"}
        <textarea className={`${textAreaClass} mt-1`} maxLength={8000} name="body" required />
      </label>
      {finalized ? (
        <label className="text-sm font-medium text-brand-navy">
          Reason for the amendment
          <textarea className={`${textAreaClass} mt-1`} maxLength={500} minLength={8} name="amendmentReason" required />
        </label>
      ) : null}
      <button className={secondaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : finalized ? "Save amendment" : "Save revision"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function FinalizeNoteForm({ appointmentId, noteId, revision }: { appointmentId: string; noteId: string; revision: number }) {
  const [state, action, pending] = useActionState(finalizeNoteAction, initial);
  return (
    <form action={action}>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <input name="noteId" type="hidden" value={noteId} />
      <input name="expectedRevision" type="hidden" value={String(revision)} />
      <button className={secondaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : "Finalize note"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function NoteActionForm({
  appointmentId,
  noteId,
  intent,
  label,
}: {
  appointmentId: string;
  noteId: string;
  intent: "release" | "withdraw" | "archive";
  label: string;
}) {
  const handler = intent === "release" ? releaseSummaryAction : intent === "withdraw" ? withdrawSummaryAction : archiveNoteAction;
  const [state, action, pending] = useActionState(handler, initial);
  return (
    <form action={action}>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <input name="noteId" type="hidden" value={noteId} />
      {intent === "release" ? (
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input className="mt-1" name="confirm" required type="checkbox" value="yes" />
          I have previewed this summary and want the patient to see it.
        </label>
      ) : null}
      <button className={intent === "archive" ? dangerButtonClass : intent === "release" ? primaryButtonClass : secondaryButtonClass} disabled={pending} type="submit">
        {pending ? "Saving…" : label}
      </button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function StructuredNoteForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(saveStructuredNoteAction, initial);
  const fields = [
    ["complaint", "Presenting complaint"],
    ["history", "History"],
    ["findings", "Observations and findings"],
    ["assessment", "Assessment"],
    ["plan", "Care plan"],
    ["followUp", "Follow-up instructions"],
  ] as const;
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Consultation details</h2>
      <p className="text-sm leading-6 text-brand-muted">These sections are saved as one working note. They are not sent to the patient.</p>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      {fields.map(([name, label]) => (
        <label key={name} className="text-sm font-medium text-brand-navy">
          {label}
          <textarea className={`${textAreaClass} mt-1`} maxLength={2000} name={name} />
        </label>
      ))}
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : "Save working note"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function PatientSummaryForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(savePatientSummaryAction, initial);
  const fields = [
    ["reason", "Reason for the visit"],
    ["findings", "What this means for the patient"],
    ["plan", "Care plan"],
    ["prescription", "Prescription"],
    ["followUp", "Follow-up"],
    ["additional", "Additional information for the patient"],
  ] as const;
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Patient summary</h2>
      <p className="text-sm leading-6 text-brand-muted">Write this for the patient. It does not copy the working note. Tick the box below if they should be able to read it now.</p>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <label className="text-sm font-medium text-brand-navy">
        Outcome
        <select className={`${textAreaClass} mt-1`} name="outcome" defaultValue="">
          <option value="">Choose an outcome</option>
          <option>Diagnosis</option>
          <option>Treatment plan</option>
          <option>Prescription</option>
          <option>Lab referral</option>
          <option>Needs an in-person visit</option>
        </select>
      </label>
      {fields.map(([name, label]) => (
        <label key={name} className="text-sm font-medium text-brand-navy">
          {label}
          <textarea className={`${textAreaClass} mt-1`} maxLength={2000} name={name} />
        </label>
      ))}
      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" name="release" type="checkbox" value="yes" />
        Release to the patient now so they can read it on Clinical Summaries and this appointment.
      </label>
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : "Save summary"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function RetireFileForm({ appointmentId, fileId }: { appointmentId: string; fileId: string }) {
  const [state, action, pending] = useActionState(retireFileAction, initial);
  return (
    <form action={action} className="mt-2">
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <input name="fileId" type="hidden" value={fileId} />
      <button className={dangerButtonClass} disabled={pending} type="submit">{pending ? "Removing…" : "Remove from record"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
export function UploadFileForm({
  appointmentId,
  notes,
}: {
  appointmentId: string;
  notes: Array<{ id: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(uploadClinicalFileAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Store a document</h2>
      <p className="text-sm leading-6 text-brand-muted">PDF, JPEG, or PNG, up to 10 MB. A document stays private unless it is attached to a summary you release.</p>
      <input name="appointmentId" type="hidden" value={appointmentId} />
      <label className="text-sm font-medium text-brand-navy">
        Attach to
        <select className="mt-1 h-12 w-full rounded-xl border border-brand-line bg-white px-3" name="noteId" defaultValue="">
          <option value="">Consultation record only</option>
          {notes.map((note) => (
            <option key={note.id} value={note.id}>{note.label}</option>
          ))}
        </select>
      </label>
      <input accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="text-sm" name="file" required type="file" />
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Storing…" : "Store document"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
