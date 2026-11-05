import type { Metadata } from "next";
import Link from "next/link";
import { DashIcon, type DashIconName } from "@/components/doctor/dash-icons";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { notDeveloper } from "@/lib/auth/visibility";
import { loadDoctorSchedule } from "@/lib/appointments/queries";
import { availabilityModeLabel } from "@/lib/appointments/slots";
import { addDays, atMinutes, isoWeekday, parseCalendarDate, formatNormalClock } from "@/lib/appointments/time";
import { appointmentStatusLabel } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { AddHoursButton, AddTimeOffButton, DeactivateRuleForm, RemoveTimeOffForm } from "./forms";
import "@/app/doctor/doctor-availability.css";

export const metadata: Metadata = { title: "Availability" };
export const dynamic = "force-dynamic";

const weekdays = [
  { name: "Monday", short: "Mon" },
  { name: "Tuesday", short: "Tue" },
  { name: "Wednesday", short: "Wed" },
  { name: "Thursday", short: "Thu" },
  { name: "Friday", short: "Fri" },
  { name: "Saturday", short: "Sat" },
  { name: "Sunday", short: "Sun" },
];

const DAY_START = 7 * 60;
const DAY_END = 20 * 60;

type Rule = Extract<Awaited<ReturnType<typeof loadDoctorSchedule>>, { ok: true }>["rules"][number];

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function weeklyHours(rules: Rule[]) {
  const minutes = rules.reduce((total, rule) => {
    const span = clockMinutes(rule.end) - clockMinutes(rule.start);
    return span > 0 ? total + span : total;
  }, 0);
  const hours = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function barStyle(start: string, end: string) {
  const span = DAY_END - DAY_START;
  const left = Math.min(96, Math.max(0, ((clockMinutes(start) - DAY_START) / span) * 100));
  const right = Math.min(100, Math.max(left + 6, ((clockMinutes(end) - DAY_START) / span) * 100));
  return { left: `${left}%`, width: `${right - left}%` };
}

function modeTone(mode: string | null) {
  if (mode === "IN_PERSON") return "clinic";
  if (mode === "ONLINE") return "online";
  return "both";
}

function calendarDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function windowLabel(rule: Rule) {
  if (rule.validFrom && rule.validUntil) return `${calendarDay(rule.validFrom)} – ${calendarDay(rule.validUntil)}`;
  if (rule.validFrom) return `From ${calendarDay(rule.validFrom)}`;
  if (rule.validUntil) return `Until ${calendarDay(rule.validUntil)}`;
  return null;
}

function bookingFit(offerings: Array<{ mode: string; durationMinutes: number }>, rule: Rule) {
  const matching = offerings.filter((offering) => rule.mode === null || offering.mode === rule.mode);
  const usable = matching.length > 0 ? matching : offerings;
  if (usable.length === 0) return 15;
  const minutes = usable.map((offering) => offering.durationMinutes).filter((minutes) => minutes > 0);
  return minutes.length > 0 ? Math.min(...minutes) : 15;
}

function nextPatientDay(rule: Rule, today: string, now: Date, durationMinutes: number) {
  const start = parseCalendarDate(today);
  const until = rule.validUntil ? parseCalendarDate(rule.validUntil) : start ? addDays(start, 60) : null;
  if (!start || !until) return null;
  for (let day = start; day.getTime() <= until.getTime(); day = addDays(day, 1)) {
    const iso = day.toISOString().slice(0, 10);
    if (rule.validFrom && iso < rule.validFrom) continue;
    if (isoWeekday(day) !== rule.dayOfWeek) continue;
    const windowStart = atMinutes(day, clockMinutes(rule.start));
    const windowEnd = atMinutes(day, clockMinutes(rule.end));
    const openFrom = windowStart > now ? windowStart : now;
    if (windowEnd.getTime() - openFrom.getTime() >= durationMinutes * 60_000) return iso;
  }
  return null;
}

function visitMode(mode: string) {
  if (mode === "ONLINE" || mode === "IN_PERSON") return availabilityModeLabel(mode);
  return mode;
}

export default async function DoctorAvailabilityPage({ searchParams }: { searchParams: Promise<{ doctor?: string }> }) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  const query = await searchParams;
  let coveredDoctorId: string | undefined;
  let clinicians: Array<{ id: string; displayName: string }> = [];
  if (portal.staff) {
    clinicians = await prisma.doctorProfile.findMany({
      where: { verificationStatus: "APPROVED", user: { status: "ACTIVE", deletedAt: null, ...notDeveloper } },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 40,
    });
    coveredDoctorId = clinicians.some((row) => row.id === query.doctor) ? query.doctor : clinicians[0]?.id;
    if (!coveredDoctorId) return <RecordsUnavailable code="NOT_FOUND" />;
  } else if (!portal.doctor) {
    return <RecordsUnavailable code="NOT_FOUND" />;
  }
  const schedule = await loadDoctorSchedule(prisma, coveredDoctorId ?? portal.doctor!.id);
  if (!schedule.ok) return <RecordsUnavailable code={schedule.code} />;
  const rules: Rule[] = schedule.rules;
  const now = new Date();
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Freetown", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const byDay = new Map<number, Rule[]>();
  for (const rule of rules) {
    const list = byDay.get(rule.dayOfWeek) ?? [];
    list.push(rule);
    byDay.set(rule.dayOfWeek, list);
  }
  const openDays = byDay.size;
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Africa/Freetown" }).format(new Date());

  return (
    <div className="avail">
      <section className="avail-hero">
        <div className="avail-hero-copy">
          <p className="avail-kicker">Practice hours</p>
          <h1>Manage availability</h1>
          <p>Set the hours patients can book. Use the normal clock, such as 7:00 AM and 4:00 PM. Saving hours does not cancel appointments already booked.</p>
          {clinicians.length > 0 ? (
            <nav className="mt-3 flex flex-wrap gap-2" aria-label="Clinician schedules">
              {clinicians.map((clinician) => (
                <Link
                  key={clinician.id}
                  href={`/doctor/availability?doctor=${clinician.id}`}
                  aria-current={clinician.id === coveredDoctorId ? "page" : undefined}
                  className={clinician.id === coveredDoctorId ? "font-semibold text-[#0F766E]" : "text-[#5b6b7c]"}
                >
                  {clinician.displayName}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        <div className="avail-hero-side">
          <p className="avail-zone">
            <DashIcon name="clock" />
            <span>Local time</span>
          </p>
          <Link href="/doctor/appointments">View appointments</Link>
        </div>
      </section>

      <section className="avail-stats" aria-label="Availability summary">
        <Stat icon="calendar" tone="teal" label="Days open" value={String(openDays)} note={openDays === 0 ? "No weekdays published" : `of ${weekdays.length} weekdays`} />
        <Stat icon="clock" tone="sky" label="Hours each week" value={weeklyHours(rules)} note={rules.length === 0 ? "Add a weekly block" : `${rules.length} published block${rules.length === 1 ? "" : "s"}`} />
        <Stat icon="plus" tone="amber" label="Time off" value={String(schedule.timeOff.length)} note={schedule.timeOff.length === 0 ? "None scheduled" : "Upcoming blocks"} />
        <Stat icon="followUp" tone="green" label="Booked ahead" value={String(schedule.upcoming.length)} note={schedule.upcoming.length === 0 ? "No upcoming visits" : "Appointments still open"} />
      </section>

      <section className="avail-body">
        <article className="avail-card avail-week">
          <header className="avail-card-head">
            <div>
              <h2>Weekly schedule</h2>
              <p>Each bar shows where the hours sit between 7:00 AM and 8:00 PM. A date range does not open every day inside it. Patients can book only that weekday, and only while a time is still ahead.</p>
            </div>
            <AddHoursButton doctorProfileId={coveredDoctorId} offerings={schedule.offerings ?? []} />
          </header>
          <ol className="avail-days">
            {weekdays.map((day, index) => {
              const dayRules = byDay.get(index + 1) ?? [];
              const isToday = day.short === today;
              return (
                <li key={day.name} className={isToday ? "avail-day is-today" : "avail-day"}>
                  <div className="avail-day-name">
                    <span>{day.short}</span>
                    <strong>{day.name}</strong>
                    {isToday ? <em>Today</em> : null}
                  </div>
                  <div className="avail-day-slots">
                    {dayRules.length === 0 ? (
                      <p className="avail-closed">Closed</p>
                    ) : (
                      dayRules.map((rule) => {
                        const tone = modeTone(rule.mode);
                        const window = windowLabel(rule);
                        const nextDay = nextPatientDay(rule, todayIso, now, bookingFit(schedule.offerings ?? [], rule));
                        const weekdayName = weekdays[rule.dayOfWeek - 1]?.name ?? "that weekday";
                        return (
                          <article key={rule.id} className={`avail-block avail-block-${tone}`}>
                            <div className="avail-track" aria-hidden="true">
                              <span style={barStyle(rule.start, rule.end)} />
                            </div>
                            <div className="avail-block-head">
                              <strong>
                                {formatNormalClock(clockMinutes(rule.start))}–{formatNormalClock(clockMinutes(rule.end))}
                              </strong>
                              <span className={`avail-mode avail-mode-${tone}`}>{availabilityModeLabel(rule.mode)}</span>
                              <DeactivateRuleForm ruleId={rule.id} doctorProfileId={coveredDoctorId} compact />
                            </div>
                            <p className="avail-block-meta">
                              {rule.service}
                              {rule.location ? ` · ${rule.location}` : ""}
                              {window ? ` · ${window}` : ""}
                            </p>
                            <p className={nextDay ? "avail-bookable" : "avail-unbookable"}>
                              {nextDay
                                ? `Patients can book ${weekdayName} ${calendarDay(nextDay)}.`
                                : `Patients cannot book this. These hours are only on ${weekdayName}, and no ${weekdayName} in these dates still has an open time.`}
                            </p>
                          </article>
                        );
                      })
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </article>

        <div className="avail-side">
          <article id="time-off" className="avail-card">
            <header className="avail-card-head">
              <div>
                <h2>Time off</h2>
                <p>Leave and breaks stay off the booking calendar. A block is refused when a visit is already booked.</p>
              </div>
              <AddTimeOffButton doctorProfileId={coveredDoctorId} />
            </header>
            {schedule.timeOff.length === 0 ? (
              <p className="avail-empty">No upcoming time off is recorded.</p>
            ) : (
              <ul className="avail-leave">
                {schedule.timeOff.map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{row.when}</strong>
                      {row.reason ? <span>{row.reason}</span> : <span>No reason recorded</span>}
                    </div>
                    <RemoveTimeOffForm timeOffId={row.id} doctorProfileId={coveredDoctorId} compact />
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="avail-card">
            <header className="avail-card-head">
              <div>
                <h2>Upcoming bookings</h2>
                <p>These visits stay on the record if you change hours.</p>
              </div>
              <Link href="/doctor/appointments">Open schedule</Link>
            </header>
            {schedule.upcoming.length === 0 ? (
              <p className="avail-empty">No upcoming appointments are booked.</p>
            ) : (
              <ul className="avail-bookings">
                {schedule.upcoming.map((row) => (
                  <li key={row.id}>
                    <Link href={`/doctor/appointments/${row.id}`}>
                      <strong>{row.when}</strong>
                      <span>
                        {visitMode(row.mode)} · {appointmentStatusLabel(row.status)}
                      </span>
                      <DashIcon name="chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, tone, label, value, note }: { icon: DashIconName; tone: string; label: string; value: string; note: string }) {
  return (
    <article className={`avail-stat avail-stat-${tone}`}>
      <span className="avail-stat-icon">
        <DashIcon name={icon} />
      </span>
      <span className="avail-stat-copy">
        <span className="avail-stat-label">{label}</span>
        <strong>{value}</strong>
        <span className="avail-stat-note">{note}</span>
      </span>
    </article>
  );
}
