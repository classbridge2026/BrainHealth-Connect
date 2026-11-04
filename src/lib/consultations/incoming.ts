import type { Prisma, PrismaClient } from "@prisma/client";
import { sharedRateLimiter, type RateLimiter } from "@/lib/auth/rate-limit";
import { parseUuid } from "@/lib/catalog/rules";
import { formatBookingWhen } from "@/lib/appointments/time";
import { readLiveKitConfig, type LiveKitConfigResult } from "@/lib/livekit/config";
import { listConsultationParticipants, type RoomParticipant } from "@/lib/livekit/server";
import type { AccessCode } from "./access";
import { listedDoctorCallIds, readDoctorCall } from "./calling";
import { consultationRoomName, joinDecision, participantIdentity, type ConsultationAppointment } from "./eligibility";

const callLimiter = sharedRateLimiter("consultation-call", { limit: 40, windowMs: 60_000 });
const PARTICIPANT_LOOKUP_MS = 12_000;

const callSelect = {
  id: true,
  status: true,
  mode: true,
  startsAt: true,
  endsAt: true,
  patient: { select: { userId: true, user: { select: { status: true } } } },
  doctor: {
    select: {
      userId: true,
      displayName: true,
      verificationStatus: true,
      user: { select: { status: true, deletedAt: true, profileImageUpdatedAt: true } },
    },
  },
  feeAmountMinor: true,
  visitChannel: true,
  payments: { select: { status: true } },
} satisfies Prisma.AppointmentSelect;

type CallRow = Prisma.AppointmentGetPayload<{ select: typeof callSelect }>;

export type IncomingCall = {
  appointmentId: string;
  callId: string;
  channel: "audio" | "video";
  doctorName: string;
  doctorUserId: string;
  doctorImageVersion: string | null;
  when: string;
};

export function callChannel(value: string | null | undefined): "audio" | "video" {
  return value === "AUDIO" ? "audio" : "video";
}

export function incomingCallFromParticipants(input: {
  participants: RoomParticipant[];
  doctorUserId: string;
}): { calling: true; callId: string } | { calling: false } {
  const identity = participantIdentity(input.doctorUserId);
  if (!identity) return { calling: false };
  const doctor = input.participants.find((person) => person.identity === identity && person.sid.trim() !== "");
  if (!doctor) return { calling: false };
  return { calling: true, callId: doctor.sid };
}

function toAppointment(row: CallRow): ConsultationAppointment {
  return {
    mode: row.mode,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    patientUserId: row.patient.userId,
    doctorUserId: row.doctor.userId,
    patientStatus: row.patient.user.status,
    doctorStatus: row.doctor.user.status,
    doctorDeletedAt: row.doctor.user.deletedAt,
    doctorVerificationStatus: row.doctor.verificationStatus,
    paymentStatuses: row.payments.map((payment) => payment.status),
    feeAmountMinor: row.feeAmountMinor,
  };
}

