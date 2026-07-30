# Auth Error Copy — Audit and Close H-03 Implementation Plan

## Overview

H-03's two deliverables — the auth error mapper (`src/lib/auth-errors.ts`) and the per-entry
OpenRouter banner gate — **already shipped and are on `main`**. They landed as Phase 1 and
Phase 4 §1 of a *different* ticket's change (C10X-28, `ai-candidate-generation-test-2`), with
every commit carrying the scope key `(C10X-28)`.

This plan does not rebuild them. It closes the edges that a side quest under a foreign key
left open, and it widens the `?error=` channel to the one end nobody enforced. Nine of the
eighteen findings in `research.md` are actioned here; the rest are named, attributed, and
routed out.

## Current State Analysis

The core security invariant **holds and is well built** — verified by reading the code in the
main context, not inherited as a claim. `authErrorMessage` never interpolates any part of its
input into its output, every return value is a module-level constant, and the `Object.hasOwn`
guard (`auth-errors.ts:148-153`, from C10X-28's impl-review F1) genuinely closes the
prototype-chain hole. Both routes call it correctly. No URL on this surface carries the
submitted address.

What is open:

- **The mapper was written from `ErrorCode`'s type union, not from these two endpoints' measured
  surface.** It maps `same_password` and `email_exists` (other endpoints' codes, dead here) and
  misses `anonymous_provider_disabled`, which is what GoTrue actually answers for the single most
  common ordinary-user error — a blank e-mail on sign-up. That falls to the catch-all while
  `AUTH_MISSING_CREDENTIALS_MESSAGE` (`auth-errors.ts:49`), written for exactly this case, is
  **dead by construction**.
- **One test observes something other than its title.** `errors.test.ts:107-113` claims to test
  the `name` rung "on `name` alone" and feeds `status: 503`, which reaches the same constant
  through `messageByStatus`. The `MESSAGE_BY_NAME` entry can be deleted with the suite green.
- **The closed set is enforced at one end only.** `AUTH_MESSAGES` is exported and asserted where
  messages are *produced*; `signin.astro:5` / `signup.astro:5` read `?error=` unconstrained and
  `ServerError.tsx:8,13` renders any non-empty string.
- **The banner gate has zero automated coverage** — confirmed by enumerated search. The whole
  deliverable rests on three manual browser checks in an archived `verification.md`.
- **Comment rot is the signature of the split**: five comments in `errors.test.ts` state things
  the code contradicts, `forms.ts:14-15` claims a defect class is closed while it lives in two
  endpoints, and four cross-references cite F-numbers that resolve against the wrong review.

## Desired End State

A user who fails to sign in or sign up reads a Polish sentence that is **true** — including when
the failure is not retryable, where today the catch-all says "spróbuj ponownie" and lies. The
`?error=` channel carries only this project's own copy in **both** directions: produced from the
closed set and refused on read if it is not in it. The banner gate's decision is a pure function
with tests, so the self-hiding "gate the block instead of the entry" regression is catchable. The
auth error surface announces itself to a screen reader and its fields associate with their errors.
No file in `src/` reads `import.meta.env`.

Verification: `npm test` green with new cases, each new claim shown falsifiable by a
deliberate-breakage run, and the three manual browser checks re-recorded.

### Key Discoveries

- **Fixing R1 turns an existing green test red, by design.** `errors.test.ts:363-382` asserts
  `toBe(AUTH_GENERIC_MESSAGE)` for a `File` `email` part on signup — that request sends `email: ""`,
  which GoTrue answers with `anonymous_provider_disabled`. The comment at `:352-359` predicts this
  exactly: *"pinning it means the day someone maps that code the test goes red and the improvement
  gets noticed instead of landing silently."* The mechanism is working as designed; the map entry
  and that assertion must move in **one commit** or Phase 1 leaves the suite red.
- **`AUTH_MISSING_CREDENTIALS_MESSAGE` is unreachable, and the proof is in `formString`.**
  `AuthInvalidCredentialsError` is thrown only when the credentials object **lacks** the `email`
  key (`GoTrueClient.js:667,835`, an `'email' in credentials` test), and `formString`
  (`forms.ts:27-29`) always returns a string. No HTTP input can produce that class.
- **`requiresSession: false` on Supabase is load-bearing, and its test cannot use the real
  `missingConfigs`.** That constant is computed at import time from `astro:env/server`
  (`config-status.ts:28,37`), so under the test runner it always reflects the local stack —
  Supabase configured, OpenRouter not. The one entry whose gating matters most is therefore
  unreachable unless the extracted function takes the list as a **parameter**.
- **`FormField` is not a shared `ui/` primitive**, so adding `aria-invalid` introduces no styling
  change: the `aria-invalid:ring-destructive` classes AGENTS.md describes live on the primitives,
  and `FormField.tsx:57` already carries its own documented `focus-visible:ring-red-400`.
- **Roadmap H-03 is no longer stranded.** `roadmap.md:248` gives H-03's `Change ID` as
  `auth-error-copy` and this change carries that id, so `/10x-archive` will match the row and flip
  it. This **reverses** C10X-28 impl-review F3's recorded conclusion — correctly, because that
  reasoning held only while no change carried this id. No manual edit, no rule broken.

## What We're NOT Doing

- **Not rebuilding the mapper or the banner gate.** Both are on `main` and correct. Every edit
  here is additive or corrective.
- **Auth input validation** — presence, format, length of credentials before the GoTrue call.
  Owned by **C10X-36** (`auth-input-validation`), which will rewrite these routes' input handling.
  Untouched here, and `errors.test.ts`'s existing boundary comment stays.
- **Translating the auth UI to Polish.** `signin.astro`, `signup.astro`, `confirm-email.astro`,
  `SignInForm.tsx`, `SignUpForm.tsx`, `PasswordToggle.tsx` are English (R12) and that sweep is
  **C10X-19**'s. New copy written here goes on `confirm-email.astro` and is written **in English**
  to match the page it lives in — mixing languages inside one short page is worse than the
  existing cross-page mix, and C10X-19 sweeps it in one pass.
- **The unguarded `formData()` and the `as string | null` cast on the two deck endpoints**
  (`decks/index.ts:23`, `decks/[publicId].ts:32`). Owned by **C10X-37**. Only the false *comment*
  about them, in `forms.ts`, is corrected here.
- **A test for `AUTH_UNAVAILABLE_MESSAGE`.** Its branch needs `createClient()` to return `null`,
  i.e. a double of `astro:env/server`. §6.9 confines module doubles to one file and admits them
  only for a claim unreachable otherwise; this claim is not worth that. Recorded as named negative
  space instead (Phase 2).
- **Rendering `Layout.astro` through the Container API.** That opens a page-rendering layer §4
  deliberately does not have. The filter is extracted and unit-tested instead.
- **Any change to `src/pages/api/auth/*.ts`'s control flow.** Phases 1–2 add map entries and test
  cases; the routes' branching is unchanged.

## Implementation Approach

Six phases, ordered so that each one's breakage check is separable from the next one's.

Phase 1 changes production behaviour (new map entries) and carries the coupled test update in the
same phase. Phase 2 hardens tests only — no `src/` change — which is why it comes after: a test
that goes red in Phase 2 cannot be confused with Phase 1's behaviour change. Phases 3–5 are three
independent surfaces (`?error=` channel, banner gate, auth markup). Phase 6 is documents and
whole-change verification.

## Critical Implementation Details

**GoTrue's rate-limit budget is shared and its failure mode is misleading.**
`supabase/config.toml:190` allows 30 sign-in/sign-up requests per 5 minutes per IP;
`tests/fixtures/accounts.ts` spends 4 provisioning the run's accounts and `errors.test.ts` spends
several more. Once the limit bites, GoTrue answers `over_request_rate_limit`, which maps to
`AUTH_RATE_LIMIT_MESSAGE`, so **every equality assertion in the file fails and the run reads as a
validation regression rather than as a rate limit** (`errors.test.ts:225-242`). Two consequences
for this plan: new cases must prefer the shape that returns *before* `createClient` where it can
carry the claim, and a red run on messages nobody touched means "wait five minutes", not "revert".

**Research left two accounts behind in the local `auth.users`.** `probe*-1785435299@example.com`,
created by the probe agent. Harmless to the suite (it provisions its own), cleared by
`npm run db:reset`. Run the Phase 0 baseline knowing they are there.

## Phase 0: Baseline

### Overview

Research deliberately did not run the suite — its live GoTrue probes and the suite share the same
rate-limit budget. Establish the green baseline cleanly before the first edit, so that a red run
later has one hypothesis rather than two.

### Changes Required

None. This phase is measurement only.

### Success Criteria

#### Automated Verification

- Local stack up (`npm run db:start`) and `OPENROUTER_API_KEY` unset
- `npm test` green; record the pass count and file count (expected: 228/228, 19 files per
  test-plan §8)
- `npx vitest run tests/auth/errors.test.ts` green; record the count (expected: 38)
- `npm run lint` exit 0; `npm run build` exit 0

---

## Phase 1: Mapper — reachability and the closed set

### Overview

The mapper was written from a type union that spans every GoTrue surface. Rewrite its table
against what these two endpoints **measurably answer**: add the code that the most common ordinary
error actually produces, add the five config-flip codes whose catch-all copy is actively wrong, and
record the dead/live split so nobody "cleans up" a constant believing it is unused.

### Changes Required

#### 1. The code table

**File**: `src/lib/auth-errors.ts`

**Intent**: Add the codes these two routes can answer with, so the catch-all stops being the
answer to a blank field and stops telling a user to retry something a retry cannot fix.

**Contract**: Six new keys in `MESSAGE_BY_CODE` (`:85-99`). Four need a new exported constant,
which must also be appended to `AUTH_MESSAGES` (`:66-82`) or the closed-set assertion fails — that
coupling is the test doing its job.

| Code | Message | New constant? |
| --- | --- | --- |
| `anonymous_provider_disabled` | `AUTH_MISSING_CREDENTIALS_MESSAGE` — "Podaj adres e-mail i hasło." | no — **revives** the dead one (`:49`) |
| `email_address_not_authorized` | "Ten adres e-mail nie może otrzymać wiadomości z potwierdzeniem. Użyj innego adresu." | yes |
| `email_provider_disabled` | "Logowanie i rejestracja e-mailem są obecnie wyłączone." | yes |
| `captcha_failed` | "Weryfikacja bezpieczeństwa nie powiodła się. Odśwież stronę i spróbuj ponownie." | yes |
| `conflict` | "Trwa inna operacja na tym koncie. Spróbuj ponownie za chwilę." | yes |
| `request_timeout` | `AUTH_NETWORK_MESSAGE` | no — reuse; a timeout *is* the transport story |

The load-bearing property is not the wording but the **retry semantics**: the catch-all's "Spróbuj
ponownie" must not survive on a branch where a retry can never succeed
(`email_address_not_authorized`, `email_provider_disabled`).

#### 2. The reachability record

**File**: `src/lib/auth-errors.ts`

**Intent**: State which constants are live on these two routes and which are defensive redundancy,
so the split is written down once instead of re-derived — and so the next reader does not delete a
constant that guards a config flip.

**Contract**: A comment block naming the dead-by-construction set on these routes
(`AUTH_SAME_PASSWORD_MESSAGE` — an `updateUser` concern, no password-change flow exists;
`AUTH_SESSION_MISSING_MESSAGE` — `session_not_found` does not come back from `/token` or `/signup`)
and the two production-only divergences: `user_already_exists` is answered locally but production
with confirmations on returns **200 with an obfuscated user** (anti-enumeration), and
`email_address_invalid` appears to be hosted-only, locally producing `validation_failed`. Mark
each unverifiable-locally claim as inference, not measurement — several of the new entries above
are exactly that.

**Cite the source of every inferred code string** (plan-review F5). Five of the six new codes
cannot be produced against the local stack, and their `it.each` rows use the **same literal as the
map key** — so the assertion is that the table agrees with itself, and a typo'd or renamed code is
invisible to the suite *and* to Stryker. That is not hypothetical: this module's own header already
warns "a typo in a key is not a compile error … which gives no exhaustiveness checking." A runtime
guard is not available — `@supabase/auth-js/dist/module/lib/error-codes.js` is `export {}`, the
codes exist only as a type. So the record names the artifact instead: all six were checked against
`node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` at auth-js **2.105.3** (hoisted
transitive of `@supabase/supabase-js`), and that path plus that version go in the comment, so a
future reader re-derives from a file rather than trusting prose.

Also correct `:105-121` in place: it now records the measurement *and* its consequence, rather
than recording the measurement and stopping short of the map entry.

#### 3. The coupled test update

**File**: `tests/auth/errors.test.ts`

**Intent**: Move the signup `File`-part assertion to the message the map now produces. This is not
a weakening — the case's real claim is "owned copy from the closed set, never the upstream string",
and it now additionally proves the new entry is reached through the real route.

**Contract**: `:363-382` — `expect(error).toBe(AUTH_GENERIC_MESSAGE)` becomes
`AUTH_MISSING_CREDENTIALS_MESSAGE`; keep `not.toContain("Anonymous")`, the closed-set membership
and the `SENTINEL` absence unchanged. Replace the comment at `:352-359` with what is now true:
the two routes still answer different upstream codes for an empty address, and both now map — the
prediction it recorded has been carried out. Add the new codes as rows in the `it.each(cases)`
table (`:55-68`) and extend the distinct-classes `Set` (`:86-101`, whose `toBe(11)` is a hand-built
count that must move with it).

### Success Criteria

#### Automated Verification

- `npx vitest run tests/auth/errors.test.ts` green, count increased by the new table rows
- `npm test` green — no other file asserts on these constants
- **Breakage check A**: remove the `anonymous_provider_disabled` entry → the signup `File` case
  goes red on the message equality; record the observed string and the split with its denominator
- **Breakage check B**: point one new code at an existing constant instead of its own → its
  `it.each(cases)` row ("maps %s to its own constant", `:70-74`) goes red. **Not** the
  distinct-classes case: that `Set` is built from imported constants and never calls the mapper,
  so it cannot observe a repointed map value — which is exactly the false claim Phase 6 §1 row 4
  deletes. Record the split with its denominator
- `npm run lint` exit 0

#### Manual Verification

- Submit the sign-up form with an empty e-mail in a browser and read the banner: "Podaj adres
  e-mail i hasło.", not the catch-all
- Confirm the sign-**in** route still answers `AUTH_VALIDATION_MESSAGE` for the same input, and
  that the asymmetry is acceptable copy (GoTrue answers a different code per route — this is
  upstream's choice, recorded, not a bug to fix here)

---

## Phase 2: Falsifiability and the coverage asymmetry

### Overview

Two test-level defects, no `src/` change. One assertion observes a rung other than the one it
names; one of two near-identical routes has half the branch coverage of the other.

### Changes Required

#### 1. The `name` rung, observed on `name` alone

**File**: `tests/auth/errors.test.ts`

**Intent**: Make the `AuthRetryableFetchError` entry in `MESSAGE_BY_NAME` killable. Today the case
titled "on `name` alone" supplies `status: 503`, and `messageByStatus(503)` returns the *same*
constant (`auth-errors.ts:130`), so the entry can be deleted with the suite green.

**Contract**: `:107-113` — feed an input that only the `name` rung can answer. A real transport
failure carries `status: 0` (`@supabase/auth-js/.../fetch.js`, `handleError` →
`AuthRetryableFetchError(msg, 0)`), which is both faithful and unambiguous. Keep a separate
assertion for the `status ≥ 500` rung so removing *that* is also catchable — the two rungs need
two inputs, which is the whole finding.

#### 2. `signup.ts`'s discriminator, tested on both branches

**File**: `tests/auth/errors.test.ts`

**Intent**: `signup.ts:19`'s `isFormContentType ? GENERIC : VALIDATION` is half tested — only the
non-form branch. A regression collapsing it to "always VALIDATION" stays green today, while
`signin.ts`'s identical discriminator is covered on both branches (`:251`, `:278`).

**Contract**: One case mirroring `signin.test`'s `:278` — a body announced as `multipart/form-data`
with a boundary the body does not contain — asserting `AUTH_GENERIC_MESSAGE` by **equality** plus
`not.toBe(AUTH_VALIDATION_MESSAGE)`, which is the pair that makes it discriminating rather than
decorative. This branch returns before `createClient`, so it costs no GoTrue budget.

#### 3. `AUTH_UNAVAILABLE_MESSAGE` as named negative space

**File**: `tests/auth/errors.test.ts`

**Intent**: The one constant in `AUTH_MESSAGES` that nothing observes beyond the non-emptiness
scan. Say so where a reader will meet it, rather than leaving its absence to be inferred from a
table.

**Contract**: A comment naming the constant, why it is untested (its branch needs
`createClient() === null`, i.e. an `astro:env/server` double — §6.9), and that the decision is
deliberate. No assertion.

### Success Criteria

#### Automated Verification

- `npm test` green
- **Breakage check C**: delete the `AuthRetryableFetchError` entry from `MESSAGE_BY_NAME` → the
  name-rung case goes red. Record the split; the point of the phase is that this run was
  **impossible before it**
- **Breakage check D**: collapse `signup.ts:19` to always `AUTH_VALIDATION_MESSAGE` → the new
  signup case goes red while the existing non-form case stays green
- `npm run lint` exit 0

---

## Phase 3: The `?error=` channel, both ends

### Overview

`AUTH_MESSAGES` is a closed set enforced where messages are produced and ignored where they are
consumed. A crafted link renders attacker-chosen text inside a trust-carrying red banner on the
sign-in page — not XSS (React escapes, and the roadmap already records that), but content
injection: a low-grade phishing vector. Separately, the parameter is never cleared from the URL,
so F5 replays a stale error and the message persists in history.

### Changes Required

#### 1. Membership check on the read side

**File**: `src/lib/auth-errors.ts`

**Intent**: A helper that turns an untrusted URL parameter into either one of this project's own
messages or nothing. Placed beside the closed set it enforces, so the two cannot drift apart.

**Contract**: A pure exported function taking the raw `searchParams.get("error")` value
(`string | null`) and returning `string | null` — the value if and only if it is a member of
`AUTH_MESSAGES`, otherwise `null`. `ServerError.tsx:8` already renders nothing for a falsy
message, so a rejected value degrades to "no banner", which is the correct failure: an error the
app cannot vouch for is not shown as one.

#### 2. Both auth pages read through it

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Route the existing `Astro.url.searchParams.get("error")` read (`:5` in both) through
the helper before it reaches `serverError`.

**Contract**: The value passed to `<SignInForm serverError={…}>` / `<SignUpForm serverError={…}>`
is the helper's return, not the raw parameter. No other change to either page.

#### 3. Clearing the parameter on mount

**File**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: `lessons.md:89-94` records the rule ("Na mount wyczyść `open`/`error` z URL,
`history.replaceState`"), four other islands follow it (`FlashcardWorkspace.tsx:102`,
`DeckActions.tsx:36`, `CreateDeckModal.tsx:30`, `CandidateReviewWorkspace.tsx:91`), and nothing
in `src/components/auth/` or `src/pages/auth/` does. Consequence: F5 replays a stale error and the
message stays in the address bar and browser history.

**Contract**: A mount effect stripping only the `error` key from the current URL via
`history.replaceState`, preserving every other parameter and the path. The banner must stay
visible — `serverError` is already captured as a prop before the effect runs, so removing the
parameter does not clear the message. Only half of the recorded rule transfers: its `open`
parameter is a modal concern that does not exist on these pages.

#### 4. Tests

**File**: `tests/auth/errors.test.ts`

**Intent**: Pin the read side the way the write side is already pinned. The helper is pure, so
this needs no database and no renderer.

**Contract**: Cases for a member value (returned verbatim), a crafted non-member string (rejected),
the empty string and `null` (rejected), and a **positive control** — every constant in
`AUTH_MESSAGES` passes, so a helper that rejects everything cannot read as protection. That
control is what makes the rest falsifiable.

### Success Criteria

#### Automated Verification

- `npm test` green; the existing endpoint cases, which assert on the redirect `Location`, are
  unaffected — they never render a page
- **Breakage check E**: make the helper return its input unchanged → the crafted-value case goes
  red while the member case stays green
- `npm run lint` exit 0; `npm run build` exit 0

#### Manual Verification

- Open `/auth/signin?error=Twoje%20konto%20zosta%C5%82o%20przej%C4%99te` in a browser: **no banner**
- Fail a real sign-in: banner shows the mapped Polish message, and the address bar has **no**
  `error=` parameter after the page settles
- Press F5 on that page: no banner replays, the form is clean
- Browser Back/Forward across the sign-in still works (`replaceState`, not `pushState`)

---

## Phase 4: The banner gate — make the decision testable

### Overview

H-03's second deliverable has zero automated coverage: nothing under `tests/` or `evals/` touches
`config-status.ts`, `missingConfigs`, `requiresSession`, `Layout.astro` or `Banner.astro`, and
neither Polish banner string appears in any test file. The whole thing rests on three manual
browser checks in an archived `verification.md`.

The invariant at stake is self-hiding: gating the *block* instead of each *entry* would hide the
Supabase warning exactly when Supabase is broken, because an unconfigured Supabase forces
`locals.user = null` on every path (`supabase.ts:6-9` + `middleware.ts:50,52`). A regression there
is invisible precisely when it costs the most.

### Changes Required

#### 1. Extract the filter

**File**: `src/lib/config-status.ts`, `src/layouts/Layout.astro`

**Intent**: Move the per-entry filter out of the layout so the decision can be asserted without a
renderer — the pattern C10X-27 established when it extracted `readJsonResponse` and `rateOutcome`
out of islands for exactly this reason (test-plan §7).

**Contract**: An exported pure function taking **the entry list as a parameter** plus a boolean
session flag, returning the entries to show. The list must be a parameter, not a closure over
`missingConfigs` — that constant is computed at import time from `astro:env/server`
(`config-status.ts:28,37`), so under the runner it always reflects the local stack (Supabase
configured, OpenRouter not) and the one entry whose gating matters most would be untestable.
`Layout.astro:17` calls it with `missingConfigs` and `Boolean(Astro.locals.user)`; its existing
comment block (`:12-16`) moves to the function, where it now documents behaviour that has a test.

**And correct the comment this extraction falsifies** (plan-review F4). `config-status.ts:13-15`
— the `requiresSession` field's own doc comment — currently reads "So it is decided PER ENTRY, and
**`Layout.astro` (not this module) applies it**". Moving the filter here makes that false on
landing, which would be a fresh instance of exactly the rot Phase 6 exists to end. Rewrite it to
say this module decides it while `Layout.astro` supplies the per-request session flag, and **keep
the reason for the split** — `configured` is computed once at import time from `astro:env/server`,
"is there a session" is per-request — because that reason is also why the filter takes its list as
a parameter. The self-hiding-Supabase paragraph below it (`:17-21`) is unaffected and stays.

#### 2. Tests

**File**: `tests/lib/config-status.test.ts` (new — mirrors `src/lib/`, per §6.1)

**Intent**: Pin the per-entry semantics, with the Supabase invariant as the case that matters.

**Contract**: Fabricated entries, never the real `missingConfigs`. Cases: a `requiresSession: true`
entry hidden without a session and shown with one; a `requiresSession: false` entry shown in
**both** states — that is the Supabase invariant, and it is the one a block-level gate breaks; a
mixed list signed-out returning only the ungated entry (the case that separates per-entry from
per-block); an empty list; and a **positive control** — signed in, everything shown — so a
function that hides everything cannot read as a working gate.

#### 3. Remove the dead export

**File**: `src/lib/openrouter.ts`

**Intent**: `isOpenRouterConfigured` (`:62-64`) has zero references repo-wide outside its own
definition — `generateCandidates` re-reads the env var directly (`:154`) and `config-status.ts:37`
does too. Flagged dead in C10X-28's plan-review grounding; still dead.

**Contract**: Delete the export. Verify by enumerated search that nothing imports it before and
that the build is clean after.

### Success Criteria

#### Automated Verification

- `npm test` green, new file collected
- **Breakage check F**: change the filter to gate the whole block when signed out (the regression
  the design exists to prevent) → the `requiresSession: false` signed-out case goes red while the
  `requiresSession: true` cases stay green. Record the split — that asymmetry is the evidence
- Enumerated search for `isOpenRouterConfigured` returns only its former definition site (empty
  after deletion)
- `npm run lint` exit 0; `npm run build` exit 0

#### Manual Verification

- Signed out with `OPENROUTER_API_KEY` unset: **no** OpenRouter banner on the landing and auth
  pages
- Signed in with it unset: OpenRouter banner present on a protected page
- With `SUPABASE_URL`/`SUPABASE_KEY` unset: the Supabase banner shows **while signed out** — the
  invariant. Restore `.env` afterwards and confirm the restore by a diff against a backup taken
  first

---

## Phase 5: The auth surface — accessibility and the env violation

### Overview

Two unrelated defects on the same surface. The error surface is invisible to a screen reader
beyond its text, and `confirm-email.astro:4` is the **only** `import.meta.env` in all of `src/`,
against a hard AGENTS.md rule — with a heuristic that is also substantively wrong.

### Changes Required

#### 1. Announce the server error

**File**: `src/components/auth/ServerError.tsx`

**Intent**: The banner appears as the result of a form submission and is the only feedback a
failed sign-in gives. Today it is a plain `<p>` (`:11-14`) with no live-region semantics.

**Contract**: `role="alert"` on the rendered element. Know the limitation and do not overclaim it:
this content is present at mount after a full-page redirect, not inserted dynamically, so
announcement behaviour varies by screen reader — this is the standard approach, not a guarantee.
That is what the manual check below is for.

**The blast radius is deliberately wider than auth, and that is a decision, not an oversight**
(plan-review F2). `ServerError` is not an auth-only component: it is imported by **eight** other
components at **eleven** call sites — `CreateDeckModal:80`, `DeckActions:101`,
`CreateFlashcardModal:121`, `FlashcardItem:159`, `FlashcardWorkspace:184`, `GeneratorForm:312`,
`CandidateItem:175`, `CandidateReviewWorkspace:209`, `StudySession:142,311`. Every one of those
renders it **dynamically** (`{status === "error" && <ServerError …/>}`), so `role="alert"` fires
harder there than on auth, where the node is present at mount — i.e. the shared edit is *more*
correct off this surface than on it, which is why it is taken shared rather than behind an opt-in
prop. lessons.md's "Poleruj tylko własne komponenty slice'a — zakres sąsiednich rozstrzygaj PRZED
budową" is the rule this could have violated; it is settled here, before the build, as in scope.
Two consequences: the manual verification below must cover one **dynamic** site as well as auth,
and Phase 6 §4's test-plan entry must record the eleven sites rather than presenting this as an
auth-only change.

#### 2. Associate fields with their errors

**File**: `src/components/auth/FormField.tsx`

**Intent**: The error `<p>` (`:62-66`) is linked to its input visually only — no `aria-invalid`,
no `aria-describedby`. Both forms use this component, so one edit covers six fields.

**Contract**: `aria-invalid` on the input reflecting the error state, and `aria-describedby`
pointing at the error paragraph, which needs a stable id derived from the field id. Only when an
error is present — a dangling `aria-describedby` is worse than none. **No visual change is
expected**: `FormField` is not a shared `ui/` primitive, so it carries none of the
`aria-invalid:ring-*` classes AGENTS.md describes, and its own documented red ring
(`:57`, `focus-visible:ring-red-400`) is untouched.

#### 3. Autocomplete on the credential fields

**File**: `src/components/auth/FormField.tsx`, `src/components/auth/SignInForm.tsx`,
`src/components/auth/SignUpForm.tsx`

**Intent**: No `autocomplete` anywhere on these forms, so password managers and browser fill are
working blind.

**Contract**: An optional pass-through prop on `FormField`, applied to the input. Values by field:
`email` on both e-mail fields, `current-password` on sign-in's password, `new-password` on
sign-up's password **and** its confirm field.

#### 4. Remove the `import.meta.env` branch

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: `const isAutoConfirmed = import.meta.env.DEV;` (`:4`) breaks AGENTS.md's "never
`import.meta.env` or `process.env`", and the heuristic is wrong on its own terms: `DEV` is a build
flag, not "confirmations are off", so a production deploy with confirmations disabled shows "Check
your email" for mail that is never sent.

**Contract**: Delete the branch and the `isAutoConfirmed`/`content` pair; render one copy that is
true under **either** GoTrue configuration — the account exists, a confirmation link may have been
sent and should be opened if it arrives, and sign-in is the next step either way. English, matching
the page (see What We're NOT Doing). Verify by enumerated search that `src/` afterwards contains
**zero** `import.meta.env` occurrences.

### Success Criteria

#### Automated Verification

- `npm test` green — no test asserts on this markup, which is itself the §7 negative space
- Enumerated search: zero `import.meta.env` and zero `process.env` under `src/`
- `npm run lint` exit 0 (`eslint-plugin-jsx-a11y` runs here); `npm run build` exit 0

#### Manual Verification

- Fail a sign-in with a screen reader active: the error is announced, not merely rendered
- **The shared-component check**: provoke a `ServerError` on one **dynamic** site off this surface
  (`GeneratorForm`'s error branch is the cheapest) with the screen reader active — the error is
  announced once, not twice, and nothing about its rendering changed
- Focus an invalid field: the error text is read as its description
- The error ring and the neutral focus ring are unchanged from before the edit (side-by-side)
- A password manager offers to fill on sign-in and to save on sign-up
- `/auth/confirm-email` reads correctly both locally (confirmations off) and against a
  confirmations-on configuration — the copy must not lie in either

---

## Phase 6: Comments, pointers, documents and whole-change verification

### Overview

Comment rot is the signature of work done under a foreign key: the prose carried the attribution
faithfully, and the cross-references rotted because two tickets' reviews coexist for one branch.
Five comments state things the code contradicts, and one of them the *source module* had already
measured false and corrected — while its twin in the test file was left standing.

### Changes Required

#### 1. The five false comments

**File**: `tests/auth/errors.test.ts`

**Intent**: A comment that contradicts the code is worse than no comment: it is what the next
contributor reasons from.

**Contract**: Correct each, in place, keeping the reason the comment existed:

| Location | The false claim | The correction |
| --- | --- | --- |
| `:115-121` | an empty field reaches `AuthInvalidCredentialsError` via `form.get("email") as string` | the cast is gone (`formString`), and no HTTP input can produce that class — the case now covers a defensive entry, and Phase 1's map entry is what covers the empty field |
| `:104-106` | without the `name` link a transport failure would read "popraw dane w formularzu" | the fallback is `AUTH_GENERIC_MESSAGE`, or `AUTH_NETWORK_MESSAGE` at 5xx; `AUTH_VALIDATION_MESSAGE` is reachable only via `validation_failed` |
| `:76-78` | the non-emptiness `it.each` kills every `StringLiteral → ""` mutant | the mapper branches on **truthiness** (`:150`), so a `""` constant falls through to the catch-all and is non-empty. The closed-set case is what kills that class, and its own comment (`:140-145`) already says so correctly |
| `:83-85` | "keeps the distinct code classes distinct" breaks on a mutant repointing a map key | the `Set` is built from imported constants and never calls the mapper — it guards against a human unifying two constants' copy. A fair guard, wrongly captioned |
| `:38-40` | "the one endpoint case at the bottom" | there are six endpoint cases, three of which reach real GoTrue |

Leave `:143-145` alone — its claim about exactly three constants surviving the `→ ""` mutants was
re-derived independently in research and is exactly right.

#### 2. Cross-ticket pointer rot

**File**: `tests/auth/errors.test.ts`, `tests/lib/forms.test.ts`, plus the three files named in the
table below (one of them under `context/foundation/`, two archived)

**Intent**: `errors.test.ts:225,269,322` and `forms.test.ts:9` cite "impl-review F10 / F7 / F4 / F5".
Those are **C10X-30**'s findings, but this file shipped under C10X-28, whose own impl-review has an
F4 and F7 with entirely different content. A reader opening "the impl-review for this file's
change" lands on the wrong findings.

**Contract**: Qualify each F-number with its owning ticket. Note the citation at `:270` is at
`:269`.

**The stale breakage denominator is NOT in these two files — corrected by plan-review F3.** This
contract used to say "also correct the recorded '1 of 33 red' here"; grepped repo-wide, that
string appears in neither test file. It lives in three places, and two of them are archived:

| Where | What it says | How it is corrected |
| --- | --- | --- |
| `context/foundation/test-plan.md:1352` | "`tests/auth/errors.test.ts` (33 cases)" | edited in place, inside Phase 6 §4's edit |
| `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md:48` | "exactly 1 of 33 red" | **dated correction line, never a rewrite** |
| …`/reviews/impl-review.md:93,334` | "1 of 33 red" ×2 | same |

The archived rule is the project's own precedent (test-plan §8; C10X-30 corrected the "4xx"
wording that way): an archived artifact records what was actually run on its date, so it gains a
dated line saying the denominator has since moved, and loses nothing.

#### 3. The `forms.ts` claim

**File**: `src/lib/forms.ts`

**Intent**: `:14-15` states the `as string | null` cast defect "existed on every form endpoint in
this repo **until C10X-30**". It still lives verbatim at `decks/index.ts:23` and
`decks/[publicId].ts:32`, plus their unguarded `formData()`. This is known and deferred
(**C10X-37**) — but `forms.ts` is the file a new contributor actually reads at this helper, and it
says the opposite.

**Contract**: State that two endpoints still carry it and name C10X-37 as the owner. Same
correction in `tests/lib/forms.test.ts:4-9`, which says "the four form endpoints" where there are
six `formData()` readers.

#### 4. Test-plan entry

**File**: `context/foundation/test-plan.md`

**Intent**: Record what this change covers, what it deliberately does not, and the counts — in the
file's own idiom, where a coverage claim carries a date and a does-NOT-prove list.

**Contract**: A §6.6 entry for C10X-34 with the claims table, every breakage split with its
denominator as **observed** (never as predicted), and the does-NOT-prove list: the island half and
rendered markup as always (§7), `AUTH_UNAVAILABLE_MESSAGE`, the production-only mappings that are
inference rather than measurement, the two deck endpoints (C10X-37), auth input validation
(C10X-36), and the English auth UI (C10X-19). State that `role="alert"` reached **eleven** call
sites across nine components, not only the two auth forms, and that ten of them are covered by one
manual check rather than by an assertion (§7's island negative space, unchanged). A §8
freshness-ledger line with the suite state. If
the read-side helper or the banner filter suggests a rule a future contributor would otherwise
re-derive, add it to the relevant §6.x — do not invent a subsection that carries only one case.

#### 6. The roadmap's ⚠️ block

**File**: `context/foundation/roadmap.md`

**Intent**: `/10x-archive` closes H-03 correctly — it matches on the exact `Change ID`
(`roadmap.md:248` = `auth-error-copy`) and rewrites the whole `- **Status:**` line, so the
deferral paragraph goes with it. But the skill is explicit that it touches nothing else
("leave `Outcome`, `Prerequisites`, `Risk`, etc. alone"), so the `⚠️ ZAKRES TEGO ELEMENTU JEST JUŻ
ZAIMPLEMENTOWANY — nie buduj go od nowa` bullet survives, still claiming the whole of H-03 shipped
under C10X-28. After this change that is incomplete: nine edges ship here, under this id.

**Contract**: One **dated** line appended to that ⚠️ bullet — the C10X-28 attribution stands for
the mapper and the gate, and C10X-34 / `auth-error-copy` (2026-07-30) closed the edges the side
quest left open. Do not rewrite the bullet and do not touch `- **Status:**`: that line is
`/10x-archive`'s, and editing it here would leave the archive step nothing to match on.

#### 5. Mutation testing on the mapper

**File**: none — a recorded run

**Intent**: The mapper's last Stryker run was 93.33% (42 killed / 3 survived / 0 uncovered), taken
before six new entries and a new exported helper existed. Re-run it narrowed to this module, per
CLAUDE.md's selective policy.

**Contract**: `npx stryker run --mutate "src/lib/auth-errors.ts"`, permanent `mutate` list
untouched. Classify each survivor individually and add an assertion **only** where the mutant is a
user-visible bug. Do not chase 100%. Record the register in the change's `verification.md`.

### Success Criteria

#### Automated Verification

- `npm test` green; record the final pass count and file count
- `npm run lint` exit 0; `npm run build` exit 0
- `git diff -- src/` empty after every deliberate-breakage restore, verified by diff against a
  pristine copy taken before the first edit
- Stryker run completed, score and survivor classification recorded
- Repo-wide search for `1 of 33` / `33 cases` returns only occurrences that now carry a dated
  correction (the three files in §2's table) — the denominator rot is closed everywhere it lives,
  not only where it was first looked for

#### Manual Verification

- Every `file:line` cited in the new test-plan entry resolves on disk (the pointer-rot class this
  phase exists to end must not be reintroduced by the document that ends it)
- The three manual browser checks from Phases 3–5 are recorded in `verification.md` with what was
  observed, not with what was expected
- `roadmap.md`'s H-03 ⚠️ bullet carries the dated C10X-34 line, and its `- **Status:**` line is
  **unchanged** — that one belongs to `/10x-archive`

---

## Testing Strategy

### Unit Tests

- The read-side membership helper (Phase 3) — member, non-member, empty, `null`, plus the
  all-constants positive control
- The banner filter (Phase 4) — per-entry gating in both session states, the ungated Supabase
  entry, a mixed list, and the everything-shown positive control

### Integration Tests

- `signup.ts`'s malformed-body discriminator on its untested branch (Phase 2), driven through the
  real route with `callEndpoint`
- The existing signup `File` case, re-pointed at the new mapping (Phase 1) — this is the only new
  claim that reaches real GoTrue, and it reuses a request the suite already makes

### Manual Testing Steps

1. Empty e-mail on sign-up → "Podaj adres e-mail i hasło."; empty e-mail on sign-in →
   "Popraw dane w formularzu i spróbuj ponownie." (the routes differ upstream; both are now
   honest)
2. `/auth/signin?error=<crafted text>` → no banner at all
3. Real failed sign-in → banner shown, `error=` gone from the address bar, F5 replays nothing
4. Signed out with no OpenRouter key → no OpenRouter banner; signed in → banner present
5. `.env` with Supabase unset → Supabase banner visible **while signed out**; restore and diff
6. Screen reader on a failed sign-in and on an invalid field; password manager fill/save
7. `/auth/confirm-email` copy read against both confirmation configurations

## Migration Notes

None — no schema change, no migration, no data to move. Nothing here touches `supabase/`.

## References

- Research: `context/changes/auth-error-copy/research.md` (findings R1–R18)
- Roadmap slice: `context/foundation/roadmap.md:245-256` (H-03, `Change ID: auth-error-copy`)
- Prior delivery: `context/archive/2026-07-26-ai-candidate-generation-test-2/` — `plan.md:324-450`
  (Phase 1 as contracted), `:626-700` (Phase 4 §1, the banner gate),
  `reviews/impl-review.md:61-93` (F1, the `Object.hasOwn` fix), `:136-177` (F3, the roadmap
  deferral this change resolves), `verification.md` §Phase 1 and §Phase 4 (the manual checks the
  banner gate rests on)
- The `?error=` URL-cleanup rule: `context/foundation/lessons.md:89-94`
- Redirect-style endpoint testing: `context/foundation/test-plan.md` §6.10
- Module doubles, and why `AUTH_UNAVAILABLE_MESSAGE` gets none: §6.9

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Baseline

#### Automated

- [x] 0.1 Local stack up and `OPENROUTER_API_KEY` unset — ccd0e7e
- [x] 0.2 `npm test` green; pass count and file count recorded — ccd0e7e
- [x] 0.3 `npx vitest run tests/auth/errors.test.ts` green; count recorded — ccd0e7e
- [x] 0.4 `npm run lint` exit 0; `npm run build` exit 0 — ccd0e7e

### Phase 1: Mapper — reachability and the closed set

#### Automated

- [x] 1.1 `npx vitest run tests/auth/errors.test.ts` green, count increased — 1c8f578
- [x] 1.2 `npm test` green — 1c8f578
- [x] 1.3 Breakage check A: remove the `anonymous_provider_disabled` entry → signup File case red; string and split recorded — 1c8f578
- [x] 1.4 Breakage check B: repoint a new code at an existing constant → its `it.each` mapping row red; split recorded — 1c8f578
- [x] 1.5 `npm run lint` exit 0 — 1c8f578

#### Manual

- [x] 1.6 Empty e-mail on sign-up shows the missing-credentials message in a browser — 1c8f578
- [x] 1.7 Sign-in's differing answer for the same input confirmed acceptable and recorded — 1c8f578

### Phase 2: Falsifiability and the coverage asymmetry

#### Automated

- [x] 2.1 `npm test` green
- [x] 2.2 Breakage check C: delete the `AuthRetryableFetchError` entry → name-rung case red; split recorded
- [x] 2.3 Breakage check D: collapse `signup.ts:19` to one branch → new signup case red, existing case green
- [x] 2.4 `npm run lint` exit 0

### Phase 3: The `?error=` channel, both ends

#### Automated

- [ ] 3.1 `npm test` green; existing endpoint cases unaffected
- [ ] 3.2 Breakage check E: helper returns its input unchanged → crafted-value case red, member case green
- [ ] 3.3 `npm run lint` exit 0; `npm run build` exit 0

#### Manual

- [ ] 3.4 Crafted `?error=` renders no banner
- [ ] 3.5 Real failure shows the banner and the URL carries no `error=` afterwards
- [ ] 3.6 F5 replays nothing; the form is clean
- [ ] 3.7 Browser Back/Forward across sign-in still work (`replaceState`, not `pushState`)

### Phase 4: The banner gate — make the decision testable

#### Automated

- [ ] 4.1 `npm test` green, `tests/lib/config-status.test.ts` collected
- [ ] 4.2 Breakage check F: block-level gate → `requiresSession: false` signed-out case red, others green; split recorded
- [ ] 4.3 `isOpenRouterConfigured` returns zero hits repo-wide
- [ ] 4.4 `npm run lint` exit 0; `npm run build` exit 0

#### Manual

- [ ] 4.5 Signed out, no OpenRouter key → no OpenRouter banner
- [ ] 4.6 Signed in, no OpenRouter key → banner present
- [ ] 4.7 Supabase unset → Supabase banner visible while signed out; `.env` restore verified by diff

### Phase 5: The auth surface — accessibility and the env violation

#### Automated

- [ ] 5.1 `npm test` green
- [ ] 5.2 Zero `import.meta.env` and zero `process.env` under `src/`
- [ ] 5.3 `npm run lint` exit 0; `npm run build` exit 0

#### Manual

- [ ] 5.4 Server error announced by a screen reader
- [ ] 5.5 A `ServerError` on one dynamic non-auth site (`GeneratorForm`) announced once, rendering unchanged
- [ ] 5.6 Field error read as the input's description
- [ ] 5.7 Error ring and neutral focus ring unchanged side-by-side
- [ ] 5.8 Password manager fills on sign-in and offers to save on sign-up
- [ ] 5.9 `/auth/confirm-email` copy true under both confirmation configurations

### Phase 6: Comments, pointers, documents and whole-change verification

#### Automated

- [ ] 6.1 `npm test` green; final pass count and file count recorded
- [ ] 6.2 `npm run lint` exit 0; `npm run build` exit 0
- [ ] 6.3 `git diff -- src/` empty after every breakage restore, verified against a pristine copy
- [ ] 6.4 Stryker run on `src/lib/auth-errors.ts` completed; score and survivor classification recorded
- [ ] 6.5 `1 of 33` / `33 cases` occurrences all carry a dated correction (test-plan + two archived files)

#### Manual

- [ ] 6.6 Every `file:line` in the new test-plan entry resolves on disk
- [ ] 6.7 Manual browser checks from Phases 3–5 recorded in `verification.md` as observed
- [ ] 6.8 roadmap H-03's ⚠️ bullet carries the dated C10X-34 line; its `- **Status:**` line untouched
