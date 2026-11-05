import { metadataBase } from "@/lib/brand/metadata-base";
import { getSystemName } from "@/lib/brand/system-name";
import { sendCareCircleEmail } from "./delivery";

export async function notifyLoginEmailChanged(input: { to: string[]; newEmail: string }): Promise<{ delivered: boolean }> {
  const systemName = await getSystemName();
  const origin = metadataBase();
  const loginUrl = origin ? new URL("/login", origin).href : "";
  const text = [
    "Your email has been changed.",
    "",
    "Use this email and your password to sign in:",
    input.newEmail,
    "",
    loginUrl || "Open the sign-in page and use the new email with your password.",
  ].join("\n");
  const recipients = [...new Set(input.to.map((address) => address.trim()).filter(Boolean))];
  let delivered = false;
  for (const to of recipients) {
    const result = await sendCareCircleEmail({
      to,
      systemName,
      subject: `${systemName}: your email has changed`,
      text,
    });
    if (result.delivered) delivered = true;
  }
  return { delivered };
}
