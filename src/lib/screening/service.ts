import { Prisma, type PrismaClient } from "@prisma/client";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { parseUuid } from "@/lib/catalog/rules";
import { clinicalAuditMetadata } from "@/lib/clinical/rules";
import { recordDenial } from "@/lib/clinical/records";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { sharedRateLimiter } from "@/lib/auth/rate-limit";
import { SCREENING_CANDIDATES } from "./catalog";
import {
  AMENDMENT_MAX,
  FOLLOW_UP_MAX,
  INTERPRETATION_MAX,
  SCREENING_CONSENT_VERSION,
  SCREENING_SAFETY_SETTING,
  activationBlockers,
  activateBlocker,
  boundedText,
  categoryOrder,
  doctorMayAccess,
  governanceChangeAllowed,
  supportContactDraft,
  governancePayloadRejected,
  isApprovalState,
  isLicenseStatus,
  nextAvailability,
  parseSafetyContacts,
  patientCanStart,
  patientOwns,
  patientResultView,
  safetyPresentation,
  startDecision,
  submitDecision,
  type SafetyContacts,
  type ToolGate,
} from "./rules";
import { nextQuestionVersion, prepareQuestionSet } from "./questions";
import { answersMatchItems, parseItems, parseScoringSpec, scoreAssessment, type ScreeningItem } from "./scoring";

const startLimit = sharedRateLimiter("screening-start", { limit: 12, windowMs: 60 * 60 * 1000 });
const submitLimit = sharedRateLimiter("screening-submit", { limit: 8, windowMs: 60 * 60 * 1000 });

export type ScreeningFailure =
  | "NOT_FOUND"
  | "SCHEMA"
  | "UNAVAILABLE"
  | "CLOSED"
  | "INVALID"
  | "CONSENT"
  | "RATE"
  | "SAFETY"
  | "FORBIDDEN";

function failed(error: unknown): ScreeningFailure {
  return isSchemaMismatch(error) ? "SCHEMA" : "UNAVAILABLE";
}

function registryInstalled(db: PrismaClient): boolean {
  return typeof db.screeningTool?.findMany === "function";
}

function missingCatalogue() {
  return {
    ok: true as const,
    registry: "missing" as const,
    cards: SCREENING_CANDIDATES.map((candidate) => ({
      ...candidate,
      registered: false,
      open: false,
      status: "Pending clinical approval",
      blockers: ["The screening registry is not available yet."],
    })),
  };
}

async function loadContacts(db: PrismaClient): Promise<SafetyContacts | null> {
  const row = await db.platformSetting.findUnique({ where: { key: SCREENING_SAFETY_SETTING }, select: { valueJson: true } });
  return parseSafetyContacts(row?.valueJson ?? null);
}

function gateFor(tool: {
  approvalState: string;
  licenseStatus: string;
  availability: string;
  retiredAt: Date | null;
  safetyProtocolRequired: boolean;
  safetyProtocolApproved: boolean;
  versions: Array<{ items: unknown; scoringSpec: unknown }>;
}, contacts: SafetyContacts | null): ToolGate {
  const version = tool.versions[0];
  return {
    approvalState: tool.approvalState,
    licenseStatus: tool.licenseStatus,
    availability: tool.availability,
    retiredAt: tool.retiredAt,
    safetyProtocolRequired: tool.safetyProtocolRequired,
    safetyProtocolApproved: tool.safetyProtocolApproved,
    hasItems: parseItems(version?.items) !== null,
    hasScoringSpec: parseScoringSpec(version?.scoringSpec) !== null,
    hasSafetyContacts: !tool.safetyProtocolRequired || contacts !== null,
  };
}

const toolSelect = {
  id: true,
  code: true,
  name: true,
  abbreviation: true,
  category: true,
  purpose: true,
  intendedPopulation: true,
  instructions: true,
  language: true,
  expectedMinutes: true,
  sourceReference: true,
  licenseStatus: true,
  approvalState: true,
  availability: true,
  safetyProtocolRequired: true,
  safetyProtocolApproved: true,
  effectiveFrom: true,
  retiredAt: true,
  versions: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, version: true, scoringAlgorithmVersion: true, items: true, scoringSpec: true, createdAt: true },
  },
} satisfies Prisma.ScreeningToolSelect;

