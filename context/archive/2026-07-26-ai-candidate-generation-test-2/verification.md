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

> **Correction line, 2026-07-31 (C10X-34 `auth-error-copy`) — the run above is NOT rewritten.**
> The denominator has moved: `tests/auth/errors.test.ts` held **33** cases on the day this run
> was made and holds **55** now (C10X-30 added the malformed-body cases, C10X-34 added six
> mapping rows with their non-emptiness twins, the signup discriminator case and four
> `ownedAuthMessage` cases). Nothing about the observed split changes — it records what was
> actually executed on 2026-07-26 — but "1 of 33" must not be quoted as a current figure, and
> the check has not been re-run since. Same rule the project applied to C10X-30's "4xx" wording:
> an archived artifact gains a dated line and loses nothing. The blindness noted in the last two
> sentences was **re-confirmed by measurement** under C10X-34's breakage check B and is now
> stated in the test file's own comment, which had claimed the opposite.

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

## Phase 4 — ambient disclosure: banner gate and the log boundary (C10X-34 / C10X-28)

> **Written during Phase 6, not during Phase 4, and that is the reason it exists.** Phase 4
> shipped as `34e8837` without touching this file, so rows 4.3–4.6 were checked off with no
> observed output written down. Reconstructing them from memory was refused (this document's
> header: "a count with no run behind it is worse than no count"), so Phase 6 **re-ran every
> one of them** and recorded what it saw. Everything below is a run made on 2026-07-26 during
> Phase 6 against the shipped files — not a recollection of Phase 4.

### 4.6 Deliberate-breakage check — the `console.*` guard

Baseline first: `npx vitest run tests/lib/no-logging.test.ts` → **3 passed / 3**.

**Edit 1** (the plan's own wording): `console.log("BREAKAGE-CHECK-4.6", message);` added to
`failGenerationSession` in `src/lib/generations.ts`.

**Observed**: **exactly 1 of 3 red**, and the failure names the file and line:

```
FAIL  tests/lib/no-logging.test.ts > src/ writes no log lines > contains no console.* call anywhere
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ "lib/generations.ts:117: console.log(\"BREAKAGE-CHECK-4.6\", message);" ]
```

The other two cases stayed green — and they are the file's two positive controls (the walker
finds >50 files including the four named ones; the regex fires on four spellings of a console
call). That split is what says the red one observes a real occurrence rather than a broken
walker.

**Edit 2 — the widening (plan-review F5) is load-bearing, so it was checked separately.** The
guard was widened from the three request-path directories to the whole of `src/` because
`.astro` frontmatter runs server-side too. `console.log("BREAKAGE-CHECK-4.6b", decks);` added
to `src/pages/generate.astro`'s frontmatter — the page that handles exactly the private data
Risk #4 is about:

```
+ [ "pages/generate.astro:14: console.log(\"BREAKAGE-CHECK-4.6b\", decks);" ]
```

**Exactly 1 of 3 red** again. A three-path guard would have been green here, which is the
case the widening exists for.

**And the reason this is a test rather than a lint rule was verified, not assumed.** With that
same `console.log` still in `generate.astro`:

```
$ npm run lint
src/pages/generate.astro
  14:1  warning  Unexpected console statement  no-console
✖ 1 problem (0 errors, 1 warning)
EXIT=0
```

Exit **0** — `no-console` is `"warn"` and the script is a bare `eslint .` with no
`--max-warnings`, so a `console.log(sourceText)` ships with CI green. The header comment in
`tests/lib/no-logging.test.ts` claims exactly this; it is now measured.

**Restore**: both edits reverted; `git diff --stat -- src/` **empty**;
`npx vitest run tests/lib/no-logging.test.ts` → 3 passed / 3. Neither edit was committed.

### 4.3 / 4.4 / 4.5 Manual checks — the banner gate

Run against `npm run dev` (ports 4328–4330; 4321–4327 were taken). Driven with `curl` rather
than a browser **on purpose**: both banners are server-rendered in `Layout.astro`'s
frontmatter, so the bytes the server sends *are* the observation, and a grep over them is
exact where a screenshot is a judgement call. The session for 4.4 is a real one, minted
through the real endpoint.

**4.3 — signed out, no OpenRouter banner** (`OPENROUTER_API_KEY` is unset locally, so an
ungated entry *would* render):

```
== / ==            http=200   (no banner)
== /auth/signin == http=200   (no banner)
```

Neither banner appears: OpenRouter's is gated behind the session, and Supabase's is simply
not in `missingConfigs` — it is configured.

