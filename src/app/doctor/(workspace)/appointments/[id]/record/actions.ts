"use server";

import { revalidatePath } from "next/cache";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import {
  archiveClinicalNote,
  finalizeClinicalNote,
  openConsultationEncounter,
  releasePatientSummary,
  retireClinicalFile,
  saveClinicalNote,
  storeClinicalFile,
  withdrawPatientSummary,
} from "@/lib/clinical/records";
import { composePatientSummary } from "@/lib/clinical/rules";
import { composeConsultationNote } from "@/lib/doctor/present";
import { prisma } from "@/lib/db/prisma";
import { createPrivateStorage } from "@/lib/storage/private-storage";

export type ClinicalActionState = { message?: string; tone?: "ok" | "error" };

function finish(appointmentId: string, result: { ok: boolean; message: string }): ClinicalActionState {
  revalidatePath(`/doctor/appointments/${appointmentId}/record`);
  revalidatePath(`/doctor/appointments/${appointmentId}`);
  revalidatePath(`/patient/appointments/${appointmentId}`);
  revalidatePath("/patient/summaries");
  revalidatePath("/patient/notifications");
  revalidatePath("/patient");
  revalidatePath("/doctor/notes");
  revalidatePath("/doctor");
  revalidatePath(`/doctor/appointments/${appointmentId}/consultation`);
  return { message: result.message, tone: result.ok ? "ok" : "error" };
}

export async function openEncounterAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await openConsultationEncounter(prisma, { appointmentId, actorUserId: user.id });
  return finish(appointmentId, result);
}

export async function saveNoteAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");
  const result = await saveClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: noteId || null,
    kind: String(formData.get("kind") ?? ""),
    body: String(formData.get("body") ?? ""),
    expectedRevision: String(formData.get("expectedRevision") ?? ""),
    amendmentReason: String(formData.get("amendmentReason") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function saveFollowUpRecommendationAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const recommendation = String(formData.get("followUpText") ?? "").replace(/\r\n/g, "\n").trim();
  const date = String(formData.get("followUpDate") ?? "").trim();
  if (recommendation.length < 2) return { message: "Enter the follow-up recommendation before saving.", tone: "error" };
  const addition = ["Follow-up recommendation", recommendation, date ? `Recommended date: ${date}` : ""].filter(Boolean).join("\n");
  const current = String(formData.get("currentBody") ?? "").trim();
  const result = await saveClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: String(formData.get("noteId") ?? "") || null,
    kind: "PRIVATE_WORKING",
    body: current ? `${current}\n\n${addition}` : addition,
    expectedRevision: String(formData.get("expectedRevision") ?? ""),
    amendmentReason: String(formData.get("amendmentReason") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function saveStructuredNoteAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const composed = composeConsultationNote({
    complaint: String(formData.get("complaint") ?? ""),
    history: String(formData.get("history") ?? ""),
    findings: String(formData.get("findings") ?? ""),
    assessment: String(formData.get("assessment") ?? ""),
    plan: String(formData.get("plan") ?? ""),
    followUp: String(formData.get("followUp") ?? ""),
  });
  if (!composed.ok) return { message: composed.message, tone: "error" };
  const result = await saveClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: String(formData.get("noteId") ?? "") || null,
    kind: "PRIVATE_WORKING",
    body: composed.body,
    expectedRevision: String(formData.get("expectedRevision") ?? ""),
    amendmentReason: String(formData.get("amendmentReason") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function savePatientSummaryAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const composed = composePatientSummary({
    reason: String(formData.get("reason") ?? ""),
    outcome: String(formData.get("outcome") ?? ""),
    findings: String(formData.get("findings") ?? ""),
    plan: String(formData.get("plan") ?? ""),
    prescription: String(formData.get("prescription") ?? ""),
    followUp: String(formData.get("followUp") ?? ""),
    additional: String(formData.get("additional") ?? ""),
  });
  if (!composed.ok) return { message: composed.message, tone: "error" };
  const result = await saveClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    kind: "PATIENT_SUMMARY",
    body: composed.body,
  });
  if (!result.ok) return finish(appointmentId, result);
  if (formData.get("release") !== "yes" || !result.noteId) return finish(appointmentId, result);
  const released = await releasePatientSummary(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: result.noteId,
  });
  if (!released.ok) {
    return finish(appointmentId, {
      ok: false,
      message: `The summary was saved, but it could not be released. ${released.message}`,
    });
  }
  return finish(appointmentId, { ok: true, message: "The patient summary was saved and released. The patient can read it now." });
}

export async function finalizeNoteAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await finalizeClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: String(formData.get("noteId") ?? ""),
    expectedRevision: String(formData.get("expectedRevision") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function releaseSummaryAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (String(formData.get("confirm")) !== "yes") {
    return { message: "Preview the summary and confirm the release before it is shared with the patient.", tone: "error" };
  }
  const result = await releasePatientSummary(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: String(formData.get("noteId") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function retireFileAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await retireClinicalFile(prisma, {
    appointmentId,
    actorUserId: user.id,
    fileId: String(formData.get("fileId") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function withdrawSummaryAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await withdrawPatientSummary(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: String(formData.get("noteId") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function archiveNoteAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const result = await archiveClinicalNote(prisma, {
    appointmentId,
    actorUserId: user.id,
    noteId: String(formData.get("noteId") ?? ""),
  });
  return finish(appointmentId, result);
}

export async function uploadClinicalFileAction(_previous: ClinicalActionState, formData: FormData): Promise<ClinicalActionState> {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose a document to store.", tone: "error" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await storeClinicalFile(
    {
      appointmentId,
      actorUserId: user.id,
      noteId: String(formData.get("noteId") ?? "") || null,
      filename: file.name,
      declaredMime: file.type,
      bytes,
    },
    { db: prisma, storage: createPrivateStorage() },
  );
  return finish(appointmentId, result);
}
