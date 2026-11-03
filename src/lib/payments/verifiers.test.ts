import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { actorMayVerifyPayment, adminVerifiedPayment, parseVerifierIds, savePaymentVerifiers } from "./verifiers";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("payment verifiers", () => {
  it("lets a super administrator verify and a selected administrator verify", () => {
    expect(actorMayVerifyPayment({ roleCodes: ["SUPER_ADMIN"], userId: ADMIN, verifierIds: [] })).toBe(true);
    expect(actorMayVerifyPayment({ roleCodes: ["ADMIN"], userId: ADMIN, verifierIds: [ADMIN] })).toBe(true);
    expect(actorMayVerifyPayment({ roleCodes: ["ADMIN"], userId: OTHER, verifierIds: [ADMIN] })).toBe(false);
    expect(actorMayVerifyPayment({ roleCodes: ["DOCTOR"], userId: ADMIN, verifierIds: [ADMIN] })).toBe(false);
    expect(actorMayVerifyPayment({ roleCodes: ["DOCTOR", "ADMIN"], userId: ADMIN, verifierIds: [ADMIN] })).toBe(false);
    expect(actorMayVerifyPayment({ roleCodes: ["SUPER_ADMIN", "DOCTOR"], userId: ADMIN, verifierIds: [] })).toBe(true);
  });

  it("treats a visit as paid only after an administrator verifies a fee", () => {
    expect(adminVerifiedPayment(0, [])).toBe(true);
    expect(adminVerifiedPayment(10000, ["REQUIRES_ACTION"])).toBe(false);
    expect(adminVerifiedPayment(10000, [])).toBe(false);
    expect(adminVerifiedPayment(10000, ["PAID"])).toBe(true);
  });

  it("keeps only account ids in the saved verifier list", () => {
    expect(parseVerifierIds([ADMIN, ADMIN, "not-an-id", 4])).toEqual([ADMIN]);
    expect(parseVerifierIds({ ids: [ADMIN] })).toEqual([]);
  });

  it("refuses a doctor or an ordinary administrator who tries to choose verifiers", async () => {
    const db = { user: { findMany: async () => [] } } as unknown as PrismaClient;
    expect((await savePaymentVerifiers(db, { userId: ADMIN, roleCodes: ["ADMIN"] }, [OTHER])).ok).toBe(false);
    expect((await savePaymentVerifiers(db, { userId: ADMIN, roleCodes: ["DOCTOR"] }, [OTHER])).ok).toBe(false);
  });
});
