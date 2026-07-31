---
date: 2026-07-30T20:14:33+02:00
researcher: Dawid Liro
git_commit: 674e9195315543b959ef5e0428aa4cd9eb03f44e
branch: main
repository: lirdaw/10xcards
topic: "What did H-03's side-quest delivery under C10X-28 leave unfinished?"
tags: [research, codebase, auth, auth-errors, config-status, banner-gate, c10x-34, h-03]
status: complete
last_updated: 2026-07-30
last_updated_by: Dawid Liro
---

# Research: What did H-03's side-quest delivery under C10X-28 leave unfinished?

**Date**: 2026-07-30T20:14:33+02:00
**Researcher**: Dawid Liro
**Git Commit**: `674e9195315543b959ef5e0428aa4cd9eb03f44e`
**Branch**: `main`
**Repository**: lirdaw/10xcards

## Research Question

C10X-34 (roadmap H-03, change-id `auth-error-copy`) owns two deliverables: the auth
error-copy mapper and the per-entry OpenRouter banner gate. **Both already shipped** — as
Phase 1 and Phase 4 §1 of a *different* ticket's change (C10X-28, `ai-candidate-generation-test-2`,
archived 2026-07-26), with every commit carrying the scope key `(C10X-28)`.

The question is therefore not "how do we build this" but: **work done as a side quest under a
foreign key is where unfinished edges hide — which edges are still open?**

Scope was widened by the owner at research time to the **whole auth front door**, with a hard
instruction to *name* the C10X-19 / C10X-36 / C10X-37 boundaries rather than absorb them.
Method: source reading **plus live measurement** against the local GoTrue.

## Summary

The core security invariant holds and is well built. `authErrorMessage` never interpolates any
part of its input into its output, every return value is a module-level constant, and the
`Object.hasOwn` guard added by C10X-28's impl-review (F1) genuinely closes the prototype-chain
hole. Both routes call it correctly and no URL on this surface carries the submitted address.
That much can be stated as fact, not as inherited claim.

What the side quest left behind falls into five groups:

1. **One live, user-visible defect, measured.** An empty e-mail on sign-up returns the useless
   catch-all, while the constant written for exactly that case (`AUTH_MISSING_CREDENTIALS_MESSAGE`)
   is **dead by construction**. Fix is one map entry.
2. **One production-only risk that cannot be seen locally.** `email_address_not_authorized`
   (built-in Supabase SMTP, non-team address) falls to the same catch-all, whose copy —
   "try again" — is a lie: a retry cannot help.
3. **A falsifiability gap in the very test that names it.** The `AuthRetryableFetchError` entry
   in `MESSAGE_BY_NAME` can be **deleted with the suite staying green**, because the case that
   claims to test it "on `name` alone" supplies a `status` that reaches the same constant.
4. **A deliverable with zero automated coverage.** Nothing anywhere under `tests/` touches the
   banner gate — confirmed by enumerated search, not by assumption.
5. **Comment rot as the signature of the split.** Five comments in the shipped test file state
   things the code contradicts, including one the *source module* explicitly measured false and
   corrected while its twin in the test file was left standing.

One bookkeeping conclusion **reverses** a decision recorded in C10X-28's impl-review — see
§5.1: opening this change under the id `auth-error-copy` has un-stranded roadmap H-03 by
itself.

Confidence is high throughout: reachability claims are backed by 10 verbatim GoTrue probes,
and the code claims by `file:line` reads that were spot-verified in the main context rather
than taken from the sub-agents on trust.

## Detailed Findings

### 1. Mapper reachability — measured, not argued

