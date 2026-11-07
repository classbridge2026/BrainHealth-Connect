import type { Prisma, PrismaClient } from "@prisma/client";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { sendCareCircleEmail } from "@/lib/auth/delivery";
import { publicAppOrigin } from "@/lib/brand/metadata-base";
import { loadSystemName } from "@/lib/brand/system-name";
import { nextRetryAt, saveChannelNotice } from "@/lib/notifications/delivery";

type ReviewDb = Prisma.TransactionClient | PrismaClient;

export async function returnApprovedProfileToReview(
  db: ReviewDb,
  input: { doctorProfileId: string; actorUserId: string; now: Date },
): Promise<void> {
  await db.doctorProfile.update({
    where: { id: input.doctorProfileId },
    data: {
      verificationStatus: "SUBMITTED",
      submittedAt: input.now,
      rejectionReason: null,
    },
  });
  await db.doctorVerificationEvent.create({
    data: {
      doctorProfileId: input.doctorProfileId,
      actorUserId: input.actorUserId,
      action: "resubmitted",
      fromStatus: "APPROVED",
      toStatus: "SUBMITTED",
    },
  });
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: "doctor.verification.submitted",
      entityType: "DoctorProfile",
      entityId: input.doctorProfileId,
    },
  });
}

export async function notifyAdministratorsOfDoctorReview(
  db: PrismaClient,
  input: { doctorProfileId: string; doctorName: string; actorUserId: string },
): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where: {
        id: { not: input.actorUserId },
        status: "ACTIVE",
        deletedAt: null,
        roles: { some: { role: { code: { in: [ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE] } } } },
      },
      select: { id: true, email: true },
    });
    const base = publicAppOrigin();
    const path = `/admin/doctors/${input.doctorProfileId}`;
    const reviewUrl = base ? `${base}${path}` : path;
    const systemName = await loadSystemName(db);
    const preview = `${input.doctorName} updated a professional profile. It is waiting for verification.`;
    for (const admin of admins) {
      await db.notification.create({
        data: {
          recipientId: admin.id,
          channel: "IN_APP",
          type: "doctor.profile.review",
          title: "Doctor profile needs verification",
          preview,
          entityType: "DoctorProfile",
          entityId: input.doctorProfileId,
          status: "SENT",
        },
      });
      const email = await sendCareCircleEmail({
        to: admin.email,
        systemName,
        subject: "A doctor profile is waiting for verification",
        text: [`${preview}`, "", `Review the profile: ${reviewUrl}`].join("\n"),
      });
      if (email.reason === "not_configured") continue;
      await db.notification.create({
        data: {
          recipientId: admin.id,
          channel: "EMAIL",
          type: "doctor.profile.review",
          title: "Doctor profile needs verification",
          preview: email.delivered ? "A verification email was sent." : "A verification email could not be sent.",
          entityType: "DoctorProfile",
          entityId: input.doctorProfileId,
          status: email.delivered ? "SENT" : "FAILED",
        },
      });
    }
  } catch {
    console.error("doctor_review_notice_failed");
  }
}

export async function notifyDoctorOfDecision(
  db: PrismaClient,
  input: { userId: string; approved: boolean },
): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { email: true, status: true, deletedAt: true },
    });
    if (!user || user.deletedAt || user.status === "DISABLED" || !user.email.trim()) return;
    const title = input.approved ? "Your clinician profile was approved" : "Your clinician profile was not approved";
    const preview = input.approved
      ? "An administrator approved your professional profile."
      : "An administrator did not approve your professional profile. Sign in for the next step.";
    const type = input.approved ? "doctor.profile.approved" : "doctor.profile.rejected";
    await saveChannelNotice(db, {
      recipientId: input.userId,
      channel: "IN_APP",
      type,
      title,
      preview,
      entityType: "User",
      entityId: input.userId,
      status: "SENT",
    });
    const email = await sendCareCircleEmail({ to: user.email, subject: title, text: preview });
    await saveChannelNotice(db, {
      recipientId: input.userId,
      channel: "EMAIL",
      type,
      title,
      preview: email.delivered ? "A profile decision email was sent." : "A profile decision email could not be sent.",
      entityType: "User",
      entityId: input.userId,
      status: email.delivered ? "SENT" : "FAILED",
      errorCode: email.delivered ? null : email.reason,
      nextRetryAt: nextRetryAt(1, new Date(), email.delivered ? null : email.reason),
    });
  } catch {
    console.error("doctor_decision_notice_failed");
  }
}
