import type { PrismaClient } from "@prisma/client";
import { DEVELOPER_ROLE_CODE } from "@/lib/auth/constants";
import { notDeveloper } from "@/lib/auth/visibility";
import { countryName } from "@/lib/catalog/countries";
import { formatFee, visitCharge } from "@/lib/catalog/money";
import { parseUuid } from "@/lib/catalog/rules";
import { forgetRemembered, rememberFor } from "@/lib/db/remember";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { canReceiveNewAppointment } from "@/lib/doctors/rules";
import { completeEndedConsultations, shownAppointmentStatus } from "./finish";
import { expireOverdueHolds } from "./payment-holds";
import { loadBlockingIntervals, loadDoctorRules } from "./schedule-data";
import { describeDaySlots } from "./slots";
import { addDays, freetownDate, formatBookingWhen, formatClock, formatNormalClock, minutesFromClock, parseCalendarDate } from "./time";

export type QueryFailure = { ok: false; code: "SCHEMA" | "UNAVAILABLE" | "NOT_FOUND" };

function failed(error: unknown): QueryFailure {
  return { ok: false, code: isSchemaMismatch(error) ? "SCHEMA" : "UNAVAILABLE" };
}

const HORIZON_DAYS = 14;

export async function listBookableSpecialties(db: PrismaClient) {
  try {
    const rows = await db.specialty.findMany({
      where: {
        isActive: true,
        offerings: {
          some: {
            isActive: true,
            consultationService: { isActive: true },
            doctor: { verificationStatus: "APPROVED", user: { status: "ACTIVE", deletedAt: null, ...notDeveloper } },
          },
        },
        doctors: { some: { claimStatus: "VERIFIED", specialty: { isActive: true } } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true },
    });
    return { ok: true as const, specialties: rows };
  } catch (error) {
    return failed(error);
  }
}

export async function listBookableDoctors(db: PrismaClient, specialtyId: string) {
  if (!parseUuid(specialtyId)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const rows = await db.doctorProfile.findMany({
      where: {
        verificationStatus: "APPROVED",
        user: { status: "ACTIVE", deletedAt: null, ...notDeveloper },
        specialties: { some: { specialtyId, claimStatus: "VERIFIED", specialty: { isActive: true } } },
        offerings: { some: { specialtyId, isActive: true, consultationService: { isActive: true } } },
      },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        qualificationTitle: true,
        yearsExperience: true,
        languages: true,
        consultationModes: true,
      },
    });
    return { ok: true as const, doctors: rows };
  } catch (error) {
    return failed(error);
  }
}

export async function loadPublicDoctor(db: PrismaClient, doctorId: string) {
  if (!parseUuid(doctorId)) return { ok: false as const, code: "NOT_FOUND" as const };
  return rememberFor(`public-doctor:${doctorId}`, 30_000, () => readPublicDoctor(db, doctorId), (result) => result.ok);
}