export async function listScreeningCatalogue(db: PrismaClient) {
  if (!registryInstalled(db)) return missingCatalogue();
  try {
    const [rows, contacts] = await Promise.all([
      db.screeningTool.findMany({ select: toolSelect }),
      loadContacts(db),
    ]);
    const byCode = new Map(rows.map((row) => [row.code, row]));
    return {
      ok: true as const,
      registry: "ready" as const,
      cards: SCREENING_CANDIDATES.map((candidate) => {
        const row = byCode.get(candidate.code);
        const gate = row ? gateFor(row, contacts) : null;
        const open = gate ? patientCanStart(gate) : false;
        return {
          ...candidate,
          registered: Boolean(row),
          open,
          status: !row ? "Not registered" : open ? "Available" : row.approvalState === "PENDING_CLINICAL_REVIEW" ? "Pending clinical approval" : "Unavailable",
          blockers: gate ? activationBlockers(gate) : ["This instrument is not in the registry."],
        };
      }),
    };
  } catch (error) {
    if (!isSchemaMismatch(error)) return { ok: false as const, code: failed(error) };
    return missingCatalogue();
  }
}

export async function readScreeningTool(db: PrismaClient, code: string) {
  const candidate = SCREENING_CANDIDATES.find((item) => item.code === code);
  if (!candidate) return { ok: false as const, code: "NOT_FOUND" as const };
  if (!registryInstalled(db)) {
    return {
      ok: true as const,
      candidate,
      registered: false,
      open: false,
      blockers: ["The screening registry is not available yet."],
      purpose: candidate.detail,
      instructions: "Questions stay hidden until a licensed version is approved.",
      intendedPopulation: "To be confirmed by the clinical lead.",
      sourceReference: "Licensing has not been reviewed.",
      expectedMinutes: null as number | null,
      language: "en",
      version: null as string | null,
      approvalState: "PENDING_CLINICAL_REVIEW",
      licenseStatus: "NOT_REVIEWED",
    };
  }
  try {
    const [row, contacts] = await Promise.all([
      db.screeningTool.findUnique({ where: { code }, select: toolSelect }),
      loadContacts(db),
    ]);
    if (!row) {
      return {
        ok: true as const,
        candidate,
        registered: false,
        open: false,
        blockers: ["This instrument is not in the registry."],
        purpose: candidate.detail,
        instructions: "Questions stay hidden until a licensed version is approved.",
        intendedPopulation: "To be confirmed by the clinical lead.",
        sourceReference: "Licensing has not been reviewed.",
        expectedMinutes: null as number | null,
        language: "en",
        version: null as string | null,
        approvalState: "PENDING_CLINICAL_REVIEW",
        licenseStatus: "NOT_REVIEWED",
      };
    }
    const gate = gateFor(row, contacts);
    return {
      ok: true as const,
      candidate,
      registered: true,
      open: patientCanStart(gate),
      blockers: activationBlockers(gate),
      purpose: row.purpose,
      instructions: row.instructions,
      intendedPopulation: row.intendedPopulation,
      sourceReference: row.sourceReference,
      expectedMinutes: row.expectedMinutes,
      language: row.language,
      version: row.versions[0]?.version ?? null,
      approvalState: row.approvalState,
      licenseStatus: row.licenseStatus,
    };
  } catch (error) {
    if (!isSchemaMismatch(error)) return { ok: false as const, code: failed(error) };
    return {
      ok: true as const,
      candidate,
      registered: false,
      open: false,
      blockers: ["The screening registry is not available yet."],
      purpose: candidate.detail,
      instructions: "Questions stay hidden until a licensed version is approved.",
      intendedPopulation: "To be confirmed by the clinical lead.",
      sourceReference: "Licensing has not been reviewed.",
      expectedMinutes: null as number | null,
      language: "en",
      version: null as string | null,
      approvalState: "PENDING_CLINICAL_REVIEW",
      licenseStatus: "NOT_REVIEWED",
    };
  }
}

