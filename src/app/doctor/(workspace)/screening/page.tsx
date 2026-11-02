import type { Metadata } from "next";
import Link from "next/link";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ClinicPracticeNote, RestrictedPractice } from "@/components/doctor/restricted";
import { ProfilePhoto } from "@/components/profile-photo";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { formatPlatformWhen } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { listDoctorAssessments } from "@/lib/screening/service";

export const metadata: Metadata = { title: "Screening assessments" };
export const dynamic = "force-dynamic";

export default async function DoctorScreeningPage() {
  const portal = await requireClinicalPortal();
  if (portal.staff) return <ClinicPracticeNote />;
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (portal.access !== "ready" || !portal.doctor) return <RestrictedPractice access={portal.access} />;
  const result = await listDoctorAssessments(prisma, portal.doctor.id);
  if (!result.ok) return <RecordsUnavailable code={result.code === "SCHEMA" ? "SCHEMA" : "UNAVAILABLE"} />;

  return (
    <section className="grid gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#0C2B45]">Screening assessments</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#5b6b7c]">
          Submitted screens for patients you already have an appointment with. A score is not a diagnosis, and it is not released to the patient as a clinical summary.
        </p>
      </header>
      {result.rows.length === 0 ? (
        <p className="rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm text-[#5b6b7c]">No submitted assessment is available for your patients.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#d7e3ee] bg-white">
          <table className="phone-table w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs tracking-wide text-[#5b6b7c] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Screening</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Review</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-[#e6eef5]">
                  <td className="px-4 py-3" data-label="Patient">
                    <span className="flex items-center gap-2 font-semibold text-[#0C2B45]">
                      <ProfilePhoto userId={row.patient.userId} name={row.patient.fullName} version={row.patient.user.profileImageUpdatedAt?.toISOString() ?? null} size={32} alt="" />
                      {row.patient.fullName}
                    </span>
                  </td>
                  <td className="px-4 py-3" data-label="Screening">{row.version.tool.abbreviation}</td>
                  <td className="px-4 py-3" data-label="Completed">{row.submittedAt ? formatPlatformWhen(row.submittedAt) : "—"}</td>
                  <td className="px-4 py-3" data-label="Score">{row.result ? `${row.result.score}/${row.result.maxScore} · ${row.result.band}` : "—"}</td>
                  <td className="px-4 py-3" data-label="Review">{row.reviews.length > 0 ? "Reviewed" : "Pending"}</td>
                  <td className="px-4 py-3" data-label="Actions"><Link className="font-semibold text-[#0F766E]" href={`/doctor/screening/${row.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
