-- AlterTable
ALTER TABLE "image" ADD COLUMN     "project_id" TEXT;

-- CreateIndex
CREATE INDEX "image_project_id_idx" ON "image"("project_id");

-- AddForeignKey
ALTER TABLE "image" ADD CONSTRAINT "image_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "team_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
