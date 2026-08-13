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

## 6. The reachability run (manual, uncommitted, DCL) — Phase 3

The half no committed test covers, and the half no committed test **can** cover (§1): that
`/api/generate` reaches this branch at all and answers with the new body. Driven by hand on
2026-08-13 against the local stack, with the suite **not** running, through the app in a real
browser — never through a temporary spec, because Phase 3 also has to observe what the ISLAND does
with the response and that observation only exists in a browser.

The account is a throwaway created for this run through the real sign-up form,
`c10x49-phase3@example.com`, holding **zero decks** at the start. Fresh rather than the e2e
harness account deliberately: this run is designed to LEAVE an orphan deck behind (D-01 —
detection, not deletion), and parking that artifact on an account the e2e layer signs into every
run would be leaving litter in someone else's fixture. Same reasoning as C10X-48's throwaway
accounts, one surface over.

**Environment, checked before a single privilege was touched** — because the next command was a
`revoke` and this project's own rule is that every non-local seam must be closed before, not
after: `SUPABASE_URL=http://127.0.0.1:54321`, the cloud credentials parked under the `PROD_`
prefix, **no `.dev.vars`** (which would otherwise outrank `.env`), and `OPENROUTER_API_KEY` unset —
confirmed independently in the browser by the mock-mode banner on every page.

### 6.1 Grants BEFORE

`information_schema.role_table_grants`, `grantee='authenticated'`:

```
deck|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
flashcard|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
generation_session|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
```

`flashcard` is dumped alongside the two tables this run touches and is never touched by it — it is
the untouched sibling the `relacl` oracle in §6.5 compares against.

### 6.2 Two revokes, not one

```sql
revoke insert on public.generation_session from authenticated;
revoke delete on public.deck from authenticated;
```

Either alone reproduces nothing. The first is what makes the `generation_session` insert at
`:531` fail — without it the handler never enters the `if (sessionError)` block at all. The second
is what makes the compensating `deleteDeck` fail **on top of it** — without it the undo succeeds,
`deckUndone` stays `true`, and the handler returns the ordinary `sessionFailure`, which is
precisely the control in §6.4.

Dump taken **while revoked**, confirming the two removals and nothing else:

```
deck|INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
flashcard|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
generation_session|DELETE REFERENCES SELECT TRIGGER TRUNCATE UPDATE
```

`deck` keeps **INSERT**, which is load-bearing rather than incidental: `createDeck` must still
succeed or `createdDeckPublicId` stays null and the undo never runs. `has_table_privilege` while
revoked: `generation_session.INSERT` **f**, `deck.DELETE` **f**, `deck.INSERT` **t**.

### 6.3 The provocation, and why it is recorded as two runs rather than one

| Run    | Deck name           | Driven by                       | What it records                            |
| ------ | ------------------- | ------------------------------- | ------------------------------------------ |
| **X**  | `C10X-49 orphan X`  | the real form, clicking Generuj | the ISLAND half — banner, button, selector |
| **X2** | `C10X-49 orphan X2` | `fetch` from the page context   | the WIRE half — status and raw body        |

**Both ran on the identical revoked state, through the same handler, and produced the same
branch.** The split is recorded honestly rather than glossed: network capture was not armed when
run X's button was clicked, so **run X's raw body was never captured on the wire** and this
document does not claim it was. What X gives is the rendered banner (§6.6); what X2 gives is the
byte-level body. A repeat under X could not have supplied it — `generate.ts:362` stops a second
request under an existing name with `409 "Talia o tej nazwie już istnieje"` before `createDeck`,
before `:531` and before the undo, i.e. it would have measured the name pre-check rather than this
branch. That is the same constraint plan-review F3 identified for the control run, met the same
way: a fresh name.

The cost, stated rather than left to be noticed: this run leaves **two** orphan decks, not one.
Both are the artifact of record and both are deliberately left in place.

**Run X2, verbatim on the wire:**

