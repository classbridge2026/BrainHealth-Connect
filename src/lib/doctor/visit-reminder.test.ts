import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { nextVisitReminder, visitReminderDue } from "./visit-reminder";

const now = new Date("2026-11-07T10:00:00.000Z");
const doctorId = "19e313e0-b4ea-4c97-8ae9-d03a9096dfb1";

describe("visit reminder", () => {
  it("is due only during the five minutes before the visit starts", () => {
    const startsAt = new Date("2026-11-07T10:05:00.000Z");
    expect(visitReminderDue(startsAt, new Date("2026-11-07T09:59:00.000Z"))).toBe(false);
    expect(visitReminderDue(startsAt, now)).toBe(true);
    expect(visitReminderDue(startsAt, new Date("2026-11-07T10:04:00.000Z"))).toBe(true);
    expect(visitReminderDue(startsAt, startsAt)).toBe(false);
  });

  it("returns the next confirmed visit inside that window", async () => {
    const db = {
      doctorProfile: { findUnique: async () => ({ id: doctorId }) },
      appointment: {
        findFirst: async () => ({
          id: "visit-1",
          startsAt: new Date("2026-11-07T10:04:00.000Z"),
          patient: { fullName: "Mohamed" },
        }),
      },
    } as unknown as PrismaClient;
    await expect(nextVisitReminder(db, "doctor-user", now)).resolves.toEqual({
      id: "visit-1",
      patientName: "Mohamed",
      when: "7 Nov 2026, 10:04 AM",
      href: "/doctor/appointments/visit-1/consultation",
    });
  });

  it("stays quiet when this account has no doctor profile", async () => {
    const db = {
      doctorProfile: { findUnique: async () => null },
      appointment: { findFirst: async () => { throw new Error("must not query visits"); } },
    } as unknown as PrismaClient;
    await expect(nextVisitReminder(db, "admin-user", now)).resolves.toBeNull();
  });
});
