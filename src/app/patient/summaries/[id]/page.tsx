import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { readPageSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { loadReleasedSummary } from "@/lib/patient/portal";
import { DownloadSummary } from "./download-summary";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Clinical summary" };
}

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const user = await readPageSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (!user) return <RecordsUnavailable code="UNAVAILABLE" />;
  const result = await loadReleasedSummary(prisma, { id, userId: user.id });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const summary = result.summary;
  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm text-brand-teal">{summary.specialty}</p>
        <h1 className="mt-2 text-3xl font-semibold text-brand-navy">{summary.service}</h1>
        <p className="mt-2 text-sm text-brand-muted">{summary.patientName} · {summary.doctor} · Visit {summary.when} · Released {summary.releasedWhen}</p>
      </header>
      <article className="rounded-2xl border border-brand-line bg-white p-5 text-sm leading-7 whitespace-pre-wrap text-brand-ink">{summary.body}</article>
      <DownloadSummary filename={`carecircle-summary-${summary.appointmentId}.txt`} body={summary.body} />
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold text-brand-navy">Documents released with this summary</h2>
        {summary.files.length === 0 ? (
          <p className="text-sm text-brand-muted">No document was released with this summary.</p>
        ) : (
          <ul className="grid gap-2">
            {summary.files.map((file) => (
              <li key={file.id}>
                <a className="text-sm font-semibold text-brand-teal" href={`/api/clinical-files/${file.id}`}>{file.name}</a>
                <p className="text-sm text-brand-muted">{file.mimeType} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap gap-4">
        <Link className="text-sm font-semibold text-brand-teal" href={`/patient/appointments/${summary.appointmentId}`}>View the appointment</Link>
        <Link className="text-sm font-semibold text-brand-teal" href="/patient/find">Book a follow-up</Link>
      </div>
    </div>
  );
}
