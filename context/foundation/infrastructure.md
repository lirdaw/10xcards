---
project: 10xcards
researched_at: 2026-07-04
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 (+ React 19 islands)
  runtime: Cloudflare workerd
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare is the only candidate that scores a clean pass on all five agent-friendly
criteria while requiring **zero migration** — it is already the stack's runtime target
(`@astrojs/cloudflare` on `workerd`), so there is no adapter swap, no Dockerfile, and no
container path to introduce. At 10k–100k requests/month the workload sits entirely inside
the free tier ($0), the developer is already familiar with the platform, and Supabase +
OpenRouter are reached over plain HTTPS as external services with no co-location penalty.
The decision was confirmed after a three-lens anti-bias cross-check surfaced real risks
(runtime-compat, CPU/bundle limits, Astro 6 beta) — all judged manageable and recorded in
the risk register below rather than disqualifying.

## Platform Comparison

Scored Pass / Partial / Fail against the five criteria in
`references/agent-friendly-criteria.md`. Hard filter (no persistent connections required)
dropped nothing — every serverless-only platform stays eligible. Runtime is not a hard
drop either: non-Cloudflare platforms remain viable but require an `@astrojs/node` adapter
swap (a real, one-time migration cost off `workerd`).

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | 4 Pass, 1 Partial |
| **Netlify** | Partial | Pass | Pass | Pass | Pass | 4 Pass, 1 Partial |
| **Railway** | Pass | Pass | Pass | Pass | Partial | 4 Pass, 1 Partial |
| **Render** | Partial | Pass | Partial | Pass | Pass | 3 Pass, 2 Partial |
| **Fly.io** | Partial | Partial | Pass | Pass | Partial | 2 Pass, 3 Partial |

**Per-platform notes:**

- **Cloudflare** — `wrangler deploy` / `wrangler tail` / `wrangler rollback` cover the full
  loop non-interactively; docs are GitHub-hosted markdown with a Documentation MCP server;
  multiple GA MCP servers (Docs, Bindings, Builds, Observability, Logpush). No adapter swap.
- **Vercel** — `@astrojs/vercel` (v11) is GA with Fluid compute reducing cold starts; CLI
  has clean `deploy`/`rollback`/`logs`. Only ding: Vercel MCP is **beta**. Hobby tier is
  non-commercial-use only → a monetized product needs Pro ($20/seat/mo).
- **Netlify** — `@astrojs/netlify` GA day-one on Astro 6; official production MCP server;
  docs served as `.md` + `llms.txt`. Partial on CLI because there is **no clean rollback
  verb** (UI/API only). Credit-based free tier (300 credits/mo) can pause the site if
  bandwidth/deploys spike.
- **Railway** — Railpack auto-builds Node SSR with no Dockerfile; full CLI incl.
  `redeploy`. MCP is **beta**. Requires `@astrojs/node` swap and always costs ≥$5/mo once
  the trial credit ends; co-located DB advantage is moot (external Supabase).
- **Render** — CLI GA but rollback lives in the REST API, not a headline command; general
  docs are server-rendered HTML (not markdown repos). MCP GA. Free tier spins down after
  15 min idle (30–60s cold start) → disqualifying for a user-facing MVP; realistic cost
  ~$7/mo Starter. Requires `@astrojs/node` swap.
- **Fly.io** — Container-only: requires a Dockerfile and `@astrojs/node` swap (genuine
  migration off `workerd`). No dedicated rollback command; MCP is experimental; free tier
  removed. Strong at persistent processes the app does not need.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on every criterion and on migration cost — it is where the stack already points. Free
at this scale, edge-native (though single-region audience makes that a soft benefit), and
the developer's known platform. The full GA MCP fleet plus `wrangler` give an agent a
complete read/write operational loop.

#### 2. Vercel

The strongest runner-up: GA Astro adapter, best-in-class DX, and a serverless model that
sidesteps Cloudflare's 10 ms-CPU free-tier ceiling (300 s function duration on Hobby). The
gaps vs. the leader are a beta MCP and the Hobby non-commercial restriction that forces Pro
($20/mo) for any real product — plus a (light) adapter swap.

#### 3. Netlify

