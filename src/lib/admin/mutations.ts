import type { Prisma, PrismaClient } from "@prisma/client";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { normalizeEmail } from "@/lib/auth/email-address";
import { syncEncounterStatus } from "@/lib/clinical/records";
import { notifyAppointmentParties } from "@/lib/appointments/email-notice";
import { expireOverdueHolds, HOLD_MINUTES_SETTING_KEY } from "@/lib/appointments/payment-holds";
import { forgetRememberedSessions } from "@/lib/auth/current-user";
import { parseSystemName, SYSTEM_NAME_SETTING_KEY } from "@/lib/brand/system-name";
import { forgetNoticeSummary } from "@/lib/notifications/delivery";
import { isUniqueConflict, isSchemaMismatch } from "@/lib/doctors/errors";
import {
  accountStatusDecision,
  adminCancelDecision,
  cleanOperationalReason,
  isPortalAdministrator,
  isSuperAdmin,
  isUuid,
  parseHoldMinutes,
  roleChangeDecision,
  sanitizeMetadata,
  type UserStatusCode,
} from "./rules";

type Actor = { userId: string; roleCodes: string[] };
type Result = { ok: true; message: string } | { ok: false; message: string };

const ROLE_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Only a super administrator can change administrator roles.",
  SELF: "You cannot change your own administrator roles.",
  UNKNOWN_ROLE: "Patient and doctor roles are not assigned from this page.",
  NOT_HELD: "You cannot grant a privilege you do not already have.",
  ALREADY: "That account already has this role.",
  MISSING: "That account does not have this role.",
  LAST_SUPER_ADMIN: "The last active super administrator cannot be demoted.",
};

const STATUS_MESSAGES: Record<string, string> = {
  FORBIDDEN: "You cannot change this account.",
  SELF: "You cannot change your own account status.",
  DELETED: "This account is closed and cannot be changed.",
  LAST_SUPER_ADMIN: "The last active super administrator cannot be suspended.",
  UNSUPPORTED: "Only an active account can be suspended, and only a suspended account can be reactivated.",
};

type TargetUser = {
  id: string;
  status: UserStatusCode;
  deletedAt: Date | null;
  roles: Array<{ role: { code: string } }>;
};

const targetSelect = {
  id: true,
  status: true,
  deletedAt: true,
  roles: { select: { role: { select: { code: true } } } },
} satisfies Prisma.UserSelect;

function roleCodesOf(user: TargetUser): string[] {
  return user.roles.map((entry) => entry.role.code);
}

async function countActiveSuperAdmins(db: PrismaClient | Prisma.TransactionClient): Promise<number> {
  return db.userRole.count({
    where: {
      role: { code: SUPER_ADMIN_ROLE_CODE },
      user: { status: "ACTIVE", deletedAt: null },
    },
  });
}

function failure(error: unknown, fallback: string): Result {
  if (isUniqueConflict(error)) return { ok: false, message: "That role is already assigned." };
  if (isSchemaMismatch(error)) return { ok: false, message: "This action is not available until the latest database migration has been applied." };
  return { ok: false, message: fallback };
}

