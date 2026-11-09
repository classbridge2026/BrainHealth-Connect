import type { Prisma, PrismaClient } from "@prisma/client";
import { TEXT_LIMIT } from "./constants";
import { catalogFailure, type CatalogResult } from "./errors";
import { decimalToMinorUnits, parseCurrency, parseMoney } from "./money";
import {
  activeOfferingBlocker,
  canManageCatalog,
  cleanOptionalText,
  parseDuration,
  parseRequiredMode,
  parseUuid,
} from "./rules";

type Actor = { userId: string; roleCodes: string[] };

type VisitMode = "ONLINE" | "IN_PERSON";

/** One visit, or both when the service allows either. */
export function offeringModesFor(serviceMode: VisitMode | null, requested: VisitMode | "ANY"): VisitMode[] {
  if (requested === "ANY") return serviceMode ? [serviceMode] : ["ONLINE", "IN_PERSON"];
  return [requested];
}

const writeOptions = { maxWait: 15_000, timeout: 30_000 };

function denied(actor: Actor): CatalogResult | null {
  if (!canManageCatalog(actor.roleCodes)) {
    return { ok: false, message: "Only an administrator can manage doctor offerings." };
  }
  return null;
}

async function loadEligibility(
  db: Prisma.TransactionClient,
  input: { doctorProfileId: string; specialtyId: string; consultationServiceId: string; mode: "ONLINE" | "IN_PERSON" },
) {
  const [doctor, service] = await Promise.all([
    db.doctorProfile.findUnique({
      where: { id: input.doctorProfileId },
      select: {
        verificationStatus: true,
        fullName: true,
        user: { select: { id: true, status: true, deletedAt: true } },
        specialties: {
          where: { specialtyId: input.specialtyId },
          select: { claimStatus: true, specialty: { select: { isActive: true } } },
        },
      },
    }),
    db.consultationService.findUnique({
      where: { id: input.consultationServiceId },
      select: { isActive: true, mode: true, name: true, defaultFee: true, currency: true },
    }),
  ]);
  const claim = doctor?.specialties[0];
  return { doctor, service, claim };
}

async function notifyAssignedOffering(
  tx: Prisma.TransactionClient,
  input: { recipientId?: string; offeringId: string; serviceName: string; mode: "ONLINE" | "IN_PERSON" },
) {
  if (!input.recipientId) return;
  const visit = input.mode === "ONLINE" ? "an online visit" : "an in-person visit";
  await tx.notification.create({
    data: {
      recipientId: input.recipientId,
      channel: "IN_APP",
      type: "offering.assigned",
      title: "A consultation service was assigned to you",
      preview: `${input.serviceName} is now assigned as ${visit}. Patients can book it while the offering stays active.`,
      entityType: "DoctorOffering",
      entityId: input.offeringId,
      status: "SENT",
    },
  });
}

export async function createDoctorOffering(
  input: {
    doctorProfileId: string;
    specialtyId: string;
    consultationServiceId: string;
    mode: string;
    durationMinutes: string;
    fee: string;
    currency: string;
    notes: string;
    isActive: boolean;
  },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const doctorProfileId = parseUuid(input.doctorProfileId);
  const specialtyId = parseUuid(input.specialtyId);
  const consultationServiceId = parseUuid(input.consultationServiceId);
  if (!doctorProfileId || !specialtyId || !consultationServiceId) {
    return { ok: false, message: "Choose a doctor, specialty, and service." };
  }
  const mode = parseRequiredMode(input.mode);
  if (!mode) return { ok: false, message: "Choose online or in person." };
  const duration = parseDuration(input.durationMinutes);
  if (!duration) return { ok: false, message: "Enter a duration from 1 to 480 minutes." };
  const notes = cleanOptionalText(input.notes, TEXT_LIMIT);
  if (!notes.ok) return notes;

  try {
    await deps.db.$transaction(async (tx) => {
      const { doctor, service, claim } = await loadEligibility(tx, {
        doctorProfileId,
        specialtyId,
        consultationServiceId,
        mode,
      });
      if (!doctor || !service) {
        throw new Error("MISSING_RECORD");
      }
      const blocker = activeOfferingBlocker({
        verificationStatus: doctor.verificationStatus,
        userStatus: doctor.user.status,
        deletedAt: doctor.user.deletedAt,
        specialtyClaim: claim?.claimStatus ?? null,
        specialtyActive: claim?.specialty.isActive ?? false,
        serviceActive: service.isActive,
        serviceMode: service.mode,
        offeringMode: mode,
      });
      if (blocker) {
        throw new Error(`BLOCK:${blocker}`);
      }
      if (input.isActive) {
        const duplicate = await tx.doctorOffering.findFirst({
          where: { doctorProfileId, specialtyId, consultationServiceId, mode, isActive: true },
          select: { id: true },
        });
        if (duplicate) {
          throw new Error("DUPLICATE_ACTIVE");
        }
      }
      const minor = decimalToMinorUnits(service.defaultFee);
      const currency = parseCurrency(service.currency);
      if (minor === null || !currency) throw new Error("FEE");
      const created = await tx.doctorOffering.create({
        data: {
          doctorProfileId,
          specialtyId,
          consultationServiceId,
          mode,
          durationMinutes: duration,
          price: service.defaultFee,
          priceAmountMinor: minor,
          currency,
          notes: notes.text,
          isActive: input.isActive,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "offering.created",
          entityType: "DoctorOffering",
          entityId: created.id,
          metadata: { doctorProfileId, consultationServiceId, currency, isActive: input.isActive },
        },
      });
      if (input.isActive) {
        await notifyAssignedOffering(tx, {
          recipientId: doctor.user.id,
          offeringId: created.id,
          serviceName: service.name,
          mode,
        });
      }
    }, writeOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "MISSING_RECORD") return { ok: false, message: "Choose a doctor and an active service." };
    if (message === "FEE") return { ok: false, message: "Set this service fee on Fees and pricing before assigning it." };
    if (message.startsWith("BLOCK:")) return { ok: false, message: message.slice("BLOCK:".length) };
    if (message === "DUPLICATE_ACTIVE") {
      return {
        ok: false,
        message: "This doctor already has an active offering for that service, specialty, and mode. Deactivate it before adding another.",
      };
    }
    return {
      ok: false,
      message: catalogFailure(
        error,
        "This doctor already has an active offering for that service, specialty, and mode.",
      ),
    };
  }
  return { ok: true, message: "The doctor offering was saved. Booked appointment fees were not changed." };
}

