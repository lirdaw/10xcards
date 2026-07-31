# Forced-language prompt fix — Plan Brief

> Full plan: `context/changes/forced-language-prompt-fix/plan.md`
> Frame brief: `context/changes/forced-language-prompt-fix/frame.md`

## What & Why

The generation prompt has no model-facing name for the target language — it interpolates
the raw whitelist value, a Polish exonym chosen for the API and audit contract, and the
model actions it only for the languages whose exonym it happens to resolve. A learner who
picks German gets Polish flashcards with no error shown, which is a rejected batch by
definition and a direct drag on the PRD's headline 75%-acceptance metric.

## Starting Point

`LANGUAGES` (`src/lib/generation-limits.ts:43`) is one value doing three jobs: the Zod enum
on the API, the value stored in `generation_session.language`, and the token interpolated
into the LLM system prompt. The human-facing half of this problem was already solved
separately (`LANGUAGE_LABELS` in the island, typed so a missing label fails to compile);
the model-facing twin was never written. The `auto` path, which injects no name at all, is
flawless at 25/25 — the defect appears exactly where a name is injected and only there.

## Desired End State

A `language` table holds the five shipped languages with a stable code, a Polish UI label
and an English prompt name. The selector, the API and the prompt each read the column meant
for them. Forcing German or French returns German or French cards, and an admin can later
manage languages from a panel without a deploy — a row deactivated in Studio already leaves
the selector on reload.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the defect actually is | Missing rendering layer, not a bad string | `forced/angielski` is green on the same Polish source, so "a Polish word drags the answer into Polish" is incomplete | Frame |
| Where the language set lives | A `language` table in the database | Makes a future admin panel possible without a later data migration; user's explicit call over the cheaper code-side seam | Plan |
| Table shape | Languages only; `auto` stays a mode in code | `auto` has no model-facing name and a different prompt sentence — as a row it would force a nullable column every consumer must check | Plan |
| Wire value | ISO-639-1 codes (`de`, `fr`) | Names now have their own columns, so the key stops pretending to be a name; nothing reads the audit column, so no backfill | Plan |
| Name form in the prompt | English (`German`, `French`) | The whole system prompt is English, so an English name adds no foreign context — measured in Phase 1 before anything is built on it | Plan |
| Validation after the enum goes | Regex shape guard + table lookup, 400 vs 500 split | Keeps the prompt-injection guard tight before any DB round-trip and honours the project's error-vs-empty convention | Plan |
| Generator contract | `generateCandidates` takes an already-resolved name | `evals/` has zero Supabase references by design — resolving inside the lib would give the acceptance instrument a DB dependency | Plan |
| Eval matrix | Add a forced case whose source is neither target nor Polish; pin the judge's expectation | Otherwise a green result proves the fix only for Polish source — the confound the frame found — and the instrument moves with the generator | Frame + Plan |

## Scope

**In scope:** a measurement phase that gates the rest; the `language` table, seed, RLS and
data-access module; the endpoint's runtime validation and name resolution; the generator's
new signature; the selector reading the table; the eval matrix, acceptance run and
documentation.

**Out of scope:** the admin panel itself (a follow-up ticket via `/jira-backlog-sync`); any
backfill or FK on `generation_session.language`; a precedence clause in the prompt
(hypothesis refuted); caching the language list; a CI leg for the eval; C10X-36 and C10X-37.

## Architecture / Approach

Measure, ship, then build. Phase 1 proves the candidate wording with one real eval run
behind a minimal `PROMPT_LANGUAGE_NAMES` constant, and that constant is **committed on its
own** rather than discarded (plan-review F4): the production defect closes without waiting
for a migration, and everything after it is measured against a green eval baseline instead
of establishing one. Nothing else starts until German and French come back green. The set of
languages then moves into a dictionary table modelled precisely on the existing
`flashcard_state` (seeded by migration, RLS read-only for `authenticated`, no write
policies), and its three consumers are rewired: the page loads and passes options to the
island, the endpoint validates the code and resolves the model-facing name, and
`generateCandidates` receives that name — expressing "auto" as `null` and so dropping the
sentinel that mixed the roles in the first place.

Because the eval cannot read the database, the claim splits: the eval proves the behaviour,
the ordinary suite proves the wiring, and one shared fixture (`tests/fixtures/language-names.ts`,
re-exported into `evals/`) pins both to the same literal names so a seed typo cannot pass
through the gap.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Measure and ship the fix | A recorded eval run proving English names work, plus the shippable constant that makes it work | The candidate may not fix it — the phase is a gate, with native-name and dual-name fallbacks measured before proceeding |
| 2. `language` table + data access | Migration, seed (five active + one seeded-inactive), RLS, `src/lib/languages.ts`, tests | New RLS pattern for this repo (reference table); seed-row drift has no oracle in the project |
| 3. Server wiring | New generator signature, endpoint lookup, 400/500 split | Validation moves from compile-time to runtime — the injection guard must stay as tight |
| 4. Selector reads the table | Page loader + island props, `LANGUAGE_LABELS` removed | Losing the compile-time label link; a load error must not silently render a short list |
| 5. Eval, acceptance, docs | Confound case, pinned judge, green run, documentation | Baseline comparability across renamed cases; run cost is real but small |

**Prerequisites:** `OPENROUTER_API_KEY` in the shell environment (not `.env`); local
Supabase stack running (Docker); `npx supabase db push` at ship time — the `drift` gate
blocks the deploy until the migration reaches the cloud.
**Estimated effort:** ~2–3 sessions across 5 phases; roughly $0.03–0.05 in eval runs.

## Open Risks & Assumptions

- The candidate fix is **unproven** — it has never been run. Phase 1 exists to settle that
  before any structure depends on it, and carries its own fallbacks.
- Which lexical mechanism operates ("the Polish word pulls Polish context" vs "the exonym
  is too rare a token to bind") is unknown; both are fixed by the same change, and the
  post-fix run settles it for free.
- The eval is one sample per case at temperature 0.4. The project's calibration rule
  applies: a red case is re-run once by hand before being believed.
- Seed-row drift between local and production is a class this project's `drift` gate cannot
  see, so the cloud rows are verified by reading them after the push.
- Moving the whitelist to the database converts a compile-time guarantee into a runtime one;
  the regex shape guard is what keeps the injection surface closed in the meantime.

## Success Criteria (Summary)

- Choosing German or French in the selector produces German or French flashcards — verified
  both by the eval and by hand in the browser, the latter being the first reproduction of
  this flow outside the eval.
- `npm run eval` exits 0 across the full matrix, including a case whose source text is
  neither the target language nor Polish, with no case below its recorded baseline.
- A language can be reordered or switched off from the database without a deploy, which is
  the capability the table was chosen for.
