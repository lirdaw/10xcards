---
date: 2026-08-13T18:00:46+02:00
researcher: lirdaw
git_commit: 286aeea094770c9b46d43432fc654927585f8ccb
branch: main
repository: 10xcards
topic: "Unchecked `failed` audit-row insert on both generation failure paths (C10X-50)"
tags: [research, codebase, generate-endpoint, generation-session, swallowed-errors, audit, observability]
status: complete
last_updated: 2026-08-13
last_updated_by: lirdaw
---

# Research: Unchecked `failed` audit-row insert on both generation failure paths

**Date**: 2026-08-13T18:00:46+02:00
**Researcher**: lirdaw
**Git Commit**: 286aeea094770c9b46d43432fc654927585f8ccb
**Branch**: main
**Repository**: 10xcards

## Research Question

Both failure paths in `src/pages/api/generate.ts` discard the result of their `status: "failed"`
audit-row insert — the transport/timeout catch at `:426` (answers 502) and the 0-saved branch at
`:477` (answers 422). C10X-50 must make a failed audit write detected and signalled rather than
silent, without breaking FR-018's "Ponów" and without touching the audit contract test-plan §6.6
records. This is the last of the three swallowed-error sites in this file; C10X-48 (compensation)
and C10X-49 (deck undo) are Done and both left `owned by C10X-50` annotations at these two sites.

> **Method note, recorded because it left a trace.** Establishing §2 needed a real PostgREST
> round-trip. One probe INSERT was issued against the **local** dev stack with
> `Prefer: tx=rollback`, which Supabase's PostgREST does **not** honour (`db-tx-end` is not
> `commit-allow-override`), so one row committed. It was deleted and the cleanup verified
> independently after the fact: `generation_session` count `4458`, rows with `source_text='probe'`
> **0**. A second probe used `BEGIN … ROLLBACK` around DDL and left nothing. No repository file was
> edited by any research step.

## Summary

**Five findings change the shape of this ticket relative to its two siblings. Three of them make it
smaller, one makes its evidence stronger, and one turns it from a bug fix into a design decision.**

1. **The precedent's headline rule does not transfer, and inheriting it would be a defect.**
   C10X-48 and C10X-49 both turn on _"under RLS a zero-row UPDATE/DELETE resolves
   `{data: null, error: null}`, so `if (error)` alone still swallows it"_. `createGenerationSession`
   is an **INSERT** ending `.select("id, public_id").single()` (`src/lib/generations.ts:23-25`), and
   `.single()` — unlike `.maybeSingle()` — has **no** null-coercion branch: it negotiates a singular
   representation with the server, and a zero-row result comes back as a **406 / `PGRST116` error**.
   Measured against the running stack, plus the postgrest-js source and its discriminated-union
   type. **`if (error)` is complete here.** A `!data` arm added for symmetry would be a branch no
   breakage run can ever redden — the unfalsifiable-assertion class this project treats as a defect.

2. **There is no deck to undo, provably.** `createdDeckPublicId` is assigned at exactly one site
   (`generate.ts:518`), strictly downstream of both returns (`:463`, `:492`), and the adoption path
   deliberately leaves it null (`:395-397`). So C10X-49's `deckUndone` shape does not repeat and the
   response copy must not mention a deck.

3. **The evidence split is better than either sibling's — and different from what `change.md`
   assumes.** `change.md` says _"no test in this suite can reach these branches"_. That is not
   right: `tests/generation/failure-path.test.ts` reaches **both** branches today (three cases on
   `:426`, one on `:477`) and each asserts the `failed` row exists exactly once. What is unreachable
   is only the **failed-insert arm**. So the split is not C10X-49's "one helper test + one manual
   run": it is _"the landed arm is already owned by four committed endpoint cases; the helper's
   failure contract is closable by a new committed test; only the endpoint's use of that failure
   needs a manual run."_

4. **`createGenerationSession` has no caller anywhere in `tests/`** — exactly the state C10X-49 found
   `deleteDeck` in — and there is a deterministic, double-free, DDL-free seam to close it: the
   cross-account RLS `WITH CHECK` refusal (`42501`), because the insert policy's predicate is
   `user_id = (select auth.uid())`.

5. **The user-visible cost of a lost audit row is zero, and that is the ticket's real question.**
   Nothing in `src/` reads `status`, `error_message`, `request_payload` or `response_payload`;
   `findSucceededSessionByIdempotencyKey` excludes `failed` rows by predicate; both sites write
   `idempotency_key: null`; and the 502/422 bodies carry no `sessionPublicId`. Unlike C10X-48 (a
   permanent 500 per key) and C10X-49 (a permanent 409 on retry), **nothing the user can act on is
   lost**. So _"signalled"_ cannot mean the same thing it meant twice before, and the sibling
   tickets' _"the response is the ONLY witness there is"_ is no longer literally true:
   `@sentry/cloudflare` is a production dependency and `Sentry.captureException` from a route works
   on the deployed Worker (§5.2). That is a plan decision, not a research conclusion.

Two secondary findings worth carrying: `retriable` should stay **true / unflagged** here and the
measurement supports it in a way it did not for C10X-49 (§4.3); and after this change the _last_
discarded-result Supabase mutation in `src/` is **not** in this file — it is
`src/pages/api/auth/signout.ts:7` (C10X-51), so every "that is the last of them" sentence must be
scoped to `generate.ts`'s table writes (§8.4).

## Detailed Findings

### 1. The two call sites, exactly

