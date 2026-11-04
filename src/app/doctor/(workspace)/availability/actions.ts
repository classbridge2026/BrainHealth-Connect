"use server";

import { revalidatePath } from "next/cache";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { forgetDoctorSchedule } from "@/lib/appointments/queries";
import { addTimeOff, deactivateAvailabilityRule, removeTimeOff, saveAvailabilityRule, type ScheduleResult } from "@/lib/appointments/schedule";
import { atMinutes, parseCalendarDate, parseClock } from "@/lib/appointments/time";
import { prisma } from "@/lib/db/prisma";

function actorOf(user: { id: string; roleCodes: string[] }) {
  return { userId: user.id, roleCodes: user.roleCodes };
}

function refresh(doctorProfileId: string) {
  if (doctorProfileId) forgetDoctorSchedule(doctorProfileId);
  revalidatePath("/doctor/availability");
  revalidatePath("/doctor/appointments");
  revalidatePath(`/admin/doctors/${doctorProfileId}/availability`);
}

export async function saveRuleAction(_previous: ScheduleResult, formData: FormData): Promise<ScheduleResult> {
  const user = await requireStoredRoles([DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const doctorProfileId = String(formData.get("doctorProfileId") ?? "");
  const result = await saveAvailabilityRule(
    {
      actor: actorOf(user),
      doctorProfileId: doctorProfileId || null,
      dayOfWeek: Number(formData.get("dayOfWeek")),
      start: String(formData.get("start") ?? ""),
      end: String(formData.get("end") ?? ""),
      mode: String(formData.get("mode") ?? "") as "ONLINE" | "IN_PERSON" | "BOTH",
      clinic: String(formData.get("clinic") ?? ""),
      offeringId: String(formData.get("offeringId") ?? "") || null,
      validFrom: String(formData.get("validFrom") ?? ""),
      validUntil: String(formData.get("validUntil") ?? ""),
    },
    { db: prisma },
  );
  if (result.ok) refresh(doctorProfileId);
  return result;
}

export async function deactivateRuleAction(_previous: ScheduleResult, formData: FormData): Promise<ScheduleResult> {
  const user = await requireStoredRoles([DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const doctorProfileId = String(formData.get("doctorProfileId") ?? "");
  const result = await deactivateAvailabilityRule({ actor: actorOf(user), doctorProfileId: doctorProfileId || null, ruleId: String(formData.get("ruleId") ?? "") }, { db: prisma });
  if (result.ok) refresh(doctorProfileId);
  return result;
}

export async function addTimeOffAction(_previous: ScheduleResult, formData: FormData): Promise<ScheduleResult> {
  const user = await requireStoredRoles([DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const doctorProfileId = String(formData.get("doctorProfileId") ?? "");
  const startDay = parseCalendarDate(String(formData.get("startDate") ?? ""));
  const endDay = parseCalendarDate(String(formData.get("endDate") ?? ""));
  const startMinute = parseClock(String(formData.get("startTime") ?? ""));
  const endMinute = parseClock(String(formData.get("endTime") ?? ""));
  if (!startDay || !endDay || startMinute === null || endMinute === null) {
    return { ok: false, message: "Enter a start and end date and time. Times use Africa/Freetown (GMT)." };
  }
  const result = await addTimeOff(
    {
      actor: actorOf(user),
      doctorProfileId: doctorProfileId || null,
      startsAt: atMinutes(startDay, startMinute),
      endsAt: atMinutes(endDay, endMinute),
      reason: String(formData.get("reason") ?? ""),
    },
    { db: prisma },
  );
  if (result.ok) refresh(doctorProfileId);
  return result;
}

export async function removeTimeOffAction(_previous: ScheduleResult, formData: FormData): Promise<ScheduleResult> {
  const user = await requireStoredRoles([DOCTOR_ROLE_CODE, ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const doctorProfileId = String(formData.get("doctorProfileId") ?? "");
  const result = await removeTimeOff({ actor: actorOf(user), doctorProfileId: doctorProfileId || null, timeOffId: String(formData.get("timeOffId") ?? "") }, { db: prisma });
  if (result.ok) refresh(doctorProfileId);
  return result;
}
