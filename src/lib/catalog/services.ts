import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_CURRENCY_CODE, TEXT_LIMIT } from "./constants";
import { catalogFailure, type CatalogResult } from "./errors";
import { matchingServiceCodes, resolveIdentity } from "./identity";
import { decimalToMinorUnits, parseCurrency, parseMoney } from "./money";
import { canManageCatalog, cleanOptionalText, parseDuration, parseOptionalMode, parseUuid, referencedDeleteDecision } from "./rules";

type Actor = { userId: string; roleCodes: string[] };

function denied(actor: Actor): CatalogResult | null {
  if (!canManageCatalog(actor.roleCodes)) {
    return { ok: false, message: "Only an administrator can manage consultation services." };
  }
  return null;
}

function feeInput(amount: string, currency: string): { ok: true; fee: Prisma.Decimal; currency: string } | { ok: false; message: string } {
  const fee = parseMoney(amount);
  if (!fee) {
    return { ok: false, message: "Enter a fee of zero or more, with up to two decimal places." };
  }
  if (decimalToMinorUnits(fee) === null) {
    return { ok: false, message: "That fee cannot be stored." };
  }
  const parsedCurrency = parseCurrency(currency);
  if (!parsedCurrency) {
    return { ok: false, message: "Enter a three-letter currency code." };
  }
  return { ok: true, fee, currency: parsedCurrency };
}

export async function createConsultationService(
  input: {
    name: string;
    slug?: string;
    code?: string;
    description: string;
    mode: string;
    durationMinutes: string;
    defaultFee?: string;
    currency?: string;
    preparationInstructions: string;
  },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const identity = resolveIdentity(input);
  if (!identity.ok) return identity;
  const description = cleanOptionalText(input.description, TEXT_LIMIT);
  if (!description.ok) return description;
  const preparation = cleanOptionalText(input.preparationInstructions, TEXT_LIMIT);
  if (!preparation.ok) return preparation;
  const mode = parseOptionalMode(input.mode);
  if (!mode.ok) return { ok: false, message: "Choose online, in person, or either mode." };
  const duration = parseDuration(input.durationMinutes);
  if (!duration) return { ok: false, message: "Enter a duration from 1 to 480 minutes." };
  const fee = feeInput(input.defaultFee?.trim() || "0.00", input.currency?.trim() || DEFAULT_CURRENCY_CODE);
  if (!fee.ok) return fee;

  try {
    const codes = matchingServiceCodes(identity);
    const existing = await deps.db.consultationService.findFirst({
      where: {
        OR: [
          { nameKey: identity.nameKey },
          { slug: identity.slug },
          { code: identity.code },
          ...(codes.length > 0 ? [{ code: { in: codes } }] : []),
        ],
      },
      select: { name: true },
    });
    if (existing) {
      return { ok: false, message: `${existing.name} already exists. Edit that service instead of adding a duplicate.` };
    }

    await deps.db.$transaction(async (tx) => {
      const created = await tx.consultationService.create({
        data: {
          code: identity.code,
          slug: identity.slug,
          name: identity.name,
          nameKey: identity.nameKey,
          description: description.text,
          mode: mode.mode,
          defaultDurationMinutes: duration,
          defaultFee: fee.fee,
          currency: fee.currency,
          preparationInstructions: preparation.text,
          isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "service.created",
          entityType: "ConsultationService",
          entityId: created.id,
          metadata: { code: identity.code, slug: identity.slug, currency: fee.currency },
        },
      });
    });
  } catch (error) {
    return { ok: false, message: catalogFailure(error, "A service with that name or slug already exists.") };
  }
  return { ok: true, message: `${identity.name} was added.` };
}

