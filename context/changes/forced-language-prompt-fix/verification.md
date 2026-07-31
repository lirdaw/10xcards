# Verification — forced-language-prompt-fix (C10X-41)

## Phase 1: Measure and ship the candidate fix

Date: 2026-07-31. Machine: Windows 11, Node 22, local Supabase stack up for the ordinary
suite (the eval never touches it — `vitest.eval.config.ts` omits `setupFiles` by design).

### The edit under measurement

Two files, nothing else:

- `src/lib/generation-limits.ts` — `PROMPT_LANGUAGE_NAMES: Record<Exclude<Language, "auto">, string>`
  = `{ polski: "Polish", angielski: "English", hiszpański: "Spanish", niemiecki: "German",
  francuski: "French" }`. Typed by the existing union, so a language added to `LANGUAGES`
  without a model-facing name is a compile error at the map's definition site — the same
  guarantee `LANGUAGE_LABELS` already gives the human-facing half.
- `src/lib/openrouter.ts` — `systemPrompt`'s forced branch emits
  `Write the flashcards in this language: German.` where it used to emit `… : niemiecki.`.
  The `auto` branch is byte-identical (it was at 25/25 and interpolates no name at all).
  `GenerateArgs` is unchanged, so the eval's existing case definitions ran untouched and the
  run is comparable to the C10X-31 baseline.

The lookup is widened to `Record<string, string | undefined>` at the call site because
`systemPrompt`'s parameter is a bare `string` by `GenerateArgs`' contract. The `?? language`
fallback is unreachable through the endpoint — the Zod enum guarantees membership and the map
is exhaustive over the union — and exists so a direct caller passing something else gets
today's behaviour rather than `undefined`.

### Ordinary gates (criterion 1.5)

| Gate | Result |
| --- | --- |
| `npx astro sync` | clean |
| `npm run lint` | exit 0 — 6 warnings, all pre-existing `no-console` in `evals/generation-quality.eval.ts` (test-plan §8 records them) |
| `npm run build` | exit 0 |
| `npm test` | **257 passed / 257, 22 files**, seed `1785494531996` |

The suite count is unchanged from the C10X-34 baseline (257/257, 22 files), which is the
expected result: this edit changes a prompt string and no test in the ordinary suite reaches
the real provider (`OPENROUTER_API_KEY` unset → `mockCards`, test-plan §6.5).

### The eval runs (criteria 1.1–1.4)

Invocation — the key lives permanently in the user-scope env var `OPENROUTER_EVAL_KEY` and is
mapped onto `OPENROUTER_API_KEY` for the one process, so the ordinary suite's preflight
(`tests/setup/preflight.ts:111`, which hard-fails when that key IS set) stays intact:

```powershell
$env:OPENROUTER_API_KEY = [Environment]::GetEnvironmentVariable('OPENROUTER_EVAL_KEY','User'); npm run eval
```

Two runs, both **exit 0**, `10 passed (10)`:

| Run | Seed | Wall-clock | Invocation |
| --- | --- | --- | --- |
| 1 | `1785495027321` | 73 s (Vitest: 70.89 s) | `npm run eval` |
| 2 | `1785495141452` | 75 s (Vitest: 72.91 s) | `npx vitest run -c vitest.eval.config.ts --disable-console-intercept` |

**Run 1 produced no summary table**, and that is worth recording rather than glossing: Vitest 4
swallows `console.log` from passing tests, and with every case green the `afterAll` table — the
diagnostic the eval prints on purpose — never reached stdout. Run 2 exists to capture it and
adds an independent second sample; nothing about the code changed between them.
`--disable-console-intercept` is the flag to use whenever the table is wanted from an all-green
run.

Run 2's table verbatim (`generator: openai/gpt-4o-mini | judge: google/gemini-2.5-flash`;
row order is the shuffled execution order):

```
case                | lang     | usable | count | skip
forced/francuski    | OK 5/5   | 5/5    | 5/5   | 0%
forced/angielski    | OK 5/5   | 5/5    | 5/5   | 0%
auto/fr             | OK 5/5   | 5/5    | 5/5   | 0%
forced/niemiecki    | OK 5/5   | 5/5    | 5/5   | 0%
forced/polski       | OK 5/5   | 5/5    | 5/5   | 0%
auto/pl             | OK 5/5   | 5/5    | 5/5   | 0%
auto/de             | OK 5/5   | 5/5    | 5/5   | 0%
auto/es             | OK 5/5   | 5/5    | 5/5   | 0%
forced/hiszpański   | OK 5/5   | 5/5    | 5/5   | 0%
auto/en             | OK 5/5   | 5/5    | 5/5   | 0%
```

