import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { clearOwnInAppNotifications, directoryFee, genderLabel, isReleasedPatientSummary, parseConsultationFilter, patientNotificationHref } from "./portal";

describe("find a doctor fees", () => {
  const service = (fee: string, currency = "SLL") => ({ defaultFee: new Prisma.Decimal(fee), currency });

  it("shows the service fee from Fees and pricing", () => {
    expect(
      directoryFee([
        { priceAmountMinor: 0, currency: "SLL", consultationService: service("100") },
        { priceAmountMinor: 0, currency: "SLL", consultationService: service("100.00") },
      ]),
    ).toBe("100.00 SLL");
  });

  it("uses the service fee instead of a separate doctor price and hides a zero price", () => {
    expect(directoryFee([{ priceAmountMinor: 15000, currency: "SLL", consultationService: service("100") }])).toBe("100.00 SLL");
    expect(directoryFee([{ priceAmountMinor: 0, currency: "SLL", consultationService: service("0") }])).toBeNull();
    expect(
      directoryFee([
        { priceAmountMinor: 0, currency: "SLL", consultationService: service("100") },
        { priceAmountMinor: 0, currency: "USD", consultationService: service("10", "USD") },
      ]),
    ).toBeNull();
  });
});

describe("patient portal visibility", () => {
  it("shows only a released patient summary", () => {
    expect(isReleasedPatientSummary({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "RELEASED", archivedAt: null })).toBe(true);
    expect(isReleasedPatientSummary({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "NOT_RELEASED", archivedAt: null })).toBe(false);
    expect(isReleasedPatientSummary({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "WITHDRAWN", archivedAt: null })).toBe(false);
    expect(isReleasedPatientSummary({ kind: "PRIVATE_WORKING", summaryReleaseStatus: "RELEASED", archivedAt: null })).toBe(false);
    expect(
      isReleasedPatientSummary({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "RELEASED", archivedAt: new Date() }),
    ).toBe(false);
  });

  it("accepts consultation type filters and appointment notification links only", () => {
    expect(parseConsultationFilter("ONLINE")).toBe("ONLINE");
    expect(parseConsultationFilter("IN_PERSON")).toBe("IN_PERSON");
    expect(parseConsultationFilter("VIDEO")).toBeNull();
    const id = "33333333-3333-4333-8333-333333333333";
    expect(patientNotificationHref("Appointment", id)).toBe(`/patient/appointments/${id}`);
    expect(patientNotificationHref("ClinicalNote", id)).toBeNull();
    expect(patientNotificationHref("Payment", id)).toBeNull();
  });

  it("clears only this patient's in-app notices and keeps the row so a reminder is not sent again", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      notification: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          updates.push({ where, data });
          return { count: 2 };
        },
      },
    };
    const result = await clearOwnInAppNotifications(db as unknown as PrismaClient, "patient-1");
    expect(result).toEqual({ ok: true, message: "Notifications are cleared." });
    expect(updates[0]?.where).toEqual({ recipientId: "patient-1", channel: "IN_APP", status: { not: "CANCELLED" } });
    expect(updates[0]?.data).toMatchObject({ status: "CANCELLED" });
  });

  it("labels stored gender values", () => {
    expect(genderLabel("PREFER_NOT_TO_SAY")).toBe("Prefer not to say");
    expect(genderLabel("FEMALE")).toBe("Female");
  });
});
