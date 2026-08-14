# Signout stops presenting a failed signOut as success — Plan Brief

> Full plan: `context/changes/bug-signout-swallowed/plan.md`
> Research: `context/changes/bug-signout-swallowed/research.md`

## What & Why

`POST /api/auth/signout` discards the `{ error }` from `supabase.auth.signOut()` and redirects to
`/` unconditionally; when `createClient` returns `null` it redirects having done nothing at all.
Both swallow points present a failure as success.

Unlike the three siblings that closed this class in `generate.ts` (C10X-48/49/50), **a returned
error here means the user is still signed in** — verified in `@supabase/auth-js` 2.105.3, where
both `return { error }` statements sit above the only call that clears the cookie. On a shared
computer the user believes they left; the session did not.

## Starting Point

Ten lines, no test of any kind — one grep over all of `tests/` returns a single hit, and it only
asserts the "Wyloguj" button _exists_. The symptom is not a stale landing page either: middleware
bounces an authenticated visitor from `/` to `/decks`, so the user clicks "Wyloguj" and is thrown
back into the app with their own e-mail in the header, narrated nowhere. This is the last
discarded-result Supabase mutation in `src/`, carved out for this ticket by `test-plan.md` in four
places.

## Desired End State

Three explicit branches, no silent path: an unconfigured client refuses on the sign-in page; a
failed sign-out lands on the **same** sign-in page with a banner naming the live session and a way
out, plus one Sentry event for the owner; a successful sign-out still goes to `/`. Two guard blind
spots that this change makes load-bearing are closed rather than left to attention.

## Key Decisions Made

| Decision             | Choice                                                                                             | Why (1 sentence)                                                                                                                                                                                                                                      | Source              |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Landing page         | `/auth/signin` + new `AUTH_MESSAGES` member; **no** page edit                                      | It is the one page the middleware cannot bounce (`/auth/*` is unprotected), so the banner renders whatever GoTrue's state — `/decks` would have shown nothing in the dominant failure class, because the middleware's own `getUser()` fails there too | Plan review F1      |
| Copy                 | Names the live session + a way out (close the browser on a shared machine; sign in again to retry) | The landing page is the entire observability surface; this project writes no log line anywhere in `src/`. Must not be confusable with `AUTH_SESSION_MISSING_MESSAGE`, which sits in the same set saying the opposite                                  | Plan + review F1    |
| Channels             | Response **and** Sentry, like C10X-50                                                              | An unreachable GoTrue is security-adjacent and exactly what an owner wants to know about                                                                                                                                                              | Plan                |
| Remedy               | Report only, no forced sign-out                                                                    | `scope: "local"` still performs the network call, and clearing the cookie by hand needs the internal name `lessons.md` forbids depending on                                                                                                           | Research §8 + Plan  |
| Testability          | Extract the decision into a pure function                                                          | The failure branch is unreachable from a suite driving real Supabase, and §6.9 admits a module double only when nothing else can reach the claim                                                                                                      | Plan                |
| `null`-client branch | `/auth/signin?error=AUTH_UNAVAILABLE_MESSAGE`                                                      | Byte-identical to what both sibling auth routes already do; no new constant                                                                                                                                                                           | Research §8         |
| `?error=` guard      | Register `signout.ts` as one more scanned surface; do **not** widen the root                       | A widened root rejects 4 of 6 existing auth emissions (measured against the guard's own `rejection()`), and greening them needs two exemptions in the file where every past exemption was a defect                                                    | Plan review F2      |
| Sentry guard         | Generalize to registered targets + catch-all over `src/`                                           | Today it is hardcoded to `generate.ts`, so a capture anywhere else is guarded by nothing                                                                                                                                                              | Plan                |
| C10X-52              | Stays out                                                                                          | Folding in the read-side twin would repeat the pattern C10X-50 refused when it carved this ticket out                                                                                                                                                 | Research §8         |
| Manual provocation   | `SUPABASE_URL` at a dead port                                                                      | Forces the dominant failure class (status 0) with one reversible `.env` change — and it reaches the banner only because the landing page is unprotected; "still alive" is proved after the port is restored, never during                             | Plan + review F1/F5 |

## Scope

**In scope:** the route's three branches; one new `AUTH_MESSAGES` member (no page edit — the sign-in
page already renders a vouched banner); a pure decision module with a truth table; the route's first
test; the Sentry channel and its report builder; widening two guards; one recorded manual run;
doc-sync across four `test-plan.md` sites and the roadmap.

