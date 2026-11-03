import type { NotificationChannel, PrismaClient } from "@prisma/client";
import { parseUuid } from "@/lib/catalog/rules";
import { formatBookingWhen } from "@/lib/appointments/time";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { noticeStamp } from "./stamp";

export const MAX_DELIVERY_ATTEMPTS = 3;
const PERMANENT_ERRORS = new Set(["not_configured", "invalid_destination", "suppressed"]);

export function notificationKey(input: {
  type: string;
  channel: string;
  recipientId: string;
  entityId?: string | null;
}): string {
  return `${input.type}:${input.channel}:${input.recipientId}:${input.entityId ?? "none"}`;
}

export function retryDelayMs(attemptCount: number): number {
  const step = Math.max(0, attemptCount - 1);
  return Math.min(5 * 60 * 1000 * 3 ** step, 6 * 60 * 60 * 1000);
}

export function nextRetryAt(attemptCount: number, now: Date, errorCode: string | null): Date | null {
  if (!errorCode || PERMANENT_ERRORS.has(errorCode) || attemptCount >= MAX_DELIVERY_ATTEMPTS) return null;
  const jitter = Math.floor(Math.random() * 30_000);
  return new Date(now.getTime() + retryDelayMs(attemptCount) + jitter);
}

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

type SaveInput = {
  recipientId: string;
  channel: NotificationChannel;
  type: string;
  title: string;
  preview: string;
  entityType?: string | null;
  entityId?: string | null;
  status: "QUEUED" | "SENT" | "FAILED" | "SUPPRESSED" | "CANCELLED";
  errorCode?: string | null;
  providerMessageId?: string | null;
  nextRetryAt?: Date | null;
  now?: Date;
};

export async function saveChannelNotice(db: PrismaClient, input: SaveInput): Promise<"created" | "duplicate"> {
  const now = input.now ?? new Date();
  const attemptCount = input.channel === "IN_APP" || input.status === "SUPPRESSED" ? (input.channel === "IN_APP" ? 1 : 0) : 1;
  try {
    const row = await db.notification.create({
      data: {
        recipientId: input.recipientId,
        channel: input.channel,
        type: input.type,
        title: input.title,
        preview: input.preview,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        status: input.status,
        idempotencyKey: notificationKey(input),
        attemptCount,
        nextRetryAt: input.nextRetryAt ?? null,
        providerMessageId: input.providerMessageId ?? null,
        errorCode: input.errorCode ?? null,
      },
      select: { id: true },
    });
    if (input.channel !== "IN_APP" && input.status !== "SUPPRESSED" && "notificationAttempt" in db && db.notificationAttempt) {
      try {
        await db.notificationAttempt.create({
          data: {
            notificationId: row.id,
            attemptNumber: 1,
            status: input.status,
            providerMessageId: input.providerMessageId ?? null,
            errorCode: input.errorCode ?? null,
            attemptedAt: now,
          },
        });
      } catch (error) {
        if (!isSchemaMismatch(error)) throw error;
      }
    }
    return "created";
  } catch (error) {
    if (isUnique(error)) return "duplicate";
    if (!isSchemaMismatch(error)) throw error;
    await db.notification.create({
      data: {
        recipientId: input.recipientId,
        channel: input.channel,
        type: input.type,
        title: input.title,
        preview: input.preview,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        status: input.status === "SUPPRESSED" || input.status === "CANCELLED" ? "FAILED" : input.status,
      },
    });
    return "created";
  }
}

export async function reminderChannelAllowed(
  db: PrismaClient,
  userId: string,
  channel: "EMAIL" | "SMS",
): Promise<boolean> {
  try {
    if (!("notificationPreference" in db) || !db.notificationPreference) return true;
    const pref = await db.notificationPreference.findUnique({
      where: { userId },
      select: { emailReminders: true, smsReminders: true },
    });
    if (!pref) return true;
    return channel === "EMAIL" ? pref.emailReminders : pref.smsReminders;
  } catch (error) {
    if (isSchemaMismatch(error) || error instanceof TypeError) return true;
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NoticeRow = {
  id: string;
  title: string;
  preview: string | null;
  readAt: Date | null;
  createdAt: Date;
  entityType: string | null;
  entityId: string | null;
  unread: number;
};

/** Unread in-app notices and their total, in one database read. */
export async function loadInAppNoticeSummary(db: PrismaClient, userId: string, role: "patient" | "doctor" | "admin") {
  try {
    const rows = await db.$queryRaw<NoticeRow[]>`
      SELECT id::text AS id,
             title,
             preview,
             "readAt",
             "createdAt",
             "entityType",
             "entityId"::text AS "entityId",
             count(*) OVER ()::int AS unread
      FROM "Notification"
      WHERE "recipientId"::text = ${userId}
        AND channel::text = 'IN_APP'
        AND "readAt" IS NULL
        AND status::text <> 'CANCELLED'
      ORDER BY "createdAt" DESC
      LIMIT 8
    `;
    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      preview: row.preview?.replace(/\s+/g, " ").trim().slice(0, 140) || null,
      when: formatBookingWhen(row.createdAt),
      read: row.readAt !== null,
      href: safeInternalHref(role, row.entityType, row.entityId),
    }));
    return { unread: Number(rows[0]?.unread) || 0, items };
  } catch {
    return { unread: 0, items: [] as Array<{ id: string; title: string; preview: string | null; when: string; read: boolean; href: string | null }> };
  }
}

