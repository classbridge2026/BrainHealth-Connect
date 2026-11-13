import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { parseCalendarDate } from "@/lib/appointments/time";
import { BookingChoices } from "./booking-choices";
import "../book.css";

export type BookingSlot = { startsAt: string; label: string };

export type BookingOffering = {
  id: string;
  doctorId: string;
  doctorUserId: string;
  doctorImageVersion: string | null;
  doctorName: string;
  specialty: string;
  service: string;
  mode: string;
  durationMinutes: number;
  fee: string;
  priceAmountMinor: number;
};

export function BookingDetailsPage({
  offering,
  days,
  today,
  requested,
  locationId,
  locations,
  channel,
  channelQuery,
  start,
  slots,
  slotsReady = true,
}: {
  offering: BookingOffering;
  days: string[];
  today: string;
  requested: string;
  locationId: string;
  locations: Array<{ id: string; label: string }>;
  channel: "VIDEO" | "AUDIO" | "IN_PERSON" | null;
  channelQuery: string;
  start: string;
  slots: BookingSlot[];
  slotsReady?: boolean;
}) {
  const online = offering.mode === "ONLINE";
  const selected = slots.find((slot) => slot.startsAt === start) ?? null;
  return (
    <div className="book-page">
      <div className="book-mobile">
        <div className="mbk">
          <Link className="mbk-back" href={`/patient/doctors/${offering.doctorId}`} aria-label="Back">
            <ChevronLeft size={22} aria-hidden="true" />
          </Link>
          <h1>Book Appointment</h1>
          <p className="mbk-lead">Choose your preferred date, time and consultation type to continue.</p>
          <p className="mbk-service">{offering.service}<b>{offering.fee}</b></p>
          <ol className="mbk-steps" aria-label="Booking steps">
            <li className="is-on"><b>1</b><span>Details</span></li>
            <li><b>2</b><span>Payment</span></li>
            <li><b>3</b><span>Confirmation</span></li>
          </ol>
          <Details
            offering={offering}
            days={days}
            today={today}
            requested={requested}
            locationId={locationId}
            locations={locations}
            channel={channel}
            channelQuery={channelQuery}
            online={online}
            selected={selected}
            slots={slots}
            slotsReady={slotsReady}
          />
        </div>
      </div>
    </div>
  );
}

export function Details({
  offering,
  days,
  today,
  requested,
  locationId,
  locations,
  channel,
  channelQuery,
  online,
  selected,
  slots,
  slotsReady = true,
}: {
  offering: BookingOffering;
  days: string[];
  today: string;
  requested: string;
  locationId: string;
  locations: Array<{ id: string; label: string }>;
  channel: "VIDEO" | "AUDIO" | "IN_PERSON" | null;
  channelQuery: string;
  online: boolean;
  selected: BookingSlot | null;
  slots: BookingSlot[];
  slotsReady?: boolean;
}) {
  return (
    <BookingChoices
      offering={offering}
      days={days}
      today={today}
      requested={requested}
      locationId={locationId}
      locations={locations}
      channelQuery={channelQuery || (channel === "AUDIO" ? "audio" : channel === "IN_PERSON" ? "in-person" : channel === "VIDEO" ? "video" : "")}
      online={online}
      slots={slots}
      slotsReady={slotsReady}
      start={selected?.startsAt ?? ""}
    />
  );
}

export function href(offeringId: string, date: string, locationId: string, channel: string, start?: string) {
  const params = new URLSearchParams({ date });
  if (locationId) params.set("location", locationId);
  if (channel) params.set("channel", channel);
  if (start) params.set("start", start);
  return `/patient/book/${offeringId}?${params.toString()}`;
}

export function dayChip(iso: string, today: string) {
  const date = parseCalendarDate(iso);
  if (!date) return { weekday: iso, label: iso };
  const weekday = iso === today ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return { weekday, label: `${month} ${date.getUTCDate()}` };
}

export function freetownDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function summaryDate(iso: string) {
  const date = parseCalendarDate(iso);
  if (!date) return iso;
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${weekday}, ${month} ${date.getUTCDate()}`;
}
