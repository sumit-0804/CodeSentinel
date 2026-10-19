# @code-sentinel/db

The Code-Sentinel database: the Prisma 7 schema, its migrations, and the Prisma client the gateway and
the orchestrator use. The database is **Supabase Postgres**: `code-sentinel-dev` for development,
`code-sentinel-prod` for the deployed app.

- **Source of truth:** [`prisma/schema.prisma`](prisma/schema.prisma) and
  [`prisma/migrations/`](prisma/migrations/).
- [`docs/design/schema/schema.sql`](../../docs/design/schema/schema.sql) is **generated** from them for
  the design documents (`npm run schema:sql`, see its header). Never edit it by hand.
- [`docs/design/diagrams/database_schema.png`](../../docs/design/diagrams/database_schema.png) is the
  ER diagram of all 15 tables (drawn in Excalidraw); redraw it when a table or relation changes.
- Only the `public` schema is ours. Supabase owns `auth` (users, OAuth identities, sessions, TOTP
  factors). `users` mirrors `auth.users` by id; the gateway writes the row the first time it sees a
  verified access token, so there is no cross-schema trigger to maintain.

## What is in the schema

Every table of the System Design Document (organizations, members, installations,
repositories and their settings, reviews, agent runs, findings, suggestions, embeddings), with these
changes for Supabase Auth and job persistence:

| Change | Why |
| --- | --- |
| `users.id` = Supabase's user id; `github_user_id` / `github_login` nullable; `name` added | Users can sign up with email + password or Google before linking GitHub |
| `sessions` removed | Supabase owns sessions (`auth.sessions`) |
| `github_user_tokens` added (sealed with AES-256-GCM) | GitHub App user tokens for installation sync (Phase A, A6) |
| `organizations.account_type` | An installation can be on a personal account or an organization |
| `repositories.removed_at`; name unique only among active rows (migration `20261011120000`) | A repository that leaves its installation, or whose App is uninstalled, is marked removed rather than deleted, so its review history stays; a recreated repository can reuse the name (A6) |
| `agent_mode` (`off` / `comment` / `block`) replaces `repository_agent_config.enabled` (false → off, true → comment); `organization_agent_defaults`; `repositories.use_org_defaults`; `review_branches` on `repository_settings` and `default_review_branches` on `organizations` (migration `20261012100000`) | Each agent can comment only or block the merge per repository, organizations set defaults, and each repository picks which base branches get reviewed (A9) |
| `reviews.job_id`, `idempotency_key`, `report` (JSONB), `error` (JSONB); status `cancelled` | The orchestrator's job store lives in `reviews`, and the API answers from one row |
| `api_keys` and the editor review trigger removed; `review_trigger` is `github_pull_request` or `dashboard_manual` (migration `20261014120000`) | There is no editor client; every caller is the GitHub App or a signed-in dashboard user |
| `finding_embeddings`: `collection` / `vector_id` (Chroma) replaced by `embedding vector(768)`, the `vector` extension enabled (migration `20261017100000`) | pgvector in the same database replaces ChromaDB. Search is exact over one organization's rows (`idx_embeddings_org`): an HNSW index filters after the nearest-neighbour step and can miss matches, and Prisma can't declare one |
| `audit_events` and the `audit_action` enum (migration `20261019100000`); RLS on | The admins' audit log (WP6): who changed configuration, decided fixes, re-ran reviews, linked GitHub or signed out a device, from which IP and browser |
| `organizations.default_review_branches` removed; repositories that followed a non-empty list and had none of their own get it copied into `repository_settings.review_branches` (migration `20261016100000`) | Branches to review are set per repository only; an organization default made the list hard to find and edit |

Prisma can't express the CHECK constraints or row-level security, so they are hand-written at the
end of the first migration:

- **CHECKs:** thresholds in 0..1, the agent timeout range, a PR number on pull request reviews,
  finding line ranges, accepted AI fixes needing a resolver, similarity scores.
- **RLS on every table with no policies**, so Supabase's publishable key (the `anon` and
  `authenticated` roles behind its Data API) can read nothing. Only the dedicated `prisma` role
  (`BYPASSRLS`), used by the gateway and orchestrator, reaches the tables.

The `vector` extension is installed in `public` on purpose: it is on the `prisma` role's search path,
and the CI image has no `extensions` schema. Supabase's Security Advisor flags it ("Extension in
Public"); its functions only do vector maths, and with RLS above they reach no data.

