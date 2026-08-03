<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 candidate-review

- **Plan**: `context/changes/candidate-review/plan.md`
- **Scope**: Phases 1–6 of 6 (full plan review)
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION → **all findings triaged and resolved same session**
- **Findings**: 0 critical, 4 warnings, 4 observations
- **Triage outcome**: 7 fixed, 1 recorded in the plan, 0 skipped. Re-verified after the fixes:
  lint, build, and `npm test` 69/69 all green. One new migration
  (`20260725150000_candidate_counts_rpc.sql`) ships as a result — see F2.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — independently re-run

| Check | Result |
|---|---|
| `npx astro sync` | pass |
| `npm run lint` | pass |
| `npm run build` | pass |
| `npm test` | 69/69, 8 files |
| `npx vitest run tests/review/candidates.test.ts tests/isolation/flashcards.test.ts` | 25/25 |
| Trigger narrowed (`pg_get_triggerdef`) | `BEFORE UPDATE OF front, back` — confirmed |
| Idempotency index (`pg_indexes`) | partial unique, incl. `status = 'succeeded'` — confirmed |
| Search RPC grants after drop+create | `authenticated` holds EXECUTE; `anon` true via PUBLIC default (pre-existing project-wide pattern) |
| `roadmap.md` doc-sync | Outcome only — no manual Status flip (lessons.md rule respected) |

Extra check not required by the plan: `npx astro check` reports 3 errors, **all pre-existing**
(`vitest.config.ts`, `tests/fixtures/endpoint.ts`, `tests/fixtures/session.ts`, last touched in
`1cf163e`, before this slice). None are in slice files — so the Phase 1 F2 mitigation (optional
`FlashcardView` fields) holds up under a real type-check. Note for a future phase: `astro check`
cannot be added as a CI gate until those three are fixed.

> **Dated correction, 2026-08-03 (C10X-43 `typecheck-gate`).** This paragraph's last sentence is an
> instruction addressed to a future phase, and that phase has now run — so the instruction is
> **discharged**, not wrong. It is left standing verbatim because it is the record of the blocker.
> Measured on `main` @ `9fb37bb` before any of C10X-43's work: `npx astro check` exits **0**,
> `Result (130 files): 0 errors`. The three pre-existing errors in `vitest.config.ts`,
> `tests/fixtures/endpoint.ts` and `tests/fixtures/session.ts` were cleared by **`674e919`**
> (2026-07-30, `fix(types): clear 4 latent type errors for a green astro check (M3L3)`) — a commit
> that names this blocker in its own subject line and touches exactly those three files plus
> `vitest.eval.config.ts`. Worth stating because C10X-43's own doc-sync first wrote "fixed by
> changes that did not record doing so" and that was **false**, found by running `git log` on the
> three paths rather than by inference — the reassurance-shaped guess this repo keeps having to
> retract. `astro check` was then added as a CI gate — inside `npm run typecheck`, fail-closed,
> between `astro sync` and `lint`.

## Findings

### F1 — Bulk selection can exceed the endpoint's 100-id cap, producing a 400 for an action the UI offered

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[publicId]/cards/batch.ts:22-24, src/lib/flashcards.ts:93-103, src/components/review/CandidateSelectionBar.tsx:55
- **Detail**: `IDS_MAX = 100` and `listFlashcardsByState`'s "no pagination, deliberately" both rest
  on the same premise — "a generation caps at 15 cards". That premise only holds for the
  `?generation=`-scoped view. Both *permanent* entry points are unscoped: the deck-list chip
  (`decks/index.astro:58`) and the deck view's permanent link, and `review.astro:75` passes
  `session?.id` which is `undefined` without the param. The `state=rejected` tab is an
  ever-growing archive by design (reject ≠ delete). At 101+ cards the bar renders
  `Zaznacz wszystkie ({total})`, `toggleAll()` selects them all, `runBatch` posts one array, and
  Zod's `.max(100)` answers `400 "Nieprawidłowe dane wejściowe"`. No client-side cap, no chunking.
  Secondary: PostgREST `max_rows = 1000` (`supabase/config.toml:18`) silently truncates the
  unscoped list, and every row renders into a `client:load` island as an `h-[40rem]` card.
