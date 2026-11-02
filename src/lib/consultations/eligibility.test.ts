import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/appointments/transitions";
import { isReleasedPatientSummary } from "@/lib/patient/portal";
import {
  appointmentStatusAfterDisconnect,
  consultationRoomName,
  joinDecision,
  parseTokenRequest,
  participantIdentity,
  requestOriginAllowed,
  showsOnlineControls,
  type ConsultationActor,
  type ConsultationAppointment,
} from "./eligibility";
import { consultationClientProps } from "./view";

const PATIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APPOINTMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const START = new Date("2026-10-19T10:00:00.000Z");
const END = new Date("2026-10-19T10:30:00.000Z");
const NOW = new Date("2026-10-19T09:50:00.000Z");

function appointment(overrides: Partial<ConsultationAppointment> = {}): ConsultationAppointment {
  return {
    mode: "ONLINE",
    status: "CONFIRMED",
    startsAt: START,
    endsAt: END,
    patientUserId: PATIENT,
    doctorUserId: DOCTOR,
    patientStatus: "ACTIVE",
    doctorStatus: "ACTIVE",
    doctorDeletedAt: null,
    doctorVerificationStatus: "APPROVED",
    paymentStatuses: ["PAID"],
    feeAmountMinor: 5000,
    ...overrides,
  };
}

function actor(overrides: Partial<ConsultationActor> = {}): ConsultationActor {
  return { userId: PATIENT, status: "ACTIVE", roleCodes: ["PATIENT"], ...overrides };
}

function decide(appointmentOverrides: Partial<ConsultationAppointment> = {}, actorOverrides: Partial<ConsultationActor> = {}, now = NOW) {
  return joinDecision({
    actor: actor(actorOverrides),
    appointment: appointment(appointmentOverrides),
    now,
    joinWindowMinutes: 15,
    rejoinGraceMinutes: 30,
  });
}

