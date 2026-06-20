-- Baseline migration: these columns were applied to the database directly
-- (e.g. via `prisma db push`) before being recorded in migration history.
-- This file captures that state so the migration log matches what's in the DB.
-- Mark it as already applied with:
--   npx prisma migrate resolve --applied 20260620115000_baseline_email_verification_and_secondary

-- AlterTable
ALTER TABLE "user"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "email_verification_token" TEXT,
  ADD COLUMN "email_verification_expires_at" TIMESTAMP(3),
  ADD COLUMN "secondary_email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_email_verification_token_key" ON "user"("email_verification_token");

-- CreateIndex
CREATE UNIQUE INDEX "user_secondary_email_key" ON "user"("secondary_email");
