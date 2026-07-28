# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

> **Local secrets live in `.env` only.** With Astro 6 + `@astrojs/cloudflare`, `npm run dev` runs on the real Cloudflare `workerd` runtime and reads `.env` directly. Do **not** also create a `.dev.vars` file — if both exist, Cloudflare ignores `.env` and reads `.dev.vars` (they are mutually exclusive). Production secrets are set separately via `npx wrangler secret put` (see [Deployment](#deployment)).

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` file:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` file:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs on every push and PR to `main`, in three jobs:

1. **`ci`** — lint, build, then a local Supabase stack for the test suite. It also
   regenerates `src/db/database.types.ts` and fails on a non-empty `git diff`, so committed
   types cannot go stale against the migrations that generate them.
2. **`drift`** — `needs: ci`, and it runs only on a push to `main`. It compares the
   repository's migration versions against the cloud project's applied migrations (read
   through the Supabase Management API) and fails when either side carries something the
   other does not.
3. **`deploy`** — `needs: [ci, drift]`. The Worker ships only when both are green.

A separate workflow, **`schema-diff`**, runs a DDL comparison (`supabase db diff`) against
the cloud project. It is `workflow_dispatch` only — no schedule — and nothing depends on it,
so a red DDL diff never blocks a release.

### Repository secrets

| Secret                                          | Used by                | Required?                                                                                      |
| ----------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `deploy`               | yes                                                                                            |
| `SUPABASE_ACCESS_TOKEN`                         | `drift`, `schema-diff` | yes — a **dedicated** Supabase personal access token, not a developer's own                    |
| `SUPABASE_PROJECT_ID`                           | `drift`, `schema-diff` | yes — the cloud project ref                                                                    |
| `SUPABASE_DB_PASSWORD`                          | `schema-diff` only     | yes for that workflow — without it the CLI mints a temporary **read-write** role on production |

`SUPABASE_URL` / `SUPABASE_KEY` are **not** repository secrets and must not be added: the
build does not read them, and the test suite gets them from the local stack it starts.

### When `drift` goes red

A deploy now depends on the Supabase Management API being reachable, and the gate fails
closed — so read the job log, which labels the failure:

- **`DRIFT`** — the comparison ran and disagreed. Run `supabase db push`, then
  `gh run rerun --failed` to re-run `drift` and the dependent `deploy`.
- **`GATE UNAVAILABLE`** — the comparison never ran (missing secret, API error). This says
  nothing about the schema. A job whose `needs` failed cannot be started on its own, so a
  prolonged outage is escaped only by a commit removing `drift` from `deploy`'s `needs`.

The full procedure, including which steps are production-mutating, lives in the ship
runbook (`.claude/skills/ship/SKILL.md`).

## License

MIT