Against the recorded C10X-31 baseline
(`context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`):

| Case | Baseline | Run 2 | Criterion |
| --- | --- | --- | --- |
| `forced/niemiecki` | **0/5**, every card Polish, 4 of 4 runs | **5/5** | 1.2 ✔ |
| `forced/francuski` | **0/5**, every card Polish, 4 of 4 runs | **5/5** | 1.2 ✔ |
| `forced/hiszpański` | 4/5 intermittent (5/5 once) | **5/5** | 1.4 ✔ (above baseline) |
| `forced/polski`, `forced/angielski` | 5/5 | 5/5 | 1.3 ✔ |
| `auto/pl`, `auto/en`, `auto/es`, `auto/de`, `auto/fr` | 5/5 each | 5/5 each | 1.3 ✔ |

Run 1 carries no table, but its exit code carries the load-bearing half: the per-case gate is a
**hard 100%** language-fidelity assertion (`generation-quality.eval.ts:137-138`), so `10 passed`
is by construction "no wrong-language card in any case". What run 1 alone cannot state is the
per-case card counts — which is exactly the gap run 2 closes.

Count compliance 50/50 (100%) and skip-rate 0% — unchanged from the baseline's first
measurement of those two dormant metrics.

**Cost**: not independently metered this run. The project's recorded figure is ~$0.012 per full
matrix run (10 generations + ~50 judge calls), so ~$0.024 for the pair. Recorded as an estimate,
not a measurement.

### Spot-check — the cards themselves, not only the verdict

The judge is an LLM's opinion, so the two cases that were red at baseline were read by hand.
`forced/niemiecki` (source text is the Polish Copernicus reference text):

```
front: Wann wurde Mikołaj Kopernik geboren?
back:  Mikołaj Kopernik wurde im Jahr 1473 in Toruń geboren.
       verdict: language_ok=true (German), usable=true

front: Welches Modell stellte Kopernik vor?
back:  Kopernik stellte das heliozentrische Modell vor, in dem die Sonne im Mittelpunkt des
       Systems steht, während die Planeten, einschließlich der Erde, um sie kreisen.
       verdict: language_ok=true (German), usable=true
```

`forced/francuski`, same source text:

```
front: Quel modèle astronomique a proposé Kopernik ?
back:  Kopernik a proposé le modèle héliocentrique, où le Soleil est au centre du système
       solaire et les planètes, y compris la Terre, tournent autour de lui.
       verdict: language_ok=true (French), usable=true
```

Proper nouns stay Polish (`Mikołaj Kopernik`, `Toruń`, the work's Polish title) — correct, and
the judge did not penalise it. The prose is genuinely German and French.

### Go / no-go (criterion 1.7)

**GO.** English names fix both cases outright, so **no fallback was needed** — neither the native
name (`Deutsch`) nor the `German (Deutsch)` form was measured, because the first candidate
cleared the gate on two consecutive runs. The five strings measured here are the same five
Phase 2 will seed as `prompt_name`, which is what makes Phase 5's acceptance run a comparison
against a green baseline rather than a first measurement.

One caveat this evidence does not remove: two runs at temperature 0.4 is two samples, not
statistical power. `forced/hiszpański` was intermittent at baseline and its single 5/5 here does
not prove the intermittency is gone — only that it did not fire twice.

### Shipping decision (Phase 1's shipping note)

**Carried in the same branch to the end of the change — no separate `/ship` before Phase 2.**
Decided 2026-07-31. The plan offers both and calls the separate ship "recommended and not
mandatory"; the cheaper process option was chosen deliberately, and the cost is stated rather
than hidden: the user-visible defect stays live until the whole change ships, which is after
Phase 5 **and** after `npx supabase db push` applies Phase 2's migration (the `drift` gate,
C10X-29, blocks the deploy until it does).

What the decision does not cost: the measurement benefit the plan's F4 note is really about.
Phases 2–5 still start from a **green** eval baseline recorded here, so a red acceptance run in
Phase 5 means the restructuring broke it — a one-variable signal.

