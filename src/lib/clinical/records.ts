import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { formatPlatformWhen } from "@/lib/admin/labels";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { parseUuid } from "@/lib/catalog/rules";
import { inspectCredentialFile, safeDownloadName } from "@/lib/doctors/credential-file";
import { isSchemaMismatch, isUniqueConflict } from "@/lib/doctors/errors";
import type { PrivateObjectStorage } from "@/lib/storage/private-storage";
import { STORAGE_CONFIGURATION_HINT } from "@/lib/storage/private-storage";
import {
  careAuthorization,
  clinicalAuditMetadata,
  clinicalFileDecision,
  clinicalMalwareScanDecision,
  clinicalStorageKey,
  clinicalUploadByteLimit,
  clinicalWriteBlock,
  clinicianMayDocument,
  clinicianRecordDecision,
  consentState,
  encounterStatusForAppointment,
  guardianIsAuthorized,
  MINOR_TREATMENT_SETTING,
  noteChange,
  noteEditDecision,
  noteFinalizeDecision,
  parseClinicalBody,
  parseExpectedRevision,
  parseNoteKind,
  requiresGuardianAuthorization,
  safeAuditReason,
  safeRequestId,
  utcDateOnly,
  type CareReason,
} from "./rules";
import { guardianMayAccessPatient } from "./guardian-access";

type FailureCode = "NOT_FOUND" | "SCHEMA" | "UNAVAILABLE";
type ClinicalResult = { ok: true; message: string; noteId?: string } | { ok: false; message: string };

class RevisionConflict extends Error {
  constructor() {
    super("REVISION_CONFLICT");
  }
}

function failed(error: unknown): { ok: false; code: FailureCode } {
  return { ok: false, code: isSchemaMismatch(error) ? "SCHEMA" : "UNAVAILABLE" };
}

function saveError(error: unknown): ClinicalResult {
  if (error instanceof RevisionConflict) {
    return { ok: false, message: "This note changed before your edit was saved. Reload it and try again." };
  }
  if (isSchemaMismatch(error)) {
    return { ok: false, message: "Clinical records are not available until the latest database migration has been applied." };
  }
  return { ok: false, message: "The clinical record could not be saved." };
}

const visitSelect = {
  id: true,
  status: true,
  mode: true,
  patientProfileId: true,
  doctorProfileId: true,
  patient: {
    select: {
      id: true,
      userId: true,
      fullName: true,
      isDependent: true,
      dateOfBirth: true,
      archivedAt: true,
    },
  },
  doctor: {
    select: {
      id: true,
      userId: true,
      verificationStatus: true,
      user: { select: { status: true, deletedAt: true } },
    },
  },
  specialty: { select: { name: true } },
  consultationService: { select: { name: true } },
  encounter: {
    select: { id: true, startedAt: true, endedAt: true, archivedAt: true, legalHold: true, status: true },
  },
} satisfies Prisma.AppointmentSelect;

type VisitRow = Prisma.AppointmentGetPayload<{ select: typeof visitSelect }>;

async function actorCoversVisit(db: PrismaClient, actorUserId: string) {
  const actor = await db.user.findUnique({
    where: { id: actorUserId },
    select: { roles: { select: { role: { select: { code: true } } } } },
  });
  return isPortalAdministrator(actor?.roles.map((row) => row.role.code) ?? []);
}

async function loadOwnedVisit(db: PrismaClient, appointmentId: string, actorUserId: string, now: Date) {
  if (!parseUuid(appointmentId)) return { ok: false as const, code: "NOT_FOUND" as const };
  const visit = await db.appointment.findUnique({ where: { id: appointmentId }, select: visitSelect });
  if (!visit) return { ok: false as const, code: "NOT_FOUND" as const };
  const decision = clinicianRecordDecision({
    actorUserId,
    doctorUserId: visit.doctor.userId,
    doctorMayDocument: clinicianMayDocument({
      verificationStatus: visit.doctor.verificationStatus,
      userStatus: visit.doctor.user.status,
      deletedAt: visit.doctor.user.deletedAt,
    }),
    coversVisit: await actorCoversVisit(db, actorUserId),
  });
  if (decision !== "allow") {
    await recordDenial(db, {
      actorUserId,
      patientProfileId: visit.patientProfileId,
      entityType: "Appointment",
      entityId: visit.id,
      reason: decision === "unauthenticated" ? "unauthenticated" : "not_assigned",
    });
    return { ok: false as const, code: "NOT_FOUND" as const };
  }
  const care = await loadCare(db, visit, now);
  return { ok: true as const, visit, care };
}

