---
date: 2026-07-26T14:39:05+02:00
researcher: lirdaw
git_commit: da5e9c213b10f9b1bcca144a9920c3b7b7eabcb6
branch: C10X-27-srs-study-session-test
repository: lirdaw/10xcards
topic: "No source-text or API-key leak on the generation failure path (C10X-28) — grounding the four surfaces the plan rests on"
tags: [research, codebase, generate-endpoint, openrouter, astro-env, vitest, rls, auth-errors, risk-6]
status: complete
last_updated: 2026-07-26
last_updated_by: lirdaw
---

# Research: No source-text or API-key leak on the generation failure path (C10X-28)

**Date**: 2026-07-26T14:39:05+02:00
**Researcher**: lirdaw
**Git Commit**: `da5e9c213b10f9b1bcca144a9920c3b7b7eabcb6`
**Branch**: `C10X-27-srs-study-session-test`
**Repository**: `lirdaw/10xcards`

## Research Question

Ground the four surfaces `plan.md` rests on before any test is written — the prerequisite
`change.md:12` names ("research pins the oracle and the cheapest layer") and the gap
`plan-brief.md:108` admits ("Risk #6 is being planned without its own research pass"):

1. **Risk #6 / bounds parity** — the input-validation surface of the generation path, never
   researched by any prior pass.
2. **Phase 5's module double** — whether the `Authorization`-header pin is reachable at all.
3. **Re-verification of the plan's `file:line` anchors** against live HEAD, which moved three
   times since the frame collected them.
4. **The Phase 1 / 2 / 4 surfaces** — the auth mapper's key, `generation_session`'s RLS and
   seed helper, the banner wiring and the `console.*` claim.

Scope decision taken with the user: contradictions are **reported here only**. `plan.md` is
left untouched — corrections belong to `/10x-plan-review` or the implementation phase.

> **HEAD moved three times during this change's investigation.** The frame ran at `d2ba91f`
> and re-checked at `a018717`; this research opened at `4756060` and HEAD is now `da5e9c2`
> (`fix(C10X-27): close the three recorded study-path defects (p3)`). Every anchor below was
> read at `da5e9c2`. None of C10X-27's commits touches the generation path, the auth routes,
> `config-status.ts`, `Layout.astro` or `openrouter.ts` — verified, not assumed.

## Summary

Six findings, in order of consequence.

**1. Phase 5's API-key pin cannot work as written, and the fix is a *smaller* seam that is
now demonstrated by execution.** The plan names `isOpenRouterConfigured` as the seam
(`plan.md:479`); that function is **dead code** — its only occurrences in the repo are its own
definition at `src/lib/openrouter.ts:57` and the plan sentence itself. Worse, the plan's own
double defeats the plan's own assertion: if `generateCandidates` is replaced by `vi.fn()`, the
header-building code at `src/lib/openrouter.ts:183-193` never executes, so no request is
issued and the positive control at `plan.md:480-482` cannot pass. The working seam is to
double **`astro:env/server`** instead — the key is read inside function bodies off an ESM
import binding (`openrouter.ts:58,149,186`), never captured module-scope, so replacing that
module flips the mock-mode gate while leaving all production code real. **Run, with a
deliberate-breakage check** (see "Verified by execution"): one seam reaches 502 **and** 422,
pins the real `Authorization` header, and pins the audit columns — and it removes the
class-identity trap `plan.md:177-181` spends a paragraph defending against, because
`OpenRouterError` is never doubled.

**2. Risk #6's surface is roughly four times wider than the plan's `SOURCE_MAX` framing.**
Four generation bounds are duplicated as independent literals, not one: `SOURCE_MAX`,
`COUNT_MIN`, `COUNT_MAX` and the whole `LANGUAGES` whitelist
(`generate.ts:22-30` vs `GeneratorForm.tsx:12-30`). The deck-name bound `1..100` exists in
**six** places. `SIZE_MAX` and `IDS_MAX` are mirrored the same way. And the sharpest instance
of "the server trusts the client" is not on the generation path at all: **neither auth route
validates anything server-side** — `SignUpForm.tsx:8`'s `MIN_PASSWORD_LENGTH = 6` has no
server counterpart, and `form.get("email") as string` launders a possible `null` past the type
system (`signin.ts:6-7`).

**3. The plan's "no write" oracle is status-filtered and blind to exactly the rows a failure
leaves.** `succeededSessions` (`tests/generation/generate.test.ts:123-132`, read verbatim)
carries `.eq("status", "succeeded")`. "4xx implies no row" **does** hold across the entire
Risk #6 surface — every input-contract rejection returns at `generate.ts:118`, `:123` or
`:128`, all before the first DB statement at `:148`. It does **not** hold for the handler:
the 502 and 422 branches each write a `failed` session *before* returning
(`generate.ts:211-235`, `:248-262`). So the oracle is currently correct-but-vacuous, and it
would silently stop being an oracle the moment a case perturbs the generation path.

**4. An unnamed asymmetry in the source-text bound.** `generate.ts:52` is
`z.string().min(1).max(SOURCE_MAX)` with **no `.trim()`**, while the minimum is re-checked
post-trim at `:126-129`. So the maximum constrains the raw string and the minimum the trimmed
one: 10 001 characters ending in whitespace is a 400 even though the meaningful text is under
the cap. Testable, and it decides what the Phase 3 boundary control actually pins.