- **Fix A ⭐ Recommended**: Chunk in `runBatch` — slice `cardPublicIds` into `IDS_MAX`-sized
  requests, merge `changed`/`skipped`, reload once at the end.
  - Strength: Keeps the server bound intact (it exists to stop a hand-crafted body) while making
    the UI's own offer always honourable. Purely island-local; no endpoint or schema change.
  - Tradeoff: Several round-trips are no longer one atomic call — a mid-way failure leaves a
    partial result, which the existing `changed`/`skipped` message can express but does not today.
  - Confidence: HIGH — the response contract already carries per-id outcomes, so merging is
    mechanical.
  - Blind spot: Haven't measured whether 7 sequential batches feel slow enough to need a progress
    affordance.
- **Fix B**: Cap the selection client-side at `IDS_MAX` and say so in the copy.
  - Strength: Smallest possible change; keeps one request per action.
  - Tradeoff: "Zaznacz wszystkie" that silently selects only 100 of 105 is its own surprise, and
    it does not address the unbounded render or the `max_rows` truncation.
  - Confidence: MEDIUM — depends on copy the user has not specified.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `CandidateReviewWorkspace.tsx` now chunks `runBatch` into
  `BATCH_MAX = 100` sequential requests and merges `changed`. A chunk failure stops the run; if
  anything already moved it still reloads (a stale list is the worse wrong), otherwise the error
  is shown. `BATCH_MAX` is commented as paired with the endpoint's `IDS_MAX`. Lint green.

### F2 — `countCandidatesByDeck` transfers one row per card and silently undercounts past 1000

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/flashcards.ts:105-124, consumed at src/pages/decks/index.astro:17
- **Detail**: The comment says this "Mirrors listDueCounts' shape" and cites study's chip as the
  settled N+1 precedent. The *return shape* matches; the *mechanism* does not. `listDueCounts`
  (`src/lib/study.ts:217-224`) calls the `study_due_counts` RPC, which aggregates **in SQL** and
  returns one row per deck. This one runs `.select("deck!inner(public_id)").eq("state_id", 1)` and
  counts in a JS loop — one transferred row per pending candidate, on every render of `/decks`.
  With `max_rows = 1000`, a user past 1000 pending candidates gets a truncated set and therefore
  **wrong chip numbers** — a plausible-looking number, not an error. `decks/index.astro:17`
  deliberately discards the count error, so nothing surfaces. The plan's requirement ("ONE grouped
  query, never a per-deck count") is met; the precedent it named is not actually followed.
- **Fix**: Add a `security invoker` RPC returning `(public_id, candidate_count)` grouped in SQL,
  mirroring `study_due_counts`, and have `countCandidatesByDeck` call it.
  - Strength: The precedent already exists in this repo, so the shape is settled; removes both the
    payload growth and the silent-truncation correctness bug in one move.
  - Tradeoff: A fourth migration in a slice that already ships three.
  - Confidence: HIGH — `study_due_counts` is a direct template.
  - Blind spot: None significant.
- **Decision**: FIXED — new migration `20260725150000_candidate_counts_rpc.sql` adds a
  `security invoker` / `search_path = ''` RPC `candidate_counts_by_deck()` grouping in SQL;
  `countCandidatesByDeck` now calls it. Types regenerated, grants match the project pattern
  (`authenticated` EXECUTE; `anon` true via PUBLIC default, invoker so RLS still yields zero rows).

  **A free red-check came with it.** The first version used a `left join`, mirroring
  `study_due_counts` literally, which returns a zero-candidate deck as `0` instead of leaving it
  absent. `candidates.test.ts` went red immediately (`expected +0 to be undefined`) — the test
  pins "absent, not zero" deliberately, and also uses absence as the cross-account denial signal.
  Fixed by making the join **inner**, which is a deliberate divergence from the precedent and is
  commented as such in the migration. That red proves the chip assertion observes the mechanism
  rather than an incidental number. Full suite back to 69/69; build green.

