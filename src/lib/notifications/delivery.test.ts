import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { loadNoticePulse, markAllInAppNotificationsRead, markViewedNotificationsRead, nextRetryAt, notificationKey, reminderChannelAllowed, retryDelayMs, safeInternalHref, saveChannelNotice } from "./delivery";
import { noticeStamp } from "./stamp";

describe("notification delivery tracking", () => {
  it("builds a key from the event, recipient, and channel", () => {
    expect(notificationKey({ type: "appointment.confirmed", channel: "EMAIL", recipientId: "user-1", entityId: "apt-1" })).toBe(
      "appointment.confirmed:EMAIL:user-1:apt-1",
    );
    expect(notificationKey({ type: "appointment.reminder.hour", channel: "SMS", recipientId: "user-1", entityId: "apt-2" })).not.toBe(
      notificationKey({ type: "appointment.reminder.day", channel: "SMS", recipientId: "user-1", entityId: "apt-2" }),
    );
  });

  it("backs off transient failures and stops permanent or exhausted ones", () => {
    expect(retryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(retryDelayMs(2)).toBe(15 * 60 * 1000);
    const now = new Date("2026-10-24T12:00:00.000Z");
    expect(nextRetryAt(1, now, "provider_failed")).not.toBeNull();
    expect(nextRetryAt(3, now, "provider_failed")).toBeNull();
    expect(nextRetryAt(1, now, "not_configured")).toBeNull();
    expect(nextRetryAt(1, now, "suppressed")).toBeNull();
  });

  it("treats a repeated business event as a duplicate and does not store the message body", async () => {
    const notes: Array<Record<string, unknown>> = [];
    const db = {
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (notes.some((row) => row.idempotencyKey === data.idempotencyKey)) {
            const error = new Error("unique") as Error & { code?: string };
            error.code = "P2002";
            throw error;
          }
          notes.push(data);
          return { id: "note-1" };
        },
      },
      notificationAttempt: { create: async () => ({}) },
    };
    const input = {
      recipientId: "user-1",
      channel: "EMAIL" as const,
      type: "appointment.confirmed",
      title: "Confirmed",
      preview: "An appointment is confirmed.",
      entityType: "Appointment",
      entityId: "22222222-2222-4222-8222-222222222222",
      status: "SENT" as const,
    };
    expect(await saveChannelNotice(db as unknown as PrismaClient, input)).toBe("created");
    expect(await saveChannelNotice(db as unknown as PrismaClient, input)).toBe("duplicate");
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes)).not.toMatch(/password|token|diagnosis/i);
  });

  it("keeps reminders when a preference row does not exist and suppresses an opted-out channel", async () => {
    const open = { notificationPreference: { findUnique: async () => null } };
    expect(await reminderChannelAllowed(open as unknown as PrismaClient, "user-1", "SMS")).toBe(true);
    const closed = {
      notificationPreference: { findUnique: async () => ({ emailReminders: false, smsReminders: true }) },
    };
    expect(await reminderChannelAllowed(closed as unknown as PrismaClient, "user-1", "EMAIL")).toBe(false);
    expect(await reminderChannelAllowed(closed as unknown as PrismaClient, "user-1", "SMS")).toBe(true);
  });

  it("only builds internal appointment and profile links", () => {
    expect(safeInternalHref("patient", "Appointment", "22222222-2222-4222-8222-222222222222")).toBe(
      "/patient/appointments/22222222-2222-4222-8222-222222222222",
    );
    expect(safeInternalHref("patient", "Appointment", "https://evil.example")).toBeNull();
    expect(safeInternalHref("admin", "DoctorProfile", "22222222-2222-4222-8222-222222222222")).toBe(
      "/admin/doctors/22222222-2222-4222-8222-222222222222",
    );
    expect(safeInternalHref("admin", "Appointment", "22222222-2222-4222-8222-222222222222")).toBe(
      "/admin/appointments/22222222-2222-4222-8222-222222222222",
    );
    expect(safeInternalHref("admin", "Payment", "22222222-2222-4222-8222-222222222222")).toBe(
      "/admin/payments/22222222-2222-4222-8222-222222222222",
    );
    expect(safeInternalHref("patient", "Payment", "22222222-2222-4222-8222-222222222222")).toBeNull();
  });

  it("marks only the signed-in person's unseen notices", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      notification: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          calls.push({ where, data });
          return { count: where.status && typeof where.status === "object" ? 1 : 0 };
        },
      },
    };
    const id = "22222222-2222-4222-8222-222222222222";
    const result = await markViewedNotificationsRead(db as unknown as PrismaClient, "user-1", [id, id, "not-a-uuid"]);
    expect(result).toEqual({ ok: true, updated: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.where).toMatchObject({ id: { in: [id] }, recipientId: "user-1", readAt: null });
    expect(calls[0]?.data).toMatchObject({ status: "READ" });
    expect(await markViewedNotificationsRead(db as unknown as PrismaClient, "user-1", [])).toEqual({ ok: true, updated: 0 });
  });

  it("marks every unread in-app notice for that person", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      notification: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          calls.push({ where, data });
          return { count: 2 };
        },
      },
    };
    const result = await markAllInAppNotificationsRead(db as unknown as PrismaClient, "user-1");
    expect(result).toEqual({ ok: true, updated: 4 });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.where).toMatchObject({ recipientId: "user-1", channel: "IN_APP", readAt: null });
    expect(calls[0]?.data).toMatchObject({ status: "READ" });
    expect(calls[0]?.where).not.toHaveProperty("id");
  });

  it("stamps a new in-app booking notice so an open portal can see it", async () => {
    const db = {
      $queryRaw: async () => [{
        id: "note-1",
        title: "Booking waiting for approval",
        preview: "A booking is waiting for the doctor to approve it.",
        readAt: null,
        createdAt: new Date("2026-10-29T10:00:00.000Z"),
        entityType: "Appointment",
        entityId: "22222222-2222-4222-8222-222222222222",
        unread: 1,
      }],
    };
    const pulse = await loadNoticePulse(db as unknown as PrismaClient, "doctor-1", "doctor");
    expect(pulse.unread).toBe(1);
    expect(pulse.items[0]?.href).toBe("/doctor/appointments/22222222-2222-4222-8222-222222222222");
    expect(pulse.stamp).toBe(noticeStamp(1, ["note-1"]));
    expect(pulse.stamp).not.toBe(noticeStamp(0, []));
  });
});
