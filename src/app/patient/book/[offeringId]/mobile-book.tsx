import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { readPageSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { HoldCountdown } from "@/components/appointments/hold-countdown";
import { CancelAppointmentForm } from "@/app/patient/appointments/[id]/cancel-form";
import { visitChannelLabel } from "@/lib/appointments/channel";
import { expireOverdueHolds } from "@/lib/appointments/payment-holds";
import { loadOwnedAppointment } from "@/lib/appointments/queries";
import { canTransition } from "@/lib/appointments/transitions";
import { formatNormalClock } from "@/lib/appointments/time";
import { prisma } from "@/lib/db/prisma";
import { listAppointmentPayments } from "@/lib/patient/portal";
import { afrimoneyConfigured, orangeConfigured } from "@/lib/payments/mobile-money";
import { afrimoneyDialHref, afrimoneyTransferCode, loadAfrimoneyDialNumber } from "@/lib/payments/afrimoney-transfer";
import { formatOrangeDialNumber, loadOrangeDialNumber, orangeDialHref, orangeTransferCode, ussdAmount } from "@/lib/payments/orange-transfer";
import { VisitPayment } from "../../appointments/[id]/pay-form";
import { Details, freetownDay, href, summaryDate, type BookingOffering, type BookingSlot } from "./booking-details";

type Step = "details" | "payment" | "confirmation";

type Slot = BookingSlot;

type OfferingCard = BookingOffering;

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "details", label: "Details" },
  { id: "payment", label: "Payment" },
  { id: "confirmation", label: "Confirmation" },
];

export async function MobileBooking({
  offering,
  days,
  today,
  requested,
  locationId,
  locations,
  channel,
  channelQuery,
  start,
  slots,
  step,
  appointmentId,
}: {
  offering: OfferingCard;
  days: string[];
  today: string;
  requested: string;
  locationId: string;
  locations: Array<{ id: string; label: string }>;
  channel: "VIDEO" | "AUDIO" | "IN_PERSON" | null;
  channelQuery: string;
  start: string;
  slots: Slot[];
  step: Step;
  appointmentId: string;
}) {
  const online = offering.mode === "ONLINE";
  const selected = slots.find((slot) => slot.startsAt === start) ?? null;
  const backHref = step === "confirmation"
    ? "/patient/appointments"
    : step === "payment"
      ? href(offering.id, requested, locationId, channelQuery)
      : `/patient/doctors/${offering.doctorId}`;
  const subtitle = step === "payment"
    ? "Pay the self-pay fee to keep this time."
    : step === "confirmation"
      ? "Review the visit you just booked."
      : "Choose your preferred date, time and consultation type to continue.";

  return (
    <div className="book-mobile">
      <div className="mbk">
        <Link className="mbk-back" href={backHref} aria-label="Back">
          <ChevronLeft size={22} aria-hidden="true" />
        </Link>
        <h1>Book Appointment</h1>
        <p className="mbk-lead">{subtitle}</p>
        <ol className="mbk-steps" aria-label="Booking steps">
          {STEPS.map((item, index) => {
            const current = STEPS.findIndex((row) => row.id === step);
            const state = index < current ? "is-done" : index === current ? "is-on" : "";
            return (
              <li key={item.id} className={state}>
                <b>{index + 1}</b>
                <span>{item.label}</span>
              </li>
            );
          })}
        </ol>

        {step === "details" ? (
          <Details
            offering={offering}
            days={days}
            today={today}
            requested={requested}
            locationId={locationId}
            locations={locations}
            channel={channel}
            channelQuery={channelQuery}
            online={online}
            selected={selected}
            slots={slots}
          />
        ) : null}
        {step === "payment" ? <PaymentStep offeringId={offering.id} appointmentId={appointmentId} /> : null}
        {step === "confirmation" ? <ConfirmationStep offeringId={offering.id} appointmentId={appointmentId} /> : null}
      </div>
    </div>
  );
}

