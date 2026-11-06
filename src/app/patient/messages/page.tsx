import type { Metadata } from "next";
import { CareChat } from "@/components/care-chat/care-chat";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { listPatientChats } from "@/lib/care-chat/service";
import { prisma } from "@/lib/db/prisma";
import { isSchemaMismatch } from "@/lib/doctors/errors";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function PatientMessagesPage() {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  try {
    const people = await listPatientChats(prisma, user.id);
    return <CareChat listHref="/patient/messages" side="patient" people={people} active={null} />;
  } catch (error) {
    if (isSchemaMismatch(error)) return <RecordsUnavailable code="SCHEMA" />;
    throw error;
  }
}
