-- CreateEnum
CREATE TYPE "project_invite_status" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "project_invites" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "team_id" TEXT,
    "email" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "project_invite_status" NOT NULL DEFAULT 'PENDING',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_invites_token_key" ON "project_invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "project_invites_project_id_email_key" ON "project_invites"("project_id", "email");

-- AddForeignKey
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "team_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
