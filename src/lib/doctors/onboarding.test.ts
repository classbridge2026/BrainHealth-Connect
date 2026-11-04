import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerPatient } from "@/lib/auth/register-patient";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { sendCareCircleEmail } from "@/lib/auth/delivery";
import { hashEmailToken } from "@/lib/auth/tokens";
import { createDoctorAccount } from "./create-doctor";
import { acceptDoctorInvitation, resendDoctorInvitation, revokeDoctorInvitation } from "./invitations";
import { uploadDoctorCredential, openCredentialFile } from "./credentials";
import { approveDoctor } from "./verification";
import { saveDoctorProfile } from "./profile";
import {
  approvalBlockers,
  canManageSpecialties,
  canReceiveNewAppointment,
  credentialDownloadDecision,
  credentialStorageKey,
  invitationOutcomeMessage,
  invitationTokenState,
  specialtyDeleteDecision,
  statusAfterDraftSave,
} from "./rules";
import { createPrivateStorage, storageRootProblem } from "@/lib/storage/private-storage";

const specialtyId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const doctorUserId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";

const addInput = {
  fullName: "Fatmata Sesay",
  email: "Fatmata@Example.com",
  phone: "076111222",
  specialtyId,
  biography: "",
  qualificationTitle: "MBChB",
  yearsExperience: "8",
};

function memoryDb() {
  const users: Array<Record<string, unknown>> = [];
  const invites: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const roles: string[] = [];
  const profiles: Array<Record<string, unknown>> = [];

  const db = {
    audits,
    invites,
    roles,
    profiles,
    users,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    role: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        roles.push(where.code);
        return where.code === "DOCTOR" ? { id: "role-doctor" } : null;
      },
    },
    specialty: {
      findUnique: async () => ({ id: specialtyId, isActive: true, name: "Psychiatry" }),
    },
    user: {
      findUnique: async ({ where }: { where: { emailNormalized?: string; phoneE164?: string } }) =>
        users.find((user) =>
          where.emailNormalized ? user.emailNormalized === where.emailNormalized : user.phoneE164 === where.phoneE164,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: doctorUserId, ...data };
        users.push(row);
        return { id: doctorUserId };
      },
      update: async () => {
        throw new Error("accept should not be asserted here");
      },
    },
    userRole: { create: async ({ data }: { data: { roleId: string } }) => data },
    doctorProfile: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: profileId, ...data };
        profiles.push(row);
        return row;
      },
    },
    doctorSpecialty: { create: async () => ({ id: "claim" }) },
    doctorInvitation: {
      findFirst: async () =>
        invites.find((invite) => invite.status === "PENDING" && (invite.expiresAt as Date) > new Date("2026-10-01")) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `invite-${invites.length + 1}`, ...data };
        invites.push(row);
        return row;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(invites[invites.length - 1], data);
        return invites[invites.length - 1];
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
    notification: { create: async () => ({ id: "note" }) },
  };
  return db;
}

