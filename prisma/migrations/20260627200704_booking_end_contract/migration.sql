-- Add COMPLETED to booking_status enum. ALTER TYPE … ADD VALUE is idempotent
-- with IF NOT EXISTS in Postgres 9.6+.
ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- End-of-contract metadata. ended_by reuses the existing booking_actor enum.
ALTER TABLE "booking"
ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ended_by" "booking_actor",
ADD COLUMN IF NOT EXISTS "end_reason" TEXT;
