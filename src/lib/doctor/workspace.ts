import { Prisma, type PrismaClient } from "@prisma/client";
import { formatPlatformDay, formatPlatformWhen, paymentStatusLabel } from "@/lib/admin/labels";
import { completeEndedConsultations, shownAppointmentStatus } from "@/lib/appointments/finish";
import { formatBookingWhen } from "@/lib/appointments/time";
import { parseUuid } from "@/lib/catalog/rules";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { genderLabel } from "@/lib/patient/portal";
import { assignedGuardianLabel, isFollowUpConsultation } from "./portal";
import {
  classifyFollowUp,
  dayKey,
  formatPortalTime,
  pageCount,
  patientAgeLine,
  patientReference,
  platformDay,
  startOfWeek,
  type FollowUpView,
  type NoteTab,
  type ScheduleView,
} from "./present";
import { addDays } from "@/lib/appointments/time";

const PAGE_SIZE = 20;
const CLOSED = ["CANCELLED_BY_PATIENT", "CANCELLED_BY_DOCTOR", "CANCELLED_BY_ADMIN", "EXPIRED_UNPAID", "RESCHEDULED", "NO_SHOW"] as const;
const OPEN = ["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;

const followUpService = {
  OR: [{ code: { contains: "FOLLOW", mode: "insensitive" as const } }, { name: { contains: "follow", mode: "insensitive" as const } }],
};

function failed(error: unknown) {
  return { ok: false as const, code: isSchemaMismatch(error) ? ("SCHEMA" as const) : ("UNAVAILABLE" as const) };
}

function followUpWhere(doctorProfileId: string | null): Prisma.AppointmentWhereInput {
  return {
    ...(doctorProfileId ? { doctorProfileId } : {}),
    OR: [{ followUpOfId: { not: null } }, { consultationService: followUpService }],
  };
}

export async function loadDoctorDashboard(db: PrismaClient, doctor: { id: string | null; displayName: string }, now = new Date()) {
  try {
    const dayStart = platformDay(now);
    const dayEnd = addDays(dayStart, 1);
    const weekStart = startOfWeek(dayStart);
    const weekEnd = addDays(weekStart, 7);
    const visitSelect = {
      id: true,
      status: true,
      mode: true,
      startsAt: true,
      endsAt: true,
      patientProfileId: true,
      patient: { select: { id: true, fullName: true, user: { select: { id: true, profileImageUpdatedAt: true } } } },
      consultationService: { select: { name: true, code: true } },
    } as const;
    const openList = OPEN.join(",");
    const closedList = CLOSED.join(",");
    const scope = doctor.id ? { doctorProfileId: doctor.id } : {};
    const onVisit = doctor.id ? Prisma.sql`AND "doctorProfileId"::text = ${doctor.id}` : Prisma.empty;
    const onVisitA = doctor.id ? Prisma.sql`AND a."doctorProfileId"::text = ${doctor.id}` : Prisma.empty;
    const onNote = doctor.id ? Prisma.sql`AND "authorDoctorProfileId"::text = ${doctor.id}` : Prisma.empty;
    const [, today, openVisits, snapshotRows] = await Promise.all([
      completeEndedConsultations(db, { now, ...(doctor.id ? { doctorProfileId: doctor.id } : {}) }),
      db.appointment.findMany({
        where: { ...scope, startsAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startsAt: "desc" },
        take: 20,
        select: visitSelect,
      }),
      db.appointment.findMany({
        where: { ...scope, status: "IN_PROGRESS", endsAt: { gt: now } },
        select: { id: true, encounter: { select: { notes: { where: { kind: "PRIVATE_WORKING", archivedAt: null }, select: { id: true }, take: 1 } } } },
        take: 50,
      }),
      db.$queryRaw<Array<{ upcoming: number; followUps: number; followUpsThisWeek: number; inProgress: number; unreleased: number; activePatients: number; newPatients: number }>>`
        SELECT
          (SELECT count(*)::int FROM "Appointment"
            WHERE "startsAt" >= ${dayEnd}
              AND status::text = ANY(string_to_array(${openList}, ','))
              ${onVisit}
          ) AS upcoming,
          (SELECT count(*)::int FROM "Appointment" a
            LEFT JOIN "ConsultationService" s ON s.id = a."consultationServiceId"
            WHERE a."startsAt" >= ${now}
              AND a.status::text = ANY(string_to_array(${openList}, ','))
              AND (a."followUpOfId" IS NOT NULL OR s.code ILIKE '%FOLLOW%' OR s.name ILIKE '%follow%')
              ${onVisitA}
          ) AS "followUps",
          (SELECT count(*)::int FROM "Appointment" a
            LEFT JOIN "ConsultationService" s ON s.id = a."consultationServiceId"
            WHERE a."startsAt" >= ${now}
              AND a."startsAt" < ${weekEnd}
              AND a.status::text = ANY(string_to_array(${openList}, ','))
              AND (a."followUpOfId" IS NOT NULL OR s.code ILIKE '%FOLLOW%' OR s.name ILIKE '%follow%')
              ${onVisitA}
          ) AS "followUpsThisWeek",
          (SELECT count(*)::int FROM "Appointment"
            WHERE status::text = 'IN_PROGRESS'
              AND "endsAt" > ${now}
              ${onVisit}
          ) AS "inProgress",
          (SELECT count(*)::int FROM "ClinicalNote"
            WHERE "archivedAt" IS NULL
              AND kind::text = 'PATIENT_SUMMARY'
              AND "summaryReleaseStatus"::text = 'NOT_RELEASED'
              ${onNote}
          ) AS unreleased,
          (SELECT count(*)::int FROM (
            SELECT "patientProfileId"
            FROM "Appointment"
            WHERE NOT (status::text = ANY(string_to_array(${closedList}, ',')))
              ${onVisit}
            GROUP BY "patientProfileId"
          ) patients) AS "activePatients",
          (SELECT count(*)::int FROM (
            SELECT "patientProfileId"
            FROM "Appointment"
            WHERE NOT (status::text = ANY(string_to_array(${closedList}, ',')))
              ${onVisit}
            GROUP BY "patientProfileId"
            HAVING min("createdAt") >= ${weekStart} AND min("createdAt") < ${weekEnd}
          ) recent_patients) AS "newPatients"
      `,
    ]);
    const snapshot = snapshotRows[0];
    const upcomingCount = Number(snapshot?.upcoming) || 0;
    const followUpCount = Number(snapshot?.followUps) || 0;
    const followUpsThisWeek = Number(snapshot?.followUpsThisWeek) || 0;
    const inProgress = Number(snapshot?.inProgress) || 0;
    const unreleased = Number(snapshot?.unreleased) || 0;
    const activePatients = Number(snapshot?.activePatients) || 0;
    const newThisWeek = Number(snapshot?.newPatients) || 0;
    const missingNotes = openVisits.filter((visit) => !visit.encounter || visit.encounter.notes.length === 0).length;
    const pendingToday = today.filter((row) => {
      const status = shownAppointmentStatus(row.status, row.endsAt, now);
      return status !== "COMPLETED" && !status.startsWith("CANCELLED") && status !== "NO_SHOW" && status !== "EXPIRED_UNPAID" && status !== "RESCHEDULED";
    }).length;
    const completedToday = today.filter((row) => shownAppointmentStatus(row.status, row.endsAt, now) === "COMPLETED").length;
    return {
      ok: true as const,
      empty: false as const,
      displayName: doctor.displayName,
      dateLabel: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Africa/Freetown" }).format(now),
      counts: {
        today: today.length,
        pendingToday,
        completedToday,
        upcoming: upcomingCount,
        followUps: followUpCount,
        followUpsThisWeek,
        activePatients,
        newPatients: newThisWeek,
        pendingNotes: unreleased + missingNotes,
        inProgress,
      },
      today: today.map((row) => ({
        id: row.id,
        time: new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Africa/Freetown" }).format(row.startsAt),
        status: shownAppointmentStatus(row.status, row.endsAt, now),
        passed: row.endsAt.getTime() <= now.getTime(),
        mode: row.mode,
        patientId: row.patient.id,
        patientUserId: row.patient.user.id,
        patientImageVersion: row.patient.user.profileImageUpdatedAt?.toISOString() ?? null,
        patient: row.patient.fullName,
        service: row.consultationService.name,
        followUp: isFollowUpConsultation(row.consultationService) || false,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

const scheduleSelect = {
  id: true,
  status: true,
  mode: true,
  startsAt: true,
  endsAt: true,
  consultationServiceId: true,
  patientConcern: true,
  intakeHistory: true,
  feeAmountMinor: true,
  payments: { orderBy: { createdAt: "desc" as const }, take: 1, select: { status: true } },
  patient: { select: { id: true, fullName: true, user: { select: { id: true, profileImageUpdatedAt: true } } } },
  doctor: { select: { displayName: true } },
  consultationService: { select: { id: true, name: true, code: true } },
} as const;

export async function loadDoctorScheduleView(
  db: PrismaClient,
  input: {
    userId: string;
    view: ScheduleView;
    start: Date;
    end: Date;
    status: string | null;
    mode: "ONLINE" | "IN_PERSON" | null;
    serviceId: string | null;
    now?: Date;
    clinicWide?: boolean;
  },
) {
  const now = input.now ?? new Date();
  try {
    const doctor = input.clinicWide
      ? null
      : await db.doctorProfile.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!input.clinicWide && !doctor) return { ok: true as const, rows: [], services: [] as Array<{ id: string; name: string }> };
    const where: Prisma.AppointmentWhereInput = {
      ...(doctor ? { doctorProfileId: doctor.id } : {}),
      startsAt: { gte: input.start, lt: input.end },
    };
    if (input.status) where.status = input.status as Prisma.EnumAppointmentStatusFilter["equals"];
    if (input.mode) where.mode = input.mode;
    if (input.serviceId && parseUuid(input.serviceId)) where.consultationServiceId = input.serviceId;
    const [, rows, services] = await Promise.all([
      completeEndedConsultations(db, { now, doctorProfileId: doctor?.id }),
      db.appointment.findMany({ where, orderBy: { startsAt: "asc" }, take: 200, select: scheduleSelect }),
      db.consultationService.findMany({
        where: doctor ? { appointments: { some: { doctorProfileId: doctor.id } } } : { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 40,
      }),
    ]);
    const dayStart = platformDay(now);
    const dayEnd = addDays(dayStart, 1);
    const presented = rows.map((row) => ({
      id: row.id,
      status: shownAppointmentStatus(row.status, row.endsAt, now),
      mode: row.mode,
      day: dayKey(row.startsAt),
      time: formatPortalTime(row.startsAt),
      when: formatBookingWhen(row.startsAt),
      patientId: row.patient.id,
      patientUserId: row.patient.user.id,
      patientImageVersion: row.patient.user.profileImageUpdatedAt?.toISOString() ?? null,
      patient: row.patient.fullName,
      doctorName: row.doctor.displayName,
      service: row.consultationService.name,
      serviceId: row.consultationService.id,
      followUp: isFollowUpConsultation(row.consultationService),
      reason: row.patientConcern,
      intake: row.intakeHistory,
      paymentLabel: row.payments[0] ? paymentStatusLabel(row.payments[0].status) : row.feeAmountMinor === 0 ? "No fee" : "Not recorded",
      onSelectedDay: row.startsAt >= dayStart && row.startsAt < dayEnd,
    }));
    return { ok: true as const, rows: presented, services };
  } catch (error) {
    return failed(error);
  }
}

export async function searchAssignedPatients(
  db: PrismaClient,
  input: { userId: string; q: string; page: number; activeOnly: boolean; now?: Date; clinicWide?: boolean },
) {
  const now = input.now ?? new Date();
  const q = input.q.trim().slice(0, 80);
  try {
    const doctor = input.clinicWide ? null : await db.doctorProfile.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!input.clinicWide && !doctor) return { ok: true as const, patients: [], total: 0, page: 1, pages: 1 };
    const visitScope = doctor ? { doctorProfileId: doctor.id } : {};
    const where: Prisma.PatientProfileWhereInput = {
      appointments: { some: { ...visitScope, ...(input.activeOnly ? { status: { notIn: [...CLOSED] } } : {}) } },
    };
    if (q) {
      where.OR = parseUuid(q) ? [{ id: q }, { fullName: { contains: q, mode: "insensitive" } }] : [{ fullName: { contains: q, mode: "insensitive" } }];
    }
    const total = await db.patientProfile.count({ where });
    const pages = pageCount(total, PAGE_SIZE);
    const page = Math.min(Math.max(input.page, 1), pages);
    const rows = await db.patientProfile.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        fullName: true,
        gender: true,
        dateOfBirth: true,
        user: { select: { id: true, profileImageUpdatedAt: true } },
        appointments: {
          where: visitScope,
          orderBy: { startsAt: "desc" },
          take: 20,
          select: { startsAt: true, status: true, consultationService: { select: { name: true } } },
        },
      },
    });
    return {
      ok: true as const,
      total,
      page,
      pages,
      patients: rows.map((row) => {
        const next = [...row.appointments].reverse().find((visit) => visit.startsAt >= now && OPEN.includes(visit.status as (typeof OPEN)[number]));
        const last = row.appointments.find((visit) => visit.startsAt < now);
        const active = row.appointments.some((visit) => !CLOSED.includes(visit.status as (typeof CLOSED)[number]));
        return {
          id: row.id,
          reference: patientReference(row.id),
          fullName: row.fullName,
          userId: row.user.id,
          imageVersion: row.user.profileImageUpdatedAt?.toISOString() ?? null,
          line: patientAgeLine(genderLabel(row.gender), row.dateOfBirth, now),
          lastVisit: last ? formatPlatformDay(last.startsAt) : null,
          nextVisit: next ? formatPlatformDay(next.startsAt) : null,
          status: active ? "Active" : "Inactive",
        };
      }),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadDoctorChart(db: PrismaClient, input: { patientId: string; actorUserId: string; now?: Date; clinicWide?: boolean }) {
  if (!parseUuid(input.patientId)) return { ok: false as const, code: "NOT_FOUND" as const };
  const now = input.now ?? new Date();
  try {
    const doctor = input.clinicWide ? null : await db.doctorProfile.findUnique({ where: { userId: input.actorUserId }, select: { id: true } });
    if (!input.clinicWide && !doctor) return { ok: false as const, code: "NOT_FOUND" as const };
    const visitScope = doctor ? { doctorProfileId: doctor.id } : {};
    const patient = await db.patientProfile.findFirst({
      where: { id: input.patientId, appointments: { some: visitScope } },
      select: {
        id: true,
        fullName: true,
        gender: true,
        dateOfBirth: true,
        preferredLanguage: true,
        nationality: true,
        residentialAddress: true,
        isDependent: true,
        emergencyContactName: true,
        user: { select: { id: true, email: true, phoneE164: true, profileImageUpdatedAt: true } },
        guardianRelationships: { select: { status: true, revokedAt: true, relationshipType: true } },
        appointments: {
          where: visitScope,
          orderBy: { startsAt: "desc" },
          take: 30,
          select: {
            id: true,
            status: true,
            mode: true,
            startsAt: true,
            followUpOfId: true,
            consultationService: { select: { name: true, code: true } },
          },
        },
      },
    });
    if (!patient) return { ok: false as const, code: "NOT_FOUND" as const };
    const authorScope = doctor ? { authorDoctorProfileId: doctor.id } : {};
    const encounterScope = doctor ? { doctorProfileId: doctor.id } : {};
    const [encounters, summaries, files, privateNotes] = await Promise.all([
      db.encounter.findMany({
        where: { ...encounterScope, patientProfileId: patient.id, archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          status: true,
          appointmentId: true,
          appointment: { select: { consultationService: { select: { name: true } } } },
        },
      }),
      db.clinicalNote.findMany({
        where: {
          ...authorScope,
          kind: "PATIENT_SUMMARY",
          summaryReleaseStatus: "RELEASED",
          archivedAt: null,
          encounter: { patientProfileId: patient.id },
        },
        orderBy: { releasedAt: "desc" },
        take: 20,
        select: { id: true, body: true, releasedAt: true, encounter: { select: { appointmentId: true } } },
      }),
      db.medicalFile.findMany({
        where: { patientProfileId: patient.id, purpose: "CLINICAL_ATTACHMENT", ...(doctor ? { encounter: { doctorProfileId: doctor.id } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 20,
          select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, createdAt: true, deletedAt: true },
      }),
      db.clinicalNote.count({
        where: { ...authorScope, kind: "PRIVATE_WORKING", archivedAt: null, encounter: { patientProfileId: patient.id } },
      }),
    ]);
    await db.$transaction([
      db.recordAccessLog.create({
        data: {
          actorUserId: input.actorUserId,
          patientProfileId: patient.id,
          entityType: "PatientProfile",
          entityId: patient.id,
          action: "READ",
        },
      }),
      db.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "doctor.patient.viewed",
          entityType: "PatientProfile",
          entityId: patient.id,
          metadata: { appointments: patient.appointments.length, summaries: summaries.length },
        },
      }),
    ]);
    const next = [...patient.appointments].reverse().find((visit) => visit.startsAt >= now && OPEN.includes(visit.status as (typeof OPEN)[number]));
    const last = patient.appointments.find((visit) => visit.startsAt < now);
    return {
      ok: true as const,
      patient: {
        id: patient.id,
        reference: patientReference(patient.id),
        userId: patient.user.id,
        imageVersion: patient.user.profileImageUpdatedAt?.toISOString() ?? null,
        fullName: patient.fullName,
        line: patientAgeLine(genderLabel(patient.gender), patient.dateOfBirth, now),
        gender: genderLabel(patient.gender),
        dateOfBirth: patient.dateOfBirth ? formatPlatformDay(patient.dateOfBirth) : null,
        preferredLanguage: patient.preferredLanguage,
        nationality: patient.nationality,
        address: patient.residentialAddress,
        email: patient.user.email,
        phone: patient.user.phoneE164,
        emergencyContactName: patient.emergencyContactName,
        isDependent: patient.isDependent,
        guardian: assignedGuardianLabel(patient.guardianRelationships),
        lastVisit: last ? formatBookingWhen(last.startsAt) : null,
        nextVisit: next ? formatBookingWhen(next.startsAt) : null,
        privateNotes,
        visits: patient.appointments.map((visit) => ({
          id: visit.id,
          status: visit.status,
          when: formatBookingWhen(visit.startsAt),
          service: visit.consultationService.name,
          mode: visit.mode,
          followUp: Boolean(visit.followUpOfId) || isFollowUpConsultation(visit.consultationService),
          record: visit.status === "IN_PROGRESS" || visit.status === "COMPLETED",
        })),
        encounters: encounters.map((row) => ({
          id: row.id,
          appointmentId: row.appointmentId,
          service: row.appointment.consultationService.name,
          started: row.startedAt ? formatPlatformWhen(row.startedAt) : "Not recorded",
          ended: row.endedAt ? formatPlatformWhen(row.endedAt) : "Open",
          status: row.status,
        })),
        summaries: summaries.map((row) => ({
          id: row.id,
          appointmentId: row.encounter.appointmentId,
          when: row.releasedAt ? formatPlatformWhen(row.releasedAt) : "Released",
          body: row.body,
        })),
        files: files.map((file) => ({
          id: file.id,
          name: file.originalFilename ?? "Document",
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          when: formatPlatformWhen(file.createdAt),
          removed: file.deletedAt !== null,
        })),
        followUps: patient.appointments
          .filter((visit) => visit.followUpOfId || isFollowUpConsultation(visit.consultationService))
          .map((visit) => ({
            id: visit.id,
            status: visit.status,
            when: formatBookingWhen(visit.startsAt),
            service: visit.consultationService.name,
          })),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listDoctorNotes(db: PrismaClient, input: { userId: string; tab: NoteTab; q: string; page: number; clinicWide?: boolean }) {
  const q = input.q.trim().slice(0, 80);
  try {
    const doctor = input.clinicWide ? null : await db.doctorProfile.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!input.clinicWide && !doctor) return { ok: true as const, notes: [], total: 0, page: 1, pages: 1, visits: [] as Array<{ id: string; label: string }> };
    const where: Prisma.ClinicalNoteWhereInput = {
      ...(doctor ? { authorDoctorProfileId: doctor.id } : {}),
      archivedAt: null,
      ...(input.tab === "private"
        ? { kind: "PRIVATE_WORKING" }
        : input.tab === "released"
          ? { kind: "PATIENT_SUMMARY", summaryReleaseStatus: "RELEASED" }
          : { kind: "PATIENT_SUMMARY", summaryReleaseStatus: "NOT_RELEASED" }),
    };
    if (q) {
      where.encounter = { patient: parseUuid(q) ? { id: q } : { fullName: { contains: q, mode: "insensitive" } } };
    }
    const total = await db.clinicalNote.count({ where });
    const pages = pageCount(total, PAGE_SIZE);
    const page = Math.min(Math.max(input.page, 1), pages);
    const [notes, visits] = await Promise.all([
      db.clinicalNote.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          kind: true,
          state: true,
          summaryReleaseStatus: true,
          updatedAt: true,
          encounter: {
            select: {
              appointmentId: true,
              patient: { select: { id: true, fullName: true } },
              appointment: { select: { consultationService: { select: { name: true } } } },
            },
          },
        },
      }),
      db.appointment.findMany({
        where: { ...(doctor ? { doctorProfileId: doctor.id } : {}), status: { in: ["IN_PROGRESS", "COMPLETED"] }, encounter: { isNot: null } },
        orderBy: { startsAt: "desc" },
        take: 30,
        select: { id: true, startsAt: true, patient: { select: { fullName: true } }, consultationService: { select: { name: true } } },
      }),
    ]);
    await db.auditLog.create({
      data: {
        actorUserId: input.userId,
        action: "doctor.notes.listed",
        entityType: doctor ? "DoctorProfile" : "User",
        entityId: doctor?.id ?? input.userId,
        metadata: { tab: input.tab, count: notes.length },
      },
    });
    return {
      ok: true as const,
      total,
      page,
      pages,
      notes: notes.map((note) => ({
        id: note.id,
        appointmentId: note.encounter.appointmentId,
        patientId: note.encounter.patient.id,
        patient: note.encounter.patient.fullName,
        service: note.encounter.appointment.consultationService.name,
        kind: note.kind === "PATIENT_SUMMARY" ? "Patient summary" : "Working note",
        state: note.state,
        release: note.summaryReleaseStatus,
        when: formatPlatformDay(note.updatedAt),
      })),
      visits: visits.map((visit) => ({ id: visit.id, label: `${visit.patient.fullName} · ${visit.consultationService.name} · ${formatBookingWhen(visit.startsAt)}` })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listDoctorFollowUps(db: PrismaClient, input: { userId: string; view: FollowUpView; now?: Date; clinicWide?: boolean }) {
  const now = input.now ?? new Date();
  const dayStart = platformDay(now);
  const dayEnd = addDays(dayStart, 1);
  try {
    const doctor = input.clinicWide ? null : await db.doctorProfile.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!input.clinicWide && !doctor) return { ok: true as const, rows: [] };
    const where: Prisma.AppointmentWhereInput = followUpWhere(doctor?.id ?? null);
    if (input.view === "completed") where.status = "COMPLETED";
    else if (input.view === "cancelled") where.status = { in: ["CANCELLED_BY_PATIENT", "CANCELLED_BY_DOCTOR", "CANCELLED_BY_ADMIN", "NO_SHOW"] };
    else if (input.view === "today") {
      where.startsAt = { gte: dayStart, lt: dayEnd };
      where.status = { in: [...OPEN] };
    } else if (input.view === "overdue") {
      where.startsAt = { lt: dayStart };
      where.status = { in: [...OPEN] };
    } else {
      where.startsAt = { gte: dayEnd };
      where.status = { in: [...OPEN] };
    }
    const rows = await db.appointment.findMany({
      where,
      orderBy: { startsAt: input.view === "completed" || input.view === "overdue" ? "desc" : "asc" },
      take: 50,
      select: {
        id: true,
        status: true,
        startsAt: true,
        followUpOfId: true,
        patient: { select: { id: true, fullName: true, user: { select: { id: true, profileImageUpdatedAt: true } } } },
        consultationService: { select: { name: true, code: true } },
        followUpOf: { select: { id: true, startsAt: true, consultationService: { select: { name: true } } } },
      },
    });
    return {
      ok: true as const,
      rows: rows.map((row) => ({
        id: row.id,
        status: row.status,
        bucket: classifyFollowUp({ status: row.status, startsAt: row.startsAt, dayStart, dayEnd }),
        when: formatBookingWhen(row.startsAt),
        patientId: row.patient.id,
        patientUserId: row.patient.user.id,
        patientImageVersion: row.patient.user.profileImageUpdatedAt?.toISOString() ?? null,
        patient: row.patient.fullName,
        service: row.consultationService.name,
        lastVisit: row.followUpOf ? formatPlatformDay(row.followUpOf.startsAt) : null,
        sourceId: row.followUpOf?.id ?? null,
        sourceService: row.followUpOf?.consultationService.name ?? null,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadFollowUpFormData(
  db: PrismaClient,
  userId: string,
  options?: { clinicWide?: boolean; doctorProfileId?: string },
) {
  try {
    const doctor = options?.doctorProfileId
      ? { id: options.doctorProfileId }
      : options?.clinicWide
        ? null
        : await db.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!options?.clinicWide && !doctor) return { ok: true as const, offerings: [], sources: [], locations: [] };
    const [offerings, sources, locations] = await Promise.all([
      db.doctorOffering.findMany({
        where: doctor ? { doctorProfileId: doctor.id, isActive: true } : { isActive: true },
        select: {
          id: true,
          mode: true,
          durationMinutes: true,
          doctorProfileId: true,
          doctor: { select: { displayName: true } },
          consultationService: { select: { name: true } },
        },
        orderBy: { consultationService: { name: "asc" } },
        take: 40,
      }),
      db.appointment.findMany({
        where: {
          ...(doctor ? { doctorProfileId: doctor.id } : {}),
          status: { in: ["COMPLETED", "IN_PROGRESS", "CONFIRMED", "CHECKED_IN"] },
        },
        orderBy: { startsAt: "desc" },
        take: 40,
        select: { id: true, doctorProfileId: true, startsAt: true, patient: { select: { fullName: true } }, consultationService: { select: { name: true } } },
      }),
      db.location.findMany({ where: { isActive: true }, select: { id: true, name: true, locality: true }, orderBy: { name: "asc" }, take: 40 }),
    ]);
    return {
      ok: true as const,
      offerings: offerings.map((row) => ({
        id: row.id,
        doctorProfileId: row.doctorProfileId,
        mode: row.mode,
        label: `${options?.clinicWide ? `${row.doctor.displayName} · ` : ""}${row.consultationService.name} · ${row.mode === "ONLINE" ? "Online" : "In person"} · ${row.durationMinutes} min`,
      })),
      sources: sources.map((row) => ({
        id: row.id,
        doctorProfileId: row.doctorProfileId,
        label: `${row.patient.fullName} · ${row.consultationService.name} · ${formatBookingWhen(row.startsAt)}`,
      })),
      locations: locations.map((row) => ({ id: row.id, label: `${row.name}, ${row.locality}` })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listDoctorNotifications(db: PrismaClient, userId: string, unreadOnly = false) {
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
      select: { id: true, title: true, preview: true, status: true, readAt: true, createdAt: true, entityType: true, entityId: true, channel: true },
    });
    return {
      ok: true as const,
      unread: rows.filter((row) => row.channel === "IN_APP" && row.readAt === null).length,
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        preview: row.preview,
        status: row.status,
        channel: row.channel,
        read: row.readAt !== null,
        when: formatPlatformWhen(row.createdAt),
        href:
          row.entityType === "Appointment" && row.entityId && parseUuid(row.entityId)
            ? `/doctor/appointments/${row.entityId}`
            : row.entityType === "DoctorOffering"
              ? "/doctor/profile"
              : null,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export { PAGE_SIZE };