async function loadCare(db: PrismaClient, visit: VisitRow, now: Date) {
  const [consents, guardians, setting] = await Promise.all([
    db.consentRecord.findMany({
      where: { userId: visit.patient.userId, consentType: { in: ["PRIVACY_NOTICE", "DATA_PROCESSING", "TELEHEALTH"] } },
      select: { consentType: true, withdrawnAt: true, expiresAt: true },
    }),
    db.guardianRelationship.findMany({
      where: { dependentPatientId: visit.patientProfileId },
      select: { status: true, revokedAt: true, expiresAt: true, guardianUserId: true },
    }),
    db.platformSetting.findUnique({ where: { key: MINOR_TREATMENT_SETTING }, select: { valueJson: true } }),
  ]);
  const guardianIds = guardians.map((row) => row.guardianUserId);
  const guardianConsents = guardianIds.length
    ? await db.consentRecord.findMany({
        where: { userId: { in: guardianIds }, consentType: "GUARDIAN_AUTHORIZATION" },
        select: { userId: true, withdrawnAt: true, expiresAt: true },
      })
    : [];
  const byType = (type: string) => consents.filter((row) => row.consentType === type);
  const guardianAuthorized = guardians.some((row) =>
    guardianIsAuthorized({
      status: row.status,
      revokedAt: row.revokedAt,
      guardianConsent: consentState(guardianConsents.filter((consent) => consent.userId === row.guardianUserId), now),
      expiresAt: row.expiresAt,
      now,
    }),
  );
  return careAuthorization({
    privacy: consentState(byType("PRIVACY_NOTICE"), now),
    dataProcessing: consentState(byType("DATA_PROCESSING"), now),
    telehealth: consentState(byType("TELEHEALTH"), now),
    mode: visit.mode,
    requiresGuardian: requiresGuardianAuthorization({
      isDependent: visit.patient.isDependent,
      dateOfBirth: utcDateOnly(visit.patient.dateOfBirth),
      now,
    }),
    minorTreatmentEnabled: setting?.valueJson === true,
    guardianAuthorized,
  });
}

function writeBlock(visit: VisitRow, care: { ok: true } | { ok: false; reason: CareReason }) {
  return clinicalWriteBlock({
    doctorApproved: clinicianMayDocument({
      verificationStatus: visit.doctor.verificationStatus,
      userStatus: visit.doctor.user.status,
      deletedAt: visit.doctor.user.deletedAt,
    }),
    appointmentStatus: visit.status,
    patientArchived: visit.patient.archivedAt !== null,
    encounterArchived: visit.encounter?.archivedAt != null,
    encounterLegalHold: visit.encounter?.legalHold === true,
    encounterStatus: visit.encounter?.status ?? null,
    care,
  });
}

async function trace(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    patientProfileId: string;
    clinicalNoteId?: string | null;
    entityType: string;
    entityId: string;
    action: "READ" | "CREATE" | "UPDATE" | "RELEASE" | "WITHDRAW" | "ARCHIVE" | "EXPORT";
    outcome?: "ALLOWED" | "DENIED";
    reason?: string | null;
    requestId?: string | null;
    auditAction: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  await tx.recordAccessLog.create({
    data: {
      actorUserId: input.actorUserId,
      patientProfileId: input.patientProfileId,
      clinicalNoteId: input.clinicalNoteId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      outcome: input.outcome ?? "ALLOWED",
      reason: input.reason ? safeAuditReason(input.reason) : null,
      requestId: safeRequestId(input.requestId),
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.auditAction,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: safeRequestId(input.requestId),
      metadata: clinicalAuditMetadata(input.metadata),
    },
  });
}

export async function recordDenial(
  db: PrismaClient,
  input: {
    actorUserId: string;
    patientProfileId: string;
    entityType: string;
    entityId: string;
    reason: string;
    clinicalNoteId?: string | null;
    requestId?: string | null;
  },
) {
  try {
    await db.$transaction(async (tx) => {
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: input.patientProfileId,
        clinicalNoteId: input.clinicalNoteId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: "READ",
        outcome: "DENIED",
        reason: input.reason,
        requestId: input.requestId,
        auditAction: "clinical.access.denied",
        metadata: { reason: safeAuditReason(input.reason) },
      });
    });
  } catch {
    // A failed denial log must not turn into a response that describes the record.
  }
}

