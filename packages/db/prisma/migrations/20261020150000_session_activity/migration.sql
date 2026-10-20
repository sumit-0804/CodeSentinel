-- The device behind each Supabase session as the gateway sees it (Signed-in devices): Supabase records
-- the dashboard's server instead, because sign-in and token refresh run there.
-- CreateTable
CREATE TABLE "session_activity" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_activity_pkey" PRIMARY KEY ("session_id")
);

-- CreateIndex
CREATE INDEX "idx_session_activity_user" ON "session_activity"("user_id");

-- AddForeignKey
ALTER TABLE "session_activity" ADD CONSTRAINT "session_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- No policies: only the prisma role (BYPASSRLS) reads or writes it.
ALTER TABLE "session_activity" ENABLE ROW LEVEL SECURITY;