### F3 — The two idempotency guards are documented as independent, and they are not

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/generate.ts:220-224, supabase/migrations/20260725133600_generation_idempotency_key.sql:27-29, context/foundation/test-plan.md §6.6
- **Detail**: Two separate things here, with one fix.

  **(a) Contract deviation.** Plan Phase 6 #1 specified the index as
  `where idempotency_key is not null` and argued explicitly that it "covers every row regardless of
  `status`". What shipped adds `and status = 'succeeded'`. The deviation is deliberate and recorded
  in `test-plan.md` §6.6.

  **(b) The recorded rationale for it is wrong, in a way that invites a regression.** All three
  places justify the predicate by saying the NULL-on-failure writes are a *second, independent*
  guard — `generate.ts:220` says the key "stays NULL on **every** failure path"; the migration
  calls the NULLs a "druga, niezalezna linia obrony"; §6.6 says "**Either alone would do**; keep
  both". That is false. `failGenerationSession` (`src/lib/generations.ts:116-121`) updates only
  `status`, `saved_count` and `error_message` — it does **not** null the key. So when
  `insertCandidates` fails (`generate.ts:307-312`), the compensating update flips the
  just-inserted `succeeded` row — which carries the key (`:290`) — to `failed` **with the key
  intact**. That is a third, production-reachable path to a `failed` row holding a key, and the two
  failure inserts do not cover it.

  Consequence: the `status = 'succeeded'` predicate is load-bearing in production, not merely a
  concession to a test criterion. Without it, "Ponów" after a card-insert failure collides on its
  own session insert; the `23505` handler at `:298-303` finds no *succeeded* session and falls
  through to `500`. Retry dead forever — exactly the FR-018 flow plan-review F1 exists to protect.
  Behaviour today is correct; only the reasoning is wrong, and it is the reasoning a future
  contributor would use to justify simplifying the predicate away.
- **Fix**: Correct the three comments to name `failGenerationSession` as a third path to a
  keyed `failed` row, and state that the index predicate is the guard that covers it — the NULL
  writes are complementary, not independent. Drop the "either alone would do" claim from §6.6.
  - Strength: No behaviour change; removes the specific false premise that would license removing
    a load-bearing predicate.
  - Tradeoff: Documentation only — it does not make the invariant enforceable.
  - Confidence: HIGH — verified by reading `failGenerationSession` and its one call site.
  - Blind spot: An alternative is to null the key inside `failGenerationSession`, which would make
    the two guards genuinely independent as documented. Not recommended without deciding whether
    the audit row should keep the key.
- **Decision**: FIXED — all three comments corrected (`generate.ts:220`, the migration's header,
  `test-plan.md` §6.6). Each now names `failGenerationSession` as the third, production-reachable
  route to a keyed `failed` row and states that the index predicate is the only guard covering it.
  §6.6 explicitly retracts its own "either alone would do". No behaviour change.

### F4 — A `newDeckName` generation that fails after the deck is created leaves retry permanently 409-ing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/generate.ts:257-313
- **Detail**: Deck creation was correctly deferred past the LLM call (impl-review F1), but
  `createDeck` still runs *before* the session insert (`:260-270`) and before `insertCandidates`
  (`:307`). If the session insert fails with a non-23505 error, or the card insert fails, the deck
  already exists and the session is `failed`. "Ponów" replays the same payload:
  `findSucceededSessionByIdempotencyKey` matches nothing (correctly — the row is `failed`),
  execution falls through to `deckNameExists(newDeckName)` → `true` → `409 "Talia o tej nazwie już
  istnieje"`. The retry can never succeed and the user is left with an empty orphan deck. Narrow —
  it needs a DB-side write failure, not an LLM failure — but it is the same class the deferral was
  introduced to prevent, one step further down the path, and it sits inside the flow this slice
  claims closed against lessons.md's "Klient↔serwer timeouty + «Ponów» wymagają idempotencji".
