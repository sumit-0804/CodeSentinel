// Removes every authenticator of a locked-out user, so they can sign in and set up a new one.
// Admin-only and never deployed: it needs the project's secret key, read from the shell, never from a file.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... node apps/dashboard/scripts/mfa-reset.mjs <user-id> [--yes]
/* eslint-disable no-console -- a command-line tool: the console is its output */
import { createClient } from "@supabase/supabase-js";

const [userId, confirm] = process.argv.slice(2);
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !userId || !UUID.test(userId)) {
  console.error("Usage: SUPABASE_URL=… SUPABASE_SECRET_KEY=… node apps/dashboard/scripts/mfa-reset.mjs <user-id> [--yes]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
if (error) {
  console.error(`Couldn't list factors: ${error.message}`);
  process.exit(1);
}

const factors = data.factors;
console.log(`${factors.length} factor(s):`);
for (const f of factors) console.log(`  ${f.id}  ${f.factor_type}  ${f.status}  ${f.friendly_name ?? ""}`);
if (factors.length === 0) process.exit(0);
if (confirm !== "--yes") {
  console.log("Nothing removed. Run again with --yes after confirming the user's identity.");
  process.exit(0);
}

for (const f of factors) {
  const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  if (deleteError) {
    console.error(`Couldn't remove ${f.id}: ${deleteError.message}`);
    process.exit(1);
  }
  console.log(`Removed ${f.id}`);
}
