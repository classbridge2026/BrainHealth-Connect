import { randomUUID } from "node:crypto";
import type { Gender, Prisma, PrismaClient } from "@prisma/client";
import { displayEmail, normalizeEmail } from "@/lib/auth/email-address";
import { ADMIN_ROLE_CODE, PATIENT_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { forgetRememberedSessions } from "@/lib/auth/current-user";
import { hashPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import {
  isPlausibleDateOfBirth,
  parseCalendarDate,
  PASSWORD_HAS_LETTER,
  PASSWORD_HAS_NUMBER,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/validation/registration";
import { isUniqueConflict, isSchemaMismatch } from "@/lib/doctors/errors";
import { isPortalAdministrator, isSuperAdmin, isUuid, parseUserStatus, sanitizeMetadata, type UserStatusCode } from "./rules";

type Actor = { userId: string; roleCodes: string[] };
type Result = { ok: true; message: string } | { ok: false; message: string };

const NAME = /^[\p{L}][\p{L}' .-]{1,119}$/u;
const TIMEZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const GENDERS = ["MALE", "FEMALE"] as const;

const targetSelect = {
  id: true,
  email: true,
  emailNormalized: true,
  phoneE164: true,
  status: true,
  timezone: true,
  deletedAt: true,
  roles: { select: { role: { select: { code: true } } } },
  patientProfile: { select: { id: true } },
  doctorProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

type Target = Prisma.UserGetPayload<{ select: typeof targetSelect }>;

function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_NUMBER.test(password)) {
    return "Use at least one letter and one number.";
  }
  return null;
}

function nameProblem(value: string): string | null {
  const name = value.trim();
  if (!NAME.test(name)) return "Enter a name using letters, spaces, apostrophes, or hyphens.";
  return null;
}

async function activeSuperAdminCount(db: PrismaClient | Prisma.TransactionClient) {
  return db.userRole.count({
    where: { role: { code: SUPER_ADMIN_ROLE_CODE }, user: { status: "ACTIVE", deletedAt: null } },
  });
}

function elevated(codes: string[]) {
  return codes.includes(ADMIN_ROLE_CODE) || codes.includes(SUPER_ADMIN_ROLE_CODE);
}

function guard(actor: Actor, target: Target | null): string | null {
  if (!isPortalAdministrator(actor.roleCodes)) return "You cannot change this account.";
  if (!target || target.deletedAt) return "That account was not found.";
  if (actor.userId === target.id) return null;
  if (elevated(target.roles.map((entry) => entry.role.code)) && !isSuperAdmin(actor.roleCodes)) {
    return "Only a super administrator can change an administrator account.";
  }
  return null;
}

function failure(error: unknown, fallback: string): Result {
  if (isUniqueConflict(error)) return { ok: false, message: "That email or phone number is already in use." };
  if (isSchemaMismatch(error)) return { ok: false, message: "This action is not available until the latest database migration has been applied." };
  return { ok: false, message: fallback };
}

export async function createUserAccount(
  input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    roleCode: string;
    gender: string;
    dateOfBirth?: string;
  },
  deps: { db: PrismaClient; actor: Actor },
): Promise<Result> {
  if (!isPortalAdministrator(deps.actor.roleCodes)) return { ok: false, message: "You cannot create accounts." };
  const email = displayEmail(input.email);
  const emailNormalized = normalizeEmail(input.email);
  if (!email || !emailNormalized) return { ok: false, message: "Enter a valid email address." };
  const nameError = nameProblem(input.fullName);
  if (input.roleCode === PATIENT_ROLE_CODE && nameError) return { ok: false, message: nameError };
  if (input.roleCode !== PATIENT_ROLE_CODE && input.fullName.trim() && nameError) return { ok: false, message: nameError };
  const phoneRaw = input.phone.trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, message: "Enter a phone number with a country code, such as +232 76 000 001." };
  const passwordError = passwordProblem(input.password);
  if (passwordError) return { ok: false, message: passwordError };
  const roleCode =
    input.roleCode === ADMIN_ROLE_CODE || input.roleCode === SUPER_ADMIN_ROLE_CODE ? input.roleCode : PATIENT_ROLE_CODE;
  if (roleCode !== PATIENT_ROLE_CODE && !isSuperAdmin(deps.actor.roleCodes)) {
    return { ok: false, message: "Only a super administrator can create an administrator account." };
  }
  const gender = GENDERS.find((value) => value === input.gender) ?? null;
  if (roleCode === PATIENT_ROLE_CODE && !gender) return { ok: false, message: "Choose Male or Female." };
  const dateOfBirth = parseCalendarDate(input.dateOfBirth ?? "");
  if (roleCode === PATIENT_ROLE_CODE && (!dateOfBirth || !isPlausibleDateOfBirth(dateOfBirth))) {
    return { ok: false, message: "Enter a valid date of birth." };
  }

  try {
    const role = await deps.db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) return { ok: false, message: "That role is not in the catalog." };
    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const now = new Date();
    await deps.db.user.create({
      data: {
        id: userId,
        email,
        emailNormalized,
        phoneE164: phone,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: now,
        timezone: "Africa/Freetown",
        roles: { create: { roleId: role.id, grantedBy: deps.actor.userId } },
        ...(roleCode === PATIENT_ROLE_CODE && gender && dateOfBirth
          ? { patientProfile: { create: { fullName: input.fullName.trim(), gender: gender as Gender, dateOfBirth } } }
          : {}),
      },
    });
    await deps.db.auditLog.create({
      data: {
        actorUserId: deps.actor.userId,
        action: "user.created",
        entityType: "User",
        entityId: userId,
        metadata: sanitizeMetadata({ role: roleCode, status: "ACTIVE" }) ?? undefined,
      },
    });
    return { ok: true, message: `Created ${email}.` };
  } catch (error) {
    return failure(error, "The account could not be created.");
  }
}

