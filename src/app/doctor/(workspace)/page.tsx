import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { DashIcon, type DashIconName } from "@/components/doctor/dash-icons";
import { HeroClock } from "@/components/doctor/hero-clock";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { appointmentStatusLabel } from "@/lib/admin/labels";
import { profileImageSrc } from "@/components/profile-image-src";
import { loadDoctorDashboard } from "@/lib/doctor/workspace";
import { loadDoctorChrome, requireClinicalPortal } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";
import "./doctor-home.css";

export const metadata: Metadata = { title: "Doctor dashboard" };
export const dynamic = "force-dynamic";

const readDoctorBoard = unstable_cache(
  async (doctorId: string, displayName: string) => {
    const board = await loadDoctorDashboard(prisma, { id: doctorId, displayName });
    if (!board.ok) throw new Error(board.code);
    return board;
  },
  ["doctor-home"],
  { revalidate: 30 },
);

export default async function DoctorPage() {
  const portal = await requireClinicalPortal();
  if (portal.staff) redirect("/doctor/appointments");
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (portal.access !== "ready" || !portal.doctor) return <RestrictedPractice access={portal.access} />;
  const [board, chrome] = await Promise.all([
    readDoctorBoard(portal.doctor.id, portal.doctor.displayName).catch((error: unknown) => {
      const code = error instanceof Error && error.message === "SCHEMA" ? "SCHEMA" : "UNAVAILABLE";
      return { ok: false as const, code: code as "SCHEMA" | "UNAVAILABLE" };
    }),
    loadDoctorChrome(),
  ]);
  if (!board.ok) return <RecordsUnavailable code={board.code} />;
  const name = board.displayName ?? portal.doctor.displayName;
  const first = name.split(" ")[0] ?? name;
  const photoSrc = chrome.imageVersion ? profileImageSrc(portal.user.id, chrome.imageVersion) : "/default-avatar.svg";
  return (
    <div className="doc-dash">
      <section className="doc-hero">
        <div className="doc-hero-copy">
          <h1>Welcome back, {first}!</h1>
          <p>Here is your overview for today. Your patients are counting on the care you give.</p>
          <HeroClock />
        </div>
        <img className="doc-hero-photo" src={photoSrc} alt={name} />
      </section>
      <section className="doc-stats" aria-label="Practice totals">
        <Stat
          icon="calendar"
          tone="teal"
          label="Today's Appointments"
          value={board.counts.today}
          note={`${board.counts.pendingToday} pending · ${board.counts.completedToday} completed`}
        />
        <Stat
          icon="followUp"
          tone="sky"
          label="Upcoming Follow-ups"
          value={board.counts.followUps}
          note={board.counts.followUpsThisWeek === 0 ? "None due this week" : `${board.counts.followUpsThisWeek} due this week`}
        />
        <Stat
          icon="patient"
          tone="green"
          label="Active Patients"
          value={board.counts.activePatients}
          note={board.counts.newPatients === 0 ? "None new this week" : `+${board.counts.newPatients} new this week`}
        />
        <Stat
          icon="notes"
          tone="amber"
          label="Pending Notes"
          value={board.counts.pendingNotes}
          note={
            board.counts.pendingNotes === 0
              ? "None waiting"
              : board.counts.inProgress > 0
                ? `${board.counts.inProgress} consultation${board.counts.inProgress === 1 ? "" : "s"} in progress`
                : "Unreleased summaries"
          }
        />
      </section>
      <section className="doc-body">
        <article className="doc-card doc-card-schedule">
          <header className="doc-card-head">
            <h2>Today&apos;s Schedule</h2>
            <Link href="/doctor/appointments">View all</Link>
          </header>
          {board.today.length === 0 ? (
            <p className="doc-empty">Nothing is booked for today.</p>
          ) : (
            <ul className="doc-schedule">
              {board.today.map((row) => {
                const pill = schedulePill(row.status, row.passed);
                return (
                  <li key={row.id}>
                    <Link className="doc-visit" href={`/doctor/appointments/${row.id}`}>
                      <time>{row.time}</time>
                      <span className="doc-visit-who">
                        <ProfilePhoto userId={row.patientUserId} name={row.patient} version={row.patientImageVersion} size={36} alt="" />
                        <span className="doc-visit-copy">
                          <strong>{row.patient}</strong>
                          <span>{row.followUp ? "Follow-up" : row.service}</span>
                        </span>
                      </span>
                      <span className={`doc-pill doc-pill-${pill.tone}`}>{pill.label}</span>
                      <DashIcon name="chevron" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
        <div className="doc-side">
          <article className="doc-card doc-card-actions">
            <header className="doc-card-head">
              <h2>Quick Actions</h2>
            </header>
            <ul className="doc-actions">
              <Action href="/doctor/appointments" icon="calendar" label="View Full Schedule" short="Schedule" />
              <Action href="/doctor/availability" icon="clock" label="Update Availability" short="Hours" />
              <Action href="/doctor/availability#time-off" icon="plus" label="Add Time Off" short="Time off" />
            </ul>
          </article>
          <aside className="doc-thanks">
            <DashIcon name="heart" />
            <p>Your work makes a difference. Thank you for being part of a healthier Sierra Leone.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, tone, label, value, note }: { icon: DashIconName; tone: string; label: string; value: number; note: string }) {
  return (
    <article className={`doc-stat doc-stat-${tone}`}>
      <span className="doc-stat-icon">
        <DashIcon name={icon} />
      </span>
      <span className="doc-stat-copy">
        <span className="doc-stat-label">{label}</span>
        <strong>{value}</strong>
        <span className="doc-stat-note">{note}</span>
      </span>
    </article>
  );
}

function Action({ href, icon, label, short }: { href: string; icon: DashIconName; label: string; short: string }) {
  return (
    <li>
      <Link className="doc-action" href={href}>
        <span className="doc-action-icon">
          <DashIcon name={icon} />
        </span>
        <span className="doc-action-label">{label}</span>
        <span className="doc-action-short">{short}</span>
        <DashIcon name="chevron" />
      </Link>
    </li>
  );
}

function schedulePill(status: string, passed: boolean) {
  if (status === "COMPLETED") return { label: "Completed", tone: "done" };
  if (status === "IN_PROGRESS") return { label: "In Progress", tone: "live" };
  if (status === "PENDING_APPROVAL") return { label: "Needs approval", tone: "wait" };
  if (status === "PENDING_PAYMENT") return { label: "Awaiting payment", tone: "wait" };
  if (passed && (status === "CONFIRMED" || status === "PENDING_PAYMENT" || status === "CHECKED_IN")) return { label: "Time passed", tone: "wait" };
  if (status === "CONFIRMED" || status === "PENDING_PAYMENT") return { label: "Upcoming", tone: "next" };
  if (status === "CHECKED_IN") return { label: "Checked in", tone: "live" };
  if (status.startsWith("CANCELLED") || status === "NO_SHOW" || status === "EXPIRED_UNPAID") return { label: appointmentStatusLabel(status), tone: "stop" };
  if (status === "RESCHEDULED") return { label: appointmentStatusLabel(status), tone: "wait" };
  return { label: appointmentStatusLabel(status), tone: "next" };
}
