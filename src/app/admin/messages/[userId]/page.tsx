import type { Metadata } from "next";
import { CareChat } from "@/components/care-chat/care-chat";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { parseUuid } from "@/lib/catalog/rules";
import { listAdminChats, readChatThread } from "@/lib/care-chat/service";
import { prisma } from "@/lib/db/prisma";
import { isSchemaMismatch } from "@/lib/doctors/errors";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function AdminMessageThreadPage({ params }: { params: Promise<{ userId: string }> }) {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const personId = parseUuid((await params).userId);
  if (!personId) return <RecordsUnavailable code="NOT_FOUND" />;
  try {
    const people = await listAdminChats(prisma, user.id);
    const person = people.find((item) => item.id === personId);
    if (!person) return <RecordsUnavailable code="NOT_FOUND" />;
    const thread = await readChatThread(prisma, { actorUserId: user.id, side: "admin", partnerProfileId: personId });
    if (!thread) return <RecordsUnavailable code="NOT_FOUND" />;
    return (
      <CareChat
        listHref="/admin/messages"
        side="admin"
        userId={user.id}
        people={people}
        active={{
          id: person.id,
          name: person.name,
          detail: person.detail,
          imageUserId: person.imageUserId,
          imageVersion: person.imageVersion,
          conversationId: thread.conversationId,
          messages: thread.messages,
          online: thread.online,
          seenAt: thread.seenAt,
          canReply: person.canReply,
        }}
      />
    );
  } catch (error) {
    if (isSchemaMismatch(error)) return <RecordsUnavailable code="SCHEMA" />;
    throw error;
  }
}