|                           | Site A                                                                                           | Site B                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Location                  | `src/pages/api/generate.ts:426`                                                                  | `src/pages/api/generate.ts:477`                                                                     |
| Enclosing branch          | `catch` around `generateCandidates` (`:415`) — transport failure or the 40 s abort               | `if (saved === 0)` (`:474`) — upstream answered 200, nothing survived Zod                           |
| Response                  | `:463` → `502 { error: "Nie udało się wygenerować fiszek. Spróbuj ponownie.", retriable: true }` | `:492` → `422 { error: "Model nie zwrócił poprawnych fiszek. Spróbuj ponownie.", retriable: true }` |
| Annotation naming C10X-50 | `:422-425`                                                                                       | `:475-476`                                                                                          |

Fields that differ between the two rows — **five, and no more**:

| field              | Site A (`:426`)                                                                  | Site B (`:477`)                                              |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `model`            | `resolveModel()` (`:429`)                                                        | `result.model` (`:481`)                                      |
| `generated_count`  | `0` (`:432`)                                                                     | `generated` = `result.generatedCount` (`:483`)               |
| `error_message`    | `message` — `err.message` or `"Nieznany błąd generacji"` (`:421`, `:435`)        | fixed literal `"Model nie zwrócił poprawnych kart"` (`:486`) |
| `request_payload`  | `rawRequest`, **null unless** `err instanceof OpenRouterError` (`:419`, `:436`)  | `result.rawRequest` (`:487`)                                 |
| `response_payload` | `rawResponse`, **null unless** `err instanceof OpenRouterError` (`:420`, `:437`) | `result.rawResponse` (`:488`)                                |

Identical: `user_id`, `source_text`, `language`, `requested_count`, `saved_count: 0`,
`status: "failed"`, `idempotency_key: null`.

One asymmetry the plan should not miss: at Site A **both payload columns can legitimately be
`null`** (a non-`OpenRouterError` throw), so that audit row is strictly weaker than Site B's even
when it lands.

**The `idempotency_key: null` constraint is not negotiable** and is argued in full at `:438-461`:
"Ponów" replays the same key, so a keyed `failed` row would be the row the retry collides with
(plan-review F1 of the S-05 slice). The same comment also forbids "simplifying" the partial unique
index's `status = 'succeeded'` predicate away on the strength of that NULL — the reason changed at
C10X-48, the conclusion did not.

### 2. THE CRUX — `.single()` on an INSERT has no silent zero-row arm

This is the finding most likely to be got wrong by inheritance, because both sibling tickets made
"check `data`, not just `error`" their headline rule and `lessons.md:243-248` states it as a
project-wide law.

**The rule is correctly scoped to UPDATE/DELETE + `.maybeSingle()`, and nothing in the repo claims
otherwise.** `src/lib/generations.ts:132-138` and `src/lib/decks.ts:37-42` both say _"a ZERO-ROW
update resolves `{ data: null, error: null }`"_ — about an UPDATE/DELETE whose WHERE matches
nothing, which is a legal, error-free outcome. An INSERT of one literal row has no zero-row
outcome: it inserts one row or it raises.

Four independent pieces of evidence, three of them measured:

**(a) `.single()` and `.maybeSingle()` are different mechanisms.** `.single()` sets a header —
`node_modules/@supabase/postgrest-js/dist/index.mjs:1041-1043`:

```js
single() { this.headers.set("Accept", "application/vnd.pgrst.object+json"); return this; }
```

`.maybeSingle()` sets a **client flag** (`index.mjs:1083-1086`), and that flag is the _sole_ source
of the null-with-no-error shape (`index.mjs:358-371`):

```js
if (_this2.isMaybeSingle && Array.isArray(data)) { … else data = null; }   // unreachable via .single()
```

**(b) PostgREST enforces the singular representation server-side, as an error.** Measured against
the running local stack with a zero-row filter and that Accept header:

```
HTTP/1.1 406 Not Acceptable
Proxy-Status: PostgREST; error=PGRST116
{"code":"PGRST116","message":"Cannot coerce the result to a single JSON object","details":"The result contains 0 rows"}
```

**(c) "Inserted but unreadable through the SELECT policy" is a hard `42501`, not an empty
representation — and here it is unreachable anyway.** `.select()` appends
`Prefer: return=representation` (`index.mjs:563-564`), so PostgREST issues `INSERT … RETURNING`, and
a row the SELECT policy hides fails the whole statement (measured in a rolled-back transaction:
`ERROR: 42501: new row violates row-level security policy … ExecWithCheckOptions, execMain.c:2158`).
On this table the question does not arise: `generation_session_insert`'s `WITH CHECK` and
`generation_session_select`'s `USING` are **the same predicate**, `user_id = (select auth.uid())`
(`supabase/migrations/20260712162349_generation_session.sql:66-71`, confirmed live in `pg_policy`).

**(d) The TypeScript type is a discriminated union and already narrows.**
`node_modules/@supabase/postgrest-js/dist/index.d.mts:609-621` gives
`PostgrestResponseSuccess<T> { error: null; data: T }` vs
`PostgrestResponseFailure { error: PostgrestError; data: null }`, and `:1398` types `single()` as
`PostgrestBuilder<ClientOptions, ResultOne>` — **not** `ResultOne | null` (contrast `maybeSingle()`
at `:622`, whose `data` is nullable on the success arm too — which is exactly why C10X-48/49 needed
the `data` check). Verified empirically rather than argued: `generate.ts:531-545` destructures this
same helper, returns on `sessionError`, then dereferences `session.id` at `:660`, and
`npm run typecheck` passes under `strict` + `noUncheckedIndexedAccess`. If `data` were not narrowed
that line would be `TS18047`.

**Consequence for the plan.** `if (error)` is the whole check. Writing `if (error || !data)` for
symmetry with the siblings buys nothing and costs something: it is a branch **no breakage run can
turn red**, because no reachable state produces it — the "assertion that cannot fail" class this
file's own §6.6 records against the `listDueCounts` false pass and against C10X-48's own green
breakage run. If the plan wants the symmetry it must say in writing that the second arm is
unreachable, or it will predict a red that cannot happen.

