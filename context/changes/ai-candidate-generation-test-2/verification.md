# Verification record — C10X-28 / C10X-34 / C10X-30

> Written incrementally, one section per phase, as each phase's checks are run — not
> reconstructed at the end. Plan Phase 6 §1 owns the finished document; this file exists from
> Phase 1 so no observed output has to be remembered.
>
> Every deliberate-breakage entry records: the edit made, the **observed** failure string, the
> red/green split with its denominator, and the verified restore. A count with no run behind it
> is worse than no count — see `test-plan.md` §6.6, where two-day-old figures were already stale.

Environment for every run below unless stated otherwise: local Supabase stack up,
`OPENROUTER_API_KEY` unset, branch `C10X-28-ai-candidate-generation-test-2`.

## Phase 1 — auth error copy (C10X-34)

### Automated

| Check | Command | Result |
| --- | --- | --- |
| 1.1 Lint | `npm run lint` | clean (only the pre-existing `astro-eslint-parser` `projectService` notices) |
| 1.2 Full suite | `npm test` | **148 passed / 148, 12 files** (was 115/11 before this phase; the file adds 33) |
| 1.3 New file alone | `npx vitest run tests/auth/errors.test.ts` | **33 passed / 33** |
| 1.4 Stryker on the mapper | `npx stryker run --mutate "src/lib/auth-errors.ts"` | **93.33%** — 42 killed, 3 survived, 0 no-coverage |

**The Stryker run's three survivors are equivalent mutants, and each was checked rather than
assumed.** None of them changes which class a code maps to, which is the criterion Phase 1 sets.

| Survivor | Why it is equivalent |
| --- | --- |
| `status !== undefined && status >= SERVER_ERROR_FLOOR` → `true && …` | `undefined >= 500` evaluates to `false` (NaN comparison), so the guard's removal cannot change the branch taken. The guard exists for TypeScript, not for the runtime. Verified: `node -e "console.log(undefined >= 500)"` → `false` |
| `error.code === undefined ? undefined : MESSAGE_BY_CODE[error.code]` → `false ? …` | `MESSAGE_BY_CODE[undefined]` looks up the property name `"undefined"`, which the table does not carry, so the value is `undefined` either way. Verified: `node -e "const M={a:'x'}; console.log(M[undefined], ('undefined' in M))"` → `undefined false` |
| the same mutant on `MESSAGE_BY_NAME` | identical reasoning; same table shape |

**One assertion was added because of this run**, not to raise the score for its own sake: the
first pass scored 86.67% with three `StringLiteral -> ""` survivors on `AUTH_UNAVAILABLE_MESSAGE`,
`AUTH_GENERIC_MESSAGE` and `AUTH_NETWORK_MESSAGE`. Those three are the constants no case compares
against a literal — a test asserting `toBe(AUTH_GENERIC_MESSAGE)` mutates on **both** sides at
once and stays green. An empty constant is a real user-visible defect (`ServerError.tsx:8`
renders nothing for a falsy message, so a failed sign-in would show no reason at all), so the
test now walks the exported closed set and asserts every member is non-empty. That is
well-formedness, not copy: no test in this file pins a single word of Polish.

### 1.7 Deliberate-breakage check

**Edit**: in `src/lib/auth-errors.ts`, repoint one key of `MESSAGE_BY_CODE` —
`user_banned: AUTH_USER_BANNED_MESSAGE` → `user_banned: AUTH_INVALID_CREDENTIALS_MESSAGE`.

**Observed**: `npx vitest run tests/auth/errors.test.ts` → **exactly 1 of 33 red**, and it is the
matching class:

```
FAIL  tests/auth/errors.test.ts > authErrorMessage — code chain > maps user_banned to its own constant
AssertionError: expected 'Nieprawidłowy e-mail lub hasło.' to be 'To konto zostało zablokowane.'
```

That split is the point: the other 32 cases — including the eleven sibling code mappings and the
distinctness check — stayed green, so the red one observes **that key** rather than an incidental
property of the table. Note what did **not** fire: "keeps the distinct code classes distinct"
compares the constants directly, not the mapping, so it is blind to a repointed key by
construction. Only the per-code case catches this.

