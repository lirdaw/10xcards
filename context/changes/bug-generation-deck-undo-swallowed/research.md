---
date: 2026-08-13T14:01:48+02:00
researcher: lirdaw
git_commit: c2a1e9f8420f31732d2a10955e053ee5bf7e9f32
branch: main
repository: 10xcards (local worktree My10xCards_v2)
topic: "The swallowed deleteDeck undo after a failed generation-session insert (C10X-49)"
tags: [research, codebase, generate-endpoint, compensating-write, idempotency, FR-018]
status: complete
last_updated: 2026-08-13
last_updated_by: lirdaw
---

# Research: the swallowed `deleteDeck` undo after a failed generation-session insert

**Date**: 2026-08-13T14:01:48+02:00
**Researcher**: lirdaw
**Git Commit**: `c2a1e9f8420f31732d2a10955e053ee5bf7e9f32`
**Branch**: `main`
**Repository**: `10xcards`

## Research Question

`src/pages/api/generate.ts:596-598` discards the result of `deleteDeck` — the deck undo
after a FAILED `generation_session` insert. C10X-49 wants that result checked, in C10X-48's
shape. What exactly is the defect, how is it reached, what does the user actually meet, what
can be tested, and what design questions must the plan answer?

## Summary

**The ticket's claim is confirmed verbatim, by a line-by-line trace rather than by reading the
sentence back.** When the undo at `:597` fails, the next "Ponów" — same payload, same key —
finds no keyed session (the insert failed, so no row carries the key), leaves `healedKey`
false, meets the orphan deck at `deckNameExists` (`:330`) and returns
`409 "Talia o tej nazwie już istnieje"` with **`retriable: false`**. Permanent for that deck
name.

Five findings sharpen the ticket, and three of them change what a plan should build.

1. **The user-visible shape is worse than C10X-48's, in a way the ticket does not say.** There
   the retry got a retriable 500. Here the sequence is: 500 **with** "Ponów" offered → user
   clicks → 409 with **"Ponów" taken away** and a message blaming the user's naming choice. The
   affordance is actively withdrawn on the second click, and no copy anywhere explains the
   empty deck that is now sitting in their deck list.

2. **The four-way `sessionFailure` design tension mostly dissolves under a reachability
   argument.** For `sessionError.code === "23505"` to coincide with `createdDeckPublicId`
   non-null, a request with the _same key_ — therefore the same `newDeckName` — must already
   have committed a succeeded session. `deck_user_name_unique` lets only one request create
   that deck, so any later one is stopped at `:362` (409) or at `:512-513` (23505 on
   `createDeck`, which returns with `createdDeckPublicId` still **null**). So when the undo
   runs at all, `sessionFailure` is essentially always the `:554` default — the ONE variant
   carrying no `retriable` flag. Derived independently twice; it is an inference from
   constraint-driven serialisation, not something a test pins.

3. **The arm that will actually fire here is `error`, not zero-rows — the inverse of the
   sibling branch.** The deck was created by this same client one round-trip earlier at `:506`,
   so a zero-row DELETE needs the row to have vanished in between; the realistic causes
   (transport, DB operational, expired JWT) all produce a non-null `error`. C10X-48's evidence
   emphasis was the opposite way round. Both arms must still be checked — `deckUndone =
!deleteError && deleted !== null` — but the plan should not inherit C10X-48's framing about
   which one matters.

4. **Nothing tests this branch, at any layer, and `deleteDeck` has no test caller anywhere in
   `tests/`.** Endpoint-level reachability is not achievable inside the suite's written rules,
   and — separately from those rules — not achievable at all by seeding, for a structural
   reason: the top-of-handler lookup's filter set is _identical_ to the partial unique index's
   predicate, so no seedable row can collide at `:531`. The cheapest genuinely new coverage is
   a cross-account zero-row test on `deleteDeck`, mirroring `generate.test.ts:1110`.

5. **One thing on this branch is not in the ticket and appears in no prior document**: the
   early `return outcome.response` at `:566` bypasses the deck undo, while the comment at
   `:552-553` claims the undo "runs on every one of these paths". Same reachability caveat as
   (2), so it is a correctness-of-the-comment issue more than a live bug — but the plan must
   either close it or say why not.