The commit shape still honours criterion 1.8: the map ships as `fix(C10X-41)` carrying only the
two `src/` files, with the change-folder artifacts in a separate `docs(C10X-41)` commit. So the
fix stays independently revertable and cherry-pickable even though it is not shipped early.

---

## Phase 4: The selector reads the table

### Ordinary gates (criteria 4.1–4.3)

| Gate | Result |
| --- | --- |
| `npx astro sync` then `npm run lint` | exit 0 — **0 errors**, 6 warnings, all the pre-existing `no-console` in `evals/generation-quality.eval.ts` |
| `npm run build` | exit 0 |
| `npm test` | **262 passed / 262, 23 files**, seed `1785500462789`, 2.72 s |

No test in the suite reaches the island's JSX (test-plan §7), so the three criteria above say
the wiring type-checks and nothing regressed — they say nothing about what renders. That is
what the four manual rows below are for, and they were driven in a real Chrome against
`npm run dev`, not reasoned about.

### 4.4 — the selector's contents come from the table

Read off the live accessibility tree at `/generate`, signed in:

```
combobox "Ten sam co tekst"
 option "Ten sam co tekst" (selected) value="auto"
 option "Polski"     value="pl"
 option "Angielski"  value="en"
 option "Hiszpański" value="es"
 option "Niemiecki"  value="de"
 option "Francuski"  value="fr"
```

`auto` first and selected by default; then the five active rows in `sort_order`, with the
Polish labels unchanged from the deleted `LANGUAGE_LABELS`. The **values** are the change: they
are now the table's `code`, not the Polish exonyms that used to be the wire value.

`it` / `Włoski` — the seeded-inactive sixth row — never appears, which is the `is_active` filter
observed through the UI rather than only through `tests/db/languages.test.ts`.

### 4.5 — deactivating a row removes it, with no deploy

The capability the table was chosen for, so it was measured rather than assumed. Table dumped
before the edit, then `update public.language set is_active = false where code = 'fr'` against
the running local DB (what a Studio edit does), then a **plain page reload** — no rebuild, no
dev-server restart:

```
option "Ten sam co tekst" value="auto"   option "Polski"     value="pl"
option "Angielski"        value="en"     option "Hiszpański" value="es"
option "Niemiecki"        value="de"
```

`Francuski` is gone. Restored with `is_active = true`, and the restore **verified by diff** of
the full six-row dump before/after (`diff` empty) plus a second reload showing `fr` back in the
list — this project's restore discipline, never a visual check (test-plan §6.6 records a
restore that silently no-opped).

### 4.6 — all six selector values generate end to end

Six submissions through the real form, mock mode (`OPENROUTER_API_KEY` unset), each with its own
short source-text marker so the rows are attributable. The oracle is the audit table, not the
green banner:

```
 language | status    | generated | saved | marker   | request_payload->>'targetLanguage'
----------+-----------+-----------+-------+----------+-----------------------------------
 auto     | succeeded |         5 |     5 | Fotosynt | (null)
 pl       | succeeded |         5 |     5 | Case pl. | Polish
 en       | succeeded |         5 |     5 | Case en. | English
 es       | succeeded |         5 |     5 | Case es. | Spanish
 de       | succeeded |         5 |     5 | Case de. | German
 fr       | succeeded |         5 |     5 | Case fr. | French
```

That table is the whole change in one row set: the **code** is what the audit column stores, the
**rendered name** is what reaches the generator, and `auto` resolves to `null` rather than to a
name — the role separation the plan is about, observed end to end through the browser for the
first time. The lookup, the regex shape guard and `createGenerationSession` all ran; no case
fell into the `400` refusal.

### 4.7 — forcing German returns German cards

The first hand reproduction of the defective flow. `OPENROUTER_API_KEY` added to `.env`
temporarily (backup taken first, `md5` recorded), dev server restarted, mock banner confirmed
**gone**, then: deck `C10X-41 Faza 4`, language `Niemiecki`, 3 cards, Polish source text about
photosynthesis.

Result — 3/3 cards in German, saved:

