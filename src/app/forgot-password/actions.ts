"use server";

import { emailProviderConfigured, sendCareCircleEmail } from "@/lib/auth/delivery";
import { RESET_NOT_SENT, RESET_SENT, requestPasswordReset } from "@/lib/auth/password-reset";
import { appBaseUrlFromEnv } from "@/lib/auth/register-patient";
import { requestContext } from "@/lib/auth/request-context";
import { sharedRateLimiter } from "@/lib/auth/rate-limit";
import { getSystemName } from "@/lib/brand/system-name";
import { prisma } from "@/lib/db/prisma";

const resetLimiter = sharedRateLimiter("password-reset", { limit: 5, windowMs: 15 * 60 * 1000 });

export type ForgotPasswordState = {
  identifierError?: string;
  formMessage?: string;
};

async function deliverReset(input: { to: string; resetUrl: string }) {
  const systemName = await getSystemName();
  return sendCareCircleEmail({
    to: input.to,
    systemName,
    subject: `${systemName}: password reset request`,
    text: [
      `A password reset was requested for your ${systemName} account.`,
      "",
      "This link expires in 60 minutes and can be used once. A newer request replaces this link.",
      input.resetUrl,
      "",
      "If you did not ask for this, you can ignore the message.",
    ].join("\n"),
  });
}

export async function requestReset(_previous: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) {
    return { identifierError: "Enter the email address or phone number for the account." };
  }

  const context = await requestContext();
  const rate = resetLimiter.check(`reset:${context.ipHash}`);
  if (!rate.allowed) {
    return { formMessage: "Too many reset attempts. Wait before trying again." };
  }

  const appBaseUrl = appBaseUrlFromEnv(context.origin);
  if (!emailProviderConfigured() || !appBaseUrl) {
    return { formMessage: RESET_NOT_SENT };
  }

  try {
    await requestPasswordReset(prisma, { identifier, now: new Date(), appBaseUrl }, deliverReset);
    // Same reply whether the account exists. The reset row is stored only after Gmail accepts the message.
    return { formMessage: RESET_SENT };
  } catch {
    return { formMessage: "We could not start a password reset. Try again." };
  }
}
