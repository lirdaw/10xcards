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