Ten probes were run against the local stack (`POST /auth/v1/token?grant_type=password` and
`POST /auth/v1/signup`, with the SDK's `X-Supabase-Api-Version: 2024-01-01`). The budget
(30 requests / 5 min / IP, `supabase/config.toml:190`) was not exhausted.

#### R1 — An empty e-mail on sign-up gets the catch-all, and its own constant is dead ⚠️ LIVE DEFECT

Measured: `{"email":"","password":"…"}` → `422 {"code":"anonymous_provider_disabled"}` — GoTrue
reads a blank address as an *anonymous sign-in attempt*. That code is absent from
`MESSAGE_BY_CODE`; `name` is `AuthApiError`, absent from `MESSAGE_BY_NAME`; `422 < 429` and
`< 500`, so `messageByStatus` returns null (`src/lib/auth-errors.ts:128-132`). The user reads
**"Nie udało się dokończyć operacji. Spróbuj ponownie."**

This is the most common ordinary-user error — a blank field — and there is **no server-side
presence check** before the call (that is C10X-36). Meanwhile
`AUTH_MISSING_CREDENTIALS_MESSAGE` ("Podaj adres e-mail i hasło.", `src/lib/auth-errors.ts:49`)
— written for precisely this situation — is unreachable (R7). One map entry pointing
`anonymous_provider_disabled` at that existing constant would fix the message and revive the
constant with no new copy.

The module already **knows** this measurement: `src/lib/auth-errors.ts:105-121` records both
per-route responses and warns "Do not re-derive an empty-field story from this entry." It
records it as a correction to a comment, not as a gap in the mapping. That is the side-quest
signature — the measurement was made in service of another ticket's phase and its consequence
was never followed through.

**Owner: C10X-34.** User-visible: yes. Confidence: high (measured).

#### R2 — `email_address_not_authorized` → catch-all, production-only 🔶 RISK

With e-mail confirmations on and Supabase's built-in SMTP (the production default), a sign-up
from an address outside the project team answers `403 email_address_not_authorized`. Unmapped
→ catch-all → "Spróbuj ponownie", which is actively wrong: a retry can never succeed. Not
reproducible locally (`enable_confirmations = false`, SMTP off), so this is a code-and-docs
inference, not a measurement.

**Owner: C10X-34.** Confidence: medium — the mechanism is certain, the production SMTP
configuration was not verified.

#### R3 — Other reachable-but-unmapped codes

`email_provider_disabled`, `captcha_failed` (would break *every* sign-in the moment captcha is
enabled in the dashboard — the forms send no token), `conflict`, `request_timeout`. All land on
the catch-all. None is reachable under today's configuration; all are config-flip risks worth
recording rather than fixing.

#### Local-vs-production divergences worth carrying

- **Duplicate sign-up.** Locally `422 user_already_exists` → `AUTH_EMAIL_EXISTS_MESSAGE`. In
  production with confirmations on, GoTrue answers **200 with an obfuscated user** (anti-enumeration)
  and never enters the error branch — so that constant is probably dead in production too, and
  the user lands on `/auth/confirm-email`. The plan already knew this about the *manual check*
  (`plan.md:436-442`); what is new is that it makes the constant itself production-dead.
- **Bad e-mail format.** Locally `validation_failed`, **not** `email_address_invalid`. The
  latter — annotated in the source as "the concrete leak" (`src/lib/auth-errors.ts:92-93`),
  because its upstream copy interpolates the submitted address — appears to be hosted-only.
  The mapping is right; it is simply unverifiable locally.

### 2. Tests and comment drift

#### R4 — The `AuthRetryableFetchError` mapping is unobserved ⚠️ FALSIFIABILITY GAP

`tests/auth/errors.test.ts:107-113` is titled "separates a transport failure from a rejected
credential, **on `name` alone**" and feeds `{ name: "AuthRetryableFetchError", status: 503 }`.
But `messageByStatus(503)` returns the *same* `AUTH_NETWORK_MESSAGE`
(`src/lib/auth-errors.ts:130`). The case is green by two paths at once, so **deleting the
`MESSAGE_BY_NAME` entry leaves the suite green**.

The regression this hides is real: a pure network failure carries `status: 0`
(`@supabase/auth-js/dist/module/lib/fetch.js`, `handleError` → `AuthRetryableFetchError(msg, 0)`),
so without the `name` entry the user reads the catch-all instead of "Brak połączenia…". The
fix is one input with `status: 0` (or no status at all).

This is the same class the project has recorded twice before — an assertion that observes
something other than what its title claims (test-plan §6.6's `f.id asc` tie-break, and the
four-policy neuter that passed while the guard was disabled).

#### R5 — Coverage asymmetry between the two near-identical routes

| Branch | `signin.ts` | `signup.ts` |
| --- | --- | --- |
| non-form Content-Type → `AUTH_VALIDATION_MESSAGE` | ✅ `errors.test.ts:251` | ✅ `:328` |
| form Content-Type, broken body → `AUTH_GENERIC_MESSAGE` | ✅ `:278` | ❌ **none** |
| `!supabase` → `AUTH_UNAVAILABLE_MESSAGE` | ❌ | ❌ |
| `if (error)` with a **mapped** code | ✅ `:203` | ❌ (only via the catch-all path at `:363`) |

So `signup.ts:19`'s `isFormContentType ? GENERIC : VALIDATION` discriminator is **half tested**:
a regression collapsing it to "always VALIDATION" stays green. And `AUTH_UNAVAILABLE_MESSAGE`
appears in **no** test file — the one constant in `AUTH_MESSAGES` that nothing observes beyond
the non-emptiness scan, because the unconfigured branch never passes through the mapper.

Note the file's own comment (`errors.test.ts:322-326`) warns that "a copy with no assertion is
exactly what drifts" — while carrying that gap.

#### R6 — Five comments that say things the code contradicts

The calibration example was already known; the audit found four more.

| Location | The claim | Why it is false |
| --- | --- | --- |
| `errors.test.ts:115-121` | empty field reaches `AuthInvalidCredentialsError` via `form.get("email") as string` | the cast is gone (`formString`), and the module itself records the measurement refuting it (`auth-errors.ts:105-121`) |
| `errors.test.ts:104-106` | without the `name` link a transport failure would read "popraw dane w formularzu" | the fallback is `AUTH_GENERIC_MESSAGE`, or `AUTH_NETWORK_MESSAGE` at 5xx; `AUTH_VALIDATION_MESSAGE` is reachable only via `validation_failed` |
| `errors.test.ts:76-78` | the non-emptiness `it.each` kills every `StringLiteral → ""` mutant | the mapper branches on **truthiness** (`:150`), so a `""` constant falls through to the catch-all — non-empty. The closed-set case kills that class, and its own comment (`:140-145`) correctly says so. Two comments claim the same kill; one is wrong |
| `errors.test.ts:83-85` | "keeps the distinct code classes distinct" breaks on a mutant repointing a map key | the Set is built from **imported constants** and never calls the mapper. It guards against a human unifying two constants' copy — a fair guard, wrongly captioned |
| `errors.test.ts:38-40` | "the one endpoint case at the bottom" | there are now six endpoint cases, three of which reach real GoTrue |

Credit where due: `errors.test.ts:143-145`'s claim about exactly three constants surviving the
`→ ""` mutants was re-derived independently and is **exactly right**.

#### R7 — Dead constants and unmapped classes

Dead by construction on these two routes: `AUTH_MISSING_CREDENTIALS_MESSAGE` (see below),
`AUTH_SAME_PASSWORD_MESSAGE` (`same_password` is an `updateUser` concern; this product has no
password-change flow), `AUTH_SESSION_MISSING_MESSAGE` (`session_not_found` does not come back
from `/token` or `/signup`).

The `AUTH_MISSING_CREDENTIALS_MESSAGE` proof, verified in the main context rather than taken on
trust: `AuthInvalidCredentialsError` is thrown only when the credentials object **lacks** the
`email` key (`GoTrueClient.js:667,835`, an `'email' in credentials` test), and
`formString` (`src/lib/forms.ts:27-29`) is `typeof value === "string" ? value : ""` — it always
returns a string, so both routes always pass the key. No HTTP input can produce that class.

Two of the five code-less classes the module header names are unmapped by `name`, though both
land acceptably: `AuthUnknownError` → catch-all (note the inconsistency — a 500 with a JSON body
becomes `AuthApiError(500)` → "network", while a 500 with an HTML body becomes `AuthUnknownError`
→ catch-all: same outage, worse message for the uglier variant) and
`AuthInvalidTokenResponseError` → `AUTH_NETWORK_MESSAGE` via its hardcoded `status: 500`.

**These are defensive redundancy, not damage.** Recorded so nobody "cleans them up" believing
they are live, and so the dead/live split is written down once.

#### R8 — Cross-ticket pointer rot

`errors.test.ts:225,270,322` and `tests/lib/forms.test.ts:9` cite "impl-review F10 / F7 / F4 /
F5" — those are **C10X-30's** review findings, but the file shipped under C10X-28, whose own
impl-review has an F4 and F7 with entirely different content (F7 = duplicated `mark`/`scope`,
F4 = the stale `plan-brief.md`). A reader who opens "the impl-review for this file's change"
lands on the wrong findings. Also: the recorded breakage result "1 of 33 red" now has a
denominator of **38**.

#### R9 — `forms.ts` claims a defect class is closed when it lives in two endpoints

`src/lib/forms.ts:14-15` states the `as string | null` cast defect "existed on every form
endpoint in this repo **until C10X-30**". It still lives at `src/pages/api/decks/index.ts:23`
and `src/pages/api/decks/[publicId].ts:32`, verbatim, plus their unguarded `formData()`. This
is known and deferred (**C10X-37**) and recorded in test-plan §6.6's C10X-30 entry — but
`forms.ts` is the file a new contributor actually reads at this helper, and it says the
opposite. `tests/lib/forms.test.ts:4-9` likewise says "the four form endpoints" where there are
six `formData()` readers.

**Owner: C10X-37 owns the defect; the false comment is cheap to correct here.**

### 3. The banner gate — delivered, and covered by nothing

#### R10 — Zero automated coverage ⚠️ COVERAGE GAP

Nothing under `tests/` or `evals/` imports, renders, or asserts on `config-status.ts`,
`configStatuses`, `missingConfigs`, `requiresSession`, `Layout.astro`, or `Banner.astro`.
Neither Polish banner string appears in any test file. There is no e2e directory. The negative
is trustworthy because the searches were enumerated: by module path, by symbol, by message
string, by the `<strong>Uwaga:</strong>` literal, and repo-wide for the symbols.

**The entire deliverable rests on the three manual browser checks recorded in the archived
`verification.md`.** That is a defensible position — test-plan §7 already says islands and
rendered pages are unreachable by construction — but it was never *stated* for this deliverable,
and the risk row does not say so either.

#### What is genuinely solid here

- **Single chokepoint confirmed.** All 11 pages route through `Layout.astro`, either directly
  (landing, dashboard, the three auth pages) or via `AuthenticatedLayout.astro:2,14`, which wraps
  it. No `.astro` outside `Layout.astro` renders an `<html>` shell; `missingConfigs` has exactly
  one importer (`Layout.astro:4`).
- **The never-gate-Supabase invariant holds.** `createClient` returns null on the first
  statement when env is unset (`src/lib/supabase.ts:6-9`), and middleware is the only writer of
  `locals.user` (`src/middleware.ts:50,52`), so an unconfigured Supabase forces `locals.user =
  null` on every path — which is exactly what makes `requiresSession: false` load-bearing.
- **No other disclosure channel.** `OPENROUTER_API_KEY` is read in two modules only; the only
  request-path consumer is `/api/generate`, which is in `PROTECTED_ROUTES`, so an anonymous
  caller is stopped in middleware before any OpenRouter code runs. Mock mode *is* disclosed in
  card content (`src/lib/openrouter.ts:117`) but only behind a session.

#### R11 — `isOpenRouterConfigured` is dead

Exported at `src/lib/openrouter.ts:62-64`, zero references repo-wide outside its definition.
`generateCandidates` re-reads the env var directly (`:154`) and `config-status.ts:37` does too.
Already flagged as dead in C10X-28's plan-review grounding; still dead.

### 4. The wider auth front door

Reported per the widened scope. **Most of this belongs to other tickets — that is the point of
listing it, not an argument for doing it here.**

#### R12 — The entire auth UI is in English — **C10X-19**

`signin.astro:8,14,17-18`, `signup.astro`, `confirm-email.astro:7-18`, `SignInForm.tsx:21-26,47,53,60,67,82-83`,
`SignUpForm.tsx:26-41,57-62,90,114,129-130`, `PasswordToggle.tsx:14`. So C10X-34's carefully
Polish constants render **inside an English form**: "Email is required" above, "Nieprawidłowy
e-mail lub hasło." below. Against the PRD's "the product's user interface is in Polish".

#### R13 — `?error=` is not validated on the read side 🔶 — **arguably C10X-34**

`signin.astro:5` / `signup.astro:5` take `searchParams.get("error")` unconstrained, and
`ServerError.tsx:8,13` renders any non-empty string. The closed set `AUTH_MESSAGES` exists and
is exported — it is asserted on the **write** side and enforced nowhere on the **read** side. So
a crafted link renders attacker-chosen text inside a trust-carrying red banner on the sign-in
page. Not XSS (React escapes; the roadmap already records that), and the empty/absent param is
handled — this is content injection, a low-grade phishing vector.

Worth deciding rather than assuming: C10X-34 owns the `?error=` channel end to end, and the
membership check is cheap because the set already exists — but this is *widening past* what
shipped under C10X-28.

#### R14 — Auth pages never clear `?error=` from the URL — **C10X-34 or C10X-19, undecided**

`history.replaceState` appears at `FlashcardWorkspace.tsx:102`, `DeckActions.tsx:36`,
`CreateDeckModal.tsx:30`, `CandidateReviewWorkspace.tsx:91` — and **nowhere** in
`src/components/auth/` or `src/pages/auth/`. `lessons.md:89-94` records the rule ("Na mount
wyczyść `open`/`error` z URL"). Consequence: F5 replays a stale error, and the message persists
in the address bar and history. No privacy impact after C10X-28 (only project constants are
there now) — this is stale-state UX. The recorded rule's context is a modal, so only half of it
transfers.

#### R15 — `confirm-email.astro:4` breaks a hard AGENTS.md rule ⚠️ — unowned

`const isAutoConfirmed = import.meta.env.DEV;` — verified in the main context as the **only**
`import.meta.env` occurrence in all of `src/`, against AGENTS.md's "never `import.meta.env` or
`process.env`". `DEV` is a build flag, not a secret, so the rule's *spirit* is arguable; its
letter is not. Separately the heuristic is wrong: "DEV" is not "confirmations are off", so a
production deploy with confirmations disabled shows "Check your email" when no mail is sent.

#### R16 — Accessibility gaps on the error surface — unowned, low confidence on attribution

`ServerError.tsx:11-14` is a plain `<p>` with no `role="alert"` / `aria-live`.
`FormField.tsx:46-59` sets no `aria-invalid` and no `aria-describedby` linking the input to its
error `<p>` (`:62-66`) — the association is visual only. No `autocomplete` (`email`,
`current-password`, `new-password`) anywhere on these forms. Against the PRD's "baseline
keyboard and screen-reader accessibility". C10X-19 is copy and C10X-36 is input rules, so this
looks genuinely unowned.

The error ring colour in `FormField.tsx:57` is **correct** — it is the documented exception in
AGENTS.md, not a stray override.

#### What is already fine on this surface

No URL anywhere on the auth path carries the submitted address (`email=` has zero hits in
`src/`); success paths redirect cleanly (`signin.ts:46` → `/decks`, `signup.ts:36` →
`/auth/confirm-email`); every redirect wraps a closed-set constant in `encodeURIComponent`;
`PasswordToggle` is `type="button"`; the focus ring uses the shared `--ring` token.

### 5. Bookkeeping the split left open

#### R17 — Roadmap H-03 is no longer stranded, and this **reverses** an archived decision ✅

C10X-28's impl-review F3 recorded that `/10x-archive` could never repair H-03's `not started`
row, because archive matches on `Change ID` and the work shipped under
`ai-candidate-generation-test-2`. The owner deliberately deferred the flip; `lessons.md` and
`roadmap.md:71-72` both reserve that flip for `/10x-archive` alone.

That reasoning was correct **for as long as no change carried the id `auth-error-copy`**. This
change does: `roadmap.md:248` gives H-03's `Change ID` as `auth-error-copy`, and the folder
opened today is `context/changes/auth-error-copy/`. So archiving this change will match the row
and flip it — **no manual edit, no rule broken**. Verified in the main context against
`roadmap.md:71-72,248`.

A sub-agent reached the opposite conclusion from a stale reading (it saw `context/changes/` as
holding only a README); recorded here because the correction is the actionable half.

#### R18 — Other documents are in better shape than expected

`jira-map.md` is consistent and current (`:22` roadmap row, `:45` origin-only follow-up row,
`:114-120` and `:166-174` notes). `test-plan.md` **does** attribute the mapper to C10X-34 by
name in its §6.6 C10X-28 entry and in §8 — no coverage is claimed without saying whose it is.
One number is stale there ("33 cases" → 38), which is the counts-rot class the file itself warns
about. The archived `change.md` OPEN list checks out item by item: items 2 and 3 are genuinely
done, items 1 and 5 are what this change closes, item 4 is a standing rule.

## Code References

- `src/lib/auth-errors.ts:44-58` — the 15 exported constants
- `src/lib/auth-errors.ts:85-99` — `MESSAGE_BY_CODE` (the map R1 needs one entry in)
- `src/lib/auth-errors.ts:102-123` — `MESSAGE_BY_NAME`; `:105-121` is the self-correcting comment that measured R1 and stopped short of it
- `src/lib/auth-errors.ts:128-132` — `messageByStatus`, the 429 / ≥500 rungs
- `src/lib/auth-errors.ts:139-157` — the chain, with `Object.hasOwn` at `:148-153`
- `src/pages/api/auth/signin.ts:24-30,34-37,40-44` — malformed-body guard, unconfigured branch, mapper call
- `src/pages/api/auth/signup.ts:15-21,25-28,31-34` — the same three, one of them untested (R5)
- `src/lib/forms.ts:14-15` — the "until C10X-30" claim that R9 refutes; `:27-29` `formString`
- `src/lib/config-status.ts:22,33,43` — `requiresSession` and the two entries
- `src/layouts/Layout.astro:17` — the per-entry filter; `AuthenticatedLayout.astro:2,14` wraps it
- `src/lib/supabase.ts:6-9` + `src/middleware.ts:50,52` — why `requiresSession: false` is load-bearing
- `src/lib/openrouter.ts:62-64` — dead `isOpenRouterConfigured`
- `src/pages/auth/confirm-email.astro:4` — the sole `import.meta.env` in `src/`
- `src/components/auth/ServerError.tsx:8,13` — unconstrained render of `?error=`
- `src/components/auth/FormField.tsx:46-66` — missing `aria-invalid` / `aria-describedby`
- `tests/auth/errors.test.ts:104-113` — the case R4 shows is unobserving; `:76-78,83-85,115-121,38-40` — the false comments
- `tests/auth/errors.test.ts:140-151` — the closed-set case that does the real work
- `roadmap.md:57,71-72,245-256` — H-03's row, the archive-matching rule, the annotated block

## Architecture Insights

- **A closed set is only half a contract until both ends enforce it.** `AUTH_MESSAGES` is
  exported and asserted where messages are *produced*, and ignored where they are *consumed*
  (R13). The project has met this shape before from the other direction — test-plan §6.10's rule
  that a redirect refusal needs an **equality** assertion on the decoded `error`, because the
  key alone proves nothing.
- **A test input that satisfies two rungs of a fallback chain observes neither.** R4 is the
  clean instance: `{ name, status: 503 }` cannot distinguish the `name` rung from the `status`
  rung. The general form is already recorded twice in test-plan §6.6.
- **Reachability is a property of the caller, not of the vocabulary.** The mapper was written
  from `ErrorCode`'s union, which spans every GoTrue surface — so it maps `same_password` and
  `email_exists` (other endpoints' codes) and misses `anonymous_provider_disabled` (this
  endpoint's actual answer). Measurement, not the type, is what tells them apart.
- **The scope key stopped encoding attribution and the prose had to carry it.** Every artifact
  did carry it faithfully; what rotted are the *cross-references* (R8) — F-numbers that resolve
  against the wrong review because two tickets' reviews coexist for one branch.

## Historical Context (from prior changes)

- `context/archive/2026-07-26-ai-candidate-generation-test-2/reviews/plan-review.md:92-122` —
  F3, the three-way scope split that created this ticket
- `.../reviews/plan-review.md:72-90` — F2, why the mapper is typed structurally and imports
  nothing from `@supabase/auth-js`; still respected in the shipped code
- `.../reviews/impl-review.md:61-93` — F1, the prototype-chain hole and the `Object.hasOwn` fix,
  with the "1 of 33 red" breakage whose denominator is now 38 (R8)
- `.../reviews/impl-review.md:136-177` — F3, the roadmap-H-03 deferral that R17 now resolves
- `.../plan.md:324-450` — Phase 1 as contracted (the mapper, both routes, the test contract)
- `.../plan.md:626-700` — Phase 4 §1, the banner gate, whose manual-only verification R10 confirms
- `.../frame.md:55-61,142-161` — why the relay is a leak (URL → history → Cloudflare access log)
  rather than XSS, and how the auth routes were identified as the codebase's only deviation
- `context/foundation/lessons.md:89-94` — the `?error=` URL-cleanup rule R14 measures against
- `context/foundation/lessons.md:180-185` — `/10x-archive` owns the Status flip (R17 obeys it)

## Related Research

- `context/archive/2026-07-26-ai-candidate-generation-test-2/research.md` — `@supabase/auth-js`
  2.105.3 error classes, where `code` comes from, the five code-less classes
- `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md` §Phase 1, §Phase 4 —
  the recorded manual checks this deliverable still rests on

## Open Questions

1. **Is R13 (`?error=` membership check) in scope for C10X-34, or a new ticket?** It is a real
   widening past what shipped, and the owner's call.
2. **Is R2 real in this project's production?** Needs one look at whether the Supabase project
   uses built-in SMTP and whether confirmations are on. That single fact decides whether R2 is a
   live production defect or a config-flip risk.
3. **Who owns R16 (a11y on the auth surface)?** Neither C10X-19 (copy) nor C10X-36 (input rules)
   covers markup semantics. It may need its own ticket.
4. **Should the banner gate get a test at all (R10)?** `Layout.astro` is renderable through the
   Container API, but no test in this project renders a page today, and doing so would open a
   layer test-plan §4 deliberately does not have. Recording it as named negative space is the
   cheaper alternative.
5. **Does anything here justify touching `signup.ts`'s untested discriminator (R5) now**, or
   does that wait for C10X-36, which will rewrite these routes' input handling anyway?

## Method Notes and Side Effects

- Four parallel read-only sub-agents (mapper reachability with live probes; tests and comment
  drift; banner-gate coverage; wider front door and bookkeeping). Findings driving decisions
  were re-verified in the main context: the `import.meta.env` violation, the archive
  Change-ID matching rule, and `formString`'s always-string return.
- **Side effect**: the probe agent created two accounts `probe*-1785435299@example.com` in the
  **local** `auth.users`. Harmless to the suite (it provisions its own accounts); cleared by
  `npm run db:reset`. Same class of residue `frame.md:214-217` records for C10X-28.
- The test suite was **deliberately not run** during this research: the probes and the suite
  share GoTrue's 30-per-5-minute budget, and a rate-limited run reads as a validation
  regression (`errors.test.ts:225-236`). A baseline belongs to the plan phase, run cleanly.
