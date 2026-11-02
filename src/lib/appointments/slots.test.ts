import { describe, expect, it } from "vitest";
import { describeDaySlots, rulesConflict, slotsForDay, slotIsOpen, visibleBookingSlots, type ScheduleRule } from "./slots";
import { canTransition } from "./transitions";

const rule = (overrides: Partial<ScheduleRule> = {}): ScheduleRule => ({
  dayOfWeek: 1,
  startMinute: 9 * 60,
  endMinute: 11 * 60,
  mode: "ONLINE",
  locationId: null,
  offeringId: null,
  validFrom: null,
  validUntil: null,
  isActive: true,
  ...overrides,
});

describe("available slots", () => {
  const now = new Date("2026-10-19T08:00:00.000Z");

  it("builds future slots from the weekly rule and skips occupied or past times", () => {
    const slots = slotsForDay({
      day: "2026-10-19",
      durationMinutes: 60,
      mode: "ONLINE",
      locationId: null,
      offeringId: "offering-1",
      rules: [rule()],
      blocks: [{ startsAt: new Date("2026-10-19T10:00:00.000Z"), endsAt: new Date("2026-10-19T11:00:00.000Z") }],
      now,
    });
    expect(slots.map((slot) => slot.toISOString())).toEqual(["2026-10-19T09:00:00.000Z"]);
    expect(describeDaySlots({
      day: "2026-10-19",
      durationMinutes: 60,
      mode: "ONLINE",
      locationId: null,
      offeringId: "offering-1",
      rules: [rule()],
      blocks: [{ startsAt: new Date("2026-10-19T10:00:00.000Z"), endsAt: new Date("2026-10-19T11:00:00.000Z") }],
      now,
    }).map((slot) => [slot.startsAt.toISOString(), slot.availability])).toEqual([
      ["2026-10-19T09:00:00.000Z", "open"],
      ["2026-10-19T10:00:00.000Z", "booked"],
    ]);
  });

  it("rejects a slot that is not on the schedule", () => {
    expect(
      slotIsOpen({
        startsAt: new Date("2026-10-19T12:00:00.000Z"),
        endsAt: new Date("2026-10-19T13:00:00.000Z"),
        mode: "ONLINE",
        locationId: null,
        offeringId: "offering-1",
        rules: [rule()],
        blocks: [],
        now,
      }),
    ).toBe(false);
  });

  it("lets a patient choose online or in person when the hours cover both", () => {
    const shared = rule({ mode: null, locationId: "clinic" });
    const online = slotsForDay({
      day: "2026-10-19",
      durationMinutes: 60,
      mode: "ONLINE",
      locationId: null,
      offeringId: "offering-1",
      rules: [shared],
      blocks: [],
      now,
    });
    const inPerson = slotsForDay({
      day: "2026-10-19",
      durationMinutes: 60,
      mode: "IN_PERSON",
      locationId: "clinic",
      offeringId: "offering-1",
      rules: [shared],
      blocks: [],
      now,
    });
    const otherClinic = slotsForDay({
      day: "2026-10-19",
      durationMinutes: 60,
      mode: "IN_PERSON",
      locationId: "other",
      offeringId: "offering-1",
      rules: [shared],
      blocks: [],
      now,
    });
    expect(online).toHaveLength(2);
    expect(inPerson).toHaveLength(2);
    expect(otherClinic).toEqual([]);
  });

  it("requires the in-person location on the rule", () => {
    const slots = slotsForDay({
      day: "2026-10-19",
      durationMinutes: 60,
      mode: "IN_PERSON",
      locationId: "clinic",
      offeringId: "offering-1",
      rules: [rule({ mode: "IN_PERSON", locationId: "other" })],
      blocks: [],
      now,
    });
    expect(slots).toEqual([]);
  });

  it("drops a time once it has passed and keeps a later booked time", () => {
    const slots = [
      { startsAt: "2026-10-19T09:00:00.000Z", availability: "passed" as const },
      { startsAt: "2026-10-19T10:00:00.000Z", availability: "open" as const },
      { startsAt: "2026-10-19T11:00:00.000Z", availability: "booked" as const },
    ];
    expect(visibleBookingSlots(slots, null).map((slot) => slot.startsAt)).toEqual([
      "2026-10-19T10:00:00.000Z",
      "2026-10-19T11:00:00.000Z",
    ]);
    expect(visibleBookingSlots(slots, Date.parse("2026-10-19T10:00:00.000Z")).map((slot) => slot.startsAt)).toEqual([
      "2026-10-19T11:00:00.000Z",
    ]);
  });

  it("treats overlapping weekly rules as a conflict", () => {
    expect(rulesConflict(rule(), rule({ startMinute: 10 * 60, endMinute: 12 * 60 }))).toBe(true);
    expect(rulesConflict(rule(), rule({ mode: "IN_PERSON", locationId: "clinic" }))).toBe(true);
    expect(rulesConflict(rule(), rule({ startMinute: 11 * 60, endMinute: 13 * 60 }))).toBe(false);
  });
});