- **Fix A ⭐ Recommended**: On the `sessionError` / `cardsError` branches, when this request created
  the deck, delete it before returning — it is provably empty at that point.
  - Strength: Restores the exact invariant the `createDeck` deferral was for (a failed generation
    leaves nothing behind), and needs no schema change. Symmetric with the existing best-effort
    compensating update right beside it.
  - Tradeoff: Another best-effort compensation that can itself fail; the writes are not one
    transaction.
  - Confidence: MEDIUM — the delete is safe (deck empty, RLS-scoped), but I have not checked
    whether any FK from the `failed` session would block it.
  - Blind spot: Haven't verified there is no `deck_id` FK on `generation_session` — the plan says
    there is none, which would make the delete clean.
- **Fix B**: Leave the deck and make the retry reuse it — treat a `deckNameExists` hit as
  "resolve to that deck" rather than 409 when an `idempotencyKey` is present.
  - Strength: No deletion, and the user keeps a deck they did ask for.
  - Tradeoff: Weakens a genuine duplicate-name guard on a path where the name collision may be
    real rather than self-inflicted.
  - Confidence: LOW — changes the meaning of a user-facing 409.
  - Blind spot: Interaction with the documented concurrent-`newDeckName` race is unexamined.
- **Decision**: FIXED via Fix A — `generate.ts` now tracks `createdDeckPublicId` (set only when
  the request created the deck itself) and calls `deleteDeck` on both the `sessionError` and
  `cardsError` branches before returning 500. Blind spot closed first: `\d generation_session`
  confirms no deck FK, and no cards land on either path, so the deck is provably empty.

  **Not covered by a test, deliberately.** Reaching it needs an injected DB write failure, which
  the suite has no seam for — the same reason §6.5 records for the commit race. Carried by code
  review. The 23505-replay path is intentionally left alone: it returns success, and if this
  request had created a deck the concurrent winner would itself have 409'd at `createDeck` — the
  pre-existing concurrent-`newDeckName` race §6.6 already documents. Lint, build, 69/69 green.

### F5 — `countFlashcards` stayed unfiltered while search became accepted-only, so the empty-state copy can lie

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/flashcards.ts:154-159, consumed at src/pages/decks/[publicId]/index.astro
- **Detail**: The Phase 1 migration gates the search RPC to `state_id = 2`. `countFlashcards` —
  whose only job is to tell an empty deck apart from a search that matched nothing — still counts
  every state. A deck holding only `rejected`/`generated` cards now reports `deckHasCards = true`,
  so a fruitless search renders "Brak fiszek pasujących do „q”" instead of "Brak fiszek w tej
  talii". The two populations were identical before this slice and are not anymore.
- **Fix**: Add `.eq("state_id", STATE_ACCEPTED)` to `countFlashcards` so its population matches the
  two branches it disambiguates.
- **Decision**: FIXED — filter added, and the comment now states *why* the filter is load-bearing
  (the count must cover the same population as the two branches it disambiguates).

### F6 — Duplicate ids in `cardPublicIds` are neither rejected nor deduped

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[publicId]/cards/batch.ts:31,103-108
- **Detail**: `z.array(...).min(1).max(IDS_MAX)` accepts repeats and the derivation preserves them,
  so `["x","x"]` returns `changed: ["x","x"]`. Harmless for the database (`.in()` collapses it) but
  it inflates any count derived from the response and lets a crafted body spend the `IDS_MAX`
  budget on one id. Not reachable from the UI.