**Restore**: key reverted; `npx vitest run tests/auth/errors.test.ts` → 33/33 green;
`git status --porcelain src/` shows only the phase's three intended paths
(`signin.ts`, `signup.ts` modified, `auth-errors.ts` new). No breakage edit was committed.

### 1.5 / 1.6 Manual checks — run in a real browser against `npm run dev`

Dev server on `http://localhost:4326` (4321-4325 were already taken by other running servers).

**1.5 — wrong password.** Signed out, `/auth/signin`, submitted
`leak-probe-manual@example.com` with a wrong password. The address bar became:

```
/auth/signin?error=Nieprawid%C5%82owy%20e-mail%20lub%20has%C5%82o.
```

i.e. `AUTH_INVALID_CREDENTIALS_MESSAGE` and nothing else — **the submitted address does not
appear in the URL**, which is the whole point of the phase. The form rendered "Nieprawidłowy
e-mail lub hasło." inside the card. Before this change the same submit produced
`?error=Invalid+login+credentials`.

**1.6 — already-registered address.** `dup-probe-c10x34@example.com` was registered through the
UI (redirect to `/auth/confirm-email`, "Registration successful"), then submitted again on
`/auth/signup`. Result:

```
/auth/signup?error=Konto%20z%20tym%20adresem%20e-mail%20ju%C5%BC%20istnieje.%20Zaloguj%20si%C4%99.
```

rendered as "Konto z tym adresem e-mail już istnieje. Zaloguj się." — its own constant, **not**
the generic fallback, which is what the check asks for. Confirmed independently at the endpoint,
because the browser read raced the redirect twice and read the pre-redirect URL:

```
$ curl -s -i -X POST http://localhost:4326/api/auth/signup \
    -H "Origin: http://localhost:4326" \
    -F "email=dup-probe-c10x34@example.com" -F "password=probe-passw0rd"
HTTP/1.1 302 Found
location: /auth/signup?error=Konto%20z%20tym%20adresem%20e-mail%20ju%C5%BC%20istnieje.%20Zaloguj%20si%C4%99.
```

Two notes for whoever repeats this. The `Origin` header is **required** — Astro's dev server
answers a form POST without it with `403 Cross-site POST form submissions are forbidden`, which
looks like an auth failure and is not. And 1.6 is reachable **locally only**:
`supabase/config.toml:209` sets `enable_confirmations = false`; with confirmations on (the
production default) GoTrue answers 200 with an obfuscated user and no error at all, so
`signup.ts:15` is never entered. That is anti-enumeration behaviour in the server, not something
the mapper can change — do not treat its absence in production as a regression.

Left behind on the local dev DB, deliberately: the one `dup-probe-c10x34@example.com` row
(`auth.users`, verified exactly 1 row). Harmless, and re-running 1.6 needs an already-registered
address anyway.

## Phase 2 — cross-account isolation of the audit columns (C10X-28)

### Automated

| Check | Command | Result |
| --- | --- | --- |
| 2.2 File alone | `npx vitest run tests/review/candidates.test.ts` | **20 passed / 20** (was 16; this phase adds 4) |
| 2.1 Full suite | `npm test` | **152 passed / 152, 12 files** (was 148/12 after Phase 1) |

The seed helper `seedGenerationSession` gained an optional `audit` argument
(`status`, `requestPayload`, `responsePayload`, `errorMessage`); all four pre-existing call
sites (`:402`, `:407`, `:490`, `:529` in the pre-edit file) pass three arguments and are
unchanged. `status` was added beyond the plan's three columns on purpose: `error_message` on a
`succeeded` row is a shape production never writes, and the failure path is what fills these
columns.

### The breakage checks did not split the way the plan assumed — read this before re-running

The plan writes 2.3 and 2.4 as two independent single-policy neuters. **2.4 as written does not
reproduce.** Neutering `generation_session_update` alone leaves the suite fully green
(**20/20**), because Postgres applies the **SELECT** policy to an UPDATE whose `WHERE` reads a
column — and B's update is addressed `.eq("public_id", …)`. The restrictive select policy hides
the row, so the UPDATE matches nothing and the denial passes for a reason that has nothing to do
with the update policy.