export async function loadClinicianRecord(db: PrismaClient, input: { appointmentId: string; actorUserId: string; now?: Date }) {
  const now = input.now ?? new Date();
  try {
    const owned = await loadOwnedVisit(db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok) return owned;
    const { visit, care } = owned;
    const blocked = writeBlock(visit, care);
    const encounterId = visit.encounter?.id ?? null;
    const notes = encounterId
      ? await db.clinicalNote.findMany({
          where: { encounterId, authorDoctorProfileId: visit.doctorProfileId },
          orderBy: { createdAt: "asc" },
          take: 30,
          select: {
            id: true,
            kind: true,
            state: true,
            revision: true,
            body: true,
            summaryReleaseStatus: true,
            releasedAt: true,
            archivedAt: true,
            legalHold: true,
            createdAt: true,
            versions: {
              orderBy: { version: "desc" },
              take: 20,
              select: { id: true, version: true, body: true, amendmentReason: true, createdAt: true },
            },
            releases: {
              orderBy: { occurredAt: "desc" },
              take: 10,
              select: { id: true, event: true, version: true, occurredAt: true },
            },
          },
        })
      : [];
    const files = encounterId
      ? await db.medicalFile.findMany({
          where: { encounterId, purpose: "CLINICAL_ATTACHMENT" },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, createdAt: true, clinicalNoteId: true, patientVisible: true, deletedAt: true },
        })
      : [];
    const noteIds = notes.map((note) => note.id);
    const entityIds = [encounterId, ...noteIds, ...files.map((file) => file.id)].filter((id): id is string => Boolean(id));
    const access = entityIds.length
      ? await db.recordAccessLog.findMany({
          where: {
            patientProfileId: visit.patientProfileId,
            OR: noteIds.length > 0 ? [{ entityId: { in: entityIds } }, { clinicalNoteId: { in: noteIds } }] : [{ entityId: { in: entityIds } }],
          },
          orderBy: { occurredAt: "desc" },
          take: 20,
          select: { id: true, actorUserId: true, action: true, entityType: true, occurredAt: true },
        })
      : [];
    if (encounterId) {
      await db.$transaction([
        db.recordAccessLog.createMany({
          data: [
            {
              actorUserId: input.actorUserId,
              patientProfileId: visit.patientProfileId,
              entityType: "Encounter",
              entityId: encounterId,
              action: "READ",
            },
            ...notes.map((note) => ({
              actorUserId: input.actorUserId,
              patientProfileId: visit.patientProfileId,
              clinicalNoteId: note.id,
              entityType: "ClinicalNote",
              entityId: note.id,
              action: "READ" as const,
            })),
          ],
        }),
        db.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            action: "clinical.record.read",
            entityType: "Encounter",
            entityId: encounterId,
            metadata: { notes: notes.length },
          },
        }),
      ]);
    }
    return {
      ok: true as const,
      view: {
        appointmentId: visit.id,
        patientId: visit.patientProfileId,
        patientName: visit.patient.fullName,
        service: visit.consultationService.name,
        specialty: visit.specialty.name,
        mode: visit.mode,
        status: visit.status,
        writeBlocked: blocked,
        canOpen: !visit.encounter && blocked === null,
        encounter: visit.encounter
          ? {
              id: visit.encounter.id,
              status: visit.encounter.status,
              startedAt: visit.encounter.startedAt?.toISOString() ?? null,
              startedWhen: visit.encounter.startedAt ? formatPlatformWhen(visit.encounter.startedAt) : "Not recorded",
              endedWhen: visit.encounter.endedAt ? formatPlatformWhen(visit.encounter.endedAt) : null,
              archived: visit.encounter.archivedAt !== null,
              legalHold: visit.encounter.legalHold,
            }
          : null,
        notes: notes.map((note) => ({
          id: note.id,
          kind: note.kind,
          state: note.state,
          revision: note.revision,
          body: note.body,
          release: note.summaryReleaseStatus,
          releasedWhen: note.releasedAt ? formatPlatformWhen(note.releasedAt) : null,
          archived: note.archivedAt !== null,
          legalHold: note.legalHold,
          createdWhen: formatPlatformWhen(note.createdAt),
          versions: note.versions.map((version) => ({
            id: version.id,
            version: version.version,
            body: version.body,
            amendmentReason: version.amendmentReason,
            when: formatPlatformWhen(version.createdAt),
          })),
          releases: note.releases.map((release) => ({
            id: release.id,
            event: release.event,
            version: release.version,
            when: formatPlatformWhen(release.occurredAt),
          })),
        })),
        files: files.map((file) => ({
          id: file.id,
          name: file.originalFilename ?? "Document",
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          when: formatPlatformWhen(file.createdAt),
          noteId: file.clinicalNoteId,
          patientVisible: file.patientVisible,
          removed: file.deletedAt !== null,
        })),
        access: access.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          when: formatPlatformWhen(row.occurredAt),
          actor: row.actorUserId === input.actorUserId ? "You" : row.actorUserId === visit.patient.userId ? "Patient" : "Another account",
        })),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function openConsultationEncounter(
  db: PrismaClient,
  input: { appointmentId: string; actorUserId: string; now?: Date },
): Promise<ClinicalResult> {
  const now = input.now ?? new Date();
  try {
    const owned = await loadOwnedVisit(db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok) return { ok: false, message: "That clinical record was not found." };
    if (owned.visit.encounter) return { ok: true, message: "The consultation record is already open." };
    const blocked = writeBlock(owned.visit, owned.care);
    if (blocked) return { ok: false, message: blocked };
    const encounterId = randomUUID();
    const encounterStatus = encounterStatusForAppointment(owned.visit.status) ?? "IN_PROGRESS";
    await db.$transaction(async (tx) => {
      await tx.encounter.create({
        data: {
          id: encounterId,
          appointmentId: owned.visit.id,
          patientProfileId: owned.visit.patientProfileId,
          doctorProfileId: owned.visit.doctorProfileId,
          status: encounterStatus,
          startedAt: now,
          endedAt: encounterStatus === "COMPLETED" ? now : null,
        },
      });
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: owned.visit.patientProfileId,
        entityType: "Encounter",
        entityId: encounterId,
        action: "CREATE",
        auditAction: "clinical.encounter.opened",
        metadata: { appointmentStatus: owned.visit.status },
      });
    });
    return { ok: true, message: "The consultation record is open." };
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: true, message: "The consultation record is already open." };
    return saveError(error);
  }
}

