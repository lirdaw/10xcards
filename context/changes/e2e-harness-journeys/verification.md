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

## Phase 5 — Journey A: an accepted card survives a reload (2026-08-09)

Environment: local Supabase stack up (`/rest/v1/` → 200), `OPENROUTER_API_KEY` unset, no
`.dev.vars`, port 4321 free before every run (required — `reuseExistingServer` is unset, so a
listening port is a hard error).

### Gates, as observed

| Gate                | Result                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck` | exit 0 — `Result (145 files): 0 errors, 0 warnings`                                     |
| `npm run lint`      | exit 0 — 3 warnings, all `no-console` in `evals/generation-quality.eval.ts` (unchanged) |
| `npm test`          | **399 passed / 399, 33 files**, seed `1786288780583`                                    |
| `npm run e2e`       | **12 passed (12.1s)** — 2 setup, 3 specs across 9 cases, 1 teardown; own dev server     |

Two figures are stated as observed rather than derived. The typecheck count is **145**; this phase
adds exactly one file to the gate (`tests/e2e/accepted-card-survives-reload.spec.ts`), and the
140 → 144 movement belongs to Phases 2-4, which this section does not enumerate because it did not
measure it. And **`npm test` is unchanged by this phase, which is correct rather than suspicious**:
the deliverable is a `.spec.ts`, which Vitest's `include` does not collect — the property Phase 2's
`tests/lib/e2e-isolation.test.ts` exists to assert.

### The oracle, and why it sits on the deck page

A content-free count of `getByRole("button", { name: "Edytuj", exact: true })`, **0 → 1 → N → still
N after `reload()`**, asserted only while the browser is on `/decks/<publicId>`. Each step asserts a
distinct expected number, so a red names which transition failed — which the breakage runs below
then exercised, each on a different one.

The zero point is genuine rather than a proxy: `listFlashcards` filters
`.eq("state_id", STATE_ACCEPTED)` (`src/lib/flashcards.ts:97-104`), so the three cards exist as rows
while being invisible on the deck page. Every deck-page count is paired with a **presence** anchor
(`getByRole("heading", { name: deckName, exact: true })`) for journey B's E1 reason: `toHaveCount(0)`
passes green over a 500, over "Błąd" and over "Nie znaleziono talii", and an absence asserted against
an unbounded set is not falsifiable.

### Two hydration gates, both measured rather than assumed

Both follow `auth.setup.ts`'s rule — retry the ACTION until its EFFECT is observable — and the
choice of signal was decided, not taken first-to-hand.

- **Generator island**: the live character counter. The obvious candidate ("select + Nowa talia,
  wait for the name field") is **not** a signal: with an account holding no decks,
  `decks[0]?.publicId ?? NEW_DECK` makes `isNewDeck` true in SSR, so the field is in the initial HTML
  and the guard would exit over a dead island. The counter's text can only change through a React
  re-render.
- **Review island**: the bulk toolbar, which `CandidateSelectionBar` renders as `null` until
  something is selected. Guard-first is mandatory, not decorative — the click TOGGLES, so a retry
  after a successful click would deselect and hang.

The generator gate was then **observed failing loudly** during the 5.8 work: under a machine starved
by 301 concurrent process spawns it timed out on `Received string: "0 / 10000"` rather than
proceeding over an unhydrated island. Accidental evidence that the gate is the right shape.

### Deliberate-breakage runs

Four, each restored and each restore verified by hash (`src/lib/flashcards.ts`
`270120bb454162b3ee6d7942933182fd`, `cards/batch.ts` `06622bda96c41fa54f2760564f556388`, the spec
`1dc28e8344194b21f031c6f33fd0b8c9`), with `git status --porcelain -- src/` empty afterwards.

| #    | Edit                                              | Observed                                                                                         | Split                                                                         |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 5.2  | `.eq("state_id", STATE_ACCEPTED)` removed         | `toHaveCount` **Expected: 0, Received: 3**, `14 × locator resolved to 3 elements`, spec line 205 | **1 of 11 red** (journey A only); all 7 journey-B cases + both controls green |
| 5.3a | `setFlashcardState(…, [], …)` — the write no-oped | `toHaveCount` **Expected: 2, Received: 3**, spec line 221 (the CANDIDATE count)                  | **1 of 4 red**; the reload assertion never reached                            |
| 5.3b | `TARGET_STATE.accepted` → `STATE_REJECTED`        | `toHaveCount` **Expected: 1, Received: 0**, spec line 225 (the DECK count)                       | **1 of 4 red**                                                                |
| 5.4  | `exact: true` dropped from both counting locators | `toHaveCount` **Expected: 2, Received: 3**, `resolved to 3 elements`, spec line 242              | **1 of 4 red**                                                                |

**5.3 became a PAIR, and the plan predicted only one of its two halves.** The criterion named the
0 → 1 deck assertion; the no-op variant dies earlier, on the candidate count, because a card that was
never written never leaves the review screen. Routing the accept to `rejected` instead reaches the
predicted assertion. So the two variants fail **different cases on different assertions** and thereby
separate "the card never left the review screen" from "it left but never arrived" — §6.10's shape,
obtained for one extra run. Recorded as observed rather than rounded to the prediction, the same way
§8 records C10X-29's `missingLocal` neuter and C10X-30's case 8.

**5.4's red is real, and what stayed GREEN is the other half of the finding.** The plan explicitly
allowed a green here. It is red — but only from the `Akceptuj` side, and only because the spec
asserts the candidate count at the one moment the bulk toolbar is on screen (`Akceptuj (2 fiszki)`
matching the bare name under substring rules). That assertion exists for exactly this purpose. The
**deck-page `Edytuj` counts passed without `exact: true`** (lines 205 and 225, both before the
failure), so that flag is a layer-wide rule there rather than a live discriminator — no other
accessible name in `src/` contains `Edytuj`, verified by enumeration (two sites:
`FlashcardItem.tsx:241`, `CandidateItem.tsx:287`).

### 5.5 — the row-delta oracle, two counts and not one

Counted as the e2e account under RLS, before and after a full `npm run e2e`:
`{"decks":0,"sessions":0}` → **12 passed** → `{"decks":0,"sessions":0}`. Both deltas **0**.

A deck-only count would have read green over the table journey A is the first spec to write:
`generation_session` has no deck foreign key at all (`generation_session.sql:24` references
`auth.users` only; `flashcard.generation_id` is `on delete set null` at `:47`).

**Why a 0 → 0 delta is not vacuous here**, since this file's own history says an oracle satisfied by
"nothing ever happened" is not one: the journey asserts three cards on the deck page mid-run, so the
rows demonstrably existed and were demonstrably removed. The `BEFORE: 0/0` additionally is
retrospective evidence for the teardown across the **three failed** breakage runs above — each
created a deck and a session, each died mid-spec, and the account was clean before the next run.

### Manual verification

**5.7 — which card crossed, measured rather than eyeballed.** A count cannot say WHICH card became
part of the deck, so the headed run carried a temporary probe (removed afterwards; spec hash back to
`1dc28e83…`, zero `PROBE` residue). Observed:

| Stage                        | Observed                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| Review screen, before accept | `["Przykładowe pytanie 1", "…2", "…3"]`                    |
| After the per-card accept    | `["…2", "…3"]` remain                                      |
| Therefore crossed            | `["Przykładowe pytanie 1"]`                                |
| Deck page shows              | `["Przykładowe pytanie 1"]`, and `…2` / `…3` asserted at 0 |

The card that left the review screen is the card that arrived in the deck, and nothing else leaked
in. Card content is deliberately **not** an oracle in the shipped spec — `mockCards` is byte-identical
across calls, so two generations into one deck produce duplicate fronts — which is why this was a
one-off probe rather than an assertion.

**5.8 — the interrupt, answered on the reachable path and NAMED as a gap on the other.**

Measured: with the deck and the session both confirmed present at the moment of interruption, an
**abrupt termination of the run's process tree** leaves the teardown project **unexecuted** and both
rows orphaned (`{"decks":1,"sessions":1}` after, from `{"decks":0,"sessions":0}` before). The
per-worker registry file **survives on disk**, so the residue is identifiable — but the next run's
`removeOutputDirs` wipes it before anything can read it, so the recovery window closes at the next
`npm run e2e`. This is the registry's residual risk (plan, Phase 3 §3) reached by a second route:
not "a worker killed between the write and its flush" but "the whole run killed before the teardown
phase". Both orphaned rows were inspected and deleted; residue re-measured at `0/0`.

**The true console-Ctrl-C path is NOT measured, and the reason belongs in the record.** Node's
`child.kill("SIGINT")` is `TerminateProcess` on Windows, so the only way to deliver a real Ctrl-C is
`GenerateConsoleCtrlEvent`. The attempt to do so used `dwProcessGroupId = 0`, which by definition
signals **every process attached to the caller's console** — including the harness driving this
change, which it killed three times over. `SetConsoleCtrlHandler(NULL, TRUE)` immunises only the
calling process, not its console siblings; that was an error of reasoning, not bad luck. The scripts
were deleted and no further programmatic interrupt was attempted.

That aborted attempt did leave one usable observation. Its logs show the event was delivered (`^C^C`
in stderr) and **swallowed by `cmd.exe`** — `npx.cmd` answered `Terminate batch job (Y/N)?` while
Playwright ran to completion, **4 passed including the teardown**. So the interrupt never reached the
Playwright process, and that run measured nothing about SIGINT handling. Whoever wants the documented
path must press Ctrl-C in an interactive console; until then §6.6 carries the abrupt-kill answer and
names the rest as unmeasured.

One further carelessness, recorded because this file's discipline is that the harness is evidence
too: an earlier attempt passed an **MSYS** shell PID to Windows `taskkill /T /F`, which interprets it
as a Windows PID and could have force-killed an unrelated process. A measurement harness that can
damage what it measures is a defect in the measurement.

### What Phase 5 does NOT establish

- **Nothing about CI, and nothing may change that.** The layer is still never a gate — no job,
  nothing in `needs:`, no schedule (§5). `npm run e2e` is human-triggered, so this date means
  "exercised", never "watched".
- **The account carries state between runs** (change.md D-01). The spec asserts only about its own
  run-unique deck; no spec may assume an empty starting deck list.
- **Two journeys exercise at most two islands on one happy path each**, while four carry a `fetch`.
  §7's islands exclusion survives Phase 5 unchanged: the defect it was written from was a wrong
  ok/parse ORDER on a failure branch no journey deliberately produces.
- **The true console-Ctrl-C path is unmeasured** (above), and the registry keeps its residual failure
  mode: an entry written but not flushed before a hard kill is still lost.
- **`exact: true` on the deck-page `Edytuj` locator is not falsifiable today** — kept as a
  layer-wide rule, not because it currently discriminates.
- **The 5459-deck debt is stopped, not repaid.** The teardown scopes to this run's own registry by
  decision; the pre-existing rows and the 2026-08-05 orphan are left in place.