export async function changeUserAccountStatus(
  input: { userId: string; change: "suspend" | "reactivate"; reason: string },
  deps: { db: PrismaClient; actor: Actor },
): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: STATUS_MESSAGES.FORBIDDEN };
  if (!isUuid(input.userId)) return { ok: false, message: "That account was not found." };
  const reason = cleanOperationalReason(input.reason);
  if (!reason) return { ok: false, message: "Enter an operational reason between 10 and 500 characters." };
  try {
    const target = (await deps.db.user.findUnique({ where: { id: input.userId }, select: targetSelect })) as TargetUser | null;
    if (!target) return { ok: false, message: "That account was not found." };
    const activeSuperAdminCount = roleCodesOf(target).includes(SUPER_ADMIN_ROLE_CODE) ? await countActiveSuperAdmins(deps.db) : 0;
    const decision = accountStatusDecision({
      actorId: deps.actor.userId,
      actorRoles: deps.actor.roleCodes,
      targetId: target.id,
      targetStatus: target.status,
      targetDeleted: Boolean(target.deletedAt),
      targetRoles: roleCodesOf(target),
      change: input.change,
      activeSuperAdminCount,
    });
    if (!decision.ok) return { ok: false, message: STATUS_MESSAGES[decision.code] };
    const next = decision.next;
    const saved = await deps.db.$transaction(async (tx) => {
      const current = (await tx.user.findUnique({ where: { id: target.id }, select: targetSelect })) as TargetUser | null;
      if (!current) return { ok: false as const, message: "That account was not found." };
      const freshCount = roleCodesOf(current).includes(SUPER_ADMIN_ROLE_CODE) ? await countActiveSuperAdmins(tx) : 0;
      const again = accountStatusDecision({
        actorId: deps.actor.userId,
        actorRoles: deps.actor.roleCodes,
        targetId: current.id,
        targetStatus: current.status,
        targetDeleted: Boolean(current.deletedAt),
        targetRoles: roleCodesOf(current),
        change: input.change,
        activeSuperAdminCount: freshCount,
      });
      if (!again.ok) return { ok: false as const, message: STATUS_MESSAGES[again.code] };
      await tx.user.update({ where: { id: current.id }, data: { status: again.next } });
      if (again.next === "SUSPENDED") {
        await tx.session.updateMany({
          where: { userId: current.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: again.next === "SUSPENDED" ? "user.suspended" : "user.reactivated",
          entityType: "User",
          entityId: current.id,
          metadata: sanitizeMetadata({ from: current.status, to: again.next, reason }) ?? undefined,
        },
      });
      return { ok: true as const, message: "" };
    });
    if (!saved.ok) return saved;
    if (next === "SUSPENDED") forgetRememberedSessions();
    return {
      ok: true,
      message: next === "SUSPENDED" ? "The account is suspended and its open sessions were revoked." : "The account is active again.",
    };
  } catch (error) {
    return failure(error, "The account status could not be saved.");
  }
}

export async function changeElevatedRole(
  input: { userId: string; roleCode: string; change: "grant" | "revoke" },
  deps: { db: PrismaClient; actor: Actor },
): Promise<Result> {
  if (!isSuperAdmin(deps.actor.roleCodes)) return { ok: false, message: ROLE_MESSAGES.FORBIDDEN };
  if (!isUuid(input.userId)) return { ok: false, message: "That account was not found." };
  if (input.roleCode !== ADMIN_ROLE_CODE && input.roleCode !== SUPER_ADMIN_ROLE_CODE) {
    return { ok: false, message: ROLE_MESSAGES.UNKNOWN_ROLE };
  }
  try {
    const target = (await deps.db.user.findUnique({ where: { id: input.userId }, select: targetSelect })) as TargetUser | null;
    if (!target) return { ok: false, message: "That account was not found." };
    if (input.change === "grant" && (target.status !== "ACTIVE" || target.deletedAt)) {
      return { ok: false, message: "Only an active account can receive an administrator role." };
    }
    const activeSuperAdminCount = await countActiveSuperAdmins(deps.db);
    const decision = roleChangeDecision({
      actorId: deps.actor.userId,
      actorRoles: deps.actor.roleCodes,
      targetId: target.id,
      targetRoles: roleCodesOf(target),
      roleCode: input.roleCode,
      change: input.change,
      activeSuperAdminCount,
      targetIsActiveSuperAdmin: target.status === "ACTIVE" && !target.deletedAt && roleCodesOf(target).includes(SUPER_ADMIN_ROLE_CODE),
    });
    if (!decision.ok) return { ok: false, message: ROLE_MESSAGES[decision.code] };
    const saved = await deps.db.$transaction(async (tx) => {
      const current = (await tx.user.findUnique({ where: { id: target.id }, select: targetSelect })) as TargetUser | null;
      if (!current) return { ok: false as const, message: "That account was not found." };
      const freshCount = await countActiveSuperAdmins(tx);
      const again = roleChangeDecision({
        actorId: deps.actor.userId,
        actorRoles: deps.actor.roleCodes,
        targetId: current.id,
        targetRoles: roleCodesOf(current),
        roleCode: input.roleCode,
        change: input.change,
        activeSuperAdminCount: freshCount,
        targetIsActiveSuperAdmin: current.status === "ACTIVE" && !current.deletedAt && roleCodesOf(current).includes(SUPER_ADMIN_ROLE_CODE),
      });
      if (!again.ok) return { ok: false as const, message: ROLE_MESSAGES[again.code] };
      if (input.change === "grant") {
        const role = await tx.role.findUnique({ where: { code: input.roleCode }, select: { id: true } });
        if (!role) return { ok: false as const, message: "That role is not in the catalog." };
        await tx.userRole.create({ data: { userId: current.id, roleId: role.id, grantedBy: deps.actor.userId } });
      } else {
        await tx.userRole.deleteMany({ where: { userId: current.id, role: { code: input.roleCode } } });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: input.change === "grant" ? "user.role_granted" : "user.role_revoked",
          entityType: "User",
          entityId: current.id,
          metadata: sanitizeMetadata({ role: input.roleCode }) ?? undefined,
        },
      });
      return { ok: true as const, message: "" };
    });
    if (!saved.ok) return saved;
    return {
      ok: true,
      message: input.change === "grant" ? "The administrator role was granted." : "The administrator role was removed.",
    };
  } catch (error) {
    return failure(error, "The role change could not be saved.");
  }
}