export async function saveClinicalNote(
  db: PrismaClient,
  input: {
    appointmentId: string;
    actorUserId: string;
    noteId?: string | null;
    kind?: string | null;
    body: string;
    expectedRevision?: string | number | null;
    amendmentReason?: string | null;
    now?: Date;
  },
): Promise<ClinicalResult> {
  const parsed = parseClinicalBody(input.body);
  if (!parsed.ok) return parsed;
  const now = input.now ?? new Date();
  try {
    const owned = await loadOwnedVisit(db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok || !owned.visit.encounter) return { ok: false, message: "That clinical record was not found." };
    const blocked = writeBlock(owned.visit, owned.care);
    if (blocked) return { ok: false, message: blocked };
    const encounter = owned.visit.encounter;
    if (input.noteId) {
      if (!parseUuid(input.noteId)) return { ok: false, message: "That note was not found." };
      const existing = await db.clinicalNote.findFirst({
        where: { id: input.noteId, encounterId: encounter.id, authorDoctorProfileId: owned.visit.doctorProfileId },
        select: { id: true, kind: true, state: true, revision: true, summaryReleaseStatus: true, archivedAt: true, legalHold: true },
      });
      if (!existing) return { ok: false, message: "That note was not found." };
      const change = noteEditDecision({
        ...existing,
        currentRevision: existing.revision,
        expectedRevision: parseExpectedRevision(input.expectedRevision),
        amendmentReason: input.amendmentReason ?? "",
      });
      if (!change.ok) return change;
      await db.$transaction(async (tx) => {
        const updated = await tx.clinicalNote.updateMany({
          where: { id: existing.id, revision: existing.revision, authorDoctorProfileId: owned.visit.doctorProfileId },
          data: { body: parsed.body, revision: { increment: 1 } },
        });
        if (updated.count !== 1) throw new RevisionConflict();
        const version = existing.revision + 1;
        await tx.clinicalNoteVersion.create({
          data: {
            clinicalNoteId: existing.id,
            encounterId: encounter.id,
            version,
            body: parsed.body,
            amendmentReason: change.amendmentReason,
            editorUserId: input.actorUserId,
          },
        });
        await trace(tx, {
          actorUserId: input.actorUserId,
          patientProfileId: owned.visit.patientProfileId,
          clinicalNoteId: existing.id,
          entityType: "ClinicalNote",
          entityId: existing.id,
          action: "UPDATE",
          auditAction: change.amendmentReason ? "clinical.note.amended" : "clinical.note.updated",
          metadata: { kind: existing.kind, version, amended: Boolean(change.amendmentReason) },
        });
      });
      return { ok: true, message: change.amendmentReason ? "The amendment was saved. Earlier versions were kept." : "The note was saved. The previous text remains in the version history.", noteId: existing.id };
    }
    const kind = parseNoteKind(input.kind ?? "");
    if (!kind) return { ok: false, message: "Choose a working note or a patient summary." };
    const noteId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.clinicalNote.create({
        data: {
          id: noteId,
          encounterId: encounter.id,
          authorDoctorProfileId: owned.visit.doctorProfileId,
          kind,
          state: "DRAFT",
          revision: 1,
          body: parsed.body,
          summaryReleaseStatus: "NOT_RELEASED",
        },
      });
      await tx.clinicalNoteVersion.create({
        data: { clinicalNoteId: noteId, encounterId: encounter.id, version: 1, body: parsed.body, editorUserId: input.actorUserId },
      });
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: owned.visit.patientProfileId,
        clinicalNoteId: noteId,
        entityType: "ClinicalNote",
        entityId: noteId,
        action: "CREATE",
        auditAction: "clinical.note.created",
        metadata: { kind, version: 1 },
      });
    });
    return {
      ok: true,
      noteId,
      message: kind === "PATIENT_SUMMARY" ? "The patient summary was saved as a draft. Release it to make it visible to the patient." : "The working note was saved on the clinician record.",
    };
  } catch (error) {
    if (isUniqueConflict(error)) {
      return { ok: false, message: "This note changed before your edit was saved. Reload it and try again." };
    }
    return saveError(error);
  }
}

