import type { Metadata } from "next";
import Link from "next/link";
import { LiveQueryForm } from "@/components/live-query";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ClinicPracticeNote, RestrictedPractice } from "@/components/doctor/restricted";
import { StatusBadge } from "@/components/status-badge";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { clampPage } from "@/lib/doctor/present";
import { searchAssignedPatients } from "@/lib/doctor/workspace";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Patient records" };
export const dynamic = "force-dynamic";

export default async function DoctorPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const portal = await requireClinicalPortal();
  if (portal.staff) return <ClinicPracticeNote />;
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (portal.access !== "ready" || !portal.doctor) return <RestrictedPractice access={portal.access} />;
  const query = await searchParams;
  const q = (query.q ?? "").trim();
  const activeOnly = query.status === "active";
  const result = await searchAssignedPatients(prisma, { userId: portal.user.id, q, page: clampPage(query.page, 10_000), activeOnly });
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const page = Math.min(result.page, result.pages);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_320px]">
      <section className="rounded-2xl border border-[#d7e3ee] bg-white p-4 sm:p-5">
        <header>
          <h1 className="text-2xl font-semibold text-[#0C2B45]">Patient Records</h1>
          <p className="mt-1 text-sm text-[#5b6b7c]">Patients with an appointment assigned to you. Opening a chart is recorded.</p>
        </header>
        <LiveQueryForm
          pathname="/doctor/patients"
          className="mt-4 flex flex-wrap gap-2"
          fields={[
            { name: "q", label: "Search by name or patient ID", kind: "text", value: q, placeholder: "Search patients by name or ID…", labelClassName: "min-w-[220px] flex-1 text-sm", inputClassName: "h-11 w-full rounded-lg border border-[#d7e3ee] px-3", srOnly: true },
            { name: "status", label: "Status", kind: "select", value: activeOnly ? "active" : "all", labelClassName: "text-sm", inputClassName: "h-11 rounded-lg border border-[#d7e3ee] bg-white px-3", srOnly: true, options: [{ value: "all", label: "All patients" }, { value: "active", label: "Active" }] },
          ]}
        />
        {result.patients.length === 0 ? (
          <p className="mt-6 text-sm leading-6 text-[#5b6b7c]">{q ? "No assigned patient matches that search." : "Patients appear here after an appointment is assigned to you."}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="phone-table w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs tracking-wide text-[#5b6b7c] uppercase">
                <tr>
                  <th className="px-2 py-2 font-medium">Patient</th>
                  <th className="px-2 py-2 font-medium">Details</th>
                  <th className="px-2 py-2 font-medium">Last visit</th>
                  <th className="px-2 py-2 font-medium">Next visit</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.patients.map((patient) => (
                  <tr key={patient.id} className="border-t border-[#e6eef5]">
                    <td className="px-2 py-3" data-label="Patient">
                      <Link className="flex items-center gap-3 font-semibold text-[#0C2B45]" href={`/doctor/patients/${patient.id}`}>
                        <ProfilePhoto userId={patient.userId} name={patient.fullName} version={patient.imageVersion} size={36} alt="" />
                        {patient.fullName}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-[#5b6b7c]" data-label="Details">{patient.line}</td>
                    <td className="px-2 py-3" data-label="Last visit">{patient.lastVisit ?? "—"}</td>
                    <td className="px-2 py-3" data-label="Next visit">{patient.nextVisit ?? "—"}</td>
                    <td className="px-2 py-3" data-label="Status"><StatusBadge tone={patient.status === "Active" ? "teal" : "slate"}>{patient.status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Patient pages">
            <Link className={page > 1 ? "font-semibold text-[#0F766E]" : "pointer-events-none text-[#9aa8b5]"} href={patientHref(q, activeOnly, page - 1)} aria-disabled={page <= 1}>Previous</Link>
            <p>Page {page} of {result.pages}</p>
            <Link className={page < result.pages ? "font-semibold text-[#0F766E]" : "pointer-events-none text-[#9aa8b5]"} href={patientHref(q, activeOnly, page + 1)} aria-disabled={page >= result.pages}>Next</Link>
          </nav>
        ) : null}
      </section>
      <aside className="rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm leading-6 text-[#5b6b7c]">
        <h2 className="text-lg font-semibold text-[#0C2B45]">What this list includes</h2>
        <p className="mt-2">Only patients who already have an appointment with you. A guessed patient ID does not open a chart.</p>
        <p className="mt-2">Clinical note text stays on the consultation record and is not shown in this list.</p>
      </aside>
    </div>
  );
}

function patientHref(q: string, activeOnly: boolean, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (activeOnly) params.set("status", "active");
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/doctor/patients?${text}` : "/doctor/patients";
}