- **Fix**: Dedupe before the write — `const cardPublicIds = [...new Set(parsed.data.cardPublicIds)]`.
- **Decision**: FIXED — deduped in `batch.ts`, commented as being about the *response* shape
  (`changed`/`skipped` are derived by filtering this list) rather than about the query.

### F7 — The one destructive migration is the only one without a written rollback

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260725112600_search_accepted_only.sql:26
- **Detail**: Both siblings carry a rollback note — `20260725112700:22-25` spells out the previous
  trigger statement, `20260725133600:33-34` gives the drop-index/drop-column pair. The search
  migration is the only `drop function` in the set. It documents why the drop is safe and that
  grants must be re-applied (both correct — the `revoke`/`grant` pair is reproduced 1:1), but never
  says how to get back to the previous definition. The plan's own Migration Notes require exactly
  this: "both need their rollback written down before `db push` … only if the old definition is not
  being reconstructed from memory".
- **Fix**: Add a rollback block naming `20260712162359_deck_keyword_search.sql` as the source
  definition, matching the two siblings.
- **Decision**: FIXED — three-step rollback added, naming the source file and the exactly two
  differences (`state_id` predicate, `source_id` column), plus the reminder that the drop clears
  the ACL again so both grants must be repeated. Points the reader at the source file rather than
  inviting reconstruction from memory, per §6.6.

### F8 — `SelectionAction` ships `className` where the plan specified `variant`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/review/CandidateSelectionBar.tsx:6-11
- **Detail**: Plan Phase 3 #1 specified `{ label, icon, variant, onRun }`; shipped is
  `{ label, icon, className, onRun }`. Functionally equivalent — colour arrives as a Tailwind
  string rather than a shadcn variant — but this interface is explicitly earmarked for promotion to
  a shared primitive in C10X-16, so the divergence from the written contract will be inherited by
  the second consumer rather than resolved before it.
- **Fix**: Either switch to a `variant` prop now, or note the deviation in the plan so C10X-16's
  promotion step does not treat the plan text as the contract.
- **Decision**: NOTED IN PLAN — `plan.md` Phase 3 #1 now carries a blockquote recording the
  shipped shape and directing C10X-16 to take the contract from `CandidateSelectionBar.tsx`, not
  from the plan line. Interface left as shipped.

## Notes on what was checked and cleared

Recorded so a later reader does not re-derive it:

- **Plan adherence** — all 11 sharp clauses MATCH: the 4-edge `ALLOWED_FROM` with `generated`
  unreachable; one grouped counter query; optional `FlashcardView` fields with `listFlashcards` and
  the deck loader untouched; the `accepted + rejected + pending` denominator with both counter traps
  commented; the search migration's seven properties (drop+create, no cascade, grants re-applied,
  `security invoker`, `search_path = ''`, LIKE-escaping, `state_id = 2` + `source_id`); the trigger
  narrowing; the batch endpoint's full status contract; the `from` switch built server-side; and the
  Phase 6 mechanics (key only on the succeeded insert, lookup before the LLM call, 23505 → replay,
  deck derived from the cards).
- **Three plan deviations, all benign** — `src/lib/decks.ts` never gained `id` because the counter
  took the FK route the plan itself offered as the alternative, making Phase 1 #5 unnecessary rather
  than skipped; `decks/[publicId]/index.astro` is untouched because the permanent review link landed
  in `FlashcardWorkspace.tsx` exactly where the contract specified (sibling of `DeckContentToolbar`,
  sticky container preserved, present even at zero pending candidates);
  `ConfirmRejectModal.tsx` is unnamed in the plan but is the "confirmation affordance" Phase 4 #1
  required, and smuggles in none of C10X-16's parked scope.
- **Scope discipline** — every guardrail held: one-member union with no `delete` action, no
  `deleteFlashcards`, no `ui/checkbox.tsx`, no deck-view selection/bulk-delete/source-badge, no
  policy change in any migration, no `ensureSchedule` call outside `listDueCards`, no DB-level
  transition guard, `Sidebar.astro` unchanged, no pagination added.
