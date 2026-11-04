import type { Prisma, PrismaClient } from "@prisma/client";
import { DEVELOPER_ROLE_CODE } from "@/lib/auth/constants";
import { notDeveloper } from "@/lib/auth/visibility";
import { forgetRemembered, rememberFor } from "@/lib/db/remember";
import { formatFee } from "@/lib/catalog/money";
import { HOLD_MINUTES_SETTING_KEY } from "@/lib/appointments/payment-holds";
import { SCREENING_SAFETY_SETTING } from "@/lib/screening/rules";
import { readStoredSystemName, SYSTEM_NAME_SETTING_KEY } from "@/lib/brand/system-name";
import { DEFAULT_CURRENCY_SETTING } from "@/lib/catalog/constants";
import { IDENTITY_DOCUMENT_SETTING } from "@/lib/doctors/constants";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { AFRIMONEY_NUMBER_KEY, readStoredAfrimoneyNumber } from "@/lib/payments/afrimoney-transfer";
import { ORANGE_MONEY_NUMBER_KEY, readStoredOrangeNumber } from "@/lib/payments/orange-transfer";
import { PUBLIC_CONTACT_ADDRESS_KEY, PUBLIC_CONTACT_EMAIL_KEY, PUBLIC_CONTACT_PHONE_KEY } from "@/lib/public/landing";
import { formatMinorMoney } from "./labels";
import {
  ADMIN_PAGE_SIZE,
  CANCELLED_APPOINTMENT_STATUSES,
  FAILED_PAYMENT_STATUSES,
  OCCUPYING_APPOINTMENT_STATUSES,
  UPCOMING_APPOINTMENT_STATUSES,
  freetownDayBounds,
  isUuid,
  parseAppointmentStatus,
  parseConsultationMode,
  parseDirectoryRole,
  parseFreetownDate,
  parsePaymentStatus,
  parseUserStatus,
  reconciliationFlags,
  sanitizeMetadata,
} from "./rules";

function failed(error: unknown) {
  if (isSchemaMismatch(error)) return { ok: false as const, code: "SCHEMA" as const };
  return { ok: false as const, code: "UNAVAILABLE" as const };
}

function pageOf(page: number | undefined) {
  return page && page > 0 ? Math.floor(page) : 1;
}

const userListSelect = {
  id: true,
  email: true,
  phoneE164: true,
  timezone: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  profileImageUpdatedAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
  patientProfile: { select: { id: true, fullName: true } },
  doctorProfile: { select: { id: true, fullName: true, verificationStatus: true } },
} satisfies Prisma.UserSelect;

