import { randomUUID } from "node:crypto";
import { Prisma, type AppointmentStatus, type PrismaClient } from "@prisma/client";
import { createPrivateStorage, type PrivateObjectStorage } from "@/lib/storage/private-storage";

/** Visits that mean the patient has booked this doctor. Unpaid holds and cancellations do not. */
export const CHAT_APPOINTMENT_STATUSES = [
  "PENDING_APPROVAL",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_SHOW",
] as const satisfies readonly AppointmentStatus[];

export const CARE_MESSAGE_MAX = 2000;

export function careMessageError(body: string): string | null {
  const text = body.trim();
  if (!text) return "Write a message before sending.";
  if (text.length > CARE_MESSAGE_MAX) return "Use 2000 characters or fewer.";
  return null;
}

type ChatDb = Pick<PrismaClient, "appointment" | "patientProfile" | "doctorProfile" | "careConversation" | "careMessage" | "user">;

export type ChatSide = "patient" | "doctor" | "admin";

const STAFF_ROLE_CODES = ["ADMIN", "SUPER_ADMIN"] as const;

export type ChatPerson = {
  id: string;
  name: string;
  detail: string;
  preview: string | null;
  when: string | null;
  unread: number;
  imageUserId: string;
  imageVersion: string | null;
  /** Patients cannot write to an administrator. Everyone else can reply. */
  canReply: boolean;
};

export type ChatFile = {
  name: string;
  mime: string;
  size: number;
};

export type ChatLine = {
  id: string;
  body: string;
  at: string;
  mine: boolean;
  readAt: string | null;
  file: ChatFile | null;
};

const FILE_KINDS = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "document",
  "text/plain": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "audio/webm": "voice",
  "audio/mp4": "voice",
  "audio/mpeg": "voice",
  "audio/ogg": "voice",
  "audio/wav": "voice",
  "audio/x-wav": "voice",
} as const;

const FILE_LIMITS = { image: 8 * 1024 * 1024, document: 10 * 1024 * 1024, video: 15 * 1024 * 1024, voice: 4 * 1024 * 1024 } as const;

function fileKind(mime: string) {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return FILE_KINDS[base as keyof typeof FILE_KINDS] ?? null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function cleanChatFileName(name: string) {
  const base = name.split(/[/\\]/).pop()?.replace(/[^\w.\- ()]/g, "").trim() ?? "";
  return (base || "file").slice(0, 180);
}

export function chatStorageKey(conversationId: string, messageId: string) {
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId)) {
    throw new Error("INVALID_STORAGE_KEY");
  }
  return `care-chat/${conversationId}/${messageId}`;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

export function chatFileMime(name: string, mime: string) {
  const declared = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (fileKind(declared)) return declared;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "webm" && /voice/i.test(name)) return "audio/webm";
  return MIME_BY_EXT[ext] ?? declared;
}

export function careFileError(file: { name: string; mime: string; size: number }) {
  const kind = fileKind(chatFileMime(file.name, file.mime));
  if (!kind) return "Use a photo, a PDF or Word document, a video, or a voice message.";
  if (file.size < 1) return "That file is empty.";
  const limit = FILE_LIMITS[kind];
  const label = kind === "voice" ? "Voice messages" : kind === "video" ? "Videos" : kind === "image" ? "Photos" : "Documents";
  if (file.size > limit) return `${label} must be ${Math.round(limit / (1024 * 1024))} MB or smaller.`;
  if (!cleanChatFileName(file.name)) return "That file needs a name.";
  return null;
}

export type ChatThread = {
  conversationId: string | null;
  messages: ChatLine[];
  online: boolean;
  seenAt: string | null;
};

const presenceTouch = new Map<string, number>();

function clearedAtOf(conversation: { patientClearedAt: Date | null; doctorClearedAt: Date | null }, seat: "patient" | "doctor") {
  return seat === "patient" ? conversation.patientClearedAt : conversation.doctorClearedAt;
}

function visibleSince(after: Date | null, clearedAt: Date | null) {
  if (!after) return clearedAt;
  if (!clearedAt) return after;
  return after > clearedAt ? after : clearedAt;
}

function visibleSql(side: "patient" | "doctor") {
  return side === "patient"
    ? Prisma.sql`(c."patientClearedAt" IS NULL OR m."createdAt" > c."patientClearedAt")`
    : Prisma.sql`(c."doctorClearedAt" IS NULL OR m."createdAt" > c."doctorClearedAt")`;
}

function visitDetail(startsAt: Date, now: Date) {
  const when = startsAt.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return startsAt.getTime() >= now.getTime() ? `Next visit ${when}` : `Last visit ${when}`;
}

async function bookedPair(db: ChatDb, patientProfileId: string, doctorProfileId: string) {
  return db.appointment.findFirst({
    where: { patientProfileId, doctorProfileId, status: { in: [...CHAT_APPOINTMENT_STATUSES] } },
    select: { id: true },
  });
}

async function patientIdFor(db: ChatDb, userId: string) {
  const profile = await db.patientProfile.findUnique({ where: { userId }, select: { id: true } });
  return profile?.id ?? null;
}

async function doctorIdFor(db: ChatDb, userId: string) {
  const profile = await db.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  return profile?.id ?? null;
}

type ChatPair = { patientProfileId: string; doctorProfileId: string; seat: "patient" | "doctor" };

const pairCache = new Map<string, ChatPair & { until: number }>();

async function isStaffUser(db: ChatDb, userId: string | null | undefined) {
  if (!userId) return false;
  const row = await db.user.findFirst({
    where: { id: userId, roles: { some: { role: { code: { in: [...STAFF_ROLE_CODES] } } } } },
    select: { id: true },
  });
  return Boolean(row);
}

