import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { parseVisitChannel, visitChannelLabel } from "@/lib/appointments/channel";
import { loadOfferingSlots } from "@/lib/appointments/queries";
import { freetownDate, parseCalendarDate, addDays } from "@/lib/appointments/time";
import { prisma } from "@/lib/db/prisma";
import { OpenTimes } from "@/components/appointments/open-times";
import { VisitIcon } from "@/app/patient/appointments/[id]/visit-icons";
import { ConfirmBookingForm } from "./confirm-form";
import "../../appointments/[id]/appointment-visit.css";
import "../book.css";

export const metadata: Metadata = { title: "Book an appointment" };
export const dynamic = "force-dynamic";

function dayParts(iso: string, today: string) {
  const date = parseCalendarDate(iso);
  if (!date) return { weekday: "", number: iso, month: "" };
  return {
    weekday: iso === today ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    number: String(date.getUTCDate()),
    month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
  };
}

function bookHref(offeringId: string, date: string, locationId: string, channel: string) {
  const params = new URLSearchParams({ date });
  if (locationId) params.set("location", locationId);
  if (channel) params.set("channel", channel);
  return `/patient/book/${offeringId}?${params.toString()}`;
}

function longDay(iso: string) {
  const date = parseCalendarDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export default async function BookOfferingPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { offeringId } = await params;
  const query = await searchParams;
  const today = freetownDate(new Date());
  const requested = typeof query.date === "string" ? query.date : today;
  const locationId = typeof query.location === "string" ? query.location : "";
  const start = typeof query.start === "string" ? query.start : "";
  const requestedChannel = parseVisitChannel(typeof query.channel === "string" ? query.channel : "");
  const result = await loadOfferingSlots(prisma, { offeringId, day: requested, locationId: locationId || null });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const { offering, locations, slots, schedule } = result;
  const days = Array.from({ length: 14 }, (_, index) => addDays(parseCalendarDate(today)!, index).toISOString().slice(0, 10));
  const selected = slots.find((slot) => slot.startsAt === start);
  const location = locations.find((row) => row.id === locationId);
  const online = offering.mode === "ONLINE";
  const channel = online
    ? requestedChannel === "VIDEO" || requestedChannel === "AUDIO" ? requestedChannel : null
    : "IN_PERSON";
  const channelQuery = channel === "AUDIO" ? "audio" : channel === "VIDEO" ? "video" : channel === "IN_PERSON" ? "in-person" : "";

  return (
    <div className="book-page">
      <Link className="visit-back" href={`/patient/doctors/${offering.doctorId}`}>
        <VisitIcon name="back" />
        Doctor profile
      </Link>

      <section className="book-hero">
        <div className="book-hero-top">
          <div className="book-hero-copy">
            <p className="visit-kicker">{offering.specialty}</p>
            <h1>{offering.service}</h1>
            <p>Choose a day and time, such as 4:00 PM.</p>
            <div className="book-facts">
              <span className="book-chip">
                <VisitIcon name={online ? "video" : "hospital"} />
                {channel ? visitChannelLabel(channel) : "Choose a visit type"}
              </span>
              <span className="book-chip">
                <VisitIcon name="clock" />
                {offering.durationMinutes} min
              </span>
              <span className="book-chip">
                <VisitIcon name="payment" />
                {offering.fee}
              </span>
            </div>
          </div>
          <div className="book-doctor">
            <ProfilePhoto userId={offering.doctorUserId} name={offering.doctorName} version={offering.doctorImageVersion} size={56} alt="" />
            <span>
              <small>Clinician</small>
              <strong>{offering.doctorName}</strong>
            </span>
          </div>
        </div>
      </section>

      {offering.mode === "IN_PERSON" ? (
        locations.length === 0 ? (
          <p className="book-panel book-hint">This doctor has not published an in-person clinic for this consultation.</p>
        ) : (
          <section className="book-panel">
            <h2>Clinic</h2>
            <div className="book-clinics">
              {locations.map((row) => (
                <Link
                  key={row.id}
                  href={bookHref(offering.id, requested, row.id, "in-person")}
                  className={`book-clinic${row.id === locationId ? " book-clinic-on" : ""}`}
                >
                  {row.label}
                </Link>
              ))}
            </div>
            {!location ? <p className="book-hint">Choose a clinic to see in-person times.</p> : null}
          </section>
        )
      ) : null}

      {online && !channel ? (
        <section className="book-panel">
          <h2>Visit type</h2>
          <p className="book-hint">Choose video or audio before the times appear.</p>
          <div className="book-clinics">
            <Link className="book-clinic" href={bookHref(offering.id, requested, "", "video")}>Video</Link>
            <Link className="book-clinic" href={bookHref(offering.id, requested, "", "audio")}>Audio</Link>
          </div>
        </section>
      ) : (
      <section className="book-panel">
        <h2>{longDay(requested)}</h2>
        <div className="book-days" role="list">
          {days.map((day) => {
            const parts = dayParts(day, today);
            return (
              <Link
                key={day}
                role="listitem"
                href={bookHref(offering.id, day, locationId, channelQuery)}
                className={`book-day${day === requested ? " book-day-on" : ""}`}
                aria-current={day === requested ? "date" : undefined}
              >
                <small>{parts.weekday}</small>
                <strong>{parts.number}</strong>
                <small>{parts.month}</small>
              </Link>
            );
          })}
        </div>
      </section>
      )}

      {online && !channel ? null : offering.mode === "IN_PERSON" && !location ? null : schedule.length === 0 ? (
        <p className="book-panel book-hint">No open times on this date. Try another day.</p>
      ) : (
        <section className="book-panel">
          <h2>Available times</h2>
          <OpenTimes basePath={`/patient/book/${offering.id}`} date={requested} locationId={locationId} channel={channelQuery} selectedStart={start} slots={schedule}>
            {selected && channel ? (
              <section className="book-review">
                <h2>Review booking</h2>
                <p>
                  {offering.doctorName} · {offering.service} · {visitChannelLabel(channel)} · {selected.label}
                  {location ? ` · ${location.label}` : ""} · {offering.fee}
                </p>
                <p>
                  {offering.priceAmountMinor > 0
                    ? "Confirming holds this open time. Pay the self-pay fee with Orange Money or Afrimoney before the hold ends, and the visit is confirmed."
                    : "Confirming books this open time. There is no fee for this visit."}
                </p>
                <ConfirmBookingForm
                  offeringId={offering.id}
                  startsAt={selected.startsAt}
                  locationId={location?.id ?? ""}
                  channel={channel}
                  payable={offering.priceAmountMinor > 0}
                />
              </section>
            ) : null}
          </OpenTimes>
        </section>
      )}
    </div>
  );
}
