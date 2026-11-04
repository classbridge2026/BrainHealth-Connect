"use client";

import { useActionState } from "react";
import { primaryButtonClass, textAreaClass } from "@/components/form-classes";
import { useConfirmedSubmit, useOutcomeAlert } from "@/lib/ui/sweet-alert";
import { reschedulePatientAppointmentAction, type AppointmentActionState } from "../../actions";

const initial: AppointmentActionState = {};

export function RescheduleForm({ appointmentId, startsAt }: { appointmentId: string; startsAt: string }) {
  const [state, action, pending] = useActionState(reschedulePatientAppointmentAction, initial);
  const onSubmit = useConfirmedSubmit({
    title: "Move this appointment?",
    text: "The current time will be released and this visit will move to the time you selected.",
    confirmText: "Reschedule",
  });
  useOutcomeAlert(state.message, pending, "error");
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5" onSubmit={onSubmit}>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <label className="text-sm font-medium">
        Reason
        <textarea name="reason" required minLength={10} maxLength={500} className={`${textAreaClass} mt-1`} />
      </label>
      <button className={primaryButtonClass} disabled={pending} type="submit">
        {pending ? "Saving…" : "Reschedule appointment"}
      </button>
      {state.message ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
