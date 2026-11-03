import type { GuardianRelationshipType, PrismaClient } from "@prisma/client";
import { GUARDIAN_AUTHORIZATION_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { normalizeEmail } from "@/lib/auth/email-address";
import { isPortalAdministrator, isUuid } from "@/lib/admin/rules";
import { clinicalAuditMetadata, MINOR_TREATMENT_SETTING } from "./rules";

const RELATIONSHIPS = ["PARENT", "LEGAL_GUARDIAN", "OTHER"] as const;

export async function authorizeGuardianConsent(
  input: { patientId: string; guardianEmail: string; relationshipType: string; confirmed: boolean },
  deps: { db: PrismaClient; actor: { userId: string; roleCodes: string[] }; now?: Date },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) {
    return { ok: false, message: "Only an administrator can record guardian authorization." };
  }
  if (!input.confirmed) return { ok: false, message: "Confirm that this person is the authorized guardian." };
  if (!isUuid(input.patientId)) return { ok: false, message: "That patient profile was not found." };
  const relationshipType = RELATIONSHIPS.find((value) => value === input.relationshipType);
  if (!relationshipType) return { ok: false, message: "Choose parent, legal guardian, or other." };
  const email = normalizeEmail(input.guardianEmail);
  if (!email) return { ok: false, message: "Enter the guardian's email address." };

  const now = deps.now ?? new Date();
  try {
    const patient = await deps.db.patientProfile.findUnique({
      where: { id: input.patientId },
      select: { id: true, userId: true, archivedAt: true, fullName: true },
    });
    if (!patient || patient.archivedAt) return { ok: false, message: "That patient profile was not found." };
    const guardian = await deps.db.user.findUnique({
      where: { emailNormalized: email },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!guardian || guardian.deletedAt) return { ok: false, message: "No account uses this email address." };
    if (guardian.id === patient.userId) return { ok: false, message: "A patient cannot authorize care for their own record." };
    if (guardian.status !== "ACTIVE") return { ok: false, message: "That guardian account cannot authorize care." };

    await deps.db.$transaction(async (tx) => {
      const relationship = await tx.guardianRelationship.upsert({
        where: { guardianUserId_dependentPatientId: { guardianUserId: guardian.id, dependentPatientId: patient.id } },
        create: {
          guardianUserId: guardian.id,
          dependentPatientId: patient.id,
          relationshipType: relationshipType as GuardianRelationshipType,
          status: "AUTHORIZED",
          authorizedAt: now,
        },
        update: {
          relationshipType: relationshipType as GuardianRelationshipType,
          status: "AUTHORIZED",
          authorizedAt: now,
          revokedAt: null,
          expiresAt: null,
        },
        select: { id: true },
      });
      const version = GUARDIAN_AUTHORIZATION_DOCUMENT_VERSION;
      const existing = await tx.consentRecord.findUnique({
        where: { userId_consentType_documentVersion: { userId: guardian.id, consentType: "GUARDIAN_AUTHORIZATION", documentVersion: version } },
        select: { id: true },
      });
      const consent = existing
        ? await tx.consentRecord.update({
            where: { id: existing.id },
            data: { withdrawnAt: null, acceptedAt: now, expiresAt: null },
            select: { id: true },
          })
        : await tx.consentRecord.create({
            data: { userId: guardian.id, consentType: "GUARDIAN_AUTHORIZATION", documentVersion: version, acceptedAt: now },
            select: { id: true },
          });
      const setting = await tx.platformSetting.findUnique({ where: { key: MINOR_TREATMENT_SETTING }, select: { valueJson: true } });
      if (setting?.valueJson !== true) {
        await tx.platformSetting.upsert({
          where: { key: MINOR_TREATMENT_SETTING },
          create: { key: MINOR_TREATMENT_SETTING, valueJson: true },
          update: { valueJson: true },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "guardian.authorized",
          entityType: "GuardianRelationship",
          entityId: relationship.id,
          metadata: clinicalAuditMetadata({ patientId: patient.id, relationshipType, consentId: consent.id }),
        },
      });
    });
    return {
      ok: true,
      message: `Guardian authorization is recorded for ${patient.fullName}. A doctor can add a clinical record.`,
    };
  } catch {
    return { ok: false, message: "The guardian authorization could not be recorded." };
  }
}