```
front: Was ist Fotosynthese?
back:  Fotosynthese ist der Prozess, bei dem Pflanzen Lichtenergie in chemische Energie
       umwandeln. Sie findet in Chloroplasten statt und produziert Sauerstoff als Nebenprodukt.

front: Wo findet die lichtabhängige Phase der Fotosynthese statt?
back:  Die lichtabhängige Phase der Fotosynthese findet in den Thylakoiden der Chloroplasten
       statt, wo Lichtenergie in chemische Energie umgewandelt wird.

front: Welcher Farbstoff ist der Hauptakteur bei der Lichtabsorption?
back:  Der Hauptfarbstoff, der Licht absorbiert, ist Chlorophyll a. …
```

And the audit row proves the sentence that produced them was rendered from the table, not from
the request:

```
 language | model              | status    | generated | saved
----------+--------------------+-----------+-----------+-------
 de       | openai/gpt-4o-mini | succeeded |         3 |     3

substring(request_payload, 'Write the flashcards in this language: [A-Za-z]+\.')
 → Write the flashcards in this language: German.
```

`.env` restored from the pristine copy and **verified by `md5sum -c` (OK)**, with a `grep` for
`OPENROUTER` in the file returning zero hits — so `npm test`'s preflight clamp is intact.

One thing this row does NOT show, worth stating because it looks like an inconsistency above:
`request_payload->>'targetLanguage'` is `null` for the real run while the mock runs carry it.
That is by design — on the real path the column stores the actual OpenRouter request body, whose
system message carries the name; only mock mode records the resolved name as its own field
(`openrouter.ts`, Phase 3 item 1).

### What Phase 4 does not prove

- **Nothing here is an automated assertion.** Four browser rows plus a row oracle; the island's
  JSX stays untested by construction (test-plan §7), so a regression in this selector is caught
  by reading the diff, not by `npm test`.
- **The empty-language-list branch was not exercised.** `generate.astro` treats an empty result
  as "render the selector with `auto` only" and only a query **error** as the error state; the
  error branch is covered by the plan's own Phase 3 breakage check (revoked `select` → 500), the
  empty branch by neither.
- **One sample per language.** 4.6 ran in mock mode, so it proves the wiring, not generation
  quality; 4.7 is one real run at temperature 0.4. The statistical claim is Phase 5's eval.

---

## Phase 5: Eval matrix, acceptance run and documentation

Date: 2026-07-31. Same machine and stack as Phase 1.

### What changed

