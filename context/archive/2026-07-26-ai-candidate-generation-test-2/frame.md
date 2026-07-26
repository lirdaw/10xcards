# Frame Brief: No source-text or API-key leak on the generation failure path (C10X-28)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.
>
> Date: 2026-07-26 · commit `a018717` · branch `C10X-27-srs-study-session-test`
> Repository: `lirdaw/10xcards`
>
> HEAD moved during this frame run: investigation started at `d2ba91f`, and
> `a018717 fix(C10X-27): stop silent rating loss on a lost session (p1)` landed
> mid-session, adding `src/lib/http.ts`, rewriting `src/middleware.ts`, and adding
> `tests/lib/http.test.ts` + `tests/middleware.test.ts`. Every verdict below was
> re-checked against `a018717` — see "Re-check against the moving HEAD".

## Reported Observation

`context/foundation/test-plan.md` §2 Risk #4 — "Private source text or the LLM API
key escapes into a log line or an error response body" — has no coverage. §3 Phase 2
("Endpoint contract") stays `implementing` partly because of it. The risk-response
row nominates *"integration on the failure path"* as the cheapest layer and names
*"asserting the status code instead of the payload contents"* as the anti-pattern.

## Initial Framing (preserved)

- **User's stated cause or approach**: close it with integration tests on
  `/api/generate`'s failure path (FR-018), asserting on payload and log **content**,
  never on the status code. Assumption to challenge: "a 500 is harmless".
- **User's proposed direction**: write those tests under C10X-28 in this change
  folder, alongside risks #2 and #6 in Phase 2.
- **Pre-dispatch narrowing**: maximal scope on all three axes — *both* halves
  (source text **and** API key) weighted equally; "log line" means app-written logs
  **and** Cloudflare runtime logs **and** the persistent DB audit; the claim must
  cover the LLM failure branches **and** every other error branch of `/api/generate`
  **and** cross-account read of the stored source text.
- **Post-dispatch scope decisions** (Step 4, after evidence): the auth `?error=`
  reflection is **in scope for this change**; the "no log line" claim must cover
  **dependency-emitted** logs, not only `src/`.

## Dimension Map

1. **The response body** — some error branch interpolates input, an upstream error,
   or an env value instead of a constant.
2. **The log line** — something in the running process writes private data to a log.
3. **The persistent audit** — `source_text` / `request_payload` / `response_payload` /
   `error_message`; can the key get in, and who can read them out.
4. **Reachability of the failure path in the harness** — can the nominated layer
   observe the branches the risk names.  ← *where the initial framing lands*