**4.4 — signed in, the banner returns.** `POST /api/auth/signin` with a cookie jar
(`dup-probe-c10x34@example.com`, the account Phase 1 left behind) → `302`, then:

```
== signed-in /decks ==     banner: OpenRouter nie jest skonfigurowany — generacja fiszek
                                   działa w trybie mock (przykładowe karty).
== signed-in /generate ==  banner: OpenRouter nie jest skonfigurowany — …
```

Same URL, same unset key, different answer by session — so 4.3's absence is the gate working,
not the entry having gone missing.

**4.5 — the trap: with Supabase unconfigured, its own banner must NOT hide itself.**
`SUPABASE_URL` commented out in `.env` (backup taken first), dev server restarted so the
`astro:env` value is re-read:

```
== / (signed out, SUPABASE_URL unset) ==            banner: Supabase nie jest skonfigurowany
                                                            — funkcje uwierzytelniania są wyłączone.
== /auth/signin (signed out, SUPABASE_URL unset) == banner: …same…
```

The Supabase banner renders **while signed out**, and the OpenRouter banner still does not —
in one page load, which is the per-entry split `requiresSession` exists to produce. A
block-level `Astro.locals.user` gate would have suppressed both: with Supabase down
`createClient` returns `null`, middleware sets `locals.user = null`, and the warning about
that very breakage would gate itself off exactly when it is needed.

**Restore**: `.env` copied back from the backup, `diff` against the backup **empty**,
`grep -c "^SUPABASE_URL=" .env` → 1. Dev server restarted once more on the restored file:
signed out, `/` shows **no banner** — i.e. the check left no residue. All three dev servers
were then stopped. `.env` is gitignored and was never committed either way.

## Phase 5 — the project's first module double (C10X-28)

### Automated

| Check | Command | Result |
| --- | --- | --- |
| 5.1 New file alone | `npx vitest run tests/generation/failure-path.test.ts` | **4 passed / 4** — two 502 branches, the 422 branch, and the key pin |
| 5.2 Full suite | `npm test` | **166 passed / 166, 14 files** (was 165/14 with the file's first three cases; 159/12 before this phase) |
| 5.3 Lint | `npm run lint` | clean (only the pre-existing `astro-eslint-parser` `projectService` notices) |

The seam is the one `research.md` § "Verified by execution" recommended and **not** the one
`frame.md` proposed: `vi.mock("astro:env/server", { ...actual, OPENROUTER_API_KEY: SENTINEL })`
plus a pass-through `globalThis.fetch`. `@/lib/openrouter` is never doubled, so every line of
it runs — which is what makes the `Authorization` assertion below evidence rather than a
restatement of the test's own wiring.

### The plan's own breakage check 2 would NOT have gone red — so a fourth case was added

The plan's row 5.5 says "make the 502 branch interpolate `err.message` into its body; confirm
exactly the no-leak assertion goes red". Against the file as first written (three cases,
matching the plan and the research spike) that check **passes**: on the HTTP-failure path
`err.message` is `openrouter.ts`'s own `"OpenRouter HTTP <status>"` — a string carrying
nothing private — so a body interpolating it leaks nothing observable and no assertion
notices. The check would have been run, come back green, and been recorded as evidence for a
claim it never tested.

`err.message` is not incidental here: it is the value the endpoint routes into the
`error_message` **column**, so interpolating it into the body is the most plausible real
leak on this path. The fix is a fourth case rather than a weaker check — a **transport**
failure (the fetch double throws), where the upstream string *is* `err.message`
(`"OpenRouter fetch failed: <reason>"`). The contrast is then asserted on `error_message`
itself: the row records it, the body does not, on one request. Check 5.5 below is run against
that case and does go red.

### 5.4 Deliberate-breakage check 1 — the seam itself

**Edit**: the `vi.mock` specifier repointed to a non-existent module id
(`"BREAKAGE-CHECK-1-astro:env/server"`), i.e. the factory is present but doubles nothing —
the same effect as commenting it out, without leaving an unused `vi.hoisted` binding that
lint would reject.

**Observed**: **4 of 4 red**, every one on the decisive observation:

```
× 502s an upstream HTTP failure …          → expected 200 to be 502
× 502s a transport failure …               → expected 200 to be 502
× 422s a model answer whose cards …        → expected 200 to be 422
× sends the key in the header …            → expected 200 to be 502
```

`200`, not a 500 and not a timeout: without the seam `OPENROUTER_API_KEY` is unset, so
`generateCandidates` short-circuits to `mockCards` and the request **succeeds**. That is what
proves these assertions observe the interception rather than an incidental failure. Re-run
against the **final** four-case file, not the three-case one the first run used — the
denominator has to match what ships.

