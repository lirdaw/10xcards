# Follow-up — the transient `createDeck` failure in CI run #66 (Defect B)

> **Status**: open, unattributed, **not reproduced**. To be ticketed via `/jira-backlog-sync`.
> **Raised by**: C10X-47 `dev-db-test-data-debt`, research §4 Defect B, 2026-08-14.
> **Read this before opening the ticket**: the expected outcome of the experiment below is a
> **non-reproduction**, and that is stated up front so nobody reads a quiet loop as a fix.

C10X-47 was chartered to say whether the `tests/validation/decks.test.ts` red under a random
shuffle seed was accumulation or the C10X-39 Kong keep-alive flake. The answer is **neither**, and
it is two defects rather than one. Defect A — a cross-file deck-name collision — was reproduced at
3/92 and fixed inside that change. **Defect B is this file**: a single-request transient on
`POST /rest/v1/deck`, seen exactly once, on a database that was two minutes old.

This document is written to be self-contained. A reader who has never opened C10X-47's research
can run the experiment in §6 from it alone.

---

## 1. The observation, verbatim

CI run **#66**, workflow `ci.yml`, head `5f3c87e`, 2026-08-05. `gh run list` reports it as
**`success`** — it is **`run_attempt: 2`**, and a re-run overwrites the visible conclusion, which
is why this never reached any document until C10X-47 went looking. Attempt 1 (run id
`31030491078`):

```
Running tests with seed "1785951361767"
FAIL tests/validation/decks.test.ts > POST /api/decks/[publicId] enforces the same rules on rename
AssertionError: expected '/decks?error=Nie%20uda%C5%82o%20si%C4…' to be '/decks'
Received: "/decks?error=Nie%20uda%C5%82o%20si%C4%99%20utworzy%C4%87%20talii&open=create"
 ❯ createDeck tests/validation/decks.test.ts:175:44
 ❯ tests/validation/decks.test.ts:374:20
Test Files  1 failed | 30 passed (31)
      Tests  361 passed | 6 skipped (367)
```

## 2. Five facts, none of which was on record before C10X-47

1. **No test failed.** It is a `beforeAll` (suite) failure — `tests/validation/decks.test.ts:374`
   is inside the rename describe's setup, and the "6 skipped" are that describe's six `it()`s.
   A run that reports `361 passed | 6 skipped` and a red file is this shape, not an assertion.
2. **The message is the GENERIC one.** `DECK_CREATE_FAILED_MESSAGE`
   ("Nie udało się utworzyć talii"), **not** `DECK_NAME_TAKEN_MESSAGE`. That distinction does
   most of the work in §4 and it is the single most load-bearing fact here.
3. **It is a single-request transient.** `createDeck` succeeded ≥3 times in the same file, in the
   same worker, within the same ~500 ms immediately before failing once.
4. **Accumulation is refuted structurally, not by argument.** `.github/workflows/ci.yml` runs
   `npx supabase start` on a fresh GitHub-hosted runner every job, with no cache, volume or
   restore. The stack had been created ~2 minutes earlier and `deck` held **zero** rows. Whatever
   this is, it is not the row-count condition C10X-47 exists to repay.
5. **`npm run db:kong` ran and SUCCEEDED in that attempt**, reporting `pool_size = 0`, and it had
   **recreated the Kong container at 17:35:46–57 with the suite starting at 17:36:02** — about
   five seconds later.

## 3. What it is not: accumulation

Fact 4 settles it. There is nothing to say beyond it, and it is recorded as its own heading so a
future reader does not re-derive it from the row counts in C10X-47's research.

## 4. What it is probably not: the Kong keep-alive 502

Three independent grounds, any one of which would be suggestive and which together are why this
was split out of C10X-47 rather than folded into C10X-39's story:

