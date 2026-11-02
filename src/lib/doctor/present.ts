import { ageInYears, freetownDate } from "@/lib/auth/age";
import { addDays, isoWeekday, parseCalendarDate } from "@/lib/appointments/time";
import { CLINICAL_BODY_MAX, utcDateOnly } from "@/lib/clinical/rules";

export type ClinicalAccess = "ready" | "pending" | "rejected" | "suspended" | "incomplete" | "missing" | "schema";
export type ScheduleView = "day" | "week" | "month" | "list";
export type FollowUpView = "upcoming" | "today" | "overdue" | "completed" | "cancelled";
export type NoteTab = "private" | "drafts" | "released" | "pending";

const SCHEDULE_VIEWS = new Set<ScheduleView>(["day", "week", "month", "list"]);
const FOLLOW_VIEWS = new Set<FollowUpView>(["upcoming", "today", "overdue", "completed", "cancelled"]);
const NOTE_TABS = new Set<NoteTab>(["private", "drafts", "released", "pending"]);

const APPOINTMENT_STATUSES = new Set([
  "PENDING_PAYMENT",
  "EXPIRED_UNPAID",
  "PENDING_APPROVAL",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED_BY_PATIENT",
  "CANCELLED_BY_DOCTOR",
  "CANCELLED_BY_ADMIN",
  "NO_SHOW",
  "RESCHEDULED",
]);

export function clinicalAccess(status: string | null | undefined): ClinicalAccess {
  if (!status) return "missing";
  if (status === "APPROVED") return "ready";
  if (status === "REJECTED") return "rejected";
  if (status === "SUSPENDED") return "suspended";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW") return "pending";
  return "incomplete";
}

export function parseScheduleView(value: string | undefined): ScheduleView {
  return value && SCHEDULE_VIEWS.has(value as ScheduleView) ? (value as ScheduleView) : "day";
}

export function parseFollowUpView(value: string | undefined): FollowUpView {
  return value && FOLLOW_VIEWS.has(value as FollowUpView) ? (value as FollowUpView) : "upcoming";
}

export function parseNoteTab(value: string | undefined): NoteTab {
  return value && NOTE_TABS.has(value as NoteTab) ? (value as NoteTab) : "private";
}

export function parseStatusFilter(value: string | undefined): string | null {
  const status = (value ?? "").trim();
  return APPOINTMENT_STATUSES.has(status) ? status : null;
}

export function parseModeFilter(value: string | undefined): "ONLINE" | "IN_PERSON" | null {
  if (value === "ONLINE" || value === "IN_PERSON") return value;
  return null;
}

export function platformDay(now: Date): Date {
  return new Date(`${freetownDate(now)}T00:00:00.000Z`);
}

export function parseAnchor(value: string | undefined, now: Date): Date {
  const parsed = value ? parseCalendarDate(value) : null;
  return parsed ?? platformDay(now);
}

export function startOfWeek(day: Date): Date {
  return addDays(day, 1 - isoWeekday(day));
}

export function visibleRange(view: ScheduleView, anchor: Date): { start: Date; end: Date } {
  if (view === "day") return { start: anchor, end: addDays(anchor, 1) };
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  if (view === "list") return { start: monthStart, end: monthEnd };
  const gridStart = startOfWeek(monthStart);
  return { start: gridStart, end: addDays(gridStart, 42) };
}

export function shiftAnchor(view: ScheduleView, anchor: Date, direction: -1 | 1): string {
  if (view === "month" || view === "list") {
    const next = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1));
    return next.toISOString().slice(0, 10);
  }
  const days = view === "week" ? 7 : 1;
  return addDays(anchor, direction * days).toISOString().slice(0, 10);
}

export function monthCells(anchor: Date): Array<{ date: string; inMonth: boolean }> {
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(gridStart, index);
    return { date: day.toISOString().slice(0, 10), inMonth: day.getUTCMonth() === anchor.getUTCMonth() };
  });
}