describe("doctor onboarding rules", () => {
  it("keeps public registration on the patient role", async () => {
    const roleLookups: string[] = [];
    const db = {
      platformSetting: { findUnique: async () => ({ valueJson: false }) },
      notification: { createMany: async () => ({ count: 0 }) },
      role: {
        findUnique: async ({ where }: { where: { code: string } }) => {
          roleLookups.push(where.code);
          return where.code === "PATIENT" ? { id: "role-patient" } : null;
        },
      },
      user: { create: async () => ({ id: "user-1" }) },
    };
    const result = await registerPatient(
      {
        fullName: "Aminata Kamara",
        gender: "FEMALE",
        nationality: "Sierra Leonean",
        phone: "076000001",
        email: "aminata@example.com",
        residentialAddress: "12 Wilberforce",
        password: "CorrectHorse12",
        confirmPassword: "CorrectHorse12",
        acceptTerms: true,
        acceptPrivacy: true,
        role: "DOCTOR",
      },
      {
        db: db as never,
        hashPassword: async () => "hashed",
        rateLimiter: createRateLimiter({ limit: 5, windowMs: 1000 }),
        ipHash: "ip",
        now: () => new Date("2026-10-18T00:00:00Z"),
        appBaseUrl: "http://localhost:3000",
      },
    );
    expect(result.ok).toBe(true);
    expect(roleLookups).toEqual(["PATIENT"]);
  });

  it("lets only an administrator create a doctor invitation", async () => {
    const db = memoryDb();
    const denied = await createDoctorAccount(addInput, {
      db: db as never,
      actor: { userId: "patient", roleCodes: ["PATIENT"] },
      hashPassword: async () => "hash",
      deliver: async () => ({ delivered: true, reason: "sent" }),
      now: new Date("2026-10-18T00:00:00Z"),
      appBaseUrl: "http://localhost:3000",
    });
    expect(denied.ok).toBe(false);
    expect(db.roles).toEqual([]);
    expect(db.invites).toHaveLength(0);
  });

  it("stores only a token hash and does not report success when email fails", async () => {
    const db = memoryDb();
    let raw = "";
    const result = await createDoctorAccount(addInput, {
      db: db as never,
      actor: { userId: adminId, roleCodes: ["ADMIN"] },
      hashPassword: async (value) => `hashed:${value.length}`,
      deliver: async (input) => {
        raw = input.text;
        return { delivered: false, reason: "not_configured" };
      },
      now: new Date("2026-10-18T00:00:00Z"),
      appBaseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.emailSent).toBe(false);
    expect(result.message).toContain("was not sent");
    expect(result.message).not.toContain("invitation email was sent");
    expect(JSON.stringify(result)).not.toContain("token=");
    expect(db.invites[0]?.tokenHash).toBeTruthy();
    expect(JSON.stringify(db.invites)).not.toContain("token=");
    expect(raw).toContain("CareCircle MindTogether");
    expect(raw).toContain("set your password");
    expect(raw).not.toMatch(/temporary password|password is/i);
    expect(db.roles).toEqual(["DOCTOR"]);
    expect(db.profiles[0]).toMatchObject({ verificationStatus: "DRAFT" });
  });

  it("rejects a duplicate email before sending another invitation", async () => {
    const db = memoryDb();
    db.users.push({ emailNormalized: "fatmata@example.com", phoneE164: "+1999" });
    const delivered: string[] = [];
    const result = await createDoctorAccount(addInput, {
      db: db as never,
      actor: { userId: adminId, roleCodes: ["SUPER_ADMIN"] },
      hashPassword: async () => "hash",
      deliver: async () => {
        delivered.push("sent");
        return { delivered: true, reason: "sent" };
      },
      now: new Date("2026-10-18T00:00:00Z"),
      appBaseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    expect(delivered).toHaveLength(0);
  });

  it("rate limits invitation acceptance", async () => {
    const deps = {
      db: { doctorInvitation: { findUnique: async () => null } } as never,
      hashPassword: async () => "hash",
      now: new Date("2026-10-18T00:00:00Z"),
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
      rateKey: "accept-limit",
    };
    await acceptDoctorInvitation({ token: "one", password: "CorrectHorse12", confirmPassword: "CorrectHorse12" }, deps);
    const blocked = await acceptDoctorInvitation(
      { token: "two", password: "CorrectHorse12", confirmPassword: "CorrectHorse12" },
      deps,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.formMessage).toContain("Too many attempts");
    }
  });

  it("expires, consumes, and revokes invitation tokens", async () => {
    const now = new Date("2026-10-18T00:00:00Z");
    expect(invitationTokenState({ status: "PENDING", expiresAt: now, acceptedAt: null, revokedAt: null }, now)).toBe("expired");
    expect(
      invitationTokenState(
        { status: "PENDING", expiresAt: new Date("2026-10-19T00:00:00Z"), acceptedAt: new Date(), revokedAt: null },
        now,
      ),
    ).toBe("used");
    expect(
      invitationTokenState(
        { status: "REVOKED", expiresAt: new Date("2026-10-19T00:00:00Z"), acceptedAt: null, revokedAt: now },
        now,
      ),
    ).toBe("revoked");
    expect(
      invitationTokenState(
        { status: "SUPERSEDED", expiresAt: new Date("2026-10-19T00:00:00Z"), acceptedAt: null, revokedAt: null },
        now,
      ),
    ).toBe("replaced");
  });

  it("accepts an invitation once and ignores any requested administrator role", async () => {
    const tokenRaw = "invite-token-value";
    const tokenHash = hashEmailToken(tokenRaw);
    const invite = {
      id: "invite-1",
      status: "PENDING",
      expiresAt: new Date("2026-10-25T00:00:00Z"),
      acceptedAt: null as Date | null,
      revokedAt: null as Date | null,
      doctor: { userId: doctorUserId },
    };
    const updates: Array<Record<string, unknown>> = [];
    const roleWrites: string[] = [];
    const db = {
      doctorInvitation: {
        findUnique: async () => invite,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          if (invite.status !== "PENDING" || invite.acceptedAt || invite.revokedAt) return { count: 0 };
          Object.assign(invite, data);
          return { count: 1 };
        },
      },
      user: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return data;
        },
      },
      userRole: { create: async () => roleWrites.push("role") },
      session: { create: async () => ({ id: "session" }) },
      auditLog: { create: async () => ({ id: "audit" }) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    const deps = {
      db: db as never,
      hashPassword: async (value: string) => `hash:${value.length}`,
      now: new Date("2026-10-18T00:00:00Z"),
      rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
      rateKey: "accept",
    };
    const accepted = await acceptDoctorInvitation(
      { token: tokenRaw, password: "CorrectHorse12", confirmPassword: "CorrectHorse12" },
      deps,
    );
    expect(accepted.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: "ACTIVE" });
    expect(updates[0]).not.toHaveProperty("role");
    expect(roleWrites).toHaveLength(0);
    expect(JSON.stringify(accepted)).not.toContain(tokenRaw);
    const replay = await acceptDoctorInvitation(
      { token: tokenRaw, password: "CorrectHorse12", confirmPassword: "CorrectHorse12" },
      deps,
    );
    expect(replay.ok).toBe(false);
    expect(tokenHash).toHaveLength(64);
  });

  it("invalidates the previous invitation when a replacement is sent", async () => {
    const existing = {
      id: "invite-old",
      doctorProfileId: profileId,
      emailNormalized: "fatmata@example.com",
      status: "PENDING",
      doctor: { id: profileId, fullName: "Fatmata Sesay", user: { id: doctorUserId, email: "fatmata@example.com" } },
    };
    const created: Array<Record<string, unknown>> = [];
    const db = {
      doctorInvitation: {
        findUnique: async () => existing,
        updateMany: async () => {
          existing.status = "SUPERSEDED";
          return { count: 1 };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: "invite-new", ...data };
          created.push(row);
          return row;
        },
        update: async () => created[0],
      },
      auditLog: { create: async () => ({ id: "audit" }) },
      notification: { create: async () => ({ id: "note" }) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    const result = await resendDoctorInvitation(
      { invitationId: existing.id },
      {
        db: db as never,
        actor: { userId: adminId, roleCodes: ["ADMIN"] },
        deliver: async () => ({ delivered: false, reason: "provider_failed" }),
        now: new Date("2026-10-18T00:00:00Z"),
        appBaseUrl: "http://localhost:3000",
        rateLimiter: createRateLimiter({ limit: 3, windowMs: 1000 }),
        rateKey: "resend",
      },
    );
    expect(existing.status).toBe("SUPERSEDED");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailSent).toBe(false);
      expect(result.message).toContain("not sent");
    }
    const revoked = await revokeDoctorInvitation(
      { invitationId: "invite-old" },
      { db: { doctorInvitation: { updateMany: async () => ({ count: 0 }) }, auditLog: { create: async () => ({}) } } as never, actor: { userId: adminId, roleCodes: ["ADMIN"] }, now: new Date() },
    );
    expect(revoked.ok).toBe(false);
  });

  it("blocks another doctor and an anonymous caller from credential download", async () => {
    const reads: string[] = [];
    const storage = {
      configured: true,
      put: async () => ({ ok: true as const }),
      read: async (key: string) => {
        reads.push(key);
        return { ok: true as const, body: new Uint8Array([1]) };
      },
      remove: async () => ({ ok: true as const }),
    };
    const db = {
      doctorCredential: {
        findUnique: async () => ({
          id: "cred",
          storageKey: "private-key",
          mimeType: "application/pdf",
          originalFilename: "licence.pdf",
          doctor: { userId: doctorUserId },
        }),
      },
    };
    const denied = await openCredentialFile(
      "cred",
      { userId: "other-doctor", status: "ACTIVE", roleCodes: ["DOCTOR"] },
      { db: db as never, storage },
    );
    expect(denied.ok).toBe(false);
    expect(reads).toHaveLength(0);
    const anon = await openCredentialFile("cred", { userId: null, status: null, roleCodes: [] }, { db: db as never, storage });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.status).toBe(401);
  });

  it("does not store a credential when private storage is not configured", async () => {
    const creates: string[] = [];
    const db = {
      doctorProfile: {
        findUnique: async () => ({
          id: profileId,
          userId: doctorUserId,
          verificationStatus: "DRAFT",
          credentials: [],
        }),
      },
      doctorCredential: { create: async () => creates.push("created") },
    };
    const result = await uploadDoctorCredential(
      {
        actorUserId: doctorUserId,
        type: "LICENSE",
        filename: "licence.pdf",
        declaredMime: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      },
      { db: db as never, storage: createPrivateStorage({}), now: new Date() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not stored");
    expect(creates).toHaveLength(0);
  });

  it("stops a doctor from approving an incomplete or their own application", async () => {
    const profile = {
      fullName: "A",
      displayName: "",
      phoneE164: null,
      email: "",
      biography: null,
      primarySpecialtyId: null,
      qualificationKind: null,
      qualificationTitle: null,
      qualificationInstitution: null,
      qualificationYear: null,
      licenseNumber: null,
      licenseAuthority: null,
      yearsExperience: null,
      languages: [],
      consultationModes: [],
    };
    expect(
      approvalBlockers({
        actorUserId: doctorUserId,
        actorRoles: ["ADMIN"],
        doctorUserId,
        verificationStatus: "SUBMITTED",
        profile,
        credentials: [],
        identityRequired: false,
        primaryClaim: "DECLARED",
      })[0],
    ).toBe("A doctor cannot approve their own profile.");
    expect(
      approvalBlockers({
        actorUserId: adminId,
        actorRoles: ["ADMIN"],
        doctorUserId,
        verificationStatus: "DRAFT",
        profile,
        credentials: [],
        identityRequired: false,
        primaryClaim: null,
      }),
    ).toContain("Only a submitted application can be approved.");

    const updates: string[] = [];
    const db = {
      doctorProfile: {
        findUnique: async () => ({
          id: profileId,
          userId: doctorUserId,
          verificationStatus: "DRAFT",
          fullName: "Fatmata Sesay",
          displayName: "Dr Sesay",
          biography: null,
          qualificationKind: null,
          qualificationTitle: null,
          qualificationInstitution: null,
          qualificationYear: null,
          licenseNumberNormalized: null,
          licenseJurisdiction: null,
          yearsExperience: null,
          languages: [],
          consultationModes: [],
          user: { id: doctorUserId, status: "ACTIVE", email: "fatmata@example.com" },
          credentials: [],
          specialties: [],
        }),
        update: async () => updates.push("updated"),
      },
      platformSetting: { findUnique: async () => null },
      user: { findUnique: async () => ({ phoneE164: "+23276111222", email: "fatmata@example.com" }) },
      $transaction: async () => updates.push("transaction"),
    };
    const result = await approveDoctor(profileId, {
      db: db as never,
      actor: { userId: adminId, roleCodes: ["ADMIN"] },
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses new appointments for rejected, suspended, or unverified doctors", () => {
    expect(
      canReceiveNewAppointment({
        verificationStatus: "APPROVED",
        userStatus: "ACTIVE",
        deletedAt: null,
        specialtyClaim: "VERIFIED",
        specialtyActive: true,
      }),
    ).toBe(true);
    expect(
      canReceiveNewAppointment({
        verificationStatus: "REJECTED",
        userStatus: "ACTIVE",
        deletedAt: null,
        specialtyClaim: "VERIFIED",
        specialtyActive: true,
      }),
    ).toBe(false);
    expect(
      canReceiveNewAppointment({
        verificationStatus: "SUSPENDED",
        userStatus: "SUSPENDED",
        deletedAt: null,
        specialtyClaim: "VERIFIED",
        specialtyActive: true,
      }),
    ).toBe(false);
    expect(
      canReceiveNewAppointment({
        verificationStatus: "APPROVED",
        userStatus: "ACTIVE",
        deletedAt: null,
        specialtyClaim: "DECLARED",
        specialtyActive: true,
      }),
    ).toBe(false);
  });

  it("requires administrator permission for specialties and protects referenced records", () => {
    expect(canManageSpecialties(["DOCTOR"])).toBe(false);
    expect(canManageSpecialties(["PATIENT"])).toBe(false);
    expect(canManageSpecialties(["ADMIN"])).toBe(true);
    expect(specialtyDeleteDecision({ doctors: 1, offerings: 0, appointments: 0 }).allowed).toBe(false);
    expect(specialtyDeleteDecision({ doctors: 0, offerings: 0, appointments: 2 }).allowed).toBe(false);
    expect(specialtyDeleteDecision({ doctors: 0, offerings: 0, appointments: 0 }).allowed).toBe(true);
  });

  it("keeps a rejected profile rejected when the draft is saved", async () => {
    expect(statusAfterDraftSave("REJECTED")).toBe("REJECTED");
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      doctorProfile: {
        findUnique: async () => ({
          id: profileId,
          userId: doctorUserId,
          verificationStatus: "REJECTED",
          fullName: "Fatmata Sesay",
          displayName: "Dr Sesay",
          user: { id: doctorUserId, email: "fatmata@example.com", phoneE164: "+23276111222", status: "ACTIVE" },
          specialties: [{ id: "link", specialtyId, isPrimary: true, claimStatus: "DECLARED" }],
          credentials: [],
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => updates.push(data),
      },
      specialty: { findMany: async () => [{ id: specialtyId, isActive: true }] },
      platformSetting: { findUnique: async () => null },
      user: { update: async () => ({}) },
      doctorSpecialty: {
        delete: async () => ({}),
        update: async () => ({}),
        create: async () => ({}),
      },
      appointment: { count: async () => 0 },
      doctorOffering: { count: async () => 0 },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    const saved = await saveDoctorProfile(
      doctorUserId,
      {
        fullName: "Fatmata Sesay",
        displayName: "Dr Sesay",
        phone: "+23276111222",
        biography: "A short note",
        primarySpecialtyId: specialtyId,
        additionalSpecialtyIds: [],
        qualificationKind: "",
        qualificationTitle: "",
        qualificationInstitution: "",
        qualificationYear: "",
        licenseNumber: "",
        licenseAuthority: "",
        licenseExpiresOn: "",
        yearsExperience: "",
        languages: "",
        consultationOnline: false,
        consultationInPerson: false,
      },
      { db: db as never, mode: "draft", now: new Date("2026-10-18T00:00:00Z") },
    );
    expect(saved.ok).toBe(true);
    expect(updates[0]?.verificationStatus).toBe("REJECTED");
  });

  it("sends an approved profile back for administrator verification", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const notices: Array<Record<string, unknown>> = [];
    const previous = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.EMAIL_FROM,
    };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_FROM;
    const biography = "Consultant psychiatrist providing careful follow-up for adults.";
    const db = {
      doctorProfile: {
        findUnique: async () => ({
          id: profileId,
          userId: doctorUserId,
          verificationStatus: "APPROVED",
          fullName: "Fatmata Sesay",
          displayName: "Dr Sesay",
          user: { id: doctorUserId, email: "fatmata@example.com", phoneE164: "+23276111222", status: "ACTIVE" },
          specialties: [{ id: "link", specialtyId, isPrimary: true, claimStatus: "VERIFIED" }],
          credentials: [
            { type: "LICENSE", status: "VERIFIED", archivedAt: null },
            { type: "DEGREE", status: "VERIFIED", archivedAt: null },
          ],
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => updates.push(data),
      },
      specialty: { findMany: async () => [{ id: specialtyId, isActive: true }] },
      platformSetting: { findUnique: async () => null },
      user: {
        update: async () => ({}),
        findMany: async () => [{ id: adminId, email: "admin@example.com" }],
      },
      doctorSpecialty: { update: async () => ({}) },
      doctorVerificationEvent: { create: async () => ({}) },
      auditLog: { create: async () => ({}) },
      notification: { create: async ({ data }: { data: Record<string, unknown> }) => notices.push(data) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    const saved = await saveDoctorProfile(
      doctorUserId,
      {
        fullName: "Fatmata Sesay",
        displayName: "Dr Sesay",
        phone: "+23276111222",
        biography,
        primarySpecialtyId: specialtyId,
        additionalSpecialtyIds: [],
        qualificationKind: "MEDICAL_DEGREE",
        qualificationTitle: "MBChB",
        qualificationInstitution: "COMAHS",
        qualificationYear: "2014",
        licenseNumber: "SL-100",
        licenseAuthority: "Medical and Dental Council",
        licenseExpiresOn: "",
        yearsExperience: "8",
        languages: "English",
        consultationOnline: true,
        consultationInPerson: false,
      },
      { db: db as never, mode: "submit", now: new Date("2026-10-18T00:00:00Z") },
    );
    if (previous.host) process.env.SMTP_HOST = previous.host;
    if (previous.port) process.env.SMTP_PORT = previous.port;
    if (previous.user) process.env.SMTP_USER = previous.user;
    if (previous.pass) process.env.SMTP_PASS = previous.pass;
    if (previous.from) process.env.EMAIL_FROM = previous.from;
    expect(saved.ok).toBe(true);
    expect(updates[0]?.verificationStatus).toBe("SUBMITTED");
    expect(notices[0]).toMatchObject({
      recipientId: adminId,
      channel: "IN_APP",
      type: "doctor.profile.review",
      entityType: "DoctorProfile",
      entityId: profileId,
    });
  });

  it("lets an administrator update an approved profile without sending it back for review", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      doctorProfile: {
        findUnique: async () => ({
          id: profileId,
          userId: doctorUserId,
          verificationStatus: "APPROVED",
          fullName: "Osman Tholley",
          displayName: "Osman Tholley",
          user: { id: doctorUserId, email: "osman@example.com", phoneE164: "+23276111222", status: "ACTIVE" },
          specialties: [{ id: "link", specialtyId, isPrimary: true, claimStatus: "VERIFIED" }],
          credentials: [],
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => updates.push(data),
      },
      specialty: { findMany: async () => [{ id: specialtyId, isActive: true }] },
      platformSetting: { findUnique: async () => null },
      user: { update: async () => ({}) },
      doctorSpecialty: {
        update: async ({ data }: { data: Record<string, unknown> }) => updates.push({ specialtyClaim: data.claimStatus }),
      },
      doctorVerificationEvent: { create: async () => { throw new Error("should not record a new review"); } },
      notification: { create: async () => { throw new Error("should not notify"); } },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    const saved = await saveDoctorProfile(
      doctorUserId,
      {
        fullName: "Osman Tholley",
        displayName: "Dr Osman Tholley",
        phone: "+23276111222",
        biography: "Mental health consultations in Freetown.",
        primarySpecialtyId: specialtyId,
        additionalSpecialtyIds: [],
        qualificationKind: "",
        qualificationTitle: "",
        qualificationInstitution: "",
        qualificationYear: "",
        licenseNumber: "",
        licenseAuthority: "",
        licenseExpiresOn: "",
        yearsExperience: "5",
        languages: "English",
        consultationOnline: true,
        consultationInPerson: false,
      },
      { db: db as never, mode: "draft", preserveApproval: true, now: new Date("2026-10-18T00:00:00Z") },
    );
    expect(saved).toEqual({ ok: true, message: "Profile saved and verified." });
    expect(updates[0]?.verificationStatus).toBe("APPROVED");
    expect(updates[0]?.biography).toBe("Mental health consultations in Freetown.");
    expect(updates[0]?.displayName).toBe("Dr Osman Tholley");
    expect(updates.some((item) => item.specialtyClaim === "VERIFIED")).toBe(true);
  });

  it("does not describe a failed delivery as sent", () => {
    const message = invitationOutcomeMessage({ delivered: false, reason: "provider_failed", baseUrlMissing: false });
    expect(message.emailSent).toBe(false);
    expect(message.message).toContain("was not sent");
    expect(credentialDownloadDecision({
      actorUserId: doctorUserId,
      actorStatus: "ACTIVE",
      actorRoles: ["DOCTOR"],
      doctorUserId,
    })).toBe("allow");
    expect(() => credentialStorageKey("../etc", "passwd")).toThrow("INVALID_STORAGE_KEY");
  });

  it("reports email as unsent when Gmail SMTP is not configured", async () => {
    const previous = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.EMAIL_FROM,
    };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_FROM;
    const result = await sendCareCircleEmail({ to: "person@example.com", subject: "Hello", text: "Body" });
    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    if (previous.host) process.env.SMTP_HOST = previous.host;
    if (previous.port) process.env.SMTP_PORT = previous.port;
    if (previous.user) process.env.SMTP_USER = previous.user;
    if (previous.pass) process.env.SMTP_PASS = previous.pass;
    if (previous.from) process.env.EMAIL_FROM = previous.from;
  });

  it("refuses a storage root inside the public directory and stores files privately", async () => {
    expect(storageRootProblem("D:/CareCircle/carecircle-mindtogether/public/uploads", "D:/CareCircle/carecircle-mindtogether")).toMatch(/public/);
    const root = await mkdtemp(path.join(os.tmpdir(), "carecircle-private-"));
    try {
      const storage = createPrivateStorage({
        STORAGE_PROVIDER: "filesystem",
        STORAGE_LOCAL_ROOT: root,
      });
      expect(storage.configured).toBe(true);
      const key = credentialStorageKey(profileId, "55555555-5555-4555-8555-555555555555");
      const body = new Uint8Array([1, 2, 3]);
      expect(await storage.put({ key, body, mimeType: "application/pdf" })).toEqual({ ok: true });
      const read = await storage.read(key);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(Array.from(read.body)).toEqual([1, 2, 3]);
      }
      expect(await storage.put({ key: "../public/secret.pdf", body, mimeType: "application/pdf" })).toEqual({
        ok: false,
        reason: "provider_failed",
      });
      expect(path.resolve(root, key).startsWith(path.resolve(process.cwd(), "public"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
