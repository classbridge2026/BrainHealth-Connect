import type { Metadata } from "next";
import Link from "next/link";
import { CatalogPager, catalogQuery } from "@/components/admin/catalog-ui";
import { AdminIcon, type AdminIconName } from "@/components/admin/admin-icons";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge } from "@/components/status-badge";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadNotifications } from "@/lib/admin/directories";
import { emailProviderConfigured } from "@/lib/auth/delivery";
import { listDeliveryLog } from "@/lib/notifications/admin-log";
import { retryDeliveryAction } from "./actions";
import { adminEntityHref, formatPlatformWhen } from "@/lib/admin/labels";
import { readPage } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/prisma";
import { MarkViewedNotifications } from "@/components/notifications/mark-viewed";
import { ClearNotificationsForm, MarkAllReadForm, MarkReadForm } from "./notification-forms";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

function words(value: string) {
  return value
    .toLowerCase()
    .split(/[._\s]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function channelLabel(channel: string) {
  if (channel === "EMAIL") return "Email";
  if (channel === "SMS") return "Text";
  return "In app";
}

function deliveryTone(status: string): "teal" | "amber" | "red" | "navy" | "slate" {
  if (status === "SENT" || status === "READ") return "teal";
  if (status === "FAILED") return "red";
  if (status === "QUEUED") return "amber";
  if (status === "SUPPRESSED" || status === "CANCELLED") return "navy";
  return "slate";
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const params = await searchParams;
  const page = readPage(params.page);
  const deliveryPage = readPage(typeof params.deliveryPage === "string" ? params.deliveryPage : undefined);
  const [result, deliveries] = await Promise.all([
    loadNotifications(prisma, user.id, page),
    listDeliveryLog(prisma, {
      page: deliveryPage,
      channel: typeof params.channel === "string" ? params.channel : undefined,
      status: typeof params.status === "string" ? params.status : undefined,
      type: typeof params.type === "string" ? params.type : undefined,
    }),
  ]);
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const emailReady = emailProviderConfigured();
  return (
    <main className="users-page">
      <MarkViewedNotifications ids={result.notifications.filter((note) => !note.readAt).map((note) => note.id)} />
      <section className="screen-stats" aria-label="Notification totals">
        <Stat tone="#9a6700" icon="bell" label="Unread" value={result.unread} note="Waiting for you" />
        <Stat tone="#12304a" icon="audit" label="Inbox" value={result.total} note="Your notices" />
        <Stat tone="#1d4ed8" icon="reports" label="Deliveries" value={deliveries.total} note="Clinic channels" />
        <Stat tone={emailReady ? "#0f766e" : "#9b2330"} icon={emailReady ? "check" : "issue"} label="Email" value={emailReady ? "On" : "Off"} note={deliveries.ok ? `${deliveries.failed} failed` : "Log unavailable"} />
      </section>
      <section className="users-card">
        <header className="users-card-head">
          <h2>Inbox</h2>
          <div className="screen-action-row">
            {result.unread > 0 ? <MarkAllReadForm /> : null}
            {result.total > 0 ? <ClearNotificationsForm /> : null}
          </div>
        </header>
        {result.notifications.length === 0 ? (
          <p className="users-empty">You have no notifications.</p>
        ) : (
          <ul className="notice-list">
            {result.notifications.map((note) => {
              const unread = !note.readAt;
              const failed = note.status === "FAILED";
              return (
                <li key={note.id} className={unread ? "notice-row is-unread" : "notice-row"}>
                  <span className="notice-icon" aria-hidden="true">
                    <AdminIcon name={failed ? "issue" : "bell"} />
                  </span>
                  <div className="notice-copy">
                    <p className="notice-title">{note.title}</p>
                    {note.preview ? <p className="notice-preview">{note.preview}</p> : null}
                    <p className="notice-meta">
                      <span>{channelLabel(note.channel)}</span>
                      <span>{words(note.type)}</span>
                      <span>{formatPlatformWhen(new Date(note.createdAt))}</span>
                    </p>
                    {note.entityType === "DoctorProfile" && note.entityId ? (
                      <Link className="notice-link" href={`/admin/doctors/${note.entityId}`}>
                        Review and verify
                      </Link>
                    ) : null}
                    {note.entityType === "Appointment" && note.entityId && adminEntityHref("Appointment", note.entityId) ? (
                      <Link className="notice-link" href={adminEntityHref("Appointment", note.entityId) ?? "/admin/appointments"}>
                        Open the appointment
                      </Link>
                    ) : null}
                    {note.entityType === "Payment" && note.entityId && adminEntityHref("Payment", note.entityId) ? (
                      <Link className="notice-link" href={adminEntityHref("Payment", note.entityId) ?? "/admin/payments"}>
                        Verify the payment
                      </Link>
                    ) : null}
                  </div>
                  <div className="notice-side">
                    <StatusBadge tone={note.readAt ? "slate" : failed ? "red" : "teal"}>{note.readAt ? "Read" : failed ? "Failed" : "Unread"}</StatusBadge>
                    {note.readAt ? null : <MarkReadForm notificationId={note.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {result.total > 0 ? <CatalogPager page={result.page} pageSize={result.pageSize} total={result.total} query={catalogQuery("/admin/notifications", {})} label="notification" /> : null}
      {deliveries.unavailable ? <p className="users-empty">Per-channel attempt history needs the notification migration. It has not been applied.</p> : null}
      {deliveries.ok && !deliveries.unavailable ? (
        <section className="users-card">
          <header className="users-card-head">
            <h2>Delivery log</h2>
            <span className="notice-quiet">{deliveries.total} records</span>
          </header>
          {deliveries.rows.length === 0 ? (
            <p className="users-empty">No deliveries match this view.</p>
          ) : (
            <ul className="notice-list">
              {deliveries.rows.map((row) => {
                const tone = deliveryTone(row.status);
                return (
                  <li key={row.id} className={row.status === "FAILED" ? "notice-row is-failed" : "notice-row"}>
                    <span className={`notice-icon is-${tone}`} aria-hidden="true">
                      <AdminIcon name={row.status === "FAILED" ? "issue" : row.status === "QUEUED" ? "clock" : "check"} />
                    </span>
                    <div className="notice-copy">
                      <p className="notice-title">{row.recipient}</p>
                      {row.preview ? <p className="notice-preview">{row.preview}</p> : null}
                      <p className="notice-meta">
                        <span>{words(row.type)}</span>
                        <span>{channelLabel(row.channel)}</span>
                        <span>{row.attemptCount} {row.attemptCount === 1 ? "attempt" : "attempts"}</span>
                        <span>{formatPlatformWhen(new Date(row.createdAt))}</span>
                      </p>
                    </div>
                    <div className="notice-side">
                      <StatusBadge tone={tone}>{words(row.status)}</StatusBadge>
                      {row.errorCode ? <StatusBadge tone="red">{words(row.errorCode)}</StatusBadge> : null}
                      {row.retryable ? (
                        <form action={retryDeliveryAction} className="screen-action-form">
                          <input type="hidden" name="notificationId" value={row.id} />
                          <button className="screen-action screen-action-on" type="submit">
                            Retry
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <DeliveryPager page={deliveries.page} pageSize={deliveries.pageSize} total={deliveries.total} params={params} />
        </section>
      ) : null}
      <p className="notice-footnote">
        In-app notices stay in this inbox. {emailReady ? "Email is on. A sent status means Gmail accepted the message." : "Email is off."} Text messages are not sent. Previews leave out clinical note text.
      </p>
    </main>
  );
}

function DeliveryPager({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (next: number) => {
    const search = new URLSearchParams();
    for (const key of ["channel", "status", "type", "page"] as const) {
      const value = params[key];
      if (typeof value === "string" && value) search.set(key, value);
    }
    search.set("deliveryPage", String(next));
    return `/admin/notifications?${search.toString()}`;
  };
  return (
    <div className="notice-pager">
      <p>
        Page {page} of {pages}
      </p>
      <div>
        {page > 1 ? (
          <Link href={href(page - 1)}>Previous</Link>
        ) : (
          <span>Previous</span>
        )}
        {page < pages ? <Link href={href(page + 1)}>Next</Link> : <span>Next</span>}
      </div>
    </div>
  );
}

function Stat({ tone, icon, label, value, note }: { tone: string; icon: AdminIconName; label: string; value: number | string; note: string }) {
  return (
    <article className="stat-card screen-stat" style={{ ["--stat" as string]: tone }}>
      <span className="stat-card-icon">
        <AdminIcon name={icon} />
      </span>
      <span className="stat-card-copy">
        <span className="stat-card-value">{value}</span>
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-note">{note}</span>
      </span>
    </article>
  );
}
