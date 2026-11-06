ALTER TABLE "CareMessage" ADD COLUMN "attachmentKey" TEXT;
CREATE INDEX "CareMessage_attachmentKey_idx" ON "CareMessage"("attachmentKey");
