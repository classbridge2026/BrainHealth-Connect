import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAdminPayment, deleteAdminPayment, parsePaymentRecordStatus } from "./admin-records";

const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPOINTMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PATIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAYMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function database(status = "REQUIRES_ACTION") {
  const writes: string[] = [];
  const db = {
    platformSetting: { findUnique: async () => ({ valueJson: [ADMIN] }) },
    appointment: {
      findUnique: async () => ({ id: APPOINTMENT, feeAmountMinor: 10000, currency: "SLL", patient: { userId: PATIENT } }),
      findMany: async () => [],
    },
    payment: {
      findFirst: async () => null,
      findUnique: async () => ({ id: PAYMENT, status, appointmentId: APPOINTMENT }),
      create: async ({ data }: { data: { amountMinor: number; payerUserId: string; status: string } }) => {
        writes.push(`create:${data.amountMinor}:${data.payerUserId}:${data.status}`);
        return { id: PAYMENT };
      },
      update: async () => {
        writes.push("update");
        return {};
      },
      delete: async () => {
        writes.push("delete");
        return {};
      },
    },
    paymentEvent: {
      deleteMany: async () => {
        writes.push("events");
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (run: (tx: unknown) => Promise<void>) => run(db),
  };
  return { db: db as unknown as PrismaClient, writes };
}

describe("admin payment records", () => {
  it("accepts the statuses an administrator can record", () => {
    expect(parsePaymentRecordStatus("PAID")).toBe("PAID");
    expect(parsePaymentRecordStatus("REFUNDED")).toBeNull();
  });

  it("refuses a doctor and an administrator who was not selected", async () => {
    const { db } = database();
    const input = { appointmentId: APPOINTMENT, provider: "ORANGE_MONEY", reference: "PP250502.1502.B91020", status: "REQUIRES_ACTION" };
    expect((await createAdminPayment(db, { userId: ADMIN, roleCodes: ["DOCTOR"] }, input)).ok).toBe(false);
    expect((await createAdminPayment(db, { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", roleCodes: ["ADMIN"] }, input)).ok).toBe(false);
  });

  it("records the visit fee for a selected administrator", async () => {
    const { db, writes } = database();
    const result = await createAdminPayment(db, { userId: ADMIN, roleCodes: ["ADMIN"] }, {
      appointmentId: APPOINTMENT,
      provider: "ORANGE_MONEY",
      reference: "PP250502.1502.B91020",
      status: "REQUIRES_ACTION",
    });
    expect(result.ok).toBe(true);
    expect(writes).toContain(`create:10000:${PATIENT}:REQUIRES_ACTION`);
  });

  it("keeps a verified payment and deletes one that is still waiting", async () => {
    const verified = database("PAID");
    expect((await deleteAdminPayment(verified.db, { userId: ADMIN, roleCodes: ["ADMIN"] }, PAYMENT)).ok).toBe(false);
    expect(verified.writes).not.toContain("delete");
    const waiting = database("REQUIRES_ACTION");
    expect((await deleteAdminPayment(waiting.db, { userId: ADMIN, roleCodes: ["ADMIN"] }, PAYMENT)).ok).toBe(true);
    expect(waiting.writes).toEqual(["events", "delete"]);
  });
});
