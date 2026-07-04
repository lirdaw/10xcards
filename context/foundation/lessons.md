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
