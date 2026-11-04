import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import type { LiveKitConfigResult } from "@/lib/livekit/config";
import { beginDoctorCall, resetDoctorCallsForTests } from "./calling";
import { phaseMessage } from "./messages";
import { callChannel, incomingCallFromParticipants, listIncomingCalls, readAppointmentCall } from "./incoming";

const PATIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPOINTMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-10-19T09:50:00.000Z");

const configured: LiveKitConfigResult = {
  ok: true,
  config: {
    websocketUrl: "wss://example.livekit.cloud",
    httpHost: "https://example.livekit.cloud",
    apiKey: "api-key",
    apiSecret: "super-secret-value",
    tokenTtlSeconds: 600,
    joinWindowMinutes: 15,
    rejoinGraceMinutes: 30,
  },
};

function row() {
  return {
    id: APPOINTMENT,
    status: "CONFIRMED",
    mode: "ONLINE",
    startsAt: new Date("2026-10-19T10:00:00.000Z"),
    endsAt: new Date("2026-10-19T10:30:00.000Z"),
    patient: { userId: PATIENT, user: { status: "ACTIVE" } },
    doctor: {
      userId: DOCTOR,
      displayName: "Dr. Kamara",
      verificationStatus: "APPROVED",
      user: { status: "ACTIVE", deletedAt: null },
    },
    feeAmountMinor: 5000,
    visitChannel: "VIDEO",
    payments: [{ status: "PAID" }],
  };
}

function database(current = row()) {
  const db = {
    appointment: {
      findUnique: async () => current,
      findMany: async () => [current],
    },
    patientProfile: {
      findUnique: async () => ({ id: "profile-1" }),
    },
  };
  return db as unknown as PrismaClient;
}

describe("incoming consultation calls", () => {
  beforeEach(() => {
    resetDoctorCallsForTests();
  });

  it("rings an audio booking as audio and a video booking as video", () => {
    expect(callChannel("AUDIO")).toBe("audio");
    expect(callChannel("VIDEO")).toBe("video");
    expect(callChannel(null)).toBe("video");
  });

  it("rings only when the assigned doctor is in the room", () => {
    expect(incomingCallFromParticipants({
      participants: [{ sid: "PA_patient", identity: `user:${PATIENT}` }],
      doctorUserId: DOCTOR,
    })).toEqual({ calling: false });
    expect(incomingCallFromParticipants({
      participants: [{ sid: "PA_doctor", identity: `user:${DOCTOR}` }],
      doctorUserId: DOCTOR,
    })).toEqual({ calling: true, callId: "PA_doctor" });
  });

  it("tells an eligible patient they can join", () => {
    expect(phaseMessage("ready", "19 Oct 2026, 10:00 GMT", "patient")).toMatch(/you can join/i);
    expect(phaseMessage("ready", "19 Oct 2026, 10:00 GMT", "doctor")).toMatch(/you can start/i);
    expect(phaseMessage("scheduled", "19 Oct 2026, 10:00 GMT", "patient")).toMatch(/not open yet/i);
  });

  it("returns the doctor's call to the assigned patient", async () => {
    const result = await readAppointmentCall(
      database(),
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], appointmentId: APPOINTMENT, now: NOW },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: NOW,
        listParticipants: async () => [{ sid: "PA_doctor", identity: `user:${DOCTOR}` }],
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.call).toMatchObject({ appointmentId: APPOINTMENT, callId: "PA_doctor", channel: "video", doctorName: "Dr. Kamara" });
    }
  });

  it("rings an audio booking as an audio call", async () => {
    const result = await readAppointmentCall(
      database({ ...row(), visitChannel: "AUDIO" }),
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], appointmentId: APPOINTMENT, now: NOW },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: NOW,
        listParticipants: async () => [{ sid: "PA_doctor", identity: `user:${DOCTOR}` }],
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.call?.channel).toBe("audio");
  });

  it("stays quiet when the doctor has not joined, and hides the room from anyone else", async () => {
    const quiet = await readAppointmentCall(
      database(),
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], appointmentId: APPOINTMENT, now: NOW },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: NOW,
        listParticipants: async () => [],
      },
    );
    expect(quiet).toEqual({ ok: true, call: null });

    const stranger = await readAppointmentCall(
      database(),
      { actorUserId: DOCTOR, actorStatus: "ACTIVE", roleCodes: ["DOCTOR"], appointmentId: APPOINTMENT, now: NOW },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: NOW,
        listParticipants: async () => [{ sid: "PA_doctor", identity: `user:${DOCTOR}` }],
      },
    );
    expect(stranger).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("lists a live call for the patient portal", async () => {
    const result = await listIncomingCalls(
      database(),
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], now: NOW },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: NOW,
        listParticipants: async () => [{ sid: "PA_doctor", identity: `user:${DOCTOR}` }],
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.calls).toHaveLength(1);
  });

  it("rings the patient when the doctor starts before the appointment time", async () => {
    const early = new Date("2026-10-19T08:00:00.000Z");
    beginDoctorCall(APPOINTMENT, early.getTime());
    let where: unknown = null;
    const db = {
      appointment: {
        findUnique: async () => row(),
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [row()];
        },
      },
      patientProfile: { findUnique: async () => ({ id: "profile-1" }) },
    } as unknown as PrismaClient;
    const listed = await listIncomingCalls(
      db,
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], now: early },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: early,
        listParticipants: async () => [],
      },
    );
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.calls).toHaveLength(1);
    expect(JSON.stringify(where)).toContain(APPOINTMENT);

    const direct = await readAppointmentCall(
      database(),
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], appointmentId: APPOINTMENT, now: early },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: early,
        listParticipants: async () => [],
      },
    );
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.call?.appointmentId).toBe(APPOINTMENT);
  });

  it("rings from the doctor's join signal before the room list returns", async () => {
    const callId = beginDoctorCall(APPOINTMENT, NOW.getTime());
    const result = await readAppointmentCall(
      database(),
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], appointmentId: APPOINTMENT, now: NOW },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: NOW,
        listParticipants: async () => {
          throw new Error("slow");
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.call?.callId).toBe(callId);
  });

  it("drops an in-progress visit from the patient call list after the rejoin window", async () => {
    let where: unknown = null;
    const db = {
      appointment: {
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [];
        },
      },
      patientProfile: { findUnique: async () => ({ id: "profile-1" }) },
    } as unknown as PrismaClient;
    const later = new Date("2026-10-26T11:22:00.000Z");
    const result = await listIncomingCalls(
      db,
      { actorUserId: PATIENT, actorStatus: "ACTIVE", roleCodes: ["PATIENT"], now: later },
      {
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
        config: configured,
        now: later,
        listParticipants: async () => [],
      },
    );
    expect(result).toEqual({ ok: true, calls: [] });
    expect(JSON.stringify(where)).toContain("IN_PROGRESS");
  });
});
