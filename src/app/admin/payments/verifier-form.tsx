"use client";

import { useActionState } from "react";
import { primaryButtonClass } from "@/components/form-classes";
import type { AdminActionState } from "@/lib/admin/action-state";
import { savePaymentVerifiersAction } from "./verifier-actions";

const initial: AdminActionState = {};

export function PaymentVerifierForm({
  choices,
}: {
  choices: Array<{ id: string; name: string; email: string; selected: boolean }>;
}) {
  const [state, action, pending] = useActionState(savePaymentVerifiersAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Who can verify payments</h2>
      <p className="text-sm leading-6 text-brand-muted">
        A super administrator can always verify a payment. Choose the administrators who can also verify. Doctors are not listed and cannot verify.
      </p>
      {choices.length === 0 ? (
        <p className="text-sm text-brand-muted">No other active administrators are available. Only a super administrator can verify until you add one.</p>
      ) : (
        <ul className="grid gap-2">
          {choices.map((choice) => (
            <li key={choice.id}>
              <label className="flex items-start gap-3 text-sm text-brand-navy">
                <input className="mt-1" type="checkbox" name="verifierId" value={choice.id} defaultChecked={choice.selected} />
                <span>
                  <span className="block font-semibold">{choice.name}</span>
                  <span className="block text-brand-muted">{choice.email}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button className={primaryButtonClass} disabled={pending} type="submit">
          {pending ? "Saving…" : "Save verifiers"}
        </button>
      </div>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
