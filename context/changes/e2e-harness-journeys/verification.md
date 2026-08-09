# Verification — e2e-harness-journeys

> Every figure here comes from a run executed against the files as they stood at that moment.
> A split is a claim about a run, so it carries its denominator and its observed failure string.

## Phase 1 — Runner foundation (2026-08-09)

Environment: local Supabase stack up, `OPENROUTER_API_KEY` unset, no `.dev.vars` on this machine
(measured before the first edit), `@playwright/test@1.62.1`, chromium `chromium-1234` installed.

### Gates, as observed

| Gate                | Result                                                                            |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm run typecheck` | exit 0 — `Result (140 files): 0 errors, 0 warnings`                               |
| `npm run lint`      | exit 0 — 3 warnings, all `no-console` in `evals/generation-quality.eval.ts`       |
| `npm test`          | **393 passed / 393, 32 files**                                                    |
| `npm run e2e`       | **9 passed (9.3s)**, Playwright starting its own dev server, none started by hand |

**The typecheck count moved 135 → 140, and the delta is enumerated rather than inferred**: four
files this phase adds (`tests/e2e/setup/env.ts`, `tests/e2e/setup/auth.setup.ts`,
`tests/setup/env-assertions.ts`, `tests/lib/e2e-env.test.ts`) plus `tests/e2e/route-guard.spec.ts`,
which is on disk but untracked and belongs to Phase 4. Nothing went red, which is the gate working
rather than failing: `scripts/run-typecheck.ts` asserts against a **floor** (50), never a pinned
count.

**The suite total's breakdown was MEASURED, not derived, and it corrects a stale figure.**
`test-plan.md` §8 carries **364/364, 31 files** from C10X-43, and 364 + 26 = 390 ≠ 393. Re-run with
this phase's new file excluded: **367 passed / 367, 31 files**. So the `+26` is exactly
`tests/lib/e2e-env.test.ts` and the three-case gap predates this branch —
`git diff --name-only main HEAD -- tests/ evals/ scripts/` is **empty**, so it is not attributable
to this change. Carried to Phase 6's doc-sync as an observation, not a correction made here.

### The `setup` project collects a non-zero number of tests

`npx playwright test --list` → `Total: 9 tests in 3 files`, with
`[setup] › setup\auth.setup.ts:18:1 › the local Supabase stack is reachable` present. This is the
criterion's own point: Playwright's default `testMatch` requires `.test.` or `.spec.` in the
filename, and `dependencies: ["setup"]` on a project collecting **zero** tests passes trivially —
a green run that produced no session.

### Deliberate-breakage runs

Four, each restored and each restore verified.

| #   | Edit                                                            | Observed                                                                                                                                                       | Restore                                                             |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1.5 | `SUPABASE_URL=https://abcdefgh.supabase.co` in `.env`           | exit 1, `E2E preflight failed: SUPABASE_URL (from .env) points at "abcdefgh.supabase.co", not the local stack.`                                                | `md5sum -c` → `.env: OK`                                            |
| 1.6 | `npm run dev` started by hand, then `npm run e2e`               | exit 1, `Error: http://localhost:4321 is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.` | dev server killed, port 4321 confirmed free                         |
| 1.7 | `ms-playwright/chromium-1234` renamed to `.off`                 | exit 1, `E2E preflight failed: the chromium binary Playwright needs is not installed. Run: npx playwright install chromium`                                    | directory renamed back, presence re-confirmed                       |
| 1.8 | `.dev.vars` carrying a cloud `SUPABASE_URL` over a valid `.env` | exit 1, `E2E preflight failed: SUPABASE_URL (from .dev.vars) points at "abcdefgh.supabase.co", …` — **naming `.dev.vars`, not `.env`**                         | file **deleted** (it did not exist beforehand), `npm run e2e` green |

**1.5's evidence is stronger than the criterion asked for.** The criterion accepts "the absence of
a dev-server line in the output"; the observed stack trace gives a positive location instead —
`loadConfigFromFile` → `loadUserConfig` → `playwright.config.ts:11` → `resolveE2eEnv` →
`buildE2eEnv` → `assertLocal`. The throw happens while Playwright is still **loading the config**,
before `runTests` reaches plugin setup, which is precisely the ordering the phase exists to
establish.

**1.6 was observed twice, once by accident and once deliberately.** The first `npm run e2e` of the
phase hit a four-day-old `astro dev` (PID 28788, started 2026-08-05 18:29) left over from the
predecessor change, and produced the same hard error. That stale process was killed; the run
recorded above is the deliberate one.

### The unit test found a defect the reading did not

`buildE2eEnv` first modelled the child's precedence as `{ ...source, ...forced, ...devVars }`,
following the plan's own wording. Under that merge the forced `OPENROUTER_API_KEY: ""` overwrites a
key set in `.env` **before** the assertion reads it, so the `.env` case was unfalsifiable —
observed as `refuses a set OPENROUTER_API_KEY` failing with `expected [Function] to throw an error`.
Fixed in the code, not the test: the value under assertion is now the two **real** sources
(`{ ...source, ...devVars }`), and the forcing applies only to the returned map. The comment at the
site records why, so the merge is not "tidied" back.

### Cold boot, measured rather than guessed

`npm run dev` to HTTP 200 on `http://localhost:4321`: **5.8 s** (2026-08-09, warm npm/vite caches).
`webServer.timeout` is set to **120 s** — ~20× headroom, sized for a cold cache or a slower machine
rather than for the number observed here.

### Manual verification

