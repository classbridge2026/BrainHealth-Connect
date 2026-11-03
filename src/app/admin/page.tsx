import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { AdminIcon, type AdminIconName } from "@/components/admin/admin-icons";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { getSystemName } from "@/lib/brand/system-name";
import { loadHomeDashboard } from "@/lib/admin/home-dashboard";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const readHomeDashboard = unstable_cache(
  async (actorId: string) => {
    const home = await loadHomeDashboard(prisma, actorId);
    if (!home.ok) throw new Error(home.code);
    return home;
  },
  ["admin-home-dashboard"],
  { revalidate: 30 },
);

export default async function AdminDashboardPage() {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const [home, systemName] = await Promise.all([
    readHomeDashboard(actor.id).catch((error: unknown) => {
      const code = error instanceof Error && error.message === "SCHEMA" ? "SCHEMA" : "UNAVAILABLE";
      return { ok: false as const, code: code as "SCHEMA" | "UNAVAILABLE" };
    }),
    getSystemName(),
  ]);
  if (!home.ok) return <RecordsUnavailable code={home.code} />;
  const specialtyMax = Math.max(1, ...home.specialties.map((row) => row.count));
  return (
    <main className="home-dash">
      <header className="home-lead">
        <div>
          <h1>Admin Dashboard</h1>
          <p>Welcome back, {home.name}.</p>
        </div>
        <p className="home-date">
          <AdminIcon name="calendar" />
          {home.dateLabel}
        </p>
      </header>
      <section className="home-stats" aria-label="Platform totals">
        <Stat href="/admin/doctors" icon="user" tone="blue" label="Total Doctors" value={home.doctors.total} note={`${home.doctors.approved} approved · ${home.doctors.pending} pending`} />
        <Stat href="/admin/patients" icon="users" tone="green" label="Total Patients" value={home.patients.total} note={home.patients.thisWeek === 0 ? "None new this week" : `+${home.patients.thisWeek} this week`} />
        <Stat href="/admin/appointments?when=today" icon="calendar" tone="sky" label="Today's Appointments" value={home.today.total} note={`${home.today.confirmed} confirmed · ${home.today.pending} pending`} />
        <Stat href="/admin/services?status=ACTIVE" icon="specialty" tone="violet" label="Active Services" value={home.services.active} note={home.services.inactive === 0 ? "None inactive" : `${home.services.inactive} inactive`} />
        <Stat href="/admin/locations" icon="location" tone="amber" label="Locations" value={home.locations.total} note={home.locations.inactive === 0 ? "None inactive" : `${home.locations.inactive} inactive`} />
      </section>
      <section className="home-mid">
        <article className="home-card home-card-trend">
          <header className="home-card-head">
            <h2>
              <AdminIcon name="calendar" />
              Appointments Trend
            </h2>
            <p>Last 7 days</p>
          </header>
          <TrendChart points={home.trend} />
        </article>
        <article className="home-card home-card-status">
          <header className="home-card-head">
            <div className="home-card-intro">
              <h2>
                <AdminIcon name="pie" />
                Appointment Status
              </h2>
              <p>All appointments</p>
            </div>
          </header>
          <div className="home-status">
            <Donut total={home.appointmentTotal} slices={home.statuses} />
            <ul className="home-legend">
              {home.statuses.map((slice) => (
                <li key={slice.key}>
                  <span className="home-dot" style={{ background: slice.color }} />
                  <strong>{slice.label}</strong>
                  <span className="home-legend-count">
                    {slice.count} ({home.appointmentTotal === 0 ? "0%" : `${((slice.count / home.appointmentTotal) * 100).toFixed(1)}%`})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </article>
        <article className="home-card home-card-activity">
          <header className="home-card-head">
            <h2>
              <AdminIcon name="clock" />
              Recent Activities
            </h2>
            <Link href="/admin/audit">View all</Link>
          </header>
          {home.activities.length === 0 ? (
            <p className="home-empty">No administrative activity has been recorded.</p>
          ) : (
            <ul className="home-feed">
              {home.activities.map((item) => (
                <li key={item.id}>
                  <span className="home-feed-icon">
                    <AdminIcon name={item.icon} />
                  </span>
                  <span className="home-feed-copy">
                    {item.href ? <Link href={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}
                    <span>{item.detail}</span>
                  </span>
                  <time>{item.when}</time>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
      <section className="home-bottom">
        <article className="home-card home-card-approvals">
          <header className="home-card-head">
            <h2>
              <AdminIcon name="shieldCheck" />
              Pending Approvals
            </h2>
            <Link href="/admin/doctors/pending">View all</Link>
          </header>
          {home.approvals.length === 0 ? (
            <p className="home-empty">No doctors are waiting for verification.</p>
          ) : (
            <div className="home-table-wrap">
              <table className="home-approvals">
                <caption className="sr-only">Doctors waiting for verification</caption>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Details</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {home.approvals.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Type">Doctor</td>
                      <td data-label="Name">{row.name}</td>
                      <td data-label="Details">{row.details}</td>
                      <td data-label="Submitted">{row.submitted}</td>
                      <td data-label="Action">
                        <Link className="home-review" href={`/admin/doctors?view=${row.id}`}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
        <article className="home-card home-card-specialties">
          <header className="home-card-head">
            <h2>
              <AdminIcon name="specialty" />
              Top Specialties
            </h2>
            <p>By appointment count</p>
          </header>
          {home.specialties.length === 0 ? (
            <p className="home-empty">No appointments are stored yet.</p>
          ) : (
            <ul className="home-bars">
              {home.specialties.map((row) => (
                <li key={row.id}>
                  <div>
                    <span>{row.name}</span>
                    <strong>{row.count}</strong>
                  </div>
                  <div className="home-bar" role="img" aria-label={`${row.name}: ${row.count} appointments`}>
                    <span style={{ width: `${Math.max(6, Math.round((row.count / specialtyMax) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="home-card home-card-actions">
          <header className="home-card-head">
            <h2>
              <AdminIcon name="bolt" />
              Quick Actions
            </h2>
          </header>
          <ul className="home-actions">
            <Action href="/admin/doctors/new" icon="doctor" label="Add New Doctor" detail="Register and verify a doctor" />
            <Action href="/admin/users" icon="users" label="Add New Patient" detail="Create a patient account" />
            <Action href="/admin/services" icon="specialty" label="Manage Services" detail="Update services and pricing" />
            <Action href="/admin/reports" icon="reports" label="View Reports" detail="Counts for a chosen date range" />
          </ul>
        </article>
      </section>
      <footer className="home-foot">
        <span>
          {systemName} © {home.year}. All rights reserved.
        </span>
        <span>Your care. Your privacy. Your journey.</span>
      </footer>
    </main>
  );
}

function Stat({ href, icon, tone, label, value, note }: { href: string; icon: AdminIconName; tone: string; label: string; value: number; note: string }) {
  return (
    <Link className={`home-stat home-stat-${tone}`} href={href}>
      <span className="home-stat-icon">
        <AdminIcon name={icon} />
      </span>
      <span className="home-stat-copy">
        <span className="home-stat-label">{label}</span>
        <strong>{value}</strong>
        <span className="home-stat-note">{note}</span>
      </span>
      <AdminIcon name="chevronRight" className="home-stat-go" />
    </Link>
  );
}

function Action({ href, icon, label, detail }: { href: string; icon: AdminIconName; label: string; detail: string }) {
  return (
    <li>
      <Link href={href}>
        <span className="home-action-icon">
          <AdminIcon name={icon} />
        </span>
        <span className="home-action-copy">
          <strong>{label}</strong>
          <span>{detail}</span>
        </span>
        <AdminIcon name="chevronRight" />
      </Link>
    </li>
  );
}

function Donut({ total, slices }: { total: number; slices: Array<{ key: string; color: string; count: number }> }) {
  const painted = slices.filter((slice) => slice.count > 0);
  let cursor = 0;
  const gradient =
    total === 0 || painted.length === 0
      ? "#e7eef5"
      : `conic-gradient(${painted
          .map((slice) => {
            const start = cursor;
            cursor += (slice.count / total) * 100;
            return `${slice.color} ${start}% ${cursor}%`;
          })
          .join(", ")})`;
  return (
    <div className="home-donut" style={{ background: gradient }} role="img" aria-label={`${total} appointments`}>
      <div>
        <strong>{total}</strong>
        <span>Total</span>
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: Array<{ label: string; count: number }> }) {
  const width = 560;
  const height = 210;
  const pad = { left: 32, right: 12, top: 16, bottom: 28 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((point) => point.count));
  const coords = points.map((point, index) => {
    const x = pad.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
    const y = pad.top + innerH - (point.count / max) * innerH;
    return { ...point, x, y };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${coords[0]?.x ?? pad.left},${pad.top + innerH} ${line} ${coords.at(-1)?.x ?? pad.left},${pad.top + innerH}`;
  const ticks = [0, Math.round(max / 2), max].filter((value, index, all) => all.indexOf(value) === index);
  const summary = points.map((point) => `${point.label}: ${point.count}`).join(", ");
  return (
    <svg className="home-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Appointments over the last 7 days. ${summary}`}>
      {ticks.map((tick) => {
        const y = pad.top + innerH - (tick / max) * innerH;
        return (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
            <text x={pad.left - 8} y={y + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        );
      })}
      <polygon points={area} />
      <polyline points={line} />
      {coords.map((point) => (
        <g key={point.label}>
          <circle cx={point.x} cy={point.y} r="4" />
          <text x={point.x} y={height - 8} textAnchor="middle">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
