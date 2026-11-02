import { ageInYears } from "@/lib/auth/age";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CLINICAL_BODY_MAX = 8000;
export const MINOR_TREATMENT_SETTING = "MINOR_TREATMENT_ENABLED";
/// JSON true allows an authorized guardian to read a minor or dependent patient's released summaries.
/// Any other value, including a missing row, denies that access.
export const GUARDIAN_RELEASED_RECORD_SETTING = "GUARDIAN_RELEASED_RECORD_ACCESS";
export const CLINICAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type CareReason = "privacy" | "data_processing" | "telehealth" | "minor_treatment" | "guardian";
export type ConsentState = "absent" | "active" | "withdrawn";

export function utcDateOnly(value: Date | null): string | null {
  if (!value) return null;
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

export function clinicianMayDocument(input: {
  verificationStatus: string;
  userStatus: string;
  deletedAt: Date | null;
}): boolean {
  return input.verificationStatus === "APPROVED" && input.userStatus === "ACTIVE" && input.deletedAt === null;
}

export function visitAllowsClinicalRecord(status: string): boolean {
  return status === "CONFIRMED" || status === "CHECKED_IN" || status === "IN_PROGRESS" || status === "COMPLETED";
}

export function requiresGuardianAuthorization(input: {
  isDependent: boolean;
  dateOfBirth: string | null;
  now: Date;
}): boolean {
  if (input.isDependent) return true;
  if (!input.dateOfBirth) return false;
  return ageInYears(input.dateOfBirth, input.now) < 18;
}

export function consentRowIsActive(
  row: { withdrawnAt: Date | null; expiresAt?: Date | null },
  now: Date,
): boolean {
  return row.withdrawnAt === null && (row.expiresAt == null || row.expiresAt > now);
}

export function consentState(
  rows: Array<{ withdrawnAt: Date | null; expiresAt?: Date | null }>,
  now = new Date(),
): ConsentState {
  if (rows.length === 0) return "absent";
  return rows.some((row) => consentRowIsActive(row, now)) ? "active" : "withdrawn";
}

export function guardianIsAuthorized(input: {
  status: string;
  revokedAt: Date | null;
  expiresAt?: Date | null;
  now?: Date;
  guardianConsent: ConsentState;
}): boolean {
  const now = input.now ?? new Date();
  if (input.expiresAt != null && input.expiresAt <= now) return false;
  return input.status === "AUTHORIZED" && input.revokedAt === null && input.guardianConsent === "active";
}

export function careAuthorization(input: {
  privacy: ConsentState;
  dataProcessing: ConsentState;
  telehealth: ConsentState;
  mode: "ONLINE" | "IN_PERSON";
  requiresGuardian: boolean;
  minorTreatmentEnabled: boolean;
  guardianAuthorized: boolean;
}): { ok: true } | { ok: false; reason: CareReason } {
  if (input.privacy !== "active") return { ok: false, reason: "privacy" };
  if (input.dataProcessing === "withdrawn") return { ok: false, reason: "data_processing" };
  if (input.mode === "ONLINE" && input.telehealth === "withdrawn") return { ok: false, reason: "telehealth" };
  if (input.requiresGuardian && !input.minorTreatmentEnabled) return { ok: false, reason: "minor_treatment" };
  if (input.requiresGuardian && !input.guardianAuthorized) return { ok: false, reason: "guardian" };
  return { ok: true };
}

export function careBlockMessage(reason: CareReason): string {
  switch (reason) {
    case "privacy":
      return "Clinical records need a current privacy notice from the patient.";
    case "data_processing":
      return "The patient has withdrawn data-processing consent, so new clinical records cannot be added.";
    case "telehealth":
      return "The patient has withdrawn telehealth consent, so this online visit cannot receive new clinical records.";
    case "minor_treatment":
      return "Minor or dependent treatment is not enabled, so a clinical record cannot be added.";
    case "guardian":
      return "This patient needs an authorized guardian with a current guardian-authorization consent before a clinical record can be added.";
  }
}

export function clinicalWriteBlock(input: {
  doctorApproved: boolean;
  appointmentStatus: string;
  patientArchived: boolean;
  encounterArchived: boolean;
  encounterLegalHold: boolean;
  encounterStatus?: string | null;
  care: { ok: true } | { ok: false; reason: CareReason };
}): string | null {
  if (!input.doctorApproved) return "Your clinician account cannot change clinical records.";
  if (input.patientArchived) return "This patient profile is archived, so new clinical records cannot be added.";
  if (!visitAllowsClinicalRecord(input.appointmentStatus)) {
    return "Clinical records can be added after the booking is approved, while you prepare, and after the consultation is completed.";
  }
  if (!input.care.ok) return careBlockMessage(input.care.reason);
  if (input.encounterStatus === "CANCELLED") return "This consultation was cancelled, so the clinical record cannot be changed.";
  if (input.encounterArchived) return "This consultation record is archived.";
  if (input.encounterLegalHold) return "This consultation record is on legal hold.";
  return null;
}

export function encounterStatusForAppointment(status: string): "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | null {
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "CANCELLED_BY_PATIENT" || status === "CANCELLED_BY_DOCTOR" || status === "CANCELLED_BY_ADMIN" || status === "NO_SHOW") {
    return "CANCELLED";
  }
  return null;
}

