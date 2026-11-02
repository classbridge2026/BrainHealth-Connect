"use client";

import { useActionState } from "react";
import { checkInAction, saveIntakeAction, type PrepareState } from "./prepare-actions";

const initial: PrepareState = {};

export function VisitPreparation({
  appointmentId,
  history,
  consented,
  canCheckIn,
  checkedIn,
}: {
  appointmentId: string;
  history: string;
  consented: boolean;
  canCheckIn: boolean;
  checkedIn: boolean;
}) {
  const [intakeState, saveIntake, intakePending] = useActionState(saveIntakeAction, initial);
  const [checkState, checkIn, checkPending] = useActionState(checkInAction, initial);

  return (
    <section className="visit-panel">
      <h2>Before the visit</h2>
      <p>Share a short history and accept the consent. eCheck-in opens 15 minutes before a confirmed visit.</p>
      <form action={saveIntake} className="grid gap-3">
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <label className="grid gap-1">
          History
          <textarea name="history" required minLength={10} maxLength={1000} rows={4} defaultValue={history} placeholder="Medicines, allergies, or what has been happening." />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="consent" defaultChecked={consented} required />
          <span>I agree to this consultation and understand it is not an emergency service.</span>
        </label>
        <button className="visit-action" type="submit" disabled={intakePending}>{intakePending ? "Saving…" : "Save intake"}</button>
        {intakeState.message ? <p role="status">{intakeState.message}</p> : null}
      </form>
      {checkedIn ? <p role="status">You are checked in.</p> : null}
      {canCheckIn ? (
        <form action={checkIn}>
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <button className="visit-action" type="submit" disabled={checkPending}>{checkPending ? "Checking in…" : "eCheck-in"}</button>
          {checkState.message ? <p role="status">{checkState.message}</p> : null}
        </form>
      ) : checkedIn ? null : (
        <p>eCheck-in stays closed until the visit is confirmed, the consent is saved, and the start time is within 15 minutes.</p>
      )}
    </section>
  );
}
