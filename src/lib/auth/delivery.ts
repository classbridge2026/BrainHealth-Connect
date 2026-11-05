import nodemailer from "nodemailer";
import { metadataBase } from "@/lib/brand/metadata-base";
import { DEFAULT_SYSTEM_NAME, getSystemName } from "@/lib/brand/system-name";

export type DeliveryResult = {
  delivered: boolean;
  reason: "sent" | "not_configured" | "provider_failed";
  providerMessageId?: string | null;
};

export type EmailDelivery = {
  sendEmailVerification: (input: { to: string; verifyUrl: string }) => Promise<DeliveryResult>;
};

export const EMAIL_CONFIGURATION_HINT =
  "Set SMTP_HOST to smtp.gmail.com, SMTP_PORT to 465, and set SMTP_USER, SMTP_PASS, and EMAIL_FROM. An invitation is reported as sent only after Gmail accepts it.";

const GMAIL_HOST = "smtp.gmail.com";
const GMAIL_PORT = 465;

type SmtpSettings = {
  host: typeof GMAIL_HOST;
  port: typeof GMAIL_PORT;
  user: string;
  pass: string;
  from: string;
};

export function readSmtpSettings(env: NodeJS.ProcessEnv = process.env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT?.trim());
  const user = env.SMTP_USER?.trim();
  // Google shows an App Password in groups of four. The spaces are not part of the password.
  const pass = env.SMTP_PASS?.replace(/\s/g, "");
  const from = env.EMAIL_FROM?.trim();
  if (host !== GMAIL_HOST || port !== GMAIL_PORT || !user || !pass || !from) {
    return null;
  }
  return { host, port, user, pass, from };
}

export function emailProviderConfigured(): boolean {
  return readSmtpSettings() !== null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkLabel(url: string): string {
  try {
    const path = new URL(url.replace(/&amp;/g, "&")).pathname;
    if (path.includes("/doctor/invitation")) return "Open your invitation";
    if (path.includes("password")) return "Choose a new password";
    if (path.endsWith("/login")) return "Sign in";
    if (path.includes("verify")) return "Confirm your email";
    if (path.includes("appointment")) return "Open the appointment";
    return "Open the portal";
  } catch {
    return "Open the portal";
  }
}

function messageHtml(text: string, systemName: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const linked = escapeHtml(paragraph).replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" style="color:#0f766e;font-weight:700">${linkLabel(url)}</a>`,
      );
      return `<p style="margin:0 0 16px">${linked.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(systemName)}</title></head><body style="margin:0;padding:24px;background:#ffffff;color:#12304a;font-family:Arial,sans-serif;font-size:16px;line-height:1.5"><div style="max-width:560px">${paragraphs}</div></body></html>`;
}

function accountFooter(systemName: string): string {
  return `${systemName} sent this message about your account. You can reply to this email if you need help.`;
}

export async function sendCareCircleEmail(input: {
  to: string;
  subject: string;
  text: string;
  systemName?: string;
}): Promise<DeliveryResult> {
  const settings = readSmtpSettings();
  if (!settings) {
    return { delivered: false, reason: "not_configured" };
  }
  const systemName = input.systemName?.trim() || DEFAULT_SYSTEM_NAME;
  const text = `${input.text.trim()}\n\n${accountFooter(systemName)}`;
  try {
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: true,
      auth: { user: settings.user, pass: settings.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({
      from: { name: systemName, address: settings.user },
      replyTo: { name: systemName, address: settings.user },
      envelope: { from: settings.user, to: input.to },
      to: input.to,
      subject: input.subject,
      text,
      html: messageHtml(text, systemName),
      textEncoding: "quoted-printable",
      xMailer: false,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    });
    return { delivered: true, reason: "sent" };
  } catch {
    console.error("smtp_send_failed");
    return { delivered: false, reason: "provider_failed" };
  }
}

export const unconfiguredEmailDelivery: EmailDelivery = {
  async sendEmailVerification() {
    return { delivered: false, reason: "not_configured" };
  },
};

export function createEmailDelivery(): EmailDelivery {
  return {
    async sendEmailVerification({ to, verifyUrl }) {
      const systemName = await getSystemName();
      return sendCareCircleEmail({
        to,
        systemName,
        subject: `${systemName}: confirm your email`,
        text: [
          `Confirm your email address for ${systemName}.`,
          "",
          verifyUrl,
          "",
          "This link can be used once. If you did not create this account, you can ignore this message.",
        ].join("\n"),
      });
    },
  };
}

export function signInPageUrl(): string {
  const base = metadataBase();
  return base ? new URL("/login", base).toString() : "/login";
}

/** Tells the account to sign in with the new email and the existing password. */
export async function sendSignInEmailChanged(input: { to: string; newEmail: string }): Promise<DeliveryResult> {
  const systemName = await getSystemName();
  return sendCareCircleEmail({
    to: input.to,
    systemName,
    subject: `${systemName}: your email has changed`,
    text: [
      "Your email has been changed.",
      "",
      "Use this email and your password to sign in:",
      input.newEmail,
      "",
      signInPageUrl(),
    ].join("\n"),
  });
}

export function verificationDeliveryMessage(input: { email: DeliveryResult; systemName?: string }): string {
  if (input.email.delivered) {
    return "Your account is waiting for verification. Use the message sent to your email.";
  }
  const systemName = input.systemName?.trim() || DEFAULT_SYSTEM_NAME;
  return `Your account was created and is waiting for verification. ${systemName} could not send an email because email delivery is not configured.`;
}
