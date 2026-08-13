<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Unchecked `failed` audit-row insert on both generation failure paths (C10X-50)

- **Plan**: `context/changes/bug-generation-failed-audit-swallowed/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-13
- **Verdict**: REVISE (all 7 findings FIXED in the plan on 2026-08-13)
- **Findings**: 2 critical, 4 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | FAIL    |

**Why REVISE and not RETHINK, despite two FAIL dimensions.** The approach is sound and unusually
well grounded: D-03 was confirmed in the installed postgrest-js source, the Sentry mechanism was
confirmed in the installed SDK, the pure/wiring split is this repo's own proven shape, and the
doc-sync target enumeration is correct line for line. Both CRITICALs have bounded, targeted fixes —
F1 is one extra builder parameter, F2 is a rewording of one breakage run.

## Grounding

10/10 paths ✓, 18/18 cited anchors ✓ (4 off-by-one, none material), brief↔plan ✓, Progress↔Phase ✓.

Deep verification, 10/10 riskiest claims checked against the installed sources:

- **D-03 CONFIRMED** — `@supabase/postgrest-js` 2.105.3: `single()` (`index.mjs:1041-1044`) sets only
  the `Accept` header; the `data = null` coercion is gated on `isMaybeSingle` (`:357`, block to
  `:371`) and is unreachable through `.single()`. Transport fallbacks at `:380-385` and `:291-331`
  confirmed (`code: ""`, `status: 0`).
- **Sentry reachability CONFIRMED (doubly)** — `withSentry.js:16` installs the ALS strategy
  unconditionally; `wrangler.jsonc:6` carries `nodejs_compat`; `init()` →
  `setCurrentClient` → `getCurrentScope().setClient(client)` attaches to the **global default
  current scope** (`defaultScopes.js:4-6`, version-keyed carrier), which the ALS store and the stack
  fallback both seed from. `getClient()` from an unrelated route module returns the client.
- **`sampleSentryEvent` fail-open CONFIRMED** — `src/lib/sentry-sampling.ts:88`
  (`if (event.logger !== "console") return event;`). A route capture carries no `logger`, so it
  passes unsampled.
- **Blast radius clean** — `eslint.config.js` has no `no-restricted-imports` and no import plugin.
  Every whole-`src/` tree guard asserts a **floor**; `form-endpoint-guards.test.ts`'s exact
  `toHaveLength(6)` counts `formData()` readers, which `generate.ts` is not.
- **Exactly two importers of `generate.ts`** — `failure-path.test.ts:3`, `generate.test.ts:4`.
- **`createGenerationSession` has no caller anywhere in `tests/`** — CONFIRMED by whole-tree grep.
- **`signout.ts:7` is the last discarded-result Supabase mutation after this change** — CONFIRMED by
  a bare-`await` sweep over `src/` (exactly three hits: `signout.ts:7`, `generate.ts:426`, `:477`).
- **`@sentry/cloudflare` 10.70.0** — no `cloudflare:` runtime import outside `./vite`; ~11 type-only
  `import type` occurrences under `build/types/**`, already exercised by `src/worker.ts`.
- **D-12 CONFIRMED** — `roadmap.md` H-17 is `Status: done`; the table ends at H-17, so H-18 is the
  correct next id.

Implementation constraint surfaced during grounding, not a finding: the new
`src/lib/audit-failure-report.ts` is scanned by three **textual** whole-`src/` guards, so
`console.x(`, `process.env` / `import.meta.env`, and `.get("error")` must not appear in its code
**or its comments**.

## Findings

### F1 — The captured exception bypasses the builder's fingerprinting

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 (the capture line) vs. "Critical Implementation Details", D-04, and
  Phase 5 §1's Risk #4 non-edit
- **Detail**: The plan states both halves of a contradiction one paragraph apart. "Critical
  Implementation Details" says a PostgREST `message`/`details` "could in principle echo submitted
  values" and must not be relayed; Phase 2 §1 then hands that same object to a third party as
  `Sentry.captureException(auditError, …)`. The builder only shapes `tags` and `extra` — the
  error's own `message`, `details` and `hint` travel on the event as the exception value and are
  never seen by `buildAuditFailureReport`. Both new guards are structurally blind: the truth table
  asserts over the builder's RETURN value, and the wiring guard's rule is that no capture LINE
  mentions a content field name, which `auditError` is not. Reachability today is narrow but one
  schema edit from wide: `generation_session` carries
  `check (char_length(source_text) > 0)` (`20260712162349_generation_session.sql:25`), and a
  Postgres CHECK violation puts `Failing row contains (…)` — the row, including `source_text` — into
  DETAIL, which PostgREST forwards. Phase 5 §1's decision not to move §2's Risk #4 row rests on
  exactly the premise this finding breaks.
- **Fix A ⭐ Recommended**: Route the PostgREST error through the builder too — capture a synthetic
  `Error` with a fixed module-local literal, and give `buildAuditFailureReport` the error as a third
  parameter: `code` verbatim as a tag, the free-form `message`/`details`/`hint` fingerprinted like
  every other free-form field.
  - Strength: 100% of what leaves the process passes through the one module the truth table covers;
    the wiring guard's "no content on the capture line" rule becomes total; Phase 5's Risk #4
    non-edit becomes defensible rather than argued from today's schema.
  - Tradeoff: Loses Sentry's native grouping on the real error type and its stack; one more builder
    parameter, and the capture statement grows past `printWidth: 120`. **Counted at triage time:
    136 characters at Site A's indent, so Prettier wraps it** — an earlier estimate of ~102 in this
    row was for the shorter two-argument form and is corrected here. The consequence is a design
    change, not a nit: Phase 3's wiring guard matches per **statement** rather than per line, and
    the deviation from `sentry-wiring.test.ts`'s per-line rule is recorded with this measurement as
    its reason.
  - Confidence: HIGH — it is the same split the plan already argues for, applied to the argument it
    forgot.
  - Blind spot: `error.code` is `""` on a thrown fetch (postgrest-js `index.mjs:295`), so the tag
    needs a fallback rather than an empty string.
- **Fix B**: Keep `captureException(auditError, …)` and close it by analysis — enumerate the
  PostgREST error classes reachable on this insert (42501, transport `{code:"", status:0}`, 23503 on
  `user_id`, 57014), record that none echoes a column value today, and add a truth-table case
  pinning that `details`/`hint` are never forwarded.
  - Strength: Keeps the stack trace and native error grouping; smaller edit; no change to the
    one-line wiring shape.
  - Tradeoff: The privacy property returns to being an argument about the current schema — precisely
    what D-04's pure/wiring split exists to stop — and it decays silently the day someone adds a
    CHECK to that table.
  - Confidence: MEDIUM — the enumeration is correct today; its durability is what is in doubt.
  - Blind spot: Postgres detail formatting varies by error class and version; the enumeration was
    not measured against a live failure.
- **Decision**: FIXED via Fix A — synthetic captured error; the PostgREST cause travels as the builder's third parameter, `code` verbatim as a tag, `message`/`details`/`hint` fingerprinted. Plan edited in 8 places: builder contract, truth table (cause-privacy case), capture statement, Critical Implementation Details, D-04, "What We're NOT Doing", wiring guard (first-argument rule), and B2/B4 promoted to pairs.

### F2 — Breakage run B5's "predicted GREEN" is falsified by Phase 3's own guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria, B5 (Progress 3.7) vs. Phase 3 §2 "The assertion"
- **Detail**: B5 predicts "the **whole suite stays green**" after deleting `if (auditError)` at
  Site A. Phase 3 §2 asserts "exactly **two** lines in `src/pages/api/generate.ts` call
  `Sentry.captureException`", and per Phase 2 §1 the capture lives inside that branch. Deleting the
  branch deletes its body, so capture lines go 2 → 1 and the wiring guard goes red — by
  construction, every time. The cost is not the wasted run: the plan instructs the implementer that
  a red B5 means "something reaches the branch that this plan says cannot, and Phase 4's scope
  changes", so a red for this trivial reason reads as the central claim being falsified, and
  criterion 3.10 loses the single measurement Phase 3 exists to produce.
- **Fix**: Redefine B5 to restore the user-visible bug without deleting a capture line — make the
  failed-audit arm at Site A return the ORDINARY literal, so both arms are identical while
  `if (auditError)` and the capture stay in place; predicted green as intended, and the coverage
  boundary is measured cleanly. Fallback if the literal deletion is preferred: keep B5 as written
  and predict "1 red — the wiring guard's exactly-two assertion — for a reason unrelated to the
  coverage boundary", stated in the criterion itself so it cannot be misread.
- **Decision**: FIXED — B5 redefined: Site A's failed-audit arm returns the ORDINARY literal (both arms identical), so the capture statement survives and the wiring guard is untouched. Progress 3.7 reworded; the reason recorded at the site.

### F3 — A throw from the builder escapes the `catch` and destroys the 502

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: "Critical Implementation Details" — Ordering at both sites
- **Detail**: The plan analyses one hazard and declares the other closed: "nothing added here may
  escape that `try`, and `Sentry.captureException` cannot throw with no client (measured), so the
  capture is safe inside it." The capture line also contains
  `await buildAuditFailureReport(auditRow, …)`, and that is the unanalysed step. Site A's capture
  sits inside the `catch` at `generate.ts:415`; a throw from a `catch` block is not caught by its own
  `try` — it propagates past `finally` and out of the handler, so the intended 502 becomes an
  uncaught framework 500, strictly worse than the bug being fixed. The concrete route is the
  builder's own contract ("a non-string is `JSON.stringify`d first") over
  `OpenRouterError.rawRequest`/`rawResponse`, both declared `unknown`
  (`src/lib/openrouter.ts:51-52`); `JSON.stringify` throws on a circular value or a BigInt.
- **Fix**: Make `fingerprint()` defensive — wrap the serialisation and the digest and return a
  sentinel shape (e.g. `{ length: -1, sha256: "unserializable" }`) rather than throwing. Add one
  truth-table case for an unserializable payload, and replace the "Ordering at both sites" sentence
  with one that names both awaits rather than only the capture.
- **Decision**: FIXED — `fingerprint()` given a cannot-throw contract with a `{ length: -1, sha256: "unserializable" }` sentinel; one truth-table case added (circular + BigInt, asserted as `resolves`); the "Ordering at both sites" paragraph rewritten to name BOTH awaits.

### F4 — "Signalled to an owner" is a promise no phase backs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State #3 vs. D-05, Phase 4 ("Sentry is a no-op locally"), Phase 5
- **Detail**: Desired End State #3 states the change delivers a signal that reaches an owner.
  Nothing in the plan establishes that it does: D-05 declines a DSN run, Phase 4 records Sentry as a
  local no-op "never as proof an event was delivered", there is no ship-time criterion anywhere, and
  no phase touches `context/changes/sentry-monitoring/deploy-runbook.md`. The mechanism is fine —
  verified in the installed SDK (see Grounding) — so the gap is evidential, not technical. It runs
  against this project's own standard, set by C10X-53 and quoted in `src/worker.ts`: "a green deploy
  proves nothing about monitoring. Only an event arriving in the Sentry UI does." C10X-54 then
  deleted `/api/shipprobe`, the only production instrument that could show a first-party error
  arriving, and `test-plan.md` §7 already records that no layer asserts Sentry invokes anything.
  Every comparable change here closes its ship-time evidence (C10X-29, C10X-42, C10X-46); this one
  has none. Honest constraint: this capture fires only when a real `generation_session` insert fails
  in production, so it is not provokable without a prod DCL change — the fix is wording plus an
  owner, not a manufactured run.
- **Fix**: Restate Desired End State #3 to what is actually delivered — a capture issued at both
  sites, proved present and composed by a per-line guard, with delivery to the Sentry UI named as a
  standing unproven boundary — and record the DSN-backed check as a `follow-ups/` item so it has an
  owner. Phase 5 already edits `src/worker.ts`'s integration comment; that is the natural site for
  the boundary sentence.
- **Decision**: FIXED — Desired End State #3 restated as "Routed toward an owner" with the delivery boundary spelled out; D-05 amended; Phase 5 gained §5 `follow-ups/sentry-delivery.md` plus Manual bullet and Progress 5.9; the boundary sentence added to the `src/worker.ts` note.

### F5 — Phase 4's Site B spec is a second module-double file, and §6.9 is never named

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §2
- **Detail**: Phase 4 §2 creates "a temporary spec under `tests/generation/`" reusing
  `failure-path.test.ts`'s `astro:env/server` + pass-through `fetch` double. `test-plan.md` §6.9 is
  explicit: "Module doubles live in that ONE file. If you find yourself adding a second one
  somewhere else, that is the moment to re-read this section rather than to imitate it." The
  deviation is defensible — temporary, deleted, deletion proved by criterion 4.2 — and Site B
  genuinely cannot be provoked otherwise, since `mockCards` always returns valid cards. But §6.9
  appears nowhere in Phase 4, and this project's own record is that an unstated deviation is what a
  later reader reconstructs as drift.
- **Fix**: Name §6.9 in Phase 4 §2 and state the deviation on its terms — second double, temporary,
  run alone, deleted, deletion proved — and add the §6.9 re-read as a Manual Verification bullet so
  the decision is recorded rather than inferred from the `git status` line.
- **Decision**: FIXED — §6.9 named in Phase 4 §2 with the deviation argued on §6.9's own terms (admissible because Site B is unreachable otherwise; temporary, run alone, deleted, deletion proved; explicitly not precedent). Manual bullet + Progress 4.8 added.

### F6 — The new response copy has no user action behind it, and criterion 2.8 cannot be met

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2 Manual Verification 2.8 (Progress 2.8), D-01/D-02
- **Detail**: Criterion 2.8 requires "Both new literals read as one sentence a user can act on". By
  the plan's own Key Discovery — "The user-visible cost of a lost audit row is zero … The row is a
  pure write-only forensic artifact" — there is nothing to act on: status, `retriable`, and
  therefore the user's next move ("Ponów") are identical on both arms. The criterion is
  unsatisfiable as worded, and a criterion that cannot be met is this project's own defect class.
  Both siblings are cited as precedent but neither is analogous: C10X-49's literal named an orphan
  deck the user would collide with, and C10X-48's a poisoned key; here the extra clause describes a
  record the user cannot see, in a failure that is otherwise identical.
- **Fix A ⭐ Recommended**: Keep the copy, fix the criterion — reword 2.8 to what the copy can
  deliver: the primary failure and its action lead, and the audit clause is informational and must
  not imply a different action.
  - Strength: Keeps sibling consistency, and keeps the only wire-observable difference Phase 4's
    manual runs use as their oracle — psql alone shows an absent row, which the buggy build also
    produces.
  - Tradeoff: Ships a sentence a user cannot use; two literals of copy carried mainly for
    testability.
  - Confidence: HIGH — the manual-run dependency is stated in Phase 4's own contract (4.4/4.5 read
    the body on the wire).
  - Blind spot: Whether the extra clause reads as alarming was not checked against the island's
    rendering.
- **Fix B**: Drop the response change entirely — detect and capture only, leaving both bodies
  unchanged; removes D-02, two literals, and half of Phase 4's contract.
  - Strength: The leanest thing in the plan; Sentry is the channel that actually reaches someone who
    can act, and the user copy stops carrying information for the developer's benefit.
  - Tradeoff: Phase 4's manual runs lose their wire oracle and shrink to psql plus the control;
    breaks the sibling pattern the change explicitly positions itself in.
  - Confidence: MEDIUM — defensible on merit, but it makes the one half of the change that IS
    verifiable locally unobservable.
  - Blind spot: The Phase 4 control's discriminating power without a body difference was not
    assessed.
- **Decision**: FIXED via Fix A — criterion 2.8 reworded to the achievable property (primary failure and "Ponów" lead; the audit clause is informational and must not read as a second problem); D-02 amended to say why the clause earns its place — Phase 4's only wire-observable oracle, not user action.

### F7 — Two citation slips in a plan whose method depends on citations

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 Overview; Key Discoveries (raw-body sentinel)
- **Detail**: (a) Phase 5's Overview says "Six documents assert C10X-50 ownership". Enumerated:
  THREE documents — `generate.ts` (3 sites), `roadmap.md` (2, both dated), `test-plan.md` (7 lines).
  The SIX is the target count inside `test-plan.md` alone, and the plan's own per-target list is
  exactly right. This is the total-vs-breakdown slip `test-plan.md` records against C10X-39, C10X-40
  and C10X-42. (b) Key Discoveries cites four anchors for "three sentinels", and `:361` is not a
  raw-body assertion at all — it is `expect(JSON.stringify(row)).not.toContain(SENTINEL_KEY)`, an
  audit-ROW assertion; the key-pin case at `:332` never reads `response.text()`. Three of the four
  cases carry raw-body sentinels, not four. Also worth stating in Current State: 3 of the 4 cases
  hit Site A, only 1 hits Site B.
- **Fix**: Correct both — "six ownership targets across three documents, six of them in
  `test-plan.md`", and drop `:361` from the raw-body list while noting separately that it is the
  audit-row key pin.
- **Decision**: FIXED — Phase 5 Overview corrected to "six ownership targets across THREE documents"; `:361` dropped from the raw-body sentinel list and re-described as the audit-row key pin; Current State gained the 3-to-1 Site A/B split of the four committed cases.
