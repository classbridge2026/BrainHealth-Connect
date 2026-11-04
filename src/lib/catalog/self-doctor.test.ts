import { describe, expect, it } from "vitest";
import { parseClinicianName, prepareSelfDoctor } from "./self-doctor";

const admin = { userId: "22222222-2222-4222-8222-222222222222", roleCodes: ["SUPER_ADMIN"] };
const specialtyId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-03T18:00:00.000Z");

describe("assign a service to the signed-in administrator", () => {
  it("keeps a patient-facing name and rejects a blank or marked-up name", () => {
    expect(parseClinicianName("  Osman   Tholley ")).toBe("Osman Tholley");
    expect(parseClinicianName("A")).toBeNull();
    expect(parseClinicianName("Osman <script>")).toBeNull();
  });

  it("opens an approved doctor profile on the administrator account and verifies the specialty", async () => {
    const profiles: Array<Record<string, unknown>> = [];
    const claims: Array<Record<string, unknown>> = [];
    const roles: Array<Record<string, unknown>> = [];
    const db = {
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          user: {
            findUnique: async () => ({ status: "ACTIVE", deletedAt: null, doctorProfile: null }),
          },
          specialty: { findUnique: async () => ({ isActive: true }) },
          role: { findUnique: async () => ({ id: "role-doctor" }) },
          userRole: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              roles.push(data);
            },
          },
          doctorProfile: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              profiles.push(data);
              return { id: "profile-1" };
            },
          },
          doctorSpecialty: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              claims.push(data);
            },
          },
          doctorVerificationEvent: { create: async () => ({}) },
          auditLog: { create: async () => ({}) },
        }),
    };

    const result = await prepareSelfDoctor(
      { fullName: "Osman Tholley", specialtyId, mode: "ONLINE" },
      { db: db as never, actor: admin, now },
    );

    expect(result).toEqual({ ok: true, doctorProfileId: "profile-1" });
    expect(roles[0]).toMatchObject({ userId: admin.userId, roleId: "role-doctor" });
    expect(profiles[0]).toMatchObject({
      userId: admin.userId,
      fullName: "Osman Tholley",
      displayName: "Osman Tholley",
      verificationStatus: "APPROVED",
      consultationModes: ["ONLINE"],
    });
    expect(claims[0]).toMatchObject({ specialtyId, claimStatus: "VERIFIED", isPrimary: true });
  });

  it("does not reopen a suspended profile", async () => {
    const db = {
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          user: {
            findUnique: async () => ({
              status: "ACTIVE",
              deletedAt: null,
              doctorProfile: { id: "profile-1", fullName: "Osman Tholley", verificationStatus: "SUSPENDED", consultationModes: [], specialties: [] },
            }),
          },
        }),
    };
    const result = await prepareSelfDoctor(
      { fullName: "Osman Tholley", specialtyId, mode: "ONLINE" },
      { db: db as never, actor: admin, now },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("suspended");
  });

  it("refuses someone who is not an administrator", async () => {
    const result = await prepareSelfDoctor(
      { fullName: "Osman Tholley", specialtyId, mode: "ONLINE" },
      { db: {} as never, actor: { userId: admin.userId, roleCodes: ["PATIENT"] }, now },
    );
    expect(result.ok).toBe(false);
  });
});
