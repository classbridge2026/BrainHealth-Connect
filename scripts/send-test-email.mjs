/**
 * Development-only Gmail SMTP check.
 * Usage: node scripts/send-test-email.mjs recipient@example.com
 * Refuses to run when NODE_ENV is production. Does not print credentials.
 */
import "dotenv/config";
import nodemailer from "nodemailer";

const recipient = process.argv[2]?.trim() ?? "";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (process.env.NODE_ENV === "production") {
  console.error("email_test_refused");
  process.exitCode = 1;
} else if (!emailPattern.test(recipient)) {
  console.error("email_test_needs_recipient");
  process.exitCode = 1;
} else {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT?.trim());
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s/g, "");
  const from = process.env.EMAIL_FROM?.trim();
  if (host !== "smtp.gmail.com" || port !== 465 || !user || !pass || !from) {
    console.error("email_test_not_configured");
    process.exitCode = 1;
  } else {
    try {
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: true,
        auth: { user, pass },
      });
      const text = `This is a development test from CareCircle MindTogether. No account was changed.\n\nThis message was sent to ${recipient}.`;
      await transport.sendMail({
        from: user,
        replyTo: user,
        envelope: { from: user, to: recipient },
        to: recipient,
        subject: "CareCircle MindTogether account check",
        text,
      });
      console.log("email_test_sent");
    } catch {
      console.error("email_test_failed");
      process.exitCode = 1;
    }
  }
}
