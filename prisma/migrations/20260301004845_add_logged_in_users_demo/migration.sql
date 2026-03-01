-- CreateTable
CREATE TABLE "user_demo_tracking" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "uploads_count" INTEGER NOT NULL DEFAULT 0,
    "last_reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_demo_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_demo_tracking_user_id_key" ON "user_demo_tracking"("user_id");

-- CreateIndex
CREATE INDEX "user_demo_tracking_user_id_last_reset_at_idx" ON "user_demo_tracking"("user_id", "last_reset_at");

-- AddForeignKey
ALTER TABLE "user_demo_tracking" ADD CONSTRAINT "user_demo_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
