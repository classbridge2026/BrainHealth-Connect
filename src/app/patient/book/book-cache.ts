import { addDays, freetownDate, parseCalendarDate } from "@/lib/appointments/time";
import type { BookingPreview } from "./preview-action";

const previews = new Map<string, BookingPreview>();
const listeners = new Set<() => void>();
const daySlots = new Map<string, BookingSlot[]>();
const dayListeners = new Set<() => void>();

type BookingSlot = BookingPreview["slots"][number];

export function bookingKey(offeringId: string, day: string, channel: string) {
  return `${offeringId}|${day}|${channel}`;
}

export function takeBooking(offeringId: string, day: string, channel: string) {
  return previews.get(bookingKey(offeringId, day, channel)) ?? null;
}

export function stashBooking(preview: BookingPreview, quiet = false) {
  previews.set(bookingKey(preview.offering.id, preview.requested, preview.channelQuery), preview);
  if (preview.slotsReady) daySlots.set(`${preview.offering.id}|${preview.requested}`, preview.slots);
  if (!quiet) {
    listeners.forEach((listener) => listener());
    if (preview.slotsReady) dayListeners.forEach((listener) => listener());
  }
}

export function takeDay(offeringId: string, day: string) {
  return daySlots.get(`${offeringId}|${day}`);
}

export function stashDay(offeringId: string, day: string, slots: BookingSlot[], quiet = false) {
  daySlots.set(`${offeringId}|${day}`, slots);
  if (!quiet) dayListeners.forEach((listener) => listener());
}

export function stashDays(offeringId: string, rows: Array<{ day: string; slots: BookingSlot[] }>) {
  for (const row of rows) daySlots.set(`${offeringId}|${row.day}`, row.slots);
  dayListeners.forEach((listener) => listener());
}

export function subscribeDays(listener: () => void) {
  dayListeners.add(listener);
  return () => {
    dayListeners.delete(listener);
  };
}

export function subscribeBooking(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function bookingShell(input: {
  offeringId: string;
  doctorId: string;
  doctorUserId: string;
  doctorImageVersion: string | null;
  doctorName: string;
  specialty: string;
  service: string;
  mode: string;
  durationMinutes: number;
  fee: string;
  channel: string;
}): BookingPreview {
  const today = freetownDate(new Date());
  const start = parseCalendarDate(today);
  const days = start ? Array.from({ length: 14 }, (_, index) => addDays(start, index).toISOString().slice(0, 10)) : [today];
  const channel = input.channel === "audio" ? "AUDIO" : input.channel === "in-person" ? "IN_PERSON" : "VIDEO";
  return {
    offering: {
      id: input.offeringId,
      doctorId: input.doctorId,
      doctorUserId: input.doctorUserId,
      doctorImageVersion: input.doctorImageVersion,
      doctorName: input.doctorName,
      specialty: input.specialty,
      service: input.service,
      mode: input.mode,
      durationMinutes: input.durationMinutes,
      fee: input.fee,
      priceAmountMinor: 0,
    },
    days,
    today,
    requested: today,
    locationId: "",
    locations: [],
    channel,
    channelQuery: input.channel,
    start: "",
    slots: [],
    slotsReady: false,
  };
}