**Restore**: specifier reverted; `npx vitest run tests/generation/failure-path.test.ts` →
4 passed / 4.

### 5.5 Deliberate-breakage check 2 — the 502 body interpolates `err.message`

**Edit**: in `src/pages/api/generate.ts`, the 502 return →
``json(502, { error: `Nie udało się wygenerować fiszek: ${message}. Spróbuj ponownie.`, retriable: true })``.

**Observed**: **exactly 1 of 4 red** — the transport case, on the no-leak assertion:

```
× 502s a transport failure: `error_message` records the upstream string, the body does not
AssertionError: expected '{"error":"Nie udało się wygenerować f…' not to contain 'upstream-sentinel-ms24v80p'
  tests/generation/failure-path.test.ts:257
```

The HTTP-failure case, the 422 case and the key pin stayed green — correctly, and that split
is the finding above made concrete: only the transport path routes private material through
`err.message`.

### 5.5b Deliberate-breakage check 2b — the 502 body interpolates the source text

Not in the plan; added because the `SOURCE_SENTINEL` assertions would otherwise never have
been shown to be falsifiable at all (check 2 only exercises the upstream-string half).

**Edit**: same return, ``…: ${sourceText}. Spróbuj ponownie.``

**Observed**: **exactly 2 of 4 red** — both 502 cases, both on the source-text assertion:

```
× 502s an upstream HTTP failure …     → expected '{"error":"Nie udało się wygenerować f…' not to contain 'zrodlo-sentinel-ms24vjk2'
× 502s a transport failure …          → expected …same…
```

The 422 case stayed green, which is right: it is a different branch with its own body. The
key pin stayed green: it asserts on the captured request and the row, not on the body.

**Restore** (both 2 and 2b): the literal reverted; `git diff -- src/` empty.

### 5.6 Deliberate-breakage check 3 — `Authorization` moved into the request body

**Edit**: in `src/lib/openrouter.ts`, `Authorization: \`Bearer ${OPENROUTER_API_KEY}\`` deleted
from the `headers` object and added as an `authorization` property of the request `body` —
so the key travels, but in the wrong place. (Modelled as a property of `body` rather than of
the stringified copy on purpose: `rawRequest` is an alias of that object, so this reproduces
the *whole* defect — key on the wire, key in the audit column — not just half of it.)

**Observed**: **exactly 1 of 4 red**, and the failure is the positive control reporting the
header now absent:

```
× sends the key in the header, keeps it out of the request body and out of the row
AssertionError: expected null to be 'Bearer sk-or-harness-SENTINEL-2f7c1d9e'
  tests/generation/failure-path.test.ts:331
```

**5.6b — the other two halves of that test are falsifiable too, and were checked rather than
assumed.** The header assertion fails first, so the body and row assertions never execute
under check 3 and could in principle have been dead. Re-run with the header assertion
commented out and the same production edit still in place:

```
AssertionError: expected '{"authorization":"Bearer sk-or-harnes…' not to contain 'sk-or-harness-SENTINEL-2f7c1d9e'
  tests/generation/failure-path.test.ts:338
```

So all three claims in that test — key in the header, key not in the body, key in no audit
column — observe something real.

**Restore**: header restored, the `body` property removed, the commented assertion
uncommented.

### 5.7 All production edits reverted, none committed

```
$ git diff --stat -- src/ supabase/
(empty)
$ git status --porcelain
 M context/changes/ai-candidate-generation-test-2/plan.md
 M context/foundation/test-plan.md
?? tests/generation/failure-path.test.ts
$ npm test
Test Files  14 passed (14)     Tests  166 passed (166)
```

Three production files were edited across checks 2, 2b and 3 (`api/generate.ts`,
`lib/openrouter.ts`); the `git diff` above is the proof each was put back, not a claim that
it was.

### 5.8 `globalThis.fetch` restored, and what actually verifies the double

The double is installed in `beforeAll` and restored in `afterAll`. That restore protects the
**intra**-file hazard only: `isolate: true` + `pool: "forks"` already keep a `vi.mock` out of
every other file by configuration (so 5.2's green full suite is a smoke check, **not**
evidence of confinement), while `restoreMocks`/`unstubGlobals` default to `false`.

What proves the double **delegates rather than replaces** is not the teardown: it is that all
four cases read their `generation_session` row and their deck count back over the same
`globalThis.fetch`, after the double is installed. A double that swallowed the Supabase calls
would go red on the row read in every test, long before teardown. Under check 1 those reads
kept working while the four status assertions failed — a live demonstration that the
pass-through half is independent of the `astro:env` half.

