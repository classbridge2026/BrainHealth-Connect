import type { Metadata } from "next";
import Link from "next/link";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge } from "@/components/status-badge";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { appointmentStatusLabel, appointmentStatusTone } from "@/lib/admin/labels";
import { ReleaseWhenHoldEnds } from "@/components/patient/release-hold";
import { listPatientAppointments, resumePaymentHref } from "@/lib/appointments/queries";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "My appointments" };
export const dynamic = "force-dynamic";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "pending", label: "Pending" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

function isCancelled(status: string) {
  return status.startsWith("CANCELLED") || status === "EXPIRED_UNPAID" || status === "RESCHEDULED";
}

export default async function PatientAppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const query = await searchParams;
  const view = tabs.some((tab) => tab.id === query.view) ? query.view : "upcoming";
  const result = await listPatientAppointments(prisma, user.id);
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const all = [...result.upcoming, ...result.pending, ...result.history];
  const unpaid = result.pending.filter((row) => row.status === "PENDING_PAYMENT");
  const rows = view === "cancelled"
    ? result.history.filter((row) => isCancelled(row.status))
    : view === "past"
      ? result.history.filter((row) => !isCancelled(row.status))
      : view === "pending"
        ? [...result.pending].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        : [...result.upcoming].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#0C2B45]">My Appointments</h1>
          <p className="mt-1 text-sm text-[#5b6b7c]">View and manage your appointments. Times use Africa/Freetown (GMT).</p>
        </div>
        <Link className="inline-flex h-11 items-center rounded-lg bg-[#0F766E] px-4 text-sm font-semibold text-white" href="/patient/find">Book appointment</Link>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Appointment views">
        {tabs.map((tab) => (
          <Link key={tab.id} href={tab.id === "upcoming" ? "/patient/appointments" : `/patient/appointments?view=${tab.id}`} aria-current={view === tab.id ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === tab.id ? "bg-[#0F766E] text-white" : "bg-white text-[#0C2B45]"}`}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {unpaid.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f3d7a1] bg-[#fff8eb] p-4">
          <p className="text-sm text-[#0C2B45]">You left a payment unfinished. The visit stays held until the countdown ends.</p>
          <Link className="inline-flex h-11 items-center rounded-lg border-2 border-[#083f3b] bg-[#0F766E] px-4 text-sm font-semibold text-white" href={resumePaymentHref(unpaid[0])}>Continue payment</Link>
          {unpaid[0].paymentHoldExpiresAt ? <ReleaseWhenHoldEnds expiresAt={unpaid[0].paymentHoldExpiresAt.toISOString()} /> : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm text-[#5b6b7c]">{view === "upcoming" ? "You have no upcoming appointments." : view === "pending" ? "You have no bookings waiting for payment." : "Nothing is stored in this view."}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#d7e3ee] bg-white">
          <table className="phone-table w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs tracking-wide text-[#5b6b7c] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Date & time</th>
                <th className="px-4 py-3 font-medium">Doctor</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#e6eef5]">
                  <td className="px-4 py-3" data-label="When">{row.when}</td>
                  <td className="px-4 py-3" data-label="Doctor">
                    <span className="flex items-center gap-2">
                      <ProfilePhoto userId={row.doctorUserId} name={row.doctor} version={row.doctorImageVersion} size={32} alt="" />
                      {row.doctor}
                    </span>
                  </td>
                  <td className="px-4 py-3" data-label="Type">{row.service}<div className="text-xs text-[#5b6b7c]">{row.specialty} · {row.mode === "ONLINE" ? "Online" : "In person"} · {row.fee}</div></td>
                  <td className="px-4 py-3" data-label="Status"><StatusBadge tone={appointmentStatusTone(row.status)}>{appointmentStatusLabel(row.status)}</StatusBadge></td>
                  <td className="px-4 py-3" data-label="Actions">
                    {row.status === "PENDING_PAYMENT" ? (
                      <Link className="font-semibold text-[#0F766E]" href={resumePaymentHref(row)}>Continue payment</Link>
                    ) : (
                      <Link className="font-semibold text-[#0F766E]" href={`/patient/appointments/${row.id}`}>View</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sr-only">{all.length} appointments loaded for this account.</p>
        </div>
      )}
    </div>
  );
}