export async function grantElevatedRoleByEmail(
  input: { email: string; roleCode: string },
  deps: { db: PrismaClient; actor: Actor },
): Promise<Result> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, message: "Enter the account email address." };
  try {
    const user = await deps.db.user.findUnique({ where: { emailNormalized: email }, select: { id: true } });
    if (!user) return { ok: false, message: "No account uses that email." };
    return changeElevatedRole({ userId: user.id, roleCode: input.roleCode, change: "grant" }, deps);
  } catch (error) {
    return failure(error, "The role could not be granted.");
  }
}

export async function cancelAppointmentAsAdmin(
  input: { appointmentId: string; reason: string },
  deps: { db: PrismaClient; actor: Actor },
): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "Only an administrator can cancel an appointment." };
  if (!isUuid(input.appointmentId)) return { ok: false, message: "That appointment was not found." };
  const reason = cleanOperationalReason(input.reason);
  if (!reason) return { ok: false, message: "Enter an operational reason between 10 and 500 characters." };
  try {
    const appointment = await deps.db.appointment.findUnique({
      where: { id: input.appointmentId },
      select: { id: true, status: true },
    });
    if (!appointment) return { ok: false, message: "That appointment was not found." };
    if (!adminCancelDecision(appointment.status)) {
      return { ok: false, message: "This appointment can no longer be cancelled. Its history was left unchanged." };
    }
    const now = new Date();
    const saved = await deps.db.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status },
        data: {
          status: "CANCELLED_BY_ADMIN",
          cancelledAt: now,
          cancellationReason: reason,
        },
      });
      if (updated.count !== 1) return { ok: false as const, message: "The appointment changed before it could be cancelled. Refresh and review it again." };
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          actorUserId: deps.actor.userId,
          fromStatus: appointment.status,
          toStatus: "CANCELLED_BY_ADMIN",
          detail: "cancelled_by_administrator",
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "appointment.cancelled_by_admin",
          entityType: "Appointment",
          entityId: appointment.id,
          metadata: sanitizeMetadata({ from: appointment.status, reason }) ?? undefined,
        },
      });
      return { ok: true as const, message: "" };
    });
    if (!saved.ok) return saved;
    await syncEncounterStatus(deps.db, { appointmentId: appointment.id, status: "CANCELLED", at: now });
    await notifyAppointmentParties(deps.db, { appointmentId: appointment.id, event: "cancelled" });
    return { ok: true, message: "The appointment was cancelled. Payment records were not changed." };
  } catch (error) {
    return failure(error, "The appointment could not be cancelled.");
  }
}