/** The signed-in person's unread in-app notices, with a stamp the open portal can compare. */
export async function loadNoticePulse(db: PrismaClient, userId: string, role: "patient" | "doctor" | "admin") {
  const summary = await loadInAppNoticeSummary(db, userId, role);
  return { unread: summary.unread, items: summary.items, stamp: noticeStamp(summary.unread, summary.items.map((item) => item.id)) };
}

export async function recentInAppNotices(db: PrismaClient, userId: string, role: "patient" | "doctor" | "admin") {
  const summary = await loadInAppNoticeSummary(db, userId, role);
  return summary.items;
}

/** Marks every unread in-app notice for this person. Email and SMS rows stay as they are. */
export async function markAllInAppNotificationsRead(db: PrismaClient, userId: string) {
  try {
    const now = new Date();
    const open = await db.notification.updateMany({
      where: { recipientId: userId, channel: "IN_APP", readAt: null, status: { not: "FAILED" } },
      data: { readAt: now, status: "READ" },
    });
    const failed = await db.notification.updateMany({
      where: { recipientId: userId, channel: "IN_APP", readAt: null, status: "FAILED" },
      data: { readAt: now },
    });
    return { ok: true as const, updated: open.count + failed.count };
  } catch {
    return { ok: false as const, updated: 0 };
  }
}

/** Marks notices the signed-in person has actually seen. Other people's rows are left alone. */
export async function markViewedNotificationsRead(db: PrismaClient, userId: string, ids: string[]) {
  const unique = [...new Set(ids.flatMap((id) => {
    const parsed = typeof id === "string" ? parseUuid(id) : null;
    return parsed ? [parsed] : [];
  }))].slice(0, 50);
  if (unique.length === 0) return { ok: true as const, updated: 0 };
  try {
    const now = new Date();
    const open = await db.notification.updateMany({
      where: { id: { in: unique }, recipientId: userId, readAt: null, status: { not: "FAILED" } },
      data: { readAt: now, status: "READ" },
    });
    const failed = await db.notification.updateMany({
      where: { id: { in: unique }, recipientId: userId, readAt: null, status: "FAILED" },
      data: { readAt: now },
    });
    return { ok: true as const, updated: open.count + failed.count };
  } catch {
    return { ok: false as const, updated: 0 };
  }
}

export async function loadReminderPreference(db: PrismaClient, userId: string) {
  try {
    const row = await db.notificationPreference.findUnique({
      where: { userId },
      select: { emailReminders: true, smsReminders: true },
    });
    return { emailReminders: row?.emailReminders ?? true, smsReminders: row?.smsReminders ?? true, available: true };
  } catch (error) {
    if (isSchemaMismatch(error)) return { emailReminders: true, smsReminders: true, available: false };
    throw error;
  }
}

export async function saveReminderPreference(
  db: PrismaClient,
  userId: string,
  input: { emailReminders: boolean },
) {
  try {
    await db.notificationPreference.upsert({
      where: { userId },
      create: { userId, emailReminders: input.emailReminders },
      update: { emailReminders: input.emailReminders },
    });
    return { ok: true as const, message: "Reminder preferences were saved. Security messages still send." };
  } catch (error) {
    if (isSchemaMismatch(error)) return { ok: false as const, message: "Reminder preferences are not available until the notification migration is applied." };
    return { ok: false as const, message: "Reminder preferences could not be saved." };
  }
}

export function safeInternalHref(role: "patient" | "doctor" | "admin", entityType: string | null, entityId: string | null): string | null {
  if (!entityId || !UUID.test(entityId)) return null;
  if (entityType === "Appointment") {
    if (role === "patient") return `/patient/appointments/${entityId}`;
    if (role === "doctor") return `/doctor/appointments/${entityId}`;
    return `/admin/appointments/${entityId}`;
  }
  if (role === "admin" && entityType === "DoctorProfile") return `/admin/doctors/${entityId}`;
  if (role === "admin" && entityType === "Payment") return `/admin/payments/${entityId}`;
  return null;
}
