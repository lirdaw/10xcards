---
date: 2026-07-29T16:30:00+02:00
researcher: Claude Code
git_commit: 209383955925147b1092184b64b7db48574e2717
branch: main
repository: 10xcards
topic: "Oracle, layer and run-location for the Risk #7 LLM-as-judge generation-quality test (test-plan §3 Phase 5, C10X-31)"
tags: [research, codebase, generation, openrouter, llm-as-judge, test-plan-phase-5, risk-7]
status: complete
last_updated: 2026-07-29
last_updated_by: Claude Code
---

# Research: Oracle, layer and run-location for the Risk #7 LLM-as-judge test

**Date**: 2026-07-29T16:30:00+02:00
**Researcher**: Claude Code
**Git Commit**: 209383955925147b1092184b64b7db48574e2717
**Branch**: main
**Repository**: 10xcards

## Research Question

What is the right oracle, test layer, and run location for the generation-quality test
(Risk #7: wrong-language or unusable cards), given: (1) the mock clamp — preflight hard-fails
when `OPENROUTER_API_KEY` is set, and mock mode returns fixed Polish strings; (2) the
no-notification-channel precedent for scheduled checks; (3) uncertainty about whether the S-05
acceptance signal exists as usable calibration DATA; (4) the boundary between deterministic
assertions and what genuinely needs a judge.

## Summary

Four findings shape the whole change:

1. **The judge cannot live in `npm test`, and three sanctioned escape routes already exist in
   this repo.** The mock clamp is airtight in three independent places (preflight `fail()` with
   no env opt-out; `openrouter.ts` short-circuits to mock when the key is unset; `astro:env`
   secrets are transform-time inlined literals under Vitest). But `globalSetup` is **per-config**
   (`vitest.config.ts:31`), so a second Vitest config invoked with `-c` runs no preflight; a bare
   Node script under `scripts/` sidesteps the Vitest surface entirely (precedent:
   `scripts/check-schema-drift.ts`); and `.github/workflows/schema-diff.yml` is a line-for-line
   reusable precedent for a `workflow_dispatch`-only, non-gating, secrets-per-step check whose
   sensitive output goes to an artifact, not the public log. The natural shape is **a separate
   Vitest config for the runner + a `workflow_dispatch` workflow for the trigger** — the exact
   split `check-schema-drift.ts` + `schema-diff.yml` already establish.

2. **The runner must import production code, which decides the runner location.** Phase 5's
   inherited scope is precisely "the prompt, the model, the real response format" — the things
   every earlier phase declared invisible to itself. `scripts/` cannot import `src/` (hard
   boundary, AGENTS.md), so a `scripts/`-resident judge would have to rebuild the OpenRouter
   request and would silently drift from the production prompt — a false-pass generator. Only a
   Vitest config built on `getViteConfig()` resolves `@/lib/openrouter` and `astro:env/server`.
   Calling `generateCandidates()` directly (lib level) exercises the real prompt, model
   selection, request build, Zod contract and per-card filtering **with no database and no local
   stack at all** — the cheapest layer that still observes production behavior.

3. **The S-05 acceptance signal exists structurally, not statistically — the reference set must
   be authored, not harvested.** The per-card ground truth (`flashcard.state_id` joined via
   `generation_id`, correct denominator already derived in `src/lib/generations.ts:88-110`) is
   real and queryable, and `generation_session.request_payload`/`response_payload` store the full
   prompt and raw model output per session. But prod holds ~38 flashcard rows total, the local
   dev DB was reset to empty on 2026-07-28, and all local candidates are mock strings. There is
   no corpus to calibrate a judge against. Phase 5 must ship its own fixed reference set (source
   texts per language) and treat the live acceptance data as a future sanity anchor only.

4. **The language surface is wider than the risk row says, and the riskiest path is the
   default.** Docs say PL/EN/ES; the shipped whitelist has six values
   (`auto`, `polski`, `angielski`, `hiszpański`, `niemiecki`, `francuski`), and the two prompt
   paths are materially different: `auto` (the UI default, and the path the PRD's NFR actually
   names) says "SAME language as the source text", while a forced language interpolates a
   **Polish exonym into an English sentence** (`Write the flashcards in this language:
   hiszpański.`). Nothing has ever tested either. A fidelity matrix must grade both paths.

No finding warrants a `/10x-frame` pass: everything of frame-shape is already decided (layer,
judge scope, anti-pattern, optional gate) and the rest is mechanics. One boundary belongs in the
plan explicitly: the judge **proxies** quality; it does not measure the 75% acceptance rate,
which only real users can produce.

## Detailed Findings

### 1. The generation path — what the judge would exercise

**The prompt** (`src/lib/openrouter.ts:98-111`): one space-joined English system message —
"You generate study flashcards from the user's source text. Produce exactly ${count}
question/answer flashcards. Each card has a 'front' … 'back' … 'front' must be at most 200
characters; 'back' at most 1000 characters. Both must be non-empty. [language rule]
Check every length BEFORE returning. Return ONLY through the provided JSON schema — no extra
prose." The user message is the raw trimmed source text and nothing else (`openrouter.ts:174`).

**The language rule has two materially different forms** (`openrouter.ts:99-102`):
- `language === "auto"` → `"Write the flashcards in the SAME language as the source text."`
- otherwise → `` `Write the flashcards in this language: ${language}.` `` where `${language}` is
  a **Polish exonym** from the whitelist `["auto", "polski", "angielski", "hiszpański",
  "niemiecki", "francuski"]` (`src/lib/generation-limits.ts:43`). The whitelist is an injection
  guard (S-04 impl-review F3, fixed), single-sourced between endpoint and island. There is no
  source-language detection anywhere; `auto` delegates it entirely to the model.

**Model selection** (`openrouter.ts:19, 68-70, 152`): `OPENROUTER_MODEL ?? "openai/gpt-4o-mini"`
— env-tunable by design ("tuning bez redeploya", S-04 plan-brief), must support
`response_format: json_schema`. **No quality/language benchmark was ever run to pick it** — the
roadmap's Open Question #3 ("model quality in PL + other languages", `roadmap.md:301`) was
answered by "make it configurable" and never closed. Phase 5 is the first thing positioned to
actually measure it.

**Response contract, two layers**: the provider-side JSON schema (`openrouter.ts:74-94`) has
**no maxLength/minLength/minItems/maxItems** — count and length are prompt-only instructions at
that layer; then Zod `candidateSchema` (`openrouter.ts:32-35`, `front ≤ 200`, `back ≤ 1000`,
both `min(1)`, values imported from `src/lib/flashcards.ts:69-70`) trims and **silently drops**
non-conforming cards individually (`validate()`, `openrouter.ts:123-134`). No content dedup
anywhere. `generatedCount` = what the model returned; `saved = cards.length`;
`skipped = generated − saved` — the counter contract S-04 fixed as "the single source of truth"
(`context/archive/2026-07-11-ai-candidate-generation/plan.md:268-272`).

**Non-determinism is built in**: `temperature: 0.4` (`openrouter.ts:177`) — confirming the
test-plan's anti-pattern ("snapshotting the model response — breaks without signal"). Any oracle
must be property- or rubric-based with an aggregate threshold, never exact-output.

**Mock mode** (`openrouter.ts:114-119, 154-162`): triggered by the key being unset; returns
`"Przykładowe pytanie N"` / `"Przykładowa odpowiedź N…"` — **always Polish, regardless of
`language` or source text**. A judge pointed at mock output would grade hard-coded Polish
filler: a PL-fidelity case passes vacuously, an ES case fails confusingly. The judge run is
meaningful only against the real provider.

**Deterministic residue a real-model run can assert without any judge** (today asserted only
under mock): count compliance (`cards.length === count` — prompt-only at the provider layer, so
a real model CAN miss it), post-Zod length/non-emptiness (guaranteed by construction), and
`skipped` (a free quality signal: how many cards the model produced that failed the contract —
the S-04 plan-review F5 lever, "1-shot corrective re-call deferred until skip-rate proves high",
has never been measured).

**The audit seam**: on every path the endpoint persists `source_text`, `model`, `language`,
`request_payload` (the full OpenRouter body incl. the rendered system prompt) and
`response_payload` (the full raw provider JSON incl. unparsed `content`) to
`generation_session` (`src/pages/api/generate.ts:286-299`; `openrouter.ts:184, 213, 231`;
migration `20260712162349_generation_session.sql:21-36`). An offline judge can therefore
re-grade any real session without re-calling the model — but only sessions produced with a real
key (mock writes `{mock: true, …}`).

### 2. Harness constraints — where a paid-LLM check can and cannot run

**The clamp, and why it stays**: `tests/setup/preflight.ts:110-118` fails the whole run when
`OPENROUTER_API_KEY` is set — "no env opt-out, same reasoning as assertLocal: a deliberate
live-generation run must cost a code edit, not an env flag" (`preflight.ts:96-108`). Two named
breakages justify it: mock-guaranteed card counts, and the timeout inversion
(`SERVER_TIMEOUT_MS` 40 s > `testTimeout` 30 s). `lessons.md` ("Preflight musi domknąć KAŻDY
nielokalny szew") makes weakening it a named anti-pattern. The judge must be a **new run path**,
not a relaxation of the existing one.

**Escape route A — second Vitest config (recommended for the runner).**
- `globalSetup` binds per-config (`vitest.config.ts:31`); a `vitest.eval.config.ts` without it
  runs no preflight. A CLI path filter does NOT bypass it (`-c` is the only lever).
- `npm test` cannot collect the eval files by construction:
  `include: ["tests/**/*.test.ts"]` (`vitest.config.ts:26`) replaces the default glob, so a
  `*.eval.ts` suffix (even inside `tests/`) or a separate `evals/` dir is invisible to the
  default run — exclusion by collection, independent of preflight.
- The config must duplicate the `getViteConfig()` + Cloudflare-plugin-strip wrapper
  (`vitest.config.ts:13-20, 38-41`) — that wrapper is what resolves `@/*` and
  `astro:env/server`, and without it `@/lib/openrouter` is unreachable.
- **`astro:env` inlining trap**: the key must be present in the environment at
  config/transform time (shell env or `.env`) — it cannot be injected from inside a test.
  Shell-env-only invocation (`OPENROUTER_API_KEY=… npx vitest run -c …`) is the safe form: a
  key left in `.env` would (loudly, by design) fail the next ordinary `npm test`. An
  allow-listed command of exactly this shape already exists
  (`.claude/settings.local.json:91`).
- `testTimeout` must exceed real LLM latency; if the endpoint is ever driven, > 40 s
  (`SERVER_TIMEOUT_MS`).
- Lib-level calls (`generateCandidates()` direct) need **no database, no local stack, no
  accounts fixture** — nothing in `openrouter.ts` touches Supabase.

**Escape route B — bare Node script under `scripts/`** (precedent
`scripts/check-schema-drift.ts`: zero-dependency, `process.env`, `console.*` legal —
`no-logging.test.ts:30` scans `src/` only). **Rejected for the runner**: `AGENTS.md:12` forbids
importing across the `scripts/`↔`src/` boundary, so the judge would have to rebuild the
OpenRouter request and would drift from the production prompt — the exact false-pass §6.9 warns
about ("a double that removes the code your positive control observes"). Still the right model
for any pure, decidable helper (a `tests/lib/*.test.ts` can unit-test a pure scoring module the
way `schema-drift.test.ts` tests `scripts/schema-drift.ts`).

**Escape route C — `workflow_dispatch` GitHub workflow (recommended for the trigger).**
`schema-diff.yml` is the template, and every one of its design rules transfers verbatim:
- `on: workflow_dispatch:` only, with the no-`schedule:` justification written in the header —
  "an alarm nobody hears is not coverage; add `schedule:` the day a notification channel and an
  owner exist" (`schema-diff.yml:16-23`; same rule at `test-plan.md` §5 for the DDL row, and the
  §5 gate row for the judge itself says **optional**, never in `deploy`'s `needs`).
- Secrets **per step, never job-level** (public repo, `npm ci` lifecycle scripts —
  `schema-diff.yml:29-40`); a fail-closed guard step (`test -n` → exit 1) before anything runs.
- **Sensitive output out of the public log**: card bodies and source texts go to an
  `if: failure()` artifact (`retention-days: 7`), the log keeps verdict + counts only — the
  same reasoning that keeps the DDL diff body out of the log.
- Ship-time property: dispatchable only once the file is on `main` (measured for schema-diff:
  HTTP 404 from any other ref). Most of the workflow's verification is ship-time work.
- Requires a new repo secret `OPENROUTER_API_KEY` — a user decision (public repo).

**Not available**: putting the key into `ci.yml` in any form — `npm test` at `ci.yml:60` is
bound to the preflighted config, and turning CI red on a set key is the designed behavior.

### 3. The acceptance signal — structure yes, data no

**Structure (satisfied)**: `flashcard.state_id ∈ {1 generated, 2 accepted, 3 rejected}` joined
to `generation_session` via `flashcard.generation_id`
(`20260712162349_generation_session.sql:46-49`); provenance separated (`source_id` ai/manual);
the correct denominator already derived and documented — **neither `saved_count` (zeroed by
`failGenerationSession`) nor `generated_count` (pre-Zod) may be used**; denominator = surviving
rows (`src/lib/generations.ts:88-110`). Display exists as a per-session **count, not a rate**,
only under `?generation=` (`review.astro:101-109, 184-198`). No code anywhere computes a
percentage or compares to 75.

**Data (not satisfied)**:
- Prod: **38 flashcard rows total** across all states and both sources (read-only probe
  recorded in `context/archive/2026-07-28-server-side-validation-test/verification.md:60-78`).
- Local: reset to empty 2026-07-28; earlier volume was suite residue ("no genuine content");
  all locally generated candidates are mock strings.
- No accept/reject **timestamp or event log** — the moddatetime trigger was deliberately
  narrowed to `front, back` (`20260725112700_flashcard_state_no_touch_updated_at.sql`), so a
  state change leaves no trace; `pending` is indistinguishable from "abandoned review".
- One derivable signal worth recording: **accepted-with-edit** — `updated_at !== created_at` on
  an `accepted`, `source=ai` card — is recoverable precisely because the trigger fires only on
  content edits. Nobody computes it; the data supports it.

**Consequence**: the judge's reference set must be authored (fixed source texts per language ×
prompt path), with real OpenRouter calls at eval time. Live acceptance data can serve as a
sanity anchor later, once real usage exists — not as a calibration corpus now.

### 4. Prior decisions that bind this change (do not re-litigate)

1. Layer = LLM-as-judge over a reference set; judge scope = **usability + language fidelity
   only** — anything a deterministic check can assert must not go to the judge (test-plan §2
   guidance row #7, §4 AI-native stack row, `change.md`).
2. Anti-pattern = snapshotting model responses (confirmed live: `temperature: 0.4`).
3. Gate is **optional**, off the deploy path; no `schedule:` without an owner and a
   notification channel.
4. Provider = OpenRouter over plain `fetch`; model env-tunable, default `openai/gpt-4o-mini`;
   prompt language policy = Zod-enum whitelist or `auto`.
5. Deferred quality lever = 1-shot corrective re-call, cut at S-04 plan-review (F5), trigger
   condition "if skip-rate proves high" — the eval is the first thing that can measure
   skip-rate on real generations.
6. Jira DoR complete: C10X-31, Epic C10X-12 "AI Generation", component `generation`,
   Fix Version MVP.

### 5. Doc bookkeeping the change must carry (learned from prior phases)

- test-plan §6.6 has no Phase 5 entry — every shipped phase added one; §3 row flips to
  `complete` with a date; §8 Freshness Ledger entry; the §4 AI-native row's `checked:
  2026-07-15` needs a refresh.
- The roadmap has **no row for this work** (Phase 5 maps onto no slice). Precedent H-04: an
  archived change with no roadmap row "disappears from the roadmap without a trace" and had to
  be repaired retroactively — an `H-06` row should exist **before** archiving
  (`roadmap.md:62-66, 268`).
- Jira: risk tickets match on `Change ID` (`customfield_10041`), never on summary; the `-3`
  suffix is a uniqueness counter, not a risk number (`jira-map.md:122-130`).
- No open-change overlap: C10X-36 (auth input, Post-MVP idea workflow) and C10X-37 (deck
  `formData()` hardening) touch neither the generation path nor this scope.

## Code References

- `src/lib/openrouter.ts:19` — `DEFAULT_MODEL = "openai/gpt-4o-mini"`; `:68-70` env override
- `src/lib/openrouter.ts:98-111` — system prompt incl. the two-form language rule
- `src/lib/openrouter.ts:74-94` — provider JSON schema (no length/count enforcement)
- `src/lib/openrouter.ts:32-35, 123-134` — Zod contract + trim + silent per-card drop
- `src/lib/openrouter.ts:114-119, 154-162` — mock mode (fixed Polish strings)
- `src/lib/openrouter.ts:177` — `temperature: 0.4`; `:168` — `max_tokens = 500 + count*450`
- `src/lib/generation-limits.ts:43` — `LANGUAGES` sextet incl. `auto`; `:30-34` — SOURCE_MAX,
  COUNT bounds
- `src/pages/api/generate.ts:46-59` — body schema; `:286-299` — success-path audit write;
  `:40` — `SERVER_TIMEOUT_MS = 40_000`
- `src/lib/generations.ts:88-110` — `generationStateCounts` + the denominator rationale;
  `:116-121` — `failGenerationSession` zeroes `saved_count`
- `src/lib/flashcards.ts:53-56, 69-70` — state/source ids; FRONT_MAX/BACK_MAX
- `src/pages/decks/[publicId]/review.astro:101-109, 184-198` — the acceptance count line
- `tests/setup/preflight.ts:96-118` — the OpenRouter clamp, no-opt-out rationale
- `vitest.config.ts:13-20, 26, 31, 33-34, 38-41` — include glob, per-config globalSetup,
  timeouts, the `getViteConfig()` wrapper a second config must duplicate
- `tests/generation/failure-path.test.ts:16-37, 48-127` — the only sanctioned module double +
  fail-closed pass-through fetch pattern
- `scripts/check-schema-drift.ts:1-26` — `scripts/` conventions (no `src/` imports, fail
  closed, zero deps)
- `.github/workflows/schema-diff.yml:16-40, 60-72, 100-137` — the on-demand workflow template
  (dispatch-only rationale, per-step secrets, guard step, artifact-not-log)
- `.github/workflows/ci.yml:24-28, 60` — key deliberately absent; `npm test` bound to the
  preflighted config
- `supabase/migrations/20260712162349_generation_session.sql:21-36, 46-49` — audit columns +
  `generation_id` linkage
- `supabase/migrations/20260725112700_flashcard_state_no_touch_updated_at.sql:27-29` — state
  change leaves no timestamp
- `.claude/settings.local.json:91` — allow-listed shell-env key invocation shape

## Architecture Insights

- **The repo already has a two-piece idiom for "check that cannot be a gate"**: a runner
  (`scripts/check-schema-drift.ts`) + a dispatch-only workflow (`schema-diff.yml`) with
  secrets-per-step, fail-closed guards, verdict-in-log / body-in-artifact. Phase 5 should reuse
  the idiom, swapping the runner's location to a second Vitest config because — unlike the
  drift check — the judge must import production `src/` code.
- **Exclusion by collection beats exclusion by guard**: `include: ["tests/**/*.test.ts"]`
  keeps `*.eval.ts` files out of `npm test` structurally, so the paid path needs no new
  preflight logic and the existing clamp stays byte-identical.
- **The judge/deterministic boundary falls out of the code, not of taste**: everything below
  the Zod layer (shape, lengths, non-emptiness) is enforced or dropped before a card exists;
  count compliance and skip-rate are deterministic over a real run; only "is this card usable
  study material" and "is it in the source's language" have no decidable oracle — exactly the
  two things the test-plan assigns to the judge.
- **Two prompt paths, not one**: `auto` (default; the PRD NFR's actual subject) and forced
  language (Polish exonym inside an English instruction) are different prompts with different
  failure modes; a fidelity matrix that grades only one proves half the risk.
- **The eval doubles as the first measurement of two dormant metrics**: real-model count
  compliance and skip-rate (the S-04 F5 re-call trigger that has never had a value).

## Historical Context (from prior changes)

- `context/archive/2026-07-11-ai-candidate-generation/` — S-04 built the path: model
  env-tunable (`plan.md:241-244`), master-prompt rules (`plan.md:250-253`), language whitelist
  after impl-review F3 (prompt-injection fix), counter contract (`plan.md:268-272`), audit
  payloads "pod metrykę 75%" (`plan.md:151`); plan-review F5 cut the 1-shot corrective re-call
  ("revisit if skip-rate proves high"); plan-review F3 documented the no-rate-limit deferral.
- `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md:653-657` — the
  explicit hand-off: "a change to the prompt, the model or the real response format is
  invisible here — that is §3 Phase 5's job (LLM-as-judge)". Also `:661`: success-path audit
  columns asserted nowhere.
- `context/archive/2026-07-28-server-side-validation-test/verification.md:60-78` — the prod
  data-volume probe (38 rows) grounding the "no calibration corpus" conclusion.
- `context/archive/2026-07-09-srs-library-choice/` — precedent for closing a foundation
  decision with a written research artifact (shortlist + verdict doc); the model to follow if
  judge-model selection deserves its own recorded comparison.
- `context/foundation/lessons.md` — binding rules: "Preflight musi domknąć KAŻDY nielokalny
  szew" (no weakening of the clamp); prod-sanity must run a real generation; the
  always-exit-0 gate lesson (measure exit codes in both directions before building any
  workflow verdict on them).

## Related Research

- `context/archive/2026-07-26-ai-candidate-generation-test-2/research.md` — seam analysis for
  the generation path (module-double constraints this change inherits).
- `context/archive/2026-07-26-srs-study-session-test/research.md` — the audit-style research
  precedent (coverage claims verified by execution).
- `context/archive/2026-07-09-srs-library-choice/srs-library-research.md` — decision-by-
  artifact precedent.

## Open Questions

1. **Judge model choice** — same as the generator (`openai/gpt-4o-mini`) or deliberately a
   different family to avoid self-grading bias? Never discussed anywhere in `context/`. A
   short recorded comparison (srs-library-choice style) may be warranted; at minimum the plan
   must pin the judge model and mark the choice revisable.
2. **Language scope of the reference set** — docs say PL/EN/ES; the product ships six selector
   values plus `auto`. Proposed: grade `auto` × {PL, EN, ES source} and forced
   {`polski`, `angielski`, `hiszpański`} over one fixed source; record DE/FR as a named gap.
   Needs a user decision only if six-language coverage is wanted (cost scales linearly).
3. **Thresholds and set size** — what pass rate over the reference set is red? (The 75%
   acceptance criterion is a *product* metric over real users; the judge threshold is a
   separate number and must not masquerade as it.) Cost per full run at gpt-4o-mini prices is
   cents, so set size is bounded by wall-clock and review effort, not money.
4. **Repo secret** — adding `OPENROUTER_API_KEY` to GitHub (public repo, per-step scoping per
   the schema-diff pattern) is a user decision; without it the workflow leg is deferred and
   the eval runs locally only (shell-env invocation).
5. **Endpoint smoke** — should one eval case drive the real `/api/generate` end-to-end (real
   key + local stack + accounts fixture, asserting the success-path audit columns nobody has
   ever asserted), or is lib-level coverage enough for this slice? Lib-level is the cheapest
   layer that observes the prompt; the endpoint adds persistence already covered
   deterministically elsewhere.
6. **No frame needed** — reviewed against `/10x-frame` criteria: the WHAT is fixed by the
   test-plan (layer, scope, anti-pattern, optional gate); remaining unknowns are mechanics and
   parameters. The one framing-adjacent boundary (judge ≠ acceptance-rate measurement) is
   stated here and should be restated in the plan's Non-Goals.