async function staffUserIds(db: ChatDb, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Set<string>();
  const rows = await db.user.findMany({
    where: { id: { in: ids }, roles: { some: { role: { code: { in: [...STAFF_ROLE_CODES] } } } } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

async function partnerIsStaffDoctor(db: ChatDb, doctorProfileId: string) {
  const doctor = await db.doctorProfile.findUnique({ where: { id: doctorProfileId }, select: { userId: true } });
  return isStaffUser(db, doctor?.userId);
}

async function ensureStaffDoctor(db: ChatDb, userId: string) {
  const existing = await db.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing.id;
  if (!(await isStaffUser(db, userId))) return null;
  const created = await db.doctorProfile.create({
    data: { userId, fullName: "Administrator", displayName: "Administrator", verificationStatus: "DRAFT" },
    select: { id: true },
  });
  return created.id;
}

async function ensureStaffPatient(db: ChatDb, userId: string) {
  const existing = await db.patientProfile.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing.id;
  if (!(await isStaffUser(db, userId))) return null;
  const created = await db.patientProfile.create({
    data: { userId, fullName: "Administrator", gender: "PREFER_NOT_TO_SAY", archivedAt: new Date() },
    select: { id: true },
  });
  return created.id;
}

async function messageablePerson(db: ChatDb, userId: string) {
  return db.user.findFirst({
    where: {
      id: userId,
      status: "ACTIVE",
      deletedAt: null,
      OR: [{ patientProfile: { is: { archivedAt: null } } }, { doctorProfile: { isNot: null } }],
    },
    select: {
      id: true,
      patientProfile: { select: { id: true, archivedAt: true } },
      doctorProfile: { select: { id: true } },
    },
  });
}

async function adminPair(db: ChatDb, adminUserId: string, personUserId: string, create: boolean): Promise<ChatPair | null> {
  if (!personUserId || personUserId === adminUserId) return null;
  if (!(await isStaffUser(db, adminUserId))) return null;
  const person = await messageablePerson(db, personUserId);
  if (!person) return null;
  if (person.patientProfile && !person.patientProfile.archivedAt) {
    const doctorProfileId = create ? await ensureStaffDoctor(db, adminUserId) : await doctorIdFor(db, adminUserId);
    if (!doctorProfileId) return null;
    return { patientProfileId: person.patientProfile.id, doctorProfileId, seat: "doctor" };
  }
  if (person.doctorProfile) {
    const patientProfileId = create ? await ensureStaffPatient(db, adminUserId) : await patientIdFor(db, adminUserId);
    if (!patientProfileId) return null;
    return { patientProfileId, doctorProfileId: person.doctorProfile.id, seat: "patient" };
  }
  return null;
}

export async function resolveChatPair(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string },
  purpose: "read" | "send" = "read",
) {
  const key = `${purpose}:${input.actorUserId}:${input.side}:${input.partnerProfileId}`;
  const cached = pairCache.get(key);
  if (cached && cached.until > Date.now()) {
    return { patientProfileId: cached.patientProfileId, doctorProfileId: cached.doctorProfileId, seat: cached.seat };
  }
  const pair = await lookupChatPair(db, input, purpose);
  if (pair) pairCache.set(key, { ...pair, until: Date.now() + 60_000 });
  return pair;
}

async function lookupChatPair(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string },
  purpose: "read" | "send",
): Promise<ChatPair | null> {
  if (input.side === "admin") return adminPair(db, input.actorUserId, input.partnerProfileId, purpose === "send");
  if (input.side === "patient") {
    const patientProfileId = await patientIdFor(db, input.actorUserId);
    if (!patientProfileId) return null;
    if (await partnerIsStaffDoctor(db, input.partnerProfileId)) {
      if (purpose === "send") return null;
      const existing = await db.careConversation.findUnique({
        where: { patientProfileId_doctorProfileId: { patientProfileId, doctorProfileId: input.partnerProfileId } },
        select: { id: true },
      });
      return existing ? { patientProfileId, doctorProfileId: input.partnerProfileId, seat: "patient" } : null;
    }
    const allowed = await bookedPair(db, patientProfileId, input.partnerProfileId);
    if (!allowed) return null;
    return { patientProfileId, doctorProfileId: input.partnerProfileId, seat: "patient" };
  }
  const doctorProfileId = await doctorIdFor(db, input.actorUserId);
  if (!doctorProfileId) return null;
  const patient = await db.patientProfile.findUnique({
    where: { id: input.partnerProfileId },
    select: { id: true, archivedAt: true, userId: true },
  });
  if (!patient) return null;
  const booked = await bookedPair(db, patient.id, doctorProfileId);
  if (booked) return { patientProfileId: patient.id, doctorProfileId, seat: "doctor" };
  if ((await isStaffUser(db, input.actorUserId)) && !patient.archivedAt) {
    return { patientProfileId: patient.id, doctorProfileId, seat: "doctor" };
  }
  if (await isStaffUser(db, patient.userId)) return { patientProfileId: patient.id, doctorProfileId, seat: "doctor" };
  return null;
}

async function listPatientChatsFast(db: SqlClient, userId: string, now: Date): Promise<ChatPerson[]> {
  const statuses = Prisma.join(CHAT_APPOINTMENT_STATUSES);
  const rows = await db.$queryRaw<Array<{
    id: string;
    name: string;
    specialty: string;
    detailKind: string;
    visitAt: Date | null;
    imageUserId: string;
    imageVersion: Date | null;
    canReply: boolean;
    preview: string | null;
    previewAt: Date | null;
    lastMessageAt: Date | null;
    unread: number;
  }>>(Prisma.sql`
    WITH me AS (
      SELECT id FROM "PatientProfile" WHERE "userId" = ${userId}::uuid
    ),
    visits AS (
      SELECT a."doctorProfileId" AS id,
             MIN(a."startsAt") FILTER (WHERE a."startsAt" >= ${now}::timestamptz) AS next,
             MAX(a."startsAt") AS last
      FROM "Appointment" a
      JOIN me ON me.id = a."patientProfileId"
      WHERE a.status::text IN (${statuses})
      GROUP BY a."doctorProfileId"
    ),
    staff AS (
      SELECT DISTINCT d.id
      FROM "DoctorProfile" d
      JOIN "UserRole" ur ON ur."userId" = d."userId"
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE r.code IN ('ADMIN', 'SUPER_ADMIN')
        AND (
          d.id IN (SELECT id FROM visits)
          OR d.id IN (
            SELECT c."doctorProfileId" FROM "CareConversation" c
            JOIN me ON me.id = c."patientProfileId"
          )
        )
    ),
    people AS (
      SELECT v.id,
             d."displayName" AS name,
             COALESCE((
               SELECT s.name FROM "DoctorSpecialty" ds
               JOIN "Specialty" s ON s.id = ds."specialtyId"
               WHERE ds."doctorProfileId" = d.id AND ds."isPrimary" = true
               LIMIT 1
             ), 'Clinician') AS specialty,
             'visit' AS "detailKind",
             COALESCE(v.next, v.last) AS "visitAt",
             d."userId" AS "imageUserId",
             u."profileImageUpdatedAt" AS "imageVersion",
             TRUE AS "canReply"
      FROM visits v
      JOIN "DoctorProfile" d ON d.id = v.id
      JOIN "User" u ON u.id = d."userId"
      WHERE NOT EXISTS (SELECT 1 FROM staff WHERE staff.id = v.id)
      UNION ALL
      SELECT d.id,
             d."displayName",
             'Administrator',
             'clinic',
             NULL::timestamptz,
             d."userId",
             u."profileImageUpdatedAt",
             FALSE
      FROM staff
      JOIN "DoctorProfile" d ON d.id = staff.id
      JOIN "User" u ON u.id = d."userId"
      JOIN "CareConversation" c ON c."doctorProfileId" = d.id
      JOIN me ON me.id = c."patientProfileId"
    )
    SELECT p.id,
           p.name,
           p.specialty,
           p."detailKind",
           p."visitAt",
           p."imageUserId",
           p."imageVersion",
           p."canReply",
           latest.body AS preview,
           latest."createdAt" AS "previewAt",
           c."lastMessageAt",
           COALESCE((
             SELECT COUNT(*)::int FROM "CareMessage" m
             WHERE m."conversationId" = c.id
               AND m."senderUserId" <> ${userId}::uuid
               AND m."readAt" IS NULL
               AND (c."patientClearedAt" IS NULL OR m."createdAt" > c."patientClearedAt")
           ), 0) AS unread
    FROM people p
    LEFT JOIN "CareConversation" c
      ON c."doctorProfileId" = p.id
     AND c."patientProfileId" = (SELECT id FROM me)
    LEFT JOIN LATERAL (
      SELECT m.body, m."createdAt"
      FROM "CareMessage" m
      WHERE c.id IS NOT NULL
        AND m."conversationId" = c.id
        AND (c."patientClearedAt" IS NULL OR m."createdAt" > c."patientClearedAt")
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) latest ON TRUE
  `);
  return rows
    .map((row) => {
      const when = row.previewAt ?? row.lastMessageAt;
      const detail = row.detailKind === "clinic"
        ? "Messages from the clinic"
        : visitDetail(row.visitAt ?? now, now);
      return {
        id: row.id,
        name: row.name,
        detail: `${row.specialty} · ${detail}`,
        preview: row.preview,
        when: when ? new Date(when).toISOString() : null,
        unread: Number(row.unread) || 0,
        imageUserId: row.imageUserId,
        imageVersion: row.imageVersion ? new Date(row.imageVersion).toISOString() : null,
        canReply: row.canReply !== false,
      };
    })
    .sort((a, b) => (b.when ?? "").localeCompare(a.when ?? "") || a.name.localeCompare(b.name));
}

export async function listPatientChats(db: ChatDb, userId: string, now = new Date()): Promise<ChatPerson[]> {
  const client = sqlClient(db);
  if (client) {
    try {
      return await listPatientChatsFast(client, userId, now);
    } catch {
      // The query path can fail on an older database. The regular list still opens.
    }
  }
  const patientProfileId = await patientIdFor(db, userId);
  if (!patientProfileId) return [];
  const visits = await db.appointment.findMany({
    where: { patientProfileId, status: { in: [...CHAT_APPOINTMENT_STATUSES] } },
    orderBy: { startsAt: "asc" },
    select: {
      doctorProfileId: true,
      startsAt: true,
      doctor: {
        select: {
          id: true,
          displayName: true,
          userId: true,
          user: { select: { profileImageUpdatedAt: true } },
          specialties: { where: { isPrimary: true }, take: 1, select: { specialty: { select: { name: true } } } },
        },
      },
    },
  });
  const doctors = new Map<string, { name: string; specialty: string; imageUserId: string; imageVersion: string | null; next: Date | null; last: Date | null; canReply: boolean }>();
  for (const visit of visits) {
    const current = doctors.get(visit.doctorProfileId);
    const next = visit.startsAt.getTime() >= now.getTime() ? visit.startsAt : current?.next ?? null;
    const last = !current?.last || visit.startsAt > current.last ? visit.startsAt : current.last;
    doctors.set(visit.doctorProfileId, {
      name: visit.doctor.displayName,
      specialty: visit.doctor.specialties[0]?.specialty.name ?? "Clinician",
      imageUserId: visit.doctor.userId,
      imageVersion: visit.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
      next: current?.next ?? next,
      last,
      canReply: true,
    });
  }
  const staff = await staffUserIds(db, [...doctors.values()].map((doctor) => doctor.imageUserId));
  for (const [id, doctor] of doctors) {
    if (staff.has(doctor.imageUserId)) doctors.delete(id);
  }
  const fromStaff = await db.careConversation.findMany({
    where: {
      patientProfileId,
      doctor: { user: { roles: { some: { role: { code: { in: [...STAFF_ROLE_CODES] } } } } } },
    },
    select: {
      doctorProfileId: true,
      doctor: {
        select: {
          displayName: true,
          userId: true,
          user: { select: { profileImageUpdatedAt: true } },
        },
      },
    },
  });
  for (const thread of fromStaff) {
    if (doctors.has(thread.doctorProfileId)) continue;
    doctors.set(thread.doctorProfileId, {
      name: thread.doctor.displayName,
      specialty: "Administrator",
      imageUserId: thread.doctor.userId,
      imageVersion: thread.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
      next: null,
      last: now,
      canReply: false,
    });
  }
  return decorate(db, userId, patientProfileId, [...doctors.entries()].map(([id, doctor]) => ({
    id,
    name: doctor.name,
    detail: doctor.canReply ? visitDetail(doctor.next ?? doctor.last ?? now, now) : "Messages from the clinic",
    specialty: doctor.specialty,
    imageUserId: doctor.imageUserId,
    imageVersion: doctor.imageVersion,
    canReply: doctor.canReply,
  })), "patient");
}

export async function listDoctorChats(db: ChatDb, userId: string, now = new Date()): Promise<ChatPerson[]> {
  const doctorProfileId = await doctorIdFor(db, userId);
  if (!doctorProfileId) return [];
  const visits = await db.appointment.findMany({
    where: { doctorProfileId, status: { in: [...CHAT_APPOINTMENT_STATUSES] } },
    orderBy: { startsAt: "asc" },
    select: {
      patientProfileId: true,
      startsAt: true,
      patient: { select: { id: true, fullName: true, userId: true, user: { select: { profileImageUpdatedAt: true } } } },
    },
  });
  const patients = new Map<string, { name: string; imageUserId: string; imageVersion: string | null; next: Date | null; last: Date | null }>();
  for (const visit of visits) {
    const current = patients.get(visit.patientProfileId);
    const next = visit.startsAt.getTime() >= now.getTime() ? visit.startsAt : current?.next ?? null;
    const last = !current?.last || visit.startsAt > current.last ? visit.startsAt : current.last;
    patients.set(visit.patientProfileId, {
      name: visit.patient.fullName,
      imageUserId: visit.patient.userId,
      imageVersion: visit.patient.user.profileImageUpdatedAt?.toISOString() ?? null,
      next: current?.next ?? next,
      last,
    });
  }
  const fromStaff = await db.careConversation.findMany({
    where: {
      doctorProfileId,
      patient: { user: { roles: { some: { role: { code: { in: [...STAFF_ROLE_CODES] } } } } } },
    },
    select: {
      patientProfileId: true,
      patient: { select: { fullName: true, userId: true, user: { select: { profileImageUpdatedAt: true } } } },
    },
  });
  for (const thread of fromStaff) {
    if (patients.has(thread.patientProfileId)) continue;
    patients.set(thread.patientProfileId, {
      name: thread.patient.fullName,
      imageUserId: thread.patient.userId,
      imageVersion: thread.patient.user.profileImageUpdatedAt?.toISOString() ?? null,
      next: null,
      last: now,
    });
  }
  return decorate(db, userId, doctorProfileId, [...patients.entries()].map(([id, patient]) => ({
    id,
    name: patient.name,
    detail: visitDetail(patient.next ?? patient.last ?? now, now),
    specialty: "Patient",
    imageUserId: patient.imageUserId,
    imageVersion: patient.imageVersion,
  })), "doctor");
}

export async function listAdminChats(db: ChatDb, adminUserId: string): Promise<ChatPerson[]> {
  if (!(await isStaffUser(db, adminUserId))) return [];
  const [users, threads] = await Promise.all([
    db.user.findMany({
      where: {
        id: { not: adminUserId },
        status: "ACTIVE",
        deletedAt: null,
        OR: [{ patientProfile: { is: { archivedAt: null } } }, { doctorProfile: { isNot: null } }],
      },
      select: {
        id: true,
        email: true,
        profileImageUpdatedAt: true,
        patientProfile: { select: { fullName: true, archivedAt: true } },
        doctorProfile: { select: { displayName: true } },
      },
      orderBy: { email: "asc" },
    }),
    db.careConversation.findMany({
      where: { OR: [{ doctor: { userId: adminUserId } }, { patient: { userId: adminUserId } }] },
      select: {
        id: true,
        lastMessageAt: true,
        patientClearedAt: true,
        doctorClearedAt: true,
        patient: { select: { userId: true } },
        doctor: { select: { userId: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true, senderUserId: true, readAt: true } },
      },
    }),
  ]);
  const byUser = new Map(threads.flatMap((thread) => {
    const personId = thread.doctor.userId === adminUserId ? thread.patient.userId : thread.doctor.userId;
    if (!personId || personId === adminUserId) return [];
    return [[personId, thread] as const];
  }));
  return users
    .map((person) => {
      const patientName = person.patientProfile && !person.patientProfile.archivedAt ? person.patientProfile.fullName : null;
      const name = patientName || person.doctorProfile?.displayName || person.email;
      const kind = patientName ? "Patient" : "Doctor";
      const thread = byUser.get(person.id);
      const seat = thread && thread.doctor.userId === adminUserId ? "doctor" : "patient";
      const latest = thread?.messages[0];
      const clearedAt = thread ? clearedAtOf(thread, seat as "patient" | "doctor") : null;
      const visible = latest && (!clearedAt || latest.createdAt > clearedAt) ? latest : null;
      const unread = visible && visible.senderUserId !== adminUserId && !visible.readAt ? 1 : 0;
      return {
        id: person.id,
        name,
        detail: kind,
        preview: visible?.body ?? null,
        when: (visible?.createdAt ?? thread?.lastMessageAt)?.toISOString() ?? null,
        unread,
        imageUserId: person.id,
        imageVersion: person.profileImageUpdatedAt?.toISOString() ?? null,
        canReply: true,
      };
    })
    .sort((a, b) => (b.when ?? "").localeCompare(a.when ?? "") || a.name.localeCompare(b.name));
}

async function decorate(
  db: ChatDb,
  userId: string,
  ownerProfileId: string,
  people: Array<{ id: string; name: string; detail: string; specialty: string; imageUserId: string; imageVersion: string | null; canReply?: boolean }>,
  side: "patient" | "doctor",
): Promise<ChatPerson[]> {
  if (people.length === 0) return [];
  const ids = people.map((person) => person.id);
  const conversations = await db.careConversation.findMany({
    where: side === "patient"
      ? { patientProfileId: ownerProfileId, doctorProfileId: { in: ids } }
      : { doctorProfileId: ownerProfileId, patientProfileId: { in: ids } },
    select: {
      id: true,
      patientProfileId: true,
      doctorProfileId: true,
      lastMessageAt: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
    },
  });
  const cleared = await clearedById(db, conversations.map((row) => row.id));
  const unread = await unreadByConversation(db, userId, side, conversations.map((row) => row.id));
  const byPartner = new Map(conversations.map((row) => [side === "patient" ? row.doctorProfileId : row.patientProfileId, row]));
  return people
    .map((person) => {
      const conversation = byPartner.get(person.id);
      const latest = conversation?.messages[0];
      const stamp = conversation ? cleared.get(conversation.id) : null;
      const clearedAt = stamp ? clearedAtOf(stamp, side) : null;
      const visible = latest && (!clearedAt || latest.createdAt > clearedAt) ? latest : null;
      return {
        id: person.id,
        name: person.name,
        detail: `${person.specialty} · ${person.detail}`,
        preview: visible?.body ?? null,
        when: (visible?.createdAt ?? conversation?.lastMessageAt)?.toISOString() ?? null,
        unread: conversation ? unread.get(conversation.id) ?? 0 : 0,
        imageUserId: person.imageUserId,
        imageVersion: person.imageVersion,
        canReply: person.canReply !== false,
      };
    })
    .sort((a, b) => (b.when ?? "").localeCompare(a.when ?? "") || a.name.localeCompare(b.name));
}

export type ChatUnread = {
  total: number;
  byPartner: Array<{ id: string; unread: number }>;
};

const unreadMemo = new Map<string, { until: number; value: ChatUnread }>();

export async function unreadCareChats(
  db: ChatDb,
  userId: string,
  side: ChatSide,
): Promise<ChatUnread> {
  if (side === "admin") return unreadAdminChats(db, userId);
  const empty: ChatUnread = { total: 0, byPartner: [] };
  const memoKey = `${side}:${userId}`;
  const memo = unreadMemo.get(memoKey);
  if (memo && memo.until > Date.now()) return memo.value;
  const profileId = side === "patient" ? await patientIdFor(db, userId) : await doctorIdFor(db, userId);
  if (!profileId) return empty;
  const client = sqlClient(db);
  if (client) {
    try {
      const rows = await client.$queryRaw<Array<{ id: string; unread: number }>>(side === "patient"
        ? Prisma.sql`
            SELECT c."doctorProfileId" AS id, COUNT(*)::int AS unread
            FROM "CareConversation" c
            JOIN "CareMessage" m ON m."conversationId" = c.id
            WHERE c."patientProfileId" = ${profileId}::uuid
              AND m."senderUserId" <> ${userId}::uuid
              AND m."readAt" IS NULL
              AND (c."patientClearedAt" IS NULL OR m."createdAt" > c."patientClearedAt")
            GROUP BY c."doctorProfileId"
          `
        : Prisma.sql`
            SELECT c."patientProfileId" AS id, COUNT(*)::int AS unread
            FROM "CareConversation" c
            JOIN "CareMessage" m ON m."conversationId" = c.id
            WHERE c."doctorProfileId" = ${profileId}::uuid
              AND m."senderUserId" <> ${userId}::uuid
              AND m."readAt" IS NULL
              AND (c."doctorClearedAt" IS NULL OR m."createdAt" > c."doctorClearedAt")
            GROUP BY c."patientProfileId"
          `);
      const byPartner = rows.filter((row) => row.unread > 0).map((row) => ({ id: row.id, unread: row.unread }));
      const value = { total: byPartner.reduce((sum, row) => sum + row.unread, 0), byPartner };
      unreadMemo.set(memoKey, { until: Date.now() + 30_000, value });
      return value;
    } catch {
      // The Prisma path still works on an older schema.
    }
  }
  const conversations = await db.careConversation.findMany({
    where: side === "patient" ? { patientProfileId: profileId } : { doctorProfileId: profileId },
    select: { id: true, patientProfileId: true, doctorProfileId: true },
  });
  if (conversations.length === 0) return empty;
  const counts = await unreadByConversation(db, userId, side, conversations.map((row) => row.id));
  const byPartner = conversations.flatMap((conversation) => {
    const unread = counts.get(conversation.id) ?? 0;
    if (unread < 1) return [];
    return [{ id: side === "patient" ? conversation.doctorProfileId : conversation.patientProfileId, unread }];
  });
  const value = { total: byPartner.reduce((sum, row) => sum + row.unread, 0), byPartner };
  unreadMemo.set(memoKey, { until: Date.now() + 30_000, value });
  return value;
}

type SqlClient = {
  $queryRaw: PrismaClient["$queryRaw"];
  $executeRaw: PrismaClient["$executeRaw"];
};

async function unreadAdminChats(db: ChatDb, userId: string): Promise<ChatUnread> {
  const empty: ChatUnread = { total: 0, byPartner: [] };
  if (!(await isStaffUser(db, userId))) return empty;
  const conversations = await db.careConversation.findMany({
    where: { OR: [{ doctor: { userId } }, { patient: { userId } }] },
    select: { id: true, patient: { select: { userId: true } }, doctor: { select: { userId: true } } },
  });
  if (conversations.length === 0) return empty;
  const counts = await db.careMessage.groupBy({
    by: ["conversationId"],
    where: { conversationId: { in: conversations.map((row) => row.id) }, senderUserId: { not: userId }, readAt: null },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((row) => [row.conversationId, row._count._all]));
  const byPartner = conversations.flatMap((conversation) => {
    const unread = countOf.get(conversation.id) ?? 0;
    if (unread < 1) return [];
    const id = conversation.doctor.userId === userId ? conversation.patient.userId : conversation.doctor.userId;
    return [{ id, unread }];
  });
  return { total: byPartner.reduce((sum, row) => sum + row.unread, 0), byPartner };
}

async function unreadByConversation(db: ChatDb, userId: string, side: "patient" | "doctor", conversationIds: string[]) {
  const unread = new Map<string, number>();
  if (conversationIds.length === 0) return unread;
  const client = sqlClient(db);
  if (client) {
    try {
      const rows = await client.$queryRaw<Array<{ id: string; unread: number }>>(Prisma.sql`
        SELECT c.id, COUNT(*)::int AS unread
        FROM "CareConversation" c
        JOIN "CareMessage" m ON m."conversationId" = c.id
        WHERE c.id IN (${Prisma.join(conversationIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND m."senderUserId" <> ${userId}::uuid
          AND m."readAt" IS NULL
          AND ${visibleSql(side)}
        GROUP BY c.id
      `);
      for (const row of rows) unread.set(row.id, row.unread);
      return unread;
    } catch {
      // Fall through to the Prisma count.
    }
  }
  const rows = await db.careMessage.groupBy({
    by: ["conversationId"],
    where: { conversationId: { in: conversationIds }, senderUserId: { not: userId }, readAt: null },
    _count: { _all: true },
  });
  for (const row of rows) unread.set(row.conversationId, row._count._all);
  return unread;
}

async function clearedById(db: ChatDb, ids: string[]) {
  const client = sqlClient(db);
  const map = new Map<string, { patientClearedAt: Date | null; doctorClearedAt: Date | null }>();
  if (!client || ids.length === 0) return map;
  try {
    const rows = await client.$queryRaw<Array<{ id: string; patientClearedAt: Date | null; doctorClearedAt: Date | null }>>(Prisma.sql`
      SELECT id, "patientClearedAt", "doctorClearedAt"
      FROM "CareConversation"
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    `);
    for (const row of rows) map.set(row.id, { patientClearedAt: row.patientClearedAt, doctorClearedAt: row.doctorClearedAt });
  } catch {
    return map;
  }
  return map;
}

function sqlClient(db: ChatDb): SqlClient | null {
  const client = db as ChatDb & Partial<SqlClient>;
  if (typeof client.$queryRaw !== "function" || typeof client.$executeRaw !== "function") return null;
  return client as SqlClient;
}

function iso(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function lineOf(message: { id: string; body: string; createdAt: Date; senderUserId: string; readAt: Date | null }, actorUserId: string): ChatLine {
  return {
    id: message.id,
    body: message.body,
    at: message.createdAt.toISOString(),
    mine: message.senderUserId === actorUserId,
    readAt: message.readAt?.toISOString() ?? null,
    file: null,
  };
}

function fileFrom(raw: { fileName?: string | null; fileMime?: string | null; fileSize?: number | string | null }): ChatFile | null {
  if (!raw.fileName || !raw.fileMime || raw.fileSize == null) return null;
  const size = Number(raw.fileSize);
  if (!Number.isFinite(size)) return null;
  return { name: raw.fileName, mime: raw.fileMime, size };
}

async function attachFiles(db: ChatDb, lines: ChatLine[]): Promise<ChatLine[]> {
  const client = sqlClient(db);
  if (!client || lines.length === 0) return lines;
  try {
    const rows = await client.$queryRaw<Array<{ id: string; name: string; mime: string; size: number }>>(Prisma.sql`
      SELECT id, "attachmentName" AS name, "attachmentMime" AS mime, "attachmentSize" AS size
      FROM "CareMessage"
      WHERE id IN (${Prisma.join(lines.map((line) => Prisma.sql`${line.id}::uuid`))})
        AND "attachmentName" IS NOT NULL
    `);
    const byId = new Map(rows.map((row) => [row.id, fileFrom({ fileName: row.name, fileMime: row.mime, fileSize: row.size })]));
    return lines.map((line) => ({ ...line, file: byId.get(line.id) ?? line.file }));
  } catch {
    return lines;
  }
}

/** Records that this person has the conversation open. Skips repeat writes for a few seconds. */
export async function noteChatPresence(db: ChatDb, userId: string) {
  const client = sqlClient(db);
  if (!client) return;
  const now = Date.now();
  if (now - (presenceTouch.get(userId) ?? 0) < 12_000) return;
  presenceTouch.set(userId, now);
  try {
    await client.$executeRaw`UPDATE "User" SET "chatSeenAt" = NOW() WHERE id = ${userId}::uuid`;
  } catch {
    presenceTouch.delete(userId);
  }
}

async function userPresence(db: ChatDb, userId: string): Promise<{ online: boolean; seenAt: string | null }> {
  const client = sqlClient(db);
  if (!client) return { online: false, seenAt: null };
  try {
    const rows = await client.$queryRaw<Array<{ seenAt: Date | null; online: boolean }>>`
      SELECT "chatSeenAt" AS "seenAt", "chatSeenAt" > NOW() - INTERVAL '70 seconds' AS online
      FROM "User" WHERE id = ${userId}::uuid`;
    const row = rows[0];
    return { online: Boolean(row?.online), seenAt: iso(row?.seenAt ?? null) };
  } catch {
    return { online: false, seenAt: null };
  }
}

export async function partnerPresence(
  db: ChatDb,
  side: ChatSide,
  partnerProfileId: string,
): Promise<{ online: boolean; seenAt: string | null }> {
  if (side === "admin") return userPresence(db, partnerProfileId);
  const client = sqlClient(db);
  if (!client) return { online: false, seenAt: null };
  try {
    const rows = side === "patient"
      ? await client.$queryRaw<Array<{ seenAt: Date | null; online: boolean }>>`
          SELECT u."chatSeenAt" AS "seenAt", u."chatSeenAt" > NOW() - INTERVAL '70 seconds' AS online
          FROM "DoctorProfile" d JOIN "User" u ON u.id = d."userId"
          WHERE d.id = ${partnerProfileId}::uuid`
      : await client.$queryRaw<Array<{ seenAt: Date | null; online: boolean }>>`
          SELECT u."chatSeenAt" AS "seenAt", u."chatSeenAt" > NOW() - INTERVAL '70 seconds' AS online
          FROM "PatientProfile" p JOIN "User" u ON u.id = p."userId"
          WHERE p.id = ${partnerProfileId}::uuid`;
    const row = rows[0];
    return { online: Boolean(row?.online), seenAt: iso(row?.seenAt ?? null) };
  } catch {
    return { online: false, seenAt: null };
  }
}

export async function readChatThread(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string },
): Promise<ChatThread | null> {
  const client = sqlClient(db);
  if (client && (input.side === "patient" || input.side === "doctor")) {
    try {
      const fast = await readChatSinceFast(client, { ...input, side: input.side, after: null });
      if (fast.ok) {
        unreadMemo.delete(`${input.side}:${input.actorUserId}`);
        return {
          conversationId: fast.conversationId,
          messages: fast.messages,
          online: fast.online,
          seenAt: fast.seenAt,
        };
      }
    } catch {
      // The query path can fail on an older database. The regular read still opens the thread.
    }
  }
  const pair = await resolveChatPair(db, input, "read");
  if (!pair) {
    if (input.side !== "admin") return null;
    const person = await messageablePerson(db, input.partnerProfileId);
    if (!person || !(await isStaffUser(db, input.actorUserId))) return null;
    return { conversationId: null, messages: [], ...(await userPresence(db, input.partnerProfileId)) };
  }
  const [conversation, presence] = await Promise.all([
    db.careConversation.findUnique({
      where: { patientProfileId_doctorProfileId: { patientProfileId: pair.patientProfileId, doctorProfileId: pair.doctorProfileId } },
      select: { id: true },
    }),
    partnerPresence(db, input.side, input.partnerProfileId),
  ]);
  if (!conversation) return { conversationId: null, messages: [], ...presence };
  const stamp = (await clearedById(db, [conversation.id])).get(conversation.id);
  const clearedAt = stamp ? clearedAtOf(stamp, pair.seat) : null;
  const visible = clearedAt ? { createdAt: { gt: clearedAt } } : {};
  await db.careMessage.updateMany({
    where: { conversationId: conversation.id, senderUserId: { not: input.actorUserId }, readAt: null, ...visible },
    data: { readAt: new Date() },
  });
  const messages = await db.careMessage.findMany({
    where: { conversationId: conversation.id, ...visible },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, body: true, createdAt: true, senderUserId: true, readAt: true },
  });
  return {
    conversationId: conversation.id,
    messages: await attachFiles(db, messages.map((message) => lineOf(message, input.actorUserId))),
    ...presence,
  };
}

function denied(side: ChatSide) {
  if (side === "patient") return "You can message only a doctor you have booked.";
  if (side === "admin") return "That person is not available to message.";
  return "You can reply only to a patient who booked you.";
}

async function sendCareMessageFast(
  db: SqlClient,
  input: { actorUserId: string; side: "patient" | "doctor"; partnerProfileId: string; body: string },
): Promise<{ ok: true; conversationId: string; message: ChatLine } | { ok: false; message: string } | null> {
  const statuses = Prisma.join(CHAT_APPOINTMENT_STATUSES);
  const allowed = input.side === "patient"
    ? Prisma.sql`
        SELECT p.id AS "patientProfileId", ${input.partnerProfileId}::uuid AS "doctorProfileId"
        FROM "PatientProfile" p
        WHERE p."userId" = ${input.actorUserId}::uuid
          AND EXISTS (
            SELECT 1 FROM "Appointment" a
            WHERE a."patientProfileId" = p.id
              AND a."doctorProfileId" = ${input.partnerProfileId}::uuid
              AND a.status::text IN (${statuses})
          )
          AND NOT EXISTS (
            SELECT 1 FROM "DoctorProfile" d
            JOIN "UserRole" ur ON ur."userId" = d."userId"
            JOIN "Role" r ON r.id = ur."roleId"
            WHERE d.id = ${input.partnerProfileId}::uuid
              AND r.code IN ('ADMIN', 'SUPER_ADMIN')
          )`
    : Prisma.sql`
        SELECT ${input.partnerProfileId}::uuid AS "patientProfileId", d.id AS "doctorProfileId"
        FROM "DoctorProfile" d
        WHERE d."userId" = ${input.actorUserId}::uuid
          AND (
            EXISTS (
              SELECT 1 FROM "Appointment" a
              WHERE a."patientProfileId" = ${input.partnerProfileId}::uuid
                AND a."doctorProfileId" = d.id
                AND a.status::text IN (${statuses})
            )
            OR EXISTS (
              SELECT 1 FROM "UserRole" ur
              JOIN "Role" r ON r.id = ur."roleId"
              WHERE ur."userId" = d."userId" AND r.code IN ('ADMIN', 'SUPER_ADMIN')
            )
            OR EXISTS (
              SELECT 1 FROM "PatientProfile" p
              JOIN "UserRole" ur ON ur."userId" = p."userId"
              JOIN "Role" r ON r.id = ur."roleId"
              WHERE p.id = ${input.partnerProfileId}::uuid AND r.code IN ('ADMIN', 'SUPER_ADMIN')
            )
          )`;
  const rows = await db.$queryRaw<Array<{ id: string; body: string; createdAt: Date; conversationId: string }>>(Prisma.sql`
    WITH touch AS (
      UPDATE "User" SET "chatSeenAt" = NOW() WHERE id = ${input.actorUserId}::uuid RETURNING id
    ),
    allowed AS (${allowed}),
    upserted AS (
      INSERT INTO "CareConversation" ("id", "patientProfileId", "doctorProfileId", "lastMessageAt", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), "patientProfileId", "doctorProfileId", NOW(), NOW(), NOW() FROM allowed WHERE EXISTS (SELECT 1 FROM touch)
      ON CONFLICT ("patientProfileId", "doctorProfileId")
      DO UPDATE SET "lastMessageAt" = NOW(), "updatedAt" = NOW()
      RETURNING id
    ),
    inserted AS (
      INSERT INTO "CareMessage" ("id", "conversationId", "senderUserId", "body", "createdAt")
      SELECT gen_random_uuid(), id, ${input.actorUserId}::uuid, ${input.body}, NOW() FROM upserted
      RETURNING id, body, "createdAt", "conversationId"
    )
    SELECT id, body, "createdAt", "conversationId" FROM inserted
  `);
  const row = rows[0];
  if (!row) return { ok: false, message: denied(input.side) };
  const at = iso(row.createdAt);
  if (!at) return null;
  return {
    ok: true,
    conversationId: row.conversationId,
    message: { id: row.id, body: row.body, at, mine: true, readAt: null, file: null },
  };
}

export async function sendCareMessage(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string; body: string },
): Promise<{ ok: true; conversationId: string; message: ChatLine } | { ok: false; message: string }> {
  const textError = careMessageError(input.body);
  if (textError) return { ok: false, message: textError };
  const body = input.body.trim();
  if (input.side === "patient" && await partnerIsStaffDoctor(db, input.partnerProfileId)) {
    return { ok: false, message: "You can't message an administrator." };
  }
  const client = sqlClient(db);
  if (client && (input.side === "patient" || input.side === "doctor")) {
    try {
      const fast = await sendCareMessageFast(client, { ...input, body, side: input.side });
      if (fast) return fast;
    } catch {
      // The query path can fail on an older database. The regular write still sends.
    }
  }
  const pair = await resolveChatPair(db, input, "send");
  if (!pair) return { ok: false, message: denied(input.side) };
  const now = new Date();
  const ids = { patientProfileId: pair.patientProfileId, doctorProfileId: pair.doctorProfileId };
  const conversation = await db.careConversation.upsert({
    where: { patientProfileId_doctorProfileId: ids },
    create: { ...ids, lastMessageAt: now },
    update: { lastMessageAt: now },
    select: { id: true },
  });
  const message = await db.careMessage.create({
    data: { conversationId: conversation.id, senderUserId: input.actorUserId, body },
    select: { id: true, body: true, createdAt: true },
  });
  return {
    ok: true,
    conversationId: conversation.id,
    message: { id: message.id, body: message.body, at: message.createdAt.toISOString(), mine: true, readAt: null, file: null },
  };
}

function asRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function readChatSinceFast(
  db: SqlClient,
  input: { actorUserId: string; side: "patient" | "doctor"; partnerProfileId: string; after: string | null },
) {
  const after = input.after ? new Date(input.after) : null;
  const afterDate = after && !Number.isNaN(after.getTime()) ? after : null;
  const statuses = Prisma.join(CHAT_APPOINTMENT_STATUSES);
  const booked = input.side === "patient"
    ? Prisma.sql`
        SELECT (
          EXISTS (
            SELECT 1 FROM "Appointment" a
            JOIN "PatientProfile" p ON p.id = a."patientProfileId"
            WHERE p."userId" = ${input.actorUserId}::uuid
              AND a."doctorProfileId" = ${input.partnerProfileId}::uuid
              AND a.status::text IN (${statuses})
          )
          OR EXISTS (
            SELECT 1 FROM "CareConversation" c
            JOIN "PatientProfile" p ON p.id = c."patientProfileId"
            JOIN "DoctorProfile" d ON d.id = c."doctorProfileId"
            JOIN "UserRole" ur ON ur."userId" = d."userId"
            JOIN "Role" r ON r.id = ur."roleId"
            WHERE p."userId" = ${input.actorUserId}::uuid
              AND c."doctorProfileId" = ${input.partnerProfileId}::uuid
              AND r.code IN ('ADMIN', 'SUPER_ADMIN')
          )
        ) AS ok`
    : Prisma.sql`
        SELECT (
          EXISTS (
            SELECT 1 FROM "Appointment" a
            JOIN "DoctorProfile" d ON d.id = a."doctorProfileId"
            WHERE d."userId" = ${input.actorUserId}::uuid
              AND a."patientProfileId" = ${input.partnerProfileId}::uuid
              AND a.status::text IN (${statuses})
          )
          OR EXISTS (
            SELECT 1 FROM "UserRole" ur
            JOIN "Role" r ON r.id = ur."roleId"
            WHERE ur."userId" = ${input.actorUserId}::uuid AND r.code IN ('ADMIN', 'SUPER_ADMIN')
          )
          OR EXISTS (
            SELECT 1 FROM "PatientProfile" p
            JOIN "UserRole" ur ON ur."userId" = p."userId"
            JOIN "Role" r ON r.id = ur."roleId"
            WHERE p.id = ${input.partnerProfileId}::uuid AND r.code IN ('ADMIN', 'SUPER_ADMIN')
          )
        ) AS ok`;
  const partner = input.side === "patient"
    ? Prisma.sql`
        SELECT u."chatSeenAt" AS "seenAt", u."chatSeenAt" > NOW() - INTERVAL '70 seconds' AS online
        FROM "DoctorProfile" d JOIN "User" u ON u.id = d."userId"
        WHERE d.id = ${input.partnerProfileId}::uuid`
    : Prisma.sql`
        SELECT u."chatSeenAt" AS "seenAt", u."chatSeenAt" > NOW() - INTERVAL '70 seconds' AS online
        FROM "PatientProfile" p JOIN "User" u ON u.id = p."userId"
        WHERE p.id = ${input.partnerProfileId}::uuid`;
  const thread = input.side === "patient"
    ? Prisma.sql`
        SELECT c.id FROM "CareConversation" c
        JOIN "PatientProfile" p ON p.id = c."patientProfileId"
        WHERE p."userId" = ${input.actorUserId}::uuid AND c."doctorProfileId" = ${input.partnerProfileId}::uuid`
    : Prisma.sql`
        SELECT c.id FROM "CareConversation" c
        JOIN "DoctorProfile" d ON d.id = c."doctorProfileId"
        WHERE d."userId" = ${input.actorUserId}::uuid AND c."patientProfileId" = ${input.partnerProfileId}::uuid`;
  const rows = await db.$queryRaw<Array<{ booked: boolean; conversationId: string | null; messages: unknown; reads: unknown; ids: unknown; online: boolean | null; seenAt: Date | string | null }>>(Prisma.sql`
    WITH touch AS (
      UPDATE "User" SET "chatSeenAt" = NOW() WHERE id = ${input.actorUserId}::uuid RETURNING id
    ),
    booked AS (${booked}),
    partner AS (${partner}),
    thread AS (${thread}),
    marked AS (
      UPDATE "CareMessage" m SET "readAt" = NOW()
      FROM thread t
      JOIN "CareConversation" c ON c.id = t.id
      WHERE m."conversationId" = t.id
        AND m."senderUserId" <> ${input.actorUserId}::uuid
        AND m."readAt" IS NULL
        AND (${afterDate}::timestamptz IS NULL OR m."createdAt" > ${afterDate}::timestamptz)
        AND ${visibleSql(input.side)}
        AND EXISTS (SELECT 1 FROM touch)
      RETURNING m.id
    )
    SELECT
      (SELECT ok FROM booked) AS booked,
      (SELECT id FROM thread) AS "conversationId",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', m.id, 'body', m.body, 'at', m."createdAt", 'mine', (m."senderUserId" = ${input.actorUserId}::uuid), 'readAt', m."readAt",
          'fileName', m."attachmentName", 'fileMime', m."attachmentMime", 'fileSize', m."attachmentSize"
        ) ORDER BY m."createdAt")
        FROM "CareMessage" m
        JOIN thread t ON t.id = m."conversationId"
        JOIN "CareConversation" c ON c.id = t.id
        WHERE (${afterDate}::timestamptz IS NULL OR m."createdAt" > ${afterDate}::timestamptz)
          AND ${visibleSql(input.side)}
      ), '[]'::json) AS messages,
      COALESCE((
        SELECT json_agg(json_build_object('id', m.id, 'readAt', m."readAt"))
        FROM "CareMessage" m
        JOIN thread t ON t.id = m."conversationId"
        JOIN "CareConversation" c ON c.id = t.id
        WHERE m."senderUserId" = ${input.actorUserId}::uuid AND m."readAt" IS NOT NULL AND ${visibleSql(input.side)}
      ), '[]'::json) AS reads,
      COALESCE((
        SELECT json_agg(m.id ORDER BY m."createdAt")
        FROM "CareMessage" m
        JOIN thread t ON t.id = m."conversationId"
        JOIN "CareConversation" c ON c.id = t.id
        WHERE ${visibleSql(input.side)}
      ), '[]'::json) AS ids,
      (SELECT online FROM partner) AS online,
      (SELECT "seenAt" FROM partner) AS "seenAt",
      (SELECT count(*) FROM marked) AS marked
  `);
  const row = rows[0];
  if (row?.booked !== true) return { ok: false as const };
  const messages = asRows<{ id: string; body: string; at: string; mine: boolean; readAt: string | null; fileName?: string | null; fileMime?: string | null; fileSize?: number | null }>(row.messages).flatMap((message) => {
    const at = iso(message.at);
    if (!at) return [];
    return [{ id: message.id, body: message.body, at, mine: Boolean(message.mine), readAt: iso(message.readAt), file: fileFrom(message) }];
  });
  const reads = asRows<{ id: string; readAt: string | null }>(row.reads).flatMap((item) => {
    const readAt = iso(item.readAt);
    return readAt ? [{ id: item.id, readAt }] : [];
  });
  return {
    ok: true as const,
    conversationId: row.conversationId,
    messages,
    reads,
    ids: asRows<string>(row.ids).filter((id) => typeof id === "string"),
    online: Boolean(row.online),
    seenAt: iso(row.seenAt),
  };
}

export async function readChatSince(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string; after: string | null },
): Promise<{ ok: true; conversationId: string | null; messages: ChatLine[]; reads: Array<{ id: string; readAt: string }>; ids: string[]; online: boolean; seenAt: string | null } | { ok: false }> {
  const client = sqlClient(db);
  if (client && (input.side === "patient" || input.side === "doctor")) {
    try {
      return await readChatSinceFast(client, { ...input, side: input.side });
    } catch (error) {
      console.error("chat_sync_failed", error instanceof Error ? error.message : "unknown");
    }
  }
  void noteChatPresence(db, input.actorUserId);
  const pair = await resolveChatPair(db, input, "read");
  if (!pair) {
    if (input.side !== "admin") return { ok: false };
    const person = await messageablePerson(db, input.partnerProfileId);
    if (!person || !(await isStaffUser(db, input.actorUserId))) return { ok: false };
    return { ok: true, conversationId: null, messages: [], reads: [], ids: [], ...(await userPresence(db, input.partnerProfileId)) };
  }
  const [conversation, presence] = await Promise.all([
    db.careConversation.findUnique({
      where: { patientProfileId_doctorProfileId: { patientProfileId: pair.patientProfileId, doctorProfileId: pair.doctorProfileId } },
      select: { id: true },
    }),
    partnerPresence(db, input.side, input.partnerProfileId),
  ]);
  if (!conversation) return { ok: true, conversationId: null, messages: [], reads: [], ids: [], ...presence };
  const after = input.after ? new Date(input.after) : null;
  const stamp = (await clearedById(db, [conversation.id])).get(conversation.id);
  const clearedAt = stamp ? clearedAtOf(stamp, pair.seat) : null;
  const since = visibleSince(after && !Number.isNaN(after.getTime()) ? after : null, clearedAt);
  const visible = since ? { createdAt: { gt: since } } : {};
  const keptWhere = { conversationId: conversation.id, ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}) };
  const messages = await db.careMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...visible,
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, body: true, createdAt: true, senderUserId: true, readAt: true },
  });
  if (messages.some((message) => message.senderUserId !== input.actorUserId)) {
    await db.careMessage.updateMany({
      where: { conversationId: conversation.id, senderUserId: { not: input.actorUserId }, readAt: null, ...visible },
      data: { readAt: new Date() },
    });
  }
  const [receipts, kept] = await Promise.all([
    db.careMessage.findMany({
      where: { ...keptWhere, senderUserId: input.actorUserId, readAt: { not: null } },
      select: { id: true, readAt: true },
      take: 200,
    }),
    db.careMessage.findMany({
      where: keptWhere,
      select: { id: true },
    }),
  ]);
  return {
    ok: true,
    conversationId: conversation.id,
    messages: await attachFiles(db, messages.map((message) => lineOf(message, input.actorUserId))),
    reads: receipts.flatMap((row) => (row.readAt ? [{ id: row.id, readAt: row.readAt.toISOString() }] : [])),
    ids: kept.map((row) => row.id),
    ...presence,
  };
}

