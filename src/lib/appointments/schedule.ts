import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { sanitizeMetadata } from "@/lib/admin/rules";
import { parseUuid } from "@/lib/catalog/rules";
import { prisma } from "@/lib/db/prisma";
import type { PrismaClient } from "@prisma/client";
import { rulesConflict, type ScheduleRule } from "./slots";
import { BOOKING_TIMEZONE, clockFromMinutes, parseCalendarDate, parseClock } from "./time";
import { expireOverdueHolds } from "./payment-holds";
import { SLOT_OCCUPYING_STATUSES } from "./schedule-data";

type Actor = { userId: string; roleCodes: string[] };
type Deps = { db?: PrismaClient; now?: Date };
export type ScheduleResult = { ok: true; message: string } | { ok: false; message: string };

function isAdmin(roles: string[]) {
  return roles.includes(ADMIN_ROLE_CODE) || roles.includes(SUPER_ADMIN_ROLE_CODE);
}

async function ownedDoctor(db: PrismaClient, actor: Actor, requestedId: string | null) {
  const admin = isAdmin(actor.roleCodes);
  const own = actor.roleCodes.includes(DOCTOR_ROLE_CODE)
    ? await db.doctorProfile.findUnique({ where: { userId: actor.userId }, select: { id: true } })
    : null;
  if (!admin) {
    if (!own) return null;
    if (requestedId && requestedId !== own.id) return null;
    return own.id;
  }
  if (!requestedId) return own?.id ?? null;
  if (!parseUuid(requestedId)) return null;
  const target = await db.doctorProfile.findUnique({ where: { id: requestedId }, select: { id: true } });
  return target?.id ?? null;
}

function clinicPlace(clinic: string) {
  const parts = clinic.split(",").map((part) => part.trim()).filter((part) => part.length >= 2);
  const locality = (parts.length > 1 ? parts[parts.length - 1] : clinic).slice(0, 80);
  const rawName = (parts.length > 1 ? parts.slice(0, -1).join(", ") : clinic).slice(0, 120);
  return { name: rawName.length >= 2 ? rawName : clinic.slice(0, 120), locality };
}

async function findClinic(db: PrismaClient, name: string, locality: string) {
  return db.location.findFirst({
    where: {
      countryCode: "SL",
      name: { equals: name, mode: "insensitive" },
      locality: { equals: locality, mode: "insensitive" },
    },
    select: { id: true, isActive: true },
  });
}

