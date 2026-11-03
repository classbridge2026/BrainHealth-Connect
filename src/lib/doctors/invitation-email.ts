export function formatWhen(value: Date): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(value) + " UTC"
  );
}

function portalHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function doctorInvitationText(input: {
  doctorName: string;
  systemName: string;
  inviteUrl: string;
  expiresAt: Date;
}): { subject: string; text: string } {
  const host = portalHost(input.inviteUrl);
  return {
    subject: `${input.systemName}: doctor invitation`,
    text: [
      `Hello ${input.doctorName},`,
      "",
      `An administrator at ${input.systemName} created a doctor account for you.`,
      host ? `The link below opens on ${host}.` : "The link below opens the portal.",
      "Use it to set your password and finish your professional profile.",
      "",
      input.inviteUrl,
      "",
      `The link stops working at ${formatWhen(input.expiresAt)} and can be used once.`,
      "",
      "Patients can be assigned only after an administrator verifies the profile.",
      "",
      "If you were not expecting this account, you can ignore this message.",
    ].join("\n"),
  };
}