## Detailed Findings

### 1. The defect site and its immediate shape

`src/pages/api/generate.ts:596-598`:

```ts
if (createdDeckPublicId) {
  await deleteDeck(supabase, createdDeckPublicId);
}
return json(500, sessionFailure);
```

The helper already carries the contract that makes the result readable —
`src/lib/decks.ts:40-42` ends `.select("public_id").maybeSingle()`, with the header at `:37-39`
stating why. So **no lib change is needed**; the whole defect is the discarded pair at the call
site. The sibling one branch down already does it right (`:628-632`).

The in-code handoff is explicit and is a warning about direction —
`src/pages/api/generate.ts:588-595`:

> "Do not read the inversion backwards and re-swallow the compensation to restore the
> symmetry — the fix is to check THIS await too, and it belongs to C10X-49, which owns this
> branch and its tests."

### 2. When the undo runs at all

`createdDeckPublicId` is written at exactly one site, `:518` (grep-verified: the only two
writes in the tree are `:313` and `:518`), inside `if (newDeckName && deckId === null)`
(`:505`). All of these must hold:

- the request carries `newDeckName`, not `deckPublicId` (`bodySchema.refine`, `:94-96`);
- `deckNameExists` (`:330`) found the name **free**;
- the LLM call succeeded and `saved > 0` (both failure returns at `:463` / `:492` skipped);
- `createDeck` (`:506`) succeeded.

**The adoption path leaves it null, deliberately.** `:365-398` sets `deckId`/`deckPublicIdOut`
but not `createdDeckPublicId`, and `:395-397` states the reason: the deck predates this
request. Consequence: on the adopted path the `deleteDeck` at `:597` **does not run at all**,
which is correct — the defect is confined to the fresh-deck path.

### 3. How `sessionError` is reached

Constraints on `generation_session` (`supabase/migrations/20260712162349_generation_session.sql:21-36`,
plus `20260725133600_generation_idempotency_key.sql:43-49`). Three are provably unreachable on
this insert: `char_length(source_text) > 0` (guarded at `:206-209`), `status in
('succeeded','failed')` (the literal `"succeeded"` at `:539`), and every NOT NULL (all supplied
at `:532-543`). The realistically reachable causes:

| Cause                                                | Mechanism                                                                                                                                                                                  | Transient?                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Transport (`502 upstream prematurely closed`)        | Kong→PostgREST keep-alive, the C10X-39 class. **Production has no retry wrapper** — `tests/setup/retry-transport.ts` is a Vitest `setupFiles` entry only                                   | yes                         |
| DB operational                                       | statement timeout, connection exhaustion, deadlock                                                                                                                                         | yes                         |
| RLS/JWT (`42501`)                                    | `generation_session_insert ... with check (user_id = (select auth.uid()))` (`20260712162349:66-67`); the JWT read at `:189` is now ≥ one LLM call old (up to `SERVER_TIMEOUT_MS = 40_000`) | transient as to the request |
| `23505` on `generation_session_idempotency_key_uidx` | the one the handler maps at `:555` — but see §4                                                                                                                                            | n/a                         |
| Privilege revocation on `generation_session`         | `grant ... to authenticated` (`20260712162349:61`)                                                                                                                                         | permanent                   |

### 4. Why the `23505` sub-branch and the deck undo barely coexist

The index (`20260725133600_generation_idempotency_key.sql:46-49`):

```sql
create unique index generation_session_idempotency_key_uidx
  on generation_session (user_id, idempotency_key)
  where idempotency_key is not null and status = 'succeeded';
```

A `23505` here means another request with the same key committed a succeeded session. "Ponów"
replays the payload verbatim (`GeneratorForm.tsx:224`), so same key ⇒ same `newDeckName`. But
`deck_user_name_unique unique (user_id, name)`
(`supabase/migrations/20260705180246_init_core_schema.sql:48`) admits only one deck of that
name, so the later request is stopped either at `:362` (409, before any generation) or at
`:512-513` (`23505` on `createDeck` → 409, `createdDeckPublicId` still null). Either way it
never reaches `:531` holding a deck it created.

