"use client";

import { useActionState } from "react";
import { dangerButtonClass, textAreaClass } from "@/components/form-classes";
import { useConfirmedSubmit, useOutcomeAlert } from "@/lib/ui/sweet-alert";
import { cancelPatientAppointmentAction, type AppointmentActionState } from "../actions";

const initial: AppointmentActionState = {};

export function CancelAppointmentForm({ appointmentId, returnTo }: { appointmentId: string; returnTo?: string }) {
  const [state, action, pending] = useActionState(cancelPatientAppointmentAction, initial);
  const booking = Boolean(returnTo);
  const onSubmit = useConfirmedSubmit({
    title: "Cancel this appointment?",
    text: "The visit will be cancelled. You can book another time afterward.",
    confirmText: "Cancel appointment",
    danger: true,
  });
  useOutcomeAlert(state.message, pending, "error");
  return (
    <form action={action} className={booking ? "mbk-cancel" : "grid gap-3 rounded-2xl border border-brand-line bg-white p-5"} onSubmit={onSubmit}>
      <h2 className={booking ? undefined : "text-lg font-semibold text-brand-navy"}>Cancel appointment</h2>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <label className={booking ? undefined : "text-sm font-medium"}>
        Reason
        <textarea name="reason" required minLength={10} maxLength={500} className={booking ? undefined : `${textAreaClass} mt-1`} placeholder={booking ? "Tell us why you are cancelling." : undefined} />
      </label>
      <button className={booking ? "mbk-cancel-btn" : dangerButtonClass} disabled={pending} type="submit">
        {pending ? "Cancelling…" : "Cancel this appointment"}
      </button>
      {state.message ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
