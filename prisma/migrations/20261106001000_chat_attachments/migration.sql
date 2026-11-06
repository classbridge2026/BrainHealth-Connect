ALTER TABLE "CareMessage" ADD COLUMN "attachmentName" TEXT,
ADD COLUMN "attachmentMime" TEXT,
ADD COLUMN "attachmentSize" INTEGER,
ADD COLUMN "attachmentBytes" BYTEA;
