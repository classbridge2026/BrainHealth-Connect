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
  wizard = false,
}: {
  offeringId: string;
  startsAt: string;
  locationId: string;
  channel: string;
  payable: boolean;
  wizard?: boolean;
}) {
  const [state, action, pending] = useActionState(bookSlotAction, initial);
  useOutcomeAlert(state.message, pending, "error");
  const concernRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    const field = concernRef.current;
    if (!field) return;
    const scroller = field.closest(".patient-scroll");
    if (!(scroller instanceof HTMLElement)) {
      field.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (wizard) {
      const button = field.parentElement?.querySelector(".mbk-continue");
      const tab = document.querySelector(".patient-tabbar");
      const limit = tab instanceof HTMLElement ? tab.getBoundingClientRect().top - 16 : scroller.getBoundingClientRect().bottom - 16;
      const target = button instanceof HTMLElement ? button : field;
      const overflow = target.getBoundingClientRect().bottom - limit;
      if (overflow > 8) scroller.scrollTo({ top: scroller.scrollTop + overflow, behavior: "smooth" });
      return;
    }
    const top = field.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [startsAt, wizard]);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="channel" value={channel} />
      {wizard ? <input type="hidden" name="wizard" value="mobile" /> : null}
      <label className="book-concern" id={wizard ? "what-is-wrong-mobile" : "what-is-wrong"} ref={concernRef}>
        What is wrong?
        <span>Tell the doctor what is wrong. This is the reason for the visit.</span>
        <textarea name="concern" required minLength={10} maxLength={500} rows={4} placeholder="Describe the problem in your own words." />
      </label>
      <button className={wizard ? "mbk-continue" : "book-confirm"} type="submit" disabled={pending}>
        {pending ? "Saving…" : wizard ? "Continue" : payable ? "Confirm and pay" : "Confirm appointment"}
      </button>
      {state.message ? <p className="book-alert" role="alert">{state.message}</p> : null}
    </form>
  );
}
