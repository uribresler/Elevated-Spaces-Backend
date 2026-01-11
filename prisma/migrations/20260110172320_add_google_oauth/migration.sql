/*
  Warnings:

  - A unique constraint covering the columns `[google_id]` on the table `user` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('LOCAL', 'GOOGLE');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "auth_provider" "auth_provider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "google_id" TEXT,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "user_google_id_key" ON "user"("google_id");
