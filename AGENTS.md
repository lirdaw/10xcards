# Repository Guidelines

10xCards is an AI-assisted flashcard app (generate cards from pasted source text) built on Astro 6 server-rendered pages with React 19 islands, TypeScript, Tailwind 4, and Supabase Auth, deployed to Cloudflare Workers. See `README.md` for setup and `context/foundation/prd.md` for product scope.

## Hard Rules

- Import via `@/*` (maps to `src/*`, see `tsconfig.json`); do not use deep relative paths like `../../lib`.
- Read env only through `astro:env/server` (`SUPABASE_URL`, `SUPABASE_KEY`) — never `import.meta.env` or `process.env`. Both are optional server secrets; `createClient` in `src/lib/supabase.ts` returns `null` when unset, so every caller must null-check before use (see `src/pages/api/auth/signin.ts`). **This rule has two exceptions, and they are the last two bullets of this section — `scripts/` and `src/worker.ts`. Read them before filing a violation**: `src/worker.ts` reads the Cloudflare `env` directly and is meant to.
- Run `npx astro sync` after changing routes or content before `lint`/`build`/`typecheck` — CI runs it and lint fails on stale generated types. `tsc` hard-depends on the same generated file (`.astro/types.d.ts`, listed explicitly in `tsconfig.json` because `**/*` skips dotted directories): without it, `tsc --noEmit` reports 13 errors naming files you never touched. `npm run typecheck` therefore syncs first itself, so it is correct when invoked with no CI around it — but the rule stands for `lint`, whose `projectService: true` depends on the same file and which has no such fallback.
- The two rules above are about `src/`. **`scripts/` is the one exception**: it is CI tooling run by bare `node --experimental-strip-types` (`.github/workflows/ci.yml`), with no Vite — so `@/*` does not resolve and `astro:env/server` does not exist there. Those files read `process.env`, import siblings relatively (`./schema-drift.ts`, extension required), and may use `console.*` (`tests/lib/no-logging.test.ts` scans `src/` only). Do not extend this to `src/`, and do not import across the boundary — that would be the deep relative path the first rule forbids.
- **`src/worker.ts` is the second exception, and the only one inside `src/`**: it is the Worker's entry (`main` in `wrangler.jsonc`), so it runs BEFORE Astro exists — it is the module that wraps the adapter handler. `astro:env/server` works only because the imported adapter entrypoint calls `setGetEnv(...)` at module scope, which this file's own import is what triggers; there is no `astro:env` to read from at that point. So it takes the Cloudflare `env` as a parameter and reads what it needs off that parameter — today `env.SENTRY_DSN`, declared as an optional field on a local `WorkerEnv` interface, never `process.env` and never `import.meta.env`, so `tests/lib/no-env-access.test.ts` stays green and unweakened. **The constraint is the shape, not the key count**: adding another Worker-level key to that interface is in scope; reaching for a forbidden accessor, or reading the Worker `env` from any other module, is not. The boundary is the file, and this one must keep importing `@astrojs/cloudflare/entrypoints/server` rather than re-implementing it — that import is what runs the adapter's `setGetEnv(...)`, so wrapping the imported handler is fine and replacing it is not. `SENTRY_DSN` itself is deliberately absent from the `astro:env` schema: it is a Worker secret (`wrangler secret put`), and the deploy procedure lives in `context/changes/sentry-monitoring/deploy-runbook.md`.

## Project Structure

- `src/pages/` — Astro routes; `src/pages/api/` — endpoints (e.g. `auth/signin.ts`).
- `src/components/` — `auth/` (React forms), `ui/` (shadcn-style), plus `.astro` components.
- `src/lib/` — shared helpers (`supabase.ts`, `utils.ts`); `src/middleware.ts` — auth + route guard.
- `src/worker.ts` — the deployed Worker's entry (`main` in `wrangler.jsonc`): it wraps the adapter handler in Sentry. Not a route; every request passes through it.
- `context/foundation/` — PRD, tech-stack, lessons (project docs, not app code).

## Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime.
- `npm run typecheck` — the type gate (`scripts/run-typecheck.ts`): `astro sync` → `tsc --noEmit` → `astro check`, over `src/`, `tests/`, `evals/`, `scripts/`, the root configs and the 18 `.astro` templates at once. Run it before you claim a change compiles; CI runs it and a husky `pre-push` hook blocks the push on it. It asserts on the checked-file count rather than the exit code, because `astro check` exits 0 when its own tooling is missing.
- `npm run lint` / `npm run lint:fix` — ESLint with **type-aware rules** (`eslint.config.js`). Type-aware is not a type check: it reads types to decide rules and reports no `tsc` diagnostic. `npm run typecheck` is the separate command for that, and neither substitutes for the other.
- `npm run format` — Prettier (`.prettierrc.json`).
- `npm run build` — production build; `npx wrangler deploy` — ship to Cloudflare.
- `npx supabase db push` — apply migrations to the **cloud** before merging; CI's `drift` job compares versions against the cloud and blocks `deploy` otherwise (`.github/workflows/ci.yml`).
- `npm test` — Vitest integration suite against the local Supabase stack; start it first with `npm run db:start`. A preflight aborts the run if `SUPABASE_URL` is not local or `OPENROUTER_API_KEY` is set (the suite asserts card counts that only mock generation guarantees). How to add a test: `context/foundation/test-plan.md` §6.
- `npm --prefix agents/review run criteria` — regenerates `agents/review/criteria.json` from the `CRITERIA` array in `agents/review/review-schema.ts`; run it after touching that array and commit the result. The file is generated DATA read by `scripts/run-review-verdict.ts`, which cannot import across the `agents/**` boundary — and the review action reds on drift (`git diff --exit-code` in `.github/actions/review-agent/action.yml`), so a stale copy stops the review rather than skewing it.

## Conventions

- Node 22 (`.nvmrc`). Two husky hooks: `pre-commit` runs `lint-staged` (`eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`), so commits auto-fix; `pre-push` runs `npm run typecheck` over the whole project. Never bypass either with `--no-verify`. **Both need husky installed in your checkout** — `core.hooksPath` is per-repository git config that `git worktree add` does not copy, so run `npm install` (which runs `prepare`) once per worktree. Until 2026-08-03 this bullet claimed commits auto-fix and that was **false in every checkout**: `package.json` had no `prepare` script, so husky had never installed itself and `.git/hooks/` held only samples. If you are unsure, check `git config --get core.hooksPath` returns `.husky/_` rather than trusting this line.
- Auth API routes read `formData`, then `redirect` with `?error=<message>` on failure instead of returning JSON — follow `src/pages/api/auth/signin.ts`.
- Add protected paths to the `PROTECTED_ROUTES` array in `src/middleware.ts`.
- Merge Tailwind classes with the `cn()` helper from `src/lib/utils.ts` (clsx + tailwind-merge); do not concatenate class strings by hand.
- The neutral focus indicator comes from the shared `--ring` token in `src/styles/global.css` only — it feeds both the primitives' `ring-*` and the app-wide `outline-color`. Never add a per-component `focus-visible:ring-*` override for that neutral colour, and never suppress the outline (`outline-none`) without replacing it on the same element. The error state is the one documented exception: it rings in `--destructive` (`aria-invalid:ring-destructive` on the primitives, `focus-visible:ring-red-400` in `src/components/auth/FormField.tsx`) — same value, do not fold it into `--ring`. Both tokens are white/red at FULL alpha because the app renders permanently dark while these are the light-theme tokens; an alpha modifier on either silently drops it below WCAG 1.4.11's 3:1.
- Use `.astro` for static content and layout; add a React island only when interactivity is needed. No Next.js directives (`"use client"` etc.) — they do nothing here.
- UI copy is Polish; flashcard and source-text language follows the user's material.

## Commits

Conventional Commits (`chore:`, `feat:`, `fix:`) as seen in `git log`. When a Jira ticket exists (it almost always does), put its key in the scope: `feat(C10X-1): <summary>`. One line, imperative mood, no multi-line body. **Commit messages MUST be in English — non-negotiable, no exceptions** (even though UI copy is Polish). Never bypass hooks with `--no-verify`.
