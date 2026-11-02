import type { Metadata } from "next";
import Link from "next/link";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge } from "@/components/status-badge";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { listDoctorNotifications } from "@/lib/doctor/workspace";
import { prisma } from "@/lib/db/prisma";
import { MarkViewedNotifications } from "@/components/notifications/mark-viewed";
import { ClearNotificationsForm, MarkReadForm } from "./mark-read-form";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function DoctorNotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const filter = (await searchParams).filter === "unread" ? "unread" : "all";
  const result = await listDoctorNotifications(prisma, user.id, filter === "unread");
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const viewedIds = result.notifications.filter((note) => !note.read && note.channel === "IN_APP").map((note) => note.id);
  return (
    <div className="grid gap-4">
      <MarkViewedNotifications ids={viewedIds} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#0C2B45]">Notifications</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#5b6b7c]">
            {result.unread} unread in-app message{result.unread === 1 ? "" : "s"}. Previews do not include clinical note text. Optional appointment reminders follow the patient&apos;s email choice. Security emails cannot be turned off.
          </p>
        </div>
        {result.notifications.length > 0 ? <ClearNotificationsForm /> : null}
      </header>
      <nav className="flex gap-2" aria-label="Notification filters">
        <Link className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === "all" ? "bg-[#e7f4f2] text-[#0F766E]" : "text-[#5b6b7c]"}`} href="/doctor/notifications">All</Link>
        <Link className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === "unread" ? "bg-[#e7f4f2] text-[#0F766E]" : "text-[#5b6b7c]"}`} href="/doctor/notifications?filter=unread">Unread</Link>
      </nav>
      {result.notifications.length === 0 ? (
        <p className="rounded-2xl border border-[#d7e3ee] bg-white p-5 text-sm text-[#5b6b7c]">You have no notifications.</p>
      ) : (
        <ul className="grid gap-3">
          {result.notifications.map((note) => (
            <li key={note.id} className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold text-[#0C2B45]">{note.title}</h2>
                <StatusBadge tone={note.read ? "slate" : note.status === "FAILED" ? "red" : "teal"}>{note.read ? "Read" : note.status === "FAILED" ? "Not delivered" : "Unread"}</StatusBadge>
              </div>
              {note.preview ? <p className="mt-2 text-sm leading-6">{note.preview}</p> : null}
              <p className="mt-2 text-sm text-[#5b6b7c]">{note.when} · {note.channel === "EMAIL" ? "Email" : note.channel === "SMS" ? "SMS" : "In app"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                {note.href ? <Link className="text-sm font-semibold text-[#0F766E]" href={note.href}>{note.href === "/doctor/profile" ? "View assigned service" : "Open appointment"}</Link> : null}
                {note.read || note.channel !== "IN_APP" ? null : <MarkReadForm notificationId={note.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
