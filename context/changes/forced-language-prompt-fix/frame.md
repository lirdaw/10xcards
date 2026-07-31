# Frame Brief: Forced target language is ignored for German and French

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Generating with the language selector forced to `niemiecki` or `francuski` returns
flashcards in **Polish**: 0 of 5 cards in the target language, in four of four complete
eval runs. `hiszpański` is intermittent (4/5 in four runs — one mixed card; 5/5 once).
`polski` and `angielski` are green. The `auto` path (detect from the source text) is
flawless: 25/25 cards in the source language across five languages. No error is shown to
the user — the wrong-language cards are returned as an ordinary success.

Recorded run table: `context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`.

## Initial Framing (preserved)

- **User's stated cause or approach**: the prompt builds an English sentence carrying the
  **Polish exonym** — `Write the flashcards in this language: niemiecki.`
  (`src/lib/openrouter.ts:97`) — and the model reads the Polish word as a signal that the
  context is Polish, so it answers in Polish.
- **User's proposed direction**: state the language in English (`German`) or natively
  (`Deutsch`). Flagged in the ticket itself as "to be verified, not assumed".
- **Pre-dispatch narrowing**: the leading observation is **the forced-language path as a
  class** (de + fr + the flaky es), not just the two hard failures. The symptom has been
  seen **only through `npm run eval`**, never reproduced by hand in the app. Whether it
  also occurs with a **non-Polish source text** was **never checked** ("nie sprawdzałem") —
  which matters, because every `forced/*` eval case runs on the same Polish source text.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Prompt lexicon** — the model has to resolve the Polish exonym as the name of a target
   language (`openrouter.ts:97`).  ← initial framing
2. **Source-language dominance** — the model follows the language of the user turn (the
   pasted text) over the system instruction. All five `forced/*` cases run on
   `REFERENCE_TEXTS.pl`, so this is confounded with 1 by construction
   (`evals/generation-quality.eval.ts:71-77`).