**1.9 — the `PROD_` swap, with a falsifiable oracle for "no request reached it."** The plan asks
for confirmation that the refusal names the host **and** that nothing was sent. The second half is
an absence claim, and this file's own history says an absence asserted against an unbounded set is
not evidence — so the oracle was proved able to detect a hit before it was used to report a miss.

1. **Positive control.** `Clear-DnsClientCache`, then `Resolve-DnsName example.com` → the Windows
   DNS cache went **0 → 2** entries. The oracle can see a lookup.
2. **Baseline.** Cache flushed; entries for `bhwnautkdfzrhepkuozx.supabase.co`: **0**.
3. **The swap.** `SUPABASE_URL` set to the real `PROD_SUPABASE_URL` value (`.env` backed up, md5
   `d9ddbf2e05c76862c41808617bfcbaa5`). `npm run e2e` → exit 1,
   `E2E preflight failed: SUPABASE_URL (from .env) points at "bhwnautkdfzrhepkuozx.supabase.co", not the local stack.`
4. **The measurement.** DNS cache entries for that host after the run: **0**. The hostname was
   never resolved, and a request cannot be sent to a name that was never resolved.
5. **Restore.** `md5sum -c` → `.env: OK`; `npm run e2e` → **9 passed**.

Two limits stated rather than glossed. A count of established `:443` connections was also taken
and is **not** evidence — 29 of them exist at any moment from unrelated applications, so it
discriminates nothing and is recorded only to say it was rejected as an oracle. And only the URL
was swapped, not the key; the both-swapped state is covered by the unit test rather than by hand,
because a production anon key IS `sb_publishable_`, so `localSource({ SUPABASE_URL: cloud })` with
a valid publishable key is exactly that state — which is lessons.md's "anon ≠ local" point.

**1.10 — reading the refusals as a developer, and it found a real defect.** The phase originally
shipped ONE hint block appended to every failure. A developer whose only problem was a missing
browser therefore read three Supabase steps — `npm run db:start`, `npx supabase status`, "copy
them into .env" — before reaching the actual remedy at position four, plus a paragraph about
`.dev.vars` that had nothing to do with their failure. A correct verdict carrying a wrong
diagnosis: the C10X-43 `pre-push` trap, in the phase whose own criterion exists to catch it.

Fixed by splitting the hint into three classes bound at the point of failure — `CREDENTIALS_HINT`,
`GENERATION_HINT`, `BROWSER_HINT`. All three refusals were then re-read end to end and each now
names only its own fix.

**The fix introduced a second defect, which the same reading caught.** `CREDENTIALS_HINT` mentions
`.dev.vars` on _every_ credential failure, so the existing assertion `toThrow(/\.dev\.vars/)`
became satisfiable by the hint alone — unfalsifiable, whatever `originOf` decided. Tightened to
assert the **problem line** (`/SUPABASE_URL \(from \.dev\.vars\)/`) and proved falsifiable rather
than argued: pinning `originOf` to `".env"` turns **1 of 26** red — exactly
`names .dev.vars, not .env, when .dev.vars is what carries the offending value` — while the other
25 stay green. Restored, `md5sum -c` → `tests/e2e/setup/env.ts: OK`.

**One hazard found and deliberately NOT fixed.** Playwright's own port-collision message ends
"…or set `reuseExistingServer:true` in config.webServer" — i.e. the tool suggests precisely the
setting this config refuses, and a developer following it would disarm the local-host guarantee
(the config comment explains why it is unset, but the developer is reading a terminal, not the
config). Intercepting it would mean a config-time port probe, which is outside this phase's
contract. Recorded here so §6.6 can carry it rather than have it rediscovered.

Gates re-run after the 1.10 fix: `npm run typecheck` **140 files, 0 errors**; `npm run lint`
**exit 0, 3 warnings**; `npm test` **393/393, 32 files**; `npm run e2e` **9 passed**.

### Scope decisions taken during Phase 1

- **The `teardown` project is NOT declared yet.** The plan allows Phase 1 to land a placeholder
  setup and lets Phase 3 stand the projects up. Declaring a teardown project whose file does not
  exist would reproduce the exact defect the plan warns about one project over — an empty project
  that passes trivially while reading as "cleanup is wired". It lands in Phase 3 with its file.
- **`tests/e2e/setup/auth.setup.ts` is a reachability placeholder**, stated as such in its own
  header. The `chromium` project still consumes the hand-made `playwright/.auth/user.json`; the
  producer is Phase 3.
- **`tests/e2e/route-guard.spec.ts` stays untracked.** It is Phase 4's deliverable and is not part
  of this phase's commit, even though it is on disk and running green.
- **`parseDevVars` was extracted and tested rather than left inside the I/O wrapper.** The repo
  carries no `dotenv` to borrow, so the `.dev.vars` assertions are only as good as the parser
  behind them — which would otherwise have been the one thing hiding behind the seam the plan
  says must hide nothing.

### What Phase 1 does NOT establish

- **Nothing about a reproducible session.** `playwright/.auth/user.json` is still the hand-made,
  4-day-old artifact; the setup project does not yet produce it.
- **Nothing about cleanup.** `seed.spec.ts` still deletes its deck inline, the pattern that already
  orphaned `E2E deck 1785947414992`.
- **The `PROD_` swap is not yet exercised by hand** (manual criterion 1.9), and the refusal texts
  have not yet been read as a developer would read them (1.10).
- **The layer is still never a gate** — no CI job, nothing in `needs:`, no schedule (§5).
