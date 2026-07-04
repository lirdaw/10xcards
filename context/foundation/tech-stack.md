---
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
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
---

## Why this stack

A solo learner shipping a medium-scale flashcard MVP in 5 after-hours weeks needs
a battle-tested, agent-friendly starter that delivers auth, a private per-user
database, and deployment out of the box. 10x Astro Starter
(Astro + React + TypeScript + Supabase + Cloudflare) is the recommended default
for `(web, js)` and clears all four agent-friendly gates. Supabase supplies
PostgreSQL plus email/password auth with row-level security, which maps directly
onto the PRD's hard per-account data-isolation and privacy guardrails. The LLM
flashcard generation (has_ai) runs as an API call with visible progress to honor
the ~200 ms / >2 s feedback guardrail; payments and realtime are out of scope per
the PRD non-goals, so those flags stay false. Deployment lands on Cloudflare Workers
(the starter default) with GitHub Actions auto-deploy-on-merge — the shape the
starter ships with. Bootstrapper confidence is first-class: expect mostly-smooth
scaffolding with occasional manual steps.