**One caveat to carry.** On a transport-level failure the `error` object may have **no `code`
field**: `index.mjs:372-386` does `error = JSON.parse(body)` and falls back to `{ message: body }`
when that throws, so a Kong 502 (whose body is Kong's own text) yields a code-less error, and a
thrown `fetch` yields `{ code: "", status: 0 }` (`index.mjs:319-332`). Do not build C10X-50's
`retriable` decision on `error.code`.

### 3. No deck undo — `createdDeckPublicId` is provably `null` at both sites

Complete trace, every occurrence:

- declared `let createdDeckPublicId: string | null = null;` — `generate.ts:313`
- **assigned exactly once** — `generate.ts:518`, inside `if (newDeckName && deckId === null)` opened
  at `:505`
- read at `:621-622` (C10X-49's undo) and `:687-688` (C10X-48's undo)
- `:395`, `:618`, `:684` are comments

Both insert sites return before `:505` is ever reached (`:463`, `:492`), so at both of them
`createdDeckPublicId` is still its initialiser. This is by design and the design says so at
`:304-313`: for a new deck the pre-LLM branch only _checks_ the name is free, because deferring
`createDeck` past the LLM call is what stops a failed generation orphaning a deck or blocking retry
with a `23505`. On the adoption path `:395-397` states it outright — "this request did not create
this deck, so the failure branches below must never delete it."

**So C10X-49's shape does not repeat**: no `deckUndone` boolean, no orphan, no hedged copy about a
leftover deck, and no `retriable: false` argument built on a deterministic 409.

One residual that is **already owned and unchanged by this ticket**: on the healed path the request
may have cleared an idempotency key at `:259-266` before the LLM call, and a death at `:426`/`:477`
forfeits that heal permanently while any pre-existing orphan deck survives. `generate.ts:344-355`
states this as a knowingly-accepted trade (C10X-48 D-10). Checking the insert result does not touch
it.

### 4. What can actually make this insert fail — and whether a repeat helps

#### 4.1 The table, measured

`generation_session` is created once (`supabase/migrations/20260712162349_generation_session.sql:21-38`)
and altered once (`20260725133600_generation_idempotency_key.sql:43-49`). Live state matches the
migrations exactly. Constraints:

```
generation_session_source_text_check | CHECK (char_length(source_text) > 0)
generation_session_status_check      | CHECK (status = ANY (ARRAY['succeeded','failed']))
generation_session_user_id_fkey      | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
generation_session_pkey / _public_id_key
generation_session_idempotency_key_uidx  -- UNIQUE (user_id, idempotency_key)
                                         --   WHERE idempotency_key IS NOT NULL AND status = 'succeeded'
```

RLS is on, four policies, all `user_id = (select auth.uid())`. Live `relacl` is
`{postgres=arwdDxtm/…, authenticated=arwdDxtm/…, service_role=arwdDxtm/…}` — `anon` absent (the
`revoke all` worked), and `authenticated` holds **all** privileges rather than the four the
migration grants, because Supabase's default privileges already gave them. That is recorded as
correct at `20260731130000_dictionary_tables_readonly.sql:40-43`: on this table RLS is the enforcer,
not the grant. **The INSERT's only gate is `generation_session_insert`'s `WITH CHECK`.**

#### 4.2 Failure causes, with codes

| #   | Cause                                                                                   | Shape                                                    | Reachable at :426/:477?                                                                                                                                                                                                          | Repeat viable?                                |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | **Kong keep-alive 502** (both idle timeouts 60 s — `tests/setup/retry-policy.ts:19,28`) | HTTP 502, error with a `message` and **no `code`**       | **Yes — the dominant realistic cause**                                                                                                                                                                                           | **Yes, transient**                            |
| 2   | `fetch` throws (network/abort)                                                          | `{ status: 0, code: "" }` (`index.mjs:319-332`)          | Yes                                                                                                                                                                                                                              | Yes, transient                                |
| 3   | PostgREST unreachable / schema cache reload                                             | 503/520                                                  | Yes                                                                                                                                                                                                                              | Yes, transient                                |
| 4   | INSERT privilege revoked                                                                | `42501` "permission denied for table"                    | Only under DCL — i.e. the manual-run state                                                                                                                                                                                       | No, until re-granted                          |
| 5   | RLS insert-policy denial                                                                | `42501` "new row violates row-level security policy"     | Effectively only if the session dies between the middleware read and this insert                                                                                                                                                 | Not for this request                          |
| 6-8 | `source_text` CHECK / `status` CHECK / NOT NULL                                         | `23514` / `23502`                                        | **Unreachable** — trimmed-and-400'd at `:206-209`; `status` hard-coded; every NOT NULL column supplied                                                                                                                           | n/a                                           |
| 9   | FK `user_id`                                                                            | `23503`                                                  | Only if the account was deleted mid-request                                                                                                                                                                                      | No                                            |
| 10  | `idempotency_key_uidx` collision                                                        | `23505`                                                  | **Structurally impossible** — the row fails **both** index predicates                                                                                                                                                            | n/a                                           |
| 11  | jsonb rejects a NUL byte in a payload column                                            | **`22P05`** (measured: `select '{"a":"\u0000"}'::jsonb`) | **Plausible and real in kind**: at `:426` `response_payload` carries the **raw upstream body**, at `:477` the model's full parsed response. That a real upstream body could carry a NUL end-to-end is inference, not measurement | Yes — a repeat gets a different upstream body |
| 12  | `generated_count` smallint overflow                                                     | `22003` (measured)                                       | **Unreachable in production** (`max_tokens = 500 + count*450` caps the response far below 32 768 cards) but **reachable in a test** that fabricates the upstream array — see §6.3                                                | n/a                                           |
| 13  | `error_message` length                                                                  | —                                                        | **No constraint at all**: `text`, nullable, no CHECK (verified live). And PostgREST carries the row in the POST **body**, so there is no 414 risk                                                                                | n/a                                           |

One mechanism worth knowing because it removes a false comfort: **postgrest-js does not retry a
POST.** `index.mjs:23-27` sets `RETRYABLE_METHODS = ["GET","HEAD","OPTIONS"]` and `:94-98` gates on
it; `:269` rethrows a POST fetch error without retry. The Kong 502 is absorbed only by the _test_
harness (`tests/setup/retry-transport.ts:159-177`), never in production.

#### 4.3 `retriable` — the measurement says true/unflagged, and it says so more cleanly than for C10X-49

C10X-48's D-08 made an **absent** flag mean retriable (`GeneratorForm.tsx:192`,
`generate.ts:98-113`); C10X-49's D-03 then shipped an explicit `retriable: false` on a 500 and
argued it, because a verbatim replay there hit a deterministic 409 on the orphan deck. **Neither
argument applies here**, and the reason is §3: nothing was written, `idempotency_key` is `null` so
there is no row to collide with, and no deck exists to make `deckNameExists` fire. A repeat re-runs
the whole request cleanly. Add that the dominant causes (#1–#3) are transient, and that both
branches already answer `retriable: true` on their happy-failure path — a failed _audit_ write must
not be **less** retriable than the failure it was auditing.

### 5. What a lost audit row costs — and who could ever witness it

#### 5.1 Nothing in `src/` reads it

All `generation_session` access goes through `src/lib/generations.ts`. Four read functions:

| function                                          | reads                                                                               | callers                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| `getGenerationSessionByPublicId` (`:32-38`)       | `id, public_id, requested_count, generated_count`                                   | `src/pages/decks/[publicId]/review.astro:6,60` |
| `findSucceededSessionByIdempotencyKey` (`:50-57`) | `id, public_id, generated_count, saved_count` — **filtered `status = 'succeeded'`** | `generate.ts:235`, `:573`                      |
| `generationResultByGenerationId` (`:67-89`)       | reads `flashcard`, not the session                                                  | `generate.ts:157`                              |
| `generationStateCounts` (`:102-113`)              | reads `flashcard`, not the session                                                  | `review.astro:104`                             |

**`status`, `error_message`, `request_payload` and `response_payload` are never read anywhere in
`src/`** — the only occurrences outside `database.types.ts` are the write sites. Three facts compound
that for the `failed` row specifically: the dedup lookup excludes it by predicate (and
`generations.ts:41-43` says why — "a `failed` row is audit, and replaying it would hand the caller
an error as if it were a result"); both sites write `idempotency_key: null`, so it is unreachable by
key even in principle; and the 502/422 responses carry no `sessionPublicId`, so its `public_id`
never reaches a client and `review.astro`'s `?generation=` scope can never name it.

**So the row is a pure write-only forensic artifact.** What its loss costs is the only record of the
pasted `source_text`, the upstream request/response payloads and the upstream error string for that
attempt — analysis, not function. Nothing in the FR-018 retry loop depends on it.

This is the structural difference from both siblings, and it is what makes "signalled" ambiguous:
C10X-48 was fixing a permanent 500 per key and C10X-49 a permanent 409 on retry, so telling the user
was telling them something actionable. Here there is nothing for the user to do that they were not
already going to do.

#### 5.2 The "only witness" sentence is no longer literally true

`generate.ts:628-632` and `:692-699` both state _"the response is the ONLY witness there is (nothing
in `src/` writes a log line and nothing here reads a log sink — test-plan §7)"_. The first half is
enforced (`tests/lib/no-logging.test.ts:102-104` scans all of `src/`). The second half has a gap the
siblings had no reason to explore:

- `@sentry/cloudflare` **10.70.0** is a **production dependency** (`package.json`), imported today
  only by `src/worker.ts:2` and as a _type_ by `src/lib/sentry-sampling.ts:1`.
- `withSentry` calls `setAsyncLocalStorageAsyncContextStrategy()` and wraps the fetch handler
  (`node_modules/@sentry/cloudflare/build/cjs/withSentry.js:18-20`), and `wrapRequestHandler` runs
  it inside `withInvocationIsolationScope` with `isolationScope.setClient(client)`
  (`build/cjs/request.js:14-21`). **So `Sentry.captureException` / `captureMessage` called from an
  Astro API route resolves the client from the async context and works on the deployed Worker.**
- Without a client it is a **safe no-op**: `@sentry/core`'s `scope.captureException` returns an
  event id after `if (!this._client) … return eventId`. So it cannot break `npm test`, where
  `src/worker.ts` never runs.
- `sampleSentryEvent` is **fail-open** for `event.logger !== "console"` (`src/lib/sentry-sampling.ts`),
  so such an event passes **unsampled**.
- No repo guard forbids it: `tests/lib/sentry-wiring.test.ts` reads **only** `src/worker.ts`
  (`:36`, `:68`), and AGENTS.md's worker carve-out is about **reading the Cloudflare `env`**, not
  about importing the SDK — "reaching for a forbidden accessor, or reading the Worker `env` from any
  other module" is what it forbids, and a capture call reads no env.
- The Sentry slice's own research anticipated exactly this: `captureConsoleIntegration` captures
  **none** of C10X-48…52, and what Sentry buys on day one includes _"a place for the C10X-48…52
  fixes to send their newly-checked errors"_
  (`context/archive/2026-08-11-sentry-monitoring/research.md:246-248`, `:377`).

**The boundary in the same breath.** Nothing in this project loads `src/worker.ts`, so **no test
layer would assert that such an event is ever emitted** — test-plan §7's C10X-54 correction states
it: _"no layer asserts that Sentry invokes `beforeSend` at all"_. A Sentry call would therefore be
evidence-free in the suite and provable only by a deployed run. That is a real cost and it is the
plan's to weigh, not research's to decide.

### 6. The evidence split — and one claim in `change.md` that is not right

#### 6.1 Both branches ARE reachable from the suite; only the failed-insert arm is not

`change.md:12` says _"no test in this suite can reach these branches (module doubles are confined to
one file, §6.9), so the reachability half will rest on a recorded manual run."_ The parenthetical is
right and the conclusion overshoots. `tests/generation/failure-path.test.ts` drives both branches
end to end today:

