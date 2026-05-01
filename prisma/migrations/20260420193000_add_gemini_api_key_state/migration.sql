-- CreateTable
CREATE TABLE "gemini_api_key_state" (
    "id" TEXT NOT NULL,
    "key_name" TEXT NOT NULL,
    "blocked_until" TIMESTAMP(3),
    "last_quota_exceeded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gemini_api_key_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gemini_api_key_state_key_name_key" ON "gemini_api_key_state"("key_name");