**5. Phase 1's mapper key is the right choice, with three caveats the plan does not carry.**
`AuthError.code` is populated from the response body (`data.code` gated on an API-version
header, else `data.error_code` — `@supabase/auth-js/dist/module/lib/fetch.js:39-50`), and it
**may be `undefined`** for five error classes. The `ErrorCode` type is *not* re-exported from
`@supabase/supabase-js`, so the mapper must key on plain string literals. And the
already-registered-email case the plan's manual check #2 relies on behaves differently in
production: with confirmations on (the prod default) GoTrue returns **200 and an obfuscated
user — no error at all**, so `signup.ts:15` is never entered. Locally it is reachable only
because `supabase/config.toml:209` sets `enable_confirmations = false`.

**6. `test-plan.md` had four false statements when this research began — C10X-27 closed three of
them WHILE this pass was running, and the fourth is still open.** This section is therefore a
snapshot with a short shelf life; see § "Concurrency hazard" below before acting on it.

| # | The claim as found | Status at 14:58 |
| --- | --- | --- |
| 1 | §8's ledger said "69/69 green, 8 files" | **Closed by C10X-27, and correctly.** The rewritten ledger keeps 69/69 as the state at the *audit* moment and adds a second bullet recording **"109/109 green, 11 files"** as the state proven by execution later the same day. That is exactly the number this research measured independently at `da5e9c2` — an unplanned cross-check that agrees to the test. `frame.md:112-115`'s proposed "97/10" is dead; nobody should write it. |
| 2 | §6.6's Phase-1 note said the middleware guard is untested | **Closed by C10X-27** — the section now reads "**Closed 2026-07-26 by C10X-27** — the middleware guard now has that table-driven [coverage]". |
| 3 | §6.5 cited `src/lib/generations.ts:29-34` for the compensating update | **Closed by C10X-27** — the anchor is gone from the file entirely (neither `:29-34` nor `:116-121` appears now). |
| 4 | §6.6 instructs `--mutate "src/lib/flashcards.ts:181-212"` | **STILL OPEN.** Present in the current file. `setFlashcardState` moved to `:218` in `75df78f` (2026-07-25 15:02), two hours *after* the Stryker run that range records, so it now mutates `updateFlashcard` and `ALLOWED_FROM` (`:195-205`) instead of the function it claims. `context/archive/2026-07-25-candidate-review/mutation-register.md:3` carries the same range and is correctly frozen. |

Outside `test-plan.md`, the same `generations.ts:29-34` anchor still sits in a **live code
comment** at `tests/generation/generate.test.ts:37` — a one-line fix, not doc-sync, and not
something C10X-27 touched. The general lesson survives all of the above: a per-line `--mutate`
range and a `path:line` in prose are both perishable, so pin them by **symbol name beside the
number**.

## Concurrency hazard — read before acting on anything about `test-plan.md`

`context/foundation/test-plan.md` was **being actively rewritten by C10X-27 during this research
pass**: 1018 lines at `HEAD`, 1332 in the working tree, with its mtime advancing between two of
this session's own greps. Every line number this document gives for that file is a reading taken
at ~14:58 on 2026-07-26 and may already be wrong.

Two consequences, both binding on this change:

- **Phase 6 must re-derive its doc-sync list against the post-C10X-27 file**, not trust the line
  numbers here. Three of four items are already closed, so acting on the list as written would
  mean re-fixing fixed text — the classic way a parallel change clobbers a sibling.
- **This change does not touch `test-plan.md`, `roadmap.md` or anything under
  `context/changes/srs-study-session-test/` until C10X-27's implementation lands.** Recorded as a
  sequencing constraint at the user's direction: C10X-27 has priority, and this change's Phase 6
  is the only phase that contends with it. Phases 1–5 touch disjoint files and are unaffected.

One disclosure about shared state: this research's spike, and its full-suite run, executed against
the **shared local Supabase stack** (a `git worktree` isolated the files, not the database). The
run was green at 109/109, which means no policy or function was in a neutered state at that
moment — but if C10X-27 was mid deliberate-breakage check, an unexpected concurrent suite run is
worth knowing about. Rows created were the ordinary per-run throwaway accounts the suite always
provisions.

## Verified by Execution (spike, 2026-07-26)

