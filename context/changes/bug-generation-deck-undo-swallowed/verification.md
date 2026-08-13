# Verification — C10X-49 `bug-generation-deck-undo-swallowed`

Every figure below comes from a run executed on **2026-08-13** against the tree at the phase
named, local stack up, `OPENROUTER_API_KEY` unset. Splits are per-file
(`tests/isolation/decks.test.ts`) unless a row says otherwise, because that is the denominator
each run was measured against; the full-suite figure is stated once, in §2.

## 1. The boundary, stated before the coverage

**The endpoint fix has no automated witness, and this phase does not pretend otherwise.** The
branch Phase 1 changed — the compensating `deleteDeck` after a failed `generation_session`
insert — is unreachable from this suite for the structural reason `research.md` §8 establishes:
`failure-path.test.ts`'s seam never doubles the database, and seeding cannot provoke a `23505`
at `generate.ts:531` because `findSucceededSessionByIdempotencyKey`'s filter set is _identical_
to the partial index predicate. No amount of seeding changes that.

So the evidence is split, and the split is the honest part:

- the **suite** owns the HELPER's contract — the zero-row-vs-landed distinction `deckUndone`
  branches on (§3 below);
- **one recorded manual DCL run** owns the endpoint's use of it (Phase 3);
- **nothing bridges the two**, and no test in this project can.

**Re-verified against the code at Phase 2's manual gate, rather than carried over from research**,
because this boundary is the one claim a reader is most likely to take on trust. All three legs
hold:

| Leg                                           | Checked how                                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deleteDeck` had no caller in `tests/`        | `grep -rn "deleteDeck" src/ tests/` — every `tests/` hit is one of this phase's own lines. Two `src/` call sites: `generate.ts:612` (Phase 1's) and `:678` (C10X-48's sibling), plus `decks/[publicId]/delete.ts:32`                                   |
| The failure-path seam cannot reach the branch | `failure-path.test.ts:94-120` — the double is **fail-closed the other way**: only Supabase reaches the network and anything else is a loud failure, so the database is delegated for real. Header `:35-36`: _"The database and RLS are NEVER doubled"_ |
| Seeding cannot provoke the `23505`            | `findSucceededSessionByIdempotencyKey` filters `.eq("idempotency_key", …).eq("status","succeeded")` under RLS's `user_id` scoping; the index is `(user_id, idempotency_key) where idempotency_key is not null and status = 'succeeded'` — the same set |

The third is the load-bearing one and it is an identity, not an approximation: there is no row
that can collide on the INSERT while escaping the lookup that runs before it. A seeded row that
collides is by construction a row the top lookup already found, and it then replays or heals.

The guard a careless fix would have broken is also re-confirmed green rather than assumed:
`generate.test.ts` → `✓ 409s a newDeckName that is already taken`.

## 2. Gates (Phase 2)

| Gate                    | Result                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test`              | **437 passed / 437, 36 files**, exit 0 — green on three fresh un-pinned seeds (below)                    |
| `npm run typecheck`     | `Result (151 files): 0 errors, 0 warnings` — `typecheck: OK — 151 files checked (floor 50)`, exit 0      |
| `npm run lint`          | exit 0, **3** warnings, all `no-console` in `evals/generation-quality.eval.ts` — pre-existing, unchanged |
| `git diff -- src/`      | **empty** after the breakage restore, additionally verified by `md5sum`                                  |
| `git diff -- supabase/` | **empty** — this change ships no migration                                                               |

Seeds, all un-pinned and all green at 437: `1786630016054`, `1786630066691`, `1786630076157`.

**Suite delta: 435 → 437, files unchanged at 36.** The +2 are the two cases §3 adds to
`tests/isolation/decks.test.ts` (**5 → 7**). No other file gains or loses a case.

**Both halves of that delta were MEASURED by running, never by arithmetic**, which is this
ledger's own rule and which is what caught the figure below. The baseline was measured by
stashing this phase's only test edit and running the whole suite: **435 passed / 435, 36 files**,
seed `1786629893093`. The stash pop was verified by `md5sum` against the pre-stash hash
(`4693c162914ee00c26c4908818309f8b`, identical).

> **The pre-existing total is 435, not the 434 `test-plan.md` records for C10X-48 — and the
> cause is the defect that ledger keeps recording against itself.** C10X-48's `verification.md`
> measured 434 and its §8 entry carries that figure, but its own impl-review commit `7a8694e`
> then added one case (`refuses to adopt a deck that HOLDS cards, even on the healed path`) to
> `tests/generation/generate.test.ts`. So 434 is the **pre-impl-review** figure, exactly as
> C10X-40's entry was and as C10X-46's entry was. Nothing is wrong with the suite; the number in
> the ledger is one behind. Phase 4 carries this as a dated correction rather than a rewrite.
>
> **Corroborated at the file rather than inferred from the total**, which is the check that turns
> this from arithmetic into a measurement: C10X-48's `verification.md` states its splits are
> per-file against `tests/generation/generate.test.ts`, **26** cases. That file measures **27**
> today (`npx vitest run tests/generation/generate.test.ts`, `Tests 27 passed (27)`), and this
> phase touched neither it nor any file but `tests/isolation/decks.test.ts`. The missing +1 is
> exactly where the commit says it is.