| case                                                   | line   | branch | what it asserts about the row                                                                                                                        |
| ------------------------------------------------------ | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `502s an upstream HTTP failure…`                       | `:204` | `:426` | `status === "failed"`, `source_text`/`request_payload`/`response_payload` contain sentinels, `error_message` non-empty (presence only), counts `0/0` |
| `502s a transport failure…`                            | `:249` | `:426` | as above **plus `error_message` CONTAINS the upstream sentinel**                                                                                     |
| `422s a model answer whose cards all fail validation…` | `:292` | `:477` | as above, **`error_message` by EQUALITY**, `generated_count > 0` + `saved_count === 0`                                                               |
| `sends the key in the header…`                         | `:332` | `:426` | whole row `not.toContain` the key; header positive control                                                                                           |

Every one goes through `sessionFor()` (`:162-172`), which asserts **exactly one** row. So the
**landed arm of both inserts is already owned by four committed cases** — a position neither sibling
had. What no layer can reach is the insert _failing_.

They are structurally unreachable from every other file: preflight hard-fails when
`OPENROUTER_API_KEY` is set (`tests/setup/preflight.ts:44-52`), so elsewhere `generateCandidates`
short-circuits to `mockCards(count)` (`src/lib/openrouter.ts:160-169`), which cannot throw and
cannot return zero cards (`COUNT_MIN = 1`).

