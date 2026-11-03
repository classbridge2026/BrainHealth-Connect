import { Prisma } from "@prisma/client";
import type { ReconciliationFlag } from "./rules";
import { isUuid, PLATFORM_TIMEZONE } from "./rules";

export type BadgeTone = "teal" | "amber" | "red" | "navy" | "slate";

export function formatPlatformWhen(value: Date): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: PLATFORM_TIMEZONE,
    }).format(value) + " GMT"
  );
}

export function formatPlatformDay(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: PLATFORM_TIMEZONE }).format(value);
}

export function formatMinorMoney(amountMinor: number, currency: string): string {
  return `${new Prisma.Decimal(amountMinor).div(100).toFixed(2)} ${currency.trim()}`;
}

export function accessLabel(roleCodes: string[]): string {
  if (roleCodes.includes("SUPER_ADMIN")) return "Super administrator";
  if (roleCodes.includes("ADMIN")) return "Administrator";
  if (roleCodes.includes("DOCTOR") && roleCodes.includes("PATIENT")) return "Doctor and patient";
  if (roleCodes.includes("DOCTOR")) return "Doctor";
  if (roleCodes.includes("PATIENT")) return "Patient";
  return "No role";
}

export function userStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "PENDING_VERIFICATION":
      return "Pending verification";
    case "SUSPENDED":
      return "Suspended";
    case "DISABLED":
      return "Disabled";
    default:
      return status;
  }
}

export function userStatusTone(status: string): BadgeTone {
  switch (status) {
    case "ACTIVE":
      return "teal";
    case "PENDING_VERIFICATION":
      return "amber";
    case "SUSPENDED":
      return "navy";
    default:
      return "red";
  }
}

export function appointmentStatusLabel(status: string): string {
  switch (status) {
    case "PENDING_PAYMENT":
      return "Pending payment";
    case "PENDING_APPROVAL":
      return "Pending approval";
    case "EXPIRED_UNPAID":
      return "Expired unpaid";
    case "CONFIRMED":
      return "Confirmed";
    case "CHECKED_IN":
      return "Checked in";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED_BY_PATIENT":
      return "Cancelled by patient";
    case "CANCELLED_BY_DOCTOR":
      return "Cancelled by doctor";
    case "CANCELLED_BY_ADMIN":
      return "Cancelled by administrator";
    case "NO_SHOW":
      return "No show";
    case "RESCHEDULED":
      return "Rescheduled";
    default:
      return status;
  }
}

export function appointmentStatusTone(status: string): BadgeTone {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
    case "CHECKED_IN":
    case "IN_PROGRESS":
      return "teal";
    case "PENDING_PAYMENT":
    case "PENDING_APPROVAL":
    case "EXPIRED_UNPAID":
      return "amber";
    case "NO_SHOW":
      return "red";
    case "CANCELLED_BY_PATIENT":
    case "CANCELLED_BY_DOCTOR":
    case "CANCELLED_BY_ADMIN":
    case "RESCHEDULED":
      return "navy";
    default:
      return "slate";
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "REQUIRES_ACTION":
      return "Waiting for administrator verification";
    case "PAID":
      return "Verified by administrator";
    case "FAILED":
      return "Failed";
    case "REFUNDED":
      return "Refunded";
    case "PARTIALLY_REFUNDED":
      return "Partially refunded";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function paymentStatusTone(status: string): BadgeTone {
  switch (status) {
    case "PAID":
      return "teal";
    case "PENDING":
    case "REQUIRES_ACTION":
      return "amber";
    case "FAILED":
      return "red";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "CANCELLED":
      return "navy";
    default:
      return "slate";
  }
}

export function reconciliationLabel(flag: ReconciliationFlag): string {
  switch (flag) {
    case "late_payment_after_released_hold":
      return "Paid after the booking hold was released";
    case "paid_without_confirmed_appointment":
      return "Paid while the appointment is not confirmed";
    case "event_status_differs":
      return "Latest provider event does not match the payment";
    case "unresolved_payment_status":
      return "Failed or waiting on the payer";
    case "no_provider_reference":
      return "No provider reference";
    case "pending_after_expired_booking":
      return "Still pending after the booking expired";
  }
}

export function adminEntityHref(entityType: string, entityId: string): string | null {
  if (entityType === "PlatformSetting") return "/admin/settings";
  if (!isUuid(entityId)) return null;
  switch (entityType) {
    case "User":
      return `/admin/users/${entityId}`;
    case "Appointment":
      return `/admin/appointments/${entityId}`;
    case "Payment":
      return `/admin/payments/${entityId}`;
    case "DoctorProfile":
      return `/admin/doctors/${entityId}`;
    case "PatientProfile":
      return `/admin/patients/${entityId}`;
    case "Specialty":
      return "/admin/specialties";
    case "ConsultationService":
      return "/admin/services";
    case "DoctorOffering":
      return "/admin/offerings";
    case "Location":
      return "/admin/locations";
    default:
      return null;
  }
}

export function metadataPreview(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const blocked = /password|token|secret|hash|cvv|card|pan|credential|body|storagekey|diagnosis|cookie|authorization/i;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 12)) {
    if (blocked.test(key)) continue;
    if (entry === null || typeof entry === "number" || typeof entry === "boolean") safe[key] = entry;
    else if (typeof entry === "string") safe[key] = entry.slice(0, 80);
  }
  if (Object.keys(safe).length === 0) return "—";
  const text = JSON.stringify(safe);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
