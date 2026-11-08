import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { bookScheduledSlot, cancelOwnAppointment, rescheduleAppointment, scheduleAssignedFollowUp } from "./booking";
import { expireOverdueHolds } from "./payment-holds";

const CONCERN = "Tooth pain on the left side since yesterday.";
const OFFERING = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-19T08:00:00.000Z");
const SLOT = new Date("2026-10-19T09:00:00.000Z");

function rule() {
  return {
    dayOfWeek: 1,
    localStartTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
    localEndTime: new Date(Date.UTC(1970, 0, 1, 11, 0, 0)),
    mode: "ONLINE" as const,
    locationId: null,
    offeringId: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
  };
}

function offering(status = "APPROVED", fee?: { amount: string; minor: number; defaultFee: string }) {
  return {
    id: OFFERING,
    isActive: true,
    doctorProfileId: "doctor-1",
    consultationServiceId: "service-1",
    specialtyId: "specialty-1",
    mode: "ONLINE" as const,
    durationMinutes: 60,
    price: new Prisma.Decimal(fee?.amount ?? "2500.00"),
    priceAmountMinor: fee?.minor ?? 250000,
    currency: "SLL",
    validFrom: null,
    validTo: null,
    consultationService: { isActive: true, mode: null, defaultFee: new Prisma.Decimal(fee?.defaultFee ?? "2500.00"), currency: "SLL" },
    specialty: { isActive: true },
    doctor: { verificationStatus: status, user: { status: "ACTIVE", deletedAt: null } },
  };
}

function database(options?: { status?: string; rules?: ReturnType<typeof rule>[]; create?: () => Promise<{ id: string }>; fee?: { amount: string; minor: number; defaultFee: string } }) {
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    patientProfile: { findUnique: async () => ({ id: "profile-actor", archivedAt: null, user: { status: "ACTIVE", deletedAt: null } }) },
    doctorOffering: { findUnique: async () => offering(options?.status, options?.fee) },
    doctorProfile: {
      findUnique: async () => ({ specialties: [{ claimStatus: "VERIFIED", specialty: { isActive: true } }] }),
    },
    doctorAvailabilityRule: { findMany: async () => options?.rules ?? [rule()] },
    doctorTimeOff: { findMany: async () => [] },
    appointment: {
      findMany: async () => [],
      create: options?.create ?? (async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: "appointment-new" };
      }),
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    appointmentEvent: { create: async () => ({}), createMany: async () => ({ count: 1 }) },
    auditLog: { create: async () => ({}) },
    platformSetting: { findUnique: async () => null },
    $queryRaw: async () => [],
  };
  return {
    created,
    db: {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      appointment: { findUnique: async () => null },
    },
  };
}

