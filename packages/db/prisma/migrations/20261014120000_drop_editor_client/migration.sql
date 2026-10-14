-- Only the GitHub App and the dashboard call the gateway: drop the editor review trigger and personal API keys.
-- The cast fails, and the migration rolls back, if any review still uses the dropped trigger value.

-- The partial index and check compare `trigger` to the old type, so they are rebuilt around the swap.
DROP INDEX "uq_reviews_pr_head";
ALTER TABLE "reviews" DROP CONSTRAINT "ck_reviews_pr_number";

-- AlterEnum
CREATE TYPE "review_trigger_new" AS ENUM ('github_pull_request', 'dashboard_manual');
ALTER TABLE "reviews" ALTER COLUMN "trigger" TYPE "review_trigger_new" USING ("trigger"::text::"review_trigger_new");
ALTER TYPE "review_trigger" RENAME TO "review_trigger_old";
ALTER TYPE "review_trigger_new" RENAME TO "review_trigger";
DROP TYPE "review_trigger_old";

CREATE UNIQUE INDEX "uq_reviews_pr_head" ON "reviews"("repository_id", "pr_number", "head_sha") WHERE (trigger = 'github_pull_request');
ALTER TABLE "reviews" ADD CONSTRAINT "ck_reviews_pr_number" CHECK ("trigger" <> 'github_pull_request' OR "pr_number" IS NOT NULL);

-- DropTable
DROP TABLE "api_keys";