async function changeSummary(
  db: PrismaClient,
  input: { appointmentId: string; actorUserId: string; noteId: string; action: "release" | "withdraw" | "archive"; now?: Date },
): Promise<ClinicalResult> {
  const now = input.now ?? new Date();
  try {
    const owned = await loadOwnedVisit(db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok || !owned.visit.encounter || !parseUuid(input.noteId)) return { ok: false, message: "That note was not found." };
    const encounter = owned.visit.encounter;
    const blocked = writeBlock(owned.visit, owned.care);
    if (blocked) return { ok: false, message: blocked };
    const note = await db.clinicalNote.findFirst({
      where: { id: input.noteId, encounterId: encounter.id, authorDoctorProfileId: owned.visit.doctorProfileId },
      select: { id: true, kind: true, revision: true, summaryReleaseStatus: true, archivedAt: true, legalHold: true },
    });
    if (!note) return { ok: false, message: "That note was not found." };
    const change = noteChange({ ...note, action: input.action });
    if (!change.ok) return change;
    await db.$transaction(async (tx) => {
      if (input.action === "release") {
        await tx.clinicalNote.update({
          where: { id: note.id },
          data: { summaryReleaseStatus: "RELEASED", releasedAt: now, releasedByUserId: input.actorUserId },
        });
        await tx.summaryRelease.create({
          data: {
            clinicalNoteId: note.id,
            version: note.revision,
            patientProfileId: owned.visit.patientProfileId,
            encounterId: encounter.id,
            actorUserId: input.actorUserId,
            event: "RELEASED",
            occurredAt: now,
          },
        });
        await tx.medicalFile.updateMany({
          where: { clinicalNoteId: note.id, purpose: "CLINICAL_ATTACHMENT", deletedAt: null },
          data: { patientVisible: true },
        });
        await tx.notification.create({
          data: {
            recipientId: owned.visit.patient.userId,
            channel: "IN_APP",
            type: "clinical.summary.released",
            title: "A clinical summary is available",
            preview: "Your clinician released a summary from a visit. Open the appointment to read it.",
            entityType: "Appointment",
            entityId: owned.visit.id,
            status: "SENT",
          },
        });
      } else if (input.action === "withdraw") {
        await tx.clinicalNote.update({
          where: { id: note.id },
          data: { summaryReleaseStatus: "WITHDRAWN" },
        });
        await tx.summaryRelease.create({
          data: {
            clinicalNoteId: note.id,
            version: note.revision,
            patientProfileId: owned.visit.patientProfileId,
            encounterId: encounter.id,
            actorUserId: input.actorUserId,
            event: "WITHDRAWN",
            occurredAt: now,
          },
        });
        await tx.medicalFile.updateMany({
          where: { clinicalNoteId: note.id },
          data: { patientVisible: false },
        });
        await tx.notification.create({
          data: {
            recipientId: owned.visit.patient.userId,
            channel: "IN_APP",
            type: "clinical.summary.withdrawn",
            title: "A clinical summary was withdrawn",
            preview: "A summary from a visit is no longer available.",
            entityType: "Appointment",
            entityId: owned.visit.id,
            status: "SENT",
          },
        });
      } else {
        await tx.clinicalNote.update({ where: { id: note.id }, data: { archivedAt: now } });
      }
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: owned.visit.patientProfileId,
        clinicalNoteId: note.id,
        entityType: "ClinicalNote",
        entityId: note.id,
        action: input.action === "release" ? "RELEASE" : input.action === "withdraw" ? "WITHDRAW" : "ARCHIVE",
        auditAction: input.action === "release" ? "clinical.summary.released" : input.action === "withdraw" ? "clinical.summary.withdrawn" : "clinical.note.archived",
        metadata: { kind: note.kind, version: note.revision },
      });
    });
    if (input.action === "release") return { ok: true, message: "The summary was released to the patient." };
    if (input.action === "withdraw") return { ok: true, message: "The summary was withdrawn. The patient can no longer read it." };
    return { ok: true, message: "The note was archived." };
  } catch (error) {
    return saveError(error);
  }
}

