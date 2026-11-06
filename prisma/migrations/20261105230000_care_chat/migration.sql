CREATE TABLE "CareConversation" (
  "id" UUID NOT NULL,
  "patientProfileId" UUID NOT NULL,
  "doctorProfileId" UUID NOT NULL,
  "lastMessageAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CareConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareMessage" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "senderUserId" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMPTZ(6),
  CONSTRAINT "CareMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareConversation_patientProfileId_doctorProfileId_key" ON "CareConversation"("patientProfileId", "doctorProfileId");
CREATE INDEX "CareConversation_doctorProfileId_lastMessageAt_idx" ON "CareConversation"("doctorProfileId", "lastMessageAt");
CREATE INDEX "CareConversation_patientProfileId_lastMessageAt_idx" ON "CareConversation"("patientProfileId", "lastMessageAt");
CREATE INDEX "CareMessage_conversationId_createdAt_idx" ON "CareMessage"("conversationId", "createdAt");
CREATE INDEX "CareMessage_senderUserId_idx" ON "CareMessage"("senderUserId");

ALTER TABLE "CareConversation" ADD CONSTRAINT "CareConversation_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareConversation" ADD CONSTRAINT "CareConversation_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CareConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareMessage" ADD CONSTRAINT "CareMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
