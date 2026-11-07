"use client";

import { useEffect } from "react";
import { bookingShell, stashBooking, takeBooking } from "./book-cache";
import { ensureRange } from "./ensure-range";
import { bookingPreview } from "./preview-action";

const flights = new Map<string, Promise<void>>();

export function WarmBooking(input: {
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
}) {
  const shell = bookingShell(input);
  if (!takeBooking(input.offeringId, shell.today, input.channel)?.slotsReady) {
    const current = takeBooking(input.offeringId, shell.today, input.channel);
    if (!current) stashBooking(shell, true);
  }

  useEffect(() => {
    const today = shell.today;
    ensureRange(input.offeringId);
    const key = `${input.offeringId}|${today}|${input.channel}`;
    if (takeBooking(input.offeringId, today, input.channel)?.slotsReady) return;
    const existing = flights.get(key);
    if (existing) return;
    const flight = bookingPreview(input.offeringId, today, input.channel)
      .then((preview) => {
        if (preview) stashBooking(preview);
        else stashBooking({ ...bookingShell(input), slotsReady: true });
      })
      .catch(() => {
        stashBooking({ ...bookingShell(input), slotsReady: true });
      })
      .finally(() => {
        flights.delete(key);
      });
    flights.set(key, flight);
  }, [input.channel, input.doctorId, input.doctorImageVersion, input.doctorName, input.doctorUserId, input.durationMinutes, input.fee, input.mode, input.offeringId, input.service, input.specialty, shell.today]);

  return null;
}
