import { describe, expect, it } from "vitest";
import {
  administratorMayReadClinicalContent,
  auditRecordMutationAllowed,
  careAuthorization,
  clinicalAuditMetadata,
  clinicalFileDecision,
  clinicalMalwareScanDecision,
  clinicianRecordDecision,
  consentState,
  guardianMayReadReleasedSummary,
  noteChange,
  noteEditDecision,
  noteFinalizeDecision,
  summaryReadDecision,
} from "./rules";
import { releasePatientSummary, saveClinicalNote } from "./records";

const now = new Date("2026-10-25T12:00:00.000Z");
const patientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const patientB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const doctorA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const doctorB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const released = { kind: "PATIENT_SUMMARY", summaryReleaseStatus: "RELEASED", archivedAt: null, encounterArchived: false };

describe("phase 8 clinical privacy decisions", () => {
  it("keeps another patient's private notes and released summaries closed", () => {
    expect(summaryReadDecision({ actorUserId: patientA, patientUserId: patientB, kind: "PRIVATE_WORKING", summaryReleaseStatus: "NOT_RELEASED", archivedAt: null, encounterArchived: false, guardianAuthorized: false })).toBe("deny");
    expect(summaryReadDecision({ actorUserId: patientA, patientUserId: patientB, ...released, guardianAuthorized: false })).toBe("deny");
  });

  it("hides a patient's own private notes and unreleased summaries", () => {
    expect(summaryReadDecision({ actorUserId: patientA, patientUserId: patientA, kind: "PRIVATE_WORKING", summaryReleaseStatus: "RELEASED", archivedAt: null, encounterArchived: false, guardianAuthorized: false })).toBe("deny");
    expect(summaryReadDecision({ actorUserId: patientA, patientUserId: patientA, kind: "PATIENT_SUMMARY", summaryReleaseStatus: "NOT_RELEASED", archivedAt: null, encounterArchived: false, guardianAuthorized: false })).toBe("deny");
    expect(summaryReadDecision({ actorUserId: patientA, patientUserId: patientA, kind: "PATIENT_SUMMARY", summaryReleaseStatus: "WITHDRAWN", archivedAt: null, encounterArchived: false, guardianAuthorized: false })).toBe("deny");
  });

  it("lets a patient read only their own released summary", () => {
    expect(summaryReadDecision({ actorUserId: patientA, patientUserId: patientA, ...released, guardianAuthorized: false })).toBe("patient");
  });

  it("does not let a different record id change the patient check", () => {
    const first = summaryReadDecision({ actorUserId: patientA, patientUserId: patientB, ...released, guardianAuthorized: false });
    const swapped = summaryReadDecision({ actorUserId: patientA, patientUserId: patientB, ...released, guardianAuthorized: false });
    expect(first).toBe("deny");
    expect(swapped).toBe(first);
  });

  it("limits clinicians to the assigned doctor and blocks unrelated doctors", () => {
    expect(clinicianRecordDecision({ actorUserId: doctorB, doctorUserId: doctorA, doctorMayDocument: true })).toBe("deny");
    expect(clinicianRecordDecision({ actorUserId: doctorA, doctorUserId: doctorA, doctorMayDocument: true })).toBe("allow");
    expect(clinicianRecordDecision({ actorUserId: doctorA, doctorUserId: doctorA, doctorMayDocument: false })).toBe("deny");
    expect(clinicianRecordDecision({ actorUserId: doctorB, doctorUserId: doctorA, doctorMayDocument: true, coversVisit: true })).toBe("allow");
    expect(clinicianRecordDecision({ actorUserId: doctorB, doctorUserId: doctorA, doctorMayDocument: false, coversVisit: true })).toBe("deny");
  });

  it("blocks a guardian from an unrelated, adult, or revoked patient", () => {
    const base = {
      policyEnabled: true,
      relationshipStatus: "AUTHORIZED",
      revokedAt: null,
      expiresAt: null,
      guardianConsent: "active" as const,
      isDependent: true,
      dateOfBirth: "2014-01-01",
      patientArchived: false,
      now,
    };
    expect(guardianMayReadReleasedSummary(base)).toBe(true);
    expect(guardianMayReadReleasedSummary({ ...base, policyEnabled: false })).toBe(false);
    expect(guardianMayReadReleasedSummary({ ...base, relationshipStatus: "REVOKED", revokedAt: now })).toBe(false);
    expect(guardianMayReadReleasedSummary({ ...base, isDependent: false, dateOfBirth: "1990-01-01" })).toBe(false);
    expect(guardianMayReadReleasedSummary({ ...base, expiresAt: new Date("2026-10-01T00:00:00.000Z") })).toBe(false);
    expect(summaryReadDecision({ actorUserId: "guardian", patientUserId: patientA, ...released, guardianAuthorized: false })).toBe("deny");
  });

  it("treats expired or withdrawn consent as blocking new clinical records", () => {
    expect(consentState([{ withdrawnAt: null, expiresAt: new Date("2026-10-01T00:00:00.000Z") }], now)).toBe("withdrawn");
    expect(careAuthorization({
      privacy: "withdrawn",
      dataProcessing: "active",
      telehealth: "active",
      mode: "IN_PERSON",
      requiresGuardian: false,
      minorTreatmentEnabled: false,
      guardianAuthorized: false,
    })).toEqual({ ok: false, reason: "privacy" });
  });

  it("refuses private documents, silent overwrites, and unauthorized release", () => {
    expect(clinicalFileDecision({
      actorUserId: null,
      purpose: "CLINICAL_ATTACHMENT",
      patientUserId: patientA,
      doctorUserId: doctorA,
      doctorMayDocument: true,
      encounterArchived: false,
      patientVisible: true,
      note: released,
    })).toBe("unauthenticated");
    expect(clinicalFileDecision({
      actorUserId: patientB,
      purpose: "CLINICAL_ATTACHMENT",
      patientUserId: patientA,
      doctorUserId: doctorA,
      doctorMayDocument: true,
      encounterArchived: false,
      patientVisible: true,
      guardianAuthorized: false,
      note: released,
    })).toBe("deny");
    expect(clinicalFileDecision({
      actorUserId: patientA,
      purpose: "CLINICAL_ATTACHMENT",
      patientUserId: patientA,
      doctorUserId: doctorA,
      doctorMayDocument: true,
      encounterArchived: false,
      patientVisible: false,
      note: released,
    })).toBe("deny");
    expect(noteEditDecision({
      kind: "PRIVATE_WORKING",
      summaryReleaseStatus: "NOT_RELEASED",
      archivedAt: null,
      legalHold: false,
      state: "DRAFT",
      currentRevision: 2,
      expectedRevision: 1,
      amendmentReason: "",
    }).ok).toBe(false);
    expect(noteEditDecision({
      kind: "PRIVATE_WORKING",
      summaryReleaseStatus: "NOT_RELEASED",
      archivedAt: null,
      legalHold: false,
      state: "FINALIZED",
      currentRevision: 2,
      expectedRevision: 2,
      amendmentReason: "Corrected the follow-up date.",
    })).toEqual({ ok: true, amendmentReason: "Corrected the follow-up date." });
    expect(noteChange({ kind: "PRIVATE_WORKING", summaryReleaseStatus: "NOT_RELEASED", archivedAt: null, legalHold: false, action: "release" }).ok).toBe(false);
    expect(noteFinalizeDecision({ state: "DRAFT", archivedAt: null, legalHold: false }).ok).toBe(true);
  });

  it("keeps administrators and every role from changing audit rows or reading note text by role alone", () => {
    expect(administratorMayReadClinicalContent(["ADMIN"])).toBe(false);
    expect(administratorMayReadClinicalContent(["SUPER_ADMIN"])).toBe(false);
    expect(auditRecordMutationAllowed(["PATIENT"])).toBe(false);
    expect(auditRecordMutationAllowed(["DOCTOR"])).toBe(false);
    expect(auditRecordMutationAllowed(["ADMIN"])).toBe(false);
    expect(auditRecordMutationAllowed(["SUPER_ADMIN"])).toBe(false);
    expect(clinicalAuditMetadata({ body: "private note", kind: "PRIVATE_WORKING", version: 2 })).toEqual({ kind: "PRIVATE_WORKING", version: 2 });
    expect(clinicianRecordDecision({ actorUserId: null, doctorUserId: doctorA, doctorMayDocument: true })).toBe("unauthenticated");
    expect(clinicalMalwareScanDecision({ CLINICAL_MALWARE_SCAN_REQUIRED: "true" }).accept).toBe(false);
    expect(clinicalMalwareScanDecision({}).accept).toBe(true);
  });
});

