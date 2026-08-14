# Local dev-DB test-data debt — Plan Brief

> Full plan: `context/changes/dev-db-test-data-debt/plan.md`
> Research: `context/changes/dev-db-test-data-debt/research.md`

## What & Why

The local dev database has accumulated ~20,748 decks and ~1,468 harness accounts, growing at
68 decks and 2 auth users per `vitest` invocation. The cost is not disk, speed, or a red run —
it is **falsifiability**: PostgREST truncates any result set at `max_rows = 1000`, so an
assertion of the form "the foreign deck is absent from this result" now passes when the deck
merely fell outside the truncation window. That disarms the deliberate-breakage procedure every
`§6.6` coverage claim in `test-plan.md` rests on. This change repays the debt, gives the
repayment a tool, closes the one reproduced flake, and hardens the two affected assertions.

## Starting Point

Nothing in the Vitest suites cleans up — by design, not oversight: per-run accounts guarantee a
run never _inherits_ rows, which is why the suite has never needed a reset, and nothing follows
from that about rows _accumulating_. C10X-46's e2e teardown stops future growth for the rows it
owns and explicitly declines to repay the backlog. Eight non-harness decks exist, every one an
artifact of a recorded manual run, two of which `test-plan.md` calls "the artifact of record".

## Desired End State

Only artifact rows and the current session's remain. `npm run db:clean` reports before it
deletes and can repay the debt again in one command. The two absence-assertions can no longer
decay — their oracle is **test-local**, so no policy the breakage procedure disables can feed it,
and they are falsifiable precisely on the repaid database this change creates. The
`Gate deck` collision cannot recur, and research's inferred false pass is a measurement on
record, taken while the fat database still existed.

## Key Decisions Made

| Decision              | Choice                                           | Why (1 sentence)                                                                                                            | Source   |
| --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| Cleanup mechanism     | Narrow pattern-scoped delete, never `db reset`   | A reset destroys seven artifact decks that archived documents cite as evidence                                              | Research |
| Hygiene ownership     | `npm run db:clean`, developer-invoked            | An in-suite teardown cannot reach `auth.users` or prior runs' rows, and destroys post-mortem evidence after a red run       | Research |
| CI hygiene step       | Refuted, not deferred                            | CI starts a fresh stack on a throwaway runner every job; nothing accumulates there, ever                                    | Research |
| Hardening             | In the assertions, not via `ORDER BY` migrations | Closes the decay class with no migration, no drift gate, and no production SQL changed to fix a test-tooling problem        | Plan     |
| Defect A (3.3% flake) | Rename one literal + record the rule             | One line removes a measured red rate; the rule stops the class recurring silently                                           | Plan     |
| Defect B (CI #66)     | Its own ticket, attributed here                  | The likely fix widens the retry policy — a change to harness semantics deserving separate review                            | Plan     |
| `db:clean` contract   | Report first, delete on `--yes`                  | The destructive path is never the default, and the census report is itself how you notice the debt returning                | Plan     |
| Repayment method      | Dogfood the script; orphan deleted separately    | The repayment doubles as the script's first exercise on real data; a one-time 2026-08-05 UUID stays out of a permanent tool | Plan     |
| Phase order           | Hardening **before** cleanup                     | The false-pass measurement is perishable — it is only obtainable while the debt exists                                      | Plan     |

## Scope

**In scope:** one-off repayment of the backlog; the orphaned `E2E deck 1785947414992`; a tested
`scripts/` pure + IO pair behind `npm run db:clean`; the `Gate deck` rename and its namespacing
rule; hardening the two vulnerable assertions; four dated document corrections; roadmap `H-21`;
a Defect B follow-up.

**Out of scope:** `npx supabase db reset`; an automatic per-run Vitest teardown; any CI hygiene
step; `ORDER BY` migrations on the two RPCs; fixing or reproducing Defect B; an entropy sweep
across the 11 files declaring a `suffix`; the 2-users-per-invocation cost (named, left, absorbed
by `db:clean`); wiring `db:clean` into `db:start` or any hook.

## Architecture / Approach

`scripts/db-cleanup.ts` (pure — pattern, statements, census parser, argv) plus
`scripts/run-db-cleanup.ts` (I/O — `docker exec … psql`, report, exit code), mirroring the
existing `kong-keepalive` / `disable-kong-keepalive` split, with the pure half tested in
`tests/lib/`. One `delete from auth.users where email like 'harness-%'` cascades to decks →
flashcards → schedules and to generation sessions, so the whole footprint of every past run
falls out of one statement. The script is local-only **by construction** — it addresses Postgres
only through a container name derived from this checkout's `config.toml`, which is a stronger
safety property than a runtime host assertion.

## Phases at a Glance

| Phase                     | What it delivers                                                                               | Key risk                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Defect A + roadmap row | The 3.3% flake gone; the class written down; `H-21` created                                    | The rename is proved by a forced-collision pair, not a 92-run matrix — the matrix would itself add ~6,000 decks                                                                      |
| 2. Harden + measure       | Both assertions bounded by a **test-local** reference set; the old shape's false pass measured | **Perishable** — the false pass is unobtainable after Phase 4; needs an RLS neuter window with a verified restore. The hardened shape's own red belongs to Phase 4, on the repaid DB |
| 3. `db:clean`             | Tested pure + IO pair, wired as an npm script                                                  | A census that reads zero on a failed query would report "nothing to clean" — the false green the script exists to prevent                                                            |
| 4. Repay                  | ~20,748 decks and ~1,468 users gone; orphan deleted                                            | Irreversible; the seven artifact decks must survive, guarded by the script's own invariant _and_ an independent read-back                                                            |
| 5. Docs                   | Four dated corrections, Defect B follow-up                                                     | An archive edit must be an append, never a rewrite                                                                                                                                   |

**Prerequisites:** local stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset, Docker
running, and Phase 2 executed **before** Phase 4.
**Estimated effort:** ~2 sessions across 5 phases; Phase 2's neuter window is the longest single step.

## Open Risks & Assumptions

- **Phase 2's evidence expires.** If Phase 4 runs first, the measurement is unobtainable and the
  plan should be re-scoped rather than the number produced from a small dataset.
- **The neuter is a write to RLS policies.** §6.6 records a restore that silently no-opped
  because a heredoc was piped to `docker exec` without `-i`; only the before/after diff caught it.
- **Hardening covers two assertions, not the class.** The two RPCs still have no `ORDER BY`, so
  a new consumer written against them inherits the same trap.
- **`db:clean` is developer-invoked.** The debt returns at 68 decks per run and nothing watches
  a counter — accepted deliberately, because the harm is realised only at neuter time, when a
  human is already at a terminal.
- **Defect B stays open and unattributed.** It fired once in 87 CI runs; the marker experiment
  is expected to be a non-reproduction.

## Success Criteria (Summary)

- A developer running the deliberate-breakage procedure gets a **red** where the guard is
  disabled — the property the accumulation had silently removed.
- The debt is repayable in one command, and the seven artifact decks are provably intact.
- The suite no longer carries a measured 3.3% flake, and the mechanism behind it is recorded so
  it cannot return unnoticed.
