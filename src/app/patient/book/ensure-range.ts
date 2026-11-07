"use client";

import { stashDays } from "./book-cache";
import { bookingRange } from "./preview-action";

const flights = new Map<string, Promise<void>>();

export function ensureRange(offeringId: string) {
  const existing = flights.get(offeringId);
  if (existing) return existing;
  const flight = bookingRange(offeringId)
    .then((rows) => {
      if (rows) stashDays(offeringId, rows);
    })
    .catch(() => undefined);
  flights.set(offeringId, flight);
  return flight;
}
