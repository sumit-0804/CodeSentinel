-- UC-3: why a person dismissed a suggested fix, and an optional comment.
-- CreateEnum
CREATE TYPE "rejection_reason" AS ENUM ('false_positive', 'not_applicable', 'will_fix_manually', 'other');

-- AlterTable
ALTER TABLE "suggestions" ADD COLUMN     "rejection_comment" TEXT,
ADD COLUMN     "rejection_reason" "rejection_reason";

-- Hand-written: the API accepts at most 1000 characters.
ALTER TABLE "suggestions" ADD CONSTRAINT "ck_suggestions_rejection_comment" CHECK (char_length("rejection_comment") <= 1000);
