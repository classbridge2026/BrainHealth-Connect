import { Prisma, type PrismaClient } from "@prisma/client";
import { formatPlatformDay, formatPlatformWhen, formatMinorMoney } from "@/lib/admin/labels";
import { addDays, formatBookingWhen } from "@/lib/appointments/time";
import { classifyFollowUp, platformDay, type FollowUpView } from "@/lib/doctor/present";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { parseUuid } from "@/lib/catalog/rules";
import { authorizedGuardianPatientIds } from "@/lib/clinical/guardian-access";
import { recordDenial } from "@/lib/clinical/records";
import { summaryReadDecision } from "@/lib/clinical/rules";

export type PortalFailure = { ok: false; code: "SCHEMA" | "UNAVAILABLE" | "NOT_FOUND" };

function failed(error: unknown): PortalFailure {
  return { ok: false, code: isSchemaMismatch(error) ? "SCHEMA" : "UNAVAILABLE" };
}

function directoryFee(offerings: Array<{ priceAmountMinor: number; currency: string }>) {
  if (offerings.length === 0) return null;
  const currency = offerings[0].currency;
  if (offerings.some((row) => row.currency !== currency)) return null;
  const lowest = offerings.reduce((best, row) => (row.priceAmountMinor < best ? row.priceAmountMinor : best), offerings[0].priceAmountMinor);
  return formatMinorMoney(lowest, currency);
}

const followUpService = {
  OR: [
    { code: { contains: "FOLLOW", mode: "insensitive" as const } },
    { name: { contains: "follow", mode: "insensitive" as const } },
  ],
};

export function parseConsultationFilter(value: string | undefined): "ONLINE" | "IN_PERSON" | null {
  if (value === "ONLINE" || value === "IN_PERSON") return value;
  return null;
}

export function isReleasedPatientSummary(note: {
  kind: string;
  summaryReleaseStatus: string;
  archivedAt: Date | null;
}): boolean {
  return note.kind === "PATIENT_SUMMARY" && note.summaryReleaseStatus === "RELEASED" && note.archivedAt === null;
}

export function patientNotificationHref(entityType: string | null, entityId: string | null): string | null {
  if (entityType === "Appointment" && entityId && parseUuid(entityId)) return `/patient/appointments/${entityId}`;
  return null;
}

export function genderLabel(value: string): string {
  switch (value) {
    case "FEMALE":
      return "Female";
    case "MALE":
      return "Male";
    case "NON_BINARY":
      return "Non-binary";
    case "PREFER_NOT_TO_SAY":
      return "Prefer not to say";
    default:
      return value;
  }
}

const releasedSummaryWhere = {
  kind: "PATIENT_SUMMARY" as const,
  summaryReleaseStatus: "RELEASED" as const,
  archivedAt: null,
};

