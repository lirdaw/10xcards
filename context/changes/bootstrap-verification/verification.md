---
bootstrapped_at: 2026-06-30T18:54:07Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10xcards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**Why this stack** (from hand-off body):

A solo learner shipping a medium-scale flashcard MVP in 5 after-hours weeks needs
a battle-tested, agent-friendly starter that delivers auth, a private per-user
database, and deployment out of the box. 10x Astro Starter
(Astro + React + TypeScript + Supabase + Cloudflare) is the recommended default
for `(web, js)` and clears all four agent-friendly gates. Supabase supplies
PostgreSQL plus email/password auth with row-level security, which maps directly
onto the PRD's hard per-account data-isolation and privacy guardrails. The LLM
flashcard generation (has_ai) runs as an API call with visible progress to honor
the ~200 ms / >2 s feedback guardrail; payments and realtime are out of scope per
the PRD non-goals, so those flags stay false. Deployment lands on Cloudflare Pages
(the starter default) with GitHub Actions auto-deploy-on-merge — the shape the
starter ships with. Bootstrapper confidence is first-class: expect mostly-smooth
scaffolding with occasional manual steps.

## Pre-scaffold verification

| Signal       | Value                                                  | Severity | Notes                                                        |
| ------------ | ------------------------------------------------------ | -------- | ------------------------------------------------------------ |
| npm package  | not run                                                | n/a      | cmd_template starts with `git clone`; no npm CLI to check    |
| GitHub repo  | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url; within 3 months of 2026-06-30            |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 top-level entries (.env.example, .github, .gitignore, .husky, .nvmrc, .prettierrc.json, .vscode, CLAUDE.md.scaffold, README.md, astro.config.mjs, components.json, eslint.config.js, node_modules, package-lock.json, package.json, public, src, supabase, tsconfig.json, wrangler.jsonc)
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold (cwd already had CLAUDE.md; existing wins)
**.gitignore handling**: moved silently (cwd had no root .gitignore)
**Cloned .git/ handling**: deleted before move-up (upstream starter history not retained)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 6 HIGH, 10 MODERATE, 2 LOW (total 18)
**Direct vs transitive**: 0/1/3/0 direct of total 0/6/10/2 (CRITICAL/HIGH/MODERATE/LOW). Audited 895 total deps.

#### CRITICAL findings

None.

#### HIGH findings

- `astro` [direct] — Reflected XSS via unescaped slot name (also: XSS via spread props, Host-header SSRF in prerendered error page). Fix available.
- `devalue` [transitive] — DoS via sparse array deserialization. Fix available.
- `miniflare` [transitive] — via undici, ws. Fix available.
- `undici` [transitive] — TLS certificate validation bypass via dropped requestTls in SOCKS5 ProxyAgent. Fix available.
- `vite` [transitive] — launch-editor NTLMv2 hash disclosure via UNC path handling on Windows. Fix available.
- `ws` [transitive] — uninitialized memory disclosure. Fix available.

#### MODERATE findings

- `@astrojs/check` [direct] — via @astrojs/language-server. Fix: @astrojs/check@0.9.2 (semver-major).
- `@astrojs/language-server` [transitive] — via volar-service-yaml. Fix via @astrojs/check@0.9.2 (major).
- `@cloudflare/vite-plugin` [transitive] — via miniflare, wrangler, ws. Fix available.
- `js-yaml` [transitive] — quadratic-complexity DoS in merge-key handling. Fix available.
- `supabase` [direct] — via tar. Fix available.
- `tar` [transitive] — PAX size-override parser interpretation differential (file smuggling). Fix available.
- `volar-service-yaml` [transitive] — via yaml-language-server. Fix via @astrojs/check@0.9.2 (major).
- `wrangler` [direct] — via esbuild, miniflare. Fix available.
- `yaml` [transitive] — stack overflow via deeply nested collections. Fix via @astrojs/check@0.9.2 (major).
- `yaml-language-server` [transitive] — via yaml. Fix via @astrojs/check@0.9.2 (major).

#### LOW / INFO findings

- `@babel/core` [transitive] — arbitrary file read via sourceMappingURL comment. Fix available.
- `esbuild` [transitive] — arbitrary file read when running the dev server on Windows. Fix available.

Note: most fixes apply via `npm audit fix`; the `@astrojs/check@0.9.2` chain is a
semver-major downgrade, so review before applying. Bootstrapper does not patch —
the decision is yours.

## Hints recorded but not acted on

| Hint                    | Value           |
| ----------------------- | --------------- |
| bootstrapper_confidence | first-class     |
| quality_override        | false           |
| path_taken              | standard        |
| self_check_answers      | null            |
| team_size               | solo            |
| deployment_target       | cloudflare-pages|
| ci_provider             | github-actions  |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true            |
| has_payments            | false           |
| has_realtime            | false           |
| has_ai                  | true            |
| has_background_jobs     | false           |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` is not needed — this directory already has its own `.git/` (the upstream starter history was deleted before move-up, so nothing leaked).
- Review `CLAUDE.md.scaffold` against your existing `CLAUDE.md` and decide what to keep (`diff CLAUDE.md CLAUDE.md.scaffold`). The starter ships its own agent instructions.
- Configure Supabase (`.env` from `.env.example`) and set up row-level security early — the PRD's per-account data isolation depends on it.
- Address audit findings per your project's risk tolerance — the full breakdown is above. The direct `astro` HIGH is the most actionable.