- **Security** — no open redirect (`from` is a literal switch, `generation` gated by `UUID_RE`, both
  targets rebuilt from validated route params); no `set:html`/`dangerouslySetInnerHTML`; no
  `console.*` added under `src/`; no source text or API key in any client-facing body (every error
  string is a fixed Polish constant); 404-never-403 held on every new denial path.
- **Correctness** — `useSelection`'s render-time prune is right and the effect-free approach is
  justified; both islands guard double-submit on the in-flight flag *and* `disabled={pending}`;
  `res.json()` sits inside the `try`, so no unhandled rejection escapes.
- **`FlashcardItem` footer parity** — shipped as `grid-cols-3` read-only / `grid-cols-2` edit rather
  than the plan's "three columns in both modes". The stated invariant (identical space, no layout
  shift) is satisfied by the shared `mt-3 shrink-0 border-t pt-4` and one row of default-size
  buttons; only the literal wording differs. Not raised as a finding.
- **Mutation register** — unusually honest: it records that 8 of 12 kills are crash-kills on
  malformed queries, that only 4 are behavioural, and that **no mutant in the run exercises the
  "gate too permissive" direction**, explicitly deferring that claim to deliberate-breakage check 1
  rather than to the 100% score.

## Triage

Run 2026-07-25, same session as the review. 7 fixed, 1 recorded in the plan, 0 skipped, 0 accepted
as risk, 0 dismissed.

| ID | Decision | Where it landed |
|----|----------|-----------------|
| F1 | FIXED (Fix A) | `src/components/review/CandidateReviewWorkspace.tsx` — `BATCH_MAX` chunking in `runBatch` |
| F2 | FIXED | `supabase/migrations/20260725150000_candidate_counts_rpc.sql` (new) + `src/lib/flashcards.ts` |
| F3 | FIXED (docs) | `src/pages/api/generate.ts`, `supabase/migrations/20260725133600_*.sql`, `context/foundation/test-plan.md` §6.6 |
| F4 | FIXED (Fix A) | `src/pages/api/generate.ts` — `createdDeckPublicId` + `deleteDeck` on both failure branches |
| F5 | FIXED | `src/lib/flashcards.ts` — `countFlashcards` gated to `accepted` |
| F6 | FIXED | `src/pages/api/decks/[publicId]/cards/batch.ts` — dedupe before the write |
| F7 | FIXED | `supabase/migrations/20260725112600_search_accepted_only.sql` — rollback block |
| F8 | NOTED IN PLAN | `context/changes/candidate-review/plan.md` Phase 3 #1 |

### Post-triage verification

Re-run after the last edit, not carried over from the pre-triage run:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run build` | pass |
| `npm test` | 69/69, 8 files |
| `npx supabase db reset` | all 6 slice migrations apply cleanly, incl. the new RPC |
| `npm run db:types` | regenerated; `candidate_counts_by_deck` present |
| `has_function_privilege` on the new RPC | `authenticated` EXECUTE; `anon` true via PUBLIC default — matches the project-wide `security invoker` pattern |

### One red-check earned during triage

F2's first attempt mirrored `study_due_counts` literally with a `left join`, which returns a
zero-candidate deck as `0` instead of omitting it. `candidates.test.ts` went red immediately —
`expected +0 to be undefined`. That assertion pins "absent, not zero" on purpose and also carries
the cross-account denial signal, so the join was made **inner** rather than the test relaxed. The
red is worth recording: it proves the chip assertion observes the mechanism, not an incidental
number.

### What triage deliberately did NOT add

F4's fix has **no test**. Reaching it needs an injected DB write failure and the suite has no seam
for one — the same limitation §6.5 records for the generation commit race. It is carried by code
review, and that is stated rather than papered over. Nothing else in this triage changed the test
surface, so `test-plan.md` §6.6's S-05 coverage claims still hold as written, with the single
correction made under F3.
