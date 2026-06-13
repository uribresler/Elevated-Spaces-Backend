-- AlterTable
ALTER TABLE "user" ADD COLUMN     "deletion_code_expires_at" TIMESTAMP(3),
ADD COLUMN     "deletion_code_hash" TEXT,
ADD COLUMN     "deletion_purge_at" TIMESTAMP(3),
ADD COLUMN     "deletion_requested_at" TIMESTAMP(3);
