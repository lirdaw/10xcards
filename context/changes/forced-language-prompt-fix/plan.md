# Forced-language prompt fix — Implementation Plan

## Overview

Forcing `niemiecki` or `francuski` in the generation language selector returns Polish
flashcards (0/5 in the target language, four of four measured runs). The frame brief
established that the cause is structural rather than lexical: nothing in the pipeline
renders a **model-facing** name for a language, so the prompt interpolates the raw
whitelist value — a Polish exonym chosen to serve as an API enum and an audit-column
value — and the model actions it only for the languages whose exonym it happens to
resolve.

This plan introduces that missing rendering layer as a **database dictionary table**
(`language`), so the set of languages and their two rendered names (one for the user, one
for the model) become data rather than code — a deliberate step toward a future admin
panel. The prompt consumes the model-facing name; the API and the audit column consume a
stable code. A **measurement phase runs first**: the candidate fix is proven by one real
eval run before any of the structure is built.

## Current State Analysis

`systemPrompt()` (`src/lib/openrouter.ts:93-106`) builds the language rule two ways. The
`auto` branch (`:96`) interpolates **no name at all** and is flawless (25/25 across five
languages). The forced branch (`:97`) interpolates the caller's `language` argument
verbatim — the raw whitelist value — and that is exactly where, and only where, the defect
appears.

`LANGUAGES` (`src/lib/generation-limits.ts:43`) is one value serving three roles at once:

| Role | Site |
| --- | --- |
| Zod enum on the API — a documented prompt-injection guard (impl-review F3) | `src/pages/api/generate.ts:51` |
| Value persisted to `generation_session.language` | `src/pages/api/generate.ts:213,250,290` |
| Token interpolated into the LLM system prompt | `src/lib/openrouter.ts:97` |