export async function sendCareFile(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string; body: string; file: { name: string; mime: string; bytes: Buffer } },
  storage: PrivateObjectStorage = createPrivateStorage(),
): Promise<{ ok: true; conversationId: string; message: ChatLine } | { ok: false; message: string }> {
  const mime = chatFileMime(input.file.name, input.file.mime);
  const fileError = careFileError({ name: input.file.name, mime, size: input.file.bytes.length });
  if (fileError) return { ok: false, message: fileError };
  const caption = input.body.trim();
  if (caption.length > CARE_MESSAGE_MAX) return { ok: false, message: "Use 2000 characters or fewer." };
  if (input.side === "patient" && await partnerIsStaffDoctor(db, input.partnerProfileId)) {
    return { ok: false, message: "You can't message an administrator." };
  }
  const client = sqlClient(db);
  if (!client) return { ok: false, message: "Files cannot be sent right now." };
  const pair = await resolveChatPair(db, input, "send");
  if (!pair) return { ok: false, message: denied(input.side) };
  const name = cleanChatFileName(input.file.name);
  const now = new Date();
  const ids = { patientProfileId: pair.patientProfileId, doctorProfileId: pair.doctorProfileId };
  const conversation = await db.careConversation.upsert({
    where: { patientProfileId_doctorProfileId: ids },
    create: { ...ids, lastMessageAt: now },
    update: { lastMessageAt: now },
    select: { id: true },
  });
  const messageId = randomUUID();
  let key: string | null = null;
  try {
    key = chatStorageKey(conversation.id, messageId);
  } catch {
    key = null;
  }
  if (key && storage.configured) {
    const stored = await storage.put({ key, body: new Uint8Array(input.file.bytes), mimeType: mime });
    if (!stored.ok) {
      console.error("care_chat_storage_put_failed", stored.reason);
      key = null;
    }
  } else {
    key = null;
  }
  try {
    const rows = key
      ? await client.$queryRaw<Array<{ id: string; body: string; createdAt: Date }>>`
          INSERT INTO "CareMessage" ("id", "conversationId", "senderUserId", "body", "createdAt", "attachmentName", "attachmentMime", "attachmentSize", "attachmentKey")
          VALUES (${messageId}::uuid, ${conversation.id}::uuid, ${input.actorUserId}::uuid, ${caption || name}, NOW(), ${name}, ${mime}, ${input.file.bytes.length}, ${key})
          RETURNING id, body, "createdAt"
        `
      : await client.$queryRaw<Array<{ id: string; body: string; createdAt: Date }>>`
          INSERT INTO "CareMessage" ("id", "conversationId", "senderUserId", "body", "createdAt", "attachmentName", "attachmentMime", "attachmentSize", "attachmentBytes")
          VALUES (${messageId}::uuid, ${conversation.id}::uuid, ${input.actorUserId}::uuid, ${caption || name}, NOW(), ${name}, ${mime}, ${input.file.bytes.length}, ${input.file.bytes})
          RETURNING id, body, "createdAt"
        `;
    const row = rows[0];
    const at = row ? iso(row.createdAt) : null;
    if (!row || !at) {
      if (key) await storage.remove(key);
      return { ok: false, message: "The file could not be sent." };
    }
    return {
      ok: true,
      conversationId: conversation.id,
      message: { id: row.id, body: row.body, at, mine: true, readAt: null, file: { name, mime, size: input.file.bytes.length } },
    };
  } catch {
    if (key) await storage.remove(key);
    return { ok: false, message: "The file could not be sent." };
  }
}