| File | Change |
| --- | --- |
| `evals/generation-quality.eval.ts` | drives `targetLanguage` (Phase 3's contract), resolves names from the shared `PROMPT_LANGUAGE_NAMES`, states the judge expectation as an **English** name, renames cases onto the language **code**, and adds `forced/fr-on-en` |
| `evals/lib/judge.ts` | `JudgeInput.expectedLanguage` JSDoc corrected — it promised an app-selector exonym; the rubric has always asked `detected_language` back as an English name. No behaviour change |
| `evals/lib/scoring.ts` | one comment example (`"forced/hiszpański"` → `"forced/es"`) |
| `tests/lib/eval-scoring.test.ts` | fixture vocabulary only — case names onto codes, `expectedLanguage` onto English names. No assertion changed meaning |
| `src/lib/generation-limits.ts` | `LANGUAGES`, `Language` and Phase 1's `PROMPT_LANGUAGE_NAMES` **deleted**; a comment records where each of the three roles went |

Order inside the phase was load-bearing and was followed: the matrix moved off
`import type { Language }` **before** the export was deleted (plan item 4).

### The old→new case-name mapping

The C10X-31 baseline is recorded under the old names, so it stays readable against the new
table only through this:

| C10X-31 name | now | note |
| --- | --- | --- |
| `auto/pl` … `auto/fr` | unchanged | already keyed on the code |
| `forced/polski` | `forced/pl` | the identity positive control |
| `forced/angielski` | `forced/en` | |
| `forced/hiszpański` | `forced/es` | the documented intermittent |
| `forced/niemiecki` | `forced/de` | 0/5 at baseline |
| `forced/francuski` | `forced/fr` | 0/5 at baseline |
| — | `forced/fr-on-en` | **new**: no baseline, first measured here |

The rename is not cosmetic: the case name used to be the wire value, and the wire value is
now a two-letter code. Leaving `forced/niemiecki` in place would name a string that no
longer exists anywhere in the system.

### Ordinary gates (criteria 5.1, 5.6)

| Gate | Result |
| --- | --- |
| `npx astro sync` | clean |
| `npm run lint` | exit 0 — **0 errors**, 6 warnings, the same pre-existing `no-console` in `evals/generation-quality.eval.ts` |
| `npx tsc --noEmit` | **clean** — see the finding below, this one is not routine |
| `npm run build` | exit 0 |
| `npm test` | **262 passed / 262, 23 files**, seed `1785502719409`, 2.87 s |

The suite count is unchanged from Phase 4 (262/262, 23 files) and that is the expected
result: `eval-scoring.test.ts` changed fixture STRINGS, not cases.

Re-run after the two comment corrections found by manual check 5.8 below: **262/262 again**,
seed `1785503894768` — a different permutation, since the runner's seed is deliberately
un-pinned (test-plan §6.2) — with `npm run lint` exit 0, `npx tsc --noEmit` clean and
`npm run build` exit 0 alongside it.

### A finding, measured rather than noticed: `npm test` + `lint` + `build` were all green over a type error

Phase 3 changed `GenerateArgs.language` to `targetLanguage`. The eval kept passing
`language:` until this phase — for two phases, on a branch whose every gate was green.
Measured rather than argued: the five files were reverted to `HEAD` (Phase 4's end state,
`b015662`) and

```
$ npx tsc --noEmit
evals/generation-quality.eval.ts(96,9): error TS2353: Object literal may only specify known
properties, and 'language' does not exist in type 'GenerateArgs'.        [exit 2]
```

— exactly one error, and nothing in the project's gate set sees it. `npm run lint` is
ESLint with type-aware RULES, which is not `tsc` diagnostics; `astro build` does not run
`astro check`; and `npm test` never collects `evals/**`, by the deliberate isolation
C10X-31 built. So the eval — the acceptance instrument for Risk #7 — could sit
uncompilable while the branch read green, and the only thing that would have surfaced it is
running it.

Restore: all five files copied back from pristine copies taken before the revert, verified
by **MD5 per file** (5/5 `OK`), then `npx tsc --noEmit` clean again. Not a visual check
(test-plan §6.6 records a restore that silently no-opped).

This is recorded as a gap, not fixed here — adding `tsc --noEmit` to `npm run lint` or to
CI is a gate change with its own blast radius and belongs to its own ticket. Named in the
does-NOT-prove list in test-plan §6.6.

### Acceptance runs (criteria 5.2–5.5)

Same invocation as Phase 1 — the key lives in the user-scope `OPENROUTER_EVAL_KEY` and is
mapped onto `OPENROUTER_API_KEY` for the one process, so `npm test`'s preflight clamp stays
intact:

```powershell
$env:OPENROUTER_API_KEY = [Environment]::GetEnvironmentVariable('OPENROUTER_EVAL_KEY','User')
npx vitest run -c vitest.eval.config.ts --disable-console-intercept
```

`--disable-console-intercept` is deliberate and Phase 1 explains why: Vitest 4 swallows
`console.log` from PASSING tests, so an all-green run otherwise prints no summary table.

Two runs, both **exit 0**, `11 passed (11)`:

| Run | Seed | Wall-clock (Vitest) |
| --- | --- | --- |
| 1 | `1785502740173` | 108 s (106.19 s) |
| 2 | `1785502867030` | 154 s (151.96 s) |

Run 1's table verbatim (`generator: openai/gpt-4o-mini | judge: google/gemini-2.5-flash`;
row order is the shuffled execution order):

```
case                | lang     | usable | count | skip
auto/en             | OK 5/5   | 5/5    | 5/5   | 0%
auto/pl             | OK 5/5   | 4/5    | 5/5   | 0%
auto/de             | OK 5/5   | 5/5    | 5/5   | 0%
forced/fr-on-en     | OK 5/5   | 5/5    | 5/5   | 0%
forced/fr           | OK 5/5   | 5/5    | 5/5   | 0%
forced/de           | OK 5/5   | 5/5    | 5/5   | 0%
forced/pl           | OK 5/5   | 5/5    | 5/5   | 0%
forced/en           | OK 5/5   | 5/5    | 5/5   | 0%
forced/es           | OK 5/5   | 5/5    | 5/5   | 0%
auto/fr             | OK 5/5   | 5/5    | 5/5   | 0%
auto/es             | OK 5/5   | 5/5    | 5/5   | 0%
```

Run 2's, same shape:

