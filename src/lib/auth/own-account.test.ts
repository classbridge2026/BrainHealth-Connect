import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authenticatePatient } from "./login";
import { updateOwnSignIn } from "./own-account";
import { hashPassword, verifyPassword } from "./password";

const userId = "11111111-1111-4111-8111-111111111111";

function database(emailNormalized = "admin@example.com") {
  const sessions: Array<{ userId: string; tokenHash: string; revokedAt: Date | null }> = [
    { userId, tokenHash: "current", revokedAt: null },
    { userId, tokenHash: "other", revokedAt: null },
  ];
  let storedEmail = emailNormalized;
  let storedHash = "hash";
  const audits: Array<{ action: string; metadata: unknown }> = [];
  const db = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; emailNormalized?: string } }) => {
        if (where.emailNormalized) {
          return where.emailNormalized === storedEmail ? { id: userId } : null;
        }
        return {
          id: userId,
          email: storedEmail,
          emailNormalized: storedEmail,
          passwordHash: storedHash,
          deletedAt: null,
          status: "ACTIVE",
        };
      },
      update: async ({ data }: { data: { email?: string; emailNormalized?: string; passwordHash?: string } }) => {
        if (data.emailNormalized) storedEmail = data.emailNormalized;
        if (data.passwordHash) storedHash = data.passwordHash;
        return { id: userId };
      },
    },
    session: {
      updateMany: async ({ where }: { where: { tokenHash?: { not: string } } }) => {
        for (const session of sessions) {
          if (session.userId !== userId || session.revokedAt) continue;
          if (where.tokenHash && session.tokenHash === where.tokenHash.not) continue;
          session.revokedAt = new Date();
        }
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; metadata: unknown } }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { db: db as unknown as PrismaClient, sessions, audits, read: () => ({ storedEmail, storedHash }) };
}

const deps = {
  verifyPassword: async (password: string) => password === "Current1",
  hashPassword: async (password: string) => `hashed:${password}`,
};

describe("updateOwnSignIn", () => {
  it("rejects a wrong current password", async () => {
    const { db } = database();
    const result = await updateOwnSignIn(
      db,
      { userId, email: "admin@example.com", currentPassword: "Wrong1", nextPassword: "", confirmPassword: "", currentTokenHash: "current" },
      deps,
    );
    expect(result).toEqual({ ok: false, message: "The current password is not correct." });
  });

  it("updates the email and keeps the current session", async () => {
    const { db, sessions, read } = database();
    const result = await updateOwnSignIn(
      db,
      { userId, email: "New.Admin@example.com", currentPassword: "Current1", nextPassword: "", confirmPassword: "", currentTokenHash: "current" },
      deps,
    );
    expect(result).toEqual({ ok: true, message: "Email updated.", email: "New.Admin@example.com", previousEmail: "admin@example.com" });
    expect(read().storedEmail).toBe("new.admin@example.com");
    expect(sessions.every((session) => session.revokedAt === null)).toBe(true);
  });

  it("updates the password and signs out the other sessions", async () => {
    const { db, sessions, read } = database();
    const result = await updateOwnSignIn(
      db,
      { userId, email: "admin@example.com", currentPassword: "Current1", nextPassword: "Nextpass2", confirmPassword: "Nextpass2", currentTokenHash: "current" },
      deps,
    );
    expect(result).toEqual({ ok: true, message: "Password updated." });
    expect(read().storedHash).toBe("hashed:Nextpass2");
    expect(sessions.find((session) => session.tokenHash === "current")?.revokedAt).toBeNull();
    expect(sessions.find((session) => session.tokenHash === "other")?.revokedAt).toBeInstanceOf(Date);
  });

  it("signs in to administration with the new email and password", async () => {
    const passwordHash = await hashPassword("Current1");
    const user = {
      id: userId,
      email: "admin@example.com",
      emailNormalized: "admin@example.com",
      passwordHash,
      deletedAt: null,
      status: "ACTIVE" as const,
      roles: [{ role: { code: "SUPER_ADMIN" } }],
    };
    const db = {
      user: {
        findUnique: async ({ where }: { where: { id?: string; emailNormalized?: string } }) => {
          if (where.id && where.id !== user.id) return null;
          if (where.emailNormalized && where.emailNormalized !== user.emailNormalized) return null;
          return user;
        },
        update: async ({ data }: { data: { email?: string; emailNormalized?: string; passwordHash?: string; emailVerifiedAt?: Date } }) => {
          Object.assign(user, data);
          return user;
        },
      },
      session: {
        updateMany: async () => ({ count: 0 }),
        create: async () => ({ id: "session-1" }),
      },
      auditLog: { create: async () => ({}) },
    } as unknown as PrismaClient;

    const saved = await updateOwnSignIn(
      db,
      {
        userId,
        email: "kpallu.admin@example.com",
        currentPassword: "Current1",
        nextPassword: "Clinic24",
        confirmPassword: "Clinic24",
        currentTokenHash: "current",
      },
      { verifyPassword, hashPassword },
    );
    expect(saved).toEqual({
      ok: true,
      message: "Email and password updated.",
      email: "kpallu.admin@example.com",
      previousEmail: "admin@example.com",
    });

    const signedIn = await authenticatePatient(db, {
      identifier: "kpallu.admin@example.com",
      password: "Clinic24",
      now: new Date(),
    });
    expect(signedIn).toMatchObject({ ok: true, destination: "/admin" });

    const oldSignIn = await authenticatePatient(db, {
      identifier: "admin@example.com",
      password: "Current1",
      now: new Date(),
    });
    expect(oldSignIn).toMatchObject({ ok: false });
  });
});
