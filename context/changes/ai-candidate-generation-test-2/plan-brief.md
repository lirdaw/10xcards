# No source-text or API-key leak on the generation failure path — Plan Brief

> Full plan: `context/changes/ai-candidate-generation-test-2/plan.md`
> Frame brief: `context/changes/ai-candidate-generation-test-2/frame.md`

## What & Why

Test-plan Risk #4 says private source text or the LLM API key could escape into a log line
or an error response body. The frame investigated it to HIGH confidence and reframed it:

> The no-leak property on the generation path **already holds by construction**, is
> **asserted nowhere**, and **cannot be asserted at the layer test-plan nominates** — while
> the surfaces where private data genuinely does escape today are two the ticket does not
> name: the four audit columns' cross-account isolation, and the auth routes' verbatim
> relay of an upstream message into a URL.

So we close the two real leaks, make the no-leak property enforceable, and — by decision —
also close Risk #6.

> **Scope split at plan-review (F3), 2026-07-26 — read this before anything below.** The six
> phases planned here belong to **three tickets**, because only Phases 2, 5 and 6 are Risk #4
> and C10X-28's acceptance criterion is about Risk #4 alone.
>
> | Phases | Ticket | What it owns |
> | --- | --- | --- |
> | 2, 5, 6 + Phase 4's `console.*` guard | **C10X-28 — this change** | Audit-column isolation, the module double (502/422 + API-key pin), the log-line guard, the doc-sync |
> | 1 + Phase 4's banner gate | **C10X-34** `auth-error-copy` (created 2026-07-26) | The `?error=` relay in `signin.ts`/`signup.ts`, and hiding the OpenRouter banner from anonymous visitors |
> | 3 | **C10X-30** `server-side-validation-test` (**already existed** — the Risk #6 ticket) | Single-sourcing the four generation constants, server-side bounds tests. Covers only C10X-30's source-text half; its card-content half stays open |
>
> The phase texts stay in `plan.md` verbatim so each new ticket's `/10x-plan` can lift its
> phase **with the traps intact** — that is the part a rewrite would lose. **Do not implement
> Phases 1, 3 or Phase 4 §1 from this folder.**
>
> **Consequence, and it is the price of the split:** §3 Phase 2 covers risks #2, #4 **and #6**,
> so it does **not** flip to `complete` here. This ticket closes #4 and leaves Phase 2
> `implementing` with #6 named as the one outstanding risk; whichever of the two tickets lands
> second flips the status.

## Starting Point

17 of the 18 error branches in `/api/generate` already return fixed Polish literals (the 18th,
`generate.ts:273-275`, is a ternary between two literals — same closed set, so the property
holds), and since
`a018717` `http.ts:56` renders that string verbatim in every island — making "every body is
a constant" a load-bearing invariant with a client-side consumer. `src/` writes zero
`console.*`. The API key exists in one expression, inside `headers`, never in the audit
payload.

What is *not* protected: `generation_session`'s `source_text`, `request_payload`,
`response_payload` and `error_message` have no cross-account test (the one existing test
reads a four-column projection that excludes all of them, and the table has no write test at
all), and `signin.ts:16`/`signup.ts:16` relay GoTrue's `error.message` straight into
`?error=` — the codebase's only two deviations from its own convention.

## Desired End State

Another account cannot read or alter your pasted text, and a test proves it on all four
columns in both directions. A failed sign-in shows fixed Polish copy that still tells you
what to do, with no upstream string in the URL. A crafted request that bypasses the UI gets
a 4xx and writes nothing, and the source-text limit has exactly one definition. On a single
502, the response body provably lacks the source text and the upstream error while the audit
row provably contains both. An anonymous visitor is no longer told whether generation is
live. `test-plan.md` states what is true.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Problem framing | Close real leaks, don't "test the failure path" | 502/422 are sealed and the reachable branches are all constants, so testing as specified carries near-zero signal | Frame |
| API-key half of Risk #4 | Closed by construction, recorded not re-litigated | Three independent layers (build-time throw, secret indirection, absent from CI) | Frame |
| Auth relay | In scope for this change | It is the one real instance of private data escaping into a log line | Frame |
| 502/422 seal | Adopt a module double of **`astro:env/server`**, confined to one file + documented rule | Two spikes ran; doubling `@/lib/openrouter` reaches 502 only and makes the header claim unassertable, while the env seam reaches 502, 422, the real `Authorization` header and the audit columns from unmodified production code | Research |
| Auth error copy | Map to fixed Polish constants per error class | Kills the relay while keeping the signal users need to self-correct | Plan |
| Mapper key | `AuthError.code`, not message text | auth-js 2.105.3 exposes an enumerated `ErrorCode`, so upstream prose changes cannot degrade the mapping | Plan |
| Key pinning | Full-path assertion via the endpoint, no second seam | Proves it end-to-end from production code; ambiguity resolved by asserting the positive control in the same request | Plan + Research |
| Audit isolation | Extend `candidates.test.ts` | User's call over a dedicated file; requires widening the seed helper first | Plan |
| Log boundary | Pin `src/` with a guard, document dependency lines | Makes the claim falsifiable where the repo controls it, honest where it does not | Plan |
| Banner disclosure | Gate the OpenRouter entry to signed-in views | Removes the anonymous oracle; Supabase's entry stays ungated or it hides itself | Plan |
| Risk #6 | In scope — close Phase 2 fully | User's call; `SOURCE_MAX` duplication is a real drift mechanism worth fixing | Plan |
| Verification | Deliberate breakage per claim + Stryker on the mapper | Each technique aimed where it has power; RLS assertions are unreachable by source mutants | Plan |
| Doc-sync | Full: corrections + new entries | Three statements in `test-plan.md` are provably false today | Plan |
| **Scope** | **Three tickets, not one** | Only Phases 2/5/6 are Risk #4; Phase 1 changes what every user sees when login fails and Phase 3 reaches the client bundle — each deserves its own review and its own revert | Plan-review F3 |
| **Sequencing** | **This ticket runs SECOND**, after C10X-27 merges | C10X-27's implementation has landed but is not in `main`; this change's branch/worktree is cut from a `main` that already contains it, or Phase 6 re-derives against a `test-plan.md` 480 lines out of date | Plan-review F4 |
| Mapper discrimination | `error.name` (+ `code`, `status`), no auth-js import | `@supabase/auth-js` is not a declared dependency and `@supabase/supabase-js`'s root re-exports no auth errors or type guards — every class sets `name` in its constructor, so the mapper needs no `@supabase/*` import at all | Plan-review F2 |
| Bounds-test "no write" oracle | Short per-case marker + `.like()`, never `.eq("source_text", …)` | A filter carrying a 10 000-char body answers `414 URI too long` (measured), so the oracle could not run for the two cases the phase exists for | Plan-review F1 |

## Scope

**In scope (C10X-28, after the F3 split):** cross-account read/write isolation on the four
audit columns; the `console.*` guard over `src/`; the first module double, with the
sentinel/audit contrast on **502 and 422** plus the API-key header pin; the verification
record; `test-plan.md` corrections and the new §6.6 / §6.9 entries.

**Moved to sibling tickets, NOT dropped:** the auth-error mapper + both routes and the
OpenRouter banner gate → **C10X-34**; single-sourcing the four generation constants +
server-side bounds tests → **C10X-30**. Their phase texts stay in `plan.md`, marked MOVED OUT.

**Out of scope:** asserting Polish copy of `/api/generate` bodies (C10X-33); auditing
`node_modules` log sites; changing `wrangler.jsonc` observability; removing the OpenRouter
banner; widening `tests/fixtures/endpoint.ts`; timing-based timeout tests; card
create/edit/batch bounds (already single-sourced); re-testing the client-bundle boundary.

## Architecture / Approach

Four fix phases, then the harness phase, then doc-sync — ordered so any stopping point
leaves a closed leak behind it and the first thing abandoned is the one named cuttable.
Each phase carries its own deliberate-breakage check, because a check targeting exactly one
claim tells you which claim it observes; that per-claim property is what made the S-03 and
S-05 checks conclusive.

## Phases at a Glance

Ticket column per the F3 split: **28** = C10X-28 (this change), **auth** = auth-copy/disclosure
ticket, **#6** = Risk #6 bounds-parity ticket.

| Phase | Ticket | What it delivers | Key risk |
| --- | --- | --- | --- |
| 1. Auth error copy | auth | Mapper over `error.name`/`code`; both routes stop relaying | A too-generic fallback degrades real usability on the front door |
| 2. Audit isolation | **28** | Read + write denial on four private columns | Asserting against `NULL`s if the seed helper isn't widened first — vacuous green |
| 3. Bounds parity (#6) | #6 | Four constants single-sourced; bounds tests asserting 4xx **and** no write | Touches the generator island, so the change reaches client code; and the "no write" oracle 414s if scoped by the full `source_text` |
| 4a. Banner gate | auth | OpenRouter entry hidden from anonymous visitors | Gating the block instead of the entry hides the Supabase warning exactly when it matters |
| 4b. `console.*` guard | **28** | Whole-`src/` assertion that this repo writes no log line | A three-path allow-list misses `.astro` frontmatter, which runs server-side too — reads as coverage |
| 5. Module double | **28** | Sentinel/audit contrast + API-key pin, on 502 **and** 422 | Doubling the wrong module (`@/lib/openrouter`) makes the header code unreachable, so half the claim silently evaporates; a factory not spreading `...actual` yields a 500 from a null Supabase client |
| 6. Sweep + doc-sync | **28** | Verification record; `test-plan.md` corrected; Phase 2 stays `implementing` with #6 outstanding | Unverified RLS restores silently disarm the suite |

**Prerequisites:** C10X-27 merged to `main`, and this ticket's branch/worktree cut from that
`main` (F4). Local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset
(preflight aborts otherwise). Frame brief read.
**Estimated effort:** ~2–3 sessions for C10X-28's four phases; the two sibling tickets carry
the rest.

## Open Risks & Assumptions

- **Phase 5 is explicitly cuttable — but the split re-prices that.** After F3, Phase 5 is no
  longer "the last thing on a six-phase queue"; it is over half of what C10X-28 still delivers,
  and cutting it now leaves this ticket as an isolation test plus a log guard. Cut it only on a
  deliberate decision, and record 502/422 as named negative space in §7 if you do.
- The module double is a precedent in a repo with zero doubles; confinement is a written
  rule, not a mechanism, so it depends on the next contributor reading §6.9.
- Extending `candidates.test.ts` rather than opening a dedicated file departs from §6.2's
  one-file-per-resource convention — a deliberate, recorded call.
- The frame left three stray users in local `auth.users` from a live probe; `npx supabase
  db reset` clears them and is harmless to the suite.
- ~~Risk #6 is being planned without its own research pass.~~ **Closed** — `research.md` grounded
  it and found the surface roughly four times wider than this brief assumed: four generation
  constants are duplicated, not just `SOURCE_MAX`, and the starkest "server trusts the client"
  instance in the repo is that **neither auth route validates anything server-side**. Whether that
  last one is in scope is still open.

## Success Criteria (Summary)

- A second account can neither read nor alter the text you pasted, and something red-checks
  that claim.
- On a single failure the response body provably lacks the source text and the upstream error
  while the audit row provably contains both — on 502 **and** on 422 — and the API key is proven
  to travel in `Authorization` and to reach no audit column.
- `test-plan.md` no longer states what is false, and its Risk #4 entry says precisely which half
  is pinned and which is documented.

Carried by the sibling tickets, so **not** claimed here: a failed sign-in telling you what went
wrong without putting anything upstream into your URL (auth ticket), and one definition of the
source-text limit with a crafted request refused and writing nothing (Risk #6 ticket).
