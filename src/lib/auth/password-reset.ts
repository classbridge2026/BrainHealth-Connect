import type { PrismaClient } from "@prisma/client";
import type { DeliveryResult } from "./delivery";
import { normalizeEmail } from "./email-address";
import { normalizePhone } from "./phone";
import { passwordRuleError } from "./password-rule";
import { createEmailToken, hashEmailToken } from "./tokens";

export { passwordRuleError };

export const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;

export const RESET_NOT_SENT =
  "If those details match an account, reset instructions are sent by email. No email was sent, because email delivery is not configured.";

export const RESET_SENT =
  "If those details match an account, password reset instructions were sent.";

export const RESET_LINK_INVALID = "This reset link is not valid. Request a new one.";

export type ResetDelivery = (input: { to: string; resetUrl: string }) => Promise<DeliveryResult>;

/**
 * Looks up an account and hands a reset URL to delivery.
 * The public result never includes the token. Nothing is stored when delivery does not succeed.
 */
export async function requestPasswordReset(
  db: PrismaClient,
  input: { identifier: string; now: Date; appBaseUrl: string | null },
  deliver: ResetDelivery,
): Promise<{ delivered: boolean }> {
  const raw = input.identifier.trim();
  const emailNormalized = normalizeEmail(raw);
  const phoneE164 = emailNormalized ? null : normalizePhone(raw);
  const accountSelect = { id: true, email: true, status: true, deletedAt: true } as const;
  const user =
    emailNormalized || phoneE164
      ? emailNormalized
        ? await db.user.findUnique({ where: { emailNormalized }, select: accountSelect })
        : await db.user.findUnique({ where: { phoneE164: phoneE164 ?? undefined }, select: accountSelect })
      : null;

  if (!user || user.deletedAt || user.status === "DISABLED" || !input.appBaseUrl) {
    return { delivered: false };
  }

  const token = createEmailToken();
  const resetUrl = `${input.appBaseUrl}/reset-password?token=${encodeURIComponent(token.raw)}`;
  let result: DeliveryResult;
  try {
    result = await deliver({ to: user.email, resetUrl });
  } catch {
    return { delivered: false };
  }
  if (!result.delivered) {
    return { delivered: false };
  }

  await db.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: input.now },
  });
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: token.hash,
      expiresAt: new Date(input.now.getTime() + PASSWORD_RESET_TTL_MS),
    },
  });
  return { delivered: true };
}

export async function completePasswordReset(
  db: PrismaClient,
  input: { token: string; password: string; now: Date },
  hashPassword: (password: string) => Promise<string>,
): Promise<{ ok: true } | { ok: false; formMessage: string }> {
  const ruleError = passwordRuleError(input.password);
  if (ruleError) {
    return { ok: false, formMessage: ruleError };
  }
  const raw = input.token.trim();
  if (!raw) {
    return { ok: false, formMessage: RESET_LINK_INVALID };
  }

  const tokenHash = hashEmailToken(raw);
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt <= input.now) {
    return { ok: false, formMessage: RESET_LINK_INVALID };
  }

  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: input.now } });
  });
  return { ok: true };
}