```
status       = 500
content-type = application/json
body         = {"error":"Nie udało się zapisać sesji generacji, a pusta talia o tej nazwie mogła zostać utworzona. Jeśli tak, odśwież stronę i wybierz ją z listy talii albo zmień nazwę i spróbuj ponownie.","retriable":false}
```

That is Phase 1's literal, carrying **`retriable: false`** — so the failure this ticket was
reported for is now nameable in the response, which before this change it was not, on any channel
at all (nothing in `src/` writes a log line and nothing in this project reads a log sink).

**The rows, read directly in psql** rather than summarised:

```
name              |public_id                            |cards
C10X-49 orphan X  |90f08eac-9757-4778-8d21-a6ee0886ffbb |0
C10X-49 orphan X2 |4ecb548f-a92c-4c8f-91ae-303ee5dd106b |0

generation_session rows for this account: 0
```

Both decks exist with **zero cards** and there is **no session row at all** — the session insert
failed, and the deck undo failed on top of it. That is the orphan this ticket is about, produced
by the shipped endpoint.

### 6.4 The control run — one variable, and a different answer

`grant delete on public.deck to authenticated;` and **nothing else**, leaving
`revoke insert on public.generation_session` in place:

```
deck|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
generation_session|DELETE REFERENCES SELECT TRIGGER TRUNCATE UPDATE
```

Same shape of request, fresh idempotency key, fresh name **Y** (`C10X-49 control Y`):

```
status = 500
body   = {"error":"Nie udało się zapisać sesji generacji"}
```

The **ordinary** `sessionFailure` — the `:554` default — with **no `retriable` field at all**,
which under D-08's absent-means-retriable rule is exactly right for a failure a repeat can fix.
And in the database:

```
select count(*) from deck where name = 'C10X-49 control Y';  →  0
```

**No deck Y anywhere in the database**, so the undo ran and landed. This is the half a single run
cannot give: without it, a message that fires on every failure is indistinguishable from one that
fires on the right failure — the unfalsifiable-rehearsal class the C10X-29 entry records. The
runs differ in exactly one privilege and answer with two different bodies and two different
database outcomes.

### 6.5 Restore, verified by three oracles rather than by memory

`grant insert on public.generation_session to authenticated;` (`delete on public.deck` was already
re-granted by §6.4, so all three oracles cover **both** tables rather than only the one this step
touches):

1. **`information_schema` projection — identical to the §6.1 BEFORE dump, line for line**, all
   three tables back to `DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE`.
2. **Raw ACL from `pg_class.relacl`, carrying its own control** — a different catalogue and a
   different projection, compared against the sibling table the run never touched:

   ```
   deck               |{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
   flashcard          |{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
   generation_session |{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
   ```

   Byte for byte identical across all three.

3. **Behaviourally** — `has_table_privilege('authenticated','public.generation_session','INSERT')`
   and `…('public.deck','DELETE')` both **t**.

Then the fourth, behavioural check the three catalogue reads cannot give: the full suite, which
exercises both grants on every generation case — **437 passed / 437, 36 files**, seed
`1786630893316`, exit 0. `git diff -- src/` and `git diff -- supabase/` both **empty**: the whole
provocation was DCL against a running container, so it is uncommitted and unpushable by
construction.

### 6.6 The browser observations

Run on step X's state, **before either re-grant** (plan-review F3): once `delete on public.deck`
comes back the state these observations need no longer exists.

**The banner.** Transcribed from the DOM rather than screenshotted alone, because the transcription
is the stronger record and because §6.11's trap applies here — this page carries **two**
`[role="alert"]` nodes, the OpenRouter mock-mode banner first in DOM order, so an unscoped
`querySelector('[role="alert"]')` reads the wrong one. Both were enumerated:

```
[role=alert] #1: "Uwaga: OpenRouter nie jest skonfigurowany — generacja fiszek działa w trybie mock…"
[role=alert] #2: "Nie udało się zapisać sesji generacji, a pusta talia o tej nazwie mogła zostać
                  utworzona. Jeśli tak, odśwież stronę i wybierz ją z listy talii albo zmień nazwę
                  i spróbuj ponownie."
```

