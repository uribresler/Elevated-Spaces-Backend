/*
  Warnings:

  - A unique constraint covering the columns `[facebook_id]` on the table `user` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[apple_id]` on the table `user` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "auth_provider" ADD VALUE 'FACEBOOK';
ALTER TYPE "auth_provider" ADD VALUE 'APPLE';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "apple_id" TEXT,
ADD COLUMN     "facebook_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_facebook_id_key" ON "user"("facebook_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_apple_id_key" ON "user"("apple_id");
