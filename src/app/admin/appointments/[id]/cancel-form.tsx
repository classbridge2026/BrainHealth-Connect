"use client";

import { useActionState } from "react";
import { primaryButtonClass, textAreaClass } from "@/components/form-classes";
import type { AdminActionState } from "@/lib/admin/action-state";
import { approveBookingAction, cancelAppointmentAction } from "../actions";

const initial: AdminActionState = {};

export function ApproveBookingForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(approveBookingAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Approve booking</h2>
      <p className="text-sm leading-6 text-brand-muted">Approving confirms the visit. The patient can see it under Upcoming.</p>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <button className={primaryButtonClass} disabled={pending} type="submit">
        {pending ? "Approving…" : "Approve booking"}
      </button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export function CancelAppointmentForm({ appointmentId, decline = false }: { appointmentId: string; decline?: boolean }) {
  const [state, action, pending] = useActionState(cancelAppointmentAction, initial);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">{decline ? "Decline booking" : "Cancel appointment"}</h2>
      <p className="text-sm leading-6 text-brand-muted">
        {decline
          ? "Declining cancels this request. The patient can see it under Cancelled. Payment records stay unchanged."
          : "This records you as the actor and leaves payment status unchanged. Reassignment is not available."}
      </p>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <label className="text-sm font-medium">
        Operational reason
        <textarea name="reason" required minLength={10} maxLength={500} className={`${textAreaClass} mt-1`} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input name="confirm" type="checkbox" required className="mt-1" />
        I understand this cancellation is recorded and the original fee stays on the appointment.
      </label>
      <button className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-danger px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">
        {pending ? (decline ? "Declining…" : "Cancelling…") : decline ? "Decline booking" : "Cancel appointment"}
      </button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