5. **The client / bundle boundary** — `astro:env` secret, React islands, CI, wrangler.
6. **Cross-account read of `generation_session`** — RLS exists; is it asserted.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **D1** Some error body interpolates private data | 12 API routes enumerated branch by branch. `/api/generate`: **18 error returns, all fixed Polish literals** (`generate.ts:89,106,111,118,123,128,150,173,176,185,188,192,236,263,273-275,284,323,336`). Zod issues discarded (`generate.ts:123`, `study.ts:66`, `batch.ts:72`); only `error.code === "23505"` is ever read, to pick between two constants. `err.message` is computed at `generate.ts:210` and routed **only** to the DB column (`:220`). **Two exceptions**: `auth/signin.ts:16` and `auth/signup.ts:16` relay `error.message` verbatim into `?error=` | **PARTIAL** — absent for source text / key, **PRESENT** for the auth relay |
| **D1b** The auth relay can carry private data | GoTrue v2.192.0 binary grepped: `Email address %q is invalid` (`%q` = the submitted address) + `_getErrorMessage` falls back to `JSON.stringify(err)` on an unknown body shape. Rendered escaped (`ServerError.tsx:13`) — not XSS — but the value lands in the URL → browser history + Cloudflare access log. Not reachable on the local default config; reachable on hosted Supabase | **STRONG** (email, not source text) |
| **D2** Something logs private data | **Zero `console.*` in all of `src/`** (exhaustive grep, three independent confirmations). Every OpenRouter failure is caught (`generate.ts:204-239`), so no uncaught throw carries it. **But** dependencies on every request path do log: `@supabase/ssr/dist/module/cookies.js:22,29`, `@supabase/auth-js/dist/module/lib/fetch.js:110`, many in `GoTrueClient`; `wrangler.jsonc:17-19` has `observability.enabled: true`, so those lines reach Workers Logs. None carries the pasted text — they carry session/transport material | **WEAK** — no app-owned producer; dependency producers exist but carry the wrong payload |
| **D3** The API key can reach the audit / an error / a bundle | The key exists in **one** expression, `openrouter.ts:186`, inside `headers`; `rawRequest` is `body` (`:179`), a separate literal. Separation verified on **every** throw and return path. Astro 6.3.1 throws `ServerOnlyModule` at **build** time if a client module imports `astro:env/server` (`vite-plugin-env.js:65-69`), and `server`+`secret` compiles to `_internalGetSecret(...)` so the value is never inlined (`:143-149`). `OPENROUTER_API_KEY` appears nowhere in `.github/workflows/ci.yml`; `dist/` is not committed | **NONE** — closed by construction at three independent layers |
| **D4** The nominated layer cannot observe the named branches | Pincer confirmed: `preflight.ts:110-118` aborts the run if the key is **set**; `openrouter.ts:149-158` short-circuits to `mockCards` if it is **unset** — and a third clamp nobody had named: `astro:env` secrets are inlined at **transform** time under Vitest (`vite-plugin-env.js:153`), so `vi.stubEnv`/`process.env` cannot flip it. **502 (`:204-236`) and 422 (`:247-263`) are unreachable.** Branch census: **6 of ~18 reachable and already tested**, 1 reachable-untested (`:88-90`, replay rebuild), rest unreachable. Repo contains **zero** `vi.mock`/`vi.spyOn`/`vi.fn`. **Now qualified by execution — the seal is liftable: see "Verified by execution"** | **STRONG** |
| **D5** The client / bundle boundary leaks | No path from `src/components/` to `openrouter.ts` (its only importer is `generate.ts:7`). No island reads env. No island writes to `console`; no island puts private content in a URL. One disclosure: the **public** landing page renders whether the key is configured (`index.astro` → `Layout.astro:23-37` → `config-status.ts:20-24`) — a boolean, not the value | **WEAK** (presence oracle only) |
| **D6** Nothing guards the stored source text | RLS is present and mirrors `deck` (`20260712162349_generation_session.sql:58-74`). A cross-account **read** denial exists (`tests/review/candidates.test.ts:528-545`, with positive control) — but on the projection `id, public_id, requested_count, generated_count` (`generations.ts:35`). **No test touches `source_text`, `request_payload`, `response_payload`, `error_message`; no cross-account WRITE test on this table at all** | **STRONG** |

## Narrowing Signals

- **The audit is write-only.** Those four columns have no SELECT anywhere in `src/`
  (`generations.ts:24,35,53,70,100` read ids, counters, `front`/`back`, `state_id`).
  The stored source text has **no read path in the application** — so its only escape
  route is the database boundary itself, which is D6, not an error body.
- **The private material and the returned material never meet.** On the 502 path the
  source text goes to `source_text` **and** verbatim into
  `request_payload.messages[1].content` (`openrouter.ts:169-179`) while the response is
  a fixed string + `retriable: true`. The leak the ticket describes is structurally
  impossible on this path.
- **Even a unit-level key assertion needs a seam.** Mock mode returns at
  `openrouter.ts:149`, **before** the request body is constructed at `:165` — so the
  `headers`/`body` separation that closes D3 cannot be observed without a key set and
  `fetch` doubled. The property is real and currently unassertable at any layer.
- **`Rating.Good`-style monoculture, repeated**: `expectErrorBody`
  (`generate.test.ts:118-121`) asserts only `typeof payload.error === "string"`, and
  the file's own header says "nothing here is stubbed and nothing here reaches the
  generator". No existing test inspects any error body's contents.
- Timeouts confirmed 30 s (`vitest.config.ts:33`) < 40 s (`generate.ts:42`) < 55 s
  (`GeneratorForm.tsx:21`) — a real timeout cannot be sat out on the runner, and in
  mock mode the `signal` is never consumed at all.

## Verified by Execution (spike, 2026-07-26)

The one caveat this brief originally carried — *"that `vi.mock("@/lib/openrouter")`
intercepts through Astro's alias under `getViteConfig()` is a code-reading argument, not a
demonstration"* — was **run**. A temporary `tests/generation/spike-vimock.test.ts` was
written, executed, and deleted (no repo residue; `git status` clean apart from this change
folder).

