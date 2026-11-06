import type { Metadata } from "next";
import { CareChat } from "@/components/care-chat/care-chat";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { parseUuid } from "@/lib/catalog/rules";
import { listDoctorChats, readChatThread } from "@/lib/care-chat/service";
import { prisma } from "@/lib/db/prisma";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { isSchemaMismatch } from "@/lib/doctors/errors";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function DoctorMessageThreadPage({ params }: { params: Promise<{ patientId: string }> }) {
  const user = await requireStoredRoles(DOCTOR_PORTAL_ROLES);
  const patientId = parseUuid((await params).patientId);
  if (!patientId) return <RecordsUnavailable code="NOT_FOUND" />;
  try {
    const [people, thread] = await Promise.all([
      listDoctorChats(prisma, user.id),
      readChatThread(prisma, { actorUserId: user.id, side: "doctor", partnerProfileId: patientId }),
    ]);
    const person = people.find((item) => item.id === patientId);
    if (!person) return <RecordsUnavailable code="NOT_FOUND" />;
    if (!thread) return <RecordsUnavailable code="NOT_FOUND" />;
    return (
      <CareChat
        listHref="/doctor/messages"
        side="doctor"
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
