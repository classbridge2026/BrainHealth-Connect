import type { Metadata } from "next";
import { CareChat } from "@/components/care-chat/care-chat";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { listAdminChats } from "@/lib/care-chat/service";
import { prisma } from "@/lib/db/prisma";
import { isSchemaMismatch } from "@/lib/doctors/errors";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function AdminMessagesPage() {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  try {
    const people = await listAdminChats(prisma, user.id);
    return <CareChat listHref="/admin/messages" side="admin" userId={user.id} people={people} active={null} />;
  } catch (error) {
    if (isSchemaMismatch(error)) return <RecordsUnavailable code="SCHEMA" />;
    throw error;
  }
}
