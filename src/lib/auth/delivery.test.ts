import { afterEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { emailProviderConfigured, sendCareCircleEmail } from "./delivery";

const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const;

function clearSmtp() {
  for (const key of SMTP_KEYS) delete process.env[key];
}

function configureSmtp() {
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "account@example.com";
  process.env.SMTP_PASS = "app-password-value";
  process.env.EMAIL_FROM = "CareCircle MindTogether <account@example.com>";
}

afterEach(() => {
  clearSmtp();
  sendMail.mockReset();
  createTransport.mockClear();
});

describe("gmail smtp delivery", () => {
  it("does not open a connection when smtp settings are missing", async () => {
    clearSmtp();
    expect(emailProviderConfigured()).toBe(false);
    const result = await sendCareCircleEmail({ to: "person@example.com", subject: "Hello", text: "Body" });
    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("rejects a host or port other than Gmail SSL", async () => {
    configureSmtp();
    process.env.SMTP_PORT = "587";
    expect(emailProviderConfigured()).toBe(false);
    process.env.SMTP_PORT = "465";
    process.env.SMTP_HOST = "smtp.example.com";
    const result = await sendCareCircleEmail({ to: "person@example.com", subject: "Hello", text: "Body" });
    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends through Gmail on port 465 and reports provider failure without the password", async () => {
    configureSmtp();
    sendMail.mockResolvedValueOnce({ messageId: "queued" });
    const sent = await sendCareCircleEmail({
      to: "person@example.com",
      subject: "Hello",
      text: "Body",
    });
    expect(sent).toEqual({ delivered: true, reason: "sent" });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "account@example.com", pass: "app-password-value" },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: "CareCircle MindTogether", address: "account@example.com" },
      replyTo: { name: "CareCircle MindTogether", address: "account@example.com" },
      envelope: { from: "account@example.com", to: "person@example.com" },
      to: "person@example.com",
      subject: "Hello",
      text: "Body\n\nCareCircle MindTogether sent this message about your account. You can reply to this email if you need help.",
      html: expect.stringContaining("Body"),
      textEncoding: "quoted-printable",
      xMailer: false,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    });

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendMail.mockRejectedValueOnce(new Error("Invalid login: app-password-value"));
    const failed = await sendCareCircleEmail({ to: "person@example.com", subject: "Hello", text: "secret-body" });
    expect(failed).toEqual({ delivered: false, reason: "provider_failed" });
    expect(errorLog).toHaveBeenCalledWith("smtp_send_failed");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("app-password-value");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret-body");
    errorLog.mockRestore();
  });

  it("labels a portal link instead of showing the full address as the link text", async () => {
    configureSmtp();
    sendMail.mockResolvedValueOnce({ messageId: "queued" });
    await sendCareCircleEmail({
      to: "person@example.com",
      subject: "Hello",
      text: "Open the page.\n\nhttps://brain-health-connect.vercel.app/doctor/invitation?token=abc",
    });
    const html = String(sendMail.mock.calls[0]?.[0]?.html ?? "");
    expect(html).toContain(">Open your invitation</a>");
    expect(html).not.toContain(">https://brain-health-connect.vercel.app/doctor/invitation?token=abc</a>");
  });
});