### What this phase does NOT prove

- **The provider contract.** No test here reaches the real OpenRouter. The upstream shapes
  are fabricated by the fetch double, so a change to the prompt, the model or the real
  response format is invisible — that is §3 Phase 5's job (LLM-as-judge), unchanged.
- **The log-line half of Risk #4.** Nothing here reads a log. That half rests on Phase 4's
  `tests/lib/no-logging.test.ts` (bounded to `src/`) plus the stated boundary on
  dependency-emitted lines.
- **The success path's audit columns.** Only the two failure branches are asserted.
- **`error_message`'s exact wording on the 502 path.** Asserted as a non-empty string, not
  pinned — the only copy assertion in the file is the 422 path's
  `"Model nie zwrócił poprawnych kart"`, and it is there because substituting that literal
  for the upstream string **is** the no-leak property on that branch.
- **The client's handling of these two bodies.** `src/lib/http.ts` renders the `error` string
  verbatim for a 502/422 (they are neither `401` nor redirects), which is what makes "every
  body is a fixed literal" a user-visible invariant — but no layer in this project reaches
  the island that renders it (`test-plan.md` §7).

### Residue left on the local dev DB

Each run of this file writes three `failed` `generation_session` rows (and none of the three
decks, which is asserted). The breakage runs additionally left a handful of **`succeeded`**
sessions plus their decks — under check 1 the requests fall through to mock mode and succeed
— named `Talia 502 …` / `Talia 422 …` / `Talia klucz …` / `Talia transport …` under a spent
per-run suffix. Harmless (every run mints fresh accounts and a fresh suffix) and cleared by
`npx supabase db reset` if a reviewer wants a clean stack.

## Phase 6 — verification sweep and test-plan sync (C10X-28)

### Automated — the measurement every claim in this change is dated against

| Check | Command | Result |
| --- | --- | --- |
| 6.1 Full suite | `npm test` | **166 passed / 166, 14 files** |
| 6.2 Lint | `npx astro sync && npm run lint` | exit **0**, clean (only the pre-existing `astro-eslint-parser` `projectService` notices) |
| 6.2 Build | `npm run build` | server built in 5.69 s, Complete |

Environment: local stack up, `OPENROUTER_API_KEY` unset, `git diff -- src/` empty. This is
the figure written into `test-plan.md` §8 — **measured here, not copied**: the frame's
"97/10" was dead on arrival and research's "109/11" is C10X-27's number, not this change's.

### The doc-sync list was re-derived, not applied

The plan's Phase 6 §2 carries a standing instruction — rebuild the list by reading the
current `test-plan.md`, and treat every line number in the plan as historical. Done: the file
is **1425 lines** at the start of this phase, a fourth different figure from the three the
plan quotes (858 → 1018 → 1332 → 1352). What that re-derivation found:

| Item | Verdict |
| --- | --- |
| §8's "69/69 green, 8 files" | **Already closed by C10X-27** — the ledger records 109/109, 11 files. Not touched. |
| §6.6's "the middleware guard is untested" | **Already closed by C10X-27**, explicitly. Not touched. |
| §6.5's `src/lib/generations.ts:29-34` anchor | **Already gone** from `test-plan.md`. Its twin in a live comment at `tests/generation/generate.test.ts` was **not**, and is fixed here. |
| S-05's Stryker range `--mutate "src/lib/flashcards.ts:181-212"` | **Still open, fixed.** `grep -n` puts `ALLOWED_FROM` at `:202` and `setFlashcardState` at `:218-226`, so the recorded range had been mutating a different part of the file since `75df78f`. Corrected to `:202-226` **with both symbols named beside the numbers**, and a note that the span must be re-derived before running — Stryker completes happily on a stale range and reports a score for whatever it happens to contain. The frozen copy in the S-05 archive keeps the original range: it records what was actually run. |
| **Every `context/changes/<archived-id>/…` evidence pointer** | **Not on the plan's list; found by re-derivation and fixed.** Thirteen pointers on twelve lines — in the header block, §3's phase table, §6.6, §6.7 and §7 — addressed `context/changes/`, but all five of those changes have been archived, so every "full evidence" link in the file was broken. Rewritten to `context/archive/<date>-<id>/…`, then the file's **whole** set of archive pointers was resolved against disk: **12 unique paths, 12 OK, 0 missing**. |
| §6.5's "**No HTTP double is needed, and none exists**" | **Not on the plan's list; falsified by this change's own Phase 5.** Corrected in place, with the correction marked rather than the sentence silently rewritten. |
| §6.3 "TBD — see §3 Phase 2" | **Written.** Phase 2 has now landed the validation-parity and no-leak-in-error-body contracts, so the placeholder was the last thing in the file still describing them as future work. §6.5's "belongs to §6.3, still TBD" pointer updated with it. |