export async function loadUsers(db: PrismaClient, filters: { q?: string; status?: string; role?: string; page?: number }) {
  const page = pageOf(filters.page);
  const q = (filters.q ?? "").trim().slice(0, 80);
  const and: Prisma.UserWhereInput[] = [{ deletedAt: null }, notDeveloper];
  if (q) {
    and.push({
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { phoneE164: { contains: q, mode: "insensitive" } },
        { patientProfile: { is: { fullName: { contains: q, mode: "insensitive" } } } },
        { doctorProfile: { is: { fullName: { contains: q, mode: "insensitive" } } } },
        ...(isUuid(q) ? [{ id: q }] : []),
      ],
    });
  }
  const status = parseUserStatus(filters.status);
  if (status) and.push({ status });
  const role = parseDirectoryRole(filters.role);
  if (role) and.push({ roles: { some: { role: { code: role } } } });
  const where: Prisma.UserWhereInput = { AND: and };
  try {
    const [total, rows] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: userListSelect,
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: ADMIN_PAGE_SIZE,
      users: rows.map((user) => ({
        id: user.id,
        email: user.email,
        phone: user.phoneE164,
        timezone: user.timezone,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        roleCodes: user.roles.map((entry) => entry.role.code),
        patientName: user.patientProfile?.fullName ?? null,
        patientId: user.patientProfile?.id ?? null,
        doctorName: user.doctorProfile?.fullName ?? null,
        doctorId: user.doctorProfile?.id ?? null,
        imageVersion: user.profileImageUpdatedAt?.toISOString() ?? null,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadUserDetail(db: PrismaClient, id: string, now = new Date()) {
  if (!isUuid(id)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phoneE164: true,
        status: true,
        timezone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
        profileImageUpdatedAt: true,
        roles: { select: { grantedAt: true, role: { select: { code: true, name: true } } } },
        patientProfile: { select: { id: true, fullName: true } },
        doctorProfile: { select: { id: true, fullName: true, verificationStatus: true } },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: now } },
          select: { id: true, createdAt: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
    if (!user || user.deletedAt || user.roles.some((entry) => entry.role.code === DEVELOPER_ROLE_CODE)) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    return {
      ok: true as const,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phoneE164,
        status: user.status,
        timezone: user.timezone,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        imageVersion: user.profileImageUpdatedAt?.toISOString() ?? null,
        roles: user.roles.map((entry) => ({ code: entry.role.code, name: entry.role.name, grantedAt: entry.grantedAt.toISOString() })),
        patient: user.patientProfile,
        doctor: user.doctorProfile,
        openSessions: user.sessions.map((session) => ({
          id: session.id,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
        })),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadPatients(db: PrismaClient, filters: { q?: string; status?: string; page?: number }) {
  const page = pageOf(filters.page);
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.PatientProfileWhereInput = { archivedAt: null };
  const and: Prisma.PatientProfileWhereInput[] = [];
  if (q) {
    and.push({
      OR: [{ fullName: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }],
    });
  }
  const status = parseUserStatus(filters.status);
  if (status) and.push({ user: { status } });
  if (and.length) where.AND = and;
  try {
    const [total, rows] = await Promise.all([
      db.patientProfile.count({ where }),
      db.patientProfile.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: {
          id: true,
          fullName: true,
          isDependent: true,
          createdAt: true,
          gender: true,
          dateOfBirth: true,
          nationality: true,
          residentialAddress: true,
          preferredLanguage: true,
          emergencyContactName: true,
          user: { select: { id: true, email: true, phoneE164: true, status: true, timezone: true, profileImageUpdatedAt: true } },
          _count: { select: { appointments: true } },
        },
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: ADMIN_PAGE_SIZE,
      patients: rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        gender: row.gender,
        dateOfBirth: row.dateOfBirth?.toISOString().slice(0, 10) ?? "",
        nationality: row.nationality,
        residentialAddress: row.residentialAddress,
        preferredLanguage: row.preferredLanguage,
        emergencyContactName: row.emergencyContactName,
        isDependent: row.isDependent,
        createdAt: row.createdAt.toISOString(),
        userId: row.user.id,
        imageVersion: row.user.profileImageUpdatedAt?.toISOString() ?? null,
        email: row.user.email,
        phone: row.user.phoneE164,
        timezone: row.user.timezone,
        status: row.user.status,
        appointments: row._count.appointments,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadPatientDetail(db: PrismaClient, id: string) {
  if (!isUuid(id)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const patient = await db.patientProfile.findUnique({
      where: { id },
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
        createdAt: true,
        archivedAt: true,
        user: { select: { id: true, email: true, phoneE164: true, status: true, profileImageUpdatedAt: true } },
        guardianRelationships: {
          select: {
            id: true,
            relationshipType: true,
            status: true,
            guardian: { select: { email: true, patientProfile: { select: { fullName: true } } } },
          },
        },
        _count: { select: { appointments: true } },
      },
    });
    if (!patient) return { ok: false as const, code: "NOT_FOUND" as const };
    return { ok: true as const, patient };
  } catch (error) {
    return failed(error);
  }
}

export async function loadAppointments(
  db: PrismaClient,
  filters: { q?: string; status?: string; mode?: string; date?: string; when?: string; patientId?: string; page?: number },
  now = new Date(),
) {
  const page = pageOf(filters.page);
  const q = (filters.q ?? "").trim().slice(0, 80);
  const and: Prisma.AppointmentWhereInput[] = [];
  if (q) {
    const or: Prisma.AppointmentWhereInput[] = [
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
      { doctor: { fullName: { contains: q, mode: "insensitive" } } },
      { doctor: { displayName: { contains: q, mode: "insensitive" } } },
      { location: { name: { contains: q, mode: "insensitive" } } },
    ];
    if (isUuid(q)) or.push({ id: q });
    and.push({ OR: or });
  }
  const status = parseAppointmentStatus(filters.status);
  if (status === "CANCELLED") and.push({ status: { in: [...CANCELLED_APPOINTMENT_STATUSES] } });
  else if (status) and.push({ status });
  const mode = parseConsultationMode(filters.mode);
  if (mode) and.push({ mode });
  const day = filters.date ? parseFreetownDate(filters.date) : filters.when === "today" ? freetownDayBounds(now).start : null;
  if (filters.date && !day) return { ok: false as const, code: "UNAVAILABLE" as const };
  if (day) and.push({ startsAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } });
  if (filters.when === "upcoming") and.push({ status: { in: [...UPCOMING_APPOINTMENT_STATUSES] }, startsAt: { gte: now } });
  if (filters.patientId && isUuid(filters.patientId)) and.push({ patientProfileId: filters.patientId });
  const where: Prisma.AppointmentWhereInput = and.length ? { AND: and } : {};
  try {
    const [total, rows] = await Promise.all([
      db.appointment.count({ where }),
      db.appointment.findMany({
        where,
        orderBy: { startsAt: "desc" },
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: {
          id: true,
          status: true,
          mode: true,
          startsAt: true,
          feeAmount: true,
          currency: true,
          patient: { select: { fullName: true } },
          doctor: { select: { displayName: true } },
        },
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: ADMIN_PAGE_SIZE,
      appointments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        mode: row.mode,
        startsAt: row.startsAt.toISOString(),
        fee: formatFee(row.feeAmount, row.currency),
        patient: row.patient.fullName,
        doctor: row.doctor.displayName,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadAppointmentDetail(db: PrismaClient, id: string) {
  if (!isUuid(id)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const appointment = await db.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        mode: true,
        startsAt: true,
        endsAt: true,
        feeAmount: true,
        currency: true,
        paymentHoldExpiresAt: true,
        bookingSource: true,
        patientConcern: true,
        cancelledAt: true,
        cancellationReason: true,
        checkedInAt: true,
        completedAt: true,
        createdAt: true,
        doctorProfileId: true,
        patient: { select: { id: true, fullName: true, user: { select: { id: true, email: true } } } },
        doctor: { select: { id: true, displayName: true, fullName: true, verificationStatus: true } },
        specialty: { select: { name: true } },
        consultationService: { select: { name: true } },
        location: { select: { name: true, locality: true, district: true } },
        events: {
          orderBy: { occurredAt: "asc" },
          select: { id: true, fromStatus: true, toStatus: true, occurredAt: true, detail: true, actor: { select: { email: true } } },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, amountMinor: true, currency: true, providerCode: true, providerReference: true, createdAt: true },
        },
      },
    });
    if (!appointment) return { ok: false as const, code: "NOT_FOUND" as const };
    const overlaps = OCCUPYING_APPOINTMENT_STATUSES.includes(appointment.status as (typeof OCCUPYING_APPOINTMENT_STATUSES)[number])
      ? await db.appointment.findMany({
          where: {
            id: { not: appointment.id },
            doctorProfileId: appointment.doctorProfileId,
            status: { in: [...OCCUPYING_APPOINTMENT_STATUSES] },
            startsAt: { lt: appointment.endsAt },
            endsAt: { gt: appointment.startsAt },
          },
          take: 5,
          select: { id: true, status: true, startsAt: true },
        })
      : [];
    return {
      ok: true as const,
      appointment: {
        id: appointment.id,
        status: appointment.status,
        mode: appointment.mode,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        fee: formatFee(appointment.feeAmount, appointment.currency),
        paymentHoldExpiresAt: appointment.paymentHoldExpiresAt?.toISOString() ?? null,
        bookingSource: appointment.bookingSource,
        patientConcern: appointment.patientConcern,
        cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
        cancellationReason: appointment.cancellationReason,
        checkedInAt: appointment.checkedInAt?.toISOString() ?? null,
        completedAt: appointment.completedAt?.toISOString() ?? null,
        createdAt: appointment.createdAt.toISOString(),
        patient: appointment.patient,
        doctor: appointment.doctor,
        specialty: appointment.specialty.name,
        service: appointment.consultationService.name,
        location: appointment.location ? `${appointment.location.name}, ${appointment.location.locality}, ${appointment.location.district}` : null,
        events: appointment.events.map((event) => ({
          id: event.id,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          occurredAt: event.occurredAt.toISOString(),
          detail: event.detail,
          actor: event.actor?.email ?? "System",
        })),
        payments: appointment.payments.map((payment) => ({
          id: payment.id,
          status: payment.status,
          amount: formatMinorMoney(payment.amountMinor, payment.currency),
          providerCode: payment.providerCode,
          providerReference: payment.providerReference,
          createdAt: payment.createdAt.toISOString(),
        })),
        overlaps: overlaps.map((row) => ({ id: row.id, status: row.status, startsAt: row.startsAt.toISOString() })),
        holdExpired: appointment.status === "PENDING_PAYMENT" && appointment.paymentHoldExpiresAt !== null && appointment.paymentHoldExpiresAt.getTime() <= Date.now(),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadPayments(db: PrismaClient, filters: { q?: string; status?: string; date?: string; page?: number }) {
  const page = pageOf(filters.page);
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.PaymentWhereInput = {};
  const status = parsePaymentStatus(filters.status);
  if (status === "FAILED_OR_REFUNDED") where.status = { in: [...FAILED_PAYMENT_STATUSES] };
  else if (status) where.status = status;
  const day = filters.date ? parseFreetownDate(filters.date) : null;
  if (filters.date && !day) return { ok: false as const, code: "UNAVAILABLE" as const };
  if (day) where.createdAt = { gte: day, lt: new Date(day.getTime() + 86_400_000) };
  if (q) {
    const or: Prisma.PaymentWhereInput[] = [
      { providerReference: { contains: q, mode: "insensitive" } },
      { payer: { email: { contains: q, mode: "insensitive" } } },
      { appointment: { patient: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
    if (isUuid(q)) or.push({ id: q }, { appointmentId: q });
    where.OR = or;
  }
  try {
    const [total, rows] = await Promise.all([
      db.payment.count({ where }),
      db.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          providerCode: true,
          providerReference: true,
          createdAt: true,
          payer: { select: { email: true } },
          appointment: { select: { id: true, patient: { select: { fullName: true } } } },
        },
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: ADMIN_PAGE_SIZE,
      payments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amount: formatMinorMoney(row.amountMinor, row.currency),
        providerCode: row.providerCode,
        providerReference: row.providerReference,
        createdAt: row.createdAt.toISOString(),
        payer: row.payer.email,
        patient: row.appointment.patient.fullName,
        appointmentId: row.appointment.id,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadPaymentDetail(db: PrismaClient, id: string) {
  if (!isUuid(id)) return { ok: false as const, code: "NOT_FOUND" as const };
  try {
    const payment = await db.payment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        providerCode: true,
        providerReference: true,
        providerAccountId: true,
        receiptMime: true,
        createdAt: true,
        updatedAt: true,
        payer: { select: { id: true, email: true } },
        appointment: {
          select: {
            id: true,
            status: true,
            startsAt: true,
            paymentHoldExpiresAt: true,
            patient: { select: { fullName: true } },
            doctor: { select: { displayName: true } },
          },
        },
        events: {
          orderBy: { occurredAt: "asc" },
          select: { id: true, status: true, providerCode: true, occurredAt: true, receivedAt: true },
        },
      },
    });
    if (!payment) return { ok: false as const, code: "NOT_FOUND" as const };
    const latest = payment.events.at(-1)?.status ?? null;
    return {
      ok: true as const,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: formatMinorMoney(payment.amountMinor, payment.currency),
        providerCode: payment.providerCode,
        providerReference: payment.providerReference,
        providerAccountId: payment.providerAccountId,
        receiptMime: payment.receiptMime,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
        payer: payment.payer,
        appointment: {
          id: payment.appointment.id,
          status: payment.appointment.status,
          startsAt: payment.appointment.startsAt.toISOString(),
          paymentHoldExpiresAt: payment.appointment.paymentHoldExpiresAt?.toISOString() ?? null,
          patient: payment.appointment.patient.fullName,
          doctor: payment.appointment.doctor.displayName,
        },
        events: payment.events.map((event) => ({
          id: event.id,
          status: event.status,
          providerCode: event.providerCode,
          occurredAt: event.occurredAt.toISOString(),
          receivedAt: event.receivedAt.toISOString(),
        })),
        flags: reconciliationFlags({
          paymentStatus: payment.status,
          appointmentStatus: payment.appointment.status,
          providerReference: payment.providerReference,
          latestEventStatus: latest,
        }),
      },
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadAuditLogs(db: PrismaClient, filters: { q?: string; from?: string; to?: string; page?: number }) {
  const page = pageOf(filters.page);
  const q = (filters.q ?? "").trim().slice(0, 80);
  const from = filters.from ? parseFreetownDate(filters.from) : null;
  const to = filters.to ? parseFreetownDate(filters.to) : null;
  if ((filters.from && !from) || (filters.to && !to)) return { ok: false as const, code: "UNAVAILABLE" as const };
  const where: Prisma.AuditLogWhereInput = {};
  if (from || to) {
    where.occurredAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { entityType: { contains: q, mode: "insensitive" } },
      { actor: { email: { contains: q, mode: "insensitive" } } },
    ];
    if (isUuid(q)) where.OR.push({ entityId: q });
  }
  try {
    const [total, rows] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          actorType: true,
          occurredAt: true,
          metadata: true,
          actor: { select: { email: true } },
        },
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: ADMIN_PAGE_SIZE,
      audits: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorType: row.actorType,
        occurredAt: row.occurredAt.toISOString(),
        actor: row.actor?.email ?? "System",
        metadata: sanitizeMetadata(row.metadata),
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadNotifications(db: PrismaClient, userId: string, page = 1) {
  const current = pageOf(page);
  const where: Prisma.NotificationWhereInput = {
    recipientId: userId,
    NOT: { channel: "IN_APP", status: "CANCELLED" },
  };
  try {
    const [total, unread, rows] = await Promise.all([
      db.notification.count({ where }),
      db.notification.count({ where: { recipientId: userId, readAt: null } }),
      db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (current - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: { id: true, channel: true, type: true, title: true, preview: true, entityType: true, entityId: true, status: true, readAt: true, createdAt: true },
      }),
    ]);
    return {
      ok: true as const,
      total,
      unread,
      page: current,
      pageSize: ADMIN_PAGE_SIZE,
      notifications: rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        type: row.type,
        title: row.title,
        preview: row.preview ? row.preview.slice(0, 180) : null,
        status: row.status,
        entityType: row.entityType,
        entityId: row.entityId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function loadAdministrators(db: PrismaClient, page = 1) {
  const current = pageOf(page);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    AND: [
      { roles: { some: { role: { code: { in: ["ADMIN", "SUPER_ADMIN"] } } } } },
      notDeveloper,
    ],
  };
  try {
    const [total, rows] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: { email: "asc" },
        skip: (current - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: userListSelect,
      }),
    ]);
    return {
      ok: true as const,
      total,
      page: current,
      pageSize: ADMIN_PAGE_SIZE,
      users: rows.map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        roleCodes: user.roles.map((entry) => entry.role.code),
      })),
    };
  } catch (error) {
    return failed(error);
  }
}

const LOCKED_SETTINGS = ["MINOR_REGISTRATION_ENABLED", "MINOR_TREATMENT_ENABLED", IDENTITY_DOCUMENT_SETTING] as const;

export function forgetPlatformSettings() {
  forgetRemembered("platform-settings");
}

export async function loadPlatformSettings(db: PrismaClient) {
  if (process.env.NODE_ENV === "test") return readPlatformSettings(db);
  return rememberFor("platform-settings", 30_000, () => readPlatformSettings(db), (result) => result.ok);
}

async function readPlatformSettings(db: PrismaClient) {
  try {
    const rows = await db.platformSetting.findMany({ orderBy: { key: "asc" }, select: { key: true, valueJson: true, updatedAt: true } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const currency = byKey.get(DEFAULT_CURRENCY_SETTING);
    const hold = byKey.get(HOLD_MINUTES_SETTING_KEY);
    const currencyValue = typeof currency?.valueJson === "string" ? currency.valueJson : "SLL";
    const holdValue = typeof hold?.valueJson === "number" ? hold.valueJson : null;
    const knownKeys = new Set<string>([DEFAULT_CURRENCY_SETTING, HOLD_MINUTES_SETTING_KEY, SYSTEM_NAME_SETTING_KEY, ORANGE_MONEY_NUMBER_KEY, AFRIMONEY_NUMBER_KEY, PUBLIC_CONTACT_EMAIL_KEY, PUBLIC_CONTACT_PHONE_KEY, PUBLIC_CONTACT_ADDRESS_KEY, SCREENING_SAFETY_SETTING, ...LOCKED_SETTINGS]);
    const storedText = (key: string) => {
      const value = byKey.get(key)?.valueJson;
      return typeof value === "string" ? value : "";
    };
    return {
      ok: true as const,
      currency: currencyValue,
      holdMinutes: holdValue,
      orangeNumber: readStoredOrangeNumber(byKey.get(ORANGE_MONEY_NUMBER_KEY)?.valueJson),
      afrimoneyNumber: readStoredAfrimoneyNumber(byKey.get(AFRIMONEY_NUMBER_KEY)?.valueJson),
      publicEmail: storedText(PUBLIC_CONTACT_EMAIL_KEY),
      publicPhone: storedText(PUBLIC_CONTACT_PHONE_KEY),
      publicAddress: storedText(PUBLIC_CONTACT_ADDRESS_KEY),
      systemName: readStoredSystemName(byKey.get(SYSTEM_NAME_SETTING_KEY)?.valueJson),
      locked: LOCKED_SETTINGS.map((key) => ({
        key,
        value: byKey.get(key)?.valueJson ?? null,
        updatedAt: byKey.get(key)?.updatedAt.toISOString() ?? null,
      })),
      other: rows
        .filter((row) => !knownKeys.has(row.key))
        .map((row) => ({
          key: row.key,
          value: primitiveSetting(row.valueJson),
          updatedAt: row.updatedAt.toISOString(),
        })),
    };
  } catch (error) {
    return failed(error);
  }
}

function primitiveSetting(value: Prisma.JsonValue): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "Stored structured value";
}