Pristine hash, taken before the breakage edit and re-checked after the restore:

```
38440185c01d198efca972e47c8a6936 *src/lib/decks.ts
```

## 3. What the suite now owns

`tests/isolation/decks.test.ts`, two cases. Placed here rather than in `generate.test.ts` on
§6.2's one-file-per-resource rule — the claim is about a deck helper — and directly beside the
endpoint-level twin at `:86-100` that they complement.

Until this phase **`deleteDeck` had no caller anywhere in `tests/`**: `decks.test.ts:86-100`
drives the DELETE _endpoint_ cross-account, and nothing asserted the helper's own return value.

| Case                                                                  | What it pins                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makes a ZERO-ROW delete visible to its caller, on the helper itself` | B's client against A's deck resolves `{ data: null, error: null }`; A re-reads the row and it is still there — row-based, never return-based (§6.2) |
| `reports a LANDED delete to its caller as a row, on the same helper`  | A's own delete resolves `data` non-null and the row is gone — the positive control                                                                  |

**The control is a separate `it()` on purpose, and that is a correction to the plan's shape
rather than a flourish.** Written first as three more lines inside the denial case — the C10X-48
precedent — it was **never observed green under the neuter at all**: Vitest aborts a case at its
first failed `expect`, so a control sitting after the denial does not RUN under the very breakage
it exists to be attributed against. It would have been green by silence rather than by
observation, which is this project's own definition of an assertion that proves nothing. Measured
before the split: `2 failed | 4 passed (6)`, with the helper control among the cases that never
executed. Split into its own `it()`, it executes and is observed (§4).

Each case owns the deck it touches, created inside its own `it()` (§6.2), so neither disturbs the
shared `beforeAll` fixtures the five sibling cases assert against — which matters because shuffle
is permanently on.

## 4. Deliberate-breakage run

**Edit** (`src/lib/decks.ts:41`): drop `.maybeSingle()` from `deleteDeck`, so a zero-row DELETE
resolves to `[]` instead of `null`.

```diff
-  return supabase.from("deck").delete().eq("public_id", publicId).select("public_id").maybeSingle();
+  return supabase.from("deck").delete().eq("public_id", publicId).select("public_id");
```

**Observed: 2 of 7 red** — both predicted by the plan, and named before the run so a two-red
result could not be read as a mystery.

| Case                                                                  | Layer    | Failure string                                 |
| --------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| `makes a ZERO-ROW delete visible to its caller, on the helper itself` | helper   | `expected [] to be null`                       |
| `refuses B's delete of A's deck and leaves A's deck in place`         | endpoint | `expected 302 to be 404 // Object.is equality` |

The second is the plan's own prediction and the reason it is worth stating: `[]` is **truthy**, so
`src/pages/api/decks/[publicId]/delete.ts:37`'s `if (!deleted)` stops firing and the endpoint
answers `302` where the case expects `404`. One neuter, two layers, two different failure strings.

**Both positive controls stayed GREEN, and that pair is the attribution** — recorded from a
`--reporter=verbose` run rather than inferred from a passing count, because the default reporter
names only failures:

```
✓ reports a LANDED delete to its caller as a row, on the same helper   77ms
✓ still lets A delete A's own deck                                     77ms
× makes a ZERO-ROW delete visible to its caller, on the helper itself   → expected [] to be null
× refuses B's delete of A's deck and leaves A's deck in place           → expected 302 to be 404
```

`[{ public_id }]` is neither null nor falsy, so the landed path is untouched on either layer.
That is what makes this neuter a removal of the **zero-row signal specifically** rather than a
broken delete: if deletes were simply broken, the controls would be red too.

**The narrower alternative and why it was not taken** (recorded so it is a decision rather than an
omission): dropping `.select("public_id")` instead nulls `data` for both callers, which inverts
the split — denial green, positive control red — and is a cleaner single-red run. But it tests the
`.select()` half of `lessons.md:243-248`, whereas the endpoint's `if (!deleted)` and
`generate.ts`'s `deleted !== null` both depend on the `.maybeSingle()` half. The neuter run is the
one that reaches the thing the fix actually reads.

**Restore**: `src/lib/decks.ts` copied back from the pristine copy, `md5sum` **identical**
(`38440185c01d198efca972e47c8a6936`), `git diff -- src/` **empty**, then
`tests/isolation/decks.test.ts` **7 passed (7)** (seed `1786630012326`) and the full suite green
on three fresh seeds (§2).

## 5. Still open after Phase 2

- **The endpoint branch has no automated witness** — §1, and Phase 3 is its only evidence.
- **The orphan deck survives a failed undo.** This change detects; it does not delete (D-01).
- **The island half is untouched**, as always (test-plan §7): that `retriable: false` reaches
  `GeneratorForm` and removes the "Ponów" button rests on Phase 3's browser check.
- **C10X-50 owns the two remaining swallowed `await`s** in `generate.ts` (the failure-path
  `createGenerationSession` inserts at `:426` and `:477`).
