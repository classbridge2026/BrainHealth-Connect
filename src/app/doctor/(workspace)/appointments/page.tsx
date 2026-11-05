import type { Metadata } from "next";
import Link from "next/link";
import { LiveQueryForm } from "@/components/live-query";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { StatusBadge } from "@/components/status-badge";
import { appointmentStatusLabel, appointmentStatusTone } from "@/lib/admin/labels";
import { isPortalAdministrator } from "@/lib/admin/rules";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { OwnAccountForm } from "./account-form";
import {
  monthCells,
  parseAnchor,
  parseModeFilter,
  parseScheduleView,
  parseStatusFilter,
  rangeLabel,
  scheduleHref,
  shiftAnchor,
  visibleRange,
  type ScheduleView,
} from "@/lib/doctor/present";
import { loadDoctorScheduleView } from "@/lib/doctor/workspace";
import { prisma } from "@/lib/db/prisma";
import { parseUuid } from "@/lib/catalog/rules";

export const metadata: Metadata = { title: "Appointment schedule" };
export const dynamic = "force-dynamic";

const views: ScheduleView[] = ["day", "week", "month", "list"];

export default async function DoctorAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; status?: string; mode?: string; service?: string }>;
}) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const query = await searchParams;
  const now = new Date();
  const view = parseScheduleView(query.view);
  const anchor = parseAnchor(query.date, now);
  const date = anchor.toISOString().slice(0, 10);
  const status = parseStatusFilter(query.status);
  const mode = parseModeFilter(query.mode);
  const service = query.service && parseUuid(query.service) ? query.service : null;
  const range = visibleRange(view, anchor);
  const result = await loadDoctorScheduleView(prisma, {
    userId: portal.user.id,
    view,
    start: range.start,
    end: range.end,
    status,
    mode,
    serviceId: service,
    now,
    clinicWide: portal.staff,
  });
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const administrator = isPortalAdministrator(portal.user.roleCodes);
  const signIn = administrator
    ? await prisma.user.findUnique({ where: { id: portal.user.id }, select: { email: true } })
    : null;
  const filters = { status, mode, service };
  const selectedKey = date;
  const selected = view === "day" ? result.rows : result.rows.filter((row) => row.day === selectedKey);
  const summaryRows = view === "day" ? result.rows : result.rows.filter((row) => row.onSelectedDay);
  const summarySource = summaryRows.length > 0 ? summaryRows : selected;
  const completed = summarySource.filter((row) => row.status === "COMPLETED").length;
  const inProgress = summarySource.filter((row) => row.status === "IN_PROGRESS").length;
  const upcoming = summarySource.filter((row) => row.status === "CONFIRMED" || row.status === "CHECKED_IN" || row.status === "PENDING_PAYMENT" || row.status === "PENDING_APPROVAL").length;
  const next = result.rows.find((row) => row.status === "CONFIRMED" || row.status === "CHECKED_IN" || row.status === "IN_PROGRESS" || row.status === "PENDING_PAYMENT" || row.status === "PENDING_APPROVAL") ?? null;
  const byDay = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#0C2B45]">Appointment Schedule</h1>
          <p className="mt-1 text-sm text-[#5b6b7c]">
            {portal.staff
              ? "Approve, decline, and run these visits the same way the assigned doctor can. Times use Africa/Freetown (GMT)."
              : "View and manage your appointments. Times use Africa/Freetown (GMT)."}
          </p>
        </div>
      </header>
      {signIn ? <OwnAccountForm email={signIn.email} /> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_280px]">
        <section className="rounded-2xl border border-[#d7e3ee] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Link className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#d7e3ee] text-[#0C2B45] sm:h-9 sm:w-9" href={scheduleHref({ view, date: shiftAnchor(view, anchor, -1), ...filters })} aria-label="Previous">‹</Link>
              <p className="min-w-0 text-sm font-semibold text-[#0C2B45]">{rangeLabel(view, anchor)}</p>
              <Link className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#d7e3ee] text-[#0C2B45] sm:h-9 sm:w-9" href={scheduleHref({ view, date: shiftAnchor(view, anchor, 1), ...filters })} aria-label="Next">›</Link>
            </div>
            <div className="flex max-w-full flex-wrap rounded-lg bg-[#F3F8FC] p-1" role="group" aria-label="Calendar view">
              {views.map((item) => (
                <Link key={item} href={scheduleHref({ view: item, date, ...filters })} aria-current={item === view ? "page" : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold capitalize sm:py-1.5 ${item === view ? "bg-[#0F766E] text-white" : "text-[#0C2B45]"}`}>
                  {item}
                </Link>
              ))}
            </div>
          </div>
          <LiveQueryForm
            pathname="/doctor/appointments"
            className="mt-4 flex flex-wrap gap-2"
            fields={[
              { name: "status", label: "Status", kind: "select", value: status ?? "", labelClassName: "text-sm", inputClassName: "h-10 rounded-lg border border-[#d7e3ee] bg-white px-2", srOnly: true, options: [{ value: "", label: "All statuses" }, ...["PENDING_APPROVAL", "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED_BY_DOCTOR", "CANCELLED_BY_PATIENT", "EXPIRED_UNPAID", "RESCHEDULED"].map((item) => ({ value: item, label: appointmentStatusLabel(item) }))] },
              { name: "mode", label: "Mode", kind: "select", value: mode ?? "", labelClassName: "text-sm", inputClassName: "h-10 rounded-lg border border-[#d7e3ee] bg-white px-2", srOnly: true, options: [{ value: "", label: "All modes" }, { value: "ONLINE", label: "Online" }, { value: "IN_PERSON", label: "In person" }] },
              { name: "service", label: "Service", kind: "select", value: service ?? "", labelClassName: "text-sm", inputClassName: "h-10 rounded-lg border border-[#d7e3ee] bg-white px-2", srOnly: true, options: [{ value: "", label: "All services" }, ...result.services.map((item) => ({ value: item.id, label: item.name }))] },
            ]}
          />
          <div className="mt-4">
            {view === "month" ? <MonthGrid anchor={anchor} byDay={byDay} filters={filters} /> : null}
            {view === "week" ? <WeekGrid anchor={anchor} byDay={byDay} filters={filters} /> : null}
            {view === "list" ? <AppointmentTable rows={result.rows} showDoctor={portal.staff} /> : null}
            {view === "day" ? <DayList rows={result.rows} showDoctor={portal.staff} /> : null}
          </div>
        </section>
        <aside className="grid content-start gap-4">
          <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#0C2B45]">Today&apos;s Summary</h2>
            <p className="mt-3 text-3xl font-semibold text-[#0C2B45]">{summarySource.length}</p>
            <p className="text-sm text-[#5b6b7c]">appointments</p>
            <ul className="mt-4 grid gap-2 text-sm text-[#0C2B45]">
              <li>{completed} completed</li>
              <li>{inProgress} in progress</li>
              <li>{upcoming} still open</li>
            </ul>
          </section>
          <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#0C2B45]">Upcoming</h2>
            {next ? (
              <div className="mt-3">
                <p className="text-sm text-[#5b6b7c]">Next appointment</p>
                <p className="mt-1 font-semibold text-[#0C2B45]">{next.time}</p>
                <p className="text-sm">{next.patient}</p>
                <p className="text-sm text-[#5b6b7c]">{next.service}</p>
                <Link className="mt-3 inline-flex text-sm font-semibold text-[#0F766E]" href={`/doctor/appointments/${next.id}`}>View appointment</Link>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#5b6b7c]">No open appointment is in this range.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function clip(value: string | null) {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function DayList({ rows, showDoctor }: { rows: Array<{ id: string; time: string; patient: string; doctorName: string; patientUserId: string; patientImageVersion: string | null; service: string; mode: string; status: string; reason: string | null; intake: string | null; paymentLabel: string }>; showDoctor: boolean }) {
  if (rows.length === 0) return <p className="rounded-xl bg-[#F3F8FC] p-4 text-sm text-[#5b6b7c]">Nothing is booked in this range.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/doctor/appointments/${row.id}`} className="grid grid-cols-1 items-center gap-3 rounded-xl px-2 py-2 hover:bg-[#F3F8FC] sm:grid-cols-[88px_minmax(0,1fr)_auto]">
            <span className="text-sm font-medium text-[#5b6b7c]">{row.time}</span>
            <span className="flex min-w-0 items-center gap-3">
              <ProfilePhoto userId={row.patientUserId} name={row.patient} version={row.patientImageVersion} size={36} alt="" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#0C2B45]">{row.patient}</span>
                <span className="block truncate text-xs text-[#5b6b7c]">
                  {showDoctor ? `${row.doctorName} · ` : ""}
                  {row.service} · {row.mode === "ONLINE" ? "Online" : "In person"} · {row.paymentLabel}
                </span>
                {clip(row.reason) ? <span className="block truncate text-xs text-[#0C2B45]">Reason: {clip(row.reason)}</span> : null}
                {clip(row.intake) ? <span className="block truncate text-xs text-[#5b6b7c]">Intake: {clip(row.intake)}</span> : null}
              </span>
            </span>
            <StatusBadge tone={appointmentStatusTone(row.status)}>{appointmentStatusLabel(row.status)}</StatusBadge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AppointmentTable({ rows, showDoctor }: { rows: Array<{ id: string; when: string; patient: string; doctorName: string; patientId: string; service: string; mode: string; status: string; reason: string | null; intake: string | null; paymentLabel: string }>; showDoctor: boolean }) {
  if (rows.length === 0) return <p className="rounded-xl bg-[#F3F8FC] p-4 text-sm text-[#5b6b7c]">Nothing is booked in this month.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="phone-table w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs tracking-wide text-[#5b6b7c] uppercase">
          <tr>
            <th className="px-2 py-2 font-medium">When</th>
            <th className="px-2 py-2 font-medium">Patient</th>
            <th className="px-2 py-2 font-medium">Service</th>
            <th className="px-2 py-2 font-medium">Mode</th>
            <th className="px-2 py-2 font-medium">Reason</th>
            <th className="px-2 py-2 font-medium">Payment</th>
            <th className="px-2 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[#e6eef5]">
              <td className="px-2 py-3" data-label="When"><Link className="font-semibold text-[#0F766E]" href={`/doctor/appointments/${row.id}`}>{row.when}</Link></td>
              <td className="px-2 py-3" data-label="Patient"><Link className="font-medium text-[#0C2B45]" href={`/doctor/patients/${row.patientId}`}>{row.patient}</Link></td>
              <td className="px-2 py-3" data-label="Service">{showDoctor ? `${row.doctorName} · ` : ""}{row.service}</td>
              <td className="px-2 py-3" data-label="Mode">{row.mode === "ONLINE" ? "Online" : "In person"}</td>
              <td className="px-2 py-3" data-label="Reason">
                <span className="block">{clip(row.reason) ?? "No reason recorded"}</span>
                {clip(row.intake) ? <span className="block text-xs text-[#5b6b7c]">Intake: {clip(row.intake)}</span> : null}
              </td>
              <td className="px-2 py-3" data-label="Payment">{row.paymentLabel}</td>
              <td className="px-2 py-3" data-label="Status"><StatusBadge tone={appointmentStatusTone(row.status)}>{appointmentStatusLabel(row.status)}</StatusBadge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekGrid({
  anchor,
  byDay,
  filters,
}: {
  anchor: Date;
  byDay: Map<string, Array<{ id: string; time: string; patient: string; status: string }>>;
  filters: { status: string | null; mode: "ONLINE" | "IN_PERSON" | null; service: string | null };
}) {
  const start = visibleRange("week", anchor).start;
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000);
    return day.toISOString().slice(0, 10);
  });
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((day) => {
        const rows = byDay.get(day) ?? [];
        return (
          <section key={day} className="rounded-xl bg-[#F3F8FC] p-2">
            <Link className="text-xs font-semibold text-[#0C2B45]" href={scheduleHref({ view: "day", date: day, ...filters })}>{day.slice(8)}</Link>
            <ul className="mt-2 grid gap-1">
              {rows.length === 0 ? <li className="text-xs text-[#5b6b7c]">Open</li> : rows.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <Link className="block rounded-md bg-white px-2 py-1 text-xs" href={`/doctor/appointments/${row.id}`}>
                    <span className="block font-semibold">{row.time}</span>
                    <span className="block truncate">{row.patient}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({
  anchor,
  byDay,
  filters,
}: {
  anchor: Date;
  byDay: Map<string, Array<{ id: string }>>;
  filters: { status: string | null; mode: "ONLINE" | "IN_PERSON" | null; service: string | null };
}) {
  return (
    <div>
      <div className="grid min-w-0 grid-cols-7 gap-0.5 text-center text-[0.65rem] font-semibold text-[#5b6b7c] sm:gap-1 sm:text-xs">
        {(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).map((day) => (
          <div key={day} className="min-w-0">
            <span className="sm:hidden">{day.slice(0, 1)}</span>
            <span className="hidden sm:inline">{day}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-7 gap-0.5 sm:gap-1">
        {monthCells(anchor).map((cell) => {
          const count = byDay.get(cell.date)?.length ?? 0;
          return (
            <Link key={cell.date} href={scheduleHref({ view: "day", date: cell.date, ...filters })} className={`flex min-h-14 min-w-0 flex-col overflow-hidden rounded-lg p-1 text-left text-[0.65rem] sm:min-h-16 sm:p-2 sm:text-xs ${cell.inMonth ? "bg-[#F3F8FC] text-[#0C2B45]" : "text-[#9aa8b5]"}`}>
              <span className="font-semibold">{Number(cell.date.slice(8))}</span>
              {count > 0 ? (
                <span className="mt-1 block leading-tight text-[#0F766E]">
                  <span className="sm:hidden">{count}</span>
                  <span className="hidden sm:inline">{count} visit{count === 1 ? "" : "s"}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