export async function updateConsultationService(
  input: {
    id: string;
    name: string;
    description: string;
    mode: string;
    durationMinutes: string;
    preparationInstructions: string;
    isActive: boolean;
  },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const id = parseUuid(input.id);
  if (!id) return { ok: false, message: "That service was not found." };
  const identity = resolveIdentity({ name: input.name, slug: "placeholder" });
  if (!identity.ok) return { ok: false, message: identity.message };
  const description = cleanOptionalText(input.description, TEXT_LIMIT);
  if (!description.ok) return description;
  const preparation = cleanOptionalText(input.preparationInstructions, TEXT_LIMIT);
  if (!preparation.ok) return preparation;
  const mode = parseOptionalMode(input.mode);
  if (!mode.ok) return { ok: false, message: "Choose online, in person, or either mode." };
  const duration = parseDuration(input.durationMinutes);
  if (!duration) return { ok: false, message: "Enter a duration from 1 to 480 minutes." };

  try {
    const existing = await deps.db.consultationService.findUnique({ where: { id } });
    if (!existing) return { ok: false, message: "That service was not found." };
    const duplicate = await deps.db.consultationService.findFirst({
      where: { nameKey: identity.nameKey, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) return { ok: false, message: "A service with that name already exists." };

    await deps.db.$transaction(async (tx) => {
      await tx.consultationService.update({
        where: { id },
        data: {
          name: identity.name,
          nameKey: identity.nameKey,
          description: description.text,
          mode: mode.mode,
          defaultDurationMinutes: duration,
          preparationInstructions: preparation.text,
          isActive: input.isActive,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: input.isActive ? "service.updated" : "service.deactivated",
          entityType: "ConsultationService",
          entityId: id,
          metadata: { code: existing.code, currency: existing.currency, isActive: input.isActive },
        },
      });
    });
  } catch (error) {
    return { ok: false, message: catalogFailure(error, "A service with that name already exists.") };
  }
  return {
    ok: true,
    message: input.isActive
      ? `${identity.name} was updated. Its fee stays the amount set on Fees and pricing.`
      : `${identity.name} was deactivated. Existing appointments still reference it, and it cannot be chosen for a new appointment.`,
  };
}

export async function updateServiceFee(
  input: { id: string; defaultFee: string; currency: string },
  deps: { db: PrismaClient; actor: Actor },
): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const id = parseUuid(input.id);
  if (!id) return { ok: false, message: "That service was not found." };
  const fee = feeInput(input.defaultFee, input.currency);
  if (!fee.ok) return fee;

  try {
    const existing = await deps.db.consultationService.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return { ok: false, message: "That service was not found." };
    await deps.db.$transaction(async (tx) => {
      const minor = decimalToMinorUnits(fee.fee);
      await tx.consultationService.update({
        where: { id },
        data: { defaultFee: fee.fee, currency: fee.currency },
      });
      if (minor !== null) {
        await tx.doctorOffering.updateMany({
          where: { consultationServiceId: id },
          data: { price: fee.fee, priceAmountMinor: minor, currency: fee.currency },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "pricing.service_fee_updated",
          entityType: "ConsultationService",
          entityId: id,
          metadata: { currency: fee.currency },
        },
      });
    });
  } catch (error) {
    return { ok: false, message: catalogFailure(error, "The default fee could not be saved.") };
  }
  return { ok: true, message: "The fee was saved. Every doctor who offers this service uses this amount. Appointments already booked keep their stored fee." };
}

export async function deleteConsultationService(id: string, deps: { db: PrismaClient; actor: Actor }): Promise<CatalogResult> {
  const block = denied(deps.actor);
  if (block) return block;
  const serviceId = parseUuid(id);
  if (!serviceId) return { ok: false, message: "That service was not found." };
  try {
    const existing = await deps.db.consultationService.findUnique({ where: { id: serviceId }, select: { id: true, name: true } });
    if (!existing) return { ok: false, message: "That service was not found." };
    const [offerings, appointments] = await Promise.all([
      deps.db.doctorOffering.count({ where: { consultationServiceId: serviceId } }),
      deps.db.appointment.count({ where: { consultationServiceId: serviceId } }),
    ]);
    const decision = referencedDeleteDecision({ offerings, appointments }, "service");
    if (!decision.allowed) return { ok: false, message: decision.message };
    await deps.db.$transaction(async (tx) => {
      await tx.consultationService.delete({ where: { id: serviceId } });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "service.deleted",
          entityType: "ConsultationService",
          entityId: serviceId,
          metadata: { name: existing.name },
        },
      });
    });
  } catch (error) {
    return { ok: false, message: catalogFailure(error, "This service is already used. Deactivate it instead of deleting it.") };
  }
  return { ok: true, message: "The service was deleted." };
}
