---
change_id: test-plan-refresh-2026-08-05
title: Refresh test-plan.md for the arrival of e2e — add §3 Phase 6, correct what is now false
status: planned
created: 2026-08-05
updated: 2026-08-05
archived_at: null
---

## Notes

Open a change folder for a REFRESH of context/foundation/test-plan.md (triggered by
`/10x-test-plan --refresh`, 2026-08-05). This change updates the guide only. It does NOT
build the e2e layer — that is the job of the §3 phase this refresh adds.

## Why the refresh fired

Two of §8's four "Refresh when" triggers, both live. NOT the `checked:` date trigger (those
dates are 3 weeks old, not 3 months) — so this change has no mandate to rewrite §1 or §2.

1. The tech stack changed: `@playwright/test@^1.62.1`, `playwright.config.ts` and
   `tests/e2e/seed.spec.ts` exist in the working tree (uncommitted as of this handoff).
2. §7's negative space no longer matches: three exclusions are worded
   "Re-evaluate the moment any §3 phase wires e2e". That moment has arrived.

## What the guide asserts today that is FALSE (not merely stale)

- §4 Stack, `e2e` row: "none yet — deliberately deferred"; "No rollout phase claims e2e".
- §5 closing paragraph: "e2e on critical flows is deliberately absent: no §3 phase wires it,
  so listing it as a gate would be aspirational."
- §7, three a11y/island exclusions: each carries a conditional re-evaluation clause whose
  condition is now met, so leaving it unreconsidered turns it into a dead clause.
- §5/§6 (and README + AGENTS.md): the typecheck gate is described as covering "133 files"
  and "18 `.astro` templates". `npm run typecheck` reports **135 files, 0 errors** today.

That last one carries a finding, not just a number. `tsconfig.json` has `include: ["**/*"]`
and excludes only `dist`/`context`, so the delta is (INFERENCE — confirm by measurement,
do not carry forward as fact) exactly `playwright.config.ts` + `tests/e2e/seed.spec.ts`.
If so, **the e2e layer is already inside the type gate, in CI and on `pre-push`, and no
document knows it.** Same denominator-rot class §8 records against C10X-39 and C10X-40.

## Decisions taken in the refresh interview (these are the substance of this change)

- **e2e is a human-triggered instrument, NEVER a gate.** Same rule and same reason as the
  eval and the DDL diff (§5): no notification channel, so an alarm nobody hears is not
  coverage. State explicitly that nothing may declare it in `needs:`.
- **Scope = two browser journeys**, each chosen because the integration layer cannot reach it:
  - A: generate → accept → the accepted card survives a page reload (US-01; real auth, real
    API, real Postgres, real SSR; OpenRouter in mock mode).
  - B: a signed-out browser navigation to a protected route lands on `/auth/signin`.
- **Journey C (SRS session) is deliberately OUT.** Risk #3 is covered on both halves by unit
  - integration; e2e adds no signal. Record as a decision, never as a gap.
- **§7's three exclusions STAY excluded**, replacing the conditional clause with a dated
  re-decision (2026-08-05).
- **A Playwright preflight is an entry condition**, not a follow-up: sub-phase 6.1 blocks the
  rest of the phase.
- **§2 is untouched** — the risk map stays 1–7. e2e introduces no new product failure
  scenario, only a new layer of proof for existing ones.

## Correction this refresh must carry (found by reading code, not documents)

The stated justification for journey B — "the `PROTECTED_ROUTES` middleware guard is
uncovered (roadmap F-03)" — has been FALSE since 2026-07-26 (C10X-27).
`tests/middleware.test.ts:85,94` drives `it.each(PROTECTED_ROUTES)` over the real imported
array on both branches (401 JSON / 302 document).

The risk survives with a different and heavier justification, and the phase must be scoped to
the latter: that test calls `onRequest` directly on a fabricated context, and its own comment
(`:21`) records that the Container API is deliberately not used because it mounts
`NOOP_MIDDLEWARE_FN`. So a middleware that stopped being MOUNTED — file renamed, export
dropped, adapter change — leaves those 9 cases fully green while every protected route stands
open in production. No layer in this project reaches that, and `callEndpoint` renders
`routeType: "endpoint"` only, so a real browser navigation to `/decks` is proven nowhere.

Journey B is "the guard is mounted and executes on a real request", NOT "PROTECTED_ROUTES has
a test". Scoped the old way, research would specify a test duplicating 9 existing cases.

## The §3 row to add (as `not started`)

| # | Phase name | Goal | Risks covered | Test types | Status |
| 6 | E2E harness + two browser journeys | Close Playwright's non-local seams, then prove the two things the integration layer cannot reach by construction: the guard is mounted, and an accepted card survives a reload | #1 and #6 (extending — **no §2 row changes**) | e2e (Playwright), human-triggered | not started |

## Harness risks the phase must address (harness trustworthiness — the H-08 class, not §2)

1. **No Playwright equivalent of `tests/setup/preflight.ts`.** Preflight closes three
   non-local seams for `npm test` (local host, anon key, `OPENROUTER_API_KEY` unset).
   Playwright has none: `baseURL` is localhost, but the dev server reads `.env`, and README
   documents swapping in cloud credentials. The seed spec ends in a DELETE. `lessons.md`:
   "Preflight musi domknąć KAŻDY nielokalny szew."
2. **`storageState` has no producer.** `playwright/.auth/user.json` is gitignored and no setup
   project creates it → a fresh checkout fails, or runs signed-out and goes red for the wrong
   reason.
3. **No `webServer` block** → the run depends on a hand-started dev server whose environment
   nothing asserts. Couples to (1).