export function encounterStatusLabel(status: string): string {
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Recorded";
  }
}

export function parseClinicalBody(value: string): { ok: true; body: string } | { ok: false; message: string } {
  const body = value.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, message: "Write the note before saving." };
  if (body.length > CLINICAL_BODY_MAX) return { ok: false, message: "Notes must be 8,000 characters or fewer." };
  return { ok: true, body };
}

export function parseNoteKind(value: string): "PRIVATE_WORKING" | "PATIENT_SUMMARY" | null {
  if (value === "PRIVATE_WORKING" || value === "PATIENT_SUMMARY") return value;
  return null;
}

export function noteChange(input: {
  kind: string;
  summaryReleaseStatus: string;
  archivedAt: Date | null;
  legalHold: boolean;
  action: "revise" | "release" | "withdraw" | "archive";
}): { ok: true } | { ok: false; message: string } {
  if (input.legalHold) return { ok: false, message: "This note is on legal hold and cannot be changed." };
  if (input.archivedAt) return { ok: false, message: "This note is archived." };
  if (input.action === "revise") {
    if (input.kind === "PATIENT_SUMMARY" && input.summaryReleaseStatus === "RELEASED") {
      return { ok: false, message: "Withdraw the released summary before changing it." };
    }
    return { ok: true };
  }
  if (input.action === "release") {
    if (input.kind !== "PATIENT_SUMMARY") {
      return { ok: false, message: "Working notes stay on the clinician record and are not released to the patient." };
    }
    if (input.summaryReleaseStatus === "RELEASED") return { ok: false, message: "This summary is already released." };
    return { ok: true };
  }
  if (input.action === "withdraw") {
    if (input.kind !== "PATIENT_SUMMARY" || input.summaryReleaseStatus !== "RELEASED") {
      return { ok: false, message: "Only a released patient summary can be withdrawn." };
    }
    return { ok: true };
  }
  if (input.kind === "PATIENT_SUMMARY" && input.summaryReleaseStatus === "RELEASED") {
    return { ok: false, message: "Withdraw the released summary before archiving it." };
  }
  return { ok: true };
}

export function releasedSummaryVisible(note: {
  kind: string;
  summaryReleaseStatus: string;
  archivedAt: Date | null;
  encounterArchived?: boolean;
}): boolean {
  return note.kind === "PATIENT_SUMMARY" && note.summaryReleaseStatus === "RELEASED" && note.archivedAt === null && note.encounterArchived !== true;
}

