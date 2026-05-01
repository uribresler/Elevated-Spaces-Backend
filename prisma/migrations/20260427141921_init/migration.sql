-- CreateEnum
CREATE TYPE "booking_actor" AS ENUM ('CLIENT', 'PHOTOGRAPHER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "photographer_application_status" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'INTERVIEW_SCHEDULED', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_user_id_fkey";

-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "cancelled_by" "booking_actor",
ADD COLUMN     "client_note_attachments" JSONB,
ADD COLUMN     "client_note_html" TEXT,
ADD COLUMN     "photographer_note_attachments" JSONB,
ADD COLUMN     "photographer_note_html" TEXT,
ADD COLUMN     "status_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "photographer_profile" ADD COLUMN     "admin_feedback" TEXT,
ADD COLUMN     "application_status" "photographer_application_status" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "business_name" TEXT,
ADD COLUMN     "driving_license_url" TEXT,
ADD COLUMN     "facebook_url" TEXT,
ADD COLUMN     "feedback_provided_at" TIMESTAMP(3),
ADD COLUMN     "gear_description" TEXT,
ADD COLUMN     "has_new_photographer_response" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagram_url" TEXT,
ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "photographer_responses" JSONB,
ADD COLUMN     "photographer_type" TEXT,
ADD COLUMN     "portfolio_items" JSONB,
ADD COLUMN     "portfolio_url" TEXT,
ADD COLUMN     "price_max" INTEGER,
ADD COLUMN     "price_min" INTEGER,
ADD COLUMN     "refund_policy" JSONB,
ADD COLUMN     "service_area" TEXT,
ADD COLUMN     "service_areas" JSONB,
ADD COLUMN     "service_keywords" TEXT,
ADD COLUMN     "short_pitch" TEXT,
ADD COLUMN     "submission_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "utility_bill_url" TEXT,
ADD COLUMN     "website_url" TEXT,
ADD COLUMN     "x_url" TEXT,
ADD COLUMN     "years_experience" TEXT;

-- CreateTable
CREATE TABLE "direct_conversation" (
    "id" TEXT NOT NULL,
    "user_a_id" TEXT NOT NULL,
    "user_b_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "body" TEXT,
    "attachments" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direct_conversation_user_a_id_idx" ON "direct_conversation"("user_a_id");

-- CreateIndex
CREATE INDEX "direct_conversation_user_b_id_idx" ON "direct_conversation"("user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_conversation_user_a_id_user_b_id_key" ON "direct_conversation"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "direct_message_conversation_id_created_at_idx" ON "direct_message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "direct_message_receiver_id_read_at_idx" ON "direct_message"("receiver_id", "read_at");

-- AddForeignKey
ALTER TABLE "direct_conversation" ADD CONSTRAINT "direct_conversation_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_conversation" ADD CONSTRAINT "direct_conversation_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "direct_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_credit_purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
