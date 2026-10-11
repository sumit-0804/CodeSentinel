-- A6: a repository that leaves its installation is marked removed, never deleted, so its reviews stay.
-- Names are unique only among active rows, so a removed repository can be recreated under the same name.
-- DropIndex
DROP INDEX "idx_repositories_org";

-- DropIndex
DROP INDEX "repositories_organization_id_full_name_key";

-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "removed_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "idx_repositories_org" ON "repositories"("organization_id") WHERE (review_enabled AND removed_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_repositories_org_name_active" ON "repositories"("organization_id", "full_name") WHERE (removed_at IS NULL);

