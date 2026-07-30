# Verification — auth-error-copy (C10X-34)

Every figure here is **observed**, recorded from the run that produced it, never predicted.
A count without a date and a command beside it is not evidence.

## Phase 0: Baseline

Measured 2026-07-30, before the first edit of this change. Research deliberately did not run the
suite — its live GoTrue probes and the suite share one rate-limit budget — so this is the first
green reading taken against these files, and the reason a red run later has one hypothesis
instead of two.

### Environment

| Precondition | Observed |
| --- | --- |
| Local Supabase stack | running — `npx supabase status` reports the stack up at `http://127.0.0.1:54321` (Studio `:54323`, Mailpit `:54324`) |
| `OPENROUTER_API_KEY` in `.env` | **absent** — `grep -c OPENROUTER_API_KEY .env` → `0` |
| `OPENROUTER_API_KEY` in the shell | **unset** |
| `SUPABASE_URL` / `SUPABASE_KEY` | set in `.env`; preflight's local-host and anon-key assertions passed on every run below |

The two probe accounts research left in the local `auth.users`
(`probe*-1785435299@example.com`) were still present for this baseline, as the plan's
Critical Implementation Details predicted. They are harmless — the suite provisions its own
accounts per run — and no run below was affected.

### Runs

| # | Command | Result | Detail |
| --- | --- | --- | --- |
| 0.2 | `npm test` | **228 passed / 228, 19 files** | seed `1785438294466`, duration 2.66 s. Matches test-plan §8's recorded state exactly (228/228, 19 files after C10X-32's impl-review) |
| 0.3 | `npx vitest run tests/auth/errors.test.ts` | **38 passed / 38, 1 file** | seed `1785438309984`, duration 1.12 s. Matches the count `change.md` recorded from the framing session |
| 0.4 | `npm run lint` | **exit 0** | 6 problems, **0 errors / 6 warnings**, all `no-console` in `evals/generation-quality.eval.ts:148-163`. Pre-existing and already recorded in test-plan §8 (C10X-32's impl-review F5 corrected their attribution to `evals/`, not `scripts/`) |
| 0.4 | `npm run build` | **exit 0** | server build complete in 5.11 s. One pre-existing `[WARN] [@astrojs/sitemap]` about the missing `site` option — unrelated to this change |

Both seeds are un-pinned by design (test-plan §6.2): the suite shuffles files **and** cases, so
this baseline is one permutation, not the only order in which these 228 pass.

### What this baseline does NOT establish

- It is a **reading of the current tree**, not a claim about the change. Nothing here has been
  falsified yet — the first deliberate-breakage run is Phase 1's check A.
- The counts above are the denominators every later split in this file is read against. When a
  phase adds cases, the denominator moves, and a split quoted without its own denominator is
  the exact rot Phase 6 §2 exists to correct.
- `npm test` collects **zero** eval files (C10X-31's structural exclusion), so nothing in this
  baseline touched the real OpenRouter provider, and the forced-language defect that eval
  records is neither reproduced nor contradicted here.
