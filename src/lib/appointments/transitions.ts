import { PATIENT_CHECK_IN_MINUTES } from "./channel";

export type AppointmentActor = "patient" | "doctor" | "admin" | "system";

export type TransitionCode =
  | "FORBIDDEN"
  | "UNSUPPORTED"
  | "TOO_LATE"
  | "TOO_EARLY"
  | "REASON"
  | "PAYMENT_HOLD";

const OCCUPYING = new Set(["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"]);

export function canTransition(input: {
  actor: AppointmentActor;
  ownsRecord: boolean;
  from: string;
  to: string;
  now: Date;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}): { ok: true } | { ok: false; code: TransitionCode } {
  if (!input.ownsRecord && input.actor !== "admin" && input.actor !== "system") {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (
    input.from === "PENDING_APPROVAL" &&
    input.to === "CONFIRMED" &&
    ((input.actor === "doctor" && input.ownsRecord) || input.actor === "admin")
  ) {
    if (input.startsAt <= input.now) return { ok: false, code: "TOO_LATE" };
    return { ok: true };
  }
  if (input.from === "EXPIRED_UNPAID" || input.to === "CONFIRMED") {
    return { ok: false, code: "PAYMENT_HOLD" };
  }
  if (input.from === input.to) return { ok: false, code: "UNSUPPORTED" };

  if (input.actor === "system" && input.from === "PENDING_PAYMENT" && input.to === "EXPIRED_UNPAID") {
    return { ok: true };
  }
  if (input.actor === "system") return { ok: false, code: "FORBIDDEN" };

  const reason = (input.reason ?? "").trim();
  const needsReason = input.to.startsWith("CANCELLED") || input.to === "RESCHEDULED";
  if (needsReason && (reason.length < 10 || reason.length > 500)) {
    return { ok: false, code: "REASON" };
  }

  if (input.actor === "patient") {
    if (input.to === "CHECKED_IN" && input.from === "CONFIRMED") {
      const earliest = input.startsAt.getTime() - PATIENT_CHECK_IN_MINUTES * 60_000;
      if (input.now.getTime() < earliest) return { ok: false, code: "TOO_EARLY" };
      if (input.now.getTime() > input.endsAt.getTime()) return { ok: false, code: "TOO_LATE" };
      return { ok: true };
    }
    if (input.to !== "CANCELLED_BY_PATIENT" && input.to !== "RESCHEDULED") return { ok: false, code: "FORBIDDEN" };
    if (input.from !== "PENDING_PAYMENT" && input.from !== "PENDING_APPROVAL" && input.from !== "CONFIRMED") return { ok: false, code: "UNSUPPORTED" };
    if (input.from === "PENDING_APPROVAL" && input.to === "RESCHEDULED") return { ok: false, code: "UNSUPPORTED" };
    if (input.startsAt <= input.now) return { ok: false, code: "TOO_LATE" };
    return { ok: true };
  }

  if (input.actor === "doctor") {
    if (input.to === "CHECKED_IN" && input.from === "CONFIRMED") {
      const earliest = input.startsAt.getTime() - 60 * 60_000;
      if (input.now.getTime() < earliest) return { ok: false, code: "TOO_EARLY" };
      if (input.now.getTime() > input.endsAt.getTime() + 60 * 60_000) return { ok: false, code: "TOO_LATE" };
      return { ok: true };
    }
    if (input.to === "IN_PROGRESS" && input.from === "CHECKED_IN") return { ok: true };
    if (input.to === "COMPLETED" && (input.from === "CONFIRMED" || input.from === "CHECKED_IN" || input.from === "IN_PROGRESS")) {
      return { ok: true };
    }
    if (input.to === "NO_SHOW" && input.from === "CONFIRMED") {
      if (input.now < input.startsAt) return { ok: false, code: "TOO_EARLY" };
      return { ok: true };
    }
    if (input.to === "CANCELLED_BY_DOCTOR" && OCCUPYING.has(input.from) && input.from !== "IN_PROGRESS") {
      return { ok: true };
    }
    if (input.to === "RESCHEDULED" && input.from === "PENDING_APPROVAL" && input.startsAt <= input.now) {
      return { ok: true };
    }
    if (input.to === "RESCHEDULED" && (input.from === "PENDING_PAYMENT" || input.from === "CONFIRMED") && input.startsAt > input.now) {
      return { ok: true };
    }
    if (
      input.to === "RESCHEDULED" &&
      (input.from === "CONFIRMED" || input.from === "CHECKED_IN" || input.from === "IN_PROGRESS") &&
      input.now.getTime() >= input.endsAt.getTime()
    ) {
      return { ok: true };
    }
    return { ok: false, code: "UNSUPPORTED" };
  }

  if (input.actor === "admin" && input.to === "CANCELLED_BY_ADMIN" && OCCUPYING.has(input.from)) {
    return { ok: true };
  }
  if (input.actor === "admin" && input.to === "RESCHEDULED" && (input.from === "PENDING_PAYMENT" || input.from === "CONFIRMED") && input.startsAt > input.now) {
    return { ok: true };
  }
  return { ok: false, code: "FORBIDDEN" };
}
