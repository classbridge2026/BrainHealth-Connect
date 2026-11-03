import type { PrismaClient } from "@prisma/client";
import type { AdminIconName } from "@/components/admin/admin-icons";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { adminEntityHref, formatPlatformDay } from "./labels";
import { PLATFORM_TIMEZONE, freetownDayBounds } from "./rules";

const CONFIRMED = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"]);
const CANCELLED = new Set(["CANCELLED_BY_PATIENT", "CANCELLED_BY_DOCTOR", "CANCELLED_BY_ADMIN"]);

const STATUS_SLICES = [
  { key: "confirmed", label: "Confirmed", color: "#0f766e", match: (status: string) => CONFIRMED.has(status) },
  { key: "pending", label: "Pending", color: "#d97706", match: (status: string) => status === "PENDING_PAYMENT" || status === "PENDING_APPROVAL" },
  { key: "completed", label: "Completed", color: "#2563eb", match: (status: string) => status === "COMPLETED" },
  { key: "cancelled", label: "Cancelled", color: "#e11d48", match: (status: string) => CANCELLED.has(status) },
  { key: "expired", label: "Expired unpaid", color: "#64748b", match: (status: string) => status === "EXPIRED_UNPAID" },
  { key: "no-show", label: "No show", color: "#7c3aed", match: (status: string) => status === "NO_SHOW" },
  { key: "rescheduled", label: "Rescheduled", color: "#0e7490", match: (status: string) => status === "RESCHEDULED" },
] as const;

const ACTIVITY_TITLES: Record<string, string> = {
  "appointment.booked": "Appointment booked",
  "appointment.follow_up_scheduled": "Follow-up scheduled",
  "appointment.status_updated": "Appointment updated",
  "appointment.rescheduled": "Appointment rescheduled",
  "admin.seeded": "Administrator account created",
  "admin.seed_updated": "Administrator account updated",
  "notification.retry": "Notification retried",
  "consent.granted": "Consent granted",
  "consent.withdrawn": "Consent withdrawn",
  "clinical.record.read": "Clinical record opened",
};

function failed(error: unknown) {
  if (isSchemaMismatch(error)) return { ok: false as const, code: "SCHEMA" as const };
  return { ok: false as const, code: "UNAVAILABLE" as const };
}

function dayKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PLATFORM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function weekStart(now: Date): Date {
  const today = freetownDayBounds(now).start;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: PLATFORM_TIMEZONE, weekday: "short" }).format(now);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  return new Date(today.getTime() - (index < 0 ? 0 : index) * 86_400_000);
}

function relativeWhen(value: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - value.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatPlatformDay(value);
}

