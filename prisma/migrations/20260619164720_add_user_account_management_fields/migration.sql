-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "end_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "photographer_profile" ADD COLUMN     "weekly_availability" JSONB;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "deletion_code_expires_at" TIMESTAMP(3),
ADD COLUMN     "deletion_code_hash" TEXT,
ADD COLUMN     "deletion_purge_at" TIMESTAMP(3),
ADD COLUMN     "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN     "demo_bonus_claimed_at" TIMESTAMP(3),
ADD COLUMN     "manual_avatar_url" TEXT;