export function rangeLabel(view: ScheduleView, anchor: Date): string {
  const zone = "Africa/Freetown";
  if (view === "day") {
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: zone }).format(anchor);
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    const startText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone }).format(start);
    const endText = new Intl.DateTimeFormat("en-US", { month: sameMonth ? undefined : "short", day: "numeric", year: "numeric", timeZone: zone }).format(end);
    return `${startText} – ${endText}`;
  }
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: zone }).format(anchor);
}

export function formatPortalTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Freetown" }).format(value);
}

export function formatPortalDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Africa/Freetown" }).format(value);
}

export function dayKey(value: Date): string {
  return freetownDate(value);
}

export function classifyFollowUp(input: { status: string; startsAt: Date; dayStart: Date; dayEnd: Date }): FollowUpView | "other" {
  if (input.status.startsWith("CANCELLED") || input.status === "NO_SHOW") return "cancelled";
  if (input.status === "COMPLETED") return "completed";
  if (input.status === "RESCHEDULED" || input.status === "EXPIRED_UNPAID") return "other";
  if (input.startsAt >= input.dayStart && input.startsAt < input.dayEnd) return "today";
  if (input.startsAt < input.dayStart) return "overdue";
  return "upcoming";
}

export function patientReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function patientAgeLine(genderLabel: string, dateOfBirth: Date | null, now: Date): string {
  const date = utcDateOnly(dateOfBirth);
  if (!date) return genderLabel;
  return `${genderLabel} · ${ageInYears(date, now)} years`;
}

export function pageCount(total: number, size: number): number {
  if (size < 1) return 1;
  return Math.max(1, Math.ceil(total / size));
}

export function clampPage(value: string | undefined, pages: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, pages);
}

const NOTE_SECTIONS: Array<{ key: "complaint" | "history" | "findings" | "assessment" | "plan" | "followUp"; label: string }> = [
  { key: "complaint", label: "Presenting complaint" },
  { key: "history", label: "History" },
  { key: "findings", label: "Observations and findings" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Care plan" },
  { key: "followUp", label: "Follow-up instructions" },
];

export function composeConsultationNote(input: Record<(typeof NOTE_SECTIONS)[number]["key"], string>): { ok: true; body: string } | { ok: false; message: string } {
  const parts = NOTE_SECTIONS.flatMap((section) => {
    const text = input[section.key].replace(/\r\n/g, "\n").trim();
    return text ? [`${section.label}\n${text}`] : [];
  });
  if (parts.length === 0) return { ok: false, message: "Add at least one section before saving." };
  const body = parts.join("\n\n");
  if (body.length > CLINICAL_BODY_MAX) return { ok: false, message: "Notes must be 8,000 characters or fewer." };
  return { ok: true, body };
}

export function splitConsultationNote(body: string): Record<(typeof NOTE_SECTIONS)[number]["key"], string> {
  const empty = {
    complaint: "",
    history: "",
    findings: "",
    assessment: "",
    plan: "",
    followUp: "",
  };
  const found = NOTE_SECTIONS.flatMap((section) => {
    const at = body.indexOf(`${section.label}\n`);
    return at < 0 ? [] : [{ ...section, at }];
  }).sort((left, right) => left.at - right.at);
  if (found.length === 0) {
    empty.complaint = body.trim();
    return empty;
  }
  for (let index = 0; index < found.length; index += 1) {
    const start = found[index].at + found[index].label.length + 1;
    const end = index + 1 < found.length ? found[index + 1].at : body.length;
    empty[found[index].key] = body.slice(start, end).trim();
  }
  return empty;
}

export function scheduleHref(input: { view: ScheduleView; date: string; status?: string | null; mode?: string | null; service?: string | null }): string {
  const params = new URLSearchParams({ view: input.view, date: input.date });
  if (input.status) params.set("status", input.status);
  if (input.mode) params.set("mode", input.mode);
  if (input.service) params.set("service", input.service);
  return `/doctor/appointments?${params.toString()}`;
}
