import type { Metadata } from "next";
import Link from "next/link";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { StatusBadge } from "@/components/status-badge";
import { appointmentStatusLabel, appointmentStatusTone } from "@/lib/admin/labels";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { parseFollowUpView, type FollowUpView } from "@/lib/doctor/present";
import { listDoctorFollowUps, loadFollowUpFormData } from "@/lib/doctor/workspace";
import { prisma } from "@/lib/db/prisma";
import { FollowUpForm } from "./follow-up-form";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

const views: Array<{ id: FollowUpView; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "today", label: "Due today" },
  { id: "overdue", label: "Overdue" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ view?: string; source?: string }> }) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const query = await searchParams;
  const view = parseFollowUpView(query.view);
  const [result, form] = await Promise.all([
    listDoctorFollowUps(prisma, { userId: portal.user.id, view, clinicWide: portal.staff }),
    loadFollowUpFormData(prisma, portal.user.id, portal.staff ? { clinicWide: true } : undefined),
  ]);
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  if (!form.ok) return <RecordsUnavailable code={form.code} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_340px]">
      <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h1 className="text-2xl font-semibold text-[#0C2B45]">Follow-ups & Consultation Status</h1>
        <p className="mt-1 text-sm text-[#5b6b7c]">Follow-ups are appointments linked to an earlier visit, or booked on a follow-up service.</p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Follow-up views">
          {views.map((item) => (
            <Link key={item.id} href={`/doctor/follow-ups?view=${item.id}`} aria-current={view === item.id ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === item.id ? "bg-[#e7f4f2] text-[#0F766E]" : "text-[#5b6b7c]"}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        {result.rows.length === 0 ? (
          <p className="mt-6 text-sm text-[#5b6b7c]">No follow-up is in this view.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="phone-table w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs tracking-wide text-[#5b6b7c] uppercase">
                <tr>
                  <th className="px-2 py-2 font-medium">Patient</th>
                  <th className="px-2 py-2 font-medium">Last visit</th>
                  <th className="px-2 py-2 font-medium">Next follow-up</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#e6eef5]">
                    <td className="px-2 py-3" data-label="Patient">
                      <Link className="flex items-center gap-2 font-semibold text-[#0C2B45]" href={`/doctor/patients/${row.patientId}`}>
                        <ProfilePhoto userId={row.patientUserId} name={row.patient} version={row.patientImageVersion} size={32} alt="" />
                        {row.patient}
                      </Link>
                    </td>
                    <td className="px-2 py-3" data-label="Last visit">{row.lastVisit ?? row.sourceService ?? "—"}</td>
                    <td className="px-2 py-3" data-label="Next follow-up">{row.when}<div className="text-xs text-[#5b6b7c]">{row.service}</div></td>
                    <td className="px-2 py-3" data-label="Status"><StatusBadge tone={appointmentStatusTone(row.status)}>{appointmentStatusLabel(row.status)}</StatusBadge></td>
                    <td className="px-2 py-3" data-label="Actions">
                      <Link className="font-semibold text-[#0F766E]" href={`/doctor/appointments/${row.id}`}>View</Link>
                      {row.sourceId ? <Link className="ml-3 font-semibold text-[#0F766E]" href={`/doctor/appointments/${row.sourceId}/record`}>Notes</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <FollowUpForm offerings={form.offerings} sources={form.sources} locations={form.locations} sourceId={query.source} />
    </div>
  );
}