export function clinicalFileDecision(input: {
  actorUserId: string | null;
  purpose: string;
  patientUserId: string | null;
  doctorUserId: string | null;
  doctorMayDocument: boolean;
  encounterArchived: boolean;
  deleted?: boolean;
  patientVisible?: boolean;
  guardianAuthorized?: boolean;
  note: { kind: string; summaryReleaseStatus: string; archivedAt: Date | null } | null;
}): "unauthenticated" | "deny" | "doctor" | "patient" | "guardian" {
  if (!input.actorUserId) return "unauthenticated";
  if (input.purpose !== "CLINICAL_ATTACHMENT" || input.deleted) return "deny";
  if (input.doctorUserId && input.actorUserId === input.doctorUserId && input.doctorMayDocument) return "doctor";
  const released = input.note
    ? releasedSummaryVisible({
        kind: input.note.kind,
        summaryReleaseStatus: input.note.summaryReleaseStatus,
        archivedAt: input.note.archivedAt,
        encounterArchived: input.encounterArchived,
      })
    : false;
  const visible = input.patientVisible !== false;
  if (released && visible && input.patientUserId && input.actorUserId === input.patientUserId) return "patient";
  if (released && visible && input.guardianAuthorized) return "guardian";
  return "deny";
}

export type SummaryReader = "unauthenticated" | "deny" | "patient" | "guardian";

export function summaryReadDecision(input: {
  actorUserId: string | null;
  patientUserId: string;
  kind: string;
  summaryReleaseStatus: string;
  archivedAt: Date | null;
  encounterArchived: boolean;
  guardianAuthorized: boolean;
}): SummaryReader {
  if (!input.actorUserId) return "unauthenticated";
  if (!releasedSummaryVisible(input)) return "deny";
  if (input.actorUserId === input.patientUserId) return "patient";
  if (input.guardianAuthorized) return "guardian";
  return "deny";
}

export function clinicianRecordDecision(input: {
  actorUserId: string | null;
  doctorUserId: string;
  doctorMayDocument: boolean;
}): "unauthenticated" | "deny" | "allow" {
  if (!input.actorUserId) return "unauthenticated";
  if (input.actorUserId !== input.doctorUserId || !input.doctorMayDocument) return "deny";
  return "allow";
}

export function administratorMayReadClinicalContent(roleCodes: readonly string[]): boolean {
  void roleCodes;
  return false;
}

export function auditRecordMutationAllowed(roleCodes: readonly string[]): boolean {
  void roleCodes;
  return false;
}

export function guardianMayReadReleasedSummary(input: {
  policyEnabled: boolean;
  relationshipStatus: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  guardianConsent: ConsentState;
  isDependent: boolean;
  dateOfBirth: string | null;
  patientArchived: boolean;
  now: Date;
}): boolean {
  if (!input.policyEnabled || input.patientArchived) return false;
  if (!requiresGuardianAuthorization({ isDependent: input.isDependent, dateOfBirth: input.dateOfBirth, now: input.now })) return false;
  return guardianIsAuthorized({
    status: input.relationshipStatus,
    revokedAt: input.revokedAt,
    expiresAt: input.expiresAt,
    now: input.now,
    guardianConsent: input.guardianConsent,
  });
}

export function parseExpectedRevision(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1_000_000_000) return value;
  if (typeof value === "string" && /^[1-9]\d{0,8}$/.test(value)) return Number(value);
  return null;
}

export function parseAmendmentReason(value: string): { ok: true; reason: string } | { ok: false; message: string } {
  const reason = value.replace(/\r\n/g, "\n").trim();
  if (reason.length < 8) return { ok: false, message: "Enter an amendment reason of at least 8 characters." };
  if (reason.length > 500) return { ok: false, message: "Amendment reasons must be 500 characters or fewer." };
  return { ok: true, reason };
}

