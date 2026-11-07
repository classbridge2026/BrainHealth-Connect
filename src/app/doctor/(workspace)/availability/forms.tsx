"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { primaryButtonClass, secondaryButtonClass, textInputClass } from "@/components/form-classes";
import type { ScheduleResult } from "@/lib/appointments/schedule";
import { showOutcome } from "@/lib/ui/sweet-alert";
import { addTimeOffAction, deactivateRuleAction, removeTimeOffAction, saveRuleAction } from "./actions";

const initial: ScheduleResult = { ok: true, message: "" };
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS_HASHES = ["weekly-hours"];
const TIME_OFF_HASHES = ["time-off", "request-time-off"];

function useSavedClose(state: ScheduleResult, pending: boolean, onSaved?: () => void) {
  const wasPending = useRef(false);
  const router = useRouter();
  useEffect(() => {
    if (wasPending.current && !pending && state.ok && state.message) {
      void showOutcome({ title: "Saved", text: state.message, tone: "ok" });
      onSaved?.();
      router.refresh();
    }
    wasPending.current = pending;
  }, [onSaved, pending, router, state.message, state.ok]);
}

function useHashOpen(names: readonly string[], open: () => void) {
  useEffect(() => {
    function sync() {
      if (names.includes(window.location.hash.replace("#", ""))) open();
    }
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [names, open]);
}

function clearHash(names: readonly string[]) {
  if (!names.includes(window.location.hash.replace("#", ""))) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function AvailDialog({ title, purpose, titleId, onClose, children }: { title: string; purpose: string; titleId: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="avail-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="avail-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header className="avail-dialog-head">
          <div>
            <p className="avail-dialog-kicker">Availability</p>
            <h2 id={titleId}>{title}</h2>
            <p>{purpose}</p>
          </div>
          <button className="avail-dialog-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Notice({ state }: { state: ScheduleResult }) {
  if (!state.message) return null;
  return (
    <p className={state.ok ? "text-sm font-semibold text-[#0F766E]" : "text-sm font-semibold text-[#9b2330]"} role={state.ok ? "status" : "alert"}>
      {state.message}
    </p>
  );
}

export function WeeklyHoursForm({
  doctorProfileId,
  offerings = [],
  embedded = false,
  showHeading = true,
  onSaved,
}: {
  doctorProfileId?: string;
  offerings?: Array<{ id: string; label: string }>;
  embedded?: boolean;
  showHeading?: boolean;
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState(saveRuleAction, initial);
  const [mode, setMode] = useState("ONLINE");
  const [clinic, setClinic] = useState("");
  const needsClinic = mode === "IN_PERSON" || mode === "BOTH";
  useSavedClose(state, pending, onSaved);
  return (
    <form action={action} className={embedded ? "avail-form" : "grid gap-3 rounded-2xl border border-brand-line bg-white p-5"}>
      {showHeading ? (
        <>
          <h2 className="text-lg font-semibold text-brand-navy">Weekly hours</h2>
          <p className="text-sm text-brand-muted">Use the normal clock, such as 7:00 AM and 4:00 PM. Saving hours does not change appointments already booked.</p>
        </>
      ) : null}
      {doctorProfileId ? <input type="hidden" name="doctorProfileId" value={doctorProfileId} /> : null}
      <label className="text-sm font-medium">
        Day
        <select name="dayOfWeek" className={`${textInputClass} mt-1`} defaultValue="1">
          {weekdays.map((day, index) => (
            <option key={day} value={index + 1}>{day}</option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Start<input name="start" type="time" required className={`${textInputClass} mt-1`} /></label>
        <label className="text-sm font-medium">End<input name="end" type="time" required className={`${textInputClass} mt-1`} /></label>
      </div>
      <label className="text-sm font-medium">
        Mode
        <select
          name="mode"
          className={`${textInputClass} mt-1`}
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            setMode(next);
            if (next === "ONLINE") setClinic("");
          }}
        >
          <option value="ONLINE">Online</option>
          <option value="IN_PERSON">In person</option>
          <option value="BOTH">Online and in person</option>
        </select>
      </label>
      <label className={`text-sm font-medium ${needsClinic ? "" : "text-brand-muted"}`}>
        Location for in-person hours
        <input
          name={needsClinic ? "clinic" : undefined}
          value={clinic}
          onChange={(event) => setClinic(event.target.value)}
          maxLength={160}
          required={needsClinic}
          disabled={!needsClinic}
          placeholder={needsClinic ? "Clinic name and area" : "Not used for online hours"}
          className={`${textInputClass} mt-1 disabled:cursor-not-allowed disabled:bg-[#f4f7fa] disabled:text-[#9aa8b5]`}
        />
        <span className="mt-1 block font-normal text-brand-muted">
          {mode === "BOTH"
            ? "Patients can choose online or in person. Enter the clinic used when they choose in person."
            : needsClinic
              ? "Type the clinic for these in-person hours."
              : "Online hours do not use a clinic. Choose in person, or online and in person, to enter a location."}
        </span>
      </label>
      {mode === "BOTH" ? (
        <p className="text-sm text-brand-muted">These hours stay open for every active service, so a patient can choose the visit type.</p>
      ) : (
        <label className="text-sm font-medium">
          Limit to one service
          <select name="offeringId" className={`${textInputClass} mt-1`} defaultValue="">
            <option value="">Any matching service</option>
            {offerings.map((offering) => (
              <option key={offering.id} value={offering.id}>{offering.label}</option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Valid from<input name="validFrom" type="date" className={`${textInputClass} mt-1`} /></label>
        <label className="text-sm font-medium">Valid until<input name="validUntil" type="date" className={`${textInputClass} mt-1`} /></label>
      </div>
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : "Save hours"}</button>
      <Notice state={state} />
    </form>
  );
}

export function DeactivateRuleForm({ ruleId, doctorProfileId, compact = false }: { ruleId: string; doctorProfileId?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(deactivateRuleAction, initial);
  return (
    <form action={action} className={compact ? "avail-stop-form" : undefined}>
      <input type="hidden" name="ruleId" value={ruleId} />
      {doctorProfileId ? <input type="hidden" name="doctorProfileId" value={doctorProfileId} /> : null}
      <button className={compact ? "avail-stop" : secondaryButtonClass} disabled={pending} type="submit" aria-label={compact ? "Stop offering these hours" : undefined}>
        {pending ? "Updating…" : compact ? "Remove" : "Stop offering these hours"}
      </button>
      <Notice state={state} />
    </form>
  );
}

export function TimeOffForm({
  doctorProfileId,
  embedded = false,
  showHeading = true,
  onSaved,
}: {
  doctorProfileId?: string;
  embedded?: boolean;
  showHeading?: boolean;
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState(addTimeOffAction, initial);
  useSavedClose(state, pending, onSaved);
  return (
    <form action={action} className={embedded ? "avail-form" : "grid gap-3 rounded-2xl border border-brand-line bg-white p-5"}>
      {showHeading ? (
        <>
          <h2 className={embedded ? undefined : "text-lg font-semibold text-brand-navy"}>{embedded ? "Add time off" : "Time off and breaks"}</h2>
          <p className="text-sm text-brand-muted">Use this for holidays, leave, and breaks. It is rejected if a booking already occupies the time.</p>
        </>
      ) : null}
      {doctorProfileId ? <input type="hidden" name="doctorProfileId" value={doctorProfileId} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">From date<input name="startDate" type="date" required className={`${textInputClass} mt-1`} /></label>
        <label className="text-sm font-medium">From time<input name="startTime" type="time" required className={`${textInputClass} mt-1`} /></label>
        <label className="text-sm font-medium">Until date<input name="endDate" type="date" required className={`${textInputClass} mt-1`} /></label>
        <label className="text-sm font-medium">Until time<input name="endTime" type="time" required className={`${textInputClass} mt-1`} /></label>
      </div>
      <label className="text-sm font-medium">Reason<input name="reason" maxLength={200} className={`${textInputClass} mt-1`} /></label>
      <button className={primaryButtonClass} disabled={pending} type="submit">{pending ? "Saving…" : "Add unavailable time"}</button>
      <Notice state={state} />
    </form>
  );
}

export function RemoveTimeOffForm({ timeOffId, doctorProfileId, compact = false }: { timeOffId: string; doctorProfileId?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(removeTimeOffAction, initial);
  return (
    <form action={action} className={compact ? "avail-stop-form" : undefined}>
      <input type="hidden" name="timeOffId" value={timeOffId} />
      {doctorProfileId ? <input type="hidden" name="doctorProfileId" value={doctorProfileId} /> : null}
      <button className={compact ? "avail-stop" : secondaryButtonClass} disabled={pending} type="submit">{pending ? "Removing…" : "Remove"}</button>
      <Notice state={state} />
    </form>
  );
}

export function AddHoursButton({
  doctorProfileId,
  offerings = [],
}: {
  doctorProfileId?: string;
  offerings?: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    clearHash(HOURS_HASHES);
  }, []);
  const show = useCallback(() => setOpen(true), []);
  useHashOpen(HOURS_HASHES, show);
  return (
    <>
      <button className="avail-open" type="button" onClick={show}>
        Add hours
      </button>
      {open ? (
        <AvailDialog
          title="Weekly hours"
          titleId="weekly-hours-title"
          purpose="Use the normal clock, such as 7:00 AM and 4:00 PM. Saving hours does not change appointments already booked."
          onClose={close}
        >
          <WeeklyHoursForm doctorProfileId={doctorProfileId} offerings={offerings} embedded showHeading={false} onSaved={close} />
        </AvailDialog>
      ) : null}
    </>
  );
}

export function AddTimeOffButton({ doctorProfileId }: { doctorProfileId?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    clearHash(TIME_OFF_HASHES);
  }, []);
  const show = useCallback(() => setOpen(true), []);
  useHashOpen(TIME_OFF_HASHES, show);
  return (
    <>
      <button className="avail-open" type="button" onClick={show}>
        Add time off
      </button>
      {open ? (
        <AvailDialog
          title="Time off"
          titleId="time-off-title"
          purpose="Use this for holidays, leave, and breaks. It is rejected if a booking already occupies the time."
          onClose={close}
        >
          <TimeOffForm doctorProfileId={doctorProfileId} embedded showHeading={false} onSaved={close} />
        </AvailDialog>
      ) : null}
    </>
  );
}