### What was added rather than corrected

- **§6.6 gains this change's entry** — a 12-row claim/what-proves-it table, the four traps
  the slice paid for (the 414, the status-filtered oracle, the select-policy backstop, and a
  breakage check that would have been recorded green for a claim it never tested), and a
  "what this does NOT prove" list of six items.
- **§2's Risk #4 and #6 rows** are annotated with the coverage and its boundary.
- **§3 Phase 2** stays `implementing`, and now says what would flip it: one crafted request
  against the card-content endpoints. That is the deliberate call — the plan's F3 note
  assumed Risk #6 was leaving with C10X-30 and it did not, but C10X-30's card-content half
  was still excluded, so the answer was not automatic in either direction.
- **§7** gains the dependency-emitted log lines as named negative space, and the islands
  bullet gains `GeneratorForm`'s bounds mirror beside `SessionSizeControl`'s.
- **§8** gains this change's ledger entry with the measurement above.

### 6.3 / 6.4 / 6.5 — the manual reads

- **6.3 — every claim in the new §6.6 entry traces to a named test or an explicit gap.**
  Walked row by row against the files rather than against my own summary, and **it found
  two overstatements in the entry as first written** — which is the only reason this check
  is worth doing:
  - the bounds row said "**seven** bounds cases". There are **six** refusal `it()`s
    covering nine inputs, plus the boundary control which the table already lists as its
    own row (7 tests added in total). Corrected to six.
  - the 502/422 row said the row is asserted to hold the source text "inside
    `request_payload.messages[1].content`". The assertion is
    `JSON.stringify(row.request_payload)).toContain(SOURCE_SENTINEL)` — presence in the
    column, not a JSON path. Corrected, and the raw-body half of the claim spelled out
    (the assertions run on `await response.text()`, not on `payload.error`).

  Everything else traced: `failure-path.test.ts` (4 cases), `candidates.test.ts`'s
  audit-column describe (4, with `auditRowOf` re-read as the owner and `data` `toEqual([])`
  as the refused-write signal), `generate.test.ts`'s input contract (6 + boundary control),
  `errors.test.ts` (33, the endpoint case asserting the decoded param **and** the raw
  `Location`), `no-logging.test.ts` (3, two of them controls). The one row that names no
  test says so in bold — the banner gate is manual, and points here.
- **6.4 — no statement in `test-plan.md` contradicts the measured suite state.** Checked by
  enumerating every `N/N` figure in the file (`grep -no`), not by reading around: 20 of them.
  **Three were live contradictions and are fixed**; the rest are dated records of a
  particular run and say so.
  - "full suite green at 69/69 … (**it is 109/109 now**)" — "now" was two changes ago. The
    parenthetical is rewritten to carry all three figures with their dates.
  - "The `1 of 13` split above **is still current** — `generate.test.ts` holds 13 cases,
    re-counted 2026-07-26." It holds **20**: Phase 3 of this change added seven. The claim
    is replaced by a statement that the denominator moved and **the run has not been
    repeated** — the numerator is not asserted on its behalf.
  - S-05's "3 of 16 red in `candidates.test.ts`" and "1 of 25 across both files": same
    class, `candidates.test.ts` is now 20. A dated note is added above those checks rather
    than the historical numbers being rewritten — the four cases this change added touch a
    different table and no `ALLOWED_FROM` path, so the numerators should hold, and saying
    "should" is the honest word for a run nobody repeated.

  Two claims that could have gone stale were verified instead and **hold**: §4/§6.9's
  "exactly one file doubles anything" (`grep -rln "vi\.mock\|vi\.spyOn\|vi\.fn" tests/` →
  `tests/generation/failure-path.test.ts`, and nothing else), and "the endpoint and the
  island both import the limits" (`grep -rn "generation-limits" src/` →
  `pages/api/generate.ts` and `components/generate/GeneratorForm.tsx`).
- **6.5 — a cold reader can tell which half of Risk #4 is pinned and which is documented.**
  The §6.6 entry states the split in the first paragraph (the property held by construction,
  was asserted nowhere, and could not be asserted at all), the table marks the banner row as
  manual, and the "does NOT prove" list opens with "nothing in this suite reads a real log
  sink". §2's row carries the same warning inline so a reader who never reaches §6.6 still
  sees the boundary.
