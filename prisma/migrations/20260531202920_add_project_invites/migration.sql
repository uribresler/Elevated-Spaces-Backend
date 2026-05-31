-- DropForeignKey
ALTER TABLE "project_invites" DROP CONSTRAINT "project_invites_invited_by_user_id_fkey";

-- AlterTable
ALTER TABLE "project_invites" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
