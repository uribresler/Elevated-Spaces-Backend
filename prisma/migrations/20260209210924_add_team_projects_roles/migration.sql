-- CreateEnum
CREATE TYPE "project_member_role" AS ENUM ('PHOTOGRAPHER', 'AGENT');

-- CreateTable
CREATE TABLE "team_project" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "description" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_project_member" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "project_member_role" NOT NULL DEFAULT 'PHOTOGRAPHER',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_project_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_project_team_id_created_by_user_id_idx" ON "team_project"("team_id", "created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_project_member_project_id_user_id_key" ON "team_project_member"("project_id", "user_id");

-- AddForeignKey
ALTER TABLE "team_project" ADD CONSTRAINT "team_project_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_project" ADD CONSTRAINT "team_project_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_project_member" ADD CONSTRAINT "team_project_member_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "team_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_project_member" ADD CONSTRAINT "team_project_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