Keeps the serverless shape without a container path, ships an official production MCP
server, and serves agent-readable docs. It falls behind on the missing CLI rollback verb
(an agent-operability gap) and a credit-based free tier that is easy to blow with heavy
assets or frequent deploys.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`nodejs_compat` is a partial shim, not Node.** `@supabase/ssr` and the OpenRouter SDK
   work until they touch an API outside the polyfill (parts of `crypto`, certain stream /
   `Buffer` paths). Failures are runtime-only and surface on production, not in the build.
2. **10 ms CPU limit (free tier) collides with LLM generation.** Waiting on OpenRouter is
   I/O (uncounted), but parsing / streaming / validating a large response burns CPU. PRD
   FR-018 (generation timeout) lands squarely on the platform's thinnest limit.
3. **3 MB gzip bundle cap (free).** Astro 6 + React 19 + Supabase SSR + validation is a
   growing worker; the free cap is reachable. Paid (10 MB) fixes it — a cost the "free"
   narrative hides.
4. **Pages → Workers drift.** `tech-stack.md` says `cloudflare-pages`; the canonical 2026
   path is Workers, and the two command sets are **not** interchangeable. The deploy plan
   must pick one explicitly or the agent deploys into a dead path.
5. **Known `base` bug in `@astrojs/cloudflare`** ([#16276](https://github.com/withastro/astro/issues/16276))
   — prefix dropped on static assets under a sub-path. A silent regression if a base path
   is ever configured.

### Pre-Mortem — How This Could Fail

Six months on, the Cloudflare choice turned out badly. The solo dev assumed "workerd ≈
Node" because the starter ran instantly. First crack: the flashcard-generation function
began throwing intermittent `crypto` errors under load, because `@supabase/ssr` hit a path
`nodejs_compat` did not cover — it worked in `astro dev` and failed only on the edge, so
debugging ate evenings. Then generation itself: longer source texts produced OpenRouter
responses whose streaming exceeded the free-tier CPU budget, so users saw an error instead
of cards — directly breaking the "responsive generation" guardrail and the 75% acceptance
metric. Moving to paid fixed CPU, but the bundle crossed 3 MB and deploys started bouncing.
Astro 6 was still beta then, so every adapter bump risked regression. In the end the
platform was not wrong — the wrong move was assuming edge-serverless was "free and like
Node," chosen because it was the default and familiar rather than verified against the
generation workload.

### Unknown Unknowns

- **Astro 6 is still beta (early 2026).** The whole recommendation rests on a pre-release
  framework; the adapter being GA does not shield against breaking changes in Astro itself.
  Pin versions and watch the changelog.
- **`astro dev` / `preview` now run on real workerd** (Vite plugin), so `wrangler dev` is
  mostly redundant — but some edge differences only appear post-deploy if you rely on the
  old flow.
- **50 subrequests/request limit (free).** One request doing Supabase auth + a few queries
  + OpenRouter climbs the counter faster than the simple flow suggests.
- **Supabase region vs. Cloudflare edge.** The worker starts near the user, but every
  Supabase query travels to *its* region. For a single-region audience the edge yields ~0
  gain and can add a hop — co-locate Supabase near users, not "globally."
- **Secrets: `wrangler secret put` (prod) vs `.env` (local)** are two separate worlds. It is
  easy to deploy with a missing `SUPABASE_KEY`; `createClient` then returns `null` and the app
  silently runs unauthenticated (the null-check swallows it instead of erroring).

## Operational Story

- **Preview deploys**: `wrangler versions upload` creates a preview version with a unique
  `*.workers.dev` preview URL without promoting to production; branch/PR previews wire up
  via the Workers Builds GitHub integration. Preview URLs are public by default — gate with
  Cloudflare Access if the preview must stay private.
- **Secrets**: production secrets live in Workers Secrets, set via `wrangler secret put
  SUPABASE_URL` / `SUPABASE_KEY` (and the OpenRouter key); local dev reads `.env`
  (git-ignored; do NOT also create `.dev.vars` — it silently shadows `.env`). GitHub Actions
  build reads them from repository secrets. Rotation =
  `wrangler secret put` again (overwrites) + redeploy. Never commit them to `wrangler.jsonc`.
- **Rollback**: `wrangler deployments list` to find the prior version id, then
  `wrangler rollback [version-id]` (omit id to revert to the immediately previous). Time to
  revert is seconds. Caveat: rollback restores the worker only — external Supabase schema /
  data changes do **not** roll back with it.
- **Approval**: an agent may deploy, tail logs, list versions, and roll back unattended.
  Human-only: rotating the primary Supabase key, dropping/altering Supabase tables, deleting
  the Worker or project, and changing billing tier (free → paid). These are dashboard-by-hand.
- **Logs**: `wrangler tail` streams live runtime logs (`--format json` for structured
  parsing); `wrangler deployments list` shows deploy history. The Observability MCP server
  (`observability.mcp.cloudflare.com`) exposes structured read-only log/metric queries when
  the agent needs many discovery-style lookups instead of parsing CLI output.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `nodejs_compat` gap breaks `@supabase/ssr` / OpenRouter SDK at runtime | Devil's advocate | M | H | Keep `compatibility_flags: ["nodejs_compat"]`; smoke-test auth + a real generation call against a deployed preview (not just `astro dev`) before promoting. |
| LLM generation exceeds 10 ms CPU on free tier → user-facing error | Pre-mortem | M | H | Budget for the $5 paid plan before real usage; keep response parsing lean; honor FR-018 with visible retry. |
| Worker bundle crosses 3 MB gzip (free) / 10 MB (paid) → deploys bounce | Devil's advocate | M | M | Monitor bundle size in CI; move to paid (10 MB) before it bites; tree-shake heavy deps. |
| Pages vs Workers command mismatch deploys into a dead path | Devil's advocate | M | M | Deploy plan must pin **Workers** (`wrangler deploy`) explicitly; update `tech-stack.md` `deployment_target` from `cloudflare-pages` to `cloudflare-workers`. |
| Astro 6 beta ships a breaking change | Unknown unknowns / Research finding | M | M | Pin Astro + adapter versions; watch the changelog; run `npx astro sync` + build in CI on every bump. |
| Missing `SUPABASE_KEY` secret → app silently runs unauthenticated (`createClient` → null) | Unknown unknowns | L | H | Add a deploy-time check that both secrets are set; treat a null client as a hard failure in a health endpoint, not a silent skip. |
| `@astrojs/cloudflare` `base` bug drops prefix on static assets ([#16276](https://github.com/withastro/astro/issues/16276)) | Research finding | L | M | Avoid a sub-path `base`; if required, verify asset URLs on a preview deploy. |
| Supabase region far from single-region audience adds latency hop | Unknown unknowns | L | M | Provision Supabase in the region closest to the target users; do not assume edge cancels DB latency. |
| 50 subrequests/request limit (free) exceeded by auth + queries + LLM in one request | Unknown unknowns | L | M | Keep per-request fan-out low; batch Supabase queries; paid tier raises the limit. |

## Getting Started

Validated against the pinned stack (Astro 6, `@astrojs/cloudflare` v13+, Node 22):

1. **Confirm the adapter targets Workers** (not the legacy Pages flow). `@astrojs/cloudflare`
   v13+ is required for Astro 6; ensure `wrangler.jsonc` has `main: ./dist/_worker.js/index.js`,
   `compatibility_flags: ["nodejs_compat"]`, and the assets binding to `./dist`.
2. **Dev on the real runtime**: `npm run dev` already runs on `workerd` via the Cloudflare
   Vite plugin — a separate `wrangler dev` is redundant for local fidelity.
3. **Set production secrets**: `npx wrangler secret put SUPABASE_URL`, `... SUPABASE_KEY`,
   and the OpenRouter key. For local dev keep the same values in `.env` (git-ignored) —
   `astro dev` runs on `workerd` and reads `.env`; do NOT create `.dev.vars` (it shadows `.env`).
4. **Build + deploy**: `npm run build` then `npx wrangler deploy`. Confirm the printed
   `*.workers.dev` URL serves the app and that sign-in works (proves secrets are wired).
5. **Verify rollback works before you need it**: `npx wrangler deployments list`, then
   `npx wrangler rollback` — confirm it reverts, so the escape hatch is proven.

> Next: proceed to Plan Mode for the first deploy — prompt "Wykonajmy pierwsze wdrożenie w
> oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`". Note the
> `tech-stack.md` `deployment_target` still says `cloudflare-pages`; the plan should target
> **Workers** and that field should be corrected.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