export async function deleteCareMessage(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string; messageId: string },
  storage: PrivateObjectStorage = createPrivateStorage(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const pair = await resolveChatPair(db, input);
  if (!pair) return { ok: false, message: denied(input.side) };
  const client = sqlClient(db);
  let key: string | null = null;
  if (client) {
    try {
      const rows = await client.$queryRaw<Array<{ key: string | null }>>`
        SELECT m."attachmentKey" AS key
        FROM "CareMessage" m
        JOIN "CareConversation" c ON c.id = m."conversationId"
        WHERE m.id = ${input.messageId}::uuid
          AND m."senderUserId" = ${input.actorUserId}::uuid
          AND c."patientProfileId" = ${pair.patientProfileId}::uuid
          AND c."doctorProfileId" = ${pair.doctorProfileId}::uuid
      `;
      key = rows[0]?.key ?? null;
    } catch {
      key = null;
    }
  }
  const removed = await db.careMessage.deleteMany({
    where: {
      id: input.messageId,
      senderUserId: input.actorUserId,
      conversation: { patientProfileId: pair.patientProfileId, doctorProfileId: pair.doctorProfileId },
    },
  });
  if (removed.count === 0) return { ok: false, message: "You can delete only a message you sent." };
  if (key) await storage.remove(key);
  return { ok: true };
}

