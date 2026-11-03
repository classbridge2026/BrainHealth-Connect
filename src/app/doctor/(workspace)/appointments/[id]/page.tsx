import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfilePhoto } from "@/components/profile-photo";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { RestrictedPractice } from "@/components/doctor/restricted";
import { StatusBadge } from "@/components/status-badge";
import { VisitIcon } from "@/app/patient/appointments/[id]/visit-icons";
import { appointmentStatusLabel, appointmentStatusTone, paymentStatusLabel } from "@/lib/admin/labels";
import { visitChannelLabel } from "@/lib/appointments/channel";
import { loadOfferingSlots, loadOwnedAppointment } from "@/lib/appointments/queries";
import { addDays, freetownDate, parseCalendarDate } from "@/lib/appointments/time";
import { canTransition } from "@/lib/appointments/transitions";
import { isFollowUpConsultation } from "@/lib/doctor/portal";
import { requireClinicalPortal } from "@/lib/doctor/session";
import { prisma } from "@/lib/db/prisma";
import { describeVisitJoin } from "@/lib/consultations/view";
import { readPublicContact } from "@/lib/public/landing";
import { ApproveNewTimeButton, DoctorAppointmentForms, DoctorBookingDecision, RescheduleButton } from "./forms";
import "./doctor-visit.css";

export const metadata: Metadata = { title: "Appointment" };
export const dynamic = "force-dynamic";

