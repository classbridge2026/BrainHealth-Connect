import { z } from "zod";
import { PATIENT_ROLE_CODE, DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { parseUuid } from "@/lib/catalog/rules";
import { clinicianMayDocument } from "@/lib/clinical/rules";
import { adminVerifiedPayment } from "@/lib/payments/verifiers";

/**
 * Consultation rooms are named from the appointment id only.
 * Appointment status stays the booking source of truth, so this module does not
 * introduce a second status machine. Reconnecting is a LiveKit client state.
 * A temporary disconnect must keep the stored appointment status.
 */
export const ROOM_PREFIX = "cc-apt-";
export const DEFAULT_REJOIN_GRACE_MINUTES = 30;

const JOINABLE = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"]);

export const tokenRequestSchema = z.object({
  audioOnly: z.boolean().optional(),
}).strict();

export type JoinCode =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_ONLINE"
  | "PAYMENT"
  | "AWAITING_APPROVAL"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW"
  | "RESCHEDULED"
  | "EXPIRED"
  | "TOO_EARLY"
  | "DOCTOR_UNAVAILABLE"
  | "UNSUPPORTED";

export type ConsultationPhase =
  | "not_available"
  | "scheduled"
  | "ready"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "expired"
  | "waiting_payment"
  | "in_person";

export type ConsultationActor = {
  userId: string;
  status: string;
  roleCodes: string[];
};

export type ConsultationAppointment = {
  mode: "ONLINE" | "IN_PERSON";
  status: string;
  startsAt: Date;
  endsAt: Date;
  patientUserId: string;
  doctorUserId: string;
  patientStatus: string;
  doctorStatus: string;
  doctorDeletedAt: Date | null;
  doctorVerificationStatus: string;
  paymentStatuses: string[];
  feeAmountMinor: number;
};

export function consultationRoomName(appointmentId: string): string | null {
  const id = parseUuid(appointmentId);
  if (!id) return null;
  return `${ROOM_PREFIX}${id}`;
}

export function participantIdentity(userId: string): string | null {
  const id = parseUuid(userId);
  if (!id) return null;
  return `user:${id}`;
}

export function showsOnlineControls(mode: string): boolean {
  return mode === "ONLINE";
}

export function appointmentStatusAfterDisconnect(status: string): string {
  return status;
}

export function paymentAllowsConsultation(status: string, paymentStatuses: string[], feeAmountMinor: number): boolean {
  if (status === "PENDING_PAYMENT" || status === "EXPIRED_UNPAID") return false;
  if (!JOINABLE.has(status)) return false;
  return adminVerifiedPayment(feeAmountMinor, paymentStatuses);
}

export function joinDecision(input: {
  actor: ConsultationActor;
  appointment: ConsultationAppointment;
  now: Date;
  joinWindowMinutes: number;
  rejoinGraceMinutes: number;
  /** Set when the assigned doctor has already started the call, so the patient can answer early. */
  doctorCalling?: boolean;
}): { ok: true; role: "patient" | "doctor" } | { ok: false; code: JoinCode } {
  const isPatient = input.appointment.patientUserId === input.actor.userId;
  const isDoctor = input.appointment.doctorUserId === input.actor.userId;
  const isAdministrator =
    input.actor.roleCodes.includes(ADMIN_ROLE_CODE) || input.actor.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
  if (isPatient && (isDoctor || isAdministrator)) return { ok: false, code: "NOT_FOUND" };
  if (!isPatient && !isDoctor && !isAdministrator) return { ok: false, code: "NOT_FOUND" };
  const role = isPatient ? "patient" : "doctor";
  if (role === "patient" && !input.actor.roleCodes.includes(PATIENT_ROLE_CODE)) return { ok: false, code: "NOT_FOUND" };
  if (role === "doctor" && !input.actor.roleCodes.includes(DOCTOR_ROLE_CODE) && !isAdministrator) return { ok: false, code: "NOT_FOUND" };

  const actorStatus = role === "patient" ? input.appointment.patientStatus : input.appointment.doctorStatus;
  if (input.actor.status !== "ACTIVE" || actorStatus !== "ACTIVE") return { ok: false, code: "INACTIVE" };

  if (
    !clinicianMayDocument({
      verificationStatus: input.appointment.doctorVerificationStatus,
      userStatus: input.appointment.doctorStatus,
      deletedAt: input.appointment.doctorDeletedAt,
    })
  ) {
    return { ok: false, code: "DOCTOR_UNAVAILABLE" };
  }

  if (input.appointment.mode !== "ONLINE") return { ok: false, code: "NOT_ONLINE" };

  const status = input.appointment.status;
  if (status === "PENDING_PAYMENT" || status === "EXPIRED_UNPAID") return { ok: false, code: "PAYMENT" };
  if (status === "PENDING_APPROVAL") return { ok: false, code: "AWAITING_APPROVAL" };
  if (status.startsWith("CANCELLED")) return { ok: false, code: "CANCELLED" };
  if (status === "COMPLETED") return { ok: false, code: "COMPLETED" };
  if (status === "NO_SHOW") return { ok: false, code: "NO_SHOW" };
  if (status === "RESCHEDULED") return { ok: false, code: "RESCHEDULED" };
  if (!JOINABLE.has(status)) return { ok: false, code: "UNSUPPORTED" };

  const closesAt = input.appointment.endsAt.getTime() + input.rejoinGraceMinutes * 60_000;
  if (input.now.getTime() > closesAt) return { ok: false, code: "EXPIRED" };
  if (!paymentAllowsConsultation(status, input.appointment.paymentStatuses, input.appointment.feeAmountMinor)) return { ok: false, code: "PAYMENT" };
  const opensAt = input.appointment.startsAt.getTime() - input.joinWindowMinutes * 60_000;
  // The doctor can start the call before the appointment time. The patient stays closed until the
  // join window, unless the doctor has already started and the patient is answering that call.
  if (input.now.getTime() < opensAt && role !== "doctor" && !input.doctorCalling) return { ok: false, code: "TOO_EARLY" };
  return { ok: true, role };
}

export function consultationPhase(input: {
  mode: string;
  status: string;
  decision: { ok: true } | { ok: false; code: JoinCode };
}): ConsultationPhase {
  if (input.mode !== "ONLINE") return "in_person";
  if (input.decision.ok && input.status === "IN_PROGRESS") return "in_progress";
  if (input.decision.ok) return "ready";
  switch (input.decision.code) {
    case "TOO_EARLY":
      return "scheduled";
    case "PAYMENT":
      return "waiting_payment";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
    case "RESCHEDULED":
      return "cancelled";
    case "EXPIRED":
    case "NO_SHOW":
      return "expired";
    default:
      return "not_available";
  }
}

export function parseTokenRequest(body: unknown): { ok: true; audioOnly: boolean } | { ok: false } {
  const parsed = tokenRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, audioOnly: parsed.data.audioOnly === true };
}

export function requestOriginAllowed(requestUrl: string, origin: string | null): boolean {
  if (!origin) return false;
  try {
    return origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