export async function clearCareChat(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const pair = await resolveChatPair(db, input);
  if (!pair) return { ok: false, message: denied(input.side) };
  const conversation = await db.careConversation.findUnique({
    where: { patientProfileId_doctorProfileId: { patientProfileId: pair.patientProfileId, doctorProfileId: pair.doctorProfileId } },
    select: { id: true },
  });
  if (!conversation) return { ok: true };
  const client = sqlClient(db);
  if (!client) return { ok: false, message: "The chat could not be cleared." };
  if (pair.seat === "patient") {
    await client.$executeRaw`UPDATE "CareConversation" SET "patientClearedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${conversation.id}::uuid`;
  } else {
    await client.$executeRaw`UPDATE "CareConversation" SET "doctorClearedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${conversation.id}::uuid`;
  }
  return { ok: true };
}

export async function openChatFile(
  db: ChatDb,
  input: { actorUserId: string; side: ChatSide; partnerProfileId: string; messageId: string },
  storage: PrivateObjectStorage = createPrivateStorage(),
): Promise<{ name: string; mime: string; bytes: Uint8Array } | null> {
  const pair = await resolveChatPair(db, input);
  const client = sqlClient(db);
  if (!pair || !client) return null;
  const rows = await client.$queryRaw<Array<{ name: string; mime: string; key: string | null; bytes: Uint8Array | null }>>`
    SELECT m."attachmentName" AS name, m."attachmentMime" AS mime, m."attachmentKey" AS key, m."attachmentBytes" AS bytes
    FROM "CareMessage" m
    JOIN "CareConversation" c ON c.id = m."conversationId"
    WHERE m.id = ${input.messageId}::uuid
      AND c."patientProfileId" = ${pair.patientProfileId}::uuid
      AND c."doctorProfileId" = ${pair.doctorProfileId}::uuid
      AND m."attachmentName" IS NOT NULL
      AND ${visibleSql(pair.seat)}
  `;
  const row = rows[0];
  if (!row?.name || !row.mime) return null;
  if (row.key) {
    const stored = await storage.read(row.key);
    if (stored.ok) return { name: row.name, mime: row.mime, bytes: stored.body };
  }
  if (!row.bytes) return null;
  return { name: row.name, mime: row.mime, bytes: row.bytes };
}
