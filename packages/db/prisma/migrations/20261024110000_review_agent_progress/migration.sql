-- Each agent's result as soon as it answers, so the dashboard can show a running review's progress.
-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "agent_progress" JSONB;