export async function assignDoctorOfferings(
  input: {
    doctorProfileId: string;
    specialtyId: string;
    consultationServiceIds: string[];
    mode: string;
    durationMinutes: string;
    notes: string;
    isActive: boolean;
  },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const ids = [...new Set(input.consultationServiceIds.map((id) => parseUuid(id)).filter((id): id is string => Boolean(id)))].slice(0, 30);
  if (ids.length === 0) return { ok: false, message: "Choose at least one consultation service." };
  const requested = input.mode.trim().toUpperCase();
  if (requested !== "ONLINE" && requested !== "IN_PERSON" && requested !== "ANY") {
    return { ok: false, message: "Choose online, in person, or online or in person." };
  }
  const services = await deps.db.consultationService.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, mode: true, defaultDurationMinutes: true },
  });
  const byId = new Map(services.map((service) => [service.id, service]));
  const saved: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const service = byId.get(id);
    if (!service) {
      skipped.push("A selected service was not found.");
      continue;
    }
    const modes = offeringModesFor(service.mode, requested);
    const duration = ids.length === 1 && input.durationMinutes.trim() ? input.durationMinutes : String(service.defaultDurationMinutes);
    for (const mode of modes) {
      const result = await createDoctorOffering(
        {
          doctorProfileId: input.doctorProfileId,
          specialtyId: input.specialtyId,
          consultationServiceId: id,
          mode,
          durationMinutes: duration,
          fee: "",
          currency: "",
          notes: input.notes,
          isActive: input.isActive,
        },
        deps,
      );
      const visit = mode === "ONLINE" ? "online" : "in person";
      if (result.ok) saved.push(`${service.name} (${visit})`);
      else skipped.push(`${service.name} (${visit}): ${result.message}`);
    }
  }
  if (saved.length === 0) {
    return { ok: false, message: skipped[0] ?? "The services could not be assigned." };
  }
  const summary = saved.length === 1 ? `${saved[0]} was assigned.` : `${saved.length} offerings were assigned.`;
  return { ok: true, message: skipped.length > 0 ? `${summary} ${skipped.join(" ")}` : summary };
}