export function releasePatientSummary(db: PrismaClient, input: { appointmentId: string; actorUserId: string; noteId: string; now?: Date }) {
  return changeSummary(db, { ...input, action: "release" });
}

export function withdrawPatientSummary(db: PrismaClient, input: { appointmentId: string; actorUserId: string; noteId: string; now?: Date }) {
  return changeSummary(db, { ...input, action: "withdraw" });
}

export function archiveClinicalNote(db: PrismaClient, input: { appointmentId: string; actorUserId: string; noteId: string; now?: Date }) {
  return changeSummary(db, { ...input, action: "archive" });
}

export async function storeClinicalFile(
  input: { appointmentId: string; actorUserId: string; noteId?: string | null; filename: string; declaredMime: string; bytes: Uint8Array; now?: Date },
  deps: { db: PrismaClient; storage: PrivateObjectStorage },
): Promise<ClinicalResult> {
  const limit = clinicalUploadByteLimit();
  if (input.bytes.byteLength > limit) {
    return { ok: false, message: `Documents must be ${Math.max(1, Math.round(limit / (1024 * 1024)))} MB or smaller.` };
  }
  const scan = clinicalMalwareScanDecision();
  if (!scan.accept) return { ok: false, message: scan.message };
  const inspected = inspectCredentialFile({ filename: input.filename, declaredMime: input.declaredMime, bytes: input.bytes });
  if (!inspected.ok) return inspected;
  if (!deps.storage.configured) return { ok: false, message: STORAGE_CONFIGURATION_HINT };
  const now = input.now ?? new Date();
  const fileId = randomUUID();
  let storageKey = "";
  try {
    const owned = await loadOwnedVisit(deps.db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok || !owned.visit.encounter) return { ok: false, message: "That clinical record was not found." };
    const blocked = writeBlock(owned.visit, owned.care);
    if (blocked) return { ok: false, message: blocked };
    let noteId: string | null = null;
    let patientVisible = false;
    if (input.noteId) {
      if (!parseUuid(input.noteId)) return { ok: false, message: "That note was not found." };
      const note = await deps.db.clinicalNote.findFirst({
        where: { id: input.noteId, encounterId: owned.visit.encounter.id, authorDoctorProfileId: owned.visit.doctorProfileId, archivedAt: null },
        select: { id: true, kind: true, summaryReleaseStatus: true },
      });
      if (!note) return { ok: false, message: "That note was not found." };
      noteId = note.id;
      patientVisible = note.kind === "PATIENT_SUMMARY" && note.summaryReleaseStatus === "RELEASED";
    }
    const encounterId = owned.visit.encounter.id;
    storageKey = clinicalStorageKey(owned.visit.patientProfileId, fileId);
    const stored = await deps.storage.put({ key: storageKey, body: input.bytes, mimeType: inspected.mimeType });
    if (!stored.ok) return { ok: false, message: "The document was not stored." };
    await deps.db.$transaction(async (tx) => {
      await tx.medicalFile.create({
        data: {
          id: fileId,
          storageKey,
          originalFilename: inspected.originalFilename,
          mimeType: inspected.mimeType,
          sizeBytes: inspected.sizeBytes,
          checksumSha256: inspected.checksumSha256,
          purpose: "CLINICAL_ATTACHMENT",
          uploaderUserId: input.actorUserId,
          patientProfileId: owned.visit.patientProfileId,
          encounterId,
          clinicalNoteId: noteId,
          patientVisible,
          scanStatus: scan.status,
        },
      });
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: owned.visit.patientProfileId,
        clinicalNoteId: noteId,
        entityType: "MedicalFile",
        entityId: fileId,
        action: "CREATE",
        auditAction: "clinical.file.stored",
        metadata: { mimeType: inspected.mimeType, sizeBytes: inspected.sizeBytes, patientVisible, scanStatus: scan.status },
      });
    });
    if (patientVisible) return { ok: true, message: "The document was stored with the released summary. The patient can open it." };
    return { ok: true, message: noteId ? "The document was stored with that note. It stays private until that summary is released." : "The document was stored on the consultation record. It is not visible to the patient until it is attached to a released summary." };
  } catch (error) {
    if (storageKey) await deps.storage.remove(storageKey);
    return saveError(error);
  }
}