4. **Isolation from `npm test` is incidental, not asserted.** `include: ["tests/**/*.test.ts"]`
   does not match `*.spec.ts` — true, but by glob rather than by an assertion, unlike the
   eval, whose separation is documented and checked.
5. **Repo hygiene:** `test-results/` and `.playwright-cli/` are not in `.gitignore` (only
   `/playwright/.auth/user.json` was added).
6. **One persistent account vs. per-run accounts.** `storageState` implies a single fixed
   account where Vitest provisions fresh ones; plus the 30 sign-ins / 5 min / IP limit (§6.4)
   and deck accumulation in the local DB — §6.6 already records a case where growth past
   `max_rows` made an assertion UNFALSIFIABLE while staying green.

## Response guidance for the two journeys (verify, do not accept blindly)

- **A**: prove the accepted card is visible after `reload` through real SSR/session/Postgres;
  challenge "integration already covers this" (it does not — `callEndpoint` renders endpoints
  only, so `review.astro`'s loader and the deck page's loader rest on MANUAL verification per
  §6.6's S-05 entry); avoid asserting on card CONTENT — §6.5 is explicit that mock output is
  identical on every call (`Przykładowe pytanie 1..N`) and is not an oracle.
- **B**: prove a signed-out browser navigation ends at `/auth/signin`; challenge
  "`tests/middleware.test.ts` covers it" (see the correction above); avoid asserting on a
  `fetch` response status — that is exactly how the C10X-27 bug hid (fetch follows the 302 and
  `/auth/signin` answers 200). The oracle is the browser's final URL.

## Scope boundary — do not collapse this change with the phase it adds

Two reasons, both from this repo's own record. (a) The note under `roadmap.md`'s
`## At a glance`, plus the backfilled H-04/H-07/H-08 entries: work done under a foreign
change-id leaves a row `/10x-archive` will never close. (b) §4 and §5 cannot be written
honestly today — coverage claims would describe work that does not exist, and this plan
treats the audit date as part of every claim. So: this change corrects what is false TODAY and
records the decisions; the phase's own change ships the harness and the journeys, and its
final sub-phase fills §6 (a new "adding an e2e test" subsection), §8, and flips §3 status.

## Corrections to THIS brief, found by measurement during research (2026-08-05)

Recorded here because a plan built from the brief alone would inherit all four.

1. **`AGENTS.md` quotes no file total**, so the claim above that README _and_ AGENTS.md describe
   the gate as "133 files" is false. `133` appears in exactly two places: `README.md:49` and
   `test-plan.md:2765` (the §6.6 C10X-43 claims row, which also carries `115 roots`).
2. **The `INFERENCE` above is now MEASURED and true.** `npm run typecheck` → `Result (135 files)`;
   `git diff --name-status ebe1d92 HEAD` adds exactly `playwright.config.ts` and
   `tests/e2e/seed.spec.ts`; `npx tsc --showConfig` resolves both as project members;
   117 roots + 18 `.astro` = 135, against the documented 115 + 18 = 133.
3. **The §7 triggers did NOT fire**, literally. They are keyed on "the moment any §3 phase wires
   e2e", and no §3 phase did — the harness landed outside the rollout. "No rollout phase claims
   e2e" and §5's "no §3 phase wires it" are both still TRUE and must survive the edit.
4. **Two of the six harness risks are stale.** #5 (`test-results/`, `.playwright-cli/`) is
   CLOSED by `5f3c87e`; #6 inverts on one axis — the harness issues **zero** auth requests per
   run, so the rate limit is not exposed at all. And "uncommitted as of this handoff" no longer
   holds: `8a12d07` + `5f3c87e`.

## Decisions on research's Open Questions (2026-08-05)

Full text and reasoning in `research.md`; this is the plan-consumable form.

1. **§3 gains a Phase 6 row, `not started`.** The phase runs the full
   `/10x-new → research → plan → implement`/`10x-e2e` chain, **not** a hardening ticket — that
   is what closes the C10X-39/40/42/43 orphan pattern instead of repeating it. §7's triggers are
   written up as **mis-keyed, condition never literally met**; the three a11y/island exclusions
   stay excluded, re-dated 2026-08-05.
2. **The refresh states that the e2e layer is already inside the type gate** (CI + `pre-push`).
   It is a NUMBER correction, not a coverage claim, so it stays inside this change's mandate. It
   rides on the 133 → 135 edit and nowhere else: `README.md:49` in place (false half only);
   `test-plan.md:2765` a dated correction line, §6.6 row not rewritten; `AGENTS.md` untouched on
   this axis; `18 .astro` left standing.
3. **Journey A's oracle is the DECK-PAGE count**, not the review-screen metric — the review
   screen reloads itself and the metric hides silently on an aggregate error. Content-free form:
   count `getByRole("button", { name: "Edytuj" })`, one per card (`Usuń` over-counts by one).
   Recorded as response guidance; the final assertion is `/10x-plan`'s work.
4. **The three unignored-artifact classes are DEFERRED to the phase**, deliberately — they are
   latent under the default reporter. **`.gitignore` is not touched by this refresh.**
5. **`lessons.md:184`'s stale pointer is in scope and fixed in place** (`roadmap.md:234` → `:401`)
   — false today, same class as the number corrections.
6. **`H-12` and `C10X-45` are reserved for the PHASE**, not for this refresh, which only names
   them as future ids and creates neither. Known consequence, accepted: this refresh then has no
   roadmap row of its own, so `/10x-archive` will have nothing to close and it will need the same
   backfill H-04/H-07/H-08 needed. Cheap to re-decide at plan time.
