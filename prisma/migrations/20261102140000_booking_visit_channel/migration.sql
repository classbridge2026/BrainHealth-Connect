CREATE TYPE "VisitChannel" AS ENUM ('IN_PERSON', 'VIDEO', 'AUDIO');

ALTER TABLE "Appointment" ADD COLUMN "visitChannel" "VisitChannel";
ALTER TABLE "Appointment" ADD COLUMN "intakeHistory" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "consentAcceptedAt" TIMESTAMPTZ(6);

UPDATE "Appointment"
SET "visitChannel" = CASE
  WHEN "mode" = 'IN_PERSON' THEN 'IN_PERSON'::"VisitChannel"
  ELSE 'VIDEO'::"VisitChannel"
END
WHERE "visitChannel" IS NULL;
