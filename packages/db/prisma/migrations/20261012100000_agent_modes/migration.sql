-- A9: each agent is off, comment-only or blocking per repository, with organization defaults and
-- base-branch patterns. Existing enabled flags carry over: false → off, true → comment.
-- CreateEnum
CREATE TYPE "agent_mode" AS ENUM ('off', 'comment', 'block');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "default_review_branches" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "use_org_defaults" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "repository_settings" ADD COLUMN     "review_branches" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "repository_agent_config" ADD COLUMN     "mode" "agent_mode" NOT NULL DEFAULT 'comment';
UPDATE "repository_agent_config" SET "mode" = 'off' WHERE NOT "enabled";
ALTER TABLE "repository_agent_config" DROP COLUMN "enabled";

-- CreateTable
CREATE TABLE "organization_agent_defaults" (
    "organization_id" UUID NOT NULL,
    "agent" "agent_kind" NOT NULL,
    "mode" "agent_mode" NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_agent_defaults_pkey" PRIMARY KEY ("organization_id","agent")
);

-- AddForeignKey
ALTER TABLE "organization_agent_defaults" ADD CONSTRAINT "organization_agent_defaults_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_agent_defaults" ADD CONSTRAINT "organization_agent_defaults_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS on with no policies, like every other table: only the `prisma` role (BYPASSRLS) reaches it.
ALTER TABLE "organization_agent_defaults" ENABLE ROW LEVEL SECURITY;