async function readPublicDoctor(db: PrismaClient, doctorId: string) {
  try {
    const doctor = await db.doctorProfile.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        displayName: true,
        fullName: true,
        biography: true,
        yearsExperience: true,
        qualificationKind: true,
        qualificationTitle: true,
        qualificationInstitution: true,
        qualificationYear: true,
        languages: true,
        verificationStatus: true,
        user: { select: { id: true, status: true, deletedAt: true, profileImageUpdatedAt: true, roles: { select: { role: { select: { code: true } } } } } },
        specialties: {
          where: { claimStatus: "VERIFIED", specialty: { isActive: true } },
          select: { specialty: { select: { id: true, name: true, isActive: true } }, claimStatus: true },
        },
        offerings: {
          where: { isActive: true, consultationService: { isActive: true }, specialty: { isActive: true } },
          orderBy: { priceAmountMinor: "asc" },
          select: {
            id: true,
            mode: true,
            durationMinutes: true,
            price: true,
            priceAmountMinor: true,
            currency: true,
            notes: true,
            specialtyId: true,
            specialty: { select: { name: true, isActive: true } },
            consultationService: { select: { name: true, isActive: true, description: true, defaultFee: true, currency: true } },
          },
        },
      },
    });
    if (!doctor || doctor.user.roles.some((entry) => entry.role.code === DEVELOPER_ROLE_CODE)) return { ok: false as const, code: "NOT_FOUND" as const };
    const bookable = doctor.specialties.some((row) =>
      canReceiveNewAppointment({
        verificationStatus: doctor.verificationStatus,
        userStatus: doctor.user.status,
        deletedAt: doctor.user.deletedAt,
        specialtyClaim: row.claimStatus,
        specialtyActive: row.specialty.isActive,
      }),
    );
    return {
      ok: true as const,
      doctor: {
        id: doctor.id,
        displayName: doctor.displayName,
        userId: doctor.user.id,
        imageVersion: doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
        biography: doctor.biography,
        yearsExperience: doctor.yearsExperience,
        qualificationKind: doctor.qualificationKind,
        qualificationTitle: doctor.qualificationTitle,
        qualificationInstitution: doctor.qualificationInstitution,
        qualificationYear: doctor.qualificationYear,
        languages: doctor.languages,
        bookable,
        specialties: doctor.specialties.map((row) => row.specialty.name),
        offerings: doctor.offerings.map((row) => {
          const charge = visitCharge({
            price: row.price,
            priceAmountMinor: row.priceAmountMinor,
            currency: row.currency,
            defaultFee: row.consultationService.defaultFee,
            defaultCurrency: row.consultationService.currency,
          });
          return {
            id: row.id,
            specialtyId: row.specialtyId,
            specialty: row.specialty.name,
            service: row.consultationService.name,
            description: row.consultationService.description,
            mode: row.mode,
            durationMinutes: row.durationMinutes,
            fee: formatFee(charge?.feeAmount ?? row.price, charge?.currency ?? row.currency),
            notes: row.notes,
          };
        }),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadOfferingSlots(
  db: PrismaClient,
  input: { offeringId: string; day: string; locationId?: string | null; now?: Date; excludeAppointmentId?: string },
) {
  if (!parseUuid(input.offeringId)) return { ok: false as const, code: "NOT_FOUND" as const };
  const now = input.now ?? new Date();
  const today = freetownDate(now);
  const requested = parseCalendarDate(input.day);
  const horizon = addDays(parseCalendarDate(today) ?? now, HORIZON_DAYS - 1).toISOString().slice(0, 10);
  if (!requested || input.day < today || input.day > horizon) {
    return { ok: false as const, code: "NOT_FOUND" as const };
  }
  try {
    const offering = await db.doctorOffering.findUnique({
      where: { id: input.offeringId },
      select: {
        id: true,
        isActive: true,
        mode: true,
        durationMinutes: true,
        price: true,
        priceAmountMinor: true,
        currency: true,
        doctorProfileId: true,
        specialtyId: true,
        specialty: { select: { name: true, isActive: true } },
        consultationService: { select: { name: true, isActive: true, defaultFee: true, currency: true } },
        doctor: { select: { id: true, displayName: true, verificationStatus: true, user: { select: { id: true, status: true, deletedAt: true, profileImageUpdatedAt: true } } } },
      },
    });
    if (!offering || !offering.isActive || !offering.consultationService.isActive || !offering.specialty.isActive) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const dayStart = requested;
    const [specialtyClaim, , rules] = await Promise.all([
      db.doctorSpecialty.findFirst({
        where: { doctorProfileId: offering.doctorProfileId, specialtyId: offering.specialtyId },
        select: { claimStatus: true, specialty: { select: { isActive: true } } },
      }),
      expireOverdueHolds(db, offering.doctorProfileId),
      loadDoctorRules(db, offering.doctorProfileId),
    ]);
    if (
      !canReceiveNewAppointment({
        verificationStatus: offering.doctor.verificationStatus,
        userStatus: offering.doctor.user.status,
        deletedAt: offering.doctor.user.deletedAt,
        specialtyClaim: specialtyClaim?.claimStatus ?? null,
        specialtyActive: specialtyClaim?.specialty.isActive ?? false,
      })
    ) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const locationIds = [
      ...new Set(rules.filter((rule) => rule.mode !== "ONLINE" && rule.locationId && (rule.offeringId === null || rule.offeringId === offering.id)).map((rule) => rule.locationId as string)),
    ];
    const [locations, blocks] = await Promise.all([
      offering.mode === "IN_PERSON" && locationIds.length
        ? db.location.findMany({
            where: { id: { in: locationIds }, isActive: true },
            select: { id: true, name: true, locality: true, district: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      loadBlockingIntervals(db, {
        doctorProfileId: offering.doctorProfileId,
        rangeStart: dayStart,
        rangeEnd: addDays(dayStart, 1),
        now,
        excludeAppointmentId: input.excludeAppointmentId,
      }),
    ]);
    const locationId = offering.mode === "IN_PERSON" ? input.locationId ?? null : null;
    const described =
      offering.mode === "ONLINE" || (locationId && locations.some((row) => row.id === locationId))
        ? describeDaySlots({
            day: input.day,
            durationMinutes: offering.durationMinutes,
            mode: offering.mode,
            locationId,
            offeringId: offering.id,
            rules,
            blocks,
            now,
          })
        : [];
    const schedule = described.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      label: formatNormalClock(minutesFromClock(slot.startsAt)),
      availability: slot.availability,
    }));
    const charge = visitCharge({
      price: offering.price,
      priceAmountMinor: offering.priceAmountMinor,
      currency: offering.currency,
      defaultFee: offering.consultationService.defaultFee,
      defaultCurrency: offering.consultationService.currency,
    });
    return {
      ok: true as const,
      offering: {
        id: offering.id,
        doctorId: offering.doctor.id,
        doctorUserId: offering.doctor.user.id,
        doctorImageVersion: offering.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
        doctorName: offering.doctor.displayName,
        specialty: offering.specialty.name,
        service: offering.consultationService.name,
        mode: offering.mode,
        durationMinutes: offering.durationMinutes,
        fee: formatFee(charge?.feeAmount ?? offering.price, charge?.currency ?? offering.currency),
        priceAmountMinor: charge?.feeAmountMinor ?? offering.priceAmountMinor,
      },
      locations: locations.map((row) => ({ id: row.id, label: `${row.name}, ${row.locality}, ${row.district}` })),
      slots: schedule.filter((slot) => slot.availability === "open").map(({ startsAt, label }) => ({ startsAt, label })),
      schedule,
      today,
      horizon,
    };
  } catch (error) {
    return failed(error);
  }
}

/** One offering, one rule list, and one block list for every day in the booking window. */
export async function loadOfferingRange(
  db: PrismaClient,
  input: { offeringId: string; days: string[]; now?: Date },
): Promise<{ ok: true; days: Array<{ day: string; slots: Array<{ startsAt: string; label: string }> }> } | QueryFailure> {
  if (!parseUuid(input.offeringId) || input.days.length === 0) return { ok: false, code: "NOT_FOUND" };
  const now = input.now ?? new Date();
  const today = freetownDate(now);
  const horizon = addDays(parseCalendarDate(today) ?? now, HORIZON_DAYS - 1).toISOString().slice(0, 10);
  const days = input.days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today && day <= horizon);
  if (days.length === 0) return { ok: false, code: "NOT_FOUND" };
  try {
    const offering = await db.doctorOffering.findUnique({
      where: { id: input.offeringId },
      select: {
        id: true,
        isActive: true,
        mode: true,
        durationMinutes: true,
        price: true,
        priceAmountMinor: true,
        currency: true,
        doctorProfileId: true,
        specialtyId: true,
        specialty: { select: { name: true, isActive: true } },
        consultationService: { select: { name: true, isActive: true, defaultFee: true, currency: true } },
        doctor: { select: { verificationStatus: true, user: { select: { status: true, deletedAt: true } } } },
      },
    });
    if (!offering || !offering.isActive || !offering.consultationService.isActive || !offering.specialty.isActive) {
      return { ok: false, code: "NOT_FOUND" };
    }
    const rangeStart = parseCalendarDate(days[0]);
    const rangeEnd = parseCalendarDate(days[days.length - 1]);
    if (!rangeStart || !rangeEnd) return { ok: false, code: "NOT_FOUND" };
    const [specialtyClaim, , rules] = await Promise.all([
      db.doctorSpecialty.findFirst({
        where: { doctorProfileId: offering.doctorProfileId, specialtyId: offering.specialtyId },
        select: { claimStatus: true, specialty: { select: { isActive: true } } },
      }),
      expireOverdueHolds(db, offering.doctorProfileId),
      loadDoctorRules(db, offering.doctorProfileId),
    ]);
    if (
      !canReceiveNewAppointment({
        verificationStatus: offering.doctor.verificationStatus,
        userStatus: offering.doctor.user.status,
        deletedAt: offering.doctor.user.deletedAt,
        specialtyClaim: specialtyClaim?.claimStatus ?? null,
        specialtyActive: specialtyClaim?.specialty.isActive ?? false,
      })
    ) {
      return { ok: false, code: "NOT_FOUND" };
    }
    const blocks = await loadBlockingIntervals(db, {
      doctorProfileId: offering.doctorProfileId,
      rangeStart,
      rangeEnd: addDays(rangeEnd, 1),
      now,
    });
    return {
      ok: true,
      days: days.map((day) => ({
        day,
        slots: describeDaySlots({
          day,
          durationMinutes: offering.durationMinutes,
          mode: offering.mode,
          locationId: null,
          offeringId: offering.id,
          rules,
          blocks,
          now,
        })
          .filter((slot) => slot.availability === "open")
          .map((slot) => ({
            startsAt: slot.startsAt.toISOString(),
            label: formatNormalClock(minutesFromClock(slot.startsAt)),
          })),
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export function resumePaymentHref(row: { id: string; offeringId: string | null }) {
  return row.offeringId
    ? `/patient/book/${row.offeringId}?step=payment&appointment=${row.id}`
    : `/patient/appointments/${row.id}#payment`;
}

export async function listPatientAppointments(db: PrismaClient, userId: string, now = new Date()) {
  try {
    const patient = await db.patientProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!patient) return { ok: true as const, upcoming: [], pending: [], history: [] };
    const dueDoctors = await db.appointment.findMany({
      where: { patientProfileId: patient.id, status: "PENDING_PAYMENT", paymentHoldExpiresAt: { lte: now } },
      select: { doctorProfileId: true },
      distinct: ["doctorProfileId"],
    });
    if (dueDoctors.length > 0) {
      await Promise.all(dueDoctors.map((row) => expireOverdueHolds(db, row.doctorProfileId)));
    }
    const [, rows] = await Promise.all([
      completeEndedConsultations(db, { now, patientProfileId: patient.id }),
      db.appointment.findMany({
      where: { patientProfileId: patient.id },
      orderBy: { startsAt: "desc" },
      take: 100,
      select: {
        id: true,
        offeringId: true,
        status: true,
        paymentHoldExpiresAt: true,
        mode: true,
        startsAt: true,
        feeAmount: true,
        feeAmountMinor: true,
        currency: true,
        endsAt: true,
        doctor: {
          select: {
            userId: true,
            displayName: true,
            verificationStatus: true,
            user: { select: { status: true, deletedAt: true, profileImageUpdatedAt: true } },
          },
        },
        consultationService: { select: { name: true } },
        specialty: { select: { name: true } },
        payments: { select: { status: true } },
        location: { select: { name: true } },
      },
    }),
    ]);
    const mapped = rows.map((row) => ({
      id: row.id,
      offeringId: row.offeringId,
      paymentHoldExpiresAt: row.paymentHoldExpiresAt,
      status: shownAppointmentStatus(row.status, row.endsAt, now),
      mode: row.mode,
      when: formatBookingWhen(row.startsAt),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      fee: formatFee(row.feeAmount, row.currency),
      feeAmountMinor: row.feeAmountMinor,
      doctor: row.doctor.displayName,
      doctorUserId: row.doctor.userId,
      doctorImageVersion: row.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
      doctorVerificationStatus: row.doctor.verificationStatus,
      doctorUserStatus: row.doctor.user.status,
      doctorDeletedAt: row.doctor.user.deletedAt,
      paymentStatuses: row.payments.map((payment) => payment.status),
      specialty: row.specialty.name,
      service: row.consultationService.name,
      location: row.location?.name ?? null,
    }));
    const closed = new Set(["COMPLETED", "CANCELLED_BY_PATIENT", "CANCELLED_BY_DOCTOR", "CANCELLED_BY_ADMIN", "NO_SHOW", "RESCHEDULED", "EXPIRED_UNPAID"]);
    const needsAction = new Set(["PENDING_APPROVAL", "PENDING_PAYMENT"]);
    const pending = mapped.filter((row) => needsAction.has(row.status));
    return {
      ok: true as const,
      upcoming: mapped.filter((row) => row.startsAt >= now && !closed.has(row.status) && !needsAction.has(row.status)),
      pending,
      history: mapped.filter((row) => (row.startsAt < now || closed.has(row.status)) && !needsAction.has(row.status)),
    };
  } catch (error) {
    return failed(error);
  }
}

const appointmentSelect = {
  id: true,
  status: true,
  mode: true,
  startsAt: true,
  endsAt: true,
  feeAmount: true,
  feeAmountMinor: true,
  currency: true,
  paymentHoldExpiresAt: true,
  cancellationReason: true,
  patientConcern: true,
  visitChannel: true,
  intakeHistory: true,
  consentAcceptedAt: true,
  checkedInAt: true,
  offeringId: true,
  locationId: true,
  specialty: { select: { name: true } },
  consultationService: { select: { name: true, code: true, preparationInstructions: true } },
  offering: { select: { notes: true } },
  location: {
    select: {
      name: true,
      addressLine1: true,
      addressLine2: true,
      locality: true,
      district: true,
      countryCode: true,
      phone: true,
      accessInstructions: true,
    },
  },
  payments: { select: { status: true } },
  doctor: { select: { id: true, displayName: true, userId: true, verificationStatus: true, user: { select: { status: true, deletedAt: true, profileImageUpdatedAt: true } } } },
  patient: { select: { id: true, fullName: true, userId: true, user: { select: { status: true, deletedAt: true, profileImageUpdatedAt: true } } } },
  events: { orderBy: { occurredAt: "asc" as const }, select: { id: true, fromStatus: true, toStatus: true, occurredAt: true, detail: true } },
} as const;

function presentAppointment(row: {
  id: string;
  status: string;
  mode: "ONLINE" | "IN_PERSON";
  startsAt: Date;
  endsAt: Date;
  feeAmount: { toString(): string };
  feeAmountMinor: number;
  currency: string;
  paymentHoldExpiresAt: Date | null;
  cancellationReason: string | null;
  patientConcern: string | null;
  visitChannel: "IN_PERSON" | "VIDEO" | "AUDIO" | null;
  intakeHistory: string | null;
  consentAcceptedAt: Date | null;
  checkedInAt: Date | null;
  offeringId: string | null;
  locationId: string | null;
  doctor: { id: string; displayName: string; userId: string; verificationStatus: string; user: { status: string; deletedAt: Date | null; profileImageUpdatedAt: Date | null } };
  patient: { id: string; fullName: string; userId: string; user: { status: string; deletedAt: Date | null; profileImageUpdatedAt: Date | null } };
  specialty: { name: string };
  consultationService: { name: string; code: string; preparationInstructions: string | null };
  offering: { notes: string | null } | null;
  payments: Array<{ status: string }>;
  location: {
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    locality: string;
    district: string;
    countryCode: string;
    phone: string | null;
    accessInstructions: string | null;
  } | null;
  events: Array<{ id: string; fromStatus: string | null; toStatus: string; occurredAt: Date; detail: string | null }>;
}) {
  const place = row.location
    ? {
        name: row.location.name,
        address: [row.location.addressLine1, row.location.addressLine2, row.location.locality, row.location.district, countryName(row.location.countryCode)].filter(Boolean).join(", "),
        phone: row.location.phone,
        instructions: row.location.accessInstructions,
      }
    : null;
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    when: formatBookingWhen(row.startsAt),
    until: formatBookingWhen(row.endsAt),
    fee: formatFee(row.feeAmount.toString(), row.currency),
    feeAmountMinor: row.feeAmountMinor,
    currency: row.currency,
    paymentHoldExpiresAt: row.paymentHoldExpiresAt,
    cancellationReason: row.cancellationReason,
    patientConcern: row.patientConcern,
    visitChannel: row.visitChannel,
    intakeHistory: row.intakeHistory,
    consentAcceptedAt: row.consentAcceptedAt,
    checkedInAt: row.checkedInAt,
    offeringId: row.offeringId,
    locationId: row.locationId,
    doctor: {
      id: row.doctor.id,
      displayName: row.doctor.displayName,
      userId: row.doctor.userId,
      imageVersion: row.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
      verificationStatus: row.doctor.verificationStatus,
      userStatus: row.doctor.user.status,
      deletedAt: row.doctor.user.deletedAt,
    },
    patient: {
      id: row.patient.id,
      fullName: row.patient.fullName,
      userId: row.patient.userId,
      imageVersion: row.patient.user.profileImageUpdatedAt?.toISOString() ?? null,
      userStatus: row.patient.user.status,
    },
    specialty: row.specialty.name,
    service: row.consultationService.name,
    serviceCode: row.consultationService.code,
    preparation: row.consultationService.preparationInstructions || row.offering?.notes || null,
    paymentStatuses: row.payments.map((payment) => payment.status),
    location: row.location ? `${row.location.name}, ${row.location.locality}` : null,
    place,
    events: row.events.map((event) => ({ ...event, when: formatBookingWhen(event.occurredAt) })),
    scheduleReason: scheduleReason(row.events),
  };
}

function scheduleReason(events: Array<{ detail: string | null }>) {
  const prefix = "schedule_reason:";
  const detail = events.find((event) => event.detail?.startsWith(prefix))?.detail;
  const text = detail?.slice(prefix.length).trim();
  return text || null;
}

export async function loadOwnedAppointment(db: PrismaClient, input: { id: string; userId: string; as: "patient" | "doctor" | "staff" }) {
  if (!parseUuid(input.id)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const row = await db.appointment.findUnique({ where: { id: input.id }, select: appointmentSelect });
    if (!row) return { ok: false as const, code: "NOT_FOUND" as const };
    const owns =
      input.as === "staff" ||
      (input.as === "patient" ? row.patient.userId === input.userId : row.doctor.userId === input.userId);
    if (!owns) return { ok: false as const, code: "NOT_FOUND" as const };
    return { ok: true as const, appointment: presentAppointment(row) };
  } catch (error) {
    return failed(error);
  }
}

export function forgetDoctorSchedule(doctorProfileId: string) {
  forgetRemembered(`doctor-schedule:${doctorProfileId}`);
}

export async function loadDoctorSchedule(db: PrismaClient, doctorProfileId: string) {
  if (!parseUuid(doctorProfileId)) return { ok: false as const, code: "NOT_FOUND" as const };
  if (process.env.NODE_ENV === "test") return readDoctorSchedule(db, doctorProfileId);
  return rememberFor(`doctor-schedule:${doctorProfileId}`, 20_000, () => readDoctorSchedule(db, doctorProfileId), (result) => result.ok);
}

async function readDoctorSchedule(db: PrismaClient, doctorProfileId: string) {
  try {
    const [rules, timeOff, offerings, upcoming] = await Promise.all([
      db.doctorAvailabilityRule.findMany({
        where: { doctorProfileId, isActive: true },
        orderBy: [{ dayOfWeek: "asc" }, { localStartTime: "asc" }],
        include: { location: { select: { name: true } }, offering: { select: { consultationService: { select: { name: true } } } } },
      }),
      db.doctorTimeOff.findMany({ where: { doctorProfileId, endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 30 }),
      db.doctorOffering.findMany({
        where: { doctorProfileId, isActive: true },
        select: { id: true, mode: true, durationMinutes: true, consultationService: { select: { name: true } } },
        orderBy: { consultationService: { name: "asc" } },
      }),
      db.appointment.findMany({
        where: { doctorProfileId, startsAt: { gte: new Date() }, status: { in: ["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] } },
        orderBy: { startsAt: "asc" },
        take: 20,
        select: { id: true, status: true, startsAt: true, mode: true },
      }),
    ]);
    return {
      ok: true as const,
      rules: rules.map((rule) => ({
        id: rule.id,
        dayOfWeek: rule.dayOfWeek,
        start: formatClock(rule.localStartTime.getUTCHours() * 60 + rule.localStartTime.getUTCMinutes()),
        end: formatClock(rule.localEndTime.getUTCHours() * 60 + rule.localEndTime.getUTCMinutes()),
        mode: rule.mode,
        location: rule.location?.name ?? null,
        service: rule.offering?.consultationService.name ?? "Any service",
        validFrom: rule.validFrom ? rule.validFrom.toISOString().slice(0, 10) : null,
        validUntil: rule.validUntil ? rule.validUntil.toISOString().slice(0, 10) : null,
      })),
      timeOff: timeOff.map((row) => ({ id: row.id, when: `${formatBookingWhen(row.startsAt)} – ${formatBookingWhen(row.endsAt)}`, reason: row.reason })),
      offerings: offerings.map((row) => ({ id: row.id, label: `${row.consultationService.name} · ${row.mode === "ONLINE" ? "Online" : "In person"} · ${row.durationMinutes} min`, mode: row.mode, durationMinutes: row.durationMinutes })),
      upcoming: upcoming.map((row) => ({ id: row.id, status: row.status, when: formatBookingWhen(row.startsAt), mode: row.mode })),
    };
  } catch (error) {
    return failed(error);
  }
}
