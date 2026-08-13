# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-13 (C10X-49 `bug-generation-deck-undo-swallowed` — **not a §3 rollout phase
> and not a coverage widening: no §2 risk row moves, no §3 phase status changes, and §3's table is
> untouched.** The second entry of the same day, and the sibling of the one below it: C10X-48 fixed
> one swallowed compensating write in `generate.ts`, this one fixes the other, and **the remaining
> exception is now C10X-50's alone.**
>
> **Read the boundary before the coverage, because this entry is one committed test and one manual
> run and they do not meet.** The endpoint branch it fixes — the `deleteDeck` undo after a failed
> `generation_session` insert — is **unreachable from this suite**, and that is an identity rather
> than an inconvenience: `findSucceededSessionByIdempotencyKey`'s filter set is _the same set_ as
> the partial unique index's predicate, so no seeded row can collide on the INSERT while escaping
> the lookup that runs before it, and `failure-path.test.ts`'s seam never doubles the database. So
> the **suite** owns the HELPER's contract — `deleteDeck` had **no caller anywhere in `tests/`**
> until now, so the zero-row-vs-landed distinction the whole fix branches on was asserted nowhere —
> and **one recorded manual DCL run** owns the endpoint's use of it. **Nothing bridges the two, and
> no test in this project can.**
>
> **What the fix is, in one sentence, and why its flag is the surprising part.** The undo's
> `{data, error}` is read on both arms into a `deckUndone` boolean, and a failed undo replaces
> `sessionFailure` with a distinct `500` that names the leftover deck and carries
> **`retriable: false`** — this handler's first `false` on a 500. That is not a softening of
> C10X-48's absent-means-retriable rule but its own test applied honestly: "Ponów" replays
> `lastPayload` VERBATIM, the orphan deck now exists, so the repeat is a deterministic `409` at
> `deckNameExists` — i.e. offering the button would reproduce this ticket's own defect one click
> later. With no button the copy is the user's ONLY route out, which is why it names two of them
> and why the browser check confirming the reload-then-select route is real is load-bearing rather
> than a nicety.
>
> **The orphan deck survives, deliberately: this change detects, it does not delete.** A plan
> promising otherwise would have been overclaiming, and the manual run's two orphan decks are left
> in the local dev DB as the artifact of record.
>
> Suite **435 → 437, 36 files** (+2, both in `tests/isolation/decks.test.ts`, 5 → 7), each half
> measured by RUNNING rather than by arithmetic. **435, not the 434 recorded below** — that figure
> is C10X-48's pre-impl-review one, and §8 carries the discrepancy as a dated correction rather
> than a rewrite. One breakage run, **2 of 7 red across two layers on one neuter**, both predicted
> and named before it ran, with **both positive controls green** as the attribution. Evidence:
> `context/changes/bug-generation-deck-undo-swallowed/verification.md` (after archiving:
> `context/archive/<date>-bug-generation-deck-undo-swallowed/verification.md`).
>
> Previously: 2026-08-13 (C10X-48 `bug-generation-compensation-swallowed` — **not a §3 rollout
> phase, and not a coverage widening either: no §2 risk row moves and no phase status changes.**
> What moves is that the replay path's DEAD END has tests at all. `failGenerationSession` had **no
> caller anywhere in `tests/`** and the archived mutation register lists the whole function as 5
> NoCov, so a compensating write that silently did nothing was invisible to every layer this
> project has.
>
> **Read the boundary in the same breath as the coverage, because this entry is half suite and
> half one manual run.** The suite proves the CONSEQUENCE half — given a `succeeded` session with
> zero cards behind it, the endpoint disarms the row's `idempotency_key`, confirms the update
> matched, and generates instead of answering the same 500 forever. That the endpoint can
> **PRODUCE** that row is proved by ONE recorded manual run (two DCL revokes, one real generation,
> the row read directly in psql as `succeeded | saved_count 3 | keyed | 0 cards`) and by nothing
> else, ever — D-04 rules out the two ways to force it here. That run also proves the
> compensation's **error** arm only; its **zero-row** arm is a committed cross-account test, which
> is the stronger evidence because it runs on every `npm test`.
>
> **Two rows reach the healed branch and they are byte-identical**, which is why the heal clears
> the key and nothing else: one is poisoned (nothing ever landed), the other is a real generation
> the user emptied — and there `saved_count` is TRUE. A heal that reused the retirement would
> destroy a truthful audit row to fix a key, i.e. this ticket's own defect class one path over.
> One test asserts `status` and `saved_count` UNCHANGED through the heal, and that pair of lines is
> the whole guard.
>
> **Three things this file said about the compensation are edited, and only one of them is a
> rename.** §6.5's `saved_count`-is-not-an-oracle bullet is a live declaration and is edited in
> place (`failGenerationSession` → `retireGenerationSession`, plus what the checked write now
> means). §6.6's impl-review-F3 paragraph is a **dated snapshot** and takes a **dated correction**
> that keeps its conclusion: the route it described is closed, the index predicate must still not
> be dropped, and a THIRD row shape now makes the index's _first_ predicate load-bearing too.
> §6.6's Phase-2 (Risk #2) entry gains the dated coverage note. The applied migration's header
> carries the same stale claim and is **deliberately not edited** — amending a pushed migration is
> a drift class the C10X-29 gate is blind to by construction.
>
> Suite **430 → 434, 36 files** (+4, all in `tests/generation/generate.test.ts`). Five breakage
> runs, of which **one came back GREEN** and **one falsified its own prediction** — both recorded
> as observed rather than rounded, and the second produced a boundary worth carrying: the
> confirm-before-fall-through step asserts a row was MATCHED, never that the key is GONE. Evidence:
> `context/changes/bug-generation-compensation-swallowed/verification.md` (after archiving:
> `context/archive/<date>-bug-generation-compensation-swallowed/verification.md`).
>
> Previously: 2026-08-09 (C10X-46 `e2e-harness-journeys` — **§3 Phase 6 is `complete`**, the
> first rollout phase to close since C10X-30 and the first new test LAYER since C10X-31's eval).
> **No §2 risk row moves**, and that is the claim to read first: a browser journey introduces no
> new failure scenario. What it adds is an execution path nothing else in this project can reach —
> `tests/middleware.test.ts` has driven the real `PROTECTED_ROUTES` on both branches since
> C10X-27, and the Container API mounts `NOOP_MIDDLEWARE_FN` and renders only
> `routeType: "endpoint"`, so **whether the middleware is MOUNTED at all had no witness anywhere**
> until a real navigation supplied one.
>
> **The layer is wired and still never a gate, and holding both is the point.** `npm run e2e`
> starts and owns its dev server, refuses a non-local `SUPABASE_URL` at **config-module
> evaluation** — strictly earlier than `globalSetup`, because Playwright starts `webServer` in
> plugin setup first, an ordering fact that moved the whole design — mints its own session through
> the real sign-in form, and removes its rows in a teardown project whatever the outcome. There is
> no CI job, no schedule, and nothing may declare one in `needs:`. §5's row carried a trap written
> for exactly this day (`never a gate` must not soften into `required — wired by §3 Phase 6`); the
> day arrived and the row survived it.
>
> **Two things this phase measured that nobody had budgeted for.** The layer was **flaky**: ten
> runs gave six green and four red, every red on a cold Vite dependency cache, reproduced
> deliberately twice — Vite rewrites `deps_ssr/` under a new hash while Astro compiles routes on
> demand, so requests in flight answer 500 and reach a spec as `element(s) not found`. Fixed by
> `workers: 1` at **11 of 11** green on cold caches; a route warm-up was written first and
> **deleted**, because measured against serialised requests it bought nothing. And **Phases 2-4
> had recorded no breakage evidence at all**, so eight criteria were re-executed today rather than
> cited — three of their predictions did not survive contact, including two neuters that prevent
> the run from starting and therefore prove nothing about anything.
>
> §6 gains **§6.11**; §7's three e2e-keyed sites were each checked and each **stands**, with the
> absence of an edit recorded so nobody hunts for one — including the nested `scroll-padding-top`
> deferral, which named this phase as its owner and is **declined on the merits**, dated at the
> site. `roadmap.md` gains **H-12** and one half-false claim corrected on its e2e half only.
>
> Previously: 2026-08-05 (`test-plan-refresh-2026-08-05` — a REFRESH, not a §3 rollout phase,
> and not a change to any product code). **No risk row moves, no coverage claim widens, and no
> test changed — so no suite figure in this file is restated.** What changes is that a Playwright
> harness now exists, that it landed **outside** the phased rollout (the C10X-39/40/42/43 pattern
> for the fifth time), and that **§4, §5 and §7** each asserted something about e2e which is false
> on this date, while **§8** carried the same mis-keyed trigger — enumerated rather than counted,
> because a total and its breakdown are two claims and this ledger has caught itself on that three
> times. The §8 clause is listed separately on purpose: this refresh's own correction block defends
> it as the accurate statement of its trigger, so folding it into "false" would collapse the
> mis-keyed/false distinction the rest of this entry turns on. §6.6 is deliberately not in that
> list: its figures were correct when they were measured, so they take a correction block instead.
> §3 gains a **Phase 6** row as `not started`, and the nine measured harness
> findings are handed to it **with verdicts** in its sequencing note, so the phase's own research
> starts from them rather than re-deriving them.
>
> **The number that moved is the one nobody was watching.** `npm run typecheck` reports
> `Result (135 files)` against the `133` two documents carried, and the delta is exactly
> `playwright.config.ts` and `tests/e2e/seed.spec.ts`, both resolved as project members by
> `npx tsc --showConfig`. So **the e2e layer has sat inside the type gate — in CI and on
> `pre-push` — since the day it landed, and no document knew it.** Nothing went red because the
> gate asserts on a **floor** rather than on a pinned count, which is correct design and also why
> the change announced itself nowhere. `README.md` now states that scope with **no total at all**,
> because a live claim pinned to a count measured at 133, 135, 136 and 135 again inside four days
> re-rots by construction; §6.6's dated C10X-43 row keeps its `133` / `115` and takes a correction block
> beneath it. The gate says the e2e layer **compiles**, never that anything runs it.
>
> **§7's re-evaluation triggers were MIS-KEYED, not fired**, and that distinction is the whole of
> what §7 changed. Three exclusions took a dated re-decision; the trigger sentence itself —
> "re-evaluate the moment any §3 phase wires e2e" — sat at three sites, two of them in §7 and one
> in §8. No §3 phase ever did. Each exclusion is re-decided on the merits and **stands** — a
> browser runner is not a computed-style oracle, this project carries no visual-diff tool at any
> layer, and one exemplar spec covers one flow rather than the class — with the condition
> **restated rather than deleted**, so it now points at something reachable. **Claiming is not
> wiring**, and the three sections say so in one voice: §3 Phase 6 claims the layer, §4's row
> states what the harness cannot do (no npm script, no CI job, no browser-install step, no
> `webServer`, no preflight), and §5's new row makes e2e **never a gate** — nothing may ever
> declare it in `needs:`.
>
> Read the four deferrals as decisions rather than omissions: `.gitignore`'s remaining artifact
> classes (latent under the default reporter), a §6.11 "adding an e2e test" subsection, and the
> ids **H-12** / **C10X-46** — all owned by the phase this refresh adds (the Jira half of that
> deferral was re-decided on 2026-08-06; §8 carries the correction). The known cost is written
> into §8 rather than discovered at archive time: this refresh carries **no roadmap row of its
> own** and needs the same backfill H-04/H-07/H-08 needed.
>
> Previously: 2026-08-03 (C10X-43 `typecheck-gate` — not a §3 rollout phase). **No risk row
> moves and no coverage claim widens. What changes is §5's gate set, for the first time since
> C10X-29, and the question it answers is embarrassingly basic: does anything in this project
> compile what it ships?** Until this date, nothing did. `npm run lint` is ESLint with
> type-AWARE RULES, which is not `tsc` diagnostics; `astro build` does not run `astro check`; and
> `npm test` deliberately never collects `evals/**`. C10X-41 measured the cost rather than arguing
> it — reverting to `b015662` makes `tsc --noEmit` exit **2** on a single `TS2353`, so Risk #7's
> only acceptance instrument sat **uncompilable** behind two fully green phases.
>
> **The gate does not trust either checker's exit code, and that is the whole design.**
> `astro check` exits **0** when its own tooling is missing, printing `[ERROR]` on the way out —
> proved with a positive control, and verbatim the `lessons.md` class "a command that always exits
> 0 is not a gate", one vendor over. It is also **blind to a malformed `tsconfig.json`**: a typo'd
> `strctNullChecks` makes `tsc` exit 2 with `TS5025` while `astro check` reports `0 errors` over
> the whole project it is now checking loosely. So `npm run typecheck` runs `astro sync` →
> `tsc --noEmit` → `astro check`, short-circuits on the first, and asserts on the
> `Result (N files):` line against a **floor** rather than on `$?`. Fail-closed in CI, with the
> corollary in the step's own comment because the same job ships the opposite: **unlike the Kong
> step, a green `ci` job DOES imply this step passed.** Locally it is `pre-push`, not
> `pre-commit` — ~12 s per commit is a standing incentive to reach for `--no-verify`, which two
> rule files forbid absolutely.
>
> **Two findings nobody had budgeted for.** husky had **never been installed in this tree** — no
> `prepare` script, so `.husky/_` was absent and `core.hooksPath` unset in every scope, surviving
> every `npm ci` indefinitely; AGENTS.md's "commits auto-fix" was therefore false, and is
> corrected. And enabling it would have pointed `lint-staged`'s `prettier --write` at every staged
> `*.md` — including the archive, the moment this very phase appended a correction line to it.
> Closed by a `.prettierignore` carrying `context/archive/**`, so "the archive is immutable" is a
> property of the tooling rather than of a reviewer's attention; the stated consequence is that
> **`npm run format` no longer touches the archive**.
>
> `noUncheckedIndexedAccess` is on, 33 diagnostics across 13 files swept in ONE commit (the lint
> config makes every intermediate state red), **zero** of them a latent defect — the flag's value
> is prospective and its justification is C10X-41's F3, reproduced as a pair. Suite **364/364, 31
> files**; the only growth is the gate's own pure half, because `scripts/run-typecheck.ts` gets no
> test by the same boundary the C10X-29 entry draws for the drift runner. **Two CI criteria are
> ship-time, by decision and not by omission**: `ci.yml` runs nothing on a branch with no PR, the
> trap this file records against C10X-39. Read §6.6's C10X-43 entry before citing this as
> coverage — the gate proves the project COMPILES, never that anything RAN.
>
> Previously: 2026-08-02 (C10X-42 `eval-ci-dispatch` — not a §3 rollout phase). **No risk row
> moves and no coverage claim widens: what changes is WHERE the Risk #7 instrument can be run
> from.** `npm run eval` had been local-only since C10X-31 shipped it, by a deliberate deferral
> rather than an oversight; `.github/workflows/eval.yml` now runs the same command on
> `workflow_dispatch` against the real provider, so the project's only check that reaches the real
> AI provider stops depending on one machine holding a key.
>
> **The word that did NOT change is the one worth reading twice.** Five targets in this file say
> "human-triggered", and every one of them is still true — `workflow_dispatch` **is**
> human-triggered. What went false is "local only" / "no CI leg", and the two are edited on
> opposite rules: a live claim (§2's Risk #7 row, §4's Stack row, §5's gate row and the paragraph
> under it, §3's Phase 5 note where it states the current situation) is **edited**; a historical
> entry (§6.6's C10X-31 and C10X-41 does-NOT-prove bullets, §8's two ledger entries, this header's
> own C10X-31 summary below, and §3's Phase 5 note _again_ where it narrates what C10X-31 and
> C10X-41 did) takes a **dated correction line and is not rewritten** — the C10X-30 "4xx"
> precedent this file states four times. That is **eleven** locations across ten places: the
> Phase 5 note is counted in both classes because it carries both kinds of sentence. One of those
> eleven was re-checked and left deliberately untouched, with the absence of an edit recorded as
> its own note, because a reader working the doc-sync list would otherwise hunt for a correction
> that should not exist.
>
> Three boundaries belong in the same breath as the headline. There is still **no `schedule:`** and
> there must never be a `needs:` — a red run here is a real generation defect, not a hygiene
> failure, and `npm run eval` exits 1 by design (C10X-31's first calibrated run was honestly red).
> The blast-radius cap is a **separate** OpenRouter key with a low per-key credit limit, and it
> buys spend isolation only — OpenRouter governs rate limits per account, globally. And `evals/`
> still sits under **no type gate** (C10X-43), so a type error there still surfaces only at run
> time, now after paid calls in CI rather than on a developer's machine. The eval also gained a
> report sink on every run (local and CI alike, one code path, `.log` so `.gitignore:20` already
> covers it), and `resolveJudgeModel()` stopped reading an empty `EVAL_JUDGE_MODEL` as a chosen
> model — which would have made the DEFAULT dispatch the broken one. `no-console` warnings in
> `evals/generation-quality.eval.ts` went **6 → 3** as a side effect of composing the report, so
> the standing "6 pre-existing warnings" figure throughout §8 is stale from this date. Suite
> **345/345, 30 files** — unchanged by this change, and correctly so: nothing here is assertable
> from any test layer this project has, exactly as §6.6's C10X-29 entry records for the drift
> runner. It is **345 and not the 342 §8 has carried since C10X-40**, which was that entry's
> pre-impl-review figure and is corrected there by a run rather than by arithmetic — the very
> defect that entry itself catches against C10X-39. Ship-time evidence is **complete, not
> deferred**: registration proved as a before/after pair, a green dispatch (`30756678180`,
> 11/11 cases at 5/5 language fidelity, 2m03s), a controlled red (`30756592782`, `400` on a bogus
> model), and the re-run that settles artifact immutability — which **falsified half of its own
> premise** and is the one line here worth reading twice. A re-run **deletes the previous
> attempt's artifacts**, so "both attempts remain downloadable" is false and the standard
> calibration re-run must be a NEW dispatch, never `gh run rerun`. The phase also found a real
> defect that no earlier check could see: the stored secret carried a **BOM**, which
> `gh secret list` is structurally blind to — exactly the claim Phase 3 deferred to here.
> Evidence:
> `context/changes/eval-ci-dispatch/verification.md` (after archiving:
> `context/archive/<date>-eval-ci-dispatch/verification.md`).
>
> > **Corrected 2026-08-03 (C10X-43), one boundary of the three.** "`evals/` still sits under **no
> > type gate**, so a type error there still surfaces only at run time, now after paid calls in CI"
> > was true when written and is not now: `npm run typecheck` covers `evals/` like every other
> > directory, in CI on every push and PR to `main` and on `pre-push` locally. The entry is left
> > standing as the record of the exposure C10X-42 correctly named and deliberately did not fix.
> > The other two boundaries in that sentence's paragraph — no `schedule:`, and a separate key
> > buying spend isolation only — are untouched. And the reason this correction is narrow is the
> > half that did NOT move: a type gate cannot see a **collection-time** error, so `eval.yml`'s own
> > cause #2 keeps its place and only its parenthetical changed.
>
> Previously: 2026-08-01, second entry of the day (C10X-40 `deck-error-param-guard` — not a §3
> rollout phase). **No risk row moves.** It began as an AUDIT of a claim this file already made —
> that C10X-37 had closed the `?error=` read side — and the audit's verdict is that the claim is
> TRUE: 5/5 reads wrapped, an 11-against-11 producer diff with nothing missing in either
> direction, 43 cases across the five guard files. What it also found is that the GUARDS holding
> that claim were keyed on spellings rather than on constructs, so ordinary refactors disarmed
> them while everything stayed green — the same "correct on what it looks at, silent about what it
> never looks at" shape this file has now recorded four times.
>
> Three were measured, not argued. **The closed set was enforced at almost no producer**: the
> detector fires only on a literal adjacent to the text `error=`, and 20 of the 29 emissions go
> through an `errorUrl(msg)` helper whose call sites carry no such text — so
> `errorUrl("Nowy komunikat")` and `errorUrl(err.message)` both passed the whole suite. **The page
> guard was keyed on the token `searchParams`**, so hoisting `const params = Astro.url.searchParams`
> — the natural tidy-up on pages that read five parameters — produced zero findings. **Its
> catch-all was rooted at `src/pages`**, leaving seven `.astro` files unscanned including
> `Layout.astro`, where a raw read would banner every page in the app. Each now goes red, proved by
> a breakage run rather than by reading.
>
> Two smaller corrections of this file's own claims, both in the reassuring direction. Two "no row
> oracle possible" CREATE cases DO have one (the JSON body and the `File` part each submit a usable
> name), and the blanket claim was the expensive half because it told the next reader not to look.
> And **`?q=` was audited as the same class and deliberately NOT given a vouching set**: the
> reflection lives only on `/decks/<publicId>`, which 404s for a deck the caller does not own, so an
> attack needs the victim's deck UUID — where `?error=` needed only `/decks`. It got a length clamp
> as hygiene and a written decision so it stops being rediscovered. Suite **342/342, 30 files**
> (+9/+1); six breakage runs, six verified restores. Evidence:
> `context/changes/deck-error-param-guard/research.md` (after archiving:
> `context/archive/<date>-deck-error-param-guard/research.md`) and, for the review's own runs,
> `reviews/impl-review.md` in the same folder. **The pointer is to `research.md` rather than to a
> `verification.md` because this change has neither that file nor a `plan.md`** — it ran straight
> from research on an explicit instruction, which is a deliberate deviation from the
> `/10x-plan → /10x-implement → /10x-impl-review` loop and is recorded as such in its `change.md`.
> Consequence a reader should not have to infer: the six breakage runs are summarised one line each
> rather than carried with their observed failure strings, denominators and restore hashes, so this
> file's usual "re-run it before citing the split" applies with more than usual force.
> Suite **343/343** after the impl-review's fixes (+1: the `?q=` clamp's surrogate case).
>
> Previously: 2026-08-01 (C10X-39 `local-stack-transport-flake` shipped — not a §3 rollout
> phase). **No risk row moves and no coverage claim changes: the subject is the HARNESS's own
> trustworthiness.** Two things make it worth reading. A mechanism this file asserted in two
> places was measured and found **false** — Kong does not hold keep-alive sockets longer than
> PostgREST; **both idle out at 60 s**, which is the pathological case rather than a fixable
> ordering, and the drops cluster in a burst's first 1-2 s rather than on the first request after
> the gap. And the residual risk C10X-32's impl-review left open — a retried write that had in
> fact committed passing **silently** — is closed by experiment rather than by reading.
>
> The experiment is the reusable part. Instead of re-reading the suite for unguarded inserts, the
> `fetch` wrapper was temporarily neutered so **every local non-`GET` request replays once**, and
> the suite was asked which assertion notices. Answer: **six** silent seams, not the two the
> wrapper's header disclosed — with 23 of 29 files not noticing a thing — and three seams that
> look silent are not, for reasons worth carrying (`deck` 64/64 `409` by constraint, a keyed
> `succeeded` session 5/5 `409` by the idempotency index, `ensureSchedule` safe by upsert). Each
> of the six now carries a case-scoped count of one, written **test-first** so the duplicate
> existed before the oracle did; the re-run census reports **zero**. The suite count does not
> move for any of it — six oracles inside existing helpers, no new `it()` — and an unchanged
> number here is correct rather than suspicious.
>
> The cause is also removed locally, and the honest boundary is in the same sentence. An
> **unsupported** post-`supabase start` recreation of the Kong container at
> `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` measured **0 drops across 40 spaced runs** against **20
> drops across 23 spaced runs** on two same-day controls — but it is per-machine, wiped by every
> `npx supabase stop`, and CI carries it as parity, not necessity (`continue-on-error`, so a
> green job no longer implies the step passed). So the wrapper stays. Two controls an hour apart
> differ by **sevenfold**, which is recorded as a finding rather than averaged away. Suite
> **333/333, 29 files** (+19/+1, all of it the new pure-half test; recorded as 332/+18 until
> 2026-08-01, when C10X-40 measured the file at **19** cases — the impl-review's own additions were
> counted at the pre-review figure). Evidence:
> `context/archive/2026-08-01-local-stack-transport-flake/verification.md`.
>
> Previously: 2026-07-31, third entry of the day (C10X-37 `deck-form-hardening` shipped — not
> a §3 rollout phase). **No risk row moves, and Risk #6 gains a third dated half.** What makes
> this entry worth reading is not the coverage but the bookkeeping it closes: it is the first
> change in this file whose entire scope was **two items other changes' impl-reviews had
> deferred**, one of which had an owner (C10X-30 F1 → C10X-37) and one of which was believed to
> have **no ticket at all** (C10X-34 F1, whose follow-up note said "to be ticketed, no key yet").
> The second shipped under the first's key by an explicit, written-down scope decision — because
> "a fix that landed under a foreign key" is the confusion C10X-34 was itself written to untangle,
> and repeating it silently would have been the same defect one surface over.
>
> > **Corrected 2026-08-01 (C10X-40).** The belief was already false when this entry was written,
> > and the correction reached `change.md` and `jira-map.md` but not this file, in four places (see
> > also the C10X-37 §6.6 entry and the two §8 entries). C10X-34 F1 **does** have a key —
> > **C10X-40** — minted by `/jira-backlog-sync` on 2026-07-31, the same day the follow-up note
> > claiming otherwise was written. What was true is narrower and is the durable lesson: the
> > _review's own note_ is not the source of truth about a deferred finding's key; `jira-map.md` is
> > (`jira-map.md:204-219`). A reader of this file would otherwise conclude C10X-40 does not
> > exist — which is exactly how a closed finding gets rediscovered and re-implemented.
>
> The two halves are one mechanism, which is why they are one change: a closed set of
> project-owned messages (`src/lib/redirect-errors.ts`, eleven members) that the producers emit
> and the consumers vouch for. The enumeration behind it is the step C10X-34's review named as
> the prerequisite and did not take — **no `.message`, `String(err)` or `JSON.stringify` on any
> deck-route REDIRECT branch** (the looser "any deck-route branch" was measured false by the same
> change's own read-back: `cards/batch.ts:45` does serialise a JSON response body, on a channel
> this set deliberately excludes) — so the set is closed by construction and the fix is
> `ownedAuthMessage`'s shape rather than a redesign. **Closed by construction is not closed by a
> test**, and as of 2026-08-01 (C10X-40) it is the latter too: `tests/lib/form-endpoint-guards.test.ts`
> resolves every value entering the channel and demands POSITIVE evidence that it is a set member.
> **That sentence overstated the guard for one day and is corrected here rather than rewritten**
> (C10X-40 impl-review F1, 2026-08-01): "is a set member" was checked, for a local, by asking
> whether its declaration MENTIONED one — so `error.code === "23505" ? OWNED : error.message`, an
> `|| OWNED` fallback and an `OWNED + String(err)` concatenation were all accepted, and an upstream
> string could reach `?error=` with the suite green. Proved a PAIR rather than argued: relaying
> `error.message` through the shipped ternary at `decks/[publicId].ts:75` leaves the guard as it
> stood **10/10 green**, and turns the tightened one **1 of 10 red** naming file and line. The
> residue check (`computedResidue`) now requires what is left after the set members are struck out
> to be inert; the comparison is stripped first, because a discriminator's own operand is a member
> access and testing before that would reject both locals this repo actually ships. One sink turned out to be worse than the review recorded: the
> deck page rendered the raw value in **`.astro` markup**, needing no companion parameter and
> carrying no `role="alert"`, so a bare `/decks/<id>?error=X` reached it and no change to
> `ServerError.tsx` could ever have covered it.
>
> Two things about the evidence rather than the coverage. **The breakage pair separated the
> layers in both directions** — run 1 (endpoint comparison decoupled) turns 3 of 16 red **on the
> message**, with the count and row oracles _passing_, and that pass is the evidence that the DB
> CHECK absorbed the write; run 2 (same edit plus the CHECK dropped) turns the same three red **on
> their oracles**, plus the DB-layer case. Different failure strings for the same cases is what
> §6.10's assertion order exists to produce. And **one gap is stated rather than hidden**: the
> nameless CREATE refusals carry no row oracle at all — `deck` has no containing column and there
> is no name to mark — so under run 1 those cases attribute nothing to either layer. Their rename
> twins are where the same refusals get a real oracle, which is why every nameless case runs
> through both endpoints. Suite **298/298, 26 files**; five breakage runs, five verified restores,
> the constraint probed **behaviourally** as well as by `diff`. Evidence:
> `context/archive/2026-07-31-deck-form-hardening/verification.md` (the path here read
> `context/changes/…` until 2026-08-01 and no longer resolved — the pointer rot this file's §8
> keeps recording in other people's documents).
>
> > **Two of the nameless CREATE refusals above got a row oracle on 2026-08-01 (C10X-40), and the
> > sentence claiming they could not is corrected at the site** (`tests/validation/decks.test.ts`).
> > The non-form JSON body and the `File` part each submit a perfectly usable name — merely
> > somewhere the endpoint must never look — so a marker-scoped count IS falsifiable there, and a
> > breakage that reads the `File`'s text turns it red on `expected 1 to be +0`. Four cases remain
> > genuinely oracle-less (missing / empty / whitespace-only / broken-form), and for those the
> > paragraph above stands unchanged.
>
> Previously: 2026-07-31, second entry of the day (C10X-41 `forced-language-prompt-fix`
> shipped — not a §3 rollout phase). **No risk row moves, and that is the point worth reading:
> the AI-native layer this file added at §3 Phase 5 has now completed its loop.** C10X-31's first
> calibrated run found a real generation defect and recorded it; C10X-41 fixed it and used the
> same instrument as the acceptance check. `forced/de` and `forced/fr` went from **0/5 cards in
> the target language, four runs of four**, to **5/5 in both** acceptance runs.
>
> The class is the reusable part, and it now has a `lessons.md` rule. One value — `LANGUAGES` —
> served three roles at once: the API's Zod enum, the `generation_session.language` audit column,
> and the token interpolated into the English system prompt. A value chosen for a machine reader
> is not a value a model must understand, so the prompt said `… : niemiecki.` and the model
> answered in Polish. Three things made the defect nasty: it is **silent** (valid JSON, right card
> count, HTTP 200 — the user just gets cards they will reject, straight onto the PRD's 75%
> metric), it is **partial** (`polski`/`angielski` passed through the identical code, so "forced
> language is broken" was never true), and **no deterministic layer can see it** — the response
> contract is intact, so only an LLM-judge eval can go red.
>
> Two things about the evidence rather than the coverage. The matrix gained
> **`forced/fr-on-en`** — French forced over the ENGLISH reference text — because every other
> forced case runs on the PL source, where a green is compatible with "the model just followed
> the source language"; it is 5/5 twice, and it is the strongest single piece of evidence that
> the interpolated NAME is what decides the output language. And a **gap was measured rather than
> noticed**: reverting to `b015662` shows `npx tsc --noEmit` exits **2** on the eval alone
> (`TS2353`, `language` vs `targetLanguage`) — so the acceptance instrument for Risk #7 sat
> uncompilable for two phases behind a fully green `lint` + `build` + `npm test`, because none of
> the three is a type-check over `evals/`. Recorded, not fixed. Suite **262/262, 23 files**; eval
> **11/11 twice**, both exit 0. Evidence:
> `context/archive/2026-07-31-forced-language-prompt-fix/verification.md`.
>
> > **Corrected 2026-08-03 (C10X-43).** "Recorded, not fixed" is now closed: `npm run typecheck`
> > exists, runs in CI and on `pre-push`, and the class this measurement names — a type error
> > behind a fully green `lint` + `build` + `npm test` — cannot recur silently. Everything else in
> > the paragraph stands, including the sentence that matters most: **none of those three is a
> > type-check over `evals/`**, which was the finding and is still an accurate description of
> > those three commands. What changed is that a FOURTH command now exists.
>
> Previously: 2026-07-31 (C10X-34 `auth-error-copy` shipped — roadmap H-03, not a §3 rollout
> phase). **No risk row moves.** What it adds is the READ end of a channel this file only ever
> pinned at the write end, the first automated coverage of the OpenRouter banner gate, and — the
> reason to read it even if auth is not your concern — the correction of five comments and one
> denominator that contradicted the code they explained.
>
> The framing is the finding. The work this ticket named was **already on `main`**, shipped as
> side work under a foreign key (C10X-28's Phase 1 and Phase 4 §1, every commit scoped
> `(C10X-28)`), and the audit of what lands "along the way" is where the edges were: the mapper
> answered its single most common ordinary error — a blank e-mail on sign-up — with the
> catch-all, while the constant written for that case was **dead by construction**; `AUTH_MESSAGES`
> was enforced where messages are produced and ignored where they are consumed, so a crafted
> `?error=` link rendered attacker-chosen text inside this project's own red banner; the banner
> gate had **zero** automated coverage of a decision that is self-hiding when it regresses; and
> `confirm-email.astro` carried the only `import.meta.env` in all of `src/`, against a hard
> AGENTS.md rule and with a heuristic that lies under a production build.
>
> Two things about the evidence rather than the coverage. **Two assertions were unfalsifiable and
> are now killable** — a case titled "on `name` alone" fed a `status` that reached the same
> constant through a different rung (deleting the production entry left the file **0 of 50 red**;
> after one input changed, **1 of 50**), and `signup.ts`'s malformed-body discriminator was half
> tested while signin's twin was covered on both branches. And **two comments were corrected by
> measurement, not by reading**: breakage check B proved the distinctness case is blind to a
> repointed map key (it stayed green while the mapping row went red), and the mapper's truthiness
> branch proves the non-emptiness scan cannot kill a `→ ""` mutant — the closed-set assertion is
> what does. Suite **254/254, 21 files**; Stryker on the mapper **92.98%**, four survivors, all
> confirmed equivalent **by execution**, no assertion added. Evidence:
> `context/archive/2026-07-30-auth-error-copy/verification.md`.
>
> Previously: 2026-07-30 (C10X-32 `flashcards-test-order` shipped). **The suite is now
> order-independent and shuffled by default** — `sequence: { shuffle: true }` is on
> permanently in BOTH runners, seed un-pinned, so an inter-`it()` dependence fails loudly
> instead of hiding behind declaration order. No risk row moves and no coverage claim
> changes: this is about whether the existing claims are _trustworthy_, not about what they
> cover.
>
> What it found and what it fixed. Six order-dependent case-pairs across three files, all
> one shape — a positive control mutating the shared `beforeAll` fixture that the denials
> beside it assert a file-scope constant against (plus one fixture-less aggregate, the
> `srs_state = 3` canary, whose `length > 0` control held only because siblings had run
> first). Four confirmed by execution, **two latent** — visible only to static analysis, so
> "shuffle until green" would have under-counted them. Four edits, no assertion weakened:
> every mutating control now owns the row it mutates. The rule is in **§6.2**, together
> with the replay procedure (`npx vitest run --sequence.seed=<n>`). One thing surfaced that
> is NOT this change's: a local-stack transport flake (Kong keep-alive → PostgREST `502`),
> measured at the **same rate with shuffle off**, now absorbed by a narrow `fetch` wrapper
> with a positive control proving it fired (22 absorbed drops across a 0/40-red matrix), and
> whose predicate the impl-review then made assertable rather than only argued.
> Suite: **228/228, 19 files** (220/220, 18 at phase completion), green across 40 fresh permutations; the eval's failure set
> under shuffle equals its C10X-31 baseline (forced `niemiecki`/`francuski`, still red, still
> out of scope). Evidence: `context/archive/2026-07-29-flashcards-test-order/verification.md`.
>
> Previously: 2026-07-29 (C10X-31 `ai-candidate-generation-test-3` shipped). **§3 Phase 5
> is `complete` and Risk #7 is covered as far as a proxy can cover it** — the project's
> first LLM-as-judge eval exists, ran against the real provider, and its very first
> calibrated run found a REAL generation defect, which is the eval doing its job rather
> than failing at it.
>
> What the slice built, and the boundary it states in the same breath. A separate run
> path — `npm run eval` (= `vitest run -c vitest.eval.config.ts`, key in the SHELL env
> only) — drives the production `generateCandidates()` through a 10-case language matrix
> (5× `auto`, 5× forced) and grades every card with `google/gemini-2.5-flash`, a
> different model family from the generator's `openai/gpt-4o-mini`, so the generator
> never grades itself. `npm test` collects ZERO eval files — exclusion is structural, by
> `include` replacement, with `vitest.config.ts` and `tests/setup/preflight.ts`
> byte-identical — and the eval's own preflight is the INVERSE of the main one: it fails
> when the key is ABSENT, because mock mode returns fixed Polish strings and a PL
> fidelity case would pass vacuously. The first recorded run: `auto` flawless (25/25
> cards in the source language), but the FORCED path answers in Polish for
> `niemiecki`/`francuski` (0/5, four of four runs) — the Polish exonym inside an English
> prompt sentence reads as more Polish context. Fixing the prompt is out of scope by
> plan; raised as a follow-up. First-ever measurements of the two dormant metrics: count
> compliance 100%, skip-rate 0%. The judge does NOT measure the 75% acceptance rate —
> only real users produce that — and the CI/workflow leg is deliberately deferred
> (local-only, human-triggered; §5). The ordinary suite gained the success-path
> audit-columns case C10X-28's hand-off named. Suite: **220/220, 18 files**.
> Evidence: `context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md`.
>
> > **Corrected 2026-08-02 (C10X-42), one word of it.** "The CI/workflow leg is deliberately
> > deferred (local-only, human-triggered; §5)" was the accurate statement of C10X-31's decision
> > and is left standing as that record. The leg has since landed
> > (`.github/workflows/eval.yml`), so **"local-only" is retired**; "deferred" describes what
> > C10X-31 chose, and "human-triggered" is as true as it ever was. This correction sits here
> > rather than in the summary above because this is the FIRST thing a reader of this file meets,
> > and a stale "no CI" claim in the opening block is how a closed follow-up gets rediscovered.
>
> Previously: 2026-07-28, second entry of the day (C10X-30 `server-side-validation-test`
> shipped). **§3 Phase 2 is `complete` and Risk #6 is covered on the server side** — the
> card-content half that C10X-28 named as the single thing between this phase and `complete`
> now has its test, so the status is a dated claim rather than a standing IOU.
>
> What the slice added beyond the assertion, and the boundary it keeps. `FRONT_MAX`/`BACK_MAX`
> gained a **second, independent enforcer** — a DB CHECK (`char_length between 1 and N`) that
> closes the residual risk S-02 recorded on 2026-07-09, when the maximum lived only in app
> code — and the breakage **pair** is what separates the two layers: one run alone cannot tell
> "the endpoint caught it" from "the database caught it". Three "server trusts the client"
> defects were fixed rather than deferred on four of the **six** endpoints that read
> `formData()` — the deck-form pair was missed and still carries two of them (impl-review
> F1, see §6.6): an unguarded
> `formData()` that answered an uncontrolled framework `500`, a `File` part that crashed the
> handler on `.trim()`, and the untested `IDS_MAX` bound on `/cards/batch`. The rule this file
> did not have is now **§6.10**: the two card endpoints are native-form targets that refuse
> with a **`302`**, not a `4xx`, so a refusal and a success carry the same status and the row
> oracle is not optional. That wording — "4xx", plus a `PATCH` handler that does not exist —
> was wrong in six places and is corrected here and, as a dated correction line, in the
> archive. Auth input validation is deliberately **out**, owned by C10X-36; what landed on the
> auth routes is malformed-body handling only. Suite: **207/207, 17 files** (193/193, 16 at
> phase completion; the impl-review added 14 across 5 findings — see §8).
> Evidence: `context/archive/2026-07-28-server-side-validation-test/verification.md`.
>
> Previously: 2026-07-28 (C10X-29 `schema-drift-test` shipped). **§3 Phase 3 is
> `complete`, and Risk #5 is covered per drift CLASS rather than wholesale** — the row
> names which classes are gated, which are only detectable off the deploy path, and which
> are not covered at all, because "Risk #5 closed" would be false in both directions.
>
> What the slice built, and the boundary it states in the same breath. A `drift` job now
> sits between `ci` and `deploy` and compares the repository's migration **versions**
> against `supabase_migrations.schema_migrations`, read through the Supabase Management
> API; `deploy` gains `needs: [ci, drift]`, so an unpushed migration stops the Worker
> deploy. It is a **history oracle by deliberate choice**: the incident behind this risk
> was a `migration repair` desync over a byte-identical schema, which a DDL diff cannot
> see. The two oracles are complementary, so an on-demand `db diff` workflow covers the
> contents-side classes — **on `workflow_dispatch` only, with no schedule and no
> notification channel**, and §5 records it as human-triggered rather than as a gate.
> Drift class 8 (stale `src/db/database.types.ts`) is closed by one step in the existing
> `ci` job. Two traps are recorded rather than smoothed over: `supabase migration list`
> and `db diff` **both always exit 0**, so a gate written from the docs would have enforced
> nothing (now a `lessons.md` entry), and Phase 4's own breakage criterion does not go red
> as worded, because `db:types` overwrites the working tree before the diff runs. **No test
> in the suite touches the cloud** — the wiring is carried by recorded runs, not by an
> assertion. Suite: **178/178, 15 files** (177 when the phases closed; the impl-review added
> the twelfth comparator case, having found that two migration files sharing one version read
> as `clean` — a false green in the gate's own core claim).
> **Ship-time verification is complete, not deferred**: the gate ran green on a real push to
> `main`, and the DDL workflow — dispatchable only once it reached the default branch — was
> exercised three times, two green and one deliberately red.
> Evidence: `context/archive/2026-07-27-schema-drift-test/verification.md`.
>
> Previously: 2026-07-26, third entry of the day (C10X-28 shipped, with C10X-34 and
> C10X-30's source-text half riding along). **Risk #4 is covered; Risk #6 is half covered;
> §3 Phase 2 deliberately stays `implementing`** — the row now names the one test that
> flips it (a crafted request against the card-content endpoints) so "implementing" reads
> as a decision rather than as leftover state.
>
> What the slice proved, and what it refuses to claim. The no-leak property on
> `/api/generate` already held by construction and is now **asserted** on both failure
> branches, behind the project's first module double (`astro:env/server` only — never
> `@/lib/openrouter`, which would make the `Authorization` half unassertable); the key is
> pinned to the header by production code. The two surfaces where private data genuinely
> _did_ escape — the auth routes' verbatim relay of an upstream message into a URL, and
> `generation_session`'s four private audit columns, which had no cross-account test at
> all — are closed. The log half is a first-party guard over the whole of `src/` and
> nothing more: **no test here reads a log sink**, and dependency-emitted lines are in
> scope but unowned (§7). Three pointer-level falsehoods in this file are corrected —
> every archived-change evidence path (each verified to resolve), the S-05 Stryker range,
> and a stale anchor in a live test comment. Suite at completion: **166/166, 14 files**.
> Evidence: `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md`.
>
> Previously: 2026-07-26, second entry of the day (C10X-27 shipped — the change the
> morning's audit opened). **Phase 4 `reopened` → `complete`**: "the session loses a
> card" now has a test that advances the clock and re-enters the session, so both halves
> of Risk #3's scenario are proven. The production bug is fixed on both sides (middleware
> answers JSON callers with a 401; the client decision moved into `src/lib/http.ts`), and
> `session_size` → `p_limit`, the batch's composition, the cap's bounds and all four
> grades are covered. `enable_fuzz: false` is now **actually configured**, so §6.1's
> correction block becomes a statement of fact.
>
> Two things this entry adds that nobody had named. §6.6's four-policy neuter has
> **silently stopped working** — the dev DB outgrew PostgREST's `max_rows`, so the
> `listDueCounts` denial passes while the guard is fully disabled. And the batch's
> composition assertion observes ORDER, not the presence of the `f.id asc` tie-break:
> removing the clause leaves the suite green. Both are recorded as open gaps rather than
> smoothed over. Every count in §6.6 now comes from a run executed against the current
> files. Evidence: `context/archive/2026-07-26-srs-study-session-test/verification.md` and
> `mutation-register.md`.
>
> Previously: 2026-07-26 (C10X-27 / roadmap H-02 audit of §3 Phase 4 — the first
> entry in this file written by auditing the code instead of a shipping change, and
> the first to move a phase BACKWARDS. **Phase 4 `complete` → `reopened`**: Risk #3's
> scenario has two halves and only "writes the wrong date" was proven; "the session
> loses a card" has no test, because nothing advances the clock and re-enters a
> session. Same audit: a **production bug** on the study path (`StudySession.rate()`
> reads the signed-out 302→HTML 200 as success and silently discards ratings),
> `session_size` → `p_limit` unobserved, `Rating.Again` never on the write path, and
> **§6.1's `enable_fuzz: false` claim is false** — the app never configures it. §6.6's
> Phase-1 signed-out note was stale in both directions and is corrected; §6.7 gained
> three traps; §3's Status vocabulary gained `reopened`. Evidence:
> `context/archive/2026-07-26-srs-study-session-test/research.md`.)
>
> Previously: 2026-07-25 (roadmap S-05 `candidate-review`: Phase 5 extended
> Risk #1's surface to the first lifecycle transition and the first multi-row
> write — §6.6 extended, §6.8 added; Phase 6 landed generation idempotency, so
> **Risk #2 moved from characterized to covered** — §3, §6.5 and §6.6's Phase-2
> entry rewritten. Also: §7 negative space corrected and extended from C10X-22 —
> the `src/components/ui/` exclusion does not cover the global style layer, and
> focus-ring rendering is named as untested. No change to §2 or §3.)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excluding docs, `context/`, build output, `node_modules`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A new or changed API endpoint lets one account read or modify another account's deck or flashcards — the ownership check does not hold, RLS is bypassed, or a `publicId` from the URL is treated as authorization. Private content leaks across accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | High   | High       | interview Q1, interview Q3; PRD §Guardrails (per-account data isolation), PRD §Access Control; hot-spot dir `src/lib/` (18 commits/30d); hot-spot dir `src/pages/api/decks/[publicId]/cards/` (4 commits/30d)                          |
| 2   | A retry after a generation timeout writes a second set of candidates — the user gets duplicated cards and a duplicated generation session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Medium | High       | `context/foundation/lessons.md` (recorded tradeoff: write is not idempotent under client+server timeout with a retry button); PRD FR-018; hot-spot dir `src/lib/` (18 commits/30d)                                                     |
| 3   | The study session loses a card or writes the wrong next-review date, and cards that were never accepted enter review — the schedule stops being trustworthy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | High   | Medium     | PRD §Guardrails (spaced-repetition scheduling correctness), PRD §NFR (schedule survives across sessions), PRD US-02 acceptance criteria, PRD FR-006; roadmap S-03 (north star, next in sequence)                                       |
| 4   | Private source text or the LLM API key escapes into a log line or an error response body. **Covered 2026-07-26 (C10X-28), with a named boundary: the response-body half is pinned on both failure branches, the log half only for what `src/` itself writes. Read §6.6's C10X-28 entry before citing this as closed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | High   | Medium     | PRD §Guardrails (privacy of pasted source text), PRD §NFR (privacy); `context/foundation/lessons.md` (prod secret is separate from `.env`; missing secret silently degraded to mock mode); abuse lens (secret/PII leakage)             |
| 5   | The production schema drifts from the migration history — the deployed app writes against an un-migrated database. **Covered 2026-07-28 (C10X-29) per drift CLASS, not as one range — writing "classes 4-9 are uncovered" would be false for four of them. Gated in CI and deploy-blocking: a migration committed but never pushed; a history desync from `migration repair`; an out-of-order version skipped by `db push`. Gated in the `ci` job: a stale generated `src/db/database.types.ts`. Detectable only off the deploy path, by an on-demand DDL diff nobody is scheduled to run: a migration file amended after it was pushed; production changed by hand in Studio; `repair --status applied` on something never applied. Not covered at all: `config.toml` vs dashboard config, and seed/dictionary row drift. Read §6.6's C10X-29 entry before citing this as closed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | High   | Medium     | interview Q2 (real incident during M2L5); `context/foundation/lessons.md` ×2 (cloud migration is a step distinct from app deploy; blind `migration repair` desynced prod history); hot-spot dir `supabase/migrations/` (6 commits/30d) |
| 6   | The server trusts the client — a crafted request bypasses the source-text length limit and the card content rules that the UI enforces. **Covered on the server side, in two dated halves: source text 2026-07-26 (C10X-28), card content 2026-07-28 (C10X-30). Both LENGTH limits have exactly one definition (`SOURCE_MAX`; `FRONT_MAX`/`BACK_MAX`), and the card pair now carries a second enforcer independent of the endpoints — a DB CHECK. `/cards/batch`'s `IDS_MAX` is the exception and is asserted rather than single-sourced: the review island mirrors it as a commented copy, so the server is its only enforcer. The boundary: only the SERVER half is asserted. The three card islands mirror the constants by import but their enforcement is not tested (§7), and unlike `GeneratorForm` they carry no `maxLength`, so their over-length branch IS reachable through the browser and rests on a manual check. Read §6.6's C10X-30 entry before citing this as closed — on the card endpoints the refusal is a `302`, not a `4xx`.** **A THIRD dated half, 2026-07-31 (C10X-37): the deck-name rule on the two endpoints C10X-30's sweep missed. Same shape as the card half — one definition (`deck-limits.ts`), a second enforcer independent of the endpoints (`deck_name_check`), and a breakage PAIR that attributes a refusal to one layer or the other by making the two runs fail the SAME cases on DIFFERENT assertions. It also closes the malformed-body class on the last two of the six `formData()` readers, so `formString` now has six callers rather than four. Two boundaries stated rather than implied: the two deck islands' own 1..100 guard is untested like every other island (§7), and the CREATE side's nameless refusals (missing / empty / whitespace-only / non-form / broken-form / `File` part) carry NO row oracle at all — `deck` has no containing column to count by and there is no name to mark, so those cases rest on the `302` plus message equality and attribute nothing to either layer. Their rename twins are where the same refusals get a real oracle. Read §6.6's C10X-37 entry before citing this as closed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Medium | Medium     | PRD FR-003 (maximum source-text length), PRD FR-007; abuse lens (untrusted input, server-side validation parity); hot-spot dir `src/lib/` (18 commits/30d)                                                                             |
| 7   | Generation returns cards in the wrong language or cards that are unusable, so the acceptance rate falls below 75% and the product thesis fails. **Covered 2026-07-29 (C10X-31), as far as a proxy can cover it: a local, human-triggered LLM-as-judge eval (`npm run eval` — never part of `npm test`) proves language fidelity and usability across all six selector values against the real provider, and its first calibrated run found a real defect — the forced-language prompt path answers in Polish for `niemiecki`/`francuski` while `auto` is flawless; recorded and raised as a follow-up, not fixed here. The judge does NOT measure the 75% acceptance rate — only real users produce that. Read §6.6's C10X-31 entry before citing this as closed.** **The defect that first run found is FIXED and re-measured, 2026-07-31 (C10X-41): the prompt now interpolates a model-facing English name resolved from a `language` dictionary table instead of the Polish exonym that doubled as the API enum and the audit-column value, and the matrix — now ELEVEN cases, with `forced/fr-on-en` added so one target is neither the source language nor Polish — runs 11/11 at 5/5 language fidelity, twice. Two things do NOT move: the judge still does not measure the 75% acceptance rate, and the eval is still local and human-triggered, so this row means "exercised on that date", never "a signal is being watched". Read §6.6's C10X-41 entry, whose does-NOT-prove list includes a gap this change measured rather than closed — `tsc` is in no gate, so the acceptance instrument itself sat uncompilable for two green phases.** **A THIRD dated half, 2026-08-02 (C10X-42): the eval is no longer LOCAL — the clause "still local and human-triggered" in the half above is superseded here and nowhere else. `.github/workflows/eval.yml` runs the same `npm run eval` on `workflow_dispatch`, against the real provider, on a SEPARATE OpenRouter key carrying a low per-key credit limit, so the instrument is a capability of the project rather than of one machine: the 11-row verdict table lands in the job log and the card-by-card record in an artifact named for the run attempt. Read what does NOT move as carefully as what does. It is still **human-triggered** — that word was never the thing that changed, `workflow_dispatch` IS human-triggered — there is still no `schedule:`, nothing may ever declare it in `needs:`, and the judge still does not measure the 75% acceptance rate. So this row still means "exercised on that date", never "a signal is being watched"; what improved is who can exercise it and what survives the run. Read §6.6's C10X-42 entry before citing this as closed — its does-NOT-prove list names the red class this change actually exercised (infrastructure, not a real generation defect).** **A FOURTH dated half, 2026-08-03 (C10X-43), and it retires exactly one clause: "`tsc` is in no gate", in the second half above. It now is — `npm run typecheck` (`astro sync` → `tsc --noEmit` → `astro check`, fail-closed, asserting on the checked-file count rather than on an exit code) runs in the `ci` job on pushes and PRs to `main` — `paths-ignore` skips a markdown-only commit, which cannot carry a type error — and on `pre-push` locally, and it covers `evals/` like everything else. So the acceptance instrument for this row can no longer sit **uncompilable** behind a green branch, which is the state C10X-41 measured and left open. Read what does NOT move, because it is almost everything. The eval is still not a gate and must never become one; there is still no `schedule:`; the judge still does not measure the 75% acceptance rate; and this gate proves the eval **compiles**, never that it RAN — a type-checked eval nobody dispatches produces no verdict at all. So this row still means "exercised on that date", never "a signal is being watched". Read §6.6's C10X-43 entry before citing this as closed.** | High   | Medium     | PRD §Success Criteria (≥75% of generated cards accepted; ≥75% of cards created via generation), PRD §NFR (cards follow the source-text language: PL/EN/ES); roadmap S-05                                                               |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                        | Must challenge                                                                                                               | Context `/10x-research` must ground                                                                                          | Likely cheapest layer                                           | Anti-pattern to avoid                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| #1   | Account B is denied account A's resource on read **and** on write, while account A still reaches its own data                                                                                      | "Authenticated implies authorized"; "RLS is enabled, therefore the endpoint is safe"                                         | Session/JWT shape, where the ownership check is enforced, how a `publicId` maps to a row, which queries run under which role | integration on the endpoint + RLS exercised with JWT claims     | Testing as `postgres` (bypasses RLS); no positive control, so "zero rows" reads as isolation when the policy is simply broken |
| #2   | Two identical requests produce exactly one set of cards                                                                                                                                            | "Client timed out, therefore the server did not commit"                                                                      | Idempotency key or dedup boundary, timeout ordering, where the write transaction ends                                        | integration (two requests against one endpoint)                 | Asserting only the timeout ordering instead of the actual race                                                                |
| #3   | A card rated well-known is deferred further than a card rated hard; the schedule survives a restart; only `accepted` cards enter a session                                                         | "The session returned cards, therefore the schedule works"                                                                   | FSRS schedule columns vs the existing card `state_id`, source of "now", persistence boundary                                 | unit on rating→next-review mapping + integration on persistence | Assertion copied from the implementation (oracle problem); happy path with no restart                                         |
| #4   | Neither the error body nor the log line contains source text or the API key                                                                                                                        | "A 500 is harmless"                                                                                                          | The FR-018 error path, what is written to logs vs returned to the client                                                     | integration on the failure path                                 | Asserting the status code instead of the payload contents                                                                     |
| #5   | A drift between migration history and the deployed schema stops the pipeline **before** the app deploys                                                                                            | "Green locally means prod is migrated"                                                                                       | The CI steps, how (and whether) `db push` is wired relative to deploy                                                        | CI gate (drift check)                                           | A unit test where a gate is required                                                                                          |
| #6   | A request that bypasses the UI is refused in the caller's own convention — a `4xx` on the JSON endpoints, a `302` to an owned error URL on the native-form targets — and writes nothing either way | "Validated in the form means validated"; "the refusal has its own status" — on a redirect-style endpoint it does not (§6.10) | Where the schema validation runs, client/server parity, and which convention the endpoint answers in                         | integration on the endpoint                                     | Driving the case through the UI only, never touching the server                                                               |
| #7   | Cards come back in the source language and are usable for PL/EN/ES material                                                                                                                        | "The model returned valid JSON, therefore the cards are good"                                                                | The prompt, the response contract, the model selection                                                                       | AI-native (LLM-as-judge over a reference set)                   | Snapshotting the model response — non-deterministic, breaks without signal                                                    |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status normally moves left-to-right (`not started` →
`implementing` → `complete`); the orchestrator updates Status as artifacts
appear on disk. A fourth value, **`reopened`**, exists because a later audit can
show a `complete` phase never covered all of its risk — see Phase 4. Treat
`complete` as a dated claim, not a permanent state.

| #   | Phase name                         | Goal (one line)                                                                                   | Risks covered                                                                                                       | Test types                         | Status   | Change folder                                                                                                                                                              |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Harness + per-account isolation    | Stand up the runner and prove cross-account denial on read and write                              | #1                                                                                                                  | runner bootstrap, integration, RLS | complete | `context/archive/2026-07-15-verification-harness/`                                                                                                                         |
| 2   | Endpoint contract                  | Prove the server does not trust the client and does not leak; stop duplication on retry           | #2 (**covered** — S-05 Phase 6), #4 (**covered** — C10X-28), #6 (**covered, server side** — C10X-30, 2026-07-28)    | integration                        | complete | `context/archive/2026-07-18-ai-candidate-generation-test/` → `context/archive/2026-07-26-ai-candidate-generation-test-2/` → `context/changes/server-side-validation-test/` |
| 3   | Quality gates + schema drift       | Make green CI mean "tested and prod actually migrated"                                            | #5 (**covered** — the deploy-blocking classes and the stale generated types; C10X-29, 2026-07-28)                   | gates                              | complete | `context/changes/schema-drift-test/`                                                                                                                                       |
| 4   | SRS schedule correctness           | Prove the schedule defers by rating, survives restart, and admits only accepted cards             | #3 (**covered** — both halves; closed by C10X-27, 2026-07-26)                                                       | unit + integration                 | complete | `context/archive/2026-07-24-srs-study-session/` → `context/archive/2026-07-26-srs-study-session-test/`                                                                     |
| 5   | AI-native generation quality       | Prove cards match the source language and are usable, so the 75% thesis is measurable             | #7 (**covered as far as a proxy can be** — C10X-31, 2026-07-29; the judge does not measure the 75% acceptance rate) | LLM-as-judge                       | complete | `context/changes/ai-candidate-generation-test-3/`                                                                                                                          |
| 6   | E2E harness + two browser journeys | Close the non-local seams, then prove the guard is mounted and an accepted card survives a reload | #1 and #6 (**extending — no §2 row changes**; e2e introduces no new failure scenario)                               | e2e (Playwright), human-triggered  | complete | `context/changes/e2e-harness-journeys/`                                                                                                                                    |

Sequencing notes:

- Phase 1 corresponds to roadmap **F-03 `verification-harness`**. It reused
  that change-id rather than opening a competing one. Delivered wider than
  F-03's "one real cross-account test": decks **and** flashcards, read
  **and** write, driven through the real endpoints and gated in CI — see
  §6.6.
- Phase 2's first slice (`ai-candidate-generation-test`) landed a
  **characterization** test for Risk #2: it asserted that a retry _did_
  duplicate, because idempotency was deferred to roadmap S-05 (finding F5).
  Roadmap slice **S-05 Phase 6 landed that idempotency**, so the standing
  instruction was carried out — the assertion was inverted (2 sessions → 1),
  not deleted, and Risk #2 is now **covered**. §6.6's Phase-2 entry records
  exactly what the inverted suite does and does not prove.
  **Phase 2's second slice (`ai-candidate-generation-test-2`, C10X-28, 2026-07-26)
  covered Risk #4 and half of Risk #6**, and left the phase at `implementing` on purpose:
  the outstanding work was one named test — a crafted request against the card-content
  endpoints breaching `FRONT_MAX`/`BACK_MAX` and shown to write nothing — not a slice.
  **Phase 2's third slice (`server-side-validation-test`, C10X-30, 2026-07-28) landed it,
  and the row is now `complete`, dated.** Three things about how it landed are worth
  carrying forward, because none was visible when the work was scoped as "one test".
  First, the named test could not be written as described: the create/edit endpoints are
  **native-form targets that refuse with a `302`**, so "assert a 4xx" was wrong wording
  (as was "PATCH", which neither endpoint exports), and a refusal is indistinguishable
  from a success without a row oracle plus an **equality** assertion on the decoded
  `error` param. That rule now has its own subsection, **§6.10**. Second, C10X-28's
  reason for excluding this half — "those endpoints already share one constant with their
  islands, so they are the low-drift side of #6" — was true and still left the constants
  with **no enforcer beneath the app**, so the slice added a DB CHECK and proved the two
  layers independent with a breakage **pair** rather than a single run. Third, three
  "server trusts the client" defects (unguarded `formData()`, a `File` part crashing the
  handler, the untested `IDS_MAX` bound) were fixed here instead of being deferred a second
  time — on **four of the six** endpoints that read `formData()`. The plan's own enumeration
  said "all four form endpoints" and that was simply wrong: `decks/index.ts` and
  `decks/[publicId].ts` (deck create and rename) carry the first two defects verbatim and
  were never touched. Found by this change's impl-review (F1), deferred by decision, and
  named in the "does NOT prove" list below rather than left to be inferred from a count.
  Auth input validation was
  considered and routed out to **C10X-36**; what landed on `signin.ts`/`signup.ts` is
  malformed-body handling, not an input rule. §6.6's C10X-30 entry states what the slice
  does **not** prove — chiefly the island half, which is where §7's note now matters more
  than it did for `GeneratorForm`.
- Phase 3 shipped as **C10X-29 `schema-drift-test`** (2026-07-28), and the one decision
  worth carrying forward is what kind of oracle the gate is. It compares migration
  **versions** — the repository's filenames against the cloud's
  `supabase_migrations.schema_migrations` — and never compares **contents**. That is a
  deliberate choice, not a shortcut: the incident this risk was written from
  (`lessons.md`, "Operacje migracji Supabase") was a `migration repair` desync that left
  the deployed schema byte-identical and the history wrong, which a DDL diff cannot see at
  all. So the cheap, deploy-blocking gate is the one that covers the classes this project
  has actually lived through, and the expensive DDL diff — which covers the classes the
  history oracle is blind to — sits off the deploy path on `workflow_dispatch`. The two
  oracles are complementary, not ranked. §2's Risk #5 row states the split per class, and
  §6.6's C10X-29 entry states what the gate does **not** prove; the two are written to be
  read together and must not be allowed to drift apart.
- Phase 4 shipped inside roadmap **S-03 `srs-study-session`** (its Phase 5),
  which is where the schedule itself was built — roadmap F-03 had already
  deferred this test to S-03, so the phase reused that change folder rather
  than opening a competing one. Read §6.6 for exactly what that claim does and
  does not include, and §6.7 for how to add the next SRS test.
  **Reopened 2026-07-26** (status `complete` → `reopened`) by a full audit run
  under C10X-27 / roadmap **H-02**, change folder
  `context/archive/2026-07-26-srs-study-session-test/`. The phase's own three claims hold and
  were re-verified by execution (69/69) — what reopens it is that Risk #3's
  scenario has two halves and only one is proven. "Writes the wrong next-review
  date" is covered; "**the study session loses a card**" is not, because no test
  ever advances the clock and re-enters a session. The same audit found a
  **production bug** on this path (`StudySession.rate()` treats the signed-out
  302 → HTML 200 as success and silently discards every rating) plus three
  unobserved wires: `session_size` → `p_limit`, the RPC's `f.id` tie-break, and
  `Rating.Again`. Details and evidence in §6.6's Phase 4 audit note. This is the
  first phase in this file to move _right-to-left_: treat "complete" as a claim
  with a date on it, not a permanent state.
  **Closed again 2026-07-26** (status `reopened` → `complete`) by C10X-27 itself, the
  change that audit opened. Both halves of Risk #3's scenario now carry a test: "writes
  the wrong next-review date" as before, and "**the study session loses a card**" by a
  case that rates at a fixed `now`, then re-enters the session at the persisted `due`
  (card present, still rated) and a minute after the rating (card absent). The production
  bug is fixed on both sides — middleware answers a JSON caller with a real 401, and the
  client's ok/parse decision moved into `src/lib/http.ts` where it has its own tests —
  and the three unobserved wires are covered: `session_size` → `p_limit`, the batch's
  composition, and all four grades including the `Again` lapse. The `reopened` vocabulary
  entry above **stays**: it earned its place, and this phase's history is the reason to
  keep reading `complete` as dated.
  Two gaps are deliberately left open rather than claimed — the `f.id asc` tie-break is
  not observable by any assertion here (only the batch's order is), and §6.6's four-policy
  neuter no longer reproduces. Both are described in the Phase 4 entry of §6.6.
- Phase 5 depends on roadmap **S-05 `candidate-review`** shipping — the
  acceptance signal the judge calibrates against is produced there.
  **Shipped as C10X-31 `ai-candidate-generation-test-3` (2026-07-29), roadmap H-06** — as a
  SEPARATE run path (`npm run eval`), not a new `npm test` layer, because the mock clamp in
  preflight is load-bearing and stays byte-identical; exclusion is by collection (a second
  Vitest config with its own `include`), not by a guard. The first calibrated run was
  honestly red with a real finding — the forced-language prompt path answers in Polish for
  `niemiecki`/`francuski` while `auto` is flawless — recorded, out of scope by plan ("No
  changes to the generation path"), raised as a follow-up. §6.6's C10X-31 entry carries the
  claims table and the does-NOT-prove list; §5's LLM-as-judge row is rewritten to the
  local-only, human-triggered reality.
  **That follow-up is CLOSED as of 2026-07-31 (C10X-41)** — the prompt now interpolates a
  model-facing English name resolved from a `language` dictionary table, and the same eval is
  the acceptance check: `forced/de` and `forced/fr` at 5/5 in two runs, plus a new
  `forced/fr-on-en` case whose target is neither the source language nor Polish. The phase's
  status does not move (it was already `complete`) and neither does what the eval is: still
  local, still human-triggered, still not a measurement of the 75% acceptance rate. C10X-31's
  OTHER deferred item — the `workflow_dispatch` leg — remains open and untouched. Read §6.6's
  C10X-41 entry with this one; the matrix it describes is 11 cases, not the 10 recorded here.
  **That other item is CLOSED as of 2026-08-02 (C10X-42)** — "remains open and untouched" was
  true when written and is not now. `.github/workflows/eval.yml` runs the same `npm run eval`
  on `workflow_dispatch` against the real provider, so this phase's instrument is exercisable
  by anyone with write access rather than only on the one machine that holds a key, and the
  verdict survives the run as a job log plus an artifact instead of as a terminal scrollback.
  The phase's status does not move — it has been `complete` since C10X-31 — and, for the third
  time in this note, neither does the trigger: still human-triggered, still no `schedule:`,
  still never a gate, still not a measurement of the 75% acceptance rate. What moved is the
  LOCATION claim alone, which is why §5's row and §2's Risk #7 row are edited while every
  "human-triggered" sentence in this file survives verbatim. Two sentences ABOVE are left
  standing as the dated record of what C10X-31 and C10X-41 did, and are corrected here rather
  than rewritten: "§5's LLM-as-judge row is rewritten to the local-only, human-triggered
  reality" (that row now reads local **and** dispatchable), and "still local, still
  human-triggered" (the first half retired, the second untouched). Read §6.6's C10X-42 entry
  with this one.
- Phase 6 is `not started`, and the unusual thing about the row — the reason this note is the
  longest in the list — is that **the harness it will inherit already exists**.
  `playwright.config.ts` plus one spec under `tests/e2e/` landed 2026-08-05 (`8a12d07`,
  `5f3c87e`) **outside** the phased rollout, which is the C10X-39/40/42/43 orphan pattern one
  more time. So the phase does not start from nothing; it starts from something nobody had
  audited. It was audited on 2026-08-05 by this refresh's research, and the nine findings below
  are handed over **with verdicts** so the phase's own research starts from them rather than
  re-deriving them — and so a reader who stops here learns that the harness exists **and** that
  it is not yet trustworthy. The phase runs the full
  `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` / `/10x-e2e` chain, deliberately
  **not** as a hardening ticket: shipping it as hardening is what would repeat the orphan
  pattern rather than close it. Its ids are reserved — roadmap **H-12**, Jira **C10X-46**. The
  roadmap half is still uncreated by this refresh; the Jira half was re-decided on 2026-08-06,
  when the refresh was given a ticket of its own and took **C10X-45**, so the phase's reservation
  moved up one (§8).

  **Sub-phase 6.1 is an entry condition that blocks the rest of the phase, not a follow-up.** A
  Playwright preflight comes first. `tests/setup/preflight.ts` closes three non-local seams for
  `npm test` — local host, anon key, `OPENROUTER_API_KEY` unset — with no env opt-out (§6.4),
  and the Playwright side has **none** of them. `baseURL` is hardcoded to `localhost`, but the
  dev server reads `.env`, whose own comments document the cloud-credential swap under a `PROD_`
  prefix, and `seed.spec.ts` ends by **deleting a whole deck through the real UI**. In the
  swapped state a hand-started `npm run dev` plus `npx playwright test` creates and deletes
  decks in **production**, and nothing stops it. `SUPABASE_URL` is local today (measured), so
  this is a live **seam**, not a live incident — and it is exactly the rule `lessons.md` states
  as "Preflight musi domknąć KAŻDY nielokalny szew".

  **The six harness risks, with the verdicts measured 2026-08-05.** Four LIVE, one CLOSED, one
  LIVE and **inverted** on the axis it was written about:
  - **1 — no Playwright preflight: LIVE.** No `globalSetup`, no setup project and no env
    assertion anywhere in the 11-line config. This is 6.1 above.
  - **2 — `storageState` has no producer: LIVE, and sharpened.** The config consumes
    `playwright/.auth/user.json`; `.gitignore` ignores it and nothing writes it, so a fresh
    checkout has no such file at all. The copy that exists on one machine is hand-made, and its
    cookie NAME is derived from the `SUPABASE_URL` hostname (§6.4) — change the URL or the port
    and the cookie is simply not read, which presents as a locator timeout rather than as
    "signed out". `lessons.md`'s "Nigdy nie sklejaj ręcznie cookie sesji `@supabase/ssr`" is the
    measured rule for producing one properly.
  - **3 — no `webServer` block: LIVE.** `baseURL` is a hardcoded string and nothing asserts a
    server is up or which environment it loaded. It couples to 6.1: a preflight has little to
    assert against until the run owns the server it talks to.
  - **4 — isolation from `npm test` is incidental, not asserted: LIVE.** Vitest collects
    `tests/**/*.test.ts` and the spec is `tests/e2e/seed.spec.ts`, so the two layers are
    separated by a filename infix alone, **inside one directory**, with nothing asserting it in
    either direction — weaker than the eval, whose separation is a second config's `include`
    plus two runtime preflights that fail in opposite directions. §6.1 and §6.2 carry the trap
    note as of this refresh; the assertion belongs to the phase.
  - **5 — `test-results/` and `.playwright-cli/` unignored: CLOSED** by `5f3c87e`, which added
    exactly those two entries. Recorded as closed rather than dropped from the list, so the next
    reader does not re-open it.
  - **6 — one persistent account vs per-run accounts: LIVE, and INVERTED on the rate-limit
    axis.** The harness issues **zero auth requests per run** — the spec goes straight to
    `/decks` on `storageState` — so the 30-sign-ins / 5-min / IP limit §6.4 records is not
    exposed at all; on that axis this is cheaper than Vitest, and the price paid for it is
    risk 2's unreproducible cookie. Row growth **is** exposed: cleanup is inline test-body code
    rather than a fixture teardown, so any failure earlier in the spec orphans a deck
    permanently — on the same dev DB §6.6 already records at 1053 decks against
    `max_rows = 1000`, where growth turned an assertion unfalsifiable while it stayed green.

  **Three findings that were on no list.** `trace: "on-first-retry"` is **inert**: no `retries`
  is configured and Playwright's default is `0`, so there is never a first retry and the only
  debugging affordance the config declares can never fire. There is **no npm script and no
  browser install** — `package.json` carries no `e2e` / `test:e2e` entry and no `postinstall`,
  and `npx playwright install` appears in no **executable** surface: not `package.json`, not
  `.github/workflows/`, not `README.md` or `AGENTS.md`, not the config. Scope the claim that way
  rather than as "nowhere in the repo", which this very sentence falsifies — the phrase now has
  prose hits, this note among them, and a grep written from the looser wording would go red on
  the document making the claim. So a fresh clone has the runner and no browser binaries, and
  the only entry point is a bare `npx playwright test`. And four
  artifact classes remain unignored — `playwright-report/`, `blob-report/`, a root-level
  `.last-run.json` and `*-snapshots/` — **latent rather than live**, because the default
  reporter produces none of them today; that is why `.gitignore` is deliberately untouched by
  this refresh and closing them belongs to the phase.

  **Two scope decisions, written down so they are not rediscovered as gaps.** **Journey C — an
  SRS study session — is deliberately OUT**: Risk #3 is covered on both halves by unit +
  integration (§6.6's Phase 4 entry), so a browser adds no signal there. That is a decision,
  never a gap. And **journey B's mandate is "the guard is MOUNTED and executes on a real
  request"**, never "`PROTECTED_ROUTES` has a test": since C10X-27 `tests/middleware.test.ts`
  has driven `it.each(PROTECTED_ROUTES)` over the real imported array on both branches, and
  `lessons.md`'s Container-API rule names precisely what that cannot reach — the Container
  mounts `NOOP_MIDDLEWARE_FN`, so a middleware that stopped being mounted (file renamed, export
  dropped, adapter change) leaves those cases fully green while every protected route stands
  open in production. Scoped the old way — "the guard is uncovered" — research would specify a
  test duplicating the two `it.each` blocks that already exist.

  **Response guidance for journey A's oracle, decided at research time and open to
  re-decision.** Assert on the **deck page**, not on the review screen: a content-free count of
  `getByRole("button", { name: "Edytuj" })`, one per card — and note that **`Usuń` over-counts
  by one**, the deck-delete button in the sticky header. The review screen was rejected for two
  measured reasons: it calls `window.location.reload()` itself on the accept branch, so an
  oracle there partly asserts what the application performs for the test; and its
  acceptance-metric line **hides silently** on an aggregate error, so its presence is evidence
  while its absence proves nothing. The deck page reaches an `.astro` loader that §6.4 records
  as deliberately never rendered and that §6.6's Phase 1 entry still lists as open after
  C10X-27, one of "the two `.astro` page loaders" — which is the coverage hole this journey
  extends into. Cite that entry rather than §6.6's S-05 one, whose "manual verification alone"
  bullet is scoped to `review.astro`, i.e. the screen this paragraph has just rejected as the
  oracle. Do not assert on card **content**: §6.5 is explicit that mock output is identical on
  every call and is not an oracle.

  **SHIPPED 2026-08-09 as C10X-46 (`e2e-harness-journeys`), roadmap H-12 — the row above is
  `complete`, dated.** Everything in this note stays as written: it is the mandate the phase was
  handed, and its nine findings, two scope decisions and oracle guidance were all followed. What
  the phase adds are three things the note could not have known, and one of them would have made
  its own design late.

  **The ordering discovery, which moved the preflight out of `globalSetup` before a line of it was
  written.** `createGlobalSetupTasks` (`playwright/lib/runner/index.js:6003-6010`) orders
  `removeOutputDirs` → **plugin setup** → globalTeardowns → **globalSetups**, and plugin setup is
  what starts `webServer` (`:823-834`). So a preflight in `globalSetup` runs **after** the app
  server is already up — i.e. a `PROD_`-swapped `.env` would boot a server pointed at a cloud
  project before the guard ever spoke, which is the ordering `tests/setup/preflight.ts:71` exists
  to forbid. The only point strictly earlier is **config-module evaluation**, which is also where
  the resolved map has to live anyway, because `webServer.env` is a config field. Sub-phase 6.1's
  synchronous half therefore sits in `playwright.config.ts`'s own import graph
  (`tests/e2e/setup/env.ts`), and only the two checks that need I/O or a session — Supabase
  reachability, a live signed-in control — sit in the setup project.

  **Which of the six harness findings closed, stated per finding rather than as a count.**
  1 (no preflight) — **closed** at config time, with the two shared predicates EXTRACTED into
  `tests/setup/env-assertions.ts` rather than copied, so `npm test`'s preflight and the e2e one
  cannot drift. 2 (`storageState` had no producer) — **closed**: `tests/e2e/setup/auth.setup.ts`
  mints it by driving the real sign-in form and asserts a signed-in DOM fact before writing.
  3 (no `webServer`) — **closed**, with `reuseExistingServer` deliberately **unset**, which is what
  makes the local-host assertion binding rather than descriptive. 4 (isolation incidental) —
  **closed** by `tests/lib/e2e-isolation.test.ts`, in both directions, with two positive controls.
  5 — was already closed. 6 (one persistent account) — **decided, not closed**: change.md's D-01
  keeps the single dedicated account and answers accumulation with a teardown project instead, so
  the rate-limit inversion the note records is kept on its cheap side and the price — **the account
  carries state between runs** — is stated wherever a spec author meets it. The three findings that
  were on no list are closed too: `trace` is now `retain-on-failure` with `retries` still 0, there
  is an `npm run e2e` script, and `.gitignore` carries the four remaining artifact classes.

  **And one thing this note asserts that the phase measured as FALSE.** The note says `Usuń`
  over-counts by one and does not name `Edytuj` as ambiguous; the phase found `Edytuj` renders on
  **two** pages (`FlashcardItem.tsx:241` and `CandidateItem.tsx:287`), so journey A's count is an
  oracle only while the browser is on `/decks/<publicId>` — which is where it is asserted. Read
  §6.6's C10X-46 entry for what the layer does and, at equal length, does not prove.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer               | Tool                                                                                                                                                                                                                                          | Version                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration  | Vitest                                                                                                                                                                                                                                        | 4.1.10                                                                      | Configured through `getViteConfig()` from `astro/config` (`vitest.config.ts`), which is what resolves the `@/*` alias and `astro:env/server`. The adapter's `@cloudflare/vite-plugin` is stripped there — it fights Astro over the `ssr` environment and tests target Node; checked: 2026-07-15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| endpoint rendering  | Astro Container API                                                                                                                                                                                                                           | ships with Astro 6                                                          | `renderToResponse` with `routeType: "endpoint"` renders an API route against a real `Request`; checked: 2026-07-15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| API mocking         | one confined module double — **see §6.9**                                                                                                                                                                                                     | Vitest's own `vi.mock` / `vi.hoisted`; no mocking library                   | Only the external HTTP edge (the LLM provider) is ever doubled; the database is real via local Supabase. Exactly one file does it (`tests/generation/failure-path.test.ts`), doubling **`astro:env/server`** plus a pass-through `globalThis.fetch` to reach the 502/422 branches the harness otherwise seals. Read §6.9 before copying it; checked: 2026-07-26. Since 2026-07-30 a **second** `fetch` seam exists and is NOT a double — `tests/setup/retry-transport.ts`, a suite-wide `setupFiles` wrapper that replays Kong's keep-alive `502` and nothing else; it fabricates no response, so it is not precedent for a second double (§6.9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| database under test | Supabase CLI local stack                                                                                                                                                                                                                      | 2.98.2 (devDependency; `^2.23.4` in `package.json` is only the range floor) | Driven by `npm run db:start` / `db:stop` / `db:reset`; RLS is only meaningful against a real Postgres. CI starts the same stack and reads its URL + publishable key from `supabase status -o env`; checked: 2026-07-15. Since 2026-08-01 (C10X-39) `db:start` also chains `db:kong`, an **unsupported** post-`supabase start` recreation of the Kong container at `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0`; it is per-machine, wiped by every `npx supabase stop`, and a bare `npx supabase start` does NOT get it — so never read a green run as evidence the stack was in that state, read `.kong_env` (§6.6's C10X-39 entry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| e2e                 | Playwright, with `eslint-plugin-playwright` 2.11.0 as the layer's lint tool                                                                                                                                                                   | 1.62.1                                                                      | **A layer since 2026-08-09 (C10X-46), and still never a gate (§5).** `npm run e2e` is the entry point; it owns its own dev server (`webServer`, `reuseExistingServer` deliberately unset), refuses any non-local `SUPABASE_URL` **at config-module evaluation** — strictly before a server exists, because plugin setup precedes `globalSetup` — and runs a `setup` project that mints `playwright/.auth/user.json` through the real sign-in form plus a `teardown` project that removes the run's rows whatever the outcome. Three specs, **not one**: `seed.spec.ts`, `route-guard.spec.ts`, `accepted-card-survives-reload.spec.ts`. `workers: 1` is a measured fix, not a preference (§6.6's C10X-46 entry). **The two stale clauses this row carried until 2026-08-09 are retired**: "plus one spec" and "nothing runs it". One-off setup on a fresh checkout: `npx playwright install chromium`, which the preflight names by command when it is missing. **What the CI gates buy here, stated so it cannot be over-read**: `tests/e2e/**` sits inside `npm run typecheck` and, since C10X-46, inside `npm run lint`'s Playwright rules too — both fail-closed `ci` steps — so the layer's source **compiles and lints in CI while the layer itself never runs there**. Same shape as §6.6's C10X-43 correction: linting a file is not executing a journey; checked: 2026-08-09 |
| accessibility       | `eslint-plugin-jsx-a11y`                                                                                                                                                                                                                      | 6.10.2                                                                      | Lint-level only; PRD names baseline a11y but no risk in §2 requires an axe run yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AI-native           | LLM-as-judge over a reference set — shipped by §3 Phase 5 (C10X-31); judge `google/gemini-2.5-flash` via OpenRouter, `temperature: 0`, structured outputs, `EVAL_JUDGE_MODEL` override; CI dispatch leg added by C10X-42; checked: 2026-08-02 | judge pinned in `evals/lib/judge.ts` as a revisable constant                | **Two invocations, one code path.** Locally: `npm run eval` with `OPENROUTER_API_KEY` in the SHELL env — a `.env` key feeds only the generator's seam and the inverse preflight rejects it. In CI since 2026-08-02: the **Generation quality eval** workflow (`workflow_dispatch` only, `.github/workflows/eval.yml`), which exports the repository secret `OPENROUTER_EVAL_KEY` to the step as `OPENROUTER_API_KEY` and takes optional `judge_model` / `generator_model` inputs. Both write `eval-report.log` + `eval-summary.log`; the workflow additionally captures the console stream and uploads all three. NOT part of `npm test` in either case (collection-level exclusion via `vitest.eval.config.ts`), and never a gate — nothing may declare it in `needs:`. **When NOT to use**: any assertion a deterministic check can make (JSON shape, card count, field presence, language tag) — those live in the ordinary suite (`tests/lib/eval-scoring.test.ts`). The judge is for usability and language fidelity only                                                                                                                                                                                                                                                                                                                                                        |

**Stack grounding tools (current session):**

- Docs: Context7 (`/withastro/docs`) — checked Astro's testing guide for the current Vitest setup path (`getViteConfig()`) and the Container API endpoint-testing shape; checked: 2026-07-15
- Search: Exa.ai — available; not used, the docs MCP answered the stack question directly; checked: 2026-07-15
- Runtime/browser: claude-in-chrome — available; still not used, and **neither clause that justified that survives**.
  `no §2 risk is DOM-unreachable` is false: **Risk #6's island half is reachable only through a browser** — §7's islands
  bullet says so outright, and §6.6's C10X-30 entry measures why (the three card islands carry no `maxLength`, so their
  over-length branch is the one a user actually meets and rests on manual checks); §7's focus-ring exclusion names a
  computed style in a real browser as the only thing that catches its class. `and no phase claims e2e` is false as of
  this refresh — §3 **Phase 6** claims the layer, as `not started`; claiming is not wiring (§5). What has not changed is
  the tool: browser work in this project is still manual verification recorded per change, never automation;
  checked: 2026-08-05.
  **Dated note, 2026-08-09 (C10X-46), and the `checked:` date above is deliberately NOT bumped** —
  what moved is one clause, not this row's tooling. Phase 6 is `complete`, so "as `not started`" is
  the record of 2026-08-05 rather than the state today. The row's own subject survives untouched and
  is worth re-reading against the new layer: **`claude-in-chrome` is still not used, and an e2e layer
  is not a substitute for it.** Playwright drives Chromium; nothing in this project drives the
  developer's own browser session, and the manual browser matrices every change records are still
  manual
- Provider/platform: Supabase MCP (requires interactive auth, unavailable in headless runs), Atlassian/Jira MCP — noted for Phase 3 gate work only; GitHub Actions is the CI surface every gate in §5 must map onto; checked: 2026-07-15

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                               | Where                                                                                                                                    | Required?                                                                                                                                                                | Catches                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| lint                               | local (husky `pre-commit` → lint-staged, staged files only) + CI                                                                         | required — wired today                                                                                                                                                   | syntactic drift, rule violations                                                               |
| typecheck                          | local (husky `pre-push`, whole project) + CI (`ci` job, between `astro sync` and `lint`)                                                 | required — wired 2026-08-03 by C10X-43; before that date this row was false in **both** halves                                                                           | type drift — including in `evals/`, `tests/` and `scripts/`                                    |
| build                              | CI                                                                                                                                       | required — wired today                                                                                                                                                   | broken production build                                                                        |
| unit + integration                 | local + CI                                                                                                                               | required — wired by §3 Phase 1                                                                                                                                           | logic regressions, cross-account access, endpoint contract breaks                              |
| migration/schema drift check       | CI, `drift` job between `ci` and `deploy`                                                                                                | required — wired by §3 Phase 3 (C10X-29)                                                                                                                                 | deployed app running against an un-migrated prod schema; a history desync                      |
| generated-types check              | CI, inside the `ci` job after the local stack                                                                                            | required — wired by §3 Phase 3 (C10X-29)                                                                                                                                 | `src/db/database.types.ts` stale against the migrations that generate it                       |
| DDL diff against the cloud         | GitHub Actions, `workflow_dispatch` only                                                                                                 | optional, human-triggered — no schedule                                                                                                                                  | a migration amended after it was pushed; production edited by hand                             |
| post-edit hook                     | local (agent loop)                                                                                                                       | recommended local, not a CI substitute                                                                                                                                   | regressions at edit time                                                                       |
| prod smoke on a real flow          | between merge and "done"                                                                                                                 | optional                                                                                                                                                                 | environment-specific failures (missing prod secret, silent mock mode)                          |
| LLM-as-judge on generation quality | local (`npm run eval`, key in the shell env) **and** GitHub Actions, `workflow_dispatch` only — no schedule                              | optional, human-triggered — wired by §3 Phase 5 (C10X-31); the CI leg added 2026-08-02 (C10X-42)                                                                         | wrong-language or unusable cards                                                               |
| e2e browser journeys               | local only — `npm run e2e`, which starts and owns its own dev server; no CI job. One-off per checkout: `npx playwright install chromium` | **never a gate** — human-triggered, no schedule, and nothing may declare it in `needs:`. §3 Phase 6 is `complete` as of 2026-08-09 and that changes nothing in this cell | the guard is MOUNTED and runs on a real browser navigation; an accepted card survives a reload |

**The e2e row is the newest row in this table and deliberately the only one that is not a gate
at all** — which is why its `Required?` cell reads as a decision rather than as a waiting room.
**As of 2026-08-09 the layer is WIRED and still not a gate, and holding those two facts together
is the whole point of this paragraph.** `npm run e2e` exists, starts its own dev server, refuses a
non-local stack before that server boots, produces its own session and cleans up after itself
(§4's e2e row; §3's Phase 6 note records which of the nine harness findings closed). None of that
is a step toward CI: there is no job, no schedule, and nothing may declare one in `needs:`.

The `Where` cell now describes an entry point that WORKS, which it did not before — the earlier
version named a command a fresh checkout could not run, because nothing installed the browser
binaries and nothing produced the `storageState` file. One prerequisite survives and is in the
cell: `npx playwright install chromium`, once per checkout, and the preflight names it by command
when it is missing. The two sentences that used to sit here are retired rather than re-based. The
opening one said e2e was deliberately absent, which stopped being true on 2026-08-05. The closing
one said to add e2e only if a risk survived the integration layer, and it is superseded by the way
Phase 6 was scoped: both journeys were chosen because the integration layer cannot reach them
**by construction** (§6.4 renders `routeType: "endpoint"` only and never runs project middleware),
not because a risk survived it.

**One thing about CI must not be misread in either direction.** The layer's SOURCE is gated:
`tests/e2e/**` has sat inside `npm run typecheck` since 2026-08-05, and since C10X-46 it is also
inside `npm run lint`'s Playwright rules — both fail-closed `ci` steps, so a `page.waitForTimeout`
or a type error in a spec reddens the `ci` job. That is not this row softening. It is the
compiles-vs-runs distinction §6.6's C10X-43 correction already had to make once: **the gates say
the specs compile and lint, never that anything ran them.**

**`never a gate` must not soften into `required — wired by §3 Phase 6` the day that phase
lands**, which is the one way this row could rot without anybody editing it. Same rule and same
reason as the DDL diff and the eval below: this project has no notification channel, so a red
run nobody is committed to reading is not coverage. Nothing may ever declare an e2e job in
`needs:`. **That day was 2026-08-09 and the row survived it** — the sentence above was written as
a trap for exactly this edit, the phase landed `complete`, and the only cell that moved is `Where`.

**The typecheck row is the newest gate and the one this table was wrong about for longest.**
Until 2026-08-03 it read `lint + typecheck | local (husky pre-commit via lint-staged) + CI |
required — wired today`, and every clause of that was false: no script and no CI step ran `tsc`
or `astro check` (C10X-41 measured the cost — Risk #7's acceptance instrument sat uncompilable
behind two fully green phases), and the local hook had **never been installed in this tree** —
`.husky/_` absent, `core.hooksPath` unset, `.git/hooks/` holding only samples, because
`package.json` carried no `prepare` script. C10X-43 wired both halves and split the row, because
they are not the same gate: `lint` runs on **staged files** at `pre-commit`, `typecheck` runs over
the **whole project** at `pre-push` — deliberately not at `pre-commit`, where ~12 s per commit is
a standing incentive to reach for `--no-verify`, and deliberately not inside `lint-staged`, which
appends file paths that make `tsc` discard `tsconfig.json` and that `astro check` silently ignores
while re-checking everything once per chunk.

Three properties of that gate belong here rather than only in §6.6, because they are what makes
it a gate rather than a green light. It is **fail-closed** — no `continue-on-error`, so unlike the
Kong step in the same job, a green `ci` job **does** imply this step passed. It does not trust an
exit code: `astro check` exits **0** when `@astrojs/check` or `typescript` is missing, printing
`[ERROR]` on the way out (proved with a positive control), so the wrapper asserts on the
`Result (N files):` line and rejects a run that checked nothing — the `lessons.md` "a command that
always exits 0 is not a gate" class, one vendor over. And it runs `tsc --noEmit` **first**, short-
circuiting on failure, because `astro check` is blind to a malformed `tsconfig.json`
(`@volar/kit` drops the parsed command line's `errors` array): a typo'd `strctNullChecks` makes
`tsc` exit 2 with `TS5025` while `astro check` reports `0 errors` over the whole project it is now
checking loosely. Neither checker alone is trustworthy; the pair is. Scope: `src/`, `tests/`,
`evals/`, `scripts/` and the root configs at once, plus the 18 `.astro` files `tsc` cannot see —
`tsconfig.json`'s `include: ["**/*"]` with `context` excluded so the local gate and CI agree on
scope by construction.

The DDL-diff row says **human-triggered** rather than "nightly", and the wording is
load-bearing: `.github/workflows/schema-diff.yml` carries no `schedule:` block, because a
red run in a tab nobody is committed to reading is not coverage — this project has no
notification channel and none is being built. Read that row as a capability that exists
and is exercised when someone asks, never as a signal being watched. Adding a cron is one
line; do it the day an alerting channel and an owner exist, not before.

The LLM-as-judge row follows the same rule, and for the same reason: the eval exists and
runs when a human runs it. The `workflow_dispatch` leg C10X-31 deferred — schema-diff.yml
idiom, per-step secrets, a SEPARATE OpenRouter key with a low per-key credit limit as the
blast-radius cap — **landed 2026-08-02 (C10X-42)** as `.github/workflows/eval.yml`, and it
moved exactly one thing: the eval is no longer local-only, so exercising it no longer
depends on one machine holding a key. It did **not** touch the trigger, and the two claims
must not be run together. There is still no `schedule:`, for the DDL diff's reason plus one
of its own: a scheduled run with no notification channel is an alarm nobody hears, and this
one would spend real OpenRouter credit nightly to produce it. Nothing may ever declare this
workflow in `needs:` — and a `workflow_dispatch`-only workflow emits no check run on a PR,
so it cannot drift into a required status check by accident either. One operational fact a
runner must know, unchanged and now more load-bearing than before: the eval's red is not
hygiene — `npm run eval` exits **1** on a REAL generation defect (§6.6's C10X-31 entry), so
the contract is "run it, read the table", not "keep it green". That is exactly why it is
not a gate, and why the workflow's own header says so before it says anything else.

Two of these gates depend on a cloud credential, which changes what a red run means. The
`drift` job needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_ID` and the DDL diff
additionally needs `SUPABASE_DB_PASSWORD`; every failure path in the drift runner —
missing secret, non-2xx, unparseable body, empty result set — **exits 1 by design**, so a
Management API outage blocks the deploy. That is the fail-closed contract working, and the
runner labels it `GATE UNAVAILABLE` (as opposed to `DRIFT`) precisely so the reader knows
it is not evidence about the schema. The recovery for each is in `README.md`'s CI section
and, in full, in the ship runbook.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase `<N>`."

### 6.1 Adding a unit test

- **Location**: `tests/`, mirroring the `src/` path of what you test.
- **Naming**: `*.test.ts`. Only files matching `tests/**/*.test.ts` are
  collected (`vitest.config.ts`). Playwright's specs live under `tests/e2e/` and end
  `.spec.ts`, which that `include` does not match — but the reverse is not true, so naming
  one `.test.ts` hands the same file to **both** runners (Playwright's default `testMatch`
  takes either suffix) and this node-only suite then tries to run a browser spec (§3 Phase 6).
- **Reference**: `tests/harness.test.ts` — the smallest possible case;
  imports through the `@/` alias and asserts on the result.
- **Run**: `npm test` (single pass) or `npm run test:watch`. One file while
  iterating: `npx vitest run tests/isolation/decks.test.ts`.
- **Note**: the whole suite requires a running local stack, because
  preflight (§6.4) aborts the run without one — even for a test that never
  touches the database. Start it with `npm run db:start`.
- **The mirroring rule has one clarification, added by §3 Phase 3.** `tests/` mirrors the
  path of what it tests, and the subject is usually app code under `src/`. Where it is CI
  tooling under `scripts/` instead, its test still sits in `tests/lib/` beside the suite's
  other pure-function files — `tests/lib/schema-drift.test.ts` covers
  `scripts/schema-drift.ts`, and that is deliberate, not a convention break. A
  `tests/scripts/` folder holding one file would buy nothing; the pure-function pattern
  (`http.test.ts`, `study-session.test.ts`) is what the file actually follows.

**The oracle-property pattern (added by Phase 4).** For logic whose expected
value is produced by a library — the rating→next-review mapping is the case
here — assert the **property**, never a copied constant.
`tests/study/schedule.test.ts` is the reference: it imports the app's own
configured `scheduler` (not a fresh inline `fsrs()`), so it pins the module's
configuration and not just the library, and asserts the ordering
`Easy.due > Good.due > Hard.due > Again.due` for a fixed `NOW`.

Two things make this legitimate rather than circular. `ts-fsrs` is pure and
immutable and **the app configures `enable_fuzz: false` explicitly**
(`generatorParameters(...)` in `src/lib/study.ts`), so the transition is a
deterministic function of `(card, now, grade)` — the library is an _independent_
oracle, and `next(card, now, grade)` takes `now` as a parameter, so nothing depends
on the wall clock.

> **History, kept because it is the reason the line is now trustworthy (C10X-27,
> 2026-07-26).** From 2026-07-24, when Phase 4 wrote this paragraph, to 2026-07-26 it
> asserted that configuration while nothing in `src/` performed it — two days, and the
> claim was already in two test-file headers as well: the call passed only `request_retention`,
> `maximum_interval` and `enable_short_term`, and fuzz was off solely because
> `default_enable_fuzz = false` upstream in ts-fsrs 5.4.1 — under a `^5.4.1` range.
> Every exact-`due` oracle in `tests/study/study.test.ts` therefore rested on an
> unpinned third-party default that an upstream flip inside the caret range would
> have turned intermittently red with no change in this repo. C10X-27 added the
> single line and confirmed the edit was behaviour-neutral the only way that can be
> confirmed: the whole suite stayed green (97/97 at that moment) across it. Had it
> gone red, determinism had never been off and every oracle was measuring something
> else. The same false sentence had been copied into both test-file headers; both
> are corrected.

What you must not do is
paste the number the implementation currently produces into an
`expect(...).toBe(...)`: that asserts the code agrees with itself and goes
green even when the schedule is wrong. If a case cannot be phrased as a
property or as a recomputation from an independent source, it does not belong
at this layer.

**"Independent source" has a sharp edge when the state is stored** (added by
the S-03 impl-review). Feeding the row you just read back through the app's own
mapper to build the expectation is _not_ an independent recomputation: whatever
the store fails to persist is dropped on both sides at once, and the oracle
agrees with the code on a wrong value. For a stateful transition, advance the
oracle **independently of the store** — chain it in memory across several
transitions and compare against what actually landed. §6.6's Phase 4 note
records the bug this rule was written from.

**When you extract a decision out of a layout or an island so it can be tested, the
env-derived input must become a PARAMETER** (added 2026-07-31 by C10X-34, and it is the
condition that makes the extraction worth anything). This project reads config through
`astro:env/server`, which Vite inlines at transform time — so a module-level constant computed
from it (`missingConfigs` in `src/lib/config-status.ts`) can only ever describe **the local
stack** under the runner: Supabase configured, OpenRouter not. A function that closes over that
constant is therefore testable only in the one state the runner happens to be in, and the state
that matters is usually the other one. `visibleConfigStatuses(entries, hasSession)` takes the
list; `Layout.astro` supplies `missingConfigs` and `Boolean(Astro.locals.user)`. Every entry in
`tests/lib/config-status.test.ts` is fabricated and the real constant appears in no assertion —
which is precisely what let breakage check F go red on an **un**configured Supabase, a state no
test run can otherwise reach. Same shape as C10X-27's `readJsonResponse` / `rateOutcome`
extractions (§7), with one extra rule: extract the decision **and** its inputs.

### 6.2 Adding an integration test

- **Location**: `tests/isolation/` for ownership cases; a sibling folder
  named after the concern otherwise. Never `tests/e2e/`, though — that is Playwright's
  `testDir` and takes `.spec.ts`, so a `.test.ts` placed there is collected by this suite
  **and** by Playwright, whose default `testMatch` matches both suffixes (§3 Phase 6).
- **Naming**: `*.test.ts`, named after the **resource**, not the scenario
  (`decks.test.ts`, `flashcards.test.ts`). A new case for a resource that
  already has a file goes in that file as another `it()` — do not open
  `decks-read.test.ts` next to `decks.test.ts`. One file per resource keeps
  every claim about that resource in one place, which is what makes a gap
  visible.
- **Check §6.6 first.** It tabulates what is already covered per resource.
  Read it before writing anything — the case you are about to add may exist,
  and if it does not, that table is where its absence is visible.
- **Reference**: `tests/isolation/decks.test.ts` — copy this one. It drives
  the real endpoint with account B's session against account A's
  `publicId`, and for each attempt asserts **both** that B gets 404 **and**
  that A's row is unchanged when re-read with A's client.
- **Run**: `npm test`.
- **The rule that makes these tests real**: assertions are row-based and
  always paired with a positive control — never status-only. A cross-tenant
  `UPDATE`/`DELETE` under RLS is a silent 0-row no-op, and a misconfigured
  `createClient` returns `null`; both are indistinguishable from success
  from the outside. "B got a 404" alone does not prove A's row survived, and
  a wholesale broken policy reads as perfect isolation unless something also
  proves the owner still reaches their own data.
- **Where the positive control goes**: inline, in the same `describe`, next
  to the denial it backs — `decks.test.ts` and `flashcards.test.ts` both do
  this, and it is the pattern to follow. `tests/isolation/positive-control.test.ts`
  is a different thing and not a template: it proves the _harness itself_
  (session, cookie, endpoint driver) works end-to-end, so that a green
  denial suite cannot be the result of a chain that was never connected.
- **Denials assert 404, never 403** — an absent row and an RLS-hidden row
  must stay indistinguishable.
- **A positive control must OWN the fixture it mutates** (added 2026-07-30 by
  C10X-32, and it is this section's own discipline that produced the defect).
  The bullet above requires a control beside every denial; the cheap way to
  write one is against the shared `beforeAll` fixture — which is exactly what
  makes the pair pass in declaration order and fail in any other. Create the
  deck / card / session the control mutates **inside its own `it()`**
  (`tests/isolation/flashcards.test.ts`'s two `controlDeckId` cases,
  `candidates.test.ts`'s own-session rewrite, and the `generate.test.ts:371-374`
  "Control deck" this pattern was copied from). Never restore the shared
  fixture at the end of a mutating case — restore-after-mutate is itself
  order-dependent hygiene; the owned fixture is the whole fix.
  - The load-bearing distinction on the reading side: **assert what you re-read
    inside the `it()`, never a file-scope constant** captured before a sibling
    could have moved it. `candidates.test.ts`'s overwrite/delete denials are safe
    for precisely this reason (each re-reads `before` itself); the read denial
    beside them, which compares against the seeded `error_message`, was not.
  - And an aggregate that owns no fixture — a scan whose positive control is
    `length > 0` — depends on its siblings just as hard. The `srs_state = 3`
    canary (§6.6 Phase 4) now seeds one schedule row it owns before scanning, and
    keeps the scan account-wide.
- **Shuffle is permanently on, in both runners** (`sequence: { shuffle: true }`
  in `vitest.config.ts` and `vitest.eval.config.ts`, files AND tests within a
  file). The seed is deliberately **un-pinned**, so each run draws a fresh
  permutation and CI accumulates coverage instead of re-testing one order
  forever. Every run's banner prints `Running tests with seed "<n>"` — **to
  replay a red run exactly, `npx vitest run --sequence.seed=<n>`** (no extra
  flag; the config already supplies `shuffle`). A red under a fresh seed is
  normally a real inter-`it()` dependence, and the fix is the owned-fixture rule
  above, not a pinned seed.
  - **If it does not reproduce at its own seed, it is not an ordering defect.**
    The local stack has a pre-existing transport flake — Kong pools keep-alive
    sockets to PostgREST and **both sides idle out at the same 60 s**, so neither
    reliably closes first and the loser of that race sends the next request down a
    socket the upstream has already closed, answering
    `502 upstream prematurely closed connection`. It is measured at the same rate
    with shuffle off. `tests/setup/retry-transport.ts` (a `setupFiles` `fetch`
    wrapper) absorbs exactly that response, from a local URL, at most twice, and
    nothing else. Read its header before widening what it retries; every other
    status in this suite is a signal something asserts on.
    > **Corrected 2026-08-01 (C10X-39), by measurement.** This bullet used to
    > claim that Kong keeps a pooled socket idle for LONGER than the upstream
    > does, and that the 502 lands on the first request after an idle gap. Both
    > halves are wrong and both were wrong in the reassuring direction: the
    > timeouts are **equal** (Kong's `upstream_keepalive_idle_timeout` 60 s,
    > PostgREST/warp 60.0 s measured with Kong bypassed), which is the
    > _pathological_ case rather
    > than a fixable ordering, and the drops **cluster in a burst's first 1-2 s**
    > (43/43) after a median 27 s of quiet rather than landing on the single first
    > request. Since C10X-39 the cause is also removed **locally** —
    > `npm run db:start` recreates Kong with upstream keep-alive pooling disabled — but that
    > is unsupported, per-machine and wiped by every `npx supabase stop`, so the
    > wrapper stays and so does this bullet. §6.6's C10X-39 entry carries the
    > before/after measurement and its controls.

### 6.3 Adding a test for a new API endpoint

(Filled in 2026-07-26 by C10X-28; it read "TBD — see §3 Phase 2" until then, and §6.5
had to warn readers off inferring the contract from §6.2's ownership rule.)

Two contracts, and they are separate claims — assert both:

- **Validation parity — a refusal AND no write.** Copy
  `tests/generation/generate.test.ts`'s input-contract block. A status assertion alone
  is not enough: a 400 returned _after_ a write had landed reads as a pass. Every
  rejection case re-counts the rows it could have created and asserts zero, and the
  block carries a **boundary-value success** so the refusals cannot be an endpoint
  refusing everything. Two traps live here, both recorded in §6.6's C10X-28 entry: a
  **status-filtered** count is an argument rather than an assertion, and a PostgREST
  filter scoped by a long value answers **414** before the query runs — scope by a short
  per-case marker with `.like()`.
  > **This bullet used to say "a 4xx AND no write"; corrected 2026-07-28 by C10X-30.**
  > A `4xx` is the convention of the three **JSON** endpoints (`/api/generate`,
  > `/api/study`, `/cards/batch`), not of the project as a whole. The six protected
  > `/api/*` routes that are native `<form method="POST">` targets refuse by
  > **redirecting** to an owned `?error=` URL — the same `302` a success returns — so on
  > those the row oracle is not a supplement to the status assertion, it is the only
  > thing separating a refusal from a write. That case has its own subsection: read
  > **§6.10** before writing one. The "AND no write" half was always the load-bearing
  > part and is unchanged.
- **No leak in the error body.** The invariant is that every `error` string an endpoint
  returns comes from a closed set of module-level literals, never from an upstream
  message, an exception, a Zod issue, or user input. It has a consumer:
  `src/lib/http.ts` renders that string verbatim in every island for anything that is
  neither a `401` nor a redirect. Where private material must be kept (an audit row, a
  log), assert the **contrast on one request** — the row records it, the body does not —
  rather than asserting the status. `tests/generation/failure-path.test.ts` is the
  reference, and reaching a sealed failure branch is the one case where a module double
  is permitted: read **§6.9** first.
- **A closed set enforced only where messages are PRODUCED is half a guarantee** (added
  2026-07-31 by C10X-34). The bullet above pins what an endpoint puts into a URL; it says
  nothing about what a page does with that URL on the way back. Both auth pages read
  `?error=` straight into a trust-carrying red banner, so a crafted link rendered
  attacker-chosen text on this project's own sign-in page — not XSS (React escapes), but
  content injection. The rule: when a message travels through a URL, enforce membership on the
  **read** side too, in a pure helper that lives **beside the set** (`ownedAuthMessage` in
  `src/lib/auth-errors.ts`), so producer and consumer cannot drift. Three things make the test
  real rather than decorative — membership by **equality**, never containment (the attack
  appends to trusted copy, which any "does it look like ours?" check waves through); rejection
  to a value the renderer already treats as "nothing", so an unvouchable error degrades to **no
  banner**; and a positive control over the **whole set**, without which `() => null` satisfies
  every rejection case and reads as perfect protection.

Everything else follows §6.4 — real endpoint, real cookie, real Postgres, row-based
assertions with a positive control, **404 never 403** for ownership, and a file-level
`Date.now().toString(36)` namespace (§6.5). A signed-out case needs no fixture change:
render the endpoint with `locals: { user: null }` through a local container helper, as
`generate.test.ts` and `study.test.ts` already do.

### 6.4 Adding a test for a data-access or ownership rule

The pattern is: **drive the real endpoint with a real session cookie against
the real local Postgres.** Nothing is mocked. The three helpers in
`tests/fixtures/` are the whole apparatus:

- `accounts.ts` — provisions the run's two accounts (A and B) once, via the
  anon key, and hands them to every file. Two accounts per run, not per
  test: the auth rate limit is 30 sign-ins / 5 min / IP.
- `session.ts` — turns a signed-in session into a `Cookie` header by
  capturing what `createServerClient` writes through `setAll`.
- `endpoint.ts` — renders an API route via the Astro Container API with that
  cookie plus an injected `locals.user`.

Two things about this pattern are non-obvious and easy to get wrong:

- **The Container API does not run project middleware**, so `locals` must be
  injected by hand. This is faithful rather than a shortcut: the middleware
  only ever answers "is someone signed in?" — it is resource-blind. Injecting
  `locals.user = B` while sending B's real cookie is a literal encoding of
  the assumption under test, "authenticated implies authorized". The cookie
  still drives the real chain because each endpoint builds its own Supabase
  client from the request headers.
- **Never hand-construct the session cookie.** Capture it via `setAll`. The
  format is internal to `@supabase/ssr`, its name depends on the
  `SUPABASE_URL` hostname, and a malformed value is read as _no session_
  with only a `console.warn` — drift would surface as a mysteriously
  logged-out test, not an error.

**Pages (`.astro`) are deliberately not rendered.** `callEndpoint` drives API
routes only (`routeType: "endpoint"`); there is no page-rendering helper and
you are not expected to write one. To cover a read surface that a page owns
(e.g. `/decks/[publicId]`), call the data-access functions its frontmatter
calls — `getDeckByPublicId`, `listFlashcards` — with an RLS-scoped client
from `clientFor`. Same database path, same RLS, same signal, without the
renderer. Know the limit this buys: an ownership check added _only_ in a
page's frontmatter would not be caught. That is acceptable today because the
pages carry no such check — RLS is the lock — but if one is ever added there,
this pattern stops being sufficient.

**Translating "404, never 403" below the HTTP layer**: a lib function has no
status code. `getDeckByPublicId` returning `{ data: null, error: null }` is
the equivalent of the 404 — absence, not a raised denial. Assert `data` is
null; never assert on an error.

**Database-level RLS tests are deliberately not the pattern here.** Setting a
role and JWT claims in SQL proves the policies; it does not prove the app
sends the JWT at all, and would stay green if the endpoint layer stopped
doing so. That proof already exists once, at
`context/archive/2026-07-05-per-user-data-isolation/rls-verification.md`;
re-doing it buys nothing. Test the endpoint.

**Preflight** (`tests/setup/preflight.ts`) runs as a `globalSetup` and aborts
the whole run when `SUPABASE_URL`/`SUPABASE_KEY` are unset, the stack is
unreachable, or `SUPABASE_KEY` is not the publishable/anon key. That last
check is load-bearing, not hygiene: a secret/`service_role` key bypasses RLS,
and RLS is the only lock — the app carries no `user_id` predicates on read.
No test could see that from the outside.

> **This list was incomplete; corrected 2026-07-26 (C10X-27) by reading the file.**
> Preflight closes **two more** seams, both of which `lessons.md` records as
> non-negotiable and neither of which was written here:
>
> - **The host must be local.** It hard-fails unless the `SUPABASE_URL` hostname is
>   `127.0.0.1` or `localhost`. "Key is anon" is _not_ sufficient — a production
>   project's anon key is anon and its stack is reachable, so without this check the
>   documented "swap cloud creds in" workflow would have `npm test` signing up real
>   accounts and writing rows in **production**.
> - **`OPENROUTER_API_KEY` must be unset.** It hard-fails if the key is set, because the
>   suite asserts card counts that only mock generation guarantees — and because a set
>   key means paid calls with test text, plus a timeout inversion (`SERVER_TIMEOUT_MS`
>   40 s > `testTimeout` 30 s).
>
> Neither has an env opt-out, by design: a genuine non-local run must require a
> deliberate code edit. Securing one seam and documenting only that one is exactly how a
> reader concludes the rest are closed too.

### 6.5 Adding a test for the generation path

- **Location**: `tests/generation/` — the sibling folder §6.2 calls for when
  the concern is not ownership.
- **Naming**: `*.test.ts`, named after the resource, not the scenario
  (`generate.test.ts`). A new generation case goes in that file as another
  `it()`.
- **Reference**: `tests/generation/generate.test.ts`.
- **Run**: `npm test` (the local stack must be up — `npm run db:start`).
- **Check §6.6 first**, as §6.2 requires: the case you are about to add may
  already exist, and §6.6 is where its absence is visible.
- **Read §6.3 before adding an input-validation case** (bad `count`, over-length
  source text). It owns the status-code and error-body contract, and as of
  C10X-28 it is written rather than TBD — the cases themselves live in _this_
  file's input-contract block. Do not infer that contract from §6.2's "404,
  never 403" rule: that rule is about ownership, not bad input.
- **Pattern**: identical to §6.4 — drive the real endpoint with a real
  session cookie against the real local Postgres, and read the result back
  with `clientFor(...)`. `callEndpoint` accepts a JSON string body and sets
  `Content-Type: application/json` for any non-`FormData` body.
  > **Corrected 2026-07-26 (C10X-27).** This bullet used to call `/api/generate` "the
  > project's only JSON endpoint". It was true when written and has not been since:
  > `/api/study` (S-03) and `/api/decks/[publicId]/cards/batch` (S-05) both parse a JSON
  > body and answer JSON — verified by enumeration, all three and only these three. The
  > distinction is no longer trivia, because the middleware guard now branches on whether
  > the caller wants JSON (§6.6 Phase 1): these three are exactly the paths that receive a
  > `401` instead of a redirect, while every other protected `/api/*` route is a native
  > form target and keeps its `302`.

Four project-specific facts that are not visible from the test file and
will cost you a wasted afternoon if you rediscover them the hard way:

- **No HTTP double is needed in THIS file, and one exists in exactly one other.**
  `OPENROUTER_API_KEY` is unset locally and in `.github/workflows/ci.yml`, so
  `generateCandidates` short-circuits to `mockCards(count)`
  (`src/lib/openrouter.ts:149-158`) and returns instantly. The outbound seam is
  already neutralised for every case here; do not add a mocking library for it.
  The corollary is that no test in this suite exercises the real provider — a
  change to the prompt or the response contract is invisible (that is §3 Phase 5's
  job).
  > **Corrected 2026-07-26 (C10X-28); this bullet used to end "and none exists".**
  > That was true until the failure branches had to be reached: the same clamp that
  > makes mock mode reliable also seals 502 and 422, so `tests/generation/failure-path.test.ts`
  > lifts it with a confined `astro:env/server` double plus a pass-through `fetch`.
  > It is the **only** file in the suite that doubles anything, and §6.9 states the
  > conditions. Nothing above changes for a test that stays on the success path.
  > **Still true as written on 2026-07-30 (C10X-32), and worth stating so nobody reads it
  > as stale**: `tests/setup/retry-transport.ts` also wraps `globalThis.fetch`, for every
  > file, but it **doubles nothing** — it replays Kong's keep-alive `502` from a local URL
  > and passes everything else through untouched, so no test here sees a fabricated
  > response. §6.9 carries the distinction.
- **Card content is not an oracle.** Mock output is identical on every call
  (`Przykładowe pytanie 1..N`), so grouping by `front` cannot tell a
  duplicated generation apart from the mock repeating itself. Use
  `generation_id`, which is unique per session.
- **`saved_count` is not an oracle.** The compensating update zeroes it
  (`retireGenerationSession` in `src/lib/generations.ts` — renamed from
  `failGenerationSession` by C10X-48, 2026-08-13, because the name described half of what
  the function does), so a duplicated-then-compensated run reads as `0` while its row still
  exists. Two things sharpen this rather than changing it. That update now also nulls the
  row's `idempotency_key`, so a compensated row is invisible to a `saved_count` oracle **and**
  to an `idempotency_key` one. And it is a **checked** write since the same date: `data == null`
  with no `error` means the compensation did NOT land, so a row that still reads
  `succeeded, saved_count > 0` after a failed card insert is the poisoned row C10X-48 is about
  rather than a successful generation.
- **The real timeout window cannot be reproduced here.** `testTimeout` is
  30 s (`vitest.config.ts:33`), below `SERVER_TIMEOUT_MS` = 40 s
  (`generate.ts`) and the client's 55 s. Any test that tries to sit out
  the timeout fails on the runner, not on the behaviour. This is not a
  limitation to work around: since S-05 Phase 6 the dedup keys off the
  request's `idempotencyKey`, not off timing, so a sequential pair of
  requests exercises the whole guard and waiting adds cost without signal.
  The one thing that genuinely needs the window — the commit race that
  produces a `23505` on the session insert — is unreachable from here and is
  carried by code review plus the manual retry check instead.

**Scope every count twice** — by `source_text` and by the test's own deck.
The threat is _within_ a run, not across runs: `provisionAccounts` gives
every run fresh accounts carrying a per-run id, precisely so the suite never
inherits a previous run's rows without a `db:reset`
(`tests/fixtures/accounts.ts`). What that does **not** buy you is separation
between the `it()`s of one run — they all read as the same account A, so an
unscoped `count(*)` silently sums every case in the file (and every other
file touching the same table). Namespace with `Date.now().toString(36)` at
**file** level, as `decks.test.ts:22` does — that is a different id from
`provisionAccounts`' per-run one, and it is the file-level one your
`source_text` values must carry.

**The deliberate-breakage check, and why its shape changed.** §6.6's precedent
is "neuter the guard, confirm red". While this file asserted that _two_
sessions were written, that was impossible — the assertion would have been
satisfied by anything ≥ 1 — so the 2026-07-18 check ran **inverted**: a crude
dedup on `(user_id, source_text)` was introduced and turned the first `it()`
red (2 expected, 1 received), not on a 500 and not on a timeout, which is what
proved the assertion observed the _second_ write.

Since S-05 Phase 6 inverted the assertion for real, the ordinary shape applies
again: neuter the guard and confirm red. §6.6's Phase-2 entry records the run —
widening the partial unique index to every `status` turns exactly the
failed-key case red (`expected 500 to be 200`) while the other 12 stay green.
Neither production edit was ever committed.

### 6.6 Per-rollout-phase notes

(Filled in by each rollout phase's final sub-phase.)

- **Phase 1 (`verification-harness`, 2026-07-15)** — what Risk #1 coverage
  now means, precisely:

  | Surface    | Non-owner denied on write                                | Non-owner denied on read                |
  | ---------- | -------------------------------------------------------- | --------------------------------------- |
  | decks      | rename, delete (`decks.test.ts`)                         | `listDecks` (`decks.test.ts`)           |
  | flashcards | create, edit, delete, containment (`flashcards.test.ts`) | `listFlashcards` (`flashcards.test.ts`) |

  Read denial is asserted on the **data-access functions the pages call**,
  not on a rendered page (see §6.4 on why pages are not rendered). Every
  denial is paired with an owner-side re-read and a positive control.

  **Not covered by THIS phase — the signed-out path.** `callEndpoint` always
  injects `locals.user` (`tests/fixtures/endpoint.ts:82`), so nothing driven
  through it can exercise a request from a logged-out visitor. That left two
  things untested: the middleware guard (`PROTECTED_ROUTES` in
  `src/middleware.ts` is prefix-matched, so a future route nobody adds to the
  array is unprotected), and each endpoint's own `if (!context.locals.user)`
  branch. Out of scope by decision — Risk #1 is authorization, not
  authentication — and worth revisiting when Phase 4's SRS routes land.

  > **Correction (2026-07-26, C10X-27 audit). This paragraph was stale in BOTH
  > directions and used to say "the whole signed-out path".** It overstated the
  > gap: the **endpoint's own 401 branch is tested** for `/api/study`
  > ("returns 401 for a signed-out request") and `/api/generate`
  > ("401s a request with no session"). Both bypass `callEndpoint`
  > with a local helper that renders the endpoint with `locals: { user: null }`
  > (`studySignedOut` in `study.test.ts`) — so widening the fixture was never needed. The
  > `/api/study` case shipped in `f90f9e7` with the endpoint itself, was not in
  > the S-03 plan's Phase 5 bullets, and never reached this file. It also
  > understated the gap: nobody had named what the guard's _response shape_ does
  > to a fetch client — see the Phase 4 audit note on `StudySession.rate()`.
  >
  > What genuinely remains untested is narrower: the **middleware guard** and the
  > two `.astro` page loaders. The guard is correct and complete today (verified
  > by enumeration; note `/study` does **not** prefix-match `/api/study`, so that
  > separate array entry is load-bearing) and it is **cheap** to test — `onRequest`
  > is an ordinary exported function taking a fabricable context, so a
  > table-driven unit over `PROTECTED_ROUTES` needs neither a container nor a
  > database. The six redirect-style deck endpoints still have no signed-out
  > test at all.
  > (The audit said "seven"; re-counted 2026-07-26 it is **six**. There are seven endpoint
  > files under `src/pages/api/decks/`, but `cards/batch.ts` is a JSON endpoint, not a
  > form target — which is precisely the distinction the guard now turns on.)
  >
  > **Closed 2026-07-26 by C10X-27** — the middleware guard now has that table-driven
  > unit (`tests/middleware.test.ts`, 21 cases), and it turned out the guard was **not**
  > correct: it answered every signed-out caller with a redirect, including the three
  > JSON endpoints fetched by islands. It now answers **in the caller's own format**.
  >
  > The discriminator is the **caller, not the path**, and that distinction is the whole
  > design. Six protected `/api/*` routes are native `<form method="POST">` targets —
  > deck rename/delete, card create/edit/delete — i.e. full-page navigations. Answering
  > those with a JSON 401 would strand the submit on a dead-end JSON page with no way
  > back to sign-in, in exactly the expired-session scenario the change exists to fix.
  > So the guard reads `Sec-Fetch-Dest`, then `Content-Type`, then `Accept`: fetch
  > callers get a `401 application/json`, page and form navigations keep their `302` to
  > `/auth/signin`, and a **new JSON endpoint needs no registration anywhere**.
  >
  > The test drives the **real, imported** `PROTECTED_ROUTES` (the array gained an
  > `export`; its contents are unchanged), so adding a protected route adds a row and a
  > duplicated list cannot stay green while production drifts. It pins the prefix trap
  > explicitly — `/api/study` does not begin with `/study`, so that entry is
  > load-bearing — lets the public paths through, and carries a signed-in positive
  > control so a wholesale-broken guard cannot read as perfect protection. Two rows
  > exist purely to stop the form regression: the same deck path answers `302` for a
  > urlencoded form POST and `401` for a JSON one. The Container API is deliberately
  > **not** used — it mounts `NOOP_MIDDLEWARE_FN` and would never run this code
  > (`lessons.md`); `onRequest` is an ordinary function and a fabricated context is both
  > sufficient and faithful. Signed-out rows need no database: `getUser()` with no
  > session fails locally, with no network call.
  >
  > Still open after C10X-27: the two `.astro` page loaders, and the six
  > redirect-style deck endpoints have no signed-out test of their **own** (the guard
  > now covers them as a class, which is a different claim).

  Phase 1 also shipped one production fix: `deleteDeck` gained `RETURNING`,
  so a cross-account delete answers 404 instead of a redirect
  indistinguishable from success.

  **How the flashcard read test got written is the cautionary tale**: it did
  not exist until a contributor exercise (§6 read cold, plan unread) tried to
  add one and found the gap — the write suite passed happily while a
  neutered `flashcard_select` policy leaked A's cards to B. If you are
  tempted to trust a row in the table above, neuter the matching policy
  (`using (true)`) and confirm something goes red.

- **Phase 2, first slice (`ai-candidate-generation-test`, 2026-07-18; Risk #2
  closed by S-05 Phase 6, 2026-07-25)** — Risk #2 is **covered**.

  For its first seven days this entry read "measured, not protected":
  `tests/generation/generate.test.ts` asserted that two identical POSTs to
  `/api/generate` wrote **two** `succeeded` sessions, because idempotency was
  deferred by an explicit decision — finding F5 (ACCEPTED-AS-RULE) in
  `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`,
  owned by roadmap **S-05**. That slice's Phase 6 landed the dedup, the first
  `it()` went red exactly as this section predicted, and the instruction was
  followed to the letter: **the assertion was inverted (2 → 1), not deleted.**

  What covers the risk now:

  | Claim                                        | What proves it                                                                                                 |
  | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
  | A retry writes one session, not two          | two POSTs with the same `idempotencyKey` → one `succeeded` session, one `generation_id`, `COUNT` cards         |
  | …and the replay is usable, not just harmless | the second response carries the **same** `sessionPublicId`, `deckPublicId` and `counts` as the first           |
  | The dedup is keyed, not blanket              | two different keys → two sessions; the control the "one session" claim would otherwise be satisfied by falsely |
  | An old client still works                    | two POSTs with **no** key at all → two sessions (column nullable, request field optional)                      |
  | A failure does not kill the retry (FR-018)   | a `failed` session seeded for a key → the same key still generates and succeeds                                |

  **The key is per ATTEMPT, not per request.** `GeneratorForm` mints a
  `crypto.randomUUID()` on submit and stores it in `lastPayload`; "Ponów"
  replays that payload verbatim, so the retry carries the same key while a
  fresh submit mints a new one. Regenerating the same source text on purpose
  is not a duplicate and must keep working.

  **Two guards keep FR-018 alive, they are NOT independent, and only one of them is
  testable from the outside.** The partial unique index is scoped to
  `(user_id, idempotency_key) where idempotency_key is not null and status = 'succeeded'`,
  and both failure-path _inserts_ in `generate.ts` write the key as `null`. A `failed`
  audit row holding the key would make "Ponów" collide on its own insert and answer
  `500` — retry permanently dead after the first failure, the exact flow FR-018 exists
  for (plan-review F1). Note that the plan's own migration contract specified the index
  **without** the `status` predicate; that made the criterion "a key whose only prior
  session is `failed` still generates" unsatisfiable, and the predicate was added
  deliberately during S-05 Phase 6.

  **This entry used to say "either alone would do". That was wrong** (impl-review F3,
  2026-07-25). The two failure inserts are not the only route to a `failed` row:
  `failGenerationSession` — the compensating update after a failed _card_ insert — flips
  an already-inserted `succeeded` row to `failed` and **leaves its key in place**
  (`src/lib/generations.ts`, which sets only `status`, `saved_count`, `error_message`).
  A keyed `failed` row is therefore reachable in ordinary operation, and the index
  predicate is the only thing covering that path. Neither guard is redundant; do not
  drop the predicate on the strength of the NULL writes. The test that pins this
  ("still generates when the only prior session for that key is `failed`") seeds the row
  directly, which is why the production route to it was easy to miss.

  > **Corrected 2026-08-13 (C10X-48) — the CONCLUSION stands, the route that justified it is
  > closed.** "Flips an already-inserted `succeeded` row to `failed` and **leaves its key in
  > place**" was true of `failGenerationSession` and is not true of what replaced it:
  > `retireGenerationSession` nulls the key and flips the status in ONE update (D-03), so a
  > **successful** retirement produces no keyed `failed` row at all. The paragraph is left
  > standing as the record of why the predicate was added and is not rewritten.
  >
  > **Do not read this as licence to drop the predicate**, and note that the reason it earns
  > its place changed while the instruction did not. It now covers a different row: a
  > retirement that **FAILS** leaves a keyed `succeeded` row standing, and the index is what
  > stops a second succeeded row for that key from ever existing. The index's FIRST predicate,
  > `idempotency_key is not null`, became load-bearing on the same date for a third row shape
  > the self-heal makes reachable in ordinary operation — a `succeeded` session with a NULL key
  > (`clearSessionIdempotencyKey` deliberately does not touch `status`, D-07). Both predicates
  > are load-bearing, each for a different row. The applied migration's own header
  > (`20260725133600:27-36`) carries the stale claim too and is **deliberately not edited** —
  > amending a pushed migration is a drift class the C10X-29 gate is blind to by construction;
  > the live correction lives in `src/lib/generations.ts` and in `generate.ts`'s
  > `idempotency_key: null` comment.
  >
  > The test named above is **unaffected** and stays this claim's guard: it seeds its `failed`
  > row directly, so no change to how production produces one can reach it.

  **The deliberate-breakage check, and it is a sharp one.** Widen the index by
  dropping `and status = 'succeeded'`, then run
  `npx vitest run tests/generation/generate.test.ts`. Exactly **1 of 13** goes
  red — the failed-key case, on `expected 500 to be 200` — while the other 12,
  including the dedup case itself, stay green. That split is what proves the
  failed-key assertion observes the index predicate rather than an incidental
  success. Two things are worth knowing before you run it:
  - The widened index may refuse to **build at all** against a database that
    already holds a suite run's rows (`Key (user_id, idempotency_key)=… is
duplicated`, the seeded `failed` row against its own `succeeded` result).
    That failure is itself evidence, but run the check from a `db reset` if you
    want the red test rather than the build error.
  - Restore with `npx supabase db reset` and then **verify it** — dump
    `indexdef` from `pg_indexes` before and after and `diff`. Done here; the
    restored definition came back identical, full suite green at **69/69** _as the
    suite stood on 2026-07-26 before C10X-27_ (109/109 after it; **166/166** after
    C10X-28 — read every figure here with the date attached to it).
    **The `1 of 13` split's denominator is stale and the run has not been repeated**
    (corrected 2026-07-26 by C10X-28): `generate.test.ts` held 13 cases when that check
    ran and holds **20** now, because Phase 3 of C10X-28 added seven. Nothing suggests
    the failed-key case stopped observing the index predicate, but "1 of 13" is a claim
    about a run, so re-run it before citing the split.

  One case in the file still looks like protection and is not: two identical
  `newDeckName` requests produce a 409 and exactly one session. That comes from
  `deck_user_name_unique`, not from any dedup, so it is kept deliberately
  **key-less** — a test written only against `newDeckName` would read green
  while proving nothing about the idempotency above.

  **What is NOT covered.** The dedup lookup runs before the LLM call and a
  `23505` on the session insert maps to the same replay, which together cover
  the sequential retry and the commit race. Two **concurrent** `newDeckName`
  requests still race at `createDeck`, and the loser 409s because the winner's
  session may not have committed yet — pre-existing, unchanged, and out of the
  flow a human performs. No test here reaches the real provider, for the reason
  §6.5 records.

  Phase 2 stays `implementing`: risks #4 (leakage in the error body) and #6
  (server-side validation parity) are untouched.

  > **Extended 2026-08-13 (C10X-48 `bug-generation-compensation-swallowed`) — and read the
  > boundary before the coverage, because this entry is half suite and half one manual run.**
  > **No §2 risk row moves and no phase status changes.** What moves is that the replay path's
  > DEAD END now has tests, where before it had none of any kind: `failGenerationSession` had no
  > caller anywhere in `tests/`, and the archived mutation register lists the whole function as
  > 5 NoCov.
  >
  > **The defect, in the terms this entry is written in.** A `succeeded` session can exist with
  > ZERO cards behind it, and `generate.ts` read that lookup as `if (error || !data)` — one branch
  > over two facts that mean opposite things — mapping it onto the outage 500. Since the row's
  > `idempotency_key` stood, every later "Ponów" on that key found the same row, read the same zero
  > cards and died the same way: a **permanent** 500 per key, which is FR-018 inverted. Two
  > byte-identical rows reach it (research §6): a POISONED one, where the card insert failed and
  > its compensating update failed too, and a TRUTHFUL one, where a real generation's cards were
  > later deleted by the user. Nothing in the row separates them.
  >
  > Suite **430 → 434, 36 files** (+4, all in `tests/generation/generate.test.ts`, 22 → 26): the
  > poisoned row heals and generates; the user-emptied row heals **with its `status` and
  > `saved_count` asserted UNCHANGED** (the heal clears the key and nothing else, D-07 — a heal
  > that reused the retirement would destroy a truthful audit row to fix a key, and that pair of
  > lines is what turns it red); a ZERO-ROW compensating write is told from a landed one on BOTH
  > helpers, cross-account under RLS with the owner's own call as the positive control; and an
  > owned EMPTY deck is adopted on the healed `newDeckName` path.
  >
  > **What the suite proves is the CONSEQUENCE half only.** Given the row, the endpoint heals.
  > That the endpoint can PRODUCE the row is **not** covered by any test and will not be: it needs
  > the card insert and the compensating update to fail on one request, and D-04 rules out both
  > ways to force that here (test-plan §6.9 confines module doubles to one file;
  > `tests/setup/retry-transport.ts` fabricates nothing by written decision). It is carried by ONE
  > recorded manual run — two DCL revokes, one real generation, the row read directly in psql as
  > `succeeded | saved_count 3 | keyed | 0 cards` — and nothing re-runs it. That run also proves
  > the compensation's **error** arm only; its **zero-row** arm is the cross-account test above,
  > which is the stronger evidence of the two because it runs on every `npm test`.
  >
  > Two more boundaries rather than a summary. The island half is untouched, as always (§7):
  > `GeneratorForm` now reads `retriable` with **absent meaning retriable** (D-08 — measured: 2 of
  > 20 `return json(...)` sites carried the flag, so a strict read would have removed "Ponów" from
  > every transient 500 including the one this ticket exists for), and that rests on a browser
  > matrix. And the two remaining swallowed `await`s in `generate.ts` are **exceptions with
  > owners**, annotated at their sites: the deck undo after a failed session insert (C10X-49) and
  > the two failure-path `createGenerationSession` inserts (C10X-50). Full record — five breakage
  > runs with their observed failure strings and denominators, including one that came back GREEN
  > and one whose prediction was measured FALSE, plus the DCL run's three restore oracles:
  > `context/changes/bug-generation-compensation-swallowed/verification.md` (after archiving:
  > `context/archive/<date>-bug-generation-compensation-swallowed/verification.md`).
  >
  > **Corrected 2026-08-13 (C10X-49 `bug-generation-deck-undo-swallowed`) — one clause of the
  > paragraph above, and the sentence is deliberately NOT rewritten, because it is the accurate
  > record of what was true on the day C10X-48 shipped.** "The two remaining swallowed `await`s …
  > the deck undo after a failed session insert (C10X-49)" describes **one** remaining exception as
  > of this date, not two: that undo is checked, and the remaining exception is **C10X-50's alone**
  > (the two failure-path `createGenerationSession` inserts, `generate.ts:426` and `:477`). What
  > does NOT change is the sentence's other half — the island is still untouched by any test — and
  > C10X-49 leans on it harder rather than less. The note directly below is that change's own.

  > **Extended 2026-08-13 (C10X-49 `bug-generation-deck-undo-swallowed`) — the sibling of the entry
  > above: same file, same class, the other call site, the same day.** **No §2 risk row moves and
  > no §3 phase status changes.** With this the "swallowed compensating write" class is closed in
  > `generate.ts` on both undo sites; what is left over is C10X-50's two audit-row inserts.
  >
  > **Read the boundary before the coverage, because this entry is ONE committed test and ONE
  > manual run and they do not meet.** The branch fixed — the `deleteDeck` undo after a failed
  > `generation_session` insert — is **unreachable from this suite**, and as an identity rather
  > than an inconvenience: `findSucceededSessionByIdempotencyKey` filters on exactly the set the
  > partial unique index predicates on, so no seeded row can collide on the INSERT while escaping
  > the lookup that runs before it, and `failure-path.test.ts`'s seam never doubles the database
  > (§6.9). So the **suite** owns the HELPER's contract and **one recorded manual DCL run** owns
  > the endpoint's use of it. **Nothing bridges them, and no test in this project can.**
  >
  > **What the suite gains, and why it had nothing before.** `deleteDeck` had **no caller anywhere
  > in `tests/`** — `tests/isolation/decks.test.ts:86-100` drives the DELETE _endpoint_
  > cross-account and nothing asserted the helper's own return value — so the
  > zero-row-vs-landed distinction the whole fix branches on was asserted nowhere. Suite
  > **435 → 437, 36 files** (+2, both in `decks.test.ts`, 5 → 7): B's client against A's deck
  > resolves `{data: null, error: null}` **with A's row re-read as A** (row-based, never
  > return-based — a null `data` over a deck that actually vanished would pass on the return and
  > leak in the database), and A's own delete resolves `data` non-null with the row gone. One
  > neuter (`.maybeSingle()` dropped) goes **2 of 7 red across two layers** — `expected [] to be null`
  > on the helper, `expected 302 to be 404` on the endpoint, because `[]` is truthy so
  > `delete.ts:37`'s `if (!deleted)` stops firing — with **both positive controls green**, which is
  > the attribution: the neuter removes the zero-row SIGNAL, it does not break deletes.
  >
  > **The control had to become its own `it()`, and that is a rule worth carrying.** Written first
  > inside the denial case (the C10X-48 precedent), it was **never observed green under the neuter
  > at all** — Vitest aborts a case at its first failed `expect`, so a control sitting after the
  > denial does not RUN under the very breakage it exists to be attributed against. Measured before
  > the split: `2 failed | 4 passed (6)`, the control among the cases that never executed. **A
  > control sharing an `it()` with the assertion it attributes is not a control.**
  >
  > **Two boundaries rather than a summary.** The orphan deck **survives a failed undo** — this
  > change detects, it does not delete (D-01) — so a reader must not take "the swallow is closed"
  > as "the deck goes away". And the island half is untouched as always (§7), but load-bearing in a
  > way it usually is not: the new response carries **`retriable: false`**, so the banner has **no
  > button** and its copy is the user's only route out. That the flag reaches `GeneratorForm` and
  > that the reload-then-select route the copy promises is real both rest entirely on Phase 3's
  > browser check. Full record — the breakage run with its observed strings, the DCL run with its
  > control and four restore oracles, and the browser observations:
  > `context/changes/bug-generation-deck-undo-swallowed/verification.md` (after archiving:
  > `context/archive/<date>-bug-generation-deck-undo-swallowed/verification.md`).

- **Phase 4 (`srs-study-session`, 2026-07-24; audited 2026-07-26; closed by C10X-27
  the same day)** — Risk #3 is **covered, both halves**. "The schedule writes the wrong
  next-review date" was covered by S-03; "**the study session loses a card**" is covered
  as of C10X-27. Re-verified by execution: suite **109/109, 11 files**, `tests/study`
  30/30. Precisely what that means:

  | Claim from Risk #3                                             | What proves it                                                                                                                                                                                                                                                             |
  | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Deferral follows the rating                                    | `schedule.test.ts` ordering property (no DB) + `study.test.ts` Easy-vs-Hard `due` persisted through the endpoint                                                                                                                                                           |
  | The written schedule is the right one, at the FIRST review     | `study.test.ts` exact-due oracle: `due`/`stability`/`difficulty`/`srs_state`/`reps`/`lapses`/`scheduled_days` vs a direct `scheduler.next`                                                                                                                                 |
  | …and at every review after it                                  | `study.test.ts` "stays faithful across consecutive reviews": three chained ratings vs an oracle Card advanced only in memory (added by impl-review F2)                                                                                                                     |
  | The written schedule survives a re-read                        | re-read on a brand-new client, column-for-column, asserted still rated (not silently reset to New). This is read-after-write, **not** a restart — same process, milliseconds apart                                                                                         |
  | …and the card comes BACK when it falls due ("no card is lost") | `study.test.ts` "returns the card at its persisted due and withholds it a minute after the rating" — rated at a fixed `now`, then `listDueCards` at `now + 1 min` (absent) and at the persisted `due` (present, `reps` advanced). **Added by C10X-27**                     |
  | A retry does not advance the schedule                          | two identical POSTs → `reps` 0→1 (not 2), second answers `200 { alreadyApplied: true }`, row byte-identical                                                                                                                                                                |
  | Only accepted cards enter                                      | a `generated` and a `rejected` sibling never come back from `listDueCards`; rating one is a 404 that writes no schedule row                                                                                                                                                |
  | No cross-account write (extends Risk #1)                       | B rating A's card → 404 and A's row unchanged column-for-column, with A's own successful rate as the positive control                                                                                                                                                      |
  | The batch is bounded by the deck's OWN cap                     | `study.test.ts` cap case: `session_size` set through the endpoint, read back via `getStudyDeck`, and passed to `listDueCards` — never a literal — with 5 due cards against a cap of 3. **Added by C10X-27**                                                                |
  | …and that cap is itself bounded                                | endpoint Zod (`0`, `-1`, `101`, `2.5` → 400, value unchanged on re-read) **and** the DB CHECK `deck_session_size_check` (`23514`, by name), with an in-range positive control. The island's own `SIZE_MIN`/`SIZE_MAX` mirror is NOT covered — see §7. **Added by C10X-27** |
  | Every grade writes what ts-fsrs computes, not just `Good`      | four fresh cards, one per grade, each column-for-column against an oracle from `createEmptyCard` advanced only in memory; plus the lapse case (`Again` from `Review`: `lapses` 0→1, `due`/`stability` strictly below `Good`'s at the same `now`). **Added by C10X-27**     |
  | The batch's composition is deterministic                       | **PARTIAL — read the caveat.** `toEqual` on the batch members pins their ORDER, but not the presence of the `f.id asc` tie-break: removing the clause leaves the suite green (see the breakage runs below)                                                                 |

  **What the single-transition oracle does NOT prove, and why there are now two
  rows for it** (added by impl-review F2, 2026-07-24). The exact-due oracle
  recomputes its expectation from the row it just read back — i.e. _through_
  `scheduleRowToCard`, the app's own mapper. Any `ts-fsrs` `Card` field the
  schedule table fails to persist is therefore dropped on both sides at once, so
  the oracle and the code agree on a wrong value and the assertion passes. That
  is §2's "assertion copied from the implementation" wearing the costume of a
  property test, and it was not hypothetical: it let a card rated Good sit in
  `Learning` at a +10 min interval **forever** (the `Card.learning_steps` cursor
  was never persisted) while the suite stayed green at 45/45.

  The rule that follows: **an oracle for a stateful transition must be advanced
  independently of the store under test.** "Stays faithful across consecutive
  reviews" does that — it chains three ratings against a `Card` built by
  `createEmptyCard` and advanced purely in memory, never round-tripping Postgres
  and never passing through the mapper, so a missing column surfaces as a
  divergence from review 2 onward instead of cancelling out. A seeded row's `due`
  does not feed the New → first transition, which is what makes `createEmptyCard`
  a faithful starting point.

  **The third deliberate-breakage check, for that case**: remove
  `enable_short_term: false` from the `generatorParameters(...)` at
  `src/lib/study.ts` (which restores the unpersisted-cursor bug) and run
  `npx vitest run tests/study/`. **Re-run 2026-07-26 (C10X-27): 2 of 30 red**, up
  from the single red first recorded. The chained case's `due` at review 2 fails on
  the same value pair as ever (`expected 1780316400000 to be 1780488600000`), and
  C10X-27's lapse case now fails too — on its **precondition**
  (`expect(settled?.srs_state).toBe(State.Review)` → `expected 1 to be 2`): with
  short-term steps on, three `Good` ratings leave the card in `Learning` instead of
  graduating it, which is the S-03 impl-review F1 bug seen from the user's side rather
  than the oracle's. **The `srs_state = 3` canary does NOT fire** under this flip — the
  card never reaches `Review`, so `Again`-from-`Review` never happens; the canary guards
  against a silently different schedule, it is not a detector for this flag. Restoring
  the flag restored green (109/109 full suite).

  **The deliberate-breakage check**: `study_due_cards` was replaced in the
  running local DB with a copy missing its `and f.state_id = 2` predicate
  (`create or replace`, no `db:reset`, so dev data survived). **Re-run 2026-07-26
  (C10X-27): exactly 1 of 22 red** — `expected [ …(3) ] to not include
'<generated card>'` in "never returns a generated or rejected card from a session
  build" — which is what proves that assertion observes the real gate rather than an
  incidental empty batch. (The split is unchanged since 2026-07-24; only the
  denominator moved, 14 → 22.) Restore: `pg_get_functiondef` dumped before and after,
  **diff identical**; the ACL re-verified byte-identical to the untouched
  `search_flashcards_in_deck`.

  **The second deliberate-breakage check, for the cross-account path — READ THIS
  BEFORE RELYING ON IT: it has silently stopped working.** It neuters all four
  guarding policies **at once** (`deck_select`, `flashcard_select`,
  `flashcard_schedule_select`, `flashcard_schedule_update`), because a single-policy
  neuter stops at the next policy down and still answers 404.

  When first run (2026-07-24) it produced two clean reds: B's rate returned `200`
  instead of `404`, and `listDueCounts` returned A's deck to B
  (`expected 1 to be undefined`). **Re-run 2026-07-26 (C10X-27) it produces 3 of 22
  red, and only ONE of the three is evidence:**

  | Red case                                                                                          | Verdict                                   |
  | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
  | `returns 404 when B rates a card in A's deck` (`expected 200 to be 404`)                          | **Evidence.** B genuinely rated A's card. |
  | `stops counting a card once its schedule is rated into the future` (`expected undefined to be 1`) | Knock-on.                                 |
  | `never exposes another account's deck` — the **positive control** (`expected undefined to be 1`)  | Knock-on.                                 |

  And the assertion that should have gone red **did not**: `never exposes another
account's deck` asserts `foreign.data?.[deckPublicId]` is `undefined`, and it
  **passed while the guard was completely disabled**. A false pass.

  The cause was traced, not guessed. `study_due_counts` carries no user predicate and
  no `LIMIT` — RLS is its only scoping — so with `deck_select using (true)` it returns
  **every** deck in the database. The local dev DB now holds **1053** decks while
  `supabase/config.toml` sets `max_rows = 1000`, so PostgREST truncates and the
  freshly-created deck (A's own as well as the one B must not see) falls outside the
  window; both sides then read `undefined`. That the policy really was wide open was
  confirmed independently at the SQL layer under the role-plus-JWT-claims pattern: as
  one user, `select count(*) from deck where user_id = <other user>` returned **4**.

  **What follows for whoever runs this next.** Re-run it from a `db:reset` (or with
  `max_rows` raised) or it proves nothing about `listDueCounts`; until then the
  cross-account claim on that surface rests on the rate-path 404 alone. This is a
  subtler failure than a stale count: an assertion that has become **unfalsifiable
  because of the environment it runs in**, while still reading green. It generalises —
  any denial asserted as "absent from an unbounded, unordered result set" is vulnerable
  to the same row cap as the dev database grows.

  Restore by `alter policy` and then **verify it**, do not assume it: dump
  `qual`/`with_check` from `pg_policies` before the neuter, dump again after
  the restore, and `diff` the two. Done on both runs; identical both times, full suite
  green (109/109 on the re-run). Restoring RLS from memory is how a suite
  quietly stops testing anything.

  **Four more breakage runs, added by C10X-27 (2026-07-26)** for the assertions that
  slice added. Full detail, including the observed failure strings, is in
  `context/archive/2026-07-26-srs-study-session-test/verification.md`:

  | Neuter                                             | Result                                                                                                                                                      |
  | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `limit p_limit` dropped from `study_due_cards`     | **1 of 22 red** — the cap case, `to have a length of 3 but got 5`                                                                                           |
  | `f.id asc` tie-break **removed**                   | **0 of 22 red — the suite stays fully GREEN**                                                                                                               |
  | `f.id asc` tie-break **reversed** to `f.id desc`   | **1 of 22 red** — same case, on `toEqual`                                                                                                                   |
  | `coalesce(s.due, p_now) <= p_now` dropped          | **1 of 22 red** — the due re-entry case, on its **negative** half (`to not include`)                                                                        |
  | endpoint Zod `min(1).max(SIZE_MAX)` → `z.number()` | **1 of 22 red** — bounds case, `expected 500 to be 400` (the 500 shows the DB CHECK caught what Zod let through, i.e. the layers are genuinely independent) |
  | `deck_session_size_check` dropped                  | **1 of 22 red** — same case, `expected undefined to be '23514'`                                                                                             |

  **The tie-break rows are the important pair, and the honest reading is
  uncomfortable**: the composition assertion observes the batch's ORDER, not the
  presence of the tie-break. With the clause gone every sort key collapses to `p_now`
  and the order is formally unspecified, but at this data volume the planner returns
  insertion order anyway. So the assertion would catch a change that reorders the
  batch and would **not** catch someone deleting the `f.id asc` that migration
  `20260724220524` exists to provide. Making that catchable needs a data volume or plan
  shape where the planner actually diverges, and nothing here creates one. Named as an
  open gap rather than papered over.

  > **A constraint neuter is not symmetric with a function neuter.** Re-adding
  > `deck_session_size_check` **failed** — `violated by some row` — because the breakage
  > run itself had persisted an out-of-range `session_size` while the constraint was
  > absent (one row, the run's own `harness-a-*` fixture deck; repaired to the column
  > default `20`, then the constraint re-added cleanly and the definition `diff` came
  > back identical). `create or replace function` leaves no residue; dropping a CHECK
  > lets the suite write data the constraint forbids, so the restore can fail _after_
  > the evidence is collected. Inspect the violating rows before repairing, and never
  > assume the `add constraint` succeeded — the `diff` is what caught it.

  **Selective mutation testing on `rateCard` (C10X-27).** First time the study path was
  mutated: `npx stryker run --mutate "src/lib/study.ts:291-350"` (permanent `mutate`
  list untouched) → **56.90% total / 71.74% covered — 33 killed, 13 survived, 12 no
  coverage**. **No assertion was added**; every survivor is classified individually in
  `context/archive/2026-07-26-srs-study-session-test/mutation-register.md`. Two results worth
  carrying:
  - **The span had to be re-derived.** The plan recorded `257-316`; Phase 3's edits
    above `rateCard` pushed it to `291-350`. A stale range completes happily while
    mutating a different function.
  - **A surviving `""` string mutant is not automatically a coverage gap, and this
    inverts S-05's precedent.** Three survivors mutate `.select("…")` → `.select("")`.
    Reproduced by hand (22/22 still green) and then explained by probing PostgREST
    directly: an empty `select=` is read as `select=*`, a strict **superset** — not the
    malformed query that killed S-05's `.in("state_id", "")` on `PGRST100`. Check the
    query semantics before classifying a mutant in either direction.
  - The remaining survivors and **all twelve** uncovered mutants sit in `rateCard`'s
    four `if (…Error)` branches and their return payloads. Its query **predicates** are
    well asserted (**27 of 33** kills are behavioural, 6 merely structural — classified
    by script, not by eye); its **failure handling** is not asserted at all and cannot be
    without a fault-injection seam §6.4 deliberately does not provide.

  **Known cosmetic gap, not a leak**: the migration's
  `revoke all on function … from anon` does not remove `PUBLIC`'s default
  `EXECUTE`, so `has_function_privilege('anon', …)` is `true` for both study
  RPCs. Both are `security invoker`, so an anon caller still gets zero rows
  under RLS. This matches the untouched `search_flashcards_in_deck`
  precedent — it is a project-wide pattern, not something S-03 introduced.
  Refined by the 2026-07-26 audit: an anon call actually fails with _permission
  denied for table flashcard_ (`init_core_schema` revokes it) rather than returning
  zero rows under RLS. Safe either way, still untested.

  **Audit note (2026-07-26, C10X-27 / roadmap H-02).** A full audit re-verified this
  entry against the code and by execution. **C10X-27 then shipped the same day and
  closed most of what it found** — each item below is marked CLOSED or OPEN, and the
  counts above have been replaced with runs executed against the current files.

  > Every `file:line` in this note points at the tree **as it stood at the audit**, before
  > the fixes below landed; the fixes moved most of those lines. Read them as a record of
  > what was found, not as navigation. Cited symbol names are still accurate.
  - **CLOSED.** **Every deliberate-breakage count in this entry is stale.** They read "the other
    14 cases stay green" (15 total) and "the other 13 cases stayed green" (14 total),
    but `tests/study/study.test.ts` now holds **16** `it()`s — `e9b8cd9` added two
    _after_ this note was written (the chained-oracle case and the
    accepted-then-un-accepted case). The `45/45` / `46/46` full-suite figures are
    superseded twice over: 66/66 after S-05, **69/69** today. **No recorded
    deliberate-breakage run has been executed against the current file.** Re-run
    them before citing them.
    → Every check above was re-run on 2026-07-26 against the current files (22 cases in
    `study.test.ts`, 109/109 full suite) and its count replaced. One re-run changed its
    meaning entirely — see the four-policy check.
  - **CLOSED.** **`session_size` → `p_limit` is the biggest untested wire on this surface.**
    `src/pages/study/[publicId].astro:37` caps the batch with `deck.session_size`,
    but every test call passes the literal `20` (`study.test.ts:104`, `:531-536`;
    `candidates.test.ts:626`) and no test creates more due cards than the limit. A
    regression to a hardcoded value, to the RPC's own `default 20`, or to dropping
    `p_limit` would be invisible, while `study.test.ts:601-618` (the setter) kept
    passing. The setter is proven; the reader is not. Its bounds are untested at all
    three layers (client mirror, endpoint Zod, DB CHECK `between 1 and 100`).
    → The reader is now covered (`deck.session_size` read via `getStudyDeck` and passed
    to `listDueCards`, 5 due cards against a cap of 3), and two of the three bound layers
    with it. The **client mirror stays uncovered** — no layer here reaches an island's
    JSX (§7) — and it was checked by hand instead: entering `101` renders "Rozmiar sesji
    musi być liczbą od 1 do 100." and sends no request. Do not read the suite as proving
    the bound end to end.
  - **PARTLY CLOSED — read the caveat.** **The RPC's `order by … , f.id asc` tie-break
    and `limit p_limit` have no assertion.** Every test checks membership with
    `find`/`toContain`, never order — even though M2 added the tie-break precisely so
    batch composition would stop being planner-dependent.
    → `limit p_limit` is closed. The **tie-break is not**: the new `toEqual` on the batch
    members pins the order, and removing `f.id asc` leaves the suite green (breakage run
    above). Order is asserted; the clause that guarantees it is not.
  - **CLOSED, and the claim in this bullet was itself FALSE.** **Only `Rating.Good` ever
    reaches the database.** Easy and Hard appear once each, in the ordering case
    (`:507`, `:512`); **`Rating.Again` never takes the write path at all**, so `lapses`
    and the ~~Review → Relearning~~ transition are unproven on persistence — that is the
    "hard card resurfaces sooner" half of US-02.
    → All four grades now take the write path, each column-for-column against an
    in-memory oracle, plus a lapse case asserting `lapses` 0→1 and a `due`/`stability`
    strictly below `Good`'s at the same `now`.
    **But "Review → Relearning" is wrong and must not be repeated.** With
    `enable_short_term: false` ts-fsrs runs `LongTermScheduler`, whose `next_state` sends
    **every** grade — `Again` included — to `State.Review`
    (`node_modules/ts-fsrs/dist/index.cjs:1271`). `State.Relearning` is assigned at
    exactly one site, `BasicScheduler.reviewState` (`:1102`), which this configuration
    never instantiates. So `srs_state` can only ever be `0` or `2`; `lapses += 1` on
    `Again` is real (`:1237`). Confirmed by execution, not by reading: the lapse case
    asserts `State.Review` and passes — asserting `Relearning`, as this bullet and §6.7
    both described, would have failed. A one-line **canary** now pins it: no row this
    suite writes ever carries `srs_state = 3`.
  - **CLOSED.** **A production bug on this path was found that no document had named**, and it is
    a Risk #3 failure in the user's terms: `StudySession.rate()`
    (`src/components/study/StudySession.tsx:174`) checks only `!res.ok`, while
    middleware answers a signed-out `POST /api/study` with a **302 to an HTML page**
    that `fetch` follows to a `200`. The card advances, the counter climbs, and no
    rating is written. The endpoint's own correct 401 (`src/pages/api/study.ts:52-55`)
    is therefore unreachable in production, as are `/api/generate`'s and
    `cards/batch`'s. Carried by C10X-27.
    → Fixed on both sides. The middleware now answers a JSON caller with a real `401`
    (§6.6 Phase 1's note carries the design and its table), so those three endpoints'
    own 401 branches are reachable in production for the first time. And the client
    decision moved out of the island into `src/lib/http.ts`'s `readJsonResponse` —
    parse before `ok`, with a followed redirect and a non-JSON body as failures in their
    own right — where it has seven tests including the defect's exact shape, a
    `200 text/html`. Confirmed live: the same signed-out `POST /api/study` that used to
    answer `status=200 ok=true content-type=text/html` now answers
    `401 application/json`, the UI shows "Twoja sesja wygasła", and the row is provably
    untouched (`reps` 0, `srs_state` 0, `last_review` null).
  - **CLOSED as hygiene — and the class was misdiagnosed here.** Also recorded,
    deliberately not fixed there: `scheduled_days` is written
    (`src/lib/study.ts:97`) and never read back (`:284` omits it; `DueCardRow` has no
    field), so it is ~~the same un-round-tripped class as impl-review F1's
    `learning_steps` bug~~ — inert today **only** because `enable_short_term: false`
    makes `LongTermScheduler` zero it on input.
    → It now round-trips on the `rateCard` path (`DueCardRow` gained it as an optional
    nullable field; `scheduleRowToCard` prefers the persisted value). **It is NOT the
    `learning_steps` class**, and recording it as such would be a second false statement.
    `learning_steps` was a genuine scheduler _input_ — a cursor the scheduler read, so
    losing it changed the transition. `scheduled_days` is **output-only** in ts-fsrs
    5.4.1 under **either** config: `LongTermScheduler` zeroes it (`index.cjs:1183`),
    `BasicScheduler` overwrites it (`:1023`, `:1041`, `:1048`), and the single read is
    `buildLog` (`:424`), whose review_log this app never persists. So the round-trip is
    behaviour-neutral for a stronger reason than "the config removes it from the
    calculation" — nothing reads it at all — and it closes **no risk class**. It is
    hygiene on the value FR-016 will want. The exact-`due` oracles were the neutrality
    check and stayed green. Two things stay outside it on purpose: `elapsed_days` has no
    column, and the RPC does not project `scheduled_days` (widening its `returns table`
    needs a `drop function` migration), so a session's **preview** intervals are still
    computed from `0` while `rateCard` uses the persisted value — harmless precisely
    because the column is output-only, and recorded so a future reader who makes it an
    input sees the divergence immediately.

  Full evidence: `context/archive/2026-07-26-srs-study-session-test/research.md` for the audit that
  opened these items, and `verification.md` + `mutation-register.md` in the same folder
  for the runs that closed them.

- **Roadmap slice S-05 (`candidate-review`, 2026-07-25)** — not a §3 rollout phase.
  It is recorded here because it widened **Risk #1's surface**: the project's first
  lifecycle state transition (`setFlashcardState`) and its first **multi-row**
  mutation (`POST /api/decks/[publicId]/cards/batch`). Every Phase-1 denial covers a
  single-row write addressed by one `public_id`, so none of them touches this path —
  a bulk UPDATE that forgot its deck scoping would have leaked while the Phase-1
  table stayed green.

  Extends the Phase 1 table by one row:

  | Surface    | Non-owner denied on write                                                                  | Non-owner denied on read |
  | ---------- | ------------------------------------------------------------------------------------------ | ------------------------ |
  | flashcards | **state transition, single and bulk, via `/cards/batch`** (`isolation/flashcards.test.ts`) | unchanged                |

  What the slice's own file (`tests/review/candidates.test.ts`) proves:

  | Claim                                               | What proves it                                                                                             |
  | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
  | Every legal edge of the transition table writes     | all four `(from,to)` pairs asserted on `RETURNING` **and** on the row re-read                              |
  | Every illegal edge writes nothing                   | anything → `generated`, and a repeat of an applied move: empty `RETURNING`, row `toEqual(before)`          |
  | A mixed batch writes only its legal subset          | one movable + one already-in-target card; `changed`/`skipped` split, sibling row byte-identical            |
  | A zero-row write is a 200, not an error             | the endpoint's `{ ok, changed, skipped }` contract, with `skipped` = requested minus returned              |
  | Route precedence cannot become a wrong write        | `batch` fails `UUID_RE` in `[cardPublicId].ts` → 404, never an edit                                        |
  | A transition moves the card through the study gate  | accepted → enters `listDueCards`; rejected → gone even at a far-future clock; Przywróć resumes at `reps` 1 |
  | Search stays accepted-only, and carries `source_id` | one token, three cards, one per state — only the accepted one matches                                      |
  | A transition is not a content edit                  | `updated_at === created_at` after a state write, while a real edit still bumps it                          |

  **What it does NOT prove.** The edit round-trip cases assert the `Location` header
  only — no test renders `review.astro`, so the review screen's own loader, its empty
  states and the acceptance-metric line are covered by manual verification alone
  (§6.4's "pages are deliberately not rendered" applies unchanged). The `?generation=`
  scope is proved at the data layer (`listFlashcardsByState`), not through the page.
  Nothing here exercises the signed-out path, for the same reason Phase 1 records.

  **Selective mutation testing, and why its 100% is weak evidence.** Stryker narrowed
  to the transition function — `ALLOWED_FROM` + `setFlashcardState`, today
  `--mutate "src/lib/flashcards.ts:202-226"`, permanent `mutate` list untouched:
  100% — 12 killed, **0 survived**.

  > **The range in this line was wrong for a day and is now corrected (C10X-28,
  > 2026-07-26).** It read `:181-212`, which is where those two symbols sat when the run
  > was made; `75df78f` moved `setFlashcardState` to `:218` **two hours later**, so the
  > recorded command had since been mutating a different part of the file — and Stryker
  > completes happily on a stale range, reporting a score for code nobody meant to test.
  > The symbols are named beside the numbers deliberately: **re-derive the span before
  > running it** (`grep -n "ALLOWED_FROM\|setFlashcardState" src/lib/flashcards.ts`) rather
  > than trusting either figure. The frozen copy in
  > `context/archive/2026-07-25-candidate-review/mutation-register.md:3` keeps the original
  > range on purpose — it records what was actually run that day. Do not read that as "the
  > gate is well asserted". Reproducing the two gate mutants by hand shows both die on a
  > **malformed query**, not on a behavioural assertion: `.in("state_id", …)` → `""`
  > fails with `PGRST100`, and the `?? []` fallback → `["Stryker was here"]` fails with
  > `22P02` (integer parse). Only **4 of 12** are behavioural — the ones that collapse the
  > allow-list to `[]` while leaving the query valid — and all four break _legal_
  > transitions. **No mutant in this run makes an illegal transition succeed**, because
  > the operator that would has to substitute a string that Postgres rejects. So the
  > direction that actually harms a user (a gate too permissive — a rejected card
  > drifting back into the deck) is carried by deliberate-breakage check 1 below, not by
  > Stryker. Per-mutant record: `context/archive/2026-07-25-candidate-review/mutation-register.md`.

  **Three deliberate-breakage checks, all run, with observed results.**

  > **Denominators below are dated, not current (noted 2026-07-26 by C10X-28).**
  > `candidates.test.ts` held **16** cases when these ran and holds **20** now — C10X-28
  > added the four generation-session audit-column cases, which touch a different table
  > and no `ALLOWED_FROM` path, so the _numerators_ should be unchanged. Neither check has
  > been re-run since. Same rule as everywhere in this file: a split is a claim about a
  > run, so re-run it before citing it.
  1. _The transition guard._ Delete `.in("state_id", ALLOWED_FROM[target])` from
     `setFlashcardState`. Exactly **3 of 16** red in `candidates.test.ts` — the
     off-graph case (`expected [ {…} ] to deeply equal []`), the mixed batch
     (2 returned instead of 1), and the endpoint's `changed`/`skipped` split. The
     other 13 stayed green, including every legal-edge assertion, which is what
     proves those three observe the gate rather than an incidental empty result.
     Reverting restored 16/16.

  2. _Cross-account denial._ This one needs **three** policies neutered, not the two
     the plan anticipated. With `deck_select` + `flashcard_update` set to
     `using (true)`, the new batch denial does go red — but only on its **status**
     (`expected 200 to be 404`, i.e. B resolved A's deck). The write half stayed
     invisible: Postgres also applies the **SELECT** policy to an UPDATE whose WHERE
     reads columns, so `flashcard_select` still hid the row and nothing landed
     (verified — zero rows matching B's intended content). Adding
     `flashcard_select using (true)` took it to **6 of 9** red, including B genuinely
     rewriting A's card (`expected 'Edited by B …' to be "A's front …"`). Note that
     the positive control went red as a **knock-on**, not as an independent signal:
     B's transition had already moved the card, so A's own accept→reject then matched
     zero rows. This is the same "stops at the next policy down" trap §6.6 records for
     S-03, one layer deeper — the next contributor should start from all three.

  3. _The trigger narrowing._ Restore the unqualified
     `before update on flashcard` moddatetime trigger. Exactly **1 of 25** red across
     both files — the `updated_at` assertion
     (`expected '…844183+00:00' to be '…839253+00:00'`) — and nothing else. A
     migration whose only effect is a _non_-event has no other witness.

  **Restores were verified, not assumed — and the verification earned its keep.** The
  first policy restore silently no-opped: the heredoc was piped to `docker exec`
  **without `-i`**, so psql never received it and reported nothing. Only the
  `pg_policies` before/after `diff` caught it; a "restored from memory, looks fine"
  pass would have left the suite testing nothing. Second attempt with `-i`: diff
  identical. The trigger was likewise re-dumped with `pg_get_triggerdef` and matched
  byte-for-byte. Full suite green afterwards: **66/66**.

- **Phase 2, second slice (`ai-candidate-generation-test-2`, 2026-07-26)** — Risk #4 is
  **covered, with a boundary this entry states rather than hides**; Risk #6 is **half**
  covered. Three tickets own the work and one branch carried it: **C10X-28** (audit-column
  isolation, the module double, the `console.*` guard, this doc-sync), **C10X-34** (auth error
  copy, the banner gate), **C10X-30** (bounds parity — its source-text half only).

  What the slice found first is why it is not the change its ticket described: the no-leak
  property on `/api/generate` **already held by construction** — 17 of its 18 error returns are
  fixed Polish literals and the 18th is a double ternary over two module-local literals, while
  `err.message` is computed once and routed **only** to the DB column. It was asserted nowhere,
  and it could not be asserted at all with the harness as it stood. So the slice pinned the
  property, and closed the two surfaces where private data genuinely did escape — neither of
  which the risk row names.

  | Claim                                                                                                                                                                             | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | On a failed generation the response body carries **neither** the pasted source text **nor** the upstream error string **nor** the key — while the audit row carries the first two | `tests/generation/failure-path.test.ts`, three cases (502 upstream HTTP, 502 transport, 422). One request each: the **raw** body (not just `error`) is asserted free of both sentinels and of the key, while the row is asserted to hold the source text in `source_text` **and** inside `request_payload`, the upstream string inside `response_payload`, and a non-empty `error_message` — the payload assertions run over the serialised column, so they pin presence, not a JSON path                                                                 |
  | …and those branches are genuinely reached, not simulated                                                                                                                          | the only module doubled is `astro:env/server` (`OPENROUTER_API_KEY` → a sentinel) plus a pass-through `globalThis.fetch`. `@/lib/openrouter` is **never** doubled, so `OpenRouterError`'s identity, the request build and the audit payloads are production's own. Breakage: remove the seam → **4 of 4 red on `expected 200 to be 502/422`** — without it the request falls through to mock mode and _succeeds_                                                                                                                                          |
  | 422's contrast is its own, not 502's with two extra rows                                                                                                                          | on that branch `error_message` is the fixed literal `"Model nie zwrócił poprawnych kart"` — asserted by **equality**, because substituting that literal for the upstream string _is_ the no-leak property here — while the upstream sentinel is asserted inside `response_payload`; both together with `generated_count > 0` and `saved_count = 0`, the pair that separates 422 from 502                                                                                                                                                                  |
  | `OPENROUTER_API_KEY` travels in `Authorization` and lands in no audit column                                                                                                      | the same file's key pin: the sentinel **is** in the captured header (the positive control — built by `openrouter.ts`, not by the test), **is not** in the captured request body, and appears in **no** field of the persisted row                                                                                                                                                                                                                                                                                                                         |
  | This repo writes no log line at all                                                                                                                                               | `tests/lib/no-logging.test.ts` — a textual scan of the **whole** `src/` tree (`.astro` frontmatter included), with two positive controls: the walker finds >50 files including four named ones, and the regex fires on four spellings of a console call                                                                                                                                                                                                                                                                                                   |
  | Account B cannot read A's four private audit columns                                                                                                                              | `tests/review/candidates.test.ts` → "returns none of the four private columns to B, while A reads every one of them": B's select resolves to `null` (absence, §6.4's below-HTTP form of "404, never 403") while A resolves all four with per-run-unique values                                                                                                                                                                                                                                                                                            |
  | …nor overwrite or delete the row                                                                                                                                                  | "refuses B's overwrite of the audit columns and leaves A's row byte-identical" (empty `RETURNING`, A re-reads column-for-column) and "refuses B's delete of A's session", with "still lets A rewrite A's own audit columns" as the positive control                                                                                                                                                                                                                                                                                                       |
  | A crafted request outside the UI gets a 4xx **and writes nothing**                                                                                                                | `tests/generation/generate.test.ts`, **six** refusal cases covering nine inputs — `sourceText` over the cap (raw, and again when it trims back under it), `count` below/above/non-integer, `language` off the whitelist, malformed `deckPublicId` and malformed `idempotencyKey`, `newDeckName` over 100 — each asserting the status **and** a **status-agnostic** session count, plus a deck count on the one path that could have created a deck                                                                                                        |
  | …with a boundary control, so the refusals are not an endpoint refusing everything                                                                                                 | "accepts a sourceText at exactly the limit and stores it whole"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | The source-text limit has exactly one definition                                                                                                                                  | `src/lib/generation-limits.ts`, imported by `api/generate.ts` **and** `GeneratorForm.tsx` (with `COUNT_MIN`, `COUNT_MAX` and `LANGUAGES`). Breakage: decouple the endpoint's own `.max()` from the shared constant → **exactly 2 of 20 red**, both over-limit cases, both on `expected 200 to be 400`, boundary control green                                                                                                                                                                                                                             |
  | No upstream auth string can reach a URL                                                                                                                                           | `tests/auth/errors.test.ts` (**55 cases as of 2026-07-31**; 33 when this row was written — the denominator moved under C10X-30 and again under C10X-34, so read any split quoted against "33" with its own date attached): a mapper keyed on `AuthError.code` with a documented `code → name → status → default` chain, "never lets an input substring reach the output", "has no empty constant in the closed set", and one endpoint case asserting the `?error=` param **equals** a project constant and contains neither the submitted address nor `{` |
  | An anonymous visitor is not told whether generation is live                                                                                                                       | **not a test — manual, and named as such.** The gate is per **entry** (`requiresSession` on `ConfigStatus`), applied in `Layout.astro`; the three browser-level checks are recorded in the change's `verification.md`                                                                                                                                                                                                                                                                                                                                     |

  **Four traps this slice paid for, so the next contributor does not.**
  - **Never scope a PostgREST filter by a long body.** `.eq("source_text", <a 10 000-char
string>)` answers **`414 URI too long`** — PostgREST carries filters in the query string and
    Kong caps the request line at ~8 KB. Measured against this stack: `n=8000` through,
    `n=10000` and `n=10001` → 414. That is exactly the over-limit case and its boundary control,
    so the oracle would have gone red for a reason unrelated to the behaviour. Scope by a short
    `<suffix>-<case>` marker in the first characters of every `sourceText` and query
    `.like("<marker>%")`. `succeededSessions` carried the same latent defect and was widened in
    the same edit.
  - **A status-filtered count is an argument, not an assertion.** `succeededSessions` filters
    `status = 'succeeded'`, so it is blind to the `failed` rows the 502/422 paths write. The
    bounds cases assert against a status-agnostic count instead; it happens to be sound either
    way today (every input-contract rejection returns before the first DB statement), which is
    precisely why the defect was invisible.
  - **On `generation_session`, neutering a write policy alone proves nothing.** With
    `generation_session_update` wide open the suite stays **20/20 green**: Postgres applies the
    **SELECT** policy to an UPDATE whose `WHERE` reads a column, so the restrictive select hides
    the row and the write matches nothing. Neuter select **with** the write policy. Same trap
    §6.8 records for S-05, one table over. Observed splits, from a `db`-live run: select alone →
    **2 of 20 red**; select + update → **3 of 20**; select + delete → **4 of 20** (the fourth
    being the positive control as a second-order knock-on). Restore verified by a `pg_policies`
    before/after dump, **diff empty**.
  - **A breakage check can come back green and be recorded as evidence for a claim it never
    tested.** The plan's own check for Phase 5 — "make the 502 body interpolate `err.message`" —
    **passes** against the HTTP-failure case, because there `err.message` is
    `"OpenRouter HTTP <status>"`, a string carrying nothing private. A fourth test case (a
    **transport** failure, where the upstream string _is_ `err.message`) was added rather than
    the check weakened; it then goes **1 of 4 red**, and a variant interpolating the source text
    goes **2 of 4**. Check what your check would observe before you trust its green.

  **What this does NOT prove — read this before citing Risk #4 as closed.**
  - **The dependency-emitted log lines.** They are inside Risk #4's scope and are **not owned
    here**: `@supabase/ssr/…/cookies.js:22,29` and `@supabase/auth-js/…/fetch.js:110` reach
    Workers Logs via `wrangler.jsonc`'s `observability`. They were measured and carry
    session/transport material — on `fetch.js:110` a fetch `TypeError`, not the request `init` —
    never pasted text. Pinning `node_modules` internals would break on every patch bump with no
    user-visible cause. **Nothing in this suite reads a real log sink**; the log half is a
    source-tree guard over first-party code, nothing more.
  - **The client-bundle half of the key question.** Closed by construction at three independent
    layers (`astro:env`'s `ServerOnlyModule` throw at build, the `_internalGetSecret`
    indirection, the key absent from CI) and deliberately recorded rather than re-tested.
  - **The provider contract.** The upstream shapes are fabricated by the fetch double, so a
    change to the prompt, the model or the real response format is invisible here. That is §3
    Phase 5's job, unchanged.
  - **The success path's audit columns.** Only the two failure branches are asserted.
  - **Anything an island renders**, as always (§7): `GeneratorForm`'s `maxLength`, `min`/`max`,
    `<select>` and char counter, and the banner gate itself, rest on the manual checks in the
    change's `verification.md`. Single-sourcing buys that the two ends cannot disagree about the
    **value**; that each end still enforces it is one assertion here and one pair of human eyes
    there.
  - **The card-content half of Risk #6** — the `FRONT_MAX`/`BACK_MAX` endpoints, excluded on
    purpose (they already share one constant with their islands). It is the single thing between
    §3 Phase 2 and `complete`.
    > **Closed 2026-07-28 by C10X-30** (`server-side-validation-test`), which flipped §3 Phase 2
    > to `complete`. Two of this bullet's own words did not survive the work: the exclusion's
    > reason ("they already share one constant with their islands") was true and still left the
    > constants with no enforcer beneath the app — a DB CHECK is now that second layer — and the
    > refusal these endpoints answer with is a **`302`**, not the `4xx` the entry above assumes
    > throughout. See §6.10 and this section's C10X-30 entry.
  - **The 502/422 error copy.** `error_message`'s wording on the 502 path is asserted non-empty,
    not pinned; the only copy assertion in the file is 422's literal, and it is there because
    substituting it for the upstream string **is** the no-leak property on that branch.

  Full evidence — every breakage edit, its observed failure string, its red/green split with the
  denominator, and each verified restore:
  `context/changes/ai-candidate-generation-test-2/verification.md` (after archiving:
  `context/archive/<date>-ai-candidate-generation-test-2/verification.md`). Before adding a
  module double of your own, read **§6.9** — it exists because of this slice and says where the
  seam may and may not go.

- **Phase 3 (`schema-drift-test`, C10X-29, 2026-07-28)** — Risk #5 is **covered for the drift
  classes named in §2's row, and this entry is about the GATE**, so its "does not prove" list
  below is a range (everything the history oracle cannot see) rather than a per-class coverage
  claim. The two are written to agree: §2 says which classes the project is protected against,
  this entry says what the gate itself observes. If they ever read as contradicting each other,
  §2's row is the coverage claim and this one is the mechanism.

  The gate is a **history oracle**: it compares the repository's migration **versions** against
  the cloud's `supabase_migrations.schema_migrations`, and never compares contents. Deliberate —
  the incident behind this risk was a `migration repair` desync over a byte-identical schema.

  | Claim                                                                             | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
  | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The comparator distinguishes the two drift directions rather than collapsing them | `tests/lib/schema-drift.test.ts`, **12 cases**: a local version absent remotely → `missingRemote` only; a cloud version with no local file → `missingLocal` only; both at once → **both**, not whichever it found first                                                                                                                                                                                                                                                                                                                             |
  | …and is not a function that simply rejects everything                             | the **positive control** — identical sets → clean. Load-bearing: without it every failure assertion in the file is satisfied by a comparator that fails on all input                                                                                                                                                                                                                                                                                                                                                                                |
  | The comparison is set-based, so this repository is not "drifted" today            | the real out-of-order pair (`20260712162349` applied _after_ the later `20260712162359`) asserted clean. An order-based comparator would call `main` drifted as it stands                                                                                                                                                                                                                                                                                                                                                                           |
  | An empty remote set is drift, not a pass                                          | fresh-or-wrong-project case → every local version in `missingRemote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | A malformed filename is surfaced, never silently dropped                          | the extractor returns a miss rather than throwing; a non-`.sql` entry is ignored, a `.sql` file with no leading timestamp is reported (extension matched case-**insensitively**, so `_x.SQL` lands here rather than being skipped). The runner prints it as its **own section with a different remedy** — `db push` cannot repair a filename                                                                                                                                                                                                        |
  | Two local files claiming one version are drift, not a clean run                   | **Added by this change's impl-review (F1), which found the opposite.** `schema_migrations.version` is the cloud's key, so a collision means at most ONE file can ever be recorded as applied — the other is committed and never applied, i.e. drift class 1. The `Set` that makes the comparison correctly order-blind was swallowing it, and the verdict read `clean`: measured, `{local:[a.sql,b.sql same stamp], remote:[stamp]} → clean:true`. Now a `duplicate` list folded into `clean`, with its own report section whose remedy is a rename |
  | The cloud's own version strings are held to the local side's shape                | **Added by impl-review (F6).** Remote versions are trimmed and must match `/^\d{14}$/`, else `GATE UNAVAILABLE`. Previously any string was accepted, so a trailing space or BOM printed the _same_ migration in `missingRemote` **and** `missingLocal` as two visually identical entries — sending the reader to `db push` and the `repair` runbook at once — and `""` printed a blank bullet                                                                                                                                                       |
  | The gate blocks the **deploy**, which is the claim the change exists to make      | a **paired** rehearsal on the feature branch, not a single run — see the breakage table below. Asserting the script's exit code would not have carried this: `needs: [ci, drift]` does                                                                                                                                                                                                                                                                                                                                                              |
  | Every non-success path fails closed, and says which kind of failure it is         | three paths exercised live — no token, no ref, and a real `401` round trip — each exiting **1** and printing `GATE UNAVAILABLE` (as opposed to `DRIFT`), so a red build separates "the schema is drifted" from "the gate could not find out" in the report while both still block                                                                                                                                                                                                                                                                   |
  | The secret stored in GitHub is the working credential                             | the control run's `drift` job reproduced `10 local entries against 10 applied cloud migrations` from inside CI, using the secret and nothing else. Phase 1 could not establish this from a developer machine — the API lists secret _names_, never values                                                                                                                                                                                                                                                                                           |
  | No credential reaches the log                                                     | both `drift` job logs downloaded in full: zero hits for `sbp_`, zero for `bearer`, zero for the project ref in clear. Masking is not the claim — the script never puts the token in a message                                                                                                                                                                                                                                                                                                                                                       |
  | A stale `src/db/database.types.ts` fails CI                                       | the `Check generated types against the schema` step, and the **staged** variant of its breakage check (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                   |

  **Deliberate-breakage checks, all run, with the splits as observed.**

  | Neuter                                                                                | Result                                                                                                                                                                                                                                                                                                                                               |
  | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `missingLocal` forced to `[]` — the `repair`-desync direction reported as clean       | **2 of 11 red**, both on `expected [] to deeply equal [ '20260601120000' ]`. The plan predicted **1**; the second red is the both-directions-at-once case, which asserts the same field by construction and is what stops the two directions collapsing into one. Positive control green. Recorded as observed rather than rounded to the prediction |
  | The rehearsal **pair** — same ref, same guards, one variable: a fabricated migration  | control run: `ci` success, `drift` **success**, `deploy` **success** (its wrangler step swapped for an `echo` marker). Gate run: `drift` **failure**, `deploy` **skipped**. Conclusions read from `gh run view --json jobs`, not from the UI's colours                                                                                               |
  | Criterion 4.4 **as worded** — hand-edit a line of `database.types.ts`, nothing staged | **green — the criterion as written does not go red.** `npm run db:types` overwrites the working tree before `git diff` runs, and `git diff --exit-code <path>` compares against the **index**, not `HEAD`                                                                                                                                            |
  | The same edit, then `git add`                                                         | **red**, printing the hunk. This is what CI actually does: after `actions/checkout` the index equals `HEAD`, so the step's real claim is "**regenerated ≠ committed**" — provokable only by bad content that is _committed_, never by a dirty working tree                                                                                           |
  | The DDL workflow's password guard, probed three ways                                  | all three secrets set → exit **0**; `SUPABASE_DB_PASSWORD` empty → exit **1** with its own message; `SUPABASE_PROJECT_ID` empty → exit **1** with its own. The all-set control is the point: a guard that fails on everything and one that fails on the right thing are indistinguishable without it                                                 |

  **Why the rehearsal had to be a pair, and it generalises.** The plan asked for one run —
  widen the `drift` job's `if`, push a fabricated migration, record `drift` red and `deploy`
  skipped. That run would have been **unfalsifiable**: `deploy` carries its own
  `github.ref == 'refs/heads/main'` guard, so on a feature branch it is skipped _whatever_
  `drift` does, and the skip produced by the branch guard would have read as a skip produced
  by `needs`. This is the same shape §6.6 has now recorded three times (the four-policy
  neuter that passed while the guard was disabled; the status-filtered count blind to the rows
  it claimed to check). The fix was a positive control: `deploy`'s guard widened alongside
  `drift`'s so the two runs differ in exactly one thing. All four temporary edits were
  reverted and the revert **verified** — `md5sum` against a pristine copy taken before the
  first edit, the fabricated file deleted, a tree-wide `grep` for the marker clean, and the two
  rehearsal commits dropped so the branch reaching the PR carries neither.

  **What this does NOT prove — read this before citing Risk #5 as closed.**
  - **No test in this suite touches the cloud, and none ever will.** `npm test` covers the
    comparator (12 cases) and nothing else; `scripts/check-schema-drift.ts` has **no unit test
    and deliberately gets none**, because every branch in it is I/O against a live account
    credential — exactly what `tests/setup/preflight.ts` exists to abort (§6.4). The wiring is
    carried by the recorded live runs and by the CI job itself, never by an assertion. Do not
    read "Phase 3 complete" as "the suite tests the Management API".
  - **The gate compares versions, never contents.** Three drift classes are invisible to it by
    construction, and naming them is the point: a **migration file amended in place after it
    was pushed** (which `/ship` makes reachable, since `db push` runs from the feature branch
    before the merge — mechanism live, no observed instance here), **production changed by hand
    in Studio** (the channel exists: `supabase/snippets/` is gitignored), and
    **`repair --status applied` on something never applied**, where the history table lies by
    construction so no history oracle can help. All three need the on-demand DDL diff, which
    nobody is scheduled to run.
  - **Two classes have no check anywhere**: `supabase/config.toml` versus the cloud dashboard
    (`max_rows`, `jwt_expiry`, `site_url` — local-only values whose cloud equivalents live in
    the dashboard and need `supabase config push`), and **seed/dictionary row drift** (migra
    diffs schema, not rows). Out of the agreed scope, not overlooked.
  - **Stale generated types are invisible to THIS gate too.** The `drift` job never reads
    `src/db/database.types.ts`; that class is closed by a separate step in the `ci` job, which
    is a different job with a different trigger — so "the drift gate is green" says nothing
    about the types. And what that step asserts is "**regenerated ≠ committed**": see the 4.4
    rows above, where a dirty working tree provably cannot provoke it. Correct behaviour, not
    a hole, but it means the two checks are independent and neither backs up the other.
  - **The `db diff --linked` path WAS unexercised until the merge, and is now covered.**
    Until `schema-diff.yml` reached the default branch it could not be dispatched at all —
    measured, not inferred: the file pushed to a throwaway ref did not register in
    `gh workflow list` and a dispatch answered
    `HTTP 404: workflow schema-diff.yml not found on the default branch`. That is a permanent
    property of `workflow_dispatch` and the reason most of Phase 5 is ship-time work; there is
    **no honest workaround**, because adding a `push:` trigger to manufacture a run would
    change the trigger set whose exclusivity criterion 5.2 asserts. **Closed at ship time
    (2026-07-28)**: three real dispatches — two green from `main` (30380427876, 30380687338,
    matching, which is the calibration baseline) and one red from a scratch branch carrying a
    column-adding migration (30381750723). So link, Docker, the shadow replay against
    production and the database password are all now exercised, in both directions, with the
    green pair as the control. Detail in the change's `verification.md`.
  - **The calibration baseline is EMPTY, which is not what the plan expected.** It warned that
    migra reports false positives on extensions and grants and that an uncalibrated first run
    would look like drift. On this project it does not: both green runs printed
    `No difference between the deployed schema and a replay of the migrations.` with a
    zero-byte diff. There is no noise filter because none was needed — so if a future run is
    non-empty, treat **every** line as a candidate for real drift rather than hunting for the
    known-noise list that this entry would otherwise have carried.
  - **The `429` retry has never fired.** The endpoint defines the status; provoking one would
    mean hammering the real API. Carried by reading.
  - **The endpoint the gate depends on is documented as partner-only.**
    `GET /v1/projects/{ref}/database/migrations` is marked available to selected partner OAuth
    apps and answers **200** to a plain PAT anyway. That is a documented restriction that
    happens not to be enforced — a weaker guarantee than a documented contract. If it is ever
    enforced the gate fails closed (correctly) and the fallback is
    `POST /v1/projects/{ref}/database/query`, measured at the same time and answering **201**,
    which is why the runner branches on `res.ok` and never on `status === 200`.

  Full evidence — every probe, breakage edit, observed failure string, red/green split with its
  denominator, and each verified revert:
  `context/changes/schema-drift-test/verification.md` (after archiving:
  `context/archive/<date>-schema-drift-test/verification.md`). The nine drift classes are
  enumerated once, with their mechanisms and which oracle sees each, in that change's
  `research.md`.

- **Phase 2, third slice (`server-side-validation-test`, C10X-30, 2026-07-28)** — Risk #6's
  **card-content** half is covered on the server, which closes §3 Phase 2. The entry states
  its boundary in the same breath: **the server half is asserted, the island half is not**,
  and on these endpoints the refusal is a `302`, not the `4xx` five documents said it was.

  Two things about the shape of the work, because neither was visible when C10X-28 scoped
  this as "one named test". The validation logic in `src/` **was already correct** — four
  lines on two endpoints, refusing before any write — so the slice's job was to make it
  observable and to give it something underneath: `FRONT_MAX`/`BACK_MAX` had **no enforcer
  below the app**, the residual risk S-02 recorded on 2026-07-09. And the same four form
  endpoints carried three genuine "server trusts the client" defects that a test of the
  length rule alone would have walked straight past.

  | Claim                                                                                  | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | An over-`FRONT_MAX`/`BACK_MAX` **create** is refused and writes nothing                | `tests/validation/cards.test.ts`, two cases: a state- and status-agnostic count scoped by `deck_id` asserted **first**, then `302`, then the decoded `error` **equal** to the project literal. The count-first order is what makes the breakage pair separable — see below                                                                                                                                                                                                                                                                                       |
  | …and the same on **edit**, where a count would prove nothing                           | the edit case's oracle is the **row**, `toEqual(before)` column for column (an over-max edit is an UPDATE, which leaves any count untouched however badly it goes), for both `front` and `back`, each with its own literal                                                                                                                                                                                                                                                                                                                                       |
  | …and the refusals are not an endpoint refusing everything                              | **three** boundary controls: create at exactly 200/1000, edit at exactly 200/1000, and a re-read asserting the stored strings are the submitted ones — length **and** equality, because a silent truncation to the bound satisfies a length check alone                                                                                                                                                                                                                                                                                                          |
  | The lower bound is one indistinguishable refusal                                       | missing, empty and whitespace-only `front` — three sub-cases, same message, no write. They measure 0 after the trim, so telling them apart from outside is not a property the endpoint has                                                                                                                                                                                                                                                                                                                                                                       |
  | The trim direction is the **mirror** of `/api/generate`, not a copy of it              | a 200-character front padded with trailing whitespace is **accepted** and stored at exactly 200. These endpoints `.trim()` before measuring; `/api/generate` caps the raw string. C10X-28's "trims back under it → still refused" does not transfer                                                                                                                                                                                                                                                                                                              |
  | A refusal does not echo the submitted content back                                     | the **raw** `Location` (before decoding — percent-encoding would hide a marker from a decoded read) contains neither the case marker nor the run suffix, and the decoded `error` is one of the two project literals                                                                                                                                                                                                                                                                                                                                              |
  | A body that is not a form at all is an owned redirect, not a framework `500`           | one case per endpoint. On create the `Location` carries `open=create-card` and `Nie udało się utworzyć fiszki`; on edit it carries `edit=<cardPublicId>` and `Nie udało się zapisać zmian` — the **unscoped** fallback, which is the ordering constraint below made assertable                                                                                                                                                                                                                                                                                   |
  | A `File` part does not crash the handler                                               | a multipart `front` of type `File` reads as empty and falls into the length guard the endpoint already owns — the existing Polish message, no new copy                                                                                                                                                                                                                                                                                                                                                                                                           |
  | The database refuses the same content **independently of the endpoint**                | direct RLS-scoped inserts (around the endpoint, never around the lock): 201-character `front` and 1001-character `back` each `23514`, asserted by **code** as `deck_session_size_check` is in `study.test.ts`, with an in-range insert as the positive control                                                                                                                                                                                                                                                                                                   |
  | `/cards/batch`'s `IDS_MAX` is bounded on the server — the **only** place it is bounded | `candidates.test.ts`: 101 **distinct, well-formed** UUIDs → `400`, JSON content type, and the one real card in that body `toEqual(before)`. Distinct on purpose — the endpoint's dedupe runs after the schema, so 101 repeats of one id would be refused for a different reason and prove less. Unlike the length limits this bound is **not** single-sourced: `CandidateReviewWorkspace.tsx:27` mirrors it as a commented copy (`BATCH_MAX = 100`, chunk size) rather than an import, so the two can drift silently and the server assertion is the whole guard |
  | The two auth routes answer their own copy on a malformed body                          | `errors.test.ts`, two cases: a non-form body and a `File` `email` part → `302` to `/auth/signin` with `error` **equal** to `AUTH_VALIDATION_MESSAGE`, and the crafted address not echoed. The `File` case also asserts `not.toBe(AUTH_GENERIC_MESSAGE)` — measured: posted verbatim, GoTrue's reply maps to the catch-all, i.e. no reason at all                                                                                                                                                                                                                 |

  **The breakage PAIR, and why one run could not have done it.** Run 1 decoupled the
  endpoint's comparison (`> FRONT_MAX` → a literal `> 100000`, never raising the shared
  constant, which the endpoint, three islands, `openrouter.ts` **and the test** all import).
  **2 of 12 red**, the predicted {case 1, case 8}, both on the message equality. Run 2 kept
  that edit and additionally dropped `flashcard_front_check` against the live local DB:
  **3 of 12 red**, {case 1, case 8, case 11}. Case 1 is red in both runs **and for different
  reasons** — run 1 on the message with its count **passing** (that pass is the evidence the
  CHECK absorbed the write), run 2 on that same count. The difference in failure string is
  the proof, not the reds; with the message asserted first, run 2 would have printed run 1's
  string verbatim and the pair would have separated nothing.

  Four things this slice paid for, so the next contributor does not:
  - **A `302` refusal and a `302` success are the same status**, so a status assertion is
    worthless alone and `toContain("error=")` is worse than useless: under run 1 the
    endpoint still answered `302` with an `error=` param — a different one, from its generic
    failure branch. Only an **equality** assertion went red. This is now §6.10.
  - **The helper your need points at is the wrong one.** "Count this deck's cards" lands on
    `countFlashcards` (`flashcards.ts:167-173`), which filters `state_id = STATE_ACCEPTED`;
    `listFlashcards` (`:76-83`) carries the same filter. A card written in any other state is
    invisible to both, so "count unchanged" reads green over a real write. Same class as
    C10X-28's status-filtered count, one layer down.
  - **Restoring a dropped CHECK is not symmetric with restoring a function.** The suite
    persisted three rows the constraint forbids while it was absent — all carrying the run's
    own suffix, all in the run's own decks — so `add constraint` fails with
    `violated by some row` until they are deleted. Inspect, repair, re-add, then `diff` the
    `pg_get_constraintdef` before/after. And know what that diff does **not** establish: it
    is a text match, identical for a constraint that came back `NOT VALID`. Probed
    behaviourally as well, in a rolled-back transaction, with an in-range insert as the
    positive control.
  - **The `-i` echo is not the strongest evidence that a `psql` drop applied.** psql echoing
    `ALTER TABLE` and the `pg_constraint` re-read come from the same session that issued the
    command. The independent corroboration is **case 11's red in run 2**, reachable only if
    the constraint was genuinely absent when the suite ran in a different process over
    PostgREST. A silently no-opped heredoc — §6.6's recorded failure mode — would have left
    it green.

  **What this does NOT prove — read this before citing Risk #6 as closed.**
  - **The two deck-form endpoints, which were missed entirely** (impl-review F1, 2026-07-28).
    `decks/index.ts:22-23` and `decks/[publicId].ts:31-32` still read `formData()` unguarded
    and still carry `((form.get("name") as string | null) ?? "").trim()`, so a crafted
    non-form body answers an uncontrolled framework `500` and a `File` `name` part crashes
    the handler — the exact two defects this slice fixed one directory over. There are
    **six** `formData()` readers in `src/pages/api/`, not four; the plan's Current State
    enumerated four and nothing in "What We're NOT Doing" excluded the other two, so this is
    an incomplete sweep rather than a scoped exclusion. They have a 1–100 name rule and a DB
    CHECK (`init_core_schema.sql:45`) already, so §6.10's breakage-pair design transfers to
    them unchanged. Deferred by decision at impl-review triage and raised as **C10X-37**.
  - **The island half.** The three card islands import the same constants, so the two ends
    cannot disagree about the **value**; that each end still enforces it is a separate claim
    and only the server half is asserted. And these islands differ from `GeneratorForm` in a
    way that matters: they carry **no `maxLength`**, so their over-length branch is genuinely
    reachable through the browser rather than being a second belt behind an input stop (§7).
    It rests on the manual checks in the change's `verification.md`.
  - **The cloud's data.** The pre-`db push` row check ran read-only against production and
    found `bad_front`/`bad_back` both 0 over 38 rows — a point-in-time observation recorded
    in `verification.md`, not a gate. The migration itself is pushed by `/ship`, and the
    `drift` gate (C10X-29) is what enforces that a committed migration reached the cloud.
  - **The generation write path's own bounds.** `insertCandidates` stays unvalidated at the
    insert site; its content bound is still `openrouter.ts`'s Zod schema. The new CHECK is a
    free backstop there with one consequence recorded rather than guarded against: a
    single over-length card would now fail the **whole batch**, not just itself.
  - **Auth input rules.** Nothing here asserts presence, format or length of credentials —
    those routes still call GoTrue with whatever they were given. That is **C10X-36**
    (`auth-input-validation`), deliberately left open; the test file says so in a comment so
    a green run of that `describe` cannot be read as "auth input is validated".
  - **`PATCH`.** Neither card endpoint exports a `PATCH` handler. The five documents that
    said "POST/PATCH" were wrong; they are corrected here and, as a dated correction line,
    in C10X-28's archived `change.md`.

  Full evidence — the cloud probe, every breakage edit, its observed failure string, its
  red/green split with the denominator, the constraint-definition diffs and the verified
  restores: `context/changes/server-side-validation-test/verification.md` (after archiving:
  `context/archive/<date>-server-side-validation-test/verification.md`).

- **Phase 5 (`ai-candidate-generation-test-3`, C10X-31, 2026-07-29)** — Risk #7 is **covered
  as far as a proxy can cover it, and the boundary belongs in the same sentence: the judge
  measures language fidelity and usability, never the 75% acceptance rate — only real users
  produce that metric.** This is the project's first AI-native layer and it is NOT part of
  `npm test`: `npm run eval` (= `vitest run -c vitest.eval.config.ts`, `OPENROUTER_API_KEY`
  in the shell environment) runs a 10-case language matrix through the production
  `generateCandidates()` against the real provider and exits with the verdict's code.
  Exclusion from the ordinary suite is structural — the second config's `include` collects
  only `evals/**/*.eval.ts`, so `npm test` sees zero eval files while `vitest.config.ts`
  and `tests/setup/preflight.ts` stay byte-identical — and the eval's own preflight is the
  INVERSE of the main one: it fails when the key is ABSENT on either seam
  (`astro:env/server`, the generator's; `process.env`, the judge's), because with no key
  `generateCandidates()` silently returns fixed Polish mock strings and a PL fidelity case
  would pass vacuously.

  The matrix: cases 1–5 run `language: "auto"` over authored reference texts in
  PL/EN/ES/DE/FR (`evals/fixtures/reference-texts.ts` — distinct topics, so a
  cross-language contamination in a verdict is attributable); cases 6–10 force each
  whitelist language over the fixed PL text. Case 6 (`polski`×PL) is the identity positive
  control. Judge: `google/gemini-2.5-flash` via OpenRouter, `temperature: 0`, one card per
  call, `EVAL_JUDGE_MODEL` override — a different model family from the generator's
  `openai/gpt-4o-mini`, so the generator never grades itself. Structured outputs
  (`response_format: json_schema`) SHIPPED as the judge request shape — the documented
  fallback was never needed. Thresholds, kept unchanged by the calibration decision:
  language fidelity 100% per case (hard), usability ≥80% aggregate; floors: ≥1 card per
  case, aggregate skip-rate <50%. Count compliance and skip-rate are REPORTED, never
  gated — a first measurement cannot be a blindly-tuned gate.

  | Claim                                                                | What proves it                                                                                                                                                                                                                                                                                                                                                                        |
  | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `auto` produces cards in the source language, all five languages     | cases 1–5: 25/25 cards `language_ok` in every complete run of the calibration day (four runs)                                                                                                                                                                                                                                                                                         |
  | The forced path is PARTIALLY broken — the first real finding         | `forced/niemiecki` and `forced/francuski`: **0/5 cards in the target language, every card Polish, four of four runs**; `forced/hiszpański` intermittent (4/5 in four runs — one mixed card — 5/5 once). Mechanism visible in the cards: the prompt says `Write the flashcards in this language: niemiecki.` — a Polish exonym in an English sentence (`src/lib/openrouter.ts:98-111`) |
  | "Generation broken" is separable from "the eval refuses everything"  | case 6 (`polski`×PL, the identity positive control) and `forced/angielski` stayed green in every run while de/fr stayed red                                                                                                                                                                                                                                                           |
  | The judge observes the EXPECTATION, not an incidental pass           | breakage check, judge leg: `auto/en`'s `expectedLanguage` → `niemiecki` turned **exactly that case** additionally red (`5/5 cards not in niemiecki (detected: English)`); every other case identical to baseline; reverted, diff clean                                                                                                                                                |
  | The run-level floor is what fires, not a per-case assertion          | breakage check, floor leg: `SKIP_RATE_CEILING` → `0` → the `afterAll` run-level assertion failed with the floor's own message; reverted, `npm test` 219/219 re-proved the restored semantics deterministically                                                                                                                                                                        |
  | The judge grades correctly on both prompt paths                      | spot-checks against a human read (recorded): the mixed card (ES front, PL back) → `language_ok=false, usable=false`; a grounding violation (an answer not in the source text) → `usable=false` — the rubric bites for real                                                                                                                                                            |
  | Threshold/floor semantics are deterministic facts, not judge opinion | `tests/lib/eval-scoring.test.ts` in the ordinary suite (12 cases): the 80% usability boundary, one-bad-card language fail, empty-list floor, 50% skip-rate edge, and the all-good positive control                                                                                                                                                                                    |
  | The success-path audit columns persist (the C10X-28 hand-off gap)    | `tests/generation/generate.test.ts` "records the five audit columns…": mock-mode POST, then `status`, `source_text` by EQUALITY, `model` ending `" (mock)"`, `language`, the three counters, and serialized-column CONTAINMENT on `request_payload`/`response_payload` (the C10X-28 precedent: pin presence, not shape)                                                               |
  | Count compliance and skip-rate exist as numbers for the first time   | measured across the calibration day: count compliance 50/50 (100%), skip-rate 0% — the generator's Zod layer dropped nothing. First data for the trigger condition of the S-04 plan-review F5 lever (the 1-shot corrective re-call)                                                                                                                                                   |

  Operational facts a future runner needs: one full run ≈ **$0.012** (10 generations + ~50
  judge calls; the whole six-run calibration day stayed under ~$0.10), wall-clock 117–312 s
  observed. The calibration rule: **a red case is re-run once by hand before being
  believed — two reds = real.** Two judge-client adaptations were measured before being
  written: `reasoning: { enabled: false }` (gemini-2.5-flash's thinking tokens drew from
  `max_tokens` and truncated verdicts mid-key; raising the budget did not help), and a
  truncated verdict body (HTTP 200, `finish_reason: "error"`, ~10% of calls, in bursts) is
  a TRANSIENT class retried twice with growing backoff — every other parse/HTTP error still
  throws loudly, because an unreachable judge must never read as a verdict.

  **What this does NOT prove — read this before citing Risk #7 as closed.**
  - **The 75% acceptance rate.** The judge is a proxy for quality; the product metric is
    produced by real users on the review screen, and nothing here measures it.
  - **The finding is FOUND, not fixed.** The forced-language defect ships in production
    today; fixing the prompt (candidate: name the target language in English or natively —
    `German`/`Deutsch`) is its own follow-up, with this eval as the acceptance check.
  - **No CI leg.** The `workflow_dispatch` leg (schema-diff.yml idiom, per-step secrets, a
    separate OpenRouter key with a low credit limit) was deliberately deferred at
    planning — local-only, human-triggered, no schedule, same rule as the DDL diff (§5).
    To be ticketed via `/jira-backlog-sync`; named in roadmap H-06's row.
    > **Closed 2026-08-02 by C10X-42** (`eval-ci-dispatch`, roadmap H-10). The bullet stands
    > as the record of what C10X-31 decided and is NOT rewritten — the C10X-30 "4xx"
    > precedent. What is no longer true is the **location**: `.github/workflows/eval.yml`
    > exists and runs `npm run eval` on `workflow_dispatch`. Everything else in the bullet
    > survives, and the distinction is the whole point of this correction line —
    > "human-triggered", "no schedule" and "same rule as the DDL diff (§5)" are all still
    > true, because `workflow_dispatch` **is** human-triggered. It was ticketed as predicted.
  - **One run per case, no statistical power.** A single green is one sample at
    temperature 0.4; the re-run-once calibration rule is the mitigation, not a fix.
  - **Judge verdicts are themselves an LLM's opinion**, calibrated once by hand (the
    spot-checks above). `EVAL_JUDGE_MODEL` exists precisely so a suspect verdict can be
    cross-examined with a different judge.
  - **`npm test` still never touches the real provider** — unchanged, by design. The eval
    is the only thing that does, and only when a human runs it.

  Full evidence — the run table verbatim, both judge adaptations with their measurements,
  both breakage checks with observed failure strings, and the calibration decision:
  `context/changes/ai-candidate-generation-test-3/verification.md` (after archiving:
  `context/archive/<date>-ai-candidate-generation-test-3/verification.md`).

- **Roadmap slice H-03 (`auth-error-copy`, C10X-34, 2026-07-31)** — not a §3 rollout phase. It
  is recorded here because it closes the **read** end of the `?error=` channel C10X-28 opened
  (Risk #4's auth half), gives the OpenRouter banner gate its first automated coverage, and
  because it is the change that ended this file's own denominator rot. Its framing is unusual
  and worth carrying: **the deliverable it was ticketed for was already on `main`**, shipped as
  side work under a foreign ticket key (C10X-28's Phase 1 and Phase 4 §1, every commit scoped
  `(C10X-28)`). So this slice audited what landed "along the way" and fixed the edges — which is
  where the interesting findings were.

  | Claim                                                                           | What proves it                                                                                                                                                                                                                                                                                                                                                                        |
  | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The most common ordinary auth error stops reading as the catch-all              | `tests/auth/errors.test.ts`: `anonymous_provider_disabled` → `AUTH_MISSING_CREDENTIALS_MESSAGE` as a pure row **and** through the real `/api/auth/signup` route (the File-part case, re-pointed from `AUTH_GENERIC_MESSAGE`). GoTrue reads an empty address on `/signup` as an anonymous sign-in attempt — measured, and the two routes answer **different** codes for the same input |
  | The catch-all's "Spróbuj ponownie" no longer survives where a retry cannot work | four new constants behind `email_address_not_authorized`, `email_provider_disabled`, `captcha_failed`, `conflict` (plus `request_timeout` reusing the network copy). **Retry semantics, not wording, is the property** — and five of the six are INFERENCE, see the does-NOT-prove list                                                                                               |
  | The `name` rung is observed on `name` **alone**                                 | the case titled so now feeds `status: 0` (what auth-js's `fetch.js` passes for a real transport failure) instead of `503`, which reached the same constant through `messageByStatus`. Two rungs, two inputs                                                                                                                                                                           |
  | `signup.ts`'s malformed-body discriminator is covered on **both** branches      | a body announced `multipart/form-data` with a boundary it does not contain → `AUTH_GENERIC_MESSAGE` by equality plus `not.toBe(AUTH_VALIDATION_MESSAGE)`. Costs no GoTrue budget: it returns before `createClient`                                                                                                                                                                    |
  | The closed set is enforced where a message is **consumed**, not only produced   | `ownedAuthMessage` (`src/lib/auth-errors.ts`) — membership by EQUALITY, `null` on anything else, so a crafted `?error=` degrades to **no banner**. Four cases including a value that CONTAINS a real message and a one-character truncation, plus the whole-set positive control                                                                                                      |
  | The banner gate's decision is per **entry**, not per block                      | `tests/lib/config-status.test.ts` (6 cases) over the extracted `visibleConfigStatuses`. Entries are **fabricated**; the real `missingConfigs` appears in no assertion, because it is import-time env and under the runner can only ever describe the local stack                                                                                                                      |
  | …and the self-hiding Supabase invariant is the one that matters                 | a `requiresSession: false` entry shown in **both** session states, and a mixed list signed-out returning only the ungated entry. That is the case a block-level gate breaks — see check F                                                                                                                                                                                             |
  | `src/` reads no build-time env                                                  | `tests/lib/no-env-access.test.ts` — a textual scan of the whole tree with two positive controls (the walker reaches >50 files; the patterns fire on six spellings while staying silent on `import.meta.url`). Same first-party-guard shape as `no-logging.test.ts`                                                                                                                    |
  | The auth error surface announces itself and its fields carry their errors       | **not a test — manual, and named as such.** `role="alert"` on `ServerError`; `aria-invalid` + `aria-describedby` on `FormField` only while an error is present; `autocomplete` on all six credential fields. Observed as DOM facts in a browser, asserted nowhere (§7)                                                                                                                |

  **Six deliberate-breakage checks, all run, splits as observed.** Denominators move phase by
  phase in this change (38 → 50 → 51 → 55 in `errors.test.ts`), so every row carries its own.

  | Neuter                                                          | Result                                                                                                                                                                                                                                               |
  | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A — remove the `anonymous_provider_disabled` map entry          | **2 of 50 red**, identical string on both: the pure row **and** the real-route signup case. The endpoint red is the load-bearing one — it shows the code arrives from upstream rather than that the table agrees with itself                         |
  | B — repoint `captcha_failed` at `AUTH_GENERIC_MESSAGE`          | **1 red** (filtered run, denominator 50) on its mapping row — and `keeps the distinct code classes distinct` **stayed GREEN**, which is how the false comment on that case was found                                                                 |
  | C — delete `AuthRetryableFetchError` from `MESSAGE_BY_NAME`     | **0 of 50 red against the test as it stood**, then **1 of 50** after one input changed. The pair is the deliverable: the first row is the finding, the second is the same neuter made catchable                                                      |
  | D — collapse `signup.ts:19` to always `AUTH_VALIDATION_MESSAGE` | **1 of 51 red** on the new case while the already-covered non-form case stayed green. The route still answered `302` to `/auth/signup?` still carrying `error=` — only the **equality** went red (§6.10 confirmed by measurement)                    |
  | E — make `ownedAuthMessage` return its input unchanged          | **2 of 55 red** (the plan predicted 1; the second is the empty-string half, recorded as observed). **What stayed green is the evidence**: the member case and the whole-set positive control, without which `() => null` reads as perfect protection |
  | F — gate the whole banner block when signed out                 | **2 of 6 red**, both on the ungated entry signed out; both `requiresSession: true` cases and the signed-in control stayed green. **That asymmetry is the evidence** — a block gate hides a gated entry just as correctly as a per-entry one does     |

  **Mutation testing on the mapper.** `npx stryker run --mutate "src/lib/auth-errors.ts"`
  (permanent `mutate` list untouched), 2026-07-31: **92.98% — 53 killed, 4 survived, 0 with no
  coverage**. C10X-28's run was 93.33% (42/3/0) before six map entries and `ownedAuthMessage`
  existed. **No assertion was added**: all four survivors are `ConditionalExpression` mutants
  stripping an `x !== undefined` / `raw === null` guard, and each was confirmed **equivalent by
  execution** rather than argued — `Object.hasOwn(map, undefined)` is `false`,
  `undefined >= 500` is `false`, and `AUTH_MESSAGES.includes(null)` is `false`, so every mutated
  branch returns what the original returns. Three of them are the same three C10X-28 classified;
  the fourth is the new helper's null guard, same class.

  **What this does NOT prove — read this before citing the auth surface as closed.**
  - **Five of the six new codes are INFERENCE, not measurement.** `email_address_not_authorized`,
    `email_provider_disabled`, `captcha_failed`, `conflict` and `request_timeout` cannot be
    produced against this project's local stack, and their `it.each` rows use the **same literal
    as the map key** — so the suite proves only that the module agrees with itself, and a typo'd
    or renamed code is invisible to it **and** to Stryker. No runtime guard is available
    (`error-codes.js` is `export {}`; the codes exist only as a type). The mitigation is an
    artifact, named in the module: all six were checked against the `ErrorCode` union in
    `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` at auth-js **2.105.3**.
    The two production-only divergences (`user_already_exists` under confirmations-on,
    `email_address_invalid` appearing hosted-only) are inference for the same reason.
  - **`AUTH_UNAVAILABLE_MESSAGE` is asserted nowhere**, deliberately: its branch needs
    `createClient() === null`, i.e. an `astro:env/server` double, and §6.9 admits one only for a
    claim unreachable otherwise. It was seen once end to end during Phase 4's manual checks and
    that changes nothing. A surviving Stryker mutant on it is expected, not a gap.
  - **The island and `.astro` halves, as always (§7)** — but **one of the three is now closed, and
    the sentence that used to end this bullet is no longer true** (corrected 2026-07-31 by this
    change's impl-review, F2). It read: "A regression deleting the `ownedAuthMessage(...)` call from
    `signin.astro` leaves the suite green." It did, and it no longer does —
    `tests/lib/auth-error-param-guard.test.ts` (**renamed 2026-07-31 by C10X-37 to
    `tests/lib/error-param-guard.test.ts`**, a `git mv`: it now drives a table of two surfaces,
    auth and decks, each against its OWN helper — the path in this paragraph and in the two §8
    entries below is repointed, the historical claims are not rewritten) is a textual guard over
    `src/pages/auth/**/*.astro`
    asserting **per line** that a read of the parameter is the same line that wraps it, so
    co-presence of an unused import cannot satisfy it. Proved falsifiable rather than argued:
    unwrapping `signin.astro:8` turns **1 of 3** red, naming file and line
    (`signin.astro:8: const error = Astro.url.searchParams.get("error");`), while **both positive
    controls stay green** — and, the reason the guard exists, `errors.test.ts` stayed **55/55 green
    through the same neuter**. Restored, `md5` identical to the pristine copy
    (`0e0221b42845c63a2130bcb7cfd7266a`), `git diff -- src/` empty. It proves the call is _present
    and composed_, never that its value reaches `serverError`. **Still resting on browser checks
    alone**: that both islands strip the parameter with `replaceState`, and that `Layout.astro`
    calls `visibleConfigStatuses` with `Boolean(Astro.locals.user)`.
  - **The field/description association covers the ERROR only, never the `hint`** (added
    2026-07-31 by this change's impl-review, F4). `FormField.tsx:69` emits `aria-describedby` on
    the same condition that renders the error `<p>`, which is what makes a dangling reference
    impossible — and `hint` is that condition's `else` branch, so it is never described. Concrete
    cost: `SignUpForm.tsx:74-80`'s live "N more characters needed" is **visible-only**, so a
    screen-reader user meets the guidance only after triggering the error it would have prevented.
    Left open by decision, not by omission — `hint` arrives as an opaque `ReactNode`, so an id
    needs a prop-contract change or a `cloneElement`, and the manual check that closed 5.6 would
    have to be re-run. Recorded at the site in `FormField.tsx` with the shape it would take.
  - **`role="alert"` is a shared edit with a wider blast radius than auth**, and the counts here
    are enumerated (`grep -rn "<ServerError" src/`), not carried over: **twelve call sites across
    eleven components**, ten of those sites (nine components) off the auth surface and every one
    of them a _dynamic_ insertion, which is the case the role is specified for. Exactly **one**
    of the ten was exercised (`GeneratorForm`); the other nine rest on the shared-component
    argument. Nothing here is evidence about what a screen reader announces — three manual rows
    are closed to the _mechanism_ only, because a screen reader and a password manager cannot be
    driven from automation.
  - **Nothing observes the URL cleanup automatically.** No assertion reads `window.location`.
  - **Other `?error=` consumers are untouched, and this one has an OWNER now** (added 2026-07-31 by
    this change's impl-review, F1). `decks/index.astro:22`, `decks/[publicId]/index.astro:86` and
    `review.astro:115` still read the parameter unconstrained; their messages come from a
    different set (or none), so the helper does not apply as written. What the review added is not
    the observation but the ticket: all three pass the raw value as `serverError` into an island
    that renders it through the **same** `ServerError` red banner (`decks/index.astro:34` →
    `CreateDeckModal.tsx:80`), i.e. the identical content-injection class this change closed on the
    auth pages — behind the middleware guard, so the victim must already be signed in, which lowers
    the severity and does not remove it. Every other deferred edge in this list carries a key
    (C10X-36, C10X-37); a live vector recorded in prose alone is how one becomes a rediscovery. **To
    be ticketed via `/jira-backlog-sync`** (same idiom as C10X-31's deferred `workflow_dispatch`
    leg): a deck-side closed set plus an `ownedAuthMessage`-shaped helper — membership by equality,
    `null` on anything else. The first step of that ticket is the thing this review did **not**
    establish: enumerate what the six deck endpoints actually put in `?error=` and confirm it is a
    closed set of literals.
    > **Closed 2026-07-31 by C10X-37**, and it shipped under C10X-37's key rather than its own —
    > **not** for lack of a key, as this line claimed until 2026-08-01 (C10X-40): the finding is
    > **C10X-40**, minted the same day the follow-up note said it had none. It shipped under a
    > foreign key
    > which is exactly the "fix landed under a foreign key" confusion this file keeps recording, so
    > the decision is written down in `deck-form-hardening/change.md` rather than left to be
    > inferred. Two things this bullet got right and one it got wrong. Right: the enumeration was
    > the first step, and it returned **eleven literals, a closed set**. Wrong: "the helper does not
    > apply as written" understates the sink count — there are **six**, not three, because
    > `[publicId]/index.astro` derives four from one read, and one of those six rendered the value
    > in raw `.astro` markup with **no** `role="alert"` and no companion parameter, so a bare
    > `/decks/<id>?error=X` reached it and no change to `ServerError.tsx` could ever have covered
    > it. See §6.6's C10X-37 entry.
  - **The two deck endpoints still carry the defects C10X-30 swept elsewhere** — unguarded
    `formData()` and the `as string | null` cast (`decks/index.ts:22-23`,
    `decks/[publicId].ts:31-32`). Owned by **C10X-37**; only the false _comment_ about them, in
    `src/lib/forms.ts`, is corrected here.
    > **Closed 2026-07-31 by C10X-37.** Both now guard `formData()` in a `try` and narrow through
    > `formString`, so the helper has six callers rather than four, and the comment corrected here
    > was corrected again to say so.
  - **Auth INPUT validation is still absent** (presence, format, length before the GoTrue call) —
    **C10X-36**. What exists on these routes is malformed-body handling only, and the test file
    says so in a comment so a green `describe` cannot be read as "auth input is validated".
  - **The auth UI is still English** (`signin.astro`, `signup.astro`, `confirm-email.astro`, the
    three auth islands) while the banner copy is Polish — **C10X-19**'s sweep. `confirm-email`'s
    new copy was written in English on purpose, to match the page it lives in.

  Full evidence — every breakage edit with its observed failure string and denominator, the
  verified restores, the Stryker register, and what each manual browser row actually showed:
  `context/changes/auth-error-copy/verification.md` (after archiving:
  `context/archive/<date>-auth-error-copy/verification.md`).

- **Roadmap slice C10X-41 (`forced-language-prompt-fix`, 2026-07-31)** — not a §3 rollout
  phase. It is recorded here because it is the first time this project's AI-native layer was
  used the way an eval is supposed to be used: **the defect C10X-31's first calibrated run
  FOUND is now fixed, and the same instrument is the acceptance check.** No risk row moves and
  no new coverage layer exists; what changes is that Risk #7's one known live defect is closed
  and re-measured, and that the matrix grew a case designed to make a green mean more.

  The defect and its class, because the class is the reusable part. `LANGUAGES`
  (`src/lib/generation-limits.ts`) was ONE value serving three roles: the API's Zod enum, the
  value persisted to `generation_session.language`, and the token interpolated into the English
  system prompt. Values chosen to serve a contract are chosen for a machine reader, so the
  prompt read `Write the flashcards in this language: niemiecki.` — a Polish exonym inside an
  English sentence — and the model answered in **Polish**. The fix is a rendering layer: the
  set moved into a `language` dictionary table with `code` (wire + audit), `ui_label` (human)
  and `prompt_name` (model), the endpoint resolves the name, and `generateCandidates` takes an
  already-resolved `targetLanguage: string | null`, so the generator module now carries no
  language vocabulary and no `"auto"` sentinel at all. The rule is in `lessons.md`
  ("Wartość kontraktowa … nigdy nie trafia do promptu LLM").

  | Claim                                                                             | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The forced path returns target-language cards for the two languages that were 0/5 | `forced/de` and `forced/fr` at **5/5**, in **both** acceptance runs (baseline: 0/5, every card Polish, four of four runs)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
  | …and the fix is the interpolated NAME, not the source text                        | **`forced/fr-on-en`** — French forced over the ENGLISH reference text, 5/5 twice. Every other forced case runs on the PL source, where a green is compatible with "the model followed the source language"; here Polish is absent from the request and the target is neither the source nor Polish                                                                                                                                                                                                                                                                              |
  | The instrument has not simply become permissive                                   | `forced/pl` (the identity positive control) and the five `auto/*` cases stayed 5/5, and one card was still judged `usable=false` in each run — a scorer that passes everything would not have produced that                                                                                                                                                                                                                                                                                                                                                                     |
  | The eval drives PRODUCTION code, not a copy                                       | it calls `generateCandidates()` with the same `targetLanguage` the endpoint resolves; the difference is only WHERE the name comes from — the table in production, `tests/fixtures/language-names.ts` in the eval                                                                                                                                                                                                                                                                                                                                                                |
  | A seed typo cannot slip between the two halves                                    | that fixture is the single pin: `tests/db/languages.test.ts` asserts every active row's `prompt_name` against it, `evals/fixtures/language-names.ts` re-exports it. Inline the strings on either side and the pin is gone                                                                                                                                                                                                                                                                                                                                                       |
  | The table's names and the endpoint's resolution are wired                         | `tests/db/languages.test.ts` (seed content, `sort_order`, the `is_active` filter falsified by a seeded-inactive `it` row, read-only enforcement) and `tests/generation/generate.test.ts` (**three** refusal inputs in one case — injection text refused by the regex, a well-formed unknown `xx` refused by the table, and a DEACTIVATED code refused the same way — each writing nothing; plus `row.language` carrying the CODE while `request_payload` carries the rendered NAME, two strings that now differ, which is what makes that assertion evidence the rendering ran) |
  | Deactivating a language cannot strand a user mid-retry                            | the ordering is a contract, not an implementation detail, and it has its own case: a keyed session still REPLAYS after its language is deactivated, because the lookup sits after the idempotency short-circuit and before deck resolution. Put it first and "Ponów" turns a recoverable replay into a `400` over cards that already landed (FR-018)                                                                                                                                                                                                                            |

  **The measurement worth carrying forward is a gap, not a claim.** Phase 3 changed
  `GenerateArgs.language` to `targetLanguage`; the eval kept passing `language:` for two
  phases whose every gate was green. Measured by reverting to `b015662`: `npx tsc --noEmit`
  exits **2** with exactly one error, `evals/generation-quality.eval.ts(96,9) TS2353`. Nothing
  in the gate set sees it — `npm run lint` is ESLint with type-aware RULES, not `tsc`
  diagnostics; `astro build` does not run `astro check`; and `npm test` never collects
  `evals/**`, by the deliberate isolation C10X-31 built. So **the acceptance instrument for
  Risk #7 can sit uncompilable behind a fully green branch**, and only running it says so.
  Recorded, not fixed: adding `tsc --noEmit` to the gate set is a gate change with its own
  blast radius and belongs to its own ticket.

  > **Closed 2026-08-03 by C10X-43** (`typecheck-gate`, roadmap H-11), and the paragraph above is
  > left standing rather than rewritten — it is the measurement that produced the ticket, and its
  > description of those three commands is still exactly right. What is no longer true is the last
  > sentence: the ticket exists, shipped, and `npm run typecheck` now runs in the `ci` job and on
  > `pre-push`. The blast radius the sentence anticipated was real and is recorded rather than
  > waved away — the gate turned out to need a wrapper rather than a one-line script, because
  > `astro check` exits 0 with its own tooling missing and is blind to a malformed `tsconfig.json`.
  > Two things this closure does NOT reach, and both matter for this entry specifically: the gate
  > proves the eval **compiles**, never that it RAN, and it cannot see a **collection-time** error
  > at all.

  **What this does NOT prove — read this before citing Risk #7 as closed.**
  - **The 75% acceptance rate**, unchanged from C10X-31: the judge is a proxy for quality and
    only real users produce the product metric.
  - **Nothing about CI.** The eval stays local and human-triggered; C10X-31's deferred
    `workflow_dispatch` leg is untouched (§5). "Covered on this date" ≠ "watched".
    > **Half of this is superseded 2026-08-02 by C10X-42; the bullet is not rewritten.** The
    > `workflow_dispatch` leg landed (`.github/workflows/eval.yml`), so "stays local" and
    > "untouched" are no longer true. The rest is, and it is the half that matters: the eval
    > is still **human-triggered**, still carries no `schedule:`, and **"covered on this
    > date" ≠ "watched" is unchanged** — a workflow nobody dispatches is watched by nobody,
    > which is exactly why C10X-42 stopped at the dispatch leg and did not add a cron.
  - **Two samples are not statistical power.** One sample per case per run, temperature 0.4.
    `forced/es` was the documented intermittent at baseline and is 5/5 twice here — that is
    encouraging, not proof the intermittency is gone.
  - **The CLOUD seed rows.** The eval reads no database and the suite reads the LOCAL one, so
    nothing here observes production's `language` rows. Seed-row drift is one of the two
    classes no oracle in this project covers (the C10X-29 entry above), which makes reading
    them once after `db push` a ship-time step rather than an inference.
  - **The island half**, as always (§7). The selector's contents, and the
    Studio-edit-without-a-deploy capability the table was chosen for, rest on browser checks
    recorded in the change's `verification.md`.
  - **The injection surface MOVED, it did not disappear.** The Zod enum over `LANGUAGES` was
    a prompt-injection guard (impl-review F3 on the generation slice); the interpolated string
    now comes from a table ROW. The request side is still bounded before any DB round-trip
    (`LANGUAGE_CODE_RE = /^[a-z]{2,8}$/`), and the row side is closed because the table is
    write-proof from the app through **two** independent enforcers — revoked write privileges
    for `authenticated` **and** the absence of any write policy. That second layer is not
    belt-and-braces: Supabase's default privileges `grant all` on every new table in `public`,
    so the migration's `grant select` line narrows nothing on its own, and the `revoke` is what
    makes it mean what it reads like. It also dictates the breakage check — adding a write
    policy alone leaves `tests/db/languages.test.ts` GREEN, because the missing grant absorbs
    the write, so the check is a **pair** (§6.10's shape, one table over). Whatever surface
    eventually writes `prompt_name` must open one of the two layers, and inherits the guard
    duty when it does — written down in the change's `follow-ups/admin-panel.md` so a future
    panel cannot inherit it silently.

  **One count in the C10X-31 entry above is now stale, and is corrected here rather than in
  place**: that entry describes a **10-case** matrix (5× `auto`, 5× forced), which is what
  C10X-31 shipped and what its recorded runs measured. It is **11** as of this change, and the
  five forced cases are named on the language CODE (`forced/de`, not `forced/niemiecki`) — the
  old→new mapping is in the change's `verification.md`, so the C10X-31 baseline stays readable
  against the new table.

  Full evidence — both acceptance runs with their seeds, tables, wall-clock and the baseline
  comparison; the `tsc` measurement with its verified per-file MD5 restore; and the one
  `usable=false` card that appeared in both runs:
  `context/changes/forced-language-prompt-fix/verification.md` (after archiving:
  `context/archive/<date>-forced-language-prompt-fix/verification.md`).

- **Roadmap C10X-37 (`deck-form-hardening`, 2026-07-31)** — not a §3 rollout phase. It is
  recorded here because it closes **two** items this file had carried as open with named owners:
  Risk #6's deck half (the two `formData()` readers C10X-30's sweep missed, that change's
  impl-review F1) and the **read** end of the `?error=` channel on the deck surface (C10X-34's
  impl-review F1, believed at the time to have no ticket at all — it has one, **C10X-40**, minted
  the same day; corrected 2026-08-01). The second shipped under the first's key by an
  explicit scope decision, recorded in the change's `change.md` — because "a fix that landed
  under a foreign key" is the confusion C10X-34 was itself written to untangle, and repeating it
  silently would have been the same defect one surface over.

  **Read the two halves as one mechanism, because that is why they are one change.** Both turn
  on a closed set of project-owned messages that the producers emit and the consumers vouch for.
  Building that set (`src/lib/redirect-errors.ts`, eleven members) is what made both halves
  assertable, and the enumeration behind it is the step C10X-34's review named as the
  prerequisite and did not do — re-derived at doc-sync rather than carried over from the plan:
  **no `.message` and no `String(err)` anywhere under `src/pages/api/decks/`**, `error.code` is
  read at exactly two sites and only as a `23505` discriminator, and **no `catch` block in that
  tree binds an exception variable at all**, so there is no upstream string in scope to
  interpolate. One `JSON.stringify` does exist there (`cards/batch.ts:45`) and is **not** a
  counter-example: it serialises that endpoint's JSON response **body**, and `batch.ts` is one of
  the three JSON endpoints this channel deliberately excludes. Scope the claim to **the redirect
  branches**, not to "any deck-route branch" — the looser wording was written here first and
  corrected by running the grep. The set is closed **by construction, not by a
  test** — which is exactly why the guard had to sit beside it.

  | Claim                                                                            | What proves it                                                                                                                                                                                                                                                                                                                                                                     |
  | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | An over-`NAME_MAX` create is refused and writes nothing                          | `tests/validation/decks.test.ts`: a raw count scoped by a per-case name **marker** with `.like()` asserted **first**, then `302`, then the decoded `error` by **equality**. The count-first order is what makes the breakage pair separable                                                                                                                                        |
  | …and an over-`NAME_MAX` rename likewise, where a count would prove nothing       | the **row**, `toEqual(before)` column for column — an UPDATE leaves any count untouched however badly it goes                                                                                                                                                                                                                                                                      |
  | …and the refusals are not an endpoint refusing everything                        | **two** boundary controls (create and rename at exactly `NAME_MAX`), each asserting the stored string's length **and** its equality with what was submitted — a silent truncation to the bound satisfies a length check alone                                                                                                                                                      |
  | The trim direction is the **mirror** of `/api/generate`, not a copy of it        | a `NAME_MAX`-character name padded with trailing whitespace is **accepted** and stored at exactly `NAME_MAX`. These endpoints `.trim()` before measuring; C10X-28's "trims back under it → still refused" does not transfer                                                                                                                                                        |
  | Missing, empty and whitespace-only are one indistinguishable refusal             | both endpoints, three sub-cases each. They measure 0 after the trim, so telling them apart from outside is not a property the endpoint has                                                                                                                                                                                                                                         |
  | A body that was never a form answers an owned redirect, not a framework `500`    | one case per endpoint; on rename the `Location` keeps the deck-scoped `open=rename` target, because `errorUrl` is built from the route param eleven lines above the read and is already UUID-gated                                                                                                                                                                                 |
  | …and so does a body announced as a form that does not parse                      | same, plus `not.toBe(NAME_MESSAGE)` — which pins that the **catch** answered rather than the length guard reading an unparsed body as an empty name                                                                                                                                                                                                                                |
  | A `File` part reads as empty rather than crashing the handler                    | `formString` narrows it to `""` and it falls into the length guard the endpoint already owns, so **no new message entered the closed set**                                                                                                                                                                                                                                         |
  | A refusal echoes nothing back                                                    | the **raw** `Location`, before decoding, carries neither the case marker nor the run suffix                                                                                                                                                                                                                                                                                        |
  | A duplicate name is refused and the existing deck is untouched                   | count **and** row, on a deck the case creates inside its own `it()` (§6.2)                                                                                                                                                                                                                                                                                                         |
  | The database refuses the same names **independently of the endpoints**           | direct RLS-scoped inserts → `23514`, asserted by **code and by constraint name `deck_name_check`** — the name read off the live stack with `pg_get_constraintdef`, never inferred from the `flashcard_front_check` precedent — with an in-range insert as the positive control                                                                                                     |
  | A crafted `?error=` value renders **no banner** rather than attacker-chosen text | `ownedRedirectMessage` — membership by **equality**, `null` on anything else, and `null` is a decision about what the user sees: `ServerError.tsx:8` renders nothing for a falsy message. `tests/lib/redirect-errors.test.ts` (6 cases) pins a containment attack, a one-character truncation, `null`/`""`, and — the load-bearing one — a positive control over the **whole set** |
  | …and the three deck pages still call it, per LINE                                | `tests/lib/error-param-guard.test.ts`, now a table over **two** surfaces with **different** helpers                                                                                                                                                                                                                                                                                |
  | All six redirect-style endpoints answer a signed-out caller themselves           | `tests/validation/signed-out.test.ts` (9 cases, **no database**), closing a gap §6.6 had carried since C10X-27 — and for all six rather than the two this ticket names, because a partial sweep left unstated is precisely what created C10X-37                                                                                                                                    |

  **The breakage PAIR, and this one separated the layers exactly as designed.** Run 1 decoupled
  both endpoints' comparison (`> NAME_MAX` → a literal `> 100000`; **never raise the constant**,
  which after Phase 1 six sites and the test all import, so raising it moves every side together
  and the suite stays green while proving nothing): **3 of 16 red**, all on the message equality
  (`expected 'Nie udało się utworzyć talii' to be 'Nazwa talii musi mieć od 1 do 100 znaków'`,
  and its rename twin), **with their count and row oracles passing** — and that pass is the
  evidence, because it is what shows `deck_name_check` absorbed the write. Run 2 kept that edit
  and additionally dropped the CHECK: **4 of 16 red**, the same three now failing on their
  **oracles** (`expected 1 to be +0`; the rename row diffing on `name` and `updated_at`) plus the
  DB-layer independence case (`expected undefined to be '23514'`). Same cases, different failure
  strings, in both directions — which is the whole reason §6.10 insists on the ordering.

  Three further falsifiability runs, each restored:

  | Neuter                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                            |
  | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `formString` → the `as string \| null` cast, on the **create** endpoint only | **1 of 16 red** — exactly the create-side `File` case, and it fails with the production defect itself: `TypeError: (form.get(...) ?? "").trim is not a function` escaping the handler. Its **rename twin stayed green**, which attributes the red to the neutered endpoint rather than to the case                                                                                                                |
  | `ownedRedirectMessage` → the identity function                               | **2 of 6 red** in `redirect-errors.test.ts` — the crafted-value case and the empty-parameter case. **What stayed green is the evidence**: the member case, the non-emptiness scan, the template case and the whole-set positive control, without which `() => null` satisfies every rejection case and reads as perfect protection. The plan predicted one red; the second is the `""` half, recorded as observed |
  | Unwrap `decks/index.astro`'s read                                            | **1 of 8 red**, naming file and line (`index.astro:27: const error = Astro.url.searchParams.get("error");`), both that surface's positive controls green, the auth surface untouched — and `redirect-errors.test.ts` **fully green through the same neuter**, which is the whole reason the page guard exists as a separate file                                                                                  |

  Two things about the restores rather than the runs. Dropping the CHECK let the suite persist
  **four** rows it forbids (three create-side names and the shared rename fixture, renamed to 101
  characters); all four carried the run's own suffix, were inspected before deletion, and were
  deleted before the `add constraint` — which is why that restore succeeded where C10X-27's
  `deck_session_size_check` restore failed with `violated by some row`. And the
  `pg_get_constraintdef` before/after `diff` came back **empty**, which is necessary and not
  sufficient: it reads identical for a constraint that came back `NOT VALID`, so the bound was
  also probed **behaviourally** in a rolled-back transaction — 101 characters and `''` both
  refused **by name**, an in-range insert accepted as the positive control.

  **What this does NOT prove — read this before citing Risk #6 or Risk #4's read half as closed.**
  - **The nameless CREATE refusals carry no row oracle at all, and the file says so rather than
    faking one.** Missing / empty / whitespace-only, the non-form body, the broken-form body and
    the `File` part submit no usable name, so there is nothing to mark and a marker-scoped count
    reads `0` before and after whatever the endpoint does — an assertion that cannot go red, the
    `listDueCounts` false-pass class one table over. A delta over account A's own decks is not the
    escape either: A is shared across **files**, and `generate.test.ts` and
    `isolation/decks.test.ts` both create decks as A in parallel workers, so the delta races.
    Consequence, and it is the one a reader would otherwise infer wrongly from the phase's
    headline: **under breakage run 1 these particular cases attribute nothing to either
    enforcement layer.** Their rename twins are where the same refusals get a real oracle, which
    is why every nameless case is routed through both endpoints.
  - **The island half**, as always (§7), and it sides with the card islands rather than
    `GeneratorForm`: neither deck input carries `maxLength` (measured), so their over-length
    branch is the branch a user meets. Carried by the browser matrix in the change's
    `verification.md`.
  - **`SUPABASE_UNCONFIGURED_MESSAGE`'s branch is asserted nowhere**, deliberately — reaching it
    needs `createClient() === null`, i.e. an `astro:env/server` double, and §6.9 admits one only
    for a claim unreachable otherwise. It is a set member and is covered as such by the whole-set
    control.
  - **`role="alert"` on the page-level banner buys the WEAKER half.** `ServerError.tsx:12-19`
    records the distinction and this surface is the weak case: the banner arrives by a full-page
    redirect, so the live region is present at MOUNT. The claim taken is that the node is
    **exposed as an alert in the accessibility tree** — verified — and **announcement is not
    claimed**. The real gain is that a hand-rolled thirteenth _render_ became the thirteenth
    _call site_ of one component: `grep -rn "<ServerError" src/` now returns **13 JSX usages
    across 12 files** (up from C10X-34's enumerated 12 across 11), and
    `decks/[publicId]/index.astro:170` is the first of them in an `.astro` file rather than an
    island. Counted by enumeration, not by adding one to the previous figure — this file has
    already recorded that exact count being wrong once.
  - **Nothing observes the URL cleanup automatically.** No assertion reads `window.location`; the
    islands' `replaceState` strip is browser-checked only.
  - **The page guard proves the read is lexically WRAPPED**, not that the wrapped value reaches
    `serverError`. Three files, three claims — helper, wiring, producers — and a green run of any
    one says nothing about the other two.
  - **`?error=` producers outside this surface are untouched.** The set and its guard cover the
    six redirect-style deck/card routes and the three deck pages. `AUTH_MESSAGES` stays a
    **separate** set on purpose (a mapper with its own reachability record and mutation run;
    merging would give each surface the other's vocabulary), and the JSON endpoints keep their
    JSON bodies.
  - **The cloud's data and schema.** Every assertion runs against the local stack, and there is
    **no migration**: `deck_name_check` ships in `20260705180246_init_core_schema.sql` and long
    predates this change, so the drift gate is not involved and nothing was pushed.

  Full evidence — every breakage edit, its observed failure string, its red/green split with the
  denominator, the constraint-definition diff, the behavioural probe and each verified restore:
  `context/changes/deck-form-hardening/verification.md` (after archiving:
  `context/archive/<date>-deck-form-hardening/verification.md`).

  > **Extended 2026-08-01 by this change's impl-review; suite 298 → 314, 26 → 28 files, and TWO
  > items in the list above moved.** Nothing about the claims table changes — the review found no
  > functional defect and re-verified every one of them — but two of the things this entry left
  > resting on prose are now enforced by tests that were each proved able to go red:
  > `tests/lib/form-endpoint-guards.test.ts` (7 cases) pins that all six `formData()` readers sit
  > under a `try` and every part is narrowed through `formString`, **and** that no deck route
  > interpolates a quoted literal into `?error=` — the two sweeps `src/lib/forms.ts` describes as
  > "found incomplete twice by reading, not by a red run"; `tests/lib/no-client-redirect-errors.test.ts`
  > (3 cases) enforces the server-only rule, whose stated reason turned out to be false (see §8).
  > The page guard also went 8 → 10: it had a hardcoded two-directory allowlist, so a raw `?error=`
  > read on any OTHER `.astro` page was never looked at. Read §8's 2026-08-01 entry with this one.

- **Roadmap C10X-39 (`local-stack-transport-flake`, 2026-08-01)** — not a §3 rollout phase, and
  not a coverage change either: **no risk row moves and the suite's claims are unchanged**. It is
  recorded here because it is the first entry in this file whose subject is the _harness's own_
  trustworthiness rather than the product's — it corrects a mechanism this file stated twice and
  had never measured, it replaces a reading with an experiment, and it closes the residual risk
  C10X-32's impl-review (F3) left explicitly open: a retried write that had in fact committed
  would have passed **silently** on `flashcard`.

  **Read the mechanism correction first, because it is the reason the rest exists.** §6.2 and §8
  both claimed Kong keeps its pooled connections idle for LONGER than the upstream does. Measured
  on the live stack: Kong's `upstream_keepalive_idle_timeout` is **60 s** (the 2.8.1 default, no
  override) and PostgREST/warp closes an idle keep-alive connection after **60.0 s** with Kong
  bypassed. They are **equal**, which is the pathological configuration rather than an ordering
  error — neither side reliably closes first, so whichever wins the race decides whether the next
  request finds a live socket, and that is exactly why the flake is occasional instead of
  deterministic. The idle half survives; the _shape_ does not: drops cluster in a burst's first
  1-2 s (43/43) after a median 27 s of quiet, not on the single first request after the gap. Both
  original sentences were inference, and both were wrong in the direction that sounds fixable.

  | Claim                                                                          | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The silent-seam list is **six**, not the two the wrapper's header disclosed    | the Phase 3 census: `tests/setup/retry-transport.ts` temporarily neutered so every **local non-`GET`** request is issued twice unconditionally (bypassing `isKongKeepAliveDrop`), then the suite read for which assertion notices. 316 replays and **27 red blocks** (26 tests + 1 failed suite) across a 332-case suite — and **23 of 29 files did not notice a thing**                                                                                                                                                                                                                                                                      |
  | …and every one of those six duplicates genuinely LANDED                        | the replay control, which is what separates "silent" from "the replay never happened": **81 × `POST /rest/v1/flashcard` and 18 × `POST /rest/v1/generation_session` answered `201 → 201`**, and the duplicate scan found 89 duplicated `(deck_id, front)` groups plus 18 duplicated `(source_text, status)` groups. Attribution is per **seam**, never per case colour, and every **green** duplicated group was traced to the helper that wrote it and the `it()` that owns it, by line number — which is how `generate.test.ts:352` escaped being filed as loud on a red belonging to a different seam                                      |
  | Three seams that look silent are not, and the reasons are worth carrying       | `deck` is LOUD by `deck_user_name_unique` (**64/64** replays `409`); a keyed `succeeded` `generation_session` is LOUD by the partial unique index S-05 added for idempotency (**5/5** `409`) — a second constraint quietly doing this job; and `ensureSchedule` is SAFE by construction, writing through `upsert(onConflict: "flashcard_id", ignoreDuplicates: true)`, so its replay is a no-op rather than a duplicate                                                                                                                                                                                                                       |
  | Each of the six is now loud                                                    | a case-scoped count of **one** immediately after the insert — `(deck_id, front)` for **three** of the four card seams (`createNonAcceptedCard`, `createCard`, `seedCard`), a raw `deck_id` count for the fourth (`insertDirect`'s `inRange` control, whose describe owns its deck and writes on one line only), `(user_id, source_text, status)` for `seedGenerationSession`, and the file marker + `status` for the seeded `failed` session. No new `it()`, no schema change, no product rule, so **the suite count does not move** — an unchanged number here is correct rather than suspicious                                             |
  | …and each was proved falsifiable **before** it existed                         | driven test-first: for every seam the duplicate was written with no oracle present (green — which reproduces that seam's census verdict at authoring time), then the oracle landed and turned **exactly one case** red, then the scratch was removed (green again). The denominators are **per-file** runs, not the full suite (1 of 23, 1 of 22, 1 of 13 depending on the file), and the column carrying the evidence is the green beside the red. Five reds read `expected 2 to be 1`; the sixth is a length assertion on a filtered list (`expected [ …(2) ] to have a length of 1 but got 2`), the count-vs-row distinction §6.10 records |
  | The before/after is the same experiment run twice                              | the census re-run: **0 silent seams**, against Phase 3's 6, with **669** replays behind it (156 × `POST /rest/v1/flashcard`, 60 × `POST /rest/v1/generation_session`) so the zero is not "the replay never happened". Red blocks 27 → **54**; all 27 of Phase 3's were matched into the 54 by set comparison, so **nothing that was loud went quiet**                                                                                                                                                                                                                                                                                         |
  | The local cause is removed, and the measurement is fixed-vs-control on one day | Phase 1 recreates the Kong container after `supabase start` with `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0`. Phase 5: **0 drops across 40 spaced full-suite runs** (0/40 red) with pooling off, against **20 drops across 23 spaced runs** over two independent stock-pool controls — same day, same machine, same suite, same oracle (`docker logs … \| grep -c "prematurely closed"`), same 35 s spacing                                                                                                                                                                                                                                         |
  | …and the quiet log is not the log of a dead proxy                              | three controls, all required and all met: the fixed matrix is **green** (0/40 red, 332 passed each run); `.kong_env` still reads `pool_size = 0` after the last run, so the setting did not revert mid-matrix; and the stock-pool control reproduced on its first attempt, **twice**                                                                                                                                                                                                                                                                                                                                                          |
  | The unsupported step is falsifiable rather than a shell incantation            | the `scripts/` split this repo already uses for the drift gate — a pure half (`scripts/kong-keepalive.ts`: the lever constant, `containerNames`, `buildRunArgs`, `parseKongEnv`) asserted by `tests/lib/kong-keepalive.test.ts` (**19 cases**, the +19 that moves the suite 314 → 333 — recorded as 18/332 until C10X-40 counted them by running the file, 2026-08-01), plus an I/O half that refuses to report success on anything it did not verify. Its adoption oracle is Kong's own dump of every resolved setting, `/usr/local/kong/.kong_env`                                                                                          |

  **The one decision the census turns on, stated because it is not obvious and it was measured.**
  The neuter returns the **first** response and discards the replay's. Returning the second
  collapses the run: every describe block gets its deck from a `createDeck` that throws
  `Setup failed: deck "…" was never written` unless it sees `Location === "/decks"`, and **64 of
  64** replayed `POST /rest/v1/deck` answered `409` — so the `beforeAll` would have died and the
  30-odd `seedCard` / `createNonAcceptedCard` sites behind those decks would never have run. The
  census would then have reported a _shorter_ silent list than the reading it exists to replace.
  Returning the first costs no signal, because only a row that actually landed can be seen.

  **Two additions to research's four, named rather than folded into a count** (§3's own
  discipline). `seedGenerationSession` was **confirmed, not discovered** — plan-review F8 put it
  in research's `.single()`-false-oracle trap list and in _neither_ its silent nor its loud list,
  and the census settled it. `createCard` in `study.test.ts` is a **genuine addition on no prior
  list**: its oracle is `listFlashcards(…).find(card => card.front === front)`, and a `find`
  returns the first match and cannot count, so the helper is blind by construction in all three
  files that carry it. **No subtractions** — nothing research called silent turned out to be
  already loud.

  **What this does NOT prove — read this before citing the flake as fixed or the seams as safe.**
  - **The fix is unsupported and per-machine, and every `npx supabase stop` wipes it.** It is a
    post-`supabase start` container recreation, not a configuration surface: no supported lever
    exists (verified against CLI v2.98.2 — Kong's container env is a hardcoded Go slice,
    `kong.yml` is `//go:embed`-ed, the image is not settable from `config.toml`, `[api]` exposes
    only PostgREST settings, and PostgREST has never had a keep-alive knob). A developer on a
    bare `npx supabase start` is back on the flaky configuration. **This is why the wrapper stays
    and must not be narrowed or deleted.**
  - **CI's step is PARITY, not necessity, and it is advisory by design.** Research measured CI as
    structurally immune — 10-13 s suite against a stack started 3-7 s earlier with a cold pool
    and exactly one invocation per run, so no socket can reach the 60 s it needs; empirically 52
    runs, 0 unexplained reds, 0 re-runs, ~25 pre-wrapper runs green. The step carries
    `continue-on-error: true` **on purpose**: the `ci` job is what `drift` and `deploy` declare in
    `needs:`, and an unsupported `docker` operation breaking on a CLI upgrade must not stop a
    release over a flake CI cannot have. Consequence a reader must not miss: **a green `ci` job no
    longer implies this step passed — read the step's own conclusion.** It is also the first thing
    to drop if it ever goes red.
  - **The wrapper still replays non-idempotent requests.** These oracles turn a silent double
    write into a loud one; they do not stop it happening, and narrowing the wrapper to `GET` would
    return the flake to full strength — Kong ships no `proxy_next_upstream`, so it never retries a
    non-idempotent method and already absorbs every idempotent drop itself (not one PostgREST
    `GET` drop reached a client in 23 h of one container).
  - **Silence is proven only for the seams that existed on the day the census ran.** A helper
    added tomorrow with no count after its insert is a new silent seam, and **nothing detects that
    class automatically** — there is no guard test over "every insert in `tests/` is followed by a
    count", unlike the sweeps §8's 2026-08-01 entry made falsifiable one surface over.
  - **Two `createCard` twins are loud only by ACCIDENT** and were deliberately left alone. The
    census classified `createCard` in `cards.test.ts` and in `isolation/flashcards.test.ts` as
    loud — but the first only because `findCardByFront`'s `.maybeSingle()` happens to answer
    `PGRST116 … Results contain 2 rows`, i.e. an error rather than an assertion. The helper is
    blind in all three files; two are covered by what the file re-reads afterwards. Closing "the
    list the experiment produced" was the instruction, so these are named rather than folded in.
  - **`flashcard` still carries no uniqueness constraint, and cannot.** Verified rather than
    assumed: `generate.test.ts` POSTs twice with no idempotency key into the **same** deck while
    `mockCards` returns identical fronts, so duplicate `(deck_id, front)` rows are legitimate
    there — every ordinary suite run leaves 6 + 2 such groups behind. The oracle is per-seam
    precisely because the database cannot hold this rule.
  - **One machine, one day, one Docker, one CLI** — and **the drop RATE is not a stable
    quantity**. The two controls differ by nearly sevenfold (1.38/run and 0.20/run, bracketing
    C10X-32's ≈0.55/run on both sides), and the phase did not isolate which of the two conditions
    that changed — a much smaller deck table, or a 9-12 s run against a 5-6 s one — moved it. A
    future contributor comparing against a single number quoted here is comparing against noise:
    **run a control in your own session.** Zero over 40 runs bounds the rate; it does not prove
    impossibility, and both idle timeouts are still 60 s and still untouchable.
  - **The comparison carrying the weight is fixed-vs-control on the SAME DAY**, not
    fixed-vs-C10X-32. The historical 22/40 was measured on a different day against a smaller
    database with an unrecorded spacing; it appears here as context and as the figure the
    original ticket named, never as the control. The two same-session controls bracket it on both
    sides, which is why they and not it are the baseline.
  - **The two halves of this change are independent, and neither is evidence for the other.**
    Phase 5 measures how OFTEN the replay happens locally and says nothing about what happens when
    it does; Phase 4 measures whether it is loud when it does and says nothing about the flake's
    rate. That separation was deliberate from the plan onward — an inconclusive Phase 5 would not
    have blocked the seam work — and it is the reason the seam oracles are not framed as
    contingent on the Kong fix.
  - **The drops' log LINES are gone** — the restore replaced the control container and took its
    log with it. Only the per-run counts survive, which is the oracle the plan specified; the
    line's text is on record from C10X-32 and from this change's research.
  - **No test in this suite touches Kong's configuration**, and none ever will. `npm test` covers
    the pure half (**19** cases, no Docker, no stack — this read `18` until 2026-08-01, the fourth
    and last site of that count, missed by C10X-40 because it spells the number out in prose while
    the three literal `18`/`332` figures were corrected; found by C10X-40's own impl-review, F6);
    `scripts/disable-kong-keepalive.ts` gets no
    unit test, because every branch in it is I/O against the local Docker daemon. The wiring is
    carried by the recorded runs, not by an assertion — the same boundary §6.6's C10X-29 entry
    draws for the drift runner.

  Full evidence — the census's full red set verbatim with its denominator, the replay control,
  the duplicate scan with per-call-site attribution, the six test-first breakage runs, the
  re-run census, both stock-pool controls with their per-run drop counts, and every verified
  cleanup: `context/changes/local-stack-transport-flake/verification.md` (after archiving:
  `context/archive/<date>-local-stack-transport-flake/verification.md`).

- **Roadmap C10X-42 (`eval-ci-dispatch`, 2026-08-02)** — not a §3 rollout phase, and **not a
  coverage change**: Risk #7's row does not widen, no test is added, and the suite count does not
  move. It is recorded here because it closes the second and last of C10X-31's two named
  deferrals (the first was C10X-41), and because it changes the answer to a question this file
  asks of every AI-native claim — **who can exercise the instrument, and what survives the run.**
  Until now: whoever had the OpenRouter key, a checkout and a working `npm ci`, and a terminal
  scrollback. Now: anyone with write access, from the Actions tab, with the verdict in a job log
  and the full record in an artifact.

  The design decisions worth carrying are all cases where the obvious copy of an existing
  precedent in this repo is **wrong**, which is the same architecture note `research.md` records
  about the two `env:` conventions: what look like rules here are discriminated decisions, and
  both discriminators resolve AGAINST the naive copy.

  | Claim                                                                           | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
  | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The eval runs on a clean runner with no database, no Docker and no `astro sync` | five steps and one env var. `evals/` touches no Supabase (two prose comments are the only hits), `vitest.eval.config.ts` omits `setupFiles`, and the `astro:env` runtime module comes from the Vite plugin's `load` hook rather than from `.astro/` — each proved by execution during research, the `.astro/` case by renaming the directory away and back with `md5sum` identical on all five files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | One step-level env var feeds BOTH key seams                                     | Astro's env loader calls Vite's `loadEnv(mode, envDir, "")` with an **empty prefix**, which overlays the whole `process.env` onto `.env` values; under Vitest the merged object is inlined into the `astro:env/server` virtual module. So `eval-preflight.ts:39` (`astro:env/server`) and `:46` (`process.env`) are both satisfied by one export. Corroborated independently by `ci.yml`, which feeds `npm test` the same way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | …and that mechanism is a **second, sharper reason** for per-step secret scoping | because the prefix is empty, every variable visible to that step is serialised into a module literal in the build. `schema-diff.yml` argues per-step scoping from `npm ci` running install lifecycle scripts on a public repo; this is an independent argument that applies to the eval step specifically, and both are stated at the site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
  | A red eval genuinely fails the step                                             | a **redirect, never a pipe**. `npm run eval \| tee eval-console.log` was MEASURED to exit **0 on a red run** — GitHub's default `run:` shell on Linux is `bash -e {0}` with no `pipefail` — i.e. verbatim the class `lessons.md` records as "a command that always exits 0 is not a gate". The status is captured with `\|\| STATUS=$?` so `-e` cannot abort before the summary is echoed and the upload is reached, and the step ends on an explicit `exit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | The artifact is uploaded on a green run too                                     | `if: always()`, a **deliberate deviation** from the repo's only artifact precedent. `schema-diff.yml`'s `if: failure()` is justified by "a green run's `diff.sql` is a zero-byte file"; here the green table IS the deliverable, because the calibration record needs the raw card/verdict pairs from PASSING cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | A re-run does not fail on the upload                                            | artifacts have been immutable since v4 and a second attempt uploading the same name **fails the step**, so the name carries `github.run_attempt`. This is not hypothetical hygiene: C10X-31's calibration rule is "a red case is re-run once by hand before being believed", which makes re-runs the standard procedure here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | The upload survives a timeout                                                   | the timeout is on the **step**, never the job. Whether an `if: always()` step runs after a JOB timeout is **undocumented** — the cancellation reference re-evaluates `if` only for jobs that continue to run, and never mentions timeouts — while a step-level timeout is documented to kill the process and let the job continue. Sized against 11 sequential cases × the 120 s `testTimeout` ≈ 22 minutes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
  | The default dispatch is not the broken one                                      | **the two model inputs travel different seams and are written differently on purpose.** `generator_model` → `OPENROUTER_MODEL` on the step's `env:`, where empty is CORRECT (`astro/templates/env.mjs` maps `'' → undefined`, so it falls through to the default). `EVAL_JUDGE_MODEL` is `process.env` only and was read through `??`, which does **not** fall through on `""` — and GitHub resolves an unprovided input to the empty STRING. Left alone, a no-input dispatch would have sent `model: ""`, OpenRouter answers `400`, and `judge.ts:128` classes `400` as neither `429` nor `≥500`, so it throws on the first card of the first case with no retry. **Two independent guards ship**: the workflow exports the variable only when non-empty, and `resolveJudgeModel()` moved `??` → `\|\|`                                                                                                                                       |
  | A missing secret fails in seconds, not after a 60 s install                     | a `test -n` guard in the `schema-diff.yml` idiom, placed before `npm ci`. Its comment states what it is NOT: the eval's own preflight already closes this seam on both sides, so the guard buys placement, not coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | Two dispatches never run concurrently against one account                       | `concurrency` grouped on `github.workflow` **alone** with `cancel-in-progress: false`. The common `${{ github.workflow }}-${{ github.ref }}` would put two branches in different groups and run them **at the same time**. The comment states the effect precisely — with `cancel-in-progress: false` the second dispatch queues and then runs, so **both still pay**; what the grouping buys is serialisation, not deduplication — because a separate key gives spend isolation and **not** rate-limit isolation                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | The verdict survives the run in a readable form                                 | the eval writes `eval-report.log` (card record + summary) and `eval-summary.log` (summary alone) on **every** run, local and CI alike — one code path, so CI has no branch nobody has executed. The workflow echoes the summary file into the job log and uploads all three files. This is `schema-diff`'s "the log keeps the verdict, the body goes to an artifact" shape obtained **without** coupling the YAML to a string literal owned by `scoring.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
  | …and the write cannot mask the verdict                                          | the hook prints, then writes, then asserts. The write is wrapped so a failure is reported and swallowed: an unwritable filesystem must not turn a real generation defect into a write error. The run-level `expect` is reached in every case where it would have been reached before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | Neither report file becomes an untracked straggler                              | both end in `.log`, which `.gitignore:20` already covers. The extension is load-bearing rather than incidental and the file says so                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | Registration, both directions of the dispatch, and artifact immutability        | measured 2026-08-02, after merge `92bc9de` — a `workflow_dispatch` workflow is undispatchable until it reaches the default branch (C10X-29: `HTTP 404: workflow schema-diff.yml not found on the default branch`), so all of this is ship-time by construction. Registration as a **pair**: `gh workflow list` had `CI` + `Schema diff` before and gains `Generation quality eval` after. Green `30756678180` — `success`, 2m03s, 11/11 cases at 5/5 language, usability 54/55, count 55/55, skip 0%. Red `30756592782` with `generator_model=bogus/does-not-exist` — `failure` in 32s on `OpenRouter HTTP 400`, `"bogus/does-not-exist is not a valid model ID"`. **Artifact immutability came back the OTHER way and the row says so**: the re-run's `eval-2` uploaded fine, but attempt 1's `eval-1` was **deleted** — so the suffix prevents no collision reachable by `gh run rerun`, and the calibration re-run must be a fresh dispatch |

  **A written-down inference was measured and found false, in the reassuring direction.**
  `evals/generation-quality.eval.ts` claimed "Vitest 4 swallows console output of PASSING tests".
  Measured on this repo's Vitest 4.1.10: that is a property of the **`agent` reporter** — Vitest
  auto-selects it only when `std-env` sees `CLAUDECODE`/`CLAUDE_CODE`, and it is
  `MinimalReporter` constructed with `silent: "passed-only"` — and it is **false** under
  `default`, which is what a GitHub runner gets. So in CI the eval prints ~165 lines of card text
  on **every** dispatch, green ones included. Left uncorrected, the next reader concludes the CI
  log is already quiet. Same class as C10X-39's Kong keep-alive mechanism: inference written as
  fact, in the direction that reads as reassurance. Corrected at the site, with the corollary
  that `--disable-console-intercept` is an agent-terminal remedy and must **not** be copied into
  the workflow reflexively.

  **And the disclosure rationale it would have been natural to inherit does NOT transfer** — this
  is stated because the artifact split looks like a privacy control and is not. `schema-diff.yml`
  withholds the DDL body on two premises: content absent from the public repo, **and**
  security-relevant (the authorization logic nobody reviewed). Of the eval's four content
  classes, two — the reference source texts and the model names — are **already committed
  byte-for-byte**, and the other two (generated cards, judge rationales) are low-value
  derivatives of a published fixture through a published prompt. The API key is not reachable
  from any first-party error path: two sites only, both `Authorization` headers, and Vitest does
  not print the custom `rawRequest`/`rawResponse` properties (probed with marker strings; neither
  appeared). And the intuition inverts for the one theoretically sensitive class: **secret
  masking applies to logs, not to artifacts**, so an artifact is marginally _worse_ there. The
  honest reasons for a file are volume and a pre-registered first-party instruction — C10X-31's
  impl-review F5 planted a comment in `evals/lib/judge.ts` to be met by the builder of this
  workflow, and it is scoped to **one line**, the 300-character upstream body excerpt, not to the
  summary table. That comment is now a dated statement of where the message lands, with the
  qualification that an artifact on a public repository is downloadable by any signed-in user.

  **What this does NOT prove — read this before citing Risk #7 as watched rather than merely
  covered.**
  - **It proves the eval CAN run in CI, never that anyone runs it.** There is no `schedule:` and
    there is no notification channel, by the same decision that keeps a cron off `schema-diff`
    and parked C10X-35. A dispatchable workflow nobody dispatches refreshes no coverage date —
    which is why §8's "this coverage date does not refresh itself" survives this change verbatim.
  - **The 75% acceptance rate**, unchanged from C10X-31 and C10X-41: the judge is a proxy for
    quality and only real users on the review screen produce the product metric.
  - **`evals/` still sits under no type gate — and this change makes that exposure worse, not
    better.** `npx tsc --noEmit` is in no script and no CI job (C10X-43), so a type error in
    `evals/` surfaces only at run time. It now surfaces at run time **in CI, after paid calls**,
    rather than on a developer's machine. Deliberately out of scope: `jira-map.md` draws the
    boundary as "C10X-42 gives running-in-CI, C10X-43 gives compilability", and merging them was
    rejected rather than overlooked.
    > **Closed 2026-08-03 by C10X-43**, and the bullet is not rewritten — it is the record of an
    > exposure this change correctly named, scoped out and handed to a ticket that then shipped.
    > `npm run typecheck` is in `package.json` and in the `ci` job, and it covers `evals/`. The
    > boundary `jira-map.md` drew held exactly as written: C10X-42 gave running-in-CI, C10X-43
    > gives compilability, and the two stayed separate changes. What does NOT follow is the thing
    > this bullet's own framing guards against — a type-checked eval still surfaces a
    > **collection-time** error only at run time, in CI, after paid calls, because no type gate
    > sees an import throw, a top-level side effect or a bad `vi.mock` path.
  - **The red class Phase 4 exercises is INFRASTRUCTURE, not a real generation defect.** The
    controlled red uses a bogus `generator_model`, which fails at the first generation call —
    cheap, no commit, no revert. The two classes are indistinguishable by exit code (everything
    exits 1) and separable only from the output, so a reader must not take "a red dispatch was
    demonstrated" as "a red generation defect was demonstrated end to end". The one time this
    project has seen the latter is C10X-31's first calibrated run.
  - **The eval step's no-report branch ships UNEXERCISED.** All **four** job executions produce
    both report files — the three planned dispatches, because a bogus model throws _inside_ a
    test and `afterAll` still runs, and the unplanned fourth, which is the datum worth carrying:
    the BOM run (`30756346671`) threw **every one of its 11 cases** and `afterAll` still ran and
    still wrote both files. That is stronger evidence that the branch is hard to reach than the
    planned runs give on their own.
    Nothing in the plan reaches that state and nothing cheaply can — provoking it needs the
    secret removed or a broken commit on `main`. It is carried by reading, like the drift
    runner's I/O branches (the C10X-29 entry above). It has **five** causes, and the fifth was
    missed until this change's impl-review (2026-08-02): four kill the run before the hook
    (preflight abort, a collection-time error, the step timeout, any crash before `afterAll`),
    and the fifth is the report **write** failing after the hook ran — which matters because
    `writeReports` is deliberately best-effort, so it is the only cause that can leave the exit
    code **zero**. The branch as first shipped announced "the run never reached the eval's
    afterAll hook" and "the exit code does not separate them" in exactly that state, both
    provably false there; it now branches on `$STATUS`, and the non-zero side lists all five
    because a red eval whose write also failed is a real state. Because every stream is
    redirected to a file, this branch's output is the job log's only diagnostic in all five
    states — so it enumerates the causes and tails the last 40 lines rather than asserting the
    one the author happened to think of. The tradeoff is stated rather than hidden: a mid-run
    failure can put card text in those 40 lines, so "no card text in the job log" is a property
    of the paths anyone runs, not an invariant.
  - **A separate key buys spend isolation only.** OpenRouter governs capacity globally per
    account, so the low per-key credit limit caps the damage a runaway dispatch can do to the
    bill and does nothing for rate limits. `402` is the loud behaviour that follows, and
    `judge.ts:128` classes it as neither `429` nor `≥500`, so it throws immediately with no
    retry — which is what we want.
  - **Nothing in this project's test suite touches this workflow, and nothing will.** `npm test`
    covers no part of it; the wiring is carried by the recorded dispatches, exactly the boundary
    the C10X-29 entry draws for the drift runner. Do not read "the CI leg shipped" as "the suite
    tests the CI leg".

  Full evidence — the workflow's own header and comments, both report files, and (Phase 4) every
  dispatch with its run id, wall clock, observed cost and outcome:
  `context/changes/eval-ci-dispatch/verification.md` (after archiving:
  `context/archive/<date>-eval-ci-dispatch/verification.md`).

- **Roadmap C10X-43 (`typecheck-gate`, 2026-08-03)** — not a §3 rollout phase, and **not a
  coverage change**: no risk row moves, no test asserts anything new about the product, and the
  only suite growth is the gate's own pure half. It is recorded here because it changes §5's gate
  set for the first time since C10X-29, and because it is the **fifth** entry in this file whose
  subject is whether the project's own instruments can be trusted — after C10X-32's
  order-independence, C10X-39's silent-write census, C10X-40's guard falsifiability and C10X-42's
  who-can-exercise-it. (Counted, not estimated: an earlier draft of this sentence said "third"
  while listing three predecessors, which is the total-versus-breakdown defect this file records
  against C10X-39, C10X-40 and C10X-42 — caught here by the §8 entry disagreeing with it.) Its
  question is narrower than any of those four: **does anything in this project compile what it
  ships?** Until this date the answer was no.

  | Claim                                                                          | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The gate goes red in every class that matters, including the historical defect | six falsification probes, each deleted and hash-verified afterwards: a `TS2322` under `src/lib/`; a probe in `.astro` **frontmatter** (the class `tsc` cannot see at all); C10X-41's own `generateCandidates({ language: … })` reproducing `ts(2353)`; FM-1; FM-2; and the stale-generated-types pair                                                                                                                                                                                 |
  | …and it covers 18 `.astro` files `tsc` is blind to                             | the gate is `astro check` (133 files) preceded by `tsc --noEmit` (115 roots), resolved from the **same** `tsconfig.json` at identical strictness — `@astrojs/language-server`'s `getTsconfig()` takes no override and `@volar/kit` routes every file through the full TS language service, so a `.ts` diagnostic is an ordinary semantic diagnostic, not a reduced `.astro`-only pass                                                                                                 |
  | It does not trust an exit code (FM-1)                                          | `astro check` exits **0** when `@astrojs/check` or `typescript` is missing, printing `[ERROR]` on the way out (`astro/dist/cli/index.js:224`). Proved with a **positive control** — same broken file, exit 1 with the package present, exit 0 with it hidden — and closed by asserting on the `Result (N files):` line against a **floor**, never a pinned count. `tests/lib/typecheck.test.ts` drives that verdict as a pure function, with the real green output as its own control |
  | …and one checker's verdict is not taken under the other's broken config (FM-2) | `tsc` runs FIRST and short-circuits. A typo'd `strctNullChecks` makes `tsc` exit 2 with `TS5025` while `astro check` reports `0 errors` over 130 files — `@volar/kit/lib/createChecker.js:15-17` keeps `options`/`fileNames` and drops the parsed command line's `errors` array. Strict mode switches off silently and the gate stays green; the pair is what makes either trustworthy                                                                                                |
  | The short-circuit cannot strand a developer on generated types                 | the wrapper runs `astro sync` **before** `tsc`, because the tsc-first ordering skips the only self-syncing leg. Measured with `.astro/` deleted: `tsc --noEmit` exits 2 on **13** errors naming no file the developer touched. Proved as a **pair** — with `.astro/` deleted the gate still exits 0, and the same tree with the sync leg neutered exits non-zero and prints its own "run `npx astro sync`" line                                                                       |
  | It is fail-closed in CI                                                        | no `continue-on-error`, placed between `astro sync` and `lint`. Corollary stated in the step's own comment because the same job ships the opposite: **unlike the Kong step, a green `ci` job does imply this step passed** — `continue-on-error` reports a failed step's `conclusion` as `success`                                                                                                                                                                                    |
  | The local half exists at all                                                   | husky had **never been installed in this tree** — no `prepare` script, so `.husky/_` was absent and `core.hooksPath` unset in every scope, surviving every `npm ci` indefinitely. Repaired, and the hook proved as a **pair**: the same `git push` command green on a clean tree and red on a staged `TS2322`, naming file and line, `husky - pre-push script failed (code 2)`                                                                                                        |
  | `noUncheckedIndexedAccess` is on with a zero-error tree                        | 33 diagnostics across 13 files, swept in **one commit** because `no-unnecessary-condition` is `error` and makes every intermediate state red. Justified by measurement rather than preference: C10X-41's F3 shape (`PROMPT_LANGUAGE_NAMES[code]` into a non-optional `string`) now goes red, and the identical probe with the flag removed exits **0** — the gate built in Phases 1-4 could not see this class                                                                        |
  | No `!` assertion was introduced                                                | `no-non-null-assertion` is `error`, so every one of the 33 fixes is `?.`, `??` or an explicit guard; the repo's count of `!` stays zero, checked by two grep shapes and by the lint run                                                                                                                                                                                                                                                                                               |

  > **Corrected 2026-08-05 (`test-plan-refresh-2026-08-05`), both figures in the `18 .astro` row
  > above — and the row itself is NOT rewritten**, because it is the accurate record of what
  > C10X-43 measured on 2026-08-03. Measured today: `astro check` reports **135** files and
  > `tsc --noEmit` resolves **117** roots, against the row's 133 and 115. The delta is exactly two
  > files with no residue — `playwright.config.ts` and `tests/e2e/seed.spec.ts`, both landed
  > outside the phased rollout and both confirmed as resolved project members by
  > `npx tsc --showConfig`; the arithmetic closes in the row's own decomposition, `117 + 18 = 135`,
  > and the `18 .astro` half is unchanged (measured: 18). **Nothing went red, and that is the gate
  > working rather than failing** — the FM-1 row in the same table records that the wrapper asserts
  > on the `Result (N files):` line against a **floor**, never a pinned count, so a rising count
  > cannot break it. The mechanism is `tsconfig.json:3` (`include: ["**/*"]`, excluding only
  > `dist` and `context`), which §5's typecheck-gate paragraph names as why the local gate and CI
  > agree on scope by construction; the same line is why a whole new top-level test directory
  > enters the gate silently. So `tests/e2e/` is type-checked in CI on every push and PR to `main`
  > and blocks a local `git push`, and no document said so until this date. Read this as a NUMBER
  > correction and nothing more: it says the e2e layer **compiles**, never that anything runs it —
  > §4's e2e row and §3's Phase 6 note are where that boundary is stated.

  **Three traps this change paid for, so the next contributor does not.**
  - **A gate's own failure message is part of the gate.** The `pre-push` hook's first real red
    printed "a tsconfig error (`TS5xxx`) makes `astro check`'s own verdict untrustworthy" for an
    ordinary `TS2322` — sending a developer whose defect was one line of `utils.ts` to a
    `tsconfig.json` that was fine. Found by the manual criterion, not by the automated ones, and
    fixed in the **pure** half (`readTscFailure`) so it is testable. The class generalises: a
    wrapper that summarises another tool's output can be correct about the exit code and wrong
    about the diagnosis.
  - **`prettier --write` is not safe on this repo's markdown, and `npm run format` is the command
    that runs it.** `test-plan.md §8` recorded it as destructive and non-idempotent once; enabling
    husky would have pointed `lint-staged`'s `prettier --write` at every staged `*.md`, including
    the archive the moment a correction line was appended. Closed by a `.prettierignore` carrying
    `context/archive/**`, which makes "the archive is immutable" a property of the tooling rather
    than of a reviewer's attention. Consequence, stated because it is a real behaviour change:
    **`npm run format` no longer touches the archive.**
  - **A criterion phrased as "no files matched" can be true vacuously.** The `.prettierignore`
    check was predicted to report no matching files; prettier 3 prints
    `All matched files use Prettier code style!` and exits 0 instead — indistinguishable from a
    genuinely clean run. Met as a **pair** with `--list-different` (**116** dirty archive files
    before, **0 files considered** after) plus a known-dirty file named explicitly on the command
    line — which is how `lint-staged` invokes prettier — and shown to be skipped.

  **What this does NOT prove — read this before citing the gate as coverage.**
  - **It proves the project COMPILES, never that anything RAN.** For Risk #7 specifically: a
    type-checked eval that nobody dispatches produces no verdict at all, so §2's fourth dated half
    retires one clause and moves nothing else. Collection-time errors stay fully live — an import
    throw, a top-level side effect, a bad `vi.mock` path — which is why `eval.yml`'s cause #2 keeps
    its place in that workflow's own diagnostic and only its parenthetical was corrected.
  - **No test in this suite runs the gate**, and none will. `npm test` covers the **pure** half
    (`tests/lib/typecheck.test.ts` — the FM-1 verdict and `readTscFailure`'s diagnosis) and nothing
    else; `scripts/run-typecheck.ts` deliberately gets no test, because every branch in it is I/O
    against two spawned CLIs. Exactly the boundary the C10X-29 entry draws for the drift runner: the
    wiring is carried by recorded runs, not by an assertion.
  - **The CI leg was proved by parse and by reading, not yet by a run.** `ci.yml` triggers only on
    push to `main` and `pull_request` to `main`, with `paths-ignore: ["**/*.md", "context/**"]`, so
    a feature branch with no PR runs nothing at all and a markdown-only commit on an open PR is
    skipped. The green-step and red-step rehearsals are **ship-time**, closed at `/ship` — the same
    decision, for the same structural reason, that C10X-39's criteria 2.3 and 2.5 record.
  - **`pre-push`, not `pre-commit`** — deliberately, because ~12 s per commit is a standing
    incentive to reach for `--no-verify`. The consequence is that a **commit** can carry a type
    error; only the push is blocked. And the hook is per-checkout: `core.hooksPath` is
    per-repository git config that `git worktree add` never copies and that no `npm ci` sets without
    the `prepare` script, so an existing worktree needs `npm install` run once by hand.
  - **The checked set includes devDependency typings.** `allowJs: true` with `include: ["**/*"]`
    puts `eslint.config.js` and `astro.config.mjs` inside the gate, so a `typescript-eslint` major
    can turn CI red with no source change. That is a true positive, not a false one — but it is a
    coupling to budget for rather than to be surprised by.
  - **`eval.yml` gets no typecheck step**, by decision. Its header defends across four documents
    what a red in that file means — a FINDING, not a hygiene failure — and a typecheck red is
    precisely a hygiene failure. `ci.yml` already covers `evals/` on every push and PR to `main`;
    the residue is a feature-branch dispatch, where a ~$0.013 wasted run is the accepted cost.
  - **The 33 nUIA fixes closed no latent defect.** Every one was already safe at runtime — an index
    behind a `.length` test, a preceding `if (!match) throw`, or a fixture the test just built. The
    flag's value is prospective, and the measurement that justifies it is C10X-41's F3, not this
    sweep.

  Full evidence — every falsification probe with its observed diagnostic, both breakage pairs, the
  hook's four failure classes, the prettier idempotency and archive-ignore measurements, and each
  hash-verified restore: `context/changes/typecheck-gate/plan.md`'s Progress section (after
  archiving: `context/archive/<date>-typecheck-gate/plan.md`).

- **§3 Phase 6 (`e2e-harness-journeys`, C10X-46, 2026-08-09)** — the first new TEST LAYER in this
  project since C10X-31's eval, and the first §3 rollout phase to close since C10X-30. Risks #1 and
  #6 are **extended, not re-covered**: no §2 row moves, because a browser journey introduces no new
  failure scenario — it reaches an execution path no existing layer can reach. Read that boundary
  first, because the layer's value is entirely in it: `tests/middleware.test.ts` has driven
  `it.each` over the real `PROTECTED_ROUTES` on both branches since C10X-27, and the Container API
  mounts `NOOP_MIDDLEWARE_FN` and renders only `routeType: "endpoint"` — so **nothing in this
  project could see whether the middleware is MOUNTED at all** until a real browser navigation did.

  Two things about the phase's own shape belong in the first paragraph. The harness it inherited
  existed already — a runner and two specs landed 2026-08-05 **outside** the phased rollout, the
  C10X-39/40/42/43 pattern — so this phase's first job was to make something runnable that had
  never run. And the layer is **never a gate** (§5): no CI job, no schedule, nothing in `needs:`.

  | Claim                                                                             | What proves it                                                                                                                                                                                                                                                                                                                     |
  | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The guard is MOUNTED and executes on a real browser navigation                    | `tests/e2e/route-guard.spec.ts`, five protected page routes driven signed-out, the oracle being the browser's FINAL URL — never a `fetch` status, because `fetch` follows the 302 to a 200 and that is exactly how the C10X-27 bug hid                                                                                             |
  | …and the redirect is SELECTIVE, not an app that funnels everything to sign-in     | the public control on `/`, which asserts the `10xCards` heading is **present** and only then that the sign-in heading is absent — the presence half being the load-bearing one, see breakage 4.4                                                                                                                                   |
  | …and with a session the same guard lets the caller through                        | the signed-in control on `/decks`, asserting the `Talie` heading is present, for the same reason                                                                                                                                                                                                                                   |
  | An accepted candidate becomes part of the deck and survives a reload              | `tests/e2e/accepted-card-survives-reload.spec.ts`: a content-free count of `getByRole("button", { name: "Edytuj", exact: true })` at **0 → 1 → N → still N after `reload()`**, asserted only while the browser is on `/decks/<publicId>`, each step a distinct expected number so a red names which transition failed              |
  | …and the zero point is genuine rather than a proxy                                | `listFlashcards` filters `.eq("state_id", STATE_ACCEPTED)` (`src/lib/flashcards.ts:97-104`), so the generated cards exist as rows while being invisible on the deck page — breakage 5.2 turns that assertion red by removing the filter                                                                                            |
  | The harness cannot run against anything but the local stack                       | `tests/e2e/setup/env.ts`, asserted at **config-module evaluation** — strictly before a server exists, because Playwright orders plugin setup (which starts `webServer`) BEFORE `globalSetup`. The decidable half is a pure function under `tests/lib/e2e-env.test.ts` with every input fabricated and a whole-map positive control |
  | …and that assertion is BINDING on the child, not merely descriptive of the runner | the verified map is handed to `webServer.env`, which outranks `process.env`, which outranks `.env`. `reuseExistingServer` is deliberately unset, so an already-listening port is a hard error rather than an attach to a server nothing verified                                                                                   |
  | …including the one source `webServer.env` cannot outrank                          | `@astrojs/cloudflare` merges `.dev.vars` into the child's `process.env` afterwards, so the merge under assertion is the two REAL sources and the refusal names **which file** carries the offending value (breakage 1.8)                                                                                                           |
  | The two shared predicates cannot drift between the two preflights                 | `assertAnonKey` and `assertLocal` were EXTRACTED into `tests/setup/env-assertions.ts` and are imported by both `tests/setup/preflight.ts` and the e2e side — not copied, which is the class §6.6 records the cost of four times                                                                                                    |
  | The session artifact has a producer, and it is correct by construction            | `tests/e2e/setup/auth.setup.ts` drives the real sign-in form, so name, value, encoding, chunking, domain and expiry all come from the app and the browser — `lessons.md`'s "never hand-assemble an `@supabase/ssr` cookie" satisfied structurally rather than by care                                                              |
  | …and it asserts it is signed in BEFORE writing                                    | `context.storageState()` will happily serialise `{"cookies":[],"origins":[]}`; two DOM facts are asserted first (the shell exists, and it belongs to THIS account), because otherwise every downstream test runs signed out and journey B's control reports a harness defect AS a guard defect                                     |
  | Cleanup survives a mid-spec failure                                               | a `teardown` PROJECT, wired as `chromium`'s `teardown` so it runs whatever the outcome, acting as the same account under RLS and scoped to a per-worker on-disk registry written BEFORE each row is created                                                                                                                        |
  | …and it reaches the table a deck-scoped teardown cannot                           | `generation_session` has no deck FK at all, so the run-delta oracle is **two counts and not one** — `{"decks":0,"sessions":0}` before and after a full run, both deltas 0                                                                                                                                                          |
  | …and that 0 → 0 is not vacuous                                                    | the control: the same failing run with the teardown project unwired leaves `{"decks":2,"sessions":1}`                                                                                                                                                                                                                              |
  | The two runners cannot silently collect each other's files                        | `tests/lib/e2e-isolation.test.ts`, both directions, with two positive controls (the walker reaches the files that exist; the predicate fires on a fabricated path)                                                                                                                                                                 |
  | The five `/10x-e2e` anti-patterns are lint-enforced rather than review-enforced   | `eslint-plugin-playwright` scoped to `tests/e2e/**`, with `no-wait-for-timeout`, `no-wait-for-selector`, `no-element-handle`, `prefer-locator`, `no-skipped-test` and `expect-expect` raised to `error`                                                                                                                            |

  **Deliberate-breakage runs — fifteen criteria, and the eight belonging to Phases 2-4 were
  RE-EXECUTED on 2026-08-09** because those phases recorded their splits nowhere and this file's own
  rule is that a split is a claim about a run. Every string below is from a run against the tree as
  it now stands.

  | #   | Neuter                                                    | Observed                                                                                                                                                              |
  | --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1.5 | cloud `SUPABASE_URL` in `.env`                            | exit 1 **while Playwright is still loading the config** — the stack trace names `playwright.config.ts:11` → `resolveE2eEnv` → `buildE2eEnv` → `assertLocal`           |
  | 1.6 | a hand-started dev server on 4321                         | `Error: http://localhost:4321 is already used, make sure that nothing is running on the port/url…` — a hard error, never a silent attach                              |
  | 1.7 | the chromium binary directory renamed away                | `E2E preflight failed: the chromium binary Playwright needs is not installed. Run: npx playwright install chromium`                                                   |
  | 1.8 | cloud `SUPABASE_URL` in a `.dev.vars` over a valid `.env` | throws before any server starts, naming **`.dev.vars`** rather than `.env` — and the assertion behind it was itself proved falsifiable, **1 of 26** red               |
  | 2.3 | `tests/e2e/scratch.test.ts`                               | **1 of 6** red, naming the file, the rule and two fixes                                                                                                               |
  | 2.4 | `page.waitForTimeout(100)` in a spec                      | `npm run lint` exit 1, `error Unexpected use of page.waitForTimeout() playwright/no-wait-for-timeout`; the 3 pre-existing `no-console` warnings unchanged             |
  | 3.4 | the setup project's sign-in forced to fail                | **1 failed / 2 passed** — the `chromium` project never runs, and `playwright/.auth/user.json` is absent afterwards. The red is the producer, not a downstream timeout |
  | 3.5 | a spec throwing after it creates a deck                   | **1 of 12** red, the teardown still running and passing, both row deltas **0** — with the unwired-teardown control leaving `{"decks":2,"sessions":1}`                 |
  | 4.2 | `/study` removed from `PROTECTED_ROUTES`                  | **1 of 7** red in the browser, that route only, on `waitForURL` — while `npm test` stays **green and silently loses two cases, 399 → 397**                            |
  | 4.3 | the guard widened to everything but the auth surfaces     | **1 of 7** red on the **public control**, `Received: "http://localhost:4321/auth/signin"` — a different case failing on a different assertion (§6.10's pair)          |
  | 4.4 | `/` made to answer 500, E1 present / E1 removed           | **1 of 7** red on the public control, then — with only that one line removed — **10 passed, exit 0** over the same dead landing page                                  |
  | 4.6 | `src/middleware.ts` renamed away                          | the browser run dies in the **setup** project (journey B never executes); Vitest goes red in **four files**, none of them about the guard's behaviour                 |
  | 5.2 | the `STATE_ACCEPTED` filter removed from `listFlashcards` | **1 of 11** red, `Expected: 0, Received: 3`, journey B untouched                                                                                                      |
  | 5.3 | the accept transition no-oped, then routed to `rejected`  | a **pair**: the first dies on the CANDIDATE count, the second on the DECK count — separating "never left the review screen" from "left but never arrived"             |
  | 5.4 | `exact: true` dropped from the counting locators          | **1 of 4** red, from the `Akceptuj` side only; the deck-page `Edytuj` counts passed without it                                                                        |

  **Three of the plan's predictions did not survive contact, and each is recorded as observed
  rather than rounded** — the discipline this file applies to C10X-29's `missingLocal` neuter and
  C10X-30's case 8. **4.3 as worded** ("force the guard predicate to `true`") makes `/auth/signin`
  redirect to itself, so the run never starts and ends on
  `Timed out waiting 120000ms from config.webServer` — nothing is learned; it needed the auth
  surfaces exempted to ask its intended question. **4.4's first attempt** failed the same way for a
  different reason: `webServer.url` is `/`, i.e. the readiness probe is the route the breakage takes
  down, which is a real coupling and is written down rather than worked around silently. And
  **4.6 fails EARLIER than predicted in the browser and in MORE places than predicted in Vitest** —
  the session producer is itself downstream of the middleware, so `dependencies: ["setup"]` stops
  everything behind it, while on the Vitest side three walker guards go red simply because a file
  left `src/`. The general form is now a rule in §6.11: **check what your neuter does to the harness
  before you read its colour.**

  **The layer was measured FLAKY and the cause was removed rather than retried past.** Ten runs at
  the default worker count on 2026-08-09: six green at ~12 s, four red, every red on a cold or
  freshly-invalidated `node_modules/.vite`, reproduced deliberately twice. The cause is in the run's
  own output, which reports a `deps_ssr/chunk-….js` that
  `is in the optimize deps directory` and no longer exists — i.e. Astro compiles routes on demand while Vite
  rewrites `deps_ssr/` under a new hash, and requests in flight answer 500, reaching a spec as
  `element(s) not found` or a click that never becomes actionable. `webServer.timeout` cannot cover
  it: the readiness probe hits `/` and returns the moment ONE route answers. The fix is
  **`workers: 1`**, measured at **11 of 11 green** on cold caches — a SUM of two measured rows, 5
  with the warm-up and 6 without it — against 5 of 7 for the
  alternative, at a cost of ~12 s → ~21 s. A route warm-up was written first and **deleted**,
  because its measured contribution once requests were serialised was zero. `retries` stays **0**:
  this removes a cause, it does not hide one.

  **What this does NOT prove — read this before citing Risk #1 or #6 as more covered than they are.**
  - **The layer is never a gate and is not watched.** No CI job, no schedule, nothing in `needs:`,
    and `npm run e2e` runs only when a human runs it. This date means "exercised", never "watched" —
    the same reading §2's Risk #7 row has demanded of the eval since C10X-31.
  - **The gates cover the specs' SOURCE, not their execution.** `tests/e2e/**` sits inside
    `npm run typecheck` and now inside `npm run lint`'s Playwright rules, both fail-closed `ci`
    steps — so a green `ci` job says the layer **compiles and lints**, never that any journey ran.
    Exactly the distinction the C10X-43 entry above had to make once already.
  - **Two journeys exercise at most two islands, on one happy path each, while four carry a
    `fetch`.** §7's islands exclusion survives unchanged: the defect it was written from is a wrong
    ok/parse ORDER on a failure branch no journey deliberately produces. One exemplar spec covers
    one flow, not the class.
  - **The account carries state between runs** (change.md D-01), so no spec may assume an empty
    starting deck list, and every count must be scoped to the spec's own rows.
  - **A hand-started server is outside the guarantee.** `reuseExistingServer` unset is what makes
    the local-host assertion binding; anyone who sets it — and Playwright's own port-collision
    message suggests exactly that — disarms it. That hazard was found and deliberately not fixed:
    intercepting the tool's own advice would need a config-time port probe.
  - **The session's durability rests on GoTrue behaviour this project does not own**, and any
    `npx supabase stop` or `npm run db:reset` kills it. The producer is the answer to that, not the
    mechanism.
  - **The cleanup registry keeps a residual failure mode**: a worker killed between the registration
    write and its flush still loses that entry — strictly narrower than the inline pattern it
    replaces, which lost the row on ANY failure, but not zero. Measured on a second route to the
    same gap: an abrupt kill of the run's process tree leaves the teardown unexecuted and both rows
    orphaned, and the next run's `removeOutputDirs` then wipes the evidence. **The true console
    Ctrl-C path is unmeasured** and the reason is on record in the change's `verification.md`.
  - **The flake is closed at eleven cold-cache runs on one machine on one day.** Zero over eleven
    bounds a rate; it does not prove impossibility, and the Vite behaviour underneath is untouched.
  - **And it did not prove impossibility — one unexplained red was observed the same day, after this
    entry was written** (impl-review triage, 2026-08-09). `accepted-card-survives-reload.spec.ts`
    failed once on the committed tree at **30.9 s**, against a steady state of 15–18 s over 45
    consecutive runs and a 22.3 s ceiling for the slowest condition reproducible on demand — i.e. a
    consumed timeout rather than slowness. It did **not** reproduce in **78** runs across five
    targeted conditions (cold Vite cache, heavy preceding load, `src/` mtime churn, combinations, a
    45-run uninterrupted loop), the teardown ran and left residue `0/0`, and the commit was proved
    not to have changed the code. **The failure string was not captured**, so the cause is unknown;
    the named-but-unconfirmed suspect is Kong's keep-alive `502` (C10X-39), which this layer absorbs
    nothing of — `tests/setup/retry-transport.ts` is a Vitest `setupFiles` entry and Playwright never
    loads it. Recorded so the next reader starts from an observation rather than from scratch. Full
    enumeration: the change's `verification.md`, "Post-review observation".
  - **Nothing here exercises concurrent users** — serialising the runner was a fix for the dev
    server, and it narrows what this layer could ever say about concurrency to nothing.
  - **The 5459-deck debt is stopped, not repaid.** The teardown scopes to the run's own registry by
    decision; the pre-existing rows and the 2026-08-05 orphan are deliberately left in place.

  Full evidence — every breakage edit with its observed failure string and denominator, the
  verified restores, the ten-run flake dataset with its two deliberate reproductions, and the
  Phases 2-4 backfill:
  `context/changes/e2e-harness-journeys/verification.md` (after archiving:
  `context/archive/<date>-e2e-harness-journeys/verification.md`).

### 6.7 Adding a test for the SRS / study path

(Added by §3 Phase 4. It sits after §6.6 so the existing §6.6 references in
`tests/study/study.test.ts`, `tests/generation/generate.test.ts` and §6.2/§6.5
keep pointing at the per-phase notes.)

- **Location**: `tests/study/` — the sibling folder §6.2 calls for when the
  concern is not ownership. Two files, split by cost, not by feature:
  `schedule.test.ts` (pure, no DB) and `study.test.ts` (real endpoint, real
  Postgres).
- **Naming**: `*.test.ts`, named after the resource. A new case goes into the
  matching file as another `it()`.
- **Reference**: `tests/study/schedule.test.ts` for the oracle-property shape
  (§6.1), `tests/study/study.test.ts` for anything that must persist.
- **Run**: `npm test`, or one file with
  `npx vitest run tests/study/study.test.ts`. The local stack must be up
  (`npm run db:start`) — preflight aborts the run otherwise, even for the
  pure file.
- **Check §6.6 first**, as §6.2 requires: the Phase 4 table there tabulates
  what each Risk #3 claim already rests on.
- **Pattern**: identical to §6.4 — drive the real endpoint with a real session
  cookie against the real local Postgres, read back with `clientFor(...)`,
  row-based assertions paired with a positive control, **404 never 403**, and
  a file-level `Date.now().toString(36)` namespace (§6.5).

Five project-specific facts that are invisible from the test file and will
cost you an afternoon if you rediscover them the hard way:

- **`now` is a lib parameter, never an HTTP input — and that is the only seam
  where an exact `due` can be pinned.** `rateCard` takes it as a trailing
  argument defaulting to `new Date()`; `/api/study` calls it without one,
  deliberately, because a client-supplied clock would let a client steer its
  own schedule. So: assert an **exact** `due` by
  calling `rateCard` directly with `clientFor(a.cookieHeader)` and a fixed
  `now`; over HTTP you can only assert **relative** properties (Easy later
  than Hard, `reps` advanced by one). Do not try to reach the fixed clock
  through the endpoint — there is no route, and adding one would be a
  security regression, not a testability win.
- **A schedule row does not exist until a session loads the card.** Manual
  create writes the card `accepted`, but `flashcard_schedule` is seeded by
  `ensureSchedule`, which runs inside `listDueCards`. Rate a freshly created
  card without loading a session first and you get a 404 that looks like an
  ownership failure and is not. `study.test.ts`'s `loadSession` helper does
  exactly what the real `/study/[publicId]` loader does; go through it.
- **`expectedReps` is an optimistic-lock version, not a payload field.** It
  must be the `reps` the session served. Pass a stale one and the
  compare-and-set matches zero rows, so the endpoint answers a benign
  `200 { alreadyApplied: true }` — no transition. A test that hard-codes `0`
  and expects a schedule change will fail on its **second** run against the
  same card, not its first.
- **Two axes are called "state" and they are not the same.**
  `flashcard.state_id` is the lifecycle (1 generated / 2 accepted /
  3 rejected) and owns the "only accepted cards enter" gate;
  `flashcard_schedule.srs_state` is FSRS's (0 New / 1 Learning / 2 Review /
  3 Relearning) and owns scheduling. Asserting the wrong column proves
  nothing while reading as a passing test.
- **No endpoint creates a non-accepted card.** Manual create always writes
  `accepted` and `/api/generate` would drag the whole generation path in, so
  the accepted-only gate needs a direct RLS-scoped insert
  (`createNonAcceptedCard` in `study.test.ts`). That seam is deliberate and
  stays RLS-scoped — it is a shortcut around the _UI_, not around the lock.

Three more, added by the 2026-07-26 audit and **closed by C10X-27 the same day**. They
stay here as rules, not as gaps — each now names the case that pins it, so a new test
can be modelled on one instead of re-deriving the trap:

- **Never pass a literal batch limit again.** Every call used to be
  `listDueCards(client, deckId, <date>, 20)` — a literal, never the deck's own
  `session_size`, which is what production uses
  (`src/pages/study/[publicId].astro`). Copying that call shape is how the wire
  stayed unobserved. A new case must set `session_size` on the deck and let the
  value reach `p_limit`, with more due cards than the cap, or it proves nothing
  about bounding. **Model it on** "caps the batch at the deck's cap and composes it
  deterministically": the cap is set through the real endpoint, read back with
  `getStudyDeck`, and handed to `listDueCards` — 5 due cards, cap 3.
- **`new Date()` is the wrong clock for a durability claim.** `now` is a lib
  parameter on `listDueCards`/`rateCard`, so a re-entry test rates at `T`, then
  calls `listDueCards` at `T + interval` and asserts the card comes back — and at
  `T + 1 min` asserts it does not. Passing `new Date()` can only ever prove
  read-after-write, which is why "no card is lost" went unproven under a table that
  said otherwise. **Model it on** "returns the card at its persisted due and withholds
  it a minute after the rating", and write the **negative** half first — that is the
  half a `due <= p_now` predicate that was always true would fail, and the positive
  half alone would not.
- **`Rating.Good` is not a representative grade.** It was for a long time the only
  grade that took the write path. `Rating.Again` drives a _different_ transition —
  `lapses + 1` — and a lapse bug would have been invisible. When adding a grade case,
  assert `lapses` and `srs_state` against an oracle advanced in memory (§6.1's rule),
  never against the row. **Model it on** the four-grade matrix and the lapse case.

  > **Correction (C10X-27).** This bullet used to say `Again` drives "Review →
  > Relearning". **It does not, in this app.** `enable_short_term: false` means ts-fsrs
  > runs `LongTermScheduler`, whose `next_state` sends every grade — `Again` included —
  > to `State.Review` (`index.cjs:1271`). `State.Relearning` is assigned at exactly one
  > site, `BasicScheduler.reviewState` (`:1102`), which this configuration never
  > instantiates, so `srs_state` can only be `0` or `2`. `lapses += 1` on `Again` is
  > real (`:1237`). A test asserting the Relearning transition would fail — confirmed by
  > execution, which is how this was caught. The user-facing claim is still observable,
  > just on different columns: assert that `Again`'s persisted `due` and `stability` are
  > strictly **below** what `Good` yields for the same card at the same `now`. §6.8
  > repeats the two-axes warning and is unaffected; only the transition target was wrong.
  > A one-line canary now pins the invariant: **no row this suite writes ever carries
  > `srs_state = 3`.** If it fires, `enable_short_term` was flipped and every exact-`due`
  > oracle in the file is suspect. Note it is a canary, not a detector for that flag —
  > under the flip the card never reaches `Review`, so it stays green while two other
  > cases go red (§6.6).

**The deliberate-breakage check for this path** runs against the live local DB
(`docker exec … psql`), not through a `db:reset` — the behaviour under test
lives in SQL, and a reset would wipe the dev data a reviewer is likely
mid-way through using. Two variants, depending on which claim you are
checking:

- **The accepted-only gate**: `create or replace` `study_due_cards` without
  its `and f.state_id = 2` predicate; exactly the gate assertion should go
  red. Restore by re-applying the migration's definition.
- **Cross-account denial**: neuter all four guarding policies at once
  (`deck_select`, `flashcard_select`, `flashcard_schedule_select`,
  `flashcard_schedule_update`) with `using (true)`. Neutering one is not
  enough — the request stops at the next policy down and still answers 404,
  so the test stays green and you learn nothing.

  > **This variant no longer works on a grown dev database (C10X-27, 2026-07-26).**
  > `study_due_counts` has no user predicate and no `LIMIT`, so with `deck_select`
  > wide open it returns every deck in the database; once that exceeds
  > `max_rows` (1000, `supabase/config.toml`) PostgREST truncates and the deck under
  > test falls outside the window. The `listDueCounts` denial then **passes while the
  > guard is fully disabled**, and its positive control fails as a knock-on. Run this
  > variant from a `db:reset`, or read only the rate-path 404 as evidence. §6.6 records
  > the full trace. The general form is worth remembering: **a denial asserted as
  > "absent from an unbounded result set" decays into a false pass as the dataset
  > grows.**

Whichever you run, **verify the restore rather than trusting it**: dump
`qual`/`with_check` (or `\sf` for a function) before and after, and `diff`.
An RLS policy restored from memory is how a suite silently stops testing
anything. §6.6 records the observed results of both.

**And note which objects are safe to neuter.** `create or replace function` leaves no
residue, so a function neuter always restores. **A dropped CHECK constraint does not**:
the suite goes on to persist data the constraint forbids, so `add constraint` fails
_after_ the evidence is collected (`violated by some row`). C10X-27 hit exactly that on
`deck_session_size_check`. Inspect the offending rows, repair them, then re-add — and let
the `diff` confirm it, never your memory.

### 6.8 Adding a test for the state-transition path

(Added by roadmap slice S-05. Sits after §6.7 so the existing §6.6/§6.7 references
in the test files keep pointing at the same anchors.)

- **Location**: `tests/review/candidates.test.ts` for the transition itself and the
  batch endpoint's contract; `tests/isolation/flashcards.test.ts` for anything about
  **who** may perform it — §6.2's one-file-per-resource rule puts cross-account
  denial with the other flashcard denials, not here.
- **Naming**: `*.test.ts`, named after the resource. A new transition case goes into
  the matching file as another `it()`.
- **Run**: `npm test`, or one file with
  `npx vitest run tests/review/candidates.test.ts`. The local stack must be up
  (`npm run db:start`).
- **Check §6.6 first**, as §6.2 requires: the S-05 entry there tabulates what each
  claim already rests on, and what the slice deliberately leaves to manual checks.
- **Pattern**: §6.4's, unchanged — real endpoint, real cookie, real Postgres,
  row-based assertions with a positive control, **404 never 403**, and a file-level
  `Date.now().toString(36)` namespace (§6.5).

Five facts that are invisible from the test file and will cost you an afternoon:

- **A zero-row write is a `200`, not an error — so a status assertion proves
  nothing.** Under RLS an UPDATE that matches nothing reports no error, and the
  batch endpoint deliberately reports it as `{ ok: true, changed: [], skipped: [...] }`
  (the same benign shape `/api/study` uses for `alreadyApplied`). `changed` is
  therefore the _only_ signal that separates a refused reach from a successful one.
  Always pair it with the row re-read as the owner.
- **`skipped` is derived, not reported by the database**: it is the requested set
  minus what `RETURNING` produced. An id lands there for four indistinguishable
  reasons — already in the target state, illegal for it, in another deck, or another
  account's. That conflation is intentional (an owner must not be able to probe
  another account's ids), so never write a test that expects `skipped` to explain why.
- **Two axes are called "state" and they are not the same** (repeated from §6.7
  because this is the file where it bites hardest). `flashcard.state_id` is the
  lifecycle — 1 generated / 2 accepted / 3 rejected — and is what a transition moves;
  `flashcard_schedule.srs_state` is FSRS's (0 New / 1 Learning / 2 Review /
  3 Relearning). Asserting the wrong column proves nothing while reading as a pass.
- **`generated` is not a reachable target, and it is refused twice.** The Zod union
  on the endpoint rejects the _value_ with a `400`, while `ALLOWED_FROM` has no key
  for it so the lib layer matches an empty allow-list. Test the lib layer through
  `setFlashcardState` directly if you want the second guard — over HTTP you only ever
  see the first.
- **Accepting a card does not seed its schedule.** `ensureSchedule` stays lazy inside
  `listDueCards`, so a card accepted-then-rated-then-rejected keeps an orphaned
  `flashcard_schedule` row on purpose — that is what lets "Przywróć" resume the real
  schedule instead of resetting the card to New. Do not "fix" an orphan you find; a
  test asserting `reps` survives a reject→accept round trip is what pins it.

**The deliberate-breakage check for this path**: delete the
`.in("state_id", ALLOWED_FROM[target])` predicate from `setFlashcardState` and
confirm exactly the illegal-transition and mixed-batch assertions go red while every
legal edge stays green. For the ownership half, neuter `deck_select`,
`flashcard_update` **and `flashcard_select`** together — two are not enough, because
Postgres applies the SELECT policy to an UPDATE's WHERE clause, so the write half
stays invisible and you would conclude more than you tested. §6.6 records both runs
and the restore-verification failure that nearly slipped through.

### 6.9 Adding a test that needs a module double

(Added by C10X-28 / §3 Phase 2's Risk #4 slice. It sits after §6.8 so every existing
§6.x anchor keeps pointing where it did.)

**The default is still "no doubles."** Every other file in this suite drives the real
endpoint against the real local Postgres, and §6.4 explains why: the lock under test is
RLS, and a double is the fastest way to mock away the thing you meant to prove. This
section exists because exactly one claim could not be reached any other way — not to open
the door generally.

- **Location**: `tests/generation/failure-path.test.ts`. **Module doubles live in that one
  file.** If you find yourself adding a second one somewhere else, that is the moment to
  re-read this section rather than to imitate it.
- **Run**: `npx vitest run tests/generation/failure-path.test.ts` (the local stack must be
  up — the database is still real, so preflight still applies).
- **Check §6.6 first**, as §6.2 requires: the C10X-28 entry there tabulates what the two
  branches now prove and what they deliberately do not.

**The only module ever doubled is `astro:env/server`**, and only to lift a clamp that is
otherwise airtight in three independent places: preflight aborts the run when
`OPENROUTER_API_KEY` is set (§6.4), `src/lib/openrouter.ts` short-circuits to `mockCards`
when it is unset, and under Vitest an `astro:env` secret is a **transform-time inlined
literal** — so `vi.stubEnv`, `process.env` and `setGetEnv` are all dead seams. Replacing
the module is not the convenient option; it is the only one.

**Why `@/lib/openrouter` is the WRONG module to double, and this is the load-bearing
paragraph.** Doubling `generateCandidates` also reaches the 502 branch, so it looks
equivalent and is not: `openrouter.ts`'s request-building code then never runs, no request
is issued, and the `Authorization` header the key-pin exists to observe does not exist. The
absence assertion ("the key is in no audit column") would still pass — because nothing was
ever sent. Half the claim evaporates and the suite stays green. A double that removes the
code your positive control observes is a false pass by construction; check for that before
choosing a seam, not after.

Four mechanical traps, three of which were only found by running it:

1. **`vi.hoisted` is mandatory for the sentinel.** `vi.mock` factories are hoisted above
   every import, so a plain module-scope `const SENTINEL` is in its TDZ when the factory
   runs. Share it with `const { SENTINEL_KEY } = vi.hoisted(() => ({ SENTINEL_KEY: "…" }))`.
2. **The factory must spread `...actual`,** for a reason unrelated to the key:
   `SUPABASE_URL`/`SUPABASE_KEY` come from the same module (`src/lib/supabase.ts`). A
   factory returning only the key makes `createClient` return `null`, and `/api/generate`
   answers **500** without ever reaching the LLM call — which presents as a mysterious
   failure rather than as the wiring error it is.
3. **The `fetch` double must be a pass-through, not a replacement.** Inside one
   `callEndpoint` the endpoint makes six Supabase calls over `globalThis.fetch`, and the
   assertions read the audit row back the same way. Match on `openrouter.ts`'s
   `OPENROUTER_URL` and delegate every other URL to the captured original.
4. **Install the `fetch` double BEFORE the key seam.** The `astro:env` mock deliberately
   lifts the clamp preflight exists to enforce (`lessons.md`: "Preflight musi domknąć KAŻDY
   nielokalny szew"), so the pass-through is the **replacement guard**, not a convenience:
   without it, a sentinel key produces a real, billed call to `openrouter.ai`.

**The database and RLS are never doubled**, here or anywhere. Every row this file asserts
on is read back through the app's own RLS-scoped client.

**Isolation: know which hazard the config already handles.** Vitest 4.1.10's defaults apply
(nothing is set in `vitest.config.ts`): `pool: "forks"`, `isolate: true`. So a `vi.mock`
**cannot** leak into another file — which means "the full suite is still green" is a smoke
check, not evidence that the double is confined. The live hazard is **intra**-file:
`restoreMocks`, `clearMocks`, `mockReset` and `unstubGlobals` all default to `false`, so a
`globalThis.fetch` replacement must be restored in an `afterAll` or a later `it()` in the
same file reads the database through a stale double.

> **There is now a SECOND `fetch` seam in this suite, and it is deliberately not a double**
> (added 2026-07-30 by C10X-32; this section otherwise still reads as if `failure-path.test.ts`
> were the only one). `tests/setup/retry-transport.ts` is a `setupFiles` entry, so it wraps
> `globalThis.fetch` for **every** test file — but it fabricates no response and intercepts no
> module: it replays one transport failure (Kong's keep-alive `502` from a local URL, at most
> twice) and hands everything else straight through. Three consequences for a reader of this
> section. It is **not precedent for a second module double** — the rule above stands, and the
> location bullet still means what it says. Its predicate is falsifiable rather than
> reasoned-about: the pure half lives in `tests/setup/retry-policy.ts` and is asserted by
> `tests/lib/retry-transport.test.ts`. And it is **never restored**, which does not violate the
> intra-file rule above — that rule is about a per-file double outliving its `describe`, while
> this one is installed by the harness for the whole file on purpose. §6.2's shuffle bullet
> carries the reason it exists.

**The deliberate-breakage check for this path** is the one that decides whether the seam is
doing anything at all: **comment out the `vi.mock("astro:env/server", …)` factory.** The
right red is `expected 200 to be 502` — without the seam the request falls through to mock
mode and **succeeds**. Any other failure means the file is observing something else. §6.6
records that run, plus the three that pin the individual assertions (a body interpolating
`err.message`, a body interpolating the source text, and `Authorization` moved into the
request body).

### 6.10 Adding a test for a redirect-style (native form) endpoint

(Added by C10X-30 / §3 Phase 2's card-content slice. It sits after §6.9 so every existing
§6.x anchor keeps pointing where it did.)

§6.3 tells you to assert a refusal **and** no write. On the six protected `/api/*` routes
that are native `<form method="POST">` targets — deck rename/delete, card create/edit/delete
— "the refusal" has no status of its own, and that changes what an assertion has to look
like. This subsection is the difference; everything §6.3 and §6.4 say still applies on top
of it.

- **Location**: `tests/validation/<resource>.test.ts` for a **content rule** — `cards.test.ts`,
  and since C10X-37 `decks.test.ts`;
  `tests/isolation/*.test.ts` stays the **ownership** file (§6.2's one-file-per-resource
  rule is about the resource, and these two concerns are deliberately not mixed).
- **Reference**: `tests/validation/cards.test.ts` — copy this one. `decks.test.ts` is the
  second worked example and the one to read when your resource has no containing column.
- **Run**: `npm test`, or one file with `npx vitest run tests/validation/cards.test.ts`.
  Local stack up (`npm run db:start`).
- **Check §6.6 first**, as §6.2 requires: the C10X-30 and C10X-37 entries tabulate what each
  claim already rests on.
- **Shared helpers live in `tests/fixtures/redirect-cases.ts`** — `sized()` and `errorParam()`.
  They were authored inline in `cards.test.ts` and extracted by C10X-37 when a second file
  needed them verbatim; do not re-declare them, that is the drift `tests/fixtures/scoping.ts`
  was extracted to end.

Six facts that are invisible from the test file and will cost you an afternoon:

- **A refusal and a success are the SAME status.** Both are a `302`; only the `Location`
  differs. So `expect(response.status).toBe(302)` proves nothing at all here, and the row
  oracle is not a supplement — it is the assertion. Every refusal case must re-read the
  rows it could have written.
- **Assert the decoded `error` param by EQUALITY, never `toContain("error=")`.** A guard
  that stops working does not remove the redirect; the request falls through to the
  handler's _other_ error branch, which redirects with a **different** owned message and
  the same `error=` key. C10X-30's breakage run 1 is exactly that: with the endpoint's
  length comparison decoupled, the response was still a `302` still carrying `error=` and
  `open=create-card`, and only the equality assertion went red. Read the param with
  `new URL(location, ORIGIN).searchParams.get("error")` (`errors.test.ts:210-220`).
- **Order the assertions with the row oracle FIRST, and say why in a comment.** Vitest
  aborts an `it()` at the first failed `expect`. When two enforcement layers exist (here:
  the endpoint's comparison and the DB CHECK), the breakage pair only separates them if the
  two runs fail on _different_ assertions — count-first yields "red on the message" for the
  endpoint layer and "red on the count" for the database layer. Message-first collapses
  both runs into one indistinguishable failure string. An ordering with no comment reads as
  arbitrary and gets tidied away.
- **`callEndpoint` does not follow redirects** (`endpoint.ts:50-55`), so `status` and the
  raw `Location` string are directly assertable — which is also what makes a **no-echo**
  case cheap: assert the raw header contains neither the submitted marker nor the run
  suffix, before decoding.
- **Never `countFlashcards` or `listFlashcards` as the count oracle.** Both filter
  `state_id = STATE_ACCEPTED` (`flashcards.ts:167-173`, `:76-83`), so a card written in any
  other state is invisible to them and "count unchanged" reads green over a real write. The
  oracle must be a raw, state- and status-agnostic count scoped by `deck_id` only. This is
  the same class as C10X-28's status-filtered-count trap, and the helper your need points
  straight at is the wrong one.
- **Deck resolution runs before content validation, deliberately** (`cards/index.ts`, from
  S-02 impl-review F5). An over-length body aimed at a foreign deck answers `404`, not the
  validation redirect — so every case must use a **real, owned** deck or it measures the
  ownership guard instead of the rule it names.

One asymmetry worth stating because it inverts a case you may be copying: the card
endpoints `.trim()` **before** measuring, while `/api/generate` caps the raw string. So
C10X-28's "over the cap, but trims back under it → still refused" does **not** transfer —
the card-side mirror is _accepted_, and `tests/validation/cards.test.ts` carries it as its
own case. And do not build boundary strings from non-ASCII: `char_length` counts code
points while JS `.length` counts UTF-16 units, so an astral character measures 2 on the
endpoint and 1 in the CHECK.

**The deliberate-breakage check for this path is a PAIR, not a single run**, whenever the
rule has a second enforcer beneath the endpoint. Run 1 decouples the endpoint's comparison
(replace `> FRONT_MAX` with a literal — **never** raise the shared constant, which the
endpoint, three islands, `openrouter.ts` _and the test_ all import, so raising it moves
every side together and the suite stays green while proving nothing). Run 2 keeps run 1's
edit and additionally drops the CHECK against the live local DB
(`docker exec -i … psql` — the `-i` is load-bearing, §6.7). One run alone cannot tell "the
endpoint caught it" from "the database caught it"; the pair can, because the _failure
strings_ differ. Restoring a dropped CHECK is **not** symmetric with restoring a function:
the suite persists rows the constraint forbids while it is absent, so delete those rows
(scoped to the run's own deck) _before_ re-adding, then confirm with a
`pg_get_constraintdef` before/after `diff`. And know what that diff does not establish — a
text match would also read identical for a constraint that came back `NOT VALID`, so probe
the restored bound behaviourally too, inside a rolled-back transaction and with an in-range
insert as the positive control. §6.6's C10X-30 entry records both runs with their splits.

### 6.11 Adding an e2e (browser) test

(Added by C10X-46 / §3 Phase 6. It sits after §6.10 so every existing §6.x anchor keeps pointing
where it did. Before this date §6 carried two trap sentences about e2e and no procedure, which was
correct while nothing could run the layer and is not now.)

**Read §5 before you read anything else here: this layer is never a gate.** It has no CI job, no
schedule, and nothing may declare one in `needs:`. A green run means "somebody exercised it on that
date", never "a signal is being watched" — the same reading §2's Risk #7 row demands of the eval.

- **Location**: `tests/e2e/`, which is Playwright's `testDir`. Helpers may live in
  `tests/e2e/setup/` and `tests/e2e/teardown/`; the rule is about Vitest's `include`, not about the
  directory's contents.
- **Naming**: `*.spec.ts`. **Never `*.test.ts` under `tests/e2e/`** — that matches Vitest's
  `include` (`tests/**/*.test.ts`) as well as Playwright's default pattern, so BOTH runners collect
  the file and this node-only suite tries to drive a browser. You do not have to remember this:
  `tests/lib/e2e-isolation.test.ts` fails and names the file, the rule and two fixes. The `setup`
  and `teardown` projects carry an explicit `testMatch` for the opposite reason — the default
  pattern needs `.test.` or `.spec.` in the filename, and a project collecting **zero** tests
  satisfies `dependencies: ["setup"]` trivially.
- **Reference**: `tests/e2e/seed.spec.ts` — the smallest complete example, and the file `/10x-e2e`
  learns this project's conventions from. `route-guard.spec.ts` for a signed-out case,
  `accepted-card-survives-reload.spec.ts` for a multi-screen journey with a counting oracle.
- **Run**: `npm run e2e` for the whole layer, `npx playwright test <file>` for one spec — either way
  Playwright starts and owns the dev server, so **port 4321 must be free**. A server you started by
  hand is a hard error, not a silent attach, and that is deliberate: `reuseExistingServer` is unset
  because a foreign server leaves no oracle for which Supabase project it points at.
- **Prerequisites**: the local stack up (`npm run db:start`) and, once per checkout,
  `npx playwright install chromium`. Both failures are named by the config-time preflight in the
  imperative — it tells you the command to run rather than the check that failed.
- **Check §6.6 first**, as §6.2 requires: the C10X-46 entry there tabulates what this layer already
  claims and, at equal length, what it does not.

Seven project-specific facts that are invisible from the spec files and will cost you an afternoon:

- **The account is SHARED and carries state between runs** (change.md D-01). One dedicated account
  signs in per run, deliberately — per-run accounts would re-expose the 30-sign-ins / 5-min / IP
  limit that this harness currently does not touch. The price is the rule: **no spec may assume an
  empty starting deck list**, and every count must be scoped to rows the spec itself created.
- **Cleanup is never a step in the test body.** Declare what you are about to create with the
  `registry` fixture from `tests/e2e/fixtures.ts` (import `test`/`expect` from there rather than
  from `@playwright/test`), and the `teardown` project removes it after the run whatever the
  outcome. **Register BEFORE the row exists**, not after: the name is minted first, so registering
  costs nothing and closes the window that produced the incident this pattern exists for —
  `seed.spec.ts` used to delete its own deck on its last line and `E2E deck 1785947414992` has sat
  orphaned since 2026-08-05 because a failure earlier in the spec skipped that line permanently.
- **Register the generation too, not only the deck.** `flashcard` and `flashcard_schedule` cascade
  from `deck`, so deleting the deck takes them; **`generation_session` has no deck foreign key at
  all**, so a deck-only registration leaks one row per generation, permanently, on a stable
  account. Scope it by a SHORT leading marker inside `source_text` — a PostgREST filter carrying a
  long value answers **414** before the query runs (§6.6's C10X-28 trap), and a journey's source
  text is deliberately long.
- **Every accessible name matches as a case-insensitive SUBSTRING by default**, so `exact: true` is
  the rule and not a flourish. Measured pairs in this app: `Akceptuj` (per-card) also matches
  `Akceptuj (3 fiszki)` (bulk toolbar), and `getByLabel("Password")` also matches the
  `Show password` toggle button, which fails on a strict-mode violation rather than on a count.
- **Three more locator hazards, each measured.** `Edytuj` renders on **two** pages — the deck page
  and the review screen — so a count of it is an oracle of the deck's contents **only while the
  browser is on `/decks/<publicId>`**. `Usuń` over-counts by one under `getByRole` (the deck-delete
  button in the sticky header) and by two in the raw DOM. And `role="alert"` is present on **every**
  authenticated page in mock mode (the OpenRouter config banner, first in DOM order), so no
  assertion may select it unscoped.
- **Wait for the EFFECT of an action, never for time, and retry the ACTION.** Every `<dialog>` is
  permanently mounted and opened imperatively, and every form island is React-controlled, so a
  click or a `fill()` landing before hydration is silently lost — and the obvious wait does not
  catch it, because `fill()` followed by `toHaveValue` passes at the instant the DOM value is set
  and React wipes it on its first render. Reuse `seed.spec.ts`'s `toPass` helper shape rather than
  re-deriving it, and **guard first**: a retry after a successful click on a toggle undoes it and
  hangs forever. `page.waitForTimeout` is a lint error (`playwright/no-wait-for-timeout`), as are
  `waitForSelector`, element handles, skipped tests and a spec with no assertion.
- **`workers: 1` is load-bearing and measured** (§6.6's C10X-46 entry). Astro's dev server compiles
  routes on demand and Vite re-runs SSR dependency optimisation while doing it, so concurrent first
  requests hit chunks that no longer exist and answer 500 — reaching a spec as a missing element
  or a click that never becomes actionable. Do not raise it to buy back the ~9 s.

**Do not assert on card content.** `mockCards` output is byte-identical across calls, so two
generations into one deck produce duplicate fronts — the same reason §6.5 gives for using
`generation_id` rather than `front` as an identity. Content is usable as a one-off probe during a
manual check; it is not an oracle.

**And write an assertion that can be red for the right reason.** `toHaveCount(0)` and "the sign-in
heading is absent" both pass green over a page answering **500**, which is measured rather than
argued: with journey B's presence assertion removed, its public control stayed **fully green** over
a landing page that threw. Pair every absence with a presence anchor on the same page — a heading
that only the correct page renders — exactly as §6.2 pairs every denial with a positive control.

**The deliberate-breakage expectation is the same as everywhere else in this file**, with one
addition this layer earned. Neuter the thing your spec claims to observe, record the observed
failure string and the split with its denominator, restore, and verify the restore by hash. The
addition: **check what your neuter actually does to the harness before you read its colour.** Two
of this layer's planned breakage runs never started — one made `/auth/signin` redirect to itself,
one took down the route `webServer.url` probes — and both ended on
`Timed out waiting 120000ms from config.webServer` rather than on any assertion. A neuter that
prevents the run is not evidence about the guard.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Generated Supabase types (`src/db/database.types.ts`)** — the generator
  is the test. Re-evaluate if the file is ever hand-edited. (Source: Phase 2
  interview Q5.)
- **shadcn-style primitives in `src/components/ui/`** — vendored library
  surface, not this project's logic. Re-evaluate if a primitive grows
  project-specific behaviour. (Source: Phase 2 interview Q5.)
  > **Scope correction (2026-07-25, from C10X-22).** This exclusion covers the
  > primitives' own behaviour. It does **not** extend to the global style layer
  > they all inherit — `src/styles/global.css` is written by this project, not
  > vendored, and a single line there breaks every input and button at once. Read
  > the exclusion as "we don't test the vendored component", never as "we don't
  > test anything rendered by `ui/`".
- **Visual rendering of the focus ring (and contrast generally)** — no
  automated coverage, by capacity, not by belief that it is safe. The defect
  class is real and shipped: C10X-22 is invisible to `eslint-plugin-jsx-a11y`,
  because the JSX is correct and so is the Tailwind ring configuration — the
  ring rendered a real `box-shadow` all along. The fault was the **value** of
  the shared `--ring` token, which feeds both the primitives' `ring-*` and the
  app-wide `outline-color`, resolving to its light-theme grey on a permanently
  dark surface: 43 of 48 controls measured 2.3–2.7:1 against a 3:1 bar. (The
  ticket's own suspected cause — "`ring-*` never maps to a real box-shadow" —
  was refuted by measurement; do not re-derive the plan from it.) Catching this
  needs a computed style in a real browser, and the layer that would produce one
  still does not exist: §4 gained a Playwright runner on 2026-08-05, nothing reads
  a computed style through it, and this project carries **no visual-diff tool at
  any layer**. Until such an oracle is wired the guard is the measured acceptance
  check in the change itself (contrast ≥ 3:1, **WCAG 1.4.11 only**), recorded per
  control before and after in
  `context/archive/2026-07-25-focus-ring-a11y/verification.md`.
  (Source: C10X-22 / `context/archive/2026-07-25-focus-ring-a11y/`.)
  > **Citation corrected (2026-07-25, impl-review F4).** This bullet used to
  > claim "WCAG 1.4.11 / 2.4.11". Only 1.4.11 (Non-text Contrast) is measured.
  > **2.4.11 is Focus Not Obscured, and nothing tests it** — the harness reads a
  > computed style on a control focused in place, so an indicator that paints
  > correctly and is then scrolled underneath something reads as a pass. That is
  > not hypothetical here: the deck page stacks two opaque `sticky` bars
  > (`pages/decks/[publicId]/index.astro` `sticky top-0 h-16`,
  > `components/flashcards/FlashcardWorkspace.tsx` `sticky top-16`) over the
  > scroll container in `layouts/AuthenticatedLayout.astro`, and there is no
  > `scroll-margin-*` or `scroll-padding-*` anywhere in `src/`, so Tab-driven
  > scroll-into-view aligns a control with the top of the scrollport — i.e.
  > under both bars. Treat Focus Not Obscured as untested negative space, not as
  > covered by C10X-22. Fixing it is a one-property change
  > (`scroll-padding-top`) but needs its own browser verification; deliberately
  > left out of C10X-22 rather than claimed without evidence.
  >
  > **Re-decided 2026-08-05 (`test-plan-refresh-2026-08-05`) — the exclusion STANDS,
  > and its trigger was mis-keyed rather than fired.** The clause struck from the prose
  > above read "Re-evaluate the moment any §3 phase wires e2e". **No §3 phase ever did**:
  > a Playwright runner and one spec landed on 2026-08-05 **outside** the phased rollout
  > — the C10X-39/40/42/43 pattern one more time — so the condition was never literally
  > met, and leaving it unreconsidered would have turned it into a dead clause pointing
  > at a moment that had already passed under another name. §3 Phase 6 now claims the
  > layer as `not started`, and claiming is not wiring (§5). Re-decided on the merits
  > instead, and the merits have not moved: a browser runner is not a computed-style
  > oracle, nothing runs the one that exists (§4's e2e row, §3's Phase 6 note), and no
  > visual-diff tool exists here at any layer. So the condition is **restated** rather
  > than deleted — re-evaluate when a computed-style or visual-diff oracle is actually
  > wired, never when a browser runner merely exists.
  >
  > **Checked again 2026-08-09 (C10X-46) — the exclusion STANDS, and the absence of an edit
  > is recorded so nobody hunts for one.** This is the first date on which the restated
  > condition could have been met: §3 Phase 6 shipped, so the layer is wired and runs. It
  > wires **neither** oracle — nothing in it reads a computed style, and this project still
  > carries no visual-diff tool at any layer. That is exactly why the 2026-08-05 restatement
  > was worth making in those terms rather than in "a browser runner exists" terms. One clause
  > above is now stale in WORDING only and is left standing as the dated record: "nothing runs
  > the one that exists" was true when written, and `npm run e2e` runs it today. The decision
  > it supports is untouched.
  >
  > **Re-decided 2026-08-05, separately, for the nested `scroll-padding-top` deferral —
  > still deferred, and its blocker is restated because it was never the one it sounded
  > like.** "Needs its own browser verification" reads as a missing capability and was
  > not one: browser work in this project has always been manual verification recorded
  > per change (§4's tooling list), so the evidence was collectable on 2026-07-25 and
  > simply was not collected. A Playwright runner existing changes nothing about that —
  > nothing runs it, and §3's Phase 6 note records the harness as not yet trustworthy.
  > What the deferral gains today is an owner rather than a capability: whoever wires
  > the e2e layer under §3 Phase 6 inherits the cheapest place to collect the evidence.
  > Until then this stays untested negative space, exactly as the paragraph above says.
  >
  > **The owner named above arrived on 2026-08-09 (C10X-46) and DECLINED it, which is a
  > decision and is dated here so it does not read as an omission at the next review.**
  > Phase 6 wired the e2e layer and its "What We're NOT Doing" excludes `scroll-padding-top`
  > explicitly. Three reasons, none of them capacity. The evidence WCAG 2.4.11 needs is a
  > browser matrix of Tab-driven focus against two `sticky` bars — an interaction neither of
  > this phase's two happy-path journeys performs, so "the layer exists" bought nothing here.
  > Focus Not Obscured is outside every oracle the phase built: its assertions read URLs,
  > accessible names and row counts, never geometry. And a one-property fix landing without
  > that matrix would be the claim-without-evidence C10X-22's own impl-review refused. **The
  > ownership is therefore re-stated rather than left pointing at a phase that has closed:
  > it belongs to whoever next collects a manual browser matrix on the deck page** — the
  > `/10x-e2e` manual-verification step of any change touching `AuthenticatedLayout.astro`
  > or either sticky bar is the cheapest such moment. Until then it stays untested negative
  > space.
- **Marketing/landing pages and static copy** — snapshot tests break
  constantly and catch nothing. Re-evaluate if the landing gains a real
  flow (e.g. the inline sign-in form parked as C10X-20). (Source: Phase 2
  interview Q5.)
- **Log lines emitted by dependencies** — inside Risk #4's scope, deliberately not
  owned. `@supabase/ssr/dist/module/cookies.js:22,29` and
  `@supabase/auth-js/dist/module/lib/fetch.js:110` do write to Workers Logs via
  `wrangler.jsonc`'s `observability`, and they were **measured** rather than assumed
  safe: they carry session/transport material — on `fetch.js:110` a fetch `TypeError`
  (message + stack), not the request `init` — never pasted source text. Pinning
  `node_modules` internals would break on every patch bump with no user-visible cause.
  What _is_ guarded is first-party code: `tests/lib/no-logging.test.ts` fails on any
  `console.*` anywhere under `src/`, which is a real gate because `no-console` is
  configured `"warn"` and `npm run lint` exits **0** on a warning (measured, C10X-28).
  Re-evaluate if a dependency is ever found logging request bodies. (Source: C10X-28 /
  `context/changes/ai-candidate-generation-test-2/`.)
  > **Dated correction, 2026-08-12 (C10X-54), and it is narrower than it will look.** The exclusion
  > above **stands**: no test here reads a real log sink, the dependency lines themselves are still
  > unowned, and pinning `node_modules` internals is still refused for the reason given. What moved
  > is one layer up from those lines. Since C10X-53 they have a monitored sink
  > (`Sentry.captureConsoleIntegration` in `src/worker.ts`), and the DECISION that separates them
  > from first-party output — recognised dependency noise thinned to ~10 %, first-party errors
  > passed **unsampled** — had **zero** coverage at any layer until this date. It is now a pure
  > function, `src/lib/sentry-sampling.ts`, held by two files with different claims:
  > `tests/lib/sentry-sampling.test.ts` (a truth table over fabricated events driving the REAL
  > `DEPENDENCY_NOISE` array) and `tests/lib/sentry-wiring.test.ts` (a per-LINE guard that
  > `src/worker.ts`'s `beforeSend` still delegates to it — the truth table stays fully green through
  > an unwiring, which is why it is two files and not one). It earned a test rather than a comment
  > because the class already shipped once: the first version discriminated on the
  > `logger === "console"` stamp alone and therefore dropped ~90 % of real application errors
  > **silently**, caught only by measurement during the C10X-53 ship (21 deliberate errors → 3
  > events) and fixed in `d381c07`.
  >
  > **Read the boundary in the same breath, because this is where the entry could be over-read.** No
  > §2 risk row moves and no coverage claim widens. Nothing in this project loads `src/worker.ts`,
  > so **no layer asserts that Sentry invokes `beforeSend` at all** — the one instrument that would
  > have surfaced a recurrence end-to-end was the public `/api/shipprobe` route, and the same change
  > deleted it from production. The truth table proves the decision is right; the guard proves that
  > file still makes it; neither proves the SDK calls it. (Source: C10X-54 /
  > `context/changes/remove-sentry-probe/`.)
- **Rate limiting on generation** — no rate limit exists, so a test would
  require adding the safeguard first. Re-evaluate if a limit is
  implemented; the cost exposure is partially covered by Risk #6
  (server-side length enforcement). (Source: Phase 3 challenger pass.)
- **React islands' own fetch-response handling** — untested by _construction_ at every
  layer this project runs, not by decision, and named here because that distinction was
  invisible until it cost something. §6.4's "pages are deliberately not rendered" is
  well known; the islands those pages mount are equally unreachable, and nobody had
  written it down. The gap is not academic: **the one production bug the C10X-27
  audit found lives
  exactly there** — `StudySession.rate()` checks `!res.ok` on a response that
  middleware turned into an HTML `200`, so every rating is silently discarded while
  the UI reports progress. Four sibling islands parse before checking `ok` and would
  survive it; only `rate()` inverts the order, and no layer this plan carries today can
  see the difference — §4's Playwright row is a runner nobody runs (§3 Phase 6,
  `not started`), which is a capability rather than a layer. What follows: an island's
  response handling is **reviewed by reading, deliberately and every time** — when a
  change touches a `fetch` in an island, diff its ok/parse/redirect handling against
  `GeneratorForm.tsx`, `FlashcardWorkspace.tsx` and `CandidateReviewWorkspace.tsx`
  rather than trusting the suite. (Source: C10X-27 audit, 2026-07-26.)
  > **Narrowed, not closed (C10X-27, 2026-07-26).** The **decision** is now testable and
  > tested; the **JSX remains unreachable**. Rather than add a DOM environment and a
  > component-test layer — which §4 would need a new row and a `checked:` date for — the
  > two decisions that failed were extracted into pure functions and covered directly:
  > `readJsonResponse` in `src/lib/http.ts` (`tests/lib/http.test.ts`, 9 cases, including
  > the defect's exact `200 text/html` shape) and `rateOutcome` in
  > `src/lib/study-session.ts` (`tests/lib/study-session.test.ts`, 7 cases: counting a
  > real transition, holding the card and offering a recovery on `alreadyApplied`,
  > offering a skip on a JSON 404 and withholding it on an unparseable one or a
  > retryable failure).
  >
  > **Both were widened again the same day by `/10x-impl-review` on this change**, and the
  > second one closed a defect rather than adding coverage. `JsonResult`'s failure variant
  > gained `parsed`, because collapsing "unparseable" into `status: 0` lost the real status
  > and made a 404 behind a proxy's HTML error page indistinguishable from "not an HTTP
  > failure" — leaving the user stuck on a card the skip affordance existed to release. And
  > `alreadyApplied` no longer advances: the compare-and-set keys on the `reps` **version**,
  > not the grade, so a second tab rating the same card with a _different_ grade landed
  > there and that grade was discarded in silence. The island now holds the card, says so
  > neutrally, and adopts the `progress.reps` the endpoint always returned and nobody read,
  > so re-rating applies. Evidence, including the row-level before/after showing an `Again`
  > actually landing after recovery:
  > `context/archive/2026-07-26-srs-study-session-test/verification.md`. What is still uncovered by construction is everything around
  > them — the island's rendering, its state wiring, whether `rate()` actually calls the
  > helper. So the review-by-reading rule above **stands unchanged**; the extraction
  > shrinks what a reading has to catch, it does not remove the need for one. The same
  > applies to `SessionSizeControl`'s `SIZE_MIN`/`SIZE_MAX` mirror, which §6.6's Phase 4
  > entry names as the one bound layer no test reaches.
  >
  > **A second instance, and it shows what single-sourcing does and does not buy (C10X-28,
  > 2026-07-26).** `GeneratorForm`'s `maxLength`, `min`/`max`, `<select>` options and char
  > counter now import their values from `src/lib/generation-limits.ts`, the same module the
  > endpoint imports — so the two ends can no longer disagree about the **value**. That each
  > end still _enforces_ it is a different claim: the server half is asserted
  > (`tests/generation/generate.test.ts`), the client half is one manual browser run
  > recorded in the change's `verification.md`, exactly as with `SessionSizeControl`. Worth
  > knowing before writing a case against it: `maxLength` truncates first, so the island's
  > own `text.length > SOURCE_MAX` branch and `CharCount`'s red state are **unreachable
  > through the UI** — a second belt, not the visible guard.
  >
  > **A third instance, and it is the OPPOSITE situation — do not read the two as the same
  > (C10X-30, 2026-07-28).** The three card islands (`CreateFlashcardModal`, `FlashcardItem`,
  > `CandidateItem`) import `FRONT_MAX`/`BACK_MAX` the same way, but they carry **no
  > `maxLength` attribute** — verified by enumeration: `maxLength` appears in `src/components/`
  > only in `GeneratorForm`. So nothing truncates the input first, their over-length branch
  > **is** the visible guard, and it is genuinely reachable through the browser. Where the
  > `GeneratorForm` note above says an untested branch is unreachable anyway, here an untested
  > branch is the one a user actually meets. The server half is asserted
  > (`tests/validation/cards.test.ts`) and backed by a DB CHECK; the client half rests on the
  > manual browser checks in `context/archive/2026-07-28-server-side-validation-test/verification.md`.
  >
  > **A fourth instance, and it belongs with the third rather than the second (C10X-37,
  > 2026-07-31).** `CreateDeckModal` and `DeckActions` import `NAME_MIN`/`NAME_MAX`/
  > `DECK_NAME_MESSAGE` from `src/lib/deck-limits.ts`, the same module `api/decks/index.ts` and
  > `api/decks/[publicId].ts` import — so, as always, the two ends cannot disagree about the
  > **value**, and that each end still enforces it is a separate claim of which only the server
  > half is asserted (`tests/validation/decks.test.ts`). They side with the card islands, not with
  > `GeneratorForm`, and this was **measured rather than assumed, at two layers**: in the browser
  > neither `#deck-name` nor `#deck-rename` carries a `maxLength` attribute
  > (`hasAttribute('maxlength')` → `false` on both), and in the source `maxLength` appears in
  > `src/components/` **only in `GeneratorForm.tsx`** — twice, on its own new-deck name input and
  > its textarea (`grep -rn "maxLength" src/components/`, the other two hits being comment lines).
  > So nothing truncates the deck inputs first and the islands' over-length branch is the branch a
  > user actually meets. Note the asymmetry inside one bound: the generate surface's new-deck field
  > IS input-stopped at `NAME_MAX` while the two deck forms' are not, so the same rule is reachable
  > through one form and sealed behind another. Their guard runs `.trim()` then 1..100 and `preventDefault()`s, which is why
  > the server's over-length branch is unreachable through the hydrated UI — Risk #6's premise,
  > not an argument against testing the server. The client half rests on the browser matrix in
  > `context/archive/2026-07-31-deck-form-hardening/verification.md`, where the trap worth carrying is that
  > the deck page renders a SECOND `[role="alert"]` (the OpenRouter config banner), so an unscoped
  > `querySelector('[role="alert"]')` reads the wrong node and the case passes on it.
  >
  > **Re-decided 2026-08-05 (`test-plan-refresh-2026-08-05`) — the exclusion STANDS, and its
  > trigger was mis-keyed rather than fired.** The clause struck from the prose above read
  > "Re-evaluate the moment any §3 phase wires e2e; that is the layer this belongs to".
  > **No §3 phase ever did**: a Playwright runner and one spec landed on 2026-08-05
  > **outside** the phased rollout, so the condition was never literally met. §3 Phase 6 now
  > claims the layer as `not started`, and claiming is not wiring (§5). Re-decided on the
  > merits — and this is the one exclusion whose merits a wired e2e layer would move only
  > PARTLY. Phase 6 scopes two journeys, so at most two islands get exercised on one happy
  > path each, while **four** carry a `fetch` (measured 2026-08-05: `GeneratorForm`,
  > `FlashcardWorkspace`, `CandidateReviewWorkspace`, `StudySession`) and the defect this
  > bullet was written from was a wrong ok/parse ORDER on a response no journey
  > deliberately produces. **One exemplar spec covers one flow, not the class.**
  > So the review-by-reading rule above survives Phase 6
  > unchanged, and the restated condition is narrower than the one it replaces: re-evaluate
  > per island, when a spec actually drives that island's failure branch — never on the
  > arrival of the layer as such.
  >
  > **Checked against the shipped layer 2026-08-09 (C10X-46) — the exclusion STANDS, and the
  > 2026-08-05 prediction held exactly.** §3 Phase 6 landed with two journeys, and they drive
  > `GeneratorForm` and `CandidateReviewWorkspace` on one happy path each; `FlashcardWorkspace`
  > and `StudySession` are untouched, and no spec drives ANY island's failure branch. So the
  > per-island condition is not met for a single island, and the review-by-reading rule above
  > is unchanged. Two smaller notes rather than a rewrite. The counting hazard this bullet
  > records was re-measured and is now enforced where it bites: `exact: true` is a layer-wide
  > rule in §6.11, and `role="alert"` being present on every authenticated page is written
  > there too. And the layer's specs are themselves under `npm run lint`'s Playwright rules and
  > `npm run typecheck` in CI — which says they compile and lint, never that an island's
  > `fetch` handling was executed.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-05 (`test-plan-refresh-2026-08-05`). §3, §4 and §5 were
  rewritten by that refresh; §1 and §2 were read and **deliberately left untouched**, because e2e
  adds a layer of proof for existing risks and introduces no new product failure scenario.
- Stack versions last verified: 2026-08-05. Every version §4 states was checked against its
  installed value and **every one matched, so no version cell was edited** — the non-edit is the
  result, not an omission. The review deliberately also covered the rows a version sweep cannot
  reach: `getViteConfig()` still wiring the unit+integration row, `vi.mock` still resolving to
  exactly one file, `db:start` still chaining `db:kong`, `renderToResponse` still rendering
  `routeType: "endpoint"`, and a11y still wired lint-level only.
- AI-native tool references last verified: 2026-08-05. `evals/lib/judge.ts` was re-read at the
  source rather than trusted — the pinned judge model, the `EVAL_JUDGE_MODEL` override,
  `temperature: 0` and `json_schema` structured outputs — and the four Stack-grounding lines were
  re-checked for availability.
- **§4's per-row `checked:` dates deliberately stay older than the two lines above, and that is a
  decision rather than drift.** A row's date stamps its whole Notes cell; the two lines above stamp
  versions and mechanisms. The 2026-08-05 review confirmed every version and the mechanism each row
  turns on, but not every clause those cells carry — e.g. that the Kong recreation is wiped by
  `npx supabase stop`, which no command run that day observed. Bumping the row dates would have
  claimed more than was measured, so they were left alone and the gap is recorded here instead.
- **Every `N/N, M files` suite total in this file counts VITEST files only** — Playwright's specs
  under `tests/e2e/` are collected by a different runner and enter no figure here, so adding one
  moves neither number, and a reader must not read a static `M` as evidence that the e2e layer is
  empty (stated once, rather than by editing figures that were true when they were measured).
- §3 Phase 4 / Risk #3 coverage claims last **audited against the code**:
  2026-07-26 (C10X-27). Suite state at that moment: 69/69 green, 8 files, local
  stack up, `OPENROUTER_API_KEY` unset. Three claims in this file were found false
  or stale and are corrected in place — see the header. **A coverage claim in §6.6
  is only as good as its audit date**; the two-day-old Phase 4 table already
  overstated one row.
- §3 Phase 4 / Risk #3 coverage claims last **proven by execution**: 2026-07-26, later
  the same day, by C10X-27 shipping. Suite state: **109/109 green, 11 files**, local
  stack up, `OPENROUTER_API_KEY` unset, `git diff` clean for `src/` after every breakage
  check. Every deliberate-breakage count in §6.6's Phase 4 entry now comes from a run
  executed against these files, and each restore was confirmed by a before/after
  definition `diff`. Mutation coverage on `rateCard`: 56.90% (33 killed / 13 survived /
  12 uncovered), no assertion added — register in
  `context/archive/2026-07-26-srs-study-session-test/mutation-register.md`.
- **Two coverage gaps are open and named**, deliberately not folded into the `complete`
  status: the RPC's `f.id asc` tie-break has no assertion that observes its _presence_
  (only the batch's order), and §6.6's four-policy neuter no longer reproduces on a dev
  DB past PostgREST's `max_rows`. Both are described where they bite, in §6.6 and §6.7.
- §3 Phase 2 / Risks #4 and #6 coverage claims last **proven by execution**: 2026-07-26
  (C10X-28 / C10X-34 / C10X-30, change folder `ai-candidate-generation-test-2`). Suite state
  measured at completion: **166 passed / 166, 14 files**, local stack up,
  `OPENROUTER_API_KEY` unset, `npm run lint` and `npm run build` clean, and
  `git diff -- src/` empty after every deliberate-breakage check. Every count in §6.6's
  C10X-28 entry comes from a run against these files; each RLS restore was confirmed by a
  `pg_policies` before/after `diff` (empty), and the `.env` edit behind the banner check by a
  `diff` against its backup (empty). Mutation coverage on the new auth mapper: **93.33%**
  (42 killed / 3 survived / 0 uncovered) — the three survivors are equivalent mutants,
  each checked individually rather than assumed, and one assertion was added because of the
  run (every constant in the exported closed set is non-empty; an empty one renders as no
  reason at all). Register: the change's `verification.md`.
- **Three false or stale statements in THIS file were corrected by that slice**, all of them
  pointers rather than claims — and pointers rot silently: every
  `context/changes/<archived-id>/…` evidence path was rewritten to its
  `context/archive/<date>-<id>/…` form and **each one verified to resolve on disk**; the S-05
  Stryker command's line range (`src/lib/flashcards.ts:181-212`) was corrected and the two
  symbols named beside it, because `75df78f` had moved them two hours after the recorded run
  and Stryker reports a score for whatever the stale range happens to contain; and the same
  wrong `generations.ts` anchor was fixed in a live comment at
  `tests/generation/generate.test.ts`. Three earlier items this change's research had listed
  were already closed by C10X-27 and are not re-fixed.
- **Risk #4's boundary and Risk #6's remaining half are named, not folded into the
  headline.** Risk #4: no test reads a real log sink, and dependency-emitted lines are in
  scope but unowned. Risk #6: the card-content endpoints are untested, which is the single
  item between §3 Phase 2 and `complete`. Both are described where they bite, in §6.6's
  C10X-28 entry and §7.
  > **Risk #6's half is closed as of 2026-07-28 (C10X-30); Risk #4's boundary stands
  > unchanged.** The line above is kept as written because it was the accurate statement on
  > 2026-07-26 and because §3 Phase 2's `implementing` status hung on it. What replaced it is
  > the entry below.
- **Cloud schema checked, and it matches.** `npx supabase migration list` run from the
  worktree on 2026-07-26 shows Local == Remote on **all ten** migrations, including
  `20260724220524` — the one carrying the `session_size` CHECK and the RPC tie-break these
  tests lean on. The S-03 impl-review's open "applied locally only, cloud push never
  confirmed" is closed. Note this was a point-in-time observation, not a gate — **which
  C10X-29 changed on 2026-07-28**: there is now a CI drift check, so the same fact is
  re-established on every push to `main` instead of by hand.
- §3 Phase 3 / Risk #5 coverage claims last **proven by execution**: 2026-07-28 (C10X-29,
  change folder `schema-drift-test`). Suite state **after the change's impl-review**:
  **178 passed / 178, 15 files** (166 before, + 12 comparator cases); it was 177/177 at
  phase completion, and the twelfth case came from the review — see the entry below. Local
  stack up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0, `npm run build` exit 0. The baseline
  was measured **before** the gate was wired — ten local migrations against ten applied
  cloud migrations, **IN SYNC as of 2026-07-27**, confirmed against a second independent
  remote oracle — precisely so the first red run after the gate landed would have one
  hypothesis rather than two. Every breakage split in §6.6's C10X-29 entry comes from a run
  against these files, and each temporary edit was reverted with the revert **verified**
  (`md5sum` against a pristine copy; the rehearsal commits dropped from the branch).
- **The impl-review found a false green in the gate itself, and it is worth reading as a
  pattern rather than a one-off.** `/10x-impl-review` (2026-07-28) verified every plan
  contract as met and every automated criterion as green — and then found, by probing the
  comparator with inputs no criterion named, that **two migration files sharing one version
  returned `clean: true`**. That is drift class 1 (committed, never applied) reported as OK
  by the gate built to catch exactly it. The cause is instructive: the `Set` that makes the
  comparison correctly **order-blind** — load-bearing, because this repo carries a genuine
  out-of-order pair — is the same thing that makes it **collision-blind**. A design property
  and a defect from one line. Closed by a `duplicate` list folded into `clean` with its own
  remedy (rename, not `db push`), plus a twelfth fixture; the out-of-order case was
  re-checked and still reads clean, so the fix is additive. Two further review fixes hardened
  the same file: remote versions are now trimmed and shape-checked, and the `.sql` test is
  case-insensitive so `_x.SQL` is surfaced rather than skipped. Full record in the change's
  `verification.md` and `reviews/impl-review.md`.
- **One prediction in the plan was wrong and is recorded as observed, not rounded.** The
  `missingLocal` neuter was predicted to turn exactly one case red; it turns **two**,
  because the both-directions-at-once case asserts the same field. And **criterion 4.4 does
  not go red as worded** — `db:types` overwrites the working tree before the diff runs, so
  the check only works on _staged_ content. Both are in §6.6; the second is a trap a
  contributor following the wording would read as "the gate does not work".
- **Risk #5's boundary is per class, and it is stated in two places on purpose.** §2's row
  is the coverage claim (which classes the project is protected against); §6.6's C10X-29
  entry is the mechanism (what the gate observes). Three classes are invisible to the gate
  by construction — a migration amended after being pushed, production hand-edited in
  Studio, `repair --status applied` on something never applied — and reachable only through
  the on-demand DDL diff, **which now works end to end but which nobody is scheduled to
  run** — the gap is the schedule and the owner, not the capability. Two classes (config
  drift, seed-row drift) have no check at all. **No test in the suite touches the cloud.**
- **Ship-time items are CLOSED, and closed by observation rather than by assertion**
  (2026-07-28, merge `f7a83c0`). The gate ran on the real path for the first time — run
  30379662871, `ci` → `drift` (5 s) → `deploy`, all green, the gate printing
  `10 local entries against 10 applied cloud migrations` / `OK`, with zero credential hits in
  the log. The DDL workflow registered only **after** the merge (checked before and after, so
  the registration is evidence rather than a fact), and was then dispatched three times: two
  green from `main` that agree with each other, and one red from a scratch branch, which is
  the negative control the three green runs would otherwise have lacked. That red run also
  fired the artifact-upload path for the first time and confirmed the impl-review's F3 fix by
  measurement: the diff body is in the artifact and **not** in the world-readable log. Every
  `## Progress` box in the change is now ticked. Full record, including the reverted scratch
  branch, in the change's `verification.md`.

- §3 Phase 2 / Risk #6's **card-content** half last **proven by execution**: 2026-07-28
  (C10X-30, change folder `server-side-validation-test`). Suite state measured at the start of
  the breakage phase and again after both restores: **193 passed / 193, 16 files**
  (178 before this change; +12 in the new `tests/validation/cards.test.ts`, +1 in
  `candidates.test.ts`, +2 in `errors.test.ts`). Local stack up, `OPENROUTER_API_KEY` unset,
  `npm run lint` exit 0, `npm run build` exit 0, and `git diff -- src/ supabase/` empty after
  every breakage restore — verified by `md5sum` against a pristine copy for the source edit and
  by a `pg_get_constraintdef` before/after `diff` for the constraint. Both splits in §6.6's
  C10X-30 entry come from runs against these files, read against a denominator of **12**.
- **The impl-review then took the suite to 207/207, 17 files, and two of its additions were
  proven falsifiable by their own breakage runs.** `/10x-impl-review` (2026-07-28) reproduced
  every automated criterion above and raised 10 findings, all triaged. Five changed the suite:
  a **boundary control at exactly `IDS_MAX`** (`candidates.test.ts`) — narrowing `IDS_MAX` to
  `2` turns **1 of 22** red on it while the pre-existing 101-id case stays green, which is
  exactly the blindness it removes; **constraint NAMES** alongside `23514` in
  `cards.test.ts`'s independence case, matching `study.test.ts:717`, because the code alone
  cannot say WHICH guard fired and layer attribution is that case's purpose; a `File`-part
  case on the **edit** endpoint and the first two cases ever to touch **`signup.ts`**; and
  `tests/lib/forms.test.ts` (9 cases) for `src/lib/forms.ts`, where the four inlined copies of
  the string-only form read were extracted so they could be tested at all.
  Two measurements are worth carrying. **GoTrue answers an empty address differently per
  route** — `signup` → `anonymous_provider_disabled` (it reads it as an anonymous sign-in
  attempt), `token?grant_type=password` → `validation_failed` — so signup lands on the
  catch-all; that is now pinned by equality rather than smoothed over, and it corrects a false
  comment in `auth-errors.ts`. And **both causes of a `formData()` rejection throw the same
  `TypeError`**, so the auth routes tell "never a form" from "a form that arrived broken" by
  the **Content-Type header**, not by the exception; collapsing that discriminator turns
  **3 of 47** red. Full record: the change's `reviews/impl-review.md` and `verification.md`.
- **One prediction was less precise than the run, and is recorded as observed.** The plan said
  run 2's case 8 "stays red from run 1"; it does, but on a **different assertion** — run 1
  failed it on the closed-set message, run 2 on the count, because case 8 also sends an
  over-max `front` and its count oracle likewise sits first. Two of run 2's three reds moved
  from the message to the count, not one. Same discipline as C10X-29's `missingLocal` neuter:
  the conclusion is unchanged, the prediction was simply rounder than reality.
- **Six documents said "4xx" (and "POST/PATCH") about endpoints that answer `302` and export no
  `PATCH`.** Corrected 2026-07-28 in this file (§2's guidance row, §6.3, the §3 sequencing
  note), in the change's own `change.md`, and as a **dated correction line** — not a rewrite —
  in `context/archive/2026-07-26-ai-candidate-generation-test-2/change.md`. The Jira description
  and its two comments are corrected outside this repo at `/jira-finish-work`. The wording was
  not cosmetic: a contributor following it would have written a status assertion on a status
  that a refusal and a success share.
- **Risk #6's remaining boundary is the ISLAND half, and it is not the same situation as
  `GeneratorForm`'s.** The three card islands carry no `maxLength`, so their over-length branch
  is reachable through the browser rather than sealed behind an input stop — an untested branch
  a user actually meets. Named in §7 and in §6.6's C10X-30 entry, carried by manual browser
  checks. Re-evaluate the moment any §3 phase wires e2e.
  > **Corrected 2026-08-05 (`test-plan-refresh-2026-08-05`), the last sentence only — and
  > appended rather than rewritten, because this is a dated ledger entry.** That sentence
  > was the accurate statement of the trigger this entry inherited from §7 on 2026-07-28 and
  > is left standing as that record. The trigger turned out to be **mis-keyed rather than
  > fired**: a Playwright runner and one spec landed on 2026-08-05 **outside** the phased
  > rollout, so no §3 phase wired anything and the condition was never literally met. §3
  > Phase 6 now claims the layer as `not started`, and claiming is not wiring (§5). This is
  > the **third and last** site carrying that clause and the only one outside §7 — a
  > §7-scoped edit list misses it, which is why it is named here. Counted rather than
  > carried over: the refresh's own plan named **four** anchors, but one of them (the nested
  > `scroll-padding-top` deferral) never carried this sentence at all — its blocker was
  > worded "needs its own browser verification" — so four anchors and three clause sites are
  > two different figures. Everything else in the bullet is untouched and
  > still true: the three card islands still carry no `maxLength`, their over-length branch
  > is still the one a user meets, and it still rests on manual browser checks. §7's own
  > re-decision of the same date is where the merits are re-stated.
- **A migration is committed and NOT yet pushed to the cloud** as of this entry
  (`20260728104500_flashcard_content_bounds.sql`). The pre-push row check ran read-only against
  production — `bad_front` 0, `bad_back` 0 over 38 rows, maxima 64/157 — so it applies without
  repair, but until `/ship` runs `db push` this is exactly drift class 1 and the C10X-29 gate
  will say so on the first push to `main`. That is the gate working, not a failure.

- §3 Phase 5 / Risk #7 coverage last **proven by execution**: 2026-07-29 (C10X-31, change
  folder `ai-candidate-generation-test-3`). Ordinary suite: **220/220, 18 files** (207 at
  C10X-30; +12 in `tests/lib/eval-scoring.test.ts`, +1 success-path audit-columns case in
  `generate.test.ts`), local stack up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0,
  `npm run build` exit 0, zero eval files collected by `npm test`, `git diff` empty for
  `vitest.config.ts` and `tests/setup/preflight.ts`. The eval itself: first calibrated run
  2026-07-29 — exit **1**, honestly red with a real finding (forced `niemiecki`/`francuski`
  → Polish cards, four of four runs; `auto` 25/25 green), thresholds kept unchanged by the
  recorded calibration decision, ~$0.012 and 158 s for the recorded run, structured outputs
  shipped as the judge request shape. Both deliberate-breakage checks ran and were reverted,
  reverts verified (diff clean, marker grep clean, suite green). **This coverage date does
  not refresh itself**: the eval is human-triggered, so "covered" here means "the capability
  exists and was exercised on this date", never "a signal is being watched".
- **Risk #7's boundary is stated in three places on purpose**: §2's row (the coverage
  claim), §6.6's C10X-31 entry (the mechanism and the does-NOT-prove list), and §5's
  LLM-as-judge row (local-only, human-triggered, no schedule). The deferred
  `workflow_dispatch` leg — with a separate, low-credit-limit OpenRouter key — is a named
  follow-up to be ticketed via `/jira-backlog-sync`, and the forced-language prompt defect
  the first run found is another; neither is folded into the headline.

  > **Both follow-ups are now closed, and this entry is corrected rather than rewritten.** The
  > forced-language defect: C10X-41, 2026-07-31. The `workflow_dispatch` leg, with exactly the
  > separate low-credit-limit key named here: **C10X-42, 2026-08-02**. Two things in the
  > sentence above survive untouched and are the reason it is not simply deleted. §5's row is
  > no longer "local-only" — that is the one word this correction retires — while
  > "human-triggered, no schedule" is as true as it was. And the entry directly above it,
  > "**this coverage date does not refresh itself**", is **unaffected**: a dispatchable
  > workflow that nobody dispatches refreshes nothing, so the sentence means today exactly
  > what it meant on 2026-07-29.

- **Suite ORDER-INDEPENDENCE last proven by execution: 2026-07-30** (C10X-32, change folder
  `flashcards-test-order`). This is a different axis from every entry above — it says the
  claims are trustworthy in any order, not that anything new is covered. Suite **228/228,
  19 files after this change's impl-review** (220/220, 18 at phase completion; the review
  added `tests/lib/retry-transport.test.ts`, 8 cases, so the transport wrapper's predicate is
  asserted rather than only argued — see the entry below). The matrix was run at 220/220 and
  re-confirmed at 228/228 on seeds 101/202/303 plus five fresh permutations. It comprised: the
  three seeds that were red before the fix (101 / 202 / 303, replayed
  green), **40 fresh un-pinned permutations, 0 red**, and a no-shuffle control
  (`--sequence.shuffle=false`) so declaration-order green was not traded away. Local stack
  up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0 (6 pre-existing `no-console` warnings,
  all in `evals/generation-quality.eval.ts` — warnings, not errors, because `no-console` is
  configured `"warn"`, and `tests/lib/no-logging.test.ts` gates `src/` only; **this line first
  said "in `scripts/`, allowed by AGENTS.md" and both halves were wrong** — `scripts/` emits
  none of them, and AGENTS.md's carve-out names `scripts/`, not `evals/`; corrected 2026-07-30
  by this change's impl-review, F5), `npm run build` exit 0. `sequence: { shuffle: true }`
  now lives in **both** configs — the two are deliberate independent copies, so each was
  edited on its own. Six pairs across three files were fixed by four edits; **two of the six
  were latent**, found by static analysis after three shuffled seeds never fired them, which
  is why the inventory came from reading rather than from re-rolling seeds.
- **A pre-existing local-stack flake was diagnosed here and is NOT an ordering defect** —
  recorded because a future contributor will meet it and reach for the wrong hypothesis. Kong
  pools keep-alive connections to PostgREST and **both sides idle out at the same 60 s**, so
  neither reliably closes first and the loser of that race can answer
  `502 upstream prematurely closed connection`; it surfaced downstream as whatever assertion
  was in flight, and none of the reds reproduced at their own seed.
  > **The mechanism in this bullet was corrected 2026-08-01 by C10X-39, and the original claim
  > is worth knowing because it is the hypothesis a reader will form again.** It said Kong keeps
  > its pooled connections idle for LONGER than the upstream does, so the 502 lands on the first
  > request after a gap — inference, never measured, and wrong twice over in the direction that
  > sounds fixable: the timeouts are equal (Kong's `upstream_keepalive_idle_timeout` 60 s;
  > PostgREST/warp 60.0 s, measured with Kong bypassed), and the drops cluster in a burst's
  > first 1-2 s (43/43) rather than on the single first request after the gap.
  > Measured, not assumed: **3/20 red with shuffle on, 3/20 with shuffle
  > off** — equal, therefore independent of this change — and two candidate causes were
  > **refuted** by measurement (restarting `rest` + `kong` did not clear it; cutting file
  > parallelism to `--maxWorkers=4` did not either). `tests/setup/retry-transport.ts` replays
  > only that response, only from a local URL, at most twice, only for a replayable body — and
  > **that predicate is asserted, not just described**: its pure half lives in
  > `tests/setup/retry-policy.ts` and `tests/lib/retry-transport.test.ts` pins it in 8 cases,
  > two of which were proved falsifiable by breakage runs (drop the body half → 1 of 8 red;
  > hostname equality → substring → 1 of 8 red). Added by this change's impl-review (F2),
  > because a guard that can swallow a failing response must be able to go red itself. Its
  > positive control in the wild is what makes the green evidence: over the 40-run matrix Kong logged
  > **22 more** such drops (86 → 108) while the suite went **0/40 red**, and no
  > duplicate-write failure appeared. **How loud such a failure would be is narrower than first
  > written** (corrected by this change's impl-review, F3): a duplicated `deck` insert 409s on
  > `deck_user_name_unique` and every count oracle goes red, but `flashcard` carries no
  > uniqueness constraint, so a duplicate from `createNonAcceptedCard` / `seedCard` — neither
  > followed by a count assertion — would be **silent**. Those seams rest on the
  > never-committed argument in the wrapper's header, not on a loud failure. The retry is
  > deliberately not method-gated: the measured flake was a POST.
  > **Two of those three sentences are superseded 2026-08-01 by C10X-39, and only by
  > measurement.** F3's narrowing was right in kind and short in count: a census that forced
  > every local non-`GET` request to replay found **six** silent seams, not two, and each is
  > now followed by a case-scoped count oracle proved falsifiable at the moment it was written.
  > "Those seams rest on the argument in the header" no longer holds — they rest on an
  > assertion. The method sentence gains the reason nobody had named: Kong ships no
  > `proxy_next_upstream`, so the proxy never retries a non-idempotent method and absorbs every
  > idempotent drop itself, which makes the POST/PATCH category the wrapper's entire marginal
  > value rather than an incidental widening. See §6.6's C10X-39 entry.
- **The eval path is shuffled too, and its failure set is unchanged.** Three runs
  (~$0.012 each), oracle = failure-set equality, never the exit code: run 3 reproduces the
  C10X-31 baseline exactly (`forced/niemiecki` + `forced/francuski`, 8 passed), the de/fr core
  is red in 3 of 3, and every red in every run sits on the **forced** path — no `auto` case,
  no `polski`/`angielski`. `forced/hiszpański` behaved as the documented intermittent (1 of 5
  cards mixed, green on its calibration re-run). Two reds in run 1 are **unidentified** — that
  run's output was truncated before it was saved — and the change's `verification.md` says so
  rather than rounding them up. The forced-language defect stays open, owned by the C10X-31
  follow-up.

- **Roadmap H-03 / the auth `?error=` channel last proven by execution: 2026-07-31** (C10X-34,
  change folder `auth-error-copy`). Suite **257/257, 22 files after this change's impl-review**
  (254/254, 21 at phase completion; the review added `tests/lib/auth-error-param-guard.test.ts`, 3
  cases, closing the one gap the entry above had disclosed rather than closed — see F2; the file
  is `tests/lib/error-param-guard.test.ts` since C10X-37 renamed it, 2026-07-31). At phase
  completion it was 228/228, 19 at the Phase 0
  baseline; +17 in `tests/auth/errors.test.ts` — which went 38 → 55 — plus two new files,
  `tests/lib/config-status.test.ts` (6) and `tests/lib/no-env-access.test.ts` (3). Local stack
  up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0 (the same 6 pre-existing `no-console`
  warnings in `evals/generation-quality.eval.ts`), `npm run build` exit 0. Six deliberate-breakage
  checks ran, each restored and each restore **verified** by a hash or `diff` against a pristine
  copy taken before the edit — including the `.env` and `supabase/config.toml` flips behind the
  manual checks. Mutation coverage on `src/lib/auth-errors.ts`: **92.98%** (53 killed / 4
  survived / 0 uncovered), no assertion added — every survivor confirmed **equivalent by
  execution**, not by argument.
- **Two predictions in that plan were less precise than the runs, and both are recorded as
  observed.** Breakage check E was predicted to turn 1 case red and turns **2** (the identity
  function also fails the empty-string half), and check A's red is a **pair** — a pure row and a
  real-route endpoint case — not the single row the plan named. Same discipline as C10X-29's
  `missingLocal` neuter and C10X-30's case 8: the conclusion is unchanged, the prediction was
  rounder than reality.
- **This change is also the one that closed the denominator rot this ledger keeps warning
  about.** `tests/auth/errors.test.ts` was cited as "33 cases" in §6.6's C10X-28 entry while
  holding 55, and the matching "1 of 33 red" lives in two **archived** artifacts. The §6.6 figure
  is corrected in place; the archived pair gained **dated correction lines and were not
  rewritten**, per this project's own precedent (C10X-30's "4xx" wording). Five comments in
  `tests/auth/errors.test.ts` that contradicted the code are corrected at the site a reader meets
  them — two of them found by _measurement_ rather than by reading (breakage check B showed the
  distinctness case is blind to a repointed map key; the mapper's truthiness branch showed the
  non-emptiness scan cannot kill a `→ ""` mutant). The `role="alert"` call-site counts in
  `ServerError.tsx` were **re-derived by enumeration** and were wrong in the version that shipped
  in this change's own Phase 5 — recorded rather than quietly fixed.
- **What is NOT closed by this entry, and is named rather than left to be inferred**: the island
  and `.astro` halves of every claim above (§7 — **with one exception added by this change's
  impl-review**: a page that stops calling `ownedAuthMessage` now fails
  `tests/lib/error-param-guard.test.ts` — the file this review added as
  `auth-error-param-guard.test.ts`, renamed by C10X-37 on 2026-07-31 when the deck surface got
  the same guard — so that one sentence in the parenthesis no longer
  holds; the `replaceState` strip and `Layout.astro`'s call are unchanged),
  `AUTH_UNAVAILABLE_MESSAGE`, the five inference-only GoTrue codes,
  the two deck endpoints (**closed 2026-07-31 by C10X-37**; they were open when this entry was
  written), auth input validation (**C10X-36**) and the English auth
  UI (**C10X-19**). §6.6's C10X-34 entry carries each with its reason.
- **The impl-review left one live vector with an owner rather than a fix** (F1): the three deck
  pages still read `?error=` unconstrained into the same `ServerError` banner — the class this
  change closed on auth, one surface over, behind the session guard. Queued in the change's
  `follow-ups/review-fixes.md` and named in §6.6's does-NOT-prove list; **to be ticketed via
  `/jira-backlog-sync`**. Its first step is the enumeration this review did not do: confirm the
  six deck endpoints' `?error=` values are a closed set of literals.

  > **Closed 2026-07-31 by C10X-37** (`deck-form-hardening`) — it shipped under C10X-37's key by an
  > explicit scope decision recorded in that change's `change.md`. This line used to add "and it
  > never got a key of its own"; **that was false and is corrected 2026-08-01 (C10X-40)**, which is
  > the key it got, minted by `/jira-backlog-sync` on the same day the follow-up note said it had
  > none. The enumeration named as "the first step" was done and came back **eleven
  > literals, a closed set** — no `.message`, `String(err)` or `JSON.stringify` on any deck-route
  > **REDIRECT** branch — which is why the fix is `ownedAuthMessage`'s shape rather than a redesign.
  > See §6.6's C10X-37 entry. (The looser "any deck-route branch" was measured false by C10X-37's
  > own read-back — `cards/batch.ts:45` does serialise a JSON response body, on a channel this set
  > deliberately excludes. C10X-40 was scoped to rescope exactly this sentence and rescoped the
  > header instead; corrected here 2026-08-01 by its impl-review, F6.)

- **Risk #7's known live defect closed and re-measured: 2026-07-31** (C10X-41, change folder
  `forced-language-prompt-fix`). Ordinary suite **262/262, 23 files**, seed `1785502719409`
  (257/257, 22 at the C10X-34 baseline; **+4** in the new `tests/db/languages.test.ts` and
  **+1** in `tests/generation/generate.test.ts` — the keyed-replay-after-deactivation case.
  The membership widening added no case: it went into the existing whitelist case, which
  now drives three inputs and is retitled "400s a language neither layer of its guard
  admits". A count that read "+1 membership case" would have been wrong about which claim is
  new — checked by diffing the `it()` titles against `e4164a9`, not by arithmetic).
  Local stack up, `OPENROUTER_API_KEY` unset,
  `npm run lint` exit 0 (the same 6 pre-existing `no-console` warnings in
  `evals/generation-quality.eval.ts`), `npm run build` exit 0. The eval: **two** acceptance runs,
  seeds `1785502740173` and `1785502867030`, both **exit 0** at `11 passed (11)`, every case 5/5
  on language — 110/110 cards across the pair — count compliance 55/55 and skip-rate 0% in both.
  `forced/de` and `forced/fr` were **0/5, four of four runs** at the C10X-31 baseline. The
  fixture-string edits in `tests/lib/eval-scoring.test.ts` changed no assertion's meaning, which
  is why the suite count moved only by the two genuinely new claims.
- **The confound-breaker is what makes the green worth more than the last one.**
  `forced/fr-on-en` (French forced over the ENGLISH reference text) has no C10X-31 baseline —
  it exists because every other forced case runs on the PL source, and a target that agrees with
  the source language cannot separate "the prompt named the language" from "the model followed
  the text". 5/5 in both runs.
- **A gate gap was measured here and deliberately left open.** `npx tsc --noEmit` is in no
  script and no CI job, so the eval — the acceptance instrument for Risk #7 — carried a real
  type error (`TS2353`) across two phases whose `lint`, `build` and `npm test` were all green.
  Reverting to `b015662` reproduces it in one line; the restore was verified by per-file **MD5**
  (5/5 `OK`), never visually. Fixing it is a gate change with its own blast radius and is not
  this change's; §6.6's C10X-41 entry names it.
  > **Closed 2026-08-03 by C10X-43** (`typecheck-gate`), which is the ticket this entry's last
  > sentence deferred to. `npx tsc --noEmit` is now in a script — `npm run typecheck`, which wraps
  > it together with `astro check` — and in the `ci` job, fail-closed. The bullet is the record of
  > the measurement that produced the ticket and is not rewritten. Its estimate of the blast radius
  > was right: the gate needed a wrapper rather than a bare command, because `astro check` exits 0
  > when its own tooling is missing and cannot see a malformed `tsconfig.json` at all.
- **Two things about this coverage date do not refresh themselves.** The eval is human-triggered
  (§5), so the date means "exercised", not "watched". And **nothing here observes the CLOUD
  `language` rows** — seed-row drift is one of the two classes no oracle in this project covers,
  so reading them once after `npx supabase db push` is a ship-time step this change carries
  rather than a check it wired.
  > **Re-checked 2026-08-02 (C10X-42) and deliberately NOT edited — recorded because the absence
  > of an edit here is itself a finding.** C10X-42 gave the eval a CI dispatch leg, so a reader
  > working through that change's doc-sync list arrives at this bullet expecting a correction.
  > There is none to make: every word above is still true. "Human-triggered" was never the claim
  > that moved (`workflow_dispatch` is human-triggered), and "the date means exercised, not
  > watched" is if anything sharpened by a workflow that runs only when somebody dispatches it.
  > The `language`-rows half is untouched — the eval still reads no database, in CI as locally.
- **The admin-panel follow-up is written and unticketed, on purpose.** The `language` table was
  built so a configuration surface is possible (`is_active`, `sort_order`, two rendered names,
  and a per-request read with no cache — so a Studio edit reaches the selector with no deploy,
  measured in the change's §4.5), the PRD makes that surface a nice-to-have behind a Non-Goal,
  and the constraint that must travel with it — whatever writes `prompt_name` has to open one of
  the table's two read-only enforcers and inherits the prompt-injection guard the Zod enum used
  to hold — is recorded in
  `context/archive/2026-07-31-forced-language-prompt-fix/follow-ups/admin-panel.md`. **To be ticketed via
  `/jira-backlog-sync`.**

- **Risk #6's deck half and Risk #4's read half on the deck surface last proven by execution:
  2026-07-31** (C10X-37, change folder `deck-form-hardening`; the documents were synced the
  following day, the measurements are all from the 31st). Suite **298/298, 26 files**, seed
  `1785534827060` at the baseline and `1785535019998` after the last restore — 266/266, 24 at the
  Phase 3 baseline; **+12** in the new `tests/validation/decks.test.ts` (16 cases, of which 4 were
  Phase 2's own malformed-body evidence), **+6** in `tests/lib/redirect-errors.test.ts`, **+9** in
  `tests/validation/signed-out.test.ts`, and **+5** in the page guard, which went 3 → 8. Files
  move by **2**, not 3, because the page guard replaced an existing file rather than adding one —
  and the wording matters, because "it is a `git mv`" (which both this entry and the change's
  Phase 5 note first said) does not survive a check: the move came with a rewrite, so at the
  default similarity threshold **git records `D` + `A`, not `R`**, and `git log --follow` shows
  nothing before the commit. Rename detection needs `-M30%` or lower, where it reports
  **`R031`** — 31% of the file survived. The +2 is verifiable on its own; the provenance is not,
  from git alone. Local stack up, `OPENROUTER_API_KEY` unset, `npx tsc --noEmit`
  exit 0, `npm run lint` exit 0 (the same 6 pre-existing `no-console` warnings in
  `evals/generation-quality.eval.ts`, unchanged), `npm run build` exit 0, and
  `git diff -- src/ supabase/` **empty** after every one of the five breakage restores, each
  additionally verified by per-file **MD5** against a pristine copy taken before the first edit.
- **The pair separated the layers in both directions, and the passing assertions are half the
  evidence.** Run 1: **3 of 16 red on the message**, oracles passing. Run 2: **4 of 16 red on the
  oracles**, message never reached. Recorded with their observed strings in §6.6's C10X-37 entry
  rather than summarised, because a split is a claim about a run.
- **One prediction was rounder than the run, as usual here.** The `ownedRedirectMessage` identity
  neuter was predicted to turn "the rejection cases" red and turns **2 of 6** — the second being
  the `""` half of the empty-parameter case, since `null` still maps to `null` under the identity.
  Same discipline as C10X-29's `missingLocal` neuter, C10X-30's case 8 and C10X-34's check E.
- **Restoring the CHECK needed the forbidden rows deleted first, and this time it worked.** The
  suite persisted **four** rows `deck_name_check` forbids while it was absent — three create-side
  names and the shared rename fixture, renamed to 101 characters — all carrying the run's own
  suffix, all inspected before deletion. That is the procedure C10X-27's
  `deck_session_size_check` restore discovered the hard way (`violated by some row`, _after_ the
  evidence was collected). The `pg_get_constraintdef` before/after `diff` came back empty **and**
  the bound was probed behaviourally in a rolled-back transaction, because a text match reads
  identical for a constraint that came back `NOT VALID`.
- **Three live comments that told a contributor this class was open are now dated statements that
  it is closed**: `src/lib/forms.ts` (four callers → six), `src/lib/generation-limits.ts` (the
  "deliberately NOT here: the deck-name bound, which lives in six places" leftover now points at
  `deck-limits.ts`), and `tests/lib/forms.test.ts`'s header. The `forms.ts` paragraph has now said
  three different things and the history is kept in place, because each correction was in the
  direction that reads as reassurance.
- **The rename's three pointers were repointed, which is the failure this ledger has recorded
  twice** (C10X-28's evidence paths, C10X-34's denominators): §6.6's C10X-34 bullet and two §8
  entries pointed at `tests/lib/auth-error-param-guard.test.ts`. The archived
  `2026-07-30-auth-error-copy/reviews/impl-review.md:128` reference is **left as written** — an
  archived artifact takes a dated correction, never a rewrite, and this file now carries that
  correction.
- **What is NOT closed by this entry, and is named rather than left to be inferred**: the two deck
  islands' own 1..100 guard (§7's fourth instance — and they carry **no** `maxLength`, measured,
  so that branch is the one a user meets), `SUPABASE_UNCONFIGURED_MESSAGE`'s branch, announcement
  of the page-level banner (exposure in the accessibility tree is the claim; announcement is
  not), the URL cleanup (browser-checked only), `?error=` producers outside the deck/card
  surface, and — the one a reader would otherwise infer wrongly from the headline — **the nameless
  CREATE refusals, which have no row oracle and therefore attribute nothing to either enforcement
  layer**. §6.6's C10X-37 entry carries each with its reason.
- **No migration, and that is a fact rather than an omission.** `deck_name_check` ships in
  `20260705180246_init_core_schema.sql` and long predates this change, so nothing is pushed to
  the cloud and the C10X-29 drift gate is not involved. The only cloud-facing residue is the
  usual one: every assertion here ran against the local stack.
- **The impl-review took the suite to 314/314, 28 files, and its theme was that this change's own
  guarantees were carried by COMMENTS** (2026-08-01, `reviews/impl-review.md`). Nine findings, none
  a functional defect — the shipped behaviour was re-verified green in every dimension, including
  the closed set being closed by construction (12 direct redirects plus 19 `errorUrl()` call sites,
  enumerated) and all four sinks on `[publicId]/index.astro` deriving from the one wrapped read.
  Eight fixed, one accepted, none skipped. Suite 298 → **314** (`+3` in the new
  `tests/lib/no-client-redirect-errors.test.ts`, `+7` in the new
  `tests/lib/form-endpoint-guards.test.ts`, `+2` in the page guard, `+1` in
  `redirect-errors.test.ts`, `+3` in `signed-out.test.ts`); files 26 → **28**; green on three fresh
  un-pinned seeds (1357 / 2468 / 8642); `tsc` / `lint` / `build` all exit 0.
  > **The `signed-out.test.ts` figure read `+1` until 2026-08-01 (C10X-40), and the entry's own
  > arithmetic is what gave it away**: 3+7+2+1+1 = 14, against a declared delta of 16. Measured by
  > running the file — **12** cases, because the review's addition was an `it()` plus an `it.each`
  > over the two delete rows, not one case. The lesson is this file's own: a total and its
  > breakdown are two claims, and only one of them was checked.
- **A stated rationale was measured and found FALSE, which is why three of the fixes are guards
  rather than edits.** Four sites justified `redirect-errors.ts`'s server-only rule with "it imports
  `flashcards.ts`, which drags a query layer into the bundle". Neither half survives: `flashcards.ts`
  has only `import type` (the client arrives as a parameter), and it is **already in the client
  bundle** — `CreateFlashcardModal.tsx`, `FlashcardItem.tsx` and `CandidateItem.tsx` import
  `FRONT_MAX`/`BACK_MAX` from it as VALUES. The rule is right and its reason was not, in the
  direction that reads as reassurance; and nothing enforced it. Corrected at three sites (the fourth,
  `DeckActions.tsx`, never carried the false reason — checked rather than assumed) and now enforced.
- **The class this ledger kept re-recording is now falsifiable, and that is the entry's real
  content.** `forms.ts` said it in its own words — "no test enumerates the readers — the sweep was
  found incomplete twice by reading, not by a red run" — and the history is three reviews for one
  class (C10X-30 swept four of six, its review caught it, C10X-34 re-recorded it, C10X-37 closed
  it). Three guards now cover what prose covered:

  | Guard                                                   | Cases | Falsification, each restored by per-file MD5                                                                                                    |
  | ------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | `tests/lib/form-endpoint-guards.test.ts`                | 7     | three neuters on `decks/index.ts` — `formString` → cast, `try` removed, an inline `?error=` literal — **1 of 7** red each, naming file and line |
  | `tests/lib/no-client-redirect-errors.test.ts`           | 3     | importing `REDIRECT_MESSAGES` into `DeckActions.tsx` → **1 of 3** red                                                                           |
  | `tests/lib/error-param-guard.test.ts` (extended 8 → 10) | 10    | a raw read added to `generate.astro` → **1 of 10** red                                                                                          |

  The page guard's extension is the one worth reading twice: it was scoped to a hardcoded
  two-directory allowlist, so a future `.astro` page anywhere else reading `?error=` raw was not
  merely unasserted — it was **never looked at**. `generate.astro`, the page used to falsify it, is
  exactly such a page. An incomplete sweep left unstated is the shape that created C10X-37.

- **One prediction in the review was wrong and was corrected by measurement, not by reading.** The
  two delete endpoints' new signed-out controls were expected to answer **404** (RLS matches nothing
  → empty `RETURNING`). They answer **302 with the endpoint's own delete-failure copy**, because
  `init_core_schema` revokes table privileges from `anon`, so the delete errors rather than returning
  zero rows. The assertion became equality on the decoded param, matching the three controls beside
  it. Consequence recorded rather than smoothed over: those two controls issue one query each, so
  `signed-out.test.ts`'s "NO DATABASE" header is now scoped to the six rows and their three inline
  controls, with the exception named. Five of six endpoints are controlled;
  `cards/[cardPublicId].ts` stays uncontrolled because its reachable-without-a-query branch runs
  BEFORE the user check — the one class in this change still resting on reading, stated at the site.
- **Three comment counts were wrong and one of them mattered.** `redirect-errors.ts` said "two"
  constants are reused by the JSON endpoints (three are); `[publicId].ts` and its copy in
  `decks.test.ts` said `errorUrl` is built ":26, eleven lines above" (`:28`, seventeen);
  `signed-out.test.ts` said `!supabase` precedes `!user` on "four of the six" (six of six). The one
  with a consequence is **`ServerError.tsx`**, whose "NINE other components … TEN call sites, every
  one of them DYNAMICALLY" both undercounted (13 sites across 12 files) and **misclassified the site
  this change added**: `[publicId]/index.astro:170` arrives at mount by full-page redirect, i.e. the
  weak case Phase 3 §2 forbids overclaiming, while that sentence is the load-bearing argument for
  `role="alert"` on the shared component. Corrected as a dated third correction — this file's counts
  have now gone stale twice, and its own parenthetical calls that "the class C10X-34's Phase 6 exists
  to end".
- **`REDIRECT_MESSAGES` gained a size pin (exactly 11, all distinct), and the reason is the one
  unplanned scope decision here.** Three JSON endpoints (`api/generate.ts`, `api/study.ts`,
  `cards/batch.ts`) import constants from this module — outside Phase 1 §3's "six endpoints under
  `src/pages/api/decks/`", and `study.ts` is named in "What We're NOT Doing". Deliberate, annotated
  at each site, and the JSON convention is genuinely unchanged, so it is not drift. What it costs is
  definitional: the module is now the home of strings that do not all travel the `?error=` channel.
  Sharing a CONSTANT is fine; extending the ARRAY is not, because every member is a value the deck
  pages will render from a URL. Written into the docblock and pinned by the count.
- **`deckNameExists` now branches on its query error** on both endpoints (this project's recorded
  "SSR error-vs-empty" lesson, which the adjacent rewritten lines did not follow). Never a wrong
  SUCCESS — a dropped error fell through to `createDeck`/`renameDeck` and surfaced the same owned
  copy from there — so the gain is naming the failure where it happens, with no new set member.
- **Still open after the review, deliberately**: `jira-map.md`'s `Change ID` is filled on the map
  side only (`customfield_10041` unset; `/10x-implement` writes no Jira), so `/jira-finish-work`
  owns setting it and closing **C10X-40** against this change. Everything in the previous entry's
  "What is NOT closed" list stands unchanged — the review added no coverage of the island half, the
  cloud rows, or banner announcement.

- **The HARNESS's own silent-write class last proven closed by execution: 2026-08-01** (C10X-39,
  change folder `local-stack-transport-flake`). A different axis again — like C10X-32's
  order-independence entry, it says the existing claims are _trustworthy_, not that anything new
  is covered. Suite **333/333, 29 files** (314/314, 28 at the C10X-37 baseline; the **+19 / +1**
  is `tests/lib/kong-keepalive.test.ts` alone, and the seam work adds **zero** cases by design —
  six oracles inside existing helpers, no new `it()`). Recorded as **332 / +18** until 2026-08-01,
  when C10X-40 ran the file and counted **19**: the entry was written from the phase-completion
  figure and the change's own impl-review had since widened that file. Nothing else moves — the
  seam work still adds zero. The count is identical at the Phase 3
  baseline, after Phase 4 and after Phase 5's 40-run matrix. Local stack up,
  `OPENROUTER_API_KEY` unset, `npx tsc --noEmit` exit 0, `npm run lint` exit 0 (the same 6
  pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged),
  `npm run build` exit 0.
- **The evidence is two censuses, not a reading, and the pair is the deliverable.** Phase 3
  forced every local non-`GET` request to replay once: **6 silent seams**, 27 red blocks, 316
  replays, 89 + 18 duplicated groups — every **green** one traced to the helper that wrote it and
  the `it()` that owns it, by line number, because attribution by case colour would have filed
  `generate.test.ts:352` as loud on a red belonging to a different seam. Phase 4's re-run of the
  identical neuter: **0 silent seams**, 54 red blocks, 669 replays behind it — and all 27 of
  Phase 3's reds matched into the 54 by set comparison, so nothing that was loud went quiet. Six
  test-first breakage runs in between, each turning **exactly one** case red in a **per-file** run
  (1 of 23 / 1 of 22 / 1 of 13, not full-suite denominators) — `expected 2 to be 1` five times, a
  length assertion the sixth — with the green beside it as the evidence. Every duplicated row this produced was deleted, scoped to each phase's window, and
  the residue verified at **0** on both tables including orphaned `flashcard_schedule`.
- **A mechanism this file asserted twice was measured and found FALSE**, which is the entry's
  reusable half. §6.2 and §8 both claimed Kong keeps its pooled connections idle for LONGER than
  the upstream does. Both sides idle out at **60 s** — equal, i.e. the pathological case, not a
  fixable ordering — and the drops cluster in a burst's first 1-2 s rather than on the first
  request after the gap. Corrected in place at both sites, plus the third live site nobody had
  listed: `tests/setup/retry-transport.ts`'s own header, which the obvious grep for the phrase
  misses because it breaks across two comment lines — which is why the criterion for this phase
  is a **pair** of patterns, not one. Same class as this ledger's recurring pointer rot: a claim
  that reads as reassurance, carried by inference, in the file a contributor consults before
  widening a guard.
  > **And the corrections deliberately PARAPHRASE the old sentence rather than quoting it**,
  > against this file's usual habit of keeping superseded wording verbatim. The reason is the
  > criterion itself. The phase's two greps (spelled out in the change's `plan.md`, criterion
  > 6.1, and deliberately not repeated here for the same reason) are a standing regression check
  > that the wrong mechanism has not crept back over `tests/ src/ context/foundation/`. A
  > correction block quoting the old phrase — or, as this bullet first did, an entry quoting the
  > grep COMMAND — keeps the check permanently non-empty, i.e. an assertion that can never pass,
  > which is this project's own definition of a useless gate. The verbatim record survives where
  > it belongs and where the grep does not reach: the change folder's `change.md` (twice, the
  > charter's own wording included), `research.md` (twice) and `plan.md` (four times).
- **Phase 5's verdict, stated as measured rather than as hoped.** **The recreation removes the
  flake on this machine**: 0 drops across 40 spaced runs with pooling disabled, against 20 drops
  across 23 spaced runs over two independent stock-pool controls the same day, same machine, same
  oracle, same 35 s spacing. Not recorded as inconclusive — the plan reserved that branch for a
  control that failed to reproduce, and both controls reproduced on their first attempt. Three
  things are recorded rather than smoothed over: the matrix ran in four chunks after the agent
  harness reaped a background job (the three extra gaps are _longer_ than 35 s, i.e. they move
  toward the cold-pool condition the flake needs); Docker Desktop died mid-control, voiding runs
  10-12, so the ≥10 floor is met by clean runs alone; and the two controls' rates differ by
  nearly **sevenfold** (1.38/run vs 0.20/run), which is why no single number here should be
  quoted as _the_ rate. Performance was measured because the plan asked: 5-6 s per run both with
  pooling on and off, no regression from the extra TCP handshake.
- **What does NOT follow from that verdict, and is named here because the headline invites it**:
  the fix is **unsupported and per-machine**, wiped by every `npx supabase stop`, so the `fetch`
  wrapper stays and was deliberately not narrowed or deleted; CI's step is **parity, not
  necessity** and carries `continue-on-error: true`, so a green `ci` job no longer implies the
  step passed — read the step's own conclusion; and the census proves silence only for the seams
  that existed on the day it ran, with no automatic guard over the class. §6.6's C10X-39 entry
  carries each with its reason.
- **Criteria 2.3 and 2.5 were open by decision and are CLOSED at ship time, 2026-08-01** — CI run
  `30710530839` on PR #22, head `69b82db`. They were unmet at phase completion by decision, not by
  omission: `ci.yml` triggers only on push to `main` and on `pull_request` to `main`, so a
  feature-branch push runs nothing at all, and the PR is the first thing that runs the step in CI.
  **The correction worth carrying is what the oracle is not.** Both this file and the change's own
  `verification.md` said to read "the step's own conclusion, not the job's colour" — and the step's
  conclusion is **not falsifiable**: with `continue-on-error: true` GitHub reports a failed step's
  `conclusion` as `success` (the pre-tolerance result lives in `outcome`, which the run API does not
  return alongside it), so it is precisely the reassuring value the criterion was written to guard
  against. What closes both criteria is the **log** — `pool_size = 60` before, `0` after, on the
  container `supabase_kong_10x-astro-starter` that the preceding step started, with `npm test`
  (which carries no `continue-on-error`) passing afterwards against it. Everything the previous
  wording said about the step being **parity rather than necessity** stands unchanged: the step is
  still advisory, and a green `ci` job still does not imply it passed. Two `createCard` twins remain
  loud only by accident (§6.6). `jira-map.md`'s `Change ID` note for **C10X-39** is also stale in
  the reassuring direction — `customfield_10041` was already set on the Jira side when
  `/jira-finish-work` RUN 1 read it, and the ticket summary already carried the retitled wording.

- **The guards holding the `?error=` claim last proven falsifiable by execution: 2026-08-01**
  (C10X-40, change folder `deck-error-param-guard`). A third axis, after C10X-32's
  order-independence and C10X-39's silent-write census: it asks whether the guards can still go
  red, not whether the claims are covered. Suite **342/342, 30 files** (333/333, 29 at the C10X-39
  baseline). The breakdown, counted by running each file rather than by adding up intentions:
  **+3** in `tests/lib/form-endpoint-guards.test.ts` (7 → 10), **+1** in
  `tests/lib/error-param-guard.test.ts` (10 → 11), **+5** in the new
  `tests/lib/deck-limits.test.ts`; `tests/validation/decks.test.ts` stays at **16** — the two count
  oracles went into existing cases, so an unchanged number there is correct rather than suspicious.
  Local stack up, `OPENROUTER_API_KEY` unset, `npx tsc --noEmit` exit 0, `npm run lint` exit 0 (the
  same 6 pre-existing `no-console` warnings in `evals/`), `npm run build` exit 0, and
  `git diff -- src/` **empty** after every breakage restore, each verified by `md5sum`.
  > **The `342/342` is the pre-impl-review figure and `main` has read `345/345` since `6bc6a1f`;
  > corrected 2026-08-02 (C10X-42) by running the suite, not by arithmetic.** This entry was
  > written at `63696e5`, and this change's own impl-review commit — which the entry describes
  > two bullets down — then reworked four test files for a net **+3**. That is the same defect
  > this entry catches against C10X-39 one screen up ("the entry was written from the
  > phase-completion figure and the change's own impl-review had since widened that file"),
  > committed by the entry that names it, which is why the number is corrected here rather than
  > silently. **The 6 `no-console` warnings are also stale from 2026-08-02 (they are 3)** — but
  > that one is a change of state rather than a mis-measurement, and this figure was true on its
  > own date.
- **Six breakage runs, each turning exactly ONE case red, and in two of them the evidence is what
  stayed green.** `errorUrl("Talia jest zablokowana")` and `errorUrl(String(err))` each turn the
  new producer claim red **while the pre-existing `INLINE_ERROR_LITERAL` case stays green** — which
  is the measurement proving the gap was real rather than theoretical. A hoisted
  `params.get("error")` on a deck page and a raw read planted in `src/layouts/Layout.astro` each go
  red naming file and line; a full rename of a `formData()` receiver plus an un-narrowed part goes
  red on the derived-receiver check; and making the create endpoint read a `File` part's text turns
  the new count oracle red on `expected 1 to be +0`.
- **One breakage attempt failed and the failure was mine, not the guard's** — recorded because this
  file's own discipline is that a green breakage run is a finding until explained. The first
  receiver-rename run stayed green because the `sed` targeted `const form = await …` while the file
  actually reads `form = await …` under a `let` declaration, so the rename never happened. Re-run
  correctly, it goes red. A breakage run that does not go red is a claim about the EDIT before it is
  a claim about the guard.
- **`?q=` was audited and deliberately left outside the vouching mechanism**, which is a decision
  rather than an omission and is written into `src/lib/deck-limits.ts` where the next reader meets
  it. It is the only query parameter in the app whose raw value is rendered as text
  (`FlashcardWorkspace.tsx`, plus the search input's `defaultValue`), so it was a genuine candidate
  for `ownedRedirectMessage`'s treatment. It is not one for a structural reason: the reflection
  exists only on `/decks/<publicId>`, which answers a hard 404 for a deck the caller does not own,
  so exploitation needs the victim's own deck UUID — where the `?error=` vector needed only
  `/decks`. What survived is hygiene: the value was unbounded in both the reflection and the search
  RPC argument, and now clamps at `QUERY_MAX`. **Do not read the clamp as a security control.**
- **Two roadmap rows were backfilled** (`roadmap.md` H-07 `deck-form-hardening`, H-08
  `local-stack-transport-flake`), following the H-04 precedent and annotated as backfilled: both
  changes archived with no roadmap row, so `/10x-archive` had nothing to close and the work
  vanished from `## Done` without trace. H-09 exists for this change so the same does not happen
  again.
- **Still open after this entry, deliberately**: `customfield_10041` on **C10X-37** is set on the
  map side only, and **C10X-40** is closed against this change by `/jira-finish-work`, not here.
  The island half of every claim (§7) is untouched, as are the cloud rows and banner announcement.

- **Risk #7's instrument stopped being local-only: 2026-08-02** (C10X-42, change folder
  `eval-ci-dispatch`). A fourth axis after C10X-32's order-independence, C10X-39's silent-write
  census and C10X-40's guard falsifiability: it asks **who can exercise a claim**, not whether the
  claim is covered or trustworthy. Suite **345/345, 30 files** — **unchanged by this change, and
  an unchanged number here is correct rather than suspicious**: the workflow is not assertable
  from any test layer this project has, and the report sink is I/O inside a hook only the eval
  run path executes. (**345, not the 342 the C10X-40 entry above records** — see the correction
  line there. `git diff --name-only 20b1866 HEAD -- tests/` is empty for this change, so the
  three are somebody else's and are not folded into this headline.)
  `evals/lib/scoring.ts` is deliberately untouched — it is pure and
  `tests/lib/eval-scoring.test.ts` pulls it into `npm test`, so I/O there would be dragged into a
  suite whose preflight forbids the key. Local stack up, `OPENROUTER_API_KEY` unset,
  `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npm test` green with **zero** eval files
  collected.
- **The `no-console` figure this ledger has quoted since C10X-32 is stale from this date: 6 → 3.**
  Measured by running `npm run lint` (exit 0), not inferred: three warnings remain, all in
  `evals/generation-quality.eval.ts`, none anywhere else. All six of the old ones sat inside the
  `afterAll` this change restructures, and composing-then-printing legitimately collapses them —
  which is why the plan's criterion asked for the count to be recorded **as observed** rather than
  asserted unchanged. Every **live** quotation of "6 pre-existing warnings in `evals/`" is stale;
  the dated ledger entries above keep theirs, because a dated figure is a claim about a run.
- **The doc-sync targets were counted by ENUMERATION, and the list beats the number.** Eleven
  existing locations claimed the eval has no CI leg, plus two new entries here and in §6.6, plus
  README (two edits — the workflow inventory and the secrets table), roadmap **H-10** and
  `jira-map.md`'s C10X-42 row. That discipline is this file's own: a total and its breakdown are
  two claims, and §8 already records C10X-40 catching exactly that arithmetic against C10X-39.
  One of the eleven produced no edit and says so at the site — §8's C10X-41 bullet is re-checked
  and **deliberately untouched**, with the absence of an edit written down, because a reader
  working the list would otherwise hunt for a correction that should not exist. (This sentence
  read "Two" and the rolling header said "one of those eight" until this change's impl-review
  recounted from the lists, 2026-08-02 — two numbers disagreeing with each other about one fact,
  which is this file's own "a total and its breakdown are two claims" defect committed by the
  entry that cites it.)
- **The wording trap was the whole difficulty, and it is the reason nothing was mass-replaced.**
  Every one of five targets says "human-triggered", and every one stays **true** —
  `workflow_dispatch` IS human-triggered. Only "local only" / "no CI leg" went false. So a live
  claim was edited and a historical entry took a **dated correction line and was not rewritten**
  (the C10X-30 "4xx" precedent). Checked **per site** against a `grep -n` list taken before the
  edit: all 13 pre-existing `human-triggered` occurrences survive, and the total is deliberately
  NOT the oracle — it goes UP for a correct edit, since the new §6.6 and §8 entries must
  themselves say the eval is still human-triggered.
- **Satisfying criterion 3.2 turned up a landmine in this file, and disarming it is the one edit
  here that a reader would never predict from the ticket.** Measured **before** any content edit:
  `test-plan.md` and `roadmap.md` were **already** prettier-dirty at `HEAD` (`*italic*` →
  `_italic_` across ~190 lines of this file; the At-a-glance table's column padding in roadmap).
  The plan's first instinct — write clean text and leave the pre-existing drift alone — was taken
  and then abandoned, because running prettier to check that decision revealed something worse:
  **`npx prettier --write` was DESTRUCTIVE on this file, and reproducibly so on the pristine
  `HEAD` copy, not only on the edited one.** A code span split across two lines inside a
  blockquote (`` `npm run `` / `` db:start` `` in §6.2's C10X-39 correction) lost its `> `
  continuation marker on the first pass; a second pass then collapsed that entire correction
  block into one unreadable line. So `npm run format` — a documented script in this repo's own
  README — silently damaged a paragraph, and prettier was **not idempotent** here. The fix is one
  line (join the code span), and after it the file is prettier-clean **and** a fixed point,
  verified by writing twice and diffing. The whole file is therefore normalised, which is what
  makes the landmine gone rather than merely stepped over.
- **The normalisation was proved content-neutral rather than asserted to be.** Comparing `HEAD`
  against the result with emphasis markers and whitespace canonicalised, **33** source lines
  differ and every one is accounted for: 1 header line demoted to "Previously", 3 table rows and
  8 paragraph lines this change deliberately edits, the 2 lines of the landmine fix, and **19
  lines that gained a `> ` prefix without any change in rendering** — that paragraph in §8's
  C10X-32 entry sits with no blank line after a blockquote, so markdown's lazy continuation
  already rendered it _inside_ the quote; prettier only made the source say so. It is left as
  prettier wrote it: making it leave the blockquote would change how someone else's paragraph
  renders, which is a bigger edit than this phase is entitled to. `roadmap.md` was formatted in
  full for the same reason at smaller scale — its only drift is the very table gaining the H-10
  row. README and `jira-map.md` were clean before and after.
- **The pre-commit hook is NOT running in this working tree, which is why the drift existed at
  all.** `package.json`'s `lint-staged` maps `*.{json,css,md}` to `prettier --write`, so a normal
  commit here should have normalised this file long ago. It did not: `core.hooksPath` is unset,
  `.husky/_/` is absent, and `.git/hooks/` holds only `pre-commit.sample` — husky's installed
  half is gitignored and does not survive a fresh clone or `git worktree add` (`lessons.md`
  records that class). Consequence a contributor must not misread: **AGENTS.md's "a husky
  `pre-commit` hook runs `lint-staged`, so commits auto-fix" is false in this tree**, and every
  `.md` and `.ts` fix-up it promises is happening only when someone runs the command by hand.
  Recorded, not fixed — it is a tooling-setup issue with its own blast radius, not this ticket's.
- **The blast-radius cap is MEASURED, not assumed — and that is the one claim about this change
  that could most easily have been left as prose.** The repository secret `OPENROUTER_EVAL_KEY`
  was set 2026-08-02 from the developer's pre-existing eval key, which is separate from
  production's (production's lives as a Cloudflare Worker secret set by `wrangler secret put`,
  never as a repository secret — see README). Its per-key credit limit was read from
  `GET /api/v1/key` rather than trusted: **`limit` $5, `limit_remaining` $4.909**, i.e. a real cap
  with roughly 370 runs of headroom at the ~$0.013 recorded for the 11-case matrix — high enough
  that a legitimate dispatch plus C10X-31's calibration re-run cannot be strangled by it, low
  enough to bound a runaway. What follows when it is hit is the loud behaviour, by construction:
  OpenRouter refuses with `402`, and `judge.ts:128` classes `402` as neither `429` nor `≥500`, so
  it throws immediately with no retry. **The plan asked for a NEWLY MINTED key and did not get
  one, which is a divergence rather than a detail** — and it was found by doing the manual check
  rather than by remembering: the wording shipped in three places (README's secrets row, the
  workflow's guard message and the comment above it) read "never the developer's own", and that
  half is **false** for what is actually stored. It is the developer's own eval key, the one a
  local `npm run eval` uses, and all three sites are corrected to say what is true — dedicated to
  the eval, capped, and never production's. The tradeoff is deliberate and cheap to state: one
  key with one purpose and one cap, versus a second key that would add a rotation surface without
  adding a limit, because OpenRouter governs rate limits per ACCOUNT and only spend per key. Two
  boundaries stay: a separate key buys **spend isolation only, not rate-limit isolation**, and
  `gh secret list` returns **names only** — so "the stored value is the working credential" is
  a claim only Phase 4's dispatch can settle. **It settled it NEGATIVE on the first attempt**, and
  that is the most useful thing this change measured: see the bullet below.
- **Ship-time evidence, measured 2026-08-02 after merge `92bc9de`.** Registration as a **pair**
  (`gh workflow list`: `CI` + `Schema diff` before, `Generation quality eval` id 325665475 after —
  C10X-29's check, whose "before" half was recorded in Phase 2). Green dispatch **`30756678180`**:
  `success`, 2m03s, 11/11 cases at 5/5 language fidelity, usability 54/55, count compliance 55/55,
  skip-rate 0% — the single `usable=false` card reproduces C10X-41's shape and is why the green is
  worth something rather than being compatible with a scorer gone permissive. Controlled red
  **`30756592782`** (`generator_model=bogus/does-not-exist`): `failure` in 32s on
  `OpenRouter HTTP 400`, artifact uploaded anyway, exit status survived the redirect. Cost is
  recorded with its ambiguity rather than rounded: the key reports `usage $0.0910555` /
  `limit_remaining $4.9089445` against $4.909 before, i.e. **within the earlier figure's
  rounding**, so either the four job executions cost under ~$0.001 or per-key accounting lags —
  one reading cannot separate those, and only the green run could have cost anything at all.
- **Two findings this phase produced that no earlier check could have.** First, **the stored
  secret carried a BOM** (U+FEFF at index 7 of `Bearer ${key}`, i.e. the key's first character),
  so the first default dispatch failed in 33s with all 11 cases `MISSING` and **$0 spent** — the
  request never left the runner. The key was fine and the **transfer** corrupted it: the source
  environment variable measures 73 characters (no BOM) and Phase 1's local eval passed on it. The
  likely mechanism is Windows PowerShell prepending a BOM when piping to a native command, labelled
  likely because only the effect was measured. `gh secret list` was green throughout and is
  structurally incapable of seeing this. Second, **a re-run DELETES the previous attempt's
  artifacts** — measured across three runs, only the re-run one lost its `eval-1`. So Phase 4 §4's
  "both attempts remain downloadable" is **false**, the `github.run_attempt` suffix prevents no
  collision reachable by `gh run rerun` (an inference from the deletion, not a measurement — a
  fixed-name run was not tried), and C10X-31's calibration re-run must be a **new dispatch**, never
  `gh run rerun`, or it destroys the evidence it exists to compare against.
- **What the ship-time evidence does NOT establish**, beyond the boundaries already listed above:
  the eval step's **no-report branch ships unexercised** (all four job executions produced both
  report files — a throw inside a test still lets `afterAll` run, and even the all-11-threw BOM run
  did not reach it), the **step timeout was never approached** (2m03s against 30 minutes, so its
  11 × 120 s sizing is unexercised arithmetic), **`concurrency` was never contended**, and the
  **`judge_model` input was never passed** — only its empty default, which is admittedly the case
  that mattered.
- **Still open after this entry, deliberately**: `evals/` under no type gate (**C10X-43**, and
  this change moves that exposure from a developer's machine into CI, after paid calls); no
  `schedule:` and no notification channel (**C10X-35**'s reasoning, unchanged); and
  `customfield_10041` on **C10X-42**, filled on the map side only — `/jira-finish-work` owns the
  Jira side, and `/10x-implement` writes nothing to Jira.

  > **The first of those three is closed 2026-08-03 by C10X-43**; the other two are untouched and
  > this bullet is not rewritten. `evals/` is now under a type gate, in CI and on `pre-push`. The
  > parenthetical stays worth reading, because it names the half a type gate does not reach: a
  > **collection-time** error in `evals/` still surfaces only at run time, in CI, after paid calls.

- **The project's own compilability last proven by execution: 2026-08-03** (C10X-43, change folder
  `typecheck-gate`). A fifth axis, after C10X-32's order-independence, C10X-39's silent-write
  census, C10X-40's guard falsifiability and C10X-42's who-can-exercise-it: it asks whether any
  gate in this project reads a **type** at all. Until this date none did, and the cost was measured
  rather than argued a fortnight earlier (C10X-41: `TS2353`, exit 2, behind two green phases).
  Suite **364/364, 31 files** (345/345, 30 at the C10X-42 baseline). The breakdown, counted by
  running the file rather than by adding up intentions: the **+19 / +1** is
  `tests/lib/typecheck.test.ts` **alone** — 13 at Phase 1 for the FM-1 verdict, then 6 more at
  Phase 4 for `readTscFailure`, measured at **19** today. Every other phase adds zero, and Phase 5
  in particular adds zero despite editing 13 files: its own row records the count moving 358 → 364
  and attributes the +6 to Phase 4, proved by `git diff -U0 -- tests/` carrying no added or removed
  `it()` line rather than reconciled by arithmetic — the defect this ledger catches against C10X-39
  and C10X-40. Local stack up, `OPENROUTER_API_KEY` unset, `npm run typecheck` exit 0,
  `npm run lint` exit 0, `npm run build` exit 0.
- **The `no-console` figure this ledger carried is stale again, and in the same direction as last
  time: 3, not 6.** C10X-42 moved it 6 → 3 and said so; every live quotation of "6 pre-existing
  warnings" above that date is a dated claim about a run and keeps its figure. This change measured
  **3**, all in `evals/generation-quality.eval.ts`, unchanged by any of its six phases.
- **Six falsification probes, each deleted and hash-verified**, covering every class the gate
  claims: a `TS2322` under `src/lib/`; a probe in `.astro` **frontmatter**, which is the class
  `tsc` cannot see and the reason the gate is `astro check` rather than `tsc` alone; C10X-41's own
  `ts(2353)`; FM-1 (`@astrojs/check` hidden — the wrapper red where the bare command is green, with
  the same-broken-file positive control); FM-2 (a typo'd compiler option, caught by the `tsc` leg
  that `astro check` cannot see past); and the stale-generated-types **pair**. Plus Phase 5's own:
  C10X-41's F3 shape red with `noUncheckedIndexedAccess` on and **green with it off**, which is
  what makes the flag a measurement rather than a preference.
- **A criterion caught a defect the automated ones could not, which is the argument for keeping
  manual rows.** The hook's first real red announced a `tsconfig` problem for an ordinary
  `TS2322` — a correct exit code with a wrong diagnosis, sending a developer to a file that was
  fine. Fixed in the **pure** half so it is testable, not in the runner.
- **Two counts in the plan were wrong and are corrected as observed, not rounded.** The archive
  carries **13** files making a falsified claim, not the nine the plan measured — the nine was a
  count of prettier-dirty files and was used only to justify `.prettierignore`, which covers
  `context/archive/**` wholesale, so nothing operational rests on it. And the historical-correction
  total moved with it. Same discipline this ledger applies to C10X-39 and C10X-40: **the list is
  the contract, the count is fragile.**
- **Still open after this entry, deliberately**: the two CI rehearsals (a green step on an open PR,
  and a deliberate type error turning the `ci` job red on that step), which are **ship-time** for
  the structural reason C10X-39's criteria 2.3 and 2.5 record — `ci.yml` runs nothing on a branch
  with no PR. `eval.yml` gets no typecheck step, by decision. `jira-map.md:86`'s empty `Change ID`
  and stale `context/changes/…` path are **flagged and deliberately not edited** — that file is
  owned by the Jira skills (`jira-map.md:3-4`). And `customfield_10041` on **C10X-43** is
  `/jira-finish-work`'s to fill.

- **This guide refreshed for the arrival of e2e: 2026-08-05** (`test-plan-refresh-2026-08-05`,
  triggered by `/10x-test-plan --refresh` on two of the four triggers directly above — the stack
  changed, and §7's negative space stopped matching). Its entire diff is markdown — `README.md`,
  `context/foundation/test-plan.md`, `context/foundation/lessons.md` and its own change folder —
  and its "does not claim" list is longer than its claims by design.
  **No risk row moves. No coverage claim widens. No test changed, so every suite total in this
  file — the C10X-43 headline figure and every dated figure beneath it — survives untouched, and
  this entry deliberately quotes none of them rather than restating one it did not measure.**
  Measured while the last phase was still in flight, `git status --porcelain -uall` listed only
  markdown paths and **nothing under `src/`, `tests/`, `evals/` or `scripts/`** — tracked or
  untracked. Read that as a claim carrying its own moment rather than a reproducible one: at the
  true close everything is committed, so the command returns nothing at all and the surviving
  oracle is `git diff --name-only` against the change's base, which lists the three documents
  above and the change folder.
  `--porcelain` rather than `git diff --stat` is load-bearing:
  a diff is blind to an **untracked** file, and plan-review found exactly that — an untracked
  `tests/e2e/route-guard.spec.ts` taking `npm run typecheck` to 136 while `git diff --stat` read
  clean. It was removed before implementation; the final run reports `Result (135 files)`.
- **The one number that moved, and what it revealed.** The type gate reports
  `Result (135 files): 0 errors`, against the `133` documented on 2026-08-03; the delta is exactly
  `playwright.config.ts` and `tests/e2e/seed.spec.ts` (`117` roots + `18` `.astro` = `135`), both
  confirmed as project members by `npx tsc --showConfig` rather than inferred from the arithmetic.
  So the e2e layer entered the gate silently the day it landed, by `tsconfig.json:3`'s
  `include: ["**/*"]`, and nothing announced it because the gate asserts against a **floor**. Two
  sites carried `133` and took **opposite** treatments: `README.md:49` is a live claim and now
  carries **no total at all**, while §6.6's C10X-43 row is a dated record and keeps its figures
  under an appended correction block. **`AGENTS.md` was checked on this axis and deliberately NOT
  edited** — it quotes no total, so there was nothing false in it; the absence of an edit is
  recorded here as its own note, the C10X-42 precedent, so a reader working the doc-sync list does
  not hunt for a correction that should not exist.
- **§7's triggers were mis-keyed, not fired.** The exclusions were keyed on "the moment any §3
  phase wires e2e" and **no §3 phase ever did** — the harness landed outside the rollout — so the
  condition was never literally met and the clauses would otherwise have become dead pointers
  aimed at a moment that had already passed under another name. Each is re-decided on the merits,
  **stands**, and restates its condition in a reachable form rather than deleting it.
  **Two figures here are different claims and must not be collapsed**, which is the trap this
  ledger keeps recording: **four** sites took a dated 2026-08-05 re-decision, but the trigger
  sentence itself sat at only **three** of them. The fourth, the nested `scroll-padding-top`
  deferral, never carried that sentence at all — its blocker was worded "needs its own browser
  verification" — so it re-decides a **blocker** rather than a trigger, and it turned out never to
  have been a capability blocker in the first place. A hit count is therefore the wrong instrument
  twice over: at `HEAD` a literal grep for the clause returned **2**, not 3, because one
  occurrence wrapped across a line break. Every site was checked **per anchor** with the C10X-39
  pair of patterns instead.
- **Four deferrals, named so they are decisions rather than gaps**, all owned by the §3 Phase 6
  change — numbered, because one of them contains a four of its own and the two must not be read
  as the same list. **(1)** `.gitignore`, which this refresh does not touch at all: four artifact
  classes stay unignored (`playwright-report/`, `blob-report/`, a root `.last-run.json`,
  `*-snapshots/`), **latent** because the default reporter produces none of them today.
  **(2)** A §6.11 "adding an e2e test" subsection — §6 got two trap sentences and nothing else,
  because a cookbook for a layer nobody can run yet would document a procedure rather than a
  practice. **(3)** The roadmap id **H-12** and **(4)** the Jira key **C10X-45**, both of which
  this refresh **names and does not create** (`jira-map.md` is owned by `/jira-backlog-sync`,
  `jira-map.md:3-4`).

  > **Corrected 2026-08-06 — deferral (4) was reversed the day after this entry was written, and
  > (3) was not.** The refresh was given a Jira ticket of its own after all, and because keys are
  > sequential it took **C10X-45** — the very key this bullet reserved for the phase. The phase's
  > reservation therefore moves up one, to **C10X-46**, corrected in place at §3's Phase 6 note
  > and in the header block, because both are live forward-guidance rather than dated records.
  > This bullet is not rewritten: it is the accurate statement of what the refresh decided on
  > 2026-08-05. Deferral **(3)** stands untouched — **H-12** is still the phase's and still
  > uncreated — so the bullet directly below survives verbatim, and the consequence a reader
  > should not have to infer is that this refresh now carries the unusual pair of a **Jira key
  > with no roadmap row**. The backfill it names is therefore still owed.

- **The known cost of that last deferral, stated now rather than discovered at archive time**:
  this refresh has **no roadmap row of its own**, so `/10x-archive` will have nothing to close and
  it will need the same backfill H-04, H-07 and H-08 needed. Accepted deliberately at plan time —
  the alternative was collapsing this change into the phase it adds, which is the orphan pattern
  it exists to break.
- **The prettier hazard §6.6's C10X-43 entry records fired twice during this change, in two shapes,
  and neither was caught by reading.** Shape one is the documented one, met one document over: a
  code span split across a line break **inside a blockquote** lost its `> ` continuation marker on
  a `--write`, this time in `plan.md` rather than in this file — so the hazard covers
  `context/changes/**` too, since `.prettierignore` carries only `context/archive/**`. Shape two is
  new: prettier **strips a code span's own padding**, so a sentence whose point rested on the
  spaces inside a span silently lost the detail it was asserting. Two rules follow, and the second
  is not implied by the first: inside a blockquote a span must stay on one line (it may wrap
  freely in ordinary prose), and **a span's padding must never carry meaning** anywhere. Both were
  caught only because every phase ran prettier on a **copy** before letting it near the original.
- **This refresh kept catching its OWN drafts asserting something it had not measured, always in
  the direction that reads as reassurance** — the discipline this ledger applies to C10X-29's
  `missingLocal` neuter, turned on the document doing the applying. Examples rather than an
  inventory, and deliberately not totalled, since a count is the very thing that keeps going
  wrong here. A sentence claiming `npx playwright install` "appears nowhere in the repo" was
  **self-falsifying**, because writing it put the phrase in the repo; it is now scoped to
  **executable** surfaces. "Five islands carry a `fetch`" was arithmetic off a neighbouring
  bullet; measured, it is **four**. A draft of this entry's own header said "five sections"
  asserted something false about e2e; enumerated, it is **§4, §5, §7 and §8**. Another said the
  type-gate count "moved four times in four days", when four was the number of measurements.
  And a draft of the bullet directly above opened "the file now says so at four sites" two
  sentences before saying the clause "sat at three sites" — the total-versus-breakdown collision,
  committed inside the paragraph that names it. Every one was caught by running something, none
  by re-reading.
- **One correction belongs to the plan rather than to this file, and is recorded so the next
  reader does not re-derive it.** The `lessons.md` drift the plan characterised as "trailing
  whitespace" is nothing of the kind: `grep -nE ' +$'` returns **zero** hits file-wide, and the
  two lines are prettier's `*emphasis*` → `_emphasis_` normalisation — content-neutral, but only
  because both sites happen to be word-bounded (`_` cannot open emphasis inside a word, so the
  same normalisation would have changed rendering had they not been).
- **Still open after this entry, deliberately**: everything the four deferrals name; `roadmap.md:234`,
  which asserts this project "nie ma warstwy e2e ani visual-diff" and is now **half** false in
  exactly the way §7's clause was — left for the phase, because `roadmap.md` is not among the three
  documents this change's scope names and `/10x-archive` owns that file's Status column. And the
  §5 intro's unqualified "before that, the gate is `planned`" convention, which the e2e row is
  deliberately kept out of; the paragraph beneath the table blocks the inference by name, and
  editing the intro was outside the phase's contract.

- **§3 Phase 6 / the e2e layer last proven by execution: 2026-08-09** (C10X-46, change folder
  `e2e-harness-journeys`, roadmap H-12). The first §3 rollout phase to close since C10X-30, and the
  first new test LAYER since C10X-31's eval. Vitest suite **399 passed / 399, 33 files**, seed
  `1786290167803` — **unchanged by this phase, and correctly so**: its deliverables are `.spec.ts`
  files, which Vitest's `include` does not collect, and that is precisely the property Phase 2's
  `tests/lib/e2e-isolation.test.ts` exists to assert. `npm run typecheck` exit 0,
  `Result (145 files): 0 errors, 0 warnings`; `npm run lint` exit 0 with **3** warnings, all
  `no-console` in `evals/generation-quality.eval.ts`; `npm run build` **run rather than assumed**,
  exit 0 (the standing `@astrojs/sitemap` `site` warning unchanged).
  `npm run e2e` **12 passed** — 15.3 s on a warm dependency cache, 21.1 s on a cold one, starting
  its own dev server with none started by hand. Local stack up, `OPENROUTER_API_KEY` unset, no
  `.dev.vars`, and the e2e account at `{"decks":0,"sessions":0}` before and after everything below.

  > **The `399/399` is the PRE-IMPL-REVIEW figure and the branch has read `402/402` since `43bad70`;
  > corrected 2026-08-09 by running the suite, not by arithmetic.** This entry was written before
  > `/10x-impl-review`, whose triage then added three cases to `tests/lib/e2e-env.test.ts` — the
  > three that pin which SOURCE a refusal blames (`.dev.vars` / the shell / `.env`), after vite's
  > `loadEnv` was measured to overlay `process.env` on top of the parsed files. Files stay **33**.
  > The review's other test edit is net zero and is stated so the +3 is not mis-attributed: closing
  > the `.dev.vars` `export KEY=value` bypass replaced eight first-party-parser cases with eight
  > that drive real `.dev.vars` text through `buildE2eEnv`. **This is the same defect this ledger
  > records against C10X-40** — an entry written at the pre-review figure while the change's own
  > impl-review commit moved it, there by a net +3 as well. Everything else in the entry stands:
  > typecheck **145 files**, lint **3** warnings, `npm run e2e` **12 passed**, residue `0/0`.
  >
  > The "**399 → 397**" in breakage 4.2 above and in §3's Phase 6 note is **not** corrected: it is a
  > claim about a run executed that day and it was true. Re-run today the same neuter would read
  > 402 → 400; the asymmetry it demonstrates — `it.each` over the real array silently losing rows
  > while staying green — is unaffected by the denominator.

- **Fifteen breakage criteria, and EIGHT of them were re-executed rather than cited.** Phases 2, 3
  and 4 shipped with their Progress rows checked and wrote no evidence section, so their observed
  strings, splits and denominators existed nowhere — and this file's own rule is that a split is a
  claim about a run. Rather than write §6.6 from claims nobody could check, criteria 2.3, 2.4, 3.4,
  3.5, 4.2, 4.3, 4.4 and 4.6 were re-run on 2026-08-09 against the tree as it now stands, each
  restored and each restore verified by hash or by a line-for-line diff. Consequence stated rather
  than implied: that backfill is evidence those guards can go red **today**, never a record of what
  was observed on the days those phases shipped.
- **Three predictions did not survive contact, and one measurement is sharper than the criterion
  that asked for it.** 4.3 as worded and 4.4's first attempt both end on
  `Timed out waiting 120000ms from config.webServer` — the run never starts, so nothing is learned;
  the general form is now a rule in §6.11. 4.6 fails earlier than predicted in the browser (the
  session producer is downstream of the middleware it would test) and in more places than predicted
  in Vitest (four files, three of them file-census guards noticing a file left `src/`). And 4.2's
  Vitest half is better than "100% green": the suite stays green **and silently loses two cases,
  399 → 397**, because `it.each` over the real array simply drops rows — which is the asymmetry the
  hardcoded route copy in the spec exists to cover, measured rather than argued.
- **The layer was measured FLAKY, and this phase is where that was found.** Phase 5's record says
  `npm run e2e` is green; on 2026-08-09 that turned out to hold only on a warm Vite dependency
  cache. Ten runs at the default worker count: six green at ~12 s, four red, every red on a cold or
  freshly-invalidated `node_modules/.vite`, reproduced deliberately twice by moving that directory
  aside. Cause in the run's own output, not in the app — Vite rewrites `deps_ssr/` under a new hash
  while Astro compiles routes on demand, and requests in flight answer 500. Fixed by **`workers: 1`**
  (11 of 11 green on cold caches — 5 with the warm-up plus 6 without it, a sum stated with its
  breakdown because this ledger has been caught on that three times — against 5 of 7 for the
  alternative), at ~12 s → ~21 s per run. A
  route warm-up was written first and **deleted** because its measured contribution was zero once
  requests were serialised — a negative result recorded rather than shipped as a mechanism with a
  confident comment. `retries` stays **0**; this removes a cause, not a symptom.
- **`.gitignore` gained four artifact classes and they are LATENT, not observed** —
  `playwright-report/`, `blob-report/`, a root-anchored `.last-run.json` and `*-snapshots/`. The
  default reporter produces none of them today; they are listed so the first person to add an HTML
  reporter or a screenshot assertion does not commit them. The anchoring choice is deliberate and
  says so in a comment: an anchored ignore does not cover a moved `outputDir`.
- **§7's three e2e-keyed sites were checked and all three STAND, with the absence of an edit
  recorded at each.** This was the first date on which their restated conditions could have been
  met, because the layer is now wired rather than merely present. The focus-ring exclusion wires
  neither a computed-style nor a visual-diff oracle. The islands exclusion's 2026-08-05 prediction
  held exactly: two journeys drive two of the four `fetch`-carrying islands, on happy paths, so not
  one island's failure branch is exercised. And the nested `scroll-padding-top` deferral — whose
  2026-08-05 re-decision named **this phase** as its owner — is **declined on the merits and dated
  at the site**, with the ownership re-stated so it points at the next manual browser matrix rather
  than at a phase that has closed.
- **The predecessor's roadmap debt is not repeated, and the predecessor's own is now visible.**
  `roadmap.md` gains the **H-12** row and detail block for this change, so `/10x-archive` has
  something to close — the omission that produced the H-04/H-07/H-08 backfills. `roadmap.md:234`'s
  claim that this project "nie ma warstwy e2e ani visual-diff" was **half** false as of 2026-08-05
  and is corrected on the e2e half only; the visual-diff half stands untouched and is still true.
  What is NOT fixed here: `test-plan-refresh-2026-08-05` still has no roadmap row of its own, which
  its own §8 entry predicted and accepted.
- **Still open after this entry, deliberately**: the layer is never a gate and must not become one;
  the true console Ctrl-C path is unmeasured (the change's `verification.md` records why, including
  a measurement attempt that damaged what it measured); the registry's residual failure mode
  survives; §7's islands exclusion survives per island; the 5459-deck debt is stopped, not repaid;
  and `customfield_10041` on **C10X-46** is `/jira-finish-work`'s to fill —
  `context/foundation/jira-map.md` is owned by the Jira skills and was not hand-edited here.

- **The replay dead-end's CONSEQUENCE half last proven by execution: 2026-08-13** (C10X-48,
  change folder `bug-generation-compensation-swallowed`). Not a §3 rollout phase and **not a
  coverage widening**: no §2 risk row moves, no phase status changes, and §3's table is untouched.
  Suite **434 passed / 434, 36 files**, seed `1786609020668` (430/434 before; the **+4** are all in
  `tests/generation/generate.test.ts`, 22 → 26, counted by running the file rather than by
  arithmetic). `npm run typecheck` exit 0 at `Result (151 files): 0 errors, 0 warnings`;
  `npm run lint` exit 0 with **3** warnings, all `no-console` in `evals/generation-quality.eval.ts`
  and unchanged by this change; `npm run build` exit 0; `git diff -- src/ supabase/` **empty** after
  every breakage restore, each additionally verified by per-file `md5sum`. **No migration ships**,
  so nothing under `supabase/` is touched and the C10X-29 drift gate is not involved.

  > **The `434` is the PRE-IMPL-REVIEW figure and the branch has read `435` since `7a8694e`;
  > corrected 2026-08-13 by C10X-49 running the suite, not by arithmetic.** This entry was written
  > before C10X-48's own impl-review commit, which then added one case
  > (`refuses to adopt a deck that HOLDS cards, even on the healed path`) to
  > `tests/generation/generate.test.ts`. **This is the third time this ledger has caught itself on
  > exactly this** — C10X-40's entry was written at its pre-review figure and so was C10X-46's, and
  > both say so in the same words. Nothing is wrong with the suite; the number is one behind.
  > **Corroborated at the FILE rather than inferred from the total**, which is what makes it a
  > measurement: this entry states its splits are per-file against `tests/generation/generate.test.ts`
  > at **26** cases, and that file measures **27** today
  > (`npx vitest run tests/generation/generate.test.ts` → `Tests 27 passed (27)`), with C10X-49
  > having touched neither it nor any file but `tests/isolation/decks.test.ts`. The missing +1 is
  > exactly where the commit says it is. Every OTHER figure in this entry stands, and the `+4` and
  > the `22 → 26` were both true when they were measured.

- **Five breakage runs rather than the planned four, because one came back GREEN** — and this
  ledger's own rule is that a green breakage run is a finding until it is explained. Removing the
  confirmation between the key-clearing update and the fall-through goes **0 of 26 red**: the
  confirmation guards a state a healthy local stack never produces, so the neuter as worded is
  observationally a no-op. The fifth run pairs it with a clear that does not clear and reproduces
  research §7's `23505` loop, with the collision's own response body captured as the evidence
  (`{"error":"Nie udało się zapisać sesji generacji. Spróbuj ponownie.","retriable":true}` — a copy
  that exists at exactly one site, reachable only after a collision on
  `generation_session_idempotency_key_uidx`). The other three: the classifier's empty arm repointed
  → **3 of 26** plus **1 of 5** in the pure file, with the write-level case staying green, which is
  what attributes those three to the classification; the heal-gate dropped from the adoption rule →
  **exactly 1 of 26**, the hand-made-EMPTY-deck 409 control, while its populated twin stays green.
- **One prediction was measured FALSE, and the correction is a boundary rather than a number.**
  Neutering `idempotency_key: null` alone was predicted to redden the cleared-key assertion while
  leaving the generation assertion green; **4 of 26 go red**, the same set as the paired run. The
  confirm-before-fall-through step asserts a row was **MATCHED**, never that the key is **GONE**, so
  a clear that finds its row and writes the wrong column sails through it into exactly the collision
  it exists to prevent. What that step does buy is unchanged and is the case `.select()` was added
  for: a clear that matched **nothing**. Same discipline as C10X-29's `missingLocal` neuter and
  C10X-30's case 8 — the conclusion holds, the prediction was rounder than reality.
- **The reachability half rests on ONE manual run and nothing re-runs it.** Two DCL revokes
  (`insert on flashcard`, `update on generation_session` — either alone reproduces nothing), one
  real keyed generation, and the row read directly in psql: `succeeded | saved_count 3 |
generated_count 3 | keyed | 0 cards`. The response is Phase 2's distinct copy carrying
  `retriable: true`, which is the first time this failure has been nameable on any channel at all —
  nothing in `src/` writes a log line and nothing in this project reads a log sink. **Restored and
  verified by three oracles rather than by memory**: the `information_schema` projection identical
  to the BEFORE dump, the raw `pg_class.relacl` byte-identical to an untouched sibling table
  (`deck`, `flashcard` and `generation_session` all `authenticated=arwdDxtm/postgres`), and
  `has_table_privilege` answering `t`/`t`. **It proves the compensation's ERROR arm only**; the
  ZERO-ROW arm is the committed cross-account test, which is the stronger evidence because it runs
  on every `npm test` rather than once.
- **Doc-sync went beyond the three edits the plan enumerated, deliberately, and the extras are
  named rather than counted.** Plan §5 §4 enumerated §6.5's `saved_count` bullet (a live
  declaration — edited in place), §6.6's impl-review-F3 paragraph (a dated snapshot — **dated
  correction**, conclusion kept) and §6.6's Phase-2 entry (a new dated note). Two more live surfaces
  would otherwise have been left stating something false about today: **this file's header block**
  and **this §8 entry**. `roadmap.md` gained a row too — **H-16**, at `Status: in progress`, created
  during implementation rather than backfilled, because without it `/10x-archive` has nothing to
  close and the change vanishes from the roadmap; that mechanism has fired **four** times here
  (H-04, H-07, H-08, H-13) and was pre-empted once (H-15). Recorded as C10X-48's D-09 in its
  `change.md` so it reads as a decision rather than as drift.
- **Still open after this entry, deliberately**: the island half, as always (§7) — `GeneratorForm`
  now reads `retriable` with **absent meaning retriable** (D-08; measured: 2 of 20 `return json(...)`
  sites carried the flag, so a strict read would have removed "Ponów" from every transient 500,
  including the one this ticket exists for), and that rests entirely on a browser matrix. The two
  remaining swallowed `await`s in `generate.ts` are **exceptions with owners**, annotated at their
  sites: the deck undo after a failed session insert (**C10X-49**) and the two failure-path
  `createGenerationSession` inserts (**C10X-50**). Already-poisoned CLOUD rows are **not** backfilled
  (D-05) — inert until someone replays that key, and disarmed at that moment. `review.astro`'s
  misattribution of a lying session stays a live, separate defect for §6-shaped rows. And
  `customfield_10041` on **C10X-48** is `/jira-finish-work`'s to fill.

  > **Corrected 2026-08-13 (C10X-49), one item of that list — the bullet is not rewritten, because
  > it is the accurate record of what was open when C10X-48 closed.** "The deck undo after a failed
  > session insert (**C10X-49**)" is **closed** as of this date: the undo reads `deleteDeck`'s
  > result on both arms and answers a distinct `500` carrying `retriable: false`. What survives
  > untouched is everything else in the bullet, including the two halves that matter most here:
  > **C10X-50 still owns** the two failure-path `createGenerationSession` inserts, and the **island
  > half** is still untouched by any test — indeed C10X-49 leans on it harder, because with
  > `retriable: false` the banner carries no button at all, so its copy is the user's only route
  > out and that route rests entirely on a browser check. And read the closure as narrowly as it is
  > meant: the swallow is closed, the orphan deck is not. A failed undo still leaves an empty deck
  > behind, by decision.

- **The deck undo's HELPER contract last proven by execution: 2026-08-13** (C10X-49, change folder
  `bug-generation-deck-undo-swallowed`). The second entry of the same day and the sibling of the one
  above: same file, same class, the other call site. Not a §3 rollout phase and **not a coverage
  widening** — no §2 risk row moves, no §3 phase status changes, §3's table is untouched. Suite
  **437 passed / 437, 36 files**, exit 0, seed `1786631338612`, re-run at the doc-sync gate rather
  than carried over from the phase that measured it. `npm run typecheck` exit 0 at
  `Result (151 files): 0 errors, 0 warnings`; `npm run lint` exit 0 with **3** warnings, all
  `no-console` in `evals/generation-quality.eval.ts` and unchanged by this change; `npm run build`
  exit 0; `git diff -- src/` **empty** after the breakage restore, additionally verified by
  `md5sum`; `git diff -- supabase/` **empty** — **no migration ships**, so the C10X-29 drift gate is
  not involved and the Phase 3 DCL was uncommittable by construction.
- **Suite delta 435 → 437, files unchanged at 36, and BOTH halves were measured by running.** The
  +2 are the two cases added to `tests/isolation/decks.test.ts` (**5 → 7**); no other file gains or
  loses a case. The baseline was measured by stashing this change's only test edit and running the
  whole suite (**435 passed / 435**, seed `1786629893093`), with the stash pop verified by `md5sum`
  against the pre-stash hash. That is what turned up the `434` above being one behind — see the
  dated correction under C10X-48's entry, which is the **third** time this ledger has caught a
  pre-impl-review figure and the first time the catch came from a neighbouring change rather than
  from the entry's own author.
- **What the suite now owns, and why it had nothing before.** Until this change **`deleteDeck` had
  no caller anywhere in `tests/`** — `decks.test.ts:86-100` drives the DELETE _endpoint_
  cross-account and nothing asserted the helper's own return value — so the zero-row-vs-landed
  distinction the entire fix branches on was asserted nowhere. Two cases now pin it: B's client
  against A's deck resolves `{data: null, error: null}` **with A's row re-read as A** (row-based,
  never return-based — a null `data` over a deck that actually vanished would pass on the return
  and leak in the database), and A's own delete resolves `data` non-null with the row gone. Placed
  in `decks.test.ts` on §6.2's one-file-per-resource rule, each owning the deck it touches.
- **The positive control had to become its own `it()`, and that is a correction to the plan's
  shape rather than a flourish.** Written first as three more lines inside the denial case — the
  C10X-48 precedent — it was **never observed green under the neuter at all**: Vitest aborts a case
  at its first failed `expect`, so a control sitting after the denial does not RUN under the very
  breakage it exists to be attributed against. Measured before the split: `2 failed | 4 passed (6)`,
  with the helper control among the cases that never executed. It would have been green by silence
  rather than by observation, which is this project's own definition of an assertion that proves
  nothing. Generalise it: **a control that shares an `it()` with the assertion it attributes is not
  a control.**
- **One breakage run, two reds across two LAYERS on one neuter, both predicted by name before it
  ran.** Dropping `.maybeSingle()` from `deleteDeck` (so a zero-row DELETE resolves to `[]` instead
  of `null`) goes **2 of 7 red** in `tests/isolation/decks.test.ts`: the new helper denial on
  `expected [] to be null`, and the pre-existing **endpoint** denial on
  `expected 302 to be 404 // Object.is equality`, because `[]` is **truthy** so
  `decks/[publicId]/delete.ts:37`'s `if (!deleted)` stops firing. **Both positive controls stayed
  GREEN and that pair is the attribution** — recorded from a `--reporter=verbose` run rather than
  inferred from a passing count, because the default reporter names only failures. `[{public_id}]`
  is neither null nor falsy, so this neuter removes the **zero-row signal specifically** rather
  than breaking deletes; if deletes were simply broken the controls would be red too.
- **The narrower alternative is recorded as a decision, not an omission.** Dropping
  `.select("public_id")` instead nulls `data` for both callers, inverting the split (denial green,
  control red) for a cleaner single-red run — but it tests the `.select()` half of
  `lessons.md:243-248`, whereas the endpoint's `if (!deleted)` and `generate.ts`'s `deleted !== null`
  both depend on the `.maybeSingle()` half. The neuter that ran is the one that reaches what the
  fix actually reads.
- **The reachability half rests on ONE manual DCL run and nothing re-runs it.** Two revokes
  (`insert on public.generation_session`, `delete on public.deck` — either alone reproduces
  nothing, and `deck` deliberately keeps INSERT or `createdDeckPublicId` stays null and the undo
  never runs), driven through the real app on a throwaway account rather than the e2e harness
  account, because the run is designed to LEAVE an orphan behind and parking that in someone else's
  fixture would be litter. On the wire: `500` with
  `{"error":"Nie udało się zapisać sesji generacji, a pusta talia o tej nazwie mogła zostać utworzona. …","retriable":false}`,
  and in psql two decks with **zero cards** and **no `generation_session` row at all**. The
  **control** — `delete on public.deck` re-granted, one variable changed, a fresh deck name because
  a repeat under the first would be stopped at `generate.ts:362` by the name pre-check and measure
  nothing — answers the **ordinary** `{"error":"Nie udało się zapisać sesji generacji"}` with **no
  `retriable` field**, and leaves **no deck** behind. Without that pair, a message that fires on
  every failure is indistinguishable from one that fires on the right failure: the
  unfalsifiable-rehearsal class the C10X-29 entry records. **It proves the ERROR arm only** — the
  zero-row arm is the committed test above, which is the stronger evidence of the two because it
  runs on every `npm test` where this is a one-off nothing re-checks.
- **The restore was proved by four oracles, not remembered.** C10X-48's three transfer unchanged
  and cover **both** tables rather than only the one the last step touched: the
  `information_schema` projection identical to the BEFORE dump line for line, the raw
  `pg_class.relacl` byte-identical across `deck`, `generation_session` **and** the untouched
  sibling `flashcard`, and `has_table_privilege` answering `t`. The fourth is behavioural and is
  what the catalogue reads cannot give: the full suite green against the restored grants.
- **The browser check is load-bearing here in a way it usually is not**, because `retriable: false`
  means the banner carries **no button**, so the copy is the user's only route out. Two
  observations, both scoped past §6.11's trap that this page carries **two** `[role="alert"]` nodes
  (the mock-mode banner first in DOM order): the new copy rendered, and "Ponów" asserted absent
  from the whole document (`document.body.innerHTML.includes('Ponów') → false`) — which is what
  catches a flag that failed to reach the island, since `GeneratorForm.tsx:192` reads
  `data.retriable !== false`. Then the recovery route executed **in the copy's own order** — read,
  reload, open the selector — because reloading first makes the observation vacuous: the deck list
  is a PROP re-read on every render, so the deck would be there whatever the copy said. Before the
  reload the selector offers `+ Nowa talia` and nothing else; after it, the orphan, and the selected
  option's `value` is the same `public_id` psql reported.
- **Still open after this entry, deliberately**: **the orphan deck survives a failed undo** — this
  change detects, it does not delete (D-01), and the manual run's two decks are left in the local
  dev DB as the artifact of record; **the endpoint branch has no automated witness** and cannot
  have one, so a future edit to it will turn nothing red; **the zero-row arm of this call site is
  covered only at the HELPER layer**, never at the endpoint; **the island half is untouched**, as
  always (§7), so the absent button and the reload-then-select route rest entirely on the browser
  check; **C10X-50 owns the two remaining swallowed `await`s** (the failure-path
  `createGenerationSession` inserts at `generate.ts:426` and `:477`) — with this change closed,
  that is the last of them; and `customfield_10041` on **C10X-49** is `/jira-finish-work`'s to fill.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
