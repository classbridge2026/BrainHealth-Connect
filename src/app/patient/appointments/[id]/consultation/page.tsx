import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PatientVisitPanel } from "@/components/consultation/patient-consult";
import { ConsultationSession } from "@/components/consultation/session";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { appointmentStatusLabel, paymentStatusLabel } from "@/lib/admin/labels";
import { loadOwnedAppointment } from "@/lib/appointments/queries";
import { getSystemName } from "@/lib/brand/system-name";
import { describeVisitJoin } from "@/lib/consultations/view";
import { prisma } from "@/lib/db/prisma";
import { readPublicContact } from "@/lib/public/landing";

export const metadata: Metadata = { title: "Consultation" };
export const dynamic = "force-dynamic";

function readAccept(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "audio" || raw === "video" ? raw : null;
}

export default async function PatientConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const { id } = await params;
  const query = await searchParams;
  const result = await loadOwnedAppointment(prisma, { id, userId: user.id, as: "patient" });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const visit = result.appointment;
  if (visit.mode !== "ONLINE") {
    return (
      <div className="grid min-h-dvh content-center justify-items-start gap-4 bg-[#F3F8FC] p-6">
        <p className="max-w-lg rounded-[14px] border border-[#d7e3ee] bg-white p-5 text-sm leading-6 text-[#0C2B45]">
          This visit is in person. The online consultation room is not used.
        </p>
        <Link className="text-sm font-semibold text-[#0F766E]" href={`/patient/appointments/${visit.id}`}>Back to the appointment</Link>
      </div>
    );
  }

  const now = new Date();
  const [systemName, contactRows] = await Promise.all([
    getSystemName(),
    prisma.platformSetting.findMany({
      where: { key: { in: ["PUBLIC_CONTACT_EMAIL", "PUBLIC_CONTACT_PHONE", "PUBLIC_CONTACT_ADDRESS"] } },
      select: { key: true, valueJson: true },
    }).catch(() => []),
  ]);
  const join = describeVisitJoin({
    actorUserId: user.id,
    actorStatus: user.status,
    roleCodes: user.roleCodes,
    mode: visit.mode,
    status: visit.status,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    patientUserId: user.id,
    doctorUserId: visit.doctor.userId,
    patientStatus: user.status,
    doctorStatus: visit.doctor.userStatus,
    doctorDeletedAt: visit.doctor.deletedAt,
    doctorVerificationStatus: visit.doctor.verificationStatus,
    paymentStatuses: visit.paymentStatuses,
    feeAmountMinor: visit.feeAmountMinor,
    when: visit.when,
    now,
    audience: "patient",
  });
  const latestPayment = visit.paymentStatuses.at(-1);
  const paid = visit.paymentStatuses.includes("PAID");
  const storedAccept = visit.visitChannel === "AUDIO" ? "audio" : visit.visitChannel === "VIDEO" ? "video" : null;

  return (
    <ConsultationSession
      accept={storedAccept ?? readAccept(query.accept) ?? "video"}
      appointmentId={visit.id}
      aside={(
        <PatientVisitPanel
          doctorImageVersion={visit.doctor.imageVersion}
          doctorName={visit.doctor.displayName}
          doctorUserId={visit.doctor.userId}
          fee={visit.fee}
          paymentLabel={latestPayment ? paymentStatusLabel(latestPayment) : paid ? "Paid" : "Not recorded"}
          preparation={visit.preparation}
          service={visit.service}
          specialty={visit.specialty}
          statusLabel={appointmentStatusLabel(visit.status)}
          supportEmail={readPublicContact(contactRows).email}
          until={visit.until}
          verified={visit.doctor.verificationStatus === "APPROVED"}
          when={visit.when}
        />
      )}
      canJoin={join.canJoin}
      configured={join.configured}
      counterpart={visit.doctor.displayName}
      counterpartImageVersion={visit.doctor.imageVersion}
      counterpartUserId={visit.doctor.userId}
      message={join.message}
      returnHref={`/patient/appointments/${visit.id}`}
      role="patient"
      service={visit.service}
      specialty={visit.specialty}
      systemName={systemName}
      verified={visit.doctor.verificationStatus === "APPROVED"}
      when={visit.when}
    />
  );
}