describe("consultation eligibility", () => {
  it("names the room from the appointment id and keeps the participant identity on the server", () => {
    expect(consultationRoomName(APPOINTMENT)).toBe(`cc-apt-${APPOINTMENT}`);
    expect(consultationRoomName(APPOINTMENT)).not.toMatch(/patient|doctor|@|diagnosis/i);
    expect(participantIdentity(PATIENT)).toBe(`user:${PATIENT}`);
    expect(participantIdentity("not-a-user")).toBeNull();
    expect(showsOnlineControls("IN_PERSON")).toBe(false);
    expect(appointmentStatusAfterDisconnect("IN_PROGRESS")).toBe("IN_PROGRESS");
  });

  it("denies the wrong patient, the wrong doctor, inactive accounts, and non-online visits", () => {
    expect(decide({}, { userId: OTHER })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(decide({}, { userId: DOCTOR, roleCodes: ["DOCTOR"] }, NOW).ok).toBe(true);
    expect(decide({}, { userId: OTHER, roleCodes: ["DOCTOR"] })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(decide({}, { userId: OTHER, roleCodes: ["ADMIN"] })).toEqual({ ok: true, role: "doctor" });
    expect(decide({}, { userId: OTHER, roleCodes: ["SUPER_ADMIN"] }, new Date("2026-10-19T09:00:00.000Z"))).toEqual({ ok: true, role: "doctor" });
    expect(decide({}, { userId: PATIENT, roleCodes: ["PATIENT", "ADMIN"] })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(decide({ mode: "IN_PERSON" })).toEqual({ ok: false, code: "NOT_ONLINE" });
    expect(decide({}, { status: "DISABLED" })).toEqual({ ok: false, code: "INACTIVE" });
    expect(decide({ doctorVerificationStatus: "SUSPENDED" })).toEqual({ ok: false, code: "DOCTOR_UNAVAILABLE" });
  });

  it("denies cancelled, completed, expired, unpaid, and early appointments", () => {
    expect(decide({ status: "CANCELLED_BY_PATIENT" })).toEqual({ ok: false, code: "CANCELLED" });
    expect(decide({ status: "COMPLETED" })).toEqual({ ok: false, code: "COMPLETED" });
    expect(decide({ status: "NO_SHOW" })).toEqual({ ok: false, code: "NO_SHOW" });
    expect(decide({ status: "RESCHEDULED" })).toEqual({ ok: false, code: "RESCHEDULED" });
    expect(decide({ status: "PENDING_PAYMENT", paymentStatuses: ["PENDING"] })).toEqual({ ok: false, code: "PAYMENT" });
    expect(decide({ status: "EXPIRED_UNPAID" })).toEqual({ ok: false, code: "PAYMENT" });
    expect(decide({ paymentStatuses: ["REFUNDED"] })).toEqual({ ok: true, role: "patient" });
    expect(decide({}, {}, new Date("2026-10-19T09:00:00.000Z"))).toEqual({ ok: false, code: "TOO_EARLY" });
    expect(decide({}, { userId: DOCTOR, roleCodes: ["DOCTOR"] }, new Date("2026-10-19T09:00:00.000Z"))).toEqual({ ok: true, role: "doctor" });
    expect(decide({}, {}, new Date("2026-10-19T11:01:00.000Z"))).toEqual({ ok: false, code: "EXPIRED" });
    expect(decide({}, { userId: DOCTOR, roleCodes: ["DOCTOR"] }, new Date("2026-10-19T11:01:00.000Z"))).toEqual({ ok: false, code: "EXPIRED" });
  });

  it("lets the patient answer when the doctor has already started before the appointment time", () => {
    const early = new Date("2026-10-19T08:00:00.000Z");
    expect(decide({}, {}, early)).toEqual({ ok: false, code: "TOO_EARLY" });
    expect(joinDecision({
      actor: actor(),
      appointment: appointment(),
      now: early,
      joinWindowMinutes: 15,
      rejoinGraceMinutes: 30,
      doctorCalling: true,
    })).toEqual({ ok: true, role: "patient" });
  });

  it("issues a join decision for the assigned patient or doctor without starting the visit", () => {
    expect(decide()).toEqual({ ok: true, role: "patient" });
    expect(decide({ paymentStatuses: [], feeAmountMinor: 5000 })).toEqual({ ok: true, role: "patient" });
    expect(decide({ paymentStatuses: [], feeAmountMinor: 0 })).toEqual({ ok: true, role: "patient" });
    expect(decide({ paymentStatuses: ["REQUIRES_ACTION"] }, { userId: DOCTOR, roleCodes: ["DOCTOR"] })).toEqual({ ok: true, role: "doctor" });
    expect(decide({ status: "IN_PROGRESS" }, {}, new Date("2026-10-19T10:45:00.000Z"))).toEqual({ ok: true, role: "patient" });
    expect(decide({ status: "IN_PROGRESS" }, {}, new Date("2026-10-19T11:01:00.000Z"))).toEqual({ ok: false, code: "EXPIRED" });
    expect(appointmentStatusAfterDisconnect("CONFIRMED")).toBe("CONFIRMED");
  });

  it("rejects a browser request for another identity or administrative grants", () => {
    expect(parseTokenRequest({}).ok).toBe(true);
    expect(parseTokenRequest({ audioOnly: true })).toEqual({ ok: true, audioOnly: true });
    expect(parseTokenRequest({ identity: OTHER }).ok).toBe(false);
    expect(parseTokenRequest({ room: "other-room" }).ok).toBe(false);
    expect(parseTokenRequest({ roomAdmin: true }).ok).toBe(false);
    expect(parseTokenRequest({ audioOnly: true, grants: { roomRecord: true } }).ok).toBe(false);
    expect(requestOriginAllowed("https://care.example/api/appointments/1/consultation/token", "https://care.example")).toBe(true);
    expect(requestOriginAllowed("https://care.example/api/appointments/1/consultation/token", "https://evil.example")).toBe(false);
    expect(requestOriginAllowed("https://care.example/api/appointments/1/consultation/token", null)).toBe(false);
  });

  it("keeps in-person check-in on the appointment state machine and hides online controls", () => {
    expect(canTransition({
      actor: "doctor",
      ownsRecord: true,
      from: "CONFIRMED",
      to: "CHECKED_IN",
      now: NOW,
      startsAt: START,
      endsAt: END,
    }).ok).toBe(true);
    expect(canTransition({
      actor: "doctor",
      ownsRecord: true,
      from: "CONFIRMED",
      to: "IN_PROGRESS",
      now: NOW,
      startsAt: START,
      endsAt: END,
    }).ok).toBe(false);
    expect(decide({ mode: "IN_PERSON" })).toEqual({ ok: false, code: "NOT_ONLINE" });
    expect(showsOnlineControls("IN_PERSON")).toBe(false);
  });

  it("keeps private notes and unreleased summaries off the consultation client", () => {
    const props = consultationClientProps({
      appointmentId: APPOINTMENT,
      canJoin: true,
      configured: false,
      counterpart: "Clinician",
      when: "today",
      returnHref: "/patient/appointments/1",
      role: "patient",
      privateNote: "secret working diagnosis",
    });
    expect(JSON.stringify(props)).not.toContain("secret working diagnosis");
    expect(isReleasedPatientSummary({ kind: "PRIVATE_WORKING", summaryReleaseStatus: "RELEASED", archivedAt: null })).toBe(false);
    expect(isReleasedPatientSummary({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "NOT_RELEASED", archivedAt: null })).toBe(false);
    expect(isReleasedPatientSummary({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "RELEASED", archivedAt: null })).toBe(true);
  });
});
