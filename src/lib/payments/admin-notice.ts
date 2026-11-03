import type { PrismaClient } from "@prisma/client";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { saveChannelNotice } from "@/lib/notifications/delivery";
import { loadVerifierIds } from "./verifiers";

/** Tells the super administrator and the administrators they selected that a phone transfer is waiting. */
export async function notifyAdminsToVerifyPayment(
  db: PrismaClient,
  input: { paymentId: string; wallet: string; reference: string },
) {
  if (!("user" in db) || typeof db.user?.findMany !== "function") return;
  try {
    const verifierIds = await loadVerifierIds(db);
    const admins = await db.user.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        OR: [
          { roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } },
          {
            id: { in: verifierIds },
            roles: { some: { role: { code: ADMIN_ROLE_CODE } } },
            NOT: { roles: { some: { role: { code: DOCTOR_ROLE_CODE } } } },
          },
        ],
      },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        saveChannelNotice(db, {
          recipientId: admin.id,
          channel: "IN_APP",
          type: "payment.verification_requested",
          title: "Verify a payment",
          preview: `${input.wallet} ${input.reference} is waiting. Open it and confirm the amount arrived.`,
          entityType: "Payment",
          entityId: input.paymentId,
          status: "SENT",
        }),
      ),
    );
  } catch {
    console.error("payment_admin_notice_failed");
  }
}
