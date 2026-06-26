-- AlterTable
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "end_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "photographer_profile" ADD COLUMN IF NOT EXISTS "weekly_availability" JSONB;

-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "deletion_code_expires_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletion_code_hash" TEXT,
ADD COLUMN IF NOT EXISTS "deletion_purge_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "demo_bonus_claimed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "manual_avatar_url" TEXT;
