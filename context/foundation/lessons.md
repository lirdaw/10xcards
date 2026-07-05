# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Match branch names in CI/hooks to the repo's actual default (`main`)

- **Context**: CI/CD workflows and git-related config (`.github/workflows/*.yml`, husky hooks) — implement / review phase.
- **Problem**: The scaffolded `ci.yml` triggered only on `master`, but the repo's working branch is `main`, so CI silently never ran on any push or PR. Caught during M1L4 setup.
- **Rule**: When generating or reviewing CI/CD workflows, git hooks, or any branch-referencing config, confirm branch names match the repo's actual default branch. This project uses `main` — do not assume `master`.
- **Applies to**: implement, impl-review

## One deploy pipeline per Cloudflare Worker — Workers Builds XOR GitHub Actions

- **Context**: Wiring CI/CD auto-deploy for a Cloudflare Workers project connected to a Git repo (Cloudflare Workers Builds and/or GitHub Actions + `cloudflare/wrangler-action`).
- **Problem**: Both can be active on the same Worker at once, so every push triggers two competing deploys. On this project Workers Builds failed with "build token deleted or rolled" while GitHub Actions deployed fine — confusing "build failed" alerts despite a live deploy, plus risk of the two pipelines racing/overwriting each other.
- **Rule**: Pick exactly one deploy pipeline per Worker. If using GitHub Actions + `cloudflare/wrangler-action`, disconnect Cloudflare Workers Builds from the repo (Dashboard → Worker → Settings → Build). Never run both for the same Worker.
- **Applies to**: plan, implement

## @astrojs/cloudflare deploys the generated dist config — rebuild after editing wrangler.jsonc

- **Context**: Deploying an Astro project with `@astrojs/cloudflare` via `wrangler deploy` (local or CI); any edit to `wrangler.jsonc`.
- **Problem**: `wrangler deploy` uses the adapter-generated `dist/server/wrangler.json` (via a `.wrangler/deploy/config.json` redirect), not `wrangler.jsonc` directly. Editing `wrangler.jsonc` without rebuilding means the change never reaches the deploy — cost two failed deploys before we saw the added id wasn't in the generated config.
- **Rule**: After editing `wrangler.jsonc`, run `npm run build` before `wrangler deploy` so the adapter regenerates `dist/server/wrangler.json`. Verify propagation by inspecting the generated file, not `wrangler.jsonc`.
- **Applies to**: implement, impl-review

## @astrojs/cloudflare auto-enables a SESSION KV binding — bind a real namespace with an id

- **Context**: Deploying Astro 6 + `@astrojs/cloudflare` to Workers (sessions enabled by default).
- **Problem**: The adapter injects a `SESSION` KV binding with no id into the generated config. Without a `kv_namespaces` entry carrying a concrete `id` in `wrangler.jsonc`, `wrangler deploy` tries to auto-provision the namespace and fails (HTTP 400 "a namespace with this title already exists" once one exists). Blocked the first production deploy.
- **Rule**: Declare `kv_namespaces: [{ binding: "SESSION", id: "<id>", preview_id: "<id>" }]` in `wrangler.jsonc` pointing at a real namespace (create with `wrangler kv namespace create`), then rebuild. Don't rely on deploy-time auto-provisioning.
- **Applies to**: implement

## Local Cloudflare secrets: use .env OR .dev.vars, never both

- **Context**: Local dev secrets for Astro 6 + `@astrojs/cloudflare` (wrangler 4.x, Aug-2025+ tooling), read via `astro:env/server`.
- **Problem**: `.env` and `.dev.vars` are mutually exclusive in Cloudflare's local tooling — if `.dev.vars` exists, `.env` is silently ignored. Keeping both (e.g. via the legacy `cp .env .dev.vars`) means edits to `.env` don't take effect; `astro dev` runs on real workerd and reads either, so the staleness is invisible until values drift.
- **Rule**: Keep exactly one local secrets file. For this stack use `.env` as the single source; do not create `.dev.vars`. Production secrets go via `wrangler secret put`, independent of both.
- **Applies to**: implement, impl-review

## Cloud migration is a separate step from app deploy

- **Context**: any change carrying a database migration / schema change targeting cloud Supabase; the deploy/ship phase.
- **Problem**: Merge to main deploys the Worker but does NOT apply migrations to the cloud database — a "shipped" app then runs against an un-migrated schema.
- **Rule**: Treat cloud migration as a step distinct from app deploy. "Shipped" = app deploy AND `db push`: `supabase login` (access-token, separate from the keys in `.env`) → `supabase link --project-ref <ref>` → `supabase db push`.
- **Applies to**: implement, impl-review

## Add RETURNING to RLS write-isolation tests in Supabase Studio

- **Context**: testing RLS write isolation (DELETE/UPDATE) via the Supabase Studio SQL editor.
- **Problem**: In Studio, DELETE/UPDATE without RETURNING always reports "No rows returned" — whether it touched 0 or 1 rows — so a policy failure reads as a PASS (false positive).
- **Rule**: Add RETURNING to DELETE/UPDATE in RLS write-isolation tests so "no rows" truly means 0 rows affected. In psql this is explicit anyway (DELETE 0 vs DELETE 1); in Studio, RETURNING is what makes the distinction visible.
- **Applies to**: implement, impl-review

## RLS tests need role + JWT claims AND a positive control

- **Context**: testing RLS policies for per-user data isolation.
- **Problem**: `SET ROLE authenticated` alone leaves `auth.uid() = NULL`, so every policy denies everything — the user sees 0 others' rows AND 0 of their own. That looks like isolation but is actually a broken policy. Testing as `postgres` (superuser) bypasses RLS entirely.
- **Rule**: An RLS test must set the role AND the JWT claims (`set local request.jwt.claims` with a `sub`), AND include a positive control: `count(*) > 0` for the user's own data. Never test RLS as `postgres`.
- **Applies to**: implement, impl-review

## Put commit conventions in AGENTS.md, not context memory

- **Context**: git commit conventions in an agent-driven repo.
- **Problem**: A freshly-cleared agent won't follow a convention that lives only in conversation/context memory — it will commit inconsistently.
- **Rule**: Encode commit conventions (English + Jira-number scope, e.g. `feat(C10X-1): …`, one line, imperative) in AGENTS.md so a cleared agent commits correctly on its own. When a convention matters, write it into the rules file — don't rely on context memory.
- **Applies to**: all

## Keep main linear after a GitHub PR merge

- **Context**: local `main` after merging a PR on GitHub, when local `main` still had un-pushed commits.
- **Problem**: `git pull` wants to create an ugly merge-commit because local `main` diverged from `origin/main`.
- **Rule**: To keep linear history: `git reset --hard origin/main` → `git cherry-pick <local-sha>` → `git push`.
- **Applies to**: implement
