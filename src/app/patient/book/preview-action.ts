"use server";

import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { parseVisitChannel } from "@/lib/appointments/channel";
import { loadOfferingSlots } from "@/lib/appointments/queries";
import { addDays, freetownDate, parseCalendarDate } from "@/lib/appointments/time";
import { prisma } from "@/lib/db/prisma";
import type { BookingOffering, BookingSlot } from "./[offeringId]/booking-details";

export type BookingPreview = {
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
  slotsReady: boolean;
};

export async function bookingPreview(offeringId: string, day: string, channelQuery: string): Promise<BookingPreview | null> {
  await requireStoredRoles([PATIENT_ROLE_CODE]);
  const today = freetownDate(new Date());
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
  const result = await loadOfferingSlots(prisma, { offeringId, day: requested });
  if (!result.ok) return null;
  const online = result.offering.mode === "ONLINE";
  const requestedChannel = parseVisitChannel(channelQuery);
  const channel = online
    ? requestedChannel === "VIDEO" || requestedChannel === "AUDIO" ? requestedChannel : null
    : "IN_PERSON";
  const start = parseCalendarDate(today);
  const days = start ? Array.from({ length: 14 }, (_, index) => addDays(start, index).toISOString().slice(0, 10)) : [today];
  return {
    offering: result.offering,
    days,
    today,
    requested,
    locationId: "",
    locations: result.locations,
    channel,
    channelQuery: channel === "AUDIO" ? "audio" : channel === "VIDEO" ? "video" : channel === "IN_PERSON" ? "in-person" : "",
    start: "",
    slots: result.slots,
    slotsReady: true,
  };
}

export async function bookingRange(offeringId: string): Promise<Array<{ day: string; slots: BookingSlot[] }> | null> {
  await requireStoredRoles([PATIENT_ROLE_CODE]);
  const today = freetownDate(new Date());
  const start = parseCalendarDate(today);
  if (!start) return null;
  const days = Array.from({ length: 14 }, (_, index) => addDays(start, index).toISOString().slice(0, 10));
  const rows = await Promise.all(days.map(async (day) => {
    const result = await loadOfferingSlots(prisma, { offeringId, day });
    return { day, slots: result.ok ? result.slots : [] };
  }));
  return rows;
}