export async function openClinicalFile(
  fileId: string,
  actorUserId: string | null,
  deps: { db: PrismaClient; storage: PrivateObjectStorage; requestId?: string | null },
): Promise<{ ok: true; body: Uint8Array; mimeType: string; filename: string } | { ok: false; status: 401 | 404 | 503; message: string }> {
  if (!actorUserId) return { ok: false, status: 401, message: "Sign in to open this document." };
  if (!parseUuid(fileId)) return { ok: false, status: 404, message: "This document is not available." };
  try {
    const file = await deps.db.medicalFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        originalFilename: true,
        purpose: true,
        clinicalNoteId: true,
        patientProfileId: true,
        patientVisible: true,
        deletedAt: true,
        patient: { select: { userId: true } },
        encounter: {
          select: {
            archivedAt: true,
            doctor: { select: { userId: true, verificationStatus: true, user: { select: { status: true, deletedAt: true } } } },
          },
        },
        note: { select: { kind: true, summaryReleaseStatus: true, archivedAt: true } },
      },
    });
    if (!file || !file.patientProfileId) return { ok: false, status: 404, message: "This document is not available." };
    const doctor = file.encounter?.doctor;
    const baseDecision = {
      actorUserId,
      purpose: file.purpose,
      patientUserId: file.patient?.userId ?? null,
      doctorUserId: doctor?.userId ?? null,
      doctorMayDocument: doctor
        ? clinicianMayDocument({
            verificationStatus: doctor.verificationStatus,
            userStatus: doctor.user.status,
            deletedAt: doctor.user.deletedAt,
          })
        : false,
      encounterArchived: file.encounter?.archivedAt != null,
      deleted: file.deletedAt !== null,
      patientVisible: file.patientVisible,
      note: file.note,
    };
    let decision = clinicalFileDecision({ ...baseDecision, guardianAuthorized: false });
    if (decision === "deny") {
      const guardianAuthorized = await guardianMayAccessPatient(deps.db, { actorUserId, patientProfileId: file.patientProfileId });
      if (guardianAuthorized) decision = clinicalFileDecision({ ...baseDecision, guardianAuthorized: true });
    }
    if (decision === "unauthenticated") return { ok: false, status: 401, message: "Sign in to open this document." };
    if (decision === "deny") {
      await recordDenial(deps.db, {
        actorUserId,
        patientProfileId: file.patientProfileId,
        clinicalNoteId: file.clinicalNoteId,
        entityType: "MedicalFile",
        entityId: file.id,
        reason: file.deletedAt ? "removed" : "not_authorized",
        requestId: deps.requestId,
      });
      return { ok: false, status: 404, message: "This document is not available." };
    }
    if (!deps.storage.configured) return { ok: false, status: 503, message: STORAGE_CONFIGURATION_HINT };
    const stored = await deps.storage.read(file.storageKey);
    if (!stored.ok) return { ok: false, status: 404, message: "This document is not available." };
    await deps.db.$transaction(async (tx) => {
      await trace(tx, {
        actorUserId,
        patientProfileId: file.patientProfileId!,
        clinicalNoteId: file.clinicalNoteId,
        entityType: "MedicalFile",
        entityId: file.id,
        action: "EXPORT",
        auditAction: "clinical.file.opened",
        requestId: deps.requestId,
        metadata: { mimeType: file.mimeType },
      });
    });
    const extension = file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : "jpg";
    return { ok: true, body: stored.body, mimeType: file.mimeType, filename: safeDownloadName(file.originalFilename, extension) };
  } catch (error) {
    if (isSchemaMismatch(error)) return { ok: false, status: 503, message: "Clinical records are not available until the latest database migration has been applied." };
    return { ok: false, status: 503, message: "This document could not be opened." };
  }
}