export async function startAssessment(
  db: PrismaClient,
  input: { actorUserId: string; code: string; consentAccepted: boolean; now?: Date },
) {
  if (!parseUuid(input.actorUserId) || !input.consentAccepted) return { ok: false as const, code: "CONSENT" as const };
  if (!startLimit.check(`start:${input.actorUserId}`).allowed) return { ok: false as const, code: "RATE" as const };
  const now = input.now ?? new Date();
  try {
    const patient = await db.patientProfile.findUnique({ where: { userId: input.actorUserId }, select: { id: true, archivedAt: true } });
    if (!patient || patient.archivedAt) return { ok: false as const, code: "NOT_FOUND" as const };
    const [tool, contacts] = await Promise.all([
      db.screeningTool.findUnique({ where: { code: input.code }, select: toolSelect }),
      loadContacts(db),
    ]);
    if (!tool || !tool.versions[0]) return { ok: false as const, code: "NOT_FOUND" as const };
    if (!patientCanStart(gateFor(tool, contacts))) return { ok: false as const, code: "FORBIDDEN" as const };
    const version = tool.versions[0];
    const existing = await db.screeningAssessment.findFirst({
      where: { patientProfileId: patient.id, versionId: version.id, state: "IN_PROGRESS" },
      select: { id: true, state: true },
    });
    if (existing && startDecision(existing.state) === "resume") return { ok: true as const, assessmentId: existing.id, resumed: true };
    const created = await db.$transaction(async (tx) => {
      const consent = await tx.screeningConsent.create({
        data: { patientProfileId: patient.id, documentVersion: SCREENING_CONSENT_VERSION, acceptedAt: now },
        select: { id: true },
      });
      const assessment = await tx.screeningAssessment.create({
        data: { patientProfileId: patient.id, versionId: version.id, consentId: consent.id, startedAt: now },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.started",
          entityType: "ScreeningAssessment",
          entityId: assessment.id,
          metadata: clinicalAuditMetadata({ code: tool.code, version: version.version }),
        },
      });
      return assessment.id;
    });
    return { ok: true as const, assessmentId: created, resumed: false };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function loadOwnSession(db: PrismaClient, input: { actorUserId: string; assessmentId: string }) {
  if (!parseUuid(input.actorUserId) || !parseUuid(input.assessmentId)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const row = await db.screeningAssessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        state: true,
        patient: { select: { userId: true } },
        version: { select: { version: true, items: true, scoringSpec: true, tool: { select: { code: true, abbreviation: true, name: true } } } },
      },
    });
    if (!row || !patientOwns(input.actorUserId, row.patient.userId)) return { ok: false as const, code: "NOT_FOUND" as const };
    if (submitDecision(row.state) !== "accept") return { ok: false as const, code: "CLOSED" as const };
    const items = parseItems(row.version.items);
    const spec = parseScoringSpec(row.version.scoringSpec);
    if (!items || !spec) return { ok: false as const, code: "FORBIDDEN" as const };
    return {
      ok: true as const,
      assessmentId: row.id,
      code: row.version.tool.code,
      title: row.version.tool.name,
      abbreviation: row.version.tool.abbreviation,
      version: row.version.version,
      items,
    };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function submitAssessment(
  db: PrismaClient,
  input: { actorUserId: string; assessmentId: string; answers: number[]; now?: Date },
) {
  if (!parseUuid(input.actorUserId) || !parseUuid(input.assessmentId)) return { ok: false as const, code: "NOT_FOUND" as const };
  if (!submitLimit.check(`submit:${input.actorUserId}`).allowed) return { ok: false as const, code: "RATE" as const };
  const now = input.now ?? new Date();
  try {
    const row = await db.screeningAssessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        state: true,
        patientProfileId: true,
        patient: { select: { userId: true } },
        version: {
          select: {
            version: true,
            scoringAlgorithmVersion: true,
            items: true,
            scoringSpec: true,
            tool: { select: { code: true, safetyProtocolRequired: true } },
          },
        },
      },
    });
    if (!row || !patientOwns(input.actorUserId, row.patient.userId)) return { ok: false as const, code: "NOT_FOUND" as const };
    if (submitDecision(row.state) === "closed") return { ok: false as const, code: "CLOSED" as const };
    if (submitDecision(row.state) !== "accept") return { ok: false as const, code: "INVALID" as const };
    const items = parseItems(row.version.items);
    const spec = parseScoringSpec(row.version.scoringSpec);
    if (!items || !spec || !row.version.scoringAlgorithmVersion) return { ok: false as const, code: "FORBIDDEN" as const };
    if (!answersMatchItems(items, spec, input.answers)) return { ok: false as const, code: "INVALID" as const };
    const scored = scoreAssessment(spec, input.answers);
    if (!scored) return { ok: false as const, code: "INVALID" as const };
    const contacts = await loadContacts(db);
    const safety = safetyPresentation(scored.safetyFlag, contacts);
    if (safety.kind === "blocked" || (row.version.tool.safetyProtocolRequired && !contacts)) {
      return { ok: false as const, code: "SAFETY" as const };
    }
    const snapshot = items.map((item) => ({ index: item.index, prompt: item.prompt, choices: item.choices }));
    await db.$transaction(async (tx) => {
      await tx.screeningAssessmentAnswer.deleteMany({ where: { assessmentId: row.id } });
      await tx.screeningAssessmentAnswer.createMany({
        data: spec.items.map((rule, position) => ({ assessmentId: row.id, itemIndex: rule.index, value: input.answers[position] })),
      });
      await tx.screeningAssessmentResult.create({
        data: {
          assessmentId: row.id,
          score: scored.score,
          maxScore: scored.maxScore,
          band: scored.band,
          algorithmVersion: row.version.scoringAlgorithmVersion ?? row.version.version,
          safetyFlag: scored.safetyFlag,
          calculatedAt: now,
        },
      });
      await tx.screeningAssessment.update({
        where: { id: row.id },
        data: { state: "SUBMITTED", submittedAt: now, itemSnapshot: snapshot },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.submitted",
          entityType: "ScreeningAssessment",
          entityId: row.id,
          metadata: clinicalAuditMetadata({ code: row.version.tool.code, version: row.version.version, safetyFlag: scored.safetyFlag }),
        },
      });
    });
    return {
      ok: true as const,
      assessmentId: row.id,
      view: patientResultView({
        score: scored.score,
        maxScore: scored.maxScore,
        band: scored.band,
        algorithmVersion: row.version.scoringAlgorithmVersion ?? row.version.version,
        completedAt: now,
      }),
      safety,
    };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function listOwnHistory(db: PrismaClient, actorUserId: string) {
  if (!registryInstalled(db)) return { ok: false as const, code: "SCHEMA" as const };
  if (!parseUuid(actorUserId)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const rows = await db.screeningAssessment.findMany({
      where: { patient: { userId: actorUserId }, state: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
      take: 30,
      select: {
        id: true,
        submittedAt: true,
        result: { select: { score: true, maxScore: true, band: true, safetyFlag: true } },
        version: { select: { version: true, tool: { select: { abbreviation: true, name: true, category: true } } } },
      },
    });
    return { ok: true as const, rows };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function readOwnResult(db: PrismaClient, input: { actorUserId: string; assessmentId: string }) {
  if (!parseUuid(input.actorUserId) || !parseUuid(input.assessmentId)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const row = await db.screeningAssessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        state: true,
        submittedAt: true,
        patient: { select: { userId: true } },
        result: true,
        version: { select: { version: true, tool: { select: { code: true, name: true, abbreviation: true } } } },
      },
    });
    if (!row || !patientOwns(input.actorUserId, row.patient.userId) || row.state !== "SUBMITTED" || !row.result || !row.submittedAt) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const contacts = row.result.safetyFlag ? await loadContacts(db) : null;
    return {
      ok: true as const,
      code: row.version.tool.code,
      name: row.version.tool.name,
      abbreviation: row.version.tool.abbreviation,
      version: row.version.version,
      view: patientResultView({
        score: row.result.score,
        maxScore: row.result.maxScore,
        band: row.result.band,
        algorithmVersion: row.result.algorithmVersion,
        completedAt: row.submittedAt,
      }),
      safety: safetyPresentation(row.result.safetyFlag, contacts),
    };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

async function careRelationship(db: PrismaClient, doctorProfileId: string, patientProfileId: string) {
  const row = await db.appointment.findFirst({
    where: { doctorProfileId, patientProfileId },
    select: { id: true },
  });
  return doctorMayAccess(Boolean(row));
}

export async function listDoctorAssessments(db: PrismaClient, doctorProfileId: string | null, clinicWide = false) {
  if (!registryInstalled(db)) return { ok: false as const, code: "SCHEMA" as const };
  if (!clinicWide && !parseUuid(doctorProfileId ?? "")) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const rows = await db.screeningAssessment.findMany({
      where: {
        state: "SUBMITTED",
        patient: { appointments: { some: clinicWide ? {} : { doctorProfileId: doctorProfileId ?? undefined } } },
      },
      orderBy: { submittedAt: "desc" },
      take: 50,
      select: {
        id: true,
        submittedAt: true,
        patient: { select: { id: true, fullName: true, userId: true, user: { select: { profileImageUpdatedAt: true } } } },
        result: { select: { score: true, maxScore: true, band: true } },
        reviews: { select: { id: true }, take: 1 },
        version: { select: { tool: { select: { abbreviation: true, name: true } } } },
      },
    });
    return { ok: true as const, rows };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function readDoctorAssessment(
  db: PrismaClient,
  input: { actorUserId: string; doctorProfileId: string | null; assessmentId: string; clinicWide?: boolean },
) {
  if (!parseUuid(input.actorUserId) || !parseUuid(input.assessmentId) || (!input.clinicWide && !parseUuid(input.doctorProfileId ?? ""))) {
    return { ok: false as const, code: "NOT_FOUND" as const };
  }
  try {
    const row = await db.screeningAssessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        state: true,
        submittedAt: true,
        itemSnapshot: true,
        patientProfileId: true,
        patient: { select: { id: true, fullName: true, user: { select: { id: true, profileImageUpdatedAt: true } } } },
        result: true,
        answers: { orderBy: { itemIndex: "asc" }, select: { itemIndex: true, value: true } },
        reviews: { orderBy: { reviewedAt: "desc" }, select: { id: true, interpretation: true, followUpNote: true, reviewedAt: true, doctor: { select: { displayName: true } } } },
        amendments: { orderBy: { createdAt: "desc" }, select: { id: true, reason: true, createdAt: true } },
        version: { select: { version: true, scoringAlgorithmVersion: true, items: true, toolId: true, tool: { select: { name: true, abbreviation: true, code: true } } } },
      },
    });
    if (!row || row.state !== "SUBMITTED" || !row.result) return { ok: false as const, code: "NOT_FOUND" as const };
    const allowed = input.clinicWide
      ? doctorMayAccess(Boolean(await db.appointment.findFirst({ where: { patientProfileId: row.patientProfileId }, select: { id: true } })))
      : await careRelationship(db, input.doctorProfileId ?? "", row.patientProfileId);
    if (!allowed) {
      await recordDenial(db, {
        actorUserId: input.actorUserId,
        patientProfileId: row.patientProfileId,
        entityType: "ScreeningAssessment",
        entityId: row.id,
        reason: "not_assigned",
      });
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const snapshot = parseItems(row.itemSnapshot) ?? parseItems(row.version.items) ?? [];
    const items = row.answers.map((answer) => {
      const item = snapshot.find((entry) => entry.index === answer.itemIndex);
      const choice = item?.choices.find((entry) => entry.value === answer.value);
      return { prompt: item?.prompt ?? "Question", answer: choice?.label ?? "Recorded" };
    });
    const history = await db.screeningAssessment.findMany({
      where: { patientProfileId: row.patientProfileId, state: "SUBMITTED", id: { not: row.id }, version: { toolId: row.version.toolId } },
      orderBy: { submittedAt: "desc" },
      take: 8,
      select: { id: true, submittedAt: true, result: { select: { score: true, band: true, algorithmVersion: true } }, version: { select: { version: true, scoringAlgorithmVersion: true } } },
    });
    await db.$transaction(async (tx) => {
      await tx.recordAccessLog.create({
        data: {
          actorUserId: input.actorUserId,
          patientProfileId: row.patientProfileId,
          entityType: "ScreeningAssessment",
          entityId: row.id,
          action: "READ",
          outcome: "ALLOWED",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.read",
          entityType: "ScreeningAssessment",
          entityId: row.id,
          metadata: clinicalAuditMetadata({ code: row.version.tool.code }),
        },
      });
    });
    return {
      ok: true as const,
      assessment: row,
      items,
      history: history.map((entry) => ({
        ...entry,
        comparable: entry.version.scoringAlgorithmVersion !== null && entry.version.scoringAlgorithmVersion === row.version.scoringAlgorithmVersion,
      })),
    };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

async function coveringDoctor(db: PrismaClient, patientProfileId: string) {
  const visit = await db.appointment.findFirst({
    where: { patientProfileId },
    orderBy: { startsAt: "desc" },
    select: { doctorProfileId: true },
  });
  return visit?.doctorProfileId ?? null;
}

export async function reviewAssessment(
  db: PrismaClient,
  input: { actorUserId: string; doctorProfileId: string | null; assessmentId: string; interpretation: string; followUpNote: string; now?: Date; clinicWide?: boolean },
) {
  const interpretation = boundedText(input.interpretation, INTERPRETATION_MAX);
  const followUp = input.followUpNote.trim() ? boundedText(input.followUpNote, FOLLOW_UP_MAX) : { ok: true as const, text: "" };
  if (!interpretation.ok || !followUp.ok) return { ok: false as const, code: "INVALID" as const };
  if (!parseUuid(input.assessmentId) || (!input.clinicWide && !parseUuid(input.doctorProfileId ?? ""))) return { ok: false as const, code: "NOT_FOUND" as const };
  const now = input.now ?? new Date();
  try {
    const row = await db.screeningAssessment.findUnique({
      where: { id: input.assessmentId },
      select: { id: true, state: true, patientProfileId: true, version: { select: { tool: { select: { code: true } } } } },
    });
    if (!row || row.state !== "SUBMITTED") return { ok: false as const, code: "NOT_FOUND" as const };
    const doctorProfileId = input.clinicWide ? await coveringDoctor(db, row.patientProfileId) : input.doctorProfileId;
    if (!doctorProfileId || !(await careRelationship(db, doctorProfileId, row.patientProfileId))) return { ok: false as const, code: "NOT_FOUND" as const };
    await db.$transaction(async (tx) => {
      const review = await tx.screeningClinicalReview.create({
        data: {
          assessmentId: row.id,
          doctorProfileId,
          interpretation: interpretation.text,
          followUpNote: followUp.text || null,
          reviewedAt: now,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.reviewed",
          entityType: "ScreeningClinicalReview",
          entityId: review.id,
          metadata: clinicalAuditMetadata({ code: row.version.tool.code, reviewed: true }),
        },
      });
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function amendAssessment(
  db: PrismaClient,
  input: { actorUserId: string; doctorProfileId: string | null; assessmentId: string; reason: string; clinicWide?: boolean },
) {
  const reason = boundedText(input.reason, AMENDMENT_MAX);
  if (!reason.ok || !parseUuid(input.assessmentId)) return { ok: false as const, code: "INVALID" as const };
  try {
    const row = await db.screeningAssessment.findUnique({
      where: { id: input.assessmentId },
      select: { id: true, state: true, patientProfileId: true },
    });
    if (!row || row.state !== "SUBMITTED") return { ok: false as const, code: "NOT_FOUND" as const };
    const allowed = input.clinicWide
      ? doctorMayAccess(Boolean(await db.appointment.findFirst({ where: { patientProfileId: row.patientProfileId }, select: { id: true } })))
      : await careRelationship(db, input.doctorProfileId ?? "", row.patientProfileId);
    if (!allowed) return { ok: false as const, code: "NOT_FOUND" as const };
    await db.$transaction(async (tx) => {
      const amendment = await tx.screeningAmendment.create({
        data: { assessmentId: row.id, editorUserId: input.actorUserId, reason: reason.text },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.amended",
          entityType: "ScreeningAmendment",
          entityId: amendment.id,
          metadata: clinicalAuditMetadata({ recorded: true }),
        },
      });
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function listAdminRegistry(db: PrismaClient) {
  if (!registryInstalled(db)) return { ok: false as const, code: "SCHEMA" as const };
  try {
    const [tools, submitted, pendingReview, active, contacts] = await Promise.all([
      db.screeningTool.findMany({ orderBy: { name: "asc" }, select: toolSelect }),
      db.screeningAssessment.count({ where: { state: "SUBMITTED" } }),
      db.screeningAssessment.count({ where: { state: "SUBMITTED", reviews: { none: {} } } }),
      db.screeningTool.count({ where: { availability: "ACTIVE" } }),
      loadContacts(db),
    ]);
    return {
      ok: true as const,
      stats: { instruments: tools.length, active, submitted, pendingReview },
      contactsConfigured: contacts !== null,
      tools: tools
        .map((tool) => ({ ...tool, blockers: activationBlockers(gateFor(tool, contacts)) }))
        .sort((left, right) => categoryOrder(left.category) - categoryOrder(right.category)),
    };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function readAdminTool(db: PrismaClient, id: string) {
  if (!parseUuid(id)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const [tool, contacts] = await Promise.all([
      db.screeningTool.findUnique({
        where: { id },
        select: {
          ...toolSelect,
          versions: { orderBy: { createdAt: "desc" }, select: { id: true, version: true, scoringAlgorithmVersion: true, createdAt: true, items: true, scoringSpec: true } },
        },
      }),
      loadContacts(db),
    ]);
    if (!tool) return { ok: false as const, code: "NOT_FOUND" as const };
    const gate = gateFor(tool, contacts);
    return { ok: true as const, tool, blockers: activationBlockers(gate), contactsConfigured: contacts !== null };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function updateGovernance(
  db: PrismaClient,
  input: { actorUserId: string; roleCodes: string[]; toolId: string; licenseStatus: string; approvalState: string; extra?: Record<string, unknown> },
) {
  if (!governanceChangeAllowed(input.roleCodes)) return { ok: false as const, code: "FORBIDDEN" as const };
  if (input.extra && governancePayloadRejected(input.extra)) return { ok: false as const, code: "FORBIDDEN" as const };
  if (!parseUuid(input.toolId) || !isLicenseStatus(input.licenseStatus) || !isApprovalState(input.approvalState)) {
    return { ok: false as const, code: "INVALID" as const };
  }
  try {
    const [tool, contacts] = await Promise.all([
      db.screeningTool.findUnique({ where: { id: input.toolId }, select: toolSelect }),
      loadContacts(db),
    ]);
    if (!tool) return { ok: false as const, code: "NOT_FOUND" as const };
    const retiredAt = input.approvalState === "RETIRED" ? tool.retiredAt ?? new Date() : null;
    const gate = gateFor(
      { ...tool, licenseStatus: input.licenseStatus, approvalState: input.approvalState, retiredAt },
      contacts,
    );
    const availability = nextAvailability(gate);
    await db.$transaction(async (tx) => {
      await tx.screeningTool.update({
        where: { id: tool.id },
        data: {
          licenseStatus: input.licenseStatus as Prisma.ScreeningToolUpdateInput["licenseStatus"],
          approvalState: input.approvalState as Prisma.ScreeningToolUpdateInput["approvalState"],
          availability,
          retiredAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.governance",
          entityType: "ScreeningTool",
          entityId: tool.id,
          metadata: clinicalAuditMetadata({ licenseStatus: input.licenseStatus, approvalState: input.approvalState, availability }),
        },
      });
    });
    return { ok: true as const, availability };
  } catch (error) {
    return { ok: false as const, code: failed(error) };
  }
}

export async function activateScreening(
  db: PrismaClient,
  input: { actorUserId: string; roleCodes: string[]; toolId: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!governanceChangeAllowed(input.roleCodes)) {
    return { ok: false, message: "A super administrator has to activate an instrument." };
  }
  if (!parseUuid(input.toolId)) return { ok: false, message: "This instrument could not be found." };
  try {
    const [tool, contacts] = await Promise.all([
      db.screeningTool.findUnique({ where: { id: input.toolId }, select: toolSelect }),
      loadContacts(db),
    ]);
    if (!tool) return { ok: false, message: "This instrument could not be found." };
    const blocker = activateBlocker(gateFor(tool, contacts));
    if (blocker) return { ok: false, message: blocker };
    await db.$transaction(async (tx) => {
      await tx.screeningTool.update({
        where: { id: tool.id },
        data: { availability: "ACTIVE", safetyProtocolApproved: true, retiredAt: null },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.activated",
          entityType: "ScreeningTool",
          entityId: tool.id,
          metadata: clinicalAuditMetadata({ availability: "ACTIVE" }),
        },
      });
    });
    return { ok: true, message: `${tool.name} is active. Patients can start it.` };
  } catch (error) {
    return { ok: false, message: failed(error) === "SCHEMA" ? "The screening registry is not available." : "This instrument could not be activated." };
  }
}

export async function deactivateScreening(
  db: PrismaClient,
  input: { actorUserId: string; roleCodes: string[]; toolId: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!governanceChangeAllowed(input.roleCodes)) {
    return { ok: false, message: "A super administrator has to change whether an instrument is active." };
  }
  if (!parseUuid(input.toolId)) return { ok: false, message: "This instrument could not be found." };
  try {
    const tool = await db.screeningTool.findUnique({
      where: { id: input.toolId },
      select: { id: true, name: true, availability: true, approvalState: true, retiredAt: true },
    });
    if (!tool) return { ok: false, message: "This instrument could not be found." };
    if (tool.retiredAt || tool.approvalState === "RETIRED" || tool.availability === "RETIRED") {
      return { ok: false, message: "This instrument is retired." };
    }
    if (tool.availability !== "ACTIVE") return { ok: false, message: "This instrument is not active." };
    await db.$transaction(async (tx) => {
      await tx.screeningTool.update({
        where: { id: tool.id },
        data: { availability: "INACTIVE" },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.deactivated",
          entityType: "ScreeningTool",
          entityId: tool.id,
          metadata: clinicalAuditMetadata({ availability: "INACTIVE" }),
        },
      });
    });
    return { ok: true, message: `${tool.name} is inactive. Patients cannot start it.` };
  } catch (error) {
    return { ok: false, message: failed(error) === "SCHEMA" ? "The screening registry is not available." : "This instrument could not be deactivated." };
  }
}

export async function saveQuestionSet(
  db: PrismaClient,
  input: { actorUserId: string; roleCodes: string[]; toolId: string; clear: boolean; questions: unknown; bands: unknown },
) {
  if (!governanceChangeAllowed(input.roleCodes)) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "A super administrator has to save questions." };
  }
  if (!registryInstalled(db)) return { ok: false as const, code: "SCHEMA" as const, message: "The screening registry is not available." };
  if (!parseUuid(input.toolId)) return { ok: false as const, code: "NOT_FOUND" as const, message: "This instrument could not be found." };
  const prepared = input.clear ? null : prepareQuestionSet({ questions: input.questions, bands: input.bands });
  if (prepared && !prepared.ok) return { ok: false as const, code: "INVALID" as const, message: prepared.message };
  try {
    const tool = await db.screeningTool.findUnique({
      where: { id: input.toolId },
        select: { id: true, versions: { orderBy: { createdAt: "desc" }, select: { id: true, version: true, scoringAlgorithmVersion: true, scoringSpec: true } } },
    });
    if (!tool) return { ok: false as const, code: "NOT_FOUND" as const, message: "This instrument could not be found." };
    const latest = tool.versions[0] ?? null;
    const used = latest ? await db.screeningAssessment.count({ where: { versionId: latest.id } }) : 0;
    const versionLabel = !latest || used > 0 ? nextQuestionVersion(tool.versions.map((version) => version.version)) : latest.version;
    const items = prepared?.ok ? prepared.prepared.items : [];
    const spec = prepared?.ok ? prepared.prepared.spec : null;
    const unchangedScore = Boolean(prepared?.ok && latest?.scoringAlgorithmVersion && JSON.stringify(parseScoringSpec(latest.scoringSpec)) === JSON.stringify(spec));
    const algorithm = prepared?.ok ? (unchangedScore ? latest?.scoringAlgorithmVersion ?? prepared.prepared.algorithmVersion : prepared.prepared.algorithmVersion) : null;
    const mode = prepared?.ok ? prepared.prepared.mode : "cleared";
    const saved = await db.$transaction(async (tx) => {
      const row = !latest || used > 0
        ? await tx.screeningToolVersion.create({
            data: {
              toolId: tool.id,
              version: versionLabel,
              scoringAlgorithmVersion: algorithm,
              items: items as Prisma.InputJsonValue,
              scoringSpec: spec ? (spec as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            },
            select: { id: true, version: true },
          })
        : await tx.screeningToolVersion.update({
            where: { id: latest.id },
            data: {
              scoringAlgorithmVersion: algorithm,
              items: items as Prisma.InputJsonValue,
              scoringSpec: spec ? (spec as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            },
            select: { id: true, version: true },
          });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.questions",
          entityType: "ScreeningToolVersion",
          entityId: row.id,
          metadata: clinicalAuditMetadata({ version: row.version, questions: items.length, scoring: mode }),
        },
      });
      return row;
    });
    return { ok: true as const, version: saved.version, mode };
  } catch (error) {
    return { ok: false as const, code: failed(error), message: "The question set could not be saved." };
  }
}

export async function saveSupportContact(
  db: PrismaClient,
  input: { actorUserId: string; roleCodes: string[]; region: string; serviceName: string; phone: string },
) {
  if (!isPortalAdministrator(input.roleCodes)) return { ok: false as const, message: "Only an administrator can save the support contact." };
  const contacts = supportContactDraft(input);
  if (!contacts) return { ok: false as const, message: "Enter the area, the service name, and a phone number with at least 3 digits." };
  try {
    await db.$transaction(async (tx) => {
      const saved = await tx.platformSetting.upsert({
        where: { key: SCREENING_SAFETY_SETTING },
        create: { key: SCREENING_SAFETY_SETTING, valueJson: contacts },
        update: { valueJson: contacts },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "screening.support_contact",
          entityType: "PlatformSetting",
          entityId: saved.id,
          metadata: clinicalAuditMetadata({ region: contacts.region, service: contacts.lines[0].label, numberSaved: true }),
        },
      });
    });
    return { ok: true as const, message: `${contacts.lines[0].label} is saved for ${contacts.region}. Patients see this number only when a screen raises the safety flag.` };
  } catch (error) {
    return { ok: false as const, code: failed(error), message: "The support contact could not be saved." };
  }
}

export type { ScreeningItem };
