---
date: 2026-07-28T20:04:11+02:00
researcher: Dawid Liro
git_commit: 8a5ff6c751c088e47ebf52d05f26460ee9866cf6
branch: C10X-30-server-side-validation-test
repository: lirdaw/10xcards
topic: "Server-side validation parity for card content rules (Risk #6, card-content half)"
tags: [research, codebase, risk-6, validation-parity, flashcards, auth, endpoint-contract]
status: complete
last_updated: 2026-07-28
last_updated_by: Dawid Liro
---

# Research: Server-side validation parity for card content rules (Risk #6)

**Date**: 2026-07-28T20:04:11+02:00
**Researcher**: Dawid Liro
**Git Commit**: 8a5ff6c751c088e47ebf52d05f26460ee9866cf6
**Branch**: C10X-30-server-side-validation-test
**Repository**: lirdaw/10xcards

## Research Question

C10X-30 owns the second half of test-plan Risk #6 — "the server trusts the client". The
source-text half shipped under C10X-28 (`b520b90`). What remains is the **card-content**
half: a crafted request breaching `FRONT_MAX`/`BACK_MAX` must be refused **and** write
nothing. The scope agreed for this research, wider than the ticket:

1. Everything connected to the topic, including whether any of it is already done under a
   foreign ticket key (the user's explicit instruction, and the Jira comments confirm the
   suspicion was well founded).
2. The auth routes (`signin.ts` / `signup.ts`) researched **on equal footing** — the ticket
   leaves the "is it in scope" decision here.
3. The generation path's Zod card schema, the `/cards/batch` input bounds, the absence of
   DB constraints, and `trim()` behaviour at the boundary.

## Summary

**The production code is already correct. This is a pure test change, and it should need no
edit under `src/` — unlike the source-text half, which had to build `generation-limits.ts`
first.** The remaining work is one narrow file's worth of assertions plus one deliberate
breakage run.

Five findings change how the plan must be written, and three of them contradict the ticket:

