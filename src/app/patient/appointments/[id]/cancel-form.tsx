"use client";

import { useActionState } from "react";
import { dangerButtonClass, textAreaClass } from "@/components/form-classes";
import { useConfirmedSubmit, useOutcomeAlert } from "@/lib/ui/sweet-alert";
import { cancelPatientAppointmentAction, type AppointmentActionState } from "../actions";

const initial: AppointmentActionState = {};

export function CancelAppointmentForm({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(cancelPatientAppointmentAction, initial);
  const onSubmit = useConfirmedSubmit({
    title: "Cancel this appointment?",
    text: "The visit will be cancelled. You can book another time afterward.",
    confirmText: "Cancel appointment",
    danger: true,
  });
  useOutcomeAlert(state.message, pending, "error");
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5" onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold text-brand-navy">Cancel appointment</h2>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <label className="text-sm font-medium">
        Reason
        <textarea name="reason" required minLength={10} maxLength={500} className={`${textAreaClass} mt-1`} />
      </label>
      <button className={dangerButtonClass} disabled={pending} type="submit">
        {pending ? "Cancelling…" : "Cancel this appointment"}
      </button>
      {state.message ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
