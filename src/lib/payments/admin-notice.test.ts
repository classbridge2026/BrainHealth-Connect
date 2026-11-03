import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { notifyAdminsToVerifyPayment } from "./admin-notice";

describe("notifyAdminsToVerifyPayment", () => {
  it("opens a payment verification notice for each active administrator", async () => {
    const notices: Array<Record<string, unknown>> = [];
    const db = {
      user: {
        findMany: async () => [{ id: "admin-1" }, { id: "admin-2" }],
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          notices.push(data);
          return data;
        },
      },
    };
    await notifyAdminsToVerifyPayment(db as unknown as PrismaClient, {
      paymentId: "22222222-2222-4222-8222-222222222222",
      wallet: "Orange Money",
      reference: "PP250502.1502.B91020",
    });
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      recipientId: "admin-1",
      channel: "IN_APP",
      type: "payment.verification_requested",
      entityType: "Payment",
      entityId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