This is exactly the trap `test-plan.md` §6.8 records for S-05 (`deck_select` + `flashcard_update`
were not enough; `flashcard_select` had to go too), one table over. The checks below therefore
neuter **select + the write policy together**, which is what makes the write half observable.
Recorded rather than smoothed over: as written, the write denials are *backstopped* by the read
policy, and only the pairwise neuter shows they also observe their own.

### 2.3 — `generation_session_select` neutered

**Edit**: `alter policy generation_session_select on generation_session using (true);`

**Observed**: **exactly 2 of 20 red**, and the first one is the leak itself — B read A's pasted
source text out of two columns at once:

```
FAIL … > account B is denied account A's generation-session audit columns
       > returns none of the four private columns to B, while A reads every one of them
AssertionError: expected { …(4) } to be null
+ {
+   "error_message": "Audit upstream failure ms22qm9y",
+   "request_payload": { "messages": [ { "content": "Audit private source ms22qm9y", … } ] },
+   "response_payload": { "error": { "message": "Audit upstream failure ms22qm9y" } },
+   "source_text": "Audit private source ms22qm9y",
+ }
```

The second red is the pre-existing `returns no session for another account's public_id` — a
genuine knock-on, same policy. The write and delete denials **stayed green**, which is the split
that proves the read assertion observes the read policy and nothing else.

### 2.4 — `generation_session_update` neutered (with `_select` also open)

**Edit**: `alter policy generation_session_update … using (true) with check (true);` plus the
2.3 neuter still in place.

**Observed**: **3 of 20 red** — the two above, plus B genuinely rewriting A's audit row:

```
FAIL … > refuses B's overwrite of the audit columns and leaves A's row byte-identical
AssertionError: expected [ { id: 100536, …(14) } ] to deeply equal []
+ [ { "source_text": "Overwritten by B ms22r46j",
+     "error_message": "Overwritten by B ms22r46j",
+     "request_payload": { "messages": [] }, "response_payload": null, … } ]
```

The `RETURNING` set is what caught it (`.select()` after `.update()`, per `lessons.md`). The
delete denial stayed green — separate policy, untouched.

### 2.4b — `generation_session_delete` neutered (with `_select` also open)

Not in the plan's row list; run because the delete denial is an assertion this phase adds and an
unobserved assertion is not evidence. Update restored first.

**Observed**: **4 of 20 red** — the two read knock-ons, the delete denial itself, and the
positive control as a second-order knock-on (B had deleted the row, so A's own update then
matched nothing):

```
FAIL … > refuses B's delete of A's session and leaves the row in place
FAIL … > still lets A rewrite A's own audit columns
AssertionError: expected [] to deeply equal [ { …(2) } ]
```

The write denial stayed green throughout, so the two write assertions are not each other's
knock-on.

### 2.5 — restore verified, not assumed

`policyname, cmd, qual, with_check` dumped from `pg_policies` **before** the first neuter and
again after the last restore; `Compare-Object` over the two dumps → **DIFF EMPTY**. Final state:

```
generation_session_delete|DELETE|(user_id = ( SELECT auth.uid() AS uid))|
generation_session_insert|INSERT||(user_id = ( SELECT auth.uid() AS uid))
generation_session_select|SELECT|(user_id = ( SELECT auth.uid() AS uid))|
generation_session_update|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))
```

Every `psql` invocation used `-c` rather than a piped heredoc, so S-05's
`docker exec`-without-`-i` silent no-op cannot occur here.

### 2.6 — after the restore

`npm test` → **152 passed / 152, 12 files**. `git status --porcelain` shows only
`context/changes/ai-candidate-generation-test-2/plan.md` and `tests/review/candidates.test.ts`
— no production file was touched by this phase at all, and no breakage edit was committed.

## Phase 3 — server-side bounds parity + single-source `SOURCE_MAX` (C10X-30)

### Automated