async function PaymentStep({ offeringId, appointmentId }: { offeringId: string; appointmentId: string }) {
  await releaseDueHold(appointmentId);
  const loaded = await loadVisit(offeringId, appointmentId);
  if (!loaded.ok) return <p className="mbk-empty">{loaded.message}</p>;
  const { visit, userId } = loaded;
  if (visit.status === "CONFIRMED" || visit.status === "PENDING_APPROVAL" || visit.paymentStatuses.includes("PAID") || visit.feeAmountMinor <= 0) {
    redirect(`/patient/book/${offeringId}?step=confirmation&appointment=${visit.id}`);
  }
  if (visit.status === "EXPIRED_UNPAID" || visit.status === "CANCELLED_BY_PATIENT") {
    const channel = visit.visitChannel === "AUDIO" ? "audio" : visit.visitChannel === "IN_PERSON" ? "in-person" : "video";
    const cancelled = visit.status === "CANCELLED_BY_PATIENT";
    return (
      <div className="mbk-panel">
        <p className="mbk-empty">{cancelled ? "This booking is cancelled. The time is free again." : "This hold has ended. Choose another open time."}</p>
        <Link className="mbk-continue" href={`/patient/book/${offeringId}?channel=${channel}`}>Choose another time</Link>
      </div>
    );
  }

  const payments = await listAppointmentPayments(prisma, { appointmentId: visit.id, userId });
  const waiting = payments.ok ? payments.payments.find((payment) => payment.status === "REQUIRES_ACTION" || payment.status === "PENDING") : undefined;
  const paid = visit.paymentStatuses.includes("PAID");
  const alreadySubmitted = paid || Boolean(waiting);
  const canPay = !alreadySubmitted && visit.feeAmountMinor > 0 && (visit.status === "CONFIRMED" || visit.status === "PENDING_PAYMENT" || visit.status === "EXPIRED_UNPAID");
  const walletApi = canPay && (orangeConfigured() || afrimoneyConfigured());
  const account = walletApi
    ? await prisma.user.findUnique({ where: { id: userId }, select: { phoneE164: true } }).catch(() => null)
    : null;
  const transferAmount = canPay && !walletApi ? ussdAmount(visit.feeAmountMinor) : null;
  const [orangeDial, afriDial] = canPay && !walletApi
    ? await Promise.all([loadOrangeDialNumber(prisma).catch(() => null), loadAfrimoneyDialNumber(prisma).catch(() => null)])
    : [null, null];

  const holdOpen = visit.status === "PENDING_PAYMENT" && visit.paymentHoldExpiresAt !== null && visit.paymentHoldExpiresAt > new Date();
  const canCancel = canTransition({
    actor: "patient",
    ownsRecord: true,
    from: visit.status,
    to: "CANCELLED_BY_PATIENT",
    now: new Date(),
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    reason: "Patient requested cancellation",
  }).ok;

  return (
    <section className="mbk-panel">
      {holdOpen && visit.paymentHoldExpiresAt ? (
        <div className="mbk-hold">
          <HoldCountdown expiresAt={visit.paymentHoldExpiresAt.toISOString()} />
        </div>
      ) : null}
      <VisitPayment
        appointmentId={visit.id}
        fee={visit.fee}
        doctor={visit.doctor.displayName}
        service={visit.service}
        when={visit.when}
        paid={paid}
        canPay={canPay}
        pendingApproval={visit.status === "PENDING_APPROVAL"}
        walletApi={walletApi}
        orange={orangeConfigured()}
        afrimoney={afrimoneyConfigured()}
        phone={account?.phoneE164 ?? ""}
        dialNumber={orangeDial ? formatOrangeDialNumber(orangeDial) : null}
        code={orangeDial && transferAmount ? orangeTransferCode(orangeDial, transferAmount) : null}
        dialHref={orangeDial && transferAmount ? orangeDialHref(orangeDial, transferAmount) : null}
        afriNumber={afriDial ? formatOrangeDialNumber(afriDial) : null}
        afriCode={afriDial && transferAmount ? afrimoneyTransferCode(afriDial, transferAmount) : null}
        afriHref={afriDial && transferAmount ? afrimoneyDialHref(afriDial, transferAmount) : null}
        waitingReference={waiting?.reference ?? null}
        waitingWallet={waiting?.providerCode === "AFRIMONEY" ? "Afrimoney" : waiting ? "Orange Money" : null}
        doneHref={`/patient/book/${offeringId}?step=confirmation&appointment=${visit.id}`}
      />
      {canCancel ? <CancelAppointmentForm appointmentId={visit.id} returnTo={`/patient/book/${offeringId}?step=payment&appointment=${visit.id}`} /> : null}
    </section>
  );
}

