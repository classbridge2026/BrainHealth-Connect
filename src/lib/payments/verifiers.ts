import type { PrismaClient } from "@prisma/client";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { isUuid } from "@/lib/admin/rules";

export const PAYMENT_VERIFIER_SETTING = "PAYMENT_VERIFIER_USER_IDS";

type Db = PrismaClient;

/** A super administrator can always verify. Another administrator can verify only after being selected. A doctor cannot. */
export function actorMayVerifyPayment(input: { roleCodes: readonly string[]; userId: string; verifierIds: readonly string[] }): boolean {
  if (input.roleCodes.includes(DOCTOR_ROLE_CODE) && !input.roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) return false;
  if (input.roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) return true;
  if (!input.roleCodes.includes(ADMIN_ROLE_CODE)) return false;
  return input.verifierIds.includes(input.userId);
}

/** A paid visit is open only after an administrator has verified the transfer. A zero fee needs no payment. */
export function adminVerifiedPayment(feeAmountMinor: number, paymentStatuses: readonly string[]): boolean {
  if (!Number.isSafeInteger(feeAmountMinor) || feeAmountMinor < 0) return false;
  if (feeAmountMinor === 0) return true;
  return paymentStatuses.includes("PAID");
}

export function parseVerifierIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === "string" && isUuid(item));
  return [...new Set(ids)];
}

export async function loadVerifierIds(db: Db): Promise<string[]> {
  if (!("platformSetting" in db) || typeof db.platformSetting?.findUnique !== "function") return [];
  try {
    const row = await db.platformSetting.findUnique({
      where: { key: PAYMENT_VERIFIER_SETTING },
      select: { valueJson: true },
    });
    return parseVerifierIds(row?.valueJson);
  } catch {
    return [];
  }
}

export async function listPaymentVerifierChoices(db: Db) {
  const [users, selected] = await Promise.all([
    db.user.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        roles: { some: { role: { code: ADMIN_ROLE_CODE } } },
        NOT: { roles: { some: { role: { code: { in: [SUPER_ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE] } } } } },
      },
      select: {
        id: true,
        email: true,
        patientProfile: { select: { fullName: true } },
      },
      orderBy: { email: "asc" },
    }),
    loadVerifierIds(db),
  ]);
  return users.map((user) => ({
    id: user.id,
    name: user.patientProfile?.fullName || user.email,
    email: user.email,
    selected: selected.includes(user.id),
  }));
}

export async function savePaymentVerifiers(
  db: Db,
  actor: { userId: string; roleCodes: readonly string[] },
  requested: readonly string[],
): Promise<{ ok: boolean; message: string }> {
  if (!actor.roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) {
    return { ok: false, message: "Only a super administrator can choose who verifies payments." };
  }
  const ids = parseVerifierIds([...requested]);
  try {
    const allowed = ids.length
      ? await db.user.findMany({
          where: {
            id: { in: ids },
            deletedAt: null,
            status: "ACTIVE",
            roles: { some: { role: { code: ADMIN_ROLE_CODE } } },
            NOT: { roles: { some: { role: { code: { in: [SUPER_ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE] } } } } },
          },
          select: { id: true },
        })
      : [];
    const savedIds = allowed.map((user) => user.id);
    await db.$transaction(async (tx) => {
      const saved = await tx.platformSetting.upsert({
        where: { key: PAYMENT_VERIFIER_SETTING },
        create: { key: PAYMENT_VERIFIER_SETTING, valueJson: savedIds },
        update: { valueJson: savedIds },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: "payment.verifiers_updated",
          entityType: "PlatformSetting",
          entityId: saved.id,
          metadata: { count: savedIds.length },
        },
      });
    });
    const dropped = ids.length !== savedIds.length;
    return {
      ok: true,
      message: dropped
        ? "Only active administrators were saved. A super administrator can always verify, and a doctor cannot."
        : savedIds.length === 0
          ? "Only a super administrator can verify payments."
          : "The selected administrators can verify payments. A super administrator can always verify.",
    };
  } catch {
    return { ok: false, message: "The payment verifiers could not be saved." };
  }
}