| Check | Command | Result |
| --- | --- | --- |
| 3.1 `astro sync` + lint | `npx astro sync && npm run lint` | types generated, lint clean (only the pre-existing `astro-eslint-parser` `projectService` notices) |
| 3.2 Build | `npm run build` | server built in 5.09 s, complete |
| 3.3 Full suite | `npm test` | **159 passed / 159, 12 files** (was 152/12 after Phase 2; this phase adds 7) |
| — file alone | `npx vitest run tests/generation/generate.test.ts` | **20 passed / 20** (was 13) |

The four constants now live in `src/lib/generation-limits.ts`, imported by both
`src/pages/api/generate.ts` and `src/components/generate/GeneratorForm.tsx`. **Why a new
module and not an existing one** is argued in its header: `flashcards.ts` would work
mechanically but is the wrong resource, and `generations.ts` is the right concern but has
never shipped to the browser. `LANGUAGES` exports **values**; the island keeps its labels in
a `Record<Language, string>`, so a language added to the lib without a label fails to
compile rather than rendering blank.

### The 414 the plan warns about — re-measured here, not inherited

The scoping rule in `tests/generation/generate.test.ts` (prefix marker + `.like()`, never
`.eq("source_text", <body>)`) rests on a measurement made during plan-review. It was re-run
against this stack rather than trusted, because the whole oracle depends on it:

```
$ curl -G "$SUPABASE_URL/rest/v1/generation_session" \
    --data-urlencode "select=id" --data-urlencode "source_text=eq.$(python -c "print('a'*N)")"
n=8000  -> HTTP 401     (reached PostgREST; refused on auth, not on length)
n=10000 -> HTTP 414
n=10001 -> HTTP 414
```

So an `.eq()` on a body at the cap is refused **by Kong, before the query runs** — a test
scoped that way would go red on `expect(error).toBeNull()` for a reason with nothing to do
with the behaviour under test. Note the ceiling sits at or below `SOURCE_MAX` itself, i.e.
exactly at the boundary this phase has to read back.

`succeededSessions` carried the same latent defect and was widened in the same edit; it had
simply never been handed a long string. The new status-agnostic `allSessions` is what the
rejection cases assert against — `succeededSessions` filters `status = 'succeeded'` and is
blind to the `failed` rows `generate.ts` writes on the 502/422 paths, so it would have been
an argument that nothing landed rather than an assertion.

**These oracles are not vacuously green.** A `.like()` pattern that matched nothing would
satisfy every "writes nothing" assertion. The boundary control uses the same `scope()` and
asserts `toHaveLength(1)`, and the six pre-existing dedup cases assert 1 and 2 through the
same helper — so the scoping is proven to find rows it should.

### 3.5 Deliberate-breakage check

**Edit**: in `src/pages/api/generate.ts`, decouple the schema from the shared constant —
`sourceText: z.string().min(1).max(SOURCE_MAX)` → `.max(SOURCE_MAX * 2)`.

**Adapted from the plan's wording, and the adaptation is the point.** The plan says "raise
the server's `SOURCE_MAX` above the client's former literal". After this phase there is no
"server's `SOURCE_MAX`" to raise: there is one constant, and the test imports it too, so
raising it moves client, server **and** oracle together and the suite stays green while
proving nothing. Loosening the endpoint's own schema away from the shared value reproduces
the same defect — the server accepting what the client refuses — and is precisely the drift
Risk #6 names.

**Observed**: `npx vitest run tests/generation/generate.test.ts` → **exactly 2 of 20 red**,
both of them the over-limit cases and both on the decisive observation (the endpoint
*accepted* the crafted body):

```
× 400s a sourceText one character over the limit, and writes nothing
  → expected 200 to be 400 // Object.is equality
× 400s a sourceText over the limit even when it trims back under it
  → expected 200 to be 400 // Object.is equality
```

**The boundary control stayed green**, which is what the check is for: the two reds observe
the cap moving, not an endpoint that started refusing everything. So did the other 17 —
including every count/language/id/deck-name bound, so those are pinned by their own guards
and not by this one.

Two reds rather than the one the plan's row implies, and correctly so: both cases assert the
same `.max()` clause, the second adding only that the cap governs the **raw** string. Under a
doubled cap a 10 001-character body passes either way.

