<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Order-Independent Test Suite + `sequence.shuffle`

- **Plan**: `context/changes/flashcards-test-order/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-30
- **Verdict**: NEEDS ATTENTION → **all 9 findings triaged and FIXED** (2026-07-30)
- **Findings**: 0 critical, 6 warnings, 3 observations
- **Suite after triage**: 228/228, 19 files (220/220, 18 at review time)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — re-verified by execution

Every automated criterion in the plan was re-run against current HEAD (`59202d3`), local
stack up, `OPENROUTER_API_KEY` unset. All green:

| Criterion | Command | Result |
|---|---|---|
| 1.1–1.3 / 2.2 Known-red seeds replay | `npx vitest run --sequence.seed=101\|202\|303` | 220/220 each |
| 1.4 / 3.2 Declaration order | `npm test` | 220/220, 18 files |
| 2.1 Config-driven shuffle, no CLI flags | `npm test` | banner `Running tests with seed "1785428083547"` |
| 2.3 Fresh un-pinned permutations | `npm test` ×6 (reviewer), ×6 (agent) | 12/12 green, 12 distinct seeds |
| — No-shuffle control | `npx vitest run --sequence.shuffle=false` | 220/220 |
| 1.5 / 2.4 Lint | `npm run lint` | exit 0 (6 warnings — see F5) |
| 2.4 Build | `npm run build` | exit 0 |
| 3.1 Doc greps | `grep -n "sequence.seed" test-plan.md` / `"positive control" lessons.md` | hits at `:23`, `:535` / `:201`, `:203-205` |
| §6.9 composition | `npx vitest run tests/generation/failure-path.test.ts` | 4/4 |

Manual criteria 1.6 / 2.6 / 3.3 are backed by observable evidence in the diff and
`verification.md` — no rubber-stamping found. All four Phase-1 fixes are MATCH against
their contracts: fixture created inside the `it()`, `${suffix}`-namespaced, no
restore-after-mutate, and **no assertion weakened** — two were strengthened
(`toHaveLength(1)` added at `flashcards.test.ts:246`; `toBe(controlFront)` replacing a
re-derived template literal at `:361`). The `test-plan.md` diff is purely additive apart
from the file's own `Last updated:` → `Previously:` convention, so no §6.6 claim, split or
denominator was altered.

## Findings

### F1 — `tests/setup/retry-transport.ts` and its `setupFiles` entry are absent from the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: tests/setup/retry-transport.ts (new, 105 lines); vitest.config.ts:32-36
- **Detail**: `grep` over `plan.md` for `retry|502|Kong|setupFiles` returns zero hits. The
  file landed under commit `f1bb55f` ("enable sequence.shuffle in both vitest configs (p2)"),
  whose subject does not mention it, and `plan.md` gained only ticked checkboxes — no scope
  addendum. The plan's guardrail reads "Tests + two configs + docs only"; a test setup file
  satisfies that literally, but this one installs a `globalThis.fetch` wrapper that changes
  the runtime of **all 18 test files**, including the 15 the plan declared untouchable ("No
  changes to the 15 order-safe files"). The work itself is well-founded — the diagnosis was
  measured, not guessed (3/20 red with shuffle on, 3/20 with shuffle off; two candidate
  causes refuted by measurement) — and it is documented in `verification.md` and
  `test-plan.md` §6.2/§8. What is missing is the plan-side record, and this repo treats the
  plan as ground truth for later reviews.
- **Fix A ⭐ Recommended**: Add a short scope addendum to `plan.md` — a "Phase 2 addendum:
  transport flake absorbed in-change" block naming the file, why it was needed, and the
  measurement — plus a line in the Jira ticket.
  - Strength: Preserves work whose evidence is already strong; makes the next review read
    the plan and find the file, instead of discovering it in the diff as this one did.
  - Tradeoff: The plan becomes a slightly moving target — mitigated by dating the addendum.
  - Confidence: HIGH — this repo already amends plans with dated addenda and correction
    lines (see the C10X-30 corrections in `test-plan.md`).
  - Blind spot: None significant.
- **Fix B**: Leave the plan as-is and rely on `verification.md` + `test-plan.md` §6.2/§8,
  which do describe the file fully.
  - Strength: Zero churn; the discoverable documentation already exists in the two places a
    contributor actually reads before writing a test.
  - Tradeoff: `/10x-archive` freezes a plan that never mentions a file changing every test
    run; the "no changes to the 15 order-safe files" guardrail reads as kept when it was not.
  - Confidence: MEDIUM — depends how much weight future readers put on `plan.md` vs `test-plan.md`.
  - Blind spot: Haven't checked whether the Jira ticket's fields were already synced with a
    mention of the wrapper.
- **Decision**: FIXED via Fix A — `plan.md` Phase 2 gained a dated `#3. Transport-flake
  absorber — ADDENDUM` section (file, why, the 3/20-vs-3/20 measurement, the contract, the
  "no changes to the 15 order-safe files" re-reading, and the F2/F3 boundary).

### F2 — The retry wrapper's predicate has no automated coverage and no exported seam

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/setup/retry-transport.ts:54-89
- **Detail**: `KONG_UPSTREAM_FAILURE`, `MAX_ATTEMPTS`, `isLocalStack`, `isReplayable` and
  `isKongUpstreamFailure` are all module-private in a side-effecting setup file. The module
  exports nothing, so the predicate is untestable by construction, and no test anywhere
  references it. Its only positive control is external and non-repeatable: 22 extra
  `prematurely closed` drops in Kong's access log (86 → 108) across a 40-run matrix while the
  suite went 0/40 red. That is a recorded run, not an assertion — exactly the category
  `test-plan.md` §6.6 keeps flagging. The consequence is concrete: if someone widens the
  predicate (drops the body check, or the `isLocalStack` gate), **nothing in the suite goes
  red**, and the thing being widened is a mechanism that swallows failures. The project has a
  precedent for exactly this shape: C10X-27 extracted `readJsonResponse` into
  `src/lib/http.ts` specifically so an untestable-by-construction decision could be tested
  while the surrounding wiring stayed unreachable (§7).
- **Fix**: Extract the decision into an exported pure function — `shouldRetry({ status,
  bodyText, url, method })` plus the two helpers — and add `tests/lib/retry-transport.test.ts`
  (no DB, matching the `http.test.ts` / `eval-scoring.test.ts` pattern): 502 + Kong body +
  localhost + string body → retry; 502 + Kong body + remote host → no; 502 with a PostgREST
  error body → no; 500 / 409 / 504 carrying the Kong string → no; `Request` input → no;
  `FormData` body → no; and the `MAX_ATTEMPTS` bound.
  - Strength: Turns the one guard in this change with veto power over failures into
    something falsifiable, at pure-function cost and with an in-repo template.
  - Tradeoff: A small refactor of a file that currently works, plus ~9 new cases.
  - Confidence: HIGH — identical extraction already done in this repo for the same reason.
  - Blind spot: A unit test on the predicate still does not prove the wrapper is *installed*;
    a run-scoped counter (`globalThis.__retryTransportFired`) would, and is one more line.
- **Decision**: FIXED — the predicate moved to a new pure module `tests/setup/retry-policy.ts`
  (exporting `isLocalStack`, `isReplayableRequest`, `isKongKeepAliveDrop`, `KONG_UPSTREAM_FAILURE`,
  `MAX_ATTEMPTS`, `BACKOFF_MS`, `RETRYABLE_STATUS`); `retry-transport.ts` imports it and keeps
  only the impure half (body read + re-issue). `tests/lib/retry-transport.test.ts` adds **8
  cases**, including the positive control the refusals need. Falsifiability proved by two
  breakage runs, each **1 of 8 red** on exactly the intended case and restored with a verified
  `diff`: dropping the body half of `isKongKeepAliveDrop` → "refuses a 502 whose body is a real
  error rather than Kong's drop"; hostname equality → substring → "refuses any host that is not
  the local stack". Suite after: **228/228, 19 files**.

### F3 — "A double write would be loud, never a false green" is overstated in two documents

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: context/changes/flashcards-test-order/verification.md:107-109; context/foundation/test-plan.md:2402-2404; tests/setup/retry-transport.ts:31-33
- **Detail**: The retry is not gated on HTTP method — `method` appears nowhere in the file,
  and `isReplayable` checks only the *body* shape, so a `postgrest-js` INSERT
  (`fetch(urlString, { method: "POST", body: JSON.stringify(...) })`) is exactly the shape the
  predicate green-lights. That is deliberate and argued for (nginx emits this error after
  reading EOF while awaiting the response *header*; a committed statement would have sent the
  header first; `RestartCount=0`; every observed red found the row **absent**, never
  duplicated). The argument is sound. What is over-stated is the safety net behind it: all
  three documents claim a wrongly-retried write would surface loudly. Verified against the
  schema — `flashcard` carries **no** uniqueness constraint (the only `unique` in the SRS
  migrations is `flashcard_schedule.flashcard_id`), and `study.test.ts`'s
  `createNonAcceptedCard` and `candidates.test.ts`'s `seedCard` insert card rows with no
  count oracle. A duplicate there is silent. Deck inserts *do* 409 on
  `deck_user_name_unique` — which is the row the measured flake actually hit — and the
  `toHaveLength(1)` / batch-composition oracles *would* go red. So the claim is
  majority-true, not universally true, and this repo's own discipline is to state such a
  boundary rather than round it up.
- **Fix A ⭐ Recommended**: Correct the claim in all three places — say the loud path covers
  deck inserts (`deck_user_name_unique`) and every count/composition oracle, and name the two
  seed helpers where a duplicate card row would be silent. Leave the code unchanged.
  - Strength: Keeps the retry effective on the failure that was actually measured (`POST
    /rest/v1/deck`), and fixes the thing that is genuinely wrong: an over-broad safety claim.
  - Tradeoff: The residual risk stays; it is now merely named accurately.
  - Confidence: HIGH — the schema check is direct, and the measured flake was on a POST, so
    the retry has to keep covering POSTs to do its job.
  - Blind spot: Have not enumerated every insert helper in the suite — the two named are from
    a targeted scan, not an exhaustive one.
  - **Applied.** Corrected in all three places: `retry-transport.ts`'s header gained a
    "HOW LOUD A DOUBLE WRITE WOULD BE — MOSTLY, NOT ALWAYS" paragraph plus an explicit note
    that `method` is uninspected on purpose; `verification.md` and `test-plan.md` §8 each
    carry a dated correction naming the two silent seams. Code unchanged.
- **Fix B**: Gate the retry on `GET`/`HEAD` only.
  - Strength: Removes the double-write class outright, one line.
  - Tradeoff: **Defeats the fix.** The measured 502s were on `POST /rest/v1/deck`; a
    GET-only gate would leave the flake in place and the 3/20 red rate with it.
  - Confidence: HIGH that it neutralises the change — the request line is in the Kong log
    quoted in `verification.md:59-61`.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — corrected in `retry-transport.ts`, `verification.md` and
  `test-plan.md` §8; the code is deliberately unchanged.

### F4 — Three "exactly one fetch/module seam" pointers in `test-plan.md` are now stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:345 (§4), :698 (§6.5), :1969 + §6.9's "Location" bullet
- **Detail**: The doc-sync touched only the header, §6.2 and §8 (confirmed by hunk headers:
  `@@ -6`, `@@ -485`, `@@ -2317`). Three older statements still describe a world with one
  interception seam: §4's stack row — "Exactly one file does it (`tests/generation/failure-path.test.ts`)";
  §6.5:698 — "No HTTP double is needed in THIS file, and one exists in exactly one other";
  and §6.9's "**Module doubles live in that one file.**" plus its isolation rule that "a
  `globalThis.fetch` replacement must be restored in an `afterAll`" — which the new wrapper
  deliberately and correctly does *not* do. A contributor reading §4 or §6.9 (the sections
  those very files point at) would not learn that every DB call in the suite now passes
  through a retry wrapper. This is precisely the stale-pointer class this file has corrected
  three times before.
- **Fix**: Add one sentence to §6.9's Location bullet and a clause to §4's stack row: the
  suite now has a second `fetch` seam, `tests/setup/retry-transport.ts`, which is a
  transport retry and **not** a double (it fabricates no response and must not be cited as
  precedent for one), installed suite-wide via `setupFiles` and deliberately never restored.
  Cross-reference §6.2's shuffle bullet, which already describes it.
- **Decision**: FIXED — §4's stack row gained the clause, §6.5's C10X-28 correction block
  gained a "still true as written, and here is why" note, and §6.9 gained a blockquote after
  the isolation paragraph stating that the second seam is not a double, that its predicate is
  now asserted, and why never restoring it does not violate the intra-file rule.

### F5 — The recorded lint warnings are attributed to the wrong directory and the wrong rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/flashcards-test-order/verification.md:33; context/foundation/test-plan.md:2385-2386
- **Detail**: Both read "`npm run lint` exit 0 (6 pre-existing `no-console` warnings in
  `scripts/`, allowed by AGENTS.md)". Re-run here, the 6 warnings are all in
  **`evals/generation-quality.eval.ts`** (`:148,149,150,151,158,163`) — `scripts/` produces
  none, despite containing many `console.error` calls. And AGENTS.md's exemption is written
  specifically for `scripts/` ("`scripts/` is the one exception … and may use `console.*`");
  it says nothing about `evals/`. Exit 0 and "pre-existing" are both correct — the file is
  unchanged by this change — but the location and the justification are not, and this landed
  in §8, the ledger whose whole purpose is that a later reader can trust a recorded run.
- **Fix**: Correct both lines to name `evals/generation-quality.eval.ts` and state the actual
  reason the warnings are tolerated (they are warnings, `no-console` is configured `"warn"`,
  and `tests/lib/no-logging.test.ts` gates `src/` only) rather than citing the `scripts/` carve-out.
- **Decision**: FIXED — both lines corrected in place, each keeping the wrong wording visible
  as a dated correction rather than silently overwriting it (this file's own convention).

### F6 — The wrapper has no install-idempotence guard, so it nests if isolation is relaxed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/setup/retry-transport.ts:62, 91
- **Detail**: `const passthrough = globalThis.fetch` captures whatever is installed at the
  time, and `setupFiles` runs **before every test file**. Today this is safe — neither config
  sets `pool`/`isolate`, so Vitest 4.1.10's defaults (`pool: "forks"`, `isolate: true`) give
  each file a fresh global. The moment anyone adds `isolate: false`, `singleFork`, or runs
  `--no-isolate` — a natural reflex when debugging exactly this kind of flake — each file's
  setup captures the *previous wrapper* and they nest: worst-case attempts become 3^N with
  compounding backoff, silently. Related nit in the same file: the header says it "installs
  once per worker" (`:2-3`); `vitest.config.ts:32`'s "Per-file, in the worker" is the accurate
  wording.
- **Fix**: Guard the install with a module-level sentinel —
  `const INSTALLED = Symbol.for("10xcards.retryTransport")` — and skip if already set; fix the
  header's "once per worker" wording to match `vitest.config.ts`.
- **Decision**: FIXED — `retryingFetch` is now a named declaration installed under an
  `if (!globals[INSTALLED])` guard; the header says "once per TEST FILE — not once per worker"
  and points at the sentinel.

### F7 — `createCard` asserts a bare `302` where §6.10 says the status proves nothing

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/isolation/flashcards.test.ts:80-86 (and the verbatim copy at tests/study/study.test.ts:91-107)
- **Detail**: The new helper does `expect(response.status).toBe(302)` then finds the row. But
  `src/pages/api/decks/[publicId]/cards/index.ts` redirects on success (`:82`) *and* on every
  failure (`:51,64,71,74,79`) — all `302` — which is the rule §6.10 exists for. The file's own
  `createDeck` four functions up carries the comment "only the Location separates a real create
  from a rejected one" and checks it. The find-or-throw guard does close the hole, so this is
  not a defect; it turns a one-line "Location was `?error=…`" diagnosis into a confusing
  "Setup failed: card … was never written". Note the helper is a verbatim copy of the one in
  `study.test.ts`, so this is an inherited pattern, not a regression introduced here — and
  `verification.md:70` records that exact confusing message appearing during the flake hunt.
- **Fix**: Add `expect(response.headers.get("Location")).toBe(`/decks/${deckPublicId}`);` to
  both copies.
- **Decision**: FIXED — added to both `flashcards.test.ts` and `study.test.ts`, each with a
  comment naming §6.10 and the confusing diagnosis it prevents.

### F8 — The eval config's "kept structurally parallel" comment no longer matches

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: vitest.eval.config.ts:48-53
- **Detail**: The comment says the eval config is "kept structurally parallel with"
  `vitest.config.ts`, but the two now differ: only the main config gained
  `setupFiles: ["tests/setup/retry-transport.ts"]`. Verified harmless —
  `grep -rn "supabase\|createClient\|127.0.0.1\|SUPABASE" evals/` returns zero hits, so the
  eval path never touches the local stack and the wrapper's `isLocalStack` gate would make it
  a no-op anyway. The risk is a future contributor "restoring parity" by mirroring it.
- **Fix**: Append to that comment: `setupFiles` is deliberately NOT mirrored — the retry
  wrapper only acts on `127.0.0.1`/`localhost` and this run path never touches the local stack.
- **Decision**: FIXED — four lines appended to the comment, ending "Do not 'restore parity'."

### F9 — `positive-control.test.ts` carries the same shape as the fixed defect, safe only by omission

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/isolation/positive-control.test.ts:51, 67
- **Detail**: Found by the independent 18-file sweep, outside the plan's inventory. `:67`
  permanently renames the deck created in `beforeAll`, and `:51` reads that same row — the
  structural shape §6.2's new rule now forbids. It is safe today purely by omission: the
  reading case projects `user_id`, keys on `public_id`, and asserts nothing about the original
  name, so no permutation can fire it. Not a bug and not in scope (the plan's inventory
  covered assertions that *could* break); worth a comment so a future edit to that file
  doesn't turn omission into a red.
- **Fix**: Add a one-line comment at `:67` noting the rename is safe only because no sibling
  asserts the original name, and pointing at §6.2's owned-fixture rule.
- **Decision**: FIXED — an `ORDER-SAFETY NOTE` block added at the case, stating why an owned
  fixture would be wrong here (this file's subject *is* the shared deck's lifecycle) and what
  to do if anyone ever asserts on the deck's name.

## Deliberately not raised as findings

- **The two unidentified eval reds in run 1** — `verification.md:144-150` names the gap and
  its cause ("the cause was mine") rather than rounding it up, and runs 2/3 were captured in
  full. That is the discipline working, not a defect.
- **Cross-file `Date.now().toString(36)` suffix collision** (`Gate deck ${suffix}` in both
  `study.test.ts:558` and `candidates.test.ts:847`) — explicitly out of scope by plan, and
  correctly recorded as such.
- **Per-file duplication of `createDeck`/`createCard`** across five files — the established
  norm here, not introduced by this change.
