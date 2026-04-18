-- AlterTable: add auth fields to users, drop name
ALTER TABLE "users" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "verificationToken" TEXT;

-- Remove defaults (they were only needed for the ALTER)
ALTER TABLE "users" ALTER COLUMN "firstName" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "lastName" DROP DEFAULT;

-- Drop old name column
ALTER TABLE "users" DROP COLUMN IF EXISTS "name";

-- CreateIndex
CREATE UNIQUE INDEX "users_verificationToken_key" ON "users"("verificationToken");