The recommended seam was source-verified by reading, then **run** — the same standard
`frame.md:86-99` set for the other seam. Done in a **detached `git worktree`** at `da5e9c2`
(user's choice), with `node_modules` reached by a Windows junction and `.env` copied, so the
in-flight C10X-27 tree was never touched. Spike file written, executed, deleted; worktree and
its git metadata removed; **zero residue** (`git worktree list`, `git status` and a
name search all confirmed clean afterwards).

Seam under test:

```ts
const { SENTINEL_KEY } = vi.hoisted(() => ({ SENTINEL_KEY: "sk-or-spike-SENTINEL-a1b2c3" }));
vi.mock("astro:env/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("astro:env/server")>();
  return { ...actual, OPENROUTER_API_KEY: SENTINEL_KEY };
});
```

| Stage | Result |
| --- | --- |
| **A** — the mocked binding is visible from inside `@/lib/openrouter` | **PASS.** `isOpenRouterConfigured()` is `true`; `resolveModel()` still returns the default, proving `...actual` survived. |
| **B** — the real header code runs; the 502 audit contrast holds | **PASS.** `/api/generate` answers **502** with `retriable: true`. The captured outgoing `Request` carries `Authorization: Bearer <SENTINEL>` — built by production code, not by the test. The request body contains the source text and **not** the key. The response body contains **neither** the source text, **nor** the upstream message, **nor** the key, while the persisted row carries `source_text`, `error_message = "OpenRouter HTTP 401"`, the source text inside `request_payload` and the upstream message inside `response_payload` — and the key in no column. No deck was created (deferred past the LLM call, `generate.ts:266-270`). |
| **C** — the same seam reaches 422, the *other* sealed branch | **PASS.** A 200 whose cards all fail `candidateSchema` (`front` > `FRONT_MAX`) gives `generated_count = 2`, `saved_count = 0`, `error_message = "Model nie zwrócił poprawnych kart"`, status **422**. |
| **Deliberate-breakage check** | **Both A and B go red with the seam commented out**, and B fails on the decisive observation — `expected 200 to be 502`, i.e. without the mock the request falls through to real mock mode and **succeeds**. A also fails cleanly (`expected false to be true`). That split is what proves the assertions observe the interception rather than passing incidentally. |
| Full suite in the worktree after deleting the spike | **109 passed / 11 files** (`npm test`, local stack up, `OPENROUTER_API_KEY` unset). |

Four mechanical facts the spike settled that no amount of reading would have:

- **`vi.mock("astro:env/server", …)` works, null-byte virtual id and all.** The plugin resolves
  it to `"\0astro:env/server"` (`node_modules/astro/dist/env/vite-plugin-env.js:37-54`) and
  Vitest's runner strips the `?_vitest_original` query that `importOriginal` appends, precisely
  so a virtual module's `load` hook still matches.
- **`vi.hoisted` is mandatory for the sentinel.** `vi.mock` factories are hoisted above every
  import, so a plain module-scope `const` is in its TDZ when the factory runs. The plan does
  not mention this.
- **`...actual` is load-bearing for a second reason the plan does not state.**
  `SUPABASE_URL`/`SUPABASE_KEY` come from the same module (`src/lib/supabase.ts:3`). A factory
  returning only the key makes `createClient` return `null` and `/api/generate` answers
  **500 at `:105-107`**, never reaching the LLM call — which reads as a mysterious failure,
  not as a wiring error.
- **The `fetch` double must be a pass-through, not a replacement.** Inside one `callEndpoint`
  the endpoint makes Supabase calls at `generate.ts:148,171,211,270,288,326` over
  `globalThis.fetch`, and the test reads the audit row back the same way. Match on
  `openrouter.ts:10`'s `OPENROUTER_URL` and delegate everything else. Install it **before**
  the key seam: the `astro:env` mock lifts the clamp `preflight.ts:110-118` exists to enforce,
  and the fetch double is what re-closes it — without it, a sentinel key produces a real
  outbound call to `openrouter.ai`.

## Detailed Findings

### Area 1 — Risk #6: the bounds-parity surface

**The full input contract** lives in `bodySchema`, `src/pages/api/generate.ts:48-61`:

| Field | Rule | Line |
| --- | --- | --- |
| `deckPublicId` | `z.string().regex(UUID_RE).optional()` (case-insensitive) | `:50` |
| `newDeckName` | `z.string().trim().min(1).max(100).optional()` — bounds apply **post-trim** | `:51` |
| `sourceText` | `z.string().min(1).max(SOURCE_MAX)` — **no `.trim()`** | `:52` |
| `language` | `z.enum(LANGUAGES)` — the prompt-injection guard (`:26-29`; value interpolated at `openrouter.ts:97`) | `:53` |
| `count` | `z.number().int().min(COUNT_MIN).max(COUNT_MAX)` → 1..15 | `:54` |
| `idempotencyKey` | `z.string().regex(UUID_RE).optional()` | `:57` |
| cross-field | `.refine(… Boolean(deckPublicId) !== Boolean(newDeckName) …)` | `:59-61` |

Constants, all module-local and none exported: `SOURCE_MAX = 10_000` (`:22`),
`COUNT_MIN = 1` (`:23`), `COUNT_MAX = 15` (`:24`), `LANGUAGES` (`:30`), `UUID_RE` (`:44`).

**`SOURCE_MAX` has no database backstop.** `generation_session.source_text` is
`text not null check (char_length(source_text) > 0)`
(`supabase/migrations/20260712162349_generation_session.sql:25`) — non-emptiness only. That is
the opposite of `session_size`, which carries both a Zod bound and
`deck_session_size_check check (session_size between 1 and 100)`
(`20260724220524_srs_study_schedule_review_fixes.sql:20`) — the only bound in the project with
a real DB backstop *and* a test at both layers, and therefore the pattern to copy.

**Validation is strictly ahead of every write.** The parse completes at `:121-124` and the
post-trim guard at `:126-129`; the first DB statement is the idempotency lookup at `:148`.
Rejection branches and their write state:

| Branch | Status | Rows written first |
| --- | --- | --- |
| `:106`, `:111`, `:118`, `:123`, `:128` | 500 / 401 / 400 | none |
| `:150`, `:173`, `:176`, `:185`, `:188`, `:192` | 500 / 404 / 409 / 400 | none (`:148`, `:171`, `:183` are SELECTs) |
| **`:236`** | **502** | **one `generation_session`, status `failed`** — inserted `:211` |
| **`:263`** | **422** | **one `generation_session`, status `failed`** — inserted `:248` |
| `:273-275` | 409 / 500 | `createDeck` errored, so none |
| `:323` | 500 | session insert failed; a deck from `:270` is undone at `:320-322`, best-effort |
| `:336` | 500 | session exists, flipped to `failed` by `failGenerationSession` (`:330`) |

Two ordering facts worth recording without over-claiming. `:284` (`deckId === null`) is the
one post-`createDeck` return that does **not** compensate — unreachable as written, but it
would leak a deck if it ever became reachable. And the replay-after-`23505` return at `:311`
sits *before* the `deleteDeck` compensation at `:320-322`, so a concurrent pair sharing one
key but carrying **different** `newDeckName` values could leave an empty orphan deck plus a
200. Both are derived from control flow, **not reproduced**.

**Every client-side duplicate** (the plan names one; there are four on this path alone):

| Site | Literal | Mirrors |
| --- | --- | --- |
| `GeneratorForm.tsx:12` | `SOURCE_MAX = 10_000` | `generate.ts:22` |
| `GeneratorForm.tsx:13` | `COUNT_MIN = 1` | `generate.ts:23` |
| `GeneratorForm.tsx:14` | `COUNT_MAX = 15` | `generate.ts:24` |
| `GeneratorForm.tsx:23-30` | the six `LANGUAGES` values | `generate.ts:30` |
| `GeneratorForm.tsx:127,128,248-249,291,293,296` | the enforcement + `maxLength` + `min`/`max` + char counter | `generate.ts:52,54` |

Deck name `1..100` appears at `GeneratorForm.tsx:135,273`, `CreateDeckModal.tsx:43-45`,
`DeckActions.tsx:48-50`, `api/decks/index.ts:25-26`, `api/decks/[publicId].ts:34-35` and
`generate.ts:51`. `StudySession.tsx:20-22` and `CandidateReviewWorkspace.tsx:18-27` mirror
`SIZE_MAX` and `IDS_MAX` with an explicit "Mirrors …" comment — i.e. the project's habit is a
commented copy, and `FRONT_MAX`/`BACK_MAX` are the single exception.

**The single-sourcing precedent.** `src/lib/flashcards.ts:61-62` declares `FRONT_MAX = 200`
and `BACK_MAX = 1000`; importers are `api/decks/[publicId]/cards/index.ts:3`,
`.../[cardPublicId].ts:3`, `src/lib/openrouter.ts:3`, and three islands
(`CreateFlashcardModal.tsx:9`, `FlashcardItem.tsx:4`, `CandidateItem.tsx:4`). The module
imports **only types** (`:1-2`), so it already ships to the browser with no runtime
dependency — mechanically, adding `SOURCE_MAX` there would work. The judgement the plan
should make explicitly rather than by default: `flashcards.ts` is the *flashcard* resource,
while these four constants are the *generation* concern, and `src/lib/generations.ts` has
never been imported by a client component — so a shared generation-constants module would be
a new precedent either way.

**Existing coverage, and the gap.** `tests/generation/generate.test.ts:340-417` holds five
cases: 401 signed-out (via the local container helper at `:92-107`), 400 non-JSON, 400
whitespace-only source (the post-trim guard, per its own comment at `:372-374`), 400 on the
XOR both/neither, and 404 on a never-issued `deckPublicId`. **Untested anywhere in `tests/`:**
`sourceText` over `SOURCE_MAX`; `count` at 0, 16, non-integer, non-number; `language` off the
whitelist; `deckPublicId`/`idempotencyKey` failing `UUID_RE`; `newDeckName` over 100;
`FRONT_MAX`/`BACK_MAX` server enforcement on card create/edit; `IDS_MAX` over 100 on `batch`.

### Area 2 — Phase 5: what is actually reachable

`OPENROUTER_API_KEY` enters `src/lib/openrouter.ts:2` as an ESM import binding and is
**never captured into a module-level const**. Every read is at call time: `:58`
(`isOpenRouterConfigured`), `:147`/`:149` (model + the mock gate), `:186` (the header). That is
the whole reason the `astro:env` seam works — ESM live bindings resolve on each access.

Structural separation of key from audit payload, verified line by line: the body is built at
`:165-177`, `const rawRequest = body` at `:179` is an **alias** of it, and `headers` at
`:185-190` is a sibling object never merged in. So "the key reaches no audit column" is true
by construction — but **only observable if `:183-193` executes**, which the plan's own double
prevents.

Under Vitest, `astro:env/server` is a real module in the graph but its value is a
transform-time inlined literal: `vite-plugin-env.js:82-83` inlines the loaded env in serve
mode, `:142-150` emits `_internalGetSecret(...)` per secret var, and `:153` bakes the whole
`.env` snapshot into a local `getEnv` closure. `dist/env/runtime.js`'s `process.env` reader is
reachable only on the build branch. Consequences: `vi.stubEnv` and `process.env` cannot flip
it, `buildStart`'s `.env`→`process.env` copy never runs, and `setGetEnv` is a dead seam
because the re-assignment re-reads the same literal. **Replacing the module is the only seam**
— which is what the spike did.

Isolation, from Vitest 4.1.10's own defaults (nothing set in `vitest.config.ts`): `pool:
"forks"`, `isolate: true`, `fileParallelism: true`, `globals: false`. So a `vi.mock` cannot
leak across files by configuration — which makes `plan.md:502-503`'s success criterion ("no
other file's behaviour changes, proving the double did not leak") a **tautology**: keep it as a
smoke check, but it is not evidence. The real hazard is **intra**-file: `restoreMocks`,
`clearMocks`, `mockReset` and `unstubGlobals` all default to `false`, so a `globalThis.fetch`
replacement must be restored in an `afterAll`/`afterEach` or a later `it()` in the same file
reads the DB through a stale double. `plan.md:482-483` asks for restoration for the wrong
reason.

The clamp and the double do not conflict: `preflight.ts:110-118` runs as `globalSetup`
(`vitest.config.ts:31`) in the **main process**, reading the real `astro:env/server`, so no
test file's mock can reach it. Confirmed by the spike running green with the key unset in
`.env`.

### Area 3 — anchor re-verification at `da5e9c2`

Almost everything resolves; the exceptions are what matter.

| Anchor | Verdict |
| --- | --- |
| `src/pages/api/generate.ts:273-275` — plan calls it a fixed Polish literal | **Characterisation false.** It is a double ternary: `json(taken ? 409 : 500, { error: taken ? "Talia o tej nazwie już istnieje" : "Nie udało się utworzyć talii" })`. Read myself. The no-leak property is intact — both arms are literals and `error.code` is read only to select between them — but "all 18 returns are fixed literals" is imprecise, and mutation/copy reasoning that treats all 18 uniformly is wrong about this one. |
| `src/lib/flashcards.ts:181-212` — `setFlashcardState` | **SHIFTED to `:218`.** Confirmed myself, including *when*: `75df78f` (2026-07-25 15:02) moved it from `:204` to `:218`, after the Stryker run at 13:13. `test-plan.md:716` and `mutation-register.md:3` now name a range covering `updateFlashcard` + `ALLOWED_FROM` (`:195-205`) instead. |
| `src/lib/generations.ts:29-34` — cited as "the compensating update zeroes `saved_count`" | **WRONG anchor, and it is not in `plan.md`.** Verified by grep: `plan.md` cites `:116-121` correctly. The stale anchor lives in **`context/foundation/test-plan.md:408`** (§6.5) and in a live code comment at **`tests/generation/generate.test.ts:37`**. `:29-34` is `getGenerationSessionByPublicId`'s doc comment + query head (read myself); `failGenerationSession` is `:116-121`, zeroing at `:119`. Several archived docs carry the same anchor and are correctly left frozen. |
| `src/layouts/AuthenticatedLayout.astro:13` | **SHIFTED by 1** — the `<Layout title={title}>` wrap is at `:14`. |
| everything else on the list (18 error returns confirmed as exactly 18; the 502/422 ranges; both auth relays; `http.ts:16,52,56`; `middleware.ts:29-38,57-71,64`; all six `openrouter.ts` anchors; the migration's columns and four policies; `preflight.ts:110-118`; `vitest.config.ts:33`; `endpoint.ts:68-70,82`; the four `candidates.test.ts` anchors; `stryker.config.json`'s two-entry `mutate`; auth-js `2.105.3`) | **RESOLVES** |
| `grep -rn "console\." src/` | **zero matches** — plan claim confirmed, twice independently |
| `grep -rn "vi\.mock\|vi\.spyOn\|vi\.fn" tests/ src/` | **zero matches** — Phase 5 genuinely would be the first |

Side observation: `tests/fixtures/endpoint.ts:41` carries a stale in-comment anchor citing
`generate.ts:10-14` for the JSON-endpoint rationale, which lives at `:16-20`.

### Area 4 — the Phase 1, 2 and 4 surfaces

**Phase 1 — the auth relay.** Both routes are 21 lines and structurally identical; the relay
is `signin.ts:16` / `signup.ts:16`, `encodeURIComponent(error.message)`. Three things the plan
does not carry:

- **`error.code` may be `undefined`.** It is sourced from the response body —
  `data.code` when an `X-Supabase-Api-Version` ≥ `2024-01-01` header is present *and* the
  value is a string, else `data.error_code` (`auth-js/dist/module/lib/fetch.js:39-50`, read
  myself). Five classes carry no code at all: `AuthUnknownError`, `AuthRetryableFetchError`
  (network failure, and status in `[502,503,504,520-524,530]`), `AuthSessionMissingError`,
  `AuthInvalidTokenResponseError`, `AuthInvalidCredentialsError`. Recommended keying order:
  `code` → `name`/exported type guard (`isAuthApiError`, `isAuthWeakPasswordError`,
  `isAuthRetryableFetchError`) → `status` → one Polish default. **Never** fall through to
  `message`.
- **`ErrorCode` is not part of the public surface.** `errors.d.ts` imports it internally and
  neither `@supabase/auth-js`'s nor `@supabase/supabase-js`'s root re-exports it, and the
  package has no `exports` field. Key on plain string literals. Note also that
  `code: ErrorCode | (string & {}) | undefined` gives **no exhaustiveness checking** — a typo
  in a mapper key is not a compile error, which is exactly what the Stryker run in
  `plan.md:249` would need to catch.
- **`weak_password` is the one code that is guaranteed** — `AuthWeakPasswordError`'s
  constructor hardcodes it on both the coded and the legacy path, and the error carries
  `reasons: string[]` usable for granular Polish copy.

The leak vector is confirmed and narrower than "any upstream prose": `_getErrorMessage`
(`fetch.js:5-18`, read myself) prefers `msg`/`message`/`error_description`/`error` and
**falls back to `JSON.stringify(err)`** when none is a string — so a GoTrue body of an
unexpected shape is stringified wholesale into `error.message`, URL-encoded by `signin.ts:16`
and rendered by `ServerError.tsx:13`. No place in the installed package interpolates submitted
input into a message, and the password goes into the *request* body (`fetch.js:80`), never into
an error — so the password cannot reach the URL by this path.

**One prod/local divergence that undercuts a manual check.** `plan.md:255-256` asks the
implementer to confirm "signing up with an already-registered address shows its own distinct
message". Locally that is reachable *only because* `supabase/config.toml:209` sets
`enable_confirmations = false` (verified myself). With confirmations on — the production
default — GoTrue deliberately answers **200 with an obfuscated user and no error**, so
`signup.ts:15` is never entered and the user lands on `/auth/confirm-email`. A mapper cannot
change that; it is anti-enumeration behaviour in the server.

Two undocumented paths in the same two files, neither in the plan's scope but both cheap to
note: `formData()` has no `try`/`catch`, so a JSON-bodied request throws an unhandled 500
rather than redirecting; and `form.get("email") as string` returns `null` for an absent field
and the cast hides it (`signin.ts:6-7`, `signup.ts:6-7`).

**Phase 2 — the audit columns.** `generation_session` carries `source_text` (NOT NULL),
`error_message`, `request_payload`, `response_payload` (all nullable) — migration `:25,32-34`
— plus `idempotency_key uuid` added nullable by `20260725133600_generation_idempotency_key.sql:43-49`.
**No trigger of any kind** and no `updated_at`, deliberately (the migration's own header calls
the session immutable). Four policies, all `user_id = (select auth.uid())`, at `:63-74`;
`revoke all … from anon` + `grant select, insert, update, delete … to authenticated` at
`:60-61`. **No later migration alters the policies, the grants, or adds a trigger.**

The four private columns are **write-only**: no `select()` in `src/lib/generations.ts` names
any of them, and a repo-wide grep finds them only in `src/db/database.types.ts` (generated),
`generations.ts:119` (the `error_message` write) and `generate.ts`'s three
`createGenerationSession` call sites. So their only escape route is the database boundary
itself.

The existing isolation case (`tests/review/candidates.test.ts:528-545`) reads through
`getGenerationSessionByPublicId`, whose projection is
`id, public_id, requested_count, generated_count` (`generations.ts:35`) — it proves the *row*
is hidden from B via that one lib function and **nothing about the four private columns**, and
there is **no cross-account write test on this table at all**. It also sits inside a
`describe` about the acceptance metric (`:485`), not in an isolation file.

`seedGenerationSession` (`:120-142`) writes **only the eight NOT NULL columns** — so the
plan's own warning is right, and the widening is a genuine prerequisite rather than tidiness.
All four call sites (`:402`, `:407`, `:490`, `:529`) seed as account `a`; none seeds as `b`.

The write-denial shape to copy is `tests/isolation/flashcards.test.ts:289-305` plus its inline
positive control at `:307-318` — `before` snapshot via a column-projecting helper (`rowOf`,
`:220-229`), drive the real thing as B, assert the response, re-read as owner and compare
column-for-column, positive control in the same `describe`. For proving RLS hides the *row*
from a direct `.from("generation_session")` read, the pattern is `:105-129`, which hands B
A's real internal id — something B could never obtain through the app.

**Phase 4 — the banner and the log claim.** `configStatuses` and `missingConfigs`
(`config-status.ts:11,28`) are module-level `const`s evaluated at import time, reading
`astro:env/server` at `:1` and computing `configured` inline at `:14` and `:21` — I read this
myself, and it confirms the plan's note: the banner state is frozen for the isolate's lifetime
and cannot vary by request, route or user, so the filtering must happen in the layout.
`Layout.astro:22-37` renders `missingConfigs.map(...)` — **zero, one or two** separate
banners — before `<slot />` at `:38`. `AuthenticatedLayout.astro:2,14,73` wraps `Layout`, so
the block executes on **every** page render; all 11 pages use one layout or the other (5
direct, 6 via `AuthenticatedLayout`).

`Astro.locals.user` **is** reachable in `Layout.astro` and is set for public pages too:
`middleware.ts:47`/`:49` assign it unconditionally, ahead of both the landing redirect
(`:53-55`) and the `PROTECTED_ROUTES` guard (`:57-71`). `Layout.astro` does not read it today;
`AuthenticatedLayout.astro:11` and `dashboard.astro:4` prove the pattern works in this tree.

The `console.*` claim holds for first-party code — **zero matches** across `src/`, and even a
broader grep for the bare word `console` finds nothing, in `.astro` frontmatter and islands
alike. A guard must cover `src/lib/` as well as `src/pages/`: `src/lib/` is where every
data-access helper and `openrouter.ts` live, i.e. the likeliest home of a future debug log.
Dependencies do log — `auth-js/dist/module/lib/fetch.js:110` `console.error(e)` on every failed
fetch, plus five `console.warn` sites in `@supabase/ssr` — and `wrangler.jsonc:17-19` has
`observability.enabled: true` with no sampling, so those lines reach Workers Logs. On
`fetch.js:110` specifically, `e` is a fetch `TypeError` carrying message and stack, **not** the
request `init`, so the submitted password is not printed there.

## Code References

- `src/pages/api/generate.ts:22-30` — the four generation constants, all module-local
- `src/pages/api/generate.ts:48-61` — `bodySchema`; `:52` is the untrimmed max
- `src/pages/api/generate.ts:126-129` — the post-trim minimum, the asymmetry's other half
- `src/pages/api/generate.ts:211-235`, `:248-262` — the two `failed` inserts that precede 502/422
- `src/pages/api/generate.ts:272-275` — the one error return that is a ternary, not a literal
- `src/lib/openrouter.ts:2,58,149,186` — the key as a live ESM binding, read per call
- `src/lib/openrouter.ts:165-179,185-190` — body/`rawRequest` vs the sibling `headers` object
- `src/lib/openrouter.ts:57` — `isOpenRouterConfigured`, dead code, the plan's named seam
- `src/lib/generations.ts:35` — the four-column projection the existing isolation test reads
- `src/lib/generations.ts:116-121` — `failGenerationSession`, the compensating update
- `src/lib/flashcards.ts:61-62` — the single-sourcing precedent; `:218` — `setFlashcardState`
- `src/lib/config-status.ts:11,28` — import-time constants, not per-request
- `src/layouts/Layout.astro:22-37` — the banner block; `AuthenticatedLayout.astro:14` — the wrap
- `src/middleware.ts:47,49` — `locals.user` set ahead of every guard
- `src/pages/api/auth/signin.ts:16`, `signup.ts:16` — the two relays
- `tests/generation/generate.test.ts:117-121` — `expectErrorBody`, a shape oracle only
- `tests/generation/generate.test.ts:123-132` — `succeededSessions`, status-filtered
- `tests/generation/generate.test.ts:340-417` — the five existing input-contract cases
- `tests/review/candidates.test.ts:120-142` — `seedGenerationSession`, eight columns only
- `tests/review/candidates.test.ts:528-545` — the existing read denial, wrong projection
- `tests/isolation/flashcards.test.ts:289-318` — the write-denial + positive-control skeleton
- `tests/setup/preflight.ts:110-118` — the key clamp, main process, unreachable by any mock
- `supabase/migrations/20260712162349_generation_session.sql:25,32-34,60-74`
- `supabase/config.toml:209` — `enable_confirmations = false`, local only
- `node_modules/@supabase/auth-js/dist/module/lib/fetch.js:5-18,39-50` — message and code
- `node_modules/astro/dist/env/vite-plugin-env.js:37-54,82-83,142-155` — the inlining
- `.github/workflows/ci.yml` — no `OPENROUTER_API_KEY` anywhere; local stack + publishable key

## Architecture Insights

- **"Fixed literal per branch, upstream detail to the audit row" is a real, near-uniform
  convention**, and since `a018717` it has a client-side consumer (`http.ts:56` renders the
  server's `error` string verbatim in every island). The two auth routes are the codebase's
  only `?error=` producers emitting English text — the outlier, not a new rule.
- **The project's habit for a shared bound is a *commented copy*, not an import.**
  `StudySession.tsx:20-22` and `CandidateReviewWorkspace.tsx:18-27` say "Mirrors …" out loud.
  `FRONT_MAX`/`BACK_MAX` are the single counter-example. Single-sourcing `SOURCE_MAX` is
  therefore a change of convention, not a repair of a lapse — worth saying so.
- **Only one bound in the whole project has a DB backstop** (`session_size`). Every other
  limit is application-only, which is what makes the server-side test the *only* layer for
  Risk #6 rather than a redundant one.
- **Two clamps that look like one.** Preflight's key check runs in the main process at
  `globalSetup`; the mock-mode gate runs per call inside the module. They are independent,
  which is exactly why a per-file module mock can lift the second without touching the first.
- **`isolate: true` means several of the plan's "proofs" are configuration, not evidence.**
  Worth keeping the smoke check, worth not calling it proof.

## Historical Context (from prior changes)

- `context/archive/2026-07-18-ai-candidate-generation-test/research.md:30` — *"Scope confirmed
  with the user: **Risk #2 only** (not #4 / #6, which share §3 Phase 2)."* This change closing
  #4 and #6 executes a recorded intention rather than widening scope.
- `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108` — finding
  F5, the deliberate idempotency deferral that Risk #2's inversion later discharged; the
  precedent for "record the deferral explicitly, then close it".
- `context/archive/2026-07-25-candidate-review/mutation-register.md:3` — the Stryker range that
  `75df78f` invalidated two hours later. A per-line `--mutate` range is a perishable artifact;
  worth pinning by symbol name in prose beside the range.
- `context/foundation/lessons.md` — *"Preflight musi domknąć KAŻDY nielokalny szew"* is the
  rule Phase 5 brushes against: the `astro:env` mock deliberately lifts a preflight clamp, so
  the fetch pass-through is not a convenience but the replacement guard, and the file rule must
  say so.
- `context/foundation/lessons.md` — *"Astro Container API nie uruchamia middleware projektu"*
  and *"Nigdy nie sklejaj ręcznie cookie sesji"* both hold unchanged for every test proposed
  here.
- `context/foundation/lessons.md` — *"Pliki gitignored nie przechodzą do nowego `git worktree`"*
  is why this research's spike needed a `node_modules` junction and a copied `.env`.

## Related Research

- `context/changes/ai-candidate-generation-test-2/frame.md` — the framing this grounds; its
  D1–D6 verdicts still hold, with the two corrections noted below
- `context/archive/2026-07-18-ai-candidate-generation-test/research.md` — Risk #2's pass, and
  the scope note that parked #4/#6 here
- `context/changes/srs-study-session-test/plan.md` — the in-flight C10X-27 work sharing this
  branch

## Where this research contradicts `plan.md` and `frame.md`

Reported only, per the scope decision — nothing was edited.

| # | Document claim | What the code says |
| --- | --- | --- |
| 1 | `plan.md:478-480` — the module double is the seam, `isOpenRouterConfigured`/the key read overridable from the factory | `isOpenRouterConfigured` has **zero callers**; the key is **not an export** of `@/lib/openrouter`. Neither half of the named seam exists. |
| 2 | `plan.md:471-483` — the API-key pin, via `callEndpoint`, with `@/lib/openrouter` doubled | Mutually exclusive: doubling `generateCandidates` means `openrouter.ts:183-193` never runs, so no request is issued and the plan's own positive control cannot pass. **Demonstrated alternative**: double `astro:env/server` + pass-through `fetch`, which also reaches 422 and needs no `@/lib/openrouter` double at all. |
| 3 | `plan.md:28-30`, `frame.md:55` — all 18 error returns are fixed Polish literals | 17 are. `generate.ts:272-275` is a double ternary. The no-leak property survives; the uniformity claim does not. |
| 4 | `plan.md:353-359` — each bounds case asserts `succeededSessions(<its own source text>)` is empty | That helper filters `status = 'succeeded'` (`generate.test.ts:129`). Correct for these branches only because they all return before `:148`; it is blind to a `failed` row and to any `deck` row. Prefer a status-agnostic count, or pair it with a deck check. |
| 5 | `plan.md:70-75`, `plan-brief.md:28-33` — Risk #6 framed as `SOURCE_MAX` duplication | Four generation bounds are duplicated, the deck-name bound sits in six places, and the auth routes validate **nothing** server-side (`SignUpForm.tsx:8`'s min-6 has no counterpart). |
| 6 | `plan.md:502-503` — "no other file's behaviour changes, proving the double did not leak" | Guaranteed by `isolate: true`; it is a tautology, not evidence. The real hazard is intra-file, since `restoreMocks`/`unstubGlobals` default to `false`. |
| 7 | `plan.md:255-256` — manual check: an already-registered address shows its own distinct message | Reachable **locally only**, because `config.toml:209` disables confirmations. With confirmations on (prod default) GoTrue returns 200 + an obfuscated user and no error at all. |
| 8 | `plan.md:206-211` — mapper keyed on `AuthError.code` | Sound, but `code` is `undefined` for five error classes, and `ErrorCode` is not publicly exported. Needs a documented fallback chain and plain string keys. |
| 9 | `plan.md:546-547` — replace §8's "69/69, 8 files" with the measured state; `frame.md:112-115` proposes "97/10" | **Overtaken by events.** C10X-27 rewrote the ledger while this pass ran and already records **109/109 green, 11 files** — the same figure measured independently here. Phase 6 must *not* rewrite that bullet; it must re-derive what, if anything, is still false after C10X-27 lands. "97/10" is dead and should not be written by anyone. |
| 10 | ~~`plan.md:644` cites `src/lib/generations.ts:29-34`~~ — **this row was wrong on first writing and is corrected here** | `plan.md` cites `:116-121` correctly. The stale `:29-34` anchor is in `context/foundation/test-plan.md:408` (§6.5) and in a live code comment at `tests/generation/generate.test.ts:37`, so it belongs to Phase 6's doc-sync plus a one-line comment fix — not to the plan's references. |
| 11 | `frame.md:56` cites GoTrue **2.192.0** for the client behaviour | That is the server image. The installed **client** is `@supabase/auth-js` 2.105.3 — `plan.md:84-87` already caught this; recorded here so the frame's citation is not re-used. |
| 12 | not claimed anywhere — a stale statement neither the frame nor the plan found | `test-plan.md` (line 716 as first read, 958 after C10X-27's rewrite) instructs `--mutate "src/lib/flashcards.ts:181-212"`, a range that no longer contains `setFlashcardState` (now `:218`). **The only one of the four that is still open**, and the moving line number is itself the argument for pinning ranges by symbol name. Fix it in Phase 6 *after* C10X-27 lands. |

## Open Questions

1. **Where do the four generation constants live?** `src/lib/flashcards.ts` works mechanically
   (types-only imports, three islands already import from it) but is the wrong resource;
   `src/lib/generations.ts` is the right concern but has never shipped to a client. A new
   `src/lib/generation-limits.ts` is a third option and the plan's current guess. No precedent
   decides it — a plan call, not a research one.
2. **How wide does Risk #6 go in this change?** The plan scopes it to `SOURCE_MAX` +
   `/api/generate` bounds. The auth routes' total absence of server-side validation is the
   starker instance of the same risk and is *already* being touched by Phase 1 — deliberate
   in-scope/out-of-scope call needed rather than a silent omission.
3. **Does the `astro:env` seam belong in one file or become a named fixture?** The spike proves
   one file works. Whether the pass-through `fetch` helper is worth extracting to
   `tests/fixtures/` depends on whether Phase 5 grows past the two pins.
4. **Is `z.number()`'s rejection of `NaN`/`Infinity` worth a case?** Zod `^4.4.3` semantics say
   yes; nothing in this repo exercises it and no source was read. Candidate case, not a fact.
5. **Unreproduced ordering gaps** — `generate.ts:284`'s uncompensated return (unreachable as
   written) and the `:311` replay that precedes `deleteDeck` (needs a concurrent commit between
   `:148` and `:288` with two different `newDeckName`s). Both derived from control flow. Worth a
   comment; a test would be timing-dependent and out of proportion.
6. **The exact GoTrue error bodies** — `error.message` strings and whether the local server
   emits `X-Supabase-Api-Version` (which selects `data.code` vs `data.error_code`). Not
   determinable from the repo; the mapper's fallback chain makes it non-blocking, but a fixture
   written against one body shape may not match the other.

## Housekeeping

- The frame left three stray users (`a@b`, `x@nonexistent-tld-zzz.invalid`, `a@localhost`) in
  local `auth.users` from a live probe (`frame.md:214-217`). Still uncleared; `npx supabase db
  reset` clears them and is harmless to the suite.
- This research's spike added rows to the local stack in the ordinary way the suite does
  (fresh per-run accounts). No production edit was made; no test file was committed; the
  worktree and its git metadata were removed and the absence verified.
