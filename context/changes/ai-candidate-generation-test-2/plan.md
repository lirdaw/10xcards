# No source-text or API-key leak on the generation failure path — Implementation Plan

## Overview

Risk #4 in `context/foundation/test-plan.md` §2 reads "private source text or the LLM API
key escapes into a log line or an error response body". The frame brief
(`frame.md`) investigated it to HIGH confidence and found the ticket's own framing does not
survive contact with the code: the no-leak property on `/api/generate` **already holds by
construction**, is **asserted nowhere**, and **cannot be asserted at the layer test-plan
nominates** — while the two surfaces where private data genuinely does escape today are
ones the ticket never names.

So this change is not "test the failure path". It is:

1. **Close the two real leaks** — the auth routes' verbatim relay of an upstream message
   into a URL, and `generation_session`'s four private audit columns, which have no
   cross-account test at all.
2. **Close Risk #6 as well**, so §3 Phase 2 ("Endpoint contract") can flip to `complete`:
   single-source the duplicated `SOURCE_MAX` and prove a crafted request gets a 4xx and
   not a write.
3. **Make the no-leak property enforceable** by adopting the project's first module
   double — confined and documented — so the sealed 502/422 branches become observable.
4. **Correct `test-plan.md`**, whose freshness ledger is provably stale and whose §6.6
   carries a claim that a landed commit already falsified.

## Current State Analysis

**The response bodies are already clean, and that is load-bearing.** Of the 18 error returns
in `src/pages/api/generate.ts`, **17 are fixed Polish literals** (`:89,106,111,118,123,128,150,
173,176,185,188,192,236,263,284,323,336`). The 18th — `:273-275` — is a **double ternary**, not
a literal (corrected by `research.md`; the frame and the first draft of this plan both treated
all 18 uniformly). `error.code === "23505"` is read at `:272` solely to pick between two
module-local literals, so the returned value still comes from a closed set and the no-leak
property holds unchanged — but any mutation or copy-pinning argument that assumes uniformity is
wrong about that one branch. Zod issues are discarded (`:123`).
`err.message` is computed at `:210` and routed **exclusively** to the DB column (`:220`).
Since commit `a018717`, `src/lib/http.ts` renders the endpoint's `error` string in every
island — so "every error body is a fixed literal" now has a client-side consumer and is an
invariant, not a habit.

