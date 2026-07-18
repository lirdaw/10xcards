# Repository Guidelines

10xCards is an AI-assisted flashcard app (generate cards from pasted source text) built on Astro 6 server-rendered pages with React 19 islands, TypeScript, Tailwind 4, and Supabase Auth, deployed to Cloudflare Workers. See @README.md for setup and @context/foundation/prd.md for product scope.

## Hard Rules

- Import via `@/*` (maps to `src/*`, see @tsconfig.json); do not use deep relative paths like `../../lib`.
- Read env only through `astro:env/server` (`SUPABASE_URL`, `SUPABASE_KEY`) — never `import.meta.env` or `process.env`. Both are optional server secrets; `createClient` in @src/lib/supabase.ts returns `null` when unset, so every caller must null-check before use (see @src/pages/api/auth/signin.ts).
- Run `npx astro sync` after changing routes or content before `lint`/`build` — CI runs it and lint fails on stale generated types.

## Project Structure

- `src/pages/` — Astro routes; `src/pages/api/` — endpoints (e.g. `auth/signin.ts`).
- `src/components/` — `auth/` (React forms), `ui/` (shadcn-style), plus `.astro` components.
- `src/lib/` — shared helpers (`supabase.ts`, `utils.ts`); @src/middleware.ts — auth + route guard.
- `context/foundation/` — PRD, tech-stack, lessons (project docs, not app code).

## Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime.
- `npm run lint` / `npm run lint:fix` — ESLint, type-checked (@eslint.config.js).
- `npm run format` — Prettier (@.prettierrc.json).
- `npm run build` — production build; `npx wrangler deploy` — ship to Cloudflare.
- `npm test` — Vitest integration suite against the local Supabase stack; start it first with `npm run db:start`. A preflight aborts the run if `SUPABASE_URL` is not local or `OPENROUTER_API_KEY` is set (the suite asserts card counts that only mock generation guarantees). How to add a test: @context/foundation/test-plan.md §6.

## Conventions

- Node 22 (@.nvmrc). A husky `pre-commit` hook runs `lint-staged` (`eslint --fix` on `*.{ts,tsx,astro}`), so commits auto-fix; do not bypass with `--no-verify`.
- Auth API routes read `formData`, then `redirect` with `?error=<message>` on failure instead of returning JSON — follow @src/pages/api/auth/signin.ts.
- Add protected paths to the `PROTECTED_ROUTES` array in @src/middleware.ts.
- Merge Tailwind classes with the `cn()` helper from @src/lib/utils.ts (clsx + tailwind-merge); do not concatenate class strings by hand.
- Use `.astro` for static content and layout; add a React island only when interactivity is needed. No Next.js directives (`"use client"` etc.) — they do nothing here.
- UI copy is Polish; flashcard and source-text language follows the user's material.

## Commits

Conventional Commits (`chore:`, `feat:`, `fix:`) as seen in `git log`. When a Jira ticket exists (it almost always does), put its key in the scope: `feat(C10X-1): <summary>`. One line, imperative mood, no multi-line body. **Commit messages MUST be in English — non-negotiable, no exceptions** (even though UI copy is Polish). Never bypass hooks with `--no-verify`.
