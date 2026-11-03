const CONTROLS = [
  "Create doctor and send invitation",
  "Open consultation",
  "Continue consultation",
  "End consultation",
  "Grant administrator",
  "Book appointment",
  "Find a Doctor",
  "Verify address",
  "New location",
  "New specialty",
  "New service",
  "Assign service",
  "Add doctor",
  "Doctor invitations",
  "Doctor verification",
  "Doctor offerings",
  "Fees and pricing",
  "Screening management",
  "Screening Centre",
  "Mark all read",
  "Start screening",
  "Doctors",
  "Approve",
  "Decline",
].sort((left, right) => right.length - left.length);

/** Names the control a person should click, without wrapping a name twice. */
export function markClickTargets(line: string) {
  let text = line.replace(/^(Open|Choose|Press|Use) (?=[A-Z])/, "Click ");
  for (const name of CONTROLS) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<!\\*)\\b${escaped}\\b(?!\\*)`, "g"), `**${name}**`);
  }
  return text;
}