#### 6.2 What the existing four cases tolerate

Checking the result breaks none of them, **provided**: status stays 502/422 on the insert-succeeded
arm (all four pin it); the row is still written exactly once; and the new failure copy is a
**module-local literal**. The Polish copy of the _body_ is pinned nowhere — only
`typeof payload.error === "string"` — and extra response fields are free (`GeneratorForm` casts
rather than parses). The one live trap: the raw-body assertions forbid the three sentinels
(`:225-227`, `:274-276`, `:309-311`, `:361`), so relaying `error.message` from PostgREST into the
body could turn cases 1/2/4 red — which would be the guard working, and is the same Risk #4
constraint C10X-49 respected.

#### 6.3 Can any layer force the insert to fail? Four routes, one recommendation

- **A — narrow the pass-through `fetch` double to fail the PostgREST POST.** Mechanically possible;
  **forbidden**. `failure-path.test.ts:35-36`: _"The database and RLS are NEVER doubled."_ §6.9:
  _"Module doubles live in that one file."_ C10X-48's **D-04** already declined this exact seam.
- **B — `tests/setup/retry-transport.ts`.** No. It calls through first and only _replays_; it
  fabricates nothing, by written decision (`:101-107`), and §6.9 records it as _"not precedent for a
  second module double."_
- **C — a value-driven constraint trip.** Real for Site B only: `generated_count` is
  `rawCards.length`, i.e. the length of the array in the **test-controlled** upstream body, so a
  fabricated 32 768-element array of cards that all fail Zod keeps `saved === 0`, stays on the
  `:477` branch and fails the INSERT with `22003`. It needs no double and no DDL. Site A has no
  equivalent (`generated_count: 0` is hard-coded); only the unverified NUL route remains. **The
  honest objection**: it makes the insert fail for a reason unrelated to the real-world failure mode
  (a transient round-trip), and it is unreachable in production (§4.2 #12).
- **D — DDL/DCL from inside the suite.** No, and structurally so: a tree-wide search of `tests/` for
  `docker exec`, `psql`, `alter policy`, `revoke`, `grant` returns **eleven hits, every one a comment
  or a message string**, and the only credential in the suite is the anon key, enforced by
  `assertAnonKey` (`tests/setup/preflight.ts:70`).

**The recommended route is none of those four: close the HELPER's contract with a cross-account RLS
refusal.** `generation_session_insert` is `with check (user_id = (select auth.uid()))`, so

```ts
createGenerationSession(clientFor(b.cookieHeader), { user_id: a.userId, … })
```

raises `42501` deterministically — the exact `{ data: null, error: <non-null> }` the fix branches on,
with no double, no DDL and no fabrication. `createGenerationSession` has **no caller anywhere in
`tests/`** today (seven repo hits, all in `src/`), the same gap C10X-49 found for `deleteDeck`, and
`tests/isolation/decks.test.ts:102-150` is the template. Note the arm differs from the siblings' and
should be said so: they closed a **zero-row** arm, this closes an **error** arm — because §2 says
there is no zero-row arm to close.

#### 6.4 Conventions the new cases must follow

- Home: `tests/generation/generate.test.ts` (§6.2 one-file-per-resource; §6.5; and the direct
  precedent — C10X-48 put the other two `generations.ts` helpers' cases there at `:1110`).
- **The positive control is its own `it()`.** C10X-49 measured that a control sharing the denial's
  `it()` _"never runs under the very breakage it exists to be attributed against"_ —
  `2 failed | 4 passed (6)`, the control among the cases that never executed. This corrects
  C10X-48's inline shape.
- Row-based, not return-based; own the fixture you mutate; file-level `Date.now().toString(36)`
  marker via `createScoping` (`tests/fixtures/scoping.ts:40-58`).
- **A case-scoped count oracle after every seeded insert**, never `.single()` / `.maybeSingle()` /
  `find` (`lessons.md:229-234`); `generation_session` is one of the six named silent seams
  (`tests/setup/retry-transport.ts:85-89`).
- **`succeededSessions` is the wrong reader** — it filters `status = 'succeeded'` and is blind to
  exactly the rows these two branches write. Use `allSessions` (`generate.test.ts:229-236`).
- Never `.eq("source_text", <long>)`: PostgREST answers **414** above ~8 000 characters; always
  `.like(scope(text))`.

### 7. The precedent playbook (C10X-48, C10X-49), compressed

**Fix shape.** C10X-48 changed the helper (`.select("id").maybeSingle()` added,
`failGenerationSession` → `retireGenerationSession`, key nulled in the same UPDATE — D-03) and read
both arms at the call site. C10X-49 changed **no lib at all** — `deleteDeck` already ended
`.maybeSingle()` — and the whole defect was the discarded pair at one call site; it introduced
`deckUndone`, defaulting to `true` because _"an undo that never ran has not failed"_, and replaced
`sessionFailure` wholesale rather than appending. **C10X-50 needs neither**: `createGenerationSession`
already ends `.select(...).single()`, so no lib change, and there is no companion write to gate on.

**`retriable`.** C10X-48 D-08: absent means retriable, measured (2 of 20 `return json(...)` sites
carried the flag; the handler now has **26**, so that figure is stale wherever it is quoted).
C10X-49 D-03: an explicit `false` on a 500, argued rather than inherited, because a verbatim replay
was a deterministic 409 — with the consequence written down that _"with no button the copy is the
user's ONLY route out, so a future edit that shortens the copy must move the flag back in the same
commit."_ §4.3 says C10X-50 lands on the other side.

**Manual run — C10X-49's is the better template.** Its shape, in order: record the environment
_before the first revoke_ (local `SUPABASE_URL`, cloud creds parked under `PROD_`, **no
`.dev.vars`**, `OPENROUTER_API_KEY` unset, mock-mode banner confirmed in the browser); create a
**fresh throwaway account through the real sign-up form** (never the e2e harness account, because
the run leaves artifacts behind); dump `information_schema.role_table_grants` for the tables it will
touch **plus one untouched sibling** as the later `relacl` control; issue **two** revokes with a
written "either alone reproduces nothing"; drive the real app in a browser and capture the wire
separately; read the oracle directly in psql; run a **control differing in exactly one privilege**
with a fresh name and key; restore and verify with **four** oracles (the same `information_schema`
projection line-for-line, raw `pg_class.relacl` byte-identical against the untouched sibling,
`has_table_privilege` = `t`, and the full suite green). C10X-48 had **no control run**, and
C10X-49's plan-review F3 is what forced one — _"a message that fires on every failure is
indistinguishable from one that fires on the right failure."_

For C10X-50 the analogous provocation is **`revoke insert on public.generation_session from
authenticated`** — C10X-49's _first_ of two — combined with whatever forces the branch. For Site A
that is a **bogus `OPENROUTER_API_KEY` in `.env`** (C10X-48's own recorded provocation, which yields
`OpenRouter HTTP 401` and a `model` without the `(mock)` suffix as proof a real call was attempted).
**Site B has never been provoked by either sibling** — C10X-48 records the 422 as not driven,
"forcing it needs a seam D-04 deliberately withholds" — and it is not steerable from `.env`, because
the model would have to return cards that all fail Zod. The one honest option for Site B is
C10X-48's _other_ method: a **temporary spec** that reuses `failure-path.test.ts`'s double to queue
an invalid-cards body, run once with the grant revoked and the rest of the suite not running, then
deleted (C10X-48's reachability run did exactly this, twice, the second time with
`--disable-console-intercept` because Vitest's `agent` reporter swallowed the first run's output).

**Breakage runs.** C10X-48 ran five, of which **one came back green** (a finding, not a pass — _"a
breakage run that stays green is a claim about the EDIT before it is a claim about the guard"_) and
**one falsified its own prediction** (the confirmation asserts a row was **matched**, never that the
key is **gone**). C10X-49 ran one, two reds across two layers, both predicted by name, **both
positive controls green** — read from a `--reporter=verbose` run "because the default reporter names
only failures."

**Doc-sync rule.** `lessons.md:236-241`: read the **section heading and preamble**, not the line; a
dated section takes an appended dated correction, overwriting is only for live declarations.
C10X-49 sharpened it — resolve each target by walking up to its enclosing heading with `awk`,
because the plan's line numbers will have moved. Prettier discipline: run the idempotency probe on
**copies in a scratchpad**, never on the live files, and pass `--config ./.prettierrc.json` from the
repo root (prettier resolves `plugins` relative to the config's directory).

### 8. Blast radius

#### 8.1 In-code

- The two annotations (`generate.ts:422-425`, `:475-476`) go away.
- **The file's own invariant sentence must be updated, not duplicated** — `generate.ts:609-611`:
  _"The exceptions left in this file are the two failure-path `createGenerationSession` inserts,
  owned by C10X-50."_ C10X-49's research raised this as its Open Question 5.
- `idempotency_key: null` and the index-predicate warning at `:438-461` / `:489-490` stay untouched.
- A new message is an **inline literal at the return site**, never a `REDIRECT_MESSAGES` member —
  `src/lib/redirect-errors.ts:78-95` is explicit ("share the constant, not the membership"), the set
  is size-pinned at 11, and both sibling branches say so at their own sites (`:628-632`, `:703-705`).

#### 8.2 Documents asserting C10X-50 ownership (six sites, split by kind)

| site                                                            | kind     | treatment                                                                                              |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `test-plan.md:13` (header block)                                | **live** | demote to "Previously:", write C10X-50's own block                                                     |
| `test-plan.md:1775` (§6.6, inside C10X-48's dated note)         | dated    | dated correction                                                                                       |
| `test-plan.md:1785` (C10X-49's dated correction to it)          | dated    | a **third** dated line — the file has no precedent for a correction-to-a-correction                    |
| `test-plan.md:1793` (§6.6, C10X-49's note)                      | dated    | dated correction                                                                                       |
| `test-plan.md:5348`, `:5358` (§8, C10X-48's ledger entry)       | dated    | dated correction                                                                                       |
| `test-plan.md:5456` (§8, C10X-49's entry)                       | live-ish | dated correction — **and note it pins the literal line numbers `:426` / `:477`, which this fix moves** |
| `roadmap.md:439` (H-17 `Parallel with:`, `Status: in progress`) | live     | edit                                                                                                   |
| `roadmap.md:427` (H-16, `Status: done`)                         | dated    | leave untouched, as C10X-49 did                                                                        |

Plus a **new §8 ledger entry**, and §6.5's `saved_count` bullet **checked and left alone** — every
clause in it is about `retireGenerationSession`, so the non-edit should be recorded rather than
hunted for later.

Two claims worth checking rather than assuming: §2's Risk #4 row and §3's table should not move (a
failed audit write is not a new leak scenario), matching both siblings' "no risk row moves".

#### 8.3 Bookkeeping

- `roadmap.md` has **no C10X-50 row**; the table ends at H-17, so it is **H-18**, opened **during
  implementation at `Status: in progress`** — the H-15/H-16/H-17 practice, which exists because a
  change archiving without a row has vanished from the roadmap four times (H-04, H-07, H-08, H-13).
  `/10x-archive` owns the Status → done flip, matching on `Change ID`.
- `jira-map.md:157` still carries `Change ID: — (jeszcze nie nadany)` for C10X-50. That file is
  owned by the Jira skills (`:3-4`) and must not be hand-edited. Jira C10X-50 is already
  **W toku**, epic **C10X-12 AI Generation**, component `generation`, Fix Version Post-MVP, Priority
  Low, label `audit-swallowed-errors`; `customfield_10041` is `/jira-finish-work`'s to fill.
- The Jira description's line numbers (277-301, 314-328) are stale — `change.md:12` already records
  the correction to `:426` / `:477`.

#### 8.4 The "last of them" wording is a trap already half-set

`test-plan.md:5456` says _"with this change closed, that is the last of them"_. Scoped to
`generate.ts`'s table writes that is true. Scoped to `src/` it is **false**:
`src/pages/api/auth/signout.ts:7` awaits `supabase.auth.signOut()` and discards its `{ error }`,
then redirects to `/` unconditionally — a failed sign-out presents as a successful one. That is
**C10X-51**, from the same audit. A sweep of every `.insert/.update/.delete/.upsert/.rpc` call site
in `src/` confirms that after C10X-50 it is the only remaining discarded-result Supabase mutation.
Whatever sentence this change writes must carve it out explicitly.

## Code References

- `src/pages/api/generate.ts:426`, `:477` — the two swallowed inserts; `:422-425`, `:475-476` — their C10X-50 annotations
- `src/pages/api/generate.ts:463`, `:492` — the 502 / 422 responses that must stay retriable
- `src/pages/api/generate.ts:313`, `:518`, `:505` — `createdDeckPublicId`: declaration, sole assignment, enclosing guard
- `src/pages/api/generate.ts:438-461` — the `idempotency_key: null` decision and the index-predicate warning
- `src/pages/api/generate.ts:98-113` — the `retriable` convention docblock (C10X-48 D-08)
- `src/pages/api/generate.ts:609-611` — the invariant sentence C10X-50 must update, not duplicate
- `src/pages/api/generate.ts:620-657`, `:677-710` — C10X-49's and C10X-48's checked-write shapes
- `src/lib/generations.ts:23-25` — `createGenerationSession`; `:132-138`, `:148-174` — the two `.maybeSingle()` helpers and why their rule is theirs
- `src/lib/decks.ts:37-42` — the `.select().maybeSingle()` precedent `lessons.md` names
- `src/lib/redirect-errors.ts:78-95` — "share the constant, not the membership"
- `src/components/generate/GeneratorForm.tsx:192`, `:371`, `:136-140`, `:223-225` — `retriable` read, "Ponów" gate, `lastPayload` replay
- `src/components/auth/ServerError.tsx:44-50` — the banner; no truncation, `role="alert"`
- `src/worker.ts:2`, `src/lib/sentry-sampling.ts` — the only Sentry surfaces in `src/`
- `supabase/migrations/20260712162349_generation_session.sql:21-38`, `:58-74` — table, RLS, grants
- `supabase/migrations/20260725133600_generation_idempotency_key.sql:43-49` — the partial unique index
- `tests/generation/failure-path.test.ts:13-46` (the confinement rule), `:162-172` (`sessionFor`), `:204`, `:249`, `:292`, `:332`
- `tests/generation/generate.test.ts:229-236` (`allSessions`), `:208-228` (why `succeededSessions` is blind), `:1110-1160` (the sibling helpers' contract cases)
- `tests/isolation/decks.test.ts:102-150` — the template: denial `it()` + its own control `it()`
- `tests/setup/preflight.ts:44-52`, `:70` — the mock clamp and the anon-key assertion
- `tests/setup/retry-transport.ts:85-89`, `:101-107` — the six silent seams; the narrow predicate
- `tests/lib/no-logging.test.ts:102-104`, `tests/lib/sentry-wiring.test.ts:36,68` — the two guards that bound §5
- `context/foundation/lessons.md:229-234`, `:236-241`, `:243-248` — the three rules this ticket sits inside

## Architecture Insights

- **A project-wide rule can be right and still not transfer.** `lessons.md:243-248` is scoped to
  compensating **UPDATE/DELETE** writes and their `.maybeSingle()` helpers, and it is correct there.
  The temptation for the third ticket in a series is to apply the series' headline verbatim; here
  that would add an arm nothing can reach. The discriminator is not "is it a write" but "does the
  statement have a legal zero-row outcome".
- **Three sites, one class, three different fixes.** C10X-48 changed the helper and the call site;
  C10X-49 changed only the call site; C10X-50 changes only the call site _and_ has no companion
  write to gate on. The class ("a discarded result") is stable; the remedy is not.
- **This is the first of the three where the loss is invisible to the user.** Both siblings could
  route their new signal through the response body because the user was already stuck. Here the
  response is the wrong channel by default — the user is unaffected — which is what surfaces the
  observability question the Sentry slice explicitly parked for these tickets.
- **The suite's coverage is inverted relative to the siblings.** C10X-48's poisoned row and
  C10X-49's branch were unreachable; here the _branches_ are covered and only the _failure of the
  write inside them_ is not. That is a better starting position and it should be stated as such
  rather than inherited as "no test can reach this".
- **`.single()` vs `.maybeSingle()` is a real semantic boundary in this codebase**, not a style
  choice: the first negotiates a singular representation with PostgREST (errors on zero rows), the
  second coerces client-side (nulls on zero rows). Three `.single()` call sites in `src/` check
  `error` alone and that is right.

## Historical Context (from prior changes)

- `context/archive/2026-08-12-bug-generation-compensation-swallowed/` (C10X-48) — the checked
  compensation, the heal, D-04 (no fabricating seam, no DDL in the suite), D-05 (no cloud backfill),
  D-07 (the heal clears only the key), D-08 (absent means retriable), and the impl-review finding
  (F5) that put the two annotations at the C10X-50 sites in the first place.
- `context/archive/2026-08-13-bug-generation-deck-undo-swallowed/` (C10X-49) — the checked deck
  undo, D-03 (an argued `retriable: false`), D-05 (the evidence split), D-06 (the control must be
  its own `it()`), and the manual-run template with its control run and four restore oracles. Its
  research Open Question 5 is a direct instruction to this ticket.
- `context/archive/2026-08-11-sentry-monitoring/research.md:233-248`, `:377` — the swallowed-error
  audit's five findings (C10X-48…52) with their sites, the measurement that
  `captureConsoleIntegration` captures **none** of them, and the note that Sentry is _"a place for
  the C10X-48…52 fixes to send their newly-checked errors"_.
- `context/archive/2026-08-12-remove-sentry-probe/` (C10X-54) — why nothing in this project asserts
  that Sentry invokes `beforeSend`, which bounds any Sentry-based option here.
- `context/archive/2026-08-01-local-stack-transport-flake/` (C10X-39) — the Kong keep-alive 502 that
  is the dominant realistic cause in §4.2, and the six-silent-seam census behind the count-oracle
  rule.

## Related Research

- `context/archive/2026-08-12-bug-generation-compensation-swallowed/research.md` — the five-site
  swallow census this ticket is item #3 of
- `context/archive/2026-08-13-bug-generation-deck-undo-swallowed/research.md` — the sibling's
  unreachability-as-an-identity argument and its `retriable` trace
- `context/foundation/test-plan.md` §6.5, §6.6 (C10X-28 / C10X-48 / C10X-49 entries), §6.9, §7, §8

## Open Questions

1. **What does "signalled" mean, given the loss is invisible to the user (§5)?** Three shapes, and
   they are not exclusive: (a) a distinct response body on the failed-audit arm, as both siblings
   did — cheap, consistent, and arguably noise, since the user's situation is unchanged; (b) a
   `Sentry.captureException` / `captureMessage`, which is the only channel that actually reaches an
   owner, works on the deployed Worker, is a no-op in tests, and is what the Sentry slice parked for
   these tickets — but is asserted by no layer here; (c) both. This is the ticket's central
   decision and it should be a numbered D-xx with its cost written down, not inherited.
2. **Does the 502/422 status change on the failed-audit arm?** Recommendation from research: **no** —
   the primary failure is the generation, the audit write is secondary, and all four existing cases
   pin the status. But if (a) above is chosen, the plan must say whether one literal covers both
   sites or each gets its own (Site A's row is strictly weaker — both payload columns can be null).
3. **`if (error)` alone, or `if (error || !data)` for symmetry?** §2 says the second arm is
   unreachable. If the plan wants it anyway, it must declare it unfalsifiable in writing rather than
   predict a red for it.
4. **Is Site B (422) in scope for manual evidence at all?** Neither sibling ever provoked it, and it
   is not steerable from `.env`. The only honest route is C10X-48's temporary-spec method with the
   grant revoked (§7) — or an explicit decision that Site A's run stands for both, with the
   asymmetry recorded.
5. **Does the new committed test target the helper only, or also add a response-shape case?** The
   helper contract (§6.3, cross-account `42501`) is the deterministic part; a `failure-path.test.ts`
   case can only ever exercise the _landed_ arm, which four cases already do.
6. **Scope of `signout.ts`.** Out of scope (it is C10X-51), but every "last of them" sentence this
   change writes must carve it out — §8.4.
7. **Does this ticket also close the `:568-570` pointer** C10X-49's impl-review F2 left ("hoisting
   the undo above this block … belongs to its own ticket")? Research says no — it is a different
   branch and a different defect — but the plan should say so rather than leave it ambiguous.
