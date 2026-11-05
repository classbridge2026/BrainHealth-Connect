import type { PrismaClient } from "@prisma/client";
import { isSchemaMismatch, isUniqueConflict } from "@/lib/doctors/errors";
import { passwordRuleError } from "./password-reset";
import { displayEmail, normalizeEmail } from "./email-address";
import { forgetRememberedSessions } from "./current-user";

type Result = { ok: true; message: string } | { ok: false; message: string };

export async function updateOwnSignIn(
  db: PrismaClient,
  input: {
    userId: string;
    email: string;
    currentPassword: string;
    nextPassword: string;
    confirmPassword: string;
    currentTokenHash: string | null;
  },
  deps: {
    verifyPassword: (password: string, passwordHash: string) => Promise<boolean>;
    hashPassword: (password: string) => Promise<string>;
    now?: Date;
  },
): Promise<Result> {
  const email = displayEmail(input.email);
  const emailNormalized = normalizeEmail(input.email);
  if (!email || !emailNormalized) return { ok: false, message: "Enter a valid email address." };
  const currentPassword = input.currentPassword;
  if (!currentPassword) return { ok: false, message: "Enter your current password." };
  const nextPassword = input.nextPassword;
  const confirmPassword = input.confirmPassword;
  if (nextPassword || confirmPassword) {
    if (nextPassword !== confirmPassword) return { ok: false, message: "The new passwords do not match." };
    const passwordError = passwordRuleError(nextPassword);
    if (passwordError) return { ok: false, message: passwordError };
  }

  try {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, emailNormalized: true, passwordHash: true, deletedAt: true, status: true },
    });
    if (!user || user.deletedAt || user.status !== "ACTIVE") return { ok: false, message: "This account cannot be updated." };
    const currentMatches = await deps.verifyPassword(currentPassword, user.passwordHash);
    if (!currentMatches) return { ok: false, message: "The current password is not correct." };

    const emailChanged = emailNormalized !== user.emailNormalized;
    const passwordChanged = nextPassword.length > 0;
    if (!emailChanged && !passwordChanged) return { ok: false, message: "Enter a new email or a new password." };
    if (emailChanged) {
      const owner = await db.user.findUnique({ where: { emailNormalized }, select: { id: true } });
      if (owner && owner.id !== user.id) return { ok: false, message: "That email address is already in use." };
    }

    const now = deps.now ?? new Date();
    await db.user.update({
      where: { id: user.id },
      data: {
        ...(emailChanged ? { email, emailNormalized, emailVerifiedAt: now } : {}),
        ...(passwordChanged ? { passwordHash: await deps.hashPassword(nextPassword) } : {}),
      },
    });
    if (passwordChanged) {
      await db.session.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(input.currentTokenHash ? { tokenHash: { not: input.currentTokenHash } } : {}),
        },
        data: { revokedAt: now },
      });
      forgetRememberedSessions();
    }
    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "user.own_sign_in_updated",
        entityType: "User",
        entityId: user.id,
        metadata: { emailChanged, passwordChanged },
      },
    });
    if (emailChanged && passwordChanged) return { ok: true, message: "Email and password updated." };
    if (emailChanged) return { ok: true, message: "Email updated." };
    return { ok: true, message: "Password updated." };
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: false, message: "That email address is already in use." };
    if (isSchemaMismatch(error)) return { ok: false, message: "This action is not available until the latest database migration has been applied." };
    return { ok: false, message: "The account could not be updated." };
  }
}