1. **No socket could have been stale.** The flake needs a pooled Kong→PostgREST socket to reach
   ~60 s of idleness (C10X-39 measured both sides' idle timeout at 60 s). The pool size was **0**
   and the container was **six seconds old** (fact 5). There was no pooled socket at all.
2. **A genuine keep-alive 502 would have been REPLAYED.** The endpoint's Supabase calls do
   traverse the wrapped `globalThis.fetch` — verified through `supabase-js` → `postgrest-js` →
   `tests/setup/retry-transport.ts` — and the wrapper replays a local `502` carrying Kong's
   wording up to twice. So the failure would have had to survive three attempts to reach the
   assertion.
3. **The message would have been the wrong one.** If a replay HAD landed on an insert that
   already committed, the second insert trips `deck_user_name_unique`, `createDeck` returns
   `23505`, and `src/pages/api/decks/index.ts:73` maps that to `DECK_NAME_TAKEN_MESSAGE`. The
   observed message is the generic one (fact 2), so the "replay hit a committed write" story is
   ruled out by the copy the user saw.

## 5. What the evidence favours, and the asymmetry behind it

**A third family C10X-47's charter does not name: an unabsorbed, non-keep-alive gateway or
transport failure on the single `POST /rest/v1/deck`.**

The retry wrapper is much narrower than "retries transport failures", and every clause was read
off the source rather than inferred:

| Layer                                | What it covers                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `tests/setup/retry-policy.ts:28`     | `RETRYABLE_STATUS = 502` — the **only** status it will ever replay                |
| `tests/setup/retry-policy.ts:19`     | the body must contain `An invalid response was received from the upstream server` |
| `tests/setup/retry-policy.ts:36`     | the URL's hostname must be `127.0.0.1` or `localhost`                             |
| `tests/setup/retry-policy.ts:53`     | the body must be replayable (not a `Request`; `undefined`, `null` or a `string`)  |
| `tests/setup/retry-transport.ts:160` | `let response = await passthrough(input, init);` — **outside any `try`**          |

That last row is the gap that matters. There is no `try` around either `passthrough` call, so a
**rejected** `fetch` — a socket reset, a DNS failure, a connection refused — is not retried at
all; it propagates. And a `502` whose body carries different wording (or a `503`, or a `504`) is
handed straight back by the two conjunction clauses above.

**Retry coverage in this stack is deeply asymmetric, and that is the general form.** A GET has
three independent layers — Kong's own idempotent upstream retry, postgrest-js's
`RETRYABLE_METHODS`, and this wrapper. A POST has exactly **one**, keyed to a single status and a
single body string. Every transport-shaped defect this project has recorded surfaced on a POST,
and this is why.

## 6. Why the mechanism cannot be narrowed from outside, and the experiment that would

**Three sites in `src/pages/api/decks/index.ts` emit the identical string, and nothing
distinguishes them from a test, a log, or a browser:**

| Line  | Condition                                                       |
| ----- | --------------------------------------------------------------- |
| `:47` | `context.request.formData()` threw                              |
| `:63` | `deckNameExists(...)` returned an error                         |
| `:74` | `createDeck(...)` returned an error whose `code` is not `23505` |

All three redirect with `DECK_CREATE_FAILED_MESSAGE`, and `src/` writes no console output at all
(guarded by `tests/lib/no-logging.test.ts`). **No amount of log reading can narrow this further** —
that is a property of the code, not of the evidence that happened to survive.

### The marker experiment

**Temporary, local, never committed.** Add a marker to each of the three sites carrying the site
id plus the PostgREST `status` and `code` — e.g. append `&_m=47`, `&_m=63:<status>:<code>`,
`&_m=74:<code>` to the redirect URL, or write the same triple to a scratch file. It must not be a
`console.*` (that guard is fail-closed and the run would go red for the wrong reason), and it must
not enter the `?error=` **message**, which is a closed set enforced by
`tests/lib/form-endpoint-guards.test.ts`.

Then loop `npx vitest run tests/validation/decks.test.ts` in **two arms differing in exactly one
variable**:

| Arm | Kong state                                           |
| --- | ---------------------------------------------------- |
| A   | stock pool (`npx supabase start`, `db:kong` NOT run) |
| B   | `npm run db:kong` applied (`pool_size = 0`)          |

**Independent oracle**, on every iteration, so a keep-alive drop is attributed by Kong's own log
rather than by the test's colour:

```
docker logs supabase_kong_10x-astro-starter 2>&1 | grep -c "prematurely closed"
```

Capture per iteration: seed, exit code, the marker (if any), and the drop delta.

### The expected outcome, stated before the run

**A non-reproduction.** This fired **once in 87 CI runs** and has never been seen locally on
record. A quiet loop is therefore the likely result and it is **informative rather than a
failure**: it bounds the rate and it leaves the marker instrumentation as the thing that pays off
the day it fires again. Do not read a green matrix as "fixed", and do not widen the retry policy
on the strength of one.

## 7. Scope note — why this is its own ticket

The likely fix is **widening the retry policy** (covering a rejected `fetch`, or more statuses, or
more wordings). That is a change to harness semantics with veto power over a failing response —
widen it and the suite goes quiet rather than red, which is the exact hazard
`tests/setup/retry-policy.ts`'s own header names. It deserves its own review, its own falsifiable
cases in `tests/lib/retry-transport.test.ts`, and its own decision about the three
generic-message sites (splitting them permanently is a separate, arguably better fix that costs
three new members in the `?error=` closed set).

## 8. Sources

- `context/changes/dev-db-test-data-debt/research.md` §4 Defect B and Open Questions #1 — the
  original analysis, with the Actions-API queries behind facts 1–5
- `context/archive/2026-08-01-local-stack-transport-flake/research.md` — the keep-alive flake's
  measured properties, and (as corrected on 2026-08-15) the CI-immunity claim run #66 falsifies
- `src/pages/api/decks/index.ts:47,63,74` — the three indistinguishable sites
- `tests/setup/retry-policy.ts` · `tests/setup/retry-transport.ts:160` — what the wrapper absorbs
  and what it does not
