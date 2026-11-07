import type { Metadata } from "next";
import Link from "next/link";
import { BookingGuideVideo } from "@/components/patient/booking-guide";
import { PatientHomeIcon, type PatientHomeIconName } from "@/components/patient/home-icons";
import { profileImageSrc } from "@/components/profile-image-src";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { appointmentStatusLabel } from "@/lib/admin/labels";
import { ReleaseWhenHoldEnds } from "@/components/patient/release-hold";
import { listPatientAppointments, resumePaymentHref } from "@/lib/appointments/queries";
import { prisma } from "@/lib/db/prisma";
import { listPatientFollowUpHome, listPatientPayments, loadPatientAccount } from "@/lib/patient/portal";
import "./patient-home.css";

export const metadata: Metadata = { title: "Patient dashboard" };
export const dynamic = "force-dynamic";

export default async function PatientPage() {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const [account, appointments, payments, follows] = await Promise.all([
    loadPatientAccount(prisma, user.id),
    listPatientAppointments(prisma, user.id),
    listPatientPayments(prisma, user.id),
    listPatientFollowUpHome(prisma, user.id),
  ]);
  const name = account.ok && account.profile ? account.profile.fullName : "there";
  const first = name.split(" ")[0] ?? name;
  const photoSrc = account.ok && account.profile?.imageVersion ? profileImageSrc(user.id, account.profile.imageVersion) : "/default-avatar.svg";
  const upcoming = appointments.ok ? [...appointments.upcoming].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()) : [];
  const unpaid = appointments.ok ? appointments.pending.filter((row) => row.status === "PENDING_PAYMENT") : [];
  const next = upcoming[0] ?? null;
  const dueFollows = (follows.ok ? [...follows.today, ...follows.overdue, ...follows.upcoming] : []).sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const nextFollow = dueFollows[0] ?? null;
  const lastPayment = payments.ok ? payments.payments[0] ?? null : null;

  return (
    <div className="pat-dash">
      <section className="pat-hero">
        <div className="pat-hero-copy">
          <h1>Welcome back, {first}!</h1>
          <p>Connect with qualified doctors, book appointments, and access your health records — all in one place.</p>
          <div className="pat-hero-actions">
            <Link href="/patient/find">Find a Doctor</Link>
            <BookingGuideVideo label="Watch how to book" />
          </div>
        </div>
        <img className="pat-hero-photo" src={photoSrc} alt={name === "there" ? "" : name} />
      </section>
      <section className="pat-stats" aria-label="Your care totals">
        <Stat
          href="/patient/appointments"
          icon="calendar"
          tone="teal"
          label="Upcoming Appointments"
          value={appointments.ok ? upcoming.length : 0}
          note={next ? `Next: ${shortDay(next.startsAt)}` : "None booked"}
        />
        <Stat
          href="/patient/follow-ups"
          icon="followUp"
          tone="amber"
          label="Follow-ups Due"
          value={follows.ok ? dueFollows.length : 0}
          note={nextFollow ? `Next: ${shortDay(nextFollow.startsAt)}` : "None due"}
        />
        <Stat
          href="/patient/payments"
          icon="payment"
          tone="green"
          label="Recent Payments"
          value={payments.ok ? payments.payments.length : 0}
          note={lastPayment ? `Last: ${shortDay(lastPayment.createdAt)}` : "None recorded"}
        />
      </section>
      <section className="pat-body">
        <article className="pat-card pat-card-next">
          <header className="pat-card-head">
            <h2>Your Next Appointment</h2>
          </header>
          {!appointments.ok ? (
            <RecordsUnavailable code={appointments.code} />
          ) : !next ? (
            unpaid[0] ? (
              <OpenPayment doctor={unpaid[0].doctor} href={resumePaymentHref(unpaid[0])} expiresAt={unpaid[0].paymentHoldExpiresAt?.toISOString() ?? null} />
            ) : appointments.pending.length > 0 ? (
              <p className="pat-empty">You have a booking waiting for the doctor. <Link href="/patient/appointments?view=pending">Open Pending</Link></p>
            ) : (
              <div className="pat-empty-guide">
                <p className="pat-empty">You have no upcoming appointment.</p>
                <BookingGuideVideo label="Watch how to book" />
              </div>
            )
          ) : (
            <div className="pat-next">
              <ProfilePhoto userId={next.doctorUserId} name={next.doctor} version={next.doctorImageVersion} size={56} alt="" />
              <div className="pat-next-copy">
                <strong>{next.doctor}</strong>
                <span>{next.specialty}</span>
                <span className={`pat-pill pat-pill-${statusTone(next.status)}`}>{appointmentStatusLabel(next.status)}</span>
                <span>
                  {shortDay(next.startsAt)} · {shortTime(next.startsAt)}
                </span>
              </div>
              <div className="pat-next-links">
                <Link className="pat-details" href={`/patient/appointments/${next.id}`}>
                  View Details
                </Link>
              </div>
            </div>
          )}
          {next && unpaid[0] ? (
            <OpenPayment doctor={unpaid[0].doctor} href={resumePaymentHref(unpaid[0])} expiresAt={unpaid[0].paymentHoldExpiresAt?.toISOString() ?? null} />
          ) : appointments.ok && next && appointments.pending.length > 0 ? (
            <p className="pat-empty"><Link href="/patient/appointments?view=pending">A booking is still waiting for the doctor under Pending.</Link></p>
          ) : null}
        </article>
        <article className="pat-card pat-card-actions">
          <header className="pat-card-head">
            <h2>Quick Actions</h2>
          </header>
          <ul className="pat-actions">
            <Action href="/patient/find" icon="calendarPlus" label="Book an Appointment" short="Book" />
            <Action href="/patient/appointments" icon="calendar" label="View My Appointments" short="Visits" />
            <Action href="/patient/summaries" icon="notes" label="View Clinical Summaries" short="Records" />
            <Action href="/patient/profile" icon="user" label="Manage Profile" short="Profile" />
          </ul>
        </article>
      </section>
    </div>
  );
}