```
case                | lang     | usable | count | skip
auto/en             | OK 5/5   | 5/5    | 5/5   | 0%
forced/de           | OK 5/5   | 5/5    | 5/5   | 0%
forced/fr           | OK 5/5   | 5/5    | 5/5   | 0%
auto/pl             | OK 5/5   | 5/5    | 5/5   | 0%
auto/es             | OK 5/5   | 5/5    | 5/5   | 0%
auto/de             | OK 5/5   | 5/5    | 5/5   | 0%
forced/pl           | OK 5/5   | 4/5    | 5/5   | 0%
auto/fr             | OK 5/5   | 5/5    | 5/5   | 0%
forced/en           | OK 5/5   | 5/5    | 5/5   | 0%
forced/fr-on-en     | OK 5/5   | 5/5    | 5/5   | 0%
forced/es           | OK 5/5   | 5/5    | 5/5   | 0%
```

Against the C10X-31 baseline
(`context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`):

| Case | Baseline | Run 1 | Run 2 | Criterion |
| --- | --- | --- | --- | --- |
| `forced/de` (`niemiecki`) | **0/5**, every card Polish, 4 of 4 runs | 5/5 | 5/5 | 5.3 ✔ |
| `forced/fr` (`francuski`) | **0/5**, every card Polish, 4 of 4 runs | 5/5 | 5/5 | 5.3 ✔ |
| `forced/fr-on-en` | — (new) | 5/5 | 5/5 | 5.4 ✔ |
| `forced/es` (`hiszpański`) | 4/5 intermittent (5/5 once) | 5/5 | 5/5 | 5.5 ✔ (above baseline) |
| `forced/pl`, `forced/en` | 5/5 | 5/5 | 5/5 | 5.5 ✔ |
| `auto/pl`…`auto/fr` | 5/5 each | 5/5 each | 5/5 each | 5.5 ✔ |

**Criterion 5.2 is met in its strong form**: `npm run eval` exits **0** on the full matrix,
so the "residual failure set is a strict subset of the baseline" fallback the plan wrote for
a partial result was never needed. No case is red, in either run, and the re-run-once
calibration rule therefore had nothing to arbitrate — the second run is an independent
second sample, not an appeal.

Language fidelity 110/110 cards across the two runs. Count compliance 55/55 (100%) and
skip-rate 0% in both, matching every prior measurement.

**Cost**: not independently metered. The project's recorded figure is ~$0.012–0.013 per
full matrix run; this matrix is 11 cases rather than 10, so ~$0.03 for the pair. Estimate,
not a measurement.

### The one usable=false card, in both runs — and why it is not a regression

Aggregate usability was **54/55 = 98.2%** in each run against an 80% run-level threshold.
The single rejected card is the same card both times, and it is instructive:

```
front: Jakie były główne osiągnięcia Kopernika?
back:  Kopernik był astronomem, matematykiem, lekarzem i duchownym. Jego najważniejsze
       dzieło to "O obrotach sfer niebieskich".
verdict: language_ok=true (Polish), usable=false — the back does not fully answer the
       front; it omits his most significant achievement, the heliocentric model.
```

It landed under `auto/pl` in run 1 and under `forced/pl` in run 2 — both of which run on
the same PL reference text, so this is one generator weakness on one source text surfacing
under whichever case drew it, not two separate failures. The judge's reading is defensible
on a hand read: the question asks for achievements and the answer lists professions plus a
title. Nothing about it touches this change; it is a usability blemish inside a threshold
with ~18 points of headroom, and it is recorded rather than smoothed over precisely because
"98.2%" alone would hide that the two runs rejected the *same* card.

### The confound-breaking case, and what it adds

`forced/fr-on-en` is the case the plan added because every other forced case runs on the PL
source text. On that matrix a green `forced/fr` is compatible with a weaker story than the
one this change claims — and `forced/pl` is green by construction, since the target agrees
with the source. Forcing French over the **English** reference text removes the overlap:
Polish is absent from the request entirely and the target is neither the source language
nor Polish, so a French card can only have come from the interpolated name.

It returned 5/5 in both runs, on Great Barrier Reef content in French
(`La Grande Barrière de Corail s'étend sur environ 2 300 kilomètres.`) — which is the
strongest single piece of evidence in this change that the rendering layer, not the source
text, is what determines the output language.

### What Phase 5 does not prove

- **The eval is still local and human-triggered.** No CI leg, no schedule — C10X-31's
  deferred `workflow_dispatch` follow-up is untouched (test-plan §5). "Covered" here means
  "the capability exists and was exercised on this date", never "a signal is being watched".