export async function updateUserAccount(
  input: { userId: string; fullName: string; email: string; phone: string; timezone: string; status: string; password: string },
  deps: { db: PrismaClient; actor: Actor },
): Promise<Result> {
  if (!isUuid(input.userId)) return { ok: false, message: "That account was not found." };
  const email = displayEmail(input.email);
  const emailNormalized = normalizeEmail(input.email);
  if (!email || !emailNormalized) return { ok: false, message: "Enter a valid email address." };
  const phoneRaw = input.phone.trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, message: "Enter a phone number with a country code, such as +232 76 000 001." };
  const timezone = input.timezone.trim() || "Africa/Freetown";
  if (!TIMEZONE.test(timezone)) return { ok: false, message: "Enter a timezone such as Africa/Freetown." };
  const requestedStatus = parseUserStatus(input.status);
  if (!requestedStatus) return { ok: false, message: "Choose a valid account status." };
  const nextPassword = input.password.trim();
  if (nextPassword) {
    const passwordError = passwordProblem(nextPassword);
    if (passwordError) return { ok: false, message: passwordError };
  }

  try {
    const target = await deps.db.user.findUnique({ where: { id: input.userId }, select: targetSelect });
    const blocked = guard(deps.actor, target);
    if (blocked || !target) return { ok: false, message: blocked ?? "That account was not found." };
    const self = deps.actor.userId === target.id;
    const status = self ? target.status : requestedStatus;
    const codes = target.roles.map((entry) => entry.role.code);
    const hasProfile = Boolean(target.patientProfile || target.doctorProfile);
    if (hasProfile) {
      const nameError = nameProblem(input.fullName);
      if (nameError) return { ok: false, message: nameError };
    }
    if (codes.includes(SUPER_ADMIN_ROLE_CODE) && target.status === "ACTIVE" && status !== "ACTIVE") {
      const count = await activeSuperAdminCount(deps.db);
      if (count <= 1) return { ok: false, message: "The last active super administrator cannot be deactivated." };
    }
    const emailOwner = await deps.db.user.findUnique({ where: { emailNormalized }, select: { id: true } });
    if (emailOwner && emailOwner.id !== target.id) return { ok: false, message: "That email address is already in use." };
    if (phone) {
      const phoneOwner = await deps.db.user.findUnique({ where: { phoneE164: phone }, select: { id: true } });
      if (phoneOwner && phoneOwner.id !== target.id) return { ok: false, message: "That phone number is already in use." };
    }
    const passwordHash = nextPassword ? await hashPassword(nextPassword) : null;
    const emailChanged = emailNormalized !== target.emailNormalized;
    const signInChanged = emailChanged || Boolean(passwordHash);
    const nextStatus = signInChanged && status === "PENDING_VERIFICATION" ? "ACTIVE" : status;
    const data: Prisma.UserUpdateInput = {
      email,
      emailNormalized,
      phoneE164: phone,
      timezone,
      status: nextStatus as UserStatusCode,
      ...(signInChanged ? { emailVerifiedAt: new Date() } : {}),
    };
    if (passwordHash) data.passwordHash = passwordHash;
    await deps.db.user.update({ where: { id: target.id }, data });
    const fullName = input.fullName.trim();
    if (target.patientProfile && fullName) {
      await deps.db.patientProfile.update({ where: { id: target.patientProfile.id }, data: { fullName } });
    }
    if (target.doctorProfile && fullName) {
      await deps.db.doctorProfile.update({ where: { id: target.doctorProfile.id }, data: { fullName } });
    }
    if (nextStatus === "SUSPENDED" || nextStatus === "DISABLED" || passwordHash) {
      await deps.db.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      forgetRememberedSessions();
    }
    await deps.db.auditLog.create({
      data: {
        actorUserId: deps.actor.userId,
        action: "user.updated",
        entityType: "User",
        entityId: target.id,
        metadata: sanitizeMetadata({ status: nextStatus, emailChanged }) ?? undefined,
      },
    });
    return { ok: true, message: `Updated ${email}.` };
  } catch (error) {
    return failure(error, "The account could not be updated.");
  }
}

export async function closeUserAccount(input: { userId: string }, deps: { db: PrismaClient; actor: Actor }): Promise<Result> {
  if (!isUuid(input.userId)) return { ok: false, message: "That account was not found." };
  try {
    const target = await deps.db.user.findUnique({ where: { id: input.userId }, select: targetSelect });
    const blocked = guard(deps.actor, target);
    if (blocked || !target) return { ok: false, message: blocked ?? "That account was not found." };
    if (deps.actor.userId === target.id) return { ok: false, message: "You cannot change your own account." };
    const codes = target.roles.map((entry) => entry.role.code);
    if (codes.includes(SUPER_ADMIN_ROLE_CODE) && target.status === "ACTIVE") {
      const count = await activeSuperAdminCount(deps.db);
      if (count <= 1) return { ok: false, message: "The last active super administrator cannot be deleted." };
    }
    const now = new Date();
    await deps.db.user.update({
      where: { id: target.id },
      data: { deletedAt: now, status: "DISABLED" },
    });
    await deps.db.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: now },
    });
    forgetRememberedSessions();
    await deps.db.auditLog.create({
      data: {
        actorUserId: deps.actor.userId,
        action: "user.closed",
        entityType: "User",
        entityId: target.id,
        metadata: sanitizeMetadata({ email: target.email }) ?? undefined,
      },
    });
    return { ok: true, message: `Deleted ${target.email}.` };
  } catch (error) {
    return failure(error, "The account could not be deleted.");
  }
}
