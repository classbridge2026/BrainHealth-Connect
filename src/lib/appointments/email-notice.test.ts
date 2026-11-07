import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { notifyAppointmentParties } from "./email-notice";

describe("appointment email notices", () => {
  it("emails both parties without clinical detail and records a failed send", async () => {
    const notes: Array<Record<string, unknown>> = [];
    const sent: string[] = [];
    const db = {
      appointment: {
        findUnique: async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          startsAt: new Date("2026-10-19T09:00:00.000Z"),
          patient: {
            userId: "patient-user",
            user: { email: "patient@example.com", status: "ACTIVE", deletedAt: null },
          },
          doctor: {
            userId: "doctor-user",
            user: { email: "doctor@example.com", status: "ACTIVE", deletedAt: null },
          },
        }),
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          notes.push(data);
        },
      },
    };
    await notifyAppointmentParties(
      db as unknown as PrismaClient,
      { appointmentId: "22222222-2222-4222-8222-222222222222", event: "confirmed", appBaseUrl: "http://localhost:3000" },
      async ({ to, text }) => {
        sent.push(`${to}:${text}`);
        return { delivered: false, reason: "provider_failed" };
      },
    );
    expect(sent).toHaveLength(2);
    expect(sent.join("\n")).toContain("patient/appointments/");
    expect(sent.join("\n")).toContain("doctor/appointments/");
    expect(sent.join("\n")).not.toMatch(/diagnosis|note|password|token/i);
    expect(notes.filter((row) => row.channel === "EMAIL").every((row) => row.status === "FAILED")).toBe(true);
    expect(notes.some((row) => row.channel === "IN_APP" && row.status === "SENT")).toBe(true);
    expect(notes.some((row) => row.channel === "SMS")).toBe(false);
  });

  it("keeps email when a phone number is stored and does not send a text", async () => {
    const notes: Array<Record<string, unknown>> = [];
    const sent: string[] = [];
    const db = {
      appointment: {
        findUnique: async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          startsAt: new Date("2026-10-19T09:00:00.000Z"),
          patient: {
            userId: "patient-user",
            user: { email: "patient@example.com", phoneE164: "+23276111222", status: "ACTIVE", deletedAt: null },
          },
          doctor: {
            userId: "doctor-user",
            user: { email: "doctor@example.com", phoneE164: "+23276111333", status: "ACTIVE", deletedAt: null },
          },
        }),
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          notes.push(data);
        },
      },
    };
    const previousBase = process.env.APP_BASE_URL;
    const previousHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.APP_BASE_URL = "http://localhost:3000";
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    await notifyAppointmentParties(
      db as unknown as PrismaClient,
      { appointmentId: "22222222-2222-4222-8222-222222222222", event: "cancelled", appBaseUrl: "http://localhost:3000" },
      async ({ to, text }) => {
        sent.push(`${to}:${text}`);
        return { delivered: false, reason: "not_configured" };
      },
    );
    expect(sent).toHaveLength(2);
    expect(sent.join("\n")).toContain("was cancelled");
    expect(sent.join("\n")).toContain("https://brain-health-connect.vercel.app/patient/appointments/22222222-2222-4222-8222-222222222222");
    expect(sent.join("\n")).not.toContain("localhost");
    if (previousBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBase;
    if (previousHost === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = previousHost;
    expect(sent.join("\n")).not.toContain("+23276111222");
    expect(notes.some((row) => row.channel === "SMS")).toBe(false);
    expect(notes.filter((row) => row.channel === "EMAIL").every((row) => row.status === "FAILED" && row.errorCode === "not_configured")).toBe(true);
  });

  it("does not send a second reminder after one was recorded", async () => {
    const sent: string[] = [];
    const db = {
      appointment: {
        findUnique: async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          status: "CONFIRMED",
          startsAt: new Date("2026-10-19T09:00:00.000Z"),
          patient: {
            userId: "patient-user",
            user: { email: "patient@example.com", phoneE164: "+23276111222", status: "ACTIVE", deletedAt: null },
          },
          doctor: {
            userId: "doctor-user",
            user: { email: "doctor@example.com", phoneE164: "+23276111333", status: "ACTIVE", deletedAt: null },
          },
        }),
      },
      notification: {
        findFirst: async () => ({ id: "already" }),
        create: async () => {
          throw new Error("should not record a second reminder");
        },
      },
    };
    await notifyAppointmentParties(
      db as unknown as PrismaClient,
      { appointmentId: "22222222-2222-4222-8222-222222222222", event: "reminder_hour" },
      async ({ to }) => {
        sent.push(to);
        return { delivered: true, reason: "sent" };
      },
    );
    expect(sent).toHaveLength(0);
  });

  it("notifies each administrator when a patient books a doctor", async () => {
    const notes: Array<Record<string, unknown>> = [];
    const sent: string[] = [];
    const db = {
      appointment: {
        findUnique: async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          status: "PENDING_APPROVAL",
          startsAt: new Date("2026-10-19T09:00:00.000Z"),
          patient: {
            userId: "patient-user",
            fullName: "Mohamed Patient",
            user: { email: "patient@example.com", status: "ACTIVE", deletedAt: null },
          },
          doctor: {
            userId: "doctor-user",
            displayName: "Osman",
            fullName: "Osman",
            user: { email: "doctor@example.com", status: "ACTIVE", deletedAt: null },
          },
        }),
      },
      user: {
        findMany: async () => [
          { id: "admin-user", email: "admin@example.com", status: "ACTIVE", deletedAt: null },
          { id: "doctor-user", email: "doctor@example.com", status: "ACTIVE", deletedAt: null },
        ],
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          notes.push(data);
        },
      },
    };
    await notifyAppointmentParties(
      db as unknown as PrismaClient,
      { appointmentId: "22222222-2222-4222-8222-222222222222", event: "requested", appBaseUrl: "http://localhost:3000" },
      async ({ to, text }) => {
        sent.push(`${to}:${text}`);
        return { delivered: true, reason: "sent" };
      },
    );
    expect(sent).toHaveLength(3);
    const adminMail = sent.find((row) => row.startsWith("admin@example.com"));
    expect(adminMail).toContain("Mohamed Patient booked Osman");
    expect(adminMail).toContain("/admin/appointments/22222222-2222-4222-8222-222222222222");
    expect(adminMail).not.toMatch(/diagnosis|note|password|token/i);
    expect(notes.filter((row) => row.recipientId === "admin-user" && row.channel === "IN_APP" && row.status === "SENT")).toHaveLength(1);
    expect(notes.filter((row) => row.recipientId === "doctor-user" && row.channel === "IN_APP")).toHaveLength(1);
  });
});