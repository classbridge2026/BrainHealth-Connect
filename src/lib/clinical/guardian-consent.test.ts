import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authorizeGuardianConsent } from "./guardian-consent";

const actor = { userId: "11111111-1111-4111-8111-111111111111", roleCodes: ["ADMIN"] };
const patientId = "050a6736-1d81-4bb7-a0de-e7da2e5cd29f";
const guardianId = "5c134b07-ded2-4959-9f76-8459a0f6c9b3";

function database(options?: { samePerson?: boolean; inactive?: boolean }) {
  const writes: string[] = [];
  const records = {
    patientProfile: {
      findUnique: async () => ({ id: patientId, userId: options?.samePerson ? guardianId : "patient-user", archivedAt: null, fullName: "Amina" }),
    },
    user: {
      findUnique: async () => ({ id: guardianId, status: options?.inactive ? "SUSPENDED" : "ACTIVE", deletedAt: null }),
    },
    guardianRelationship: {
      upsert: async () => {
        writes.push("relationship");
        return { id: "relationship-1" };
      },
    },
    consentRecord: {
      findUnique: async () => null,
      create: async () => {
        writes.push("consent");
        return { id: "consent-1" };
      },
      update: async () => ({ id: "consent-1" }),
    },
    platformSetting: {
      findUnique: async () => ({ valueJson: false }),
      upsert: async () => {
        writes.push("setting");
        return {};
      },
    },
    auditLog: { create: async () => { writes.push("audit"); return {}; } },
  };
  const db = {
    ...records,
    $transaction: async (fn: (tx: typeof records) => Promise<void>) => fn(records),
  };
  return { db: db as unknown as PrismaClient, writes };
}

describe("authorizeGuardianConsent", () => {
  it("records an authorized guardian and the current consent", async () => {
    const store = database();
    const result = await authorizeGuardianConsent(
      { patientId, guardianEmail: "Parent@Example.com", relationshipType: "PARENT", confirmed: true },
      { db: store.db, actor, now: new Date("2026-11-03T13:00:00Z") },
    );
    expect(result.ok).toBe(true);
    expect(store.writes).toEqual(["relationship", "consent", "setting", "audit"]);
  });

  it("refuses a patient authorizing their own record", async () => {
    const store = database({ samePerson: true });
    const result = await authorizeGuardianConsent(
      { patientId, guardianEmail: "parent@example.com", relationshipType: "LEGAL_GUARDIAN", confirmed: true },
      { db: store.db, actor },
    );
    expect(result).toEqual({ ok: false, message: "A patient cannot authorize care for their own record." });
    expect(store.writes).toEqual([]);
  });

  it("requires an explicit confirmation", async () => {
    const result = await authorizeGuardianConsent(
      { patientId, guardianEmail: "parent@example.com", relationshipType: "PARENT", confirmed: false },
      { db: database().db, actor },
    );
    expect(result.ok).toBe(false);
  });
});
