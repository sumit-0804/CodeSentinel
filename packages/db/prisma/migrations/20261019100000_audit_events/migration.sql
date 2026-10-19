-- Audit log for admins (WP6): sensitive actions, who did them and from where.
-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('repository_config_updated', 'review_defaults_updated', 'repository_reviews_toggled', 'fix_accepted', 'fix_rejected', 'fixes_applied', 'review_rerun', 'github_linked', 'installations_synced', 'session_revoked', 'step_up_refused');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID,
    "action" "audit_action" NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_org_created" ON "audit_events"("organization_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- No policies: only the prisma role (BYPASSRLS) reads or writes it.
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