function activityTitle(action: string): string {
  return (
    ACTIVITY_TITLES[action] ??
    action
      .replace(/[._]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

type CountRow = { status: string; count: number };
type DayRow = { day: string; count: number };
type SpecialtyRow = { id: string; name: string; count: number };
type PairRow = { active: number; inactive: number };
type PatientRow = { total: number; week: number };

type DashboardSnapshot = {
  doctors: CountRow[] | string | null;
  patients: PatientRow | string | null;
  services: PairRow | string | null;
  locations: PairRow | string | null;
  today: CountRow[] | string | null;
  statuses: CountRow[] | string | null;
  trend: DayRow[] | string | null;
  specialties: SpecialtyRow[] | string | null;
};

function asJson<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value;
}

function countRows(value: DashboardSnapshot["doctors"]): CountRow[] {
  const rows = asJson<CountRow[]>(value, []);
  return Array.isArray(rows) ? rows.map((row) => ({ status: String(row.status), count: Number(row.count) || 0 })) : [];
}

function activityIcon(action: string, entityType: string): AdminIconName {
  const key = `${action} ${entityType}`.toLowerCase();
  if (key.includes("verif") || key.includes("approved")) return "check";
  if (entityType === "DoctorProfile") return "doctor";
  if (entityType === "PatientProfile" || entityType === "User") return "users";
  if (entityType === "Appointment") return "calendar";
  if (entityType === "ConsultationService" || entityType === "DoctorOffering") return "settings";
  if (entityType === "Location") return "location";
  if (entityType === "Payment") return "payment";
  if (entityType === "Notification") return "bell";
  return "audit";
}

export async function loadHomeDashboard(db: PrismaClient, actorId: string, now = new Date()) {
  const day = freetownDayBounds(now);
  const trendStart = new Date(day.start.getTime() - 6 * 86_400_000);
  const week = weekStart(now);
  try {
    const [account, snapshotRows, approvals, activities] = await Promise.all([
      db.user.findUnique({
        where: { id: actorId },
        select: {
          email: true,
          patientProfile: { select: { fullName: true } },
          doctorProfile: { select: { fullName: true } },
        },
      }),
      db.$queryRaw<DashboardSnapshot[]>`
        SELECT
          coalesce((
            SELECT json_agg(json_build_object('status', status, 'count', count))
            FROM (
              SELECT d."verificationStatus"::text AS status, count(*)::int AS count
              FROM "DoctorProfile" d
              INNER JOIN "User" u ON u.id = d."userId"
              WHERE u."deletedAt" IS NULL
              GROUP BY 1
            ) doctors
          ), '[]'::json) AS doctors,
          (
            SELECT json_build_object(
              'total', count(*)::int,
              'week', count(*) FILTER (WHERE "createdAt" >= ${week})::int
            )
            FROM "PatientProfile"
            WHERE "archivedAt" IS NULL
          ) AS patients,
          (
            SELECT json_build_object(
              'active', count(*) FILTER (WHERE "isActive")::int,
              'inactive', count(*) FILTER (WHERE NOT "isActive")::int
            )
            FROM "ConsultationService"
          ) AS services,
          (
            SELECT json_build_object(
              'active', count(*) FILTER (WHERE "isActive")::int,
              'inactive', count(*) FILTER (WHERE NOT "isActive")::int
            )
            FROM "Location"
          ) AS locations,
          coalesce((
            SELECT json_agg(json_build_object('status', status, 'count', count))
            FROM (
              SELECT status::text AS status, count(*)::int AS count
              FROM "Appointment"
              WHERE "startsAt" >= ${day.start} AND "startsAt" < ${day.end}
              GROUP BY 1
            ) today
          ), '[]'::json) AS today,
          coalesce((
            SELECT json_agg(json_build_object('status', status, 'count', count))
            FROM (
              SELECT status::text AS status, count(*)::int AS count
              FROM "Appointment"
              GROUP BY 1
            ) statuses
          ), '[]'::json) AS statuses,
          coalesce((
            SELECT json_agg(json_build_object('day', day, 'count', count))
            FROM (
              SELECT to_char(timezone('Africa/Freetown', "startsAt"), 'YYYY-MM-DD') AS day,
                     count(*)::int AS count
              FROM "Appointment"
              WHERE "startsAt" >= ${trendStart} AND "startsAt" < ${day.end}
              GROUP BY 1
            ) trend
          ), '[]'::json) AS trend,
          coalesce((
            SELECT json_agg(json_build_object('id', id, 'name', name, 'count', count) ORDER BY count DESC)
            FROM (
              SELECT s.id::text AS id, s.name, count(a.id)::int AS count
              FROM "Appointment" a
              INNER JOIN "Specialty" s ON s.id = a."specialtyId"
              GROUP BY s.id, s.name
              ORDER BY count DESC
              LIMIT 5
            ) specialties
          ), '[]'::json) AS specialties
      `,
      db.doctorProfile.findMany({
        where: { verificationStatus: { in: ["SUBMITTED", "UNDER_REVIEW"] }, user: { deletedAt: null } },
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        take: 5,
        select: {
          id: true,
          fullName: true,
          qualificationTitle: true,
          submittedAt: true,
          createdAt: true,
          specialties: { select: { isPrimary: true, specialty: { select: { name: true } } } },
        },
      }),
      db.auditLog.findMany({
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          occurredAt: true,
          actor: { select: { email: true } },
        },
      }),
    ]);
    const snapshot = snapshotRows[0];
    if (!snapshot) return { ok: false as const, code: "UNAVAILABLE" as const };
    const doctors = countRows(snapshot.doctors);
    const todayGroups = countRows(snapshot.today);
    const statusGroups = countRows(snapshot.statuses);
    const patients = asJson<PatientRow>(snapshot.patients, { total: 0, week: 0 });
    const services = asJson<PairRow>(snapshot.services, { active: 0, inactive: 0 });
    const locations = asJson<PairRow>(snapshot.locations, { active: 0, inactive: 0 });
    const trendRows = asJson<DayRow[]>(snapshot.trend, []);
    const specialtyRows = asJson<SpecialtyRow[]>(snapshot.specialties, []);
    const doctorCount = (status: string) => doctors.find((row) => row.status === status)?.count ?? 0;
    const approved = doctorCount("APPROVED");
    const pendingDoctors = doctorCount("SUBMITTED") + doctorCount("UNDER_REVIEW");
    const todayCount = (matches: (status: string) => boolean) =>
      todayGroups.reduce((sum, row) => sum + (matches(row.status) ? row.count : 0), 0);
    const countsByDay = new Map<string, number>();
    for (const row of Array.isArray(trendRows) ? trendRows : []) {
      countsByDay.set(String(row.day), Number(row.count) || 0);
    }
    const trend = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(trendStart.getTime() + index * 86_400_000);
      return {
        label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: PLATFORM_TIMEZONE }).format(date),
        count: countsByDay.get(dayKey(date)) ?? 0,
      };
    });
    const statuses: Array<{ key: string; label: string; color: string; count: number }> = STATUS_SLICES.map((slice) => ({
      key: slice.key,
      label: slice.label,
      color: slice.color,
      count: statusGroups.reduce((sum, row) => sum + (slice.match(row.status) ? row.count : 0), 0),
    })).filter((slice) => slice.count > 0 || ["confirmed", "pending", "completed", "cancelled"].includes(slice.key));
    const other = statusGroups.reduce((sum, row) => sum + (STATUS_SLICES.some((slice) => slice.match(row.status)) ? 0 : row.count), 0);
    if (other > 0) statuses.push({ key: "other", label: "Other", color: "#94a3b8", count: other });

    return {
      ok: true as const,
      name: account?.doctorProfile?.fullName || account?.patientProfile?.fullName || account?.email || "Administrator",
      dateLabel: new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: PLATFORM_TIMEZONE,
      }).format(now),
      year: Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: PLATFORM_TIMEZONE }).format(now)),
      doctors: { total: doctors.reduce((sum, row) => sum + row.count, 0), approved, pending: pendingDoctors },
      patients: { total: Number(patients.total) || 0, thisWeek: Number(patients.week) || 0 },
      today: {
        total: todayGroups.reduce((sum, row) => sum + row.count, 0),
        confirmed: todayCount((status) => CONFIRMED.has(status)),
        pending: todayCount((status) => status === "PENDING_PAYMENT" || status === "PENDING_APPROVAL"),
      },
      services: { active: Number(services.active) || 0, inactive: Number(services.inactive) || 0 },
      locations: {
        total: (Number(locations.active) || 0) + (Number(locations.inactive) || 0),
        inactive: Number(locations.inactive) || 0,
      },
      trend,
      statuses,
      appointmentTotal: statusGroups.reduce((sum, row) => sum + row.count, 0),
      activities: activities.map((row) => ({
        id: row.id,
        title: activityTitle(row.action),
        detail: row.actor?.email ?? row.entityType.replace(/([a-z])([A-Z])/g, "$1 $2"),
        when: relativeWhen(row.occurredAt, now),
        href: adminEntityHref(row.entityType, row.entityId),
        icon: activityIcon(row.action, row.entityType),
      })),
      approvals: approvals.map((row) => {
        const specialty = row.specialties.find((item) => item.isPrimary) ?? row.specialties[0];
        const details = [specialty?.specialty.name, row.qualificationTitle].filter(Boolean).join(" · ");
        return {
          id: row.id,
          name: row.fullName,
          details: details || "Submitted profile",
          submitted: formatPlatformDay(row.submittedAt ?? row.createdAt),
        };
      }),
      specialties: (Array.isArray(specialtyRows) ? specialtyRows : []).map((row) => ({
        id: String(row.id),
        name: row.name || "Specialty",
        count: Number(row.count) || 0,
      })),
    };
  } catch (error) {
    return failed(error);
  }
}
