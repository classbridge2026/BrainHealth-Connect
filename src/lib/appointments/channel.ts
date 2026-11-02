export const PATIENT_CHECK_IN_MINUTES = 15;

export type VisitChannelName = "IN_PERSON" | "VIDEO" | "AUDIO";

export function parseVisitChannel(value: string | null | undefined): VisitChannelName | null {
  const raw = (value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (raw === "in-person" || raw === "inperson") return "IN_PERSON";
  if (raw === "video") return "VIDEO";
  if (raw === "audio") return "AUDIO";
  return null;
}

export function visitChannelQuery(channel: string | null | undefined): string {
  if (channel === "AUDIO") return "audio";
  if (channel === "VIDEO") return "video";
  if (channel === "IN_PERSON") return "in-person";
  return "";
}

export function visitChannelLabel(channel: string | null | undefined, mode?: string | null): string {
  if (channel === "AUDIO") return "Audio";
  if (channel === "VIDEO") return "Video";
  if (channel === "IN_PERSON") return "In person";
  if (mode === "IN_PERSON") return "In person";
  if (mode === "ONLINE") return "Video";
  return "Visit";
}