**Therefore, on the paths where the undo runs, `sessionFailure` is the `:554` default** —
`{ error: "Nie udało się zapisać sesji generacji" }`, with **no `retriable` field**, relying on
the D-08 absent-means-retriable default. The three `retriable: true` variants at `:562`,
`:577`, `:578` are, in that combination, unreachable.

Labelled as an inference: it follows from constraint-driven serialisation and is not pinned by
any test. A plan that wants belt and braces can still write the fix to handle all four
variants — it just should not spend design effort on a tension that does not bite.

### 5. The retry trace — the ticket's claim, verified step by step

Client side first: the key is minted once per **submit** (`GeneratorForm.tsx:153`), stashed in
`lastPayload` (`:165`), and `handleRetry` re-issues it verbatim (`:224`).

| Line   | What happens on "Ponów"                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:232` | `idempotencyKey` present → enter the replay block                                                                                                                                                                                      |
| `:235` | `findSucceededSessionByIdempotencyKey` filters `.eq("idempotency_key", k).eq("status","succeeded")` (`src/lib/generations.ts:50-57`). **The first attempt's insert failed, so no row carries that key.** → `{data: null, error: null}` |
| `:239` | `replayed` null → whole heal block skipped → **`healedKey` stays `false`** (set only at `:266`)                                                                                                                                        |
| `:330` | `deckNameExists` finds the **orphan deck** the failed undo left behind                                                                                                                                                                 |
| `:362` | `if (existing && !healedKey)` → `true && true` → fires                                                                                                                                                                                 |
| `:363` | `return json(409, { error: DECK_NAME_TAKEN_MESSAGE, retriable: false })`                                                                                                                                                               |

`DECK_NAME_TAKEN_MESSAGE = "Talia o tej nazwie już istnieje"` (`src/lib/redirect-errors.ts:64`).
`GeneratorForm.tsx:192` reads `data.retriable !== false` → `canRetry` false → the "Ponów"
button at `:371-382` **disappears**.

**`healedKey` can never be true on this retry, categorically**: it is set only when the lookup
returned a row, and the only row that could carry this per-attempt key is the session this very
attempt failed to insert. **So C10X-48's adoption path does not rescue this case** — and that
is not a discovery, it is predicted in writing at `src/pages/api/generate.ts:344-355`, which
names "the session-insert 500" among the failures that forfeit the heal while the orphan
survives (D-10; `context/archive/2026-08-12-bug-generation-compensation-swallowed/verification.md:315`).

**Recovery exists but is undiscoverable from the copy.** `listDecks` is unfiltered
(`src/lib/decks.ts:11-13`) and feeds the generate page's selector
(`src/pages/generate.astro:23,29,50`), so the orphan is visible and pickable — the user just has
no way to learn that from a message about a name clash.

### 6. Which arm of the undo actually fails — and why it is the inverse of the sibling

`deleteDeck` resolves `{data: null, error: null}` only when the row **does not match**
(`src/lib/decks.ts:40-42`; policies `deck_delete` / `deck_select`, both
`user_id = (select auth.uid())`, `20260705180246:109-110,119-120`). Here the deck was created
by the same client, in the same request, one round-trip earlier — so the zero-row arm needs the
row to have vanished in between. The one realistic route is account deletion cascading the deck
away (`on delete cascade` on `deck.user_id`, `20260705180246:44`), which is also a cause of the
`sessionError` itself. Nothing else can cascade a deck away: there is no `RESTRICT`/`NO ACTION`
FK pointing at `deck`, and `generation_session` carries no `deck_id` column at all — which
corroborates the "provably empty here" claim at `:585-586`.

So the realistic failure at `:597` is a **non-null `error`**. C10X-48's own evidence split ran
the other way (its committed cross-account test proved the _zero-row_ arm and called it the
stronger evidence; the DCL run proved the error arm). The check must still be
`!deleteError && deleted !== null`, as at `:631` — the point is only that the plan should not
inherit the sibling's emphasis about which arm is the interesting one.

### 7. The correlated-failure argument transfers, and is stronger here

C10X-48 argued the compensation is expected to fail on the likeliest road to the primary
failure. Here the failing INSERT and the compensating DELETE are two HTTP round-trips over the
same `fetch`, same `SUPABASE_URL`, same Kong→PostgREST path, same JWT from the one
`createClient` call at `:182` — with no second table or statement class in between.

| Cause of `sessionError`                        | Does the DELETE fail too?                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Transport / Kong `502`                         | **Yes**, strongly — same pool, same proxy, same instant                     |
| DB operational                                 | **Yes**, strongly — same server, same moment                                |
| RLS / expired JWT                              | **Yes**, strongly — `deck_delete` uses the identical `auth.uid()` predicate |
| Account deleted (`23503`)                      | **Yes**, and in the _zero-row_ arm — the deck was cascade-deleted           |
| Privilege revoked on `generation_session` only | No — `deck`'s grants are a separate line (`20260705180246:101`)             |

The swallow is silent precisely in the cases that produce it.

### 8. Test reality

- **The entire `sessionError` branch (`:545-599`) has zero coverage of any kind** — no
  committed test, and no manual run either. Established three ways: a grep over `tests/` for
  all four response literals returns nothing; no test asserts `toBe(500)` on `/api/generate`
  at all; `tests/generation/generate.test.ts:8` imports `clearSessionIdempotencyKey` and
  `retireGenerationSession` but neither `createGenerationSession` nor `deleteDeck`.
- **`deleteDeck` has no caller anywhere in `tests/`** — so unlike the two `generations.ts`
  helpers (covered by `generate.test.ts:1110`, "makes a ZERO-ROW compensating write visible to
  its caller, on both helpers"), its zero-row-vs-landed distinction is asserted nowhere.
- **`createdDeckPublicId` is exercised only on paths that return 200** —
  `generate.test.ts:507` and `:844`. `failure-path.test.ts` uses `newDeckName` in all four
  cases but returns at `:463`/`:492`, i.e. _before_ `:505`; its
  `expect(await decksNamed(...)).toHaveLength(0)` oracles prove the deck was never created,
  not that an undo ran.
- **The failure-path seam cannot reach this branch.** `tests/generation/failure-path.test.ts`
  doubles `astro:env/server` (`:54-62`) and wraps `fetch` (`:94-131`), but the wrapper
  delegates every Supabase URL to `realFetch` (`:109-120`) and its header states the rule:
  _"The database and RLS are NEVER doubled"_ (`:35-36`). It controls what OpenRouter answers —
  nothing downstream of `:505`.
- **Seeding cannot provoke a real `23505` at `:531` either**, and the reason is structural:
  `findSucceededSessionByIdempotencyKey`'s filter set is _identical_ to the index predicate, so
  any row that could collide is a row the top lookup already found — and it then either replays
  (returns) or heals (clears the key). `generate.ts:245-250` names this as the safety property.
- **A guard already pins the ordinary 409** that a careless fix could break:
  `generate.test.ts:871` ("409s a newDeckName that is already taken") uses a deck created
  through `/api/decks`, key-**less**, so it goes red the moment the adoption gate is loosened
  from `healedKey` to emptiness alone.

### 9. Previously unrecorded: the early return at `:566` skips the undo

Inside the same `if (sessionError)` block:

```ts
} else if (won) {
  const outcome = await replaySession(supabase, won);
  if (outcome.kind === "answered") {
    return outcome.response;          // :566 — returns BEFORE the undo at :596
  }
```

`replaySession` returns `answered` for **both** the 200 replay (`:167-178`) and the 500
"Nie udało się odtworzyć wyników generacji" (`:161`), so both bypass the undo. That contradicts
the comment two screens up at `:552-553`: _"Built up rather than returned early, so the deck
undo below still runs on every one of these paths."_ Accurate for the three `sessionFailure`
assignments; false for this `return`.

Under §4 the combination is ~unreachable, so this is a correctness-of-the-comment problem more
than a live bug — but a change whose whole subject is _this branch's_ undo should not leave a
false claim about that undo standing in the same block. Found here; in no prior document.

## Code References

- `src/pages/api/generate.ts:596-598` — the defect: the discarded `deleteDeck` result
- `src/pages/api/generate.ts:588-595` — the C10X-49 handoff comment, to be rewritten not deleted
- `src/pages/api/generate.ts:628-632` — the sibling fix's shape (`deckUndone`)
- `src/pages/api/generate.ts:642-652` — the sibling's combined gate and its two response bodies
- `src/pages/api/generate.ts:552-579` — the four `sessionFailure` variants; `:566` the early return
- `src/pages/api/generate.ts:505-519` — the only assignment of `createdDeckPublicId`
- `src/pages/api/generate.ts:344-355` — D-10's single-use heal, which predicts this exact orphan
- `src/pages/api/generate.ts:99-113` — the `retriable` convention (absent ⇒ retriable)
- `src/lib/decks.ts:37-42` — `deleteDeck`'s `.select(...).maybeSingle()` contract (no change needed)
- `src/lib/generations.ts:50-57` — the lookup whose filters equal the index predicate
- `src/lib/generations.ts:139-146`, `:172-174` — the two checked-write precedents
- `supabase/migrations/20260725133600_generation_idempotency_key.sql:46-49` — the partial index
- `supabase/migrations/20260705180246_init_core_schema.sql:48` — `deck_user_name_unique`
- `src/components/generate/GeneratorForm.tsx:182-195` — `retriable` read; `:224` verbatim replay
- `src/components/auth/ServerError.tsx:44-50` — the banner; `items-center`, no `break-words`
- `tests/generation/generate.test.ts:1110-1160` — the cross-account zero-row pattern to copy
- `tests/generation/generate.test.ts:871` — the ordinary-409 guard a fix must keep green
- `tests/generation/failure-path.test.ts:35-36,109-120` — why the seam cannot reach this branch

## Architecture Insights

- **A compensating write is an ordinary write** (`lessons.md:243-248`, written by C10X-48).
  Two layers must both hold: read the result, and branch on `data` rather than `error` alone,
  because without an explicit `.select()` a zero-row UPDATE/DELETE under RLS is
  byte-indistinguishable from a landed one. Here layer two is already in the helper; only
  layer one is missing.
- **`healedKey` is request-local by design**, which is what makes the heal single-use (D-10) —
  and this branch is one of the surfaces named as forfeiting it. Any temptation to "just make
  the retry work" by widening adoption re-opens a decision C10X-48 weighed and declined.
- **The response body is the only witness.** `src/` writes no log line and this project reads
  no log sink (`tests/lib/no-logging.test.ts:102-104`; test-plan §7), so error copy is not
  cosmetics — it is the entire observability surface for this failure.
- **`retriable` is fail-safe**: absent means retriable, both in the endpoint's convention
  (`:99-113`) and in the island's read (`GeneratorForm.tsx:192`). Do not invert it.
- **A message only a JSON endpoint emits must NOT join `REDIRECT_MESSAGES`**
  (`src/lib/redirect-errors.ts:85-95`; size pinned at `tests/lib/redirect-errors.test.ts:92-95`).
  Share the constant, not the membership. The sibling's long literal at `:648-651` is inline for
  exactly this reason.

## Historical Context (from prior changes)

From `context/archive/2026-08-12-bug-generation-compensation-swallowed/` (C10X-48) — note it
carries **eleven** decisions, not the nine its planning block suggests, laid down in three
layers (planning D-01…D-08, implementation D-09, impl-review D-10/D-11):

- **D-01 + its dated correction** (`change.md:20-34`) — the sibling `deleteDeck` was pulled into
  C10X-48 as a precondition; the correction is the sentence C10X-49 must internalise:
  _"Hardening gives **detection**, not deletion: the orphan deck survives a failed undo however
  loudly it is reported."_ A plan that promises the orphan goes away is overclaiming.
- **D-04** (`change.md:61-64`) — no fabricating transport seam and no DDL/DCL inside the suite.
  The suite owns the _consequence_ half; _reachability_ is one recorded manual run.
- **D-07** (`change.md:44-48`) — heal clears only the key; retirement stays the compensation's job.
- **D-08** (`change.md:50-54`) — measured: 2 of 20 `return json(...)` sites carry the flag, so a
  strict read would remove "Ponów" from every transient 500.
- **D-10** (`change.md:114-123`) — the single-use heal residual, which this branch is upstream of.
- **The manual DCL procedure** (`verification.md:138-206`): two revokes, the row read in psql,
  restore verified by **three** oracles — the `information_schema` projection matching the BEFORE
  dump, the raw `pg_class.relacl` compared byte-for-byte against an untouched sibling table, and
  `has_table_privilege` answering `t`. The analogue for C10X-49 is `revoke delete on public.deck
from authenticated` (plus `revoke insert on public.generation_session`); the restore procedure
  transfers unchanged.
- **The breakage-run discipline**: five runs where four were budgeted, **one came back GREEN**
  (_"a breakage run that stays green is a claim about the EDIT before it is a claim about the
  guard"_, `verification.md:37-48`) and **one prediction was measured FALSE** — the
  confirm-before-fall-through asserts a row was _matched_, never that the key is _gone_
  (`verification.md:102-119`).
- **The doc-sync rule** (`change.md:80-83`): a live declaration is edited in place; a dated
  snapshot takes a dated correction. The applied migration's header is deliberately never
  amended (`change.md:92-95`).
- **The roadmap row is opened DURING implementation, not backfilled** (D-09,
  `change.md:78-95`) — the mechanism has been missed four times (H-04, H-07, H-08, H-13) and
  pre-empted once (H-15).
- `research.md:180-184` frames the composition: _"C10X-48 kills the keyed retry and C10X-49 kills
  the fresh one."_

## Related Research

- `context/archive/2026-08-12-bug-generation-compensation-swallowed/research.md` — the swallow
  census (§ the four twins) and the correlated-failure measurement this change reuses
- `context/archive/2026-08-01-local-stack-transport-flake/verification.md` — the Kong keep-alive
  `502` class that is the most likely production cause of `sessionError`
- `context/foundation/test-plan.md:1731`, `:5234` — the two live declarations naming C10X-49 as
  owner of this site; both go stale on the day it ships

## Open Questions

1. **Message design — the real decision of this change.** C10X-48 answered both its
   compensation failures with ONE combined message, and that choice was **never defended**: the
   plan's only wording uses "either" (`plan.md:294-302`), so no precedent binds C10X-49. Options:
   (a) mirror the sibling — one combined literal replacing `sessionFailure` whenever the undo
   failed; (b) keep the 23505-specific variants and append a clause; (c) a distinct message
   naming the leftover deck, which is the only option that makes the state _recoverable from the
   copy_ (the user can then pick that deck from the selector). Given §4, (a) is nearly free — but
   §5 shows the user's actual pain is the _next_ click, which argues for (c).
2. **Does the fix change `retriable`?** Today the honest answer on this path is "retriable, but
   the retry will 409 unless you change the name". A `retriable: true` that leads to a
   `retriable: false` 409 one click later is arguably worse than either alternative. Weigh
   against D-08: never invert the default, and never remove an affordance by omission.
3. **Is the `:566` early return in scope?** It skips the undo and falsifies the comment at
   `:552-553`. Fixing it is two lines; leaving it means shipping a change about this undo that
   leaves a false claim about this undo in the same block. Decide explicitly.
4. **How far does the evidence go?** The suite can own: a cross-account zero-row test on
   `deleteDeck` (new, cheap, mirrors `generate.test.ts:1110`) and — if the message design allows
   — nothing at the endpoint level, because §8 shows the branch is unreachable from a test.
   Reachability would need a recorded manual DCL run in C10X-48's shape. Is one run worth it for
   a branch whose consequence half cannot be asserted either?
5. **Scope creep check.** C10X-50 owns the two failure-path `createGenerationSession` inserts
   (`:426`, `:477`). After this change, `generate.ts` has exactly two swallowed awaits left; the
   invariant sentence at `A/plan.md:330-331` must be updated rather than duplicated.
6. **`jira-map.md:156` records C10X-49 with no Change ID yet** — `/jira-finish-work` owns that
   field, but the roadmap row (D-09's lesson) must be opened during implementation.
