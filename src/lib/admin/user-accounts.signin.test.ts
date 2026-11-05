import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { updateUserAccount } from "./user-accounts";
import { authenticatePatient } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";

const userId = "11111111-1111-4111-8111-111111111111";

describe("administration sign-in update", () => {
  it("lets the administrator sign in with the saved email and password", async () => {
    const user = {
      id: userId,
      email: "admin@example.com",
      emailNormalized: "admin@example.com",
      phoneE164: null as string | null,
      status: "ACTIVE" as const,
      timezone: "Africa/Freetown",
      deletedAt: null,
      passwordHash: await hashPassword("Oldpass1"),
      emailVerifiedAt: null as Date | null,
      roles: [{ role: { code: "SUPER_ADMIN" } }],
      patientProfile: null,
      doctorProfile: null,
    };
    const db = {
      user: {
        findUnique: async ({ where }: { where: { id?: string; emailNormalized?: string } }) => {
          if (where.id) return where.id === user.id ? user : null;
          if (where.emailNormalized) return where.emailNormalized === user.emailNormalized ? user : null;
          return null;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(user, data);
          return user;
        },
      },
      session: {
        updateMany: async () => ({ count: 1 }),
        create: async () => ({ id: "session-1" }),
      },
      auditLog: { create: async () => ({}) },
    } as unknown as PrismaClient;

    const saved = await updateUserAccount(
      {
        userId,
        fullName: "",
        email: "kpallu.admin@example.com",
        phone: "",
        timezone: "Africa/Freetown",
        status: "ACTIVE",
        password: "Clinic24",
      },
      { db, actor: { userId, roleCodes: ["SUPER_ADMIN"] } },
    );
    expect(saved).toEqual({ ok: true, message: "Updated kpallu.admin@example.com." });

    const signedIn = await authenticatePatient(db, {
      identifier: "Kpallu.Admin@example.com",
      password: "Clinic24",
      now: new Date(),
    });
    expect(signedIn).toMatchObject({ ok: true, destination: "/admin" });

    const oldSignIn = await authenticatePatient(db, {
      identifier: "admin@example.com",
      password: "Oldpass1",
      now: new Date(),
    });
    expect(oldSignIn.ok).toBe(false);
  });
});