**Restore**: `.max(SOURCE_MAX)` reverted; `grep -n "max(SOURCE_MAX" src/pages/api/generate.ts`
→ `50: sourceText: z.string().min(1).max(SOURCE_MAX),`, `git diff --stat src/` shows only the
phase's two intended files, `npm test` → **159 passed / 159**. No breakage edit was committed.

### 3.4 Manual check — the client still enforces the limit after the import swap

Run in a real browser against `npm run dev` (`http://localhost:4327`; 4321-4326 were taken),
signed in as `dup-probe-c10x34@example.com`, on `/generate`. This is the check no automated
layer here can make (§7), so it was driven as a user would drive it, not read off the source.

**The four attributes now come from the shared module, and they arrived intact:**

```
textareaMaxLength: 10000        countMin: "1"   countMax: "15"   (type=number)
deckNameMaxLength: 100          counter: "0 / 10000"
languages: auto => Ten sam co tekst | polski => Polski | angielski => Angielski
           hiszpański => Hiszpański | niemiecki => Niemiecki | francuski => Francuski
```

The language list is the one thing the swap restructured — the island used to hold
`{value,label}` objects and now derives labels from a `Record<Language,string>` over the
lib's values. All six render, and each `<option value>` still matches the endpoint's enum
exactly (confirmed again by the positive control below, which sends a **non-default**
language).

**`maxLength` truncation, driven through the real editing pipeline** (`execCommand
insertText`, not an assigned `value` — an assigned value bypasses `maxLength` and would have
faked a pass):

```
attempted: 10001   inField: 10000   head: "PROBE-aaaa"   tail: "aaaaa-END!"
counter: "10000 / 10000"   counterClass: …text-blue-100/50   aria-invalid: null
```

The 10 001st character was dropped by the browser (the probe's tail `-END!!` arrived as
`-END!`), React state followed, and the counter reads the cap. Not red and not
`aria-invalid`, correctly: the value sits **at** the cap, not over it. Note what this means —
`CharCount`'s red state and the island's own `text.length > SOURCE_MAX` branch are
**unreachable through the UI**, because `maxLength` gets there first. They are a second belt,
not the visible guard.

**The reachable client guard, and proof it refuses without touching the wire.** `count` is a
number input, so `min`/`max` do not stop a typed value: with `20` entered and `window.fetch`
wrapped to record calls, submitting rendered

> Liczba kart musi być w zakresie 1–15.

with `fetchCalls: []` — **no request was issued at all**, and no "Ponów" button (correct: a
pure validation error is not retriable). That message interpolates `COUNT_MIN`/`COUNT_MAX`,
so it also shows the imported constants reaching the client's *validation*, not only its HTML
attributes.

**Positive control — the happy path still works after the swap.** Same form, `count` 3,
language deliberately set to `hiszpański` rather than the default `auto`:
`fetchCalls: ["/api/generate"]`, banner "Zapisano 3 — kandydaci trafili do talii jako karty
do przeglądu.", 3 candidates rendered. So the derived option values are ones the server's
whitelist accepts; had the swap changed what travels, this is where it would have 400'd.

Left behind on the local dev DB, deliberately and harmlessly: one deck
`Sonda C10X-30 1785088993728` with its 3 mock cards and one `succeeded` session.

### What this phase does NOT prove

The client half of the parity **as a standing guarantee**. The check above is a human run at
a point in time; no layer in this project reaches an island's JSX
(`test-plan.md` §7), so `GeneratorForm`'s `maxLength`, `min`/`max`, `<select>` and char
counter are covered by manual check 3.4 alone — the same gap §6.6's Phase 4 entry records for
`SessionSizeControl`'s `SIZE_MIN`/`SIZE_MAX`. What single-sourcing buys is that the two ends
can no longer disagree about the **value**; that each end still enforces it is one assertion
here and one pair of human eyes there.

Also out of scope, deliberately, and named so it does not read as missed: the deck-name
`1..100` bound (six copies) and the card-content `FRONT_MAX`/`BACK_MAX` endpoints — the
latter being the half of C10X-30 this phase does not close.
