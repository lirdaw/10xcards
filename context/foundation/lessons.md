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
