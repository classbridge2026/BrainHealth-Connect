"use client";

import { useActionState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/form-classes";
import type { AdminActionState } from "@/lib/admin/action-state";
import { restorePaidVisitAction } from "./review-actions";

const initial: AdminActionState = {};

export function RestoreVisitForm({
  paymentId,
  when,
  choice,
  slots,
  canReject,
}: {
  paymentId: string;
  when: string;
  choice: "restore" | "move";
  slots: Array<{ startsAt: string; label: string }>;
  canReject: boolean;
}) {
  const [state, action, pending] = useActionState(restorePaidVisitAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">The patient already paid</h2>
      <p className="text-sm leading-6 text-brand-muted">
        {choice === "restore"
          ? `${when} is still free. Give that time back so the consultation can go ahead. The patient does not pay again.`
          : `${when} is no longer available. Choose another time so the consultation can go ahead. The patient does not pay again.`}
      </p>
      <input type="hidden" name="paymentId" value={paymentId} />
      {choice === "move" ? (
        <label className="text-sm font-medium text-brand-navy">
          Another time
          <select name="startsAt" required defaultValue="" className="mt-1 w-full rounded-lg border border-brand-line bg-white px-3 py-2">
            <option value="" disabled>
              {slots.length === 0 ? "No open time in the next week" : "Choose a time"}
            </option>
            {slots.map((slot) => (
              <option key={slot.startsAt} value={slot.startsAt}>
                {slot.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {choice === "restore" ? (
          <button className={primaryButtonClass} disabled={pending} name="decision" value="restore" type="submit">
            {pending ? "Saving…" : "Give this time back"}
          </button>
        ) : (
          <button className={primaryButtonClass} disabled={pending || slots.length === 0} name="decision" value="move" type="submit">
            {pending ? "Saving…" : "Give this time"}
          </button>
        )}
        {canReject ? (
          <button className={secondaryButtonClass} disabled={pending} name="decision" value="reject" type="submit">
            We did not receive this
          </button>
        ) : null}
      </div>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