async function callForRow(
  row: CallRow,
  input: { actorUserId: string; actorStatus: string; roleCodes: string[]; now: Date },
  config: LiveKitConfigResult,
  listParticipants: (roomName: string) => Promise<RoomParticipant[]>,
): Promise<IncomingCall | null> {
  if (!config.ok) return null;
  const marked = readDoctorCall(row.id, input.now.getTime());
  const decision = joinDecision({
    actor: { userId: input.actorUserId, status: input.actorStatus, roleCodes: input.roleCodes },
    appointment: toAppointment(row),
    now: input.now,
    joinWindowMinutes: config.config.joinWindowMinutes,
    rejoinGraceMinutes: config.config.rejoinGraceMinutes,
    doctorCalling: marked !== null,
  });
  if (!decision.ok || decision.role !== "patient") return null;
  if (marked) {
    return {
      appointmentId: row.id,
      callId: marked,
      doctorName: row.doctor.displayName,
      doctorUserId: row.doctor.userId,
      channel: callChannel(row.visitChannel),
      doctorImageVersion: row.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
      when: formatBookingWhen(row.startsAt),
    };
  }
  const roomName = consultationRoomName(row.id);
  if (!roomName) return null;
  let participants: RoomParticipant[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    participants = await Promise.race([
      listParticipants(roomName),
      new Promise<RoomParticipant[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PARTICIPANT_LOOKUP_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const found = incomingCallFromParticipants({ participants, doctorUserId: row.doctor.userId });
  if (!found.calling) return null;
  return {
    appointmentId: row.id,
    callId: found.callId,
    doctorName: row.doctor.displayName,
    doctorUserId: row.doctor.userId,
    channel: callChannel(row.visitChannel),
    doctorImageVersion: row.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
    when: formatBookingWhen(row.startsAt),
  };
}

export async function readAppointmentCall(
  db: PrismaClient,
  input: { actorUserId: string; actorStatus: string; roleCodes: string[]; appointmentId: string; now?: Date },
  deps: {
    limiter?: RateLimiter;
    config?: LiveKitConfigResult;
    listParticipants?: (roomName: string) => Promise<RoomParticipant[]>;
    now?: Date;
  } = {},
): Promise<{ ok: true; call: IncomingCall | null } | { ok: false; code: AccessCode }> {
  const now = input.now ?? deps.now ?? new Date();
  if (!parseUuid(input.appointmentId) || !parseUuid(input.actorUserId)) return { ok: false, code: "NOT_FOUND" };
  const limiter = deps.limiter ?? callLimiter;
  if (!limiter.check(`consultation-call:${input.actorUserId}`, now.getTime()).allowed) return { ok: false, code: "RATE_LIMITED" };
  const row = await db.appointment.findUnique({ where: { id: input.appointmentId }, select: callSelect });
  if (!row || row.patient.userId !== input.actorUserId) return { ok: false, code: "NOT_FOUND" };
  const config = deps.config ?? readLiveKitConfig();
  const listParticipants = deps.listParticipants ?? ((roomName: string) => {
    if (!config.ok) return Promise.resolve([]);
    return listConsultationParticipants(config.config, roomName);
  });
  const call = await callForRow(row, { ...input, now }, config, listParticipants);
  return { ok: true, call };
}

export async function listIncomingCalls(
  db: PrismaClient,
  input: { actorUserId: string; actorStatus: string; roleCodes: string[]; now?: Date },
  deps: {
    limiter?: RateLimiter;
    config?: LiveKitConfigResult;
    listParticipants?: (roomName: string) => Promise<RoomParticipant[]>;
    now?: Date;
  } = {},
): Promise<{ ok: true; calls: IncomingCall[] } | { ok: false; code: AccessCode }> {
  const now = input.now ?? deps.now ?? new Date();
  if (!parseUuid(input.actorUserId)) return { ok: false, code: "NOT_FOUND" };
  const limiter = deps.limiter ?? callLimiter;
  if (!limiter.check(`consultation-calls:${input.actorUserId}`, now.getTime()).allowed) return { ok: false, code: "RATE_LIMITED" };
  const patient = await db.patientProfile.findUnique({ where: { userId: input.actorUserId }, select: { id: true } });
  if (!patient) return { ok: true, calls: [] };
  const config = deps.config ?? readLiveKitConfig();
  if (!config.ok) return { ok: true, calls: [] };
  const windowStart = new Date(now.getTime() - config.config.rejoinGraceMinutes * 60_000);
  const windowEnd = new Date(now.getTime() + config.config.joinWindowMinutes * 60_000);
  const callingIds = listedDoctorCallIds(now.getTime());
  const openForCall: Prisma.AppointmentWhereInput[] = [
    {
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      startsAt: { lte: windowEnd },
      endsAt: { gte: windowStart },
    },
    {
      status: "IN_PROGRESS",
      endsAt: { gte: windowStart },
    },
  ];
  if (callingIds.length > 0) {
    openForCall.push({
      id: { in: callingIds },
      status: { in: ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] },
      endsAt: { gte: windowStart },
    });
  }
  const rows = await db.appointment.findMany({
    where: {
      patientProfileId: patient.id,
      mode: "ONLINE",
      OR: openForCall,
    },
    orderBy: { startsAt: "asc" },
    take: 8,
    select: callSelect,
  });
  const listParticipants = deps.listParticipants ?? ((roomName: string) => listConsultationParticipants(config.config, roomName));
  const calls: IncomingCall[] = [];
  for (const row of rows) {
    const call = await callForRow(row, { ...input, now }, config, listParticipants);
    if (call) calls.push(call);
  }
  return { ok: true, calls };
}
