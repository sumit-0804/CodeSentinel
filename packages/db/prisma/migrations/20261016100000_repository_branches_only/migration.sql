-- Branches to review are set per repository only. Repositories that followed an organization list
-- and had none of their own keep it, copied into their settings, before the column is dropped.
INSERT INTO "repository_settings" ("repository_id", "review_branches")
SELECT r."id", o."default_review_branches"
FROM "repositories" r
JOIN "organizations" o ON o."id" = r."organization_id"
WHERE r."use_org_defaults" AND cardinality(o."default_review_branches") > 0
ON CONFLICT ("repository_id") DO UPDATE
SET "review_branches" = EXCLUDED."review_branches"
WHERE cardinality("repository_settings"."review_branches") = 0 OR "repository_settings"."review_branches" IS NULL;

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "default_review_branches";
