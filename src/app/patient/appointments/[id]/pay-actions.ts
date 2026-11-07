"use server";

import { revalidatePath } from "next/cache";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { beginVisitPayment, refreshVisitPayment } from "@/lib/payments/collect";
import { reportAfrimoneyTransfer } from "@/lib/payments/afrimoney-transfer";
import { reportOrangeTransfer } from "@/lib/payments/orange-transfer";
import { inspectProfileImage } from "@/lib/profile/image";

export type PayState = { message?: string; tone?: "ok" | "error"; paymentUrl?: string };

export async function startWalletPaymentAction(_previous: PayState, formData: FormData): Promise<PayState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await beginVisitPayment(
    {
      actorUserId: user.id,
      appointmentId,
      provider: String(formData.get("provider") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    },
    prisma,
  );
  revalidatePath(`/patient/appointments/${appointmentId}`);
  revalidatePath("/patient/payments");
  revalidatePath("/patient", "layout");
  revalidatePath("/admin/payments");
  revalidatePath("/admin", "layout");
  const started = Boolean(result.paymentUrl) || (result.message ?? "").startsWith("Afrimoney sent a prompt");
  return { message: result.message, paymentUrl: result.paymentUrl, tone: started ? "ok" : "error" };
}

export async function refreshWalletPaymentAction(_previous: PayState, formData: FormData): Promise<PayState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await refreshVisitPayment({ actorUserId: user.id, appointmentId }, prisma);
  revalidatePath(`/patient/appointments/${appointmentId}`);
  revalidatePath("/patient/payments");
  revalidatePath("/patient", "layout");
  revalidatePath("/admin/payments");
  revalidatePath("/admin", "layout");
  const paid = result.message === "The payment is recorded.";
  return { message: result.message, tone: paid ? "ok" : "error" };
}

export async function reportOrangeTransferAction(_previous: PayState, formData: FormData): Promise<PayState> {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const reference = String(formData.get("reference") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const wallet = provider === "AFRIMONEY" ? "Afrimoney" : "Orange Money";
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    return { message: `Upload a screenshot of the ${wallet} transaction details.`, tone: "error" };
  }
  const filename = /\.(jpe?g|png|webp)$/i.test(file.name)
    ? file.name
    : file.type === "image/png"
      ? "receipt.png"
      : file.type === "image/webp"
        ? "receipt.webp"
        : "receipt.jpg";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = inspectProfileImage({ filename, declaredMime: file.type, bytes });
  if (!checked.ok) return { message: "Upload a JPEG, PNG, or WebP screenshot of the transaction, up to 2 MB.", tone: "error" };
  const receipt = { bytes, mimeType: checked.mimeType };
  const result = provider === "AFRIMONEY"
    ? await reportAfrimoneyTransfer({ actorUserId: user.id, appointmentId, reference, receipt }, prisma)
    : await reportOrangeTransfer({ actorUserId: user.id, appointmentId, reference, receipt }, prisma);
  revalidatePath(`/patient/appointments/${appointmentId}`);
  revalidatePath("/patient/payments");
  revalidatePath("/patient", "layout");
  revalidatePath("/admin/payments");
  revalidatePath("/admin", "layout");
  return result;
}
