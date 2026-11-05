import type { Metadata } from "next";
import Link from "next/link";
import { LiveQueryForm } from "@/components/live-query";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { StatusBadge } from "@/components/status-badge";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { clampPage, parseNoteTab, type NoteTab } from "@/lib/doctor/present";
import { listDoctorNotes } from "@/lib/doctor/workspace";
import { prisma } from "@/lib/db/prisma";
import { PortalNoteForm } from "./note-form";

export const metadata: Metadata = { title: "Notes and summaries" };
export const dynamic = "force-dynamic";

const tabs: Array<{ id: NoteTab; label: string }> = [
  { id: "private", label: "Private notes" },
  { id: "drafts", label: "Draft summaries" },
  { id: "released", label: "Released summaries" },
  { id: "pending", label: "Awaiting release" },
];

function releaseLabel(release: string) {
  if (release === "RELEASED") return "Released";
  if (release === "WITHDRAWN") return "Withdrawn";
  return "Private";
}

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const query = await searchParams;
  const tab = parseNoteTab(query.tab);
  const q = (query.q ?? "").trim();
  const result = await listDoctorNotes(prisma, { userId: portal.user.id, tab, q, page: clampPage(query.page, 10_000), clinicWide: portal.staff });
  if (!result.ok) return <RecordsUnavailable code={result.code} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px]">
      <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h1 className="text-2xl font-semibold text-[#0C2B45]">Private Notes & Summaries</h1>
        <p className="mt-1 text-sm text-[#5b6b7c]">Working notes stay on your record. A summary is visible to the patient only after you release it.</p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Note filters">
          {tabs.map((item) => (
            <Link key={item.id} href={noteHref(item.id, q, 1)} aria-current={tab === item.id ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === item.id ? "bg-[#e7f4f2] text-[#0F766E]" : "text-[#5b6b7c]"}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <LiveQueryForm
          pathname="/doctor/notes"
          className="mt-4 flex flex-wrap gap-2"
          fields={[{ name: "q", label: "Search by patient", kind: "text", value: q, placeholder: "Search notes…", labelClassName: "min-w-[200px] flex-1 text-sm", inputClassName: "h-11 w-full rounded-lg border border-[#d7e3ee] px-3", srOnly: true }]}
        />
        {result.notes.length === 0 ? (
          <p className="mt-6 text-sm text-[#5b6b7c]">{q ? "No note matches that patient." : "No notes are stored in this view."}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="phone-table w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs tracking-wide text-[#5b6b7c] uppercase">
                <tr>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Patient</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.notes.map((note) => (
                  <tr key={note.id} className="border-t border-[#e6eef5]">
                    <td className="px-2 py-3" data-label="Date">{note.when}</td>
                    <td className="px-2 py-3" data-label="Patient"><Link className="font-semibold text-[#0C2B45]" href={`/doctor/patients/${note.patientId}`}>{note.patient}</Link></td>
                    <td className="px-2 py-3" data-label="Type">{note.kind}</td>
                    <td className="px-2 py-3" data-label="Status">
                      <StatusBadge tone={note.state === "FINALIZED" ? "navy" : "slate"}>{note.state === "FINALIZED" ? "Finalized" : "Draft"}</StatusBadge>
                      <StatusBadge tone={note.release === "RELEASED" ? "teal" : "slate"}>{releaseLabel(note.release)}</StatusBadge>
                      <Link className="ml-3 font-semibold text-[#0F766E]" href={`/doctor/appointments/${note.appointmentId}/record`}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.pages > 1 ? (
          <nav className="mt-4 flex justify-between text-sm" aria-label="Note pages">
            <Link className={result.page > 1 ? "font-semibold text-[#0F766E]" : "pointer-events-none text-[#9aa8b5]"} href={noteHref(tab, q, result.page - 1)}>Previous</Link>
            <span>Page {result.page} of {result.pages}</span>
            <Link className={result.page < result.pages ? "font-semibold text-[#0F766E]" : "pointer-events-none text-[#9aa8b5]"} href={noteHref(tab, q, result.page + 1)}>Next</Link>
          </nav>
        ) : null}
      </section>
      <section className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#0C2B45]">Create new note</h2>
        <div className="mt-3">
          <PortalNoteForm visits={result.visits} />
        </div>
      </section>
    </div>
  );
}

function noteHref(tab: NoteTab, q: string, page: number) {
  const params = new URLSearchParams({ tab });
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  return `/doctor/notes?${params.toString()}`;
}
