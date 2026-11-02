import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ClinicPracticeNote, RestrictedPractice } from "@/components/doctor/restricted";
import { ProfilePhoto } from "@/components/profile-photo";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { formatPlatformWhen } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { readDoctorAssessment } from "@/lib/screening/service";
import { textAreaClass, primaryButtonClass, secondaryButtonClass } from "@/components/form-classes";
import { amendScreeningAction, reviewScreeningAction } from "../actions";

export const metadata: Metadata = { title: "Screening assessment" };
export const dynamic = "force-dynamic";

const reviewNotices: Record<string, string> = {
  INVALID: "Write a shorter interpretation before saving. The answers and score were not changed.",
  NOT_FOUND: "This assessment is not available for your patients.",
  UNAVAILABLE: "The review could not be saved.",
};

export default async function DoctorScreeningDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const portal = await requireClinicalPortal();
  if (portal.staff) return <ClinicPracticeNote />;
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (portal.access !== "ready" || !portal.doctor) return <RestrictedPractice access={portal.access} />;
  const { id } = await params;
  const query = await searchParams;
  const result = await readDoctorAssessment(prisma, { actorUserId: portal.user.id, doctorProfileId: portal.doctor.id, assessmentId: id });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code === "SCHEMA" ? "SCHEMA" : "UNAVAILABLE"} />;
  }
  const row = result.assessment;
  const reviewed = row.reviews.length > 0;

  return (
    <div className="grid gap-4">
      <Link className="text-sm font-semibold text-[#0F766E]" href="/doctor/screening">Back to assessments</Link>
      <header className="flex items-center gap-3">
        <ProfilePhoto userId={row.patient.user.id} name={row.patient.fullName} version={row.patient.user.profileImageUpdatedAt?.toISOString() ?? null} size={56} alt="" />
        <div>
          <h1 className="text-2xl font-semibold text-[#0C2B45]">{row.patient.fullName}</h1>
          <p className="text-sm text-[#5b6b7c]">{row.version.tool.name} · {row.version.tool.abbreviation} · Version {row.version.version}</p>
          <p className="text-sm text-[#5b6b7c]">{row.submittedAt ? formatPlatformWhen(row.submittedAt) : "Completion time not recorded"} · {reviewed ? "Reviewed" : "Pending review"}</p>
        </div>
      </header>
      <section className="grid gap-2 rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm leading-6">
        <h2 className="text-lg font-semibold text-[#0C2B45]">Score summary</h2>
        <p>{row.result ? `${row.result.score} of ${row.result.maxScore}` : "No score is stored."} {row.result ? `· ${row.result.band}` : ""}</p>
        <p>Algorithm {row.result?.algorithmVersion ?? "not recorded"}. This automated band is not a diagnosis and is not a medication recommendation.</p>
        {row.result?.safetyFlag ? <p>A safety item met the approved threshold. Follow the clinic safety protocol. This record does not confirm that a clinician was notified.</p> : null}
      </section>
      <section className="grid gap-3 rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0C2B45]">Question responses</h2>
        <ol className="grid gap-3 text-sm">
          {result.items.map((item, index) => (
            <li key={`${item.prompt}-${index}`}>
              <p className="font-semibold text-[#0C2B45]">{index + 1}. {item.prompt}</p>
              <p className="text-[#3a5560]">{item.answer}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="grid gap-3 rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0C2B45]">Earlier results</h2>
        {result.history.length === 0 ? <p className="text-sm text-[#5b6b7c]">No earlier result is stored for this instrument.</p> : (
          <ul className="grid gap-2 text-sm">
            {result.history.map((entry) => (
              <li key={entry.id}>
                <Link className="font-semibold text-[#0F766E]" href={`/doctor/screening/${entry.id}`}>
                  {entry.submittedAt ? formatPlatformWhen(entry.submittedAt) : "Undated"} · {entry.result ? `${entry.result.score} · ${entry.result.band}` : "No score"}
                </Link>
                <span className="text-[#5b6b7c]"> · Version {entry.version.version} · {entry.comparable ? "Same scoring algorithm" : "Not directly comparable"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-3 rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0C2B45]">Clinical interpretation</h2>
        <p className="text-sm text-[#5b6b7c]">This note stays on the clinician record. It is not released to the patient as a summary.</p>
        {query.notice && reviewNotices[query.notice] ? <p role="alert">{reviewNotices[query.notice]}</p> : null}
        {row.reviews.map((review) => (
          <article key={review.id} className="rounded-xl bg-[#f7fbfa] p-3 text-sm">
            <p className="font-semibold text-[#0C2B45]">{review.doctor.displayName} · {formatPlatformWhen(review.reviewedAt)}</p>
            <p className="mt-1 whitespace-pre-wrap">{review.interpretation}</p>
            {review.followUpNote ? <p className="mt-1 text-[#5b6b7c]">Follow-up: {review.followUpNote}</p> : null}
          </article>
        ))}
        <form action={reviewScreeningAction} className="grid gap-3">
          <input name="assessmentId" type="hidden" value={row.id} />
          <label className="text-sm font-medium text-[#0C2B45]">
            Interpretation
            <textarea name="interpretation" required className={`${textAreaClass} mt-1`} maxLength={2000} placeholder="What this result means for this patient" />
          </label>
          <label className="text-sm font-medium text-[#0C2B45]">
            Follow-up recommendation
            <textarea name="followUp" className={`${textAreaClass} mt-1`} maxLength={1000} placeholder="Optional recommendation" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className={primaryButtonClass} type="submit">Mark as reviewed</button>
            <Link className={secondaryButtonClass} href="/doctor/follow-ups">Arrange a follow-up</Link>
          </div>
        </form>
      </section>
      <section className="grid gap-3 rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0C2B45]">Amendment</h2>
        <p className="text-sm text-[#5b6b7c]">An amendment adds a correction note. It does not change the submitted answers or the score.</p>
        {row.amendments.map((amendment) => (
          <p key={amendment.id} className="text-sm">{formatPlatformWhen(amendment.createdAt)} · {amendment.reason}</p>
        ))}
        <form action={amendScreeningAction} className="grid gap-3">
          <input name="assessmentId" type="hidden" value={row.id} />
          <label className="text-sm font-medium text-[#0C2B45]">
            Reason
            <textarea name="reason" required className={`${textAreaClass} mt-1`} maxLength={500} />
          </label>
          <button className={secondaryButtonClass} type="submit">Record amendment</button>
        </form>
      </section>
    </div>
  );
}