| Stage | Result |
| --- | --- |
| A — mock resolves in the test's own graph | **PASS.** `vi.isMockFunction(OpenRouter.generateCandidates)` is `true`. The `@/` alias is honoured by `vi.mock`. |
| B — mock reaches the import inside `generate.ts` | **PASS.** A `mockRejectedValue(new OpenRouterError(...))` drives the endpoint to **502** with `retriable: true`, and a `failed` session lands with `error_message = "OpenRouter HTTP 401"` and the injected source text inside `request_payload`. |
| Deliberate-breakage check | **Both stages go red with the mock disabled**, and stage B fails on the decisive observation — `expected 200 to be 502`, i.e. without the mock the request falls through to real mock mode and succeeds. That split is what proves the assertion observes the interception rather than passing incidentally. |
| Full suite after restore + deletion | **97 passed / 10 files** (`npm test`, local stack up, `OPENROUTER_API_KEY` unset). |

Three consequences for /10x-plan:

- **The 502 branch is reachable after all** — the seal in D4 is a property of the *current*
  test setup, not of the framework. `{ ...actual, generateCandidates: vi.fn() }` preserves
  the `OpenRouterError` class identity that `generate.ts:208-209` needs for its
  `instanceof`. This is the project's **first** module double; that it works is now a fact,
  whether to adopt it is a plan decision.
- **The spike already demonstrated the Risk #4 assertion in its useful form**: the 502 body
  contains neither the source text, nor `"OpenRouter HTTP 401"`, nor the upstream
  `"No auth credentials found"` — *while the audit row contains the first two.* That
  contrast, on one request, is the shape worth building; asserting the constant alone is not.
- **`test-plan.md`'s freshness ledger is already stale**: it states "69/69 green, 8 files"
  as of today. The suite is **97/10**. `tests/lib/http.test.ts` and `tests/middleware.test.ts`
  (11 cases) landed in `a018717` and closed §6.6's "the middleware guard is untested" gap
  without that section being updated. The plan's doc-sync owes both corrections.

## Re-check against the moving HEAD

`a018717` touched none of the files this frame's verdicts rest on — `generate.ts`,
`openrouter.ts`, `generations.ts`, the migration, and both auth routes are **unchanged**, so
every `file:line` above still resolves. The two new surfaces were audited fresh and are
**constant-only**: `middleware.ts:64` returns a fixed `{ error: "Nie jesteś zalogowany" }`,
and `http.ts` returns `SESSION_EXPIRED_MESSAGE` (`:16`), a caller-supplied fallback (`:52`),
or the server's own `error` string (`:56`). `grep -rn "console\." src/` re-run on `a018717`:
still **zero**.

One thing that *does* shift: `http.ts:56` now renders the endpoint's `error` string verbatim
in every island. That makes "every error body is a fixed literal" a load-bearing invariant
with a client-side consumer, not merely a habit — it raises the value of pinning it, and it
is the one place a future non-constant body would become user-visible automatically.

## Cross-System Convention