> **Narrowed 2026-07-26, after C10X-27 merged** (`e1aee53`, the impl-review fixes, rewrote
> `http.ts`). This used to read "`http.ts:56` renders … **verbatim** in every island". Two
> corrections. The line moved: the render is now `readJsonResponse`'s `:61`
> (`errorMessageOf(body) ?? fallback`), while `:56` is the `if (!parsed)` guard. And
> "verbatim" is no longer true for **every** response — `:52-54` intercepts `401` and
> `res.redirected` first and returns the client's own `SESSION_EXPIRED_MESSAGE`, ignoring the
> endpoint's copy entirely. The claim still holds exactly where this plan uses it: 502 and
> 422 (Phase 5's two branches) are neither 401 nor redirects, so their bodies do reach the
> user verbatim. Do not restate the wider version.

**The two auth routes are the codebase's only deviation.** `src/pages/api/auth/signin.ts:16`
and `signup.ts:16` relay `error.message` verbatim into `?error=`. The value is rendered
escaped (`ServerError.tsx:13`), so this is not XSS — but it lands in the URL, i.e. in
browser history and in the Cloudflare access log. GoTrue's copy includes
`Email address %q is invalid` (interpolating the submitted address), and auth-js falls back
to `JSON.stringify(err)` on an unrecognised body shape. These routes predate the JSON
convention (`generate.ts:16-20` documents itself as the project's first JSON endpoint) and
were never revisited.

**The audit columns are unguarded by test.** `generation_session` carries `source_text`
(NOT NULL), `request_payload`, `response_payload`, `error_message`
(`supabase/migrations/20260712162349_generation_session.sql:25,32-34`). On the 502 path the
pasted text lands in `source_text` **and** verbatim inside
`request_payload.messages[1].content` (`openrouter.ts:169-179`). RLS mirrors `deck`
(migration `:58-74`). The single existing cross-account test
(`tests/review/candidates.test.ts:528-545`) reads only the projection
`id, public_id, requested_count, generated_count` (`generations.ts:35`) — **no test touches
the four private columns, and this table has no cross-account WRITE test whatsoever.**

**The failure branches are sealed by a triple clamp.** `tests/setup/preflight.ts:110-118`
aborts the run if `OPENROUTER_API_KEY` is set; `src/lib/openrouter.ts:149-158`
short-circuits to `mockCards` if it is unset; and `astro:env` secrets are inlined at
**transform** time under Vitest, so `vi.stubEnv`/`process.env` cannot flip it. 502
(`generate.ts:204-236`) and 422 (`:247-263`) are therefore unreachable with the current
harness. The repo contains **zero** `vi.mock` / `vi.spyOn` / `vi.fn`.

**But the seal is liftable — and research changed WHICH seam lifts it.** Two spikes have now
been run (each written, executed, deleted, with a deliberate-breakage check and a green suite
afterwards):

- The frame's: `vi.mock("@/lib/openrouter", { ...actual, generateCandidates: vi.fn() })`
  resolves through the `@/` alias under `getViteConfig()` and reaches the import inside
  `generate.ts`, preserving the `OpenRouterError` identity `generate.ts:208-209` needs. It
  reaches **502 only**.
- This change's research: `vi.mock("astro:env/server", { ...actual, OPENROUTER_API_KEY: … })`
  reaches **502, 422, the real `Authorization` header and the audit columns at once** — because
  the key is a live ESM import binding read inside function bodies (`openrouter.ts:2,58,149,186`),
  never captured module-scope, so replacing that module flips the mock-mode gate while every
  line of production code stays real. See `research.md` § "Verified by execution".

**The second seam is the one this plan now uses, and the first is not merely worse — it cannot
carry half the claim.** Doubling `generateCandidates` means `openrouter.ts:183-193` never runs,
so no request is issued and no header exists to assert. Under Vitest `astro:env` secrets are an
inlined literal with no runtime override (`vite-plugin-env.js:82-83,142-155`), so replacing the
module is the *only* seam; `vi.stubEnv`, `process.env` and `setGetEnv` are all dead here.

**`SOURCE_MAX` is duplicated.** `generate.ts:22` declares `const SOURCE_MAX = 10_000` and
`src/components/generate/GeneratorForm.tsx:12` declares its own identical literal. This is
the inverse of the `FRONT_MAX`/`BACK_MAX` pattern, which both server
(`api/decks/[publicId]/cards/index.ts:3`) and client
(`CreateFlashcardModal.tsx:9`, `FlashcardItem.tsx:4`) import from `@/lib/flashcards`. Two
literals for one business rule is the drift mechanism Risk #6 describes.

**`test-plan.md` had four false statements, and C10X-27 closed three of them while this
change's research was running — so this paragraph is a snapshot, not a work list.** Closed
already: §8's "69/69 green, 8 files" (the rewritten ledger now records **109/109 green, 11
files**, matching this change's independent measurement at `da5e9c2`); §6.6's "the middleware
guard is untested" (explicitly marked closed by C10X-27); and §6.5's
`src/lib/generations.ts:29-34` anchor (gone from the file). **Still open:** the Stryker command
`--mutate "src/lib/flashcards.ts:181-212"`, a range that stopped containing `setFlashcardState`
when `75df78f` moved it to `:218` — two hours after the run that range records. The same wrong
`generations.ts` anchor also survives in a live code comment at
`tests/generation/generate.test.ts:37`, which C10X-27 did not touch.

> **Sequencing constraint (user's direction, 2026-07-26).** `context/foundation/test-plan.md` was
> being rewritten by C10X-27 during this research pass — 1018 lines at `HEAD`, 1332 in the working
> tree, mtime advancing mid-session. **C10X-27 has priority. This change touches `test-plan.md`,
> `roadmap.md` and nothing under `context/changes/srs-study-session-test/` until C10X-27's
> implementation lands.** Phases 1–5 touch disjoint files and are unaffected; **Phase 6 is the only
> contended phase and must re-derive its list against the post-C10X-27 file** rather than trust any
> line number in this plan. Acting on the list as first written would mean re-fixing fixed text.
>
> **DISCHARGED 2026-07-26 — this whole constraint is now history, keep reading only for the
> one rule that survives it.** C10X-27 merged (PR #13, `9817a07`) and was archived to
> `context/archive/2026-07-26-srs-study-session-test/`, so the folder this note forbids
> touching **no longer exists** under `context/changes/`. This change was cut from that merged
> `main` as `C10X-28-ai-candidate-generation-test-2` (`60e0e97`), which is what the F4
> resolution asked for.
>
> **What survives: Phase 6 must still re-derive its list, and harder than before.**
> `test-plan.md` is **1352** lines on `main` now — it moved again after this plan was written
> (1018 at that `HEAD`, 1332 in the then-working tree), because `e1aee53` touched it too.
> Every line number this plan gives for that file is historical. The same commit rewrote
> `src/lib/http.ts`; see the narrowing note in Current State Analysis for what that did to one
> of this plan's own claims. Treat any other anchor into a C10X-27 file as suspect until
> re-checked.

### Key Discoveries

- `@supabase/auth-js` installed here is **2.105.3** (`node_modules/@supabase/auth-js/package.json`),
  not the 2.192.0 the frame cites — that number is the **GoTrue server** image, a different
  artifact. This matters: the installed client exposes `AuthError.code` as an enumerated
  `ErrorCode` union (`dist/module/lib/errors.d.ts:14-20`, `lib/error-codes.d.ts`), so the
  mapper keys off **stable identifiers**, not off message text. Codes verified present:
  `invalid_credentials`, `email_not_confirmed`, `email_exists`, `user_already_exists`,
  `weak_password`, `same_password`, `validation_failed`, `signup_disabled`, `user_banned`,
  `over_request_rate_limit`, `over_email_send_rate_limit`.
- **`Layout.astro` is the base layout for every page, including `AuthenticatedLayout.astro:2,14`**
  (import and `<Layout title={title}>`; the wrap is at `:14`, not `:13`).
  A naive `Astro.locals.user` gate on the banner block would permanently hide the *Supabase*
  misconfiguration warning — because when Supabase is unconfigured, `createClient` returns
  `null`, middleware sets `locals.user = null`, and the banner about that very fact would
  gate itself off. Only the OpenRouter banner may be gated.
- `stryker.config.json`'s permanent `mutate` array already lists
  `src/pages/api/generate.ts` and `src/lib/generations.ts` — this change's exact surface.
  Per CLAUDE.md, narrow with `--mutate "path:start-end"` and leave the array alone.
- `tests/review/candidates.test.ts:120-142`'s `seedGenerationSession` writes **neither**
  `request_payload`, `response_payload`, **nor** `error_message`. Extending that file's
  isolation case without widening the helper would assert "B cannot read" against `NULL`s —
  a vacuously green test.
- `tests/fixtures/endpoint.ts:82` always injects `locals.user`, but both
  `generate.test.ts:92-107` and `study.test.ts` already bypass it with a local container
  helper for signed-out cases. That precedent is reusable; the shared fixture needs no change.
- `callEndpoint` sets `Content-Type: application/json` only for a string body
  (`endpoint.ts:68-70`), so `FormData` keeps its multipart boundary — which is what the auth
  routes read (`signin.ts:5`).
- **`isOpenRouterConfigured` (`openrouter.ts:57`) is dead code** — its only occurrences in the
  repo are its own definition and the first draft of this plan. It is *not* a usable seam;
  `config-status.ts:21` reads `Boolean(OPENROUTER_API_KEY)` straight from `astro:env/server`.
- **`succeededSessions` (`generate.test.ts:123-132`) filters `status = 'succeeded'`.** It is
  blind to the `failed` rows that `generate.ts:211` and `:248` write, and to any `deck` row.
  "4xx implies no row" does hold across the whole Risk #6 surface — every input-contract
  rejection returns at `:118`, `:123` or `:128`, before the first DB statement at `:148` — so
  today the helper is correct but **vacuous**, and it stops being an oracle the moment a case
  perturbs the generation path.
- **The source-text bound is asymmetric.** `generate.ts:52` is `.min(1).max(SOURCE_MAX)` with
  **no `.trim()`**, while the minimum is re-checked post-trim at `:126-129`. The maximum
  constrains the raw string, the minimum the trimmed one — which decides what a boundary
  control actually pins.
- **The duplication Risk #6 describes is four constants, not one.** `SOURCE_MAX`, `COUNT_MIN`,
  `COUNT_MAX` and the whole `LANGUAGES` whitelist exist twice (`generate.ts:22-30` vs
  `GeneratorForm.tsx:12-30`). Deck name `1..100` exists in six places. `StudySession.tsx:20-22`
  and `CandidateReviewWorkspace.tsx:18-27` mirror their bounds with an explicit "Mirrors …"
  comment — so a commented copy is the project's *habit* and `FRONT_MAX`/`BACK_MAX` the single
  exception. Single-sourcing is a change of convention, not the repair of a lapse.
- **Vitest defaults make one intended proof a tautology.** Nothing is set in `vitest.config.ts`,
  so `isolate: true` and `pool: "forks"` apply: a `vi.mock` cannot leak across files by
  configuration. The live hazard is intra-file — `restoreMocks`, `clearMocks`, `mockReset` and
  `unstubGlobals` all default to `false`.

## Desired End State

- A signed-in user's pasted source text cannot be read or altered by another account, and a
  test proves it on all four private columns, in both directions, with positive controls.
- A failed sign-in or sign-up shows fixed Polish copy that still tells the user what to do,
  and no upstream string — no submitted email, no `JSON.stringify` fallback — ever reaches
  the URL.
- A crafted request that bypasses the UI's bounds gets a 4xx and writes nothing; the
  source-text limit has exactly one definition in the codebase.
- The 502 path is observable in tests: on one request, the response body provably lacks the
  source text and the upstream error string **while the audit row provably contains both**.
- `OPENROUTER_API_KEY` is proven to travel in `Authorization` and to appear in no audit
  column.
- An anonymous visitor is no longer told whether generation is live.
- `test-plan.md` states what is true, with Risk #4 and Risk #6 entries describing exactly
  what the new coverage does and does not claim, and §3 Phase 2 marked `complete`.

Verify by: `npm test` green (local stack up, `OPENROUTER_API_KEY` unset), plus the recorded
deliberate-breakage runs in `verification.md`.

## What We're NOT Doing

- **Not** asserting the Polish copy of any `/api/generate` error body. C10X-33 leaves those
  `StringLiteral -> ""` mutants alive deliberately; copy is not a contract.
- **Not** auditing or gating dependency-emitted log lines against `node_modules` internals.
  The boundary is stated; pinning it would break on every patch bump with no user-visible
  cause.
- **Not** changing `wrangler.jsonc`'s `observability` setting. The frame measured those
  lines as carrying session/transport material, never pasted text.
- **Not** removing the OpenRouter banner outright — it is the only in-app signal that
  generation silently degraded to mock, an incident `lessons.md` already records.
- **Not** widening `tests/fixtures/endpoint.ts`. Signed-out cases use the existing local
  container helper.
- **Not** attempting to sit out a real timeout. `testTimeout` (30 s) < `SERVER_TIMEOUT_MS`
  (40 s) < client (55 s); a timing-based test fails on the runner, not on the behaviour.
- **Not** sweeping the card create / edit / batch endpoints for bounds. Those already share
  a single `FRONT_MAX`/`BACK_MAX` source, so they are the low-drift half of Risk #6.
- **Not** re-litigating whether the API key can reach a client bundle. The frame closed it
  at three independent layers (`astro:env` `ServerOnlyModule` throw at build,
  `_internalGetSecret` indirection, key absent from CI). It is recorded, not re-tested.

## Implementation Approach

> **Scope split — decided at plan-review (F3), 2026-07-26.** `change.md` left "one change or
> three?" open; the answer is **three tickets**, because only Phases 2, 5 and 6 are Risk #4 and
> C10X-28's acceptance criterion is about Risk #4 alone.
>
> | Phases | Ticket | Why it is its own ticket |
> | --- | --- | --- |
> | 2, 5, 6 + Phase 4 §2 | **C10X-28** (this change, `ai-candidate-generation-test-2`) | Risk #4 proper: audit-column isolation, the module double, the `console.*` guard, the doc-sync |
> | 1 + Phase 4 §1 | **C10X-34** (`auth-error-copy`) — created 2026-07-26 | Phase 1 changes what every user sees when login fails; it must be reviewable and revertable on its own, and Phase 4's banner gate is the same user-facing-disclosure concern |
> | 3 | **C10X-30** (`server-side-validation-test`) — **already existed** | The Risk #6 ticket. Phase 3 belongs to it by content; opening a new one would have been a duplicate |
>
> **C10X-30 is only PARTLY closed by Phase 3, and that matters when someone goes to close it.**
> Its description spans two surfaces — the source-text limit (S-04) *and* the card-content
> rules (S-02). Phase 3 covers the first and deliberately excludes the card endpoints, which
> already share one `FRONT_MAX`/`BACK_MAX` source ("What We're NOT Doing"). Do not close
> C10X-30 on Phase 3 alone.
>
> **Consequence for Phase 6, and it is the cost of the split:** §3 Phase 2 ("Endpoint contract")
> covers risks #2, #4 **and #6**, so it cannot flip to `complete` until the Risk #6 ticket also
> lands. Phase 6 here closes Risk #4 only and leaves Phase 2 `implementing` with #6 named as the
> one outstanding risk. Whichever of the two tickets lands second flips the status.
>
> **Revised 2026-07-26 (user's direction): the split is bookkeeping, not an execution boundary.**
> This paragraph used to end "Do not implement Phases 1, 3 or 4 from this plan folder" — that no
> longer holds. **All six phases are executed here, on this branch**; the tickets above own the
> *attribution* only. It used to show up as the commit scope key too — that was **revoked later
> the same day**: every commit on this branch carries `(C10X-28)`, because the branch is
> C10X-28's and a foreign key in the subject line reads as drift. See the scope note at the top
> of `## Progress` for what that costs and where attribution lives instead.
>
> Two things follow. **Phase 6 must re-evaluate the §3 Phase 2 status** rather than inherit the
> "stays `implementing`" note below: that note assumed Risk #6 was leaving with C10X-30, and it
> is not leaving any more — though C10X-30's card-content half stays out of scope, so the answer
> is not automatic. And **C10X-34 / C10X-30 will need closing or annotating after merge**, since
> their work will have landed under someone else's branch.

Six phases, ordered so that **every stopping point leaves a closed leak behind it** and the
first thing abandoned is the thing named cuttable. Phases 1–4 are the fixes; Phase 5 is the
harness work; Phase 6 is verification sweep plus doc-sync.

Each phase carries its own deliberate-breakage check in its success criteria, because a
green suite proves nothing until something has been made red on purpose — and because a
check that targets exactly one claim tells you *which* claim it observes. That property is
what made the S-03 and S-05 checks conclusive and is why they are per-claim here rather
than batched at the end.

## Critical Implementation Details

**The banner gate has one ordering trap and it is not obvious.** `Layout.astro` renders the
banner list for *every* page because `AuthenticatedLayout` wraps it. Gating the whole block
on `Astro.locals.user` inverts the Supabase banner's purpose: unconfigured Supabase means
`createClient` returns `null`, so middleware always sets `locals.user = null`, so the
warning about the broken subsystem hides itself exactly when it is needed. Gate **per
status entry**, not per block — OpenRouter's entry requires a session, Supabase's never does.

**The isolation seed must write non-null private values before it can assert anything.**
`seedGenerationSession` currently omits the three nullable private columns. Widen it first;
otherwise the new assertions run against `NULL` and pass no matter what RLS does.

**The module double has four mechanical traps, and three of them were only found by running
it.** All four are properties of doubling `astro:env/server` (see `research.md` § "Verified by
execution"); the class-identity trap this section used to carry is **gone**, because
`OpenRouterError` is no longer doubled at all and `generate.ts:208-209`'s `instanceof` holds
natively.

1. **`vi.hoisted` is mandatory for the sentinel.** `vi.mock` factories are hoisted above every
   import, so a plain module-scope `const SENTINEL` is in its TDZ when the factory runs. Share
   it via `const { SENTINEL_KEY } = vi.hoisted(() => ({ SENTINEL_KEY: "…" }))`.
2. **The factory must spread `...actual`, for a reason unrelated to class identity.**
   `SUPABASE_URL` / `SUPABASE_KEY` come from the same module (`src/lib/supabase.ts:3`). A factory
   returning only the key makes `createClient` return `null`, and `/api/generate` answers **500
   at `:105-107`** without ever reaching the LLM call — which presents as a mysterious failure
   rather than as the wiring error it is.
3. **The `fetch` double must be a pass-through, not a replacement.** Inside one `callEndpoint`
   the endpoint makes Supabase calls at `generate.ts:148,171,211,270,288,326` over
   `globalThis.fetch`, and the test reads the audit row back the same way. Match on
   `openrouter.ts:10`'s `OPENROUTER_URL` and delegate everything else to the captured original.
4. **Install the `fetch` double BEFORE the key seam.** The `astro:env` mock deliberately lifts
   the clamp `preflight.ts:110-118` exists to enforce (`lessons.md`: "Preflight musi domknąć
   KAŻDY nielokalny szew"), so the pass-through is not a convenience — it is the replacement
   guard. Without it a sentinel key produces a real billed call to `openrouter.ai`. Say this in
   the file header rule, not only here.

**The key-pin test needs its positive control inside the same request.** Asserting only that
a sentinel is absent from the audit cannot distinguish "the key was correctly withheld" from
"the doubled fetch was never called". Capture the outgoing request in the fetch double and
assert the sentinel **is** in its `Authorization` header in the same test body. With the
`astro:env` seam that header is built by production code (`openrouter.ts:185-190`), so the
control is evidence rather than a restatement of the test's own wiring — which is precisely what
the alternative seam could not deliver.

## Phase 1: Auth error copy — stop the verbatim relay

> **Attributed to `C10X-34` (`auth-error-copy`, roadmap H-03) by the scope split (F3), together
> with Phase 4 §1 — but implemented HERE.** Its commit carries `(C10X-28)` like every other on
> this branch; see the scope note at the top of `## Progress`.

### Overview

Replace the two `error.message` relays with a mapper over `AuthError.code`, so the URL
carries only project-owned constants while the user still learns what to do.

### Changes Required:

#### 1. The mapper

**File**: `src/lib/auth-errors.ts` (new)

**Intent**: Translate an auth failure into one fixed Polish message, keyed off the stable
`AuthError.code` rather than the upstream prose, so no upstream string can reach a URL.

**Contract**: One exported function taking the `AuthError` (or `unknown`) returned by
supabase-js and returning a `string` drawn from a closed set of module-level literals.
Codes to distinguish, verified present in `@supabase/auth-js` 2.105.3's `ErrorCode` union:
`invalid_credentials`, `email_not_confirmed`, `email_exists` / `user_already_exists`,
`weak_password`, `same_password`, `validation_failed`, `signup_disabled`, `user_banned`,
`over_request_rate_limit` / `over_email_send_rate_limit`. The function must not interpolate
any part of the input into its return value — that is the invariant the whole phase exists
to establish, and the concrete thing it kills is `_getErrorMessage`'s
`JSON.stringify(err)` fallback (`auth-js/dist/module/lib/fetch.js:5-18`), which stringifies a
whole unexpected GoTrue body into `error.message`.

Three corrections from `research.md`, all of which change how the mapper is written:

- **Key on plain string literals, not on the `ErrorCode` type.** `ErrorCode` is imported
  internally by `errors.d.ts` and re-exported by **neither** `@supabase/auth-js`'s nor
  `@supabase/supabase-js`'s root, and the package declares no `exports` field — so a deep import
  would be reaching into internals. Note also that the field is typed
  `ErrorCode | (string & {}) | undefined`, which gives **no exhaustiveness checking**: a typo in a
  key is not a compile error, and catching it is exactly what the Stryker run below is for.
- **`code` is `undefined` for five error classes**, so "every unrecognised or absent code falls to
  a generic literal" is too blunt to be usable on the front door. It is sourced from the response
  body — `data.code` when an `X-Supabase-Api-Version` ≥ `2024-01-01` header is present *and* the
  value is a string, else `data.error_code` (`fetch.js:39-50`) — and never set for
  `AuthUnknownError`, `AuthRetryableFetchError` (network failure, and status in
  `[502,503,504,520-524,530]`), `AuthSessionMissingError`, `AuthInvalidTokenResponseError`,
  `AuthInvalidCredentialsError`. Use a documented fallback **chain**: `code` → `name` →
  `status` → one Polish default. A transport failure deserves different copy from a rejected
  password, and only the chain can tell them apart.
  > **Corrected at plan-review (F2), 2026-07-26 — the chain used to route through the exported
  > type guards `isAuthApiError` / `isAuthWeakPasswordError` / `isAuthRetryableFetchError`. Do
  > not put them back.** They are reachable only from `@supabase/auth-js`'s root, and that
  > package is **not** in `package.json` `dependencies` — it is a hoisted transitive dep of
  > `@supabase/supabase-js` with no version range this repo controls. `@supabase/supabase-js`
  > 2.105.3's own root re-exports just `AuthSession` and `AuthUser`: no `AuthError`, no guards,
  > no `ErrorCode` (verified against `dist/index.d.mts`). Reaching for the guards is therefore
  > the *same* objection the bullet above raises against deep-importing `ErrorCode`, and it was
  > applied inconsistently.
  >
  > `name` carries the whole discrimination on its own — every class assigns it in its
  > constructor (`auth-js/dist/module/lib/errors.js:15,44,69`, and `:86` for every
  > `CustomAuthError` subclass), so `"AuthRetryableFetchError"` separates a transport failure
  > from `"AuthApiError"` without a single import. Type the mapper's parameter **structurally**
  > — `{ code?: string; name?: string; status?: number }` — and the module depends on no
  > `@supabase/*` package at all, which is also what makes its unit test trivially cheap.
- **`weak_password` is the one guaranteed code** — `AuthWeakPasswordError`'s constructor hardcodes
  it on both the coded and the legacy path, and the error carries `reasons: string[]` available for
  granular copy if wanted.

**Never** fall through to `error.message` at any link in the chain; that is the relay this phase
exists to remove.

#### 2. The two routes

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Route the mapper's output into the existing `?error=` redirect instead of
`error.message`, leaving control flow and the `Supabase is not configured` branch untouched.

**Contract**: `:16` in each file changes its argument to the mapper call. The redirect
target, `encodeURIComponent` wrapping, and success paths are unchanged. Note the existing
`"Supabase is not configured"` literal at `:11` is English while the rest of the app is
Polish — bring it in line with the new constants.

#### 3. Tests

**File**: `tests/auth/errors.test.ts` (new)

**Intent**: Prove each mapped class produces its own constant, that an unknown code falls
back rather than throwing, and — the load-bearing one — that no input substring survives
into the output.

**Contract**: Unit tests over the mapper (no DB needed, though preflight still requires the
stack). Include a property-style case: given an `AuthError` whose `message` carries a
sentinel, assert the sentinel appears in no mapper output for any code. Plus one endpoint
case driving `signin.ts` through `callEndpoint` with `FormData` and bad credentials,
asserting the 302 `Location`'s `error` param equals a known constant and contains neither
the submitted email nor `"{"`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Full suite passes: `npm test`
- New file passes alone: `npx vitest run tests/auth/errors.test.ts`
- Stryker narrowed to the mapper leaves no surviving mutant that changes which class a code
  maps to: `npx stryker run --mutate "src/lib/auth-errors.ts"`

#### Manual Verification:

- A wrong password on `/auth/signin` shows actionable Polish copy, and the address bar's
  `?error=` value is one of the new constants
- Signing up with an already-registered address shows its own distinct message, not the
  generic fallback. **This check is reachable LOCALLY ONLY** — `supabase/config.toml:209` sets
  `enable_confirmations = false`. With confirmations on (the production default) GoTrue
  deliberately answers **200 with an obfuscated user and no error at all**, so `signup.ts:15` is
  never entered and the visitor lands on `/auth/confirm-email`. That is anti-enumeration behaviour
  in the server; no mapper can change it, and a prod smoke test of this case would fail for the
  wrong reason.
- Deliberate-breakage check recorded: break one code's mapping, confirm exactly that class's
  test goes red while the others stay green

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Cross-account isolation of the audit columns

### Overview

Prove account B can neither read nor write account A's `source_text`, `request_payload`,
`response_payload`, or `error_message`.

### Changes Required:

#### 1. Widen the seed helper

**File**: `tests/review/candidates.test.ts`

**Intent**: Make `seedGenerationSession` able to write the three nullable private columns,
so the isolation assertions have non-null values to be denied. Without this the phase
asserts nothing.

**Contract**: The helper gains an optional argument carrying `request_payload`,
`response_payload` and `error_message`; all **four** existing call sites (`:402`, `:407`,
`:490`, `:529`) keep working unchanged — `:490` ("Metric source") was missing from this list
until plan-review F7, and the count is what you check the edit against. Values must be per-run unique (the file's `suffix`) so a denial cannot
be satisfied by a stale row.

#### 2. The isolation cases

**File**: `tests/review/candidates.test.ts`

**Intent**: Extend the existing `generation_session` describe with read denial across all
four private columns and — new for this table — write denial, each paired with a positive
control.

**Contract**: Read: B selecting the four columns by A's `public_id` gets `data: null,
error: null` (absence, not a raised denial — §6.4's below-HTTP form of "404, never 403"),
while A still resolves the row with every private value intact. Write: B's `UPDATE` and
`DELETE` against A's row report no error and change nothing; A re-reads the row
column-for-column and finds it byte-identical. A's own successful update is the positive
control that separates "policy denied B" from "the write path is broken for everyone".

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- File passes alone: `npx vitest run tests/review/candidates.test.ts`

#### Manual Verification:

- Deliberate-breakage check recorded: set `generation_session_select` to `using (true)`,
  confirm the read assertions go red; restore, then set
  `generation_session_update` to `using (true)`, confirm the write assertion goes red
- Restore **verified, not assumed**: dump `qual`/`with_check` from `pg_policies` before and
  after, `diff` them, and record that the diff is empty (S-05's heredoc-without-`-i`
  near-miss is why this step is written out)
- Full suite green after restore

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Server-side bounds parity (Risk #6) + single-source `SOURCE_MAX`

> **Attributed to `C10X-30` (`server-side-validation-test`), the pre-existing Risk #6 ticket —
> but implemented HERE.** Commits carry `(C10X-28)`, as everywhere on this branch. It covers only that ticket's
> source-text half, not its card-content half, so C10X-30 does **not** close on this alone.
> Read the traps below before writing anything — in
> particular the 414 trap and the pre-trim/post-trim asymmetry below, which are the two things a
> rewrite would drop.

### Overview

Remove the duplicated source-text limit, then prove a request crafted outside the UI gets a
4xx and leaves no row behind.

### Changes Required:

#### 1. One definition of the limit

**File**: `src/lib/generation-limits.ts` (new, or an existing shared lib if one fits better
on inspection), `src/pages/api/generate.ts`, `src/components/generate/GeneratorForm.tsx`

**Intent**: Give the generation bounds a single home that both the endpoint and the island
import, matching how `FRONT_MAX`/`BACK_MAX` already work, so the two ends cannot drift.

**Contract**: **Four constants, not one** — research settled the "check before deciding" left
open here: the island carries its own copies of `SOURCE_MAX` (`GeneratorForm.tsx:12`),
`COUNT_MIN` (`:13`), `COUNT_MAX` (`:14`) **and the whole `LANGUAGES` whitelist** (`:23-30`),
against `generate.ts:22-30`. All four move to one module; `generate.ts` and `GeneratorForm.tsx`
both delete their locals and import. No behavioural change: values stay `10_000`, `1`, `15` and
the same six languages. The island's `LANGUAGES` are `{value,label}` objects while the endpoint's
are a bare `as const` tuple — export the values and let the island derive its labels, rather than
exporting a UI shape from a lib.

**Where** is an open decision, not a default (see `research.md` § Open Questions #1): three
candidates, and the codebase does not settle it. `src/lib/flashcards.ts` works *mechanically* —
it imports types only (`:1-2`) and three islands already import values from it — but it is the
flashcard resource, not the generation concern. `src/lib/generations.ts` is the right concern but
has never been imported by a client component, so shipping it to the browser is a new precedent.
A new `src/lib/generation-limits.ts` avoids both objections and adds a file. Pick one explicitly
and say why in a comment.

**Also state the honest framing**: `StudySession.tsx:20-22` and
`CandidateReviewWorkspace.tsx:18-27` mirror *their* bounds with an explicit "Mirrors …" comment,
so a commented copy is this project's habit and `FRONT_MAX`/`BACK_MAX` the exception. This phase
changes a convention; it does not repair a lapse. Deck name `1..100` lives in six places and is
deliberately **out of scope** — naming that keeps the next reader from thinking it was missed.

#### 2. Bounds tests

**File**: `tests/generation/generate.test.ts`

**Intent**: Extend the existing input-contract describe with the bounds no case currently
breaches, asserting both the refusal and the absence of a write.

**Contract**: New `it()`s in the existing `"rejects a request that fails its input contract"`
block, following its established shape (`expectErrorBody`, no copy assertions). Cases:
`sourceText` at `SOURCE_MAX + 1`; `count` of `0`, `16`, and a non-integer; `language` off
the whitelist; a `deckPublicId` that fails `UUID_RE`; a malformed `idempotencyKey`;
`newDeckName` over 100 characters.

**The oracle must be widened first, or the assertions are vacuous.**
`succeededSessions` (`generate.test.ts:123-132`) filters `.eq("status", "succeeded")`, so it
cannot see the `failed` rows `generate.ts:211` and `:248` write, nor any `deck` row. For *these*
cases it happens to be sound — every input-contract rejection returns at `:118`, `:123` or `:128`,
before the first DB statement at `:148` — but a status-filtered "nothing was written" is an
argument, not an assertion, and it silently stops being either the moment a case perturbs the
generation path. Add a **status-agnostic** count (and, for the `newDeckName` cases, a `deck`
count by name), and assert *that*. `tests/study/study.test.ts:691-713` is the shape to copy: it
re-reads the row after every rejection precisely because "a 400 returned after the write had
already landed would read as a pass".

**Do NOT scope that count by the full `source_text`, and this is the phase's sharpest trap.**
PostgREST carries filters in the query string and Kong caps the request line at ~8 KB, so
`.eq("source_text", <the 10 000-char body>)` answers **`HTTP 414 URI too long`** — measured
against the local stack, `n=10001 → 414`, `n=10000 → 414`, `n=8000 → through`. That kills the
oracle for exactly the two cases this phase exists for: the over-length rejection *and* the
boundary control, which must be read back after it succeeds. The test would go red on
`expect(error).toBeNull()` for a reason with nothing to do with the behaviour under test
(plan-review F1). `succeededSessions` has the same defect today; it has simply never been handed
a long string.

So scope by a **short per-case marker**, not by the body: put a `<suffix>-<case>` header in the
FIRST characters of every `sourceText` and query `.like("<marker>%")`. The filter then stays a
few dozen bytes whatever the body length, and the file-level `Date.now().toString(36)` namespace
§6.5 requires still does its job. Widen `succeededSessions` the same way in the same edit — one
scoping rule for the whole file, or the next long-text case rediscovers the 414.

**The boundary control needs the asymmetry spelled out.** `generate.ts:52` applies `.max()` to the
**raw** string while `:126-129` re-checks the minimum **post-trim**. So: `sourceText` at exactly
`SOURCE_MAX` succeeds (off-by-none), and `SOURCE_MAX + 1` **whose last characters are whitespace**
is still a 400 even though the meaningful text is under the cap — that second case is what pins
which string the limit governs, and no existing test distinguishes them. The client's
`maxLength={SOURCE_MAX}` (`GeneratorForm.tsx:291`) also counts the raw string, so the two ends
agree here by coincidence of both being pre-trim, not by construction; the import swap must not
quietly change that.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` then lint passes: `npm run lint`
- Build passes: `npm run build`
- Full suite passes: `npm test`

#### Manual Verification:

- The generator form still enforces the limit client-side (char counter, `maxLength`) after
  the import swap
- Deliberate-breakage check recorded: raise the server's `SOURCE_MAX` above the client's
  former literal and confirm the over-length case goes red while the boundary control stays
  green

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Ambient disclosure — banner gate and the log boundary

> **Split by ATTRIBUTION only (F3) — both sections are implemented here.** The **banner gate**
> (§1) is attributed to `C10X-34` with Phase 1, being a user-facing disclosure change rather
> than a leak test; the **`console.*` guard** (§2) is C10X-28's, as the log-line half of Risk #4
> that Phase 6's §6.6 entry has to describe. Steps 4.3–4.5 verify §1, step 4.6 verifies §2.
> Both commits carry `(C10X-28)` — the scope key stopped encoding attribution (see `## Progress`).

### Overview

Stop telling anonymous visitors whether generation is live, and turn "`src/` writes no log
lines" from a point-in-time grep into a standing guard.

### Changes Required:

#### 1. Gate the OpenRouter banner

**File**: `src/lib/config-status.ts`, `src/layouts/Layout.astro`

**Intent**: Keep both banners for the operator who can act on them, but render the
OpenRouter one only to a signed-in visitor.

**Contract**: Each `ConfigStatus` gains a flag (or the layout gains an equivalent filter)
marking whether the entry requires a session. `Layout.astro:22` filters on
`Astro.locals.user` **per entry**. Supabase's entry is explicitly never gated — see
"Critical Implementation Details" for why gating it would hide itself. Note
`missingConfigs` is currently a module-level constant evaluated at import time; a
per-request decision cannot be baked into it, so the filtering must happen in the layout.

#### 2. Guard against future log writes

**File**: `tests/lib/no-logging.test.ts` (new)

**Intent**: Assert that the request-path modules in `src/` contain no `console.*` call, so
the claim survives the next contributor rather than resting on a dated grep.

**Contract**: Reads the `src/` tree from disk and asserts no `console.<method>(` occurrence
**anywhere under `src/`** — not in a three-path allow-list.

> **Widened at plan-review (F5), 2026-07-26; it used to read `src/pages/api/`, `src/lib/`,
> `src/middleware.ts`.** That list leaves out every `.astro` page frontmatter, which runs
> server-side on every request and reaches Workers Logs identically — including
> `src/pages/generate.astro` and `src/pages/study/[publicId].astro`, the two that handle exactly
> the private data Risk #4 is about. A future `console.log(sourceText)` there is squarely inside
> the risk and invisible to a three-path guard, which is worse than no guard because it reads as
> coverage. Whole-tree costs nothing: `src/` contains **zero** `console.*` occurrences today
> (verified), so the wider scan is green on arrival.

A short comment states the boundary
explicitly: this covers what this repo writes; dependency-emitted lines
(`@supabase/ssr/dist/module/cookies.js:22,29`,
`@supabase/auth-js/dist/module/lib/fetch.js:110`) reach Workers Logs via
`wrangler.jsonc:17-19`, are inside Risk #4's scope, are **not** owned here, and were
measured to carry session/transport material rather than pasted text.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Build passes: `npm run build`

#### Manual Verification:

- Signed out, `/` and `/auth/signin` show no OpenRouter banner
- Signed in, the OpenRouter banner still appears when the key is unset
- With `SUPABASE_URL` deliberately unset, the Supabase banner **still** renders while signed
  out — the trap this phase is written around
- Deliberate-breakage check recorded: add a `console.log` to `src/lib/generations.ts`,
  confirm the guard goes red, remove it

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: The project's first module double — no-leak and API-key pins

> **Still nominally the cuttable phase — but re-price it before cutting.** The original logic
> stands: everything above is a closed leak, this is a pin on a property that already holds. What
> changed is the cost/benefit. Research halved the cost (one seam, demonstrated end to end, no
> class-identity risk, no `@/lib/openrouter` double) and doubled the yield: the same seam reaches
> **422 as well as 502**. Cutting it therefore leaves *both* branches as named negative space in
> §7, not one — and forfeits the only pin on the `Authorization` header. Decide deliberately; do
> not cut it on the strength of the old estimate.

### Overview

Lift the triple clamp by doubling **`astro:env/server`** — not `@/lib/openrouter` — which makes
both sealed branches reachable at once, and then assert the two things worth asserting: on a
single failure, the body withholds what the audit row records (on 502, and again on 422); and the
key travels in a header built by production code.

### Changes Required:

#### 1. The failure-path suite

**File**: `tests/generation/failure-path.test.ts` (new)

**Intent**: Make the 502 **and** 422 branches observable and assert the sentinel/audit contrast
that proves the private data reached the server and was withheld.

**Contract**: One `vi.mock("astro:env/server", async (importOriginal) => ({ ...(await
importOriginal()), OPENROUTER_API_KEY: SENTINEL_KEY }))`, with `SENTINEL_KEY` shared through
`vi.hoisted` — see "Critical Implementation Details" for all four traps. **`@/lib/openrouter` is
NOT doubled**: every line of it runs, so `OpenRouterError` keeps its identity natively and the
audit payloads are the ones production builds rather than ones the test injected.

A pass-through `fetch` double, installed **first**, matches `openrouter.ts:10`'s `OPENROUTER_URL`,
captures the outgoing request, and delegates every other URL to the captured original. Two
responses drive the two branches:

- a non-ok status → real throw at `openrouter.ts:202` → **502** at `generate.ts:236` with
  `retriable: true`;
- a 200 whose `choices[0].message.content` holds cards that all fail `candidateSchema`
  (`front` > `FRONT_MAX`) → `generatedCount > 0` with `cards: []` → **422** at `generate.ts:263`.

Drive `/api/generate` via `callEndpoint` with a per-run sentinel source text and a sentinel
upstream message. Assert, on one request: the response body contains **neither** sentinel nor the
key; the persisted `generation_session` row contains `source_text`, `error_message`, the source
text inside `request_payload` and the upstream message inside `response_payload`; the status is
502 with `retriable: true`; and no deck was created (deck creation is deferred past the LLM call,
`generate.ts:266-270`).

**422 gets its OWN assertion set — it is not "the 502 set, plus two"** (corrected at plan-review,
F6). On that path `error_message` is a fixed literal, `"Model nie zwrócił poprawnych kart"`
(`generate.ts:257`), *not* the upstream string, and the upstream sentinel reaches the row only
through `response_payload`. Carrying the 502 wording over produces an `error_message` sentinel
assertion that cannot pass. So for 422 assert: response body free of both sentinels and of the
key; sentinel source text in `source_text` **and** inside `request_payload`; the upstream
sentinel inside `response_payload`; `error_message` **equal to that constant**;
`generated_count > 0` with `saved_count = 0` (the pair that distinguishes 422 from 502); status
422 with `retriable: true`; no deck created.

A file-header comment states the confinement rule: module doubles live in this file; the only
module ever doubled is `astro:env/server`, and only to lift a clamp the harness otherwise seals;
the pass-through `fetch` is the replacement guard for `preflight.ts:110-118`, not an optional
convenience; the database and RLS are never doubled.

#### 2. The API-key pin

**File**: `tests/generation/failure-path.test.ts`

**Intent**: Prove `OPENROUTER_API_KEY` travels in `Authorization` and reaches no audit column,
along the full endpoint path.

**Contract**: No second seam — the same `astro:env` mock and the same pass-through `fetch`
already make this observable, which is the whole reason for the change of approach. Assert in one
test body: the sentinel key **is** present in the captured `Authorization` header (the positive
control; without it, absence proves only that the request was never issued), is **absent** from
the captured request body — the object `openrouter.ts:179` aliases as `rawRequest` — and appears
in **no** field of the persisted row. Restore `globalThis.fetch` in a teardown: not to protect
other files (`isolate: true` already does), but because `unstubGlobals` and `restoreMocks` default
to `false`, so a later `it()` in this file would otherwise read the DB through a stale double.

#### 3. Cookbook entry

**File**: `context/foundation/test-plan.md` §6.9 (new sub-section)

**Intent**: Record when a module double is permitted, so the precedent does not spread by
imitation into places where it would mock away the lock under test.

**Contract**: New sub-section after §6.8 (keeping existing §6.x anchors stable). States: the
only module ever doubled is `astro:env/server`, and only to reach a branch sealed by the
preflight/mock-mode/inlining clamp; **why `@/lib/openrouter` is the wrong module to double** (it
makes the header code unreachable, so half the claim silently evaporates); the factory must
spread `...actual` or `createClient` returns `null`; `vi.hoisted` is required for the sentinel;
the pass-through `fetch` is the replacement for the lifted preflight clamp and goes in first; the
database and RLS are never doubled. §4's "API mocking: none yet" line is updated to point here.
Record that `isolate: true` makes cross-file leakage a non-issue and intra-file teardown the real
requirement — so the next contributor does not mistake the config for the guard.

### Success Criteria:

#### Automated Verification:

- New file passes alone: `npx vitest run tests/generation/failure-path.test.ts`
- Full suite passes: `npm test` — kept as a smoke check, **not** as proof that the double did not
  leak: `isolate: true` guarantees that by configuration, so a green run here is a tautology
- Lint passes: `npm run lint`

#### Manual Verification:

- Deliberate-breakage check 1 recorded: comment out the `vi.mock("astro:env/server", …)` factory;
  confirm the suite goes red on the **decisive** observation — `expected 200 to be 502`, i.e.
  without the seam the request falls through to mock mode and *succeeds*. (Already observed during
  research; re-run it against the real file so the record is this change's own.)
- Deliberate-breakage check 2 recorded: make the 502 branch interpolate `err.message` into its
  body; confirm exactly the no-leak assertion goes red
- Deliberate-breakage check 3 recorded: move `Authorization` into the request body in
  `openrouter.ts`; confirm exactly the key assertion goes red while its positive control reports
  the header now absent
- All production edits reverted and the suite re-run green; none committed

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Verification sweep and test-plan sync

### Overview

Record what was proven, correct what `test-plan.md` states falsely, and close Phase 2.

### Changes Required:

#### 1. Verification record

**File**: `context/changes/ai-candidate-generation-test-2/verification.md` (new)

**Intent**: Capture every deliberate-breakage run with its observed red/green split and its
verified restore, so a future reader can re-run them rather than trust them.

**Contract**: One section per check (Phases 1–5), each recording the edit made, the exact
observed failure output, the count of tests red vs green, and the restore verification
(policy `diff` output for the RLS ones). Plus the Stryker run's per-mutant verdict for the
auth mapper, following `context/changes/candidate-review/mutation-register.md`'s shape.

#### 2. Correct the false claims

**File**: `context/foundation/test-plan.md`

> **Unblocked as a dependency; still last in the queue.** Updated at plan-review (F4),
> 2026-07-26. C10X-27's implementation **has landed** — `a018717..bfe53dd`, five commits,
> epilogue closed — so the original "BLOCKED until C10X-27's implementation lands" is satisfied.
> What remains true is the *reason* behind it: `test-plan.md` moved by ~480 lines
> (858 → 1338) and this phase must re-derive its list against the file as it will actually be,
> never against a line number in this plan.
>
> **SATISFIED 2026-07-26.** The "runs SECOND" direction is discharged: C10X-27 merged (PR #13)
> and archived, and this change now sits on `C10X-28-ai-candidate-generation-test-2`, cut from
> that merged `main`. **The re-derivation requirement is untouched and is the live part of this
> note.** `test-plan.md` is **1352** lines on `main` — different again from every figure this
> plan quotes — so rebuild the list by reading the file, and treat the line numbers below as
> historical without exception.

**Intent**: Correct whatever is *still* false — having first established what is, rather than
applying a list assembled before a sibling change rewrote the file.

**Contract**: The first step is **re-derivation, not editing.** Re-read the post-C10X-27
`test-plan.md` and rebuild the list; treat every line number below as historical. As of
2026-07-26 14:58, three of the four items research found were **already closed by C10X-27**:
§8's "69/69 green, 8 files" (the ledger now records `109/109 green, 11 files`, matching this
change's independent measurement), §6.6's middleware-guard gap (explicitly marked closed), and
§6.5's `generations.ts:29-34` anchor (gone from the file). Then:

- **The one item known to be still open** — the Stryker command
  `--mutate "src/lib/flashcards.ts:181-212"`, a range that no longer contains `setFlashcardState`
  (now `:218`; moved by `75df78f`, two hours after the run that range records). Correct it **and
  name the symbol beside the number**, so the next line shift is survivable. The copy in
  `context/archive/2026-07-25-candidate-review/mutation-register.md:3` is frozen — leave it.
- **`tests/generation/generate.test.ts:37`** — the same wrong `generations.ts:29-34` anchor in a
  live code comment, which C10X-27 did not touch. Not doc-sync, but a one-line fix worth taking.
- **§8 ledger** — add *this* change's own entry with the suite state **measured at its
  completion**, dated. Do not copy a number from any document: the frame's "97/10" is dead and
  research's "109/11" is now C10X-27's recorded figure, not this change's.
- **§4** — the "API mocking: none yet" row now points at §6.9 (or, if Phase 5 was cut, states the
  seal, that research demonstrated the seam that lifts it, and the decision not to use it).

#### 3. Record the new coverage

**File**: `context/foundation/test-plan.md`

**Intent**: State precisely what Risk #4 and Risk #6 coverage now means — and what it does
not.

**Contract**: A §6.6 entry for this change with a claim/what-proves-it table, matching the
Phase 4 and S-05 entries' shape. It must name the negative space explicitly: the log-line
half is bounded to `src/`; dependency-emitted lines are in scope but unowned; the
client-bundle half is closed by construction and untested by choice; 502/422 either pinned
(Phase 5) or recorded as named negative space in §7 (if cut). §2's Risk #4 row annotated.

**§3 Phase 2 does NOT flip to `complete` here** — that changed with the scope split (F3).
Phase 2 covers risks #2, #4 and #6; this ticket closes #4 only, so the row stays
`implementing` with **#6 named as the single outstanding risk** and a pointer to the
bounds-parity ticket. Whichever of the two lands second flips the status, and its plan owns
that edit. Claiming `complete` from here would be the same dated-claim failure §3's `reopened`
vocabulary exists to record.

#### 4. Change bookkeeping

**File**: `context/changes/ai-candidate-generation-test-2/change.md`

**Intent**: Reflect the delivered scope.

**Contract**: `status: implemented`, `updated` stamped, and a note that the delivered scope
is wider than the ticket's framing — per the frame's Reframed Problem Statement.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Lint + build pass: `npm run lint`, `npm run build`

#### Manual Verification:

- Every claim in the new §6.6 entry traces to a named test or to an explicit "not covered"
- No statement in `test-plan.md` contradicts the measured suite state
- A reader who knows nothing of this change can tell, from §6.6 alone, which half of Risk #4
  is pinned and which is documented

**Implementation Note**: This is the final phase; confirm the whole change with the human
before archiving.

---

## Testing Strategy

### Unit Tests

- The auth-error mapper: one case per mapped code class, one unknown-code fallback, and a
  sentinel-absence property case proving no input substring reaches the output.
- The no-logging guard: a source-tree assertion, not a behavioural test.

### Integration Tests

- Cross-account read **and** write denial on `generation_session`'s four private columns,
  each with a positive control, driven through RLS-scoped clients against real Postgres.
- Input-contract bounds on `/api/generate`, each asserting a 4xx **and** the absence of a
  session row, with a boundary-value success as the control.
- The 502 **and** 422 sentinel/audit contrasts and the API-key header pin, behind one confined
  `astro:env/server` double plus a pass-through `fetch`. `@/lib/openrouter` is never doubled, so
  the assertions observe production code.
- One endpoint-level auth case proving the `?error=` param carries only a known constant.

### Manual Testing Steps

1. Sign in with a wrong password; read the address bar — the `error` param is a project
   constant, and the submitted email appears nowhere in it.
2. Sign up with an address that already exists; confirm the message differs from the
   generic fallback.
3. Signed out, load `/` and `/auth/signin`; no OpenRouter banner. Sign in; it reappears.
4. Unset `SUPABASE_URL`, load `/` signed out; the Supabase banner still renders.
5. Paste text one character over the limit into the generator; confirm the client refuses,
   then confirm a hand-crafted request is refused too.

## Performance Considerations

None material. The new tests add DB round-trips to an already-DB-bound suite; the module
double removes a network call rather than adding one. The banner gate moves a module-level
filter into per-request layout code — a array filter over two entries.

## Migration Notes

No schema change. `generation_session`'s RLS policies are read and exercised, never altered
— the deliberate-breakage checks mutate them temporarily in the **local** stack only, with a
verified `pg_policies` diff to prove the restore, and are never committed.

## References

- Frame brief: `context/changes/ai-candidate-generation-test-2/frame.md`
- **Research: `context/changes/ai-candidate-generation-test-2/research.md`** — grounds all four
  surfaces, records the executed `astro:env/server` spike with its deliberate-breakage check, and
  carries a 12-row table of where this plan's first draft disagreed with the code. Read its
  § "Verified by execution" before writing Phase 5.
- Risk rows and cookbook: `context/foundation/test-plan.md` §2 (#4, #6), §3 Phase 2, §4,
  §6.2, §6.4, §6.5, §7, §8
- Endpoint bodies: `src/pages/api/generate.ts:89-336`
- Auth relay: `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:16`,
  `src/components/auth/ServerError.tsx:13`, `src/lib/http.ts:52-61` (the `401`/redirect
  interception at `:52-54`, the verbatim render at `:61` — see the narrowing note in
  Current State Analysis)
- Key surface: `src/lib/openrouter.ts:149-158,165-186,194-211`
- Audit surface: `src/lib/generations.ts:24,35,116-121`,
  `supabase/migrations/20260712162349_generation_session.sql:25,32-34,58-74`
- Harness clamps: `tests/setup/preflight.ts:110-118`, `vitest.config.ts:31-34`,
  `tests/fixtures/endpoint.ts:68-82`
- Patterns to copy: `tests/isolation/flashcards.test.ts` (denial + positive control),
  `tests/generation/generate.test.ts:322-417` (input contract),
  `tests/review/candidates.test.ts:120-142,528-545` (seed + session isolation)
- Prior precedent for recording checks:
  `context/changes/candidate-review/mutation-register.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `references/progress-format.md`.
>
> **Execute ALL six phases on this branch (user's direction, 2026-07-26).** The F3 split stands
> as a *bookkeeping* fact — three tickets own three parts of this plan — but **not** as an
> execution boundary: nothing here is skipped. Every step below gets done.
>
> **Every commit on this branch carries `(C10X-28)` — user's direction, 2026-07-26, later the
> same day.** The reason is the branch itself: it is `C10X-28-ai-candidate-generation-test-2`,
> so a foreign key in a subject line reads as drift rather than as attribution. This supersedes
> the per-phase scope table that stood here, which had already been applied once — Phase 1's
> commit was rewritten in place (`340a2eb` → `b0ab625`, unpushed, message only).
>
> Attribution is not lost; it moves off the subject line into the two places that already
> carried it — the phase headers below, and Jira:
>
> | Steps | Attributed to (NOT the commit scope) |
> | --- | --- |
> | 1.1 – 1.7 | C10X-34 — auth error copy, roadmap H-03 |
> | 2.1 – 2.6 | C10X-28 — audit-column isolation |
> | 3.1 – 3.5 | C10X-30 — Risk #6 bounds parity |
> | 4.3 – 4.5 (banner gate) | C10X-34 — ambient disclosure |
> | 4.1, 4.2, 4.6 (`console.*` guard) | C10X-28 — log-line half of Risk #4 |
> | 5.1 – 5.8, 6.1 – 6.5 | C10X-28 — module double, doc-sync |
>
> One consequence sharpens rather than softens: with the scope key no longer encoding it,
> **this plan and Jira are the only trace of C10X-34's and C10X-30's work**, so the
> "close or annotate after merge" item below stops being hygiene and becomes the sole link.
>
> **One consequence is a gain and Phase 6 must act on it.** F3 said §3 Phase 2 could not flip to
> `complete`, because it covers risks #2, #4 **and #6** and #6 was leaving with C10X-30. Doing
> Phase 3 here closes #6's source-text half in the same change — so Phase 6 should re-evaluate
> that call against what actually landed, rather than inheriting the "stays `implementing`"
> note written under the split assumption. The card-content half of C10X-30 (S-02's endpoints)
> is still deliberately out of scope, so the answer is not automatic.
>
> **One consequence to settle at the end, not now:** C10X-34 and C10X-30 will have had their
> work done outside themselves, so they need closing or annotating after merge. (This paragraph
> used to name a second one — "the branch will carry commits under three scope keys, which is
> intended, not drift". That is void: the scope note above settled on one key, `(C10X-28)`.)

### Phase 1: Auth error copy — stop the verbatim relay

> Attributed to C10X-34 (roadmap H-03) — **executed here**, commit scoped `(C10X-28)`.

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — b0ab625
- [x] 1.2 Full suite passes: `npm test` — b0ab625
- [x] 1.3 New file passes alone: `npx vitest run tests/auth/errors.test.ts` — b0ab625
- [x] 1.4 Stryker narrowed to the mapper leaves no class-changing survivor — b0ab625

#### Manual

- [x] 1.5 Wrong password shows actionable Polish copy; `?error=` is a known constant — b0ab625
- [x] 1.6 Already-registered address shows its own distinct message — b0ab625
- [x] 1.7 Deliberate-breakage check recorded: one mapping broken, exactly that class red — b0ab625

### Phase 2: Cross-account isolation of the audit columns

#### Automated

- [x] 2.1 Full suite passes: `npm test` — f95fcd5
- [x] 2.2 File passes alone: `npx vitest run tests/review/candidates.test.ts` — f95fcd5

#### Manual

- [x] 2.3 Deliberate-breakage check recorded: `generation_session_select` neutered, reads red — f95fcd5
- [x] 2.4 Deliberate-breakage check recorded: `generation_session_update` neutered, write red — f95fcd5
- [x] 2.5 Restore verified by `pg_policies` before/after diff, diff empty — f95fcd5
- [x] 2.6 Full suite green after restore — f95fcd5

### Phase 3: Server-side bounds parity (Risk #6) + single-source `SOURCE_MAX`

> Attributed to C10X-30 (`server-side-validation-test`) — **executed here**, commits scoped
> `(C10X-28)`.

#### Automated

- [x] 3.1 `npx astro sync` then lint passes: `npm run lint` — b520b90
- [x] 3.2 Build passes: `npm run build` — b520b90
- [x] 3.3 Full suite passes: `npm test` — b520b90

#### Manual

- [x] 3.4 Generator form still enforces the limit client-side after the import swap — b520b90
- [x] 3.5 Deliberate-breakage check recorded: server limit raised, over-length case red,
      boundary control green — b520b90

### Phase 4: Ambient disclosure — banner gate and the log boundary

#### Automated

- [x] 4.1 Full suite passes: `npm test` — 34e8837
- [x] 4.2 Build passes: `npm run build` — 34e8837

#### Manual

- [x] 4.3 Signed out, no OpenRouter banner on `/` or `/auth/signin` — 34e8837
- [x] 4.4 Signed in, the OpenRouter banner still appears when the key is unset — 34e8837
- [x] 4.5 With `SUPABASE_URL` unset, the Supabase banner still renders while signed out — 34e8837
- [x] 4.6 Deliberate-breakage check recorded: a `console.log` in `src/` turns the guard red — 34e8837

### Phase 5: The project's first module double — no-leak and API-key pins

#### Automated

- [x] 5.1 New file passes alone: `npx vitest run tests/generation/failure-path.test.ts` —
      covering 502 **and** 422
- [x] 5.2 Full suite passes: `npm test` (smoke check only — `isolate: true` already guarantees
      no cross-file leakage, so this is not the proof)
- [x] 5.3 Lint passes: `npm run lint`

#### Manual

- [x] 5.4 Deliberate-breakage check 1 recorded: `vi.mock("astro:env/server", …)` commented out,
      red on `expected 200 to be 502` (the seam, not an incidental pass)
- [x] 5.5 Deliberate-breakage check 2 recorded: 502 body interpolates `err.message`,
      exactly the no-leak assertion red
- [x] 5.6 Deliberate-breakage check 3 recorded: `Authorization` moved into the body,
      exactly the key assertion red while its positive control reports the header absent
- [x] 5.7 All production edits reverted, suite green, none committed
- [x] 5.8 `globalThis.fetch` restored in teardown — verified by a later `it()` in the same file
      still reading the DB (intra-file is the real hazard, not cross-file)

### Phase 6: Verification sweep and test-plan sync

#### Automated

- [ ] 6.1 Full suite passes: `npm test`
- [ ] 6.2 Lint + build pass: `npm run lint`, `npm run build`

#### Manual

- [ ] 6.3 Every claim in the new §6.6 entry traces to a named test or an explicit gap
- [ ] 6.4 No statement in `test-plan.md` contradicts the measured suite state
- [ ] 6.5 §6.6 alone tells a cold reader which half of Risk #4 is pinned, which documented