describe("scheduled booking", () => {
  it("rejects an unapproved doctor and a time that is not on the schedule", async () => {
    const suspended = database({ status: "SUSPENDED" });
    const denied = await bookScheduledSlot({ actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: CONCERN, channel: "VIDEO" }, { db: suspended.db as never, now: NOW, rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }) });
    expect(denied).toEqual({ ok: false, code: "DOCTOR_UNAVAILABLE" });

    const closed = database({ rules: [] });
    const unavailable = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: CONCERN, channel: "VIDEO" },
      { db: closed.db as never, now: NOW, rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }) },
    );
    expect(unavailable).toEqual({ ok: false, code: "SLOT_UNAVAILABLE" });
    const past = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: new Date("2026-10-19T07:00:00.000Z"), concern: CONCERN, channel: "VIDEO" },
      { db: database().db as never, now: NOW, rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }) },
    );
    expect(past).toEqual({ ok: false, code: "PAST" });
  });

  it("holds the signed-in patient's slot until the fee is paid", async () => {
    const store = database();
    const result = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: `  ${CONCERN}  `, channel: "VIDEO" },
      { db: store.db as never, now: NOW, rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }) },
    );
    expect(result.ok).toBe(true);
    expect(store.created[0]).toMatchObject({
      patientProfileId: "profile-actor",
      status: "PENDING_PAYMENT",
      visitChannel: "VIDEO",
      feeAmountMinor: 250000,
      currency: "SLL",
      offeringId: OFFERING,
      paymentHoldExpiresAt: new Date("2026-10-19T08:15:00.000Z"),
      patientConcern: CONCERN,
    });
  });

  it("holds payment at the administrator service price when the doctor fee is zero", async () => {
    const store = database({ fee: { amount: "0", minor: 0, defaultFee: "100.00" } });
    const result = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: CONCERN, channel: "VIDEO" },
      { db: store.db as never, now: NOW, rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }) },
    );
    expect(result.ok).toBe(true);
    expect(store.created[0]).toMatchObject({
      status: "PENDING_PAYMENT",
      feeAmountMinor: 10000,
      currency: "SLL",
    });
  });

  it("does not save a request until the patient describes what is wrong", async () => {
    const store = database();
    const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
    const missing = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: "   ", channel: "VIDEO" },
      { db: store.db as never, now: NOW, rateLimiter: limiter },
    );
    const short = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: "pain", channel: "VIDEO" },
      { db: store.db as never, now: NOW, rateLimiter: limiter },
    );
    expect(missing).toEqual({ ok: false, code: "CONCERN" });
    expect(short).toEqual({ ok: false, code: "CONCERN" });
    expect(store.created).toHaveLength(0);
  });

  it("returns a conflict when the database rejects the overlapping insert", async () => {
    const store = database({
      create: async () => {
        const error = new Error("overlap") as Error & { code: string };
        error.code = "23P01";
        throw error;
      },
    });
    const result = await bookScheduledSlot(
      { actorUserId: "actor-1", offeringId: OFFERING, startsAt: SLOT, concern: CONCERN, channel: "VIDEO" },
      { db: store.db as never, now: NOW, rateLimiter: createRateLimiter({ limit: 10, windowMs: 60_000 }) },
    );
    expect(result).toEqual({ ok: false, code: "SLOT_UNAVAILABLE" });
  });

  it("does not cancel another patient's appointment or a completed visit", async () => {
    let updates = 0;
    const db = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          appointment: {
            findUnique: async () => ({
              id: APPOINTMENT,
              status: "CONFIRMED",
              startsAt: SLOT,
              endsAt: new Date(SLOT.getTime() + 60 * 60_000),
              patient: { userId: "other-patient" },
              doctor: { userId: "doctor-user" },
            }),
            updateMany: async () => {
              updates += 1;
              return { count: 1 };
            },
          },
        }),
    };
    const result = await cancelOwnAppointment(
      { actorUserId: "actor-1", actor: "patient", appointmentId: APPOINTMENT, reason: "I need to cancel this visit" },
      { db: db as never, now: NOW },
    );
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(updates).toBe(0);

    const completed = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          appointment: {
            findUnique: async () => ({
              id: APPOINTMENT,
              status: "COMPLETED",
              startsAt: SLOT,
              endsAt: new Date(SLOT.getTime() + 60 * 60_000),
              offeringId: OFFERING,
              locationId: null,
              mode: "ONLINE",
              patientProfileId: "profile-actor",
              doctorProfileId: "doctor-1",
              specialtyId: "specialty-1",
              consultationServiceId: "service-1",
              patient: { userId: "actor-1" },
              doctor: { userId: "doctor-user" },
            }),
            updateMany: async () => {
              updates += 1;
              return { count: 1 };
            },
          },
        }),
    };
    const rescheduled = await rescheduleAppointment(
      { actorUserId: "actor-1", actor: "patient", appointmentId: APPOINTMENT, startsAt: new Date("2026-10-19T10:00:00.000Z"), reason: "Need a later time today" },
      { db: completed as never, now: NOW },
    );
    expect(rescheduled.ok).toBe(false);
    expect(updates).toBe(0);
  });

  it("moves a missed visit to an open time and refuses a time booked by another patient", async () => {
    const missedStart = new Date("2026-10-18T09:00:00.000Z");
    const nextStart = new Date("2026-10-19T09:00:00.000Z");
    const created: Array<Record<string, unknown>> = [];
    let updates = 0;
    function client(occupied: boolean) {
      const tx = {
        appointment: {
          findUnique: async () => ({
            id: APPOINTMENT,
            status: "IN_PROGRESS",
            startsAt: missedStart,
            endsAt: new Date("2026-10-18T10:00:00.000Z"),
            offeringId: OFFERING,
            locationId: null,
            mode: "ONLINE",
            patientProfileId: "profile-actor",
            doctorProfileId: "doctor-1",
            specialtyId: "specialty-1",
            consultationServiceId: "service-1",
            patient: { userId: "patient-user" },
            doctor: { userId: "doctor-user" },
          }),
          findMany: async () => occupied ? [{ startsAt: nextStart, endsAt: new Date(nextStart.getTime() + 60 * 60_000) }] : [],
          updateMany: async () => {
            updates += 1;
            return { count: 1 };
          },
          create: async (args: { data: Record<string, unknown> }) => {
            created.push(args.data);
            return { id: "appointment-new" };
          },
        },
        doctorOffering: { findUnique: async () => offering() },
        doctorAvailabilityRule: { findMany: async () => [rule()] },
        doctorTimeOff: { findMany: async () => [] },
        appointmentEvent: { createMany: async () => ({ count: 1 }) },
        auditLog: { create: async () => ({}) },
        $queryRaw: async () => [],
      };
      return {
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
        appointment: { findUnique: async () => null },
      };
    }

    const moved = await rescheduleAppointment(
      { actorUserId: "doctor-user", actor: "doctor", appointmentId: APPOINTMENT, startsAt: nextStart, reason: "The visit time passed before we met" },
      { db: client(false) as never, now: NOW },
    );
    expect(moved).toEqual({ ok: true, appointmentId: "appointment-new" });
    expect(created[0]).toMatchObject({
      patientProfileId: "profile-actor",
      status: "CONFIRMED",
      rescheduledFromId: APPOINTMENT,
      startsAt: nextStart,
    });

    updates = 0;
    created.length = 0;
    const taken = await rescheduleAppointment(
      { actorUserId: "doctor-user", actor: "doctor", appointmentId: APPOINTMENT, startsAt: nextStart, reason: "The visit time passed before we met" },
      { db: client(true) as never, now: NOW },
    );
    expect(taken).toEqual({ ok: false, code: "SLOT_UNAVAILABLE" });
    expect(updates).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("expires overdue holds once and does nothing on a second pass", async () => {
    let reads = 0;
    let events = 0;
    const client = {
      $queryRaw: async () => {
        reads += 1;
        return reads === 1 ? [{ id: APPOINTMENT }] : [];
      },
      appointmentEvent: { createMany: async () => { events += 1; return { count: 1 }; } },
    };
    expect(await expireOverdueHolds(client as never)).toEqual([APPOINTMENT]);
    expect(await expireOverdueHolds(client as never)).toEqual([]);
    expect(events).toBe(1);
  });
});

