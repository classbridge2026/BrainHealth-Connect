-- New unpaid bookings keep the slot for 15 minutes.
UPDATE "PlatformSetting"
SET "valueJson" = '15'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'APPOINTMENT_PAYMENT_HOLD_MINUTES'
  AND "valueJson" = '10'::jsonb;