**"Ponów" is ABSENT**, and asserted as absence from the whole document rather than from a
screenshot's viewport:

```
buttons in document: ["Wyloguj", "", "Generuj"]     ("" is the sidebar collapse toggle)
document.body.innerHTML.includes('Ponów')  →  false
```

So `retriable: false` reached the island and removed the affordance. This is the observation the
plan calls load-bearing: `GeneratorForm.tsx:192` reads `data.retriable !== false`, so a flag that
failed to arrive would leave the button rendering, and nothing else in this change would have
caught that.

**How the long literal wraps** (recorded because `ServerError` renders `items-center` with no
`break-words`, so it was worth checking rather than assuming): at 1440px it wraps at word
boundaries onto **two lines** inside the banner box, left-aligned beside the alert icon, with no
overflow and no mid-word break.

**The recovery route the copy promises, executed in the copy's own order** — read the banner,
_then_ reload, _then_ open the selector. Doing it in that order is what makes the observation
mean anything (plan-review F4): reloading first is the reflex, and it would make the result
vacuous, because the deck list is a PROP re-read on every render and the deck would be there
whatever the copy said.

| Moment                           | `Talia docelowa` options                                |
| -------------------------------- | ------------------------------------------------------- |
| **Before** the reload, banner up | `+ Nowa talia` — and nothing else                       |
| **After** the reload             | `C10X-49 orphan X2`, `C10X-49 orphan X`, `+ Nowa talia` |

The pre-reload absence is the mechanism the word `odśwież` exists for, observed rather than
argued: `generate.astro` reads `listDecks` in the frontmatter and hands `decks` to the island as a
prop, the orphan is created DURING the failing request, i.e. after that render, so it is genuinely
not in the selector the user is looking at.

**And it is the orphan row itself, not a label that happens to match**: the selected option's
`value` is `90f08eac-9757-4778-8d21-a6ee0886ffbb`, the same `public_id` psql reported in §6.3.
Selecting it switches the form to the existing-deck path and the "Nazwa nowej talii" field yields
to it — so the route the copy promises is real end to end, which matters more than usual here
because with no button on the banner **the copy is the user's only way out**.

### 6.7 What this run proves, and what it does not

- **It proves the ERROR arm only.** With `delete on public.deck` revoked the compensating DELETE
  returns an **error**, so `deckUndone` goes false down the `deleteError` branch. The **zero-row**
  arm — `{ data: null, error: null }`, the case `.maybeSingle()` exists for and the one `if
(error)` alone would still swallow — is proved instead by the committed cross-account test in
  §3, which is the stronger evidence of the two because it runs on every `npm test` where this is
  a one-off observation nothing re-checks. This is the same boundary C10X-48 drew, and here it is
  the expected one: the plan predicted (research §6) that the realistic failing arm at this call
  site is `error`, the inverse of the sibling branch.
- **It proves the endpoint reaches the branch and answers with the new body. It proves nothing
  about the orphan going away**, because it does not: deck X is still there afterwards and is
  meant to be (D-01).
- **Nothing bridges §3 and §6.** The suite owns the helper's contract; this run owns the
  endpoint's use of it; no test in this project can join them, for the structural reason §1 gives.
- **It is one observation, not a regression guard.** Nothing re-runs it, and a future edit to this
  branch will not turn anything red.

## 7. Still open after Phase 3

- **The orphan decks survive**, by decision (D-01): `C10X-49 orphan X` and `C10X-49 orphan X2` are
  left in the local dev DB on the throwaway account `c10x49-phase3@example.com`. They are the
  artifact of record, not litter, and nothing else can reach that account.
- **The endpoint branch still has no automated witness** — §1 and §6.7. Phase 3 is evidence, not
  coverage.
- **The zero-row arm of this call site is covered only at the HELPER layer** (§3), never at the
  endpoint.
- **C10X-50 owns the two remaining swallowed `await`s** in `generate.ts` (the failure-path
  `createGenerationSession` inserts at `:426` and `:477`).
