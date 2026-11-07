import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/catalog-ui";
import { Notice } from "@/components/admin/portal-ui";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge } from "@/components/status-badge";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadAppointmentDetail } from "@/lib/admin/directories";
import { adminCancelDecision } from "@/lib/admin/rules";
import { appointmentStatusLabel, appointmentStatusTone, formatPlatformWhen, paymentStatusLabel, paymentStatusTone } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { ApproveBookingForm, CancelAppointmentForm } from "./cancel-form";

export const metadata: Metadata = { title: "Appointment" };
export const dynamic = "force-dynamic";

export default async function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const { id } = await params;
  const result = await loadAppointmentDetail(prisma, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const visit = result.appointment;
  return (
    <main className="grid gap-6">
      <PageHeader eyebrow="Operations" title={`${visit.patient.fullName} with ${visit.doctor.displayName}`} description={`${visit.specialty} · ${visit.service}`} />
      <section className="grid gap-4 rounded-2xl border border-brand-line bg-white p-5 sm:grid-cols-2">
        <p>
          <span className="block text-sm text-brand-muted">Status</span>
          <StatusBadge tone={appointmentStatusTone(visit.status)}>{appointmentStatusLabel(visit.status)}</StatusBadge>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">When</span>
          <span className="font-semibold text-brand-navy">
            {formatPlatformWhen(new Date(visit.startsAt))} – {formatPlatformWhen(new Date(visit.endsAt))}
          </span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Mode</span>
          <span className="font-semibold text-brand-navy">{visit.mode === "ONLINE" ? "Online" : "In person"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Historical fee</span>
          <span className="font-semibold text-brand-navy">{visit.fee}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Location</span>
          <span className="font-semibold text-brand-navy">{visit.location ?? "No platform location"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Booking source</span>
          <span className="font-semibold text-brand-navy">{visit.bookingSource}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Payment hold</span>
          <span className="font-semibold text-brand-navy">{visit.paymentHoldExpiresAt ? formatPlatformWhen(new Date(visit.paymentHoldExpiresAt)) : "Not applicable"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Patient</span>
          <Link className="font-semibold text-brand-teal" href={`/admin/patients/${visit.patient.id}`}>
            {visit.patient.fullName}
          </Link>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Doctor</span>
          <Link className="font-semibold text-brand-teal" href={`/admin/doctors/${visit.doctor.id}`}>
            {visit.doctor.displayName}
          </Link>
        </p>
      </section>
      {visit.holdExpired ? <Notice>This unpaid hold has passed its expiry and still occupies the slot until it is processed.</Notice> : null}
      {visit.status === "EXPIRED_UNPAID" ? (
        <Notice>
          The time was released because the hold ended. If the patient already paid, open the payment and give that time back, or choose another time. The patient does not pay again.
        </Notice>
      ) : null}
      {visit.cancellationReason ? <Notice>Cancellation reason: {visit.cancellationReason}</Notice> : null}
      {visit.overlaps.length > 0 ? (
        <Notice>
          Other occupying appointments overlap this time.{" "}
          {visit.overlaps.map((row) => (
            <Link key={row.id} className="font-semibold text-brand-teal" href={`/admin/appointments/${row.id}`}>
              {formatPlatformWhen(new Date(row.startsAt))}{" "}
            </Link>
          ))}
        </Notice>
      ) : null}
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold text-brand-navy">Payments</h2>
        {visit.payments.length === 0 ? (
          <p className="text-sm text-brand-muted">No payment record is attached.</p>
        ) : (
          <ul className="grid gap-2">
            {visit.payments.map((payment) => (
              <li key={payment.id}>
                <Link href={`/admin/payments/${payment.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm">
                  <span>
                    {payment.amount} · {payment.providerCode}
                    {payment.providerReference ? ` · ${payment.providerReference}` : payment.hasReceipt ? " · Screenshot" : ""}
                  </span>
                  <StatusBadge tone={paymentStatusTone(payment.status)}>{paymentStatusLabel(payment.status)}</StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold text-brand-navy">History</h2>
        <ol className="grid gap-2">
          {visit.events.map((event) => (
            <li key={event.id} className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm">
              <p className="font-semibold text-brand-navy">
                {event.fromStatus ? `${appointmentStatusLabel(event.fromStatus)} → ` : ""}
                {appointmentStatusLabel(event.toStatus)}
              </p>
              <p className="text-brand-muted">
                {formatPlatformWhen(new Date(event.occurredAt))} · {event.actor}
                {event.detail ? ` · ${event.detail}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
      {visit.status === "PENDING_APPROVAL" ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold text-brand-navy">Booking request</h2>
          {visit.patientConcern ? (
            <p className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm leading-6 text-brand-ink">{visit.patientConcern}</p>
          ) : (
            <p className="text-sm text-brand-muted">This request does not include a description of what is wrong.</p>
          )}
          <p className="text-sm leading-6 text-brand-muted">Approve or decline this visit the same way the assigned doctor can. Until it is approved, the booking stays under Pending.</p>
          {new Date(visit.startsAt) > new Date() ? <ApproveBookingForm appointmentId={visit.id} /> : (
            <Notice>This requested time has passed. Decline the booking so the patient can choose another time.</Notice>
          )}
          <CancelAppointmentForm appointmentId={visit.id} decline />
        </section>
      ) : adminCancelDecision(visit.status) ? (
        <CancelAppointmentForm appointmentId={visit.id} />
      ) : null}
    </main>
  );
}