describe("appointment transitions", () => {
  const now = new Date("2026-10-19T09:00:00.000Z");
  const startsAt = new Date("2026-10-19T12:00:00.000Z");
  const endsAt = new Date("2026-10-19T13:00:00.000Z");

  it("lets a patient cancel only their own future unpaid or confirmed appointment", () => {
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "PENDING_PAYMENT", to: "CANCELLED_BY_PATIENT", now, startsAt, endsAt, reason: "Cannot attend today" }).ok).toBe(true);
    expect(canTransition({ actor: "patient", ownsRecord: false, from: "PENDING_PAYMENT", to: "CANCELLED_BY_PATIENT", now, startsAt, endsAt, reason: "Cannot attend today" }).ok).toBe(false);
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "COMPLETED", to: "CANCELLED_BY_PATIENT", now, startsAt, endsAt, reason: "Cannot attend today" }).ok).toBe(false);
  });

  it("refuses to confirm an expired hold by changing status", () => {
    const result = canTransition({ actor: "admin", ownsRecord: true, from: "EXPIRED_UNPAID", to: "CONFIRMED", now, startsAt, endsAt });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PAYMENT_HOLD");
  });

  it("rejects a doctor no-show before the appointment starts", () => {
    const result = canTransition({ actor: "doctor", ownsRecord: true, from: "CONFIRMED", to: "NO_SHOW", now, startsAt, endsAt });
    expect(result.ok).toBe(false);
  });

  it("lets a doctor approve a future booking request and lets the patient cancel it", () => {
    const reason = "Patient no longer needs this time";
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "CONFIRMED", now, startsAt, endsAt }).ok).toBe(true);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "CONFIRMED", now: startsAt, startsAt, endsAt }).ok).toBe(false);
    expect(canTransition({ actor: "admin", ownsRecord: false, from: "PENDING_APPROVAL", to: "CONFIRMED", now, startsAt, endsAt }).ok).toBe(true);
    expect(canTransition({ actor: "admin", ownsRecord: false, from: "PENDING_APPROVAL", to: "CONFIRMED", now: startsAt, startsAt, endsAt }).ok).toBe(false);
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "PENDING_APPROVAL", to: "CANCELLED_BY_PATIENT", now, startsAt, endsAt, reason }).ok).toBe(true);
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "PENDING_APPROVAL", to: "RESCHEDULED", now, startsAt, endsAt, reason }).ok).toBe(false);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "CANCELLED_BY_DOCTOR", now, startsAt, endsAt, reason }).ok).toBe(true);
    const after = new Date(startsAt.getTime() + 60_000);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "RESCHEDULED", now: after, startsAt, endsAt, reason: "The requested time has passed" }).ok).toBe(true);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "RESCHEDULED", now, startsAt, endsAt, reason: "The requested time has passed" }).ok).toBe(false);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "CHECKED_IN", now, startsAt, endsAt }).ok).toBe(false);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "CONFIRMED", to: "COMPLETED", now, startsAt, endsAt }).ok).toBe(true);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "PENDING_APPROVAL", to: "COMPLETED", now, startsAt, endsAt }).ok).toBe(false);
    const early = new Date(startsAt.getTime() - 16 * 60_000);
    const ready = new Date(startsAt.getTime() - 14 * 60_000);
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "CONFIRMED", to: "CHECKED_IN", now: early, startsAt, endsAt }).ok).toBe(false);
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "CONFIRMED", to: "CHECKED_IN", now: ready, startsAt, endsAt }).ok).toBe(true);
  });

  it("lets a doctor reschedule a missed visit after the scheduled time and refuses a completed one", () => {
    const after = new Date("2026-10-19T14:00:00.000Z");
    const reason = "The visit time passed before we met";
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "CONFIRMED", to: "RESCHEDULED", now: after, startsAt, endsAt, reason }).ok).toBe(true);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "IN_PROGRESS", to: "RESCHEDULED", now: after, startsAt, endsAt, reason }).ok).toBe(true);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "COMPLETED", to: "RESCHEDULED", now: after, startsAt, endsAt, reason }).ok).toBe(false);
    expect(canTransition({ actor: "doctor", ownsRecord: true, from: "IN_PROGRESS", to: "RESCHEDULED", now, startsAt, endsAt, reason }).ok).toBe(false);
    expect(canTransition({ actor: "patient", ownsRecord: true, from: "CONFIRMED", to: "RESCHEDULED", now: after, startsAt, endsAt, reason }).ok).toBe(false);
  });
});