- **Two samples are not statistical power.** Both runs are single samples per case at
  temperature 0.4. `forced/es` was intermittent at baseline and is 5/5 twice here; that is
  encouraging and is not proof the intermittency is gone.
- **The judge is an LLM's opinion.** Calibrated by hand at C10X-31 and spot-checked again in
  Phase 1; `EVAL_JUDGE_MODEL` exists so a suspect verdict can be cross-examined.
- **The seed rows in the CLOUD are unverified.** The eval reads no database at all, and the
  ordinary suite reads the LOCAL one. Seed-row drift is one of the two classes no oracle in
  this project covers (test-plan §6.6, C10X-29) — so after `db push` the production
  `language` rows must be read once by hand, as a recorded observation. That is ship-time
  work, not Phase 5's.
- **`tsc` is not in any gate.** See the finding above.

### 5.8 — the doc entries read against the code, and what that pass found

The criterion is "read correctly against the code they describe", so each factual claim in
the new `test-plan.md` §6.6 entry, the §8 lines and the `lessons.md` rule was checked against
the file it names — not against memory of writing it. Six were confirmed as written
(`LANGUAGE_CODE_RE = /^[a-z]{2,8}$/` and its position before the DB round-trip; the seed's six
rows with `it` inactive; `getActiveLanguage` resolving absence as `{ data: null, error: null }`;
`AUDIT_LANGUAGE = "es"` with the payload assertion pinned to a name asserted `not.toBe` the
code; `generate.astro` reading the list per request with no cache; the `tests/` → `evals/`
re-export direction). **Two were wrong, and both are corrected.**

**1. "Closed only because the table has no write policies" was incomplete — there are TWO
enforcers.** The migration also runs `revoke all on language from authenticated`, and that
line is load-bearing rather than tidy: Supabase's default privileges `grant all` on every new
table in `public`, so the `grant select` beside it narrows nothing on its own. The
one-enforcer phrasing appeared in **four** places and each is now fixed — the two documents
written this phase (`test-plan` §6.6 and the follow-up), plus **two source comments that
predate this phase and contradicted their own code**: `src/pages/api/generate.ts:42` and the
header of `tests/db/languages.test.ts`, whose own write case (lines 73–82) had described the
pair correctly all along. This matters beyond wording: with two layers the deliberate-breakage
check is a **pair** — adding a write policy alone leaves the suite GREEN, because the missing
grant absorbs the write — and the one-enforcer sentence would have sent the next contributor
to run half of it and conclude the assertion was falsifiable.

**2. The §8 suite-count breakdown named the wrong new case.** It read "+1 membership sub-case
in `generate.test.ts`". Diffing the `it()` titles against `e4164a9` shows the +1 is
`replays a keyed session even when its language has since been deactivated`; the membership
widening added **no** case at all — it went into the existing whitelist case, which now drives
three inputs (injection text → refused by the regex; `xx` → refused by the table; a deactivated
code → refused the same way) and was retitled accordingly. Corrected, with the method
recorded, because "+4 and +1 sums to five" is arithmetic that agrees with itself whichever
case is which.

Both corrections are the C10X-34 class exactly: a comment that reads plausibly and describes a
weaker system than the one the code implements. Neither changes behaviour — the edits are
comments and documents — and the suite was re-run after them.

### 5.9 — the follow-up file

`follow-ups/admin-panel.md` exists and states: what the screen is, the role model and the two
write enforcers a ticket would have to open, that language configuration is one function among
several the PRD names for the admin area, and — the part that must not be lost — that
`prompt_name` inherits the prompt-injection guard the Zod enum used to hold, with the three
concrete measures that inheritance implies (a DB CHECK on shape, endpoint validation over a
narrow vocabulary, and a case proving a crafted `prompt_name` cannot steer the generator). No
Jira ticket was created, per the plan's "What We're NOT Doing"; it is raised via
`/jira-backlog-sync`.

### 5.7 — what this file carries

Both acceptance runs with their seeds, verbatim summary tables and wall-clock; the old→new
case-name mapping; the cost estimate stated as an estimate; the `tsc` finding with its
observed error string and its MD5-verified restore; and the Phase 1 measurement, which sits in
this same file above — so the acceptance run reads as a comparison against a recorded green
baseline rather than as a first measurement.