export function noteEditDecision(input: {
  kind: string;
  summaryReleaseStatus: string;
  archivedAt: Date | null;
  legalHold: boolean;
  state: string;
  currentRevision: number;
  expectedRevision: number | null;
  amendmentReason: string;
}): { ok: true; amendmentReason: string | null } | { ok: false; message: string } {
  const change = noteChange({ ...input, action: "revise" });
  if (!change.ok) return change;
  if (input.expectedRevision === null || input.expectedRevision !== input.currentRevision) {
    return { ok: false, message: "This note changed before your edit was saved. Reload it and try again." };
  }
  if (input.state === "FINALIZED") {
    const reason = parseAmendmentReason(input.amendmentReason);
    if (!reason.ok) return reason;
    return { ok: true, amendmentReason: reason.reason };
  }
  return { ok: true, amendmentReason: null };
}

export function noteFinalizeDecision(input: {
  state: string;
  archivedAt: Date | null;
  legalHold: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.legalHold) return { ok: false, message: "This note is on legal hold and cannot be changed." };
  if (input.archivedAt) return { ok: false, message: "This note is archived." };
  if (input.state === "FINALIZED") return { ok: false, message: "This note is already finalized." };
  if (input.state !== "DRAFT") return { ok: false, message: "This note cannot be finalized." };
  return { ok: true };
}

export function safeAuditReason(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
  return cleaned || "denied";
}

export function safeRequestId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 80);
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

const BLOCKED_AUDIT_KEYS = new Set([
  "password",
  "token",
  "secret",
  "hash",
  "cvv",
  "card",
  "pan",
  "credential",
  "body",
  "content",
  "findings",
  "diagnosis",
  "medication",
  "storagekey",
  "cookie",
  "authorization",
]);

export function clinicalAuditMetadata(
  input: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_AUDIT_KEYS.has(key.toLowerCase())) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 80) : value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function clinicalUploadByteLimit(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.CLINICAL_MAX_UPLOAD_BYTES);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > CLINICAL_UPLOAD_MAX_BYTES) return CLINICAL_UPLOAD_MAX_BYTES;
  return parsed;
}

export function clinicalMalwareScanDecision(
  env: Record<string, string | undefined> = process.env,
): { accept: true; status: "NOT_CONFIGURED" } | { accept: false; message: string } {
  if (env.CLINICAL_MALWARE_SCAN_REQUIRED === "true") {
    return {
      accept: false,
      message: "Document upload is paused because malware scanning is required and no scanner is configured.",
    };
  }
  return { accept: true, status: "NOT_CONFIGURED" };
}

const SUMMARY_SECTIONS = [
  ["reason", "Reason for the visit"],
  ["outcome", "Outcome"],
  ["findings", "What this means for you"],
  ["plan", "Care plan"],
  ["prescription", "Prescription"],
  ["followUp", "Follow-up"],
  ["additional", "Additional information"],
] as const;

export function composePatientSummary(
  input: Record<(typeof SUMMARY_SECTIONS)[number][0], string>,
): { ok: true; body: string } | { ok: false; message: string } {
  const parts = SUMMARY_SECTIONS.flatMap(([key, label]) => {
    const text = input[key].replace(/\r\n/g, "\n").trim();
    return text ? [`${label}\n${text}`] : [];
  });
  if (parts.length === 0) return { ok: false, message: "Add at least one section before saving the summary." };
  const body = parts.join("\n\n");
  if (body.length > CLINICAL_BODY_MAX) return { ok: false, message: "Summaries must be 8,000 characters or fewer." };
  return { ok: true, body };
}

export function clinicalStorageKey(patientProfileId: string, fileId: string): string {
  if (!UUID_PATTERN.test(patientProfileId) || !UUID_PATTERN.test(fileId)) {
    throw new Error("INVALID_STORAGE_KEY");
  }
  return `clinical-records/${patientProfileId}/${fileId}`;
}