describe("assigned follow-up booking", () => {
  function followUpDb(options?: { ownerId?: string; occupied?: boolean }) {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      appointment: {
        findUnique: async () => ({
          id: APPOINTMENT,
          doctorProfileId: "doctor-1",
          patientProfileId: "patient-1",
          doctor: { userId: options?.ownerId ?? "doctor-user" },
          patient: { archivedAt: null, user: { status: "ACTIVE", deletedAt: null } },
        }),
        findMany: async () =>
          options?.occupied
            ? [{ startsAt: SLOT, endsAt: new Date(SLOT.getTime() + 60 * 60_000) }]
            : [],
        create: async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: "follow-up-1" };
        },
      },
      doctorOffering: { findUnique: async () => offering() },
      doctorProfile: { findUnique: async () => ({ specialties: [{ claimStatus: "VERIFIED", specialty: { isActive: true } }] }) },
      doctorAvailabilityRule: { findMany: async () => [rule()] },
      doctorTimeOff: { findMany: async () => [] },
      location: { findUnique: async () => null },
      appointmentEvent: { create: async () => ({}) },
      auditLog: { create: async () => ({}) },
      platformSetting: { findUnique: async () => null },
      $queryRaw: async () => [],
    };
    return {
      created,
      db: {
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
        appointment: { findUnique: async () => null },
      },
    };
  }

  it("confirms a follow-up linked to the source visit without payment", async () => {
    const { created, db } = followUpDb();
    const result = await scheduleAssignedFollowUp(
      { actorUserId: "doctor-user", sourceAppointmentId: APPOINTMENT, offeringId: OFFERING, startsAt: SLOT },
      { db: db as never, now: NOW },
    );
    expect(result.ok).toBe(true);
    expect(created[0]).toMatchObject({
      status: "CONFIRMED",
      followUpOfId: APPOINTMENT,
      patientProfileId: "patient-1",
      doctorProfileId: "doctor-1",
      paymentHoldExpiresAt: null,
    });
  });

  it("does not book from another doctor's appointment or an occupied slot", async () => {
    const foreign = followUpDb({ ownerId: "someone-else" });
    const denied = await scheduleAssignedFollowUp(
      { actorUserId: "doctor-user", sourceAppointmentId: APPOINTMENT, offeringId: OFFERING, startsAt: SLOT },
      { db: foreign.db as never, now: NOW },
    );
    expect(denied).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(foreign.created).toHaveLength(0);

    const busy = followUpDb({ occupied: true });
    const blocked = await scheduleAssignedFollowUp(
      { actorUserId: "doctor-user", sourceAppointmentId: APPOINTMENT, offeringId: OFFERING, startsAt: SLOT },
      { db: busy.db as never, now: NOW },
    );
    expect(blocked).toEqual({ ok: false, code: "SLOT_UNAVAILABLE" });
    expect(busy.created).toHaveLength(0);
  });
});
