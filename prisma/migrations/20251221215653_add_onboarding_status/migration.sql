-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('account_created', 'email_verified', 'profile_setup', 'pin_setup');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'account_created';