export default async function DoctorAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string; start?: string }>;
}) {
  const portal = await requireClinicalPortal();
  if (portal.access === "schema") return <RecordsUnavailable code="SCHEMA" />;
  if (!portal.staff && (portal.access !== "ready" || !portal.doctor)) return <RestrictedPractice access={portal.access} />;
  const user = portal.user;
  const { id } = await params;
  const query = await searchParams;
  const result = await loadOwnedAppointment(prisma, { id, userId: user.id, as: portal.staff ? "staff" : "doctor" });
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  const visit = result.appointment;
  const now = new Date();
  const join = describeVisitJoin({
    actorUserId: user.id,
    actorStatus: user.status,
    roleCodes: user.roleCodes,
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
  const [contactRows, followUps] = await Promise.all([
    prisma.platformSetting.findMany({
      where: { key: "PUBLIC_CONTACT_EMAIL" },
      select: { key: true, valueJson: true },
    }).catch(() => []),
    prisma.appointment.findMany({
      where: { followUpOfId: visit.id, doctorProfileId: visit.doctor.id },
      orderBy: { startsAt: "asc" },
      select: { id: true },
      take: 1,
    }).catch(() => []),
  ]);
  const supportEmail = readPublicContact(contactRows).email;
  const minutes = Math.max(1, Math.round((visit.endsAt.getTime() - visit.startsAt.getTime()) / 60_000));
  const paid = visit.paymentStatuses.includes("PAID");
  const latestPayment = visit.paymentStatuses.at(-1);
  const online = visit.mode === "ONLINE";
  const pendingApproval = visit.status === "PENDING_APPROVAL";
  const canCancel = !pendingApproval && canTransition({
    actor: "doctor",
    ownsRecord: true,
    from: visit.status,
    to: "CANCELLED_BY_DOCTOR",
    now,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    reason: "Doctor requested cancellation",
  }).ok;

  const recordOpen = visit.status === "CONFIRMED" || visit.status === "CHECKED_IN" || visit.status === "IN_PROGRESS" || visit.status === "COMPLETED";
  const preparing = visit.status === "CONFIRMED" || visit.status === "CHECKED_IN" || visit.status === "IN_PROGRESS";
  const paymentLabel = latestPayment ? paymentStatusLabel(latestPayment) : paid ? "Paid" : "Not recorded";
  const followUp = isFollowUpConsultation({ code: visit.serviceCode, name: visit.service });
  const missed = now.getTime() >= visit.endsAt.getTime();
  const canOfferNewTime = pendingApproval && visit.startsAt <= now && Boolean(visit.offeringId);
  const canReschedule = !pendingApproval && Boolean(visit.offeringId) && canTransition({
    actor: "doctor",
    ownsRecord: true,
    from: visit.status,
    to: "RESCHEDULED",
    now,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    reason: "Doctor offered another time",
  }).ok;
  const today = freetownDate(now);
  const requestedDay = typeof query.date === "string" && parseCalendarDate(query.date) ? query.date : today;
  const start = typeof query.start === "string" ? query.start : "";
  const slots = (canReschedule || canOfferNewTime) && visit.offeringId
    ? await loadOfferingSlots(prisma, {
        offeringId: visit.offeringId,
        day: requestedDay,
        locationId: visit.locationId,
        now,
        excludeAppointmentId: visit.id,
      })
    : null;
  const days = parseCalendarDate(today)
    ? Array.from({ length: 14 }, (_, index) => addDays(parseCalendarDate(today)!, index).toISOString().slice(0, 10))
    : [today];
  const selected = slots?.ok ? slots.slots.find((slot) => slot.startsAt === start) : undefined;

  return (
    <main className="doc-visit">
      <Link className="doc-back" href="/doctor/appointments">
        <VisitIcon name="back" />
        Back to appointments
      </Link>

      <section className="doc-hero">
        <div className="doc-hero-top">
          <div>
            <p className="doc-kicker">{visit.specialty}{followUp ? " · Follow-up" : ""}</p>
            <h1>Appointment details</h1>
            <p className="doc-lead">{visit.service}</p>
          </div>
          <StatusBadge tone={appointmentStatusTone(visit.status)}>{appointmentStatusLabel(visit.status)}</StatusBadge>
        </div>

        <div className="doc-patient">
          <ProfilePhoto userId={visit.patient.userId} name={visit.patient.fullName} version={visit.patient.imageVersion} size={56} alt="" />
          <div>
            <strong>{visit.patient.fullName}</strong>
            <span>Patient</span>
          </div>
        </div>

        <div className="doc-chip-row">
          <span className={`doc-chip ${online ? "teal" : ""}`}>{online ? `${visitChannelLabel(visit.visitChannel, visit.mode)} consultation` : "In person"}</span>
          <span className="doc-chip">{paymentLabel}</span>
          <span className="doc-chip">{visit.fee}</span>
        </div>

        <dl className="doc-facts">
          <div className="doc-fact">
            <small>Date and time</small>
            <strong>{visit.when}</strong>
          </div>
          <div className="doc-fact">
            <small>Duration</small>
            <strong>{minutes} min</strong>
          </div>
          <div className="doc-fact">
            <small>Ends</small>
            <strong>{visit.until}</strong>
          </div>
          <div className="doc-fact">
            <small>Mode</small>
            <strong>{online ? "Video and audio" : "Clinic visit"}</strong>
          </div>
        </dl>

        <dl className="doc-ref">
          <dt>Appointment reference</dt>
          <dd>{visit.id}</dd>
        </dl>

        {visit.place ? (
          <div className="doc-place">
            <strong>{visit.place.name}</strong>
            <span>{visit.place.address}</span>
            {visit.place.phone ? <span>Clinic phone: {visit.place.phone}</span> : null}
            <span>{visit.place.instructions ?? "No arrival instructions have been added."}</span>
          </div>
        ) : null}
        {!online && !visit.place ? <p className="doc-banner">Location details have not been provided yet.</p> : null}
        {visit.feeAmountMinor > 0 && !paid ? (
          <p className="doc-banner">This visit stays closed until the payment is received and an administrator verifies it. A doctor cannot verify a payment.</p>
        ) : null}
        {visit.patientConcern && !pendingApproval ? (
          <div className="doc-concern">
            <h2>What the patient reported</h2>
            <p>{visit.patientConcern}</p>
          </div>
        ) : null}
        {visit.intakeHistory ? (
          <div className="doc-concern">
            <h2>Intake</h2>
            <p>{visit.intakeHistory}</p>
          </div>
        ) : null}
        {visit.preparation ? <p className="doc-banner">{visit.preparation}</p> : null}
        {visit.scheduleReason ? <p className="doc-banner">Approved at this time. Reason: {visit.scheduleReason}</p> : null}
        {visit.cancellationReason ? <p className="doc-banner">Cancellation reason: {visit.cancellationReason}</p> : null}

        {online && !join.decision.ok && join.decision.code === "EXPIRED" ? (
          <p className="doc-banner">The video and audio window for this visit has closed.</p>
        ) : null}
        <div className="doc-actions">
          {preparing && !missed ? (
            <Link className="doc-btn" href={`/doctor/appointments/${visit.id}/consultation`}>
              <VisitIcon name={online ? "video" : "calendar"} />
              {visit.status === "IN_PROGRESS" ? "Continue consultation" : "Prepare for consultation"}
            </Link>
          ) : null}
          {portal.staff ? null : <Link className="doc-btn-ghost" href={`/doctor/patients/${visit.patient.id}`}>Patient information</Link>}
          {recordOpen && !portal.staff ? (
            <Link className="doc-btn-ghost" href={`/doctor/appointments/${visit.id}/record`}>Clinical record</Link>
          ) : null}
          {portal.staff ? null : followUps[0] ? (
            <Link className="doc-btn-ghost" href={`/doctor/appointments/${followUps[0].id}`}>View follow-up</Link>
          ) : (
            <Link className="doc-btn-ghost" href={`/doctor/follow-ups?source=${visit.id}`}>Record a follow-up</Link>
          )}
          {supportEmail ? <a className="doc-btn-ghost" href={`mailto:${supportEmail}`}>Contact support</a> : null}
        </div>
      </section>

      <div className="doc-layout">
        <div className="doc-forms">
          {pendingApproval ? (
            <section className="doc-panel">
              <h2>Booking request</h2>
              {visit.patientConcern ? (
                <div className="doc-concern">
                  <h3>What the patient reported</h3>
                  <p>{visit.patientConcern}</p>
                </div>
              ) : (
                <p className="doc-quiet">This request does not include a description of what is wrong.</p>
              )}
              <p className="doc-quiet">{visit.patientConcern ? "Read what the patient reported before you approve or decline. " : ""}Until you approve it, the booking stays under Pending and this time cannot be given to another patient.</p>
              <DoctorBookingDecision appointmentId={visit.id} canApprove={visit.startsAt > now} offerNewTime={canOfferNewTime}>
                {canOfferNewTime ? (
                  <ApproveNewTimeButton
                    appointmentId={visit.id}
                    date={requestedDay}
                    days={days}
                    locationId={visit.locationId ?? ""}
                    selectedStart={start}
                    slots={slots ? (slots.ok ? { ok: true, schedule: slots.schedule } : { ok: false }) : null}
                  />
                ) : null}
              </DoctorBookingDecision>
            </section>
          ) : null}
          {canReschedule ? (
            <section className="doc-panel">
              <h2>Reschedule</h2>
              <p className="doc-quiet">
                {missed
                  ? "This visit time has passed and the consultation was not completed. Choose another open time and give a reason."
                  : "Choose another open time and give a reason. The patient will see the new appointment."}
              </p>
              <RescheduleButton
                appointmentId={visit.id}
                date={requestedDay}
                days={days}
                locationId={visit.locationId ?? ""}
                missed={missed}
                selectedStart={start}
                slots={slots ? (slots.ok ? { ok: true, schedule: slots.schedule } : { ok: false }) : null}
              />
            </section>
          ) : null}
          {preparing && !missed ? (
            <section className="doc-panel">
              <h2>Prepare for consultation</h2>
              <p className="doc-quiet">This booking is approved. Review the visit and open the consultation. When you end the consultation, the system marks it complete.</p>
              <Link className="doc-btn" href={`/doctor/appointments/${visit.id}/consultation`}>
                {visit.status === "IN_PROGRESS" ? "Continue consultation" : "Prepare for consultation"}
              </Link>
            </section>
          ) : null}
          <DoctorAppointmentForms appointmentId={visit.id} actions={[]} canCancel={canCancel} />
        </div>
        <aside className="doc-panel doc-timeline">
          <h2>Visit history</h2>
          {visit.events.length === 0 ? <p className="doc-quiet">No events are recorded.</p> : (
            <ol>
              {visit.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{event.fromStatus ? `${appointmentStatusLabel(event.fromStatus)} to ${appointmentStatusLabel(event.toStatus)}` : appointmentStatusLabel(event.toStatus)}</strong>
                    <time>{event.when}</time>
                    {event.detail && !event.detail.startsWith("schedule_reason:") ? <small>{event.detail}</small> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {!recordOpen ? <p className="doc-quiet">The clinical record opens after this booking is approved.</p> : null}
        </aside>
      </div>
    </main>
  );
}