Partial indexes such as `uq_reviews_pr_head` are declared in the schema with `where:` (the
`partialIndexes` preview feature). `idx_reviews_status` is written the way Postgres stores it
(`= ANY (ARRAY[...])`), otherwise `migrate diff` reports drift on every run.

## Exports

| Export | What it does |
| --- | --- |
| `createPrismaClient(url)` | A `PrismaClient` over `node-postgres` (`@prisma/adapter-pg`, required by Prisma 7) |
| `SecretBox` | AES-256-GCM `seal` / `open` for OAuth tokens, keyed by `FIELD_ENCRYPTION_KEY` (32 bytes, base64); output `v1.<iv>.<tag>.<ciphertext>` |
| Prisma types and enums | Re-exported from the generated client (`src/generated/prisma`, gitignored, rebuilt by `prisma generate` in every build) |

## Supabase setup (once per project)

1. **SQL Editor:** create the dedicated `prisma` role (Supabase's recommended grants):
   ```sql
   create user "prisma" with password '<password>' bypassrls createdb;
   grant "prisma" to "postgres";
   grant usage on schema public to prisma;
   grant create on schema public to prisma;
   grant all on all tables in schema public to prisma;
   grant all on all routines in schema public to prisma;
   grant all on all sequences in schema public to prisma;
   alter default privileges for role postgres in schema public grant all on tables to prisma;
   alter default privileges for role postgres in schema public grant all on routines to prisma;
   alter default privileges for role postgres in schema public grant all on sequences to prisma;
   ```
2. **Connect → Session pooler** (port 5432, IPv4). Change the user to `prisma.<project-ref>`:
   `postgres://prisma.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Servers (gateway, orchestrator on Render) and migrations both use it.
3. Copy [`.env.example`](.env.example) to `.env` and fill in `DATABASE_URL` and `DIRECT_URL`.

## Develop

```bash
npm run build -w @code-sentinel/db          # prisma generate + tsc
npm run test  -w @code-sentinel/db          # unit tests; integration tests run when TEST_DATABASE_URL is set
npm run migrate:status -w @code-sentinel/db
npm run migrate:deploy -w @code-sentinel/db # apply pending migrations (never prompts)
npm run seed -w @code-sentinel/db           # dev demo data (refused when NODE_ENV=production)
npm run schema:sql -w @code-sentinel/db     # print the SQL that docs/design/schema/schema.sql is built from
```

**Changing the schema:** edit `schema.prisma`, run
`npx prisma migrate dev --create-only --name <change>` in this folder, add any CHECK or RLS
statements by hand, then `npm run migrate:deploy`. Check for drift with
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` ("No difference
detected"), then regenerate `schema.sql` and the ER diagrams.

Use `migrate deploy` rather than `migrate dev` to apply: `migrate dev` can stop at an interactive
prompt and hold Prisma's advisory lock until it's killed.

**Seed:** the same ids as `@code-sentinel/contracts/examples` and the gateway's in-memory dev seed:
organization `code-sentinel`, repository `code-sentinel/consumer-api` (GitHub id 123456789), user
`octo-dev`. Dev data only.
Set `SEED_GITHUB_REPOSITORY=owner/name:githubRepoId` (e.g. the test playground) to seed that
repository instead, so its pull requests are reviewed by a gateway running with `DATABASE_URL`.
Rerunning the seed with or without it switches the repository back and forth.

**Integration tests** (`src/schema.integration.test.ts`) prove the hand-written SQL: the partial
unique index, the CHECKs, JSON reports and the `cancelled` status. They create one throwaway
organization and delete it, cascading, at the end. CI runs them against a `pgvector/pgvector:pg16`
service after `prisma migrate deploy`. Locally, use the same image in Docker (port 55432, so a local
Postgres on 5432 doesn't clash):

```bash
docker run -d --rm --name cs-test-pg -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=code_sentinel -p 55432:5432 pgvector/pgvector:pg16
export TEST_DATABASE_URL=postgres://ci:ci@localhost:55432/code_sentinel
DIRECT_URL=$TEST_DATABASE_URL DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy   # in packages/db
npx turbo run test --concurrency=1    # every package's integration tests; one at a time avoids a Windows lock on prisma generate
docker rm -f cs-test-pg
```

The suites also run against Supabase dev (the session pooler URL), but there the gateway's session
cases are skipped.

Requires Node 20.19+ (Prisma 7).