async function ConfirmationStep({ offeringId, appointmentId }: { offeringId: string; appointmentId: string }) {
  const loaded = await loadVisit(offeringId, appointmentId);
  if (!loaded.ok) return <p className="mbk-empty">{loaded.message}</p>;
  const { visit, userId } = loaded;
  const payments = await listAppointmentPayments(prisma, { appointmentId: visit.id, userId }).catch(() => null);
  const waiting = payments && payments.ok ? payments.payments.find((payment) => payment.status === "REQUIRES_ACTION" || payment.status === "PENDING") : undefined;
  const paid = visit.paymentStatuses.includes("PAID");
  const ended = visit.status === "EXPIRED_UNPAID" || visit.status === "CANCELLED_BY_PATIENT";
  const channelName = visit.visitChannel === "VIDEO" ? "Video Call" : visit.visitChannel === "AUDIO" ? "Audio Call" : visitChannelLabel(visit.visitChannel, visit.mode);
  const headline = ended
    ? "This hold ended"
    : visit.status === "PENDING_APPROVAL"
    ? "Waiting for the doctor"
    : paid || visit.status === "CONFIRMED"
      ? "Appointment confirmed"
      : waiting
        ? "Payment sent"
        : "Finish payment";
  const detail = ended
    ? "The time was released. Choose another open time to book again."
    : visit.status === "PENDING_APPROVAL"
    ? "The doctor will approve or decline this visit. It stays pending until then."
    : paid || visit.status === "CONFIRMED"
      ? "This time is booked. You can open the visit any time from Appointments."
      : waiting
        ? "The clinic has your payment and will confirm it. This time stays held."
        : "This time is held. Pay the fee to confirm the visit.";

  return (
    <section className="mbk-done">
      <span className="mbk-check" aria-hidden="true">{paid || visit.status === "CONFIRMED" ? "✓" : "!"}</span>
      <h2>{headline}</h2>
      <p>{detail}</p>
      <div className="mbk-doctor">
        <ProfilePhoto userId={visit.doctor.userId} name={visit.doctor.displayName} version={visit.doctor.imageVersion} size={44} alt="" />
        <span>
          <strong>{visit.doctor.displayName}</strong>
          <small>{visit.specialty} · {channelName}</small>
        </span>
        <span className="mbk-when mbk-when-line">
          <strong>{summaryDate(freetownDay(visit.startsAt))}</strong>
          <small>{formatNormalClock(visit.startsAt.getUTCHours() * 60 + visit.startsAt.getUTCMinutes())}</small>
          <small>{visit.fee}</small>
        </span>
      </div>
      {ended ? (
        <Link className="mbk-continue" href={`/patient/book/${offeringId}?channel=${visit.visitChannel === "AUDIO" ? "audio" : visit.visitChannel === "IN_PERSON" ? "in-person" : "video"}`}>Choose another time</Link>
      ) : !paid && visit.status === "PENDING_PAYMENT" && !waiting ? (
        <Link className="mbk-continue" href={`/patient/book/${offeringId}?step=payment&appointment=${visit.id}`}>Continue to payment</Link>
      ) : (
        <Link className="mbk-continue" href="/patient">Go to home</Link>
      )}
    </section>
  );
}

async function releaseDueHold(appointmentId: string) {
  if (!appointmentId) return;
  const due = await prisma.appointment.findFirst({
    where: { id: appointmentId, status: "PENDING_PAYMENT", paymentHoldExpiresAt: { lte: new Date() } },
    select: { doctorProfileId: true },
  }).catch(() => null);
  if (due) await expireOverdueHolds(prisma, due.doctorProfileId).catch(() => undefined);
}

async function loadVisit(offeringId: string, appointmentId: string) {
  if (!appointmentId) return { ok: false as const, message: "Choose a time before payment." };
  const cookieStore = await cookies();
  const user = await readPageSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (!user) return { ok: false as const, message: "Sign in again to continue this booking." };
  const result = await loadOwnedAppointment(prisma, { id: appointmentId, userId: user.id, as: "patient" });
  if (!result.ok) return { ok: false as const, message: "This booking could not be opened." };
  if (result.appointment.offeringId !== offeringId) return { ok: false as const, message: "This booking does not match the consultation." };
  return { ok: true as const, visit: result.appointment, userId: user.id };
}
