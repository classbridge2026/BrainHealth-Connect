import type { JoinCode } from "./eligibility";

export function joinDenialMessage(code: JoinCode): string {
  switch (code) {
    case "NOT_FOUND":
      return "That consultation could not be found.";
    case "INACTIVE":
      return "This account cannot join a consultation.";
    case "NOT_ONLINE":
      return "This is an in-person appointment, so there is no video room.";
    case "PAYMENT":
      return "This consultation opens after the visit fee is paid and an administrator verifies it.";
    case "AWAITING_APPROVAL":
      return "This booking is waiting for the doctor to approve it.";
    case "CANCELLED":
      return "This appointment was cancelled, so the consultation cannot be joined.";
    case "COMPLETED":
      return "This consultation has been completed. A clinical summary appears only after your clinician releases it.";
    case "NO_SHOW":
      return "This appointment was marked as a no-show, so the consultation cannot be joined.";
    case "RESCHEDULED":
      return "This appointment was rescheduled. Open the new appointment to continue.";
    case "EXPIRED":
      return "The join window for this appointment has ended.";
    case "TOO_EARLY":
      return "Your consultation is not open yet. Please return closer to your appointment time.";
    case "DOCTOR_UNAVAILABLE":
      return "This consultation is not available.";
    case "UNSUPPORTED":
      return "This appointment cannot be joined.";
  }
}

export function liveKitUnavailableMessage(): string {
  return "Video and audio are unavailable until the consultation service is configured. Your appointment has not changed.";
}

export function connectionFailureMessage(): string {
  return "The consultation could not connect. Check your internet connection, then try again. The appointment was not completed.";
}

export function connectionQualityLabel(quality: string): string {
  switch (quality) {
    case "excellent":
      return "Excellent connection";
    case "good":
      return "Good connection";
    case "poor":
      return "Weak connection";
    case "lost":
      return "Connection lost";
    default:
      return "Connection quality is not available yet";
  }
}

export function mediaAccessMessage(kind: "denied" | "missing" | "insecure" | "busy" | "failed"): string {
  switch (kind) {
    case "denied":
      return "The browser blocked the camera or microphone. Use the site controls in the address bar, allow access for this page, and choose Test devices again.";
    case "missing":
      return "No camera or microphone was found. You can continue with audio only if a microphone is available.";
    case "insecure":
      return "Camera and microphone access needs a secure page. Use this site over HTTPS. Localhost is treated as secure by current browsers.";
    case "busy":
      return "The camera or microphone is in use by another app. Close the other app and try again.";
    case "failed":
      return "The camera or microphone could not be opened. Check the device connection and try again.";
  }
}

export function phaseMessage(phase: string, when: string, audience: "patient" | "doctor" = "doctor"): string {
  const patient = audience === "patient";
  switch (phase) {
    case "scheduled":
      return patient
        ? `Your consultation is not open yet. Please return closer to your appointment time (${when}, Africa/Freetown).`
        : `You can start this consultation before ${when}. The appointment time uses Africa/Freetown (GMT).`;
    case "ready":
      return patient
        ? "You can join this online consultation. Check your camera and microphone first. If your doctor is already in the room, you can also accept the call."
        : "You can start this online consultation now, including before the appointment time.";
    case "in_progress":
      return patient
        ? "Your consultation is in progress. You can return to the room. Leaving the video does not complete the visit."
        : "This consultation is in progress. You can join again if you were disconnected. Leaving the video does not complete the visit.";
    case "waiting_payment":
      return patient
        ? "This consultation opens after the visit fee is paid and an administrator verifies it."
        : "This consultation stays closed until the visit fee is paid and an administrator verifies it. A doctor cannot verify a payment.";
    case "completed":
      return "This consultation is complete. A patient summary appears only after the clinician releases it.";
    case "cancelled":
      return "This appointment is no longer active.";
    case "expired":
      return "The time window for joining this consultation has passed.";
    case "in_person":
      return "Attend this visit at the clinic. There is no online room for an in-person appointment.";
    default:
      return "This consultation cannot be joined from this account.";
  }
}