3. **Instruction salience** — the language rule is sentence 5 of 6, joined with `" "` into
   a single system string, with no precedence clause ("even if the source text is in
   another language") and no restatement in the user turn (`openrouter.ts:98-105`).
4. **Value-to-model-name coupling** — one `LANGUAGES` value serves three roles at once: the
   Zod enum on the API (`generate.ts:51`), the value persisted to
   `generation_session.language` (`generate.ts:213,250,290`), and the token interpolated
   into the prompt (`openrouter.ts:97`). Nothing in the system ever renders a
   **model-facing** name for a language.
5. **Measurement** — the judge is told the expectation using the *same* Polish exonym
   (`evals/generation-quality.eval.ts:40-46` → `evals/lib/judge.ts:77`), so the red could
   in principle come from the instrument rather than the generator.

## Hypothesis Investigation

Investigated by direct reads of this repository (five files, all read in full); no
sub-agents — the surface is small enough that delegation would have added nothing.

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 5: the judge produces the red | `auto/de` and `auto/fr` scored **5/5 green** while being told the expectation in the identical wording (`SELECTOR_NAME.de = "niemiecki"`, eval:40-46). Same instrument, same words, opposite result | **NONE** (refuted) |
| 2: the source language wins | `forced/angielski` is **5/5 English** on that same Polish source text (verification.md run table). The model demonstrably overrides the source language when it understands the target | **WEAK** (refuted as the sole mechanism) |
| 3: the instruction is too weak in the prompt | The structure is real (`openrouter.ts:98-105`), but `forced/polski` and `forced/angielski` pass through the *same* structure and succeed. Structure does not discriminate between the green and red cases | **WEAK** (not the differentiator) |
| 1: the model does not resolve the exonym as a target-language name | The failure gradient is exactly lexical and stable across four runs: `polski`/`angielski` green → `hiszpański` intermittent → `niemiecki`/`francuski` 0/5. Every failing card is Polish, never a third language, i.e. the target instruction is not *misread* — it is not acted on at all | **STRONG** |
| 4: no model-facing language name exists | `LANGUAGES` (`generation-limits.ts:43`) is simultaneously API enum, audit-column value and prompt token. The **human-facing** side of exactly this problem was already solved separately — `LANGUAGE_LABELS` in `GeneratorForm.tsx:26` maps value → display string. The model-facing twin was never written; the prompt gets the raw contract value | **STRONG** (structural) |

## Narrowing Signals

- **`forced/angielski` is green.** "Angielski" is as Polish a word as "niemiecki". If the
  mechanism were "a Polish word drags the answer into Polish", this case would fail with
  the others. It does not — so the stated cause is *incomplete*, not wrong.
- **`auto` is flawless (25/25).** The `auto` branch interpolates no language name at all
  (`openrouter.ts:96`). The defect appears exactly where a name is injected, and only there.
- **Every failing card is Polish, never a third language.** Consistent with "the target
  instruction was not actioned", not with "the target was misidentified".
- **The confound was never broken** (user's own answer): forced language has only ever been
  measured against a Polish source. So "forced target ≠ source language" is untested as a
  general claim, both before and — unless the matrix changes — after the fix.
- **The symptom has never been reproduced by hand in the app.** Low risk (the eval drives
  the production `generateCandidates()` directly), but worth one manual check.

## Cross-System Convention

This project already draws the line this defect crosses. `GeneratorForm.tsx:23-33`
carries an explicit comment — "The lib exports VALUES; the labels are UI and stay here",
typed by the `Language` union so a value without a label fails to compile. That is the
same separation, applied to the human reader. The prompt is the **second** consumer that
needs a rendered name, and it is the one still reading the raw value.

No prior decision record justifies the Polish exonyms: a search across `context/` finds
the values discussed only after the fact (test-plan §6.6, roadmap H-06, the C10X-31
artifacts), never chosen as model-legible tokens. `context/foundation/lessons.md` contains
no prompt- or language-related lesson at all — this class is unrecorded in this project.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the generation prompt has no model-facing name
> for the target language — it interpolates the raw whitelist value, a Polish exonym chosen
> for the API and audit contract, and the model actions it only for the languages whose
> exonym it happens to resolve.

The initial framing named the right line of code and the right fix candidate, but stopped
at "the word is Polish", which `forced/angielski` contradicts. One level down, the defect is
structural: nothing in the pipeline is responsible for rendering a language into a form the
model can act on, so the prompt reaches for the only string available. Addressing it at that
level fixes the two hard failures and the flaky `hiszpański` by the same mechanism, closes
the class rather than the two instances, and leaves an obvious place for the next language
to be added without re-opening this ticket.

The user has decided the wire value **may change** ("ma docelowo być zrobione dobrze") — so
the plan is free to make the selector value model-legible at the contract level rather than
mapping only at the prompt boundary.

**That blast radius was measured, not assumed, and it is smaller than it first looked.**
`generation_session.language` is `text not null` with **no CHECK constraint and no enum
type** (`supabase/migrations/20260712162349_generation_session.sql:27`), and **nothing reads
it**: a grep across `src/`, `tests/` and `evals/` finds only writes plus one assertion in
the audit-columns test (`tests/generation/generate.test.ts:804`). No page, filter or RPC
consumes the column. So changing the values needs **no migration and no backfill**; what
moves is four places in code — the Zod enum (`generate.ts:51`), the `LANGUAGE_LABELS` keys
(`GeneratorForm.tsx:26`), `SELECTOR_NAME` in the eval
(`evals/generation-quality.eval.ts:40-46`) and the `AUDIT_LANGUAGE` constant
(`generate.test.ts:774,804`). The only residue is analytical: rows written before the change
carry the old strings, and the eval's recorded calibration is evidence about the old wording.

## Confidence

**MEDIUM.**

The structural finding is strong and matches an existing convention in this codebase. What
is *not* proven, and cannot be proven by reading:

- **Which lexical mechanism operates** — "the Polish word pulls Polish context" vs "the
  exonym is too rare a token for gpt-4o-mini to bind to a language". Both are fixed by the
  same change, so the reframe does not depend on the answer; a post-fix run settles it for
  free.
- **That a model-legible name actually fixes it.** The candidate fix has never been run.
  Verification needed before the plan commits: one `npm run eval` (~$0.012, key in the shell
  env) with the language rendered in English/natively — `forced/niemiecki` and
  `forced/francuski` green. That measurement belongs in the plan's first phase, not after it.

## What Changes for /10x-plan

Plan a **language rendering layer**, not a string swap: decide what the selector/API value
is (the user has allowed changing it), and make the prompt consume a name chosen to be
model-legible, with the existing `LANGUAGE_LABELS` separation as the local precedent. Two
things must be in the plan explicitly: the four code sites keyed off the current values
(enum, labels, `SELECTOR_NAME`, `AUDIT_LANGUAGE` — no migration is needed, see above), and a
first phase that *measures* (one eval run) before the rest is built.

**Recommended, user undecided:** add one forced case whose source text is neither the target
language nor Polish (e.g. force `francuski` on the EN reference text). Without it, a green
`forced/niemiecki` proves the fix only for a Polish source, which is the confound this brief
found and would otherwise inherit. Cost is one extra generation plus ~5 judge calls — roughly
+10% of a $0.012 run. If the plan skips it, it should say so as a known coverage limit rather
than let the matrix read as general.

## References

- Source files: `src/lib/openrouter.ts:93-106,147-177`, `src/lib/generation-limits.ts:37-45`,
  `src/pages/api/generate.ts:51,201,213,250,290`,
  `src/components/generate/GeneratorForm.tsx:23-33,225-243`
- Eval/measurement: `evals/generation-quality.eval.ts:31-79`, `evals/lib/judge.ts:72-86`,
  `evals/fixtures/reference-texts.ts:1-40`
- Recorded evidence: `context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`
  (run table + "THE FINDING"), `context/foundation/test-plan.md` §6.6 (C10X-31 entry),
  `context/foundation/roadmap.md` H-06
- Investigation tasks: none — investigated inline (see Hypothesis Investigation)
- Jira: C10X-41
