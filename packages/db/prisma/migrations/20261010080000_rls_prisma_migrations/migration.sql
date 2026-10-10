-- Prisma's bookkeeping table sits in `public` too; hide it from Supabase's publishable key like every other table.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
