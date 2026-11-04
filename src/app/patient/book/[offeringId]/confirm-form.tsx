"use client";

import { useActionState, useEffect, useRef } from "react";
import { useOutcomeAlert } from "@/lib/ui/sweet-alert";
import { bookSlotAction, type BookState } from "../actions";
import "../book.css";

const initial: BookState = {};

export function ConfirmBookingForm({
  offeringId,
  startsAt,
  locationId,
  channel,
  payable,
}: {
  offeringId: string;
  startsAt: string;
  locationId: string;
  channel: string;
  payable: boolean;
}) {
  const [state, action, pending] = useActionState(bookSlotAction, initial);
  useOutcomeAlert(state.message, pending, "error");
  const concernRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    const field = concernRef.current;
    if (!field) return;
    const scroller = field.closest(".patient-scroll");
    if (scroller instanceof HTMLElement) {
      const top = field.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return;
    }
    field.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [startsAt]);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="channel" value={channel} />
      <label className="book-concern" id="what-is-wrong" ref={concernRef}>
        What is wrong?
        <span>Tell the doctor what is wrong. This is the reason for the visit.</span>
        <textarea name="concern" required minLength={10} maxLength={500} rows={4} placeholder="Describe the problem in your own words." />
      </label>
      <button className="book-confirm" type="submit" disabled={pending}>
        {pending ? "Saving…" : payable ? "Confirm and pay" : "Confirm appointment"}
      </button>
      {state.message ? <p className="book-alert" role="alert">{state.message}</p> : null}
    </form>
  );
}
