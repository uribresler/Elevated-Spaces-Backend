-- AlterTable
ALTER TABLE "user"
  ADD COLUMN "secondary_email_pending" TEXT,
  ADD COLUMN "secondary_email_verification_token" TEXT,
  ADD COLUMN "secondary_email_verification_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "user_secondary_email_pending_key" ON "user"("secondary_email_pending");

-- CreateIndex
CREATE UNIQUE INDEX "user_secondary_email_verification_token_key" ON "user"("secondary_email_verification_token");