export async function finalizeClinicalNote(
  db: PrismaClient,
  input: { appointmentId: string; actorUserId: string; noteId: string; expectedRevision?: string | number | null; now?: Date },
): Promise<ClinicalResult> {
  const now = input.now ?? new Date();
  try {
    const owned = await loadOwnedVisit(db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok || !owned.visit.encounter || !parseUuid(input.noteId)) return { ok: false, message: "That note was not found." };
    const blocked = writeBlock(owned.visit, owned.care);
    if (blocked) return { ok: false, message: blocked };
    const note = await db.clinicalNote.findFirst({
      where: { id: input.noteId, encounterId: owned.visit.encounter.id, authorDoctorProfileId: owned.visit.doctorProfileId },
      select: { id: true, kind: true, state: true, revision: true, archivedAt: true, legalHold: true },
    });
    if (!note) return { ok: false, message: "That note was not found." };
    const decision = noteFinalizeDecision(note);
    if (!decision.ok) return decision;
    const expected = parseExpectedRevision(input.expectedRevision);
    if (expected === null || expected !== note.revision) {
      return { ok: false, message: "This note changed before it could be finalized. Reload it and try again." };
    }
    await db.$transaction(async (tx) => {
      const updated = await tx.clinicalNote.updateMany({
        where: { id: note.id, revision: note.revision, state: "DRAFT", authorDoctorProfileId: owned.visit.doctorProfileId },
        data: { state: "FINALIZED", finalizedAt: now, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new RevisionConflict();
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: owned.visit.patientProfileId,
        clinicalNoteId: note.id,
        entityType: "ClinicalNote",
        entityId: note.id,
        action: "UPDATE",
        auditAction: "clinical.note.finalized",
        metadata: { kind: note.kind, version: note.revision + 1 },
      });
    });
    return { ok: true, message: "The note was finalized. Later corrections must be saved as amendments." };
  } catch (error) {
    return saveError(error);
  }
}

export async function retireClinicalFile(
  db: PrismaClient,
  input: { appointmentId: string; actorUserId: string; fileId: string; now?: Date },
): Promise<ClinicalResult> {
  const now = input.now ?? new Date();
  if (!parseUuid(input.fileId)) return { ok: false, message: "That document was not found." };
  try {
    const owned = await loadOwnedVisit(db, input.appointmentId, input.actorUserId, now);
    if (!owned.ok || !owned.visit.encounter) return { ok: false, message: "That document was not found." };
    const blocked = writeBlock(owned.visit, owned.care);
    if (blocked) return { ok: false, message: blocked };
    const file = await db.medicalFile.findFirst({
      where: { id: input.fileId, encounterId: owned.visit.encounter.id, purpose: "CLINICAL_ATTACHMENT", patientProfileId: owned.visit.patientProfileId },
      select: { id: true, deletedAt: true, legalHold: true, clinicalNoteId: true },
    });
    if (!file || file.deletedAt) return { ok: false, message: "That document was not found." };
    if (file.legalHold || owned.visit.encounter.legalHold) return { ok: false, message: "This document is on legal hold and stays available." };
    await db.$transaction(async (tx) => {
      const updated = await tx.medicalFile.updateMany({
        where: { id: file.id, deletedAt: null, encounterId: owned.visit.encounter?.id },
        data: { deletedAt: now, patientVisible: false },
      });
      if (updated.count !== 1) throw new Error("FILE_CHANGED");
      await trace(tx, {
        actorUserId: input.actorUserId,
        patientProfileId: owned.visit.patientProfileId,
        clinicalNoteId: file.clinicalNoteId,
        entityType: "MedicalFile",
        entityId: file.id,
        action: "ARCHIVE",
        auditAction: "clinical.file.removed",
        metadata: { retained: true },
      });
    });
    return { ok: true, message: "The document was removed from the record. The stored file is retained and can no longer be downloaded." };
  } catch (error) {
    if (error instanceof Error && error.message === "FILE_CHANGED") return { ok: false, message: "That document changed before it could be removed." };
    return saveError(error);
  }
}

export async function syncEncounterStatus(
  db: { encounter?: Pick<PrismaClient["encounter"], "updateMany"> },
  input: { appointmentId: string; status: "COMPLETED" | "CANCELLED"; at: Date },
) {
  if (!parseUuid(input.appointmentId) || !db.encounter?.updateMany) return;
  try {
    await db.encounter.updateMany({
      where: { appointmentId: input.appointmentId, status: { not: input.status } },
      data: { status: input.status, endedAt: input.at },
    });
  } catch (error) {
    if (!isSchemaMismatch(error)) console.error("encounter_status_sync_failed");
  }
}
