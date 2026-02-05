/*
  Warnings:

  - The `permissions` column on the `team_roles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "team_roles" DROP COLUMN "permissions",
ADD COLUMN     "permissions" JSONB;
