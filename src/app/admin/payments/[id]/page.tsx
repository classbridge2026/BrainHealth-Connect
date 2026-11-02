import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/catalog-ui";
import { Notice } from "@/components/admin/portal-ui";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { StatusBadge } from "@/components/status-badge";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadPaymentDetail } from "@/lib/admin/directories";
import { appointmentStatusLabel, formatPlatformWhen, paymentStatusLabel, paymentStatusTone, reconciliationLabel } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { OrangeReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const { id } = await params;
  const result = await loadPaymentDetail(prisma, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const payment = result.payment;
  return (
    <main className="grid gap-6">
      <PageHeader eyebrow="Operations" title={payment.amount} description={`${payment.payer.email} · ${payment.providerCode}`} />
      {payment.receiptMime ? (
        <img
          className="max-h-[32rem] w-full rounded-2xl border border-brand-line bg-white object-contain"
          src={`/admin/payments/${payment.id}/receipt`}
          alt="Screenshot of the transaction details"
        />
      ) : null}
      {payment.status === "REQUIRES_ACTION" && (payment.providerCode === "ORANGE_MONEY" || payment.providerCode === "AFRIMONEY") && payment.providerReference ? (
        <OrangeReviewForm paymentId={payment.id} reference={payment.providerReference} wallet={payment.providerCode === "AFRIMONEY" ? "Afrimoney" : "Orange Money"} />
      ) : (
        <Notice>Confirm a phone transfer only after the patient has submitted the SMS transaction code and the amount is on the clinic number.</Notice>
      )}
      {payment.flags.length > 0 ? (
        <Notice>
          {payment.flags.map((flag) => reconciliationLabel(flag)).join(" ")} A late payment does not confirm an appointment whose slot was released.
        </Notice>
      ) : null}
      <section className="grid gap-4 rounded-2xl border border-brand-line bg-white p-5 sm:grid-cols-2">
        <p>
          <span className="block text-sm text-brand-muted">Status</span>
          <StatusBadge tone={paymentStatusTone(payment.status)}>{paymentStatusLabel(payment.status)}</StatusBadge>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Provider reference</span>
          <span className="font-semibold text-brand-navy">{payment.providerReference ?? "None recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Provider account</span>
          <span className="font-semibold text-brand-navy">{payment.providerAccountId ?? "None recorded"}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Created</span>
          <span className="font-semibold text-brand-navy">{formatPlatformWhen(new Date(payment.createdAt))}</span>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Payer</span>
          <Link className="font-semibold text-brand-teal" href={`/admin/users/${payment.payer.id}`}>
            {payment.payer.email}
          </Link>
        </p>
        <p>
          <span className="block text-sm text-brand-muted">Appointment</span>
          <Link className="font-semibold text-brand-teal" href={`/admin/appointments/${payment.appointment.id}`}>
            {payment.appointment.patient} · {appointmentStatusLabel(payment.appointment.status)}
          </Link>
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold text-brand-navy">Provider events</h2>
        <p className="text-sm text-brand-muted">Event payloads are not displayed.</p>
        {payment.events.length === 0 ? (
          <p className="text-sm text-brand-muted">No provider events are stored for this payment.</p>
        ) : (
          <ol className="grid gap-2">
            {payment.events.map((event) => (
              <li key={event.id} className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm">
                <p className="font-semibold text-brand-navy">{paymentStatusLabel(event.status)}</p>
                <p className="text-brand-muted">
                  {event.providerCode} · occurred {formatPlatformWhen(new Date(event.occurredAt))} · received {formatPlatformWhen(new Date(event.receivedAt))}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
