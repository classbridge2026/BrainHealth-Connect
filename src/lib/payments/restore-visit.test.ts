import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { giveOriginalSlot, releasedVisitChoice } from "./restore-visit";

const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAYMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APPOINTMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-11-03T12:00:00.000Z");
const FUTURE = new Date("2026-11-03T15:00:00.000Z");

describe("released paid visits", () => {
  it("gives the original time back only when it is still free", () => {
    expect(releasedVisitChoice({ startsAt: FUTURE, now: NOW, taken: false })).toBe("restore");
    expect(releasedVisitChoice({ startsAt: FUTURE, now: NOW, taken: true })).toBe("move");
    expect(releasedVisitChoice({ startsAt: new Date("2026-11-03T11:00:00.000Z"), now: NOW, taken: false })).toBe("move");
  });

  it("refuses a doctor and restores a free time without another fee", async () => {
    const writes: string[] = [];
    const db = {
      platformSetting: { findUnique: async () => ({ valueJson: [ADMIN] }) },
      payment: {
        findUnique: async () => ({
          id: PAYMENT,
          status: "REQUIRES_ACTION",
          providerCode: "ORANGE_MONEY",
          appointment: {
            id: APPOINTMENT,
            status: "EXPIRED_UNPAID",
            startsAt: FUTURE,
            endsAt: new Date(FUTURE.getTime() + 30 * 60_000),
            paymentHoldExpiresAt: new Date("2026-11-03T11:00:00.000Z"),
            doctorProfileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          },
        }),
        updateMany: async () => {
          writes.push("paid");
          return { count: 1 };
        },
      },
      appointment: {
        findFirst: async () => null,
        updateMany: async () => {
          writes.push("confirmed");
          return { count: 1 };
        },
      },
      paymentEvent: { create: async () => ({}) },
      appointmentEvent: { create: async () => ({}) },
      auditLog: { create: async () => ({}) },
      $transaction: async (run: (tx: unknown) => Promise<boolean>) => run(db),
    };
    const doctor = await giveOriginalSlot(db as unknown as PrismaClient, { userId: ADMIN, roleCodes: ["DOCTOR"] }, PAYMENT, NOW);
    expect(doctor.ok).toBe(false);
    const restored = await giveOriginalSlot(db as unknown as PrismaClient, { userId: ADMIN, roleCodes: ["ADMIN"] }, PAYMENT, NOW);
    expect(restored.ok).toBe(true);
    expect(writes).toEqual(["confirmed", "paid"]);
  });

  it("asks for another time when the original slot is taken", async () => {
    const db = {
      platformSetting: { findUnique: async () => ({ valueJson: [ADMIN] }) },
      payment: {
        findUnique: async () => ({
          id: PAYMENT,
          status: "REQUIRES_ACTION",
          providerCode: "ORANGE_MONEY",
          appointment: {
            id: APPOINTMENT,
            status: "EXPIRED_UNPAID",
            startsAt: FUTURE,
            endsAt: new Date(FUTURE.getTime() + 30 * 60_000),
            paymentHoldExpiresAt: null,
            doctorProfileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          },
        }),
      },
      appointment: { findFirst: async () => ({ id: "taken" }) },
    };
    const result = await giveOriginalSlot(db as unknown as PrismaClient, { userId: ADMIN, roleCodes: ["ADMIN"] }, PAYMENT, NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("does not pay again");
  });
});
