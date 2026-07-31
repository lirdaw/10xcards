# Deck Form Hardening Implementation Plan

## Overview

Two deck endpoints read `formData()` unguarded and cast a `FormData` part to `string`, so a
crafted non-form body answers an uncontrolled framework `500` and a `File` part crashes the
handler at `.trim()`. That is C10X-37 — the two endpoints C10X-30's sweep missed. This plan
closes them with the guard the four swept endpoints already carry, and — under the maximum-scope
decision recorded during scoping — closes the **read** side of the `?error=` channel on the deck
surface at the same time, which is the same content-injection class the auth pages closed with
`ownedAuthMessage` and which today renders attacker-chosen text inside this project's own red
banner.

The two halves share one mechanism: a closed set of project-owned messages that the producers
emit and the consumers vouch for. Building that set is what makes both halves assertable, and it
is the largest single piece of work here.

## Current State Analysis

**The defects, read first-hand at `465832e`.**

`src/pages/api/decks/index.ts:22-23` (create) and `src/pages/api/decks/[publicId].ts:31-32`
(rename) both carry:

```ts
const form = await context.request.formData();
const name = ((form.get("name") as string | null) ?? "").trim();
```

Two live consequences: a body that was never a form rejects out of `formData()` as an unhandled
`TypeError` → framework `500` with no project-owned response; a multipart `name` part of type
`File` survives the compile-time cast and throws the same way at `.trim()`.

**Six `formData()` readers exist under `src/pages/api/`, not four.** Four are guarded
(`auth/signin.ts:26`, `auth/signup.ts:17`, `cards/index.ts:49`, `cards/[cardPublicId].ts:41`);
these two are not. Three further endpoints read no body at all (`auth/signout.ts`,
`decks/[publicId]/delete.ts`, `cards/[cardPublicId]/delete.ts`), and three more are JSON
endpoints (`generate.ts`, `study.ts`, `cards/batch.ts`).

**The read side.** Five page-level `?error=` reads exist in `src/`; the two auth pages wrap
theirs, the three deck pages do not:

```
src/pages/decks/index.astro:22
src/pages/decks/[publicId]/index.astro:86
src/pages/decks/[publicId]/review.astro:115
```

Six sinks hang off those three reads. Five render through `ServerError`; the sixth —
`[publicId]/index.astro:149-153` — renders the value **directly in `.astro` markup**, and needs
**no companion parameter**, so a bare `/decks/<id>?error=X` reaches it. Its class list is
`ServerError.tsx:35`'s **plus a leading `mb-4`** — measured, not eyeballed — and it carries neither
`role="alert"` nor the icon. All four sinks on that page
derive from the one `error` const at `:86`, so one wrap closes all four.

