import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from "./constants";
import { registerPatient } from "./register-patient";
import { createRateLimiter } from "./rate-limit";

const password = "CorrectHorse12";

const valid = {
  fullName: "Aminata Kamara",
  gender: "FEMALE",
  dateOfBirth: "1995-04-12",
  nationality: "Sierra Leonean",
  phone: "076000001",
  email: "aminata@example.com",
  residentialAddress: "12 Wilberforce",
  password,
  confirmPassword: password,
  acceptTerms: true,
  acceptPrivacy: true,
  role: "SUPER_ADMIN",
  status: "ACTIVE",
};

type Stored = Record<string, unknown>;

function createDb(options?: { failProfile?: boolean; emails?: Set<string>; phones?: Set<string> }) {
  const emails = options?.emails ?? new Set<string>();
  const phones = options?.phones ?? new Set<string>();
  const stored: Stored[] = [];
  const roleLookups: string[] = [];
  const db = {
    platformSetting: {
      findUnique: async () => ({ valueJson: false }),
    },
    notification: {
      createMany: async () => ({ count: 0 }),
    },
    session: {
      create: async () => ({ id: "session-1" }),
    },
    role: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        roleLookups.push(where.code);
        return where.code === "PATIENT" ? { id: "role-patient" } : null;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { emailNormalized?: string; phoneE164?: string } }) => {
        if (where.emailNormalized && emails.has(where.emailNormalized)) return { id: "existing-email" };
        if (where.phoneE164 && phones.has(where.phoneE164)) return { id: "existing-phone" };
        return null;
      },
      create: async ({ data }: { data: Stored }) => {
        const email = String(data.emailNormalized);
        const phone = String(data.phoneE164);
        if (emails.has(email) || phones.has(phone)) {
          const error = new Error("Unique constraint failed");
          (error as Error & { code: string }).code = "P2002";
          throw error;
        }
        if (options?.failProfile) {
          throw new Error("profile_failed");
        }
        emails.add(email);
        phones.add(phone);
        const id = String(data.id ?? `user-${emails.size}`);
        stored.push({ kind: "user", id, ...data });
        const roles = data.roles as { create?: Stored } | undefined;
        if (roles?.create) stored.push({ kind: "userRole", userId: id, ...roles.create });
        const profile = data.patientProfile as { create?: Stored } | undefined;
        if (profile?.create) stored.push({ kind: "profile", userId: id, ...profile.create });
        const consents = data.consents as { create?: Stored[] } | undefined;
        if (consents?.create) {
          stored.push({
            kind: "consent",
            data: consents.create.map((row) => ({ userId: id, ...row })),
          });
        }
        return { id };
      },
    },
  };
  return { db: db as unknown as PrismaClient, stored, roleLookups, emails };
}

function deps(db: PrismaClient) {
  return {
    db,
    hashPassword: async (value: string) => `hashed:${value.length}`,
    rateLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    ipHash: "ip-hash",
    now: () => new Date("2026-10-18T12:00:00.000Z"),
    appBaseUrl: "http://localhost:3000",
  };
}

describe("patient registration", () => {
  beforeEach(() => {
    process.env.VERIFICATION_PEPPER = "test-pepper";
  });

  it("opens an active patient account without sending a verification message", async () => {
    const { db, stored, roleLookups } = createDb();
    const result = await registerPatient(valid, deps(db));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain("portal");
    expect(result.sessionToken).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain("hashed:");
    expect(JSON.stringify(result)).not.toContain("verify/email");

    expect(roleLookups).toEqual(["PATIENT"]);
    const user = stored.find((row) => row.kind === "user");
    expect(user).toMatchObject({
      status: "ACTIVE",
      passwordHash: `hashed:${password.length}`,
      emailNormalized: "aminata@example.com",
      phoneE164: "+23276000001",
    });
    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("confirmPassword");
    expect(stored.find((row) => row.kind === "userRole")).toMatchObject({ roleId: "role-patient" });
    expect(stored.find((row) => row.kind === "profile")).toMatchObject({
      fullName: "Aminata Kamara",
      gender: "FEMALE",
      dateOfBirth: new Date("1995-04-12T00:00:00.000Z"),
      isDependent: false,
    });
    expect(stored.find((row) => row.kind === "consent")).toMatchObject({
      data: [
        expect.objectContaining({
          consentType: "TERMS_OF_USE",
          documentVersion: TERMS_DOCUMENT_VERSION,
        }),
        expect.objectContaining({
          consentType: "PRIVACY_NOTICE",
          documentVersion: PRIVACY_DOCUMENT_VERSION,
        }),
      ],
    });
    expect(JSON.stringify(stored)).not.toContain("DOCTOR");
    expect(JSON.stringify(stored)).not.toContain("SUPER_ADMIN");
  });

  it("returns a generic duplicate message and rolls back a failed profile write", async () => {
    const sharedEmails = new Set<string>();
    const sharedPhones = new Set<string>();
    const first = createDb({ emails: sharedEmails, phones: sharedPhones });
    expect((await registerPatient(valid, deps(first.db))).ok).toBe(true);

    const duplicate = await registerPatient(
      { ...valid, phone: "076000009" },
      deps(createDb({ emails: sharedEmails, phones: sharedPhones }).db),
    );
    expect(duplicate).toEqual({
      ok: false,
      formMessage: "This email address is already registered. Sign in with it, or use a different email.",
      fieldErrors: { email: "This email address is already registered. Sign in with it, or use a different email." },
    });

    const duplicatePhone = await registerPatient(
      { ...valid, email: "other@example.com", phone: "076000001" },
      deps(createDb({ emails: sharedEmails, phones: sharedPhones }).db),
    );
    expect(duplicatePhone).toMatchObject({
      ok: false,
      fieldErrors: { phone: "This phone number is already registered. Sign in with it, or use a different phone number." },
    });

    const failing = createDb({ failProfile: true });
    const failed = await registerPatient(
      { ...valid, email: "other@example.com", phone: "076000008" },
      deps(failing.db),
    );
    expect(failed.ok).toBe(false);
    expect(failing.stored).toHaveLength(0);
    expect(failing.emails.size).toBe(0);
    expect(JSON.stringify(failed)).not.toContain(password);
  });

  it("lets only one of two concurrent registrations keep an email", async () => {
    const sharedEmails = new Set<string>();
    const sharedPhones = new Set<string>();
    const results = await Promise.all([
      registerPatient(valid, deps(createDb({ emails: sharedEmails, phones: sharedPhones }).db)),
      registerPatient(
        { ...valid, phone: "076000007" },
        deps(createDb({ emails: sharedEmails, phones: sharedPhones }).db),
      ),
    ]);
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      fieldErrors: { email: "This email address is already registered. Sign in with it, or use a different email." },
    });
    expect(sharedEmails.size).toBe(1);
  });

  it("rate limits repeated registration attempts", async () => {
    const { db } = createDb();
    const limited = {
      ...deps(db),
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    };
    expect((await registerPatient(valid, limited)).ok).toBe(true);
    const blocked = await registerPatient(
      { ...valid, email: "second@example.com", phone: "076000003" },
      limited,
    );
    expect(blocked).toMatchObject({ ok: false });
    if (!blocked.ok) {
      expect(blocked.formMessage).toContain("Too many registration attempts");
    }
  });
});