The **human-facing** half of this same problem was already solved separately:
`LANGUAGE_LABELS` (`src/components/generate/GeneratorForm.tsx:26`) maps value → display
string, typed by the `Language` union so a value without a label fails to compile, with an
explicit comment drawing the line ("The lib exports VALUES; the labels are UI and stay
here"). The model-facing twin was never written.

Baseline, recorded in `context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`:

| Case | Language fidelity |
| --- | --- |
| `auto/pl`, `auto/en`, `auto/es`, `auto/de`, `auto/fr` | 5/5 each |
| `forced/polski`, `forced/angielski` | 5/5 |
| `forced/hiszpański` | 4/5 (intermittent; 5/5 once) |
| `forced/niemiecki`, `forced/francuski` | **0/5, every card Polish, every run** |

Two facts about the surrounding machinery constrain the design and were verified by direct
reads rather than assumed:

- **`evals/` contains zero Supabase references.** The eval calls `generateCandidates()`
  directly and `vitest.eval.config.ts` deliberately omits `setupFiles` and any local stack
  ("this run path never touches the local stack … Do not 'restore parity'"). A DB-resolved
  prompt name therefore cannot be resolved *inside* the generator without giving the
  acceptance instrument a database dependency it is designed not to have.
- **`generation_session.language` is `text not null` with no CHECK and no enum type**
  (`supabase/migrations/20260712162349_generation_session.sql:27`), and **nothing reads
  it** — a grep across `src/`, `tests/` and `evals/` finds only writes plus one assertion
  in the audit-columns test. Changing the wire values needs no migration of existing data
  and no backfill.

## Desired End State

A `language` table holds the five shipped languages — plus one seeded inactive, which is
what keeps the `is_active` filter assertable — each with a stable `code`, a Polish
`ui_label` and an English `prompt_name`, plus `sort_order` and `is_active`. The generate
page reads it and passes options to the island; the endpoint reads it to validate the
submitted code and to resolve the model-facing name; `generateCandidates` receives that
already-resolved name and never sees a contract value again. Forcing German or French
returns German or French cards, proven by a full `npm run eval` run whose matrix now also
contains a case whose source text is neither the target language nor Polish.

Verified by: `npm run eval` exits 0 across the full matrix; `npm test` green; the language
selector in the browser is driven by the table, including a row deactivated in Studio
disappearing without a deploy.

### Key Discoveries:

- The defect appears exactly where a name is injected and nowhere else —
  `openrouter.ts:96` (auto, no name, green) vs `:97` (forced, raw value, red).
- `forced/angielski` is **green** on the same Polish source text, so "a Polish word drags
  the answer into Polish" is incomplete; and `auto/de`/`auto/fr` scored 5/5 while the judge
  was told the expectation using the identical Polish exonym, which refutes the instrument
  as the source of the red.
- `flashcard_state` (`supabase/migrations/20260705180246_init_core_schema.sql:25-34,148-149`)
  is a precise precedent for a dictionary table in this project: seeded by the migration,
  RLS enabled, `select … using (true)` for `authenticated`, **no write policies**
  (deny-by-default), `revoke all … from anon`.
- `src/pages/generate.astro:11-13` already loads data server-side and passes it to the
  island as props, branching on query error vs empty — the language list follows the same
  path, unchanged in shape.
- **A fifth site carries the Polish exonyms** beyond the four the frame named:
  `tests/lib/eval-scoring.test.ts:28,80,90,99,157,160` uses them as fixture strings. They
  are typed as bare `string`, so they neither break compilation nor fail — the file would
  silently keep dead vocabulary.
- `evals/lib/judge.ts:79` already asks the judge to report `detected_language` as an
  **English** name ("Polish", "Spanish") while `:77` states the expectation in a Polish
  exonym. Pinning the expectation to an English name makes the judge's two fields
  consistent for the first time.

## What We're NOT Doing

- **No admin panel.** The table is built so one is possible; the panel itself is a PRD
  non-goal for MVP (FR-013 is a visible mock, nice-to-have). A backlog item is written as a
  follow-up file and raised via `/jira-backlog-sync` — no ticket is created during this change.
- **No backfill and no FK on `generation_session.language`.** Historical rows keep their
  Polish strings; the column stays free `text` deliberately, because `auto` is stored there
  and is not a row in the table, and because a future deactivation must not be blocked by
  old sessions.
- **No precedence clause and no restructuring of the system prompt.** Hypothesis 3
  (instruction salience) was investigated and refuted as the differentiator —
  `forced/polski` and `forced/angielski` pass through the identical structure. Adding one
  would make the measurement multi-variable for no established gain.
- **No change to the `auto` branch's sentence.** It is at 25/25.
- **No caching of the language list.** A cache would make an admin edit take effect only
  after an unpredictable Worker recycle, and it is an optimisation ahead of any measurement
  that the read hurts.
- **No CI / `workflow_dispatch` leg for the eval.** It stays local and human-triggered —
  that remains C10X-31's deferred follow-up, unchanged.
- **No work on C10X-36 (auth input validation) or C10X-37 (the two deck endpoints).**

## Implementation Approach

Measure, ship, then build. Phase 1 proves the candidate fix with one full eval run behind a
minimal rendering constant, and is a gate: nothing else is built until German and French come
back green and the other cases hold. That constant is committed rather than discarded, so the
user-visible defect can close on its own and everything after it is measured against a green
baseline. Phases 2–4 then move the language set into the database and
rewire its three consumers (endpoint, generator lib, island). Phase 5 updates the eval
matrix, runs acceptance, and records the evidence.

The seam that makes this work is `generateCandidates` taking an **already-resolved**
model-facing name rather than a contract value. That keeps the eval database-free, and it
removes the `"auto"` sentinel from inside the library — the role-mixing the frame
diagnosed — by expressing the mode as `null`.

## Critical Implementation Details

**Ordering: the language lookup goes AFTER the idempotency replay, BEFORE deck
resolution.** The replay branch (`generate.ts:143-153`) exists so "Ponów" returns cards
that already landed. "Ponów" replays the payload verbatim, language included — so if the
lookup ran first, an admin deactivating a language between the attempt and the retry would
turn a recoverable replay into a `400` and strand the user with saved cards they cannot
reach. Validating after the replay short-circuit keeps FR-018 intact. Deck resolution must
still come after, so a refused language never reaches a deck query.

**The eval cannot read the database, so the claim splits — and the split needs one shared
fixture.** The eval proves the *behaviour* (a model-legible English name in the prompt
yields target-language cards); the ordinary suite proves the *wiring* (the table holds the
right names and the endpoint resolves them). Left alone, a typo in the seed
(`"Germen"`) would pass both: the eval uses its own literal, the suite compares the row to
whatever the suite expects. Both sides therefore import the same
`tests/fixtures/language-names.ts` (re-exported for the eval — see Phase 2 item 4 for why
that direction), and the DB test asserts the seeded `prompt_name` values against it. That
one file is the pin; do not inline the names on either side.

**Phase 1's edit ships; it is not throwaway (plan-review F4).** It lands as its own commit
carrying nothing else, so the production defect can close before the restructuring does and
so Phases 2–5 measure against a green eval baseline instead of establishing one. What the
later phases then do to it is a MOVE, not a rewrite: the same five strings become the seed's
`prompt_name`, and the constant is deleted in Phase 5 when the table is their source. If a
breakage check in a later phase needs a temporary local edit, this project's restore
discipline still applies in full — a hash or `diff` against a pristine copy taken before the
edit, never a visual check (test-plan §6.6 records a restore that silently no-opped).

**Ship dependency.** This change carries a migration, so the `drift` gate (C10X-29) will
block the deploy until `npx supabase db push` runs. That is the gate working, not a
failure; `/ship` sequences it (additive migration before merge).

---

## Phase 1: Measure and ship the candidate fix

### Overview

Prove that a model-legible English language name actually fixes German and French, before
any structure is built on the assumption — and, once proved, **ship that fix on its own**.

> **This phase used to end by deleting its own edit; it no longer does (plan-review F4).**
> The defect is live in production and change.md frames it as a direct drag on the PRD's
> headline 75%-acceptance metric, while the plan's remaining four phases need a migration
> and a prod `db push` before anything reaches a user. A minimal rendering map is shippable
> without any of that. The second benefit is measurement, not speed: Phases 2–5 then start
> from a GREEN eval baseline, so a red acceptance run means the restructuring broke it —
> a one-variable signal instead of "table + endpoint + signature + matrix, all at once".

### Changes Required:

#### 1. A minimal model-facing name map

**File**: `src/lib/generation-limits.ts`, `src/lib/openrouter.ts`

**Intent**: Interpolate an English language name instead of the caller's raw value, by the
smallest edit that is fit to ship, so the measurement isolates the prompt wording and
nothing else. This is the same rendering layer the plan is about — it just lives in a
constant until Phase 2 moves it into the table.

**Contract**: `generation-limits.ts` gains
`PROMPT_LANGUAGE_NAMES: Record<Exclude<Language, "auto">, string>` =
`{ polski: "Polish", angielski: "English", hiszpański: "Spanish", niemiecki: "German",
francuski: "French" }`, typed by the existing union so a language added without a name is a
compile error — the exact guarantee `LANGUAGE_LABELS` already gives the human-facing half.
`systemPrompt`'s forced branch (`:97`) emits
`Write the flashcards in this language: ${PROMPT_LANGUAGE_NAMES[language]}.`, i.e.
`… : German.` for a caller passing `niemiecki`. No signature change, no API change, no
migration, and **no other file touched** — the eval's existing case definitions must keep
working untouched so the run is comparable to the recorded baseline.

The map is deleted in Phase 5 together with `LANGUAGES`, once the table is its source. Its
values are the same five strings Phase 2 seeds as `prompt_name`, which is not a coincidence
to be tidied away — it is what makes Phase 5's acceptance run a comparison rather than a
first measurement.

### Success Criteria:

#### Automated Verification:

- Full matrix run completes: `npm run eval` (key in the shell env, local stack not required)
- `forced/niemiecki` and `forced/francuski` each report 5/5 language fidelity
- The six cases green at baseline (`auto/*` ×5, `forced/polski`, `forced/angielski`) stay green
- `forced/hiszpański` is at or above its 4/5 baseline
- The shipped map passes the ordinary gates: `npm test`, `npm run lint`, `npm run build`

#### Manual Verification:

- The run table, cost and wall-clock are recorded in the change's `verification.md`
- The go/no-go decision is recorded, including the fallback taken if English names fail
  (native name, then `German (Deutsch)`), with its own measured run
- The map is committed **on its own**, and the commit contains nothing else — so it can be
  shipped, reverted or cherry-picked independently of the four phases that follow

**Implementation Note**: This phase is a gate. If English names do not fix both cases,
stop and re-measure the fallbacks before Phase 2 — the table's `prompt_name` column is only
worth building once its content is known to work. Pause for confirmation before proceeding.

**Shipping note**: the commit is self-contained and carries no migration, so it can go
through `/ship` before Phase 2 starts. Doing so is recommended and not mandatory — it closes
the production defect immediately; carrying it in the same branch is the cheaper option in
process terms and delays the user-visible fix by the whole change. Decide once, here, and
record which was chosen in `verification.md`.

---

## Phase 2: The `language` dictionary table

### Overview

Introduce the table, its seed and its RLS, modelled on `flashcard_state`, plus the
data-access module and its tests. Nothing consumes it yet.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_language_dictionary.sql` (timestamp must sort
after `20260728104500`)

**Intent**: Create the dictionary table, seed the five shipped languages, and grant
read-only access to signed-in users following the `flashcard_state` precedent exactly.

**Contract**: Table `language` with `code text primary key`, `ui_label text not null`,
`prompt_name text not null`, `sort_order smallint not null`, `is_active boolean not null
default true`, with `char_length` CHECKs on the three text columns. `code` is the primary
key rather than a surrogate `smallint` because nothing references this table by FK — the
`flashcard_state` surrogate exists only because `flashcard.state_id` points at it. Seed
rows, in `sort_order`:

| code | ui_label | prompt_name |
| --- | --- | --- |
| `pl` | `Polski` | `Polish` |
| `en` | `Angielski` | `English` |
| `es` | `Hiszpański` | `Spanish` |
| `de` | `Niemiecki` | `German` |
| `fr` | `Francuski` | `French` |

Plus a **sixth row, seeded `is_active = false`**: `it` / `Włoski` / `Italian`, `sort_order`
after `fr`. It is not a fixture and not decoration — it is a prepared-but-unshipped
language, and it is what makes `listActiveLanguages`'s filter falsifiable by an ordinary
read-only assertion (plan-review F2). Without it the filter can only be exercised by a
write, which **no client this project's test harness can build is permitted to make**: the
table has no write policies, `tests/fixtures/` exposes only the anon-key, RLS-scoped
`clientFor`, and `tests/setup/preflight.ts:61` hard-fails on a `service_role` key. The row
is invisible to every surface by construction — that is the point of asserting it.

RLS enabled; `revoke all on language from anon`; `grant select on language to
authenticated`; one policy `language_select … for select to authenticated using (true)`;
**no write policies** — deny-by-default is what keeps the table read-only until an admin
surface exists. `generation_session.language` gains no FK (see Migration Notes).

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate so the new table is typed; CI fails on a stale file.

**Contract**: Produced by `npm run db:types` against the local stack and committed. Not
hand-edited (test-plan §7).

#### 3. Data-access module

**File**: `src/lib/languages.ts`

**Intent**: Give the table one home for its queries, as `src/lib/decks.ts` does for decks —
every function takes an already-created SSR client so all reads are RLS-scoped.

**Contract**: `listActiveLanguages(supabase)` returns `code, ui_label` for active rows
ordered by `sort_order` (the UI needs no `prompt_name` and must not receive it — it is
model-facing, not user-facing). `getActiveLanguage(supabase, code)` returns
`code, prompt_name` for one active row via `maybeSingle()`, so an unknown or deactivated
code resolves as `{ data: null, error: null }` — absence, which §6.4 names as the
below-HTTP form of "404, never 403" and which the endpoint maps to a `400`.

#### 4. Shared name fixture

**File**: `tests/fixtures/language-names.ts`, re-exported by `evals/fixtures/language-names.ts`

**Intent**: One literal set of model-facing names that both the DB assertion and the eval
matrix consume, so a seed typo cannot slip through the gap between them.

**Contract**: Exports `PROMPT_LANGUAGE_NAMES: Record<string, string>` =
`{ pl: "Polish", en: "English", es: "Spanish", de: "German", fr: "French" }` — the five
**active** languages. The seeded-inactive `it` row deliberately has no entry and no
reference text.

Two things about this file's shape were decided by the plan review (F5) and are not free
choices:

- **It is keyed by `string`, NOT by `ReferenceLanguageCode`.** That union means "languages
  the eval has a reference text for"; this map means "languages the app ships". They
  coincide at five today and are not the same set — a sixth shipped language needs a
  `prompt_name`, but it does not need an authored reference text, and typing them together
  would make adding one a red DB assertion until somebody wrote 800 characters of German
  prose. The eval keeps its own `ReferenceLanguageCode` typing at its call sites, where the
  two sets genuinely do have to line up.
- **`tests/` owns it and `evals/` re-exports it, not the other way round.** The eval run
  path is deliberately isolated from `npm test` (`vitest.eval.config.ts:5-11`, and its
  inverse preflight); pointing the ordinary suite INTO `evals/` inverts that isolation for
  no gain. Both configs resolve the same repo, so a one-line re-export in
  `evals/fixtures/language-names.ts` keeps the eval's existing import ergonomics with the
  dependency arrow the right way round.

#### 5. Table tests

**File**: `tests/db/languages.test.ts`

**Intent**: Prove the seed is what the prompt layer will consume, and that the table is
readable by a signed-in user and by nobody else.

**Contract**: Against the local stack, with an RLS-scoped client from the existing
`tests/fixtures` helpers, and **read-only throughout** — no case mutates a seeded row:

- **every** active row HAS an entry in `PROMPT_LANGUAGE_NAMES` and its `prompt_name` equals
  that entry — asserted per row, not as set equality against exactly five, so shipping a
  sixth language is a one-line fixture edit rather than a red assertion (plan-review F5);
  `ui_label` values and `sort_order` ordering are asserted alongside;
- `listActiveLanguages` returns exactly the five active codes and **omits `it`** — the
  seeded-inactive row — which is the falsifiable form of the `is_active` filter;
- the positive control for that: a direct read of the table (no `is_active` filter) DOES
  return `it`, so "omits `it`" cannot be satisfied by a query that returns nothing;
- a write attempt by an authenticated client changes nothing — INSERT, UPDATE and DELETE
  each followed by a re-read proving the row is byte-identical (deny-by-default).

No case flips `is_active`, so the file is order-independent under the shuffled runner
without owning any fixture (test-plan §6.2's owned-fixture rule).

### Success Criteria:

#### Automated Verification:

- Migration applies from scratch: `npx supabase db reset`
- Generated types regenerate with no further diff: `npm run db:types` then `git diff --exit-code src/db/database.types.ts`
- Suite green including the new file: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Six rows are visible in Studio with the expected `sort_order` — five active, `it` inactive
- `pg_policies` shows exactly one policy on `language` and it is `select`-only

---

## Phase 3: Server wiring

### Overview

Make the endpoint resolve the model-facing name from the table and hand it to the
generator, and remove the language whitelist from code.

### Changes Required:

#### 1. Generator signature

**File**: `src/lib/openrouter.ts`

**Intent**: Take an already-resolved model-facing name instead of a contract value, so the
library no longer carries a language vocabulary at all and the eval can drive it without a
database.

**Contract**: `GenerateArgs.language: string` becomes `targetLanguage: string | null`,
where `null` means "same language as the source text". `systemPrompt(targetLanguage,
count)` branches on `null` for the existing auto sentence and otherwise emits
`Write the flashcards in this language: ${targetLanguage}.`. The mock-mode audit payload
(`:155`) records `targetLanguage` in place of `language`. The `"auto"` string literal
disappears from this module.

#### 2. Endpoint validation and resolution

**File**: `src/pages/api/generate.ts`

**Intent**: Replace the compile-time enum with a shape guard plus a table lookup, and map
the two outcomes the project's error-vs-empty convention distinguishes.

**Contract**: The Zod field becomes `z.string().regex(LANGUAGE_CODE_RE)` with
`const LANGUAGE_CODE_RE = /^[a-z]{2,8}$/` declared as a module literal beside `UUID_RE`
(`generate.ts:42`) — pinned rather than described, because this is the field impl-review F3
named a prompt-injection guard and this change converts it from a compile-time enum to a
runtime check (plan-review F6). No special case for `auto`: it already matches. The pattern
keeps the guard tight before any DB round-trip — arbitrary instruction text cannot pass it,
since it admits no space, no punctuation and at most eight characters.

> **Note for the admin-panel follow-up.** After this change the string interpolated into the
> system prompt is `prompt_name` from a table ROW, not a value from the request. The
> injection surface therefore MOVES rather than disappearing: it is closed today only
> because the table has no write policies. Whatever surface eventually writes `prompt_name`
> inherits that guard duty — record it in `follow-ups/admin-panel.md` (Phase 5 item 5).

Membership is then decided by
`getActiveLanguage`: a query error returns `500` with its own Polish copy, a `null` row
returns the existing `400` refusal copy, and a hit yields `prompt_name`, passed as
`targetLanguage`. `language === "auto"` skips the lookup and passes `null`. The lookup sits
**after** the idempotency replay branch and **before** deck resolution (see Critical
Implementation Details). The three `createGenerationSession` calls keep writing the
submitted **code** to `language`, not the rendered name.

#### 3. Stop importing the code-side whitelist (do NOT delete it yet)

**File**: `src/pages/api/generate.ts`, `src/lib/generation-limits.ts`

**Intent**: Take `LANGUAGES` out of the endpoint's import and out of the schema, while
leaving the export itself in place — two consumers still read it at this point in the
sequence.

**Contract**: `generate.ts` imports only `SOURCE_MAX, COUNT_MIN, COUNT_MAX`. The comment
block explaining the whitelist moves to the endpoint, rewritten to describe the two-layer
guard (regex shape + table membership) rather than the enum; `generation-limits.ts` keeps
`LANGUAGES` and `Language` with a short note that they are now read only by
`GeneratorForm.tsx` and the eval, and are deleted in Phase 5.

> **Why the deletion is deferred (plan-review F1).** `LANGUAGES` is used as a **value** at
> `GeneratorForm.tsx:237` until Phase 4, and `Language` as a **type** at
> `evals/generation-quality.eval.ts:3,52,71` until Phase 5. Deleting it here would break
> this phase's own criteria 3.2 and 3.3: `astro build` bundles the island and Rollup errors
> on a missing named export, and `npm run lint` type-lints `evals/` too (`projectService:
> true` in `eslint.config.js`, tsconfig `include: ["**/*"]`). The delete lands in Phase 5,
> behind the last reader.

#### 4. Endpoint tests

**File**: `tests/generation/generate.test.ts`

**Intent**: Cover the new membership guard, which the existing whitelist case cannot reach,
and make the audit assertions describe the new two-name reality.

**Contract**: The existing "400s a language off the whitelist" case keeps its injection-text
input — now refused by the regex — and gains a **second** sub-case: a well-formed but
unknown code (e.g. `xx`) that passes the regex and is refused by the table lookup, with the
same status-agnostic "writes nothing" oracle. `AUDIT_LANGUAGE` becomes the code (`es`) for
the `row.language` assertion, while the `request_payload` containment assertion targets the
**rendered** name (`Spanish`) — the two strings now differ, which is what makes that
assertion evidence that the rendering layer actually ran. Every `language: "auto"` in the
file is unchanged.

### Success Criteria:

#### Automated Verification:

- Suite green: `npm test`
- Type checking and lint pass: `npm run lint`
- Build passes: `npm run build`
- `npx astro sync` clean before lint (no stale generated types)

#### Manual Verification:

- Breakage check on the error-vs-empty split: with `select` on `language` revoked from
  `authenticated`, a generate request answers **500**, not the `400` refusal — proving the
  two branches are genuinely separate and the guard is not reporting an outage as "unknown
  language". Restore, and verify the restore with a `pg_policies`/grant before-and-after diff
- Breakage check on membership: temporarily set `is_active = false` on `de`, confirm a
  forced-German request answers `400` and writes nothing, then restore

---

## Phase 4: The selector reads the table

### Overview

Drive the language `<select>` from the table instead of a hard-coded map, through the same
server-render-and-pass-props path the deck selector already uses.

### Changes Required:

#### 1. Page loader

**File**: `src/pages/generate.astro`

**Intent**: Load active languages alongside decks and pass them to the island, branching on
query error rather than silently rendering a short list.

**Contract**: `listActiveLanguages` is called with the same client; its error folds into
the existing `loadError` branch, so a transient DB failure renders the error state rather
than a selector missing every language. An **empty** result is not an error — it renders a
selector offering only "Ten sam co tekst", which is the correct reading of an admin having
deactivated everything.

#### 2. Island props

**File**: `src/components/generate/GeneratorForm.tsx`

**Intent**: Render the selector from props and delete the hard-coded label map.

**Contract**: `Props` gains `languages: { code: string; label: string }[]`.
`LANGUAGE_LABELS`, the `LANGUAGES` import and the `Language` type import are removed; the
`auto` option is rendered first from a module constant with its existing Polish copy
("Ten sam co tekst"), followed by the props in the order received. Default state stays
`"auto"`. The comment at `:23-25` explaining the values/labels split is rewritten to point
at the table as the new source.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` then `npm run lint` pass
- Build passes: `npm run build`
- Suite still green: `npm test`

#### Manual Verification:

- The selector shows "Ten sam co tekst" first, then the five languages in `sort_order`,
  with the Polish labels unchanged from today
- Deactivating a row in Studio removes it from the selector on reload, **with no deploy** —
  the capability the table was chosen for
- Generating with each of the six selector values succeeds end to end
- Forcing German in the browser returns German cards — the first hand reproduction of this
  flow, which the frame recorded as never having been done

---

## Phase 5: Eval matrix, acceptance run and documentation

### Overview

Update the eval to the new generator contract, break the source-language confound, run
acceptance, and record the evidence.

### Changes Required:

#### 1. Matrix and judge expectation

**File**: `evals/generation-quality.eval.ts`

**Intent**: Drive the new `targetLanguage` contract, state the expectation to the judge in
a name that no longer moves with the wire value, and add the case that makes a green result
mean more than "works on Polish source".

**Contract**: `SELECTOR_NAME` is replaced by the shared `PROMPT_LANGUAGE_NAMES`.
`MatrixCase` carries `targetLanguage: string | null` and `expectedLanguage: string` (the
English name). Auto cases pass `null`. Forced cases pass the English name and keep the PL
source text. One case is added — **`forced/fr-on-en`**: French forced over
`REFERENCE_TEXTS.en.text`, so the target is neither the source language nor Polish. Case
names key on the language code (`forced/de`), and the old→new name mapping is recorded in
`verification.md` so the C10X-31 baseline stays readable against the new table.

#### 2. Judge documentation

**File**: `evals/lib/judge.ts`

**Intent**: Correct the contract comment on `expectedLanguage`, which currently promises an
app-selector exonym.

**Contract**: The JSDoc at `:40` states that the expectation is an English language name,
matching the English `detected_language` the rubric at `:79` already asks for. No behaviour
change.

#### 3. Scoring-test fixtures

**File**: `tests/lib/eval-scoring.test.ts`

**Intent**: Remove the dead Polish vocabulary so the file does not describe a world that no
longer exists.

**Contract**: The exonym fixture strings at `:28,80,90,99,157,160` become English names.
Pure fixture text — no assertion semantics change.

#### 4. Remove the code-side whitelist

**File**: `src/lib/generation-limits.ts`

**Intent**: Delete `LANGUAGES`, the `Language` type and Phase 1's `PROMPT_LANGUAGE_NAMES`
constant now that the set lives in the database and the last reader is gone, leaving the
module to the three numeric bounds it also owns. Deferred here from Phase 3 (plan-review F1).

**Contract**: `SOURCE_MAX`, `COUNT_MIN`, `COUNT_MAX` stay and keep their comments. This
edit lands **after** item 1 above — the eval's `import type { Language }` at `:3` is the
last reader, so the order within this phase is load-bearing: matrix first, delete second.
Phase 1's constant is deleted here rather than in Phase 3 for the same reason it was
written there: it is the code-side source of the model-facing names until `prompt_name` in
the table takes over, and the two carry the same five strings by design.

#### 5. Documentation and follow-up

**Files**: `context/foundation/test-plan.md`, `context/foundation/lessons.md`,
`context/changes/forced-language-prompt-fix/verification.md`,
`context/changes/forced-language-prompt-fix/follow-ups/admin-panel.md`

**Intent**: Record what is now covered, capture the reusable rule, and give the admin-panel
idea an owner rather than leaving it in prose.

**Contract**: the follow-up file must carry the constraint Phase 3 records — whatever
surface writes `prompt_name` inherits the prompt-injection guard the Zod enum used to hold.
test-plan gains a §6.6 entry for this change (what the fix proves, and what
it does not — chiefly that the eval remains local and human-triggered) and a §2 Risk #7
note that the defect its first run found is closed and re-measured; the §8 ledger gains a
dated line. `lessons.md` gains the rule this project did not have: a value that serves as
an API or storage contract must never be interpolated into an LLM prompt — render a
model-facing name, and keep the two roles separate. The follow-up file describes the admin
panel (language configuration among its functions) for raising via `/jira-backlog-sync`.

### Success Criteria:

#### Automated Verification:

- Suite green: `npm test`
- Acceptance run: `npm run eval` exits 0 **after** the project's re-run-once calibration
  rule — or its residual failure set is recorded in `verification.md` and is a strict
  subset of the C10X-31 baseline
- `forced/de` and `forced/fr` report 5/5 language fidelity
- `forced/fr-on-en` — the confound-breaking case — reports 5/5
- No case regresses below its C10X-31 baseline
- Lint and build pass: `npm run lint`, `npm run build`

**Implementation Note on the acceptance criterion (plan-review F3).** The eval's per-case
language gate is hard 100% (`generation-quality.eval.ts:137-138`), so ONE wrong-language
card anywhere in the 11 cases exits non-zero — at one sample per case and temperature 0.4
that is a live outcome, not a corner case. Written as a bare "exits 0" it would contradict
the no-regression criterion beside it: `forced/es` (`hiszpański`) has a recorded 4/5
**intermittent** baseline, so a run can satisfy "no case regressed" and still exit 1 with
nothing broken. The target for `forced/es` is 5/5 — the plan's whole thesis says the same
mechanism fixes it — but a 4/5 that survives one hand re-run is recorded as
still-intermittent and does **not** block this phase. What DOES block it: any red on
`forced/de`, `forced/fr`, `forced/fr-on-en`, or on a case that was 5/5 at baseline.

#### Manual Verification:

- `verification.md` carries the full run table, the old→new case-name mapping, cost and
  wall-clock, and the Phase 1 measurement alongside the acceptance run
- test-plan and lessons.md entries read correctly against the code they describe
- The admin-panel follow-up file exists and names what the ticket should cover

---

## Testing Strategy

### Unit Tests:

- `tests/db/languages.test.ts` — seed content against the shared fixture, ordering,
  `is_active` filtering, read-only enforcement
- `tests/lib/eval-scoring.test.ts` — unchanged semantics, refreshed fixtures

### Integration Tests:

- `tests/generation/generate.test.ts` — the membership guard's two refusal shapes
  (malformed by regex, well-formed-but-unknown by table), each writing nothing; the audit
  columns carrying the code while the request payload carries the rendered name

### AI-native (separate run path):

- `npm run eval` — the 11-case matrix, including the new confound-breaking case. Not part
  of `npm test` (collection-level exclusion via `vitest.eval.config.ts`), key in the shell
  environment only.

### Manual Testing Steps:

1. Generate with each of the six selector values; confirm the language of the cards
2. Force German in the browser and read the cards — the first hand reproduction of this flow
3. Deactivate a language row in Studio and confirm it leaves the selector without a deploy
4. Revoke `select` on `language` from `authenticated` and confirm a `500`, not a `400`; restore and diff
5. Simulate a language-list load failure and confirm the page renders its error state

## Performance Considerations

One additional round-trip per generation: a primary-key lookup on a five-row table, against
a request that already spends up to 40 s in an LLM call. Negligible, and deliberately not
cached — a cache would make an admin edit take effect only after an unpredictable Worker
recycle, and no measurement suggests the read is worth optimising.

## Migration Notes

The migration is **additive**: a new table, its seed, its grants and one policy. No existing
table is altered and no data is backfilled.

`generation_session.language` deliberately does **not** gain a foreign key to
`language.code`. Three reasons, each independently sufficient: rows written before this
change carry Polish exonyms; `auto` is written to that column and is not a row in the
table; and a future deactivation or rename in an admin panel must not be constrained by
historical audit rows. The column stays free `text`, exactly as it is today.

Two operational consequences to sequence at ship time. `npx supabase db push` must run
before the merge — the `drift` gate (C10X-29) blocks the deploy for a committed-but-unpushed
migration, which is the gate working as designed. And **seed-row drift is one of the two
classes no oracle in this project covers** (test-plan §6.6, C10X-29 entry): nothing verifies
that the production `language` rows match the local ones, so the seed is verified by reading
it in the cloud after the push, as a recorded observation.

## References

- Frame brief: `context/changes/forced-language-prompt-fix/frame.md`
- Recorded baseline: `context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`
- Dictionary-table precedent: `supabase/migrations/20260705180246_init_core_schema.sql:25-34,148-149`
- Values/labels separation precedent: `src/components/generate/GeneratorForm.tsx:23-33`
- Load-and-pass-props precedent: `src/pages/generate.astro:11-13`
- Error-vs-empty convention: `src/pages/api/generate.ts:165-177`, `context/foundation/lessons.md`
- Eval run path and its DB-free design: `vitest.eval.config.ts`
- Test cookbook: `context/foundation/test-plan.md` §6.2, §6.3, §6.5, §6.6

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Measure and ship the candidate fix

#### Automated

- [x] 1.1 Full matrix run completes: `npm run eval` — e4164a9
- [x] 1.2 `forced/niemiecki` and `forced/francuski` each report 5/5 language fidelity — e4164a9
- [x] 1.3 The six baseline-green cases stay green — e4164a9
- [x] 1.4 `forced/hiszpański` is at or above its 4/5 baseline — e4164a9
- [x] 1.5 The shipped map passes the ordinary gates: `npm test`, `npm run lint`, `npm run build` — e4164a9

#### Manual

- [x] 1.6 Run table, cost and wall-clock recorded in `verification.md` — e4164a9
- [x] 1.7 Go/no-go decision recorded, including any fallback taken and its measured run — e4164a9
- [x] 1.8 The map is committed on its own, and the commit contains nothing else — e4164a9

### Phase 2: The `language` dictionary table

#### Automated

- [x] 2.1 Migration applies from scratch: `npx supabase db reset` — 1c1cfee
- [x] 2.2 Generated types regenerate with no further diff — 1c1cfee
- [x] 2.3 Suite green including `tests/db/languages.test.ts`: `npm test` — 1c1cfee
- [x] 2.4 Lint passes: `npm run lint` — 1c1cfee
- [x] 2.5 Build passes: `npm run build` — 1c1cfee

#### Manual

- [x] 2.6 Six rows visible in Studio with the expected `sort_order` (five active, `it` inactive) — 1c1cfee
- [x] 2.7 `pg_policies` shows exactly one `select`-only policy on `language` — 1c1cfee

### Phase 3: Server wiring

#### Automated

- [x] 3.1 Suite green: `npm test` — eb1a0e5
- [x] 3.2 Lint passes: `npm run lint` — eb1a0e5
- [x] 3.3 Build passes: `npm run build` — eb1a0e5
- [x] 3.4 `npx astro sync` clean before lint — eb1a0e5

#### Manual

- [x] 3.5 Breakage check: `select` revoked on `language` yields 500, not 400; restore verified by diff — eb1a0e5
- [x] 3.6 Breakage check: `is_active = false` on `de` yields 400 and writes nothing; restored — eb1a0e5

### Phase 4: The selector reads the table

#### Automated

- [x] 4.1 `npx astro sync` then `npm run lint` pass — b015662
- [x] 4.2 Build passes: `npm run build` — b015662
- [x] 4.3 Suite still green: `npm test` — b015662

#### Manual

- [x] 4.4 Selector shows "Ten sam co tekst" first, then five languages in `sort_order` — b015662
- [x] 4.5 Deactivating a row in Studio removes it from the selector without a deploy — b015662
- [x] 4.6 Generating with each of the six selector values succeeds end to end — b015662
- [x] 4.7 Forcing German in the browser returns German cards (first hand reproduction) — b015662

### Phase 5: Eval matrix, acceptance run and documentation

#### Automated

- [x] 5.1 Suite green: `npm test`
- [x] 5.2 `npm run eval` exits 0 after the re-run-once rule, or its residual failure set is recorded and is a strict subset of the C10X-31 baseline
- [x] 5.3 `forced/de` and `forced/fr` report 5/5 language fidelity
- [x] 5.4 `forced/fr-on-en` reports 5/5
- [x] 5.5 No case regresses below its C10X-31 baseline
- [x] 5.6 Lint and build pass

#### Manual

- [x] 5.7 `verification.md` carries the run table, old→new case-name mapping, cost and wall-clock
- [x] 5.8 test-plan and lessons.md entries read correctly against the code
- [x] 5.9 Admin-panel follow-up file written for `/jira-backlog-sync`