**The name rule lives in six places** plus the DB CHECK — `generation-limits.ts:19-20` names it
explicitly as a deliberate leftover ("Out of scope for this change, and named so the next reader
knows it was left, not missed"). Two endpoints and two islands share both the number **and** the
string; `GeneratorForm` shares only the number.

**Existing deck coverage is ownership only.** `tests/isolation/decks.test.ts` (5 `it()`) asserts
no input validation, no malformed body, no `File` part, no boundary, no decoded `error` param, no
duplicate-name case, and no signed-out request. Its own helper comment at `:34-35` already warns
that "the endpoint redirects on failure too … so the status alone proves nothing".

**Neither deck endpoint's own signed-out branch is executed by any test.** `callEndpoint` always
injects `locals.user` (`tests/fixtures/endpoint.ts:88-93`). The middleware covers these routes as
a class (`tests/middleware.test.ts:85`, `:94`, `:110`, `:118`), which is a different claim —
test-plan §6.6 has carried this gap since C10X-27.

## Desired End State

Both deck endpoints answer their own owned redirect on a non-form body and on a `File` part, and
never a `500`. Every `?error=` value the deck surface renders is one the app can vouch for by
equality; anything else degrades to **no banner**. The 1–100 name rule has one definition, and
its two enforcement layers — the endpoint and `deck_name_check` — are provably independent. The
six redirect-style endpoints' own signed-out branches are executed.

Verified by: `npm test` green with the new files; a deliberate-breakage **pair** whose two runs
fail the same cases on **different assertions**; a falsifiability run on each new guard; and a
manual browser pass over the two deck forms and the banner sink.

### Key Discoveries

- **The `errorUrl` ordering constraint does not exist here — measured, not assumed.**
  `decks/index.ts` builds fixed literal URLs inline (`:14`, `:27`, `:33`, `:41`), and
  `[publicId].ts:20` builds `errorUrl` from the **route param**, eleven lines before `formData()`
  is awaited and already UUID-gated at `:17`. Neither endpoint has `[cardPublicId].ts`'s
  constraint. The guard can sit wherever it reads best. (`change.md:12` and C10X-30's
  `follow-ups/review-fixes.md:32-34` both left this open.)
- **The DB CHECK is named `deck_name_check` — measured against the live local stack**, not
  inferred from the `flashcard_front_check` precedent:
  `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid =
  'public.deck'::regclass and contype = 'c'` returns `deck_name_check` /
  `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100)))`.
- **The one-message shape is precedent, not preference.** `cards/index.ts:40-46` states the rule:
  both `formData()` rejection causes share one message because the copy is truthful for both and
  is a literal the handler's other failure branches already carry, so the owned set does not
  grow. The deck endpoints already own exactly such literals. The two-message split
  (`isFormContentType`) exists only on auth, where its catch answered "Popraw dane w formularzu"
  — a claim about the user's input, wrong for a dropped upload.
- **`formString` only narrows** (`src/lib/forms.ts:37-39`): identity for a genuine string, `""`
  for a `File` or a missing part. So a `File` part falls into the endpoint's existing
  `name.length < 1` guard and **needs no new message at all**.
- **The eleven `?error=` literals are already a closed set** — no `.message`, `String(err)` or
  `JSON.stringify` appears on any deck-route branch; `error.code` is read as a discriminator
  only, and both card-side `catch` blocks bind no exception variable. So the fix is the
  `ownedAuthMessage` shape, not a redesign.
- **…but the set is not "deck messages".** The card endpoints redirect to **deck pages**, so the
  set a deck page must vouch for spans deck routes, card routes, and one literal shared by six
  files. Two of the eleven are templates over `FRONT_MAX`/`BACK_MAX` and must be built by
  interpolation, exactly as `tests/validation/cards.test.ts:45-46` builds its expectations.
- **`replaceState` is not a mitigation.** All four islands strip `error`/`open` on mount, but
  every one of them seeds `React.useState(serverError)` at first render, so the value is captured
  before the URL is cleaned. The guard has to sit at the `.astro` read.
- **The count oracle for decks has no `deck_id` to hang on, and both obvious helpers are wrong.**
  `deckNameExists` filters one exact name and `.maybeSingle()`s; `listDecks` has **no WHERE
  clause at all** and decays into a false pass past PostgREST's `max_rows`, exactly as the
  `listDueCounts` denial did (test-plan §6.6, Phase 4).
- **The existing page guard already anticipates this work.**
  `tests/lib/auth-error-param-guard.test.ts:99-101` asserts it does **not** fire on `?open=`,
  with the comment "`open` is read beside `error` on the deck pages". Pointed at
  `src/pages/decks`, the same regexes report three unwrapped reads today.
- **The server's over-length branch is not reachable through the hydrated UI.** Both deck islands
  run a `.trim()`-then-1..100 check and `preventDefault()` on failure
  (`CreateDeckModal.tsx:41-47`, `DeckActions.tsx:46-52`). That is Risk #6's premise, not an
  argument against testing the server.

## What We're NOT Doing

- **Not renaming the DB constraint in a migration.** The name is measured, so a schema change
  buys only DDL cosmetics at the cost of a prod-mutating `db push`, the drift gate, and the
  `violated by some row` restore procedure on top of an already complex breakage pair.
- **Not folding `AUTH_MESSAGES` into the new set.** Two sets side by side, deliberately:
  `auth-errors.ts` carries a mapper, a reachability record and 92.98% mutation coverage, and
  mixing "translate a GoTrue failure" with "vouch for a URL value" in one module is two jobs in
  one file.
- **Not unifying `GeneratorForm`'s copy.** It shares the **number** and gets it from the new
  module; its message names a different thing ("Nazwa **nowej** talii …", with a trailing period)
  and stays as it is. Changing it would be a user-visible copy edit on a surface this ticket does
  not touch.
- **Not testing what an island enforces.** The two deck islands' 1–100 guard stays unasserted
  (§7) — no DOM layer exists and none is added here. Their half is carried by the manual checks.
- **Not adding auth input validation** (presence/format/length before the GoTrue call) — that is
  C10X-36, untouched.
- **Not changing the JSON endpoints' error convention.** `?error=` is the native-form channel;
  `generate.ts`, `study.ts` and `cards/batch.ts` keep their JSON bodies.
- **Not adding e2e, a rate limit, or a `role="alert"` audit beyond the one banner sink.**

## Implementation Approach

Build the shared vocabulary first, then use it. Phase 1 creates two modules — a browser-safe
values module and a server-side closed-set module — and hoists the existing literals into them
with **no behaviour change**, which is what makes Phases 2 and 3 small. Phase 2 is C10X-37
proper. Phase 3 closes the read side. Phases 4 and 5 build the evidence, split by cost (endpoint
+ database vs pure and textual). Phase 6 makes that evidence falsifiable and syncs the documents
that currently say this class is still open.

The module split is load-bearing and is the one architectural constraint here: **`deck-limits.ts`
imports nothing** (mirroring `generation-limits.ts`, so the two islands pay only for the values),
while **`redirect-errors.ts` is server-side only** and may import `flashcards.ts` for the two
templates. An island must never import `redirect-errors.ts` — it would drag a query layer into
the browser bundle. Islands receive their message as a `serverError` prop from the page, as they
already do.

## Critical Implementation Details

**The hoist must be byte-for-byte inert.** Every hoisted literal is a string a test will later
assert by equality and a renderer will later vouch for by equality. `DECK_NAME_MESSAGE` is built
by interpolating `NAME_MIN`/`NAME_MAX`, so it must produce `Nazwa talii musi mieć od 1 do 100
znaków` character for character — including the absence of a trailing period, which is what
distinguishes it from `GeneratorForm`'s. A hoist that "tidies" a string silently removes a set
member and makes the banner disappear rather than fail.

**`!supabase` is checked before `!user` on four of the six endpoints.** `decks/index.ts:13`,
`[publicId].ts:23`, and both delete endpoints redirect on an unconfigured client *first*. So a
signed-out test measures the branch it names only when `SUPABASE_URL`/`SUPABASE_KEY` are set —
which preflight already guarantees. Four of the six also gate on `UUID_RE` before anything else,
so their `params` must carry a well-formed UUID or the case measures the 404 instead. And
`cards/[cardPublicId].ts` reads `formData()` at `:41` *before* its `!user` check at `:64` — the
only one of the six in that order, flagged by its own comment as unchosen — so its signed-out case
must send a real `FormData` or the `catch` answers the deck error URL instead of `/auth/signin`.

## Phase 1: Single-source modules and the closed set

### Overview

Create the two modules and move every affected literal and bound into them. No endpoint's
behaviour changes; this phase is pure extraction, and its whole risk is a string changing under
the move.

### Changes Required

#### 1. Browser-safe values

**File**: `src/lib/deck-limits.ts` (new)

**Intent**: End the deck-name bound's six-way duplication, which `generation-limits.ts:19-20`
names as a deliberate leftover. Mirrors that module's shape and its reason for existing.

**Contract**: Exports `NAME_MIN = 1`, `NAME_MAX = 100`, and `DECK_NAME_MESSAGE` interpolated from
both. **Imports nothing**, so an island pays only for the values. The header must state that
constraint and why (an island importing a query layer is the trade `generation-limits.ts` refused).

#### 2. The closed set and its read-side guard

**File**: `src/lib/redirect-errors.ts` (new)

**Intent**: Give the native-form `?error=` channel one place where its messages are defined, and
put the read-side guard beside the set it enforces so producer and consumer cannot drift — the
property `auth-errors.ts:115` names.

**Contract**: Exports one named constant per literal (nine of its own, plus `DECK_NAME_MESSAGE`
re-exported from `deck-limits.ts`), the two card-content templates built from `FRONT_MAX`/
`BACK_MAX`, a `REDIRECT_MESSAGES: readonly string[]` containing every one of them, and
`ownedRedirectMessage(raw: string | null): string | null` — membership by **equality**, `null` on
anything else. Server-side only; no island may import it. The eleven values:

| Constant | Current sites |
| --- | --- |
| `SUPABASE_UNCONFIGURED_MESSAGE` | six inline copies across all six endpoints |
| `DECK_NAME_MESSAGE` | `decks/index.ts:26`, `[publicId].ts:35` (+ two islands) |
| `DECK_NAME_TAKEN_MESSAGE` | `decks/index.ts:5`, `[publicId].ts:5` — two module consts |
| `DECK_CREATE_FAILED_MESSAGE` | `decks/index.ts:40` |
| `DECK_RENAME_FAILED_MESSAGE` | `[publicId].ts:48` |
| `DECK_DELETE_FAILED_MESSAGE` | `[publicId]/delete.ts:33` |
| `CARD_CREATE_FAILED_MESSAGE` | `cards/index.ts:51`, `:64`, `:79` |
| `CARD_SAVE_FAILED_MESSAGE` | `cards/[cardPublicId].ts:43`, `:76`, `:93` |
| `CARD_DELETE_FAILED_MESSAGE` | `cards/[cardPublicId]/delete.ts:34`, `:44` |
| `CARD_FRONT_MESSAGE` | `cards/index.ts:71`, `[cardPublicId].ts:83` |
| `CARD_BACK_MESSAGE` | `cards/index.ts:74`, `[cardPublicId].ts:86` |

The docblock must carry `ownedAuthMessage`'s three load-bearing properties in this surface's
terms: equality never containment; `null` as the rejection value *because* `ServerError.tsx:8`
renders nothing for a falsy message, so an unvouchable value degrades to no banner; and residence
beside the set. It must also state why this set is separate from `AUTH_MESSAGES` rather than
subsuming it.

#### 3. Producers import instead of declaring

**Files**: all six endpoints under `src/pages/api/decks/`

**Intent**: Make the set the single definition rather than a seventh copy. Drift here is not loud
— a producer's reworded string silently falls out of the set and the banner disappears — so
construction, not a test, has to prevent it.

**Contract**: Every inline `?error=` literal is replaced by an import from
`@/lib/redirect-errors`. The URL-building shape (fixed literal vs `errorUrl` helper) is unchanged
in each file. No message text changes.

#### 4. All six sites take the bound

**Files**: `src/pages/api/decks/index.ts`, `src/pages/api/decks/[publicId].ts`,
`src/components/decks/CreateDeckModal.tsx`, `src/components/decks/DeckActions.tsx`,
`src/components/generate/GeneratorForm.tsx`, `src/pages/api/generate.ts`

**Intent**: Close the bound's six sites — **all six**, the two deck endpoints included. They are
the two this ticket is actually about, and leaving them on a literal would leave the Desired End
State's "one definition" unmet while every criterion in this phase still passed; it would also make
Phase 6's run 1 ("replace `> NAME_MAX` with a literal") inapplicable, since the endpoint would
already hold one. The two deck endpoints and the two deck islands share both the number and the
string and take both; `GeneratorForm` and the generate endpoint share only the number.

**Contract**: `decks/index.ts:25` and `[publicId].ts:34` become
`name.length < NAME_MIN || name.length > NAME_MAX` — the same two lines whose message §3 replaces,
so after this phase both halves of each guard come from `deck-limits.ts`. The deck islands import
`NAME_MIN`/`NAME_MAX`/`DECK_NAME_MESSAGE` and drop their inline copies. `GeneratorForm.tsx:144` keeps its own wording and takes `NAME_MIN`/`NAME_MAX`;
`:282`'s `maxLength` takes `NAME_MAX`. `api/generate.ts:75`'s `newDeckName` schema takes
`.min(NAME_MIN).max(NAME_MAX)`.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite still green at its pre-change count: `npm test`
- No inline copy survives — **message**: `grep -rn "Nazwa talii musi mieć\|Supabase nie jest skonfigurowany\|Nie udało się utworzyć talii" src/` returns only `src/lib/`
- No inline copy survives — **number**: `grep -rn "1 do 100\|length > 100\|max(100)\|maxLength={100}" src/pages/api/decks/ src/pages/api/generate.ts src/components/decks/ src/components/generate/` returns nothing. A message-only grep passes over an endpoint still comparing against a literal `100`, which is the exact gap this criterion exists to close

#### Manual Verification

- Creating a deck with a duplicate name still shows the same Polish copy as before the hoist
- The generate form's new-deck message still reads "Nazwa **nowej** talii … znaków." with its trailing period

**Implementation Note**: Pause here for manual confirmation before Phase 2.

---

## Phase 2: Harden the two deck endpoints (C10X-37)

### Overview

The ticket proper. Apply the guard the four swept endpoints already carry, in the shape
`cards/index.ts:47-54` established.

### Changes Required

#### 1. Guarded body read

**Files**: `src/pages/api/decks/index.ts`, `src/pages/api/decks/[publicId].ts`

**Intent**: Replace the unguarded `formData()` and the `as string | null` cast so a crafted
non-form body and a `File` part both answer this endpoint's own redirect instead of a framework
`500`.

**Contract**: `formData()` moves inside a `try`; the `catch` redirects to the endpoint's existing
`errorUrl`/literal URL carrying its own already-owned failure literal —
`DECK_CREATE_FAILED_MESSAGE` on create, `DECK_RENAME_FAILED_MESSAGE` on rename. The field read
becomes `formString(form.get("name")).trim()`. **One message for both rejection causes**, not
auth's two-message split: the copy reads as "the operation failed" and is truthful for both, and
it is already a set member, so the closed set does not grow. A `File` part needs no new message —
`formString` returns `""` and it falls into the existing `name.length < 1` guard. Record that
reasoning at the site, as `cards/index.ts:40-46` does.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Full suite still green: `npm test`

#### Manual Verification

- Creating and renaming a deck through the browser is unchanged (happy path, duplicate name, empty name)

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: Close the read side on the deck surface

### Overview

Wrap the three raw reads, and retire the one banner sink that a component-level fix could never
reach.

### Changes Required

#### 1. Vouch for the parameter at the read

**Files**: `src/pages/decks/index.astro`, `src/pages/decks/[publicId]/index.astro`,
`src/pages/decks/[publicId]/review.astro`

**Intent**: A crafted `?error=` link currently renders attacker-chosen text inside this project's
trust-carrying red banner. Wrapping at the read is the only place that works: every island seeds
`useState(serverError)` at first render, so their `replaceState` cleanup happens too late.

**Contract**: Each page's `Astro.url.searchParams.get("error")` becomes
`ownedRedirectMessage(Astro.url.searchParams.get("error"))`, **on one line** — the page guard in
Phase 5 asserts per line, so a split expression trips it. On `[publicId]/index.astro:86` this one
wrap covers all four of that page's sinks, which all derive from the same const.

#### 2. Retire the non-component banner

**File**: `src/pages/decks/[publicId]/index.astro`

**Intent**: `:149-153` renders the banner in raw `.astro` markup — the thirteenth render of a
banner that eleven components get from one place, and the one a change to `ServerError.tsx` would
never reach. It also lacks `role="alert"`, so it is the only red banner on this surface a screen
reader is never told about.

**Contract**: The markup block is replaced by
`<div class="mb-4"><ServerError message={bannerError} /></div>`. The wrapper is not decoration:
the page's `<p>` carries `mb-4` and `ServerError.tsx:35` does **not**, and the component accepts
only `message` — no `className` — so a bare swap deletes the only spacing between this banner and
`FlashcardWorkspace` below it. Giving the component a `className` prop instead would edit a
surface with twelve call sites to fix one; the wrapper keeps the blast radius at this page. Every
other class already matches, so the visible delta is the added `CircleAlert` icon and the
behavioural delta is `role="alert"`.

**What `role="alert"` buys here is the weaker half, and the verification must not overclaim it.**
`ServerError.tsx:12-19` records the distinction: a live region already present at MOUNT is not
reliably announced, and the role earns its keep at the ten DYNAMIC call sites. This banner arrives
by a full-page redirect, so it is present at mount — the same weak case as the auth forms. The
claim taken here is therefore that the node is **exposed as an alert in the accessibility tree**;
announcement is not claimed on this surface and must not be written into `verification.md` as if
it were. The real gain is consistency: one banner component, one place to change it.

**Keep the `{bannerError && …}` conditional**, wrapping the `<div>` and not just the component.
`ServerError` returns `null` for a falsy message, so the conditional looks redundant — but an
always-rendered wrapper would contribute its `mb-4` on every error-free page load, i.e. trade one
spacing regression for its mirror image. The conditional is what makes the wrapper cost nothing
when there is nothing to show.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite still green: `npm test`
- No raw read survives: `grep -rn 'searchParams.get("error")' src/pages/` shows every hit wrapped

#### Manual Verification

- `/decks?open=create&error=<a project literal>` shows the banner; `/decks?open=create&error=Twoje konto zostało zablokowane, kliknij tutaj` shows **no banner**
- Same pair on `/decks/<id>?open=rename&error=…` and on `/decks/<id>/review?edit=<cardPublicId>&error=…`
- A real deck-delete failure still surfaces the page-level banner, now with its icon — **and the
  gap between it and the card list below is unchanged**, compared against a screenshot taken before
  the swap; the error-free page is unchanged too (the wrapper must not add spacing when silent)
- The page-level banner is exposed as an alert in the accessibility tree (`role="alert"` on the
  rendered node). **Announcement is deliberately not the claim** — the node is present at mount, the
  case `ServerError.tsx:12-19` records as unreliable

**Implementation Note**: Pause here for manual confirmation before Phase 4.

---

## Phase 4: Server-side tests for the deck form rules

### Overview

The evidence for Risk #6 on this surface. Everything here drives the real endpoint against the
real local Postgres and asserts on rows, because a refusal and a success are both a `302`.

### Changes Required

#### 1. Deck content rules on the server

**File**: `tests/validation/decks.test.ts` (new)

**Intent**: Prove that every rule the browser form enforces holds for a request that never went
through it, and that a refusal writes nothing. Modelled on `tests/validation/cards.test.ts`,
whose header (`:11-37`) is the §6.10 rationale in the project's own words.

**Contract**: One file covering create and rename plus a DB-layer `describe`, mirroring
`cards.test.ts`'s coverage of create and edit. Reuse `sized()`, `errorParam()` and the
`post*(deckPublicId, body: BodyInit)` shape so a malformed body travels the same path as a form.
Cases:

- Over-`NAME_MAX` create → refused, nothing written; over-`NAME_MAX` rename → refused, row
  `toEqual(before)`
- Missing, empty and whitespace-only `name` — one indistinguishable refusal, both endpoints
- Non-form body (a **string** body is labelled `application/json` by `callEndpoint`, no header
  override needed) → the endpoint's own owned redirect, both endpoints
- A body announced as a form that does not parse — needs the `headers` override, shape at
  `tests/auth/errors.test.ts:424-443`; **both endpoints**
- A multipart `name` part of type `File` → falls into the length guard, existing message; **both
  endpoints** (on rename it is the only one of these four that gets a real row oracle)
- **Boundary controls**: create and rename at exactly `NAME_MAX`, plus a re-read asserting the
  stored string is the submitted one — length **and** equality, since a silent truncation to the
  bound satisfies a length check alone
- The trim direction: a `NAME_MAX`-character name padded with trailing whitespace is **accepted**
  and stored at exactly `NAME_MAX` (these endpoints trim before measuring, the mirror of
  `/api/generate`)
- No echo: the **raw** `Location`, before decoding, carries neither the case marker nor the run
  suffix
- Duplicate name → `DECK_NAME_TAKEN_MESSAGE`, and the existing deck unchanged

**The count oracle, and it is not one oracle.** Not `deckNameExists` (filters one exact name,
`.maybeSingle()`s) and not `listDecks` (**no WHERE clause at all** — it decays into a false pass
past PostgREST's `max_rows`, exactly as the `listDueCounts` denial did). `deck` has no containing
column, so which oracle a case gets depends on what that case submits. Three classes, and the
split is load-bearing rather than bookkeeping:

- **Rename, every case.** The oracle is the **row**, `toEqual(before)` column for column. It works
  whatever the request carried — an over-length name, an empty one, no form at all — because an
  UPDATE leaves the row identifiable regardless. So **route every nameless case through rename as
  well as create**: rename is where those refusals get a real oracle, and it costs one extra `it()`
  per case rather than new apparatus.
- **Create with a usable name** (over-`NAME_MAX`, the boundary controls, trailing-whitespace,
  duplicate). A raw count filtered by a per-case **name marker** with `.like()`, which works
  because the name under test *is* the marker. Markers must avoid `%` and `_` per
  `tests/fixtures/scoping.ts:31`.
- **Create with no usable name** (missing / empty / whitespace-only, the non-form body, the
  broken-form body, the `File` part). **These have no row oracle, and the plan says so rather than
  faking one.** There is no name to carry a marker, so a marker-scoped count reads `0` before and
  after whatever the endpoint does — an assertion that cannot go red, which is the `listDueCounts`
  false-pass class one table over. A delta count over the account's own decks is not the escape
  either: account A is shared across FILES, and `generate.test.ts` (`newDeckName`) and
  `isolation/decks.test.ts` both create decks as A in parallel workers, so the delta is raceable.
  These cases therefore rest on the `302` plus the decoded `error` **equality**, and that is
  honest for a second reason: `deck_name_check` refuses a `''` name independently, so at the
  endpoint layer there is nothing a row oracle could distinguish. Record the reasoning at the
  site, and carry it into Phase 6's does-NOT-prove list — under run 1's decoupled comparison these
  particular cases attribute nothing to either layer.

**Assertion order is load-bearing**: wherever a case *has* a row/count oracle it goes first and the
decoded `error` equality last, so Phase 6's pair fails the same case on different assertions.
Record why at the site — an unexplained order gets tidied away. The nameless create cases have no
oracle to put first (above), so they are the cases the pair cannot attribute; that is stated, not
hidden.

#### 2. The database refuses independently of the endpoint

**File**: `tests/validation/decks.test.ts` (same file, own `describe`)

**Intent**: Prove the two layers are genuinely independent, which is the only thing that lets
Phase 6's pair attribute a refusal.

**Contract**: A direct RLS-scoped insert **around** the endpoint (never around the lock) of a
101-character name → `23514`, asserted by **code and by constraint name `deck_name_check`**, the
name measured off the live stack rather than inferred. An in-range insert is the positive
control. Boundary strings must be ASCII: `char_length` counts code points while JS `.length`
counts UTF-16 units, so `char_length ≤ .length` always and the CHECK can never reject a name the
endpoint accepted. Deck fixtures carry the run suffix — `deck_user_name_unique` makes a
duplicated insert a loud `23505`, which `tests/setup/retry-transport.ts:37-44` relies on.

### Success Criteria

#### Automated Verification

- New file passes: `npx vitest run tests/validation/decks.test.ts`
- Full suite green, count risen by the new cases: `npm test`
- Green under a fresh shuffle seed, three times (every mutating control owns its own fixture, §6.2)
- Linting passes: `npm run lint`

#### Manual Verification

- None — this phase is assertions only

**Implementation Note**: Pause here for manual confirmation before Phase 5.

---

## Phase 5: Guards — the closed set, the page wiring, and the signed-out class

### Overview

Three claims no endpoint test can make, all cheap and none needing the database: that the helper
behaves, that the pages still call it, and that six endpoints answer a signed-out caller
themselves.

### Changes Required

#### 1. The closed-set helper

**File**: `tests/lib/redirect-errors.test.ts` (new)

**Intent**: Pin `ownedRedirectMessage`'s three properties. Modelled on the `ownedAuthMessage`
cases in `tests/auth/errors.test.ts`.

**Contract**: Membership by equality for a real member; rejection of a crafted non-member, of a
value that **contains** a real message (the attack appends to trusted copy), and of a
one-character truncation; `null` and `""` handled. **A positive control over the whole set** is
the load-bearing case: without it `() => null` satisfies every rejection case and reads as
perfect protection. Plus a non-emptiness assertion over `REDIRECT_MESSAGES` — an empty constant
renders as no reason at all — and a case pinning the two templates against the live
`FRONT_MAX`/`BACK_MAX` so a moved bound cannot leave a stale copy in the set.

#### 2. The page guard, parameterised over two surfaces

**File**: `tests/lib/auth-error-param-guard.test.ts` → `tests/lib/error-param-guard.test.ts`

**Intent**: The helper being correct says nothing about the pages still calling it. This is a
deletion detector, and it now has two surfaces with **different** helpers, so a single shared
regex would let a deck page wrapped in `ownedAuthMessage` pass — the wrong set for that surface.

**Contract**: `WRAPPED_READ` becomes a factory over the helper name; the file drives a table of
`{ dir, helper, expectedPages, floor }` with one row for `src/pages/auth` /`ownedAuthMessage` and
one for `src/pages/decks` /`ownedRedirectMessage`. Both existing positive controls — the walker
reaches its pages, and the detector fires on the unwrapped form while accepting the wrapped one —
are kept and run per surface. The existing `?open=` non-firing case stays: it was written for
exactly these deck pages. Rename the file (it is no longer auth-only) and update the header,
keeping its "what this proves, and do not read it as more" paragraph.

#### 3. The signed-out branch, as a class

**File**: `tests/validation/signed-out.test.ts` (new)

**Intent**: Close a gap test-plan §6.6 has carried since C10X-27, for **all six** redirect-style
endpoints rather than the two this ticket names — a partial sweep left unstated is precisely the
shape that created C10X-37.

**Contract**: A local helper renders each endpoint with `locals: { user: null }` and no cookie,
bypassing `callEndpoint` (which always injects a user), modelled on `studySignedOut` in
`tests/study/study.test.ts`. **No database.** Each of the six asserts `302` with `Location` equal
to `/auth/signin`. A signed-**in** row is the positive control, so a helper that returned the
sign-in redirect unconditionally cannot read as perfect protection.

Two preconditions, and a row that ignores either measures a different branch while still looking
like a signed-out case:

- **`UUID_RE` runs first on four of the six**, so their `params` must carry a well-formed UUID or
  the case measures the 404 instead.
- **`cards/[cardPublicId].ts` reads the body BEFORE it checks the user** — `formData()` at `:41`,
  `!context.locals.user` at `:64` — so its row must send a real `FormData`. With no body, or with
  the string body `callEndpoint` labels `application/json`, the `catch` at `:42` answers
  `/decks/<id>?error=…&edit=<id>` and the row goes red for a reason that has nothing to do with
  authentication. It is the only one of the six with this ordering; the endpoint's own comment at
  `:29-32` records it as "an ordering nobody chose", so state at the site that the body is a
  precondition of the case and not incidental setup — otherwise the next reader tidies the six rows
  into one uniform shape and re-opens this.

**Naming note for §6.6**: this file is named after the concern, not the resource — §6.2's
one-file-per-resource rule bends here because the claim is about a class of routes, as
`tests/middleware.test.ts` already is. Record the reason.

### Success Criteria

#### Automated Verification

- New and renamed files pass: `npx vitest run tests/lib/redirect-errors.test.ts tests/lib/error-param-guard.test.ts tests/validation/signed-out.test.ts`
- Full suite green: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npx tsc --noEmit`

#### Manual Verification

- None — this phase is assertions only

**Implementation Note**: Pause here for manual confirmation before Phase 6.

---

## Phase 6: Deliberate breakage, and the documents that still say this is open

### Overview

Every assertion above is worth exactly what its falsifiability run says it is. Five checks, each
run, each restored, each restore **verified** rather than assumed.

### Changes Required

#### 1. The breakage pair — endpoint vs database

**Intent**: One run cannot tell "the endpoint caught it" from "the database caught it". The pair
can, because the *failure strings* differ.

**Contract**: Run 1 decouples the endpoint's comparison — replace `> NAME_MAX` with a literal.
**Never raise `NAME_MAX`**: after Phase 1 six sites and the test all import it, so raising it
moves every side together and the suite stays green while proving nothing. Expect the
over-length create and rename cases red **on the message equality**, with their oracles passing —
and that pass is the evidence, since it shows the CHECK absorbed the write. Run 2 keeps run 1's
edit and additionally drops `deck_name_check` against the live local DB
(`docker exec -i … psql` — the `-i` is load-bearing, §6.7). Expect the same cases red **on the
count/row oracle**, plus the DB-layer independence case. Record both splits with their
denominators and their observed failure strings.

**Restoring a dropped CHECK is not symmetric with restoring a function**: the suite persists rows
the constraint forbids while it is absent, so delete those rows — scoped to the run's own decks —
*before* re-adding, then confirm with a `pg_get_constraintdef` before/after `diff`. That diff is
a text match and would read identical for a constraint that came back `NOT VALID`, so probe the
restored bound behaviourally too, inside a rolled-back transaction with an in-range insert as the
positive control.

#### 2. Three more falsifiability runs

**Contract**:
- Neuter `formString` back to a cast on one deck endpoint → the `File`-part case goes red.
- Make `ownedRedirectMessage` return its input unchanged → the rejection cases go red. **What
  stays green is the evidence**: the member case and the whole-set positive control, without
  which `() => null` reads as perfect protection.
- Unwrap one deck page's read → the page guard goes red naming file and line, both its positive
  controls stay green, and `redirect-errors.test.ts` stays **fully green** — which is the whole
  reason the page guard exists.

Every edit is reverted and the revert verified by per-file MD5 against a pristine copy taken
before the edit, plus `git diff -- src/` empty.

#### 3. Documents that currently say this class is open

**Files**: `src/lib/forms.ts`, `src/lib/generation-limits.ts`, `tests/lib/forms.test.ts`,
`context/foundation/test-plan.md`, `context/changes/deck-form-hardening/change.md`,
`context/foundation/jira-map.md`

**Intent**: Three live comments tell a contributor this work is outstanding, and after this
change they would be false in the way this project keeps paying for.

**Contract**:
- `src/lib/forms.ts:16-25` — the paragraph naming the deck pair as unguarded and owned by
  C10X-37 becomes a dated statement that all six readers are now guarded.
- `src/lib/generation-limits.ts:19-20` — "Deliberately NOT here: the deck-name 1..100 bound,
  which lives in six places" becomes a pointer to `deck-limits.ts`.
- `tests/lib/forms.test.ts:5-12` — its header names C10X-37 as outstanding.
- `context/foundation/test-plan.md:1865`, `:2753`, `:2785` — three live references to
  `tests/lib/auth-error-param-guard.test.ts`, which Phase 5 renames. Pointer rot is the failure
  this ledger has already recorded twice (C10X-28's evidence paths, C10X-34's denominators), so
  the rename is not done until these three are repointed. The archived
  `2026-07-30-auth-error-copy/reviews/impl-review.md:128` reference stays as written — archived
  artifacts take a dated correction line, never a rewrite.
- `context/foundation/test-plan.md` — a new §6.6 entry with the claims table, the breakage splits
  and an explicit **does-NOT-prove** list (the island half, the cloud rows, `role="alert"`
  announcement, the other `?error=` producers outside this surface, and — the one a reader would
  otherwise infer wrongly from the phase's headline — that the nameless **create** refusals carry
  no row oracle and so attribute nothing to either enforcement layer); §2's Risk #6 row updated;
  §6.10 extended with the deck pair; §7's third-instance note extended to the deck islands; §8
  freshness ledger entry with the measured suite counts.
- `change.md` — `status: planned` → the implementing/complete progression, and an explicit record
  that the read-side half (C10X-34 impl-review F1, previously unticketed) shipped **under
  C10X-37** by scope decision, so a future reader does not find a follow-up whose fix landed
  under a foreign key.
- `context/foundation/jira-map.md:169-186` — C10X-37's `Change ID` is empty on both sides; this
  is the moment it is filled with `deck-form-hardening`.

### Success Criteria

#### Automated Verification

- Full suite green after every restore: `npm test`
- `git diff -- src/ supabase/` empty after every breakage restore
- Constraint definition identical before/after: `pg_get_constraintdef` diff
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Type checking passes: `npx tsc --noEmit`

#### Manual Verification

- Each breakage run's observed split and failure string recorded in `verification.md` with its denominator
- The restored `deck_name_check` rejects a 101-character name behaviourally, in a rolled-back transaction
- test-plan's new §6.6 entry read back against the code it describes

---

## Testing Strategy

### Unit Tests

- `ownedRedirectMessage`: equality membership, containment rejection, truncation rejection,
  `null`/`""`, whole-set positive control, non-empty constants, templates pinned to live bounds
- The page guard: per-line wrapped/unwrapped detection per surface, two positive controls per
  surface, `?open=` non-firing

### Integration Tests

- Deck create and rename over the real endpoint: over-length, empty/missing/whitespace, non-form
  body, broken form body, `File` part, boundary at `NAME_MAX`, trailing-whitespace acceptance,
  no-echo in the raw `Location`, duplicate name — each with its row/count oracle first
- DB independence: direct RLS-scoped insert → `23514` / `deck_name_check`, with an in-range control
- Signed-out: six endpoints, no database, with a signed-in positive control

### Manual Testing Steps

1. Create a deck normally; create one with a duplicate name; submit an empty name — copy unchanged
2. Rename a deck normally and to a duplicate name — copy unchanged
3. Visit `/decks?open=create&error=<a real project literal>` → banner shows
4. Visit the same with crafted text appended to a real literal → **no banner**
5. Repeat 3–4 on `/decks/<id>?open=rename&error=…` and `/decks/<id>/review?edit=<id>&error=…`
6. Trigger a real deck-delete failure → page-level banner renders through `ServerError`, with icon
7. Confirm the page-level banner is exposed as an alert in the accessibility tree
8. Generate flow: the new-deck name field still caps at 100 and shows its own trailing-period copy

## Performance Considerations

None. The modules add two imports resolved at build time; no query, render or request path
changes shape.

## Migration Notes

**No migration.** `deck_name_check` already exists and its name was measured, so nothing is
pushed to the cloud and the drift gate is not involved. The one operational caveat is local-only:
Phase 6's run 2 drops that constraint against the running local stack and must restore it by the
procedure above — the suite will have written rows the constraint forbids in the meantime.

## References

- Research: `context/changes/deck-form-hardening/research.md`
- Ticket origin: `context/archive/2026-07-28-server-side-validation-test/reviews/impl-review.md:64-110` (F1)
- Read-side origin: `context/archive/2026-07-30-auth-error-copy/reviews/impl-review.md:51-90` (F1)
- Guard pattern: `src/lib/auth-errors.ts:97-120`
- Endpoint pattern: `src/pages/api/decks/[publicId]/cards/index.ts:40-54`
- Test template: `tests/validation/cards.test.ts:11-37`
- Page-guard template: `tests/lib/auth-error-param-guard.test.ts`
- Convention: `context/foundation/test-plan.md` §6.10, §6.3, §6.6 (C10X-30 and C10X-34 entries)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Single-source modules and the closed set

#### Automated

- [ ] 1.1 Type checking passes: `npx tsc --noEmit`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 Build passes: `npm run build`
- [ ] 1.4 Full suite still green at its pre-change count: `npm test`
- [ ] 1.5 No inline copy survives — message (grep returns only `src/lib/`)
- [ ] 1.8 No inline copy survives — number (grep over the six bound sites returns nothing)

#### Manual

- [ ] 1.6 Duplicate-name copy unchanged after the hoist
- [ ] 1.7 Generate form's new-deck message keeps its own wording and trailing period

### Phase 2: Harden the two deck endpoints (C10X-37)

#### Automated

- [ ] 2.1 Type checking passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Full suite still green: `npm test`

#### Manual

- [ ] 2.4 Create and rename unchanged in the browser (happy path, duplicate, empty)

### Phase 3: Close the read side on the deck surface

#### Automated

- [ ] 3.1 Type checking passes: `npx tsc --noEmit`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Full suite still green: `npm test`
- [ ] 3.5 No raw `?error=` read survives in `src/pages/`

#### Manual

- [ ] 3.6 A project literal shows the banner; a crafted value shows none (`/decks`)
- [ ] 3.7 Same pair on the deck page and the review page
- [ ] 3.8 A real deck-delete failure surfaces the page-level banner, with its icon and unchanged spacing
- [ ] 3.9 The page-level banner is exposed as an alert in the accessibility tree (announcement not claimed)

### Phase 4: Server-side tests for the deck form rules

#### Automated

- [ ] 4.1 New file passes: `npx vitest run tests/validation/decks.test.ts`
- [ ] 4.2 Full suite green, count risen by the new cases: `npm test`
- [ ] 4.3 Green under three fresh shuffle seeds
- [ ] 4.4 Linting passes: `npm run lint`

### Phase 5: Guards — the closed set, the page wiring, and the signed-out class

#### Automated

- [ ] 5.1 New and renamed guard files pass
- [ ] 5.2 Full suite green: `npm test`
- [ ] 5.3 Linting passes: `npm run lint`
- [ ] 5.4 Type checking passes: `npx tsc --noEmit`

### Phase 6: Deliberate breakage, and the documents that still say this is open

#### Automated

- [ ] 6.1 Full suite green after every restore: `npm test`
- [ ] 6.2 `git diff -- src/ supabase/` empty after every breakage restore
- [ ] 6.3 Constraint definition identical before/after (`pg_get_constraintdef` diff)
- [ ] 6.4 Linting passes: `npm run lint`
- [ ] 6.5 Build passes: `npm run build`
- [ ] 6.6 Type checking passes: `npx tsc --noEmit`

#### Manual

- [ ] 6.7 Every breakage split and failure string recorded with its denominator
- [ ] 6.8 Restored `deck_name_check` probed behaviourally in a rolled-back transaction
- [ ] 6.9 test-plan's new §6.6 entry read back against the code it describes
