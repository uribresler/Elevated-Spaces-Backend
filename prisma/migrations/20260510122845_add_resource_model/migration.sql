-- DropForeignKey
ALTER TABLE "photographer_profile" DROP CONSTRAINT "photographer_profile_user_id_fkey";

-- AlterTable
ALTER TABLE "user_credit_purchase" ADD COLUMN     "credit_expires_at" TIMESTAMP(3),
ADD COLUMN     "payment_reminder_sent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "resource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_html" TEXT,
    "pdf" BYTEA,
    "pdf_filename" TEXT,
    "pdf_mime" TEXT,
    "video" BYTEA,
    "video_filename" TEXT,
    "video_mime" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resource_slug_key" ON "resource"("slug");

-- AddForeignKey
ALTER TABLE "photographer_profile" ADD CONSTRAINT "photographer_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