export async function loadPatientAccount(db: PrismaClient, userId: string) {
  try {
    const profile = await db.patientProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        gender: true,
        nationality: true,
        residentialAddress: true,
        preferredLanguage: true,
        dateOfBirth: true,
        isDependent: true,
        emergencyContactName: true,
        user: { select: { email: true, phoneE164: true, emailVerifiedAt: true, phoneVerifiedAt: true, profileImageUpdatedAt: true } },
      },
    });
    if (!profile) return { ok: true as const, profile: null };
    return {
      ok: true as const,
      profile: {
        id: profile.id,
        fullName: profile.fullName,
        gender: genderLabel(profile.gender),
        nationality: profile.nationality,
        residentialAddress: profile.residentialAddress,
        preferredLanguage: profile.preferredLanguage,
        dateOfBirth: profile.dateOfBirth ? formatPlatformDay(profile.dateOfBirth) : null,
        isDependent: profile.isDependent,
        emergencyContactName: profile.emergencyContactName,
        email: profile.user.email,
        phone: profile.user.phoneE164,
        emailVerified: profile.user.emailVerifiedAt !== null,
        phoneVerified: profile.user.phoneVerifiedAt !== null,
        imageVersion: profile.user.profileImageUpdatedAt?.toISOString() ?? null,
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function searchVerifiedDoctors(
  db: PrismaClient,
  filters: { q?: string | null; specialty?: string | null; language?: string | null; location?: string | null; visit?: string | null },
) {
  const q = (filters.q ?? "").trim().slice(0, 80);
  const specialty = (filters.specialty ?? "").trim().slice(0, 80);
  const language = (filters.language ?? "").trim().slice(0, 40);
  const location = (filters.location ?? "").trim().slice(0, 80);
  const visit = (filters.visit ?? "").trim().toLowerCase();
  const visitMode: "IN_PERSON" | "ONLINE" | null = visit === "in-person" ? "IN_PERSON" : visit === "video" || visit === "audio" ? "ONLINE" : null;
  const where: Prisma.DoctorProfileWhereInput = {
    AND: [
          { verificationStatus: "APPROVED" },
          { user: { status: "ACTIVE", deletedAt: null } },
          {
            specialties: {
              some: {
                claimStatus: "VERIFIED",
                specialty: {
                  isActive: true,
                  ...(specialty ? { name: { equals: specialty, mode: "insensitive" } } : {}),
                },
              },
            },
          },
          ...(q
            ? [{
                OR: [
                  { displayName: { contains: q, mode: "insensitive" as const } },
                  { specialties: { some: { claimStatus: "VERIFIED" as const, specialty: { isActive: true, name: { contains: q, mode: "insensitive" as const } } } } },
                  { offerings: { some: { isActive: true, consultationService: { isActive: true, name: { contains: q, mode: "insensitive" as const } } } } },
                ],
              }]
            : []),
          ...(language ? [{ languages: { has: language } }] : []),
          ...(location
            ? [{
                availabilityRules: {
                  some: { isActive: true, location: { isActive: true, district: { equals: location, mode: "insensitive" as const } } },
                },
              }]
            : []),
          ...(visitMode
            ? [{ offerings: { some: { isActive: true, mode: visitMode, consultationService: { isActive: true } } } }]
            : []),
    ],
  };
  try {
    const doctors = await db.doctorProfile.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: 24,
      select: {
        id: true,
        displayName: true,
        qualificationTitle: true,
        user: { select: { id: true, profileImageUpdatedAt: true } },
        yearsExperience: true,
        languages: true,
        specialties: {
          where: { claimStatus: "VERIFIED", specialty: { isActive: true } },
          select: { specialty: { select: { name: true } } },
        },
        offerings: {
          where: { isActive: true, consultationService: { isActive: true }, specialty: { isActive: true } },
          select: { mode: true, priceAmountMinor: true, currency: true, consultationService: { select: { name: true } } },
        },
      },
    });
    return {
      ok: true as const,
      doctors: doctors.map((doctor) => ({
        id: doctor.id,
        displayName: doctor.displayName,
        qualificationTitle: doctor.qualificationTitle,
        yearsExperience: doctor.yearsExperience,
        languages: doctor.languages,
        specialties: doctor.specialties.map((row) => row.specialty.name),
        services: [...new Set(doctor.offerings.map((offering) => offering.consultationService.name))],
        modes: [...new Set(doctor.offerings.map((offering) => offering.mode))],
        fee: directoryFee(doctor.offerings),
        userId: doctor.user.id,
        imageVersion: doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listBookingFilters(db: PrismaClient) {
  try {
    const [specialties, speakers, places] = await Promise.all([
      db.specialty.findMany({
        where: {
          isActive: true,
          doctors: { some: { claimStatus: "VERIFIED", doctor: { verificationStatus: "APPROVED", user: { status: "ACTIVE", deletedAt: null } } } },
        },
        select: { name: true },
        orderBy: { name: "asc" },
      }),
      db.doctorProfile.findMany({
        where: { verificationStatus: "APPROVED", user: { status: "ACTIVE", deletedAt: null } },
        select: { languages: true },
      }),
      db.location.findMany({
        where: { isActive: true },
        select: { district: true },
        distinct: ["district"],
        orderBy: { district: "asc" },
      }),
    ]);
    return {
      ok: true as const,
      specialties: specialties.map((row) => row.name),
      languages: [...new Set(speakers.flatMap((row) => row.languages).map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      districts: places.map((row) => row.district).filter(Boolean),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listPatientPayments(db: PrismaClient, userId: string) {
  try {
    const rows = await db.payment.findMany({
      where: { appointment: { patient: { userId } } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
        appointment: {
          select: {
            id: true,
            startsAt: true,
            status: true,
            doctor: { select: { displayName: true } },
            consultationService: { select: { name: true } },
          },
        },
      },
    });
    return {
      ok: true as const,
      payments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amount: formatMinorMoney(row.amountMinor, row.currency),
        amountMinor: row.amountMinor,
        currency: row.currency,
        when: formatPlatformWhen(row.createdAt),
        createdAt: row.createdAt,
        appointmentId: row.appointment.id,
        appointmentWhen: formatBookingWhen(row.appointment.startsAt),
        appointmentStatus: row.appointment.status,
        doctor: row.appointment.doctor.displayName,
        service: row.appointment.consultationService.name,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listAppointmentPayments(db: PrismaClient, input: { appointmentId: string; userId: string }) {
  if (!parseUuid(input.appointmentId)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const rows = await db.payment.findMany({
      where: { appointmentId: input.appointmentId, appointment: { patient: { userId: input.userId } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, amountMinor: true, currency: true, createdAt: true, providerReference: true, providerCode: true },
    });
    return {
      ok: true as const,
      payments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amount: formatMinorMoney(row.amountMinor, row.currency),
        when: formatPlatformWhen(row.createdAt),
        reference: row.providerReference,
        providerCode: row.providerCode,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listReleasedSummaries(db: PrismaClient, userId: string, now = new Date()) {
  try {
    const guardianPatientIds = await authorizedGuardianPatientIds(db, userId, now);
    const rows = await db.clinicalNote.findMany({
      where: {
        ...releasedSummaryWhere,
        encounter: {
          archivedAt: null,
          OR: [
            { patient: { userId } },
            ...(guardianPatientIds.length > 0 ? [{ patientProfileId: { in: guardianPatientIds } }] : []),
          ],
        },
      },
      orderBy: { releasedAt: "desc" },
      take: 50,
      select: {
        id: true,
        releasedAt: true,
        author: { select: { displayName: true } },
        encounter: {
          select: {
            patient: { select: { userId: true, fullName: true } },
            appointment: {
              select: {
                id: true,
                startsAt: true,
                specialty: { select: { name: true } },
                consultationService: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    return {
      ok: true as const,
      summaries: rows.map((row) => ({
        id: row.id,
        releasedWhen: row.releasedAt ? formatPlatformWhen(row.releasedAt) : "Release time not recorded",
        doctor: row.author.displayName,
        appointmentId: row.encounter.appointment.id,
        when: formatBookingWhen(row.encounter.appointment.startsAt),
        specialty: row.encounter.appointment.specialty.name,
        service: row.encounter.appointment.consultationService.name,
        subject: row.encounter.patient.userId === userId ? "You" : row.encounter.patient.fullName,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadReleasedSummary(db: PrismaClient, input: { id: string; userId: string; now?: Date }) {
  if (!parseUuid(input.id)) return { ok: false as const, code: "NOT_FOUND" as const };
  const now = input.now ?? new Date();
  try {
    const marker = await db.clinicalNote.findFirst({
      where: { id: input.id },
      select: {
        id: true,
        kind: true,
        summaryReleaseStatus: true,
        archivedAt: true,
        encounter: {
          select: {
            archivedAt: true,
            patientProfileId: true,
            patient: { select: { userId: true, fullName: true } },
          },
        },
      },
    });
    if (!marker) return { ok: false as const, code: "NOT_FOUND" as const };
    const ownsPatient = marker.encounter.patient.userId === input.userId;
    const guardianAuthorized = ownsPatient
      ? false
      : await authorizedGuardianPatientIds(db, input.userId, now).then((ids) => ids.includes(marker.encounter.patientProfileId));
    const decision = summaryReadDecision({
      actorUserId: input.userId,
      patientUserId: marker.encounter.patient.userId,
      kind: marker.kind,
      summaryReleaseStatus: marker.summaryReleaseStatus,
      archivedAt: marker.archivedAt,
      encounterArchived: marker.encounter.archivedAt !== null,
      guardianAuthorized,
    });
    if (decision === "deny" || decision === "unauthenticated") {
      await recordDenial(db, {
        actorUserId: input.userId,
        patientProfileId: marker.encounter.patientProfileId,
        clinicalNoteId: marker.id,
        entityType: "ClinicalNote",
        entityId: marker.id,
        reason: marker.kind === "PRIVATE_WORKING" ? "private_note" : marker.summaryReleaseStatus === "RELEASED" ? "not_authorized" : "unreleased",
      });
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const note = await db.clinicalNote.findFirst({
      where: {
        id: marker.id,
        ...releasedSummaryWhere,
        encounter: { archivedAt: null, patientProfileId: marker.encounter.patientProfileId },
      },
      select: {
        id: true,
        body: true,
        releasedAt: true,
        author: { select: { displayName: true } },
        encounter: {
          select: {
            patientProfileId: true,
            patient: { select: { fullName: true } },
            appointment: {
              select: {
                id: true,
                startsAt: true,
                specialty: { select: { name: true } },
                consultationService: { select: { name: true } },
              },
            },
          },
        },
        files: {
          where: { purpose: "CLINICAL_ATTACHMENT", patientVisible: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true },
        },
      },
    });
    if (!note) return { ok: false as const, code: "NOT_FOUND" as const };
    await db.$transaction([
      db.recordAccessLog.create({
        data: {
          actorUserId: input.userId,
          patientProfileId: note.encounter.patientProfileId,
          clinicalNoteId: note.id,
          entityType: "ClinicalNote",
          entityId: note.id,
          action: "READ",
          outcome: "ALLOWED",
        },
      }),
      db.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: decision === "guardian" ? "clinical.summary.read_by_guardian" : "clinical.summary.read",
          entityType: "ClinicalNote",
          entityId: note.id,
          metadata: { released: true },
        },
      }),
    ]);
    return {
      ok: true as const,
      summary: {
        id: note.id,
        body: note.body,
        releasedWhen: note.releasedAt ? formatPlatformWhen(note.releasedAt) : "Release time not recorded",
        doctor: note.author.displayName,
        patientName: note.encounter.patient.fullName,
        appointmentId: note.encounter.appointment.id,
        when: formatBookingWhen(note.encounter.appointment.startsAt),
        specialty: note.encounter.appointment.specialty.name,
        service: note.encounter.appointment.consultationService.name,
        files: note.files.map((file) => ({
          id: file.id,
          name: file.originalFilename ?? "Document",
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
        })),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listFollowUpVisits(db: PrismaClient, userId: string, now = new Date()) {
  try {
    const rows = await db.appointment.findMany({
      where: {
        patient: { userId },
        startsAt: { gte: now },
        status: { in: ["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] },
        consultationService: followUpService,
      },
      orderBy: { startsAt: "asc" },
      take: 10,
      select: {
        id: true,
        startsAt: true,
        status: true,
        doctor: { select: { displayName: true } },
        consultationService: { select: { name: true } },
      },
    });
    return {
      ok: true as const,
      visits: rows.map((row) => ({
        id: row.id,
        when: formatBookingWhen(row.startsAt),
        status: row.status,
        doctor: row.doctor.displayName,
        service: row.consultationService.name,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listPatientNotifications(db: PrismaClient, userId: string, unreadOnly = false) {
  try {
    const rows = await db.notification.findMany({
      where: {
        recipientId: userId,
        channel: "IN_APP",
        status: { not: "CANCELLED" },
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, preview: true, status: true, channel: true, readAt: true, createdAt: true, entityType: true, entityId: true },
    });
    return {
      ok: true as const,
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        preview: row.preview,
        status: row.status,
        channel: row.channel,
        read: row.readAt !== null,
        when: formatPlatformWhen(row.createdAt),
        href: patientNotificationHref(row.entityType, row.entityId),
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function markOwnNotificationRead(db: PrismaClient, input: { userId: string; notificationId: string }) {
  if (!parseUuid(input.notificationId)) return { ok: false as const, message: "That notification was not found." };
  try {
    const note = await db.notification.findFirst({
      where: { id: input.notificationId, recipientId: input.userId },
      select: { id: true, status: true, readAt: true },
    });
    if (!note) return { ok: false as const, message: "That notification was not found." };
    if (note.readAt) return { ok: true as const, message: "That notification is already read." };
    await db.notification.update({
      where: { id: note.id },
      data: { readAt: new Date(), status: note.status === "FAILED" ? "FAILED" : "READ" },
    });
    return { ok: true as const, message: "The notification is marked as read." };
  } catch {
    return { ok: false as const, message: "The notification could not be updated." };
  }
}

export async function markAllOwnNotificationsRead(db: PrismaClient, userId: string) {
  try {
    await db.notification.updateMany({
      where: { recipientId: userId, channel: "IN_APP", readAt: null, status: { not: "FAILED" } },
      data: { readAt: new Date(), status: "READ" },
    });
    await db.notification.updateMany({
      where: { recipientId: userId, channel: "IN_APP", readAt: null, status: "FAILED" },
      data: { readAt: new Date() },
    });
    return { ok: true as const, message: "Unread notifications are marked as read." };
  } catch {
    return { ok: false as const, message: "Notifications could not be updated." };
  }
}

export async function clearOwnInAppNotifications(db: PrismaClient, userId: string) {
  try {
    const cleared = await db.notification.updateMany({
      where: { recipientId: userId, channel: "IN_APP", status: { not: "CANCELLED" } },
      data: { readAt: new Date(), status: "CANCELLED" },
    });
    return {
      ok: true as const,
      message: cleared.count === 0 ? "There are no notifications to clear." : "Notifications are cleared.",
    };
  } catch {
    return { ok: false as const, message: "Notifications could not be cleared." };
  }
}

export async function listPatientFollowUps(db: PrismaClient, userId: string, view: FollowUpView, now = new Date()) {
  const dayStart = platformDay(now);
  const dayEnd = addDays(dayStart, 1);
  try {
    const where = {
      patient: { userId },
      OR: [{ followUpOfId: { not: null } }, { consultationService: followUpService }],
    };
    const rows = await db.appointment.findMany({
      where,
      orderBy: { startsAt: view === "completed" || view === "overdue" ? "desc" : "asc" },
      take: 80,
      select: {
        id: true,
        status: true,
        startsAt: true,
        mode: true,
        doctor: { select: { displayName: true, userId: true, user: { select: { profileImageUpdatedAt: true } } } },
        consultationService: { select: { name: true } },
        specialty: { select: { name: true } },
      },
    });
    const visits = rows
      .map((row) => ({
        id: row.id,
        status: row.status,
        bucket: classifyFollowUp({ status: row.status, startsAt: row.startsAt, dayStart, dayEnd }),
        startsAt: row.startsAt,
        when: formatBookingWhen(row.startsAt),
        mode: row.mode,
        doctor: row.doctor.displayName,
        doctorUserId: row.doctor.userId,
        doctorImageVersion: row.doctor.user.profileImageUpdatedAt?.toISOString() ?? null,
        service: row.consultationService.name,
        specialty: row.specialty.name,
      }))
      .filter((row) => row.bucket === view);
    return { ok: true as const, visits };
  } catch (error) {
    return failed(error);
  }
}

export async function releasedSummaryForAppointment(db: PrismaClient, input: { appointmentId: string; userId: string }) {
  if (!parseUuid(input.appointmentId)) return null;
  try {
    return await db.clinicalNote.findFirst({
      where: {
        ...releasedSummaryWhere,
        encounter: { archivedAt: null, appointmentId: input.appointmentId, patient: { userId: input.userId } },
      },
      select: { id: true },
    });
  } catch {
    return null;
  }
}
