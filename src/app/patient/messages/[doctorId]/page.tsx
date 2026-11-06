import type { Metadata } from "next";
import { CareChat } from "@/components/care-chat/care-chat";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { parseUuid } from "@/lib/catalog/rules";
import { listPatientChats, readChatThread } from "@/lib/care-chat/service";
import { prisma } from "@/lib/db/prisma";
import { isSchemaMismatch } from "@/lib/doctors/errors";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function PatientMessageThreadPage({ params }: { params: Promise<{ doctorId: string }> }) {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const doctorId = parseUuid((await params).doctorId);
  if (!doctorId) return <RecordsUnavailable code="NOT_FOUND" />;
  try {
    const people = await listPatientChats(prisma, user.id);
    const person = people.find((item) => item.id === doctorId);
    if (!person) return <RecordsUnavailable code="NOT_FOUND" />;
    const thread = await readChatThread(prisma, { actorUserId: user.id, side: "patient", partnerProfileId: doctorId });
    if (!thread) return <RecordsUnavailable code="NOT_FOUND" />;
    return (
      <CareChat
        listHref="/patient/messages"
        side="patient"
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
