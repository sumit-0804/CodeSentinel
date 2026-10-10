-- CreateEnum
CREATE TYPE "org_role" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('user', 'organization');

-- CreateEnum
CREATE TYPE "agent_kind" AS ENUM ('security', 'style', 'performance', 'logic', 'documentation');

-- CreateEnum
CREATE TYPE "review_trigger" AS ENUM ('github_pull_request', 'vscode_on_demand', 'dashboard_manual');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "check_conclusion" AS ENUM ('pass', 'fail', 'neutral');

-- CreateEnum
CREATE TYPE "agent_run_status" AS ENUM ('pending', 'running', 'succeeded', 'timed_out', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('critical', 'warning', 'info');

-- CreateEnum
CREATE TYPE "fix_kind" AS ENUM ('deterministic', 'ai_suggested');

-- CreateEnum
CREATE TYPE "suggestion_state" AS ENUM ('proposed', 'accepted', 'rejected', 'superseded');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "github_org_login" TEXT NOT NULL,
    "github_org_id" BIGINT NOT NULL,
    "account_type" "account_type" NOT NULL DEFAULT 'organization',
    "display_name" TEXT NOT NULL,
    "default_confidence_threshold" DECIMAL(4,3) NOT NULL DEFAULT 0.800,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "github_user_id" BIGINT,
    "github_login" TEXT,
    "email" TEXT,
    "name" TEXT,
    "avatar_url" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "org_role" NOT NULL DEFAULT 'member',
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "github_installation_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "webhook_secret_ref" TEXT NOT NULL DEFAULT 'env:GITHUB_WEBHOOK_SECRET',
    "suspended_at" TIMESTAMPTZ(6),
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMPTZ(6),

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_user_tokens" (
    "user_id" UUID NOT NULL,
    "access_token_sealed" TEXT NOT NULL,
    "refresh_token_sealed" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "refresh_expires_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_user_tokens_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" BYTEA NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "github_installation_id" UUID NOT NULL,
    "github_repo_id" BIGINT NOT NULL,
    "full_name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "primary_language" TEXT,
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "review_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_settings" (
    "repository_id" UUID NOT NULL,
    "confidence_threshold_override" DECIMAL(4,3),
    "agent_timeout_ms" INTEGER NOT NULL DEFAULT 20000,
    "auto_fix_style" BOOLEAN NOT NULL DEFAULT true,
    "post_inline_comments" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_settings_pkey" PRIMARY KEY ("repository_id")
);

-- CreateTable
CREATE TABLE "repository_agent_config" (
    "repository_id" UUID NOT NULL,
    "agent" "agent_kind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_agent_config_pkey" PRIMARY KEY ("repository_id","agent")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID,
    "idempotency_key" TEXT,
    "organization_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "trigger" "review_trigger" NOT NULL,
    "triggered_by_user_id" UUID,
    "pr_number" INTEGER,
    "pr_title" TEXT,
    "head_sha" TEXT NOT NULL,
    "base_sha" TEXT,
    "head_ref" TEXT,
    "base_ref" TEXT,
    "changed_files_count" INTEGER NOT NULL DEFAULT 0,
    "changed_lines_count" INTEGER NOT NULL DEFAULT 0,
    "status" "review_status" NOT NULL DEFAULT 'queued',
    "confidence_threshold" DECIMAL(4,3) NOT NULL,
    "github_check_run_id" BIGINT,
    "check_conclusion" "check_conclusion",
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "report" JSONB,
    "error" JSONB,
    "delivery_id" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "agent" "agent_kind" NOT NULL,
    "status" "agent_run_status" NOT NULL DEFAULT 'pending',
    "service_version" TEXT,
    "llm_provider" TEXT,
    "llm_model" TEXT,
    "llm_fallback_depth" SMALLINT NOT NULL DEFAULT 0,
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "timeout_ms" INTEGER NOT NULL,
    "attempt" SMALLINT NOT NULL DEFAULT 1,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "agent_run_id" UUID NOT NULL,
    "agent" "agent_kind" NOT NULL,
    "rule_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "line_start" INTEGER NOT NULL,
    "line_end" INTEGER NOT NULL,
    "severity" "severity" NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "severity_rank" SMALLINT NOT NULL,
    "cwe_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "duplicate_of" UUID,
    "duplicate_count" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "finding_id" UUID NOT NULL,
    "kind" "fix_kind" NOT NULL,
    "state" "suggestion_state" NOT NULL DEFAULT 'proposed',
    "original_snippet" TEXT NOT NULL,
    "suggested_snippet" TEXT NOT NULL,
    "explanation" TEXT,
    "posted_to_github" BOOLEAN NOT NULL DEFAULT false,
    "github_comment_id" BIGINT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_commit_sha" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_embeddings" (
    "finding_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "collection" TEXT NOT NULL,
    "vector_id" TEXT NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_embeddings_pkey" PRIMARY KEY ("finding_id")
);

-- CreateTable
CREATE TABLE "finding_similarities" (
    "finding_id" UUID NOT NULL,
    "similar_finding_id" UUID NOT NULL,
    "similarity_score" DECIMAL(5,4) NOT NULL,
    "retrieved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_similarities_pkey" PRIMARY KEY ("finding_id","similar_finding_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_github_org_login_key" ON "organizations"("github_org_login");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_github_org_id_key" ON "organizations"("github_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_github_user_id_key" ON "users"("github_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_org_members_user" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_github_installation_id_key" ON "github_installations"("github_installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "idx_api_keys_user" ON "api_keys"("user_id") WHERE (revoked_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_github_repo_id_key" ON "repositories"("github_repo_id");

-- CreateIndex
CREATE INDEX "idx_repositories_org" ON "repositories"("organization_id") WHERE (review_enabled);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_organization_id_full_name_key" ON "repositories"("organization_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_job_id_key" ON "reviews"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_idempotency_key_key" ON "reviews"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_reviews_delivery" ON "reviews"("delivery_id");

-- CreateIndex
CREATE INDEX "idx_reviews_history" ON "reviews"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_reviews_repo" ON "reviews"("repository_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_reviews_status" ON "reviews"("status") WHERE (status IN ('queued', 'running'));

-- CreateIndex
CREATE UNIQUE INDEX "uq_reviews_pr_head" ON "reviews"("repository_id", "pr_number", "head_sha") WHERE (trigger = 'github_pull_request');

-- CreateIndex
CREATE INDEX "idx_agent_runs_review" ON "agent_runs"("review_id");

-- CreateIndex
CREATE INDEX "idx_agent_runs_slow" ON "agent_runs"("agent", "latency_ms" DESC) WHERE (status = 'succeeded');

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_review_id_agent_attempt_key" ON "agent_runs"("review_id", "agent", "attempt");

-- CreateIndex
CREATE INDEX "idx_findings_review" ON "findings"("review_id", "severity_rank", "confidence" DESC);

-- CreateIndex
CREATE INDEX "idx_findings_agent" ON "findings"("review_id", "agent");

-- CreateIndex
CREATE INDEX "idx_findings_file" ON "findings"("review_id", "file_path");

-- CreateIndex
CREATE UNIQUE INDEX "uq_findings_dedupe" ON "findings"("review_id", "dedupe_key") WHERE (duplicate_of IS NULL);

-- CreateIndex
CREATE INDEX "idx_suggestions_finding" ON "suggestions"("finding_id");

-- CreateIndex
CREATE INDEX "idx_suggestions_open" ON "suggestions"("state") WHERE (state = 'proposed');

-- CreateIndex
CREATE INDEX "idx_embeddings_org" ON "finding_embeddings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_embeddings_collection_vector_id_key" ON "finding_embeddings"("collection", "vector_id");

-- CreateIndex
CREATE INDEX "idx_similarities_score" ON "finding_similarities"("finding_id", "similarity_score" DESC);

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_user_tokens" ADD CONSTRAINT "github_user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_github_installation_id_fkey" FOREIGN KEY ("github_installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_settings" ADD CONSTRAINT "repository_settings_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_settings" ADD CONSTRAINT "repository_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_agent_config" ADD CONSTRAINT "repository_agent_config_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_agent_config" ADD CONSTRAINT "repository_agent_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_duplicate_of_fkey" FOREIGN KEY ("duplicate_of") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_embeddings" ADD CONSTRAINT "finding_embeddings_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_embeddings" ADD CONSTRAINT "finding_embeddings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_similarities" ADD CONSTRAINT "finding_similarities_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_similarities" ADD CONSTRAINT "finding_similarities_similar_finding_id_fkey" FOREIGN KEY ("similar_finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written below: CHECK constraints and RLS, which the Prisma schema cannot express.

ALTER TABLE "organizations" ADD CONSTRAINT "ck_org_threshold" CHECK ("default_confidence_threshold" BETWEEN 0 AND 1);
ALTER TABLE "repository_settings" ADD CONSTRAINT "ck_settings_threshold" CHECK ("confidence_threshold_override" BETWEEN 0 AND 1);
ALTER TABLE "repository_settings" ADD CONSTRAINT "ck_settings_timeout" CHECK ("agent_timeout_ms" BETWEEN 1000 AND 120000);
ALTER TABLE "reviews" ADD CONSTRAINT "ck_reviews_pr_number" CHECK ("trigger" <> 'github_pull_request' OR "pr_number" IS NOT NULL);
ALTER TABLE "reviews" ADD CONSTRAINT "ck_reviews_threshold" CHECK ("confidence_threshold" BETWEEN 0 AND 1);
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_lines" CHECK ("line_start" > 0 AND "line_end" >= "line_start");
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_confidence" CHECK ("confidence" BETWEEN 0 AND 1);
-- Deterministic style fixes never need review; AI fixes must carry an explicit accept/reject (FR-GH-04, NFR-07).
ALTER TABLE "suggestions" ADD CONSTRAINT "ck_ai_fix_needs_action"
    CHECK ("kind" = 'deterministic' OR "state" <> 'accepted' OR "resolved_by_user_id" IS NOT NULL);
ALTER TABLE "finding_similarities" ADD CONSTRAINT "ck_similarity_score" CHECK ("similarity_score" BETWEEN 0 AND 1);
ALTER TABLE "finding_similarities" ADD CONSTRAINT "ck_similarity_distinct" CHECK ("finding_id" <> "similar_finding_id");

-- RLS on with no policies: Supabase's publishable key (anon / authenticated roles) can read nothing.
-- Only the `prisma` role (BYPASSRLS) used by the gateway and orchestrator reaches these tables.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "github_installations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "github_user_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repositories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repository_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repository_agent_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_similarities" ENABLE ROW LEVEL SECURITY;
