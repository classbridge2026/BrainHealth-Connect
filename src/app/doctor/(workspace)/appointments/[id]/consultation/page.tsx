import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsultationSession } from "@/components/consultation/session";
import { DoctorWorkspace, type DoctorWorkspaceNote } from "@/components/consultation/doctor-workspace";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { appointmentStatusLabel, paymentStatusLabel } from "@/lib/admin/labels";
import { formatBookingWhen } from "@/lib/appointments/time";
import { loadOwnedAppointment } from "@/lib/appointments/queries";
import { canTransition } from "@/lib/appointments/transitions";
import { loadClinicianRecord } from "@/lib/clinical/records";
import { encounterStatusLabel } from "@/lib/clinical/rules";
import { describeVisitJoin } from "@/lib/consultations/view";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { patientAgeLine, patientReference } from "@/lib/doctor/present";
import { loadFollowUpFormData } from "@/lib/doctor/workspace";
import { genderLabel } from "@/lib/patient/portal";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Consultation" };
export const dynamic = "force-dynamic";

function toNote(note: {
  id: string;
  kind: string;
  state: string;
  revision: number;
  body: string;
  release: string;
  releasedWhen: string | null;
  archived: boolean;
  versions: DoctorWorkspaceNote["versions"];
} | undefined): DoctorWorkspaceNote | null {
  if (!note || note.archived) return null;
  return note;
}

export default async function DoctorConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const { id } = await params;
  const result = await loadOwnedAppointment(prisma, { id, userId: portal.user.id, as: portal.staff ? "staff" : "doctor" });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const visit = result.appointment;
  const now = new Date();
  const [record, form, profile, linked] = await Promise.all([
    loadClinicianRecord(prisma, { appointmentId: visit.id, actorUserId: portal.user.id }),
    loadFollowUpFormData(prisma, portal.user.id),
    prisma.patientProfile.findUnique({
      where: { id: visit.patient.id },
      select: { gender: true, dateOfBirth: true },
    }).catch(() => null),
    prisma.appointment.findMany({
      where: { followUpOfId: visit.id, doctorProfileId: visit.doctor.id },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, startsAt: true, status: true },
    }).catch(() => []),
  ]);
  const notes = record.ok ? record.view.notes : [];
  const privateNote = toNote(notes.filter((note) => note.kind === "PRIVATE_WORKING").at(-1));
  const summaryNote = toNote(notes.filter((note) => note.kind === "PATIENT_SUMMARY").at(-1));
  const latestPayment = visit.paymentStatuses.at(-1);
  const paid = visit.paymentStatuses.includes("PAID");
  const canComplete = canTransition({
    actor: "doctor",
    ownsRecord: true,
    from: visit.status,
    to: "COMPLETED",
    now,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
  }).ok;
  const workspace = (
    <DoctorWorkspace
      appointmentId={visit.id}
      canComplete={canComplete}
      canOpen={record.ok ? record.view.canOpen : false}
      encounterLabel={record.ok && record.view.encounter ? encounterStatusLabel(record.view.encounter.status) : null}
      concern={visit.patientConcern}
      fee={visit.fee}
      followUps={linked.map((row) => ({ id: row.id, when: formatBookingWhen(row.startsAt), statusLabel: appointmentStatusLabel(row.status) }))}
      intake={visit.intakeHistory}
      locations={form.ok ? form.locations : []}
      modeLabel={visit.mode === "ONLINE" ? "Online consultation" : "In person"}
      offerings={form.ok ? form.offerings : []}
      patientImageVersion={visit.patient.imageVersion}
      patientLine={profile ? patientAgeLine(genderLabel(profile.gender), profile.dateOfBirth, now) : "Patient"}
      patientName={visit.patient.fullName}
      patientUserId={visit.patient.userId}
      paymentLabel={latestPayment ? paymentStatusLabel(latestPayment) : paid ? "Paid" : "Not recorded"}
      privateNote={privateNote}
      reference={patientReference(visit.patient.id)}
      service={visit.service}
      specialty={visit.specialty}
      statusLabel={appointmentStatusLabel(visit.status)}
      summaryNote={summaryNote}
      until={visit.until}
      when={visit.when}
      writeBlocked={record.ok ? record.view.writeBlocked : "The clinical record could not be opened. The appointment was not changed."}
    />
  );

  if (visit.mode !== "ONLINE") {
    return (
      <div className="grid gap-4">
        <p className="rounded-[14px] border border-[#DCE7F0] bg-white p-4 text-sm text-[#17324D]">This visit is in person. Prepare the consultation here. When you end it, the system marks the visit complete.</p>
        <Link className="text-sm font-semibold text-[#0F766E]" href={`/doctor/appointments/${visit.id}`}>Back to the appointment</Link>
        {workspace}
      </div>
    );
  }

  const join = describeVisitJoin({
    actorUserId: portal.user.id,
    actorStatus: portal.user.status,
    roleCodes: portal.user.roleCodes,
    mode: visit.mode,
    status: visit.status,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    patientUserId: visit.patient.userId,
    doctorUserId: visit.doctor.userId,
    patientStatus: visit.patient.userStatus,
    doctorStatus: visit.doctor.userStatus,
    doctorDeletedAt: visit.doctor.deletedAt,
    doctorVerificationStatus: visit.doctor.verificationStatus,
    paymentStatuses: visit.paymentStatuses,
    feeAmountMinor: visit.feeAmountMinor,
    when: visit.when,
    now,
    audience: "doctor",
  });

  return (
    <ConsultationSession
      appointmentId={visit.id}
      aside={workspace}
      canJoin={join.canJoin}
      configured={join.configured}
      counterpart={visit.patient.fullName}
      counterpartImageVersion={visit.patient.imageVersion}
      counterpartUserId={visit.patient.userId}
      message={join.message}
      returnHref={`/doctor/appointments/${visit.id}`}
      role="doctor"
      service={visit.service}
      specialty={visit.specialty}
      startedAt={record.ok ? record.view.encounter?.startedAt ?? null : null}
      statusLabel={appointmentStatusLabel(visit.status)}
      when={visit.when}
    />
  );
}