export async function updatePaymentHoldMinutes(minutesInput: string, deps: { db: PrismaClient; actor: Actor }): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "Only an administrator can change platform settings." };
  const minutes = parseHoldMinutes(minutesInput);
  if (minutes === null) return { ok: false, message: "Enter a payment hold between 5 and 120 minutes." };
  try {
    await deps.db.$transaction(async (tx) => {
      const saved = await tx.platformSetting.upsert({
        where: { key: HOLD_MINUTES_SETTING_KEY },
        create: { key: HOLD_MINUTES_SETTING_KEY, valueJson: minutes },
        update: { valueJson: minutes },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "settings.hold_minutes_updated",
          entityType: "PlatformSetting",
          entityId: saved.id,
          metadata: sanitizeMetadata({ minutes }) ?? undefined,
        },
      });
    });
    return { ok: true, message: `New bookings keep an unpaid hold for ${minutes} minutes. Existing holds were not changed.` };
  } catch (error) {
    return failure(error, "The payment hold could not be saved.");
  }
}

export async function updateSystemName(nameInput: string, deps: { db: PrismaClient; actor: Actor }): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "Only an administrator can change platform settings." };
  const systemName = parseSystemName(nameInput);
  if (!systemName) {
    return { ok: false, message: "Enter a system name of 2 to 80 characters. Use letters, numbers, spaces, and simple punctuation." };
  }
  try {
    await deps.db.$transaction(async (tx) => {
      const saved = await tx.platformSetting.upsert({
        where: { key: SYSTEM_NAME_SETTING_KEY },
        create: { key: SYSTEM_NAME_SETTING_KEY, valueJson: systemName },
        update: { valueJson: systemName },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "settings.system_name_updated",
          entityType: "PlatformSetting",
          entityId: saved.id,
          metadata: sanitizeMetadata({ systemName }) ?? undefined,
        },
      });
    });
    return { ok: true, message: `The system name is now ${systemName}.` };
  } catch (error) {
    return failure(error, "The system name could not be saved.");
  }
}

export async function markNotificationRead(notificationId: string, deps: { db: PrismaClient; actor: Actor }): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "Only an administrator can update notifications." };
  if (!isUuid(notificationId)) return { ok: false, message: "That notification was not found." };
  try {
    const note = await deps.db.notification.findFirst({
      where: { id: notificationId, recipientId: deps.actor.userId },
      select: { id: true, status: true, readAt: true },
    });
    if (!note) return { ok: false, message: "That notification was not found." };
    if (note.readAt) return { ok: true, message: "That notification is already read." };
    await deps.db.notification.update({
      where: { id: note.id },
      data: { readAt: new Date(), status: note.status === "FAILED" ? "FAILED" : "READ" },
    });
    forgetNoticeSummary(deps.actor.userId);
    return { ok: true, message: "The notification is marked as read." };
  } catch (error) {
    return failure(error, "The notification could not be updated.");
  }
}

export async function markAllNotificationsRead(deps: { db: PrismaClient; actor: Actor }): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "Only an administrator can update notifications." };
  try {
    const now = new Date();
    await deps.db.notification.updateMany({
      where: { recipientId: deps.actor.userId, readAt: null, status: { not: "FAILED" } },
      data: { readAt: now, status: "READ" },
    });
    await deps.db.notification.updateMany({
      where: { recipientId: deps.actor.userId, readAt: null, status: "FAILED" },
      data: { readAt: now },
    });
    forgetNoticeSummary(deps.actor.userId);
    return { ok: true, message: "Unread notifications are marked as read. Failed deliveries stay failed." };
  } catch (error) {
    return failure(error, "Notifications could not be updated.");
  }
}

export async function processExpiredHolds(deps: { db: PrismaClient; actor: Actor }): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "Only an administrator can process expired holds." };
  try {
    const ids = await expireOverdueHolds(deps.db);
    if (ids.length === 0) return { ok: true, message: "No overdue unpaid holds were waiting." };
    await deps.db.auditLog.create({
      data: {
        actorUserId: deps.actor.userId,
        action: "operations.holds_expired",
        entityType: "Appointment",
        entityId: ids[0],
        metadata: sanitizeMetadata({ count: ids.length }) ?? undefined,
      },
    });
    return { ok: true, message: `${ids.length} overdue unpaid hold${ids.length === 1 ? "" : "s"} moved to expired unpaid.` };
  } catch (error) {
    return failure(error, "Expired holds could not be processed.");
  }
}
