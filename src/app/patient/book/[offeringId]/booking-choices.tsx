"use client";

import { useEffect, useState } from "react";
import { Building2, Phone, Video, type LucideIcon } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { stashDay, subscribeDays, takeDay } from "@/app/patient/book/book-cache";
import { ensureRange } from "@/app/patient/book/ensure-range";
import { ConfirmBookingForm } from "./confirm-form";
import { CurrentScroller } from "./current-scroller";
import { parseCalendarDate } from "@/lib/appointments/time";
import type { BookingOffering, BookingSlot } from "./booking-details";

export function BookingChoices({
  offering,
  days,
  today,
  requested: requestedFromServer,
  locationId: locationFromServer,
  locations,
  channelQuery: channelFromServer,
  online,
  slots,
  slotsReady = true,
  start: startFromServer = "",
}: {
  offering: BookingOffering;
  days: string[];
  today: string;
  requested: string;
  locationId: string;
  locations: Array<{ id: string; label: string }>;
  channelQuery: string;
  online: boolean;
  slots: BookingSlot[];
  slotsReady?: boolean;
  start?: string;
}) {
  const [channelQuery, setChannelQuery] = useState(channelFromServer);
  const [requested, setRequested] = useState(requestedFromServer);
  const [locationId, setLocationId] = useState(locationFromServer);
  const [start, setStart] = useState(startFromServer);
  const [revision, setRevision] = useState(0);

  if (slotsReady && takeDay(offering.id, requestedFromServer) === undefined) {
    stashDay(offering.id, requestedFromServer, slots, true);
  }

  useEffect(() => {
    void ensureRange(offering.id);
  }, [offering.id]);
  useEffect(() => subscribeDays(() => setRevision((value) => value + 1)), []);

  useEffect(() => {
    if (!location.pathname.startsWith("/patient/book/")) return;
    if (new URLSearchParams(location.search).get("step")) return;
    const next = href(offering.id, requested, locationId, channelQuery, start || undefined);
    if (`${location.pathname}${location.search}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [channelQuery, locationId, offering.id, requested, start]);

  const daySlots = takeDay(offering.id, requested);
  const visibleSlots = daySlots ?? (requested === requestedFromServer && slotsReady ? slots : undefined);
  const selected = visibleSlots?.find((slot) => slot.startsAt === start) ?? null;
  const channel = channelQuery === "audio" ? "AUDIO" : channelQuery === "in-person" ? "IN_PERSON" : channelQuery === "video" ? "VIDEO" : null;
  const types: Array<{ id: string; title: string; note: string; icon: LucideIcon }> = online
    ? [
        { id: "video", title: "Video Call", note: "Talk from home", icon: Video },
        { id: "audio", title: "Audio Call", note: "Talk by phone", icon: Phone },
      ]
    : [{ id: "in-person", title: "In person", note: "Visit the clinic", icon: Building2 }];
  const ready = Boolean(channel && selected && (online || locationId));
  const channelName = channel === "VIDEO" ? "Video Call" : channel === "AUDIO" ? "Audio Call" : channel === "IN_PERSON" ? "In person" : "Choose a visit type";
  void revision;

  return (
    <>
      <section className="mbk-block">
        <h2>Consultation Type</h2>
        <div className="mbk-types">
          {types.map((type) => {
            const on = channelQuery === type.id;
            const Icon = type.icon;
            return (
              <button key={type.id} type="button" className={on ? "mbk-type is-on" : "mbk-type"} aria-pressed={on} onClick={() => setChannelQuery(type.id)}>
                <i><Icon size={22} aria-hidden="true" /></i>
                <strong>{type.title}</strong>
                <small>{type.note}</small>
              </button>
            );
          })}
        </div>
      </section>

      {!online && locations.length > 0 ? (
        <section className="mbk-block">
          <h2>Clinic</h2>
          <div className="mbk-types">
            {locations.map((row) => (
              <button key={row.id} type="button" className={row.id === locationId ? "mbk-type is-on" : "mbk-type"} aria-pressed={row.id === locationId} onClick={() => { setLocationId(row.id); setStart(""); }}>
                <i><Building2 size={22} aria-hidden="true" /></i>
                <strong>{row.label}</strong>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mbk-block">
        <h2>Select Date</h2>
        <CurrentScroller marker={requested}>
          {days.map((day) => {
            const parts = dayChip(day, today);
            const on = day === requested;
            return (
              <button key={day} type="button" role="listitem" className={on ? "mbk-day is-on" : "mbk-day"} aria-current={on ? "date" : undefined} onClick={() => { setRequested(day); setStart(""); }}>
                <small>{parts.weekday}</small>
                <strong>{parts.label}</strong>
              </button>
            );
          })}
        </CurrentScroller>
      </section>

      <section className="mbk-block">
        <h2>Available Time</h2>
        {!channel ? <p className="mbk-empty">Choose video or audio to see open times.</p> : null}
        {channel && !online && !locationId ? <p className="mbk-empty">Choose a clinic to see open times.</p> : null}
        {channel && (online || locationId) && visibleSlots && visibleSlots.length === 0 ? <p className="mbk-empty">No open times on this date. Try another day.</p> : null}
        {channel && (online || locationId) && visibleSlots && visibleSlots.length > 0 ? (
          <CurrentScroller marker={start || requested} className="mbk-times">
            {visibleSlots.map((slot) => {
              const on = slot.startsAt === start;
              return (
                <button key={slot.startsAt} type="button" role="listitem" className={on ? "mbk-time is-on" : "mbk-time"} aria-pressed={on} aria-current={on ? "true" : undefined} onClick={() => setStart(slot.startsAt)}>
                  {slot.label}
                </button>
              );
            })}
          </CurrentScroller>
        ) : null}
      </section>

      <div className="mbk-doctor">
        <ProfilePhoto userId={offering.doctorUserId} name={offering.doctorName} version={offering.doctorImageVersion} size={44} alt="" />
        <span>
          <strong>{offering.doctorName}</strong>
          <small>{offering.specialty} · {channelName}</small>
        </span>
        <span className="mbk-when">
          <strong>{summaryDate(requested)}</strong>
          {selected ? <small>{selected.label}</small> : null}
        </span>
      </div>

      {ready && channel && selected ? (
        <ConfirmBookingForm
          offeringId={offering.id}
          startsAt={selected!.startsAt}
          locationId={locationId}
          channel={channel}
          payable={offering.priceAmountMinor > 0}
          wizard
        />
      ) : (
        <button className="mbk-continue" type="button" disabled>Continue</button>
      )}
    </>
  );
}

function href(offeringId: string, date: string, locationId: string, channel: string, start?: string) {
  const params = new URLSearchParams({ date });
  if (locationId) params.set("location", locationId);
  if (channel) params.set("channel", channel);
  if (start) params.set("start", start);
  return `/patient/book/${offeringId}?${params.toString()}`;
}

function dayChip(iso: string, today: string) {
  const date = parseCalendarDate(iso);
  if (!date) return { weekday: iso, label: iso };
  const weekday = iso === today ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return { weekday, label: `${month} ${date.getUTCDate()}` };
}

function summaryDate(iso: string) {
  const date = parseCalendarDate(iso);
  if (!date) return iso;
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${weekday}, ${month} ${date.getUTCDate()}`;
}
