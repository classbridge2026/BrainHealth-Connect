import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { confirmVerifiedPayment, getPaymentHoldMinutes } from "@/lib/appointments/payment-holds";
import { securityHeaders, portalNoStoreHeaders } from "@/lib/security/headers";
import {
  decidePaymentConfirmation,
  nextProviderPaymentStatus,
  paymentAmountsMatch,
  verifyProviderSignature,
} from "./verification";

const now = new Date("2026-10-25T12:00:00.000Z");
const later = new Date("2026-10-25T12:10:00.000Z");
const appointmentId = "11111111-1111-4111-8111-111111111111";
const paymentId = "22222222-2222-4222-8222-222222222222";

const base = {
  appointmentFound: true,
  paymentFound: true,
  paymentAppointmentId: appointmentId,
  appointmentId,
  appointmentStatus: "PENDING_PAYMENT",
  paymentStatus: "PENDING",
  holdExpiresAt: later,
  now,
  paymentAmountMinor: 1550,
  appointmentFeeMinor: 1550,
  paymentCurrency: "SLL",
  appointmentCurrency: "SLL",
};

describe("payment confirmation rules", () => {
  it("accepts only the stored fee and the configured currency", () => {
    expect(paymentAmountsMatch({ paymentAmountMinor: 1550, appointmentFeeMinor: 1550, paymentCurrency: " sll ", appointmentCurrency: "SLL" })).toBe(true);
    expect(paymentAmountsMatch({ paymentAmountMinor: 1, appointmentFeeMinor: 1550, paymentCurrency: "SLL", appointmentCurrency: "SLL" })).toBe(false);
    expect(paymentAmountsMatch({ paymentAmountMinor: 1550, appointmentFeeMinor: 1550, paymentCurrency: "USD", appointmentCurrency: "SLL" })).toBe(false);
    expect(decidePaymentConfirmation({ ...base, paymentAmountMinor: 1 })).toEqual({ ok: false, code: "AMOUNT_MISMATCH" });
  });

  it("does not confirm a failed, refunded, expired, or foreign payment", () => {
    expect(decidePaymentConfirmation({ ...base, paymentStatus: "FAILED" })).toEqual({ ok: false, code: "PAYMENT_NOT_PAYABLE" });
    expect(decidePaymentConfirmation({ ...base, paymentStatus: "REFUNDED" })).toEqual({ ok: false, code: "PAYMENT_NOT_PAYABLE" });
    expect(decidePaymentConfirmation({ ...base, paymentStatus: "CANCELLED" })).toEqual({ ok: false, code: "PAYMENT_NOT_PAYABLE" });
    expect(decidePaymentConfirmation({ ...base, holdExpiresAt: new Date("2026-10-25T11:00:00.000Z") })).toEqual({
      ok: false,
      code: "LATE_PAYMENT_NEEDS_REVIEW",
    });
    expect(decidePaymentConfirmation({ ...base, appointmentStatus: "EXPIRED_UNPAID" })).toEqual({
      ok: false,
      code: "LATE_PAYMENT_NEEDS_REVIEW",
    });
    expect(decidePaymentConfirmation({ ...base, paymentAppointmentId: paymentId })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(decidePaymentConfirmation({ ...base, paymentFound: false })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("treats a repeated paid confirmation as already recorded and refuses to mark a confirmed visit from a pending payment", () => {
    expect(decidePaymentConfirmation({ ...base, appointmentStatus: "CONFIRMED", paymentStatus: "PAID" })).toEqual({
      ok: true,
      action: "already_recorded",
    });
    expect(decidePaymentConfirmation({ ...base, appointmentStatus: "CONFIRMED", paymentStatus: "PENDING" })).toEqual({
      ok: false,
      code: "PAYMENT_NOT_PAYABLE",
    });
    expect(decidePaymentConfirmation(base)).toEqual({ ok: true, action: "confirm_and_mark_paid" });
    expect(decidePaymentConfirmation({ ...base, paymentStatus: "PAID" })).toEqual({ ok: true, action: "confirm_appointment_only" });
  });

  it("ignores out-of-order failures after payment and rejects a success after failure", () => {
    expect(nextProviderPaymentStatus("PAID", "FAILED")).toEqual({ status: "PAID", changed: false });
    expect(nextProviderPaymentStatus("PAID", "PENDING")).toEqual({ status: "PAID", changed: false });
    expect(nextProviderPaymentStatus("PAID", "PAID")).toEqual({ status: "PAID", changed: false });
    expect(nextProviderPaymentStatus("PAID", "REFUNDED")).toEqual({ status: "REFUNDED", changed: true });
    expect(nextProviderPaymentStatus("REFUNDED", "PAID")).toEqual({ status: "REFUNDED", changed: false });
    expect(nextProviderPaymentStatus("FAILED", "PAID")).toEqual({ rejected: true });
    expect(nextProviderPaymentStatus("PENDING", "PAID")).toEqual({ status: "PAID", changed: true });
  });

  it("rejects a missing, empty, or mismatched provider signature", () => {
    const body = JSON.stringify({ id: "evt_1", amount: 1550 });
    const secret = "test-provider-secret";
    expect(verifyProviderSignature({ body, header: null, secret })).toBe(false);
    expect(verifyProviderSignature({ body, header: "sha256=abcd", secret: null })).toBe(false);
    expect(verifyProviderSignature({ body, header: "sha256=abcd", secret })).toBe(false);
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyProviderSignature({ body, header: `sha256=${signature}`, secret })).toBe(true);
    expect(verifyProviderSignature({ body: `${body} `, header: `sha256=${signature}`, secret })).toBe(false);
  });
});

describe("payment hold and confirmation service", () => {
  it("ignores a stored hold outside the 5 to 120 minute range", async () => {
    const setting = (valueJson: unknown) => ({ platformSetting: { findUnique: async () => ({ valueJson }) } });
    expect(await getPaymentHoldMinutes(setting(4) as never)).toBe(15);
    expect(await getPaymentHoldMinutes(setting(200) as never)).toBe(15);
    expect(await getPaymentHoldMinutes(setting(15.5) as never)).toBe(15);
    expect(await getPaymentHoldMinutes(setting(15) as never)).toBe(15);
  });

  it("does not write when the amount, status, or owner is not payable", async () => {
    const updates: string[] = [];
    const db = confirmationDb(
      {
        id: appointmentId,
        status: "PENDING_PAYMENT",
        paymentHoldExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        feeAmountMinor: 1550,
        currency: "SLL",
      },
      {
        id: paymentId,
        appointmentId,
        status: "FAILED",
        amountMinor: 1550,
        currency: "SLL",
        providerCode: "manual",
      },
      updates,
    );
    const result = await confirmVerifiedPayment({ appointmentId, paymentId }, db as never);
    expect(result).toEqual({ ok: false, code: "PAYMENT_NOT_PAYABLE" });
    expect(updates).toEqual([]);
  });

  it("marks only a matching pending payment as paid and records one verification event", async () => {
    const updates: string[] = [];
    const events: string[] = [];
    const db = confirmationDb(
      {
        id: appointmentId,
        status: "PENDING_PAYMENT",
        paymentHoldExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        feeAmountMinor: 1550,
        currency: "SLL",
      },
      {
        id: paymentId,
        appointmentId,
        status: "PENDING",
        amountMinor: 1550,
        currency: "SLL",
        providerCode: "manual",
      },
      updates,
      events,
    );
    const result = await confirmVerifiedPayment({ appointmentId, paymentId }, db as never);
    expect(result).toEqual({ ok: true, appointmentId, alreadyConfirmed: false });
    expect(updates).toEqual(["appointment", "payment"]);
    expect(events).toEqual([`verified:${paymentId}`]);
  });
});

describe("response headers", () => {
  it("sets baseline browser protections and keeps portal pages uncached", () => {
    const joined = securityHeaders.map((header) => `${header.key}:${header.value}`).join(" ");
    expect(joined).toContain("X-Content-Type-Options:nosniff");
    expect(joined).toContain("X-Frame-Options:DENY");
    expect(joined).toContain("camera=(self)");
    expect(joined).not.toMatch(/secret|password|postgres/i);
    expect(portalNoStoreHeaders[0]).toEqual({ key: "Cache-Control", value: "private, no-store" });
  });
});

function confirmationDb(
  appointment: { id: string; status: string; paymentHoldExpiresAt: Date; feeAmountMinor: number; currency: string },
  payment: { id: string; appointmentId: string; status: string; amountMinor: number; currency: string; providerCode: string },
  updates: string[],
  events: string[] = [],
) {
  const state = { appointment, payment };
  const tx = {
    $queryRaw: async () => [],
    appointment: {
      findUnique: async () => state.appointment,
      updateMany: async () => {
        updates.push("appointment");
        state.appointment = { ...state.appointment, status: "CONFIRMED" };
        return { count: 1 };
      },
    },
    payment: {
      findUnique: async () => state.payment,
      updateMany: async () => {
        updates.push("payment");
        state.payment = { ...state.payment, status: "PAID" };
        return { count: 1 };
      },
    },
    appointmentEvent: { create: async () => ({}) },
    paymentEvent: {
      create: async ({ data }: { data: { providerEventId: string } }) => {
        events.push(data.providerEventId);
        return data;
      },
    },
  };
  return {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    appointment: { findUnique: async () => null },
  };
}