This project's convention for "the server does not trust and does not tell" is already
uniform and deliberate: fixed Polish copy per branch, upstream detail routed to a
persisted audit row, `404` never `403`, Zod issues dropped. `/api/generate` follows it
in all 18 branches. The two auth routes are the **only** deviation in the codebase —
they predate the JSON-endpoint convention (`generate.ts:16-20` documents itself as the
project's first JSON endpoint) and were never revisited. So the leading hypothesis
matches convention by *identifying the outlier*, not by proposing a new rule.

## Reframed Problem Statement

> **The actual problem to plan around is**: the no-leak property on the generation path
> already holds by construction, is asserted nowhere, and cannot be asserted at the
> layer test-plan nominates — while the surfaces where private data genuinely does
> escape today are two the ticket does not name: the four audit columns' cross-account
> isolation, and the auth routes' verbatim relay of an upstream message into a URL.

Three things follow. **(1)** Writing "integration tests on the FR-018 failure path"
as stated is not possible: 502 and 422 are sealed by a three-way clamp, and asserting
the constant-ness of the six *reachable* branches carries near-zero signal — it would
be the payload-side twin of the status-code anti-pattern the risk row warns about.
**(2)** The half of Risk #4 about the API key is **closed by construction** at three
independent layers and should be recorded as such, not re-litigated; what is missing is
that nothing *pins* it, and pinning it requires the project's first module double —
exactly the "API mocking: none yet — see Phase 2" gap test-plan §4 parks here.
**(3)** The genuinely unprotected private-data path is `generation_session`'s audit
columns, reachable today with the existing harness and no new seam; and the one real
instance of "private data escapes into a log line" in this codebase is the user's
**email**, via `signin.ts:16`/`signup.ts:16` — now explicitly in scope for this change.

## Confidence

**HIGH.** Three independently-prompted investigations converged on the same decisive
facts (constant-only bodies, zero app `console.*`, key absent from `rawRequest`,
audit write-only). The pressure-test — checking whether "no log line" survives at the
dependency layer — **refined** the claim (dependency logs exist and are captured) but
did not contradict it. Every verdict above rests on a `file:line`, including two reads
of installed `node_modules` (astro 6.3.1, gotrue 2.192.0) rather than on docs alone.

**The one caveat this brief originally carried has been discharged by execution** — the
`vi.mock` interception is now demonstrated, with a deliberate-breakage check, and the
full suite re-run green afterwards (see "Verified by execution"). Nothing in this brief
is now marked unverified.

What remains genuinely open is a **decision**, not a fact: whether to adopt the project's
first module double in order to pin the 502/422 branches, or to record them as named
negative space in §7. That is /10x-plan's call.

## What Changes for /10x-plan

The plan is not "test the failure path"; it is **make the no-leak property enforceable
and close the two surfaces that are actually open** — the audit columns' cross-account
isolation (cheap, existing harness) and the auth relay (now in scope) — while treating
the sealed 502/422 branches as a deliberate, named harness decision (build the first
module double, or record them as negative space in §7) rather than an oversight.
The "log line" claim must state its boundary explicitly: `src/` writes nothing, and
dependency-emitted lines reaching Workers Logs are inside the claim's scope per the
scope decision above.

## References

- Endpoint + bodies: `src/pages/api/generate.ts:89-336`, `src/pages/api/auth/signin.ts:16`,
  `src/pages/api/auth/signup.ts:16`, `src/components/auth/ServerError.tsx:13`
- Key surface: `src/lib/openrouter.ts:149-158,165-186,194-211`, `astro.config.mjs:19-22`,
  `node_modules/astro/dist/env/vite-plugin-env.js:65-69,143-155`
- Audit surface: `src/lib/generations.ts:24,35,53,70,100,119`,
  `supabase/migrations/20260712162349_generation_session.sql:25,32-34,58-74`
- Harness clamps: `tests/setup/preflight.ts:110-118`, `vitest.config.ts:31-34`,
  `tests/fixtures/endpoint.ts:78`, `tests/generation/generate.test.ts:118-121,250-261`
- Existing isolation: `tests/review/candidates.test.ts:528-545`
- Logging surface: `wrangler.jsonc:17-19`, `@supabase/ssr/dist/module/cookies.js:22,29`,
  `@supabase/auth-js/dist/module/lib/fetch.js:110`
- Plan context: `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 2, §4, §6.5, §7;
  `context/foundation/lessons.md` (preflight seams; middleware-vs-fetch);
  `context/archive/2026-07-18-ai-candidate-generation-test/research.md:30,385` (Risk #2
  scoped alone; #4/#6 deferred here); `context/foundation/jira-map.md:30` (C10X-28)
- Landed mid-run, re-checked: `src/lib/http.ts:16,52,56`, `src/middleware.ts:29-38,57-71`,
  `tests/lib/http.test.ts`, `tests/middleware.test.ts` (commit `a018717`)
- Investigation: three parallel read-only sub-agents (response-body audit, key-exposure
  trace, harness reachability) + one inverse check on dependency logging + one executed
  spike with a deliberate-breakage check. No TaskCreate ids were registered for this run.
- **Side effect to clean up**: the response-body agent probed GoTrue's validation copy
  with three live `POST /auth/v1/signup` calls against the **local** stack, creating
  users `a@b`, `x@nonexistent-tld-zzz.invalid`, `a@localhost` in local `auth.users`.
  Harmless to the suite (it provisions its own accounts); `npx supabase db reset` clears them.
