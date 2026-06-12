ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "ai_generation_consent_first_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ai_generation_consent_last_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "user_ai_generation_consent_last_at_idx"
ON "user"("ai_generation_consent_last_at");