describe("phase 8 clinical record services", () => {
  const appointmentId = "11111111-1111-4111-8111-111111111111";
  const patientProfileId = "22222222-2222-4222-8222-222222222222";
  const encounterId = "66666666-6666-4666-8666-666666666666";
  const noteId = "77777777-7777-4777-8777-777777777777";

  function visit(doctorUserId: string) {
    return {
      id: appointmentId,
      status: "IN_PROGRESS",
      mode: "IN_PERSON",
      patientProfileId,
      doctorProfileId: "55555555-5555-4555-8555-555555555555",
      patient: {
        id: patientProfileId,
        userId: patientA,
        fullName: "Patient A",
        isDependent: false,
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        archivedAt: null,
      },
      doctor: {
        id: "55555555-5555-4555-8555-555555555555",
        userId: doctorUserId,
        verificationStatus: "APPROVED",
        user: { status: "ACTIVE", deletedAt: null },
      },
      specialty: { name: "Psychiatry" },
      consultationService: { name: "Consultation" },
      encounter: { id: encounterId, startedAt: now, endedAt: null, archivedAt: null, legalHold: false, status: "IN_PROGRESS" },
    };
  }

  function dbFor(note: { kind: string; summaryReleaseStatus: string; revision: number; state?: string }, doctorUserId = doctorA) {
    const audits: Array<{ action: string; metadata?: unknown }> = [];
    const releases: Array<Record<string, unknown>> = [];
    let versionCreates = 0;
    let noteUpdates = 0;
    const db = {
      appointment: { findUnique: async () => visit(doctorUserId) },
      user: { findUnique: async () => ({ roles: [{ role: { code: "DOCTOR" } }] }) },
      consentRecord: { findMany: async () => [{ consentType: "PRIVACY_NOTICE", withdrawnAt: null, expiresAt: null }] },
      guardianRelationship: { findMany: async () => [] },
      platformSetting: { findUnique: async () => null },
      clinicalNote: {
        findFirst: async () => ({
          id: noteId,
          kind: note.kind,
          state: note.state ?? "DRAFT",
          revision: note.revision,
          summaryReleaseStatus: note.summaryReleaseStatus,
          archivedAt: null,
          legalHold: false,
        }),
        update: async () => ({}),
        updateMany: async () => {
          noteUpdates += 1;
          return { count: note.revision === 1 ? 0 : 1 };
        },
      },
      clinicalNoteVersion: { create: async () => { versionCreates += 1; return {}; } },
      summaryRelease: { create: async ({ data }: { data: Record<string, unknown> }) => { releases.push(data); return data; } },
      medicalFile: { updateMany: async () => ({ count: 1 }) },
      notification: { create: async () => ({}) },
      recordAccessLog: { create: async () => ({}) },
      auditLog: { create: async ({ data }: { data: { action: string; metadata?: unknown } }) => { audits.push(data); return data; } },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
      audits,
      releases,
      get versionCreates() { return versionCreates; },
      get noteUpdates() { return noteUpdates; },
    };
    return db;
  }

  it("does not let an unrelated doctor release a summary or overwrite a note version", async () => {
    const db = dbFor({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "NOT_RELEASED", revision: 1 });
    const releasedSummary = await releasePatientSummary(db as never, { appointmentId, actorUserId: doctorB, noteId, now });
    expect(releasedSummary.ok).toBe(false);
    expect(db.releases).toHaveLength(0);
    expect(db.audits.some((row) => row.action === "clinical.access.denied")).toBe(true);

    const stale = dbFor({ kind: "PRIVATE_WORKING", summaryReleaseStatus: "NOT_RELEASED", revision: 1 });
    const saved = await saveClinicalNote(stale as never, {
      appointmentId,
      actorUserId: doctorA,
      noteId,
      body: "Amended plan",
      expectedRevision: 1,
      now,
    });
    expect(saved.ok).toBe(false);
    expect(saved.message).toMatch(/Reload/);
    expect(stale.versionCreates).toBe(0);
  });

  it("records an authorized summary release without copying a private note body into the audit", async () => {
    const db = dbFor({ kind: "PATIENT_SUMMARY", summaryReleaseStatus: "NOT_RELEASED", revision: 3 });
    const result = await releasePatientSummary(db as never, { appointmentId, actorUserId: doctorA, noteId, now });
    expect(result.ok).toBe(true);
    expect(db.releases[0]).toMatchObject({ clinicalNoteId: noteId, version: 3, event: "RELEASED", actorUserId: doctorA });
    const audit = db.audits.find((row) => row.action === "clinical.summary.released");
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.metadata ?? {})).not.toMatch(/private note|Amended plan/);
    expect(noteChange({ kind: "PRIVATE_WORKING", summaryReleaseStatus: "NOT_RELEASED", archivedAt: null, legalHold: false, action: "release" }).ok).toBe(false);
  });
});