async function resolveTypedClinic(db: PrismaClient, clinic: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (clinic.length < 3 || clinic.length > 160) {
    return { ok: false, message: "Enter the clinic location, using 3 to 160 characters." };
  }
  const place = clinicPlace(clinic);
  const existing = await findClinic(db, place.name, place.locality);
  if (existing?.isActive) return { ok: true, id: existing.id };
  if (existing) return { ok: false, message: "That clinic is already on file but is not active. Ask an administrator to turn it on." };
  try {
    const created = await db.location.create({
      data: {
        name: place.name,
        addressLine1: clinic.slice(0, 200),
        locality: place.locality,
        district: place.locality,
        countryCode: "SL",
        isActive: true,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (error) {
    const duplicate = error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002";
    if (!duplicate) throw error;
    const again = await findClinic(db, place.name, place.locality);
    if (again?.isActive) return { ok: true, id: again.id };
    if (again) return { ok: false, message: "That clinic is already on file but is not active. Ask an administrator to turn it on." };
    return { ok: false, message: "That clinic is already on file. Choose it again and save the hours." };
  }
}

function dateOrNull(value: string | null | undefined): Date | null | "invalid" {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = parseCalendarDate(trimmed);
  return parsed ?? "invalid";
}

export async function saveAvailabilityRule(
  input: {
    actor: Actor;
    doctorProfileId?: string | null;
    ruleId?: string | null;
    dayOfWeek: number;
    start: string;
    end: string;
    mode: "ONLINE" | "IN_PERSON" | "BOTH";
    locationId?: string | null;
    clinic?: string | null;
    offeringId?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
  },
  deps: Deps = {},
): Promise<ScheduleResult> {
  const db = deps.db ?? prisma;
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    return { ok: false, message: "Choose a weekday." };
  }
  const startMinute = parseClock(input.start);
  const endMinute = parseClock(input.end);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) {
    return { ok: false, message: "End time must be after the start time on the same day. Times use Africa/Freetown (GMT)." };
  }
  if (input.mode !== "ONLINE" && input.mode !== "IN_PERSON" && input.mode !== "BOTH") {
    return { ok: false, message: "Choose online, in person, or both." };
  }
  const coversBoth = input.mode === "BOTH";
  const needsClinic = input.mode === "IN_PERSON" || coversBoth;
  const typedClinic = (input.clinic ?? "").trim().replace(/\s+/g, " ");
  if (needsClinic && typedClinic && (typedClinic.length < 3 || typedClinic.length > 160)) {
    return { ok: false, message: "Enter the clinic location, using 3 to 160 characters." };
  }
  if (needsClinic && !typedClinic && !(input.locationId && parseUuid(input.locationId))) {
    return { ok: false, message: "Enter the clinic for in-person hours." };
  }
  if (coversBoth && input.offeringId) {
    return { ok: false, message: "Leave the service open when these hours cover online and in person. Patients then choose the visit type." };
  }
  if (input.offeringId && !parseUuid(input.offeringId)) return { ok: false, message: "That consultation service was not found." };
  const validFrom = dateOrNull(input.validFrom);
  const validUntil = dateOrNull(input.validUntil);
  if (validFrom === "invalid" || validUntil === "invalid") return { ok: false, message: "Enter valid dates, or leave them blank." };
  if (validFrom && validUntil && validFrom > validUntil) return { ok: false, message: "The end date must be on or after the start date." };
  if (input.ruleId && !parseUuid(input.ruleId)) return { ok: false, message: "That schedule was not found." };

  try {
    const doctorProfileId = await ownedDoctor(db, input.actor, input.doctorProfileId ?? null);
    if (!doctorProfileId) return { ok: false, message: "That doctor schedule was not found." };
    let locationId: string | null = null;
    if (needsClinic && typedClinic) {
      const clinic = await resolveTypedClinic(db, typedClinic);
      if (!clinic.ok) return clinic;
      locationId = clinic.id;
    } else if (needsClinic && input.locationId) {
      locationId = input.locationId;
    }
    const storedMode: "ONLINE" | "IN_PERSON" | null = input.mode === "ONLINE" || input.mode === "IN_PERSON" ? input.mode : null;
    if (locationId) {
      const location = await db.location.findUnique({ where: { id: locationId }, select: { isActive: true } });
      if (!location?.isActive) return { ok: false, message: "Choose an active clinic for in-person hours." };
    }
    if (input.offeringId) {
      const offering = await db.doctorOffering.findUnique({
        where: { id: input.offeringId },
        select: { doctorProfileId: true, mode: true, isActive: true },
      });
      if (!offering || !offering.isActive || offering.doctorProfileId !== doctorProfileId || offering.mode !== input.mode) {
        return { ok: false, message: "Choose one of this doctor's active services for the same consultation mode." };
      }
    }
    const existing = await db.doctorAvailabilityRule.findMany({ where: { doctorProfileId, isActive: true } });
    const candidate: ScheduleRule = {
      dayOfWeek: input.dayOfWeek,
      startMinute,
      endMinute,
      mode: storedMode,
      locationId,
      offeringId: input.offeringId ?? null,
      validFrom: validFrom ? validFrom.toISOString().slice(0, 10) : null,
      validUntil: validUntil ? validUntil.toISOString().slice(0, 10) : null,
      isActive: true,
    };
    const conflict = existing.some((row) => {
      if (input.ruleId && row.id === input.ruleId) return false;
      return rulesConflict(candidate, {
        dayOfWeek: row.dayOfWeek,
        startMinute: row.localStartTime.getUTCHours() * 60 + row.localStartTime.getUTCMinutes(),
        endMinute: row.localEndTime.getUTCHours() * 60 + row.localEndTime.getUTCMinutes(),
        mode: row.mode,
        locationId: row.locationId,
        offeringId: row.offeringId,
        validFrom: row.validFrom ? row.validFrom.toISOString().slice(0, 10) : null,
        validUntil: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null,
        isActive: row.isActive,
      });
    });
    if (conflict) return { ok: false, message: "Those hours overlap another active rule for the same day." };
    const data = {
      doctorProfileId,
      dayOfWeek: input.dayOfWeek,
      localStartTime: clockFromMinutes(startMinute),
      localEndTime: clockFromMinutes(endMinute),
      timezone: BOOKING_TIMEZONE,
      mode: storedMode,
      locationId,
      offeringId: input.offeringId || null,
      validFrom,
      validUntil,
      isActive: true,
    };
    const saved = input.ruleId
      ? await db.doctorAvailabilityRule.updateMany({ where: { id: input.ruleId, doctorProfileId }, data })
      : null;
    if (input.ruleId && saved?.count !== 1) return { ok: false, message: "That schedule was not found." };
    const rule = input.ruleId
      ? { id: input.ruleId }
      : await db.doctorAvailabilityRule.create({ data, select: { id: true } });
    await db.auditLog.create({
      data: {
        actorUserId: input.actor.userId,
        action: input.ruleId ? "availability.rule_updated" : "availability.rule_created",
        entityType: "DoctorAvailabilityRule",
        entityId: rule.id,
        metadata: sanitizeMetadata({ dayOfWeek: input.dayOfWeek, mode: input.mode }) ?? undefined,
      },
    });
    return { ok: true, message: "The weekly hours were saved. Existing appointments were not changed." };
  } catch (error) {
    console.error(`availability_save_failed code=${error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "unknown"}`);
    return { ok: false, message: "The weekly hours could not be saved." };
  }
}

export async function deactivateAvailabilityRule(input: { actor: Actor; doctorProfileId?: string | null; ruleId: string }, deps: Deps = {}): Promise<ScheduleResult> {
  const db = deps.db ?? prisma;
  if (!parseUuid(input.ruleId)) return { ok: false, message: "That schedule was not found." };
  try {
    const doctorProfileId = await ownedDoctor(db, input.actor, input.doctorProfileId ?? null);
    if (!doctorProfileId) return { ok: false, message: "That doctor schedule was not found." };
    const updated = await db.doctorAvailabilityRule.updateMany({
      where: { id: input.ruleId, doctorProfileId, isActive: true },
      data: { isActive: false },
    });
    if (updated.count !== 1) return { ok: false, message: "That schedule was not found." };
    await db.auditLog.create({
      data: {
        actorUserId: input.actor.userId,
        action: "availability.rule_deactivated",
        entityType: "DoctorAvailabilityRule",
        entityId: input.ruleId,
        metadata: sanitizeMetadata({ active: false }) ?? undefined,
      },
    });
    return { ok: true, message: "Those hours are no longer offered. Existing appointments were not changed." };
  } catch {
    return { ok: false, message: "The weekly hours could not be updated." };
  }
}

export async function addTimeOff(
  input: { actor: Actor; doctorProfileId?: string | null; startsAt: Date; endsAt: Date; reason?: string | null },
  deps: Deps = {},
): Promise<ScheduleResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime()) || input.endsAt <= input.startsAt) {
    return { ok: false, message: "The unavailable period must end after it starts. Times use Africa/Freetown (GMT)." };
  }
  if (input.endsAt.getTime() - input.startsAt.getTime() > 366 * 86_400_000) {
    return { ok: false, message: "Enter an unavailable period of 366 days or less." };
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length > 200) return { ok: false, message: "Keep the reason under 200 characters." };
  try {
    const doctorProfileId = await ownedDoctor(db, input.actor, input.doctorProfileId ?? null);
    if (!doctorProfileId) return { ok: false, message: "That doctor schedule was not found." };
    return await db.$transaction(async (tx) => {
      await expireOverdueHolds(tx, doctorProfileId);
      const clash = await tx.appointment.findFirst({
        where: {
          doctorProfileId,
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
          OR: [
            { status: { in: ["PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] } },
            { status: "PENDING_PAYMENT", paymentHoldExpiresAt: { gt: now } },
          ],
        },
        select: { id: true },
      });
      if (clash) {
        return { ok: false as const, message: "That period overlaps an existing booking. Cancel or reschedule it before blocking the time." };
      }
      const created = await tx.doctorTimeOff.create({
        data: { doctorProfileId, startsAt: input.startsAt, endsAt: input.endsAt, reason: reason || null },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actor.userId,
          action: "availability.time_off_created",
          entityType: "DoctorTimeOff",
          entityId: created.id,
          metadata: sanitizeMetadata({ reason: reason || null }) ?? undefined,
        },
      });
      return { ok: true as const, message: "The unavailable period was saved. Existing appointments were not changed." };
    });
  } catch {
    return { ok: false, message: "The unavailable period could not be saved." };
  }
}

export async function removeTimeOff(input: { actor: Actor; doctorProfileId?: string | null; timeOffId: string }, deps: Deps = {}): Promise<ScheduleResult> {
  const db = deps.db ?? prisma;
  if (!parseUuid(input.timeOffId)) return { ok: false, message: "That unavailable period was not found." };
  try {
    const doctorProfileId = await ownedDoctor(db, input.actor, input.doctorProfileId ?? null);
    if (!doctorProfileId) return { ok: false, message: "That doctor schedule was not found." };
    const removed = await db.doctorTimeOff.deleteMany({ where: { id: input.timeOffId, doctorProfileId } });
    if (removed.count !== 1) return { ok: false, message: "That unavailable period was not found." };
    await db.auditLog.create({
      data: {
        actorUserId: input.actor.userId,
        action: "availability.time_off_removed",
        entityType: "DoctorTimeOff",
        entityId: input.timeOffId,
        metadata: sanitizeMetadata({ removed: true }) ?? undefined,
      },
    });
    return { ok: true, message: "The unavailable period was removed. Existing appointments were not changed." };
  } catch {
    return { ok: false, message: "The unavailable period could not be removed." };
  }
}

export { SLOT_OCCUPYING_STATUSES };
