"use client";

import { useActionState, useState } from "react";
import { scheduleFollowUpAction, type FollowUpState } from "./actions";

const initial: FollowUpState = {};

export function FollowUpForm({
  offerings,
  sources,
  locations,
  sourceId,
}: {
  offerings: Array<{ id: string; label: string; mode: "ONLINE" | "IN_PERSON"; doctorProfileId?: string }>;
  sources: Array<{ id: string; label: string; doctorProfileId?: string }>;
  locations: Array<{ id: string; label: string }>;
  sourceId?: string;
}) {
  const [state, action, pending] = useActionState(scheduleFollowUpAction, initial);
  const [source, setSource] = useState(sourceId && sources.some((row) => row.id === sourceId) ? sourceId : sources[0]?.id ?? "");
  const doctorProfileId = sources.find((row) => row.id === source)?.doctorProfileId;
  const choices = doctorProfileId ? offerings.filter((row) => row.doctorProfileId === doctorProfileId) : offerings;
  if (sources.length === 0 || offerings.length === 0) {
    return <p className="text-sm leading-6 text-[#5b6b7c]">A follow-up can be scheduled after you have an assigned visit and an active consultation service.</p>;
  }
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-[#d7e3ee] bg-white p-5">
      <h2 className="text-lg font-semibold text-[#0C2B45]">Schedule a follow-up</h2>
      <p className="text-sm leading-6 text-[#5b6b7c]">This uses the existing booking rules. The visit is confirmed without payment. Times use Africa/Freetown (GMT).</p>
      <label className="text-sm font-medium">
        Related visit
        <select className="mt-1 h-11 w-full rounded-lg border border-[#d7e3ee] px-3" name="sourceAppointmentId" value={source} onChange={(event) => setSource(event.target.value)} required>
          {sources.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">
        Service
        <select className="mt-1 h-11 w-full rounded-lg border border-[#d7e3ee] px-3" name="offeringId" required>
          {choices.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Date<input className="mt-1 h-11 w-full rounded-lg border border-[#d7e3ee] px-3" name="date" type="date" required /></label>
        <label className="text-sm font-medium">Start time<input className="mt-1 h-11 w-full rounded-lg border border-[#d7e3ee] px-3" name="time" type="time" required /></label>
      </div>
      <label className="text-sm font-medium">
        Clinic, for an in-person service
        <select className="mt-1 h-11 w-full rounded-lg border border-[#d7e3ee] px-3" name="locationId" defaultValue="">
          <option value="">No clinic</option>
          {locations.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </label>
      <button className="h-11 rounded-lg bg-[#0F766E] text-sm font-semibold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "Saving…" : "Schedule follow-up"}</button>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