function Stat({
  href,
  icon,
  tone,
  label,
  value,
  note,
}: {
  href: string;
  icon: PatientHomeIconName;
  tone: string;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <Link className={`pat-stat pat-stat-${tone}`} href={href}>
      <span className="pat-stat-icon">
        <PatientHomeIcon name={icon} />
      </span>
      <span className="pat-stat-copy">
        <span className="pat-stat-label">{label}</span>
        <strong>{value}</strong>
        <span className="pat-stat-note">{note}</span>
      </span>
      <span className="pat-stat-go">
        <PatientHomeIcon name="chevron" />
      </span>
      <span className="pat-stat-all">View all</span>
    </Link>
  );
}

function OpenPayment({ doctor, href, expiresAt }: { doctor: string; href: string; expiresAt: string | null }) {
  return (
    <div className="pat-pay-note">
      <p className="pat-empty">Payment is still open for {doctor}.</p>
      <Link className="pat-continue" href={href}>Continue payment</Link>
      {expiresAt ? <ReleaseWhenHoldEnds expiresAt={expiresAt} /> : null}
    </div>
  );
}

function Action({ href, icon, label, short }: { href: string; icon: PatientHomeIconName; label: string; short: string }) {
  return (
    <li>
      <Link className="pat-action" href={href}>
        <span className="pat-action-icon">
          <PatientHomeIcon name={icon} />
        </span>
        <span className="pat-action-label">{label}</span>
        <span className="pat-action-short">{short}</span>
        <PatientHomeIcon name="chevron" />
      </Link>
    </li>
  );
}

function shortDay(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Africa/Freetown" }).format(value);
}

function shortTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Africa/Freetown" }).format(value);
}

function statusTone(status: string) {
  if (status === "COMPLETED" || status === "CONFIRMED") return "done";
  if (status === "IN_PROGRESS" || status === "CHECKED_IN") return "live";
  if (status === "PENDING_PAYMENT" || status === "PENDING_APPROVAL" || status === "EXPIRED_UNPAID") return "wait";
  if (status.startsWith("CANCELLED") || status === "NO_SHOW") return "stop";
  return "next";
}