**Out of scope:** any local remedy or forced session close; C10X-52 (`middleware.ts`'s `getUser()`);
the three sign-out triggers' inconsistent accessible names and whether `dashboard.astro` is dead
weight; any new island or `retriable` flag (there is no `fetch` call site to read one).

## Architecture / Approach

The defect is two lines; the design is the landing page, and everything else follows from it —
which closed set the message joins, whether `decks/index.astro` is touched, whether the size pin
moves. A pure `signout-outcome` module owns the outcome→landing decision and (in Phase 4) what
leaves the process toward Sentry; the route becomes a thin caller. Two textual guards then make
both new channels enforced rather than conventional.

## Phases at a Glance

| Phase                           | What it delivers                                                                        | Key risk                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Decision, copy, closed set   | Pure decision + truth table, new `AUTH_MESSAGES` member, roadmap H-19                   | Copy that gets "tidied" back into a one-liner, or that reads as a variation on `AUTH_SESSION_MISSING_MESSAGE` beside it                           |
| 2. Route                        | **Defect fixed** — three branches, route's first test; no page edit                     | A success-path test signs out the _shared_ account: `scope: "global"` revokes every session for that user across parallel files                   |
| 3. `?error=` guard registration | New emission actually enforced                                                          | The sweeps are textual, so the route must build its own URL or the registration guards an empty file; floors must be re-measured, not scaled      |
| 4. Sentry channel + guard       | Second channel, generalized to registered targets + catch-all                           | Rewriting a 245-line, densely argued guard without losing `generate.ts`'s six existing claims (seven `it()`s incl. the detector control)          |
| 5. Evidence and doc-sync        | Manual run with its control, four carve-out sites, eight stale pointers, roadmap closed | A one-variable control is what separates "fires on the right failure" from "fires on every failure"; the pointer sweep must be a grep, not a list |

**Prerequisites:** local stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset, clean tree on a
branch off `main` at `65ecb47`.
**Estimated effort:** ~3-4 sessions; Phase 4 is the largest single piece.

## Open Risks & Assumptions

- **The shared-account hazard is the sharpest one, and it is UNMEASURED.** A global sign-out revokes
  refresh tokens; whether the existing **access** token dies with them decides both whether Phase 2's
  test needs its own account and whether its "the cookie no longer resolves a user" assertion can
  pass at all. The two are the same fact read in opposite directions, so Phase 2 opens by measuring
  it (plan-review F4). A third account is also not free: it is an edit to shared globalSetup, and the
  suite's auth budget is 4 requests per run against a 30/5-min ceiling.
- **Research §7's sampling caution does not apply here**, and the plan corrects it rather than
  propagating it: `sampleSentryEvent` returns early for any event without a `logger === "console"`
  stamp, which a direct `captureException` never carries.
- **Nothing proves a Sentry event is delivered**, at any layer in this project — `/api/shipprobe`,
  the only instrument that ever showed one arriving, was deleted by C10X-54.
- **The `null`-client branch is unreachable from the suite** (`astro:env/server` is inlined at
  transform time), so it rests on the truth table plus one manual run.
- **A browser POST may answer 403 on CSRF grounds** unrelated to this route's logic — worth knowing
  before a manual run reads it as evidence.

## Success Criteria (Summary)

- A failed sign-out never presents as success: the user lands on a page that matches reality, with a
  banner naming the live session and a way out, and the retry button is right there.
- An unconfigured client refuses visibly instead of redirecting as if it had worked.
- Both new channels are enforced by a guard that goes red when neutered — proved by running, not
  argued.