1. **The card endpoints do not answer `4xx`. They answer `302`.** `POST /api/decks/[publicId]/cards`
   and `POST /api/decks/[publicId]/cards/[cardPublicId]` are native-form targets: on a length
   breach they `context.redirect(...)` to `?error=<Polish>&open=create-card` / `&edit=<cardPublicId>`
   ([cards/index.ts:48-53](src/pages/api/decks/[publicId]/cards/index.ts#L48-L53),
   [[cardPublicId].ts:60-65](src/pages/api/decks/[publicId]/cards/[cardPublicId].ts#L60-L65)).
   Astro's `redirect()` defaults to **302** for on-demand routes (verified against Astro docs).
   The ticket description, **both** Jira comments, `change.md:41`, the archived C10X-28
   `change.md:48-54` and `test-plan.md`'s Phase 2 note all say "4xx". That wording is accurate
   for `/cards/batch` and **wrong for create/edit**. Nobody has been misled yet because nobody
   has written the test; whoever writes it from the ticket text will chase a status code that
   does not exist.
2. **`/cards/batch` carries no card content at all** and its input bounds are **already fully
   tested** ([candidates.test.ts:281-325](tests/review/candidates.test.ts#L281-L325) — five bad
   bodies → 400, absent deck → 404, row re-read `toEqual(before)`). Including it would be a
   duplicate, not coverage.
3. **The trim asymmetry is the OPPOSITE of the source-text half.** `/api/generate` caps the
   **raw** string; both card endpoints `.trim()` **before** measuring
   ([index.ts:31-32](src/pages/api/decks/[publicId]/cards/index.ts#L31-L32)). The C10X-28 case
   "over the cap, but trims back under it → still refused" **does not transfer** and would be a
   false expectation here; the correct card-side case is its mirror image — *accepted*.
4. **The database has no upper bound on `front`/`back`, by a decision recorded in the migration
   itself.** Only `check (char_length(front) > 0)`
   ([init_core_schema.sql:62-63](supabase/migrations/20260705180246_init_core_schema.sql#L62-L63));
   the rationale is written in Polish at
   [manual_card_source.sql:10](supabase/migrations/20260710195327_manual_card_source.sql#L10).
   The endpoint's four lines are therefore the **only** enforcer in the system. That is exactly
   what makes this test worth writing — and it is the sharpest contrast with the auth surface
   below.
5. **Auth is a different animal, and the honest recommendation is to keep it out of this
   change.** Researched on equal footing as agreed, with live probes: our two routes contain
   **zero** validation lines, but every rule the UI states is independently enforced by GoTrue.
   A test there would be green on the first run and **impossible to turn red by editing `src/`**
   — it would pin `supabase/config.toml`, i.e. exactly the config-drift class §6.6 records as
   having no check anywhere. Details, probe output and the four real defects found are in
   §Auth below. The decision remains the user's; this is the evidence, not a veto.

## Detailed Findings

### 1. The card-content write paths — what actually enforces the rule

Repo-wide there are exactly **three** writers of `front`/`back`
([flashcards.ts:178](src/lib/flashcards.ts#L178), [flashcards.ts:188](src/lib/flashcards.ts#L188),
[generations.ts:131](src/lib/generations.ts#L131)), each with one caller. **No lib function
re-validates length** — `createFlashcard` and `updateFlashcard` put the strings straight into
the query.

`POST /api/decks/[publicId]/cards` — guard order:

| # | Guard | Line | Response | Writes? |
|---|---|---|---|---|
| 1 | route uuid | `index.ts:16-18` | `404`, empty body | no |
| 2 | supabase configured | `:21-24` | `302` → `?error=…&open=create-card` | no |
| 3 | session | `:26-28` | `302` → `/auth/signin` | no |
| 4 | `await request.formData()` | `:30` | **unguarded** — throws → framework `500` | no |
| 5 | deck resolve error / absent | `:40-46` | `302` errorUrl / `404` empty | no |
| 6 | **front length** | `:48-50` | `302` → `?error=Przód fiszki musi mieć od 1 do 200 znaków` | **no** |
| 7 | **back length** | `:51-53` | `302` → `?error=Tył fiszki musi mieć od 1 do 1000 znaków` | **no** |
| 8 | insert error / success | `:55-60` | `302` errorUrl / `302` → `/decks/{publicId}` | yes |

`POST …/cards/[cardPublicId]` mirrors it with two differences worth knowing: `formData()` is
read **first** (`:23`), before the supabase/session guards, because `errorUrl` needs the
`from`/`generation` fields to choose its base path; and a 0-row update (foreign or absent card)
resolves to `404` (`:73-75`).

Three properties the test must encode, none of them visible from the ticket:

- **Deck resolution runs BEFORE length validation, deliberately** (comment at
  [index.ts:34-39](src/pages/api/decks/[publicId]/cards/index.ts#L34-L39), from S-02
  impl-review F5). An over-length body aimed at a **foreign** deck answers `404`, not the
  validation redirect — so it never confirms that the deck exists. A test must therefore use a
  **real, owned** deck or it measures the wrong guard.
- **Missing, empty and whitespace-only are one indistinguishable case.**
  `((form.get("front") as string | null) ?? "").trim()` collapses all three to `""`, and the
  copy frames it as a length problem ("od 1 do 200 znaków") even when the field was never sent.
- **No client string can reach the `Location` header.** `errorUrl` interpolates only the
  already-UUID-validated route params and one of four module-level Polish literals; the two
  length messages embed only the numeric constants. Every non-redirect response is
  `new Response(null, …)` — these endpoints have **no response body at all**. That is the
  invariant to pin (it is the same class as the auth `?error=` leak C10X-34 closed), and today
  it holds by construction.

### 2. What the DB does and does not enforce

```sql
front text not null check (char_length(front) > 0),
back  text not null check (char_length(back)  > 0),
```
[init_core_schema.sql:62-63](supabase/migrations/20260705180246_init_core_schema.sql#L62-L63).
`text` is unbounded in Postgres. No `varchar(n)`, no upper `CHECK`, no trigger, in any of the
ten migrations.

Precedent matters here, in both directions:

| Constraint | Where | Shape |
|---|---|---|
| `deck.name` | `init_core_schema.sql:45` | `check (char_length(name) between 1 and 100)` — same shape, sibling text column, **has** a backstop |
| `deck_session_size_check` | `20260724220524_…_review_fixes.sql:16-20` | `between 1 and 100`, **widened from `> 0` specifically because the max lived only in Zod and an island** |
| `generation_session.source_text` | `20260712162349_generation_session.sql:25` | `char_length > 0` only — same gap as `front`/`back` |

So this project has **already once** concluded that a limit living only in app code deserved a
DB CHECK. Whether to repeat that for `front`/`back` is a plan-level decision, not a research
finding — but the plan should make it consciously rather than inherit it. The absence is
documented as intentional (S-02 `plan.md:140-144`; migration comment above), and S-02's own
`plan-brief.md:80-81` already named the residual risk in 2026-07-09: *"there is no DB backstop
for max length by design, so an out-of-band writer could exceed them."* **This ticket is the
closing of a loop opened nineteen days earlier.**

### 3. The generation path — a fourth content writer, bounded elsewhere

`insertCandidates` ([generations.ts:125-141](src/lib/generations.ts#L125-L141)) is a bare
`.insert(...)` with **zero** content validation. The only bound on generated card content is
the Zod schema in [openrouter.ts:32-35](src/lib/openrouter.ts#L32-L35), which imports the same
`FRONT_MAX`/`BACK_MAX` from `@/lib/flashcards` — genuinely single-sourced.

Three facts about it:

- **Failing cards are dropped individually and silently** (`validate()` at
  [openrouter.ts:123-134](src/lib/openrouter.ts#L123-L134)). The whole response is never
  rejected for one bad card. The `422` is a *downstream consequence* of `saved === 0`
  ([generate.ts:245-262](src/pages/api/generate.ts#L245-L262)), not a schema outcome — 3 of 10
  surviving means 3 inserted and 7 reported as `skipped`.
- **The JSON schema sent to the model declares `front`/`back` as bare `type: "string"` with no
  `maxLength`** ([openrouter.ts:74-94](src/lib/openrouter.ts#L74-L94)); the limits exist only as
  prose in the system prompt. Enforcement is entirely post-hoc.
- **Mock mode bypasses `validate()` entirely** ([openrouter.ts:154-163](src/lib/openrouter.ts#L154-L163)).
  Harmless in fact (`Przykładowe pytanie N` is short and non-empty), but formally it is a route
  to `insertCandidates` where no length check of any kind runs — and it is the mode the whole
  test suite uses.

Existing coverage: [failure-path.test.ts:181-194](tests/generation/failure-path.test.ts#L181-L194)
fabricates an over-`FRONT_MAX` **model answer** so every card is dropped and the endpoint
answers `422`. That is the only `FRONT_MAX` reference in the entire suite, and it tests
`openrouter.ts`'s schema — **not** the card endpoints. `BACK_MAX` appears in no test file at all.

### 4. `/cards/batch` — already covered, and it is not a content surface

The endpoint transitions state only; `front`/`back` never appear in its body schema
([batch.ts:29-37](src/pages/api/decks/[publicId]/cards/batch.ts#L29-L37)). Its three bounds —
`IDS_MAX = 100`, the per-element `UUID_RE`, and the `accepted|rejected` literals — are reachable
from outside but **mutually indistinguishable**: all collapse to `400 {error:"Nieprawidłowe dane
wejściowe"}`, which is correct (no Zod issue is ever echoed).

They are already asserted at
[candidates.test.ts:281-325](tests/review/candidates.test.ts#L281-L325) — five bad bodies plus a
404, each paired with `expect(await rowOf(a, candidate)).toEqual(before)`. **Do not re-test
them.** The dedupe at `batch.ts:90` changes the *response* only (a body sending one id 100 times
gets an array of length 1 back); Postgres collapses repeats inside `IN (...)` anyway, so row
counts are unaffected either way.

One gap remains and is small: a **101-id** body (`IDS_MAX` itself) has no case. The client
mirrors the bound as a commented copy `BATCH_MAX = 100`
([CandidateReviewWorkspace.tsx:27](src/components/review/CandidateReviewWorkspace.tsx#L27)),
not an import — the same drift mechanism, one table over.

### 5. Test coverage today — the gap, stated as claims nobody has tested

Suite baseline: **178 cases / 15 files** (139 `it()` blocks; `auth/errors.test.ts` and
`middleware.test.ts` parameterise). This matches `test-plan.md`'s stated figure exactly.

`tests/isolation/flashcards.test.ts` (9 cases) and `tests/review/candidates.test.ts` (20 cases)
between them touch these endpoints heavily — and **not once for a content rule**. Card text is
used only as an identity marker (`A_FRONT = \`A's front ${suffix}\``).

Untested claims, in priority order:

1. A `POST …/cards` with `front` at `FRONT_MAX + 1` is refused and **writes no card**.
2. The same for `back` at `BACK_MAX + 1`.
3. Both, on the **edit** endpoint — and the target row left byte-identical after the refusal.
4. **The boundary control**: a card at exactly 200 / 1000 is accepted and stored **whole**, not
   truncated. Without it every refusal above is satisfied by an endpoint that refuses everything.
5. The **card-side trim direction**: a 200-character front with trailing whitespace is
   **accepted** here (post-trim measurement), the mirror image of `/api/generate`'s raw cap.
6. The `?error=` contract itself: the redirect target (`open=create-card` / `edit=<id>`), the
   message being a project-owned string, and **nothing submitted echoed into the `Location`**.
7. **No `?error=` refusal anywhere in the suite is paired with a row oracle.** Every existing
   "writes nothing" assertion belongs to a JSON endpoint. A 302 endpoint that redirected *after*
   writing would read as a pass today.

The nearest thing that exists is
[candidates.test.ts:402-412](tests/review/candidates.test.ts#L402-L412) — it posts `front: ""`
and asserts the `Location` carries `error=`, `edit=` and the generation scope. Its subject is
the **redirect target**, not the bound: no row count, no re-read, no boundary control, no echo
assertion. Roughly 5% of the needed surface, incidentally.

### 6. Harness capability — what a new test needs, and what it already has

Already provided, **no fixture change required**:

- `callEndpoint` accepts `FormData` and deliberately leaves `Content-Type` unset for non-string
  bodies so `Request` derives the multipart boundary
  ([endpoint.ts:62-70](tests/fixtures/endpoint.ts#L62-L70)).
- **Redirects are not followed** — the doc comment says so explicitly
  ([endpoint.ts:50-55](tests/fixtures/endpoint.ts#L50-L55)) — so `status === 302` and
  `headers.get("Location")` are directly assertable.
- Decoding the param: `new URL(location, ORIGIN).searchParams.get("error")`, the pattern at
  [errors.test.ts:210-220](tests/auth/errors.test.ts#L210-L220).
- `cardForm(front, back)` already exists verbatim in two files
  ([flashcards.test.ts:36-41](tests/isolation/flashcards.test.ts#L36-L41)); `editFrom` (assert
  302, return `Location`) at [candidates.test.ts:358-372](tests/review/candidates.test.ts#L358-L372)
  is the richest precedent.
- Row oracles: `clientFor(a.cookieHeader)` plus the column-for-column `rowOf` helper.

Must be built **in the test file**, not in the shared fixture:

- **A status-agnostic count scoped to the test's own deck.** There is no `allSessions` analogue
  for flashcards. **Do not use `listFlashcards` as the create-refusal oracle** — it filters
  `state_id = STATE_ACCEPTED` ([flashcards.ts:76-83](src/lib/flashcards.ts#L76-L83)). Harmless
  today (manual create always writes accepted) but it would hide a card written in any other
  state.
- **`createScoping` is NOT needed here.** The 414 trap it exists for binds filters carrying a
  ~10 000-character value; an over-max card body is 201 / 1001 characters, far inside Kong's
  ~8 KB request line. Scoping by the test's own deck id is simpler and sufficient — the marker
  helper is the right tool for the wrong problem on this surface.
- A signed-out case, if wanted, needs the local-container pattern
  ([generate.test.ts:130-145](tests/generation/generate.test.ts#L130-L145)) because
  `callEndpoint` always injects `locals.user`. Note the card endpoints' signed-out branch is a
  `redirect("/auth/signin")`, **not** a 401.

### 7. The deliberate-breakage check — the one part that needs thought

C10X-28 recorded the trap in its own `verification.md:279-285`: after single-sourcing, *"there
is no 'server's `SOURCE_MAX`' to raise: there is one constant, and the test imports it too, so
raising it moves client, server and oracle together and the suite stays green while proving
nothing."*

The card endpoints have **identical topology** — `FRONT_MAX`/`BACK_MAX` are imported by both
endpoints, three islands, `openrouter.ts`, and would be imported by the test. So the breakage
must **decouple the endpoint's own comparison** from the shared constant (e.g. replace
`> FRONT_MAX` with a literal `> 100000` at `index.ts:48`), never raise the constant. Predicted
red: the over-max create case and its edit twin; the boundary control must stay green.

### Auth — researched on equal footing, with live probes

Our two routes read `email` and `password` from `formData` and perform **exactly one** check
before calling supabase-js: `if (!supabase)`. No presence, format, length or type check.
`confirmPassword` is submitted by `SignUpForm.tsx:104-106` and **never read** by `signup.ts`.
Both forms carry `noValidate` and `FormField.tsx` emits no `required`/`minLength`/`pattern`, so
every UI rule is JavaScript-only — defeated by disabling JS, not just by curl.

Parity table (Supabase column verified by live probe against the local stack today):

| Rule | UI | Our server | GoTrue | Verdict |
|---|---|---|---|---|
| email present (signin) | yes | **no** | yes — `400 validation_failed` "missing email or phone" | covered upstream |
| email present (signup) | yes | **no** | yes — `422 anonymous_provider_disabled` | covered upstream, **config-conditional** |
| email format (signup) | yes | **no** | yes — `400` "invalid format" | covered upstream |
| email format (signin) | yes | **no** | **no** — `400 invalid_credentials` | gap, zero consequence |
| password present (signup) | yes | **no** | yes — `400` "requires a valid password" | covered upstream |
| password ≥ 6 (signup) | yes | **no** | yes — `422 weak_password` (`config.toml:175`) | covered upstream |
| password ≤ 72 | **no** | **no** | yes — `400` "cannot be longer than 72 characters" | upstream-only |
| email length cap | **no** | **no** | yes — `400` "An email address is too long" | upstream-only |
| `password === confirmPassword` | **yes** | **no** | not a concept | **only rule with no enforcer outside the browser** |
| brute force | no | **no** | `sign_in_sign_ups = 30`/5 min/IP (read, not probed) | upstream-only |

`@supabase/auth-js` 2.105.3 performs **no** client-side validation — verified independently in
this session: `signUp`/`signInWithPassword` branch on `'email' in credentials`
(`GoTrueClient.js:633`, `:813`), a key test that is true for `""` and for `null`, so the
`else { throw AuthInvalidCredentialsError }` at `:667`/`:835` is **structurally unreachable**
from these call sites.

**Why the recommendation is to keep it out of C10X-30.** The decisive difference is the presence
of an independent enforcer. For card content, deleting four lines in `src/` lands the "śmieci w
bazie" `change.md:31-33` describes — a test there **can be turned red by a code edit**. For auth,
our routes contain zero validation lines, so there is nothing a regression can delete; a crafted
signup with a 3-character password is refused by GoTrue and would be green on the first run,
pinning `supabase/config.toml` rather than this repository. That is a config test wearing an
endpoint test's clothes, and it would put a false *"parity, auth included"* claim into §6.6 for
a value whose production counterpart lives in a dashboard the drift gate explicitly does not
check. Making auth genuinely testable as Risk #6 means **building** first: an `auth-limits.ts`
mirroring the `generation-limits.ts` pattern, real pre-checks returning constants that already
exist in the closed set, and optionally the `confirmPassword` comparison.

The final call is the user's. If auth is pulled in, it converts a test ticket into a
production-code ticket and delays the §3 Phase 2 close.

**Four real defects found there regardless, none needing this ticket:**

1. **`auth-errors.ts:105-107` states a falsehood** and the mapping it documents is unreachable.
   The comment claims `AuthInvalidCredentialsError` is raised client-side for an empty field;
   it is not (see the `'email' in credentials` proof above), so `AUTH_MISSING_CREDENTIALS_MESSAGE`
   sits in the closed set unreachable from either route. `tests/auth/errors.test.ts:114-120`
   asserts it against a hand-built shape while repeating the same false claim in its own comment.
2. **A live copy gap**: `anonymous_provider_disabled` is in neither `MESSAGE_BY_CODE` nor the
   status chain (422 is neither 429 nor ≥ 500), so an empty-field signup outside the UI renders
   the generic "Nie udało się dokończyć operacji".
3. **`MIN_PASSWORD_LENGTH = 6`** is a magic literal at `SignUpForm.tsx:8` duplicating
   `supabase/config.toml:175` — the drift mechanism this very risk describes, in a form
   `generation-limits.ts` cannot fix (one side is config, not code).
4. **`enable_anonymous_sign_ins`** (`config.toml:171`) is the only reason an empty signup is
   refused today. If it is ever true in the cloud dashboard, empty fields create a real
   anonymous account with no email — a user the PRD's access model has no notion of — and
   `signup.ts` would redirect it to `/auth/confirm-email`. Our code has no opinion on the flag.

### Surprises outside the stated scope

Found while mapping the endpoints; each is a genuine "server trusts the client" instance, and
none is in the ticket:

1. **`await request.formData()` is unguarded in all four form endpoints**
   (`cards/index.ts:30`, `cards/[cardPublicId].ts:23`, `auth/signin.ts:6`, `auth/signup.ts:6`).
   A crafted POST with `Content-Type: application/json` makes it reject → **uncontrolled
   framework 500** with no project-owned body. Both JSON endpoints wrap `.json()` in try/catch
   and answer a fixed `400`. The convention is applied on one side only.
2. **A `File` part named `front` crashes the handler**: `(… as string | null) ?? ""` then
   `.trim()` → `TypeError` → 500. Same at `signin.ts:7-8`, where a `File` would be posted
   verbatim to GoTrue.
3. **JS `.length` ≠ Postgres `char_length`.** The endpoints count UTF-16 code units; a front of
   101 astral characters (emoji) measures 202 in JS. The server is *stricter* than its stated
   rule for such text — no bypass direction, but a real user-visible discrepancy, and one a test
   at the boundary could accidentally trip over if it builds strings from non-ASCII.
4. **The card islands have no `maxLength` attribute** (unlike `GeneratorForm`, whose
   `maxLength={SOURCE_MAX}` truncates at input and makes its own over-length branch unreachable
   through the browser). `CreateFlashcardModal`, `FlashcardItem` and `CandidateItem` all `.trim()`
   then bounds-check against the **imported** constants — the same predicate on the same string
   as the server. So client and server here agree **by construction**, which is precisely why
   C10X-28 called this the low-drift half.
5. **`updateFlashcard` has no lifecycle filter**, so a `rejected` card's content is editable.
   Intended (the review screen edits candidates), but content edits are not gated by
   `ALLOWED_FROM` the way state transitions are.
6. **Four endpoints' `!supabase` / `!user` branches are unreachable in production** because
   middleware's `PROTECTED_ROUTES` fires first; only a direct container render (i.e. a test)
   reaches them. `/api/auth/*` is not protected, so those `!supabase` branches are genuinely live.

## Code References

- `src/pages/api/decks/[publicId]/cards/index.ts:48-53` — the front/back length guard on create; the subject of this change
- `src/pages/api/decks/[publicId]/cards/[cardPublicId].ts:60-65` — the same guard on edit
- `src/pages/api/decks/[publicId]/cards/index.ts:19` — `errorUrl`, which interpolates only validated route params and literals
- `src/pages/api/decks/[publicId]/cards/index.ts:34-39` — the comment recording why deck resolution precedes length validation
- `src/lib/flashcards.ts:58-62` — `FRONT_MAX`/`BACK_MAX` and the "business rule, not a DB CHECK" comment
- `src/lib/flashcards.ts:175-193` — `createFlashcard` / `updateFlashcard`: no content validation
- `src/lib/generations.ts:125-141` — `insertCandidates`: the AI write path, unvalidated at the insert site
- `src/lib/openrouter.ts:32-35` — the Zod card schema, the only bound on generated content
- `src/lib/openrouter.ts:123-134` — `validate()`: failing cards dropped individually
- `supabase/migrations/20260705180246_init_core_schema.sql:62-63` — `char_length > 0` and nothing more
- `supabase/migrations/20260710195327_manual_card_source.sql:10` — the recorded decision to omit the upper bound
- `supabase/migrations/20260705180246_init_core_schema.sql:45` — `deck.name between 1 and 100`, the contrasting precedent
- `tests/fixtures/endpoint.ts:50-70` — FormData support and the "redirects are not followed" contract
- `tests/generation/generate.test.ts:155-183` — `expectErrorBody`, the raw-body no-echo assertion (impl-review F5)
- `tests/generation/generate.test.ts:577-598` — the boundary-value success case to mirror
- `tests/review/candidates.test.ts:281-325` — the batch input contract, already covered
- `tests/review/candidates.test.ts:402-412` — the incidental empty-front case, and its limits
- `src/pages/api/auth/signin.ts:5-14`, `signup.ts:5-14` — zero validation before `supabase.auth.*`
- `src/lib/auth-errors.ts:100-108` — `MESSAGE_BY_NAME` and the false comment
- `src/components/auth/SignUpForm.tsx:8,22-44` — the client rules and the duplicated `MIN_PASSWORD_LENGTH`

## Architecture Insights

- **Two response conventions coexist by design, and the split is the caller, not the path.**
  Native-form targets redirect with `?error=`; JSON endpoints fetched by islands return a status
  and `{error}`. `AGENTS.md` states it, `middleware.ts` was rewritten around it in C10X-27, and
  `lessons.md:89-94` records the round-trip lesson behind it. Any plan that writes "4xx" for a
  card endpoint has silently changed the architecture.
- **Single-sourcing a bound is not the same as enforcing it twice.** `FRONT_MAX`/`BACK_MAX` are
  imported by endpoints, islands and the LLM schema, so the two ends cannot disagree about the
  *value*; that each end still *enforces* it is a separate claim, and only the server half is
  assertable in this suite (§7 of test-plan.md).
- **The project's own precedent points both ways on a DB backstop.** `deck.name` and
  `deck_session_size_check` both have one — the latter added precisely because a Zod-plus-island
  bound was judged insufficient. `front`/`back` and `source_text` do not. The inconsistency is
  documented, not accidental, but it is currently unargued in either direction.
- **The suite's oracle discipline is the real asset here.** Status assertions prove nothing on
  this codebase: an RLS-refused write is a silent 0-row no-op, and a 302 refusal is
  indistinguishable from a 302 success without reading rows. Every existing per-phase note in
  §6.6 says a version of this.

## Historical Context (from prior changes)

- `context/archive/2026-07-09-manual-card-crud/plan.md:140-144` — where `FRONT_MAX`/`BACK_MAX`
  were created, with the explicit decision that the DB carries no upper bound.
- `context/archive/2026-07-09-manual-card-crud/plan-brief.md:80-81` — **the residual risk named
  on 2026-07-09**: *"there is no DB backstop for max length by design, so an out-of-band writer
  could exceed them."* This ticket closes that loop.
- `context/archive/2026-07-09-manual-card-crud/reviews/impl-review.md:72-80` — F5, the reorder
  that put deck resolution ahead of length validation. Still live, and it shapes the test.
- `context/archive/2026-07-25-candidate-review/plan.md:406-412` + impl-review F1/F6 — the batch
  bounds, client-side chunking to keep the server bound meaningful, and the dedupe.
- `context/archive/2026-07-26-ai-candidate-generation-test-2/plan.md:226-227, :244-248` — the
  deliberate exclusion of the card endpoints and the instruction not to close C10X-30 on Phase 3.
- `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md:244-285` — the 414
  measurement, the status-filtered-count trap, and the breakage-decoupling rule.
- `context/archive/2026-07-26-ai-candidate-generation-test-2/reviews/impl-review.md` — F5 (the
  error body must not echo input), F6 (the trim comment was backwards), F7 (`scoping.ts`).
- Jira C10X-30 comments (2026-07-26, ×2) and C10X-34 comment (2026-07-26) — the split into three
  tickets, the "half is done under a foreign key" trail, and the hand-off of the auth decision
  to this ticket.

## Related Research

- `context/archive/2026-07-26-ai-candidate-generation-test-2/research.md` — measured the
  duplication surface and the raw-vs-trimmed asymmetry for the source-text half.
- `context/archive/2026-07-26-srs-study-session-test/research.md` — the audit that established
  the "a complete claim is a dated claim" discipline this file follows.
- `context/archive/2026-07-27-schema-drift-test/research.md` — enumerates the drift classes,
  including the config-drift class the auth recommendation leans on.

## Open Questions

1. ~~**Auth in or out.**~~ **RESOLVED 2026-07-28 — OUT.** Researched on equal footing as agreed,
   then excluded by decision: auth goes to its own ticket. The reasoning is the one recorded in
   §Auth — our routes contain zero validation lines, so a test there could not be turned red by
   any edit under `src/`; it would pin `supabase/config.toml`. That ticket carries the four
   defects listed in §Auth, and it is a **production-code** ticket (build `auth-limits.ts` and
   real pre-checks first), not a test ticket. C10X-30 stays card-content only.
   **Ticket raised the same day: C10X-36** (`Pomysł`, Fix Version `Post-MVP`, component `auth`,
   change-id `auth-input-validation`, linked `relates to` C10X-30). It carries the parity table,
   the build-first reasoning and all four defects. Note the type: `Pomysł` runs a **separate Idea
   Workflow**, so it will not enter the normal delivery flow until someone converts it.
2. **Whether to add a DB CHECK on `front`/`back`.** Not required by the ticket, and the omission
   is a recorded S-02 decision — but `deck_session_size_check` is precedent for promoting exactly
   this kind of bound. If the plan declines, it should say so in one line rather than inherit the
   silence.
3. **Whether the unguarded `formData()` (500 instead of a controlled 4xx) belongs here.** It is a
   genuine "crafted request" instance on the same four endpoints and cheap to fix, but it is a
   production change, and this change is otherwise test-only.
4. **The `IDS_MAX = 100` case on `/cards/batch`** — the one input bound there without a test. One
   `it()` in the existing file, or deliberately left.
5. **Where the new cases live.** §6.2 sends ownership cases to `tests/isolation/` and everything
   else to "a sibling folder named after the concern", while also saying a resource that already
   has a file gets another `it()` in it. Content rules on flashcards satisfy both readings:
   `tests/isolation/flashcards.test.ts` exists but is the **ownership** file, and
   `tests/review/candidates.test.ts` is the **review** concern. So this is a genuine choice —
   most likely a new `tests/validation/cards.test.ts` — and the plan must make it explicitly,
   because putting content rules into the isolation file would blur the one-claim-per-file
   property that makes a gap visible.
6. **Who corrects the "4xx" wording, and where.** It is wrong in six places: the C10X-30 Jira
   description, both C10X-30 comments, this change's `change.md:41`, the archived C10X-28
   `change.md:48-54`, and `test-plan.md` (§3 Phase 2 sequencing note + §6.6's C10X-28 entry).
   The `test-plan.md` corrections belong to this change's doc-sync; the Jira side is a comment at
   finish-work. Archived artifacts are historical record and should **not** be rewritten — the
   correction belongs in the live docs that a future reader acts on.
