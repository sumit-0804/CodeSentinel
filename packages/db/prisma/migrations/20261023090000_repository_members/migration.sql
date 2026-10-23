-- The repositories an organization member can open on GitHub, as of their last sync; admins have no rows.
-- CreateTable
CREATE TABLE "repository_members" (
    "repository_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_members_pkey" PRIMARY KEY ("repository_id","user_id")
);

-- CreateIndex
CREATE INDEX "idx_repository_members_user" ON "repository_members"("user_id");

-- AddForeignKey
ALTER TABLE "repository_members" ADD CONSTRAINT "repository_members_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_members" ADD CONSTRAINT "repository_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- No policies: only the prisma role (BYPASSRLS) reads or writes it.
ALTER TABLE "repository_members" ENABLE ROW LEVEL SECURITY;