export async function updateDoctorOffering(
  input: {
    id: string;
    mode: string;
    durationMinutes: string;
    fee: string;
    currency: string;
    notes: string;
    isActive: boolean;
  },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const id = parseUuid(input.id);
  if (!id) return { ok: false, message: "That offering was not found." };
  const mode = parseRequiredMode(input.mode);
  if (!mode) return { ok: false, message: "Choose online or in person." };
  const duration = parseDuration(input.durationMinutes);
  if (!duration) return { ok: false, message: "Enter a duration from 1 to 480 minutes." };
  const notes = cleanOptionalText(input.notes, TEXT_LIMIT);
  if (!notes.ok) return notes;

  try {
    await deps.db.$transaction(async (tx) => {
      const existing = await tx.doctorOffering.findUnique({
        where: { id },
        select: { id: true, doctorProfileId: true, specialtyId: true, consultationServiceId: true, isActive: true },
      });
      if (!existing) throw new Error("MISSING_RECORD");
      const { doctor, service, claim } = await loadEligibility(tx, {
        doctorProfileId: existing.doctorProfileId,
        specialtyId: existing.specialtyId,
        consultationServiceId: existing.consultationServiceId,
        mode,
      });
      if (!doctor || !service) throw new Error("MISSING_RECORD");
      if (input.isActive) {
        const blocker = activeOfferingBlocker({
          verificationStatus: doctor.verificationStatus,
          userStatus: doctor.user.status,
          deletedAt: doctor.user.deletedAt,
          specialtyClaim: claim?.claimStatus ?? null,
          specialtyActive: claim?.specialty.isActive ?? false,
          serviceActive: service.isActive,
          serviceMode: service.mode,
          offeringMode: mode,
        });
        if (blocker) throw new Error(`BLOCK:${blocker}`);
        const duplicate = await tx.doctorOffering.findFirst({
          where: {
            doctorProfileId: existing.doctorProfileId,
            specialtyId: existing.specialtyId,
            consultationServiceId: existing.consultationServiceId,
            mode,
            isActive: true,
            NOT: { id },
          },
          select: { id: true },
        });
        if (duplicate) throw new Error("DUPLICATE_ACTIVE");
      }
      await tx.doctorOffering.update({
        where: { id },
        data: {
          mode,
          durationMinutes: duration,
          notes: notes.text,
          isActive: input.isActive,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: input.isActive ? "offering.updated" : "offering.deactivated",
          entityType: "DoctorOffering",
          entityId: id,
          metadata: { isActive: input.isActive },
        },
      });
      if (input.isActive && existing.isActive === false) {
        await notifyAssignedOffering(tx, {
          recipientId: doctor.user.id,
          offeringId: id,
          serviceName: service.name,
          mode,
        });
      }
    }, writeOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "MISSING_RECORD") return { ok: false, message: "That offering was not found." };
    if (message.startsWith("BLOCK:")) return { ok: false, message: message.slice("BLOCK:".length) };
    if (message === "DUPLICATE_ACTIVE") {
      return { ok: false, message: "This doctor already has an active offering for that service, specialty, and mode." };
    }
    return { ok: false, message: catalogFailure(error, "This doctor already has an active offering for that service, specialty, and mode.") };
  }
  return {
    ok: true,
    message: input.isActive
      ? "The offering was updated. Appointment fees already booked were not changed."
      : "The offering was deactivated. Existing appointments still reference it.",
  };
}

export async function updateOfferingFee(
  input: { id: string; fee: string; currency: string },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const id = parseUuid(input.id);
  if (!id) return { ok: false, message: "That offering was not found." };
  const price = parseMoney(input.fee);
  if (!price) return { ok: false, message: "Enter a doctor fee of zero or more, with up to two decimal places." };
  const minor = decimalToMinorUnits(price);
  if (minor === null) return { ok: false, message: "That fee cannot be stored." };
  const currency = parseCurrency(input.currency);
  if (!currency) return { ok: false, message: "Enter a three-letter currency code." };

  try {
    await deps.db.$transaction(async (tx) => {
      const existing = await tx.doctorOffering.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new Error("MISSING_RECORD");
      await tx.doctorOffering.update({
        where: { id },
        data: { price, priceAmountMinor: minor, currency },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "pricing.offering_fee_updated",
          entityType: "DoctorOffering",
          entityId: id,
          metadata: { currency },
        },
      });
    }, writeOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "MISSING_RECORD") return { ok: false, message: "That offering was not found." };
    return { ok: false, message: catalogFailure(error, "The doctor fee could not be saved.") };
  }
  return { ok: true, message: "The doctor price was updated. The default service fee and booked appointment fees were left unchanged." };
}

export async function deleteDoctorOffering(id: string, deps: { db: PrismaClient; actor: Actor }): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const offeringId = parseUuid(id);
  if (!offeringId) return { ok: false, message: "That offering was not found." };
  try {
    const [appointments, rules] = await Promise.all([
      deps.db.appointment.count({ where: { offeringId } }),
      deps.db.doctorAvailabilityRule.count({ where: { offeringId } }),
    ]);
    const existing = await deps.db.doctorOffering.findUnique({ where: { id: offeringId }, select: { id: true } });
    if (!existing) return { ok: false, message: "That offering was not found." };
    await deps.db.$transaction(async (tx) => {
      await tx.doctorOffering.delete({ where: { id: offeringId } });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "offering.deleted",
          entityType: "DoctorOffering",
          entityId: offeringId,
          metadata: { appointments, rules },
        },
      });
    }, writeOptions);
    const used = appointments + rules > 0;
    return {
      ok: true,
      message: used
        ? "The offering was deleted. Appointments already booked stay."
        : "The offering was deleted.",
    };
  } catch (error) {
    return { ok: false, message: catalogFailure(error, "The offering could not be deleted.") };
  }
}
