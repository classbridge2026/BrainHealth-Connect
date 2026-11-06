ALTER TABLE "CareConversation" ADD COLUMN "patientClearedAt" TIMESTAMPTZ(6);
ALTER TABLE "CareConversation" ADD COLUMN "doctorClearedAt" TIMESTAMPTZ(6);
