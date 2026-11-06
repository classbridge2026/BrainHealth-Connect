import type { Metadata } from "next";
import { CareChat } from "@/components/care-chat/care-chat";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { listDoctorChats } from "@/lib/care-chat/service";
import { prisma } from "@/lib/db/prisma";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { isSchemaMismatch } from "@/lib/doctors/errors";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function DoctorMessagesPage() {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  try {
    const people = await listDoctorChats(prisma, user.id);
    return <CareChat listHref="/doctor/messages" side="doctor" people={people} active={null} />;
  } catch (error) {
    if (isSchemaMismatch(error)) return <RecordsUnavailable code="SCHEMA" />;
    throw error;
  }
}
