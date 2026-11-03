"use client";

import { useActionState } from "react";
import { authorizeGuardianAction, type GuardianActionState } from "./guardian-actions";

const initial: GuardianActionState = {};

export function GuardianConsentForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(authorizeGuardianAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Authorized guardian consent</h2>
      <p className="text-sm leading-6 text-brand-muted">
        Record a parent or legal guardian who already has an account. Their authorization consent lets a doctor add a clinical record for a dependent or a patient under 18.
      </p>
      <input name="patientId" type="hidden" value={patientId} />
      <label className="grid gap-1 text-sm font-medium text-brand-navy">
        Guardian email
        <input name="guardianEmail" type="email" required autoComplete="off" className="h-11 rounded-lg border border-brand-line px-3" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-brand-navy">
        Relationship
        <select name="relationshipType" defaultValue="PARENT" className="h-11 rounded-lg border border-brand-line px-3">
          <option value="PARENT">Parent</option>
          <option value="LEGAL_GUARDIAN">Legal guardian</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm text-brand-navy">
        <input className="mt-1" name="confirm" required type="checkbox" value="yes" />
        This person is authorized to consent to care for this patient.
      </label>
      <button className="h-11 w-fit rounded-lg bg-brand-teal px-4 text-sm font-semibold text-white" disabled={pending} type="submit">
        {pending ? "Saving…" : "Record guardian authorization"}
      </button>
      {state.message ? (
        <p className={state.tone === "error" ? "text-sm text-[#9f1239]" : "text-sm text-[#0F766E]"} role={state.tone === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
