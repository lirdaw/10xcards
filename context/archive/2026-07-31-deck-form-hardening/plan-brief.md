# Deck Form Hardening — Plan Brief

> Full plan: `context/changes/deck-form-hardening/plan.md`
> Research: `context/changes/deck-form-hardening/research.md`

## What & Why

Two deck endpoints read `formData()` unguarded and cast a form part to `string`, so a crafted
non-form body answers an uncontrolled framework `500` and a `File` part crashes the handler at
`.trim()` — the two endpoints C10X-30's sweep missed (C10X-37). Under the maximum-scope decision
taken at scoping, the same change also closes the **read** side of the `?error=` channel on the
three deck pages, where the parameter is taken raw into a trust-carrying red banner: the same
content-injection class the auth pages closed with `ownedAuthMessage`, still live behind the
session guard.

## Starting Point

Both defects are live and verbatim at `465832e`. Four of the six `formData()` readers under
`src/pages/api/` are guarded; these two are not. Three deck pages read `?error=` raw, feeding six
sinks — five through `ServerError`, one rendered directly in `.astro` markup without
`role="alert"`, which a component-level fix could never reach. The eleven `?error=` literals are
already a closed set in practice (no upstream, DB or exception string can get in), but nine of
them are inline duplicates across six files and nothing on the read side vouches for any of them.
Existing deck coverage is ownership only: no input validation, no malformed body, no boundary,
no signed-out case.

## Desired End State

Both endpoints answer their own owned redirect on a non-form body and on a `File` part, never a
`500`. Every `?error=` value the deck surface renders is one the app can vouch for by equality;
anything else degrades to **no banner** rather than to a hedged one. The 1–100 name rule has one
definition, and its two layers — the endpoint and `deck_name_check` — are provably independent.
The six redirect-style endpoints' own signed-out branches are executed for the first time.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `errorUrl` ordering constraint | Does not exist here | Create builds fixed literal URLs; rename builds `errorUrl` from the route param eleven lines before the body read — the guard can sit anywhere. | Research |
| Rejection-cause messages | One message, not auth's split | The endpoints' own "operation failed" literal is truthful for both causes and is already a set member, so a branch would add code with no observable difference (`cards/index.ts:40-46`). | Research |
| Closed-set location | New `redirect-errors.ts` beside `auth-errors.ts` | Small blast radius — `auth-errors.ts` carries a mapper, a reachability record and 92.98% mutation coverage; mixing "translate a GoTrue failure" with "vouch for a URL value" is two jobs in one file. | Plan |
| Literals: list or source | **Hoist** — single source across six endpoints | Drift here is silent, not loud: a reworded producer string falls out of the set and the banner simply disappears. | Plan |
| Name bound single-sourcing | Number in all six sites; message in the four that share it | The two deck islands share the number **and** the string; `GeneratorForm` names a different thing ("Nazwa **nowej** talii …", trailing period) and keeps its copy. | Plan |
| DB CHECK name | Assert the measured `deck_name_check` | Read off the live stack rather than inferred, so no migration, no `db push`, no drift gate. | Plan |
| Page guard | Parameterise the existing file over two surfaces | Each surface asserts **its own** helper — a shared regex would wave through a deck page wrapped in `ownedAuthMessage`, the wrong set for that surface. | Plan |
| Banner sink `:149-153` | Replace with `<ServerError>` | Retires the thirteenth, non-component banner render and gains `role="alert"`; classes are already byte-identical. | Plan |
| Signed-out coverage | All six endpoints, one file | Sweeping some and not saying so is exactly the shape that created C10X-37. | Plan |
| Jira | Both halves under C10X-37, recorded explicitly | One change folder maps to one key in `jira-map`; the scope extension is written down so no follow-up ships under a foreign key unremarked. | Plan |

## Scope

**In scope:** the two endpoints' `formData()` guard; two new single-source modules; hoisting
eleven literals across six endpoints and the name bound across six sites; the three `.astro`
read-side wraps; the banner-sink swap; a new endpoint test file, a closed-set test, a
parameterised page guard, a signed-out file; the breakage pair plus three falsifiability runs;
document sync.

**Out of scope:** renaming the constraint in a migration; folding `AUTH_MESSAGES` into the new
set; unifying `GeneratorForm`'s copy; testing what an island enforces (no DOM layer, §7); auth
input validation (C10X-36); the JSON endpoints' error convention; e2e; rate limiting.

## Architecture / Approach

Build the shared vocabulary first, then use it. `deck-limits.ts` **imports nothing** (mirroring
`generation-limits.ts`) so the two islands pay only for the values; `redirect-errors.ts` is
server-side only, holds the eleven constants plus `REDIRECT_MESSAGES` and `ownedRedirectMessage`,
and may import `flashcards.ts` for the two `FRONT_MAX`/`BACK_MAX` templates. Producers import
their literals; the three pages vouch at the read. Islands never import `redirect-errors.ts` —
they receive their message as a `serverError` prop, as they already do.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Single-source modules | Two modules; eleven literals and the bound hoisted | A hoist that "tidies" a string silently drops a set member — the banner then disappears rather than failing |
| 2. Harden the endpoints | `try`/`catch` + `formString` on both (C10X-37 proper) | Small; the one trap is reaching for auth's two-message split where one is correct |
| 3. Close the read side | Three wraps + the banner-sink swap | The wrap must stay on one line — the Phase 5 guard asserts per line |
| 4. Endpoint tests | `tests/validation/decks.test.ts`, rows + DB independence | The count oracle: both obvious helpers are wrong, and `listDecks` decays into a false pass as the dev DB grows |
| 5. Guards | Closed set, parameterised page guard, signed-out class | A guard that can pass vacuously — hence whole-set positive controls |
| 6. Breakage + docs | The pair, three falsifiability runs, document sync | Restoring a dropped CHECK fails with `violated by some row` until the run's own rows are deleted |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset,
Docker available for the `psql` breakage runs.
**Estimated effort:** ~3–4 sessions across 6 phases; Phase 1 and Phase 4 carry most of it.

## Open Risks & Assumptions

- The hoist touches six endpoints and four components — the widest edit here, and it is the one
  with no behavioural test of its own until Phase 4. The grep in 1.5 and the manual copy checks
  are what carry it.
- Phase 6 run 2 drops `deck_name_check` against the live local stack; the suite writes rows the
  constraint forbids in the meantime, so the restore is a delete-then-re-add-then-diff procedure,
  not a one-liner.
- The island half of the name rule stays unasserted (§7). Unlike `GeneratorForm`, the deck
  islands carry no `maxLength`, but they do `preventDefault()` — so the server branch is
  unreachable through the hydrated UI, which is Risk #6's premise rather than a gap in it.
- Nothing here observes the cloud. `?error=` producers outside the deck surface are untouched.

## Success Criteria (Summary)

- A request crafted outside the browser is refused by both deck endpoints in their own
  convention — a `302` to an owned `?error=` URL — and writes nothing, proven by a row oracle
  rather than by a status.
- A crafted `?error=` link on any deck page renders **no banner**, while every genuine failure
  still renders its own message.
- The breakage pair's two runs fail the same cases on **different** assertions, which is what
  attributes a refusal to the endpoint or to the database.
