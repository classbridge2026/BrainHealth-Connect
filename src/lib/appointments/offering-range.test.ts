import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { addDays, freetownDate, parseCalendarDate } from "./time";
import { loadOfferingRange } from "./queries";

const offeringId = "fbc9afe0-7668-4807-986d-59d89e1616d5";

describe("loadOfferingRange", () => {
  it("reads the doctor once for the whole two-week window", async () => {
    const now = new Date("2026-11-11T00:01:00.000Z");
    const start = parseCalendarDate(freetownDate(now));
    const days = start ? Array.from({ length: 14 }, (_, index) => addDays(start, index).toISOString().slice(0, 10)) : [];
    const calls = { offering: 0, specialty: 0, rules: 0, timeOff: 0, appointments: 0, expire: 0 };
    const db = {
      doctorOffering: {
        findUnique: async () => {
          calls.offering += 1;
          return {
            id: offeringId,
            isActive: true,
            mode: "ONLINE",
            durationMinutes: 30,
            price: new Prisma.Decimal("50.00"),
            priceAmountMinor: 5000,
            currency: "SLE",
            doctorProfileId: "19e313e0-b4ea-4c97-8ae9-d03a9096dfb1",
            specialtyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            specialty: { name: "Psychiatry", isActive: true },
            consultationService: { name: "Visit", isActive: true, defaultFee: new Prisma.Decimal("50.00"), currency: "SLE" },
            doctor: { verificationStatus: "APPROVED", user: { status: "ACTIVE", deletedAt: null } },
          };
        },
      },
      doctorSpecialty: {
        findFirst: async () => {
          calls.specialty += 1;
          return { claimStatus: "VERIFIED", specialty: { isActive: true } };
        },
      },
      doctorAvailabilityRule: {
        findMany: async () => {
          calls.rules += 1;
          return Array.from({ length: 7 }, (_, index) => ({
            dayOfWeek: index + 1,
            localStartTime: new Date(Date.UTC(1970, 0, 1, 8, 0)),
            localEndTime: new Date(Date.UTC(1970, 0, 1, 9, 0)),
            mode: "ONLINE",
            locationId: null,
            offeringId: null,
            validFrom: null,
            validUntil: null,
            isActive: true,
          }));
        },
      },
      doctorTimeOff: {
        findMany: async () => {
          calls.timeOff += 1;
          return [];
        },
      },
      appointment: {
        findMany: async () => {
          calls.appointments += 1;
          return [];
        },
      },
      $queryRaw: async () => {
        calls.expire += 1;
        return [];
      },
    };

    const result = await loadOfferingRange(db as never, { offeringId, days, now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(14);
    expect(result.days.every((row) => row.slots.length === 2)).toBe(true);
    expect(calls).toEqual({ offering: 1, specialty: 1, rules: 1, timeOff: 1, appointments: 1, expire: 1 });
  });
});
