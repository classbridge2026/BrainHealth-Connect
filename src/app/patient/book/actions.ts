"use server";

import { redirect } from "next/navigation";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { bookScheduledSlot, bookingMessage, type BookingCode } from "@/lib/appointments/booking";
import { parseVisitChannel } from "@/lib/appointments/channel";
import { prisma } from "@/lib/db/prisma";

export type BookState = { message?: string };

export async function bookSlotAction(_previous: BookState, formData: FormData): Promise<BookState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  const location = String(formData.get("locationId") ?? "").trim();
  const channel = parseVisitChannel(String(formData.get("channel") ?? ""));
  if (!channel) return { message: "Choose video, audio, or in person before you confirm." };
  const result = await bookScheduledSlot(
    {
      actorUserId: user.id,
      offeringId: String(formData.get("offeringId") ?? ""),
      locationId: location || null,
      startsAt,
      concern: String(formData.get("concern") ?? ""),
      channel,
    },
    { db: prisma },
  );
  if (!result.ok) return { message: bookingMessage(result.code as BookingCode) };
  const offeringId = String(formData.get("offeringId") ?? "");
  if (String(formData.get("wizard") ?? "") === "mobile" && offeringId) {
    const step = result.paymentHoldExpiresAt ? "payment" : "confirmation";
    redirect(`/patient/book/${offeringId}?step=${step}&appointment=${result.appointmentId}`);
  }
  redirect(`/patient/appointments/${result.appointmentId}`);
}
