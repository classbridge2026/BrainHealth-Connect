import type { Metadata } from "next";
import { CatalogPager, PageHeader, catalogQuery } from "@/components/admin/catalog-ui";
import { Notice } from "@/components/admin/portal-ui";
import { LiveQueryForm } from "@/components/live-query";
import { textInputClass } from "@/components/form-classes";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadPayments } from "@/lib/admin/directories";
import { formatPlatformWhen, paymentStatusLabel, paymentStatusTone } from "@/lib/admin/labels";
import { readPage, readParam } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/prisma";
import { listPaymentVerifierChoices } from "@/lib/payments/verifiers";
import { PaymentVerifierForm } from "./verifier-form";
import { PaymentsBoard } from "./payments-board";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const params = await searchParams;
  const q = readParam(params.q);
  const status = readParam(params.status);
  const date = readParam(params.date);
  const page = readPage(params.page);
  const [result, verifiers] = await Promise.all([
    loadPayments(prisma, { q, status, date, page }),
    user.roleCodes.includes(SUPER_ADMIN_ROLE_CODE) ? listPaymentVerifierChoices(prisma).catch(() => []) : Promise.resolve(null),
  ]);
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  return (
    <main className="grid gap-6">
      <PageHeader eyebrow="Operations" title="Payments" description="Orange Money and Afrimoney transfers reported by patients. A selected administrator confirms the money arrived." />
      <Notice>Patients send the fee from their own phones. The visit counts as paid only after an administrator verifies the transfer. A doctor cannot verify a payment. A refund is not sent from here.</Notice>
      {verifiers ? <PaymentVerifierForm choices={verifiers} /> : <Notice>A super administrator chooses which administrators can verify payments.</Notice>}
      <LiveQueryForm
        pathname="/admin/payments"
        className="grid gap-3 rounded-2xl border border-brand-line bg-white p-4 md:grid-cols-[minmax(0,1fr)_12rem_11rem] md:items-end"
        fields={[
          { name: "q", label: "Patient, payer, reference, or appointment", kind: "text", value: q, labelClassName: "text-sm font-medium", inputClassName: `${textInputClass} mt-1` },
          { name: "status", label: "Status", kind: "select", value: status || "ALL", labelClassName: "text-sm font-medium", inputClassName: `${textInputClass} mt-1`, options: [
            { value: "ALL", label: "All statuses" },
            { value: "PENDING", label: "Pending" },
            { value: "REQUIRES_ACTION", label: "Waiting for administrator verification" },
            { value: "PAID", label: "Verified by administrator" },
            { value: "FAILED_OR_REFUNDED", label: "Failed or refunded" },
            { value: "CANCELLED", label: "Cancelled" },
          ] },
          { name: "date", label: "Created", kind: "date", value: date, labelClassName: "text-sm font-medium", inputClassName: `${textInputClass} mt-1` },
        ]}
      />
      <PaymentsBoard
        payments={result.payments.map((payment) => ({
          ...payment,
          createdLabel: formatPlatformWhen(new Date(payment.createdAt)),
          statusLabel: paymentStatusLabel(payment.status),
          statusTone: paymentStatusTone(payment.status),
        }))}
      />
      <CatalogPager page={result.page} pageSize={result.pageSize} total={result.total} query={catalogQuery("/admin/payments", { q, status, date })} label="payment" />
    </main>
  );
}
