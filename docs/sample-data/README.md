# Sample data

Two sets of sample data are used to test and demo Code-Sentinel:

1. **Database seed**: realistic records in all 18 tables, so every dashboard screen has data.
2. **Seeded-bug pull request**: a demo repository branch with known bugs for every agent.

Test results that use them are in the [Test Report](../CodeSentinel_Test_Report.pdf).

## 1. Database seed

Source: [`packages/db/src/seed-data.ts`](../../packages/db/src/seed-data.ts), run by
[`packages/db/prisma/seed.ts`](../../packages/db/prisma/seed.ts).

```bash
npm run seed -w @code-sentinel/db
```

- Needs `DATABASE_URL`. Setup is in [`packages/db/README.md`](../../packages/db/README.md).
- Running it again changes nothing (fixed ids), and it is refused when `NODE_ENV=production`.
- `deleteSeededDatabase` removes it.
- `seed-data.test.ts` checks the seed on every CI run.

88 records across the 18 tables:

| Table | Rows | What is seeded |
| --- | --- | --- |
| `organizations` | 2 | `code-sentinel` and `acme-payments` (a second tenant, to test isolation) |
| `users` | 4 | `octo-dev` and `priya-sec` (admins), `arjun-dev` (member), `riley-acme` (Acme admin) |
| `organization_members` | 4 | Three users in `code-sentinel`, one in `acme-payments` |
| `organization_agent_defaults` | 5 | Security and Logic block, the other three comment |
| `github_installations` | 2 | One per organization |
| `github_user_tokens` | 2 | Encrypted tokens for two users |
| `repositories` | 3 | `consumer-api` (TypeScript), `checkout-service` (Python), `settlement-engine` (Acme) |
| `repository_settings` | 3 | Threshold overrides, agent timeouts, branches to review |
| `repository_members` | 2 | Which members can open `consumer-api` |
| `repository_agent_config` | 5 | Per-agent modes on `consumer-api` |
| `reviews` | 4 | Completed and blocked, partial (Logic timed out), manual and passed, cancelled |
| `agent_runs` | 15 | Five per review: succeeded, timed out, skipped, one LLM fallback |
| `findings` | 12 | Nine on PR #42 (one merged duplicate), two on PR #48, one on PR #51 |
| `suggestions` | 6 | Every state: proposed, accepted, rejected, superseded; rule-based and AI |
| `finding_embeddings` | 4 | 768-dimension vectors for the SQL injection and performance findings |
| `finding_similarities` | 2 | "Seen before" links between PR #48 and PR #42 |
| `session_activity` | 3 | Two devices for `octo-dev`, one for `arjun-dev` |
| `audit_events` | 10 | Settings changes, fixes, re-runs, GitHub link, device sign-out, refused step-up |

## 2. Seeded-bug pull request

Demo repository: [sumit-0804/test-repo](https://github.com/sumit-0804/test-repo). `main` is a clean
Express + Postgres order API. Branch `demo/faulty-checkout` adds the code below; opening a pull
request from it to `main` exercises every agent.

This list is kept here and not in the demo repository, so the agents cannot read it.

### Security

| File | Bug |
| --- | --- |
| `src/config.ts` | AWS access key, `DB_PASSWORD` and `jwtSecret` hardcoded |
| `src/routes/orders.ts` | SQL injection: `userId` put into a template literal |
| `src/routes/orders.ts` | Command injection: `exec` with `req.params.id` |
| `src/routes/users.ts` | SQL injection: email concatenated into the login query |
| `src/routes/users.ts` | MD5 password hashing; error message echoes the password |
| `src/routes/users.ts` | Path traversal in the avatar route (`../` in `id`) |
| `src/routes/users.ts` | Admin check reads a client header |
| `public/app.js` | XSS: `innerHTML` with product names and the `q` query param; `eval` of server settings |
| `scripts/import_orders.py` | `pickle.loads`, `yaml.load` with no safe loader, SQL from `%` and f-strings, `shell=True`, `os.system` |

### Logic

| File | Bug |
| --- | --- |
| `src/pricing.ts` | `applyDiscount` multiplies by `percent` instead of `percent / 100` |
| `src/pricing.ts` | Shipping uses `>` but the comment says "500 and above" |
| `src/pricing.ts` | `taxCents` returns fractional cents |
| `src/pricing.ts` | `paginate` skips the first row (`+ 1`) |
| `src/pricing.ts` | `isValidQuantity` uses `\|\|`, so it is always true |
| `src/routes/orders.ts` | Tax is worked out after shipping is added; the insert isn't awaited and its error is swallowed |
| `src/routes/orders.ts` | `products.push(rows[0])` can push `undefined` for an unknown product |
| `src/routes/users.ts` | `if (req.headers["x-role"] = "admin")` assigns instead of comparing |
| `public/app.js` | `i <= cart.length` off by one; `render()` isn't called when the quantity goes up |
| `scripts/import_orders.py` | Mutable default `seen=[]`; bare `except` returns `None` for an empty list |

### Performance

| File | Bug |
| --- | --- |
| `src/routes/orders.ts` | N+1: one product query per item inside a loop |
| `src/routes/orders.ts` | `readFileSync` inside a request handler |
| `src/routes/orders.ts` | `/orders/export` runs an O(n²) loop that does nothing; builds the CSV by string concatenation; `SELECT *` with no limit |
| `src/pricing.ts` | `orderTotal` is a nested loop instead of a map lookup |
| `public/app.js` | Fetches all products every 100 ms |
| `scripts/import_orders.py` | One customer query per order |

### Style

`var` and `==` (ESLint `no-var`, `eqeqeq`), an empty `catch {}`, missing semicolons, mixed quotes,
`let` that is never reassigned (`prefer-const`), and in Python multiple imports on one line and an
unused import (Ruff), plus Black formatting.

### Documentation

New exported functions in `src/pricing.ts` and the routes have no doc comments. `import_orders.py`
has no module docstring.

### Result of the last run

Reviewed in 34 seconds: 45 findings in 24 places (11 critical, 11 warning, 23 info), all 7 files covered.
