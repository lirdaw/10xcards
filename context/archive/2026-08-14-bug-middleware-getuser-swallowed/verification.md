# Verification — C10X-52 `bug-middleware-getuser-swallowed`

Evidence for the change that stops `src/middleware.ts` reading a `getUser()` auth error as "not
signed in". Phase 4 is the falsification record; Phase 5 is the manual before/after that owns the
wiring, and it is the only evidence covering either failure branch end to end.

---

## Phase 4 — Falsification

### Environment

| Item                 | Value                                      |
| -------------------- | ------------------------------------------ |
| Date                 | 2026-08-14                                 |
| Branch               | `C10X-52-bug-middleware-getuser-swallowed` |
| HEAD at start        | `f380799` (Phase 3)                        |
| Runner               | Vitest 4.1.10, shuffle on, seed un-pinned  |
| Stack                | local Supabase up, `/auth/v1/health` → 200 |
| `SUPABASE_URL`       | `http://127.0.0.1:54321`                   |
| `OPENROUTER_API_KEY` | unset                                      |

### Denominators, measured by RUNNING each file alone

Never counted from `it(` — three of these files use `it.each`, so a static count and a run
disagree by construction (the C10X-51 lesson, where 16 `it(` reported 20).

| File                                     | Cases  |
| ---------------------------------------- | ------ |
| `tests/lib/auth-outcome.test.ts`         | **20** |
| `tests/middleware.test.ts`               | **23** |
| `tests/lib/form-endpoint-guards.test.ts` | **11** |

The plan predicted 23 for `middleware.test.ts`; confirmed by run, not carried over.

### Pristine hashes, taken BEFORE the first edit

Copies parked outside the repo; every restore below is verified against these rather than read
for plausibility (the C10X-51 trap: a `.env` restore that _read_ correct and _hashed_ wrong).

```
659841468558ca540bc0eab48b8c4334  src/lib/auth-outcome.ts
150ea05d2bde70874c54ab4b201d90ba  src/middleware.ts
5616b43a1399fe3056888d7f65168b73  tests/lib/form-endpoint-guards.test.ts
b1967db02b31f28e130a241256d36cd4  tests/lib/auth-outcome.test.ts
8c61fcabd6283211f17c0aeb548bba17  tests/middleware.test.ts
```

### The five runs

#### B1 — the classifier's `unavailable` arm returns `no-session`

**Neuter**: all three `return "unavailable"` sites in `classifyAuthError` flipped to
`"no-session"` (the `AuthRetryableFetchError` name rule, the 429 rule, the `>= 500` rule). The
collapse is total on purpose: a single-site flip would leave the other two rows green and the
run would understate what the table observes.

**Predicted**: 5 of 20 — taxonomy rows c, d, d', e, plus the whole-set positive control, whose
`classifications.size` drops from 2 to 1.

**Observed**: **5 of 20 red**, exactly those five.

```
× classifies 'c — GoTrue unreachable, no response a…' as 'unavailable'
× classifies 'd — GoTrue answers 500' as 'unavailable'
× classifies 'd' — GoTrue answers 503, which auth-…' as 'unavailable'
× classifies 'e — GoTrue rate-limits the request' as 'unavailable'
× makes more than one decision, and says something on more than one of them

AssertionError: expected 'no-session' to be 'unavailable' // Object.is equality
AssertionError: expected 1 to be 2 // Object.is equality
```

**The attribution is the green half**: `tests/middleware.test.ts` stayed **23 of 23 passed**. No
middleware row rides the outage classes, so this criterion is a claim about the truth table and
nothing else — which is what the extraction was for.

#### B2 — the classifier maps `AuthSessionMissingError` to `unavailable`

The load-bearing one: the naive-`if (error)` regression, applied at the layer that actually
carries that class. Neutered on the `name` rule and **not** on the `default` arm, because that
class is matched explicitly and never falls through — a `default` flip would leave every
middleware row green and prove nothing about this file (B3 below measures exactly that).

**Predicted** (from the plan, by row): both `it.each(PROTECTED_ROUTES)` blocks (7 + 7), the
form-POST row, the same-deck JSON row and the body-less fetch row — **≈ 17 of 23**. Predicted
green: the `Vary` row and the three public-path rows.

**Observed**: **17 of 23 red** in `tests/middleware.test.ts`, and **4 of 20 red** in
`tests/lib/auth-outcome.test.ts` (rows a, b1, b2, f1).

```
AssertionError: expected 503 to be 401 // Object.is equality
AssertionError: expected '/auth/signin?error=Brak%20po%C5%82%C4…' to be '/auth/signin'
AssertionError: expected 'unavailable' to be 'no-session' // Object.is equality
```

The red count matched the prediction exactly. The **green** list did not, and it is recorded as
observed rather than rounded to the plan: six rows stayed green, not the four the plan
enumerated. The two it did not name are `protects /api/study through its own entry` (pure array
logic, never calls the guard) and `lets a signed-in caller through to the route` (a real
session, so `locals.user` is non-null and the branch is never reached). Both are rows that
cannot reach the classification at all, so the plan's list was incomplete rather than wrong —
but the plan predicted a set and the run produced a larger one, which is the kind of divergence
this project records instead of smoothing.

Full green set:

```
✓ marks both representations as varying on the caller's headers
✓ lets a signed-in caller through to the route
✓ lets a public path through: /api/auth/signin
✓ lets a public path through: /auth/signin
✓ protects /api/study through its own entry, not through /study
✓ lets a public path through: /
```

The `Vary` row staying green is worth one sentence, because it looks like a miss and is not: it
asserts the header on both representations, and the outage branch sets the identical
`VARY_ON_CALLER` — so a row that would have caught a _missing_ `Vary` correctly does not catch a
_changed status_.

#### B3 — the classifier's `default` arm flipped to `unavailable`

**Predicted**: reddens `tests/lib/auth-outcome.test.ts` **only**. Under the module's design the
default arm is reached by an unrecognised `code` and by a shapeless value, and no
`middleware.test.ts` row produces either — so a middleware-side red here would mean the arms are
wired wrongly, not that the neuter worked.

**Observed**: **4 of 20 red**; `tests/middleware.test.ts` **23 of 23 passed**. The caveat holds.

```
× reads an unrecognised AuthApiError code as no-session
× reads 'an empty object' as no-session, because a throw does not come through here
× reads 'an object carrying nothing the classi…' as no-session, because a throw does not come through here
× does not read an unrecognised 4xx as an outage

AssertionError: expected 'unavailable' to be 'no-session' // Object.is equality
```

The `null` / `undefined` rows stayed green, correctly: they return at the `if (!error)` guard
clause above, never through the default arm. So this run separates the guard clause from the
default arm as well as separating the layers.

#### B4 — the landing function removed from `decisionFunctions`

**Neuter**: `MIDDLEWARE_DECISION_FUNCTIONS` emptied — `decisionFunctions`, **not**
`vouchingModule`. The plan's caveat is the reason: the middleware imports nothing from
`@/lib/auth-errors`, so `ownedNames()` is empty either way and the vocabulary check resolves
`decisionModule ?? vouchingModule` — a wrong `vouchingModule` changes nothing and comes back
green.

**Predicted**: 1 red, on the vouching claim, with the reason
`` `message` is neither imported from the closed set nor declared here ``.

**Observed**: **1 of 11 red**, verbatim.

```
× emits only values the landing page for that surface can vouch for
AssertionError: expected [ Array(1) ] to deeply equal []
+   "middleware.ts:160: `message` is neither imported from the closed set nor declared here",
```

So the exemption is load-bearing rather than decorative: without it the surface's own correct
line is refused, which is what makes the per-function grant a real grant.

#### B5 — a bare literal emitted into `?error=` from the middleware

The claim the whole of Phase 3 rests on: that the registration actually inspects this file.

**Neuter**: the redirect's interpolated `message` replaced with a quoted literal.

**Observed**: **2 of 11 red**, both naming the middleware file and line.

```
× interpolates only identifiers, never a quoted string
× emits only values the landing page for that surface can vouch for

+   "middleware.ts:161: `/auth/signin?error=${encodeURIComponent(\"Awaria uwierzytelniania\")}`,"
+   "middleware.ts:161: not an identifier: \"Awaria uwierzytelniania\""
```

Both sweeps fire, on the same line, for two different reasons — the inline-literal detector and
the membership rule. The registration is real.

### The prediction that did not survive contact: the formatter

Test-plan §6.11 says to check what a neuter does to the harness before reading its colour, and
this run is why. The repository's post-edit hook ran Prettier on `src/middleware.ts`
immediately after the B5 edit and **rewrapped the emission across lines**:

```
        const toSignInWithReason = context.redirect(
          `/auth/signin?error=${encodeURIComponent("Awaria uwierzytelniania")}`,
        );
```

That block is fenced WITHOUT a language tag, and it has to be. Written as `ts` it was silently
rewritten by the same tool it documents: Prettier formats embedded code blocks, the excerpt is
114 characters against this project's `printWidth` 120, so a `--write` on this file JOINED the
three lines back onto one — leaving the sentence above it saying "rewrapped across lines"
directly over a single-line example. Caught reading the file back during Phase 4's own manual
verification, not by any check. A fence with no language is left alone, so the evidence stays
what was observed. Generalise it as: a formatter that runs over an evidence document can falsify
the evidence, and a fixed-point check cannot see it — both forms were stable.

That is the shape of the KNOWN LIMITATION the guard file records for itself: the call-site regex
runs per LINE, so a call Prettier has broken across lines matches nothing and is never
inspected — not rejected, unexamined. Read carelessly, a green B5 here would have been recorded
as "the registration does not work" when the truth was "the neuter was never seen".

**What actually happened, and the claim is deliberately narrow.** Prettier broke at the
`context.redirect(` argument boundary and left the template literal **whole, on its own line**.
Both `ERROR_INTERPOLATION` and `INLINE_ERROR_LITERAL` match per line and both still matched, so
B5 reddened as intended. The line number moved from 160 to 161, which is why B4's reason names
`:160` and B5's names `:161` — same emission, one wrap apart.

This does **not** retire the limitation, and it must not be read as doing so. What it shows is
that the wrap Prettier actually produces on _this_ emission does not disarm the sweep, because
the interpolation survives intact on one line. The limitation is about a value that stops being
matchable at all — a helper call broken mid-argument, or a string concatenation in place of the
template literal, which contributes zero emissions rather than a rejected one. Neither was
provoked here, and the standing guard against both is the
`emissionCount(MIDDLEWARE_FILE) > 0` pin Phase 3 shipped, not this one-off run.

### A second harness finding: "run Prettier on a copy first" needs an IN-REPO copy

Test-plan §6.6's C10X-43 entry says to run Prettier on a copy before letting it near the
original. Followed literally with a copy in the system temp directory, that procedure **measures
the wrong thing**, and it produced a false alarm here before it was caught.

Observed: this file was written with the B5 example wrapped across three lines. A `--write` on an
in-repo path joined it onto one line; a `--write` on a `/tmp` copy of that result wrapped it back
to three; and `--check` reported **both** forms clean. That reads exactly like Prettier being
non-idempotent on this project's markdown, which is the C10X-43 hazard class.

It is not. Prettier resolves configuration **by file path**, so a copy outside the repository
never sees `.prettierrc.json` and is formatted at the default `printWidth` 80 instead of this
project's 120 — and the example line is 114 characters, i.e. exactly between the two. Re-run with
the copy inside the change folder, the file is a genuine fixed point: `--write` on the copy
produces a byte-identical result and `--check` passes.

The rule this sharpens, because the original wording does not carry it: the copy must live
**inside the repository**, or the safety check silently answers a different question than the one
asked. `.prettierignore` covers `context/archive/**` and not `context/changes/**`, so a copy in
the change folder is governed by the same config as the file it stands in for.

### Restores

Every file restored by byte copy from the pristine set, then verified by hash — never by
reading, and never by `git diff` alone.

| File                                     | md5 after restore                  | Matches pristine |
| ---------------------------------------- | ---------------------------------- | ---------------- |
| `src/lib/auth-outcome.ts`                | `659841468558ca540bc0eab48b8c4334` | yes              |
| `src/middleware.ts`                      | `150ea05d2bde70874c54ab4b201d90ba` | yes              |
| `tests/lib/form-endpoint-guards.test.ts` | `5616b43a1399fe3056888d7f65168b73` | yes              |
| `tests/lib/auth-outcome.test.ts`         | `b1967db02b31f28e130a241256d36cd4` | untouched        |
| `tests/middleware.test.ts`               | `8c61fcabd6283211f17c0aeb548bba17` | untouched        |

`git diff -- src/ tests/` is **empty**. The last two rows are listed because they are the files
the runs were _read through_ rather than edited; hashing them proves no neuter leaked sideways
into an oracle, which a diff of the edited files alone would not show.

### Full suite after the last restore

```
Test Files  41 passed (41)
     Tests  521 passed (521)
     Seed  1786719326663
```

**521 / 41**, against C10X-51's closing **501 / 40**. The delta is `tests/lib/auth-outcome.test.ts`
alone — **+20 cases, +1 file** — measured by running that file rather than inferred; `501 + 20 = 521`
closes as a check on the measurement, never as its source. `tests/lib/form-endpoint-guards.test.ts`
is unchanged at **11**, correctly: Phase 3 added assertions inside existing cases and no new `it()`.

### Predictions against observations — the whole ledger

Criterion 4.4 in one place, so it is auditable rather than a matter of trusting the prose above.
Four predictions survived contact unchanged; four things diverged, and each is recorded where it
happened rather than rounded to what was expected.

| Prediction                                                                | Outcome                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| B1 — 5 of 20, the four outage rows plus the whole-set control             | **Held.** Exactly those five.                                                                           |
| B2 — "≈ 17 of 23", by named row                                           | **Red count held exactly; the GREEN set diverged** — six green, not the four the plan enumerated.       |
| B3 — reddens the truth table ONLY                                         | **Held.** 4 of 20, middleware 23/23.                                                                    |
| B4 — 1 red, reason quoted verbatim in the plan                            | **Held.** 1 of 11, string identical.                                                                    |
| B5 — the registration inspects this file                                  | **Held**, 2 of 11 — but only after the formatter question below was settled.                            |
| _(unplanned)_ the neuter would reach the walker as written                | **Diverged.** A post-edit Prettier hook rewrapped the emission before the run; checked before reading.  |
| _(unplanned)_ "run Prettier on a copy first" is a sufficient safety check | **Diverged.** A `/tmp` copy escapes config resolution and measured `printWidth` 80, not the repo's 120. |
| _(unplanned)_ an evidence document is inert under its own tooling         | **Diverged.** A `ts`-fenced excerpt was rewritten by `--write`, contradicting the sentence above it.    |

The two numeric claims in this record were **measured rather than inferred**, after being written
by reading first. Only two test files change across the whole branch
(`git diff --stat 2326ecc..HEAD -- tests/`): the new `tests/lib/auth-outcome.test.ts` and
`tests/lib/form-endpoint-guards.test.ts`. Phase 3's only `it(` change in the latter is a case
**title rename** — one removed line, one added, no case created or destroyed — so its 11 is
unchanged in both directions, and the suite delta is the new file alone.

### What Phase 4 does NOT prove

Read this before citing the falsification as coverage of the fix.

- **Neither failure branch is exercised end to end.** Every run above drives a fabricated
  argument or a healthy stack. That the middleware reaches the classifier at all, and that a real
  outage produces the new response, is Phase 5's and nothing else's.
- **The 503's STATUS is observed by nothing automated**, by the same structural absence of a seam.
  "Return 401 instead" is not a criterion here at all; it moves to Phase 5 row 6, where
  `src/lib/http.ts` turns any 401's body back into "Twoja sesja wygasła" and the regression becomes
  visible. This is the only place in the change where D-07 is falsifiable.
- **Classes 500 and 429 are covered by the truth table alone.** The manual run provokes
  `AuthRetryableFetchError` (status 0) and nothing else.
- **`tests/middleware.test.ts` gained no case for the new branch.** Its 23 are a regression proof
  that the signed-out path is byte-identical, and they say nothing about the fix.
- **B3's default arm has no production route into it from any test.** It is asserted only against
  fabricated input, which is the point of the extraction and also its ceiling.

---

## Phase 5 — Manual before/after

Both failure branches are unreachable from Vitest, so this run owns the endpoint's use of the
classifier. **Nothing bridges it and the suite, and no test in this project can.**

### Environment

| Item                 | Value                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Date                 | 2026-08-14                                                                                |
| Branch               | `C10X-52-bug-middleware-getuser-swallowed`                                                |
| HEAD                 | `8fb99d4` (Phase 4)                                                                       |
| App                  | `npm run dev` on `localhost:4321` (workerd), driven with `curl`, then re-driven in Chrome |
| Stack                | local Supabase up, `/auth/v1/health` → 200                                                |
| `OPENROUTER_API_KEY` | unset                                                                                     |
| Throwaway account    | `manual-c10x52-p5-1786720259@example.com`, used for nothing else                          |
| The outage           | `SUPABASE_URL` → `http://127.0.0.1:54399`, probed: `curl` exit **7**                      |

The dead port keeps the hostname at `127.0.0.1`, so the session cookie's name is unchanged
(`sb-127-auth-token`) and the request still carries a real session into the middleware. That is
the whole reason a port swap provokes this defect rather than merely hiding the session.

### Pristine hashes, taken BEFORE the first edit

Copies parked outside the repo; every restore below is verified against these rather than read
for plausibility — the C10X-51 trap, where a `.env` restore _read_ correct and _hashed_ wrong
because .NET's `.` consumed the `\r` in a CRLF file. Nothing here was restored with a regex.

```
d56648ca7e65776ccf80bdd31f4dbc32  .env                        (pristine)
150ea05d2bde70874c54ab4b201d90ba  src/middleware.ts           (pristine, = Phase 4's)
c33a44f3ce4b798cff6679a413265803  .env                        (dead-port variant)
2117332b09665068d3b93188ce2383aa  src/middleware.ts           (pre-fix, from 889042d)
e095a0dfd9ce198d4415edc61edf8d93  src/middleware.ts           (row 6 neuter, 503 → 401)
```

`889042d` is Phase 1, which added the classifier and did **not** touch the middleware —
`git diff 2326ecc 889042d -- src/middleware.ts` is empty — so its copy of the file is the
pre-fix original and the swap changes exactly one thing.

### The run

Rows are numbered as the plan numbers them. Ordering deviates from the plan in one place and the
reason is below the table.

| #     | State                                              | Request                                 | Observed                                                                                        |
| ----- | -------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0     | fix in place, stack live, signed in                | `GET /decks`                            | `200`, account e-mail rendered ×1 — the baseline                                                |
| 5     | fix in place, stack live, **no cookie**            | `GET /decks`                            | `302 → /auth/signin`, `?error=` occurrences **0**, `Vary: Sec-Fetch-Dest, Content-Type, Accept` |
| 5 (b) | same                                               | `GET /api/study` as JSON                | `401` `{"error":"Nie jesteś zalogowany"}`                                                       |
| **1** | **fix STASHED** (`889042d`), **dead port**, cookie | `GET /decks`                            | `302 → /auth/signin`, `?error=` **0** — **the defect, live**                                    |
| 1 (b) | same                                               | `GET /api/study` as JSON                | `401` `{"error":"Nie jesteś zalogowany"}`                                                       |
| 1 (c) | same                                               | `GET /auth/signin`                      | `200`, `role="alert"` nodes **0** — nothing on any channel says why                             |
| **2** | **fix in place**, dead port, cookie                | `GET /decks`                            | `302 → /auth/signin?error=Brak%20po%C5%82%C4%85czenia%20…`, identical `Vary`                    |
| 2 (b) | same                                               | `GET` that redirect target              | `200`, `role="alert"` nodes **1**, carrying `AUTH_NETWORK_MESSAGE`                              |
| **3** | same                                               | `GET /api/study` as JSON                | **`503`**, `Content-Type: application/json`, identical `Vary`, body = `AUTH_NETWORK_MESSAGE`    |
| 5 (c) | fix in place, dead port, **no cookie**             | `GET /decks` / `GET /api/study`         | `302 → /auth/signin` with `?error=` **0** / `401 {"error":"Nie jesteś zalogowany"}`             |
| 5 (d) | same                                               | `GET /`, `/auth/signin`, `/auth/signup` | `200`, `200`, `200` — no path the outage could gate                                             |
| **6** | dead port, **`status: 503` → `401`**               | `GET /api/study` as JSON                | `401`, wire body still `AUTH_NETWORK_MESSAGE` — **and see the island reading below**            |
| 6 (b) | dead port, **`503` restored**                      | same request, same probe                | `503`, and the island reads the outage copy — the pair, one variable apart                      |
| 7     | dead port, cookie                                  | `GET /`                                 | `200` **guest landing**, e-mail rendered **0**, "Zaloguj się" ×1 — D-04's stated cost, measured |
| 7 (b) | dead port, cookie                                  | `GET /decks`, `GET /api/study`, `GET /` | `Set-Cookie` headers: **0, 0, 0** — nothing is revoked and nothing is cleared                   |
| **4** | **port restored**, same cookie, **no re-sign-in**  | `GET /decks`                            | `200`, e-mail rendered ×1, `AUTH_NETWORK_MESSAGE` **0** — the session survived the whole outage |
| 4 (b) | same                                               | `GET /`                                 | `302 → /decks` — the middleware agrees the user is signed in                                    |
| 4 (c) | same                                               | `GET /api/study` as JSON                | `404` — the guard let it through; that route exports no `GET` handler                           |

**Row 1 against row 5 is the defect stated as an identity.** With the fix stashed, a user holding
a live session and a dead backend produces a response **byte-identical** to an anonymous
visitor's — same status, same `Location`, same `Vary`, no `?error=`, and a landing page with zero
alerts on it. That is not an analogy for the bug; it is the bug, and the two rows sit one above
the other so the sameness is readable rather than argued.

**Row 4's `404` is the control working, not a failure.** `/api/study` exports `POST` only, so a
`GET` that reaches routing answers `404`. Reaching routing at all is the claim: under rows 3 and 6
the same request never got past the middleware.

**One ordering deviation from the plan, and it makes row 4 stronger rather than weaker.** The plan
lists the port-restored control at position 4 and the status probe at position 6. Run in that
order, the control would sit two variables away from the last outage observation, because row 6
mutates `src/middleware.ts` and restores it afterwards. Row 6 was therefore run first and its
restore re-confirmed by re-issuing row 3 **as row 6 (b)** — so the closing control is exactly one
variable (the port) away from a freshly re-measured outage reading.

### Row 2 (b): the banner, and the two things a naive count gets wrong

`AUTH_NETWORK_MESSAGE` appears **twice** in that page's HTML and only one of them is a rendered
node:

- offset 90073 — inside `<p role="alert" class="… border-red-500/30 bg-red-900/30 … text-red-300">`,
  i.e. the `ServerError` banner.
- offset 86923 — inside `props="{&quot;serverError&quot;:[0,&quot;…"` , the island's hydration
  payload. Not a node, but useful: it is the evidence the message **survives hydration** rather
  than being an SSR-only artifact that the island's `history.replaceState` cleanup wipes.

**The `[role="alert"]` scoping the plan demands was verified in both directions.** On the outage
landing there is exactly **one** alert, because the OpenRouter config entry is
`requiresSession: true` and the visitor is signed out, while the Supabase entry keys on
**configuration** and not on reachability — `SUPABASE_URL`/`KEY` are still set here, so
`missingConfigs` never contains it. The trap is real and it fires on the other side: row 4's
`/decks` also reports exactly one `role="alert"`, and that one is **`Banner.astro`**'s OpenRouter
mock-mode notice, carrying no error at all. An unscoped `querySelector('[role="alert"]')` reads a
different node on each of the two pages.

> **Corrected by the island run below, and the corrected sentence is the reassuring one — which is
> why it is struck rather than quietly reworded.** This paragraph originally continued "…and this
> run's outage class does **not** reproduce the two-alert page C10X-51 met." That is true of
> `/auth/signin` and **false of the app as a whole**: the study screen during the same outage
> carries **two** `[role="alert"]` nodes, and after the second call site fires, **three** — the
> config banner (visible there because the user IS signed in) plus one `ServerError` per failed
> fetch. So the trap is worse on the authenticated surfaces than on the landing, not absent. The
> scoping used throughout this record is unaffected, because every reading here matches on the
> node's **text** rather than taking `querySelector`'s first hit.

Measured server-side, in the HTML before any JS runs, for the reason C10X-51 records: the sign-in
island strips `?error=` from the URL on mount, so in the DOM alone "rejected" and "cleaned up"
look identical. The claim taken is that the node is **rendered and carries the message**;
announcement by a screen reader is not claimed anywhere in this change.

> **A real browser was driven afterwards** — see "The same run, in a real browser" below — and it
> confirms every reading in this section from the other side, including the one thing the
> server-side measurement structurally cannot show: that the banner **survives** the island's URL
> cleanup rather than being wiped with the query string.

### Row 6: what the island receives, and how that was measured

The wire is only half of it. `src/lib/http.ts:52-53` replaces the body of **any** `401` with
`SESSION_EXPIRED_MESSAGE`, so a `401` carrying outage copy arrives at the island as the very
message this ticket removes. Both readings, from the real running server:

```
--- 503 → 401 (D-07 neutered) ---
wire status  : 401
wire body    : {"error":"Brak połączenia z serwerem uwierzytelniania. Spróbuj ponownie za chwilę."}
island reads : {"ok":false,"message":"Twoja sesja wygasła. Zaloguj się ponownie.","status":401,"parsed":true}
is it the SESSION-EXPIRED copy? true
is it the OUTAGE copy?          false

--- 503 restored (shipped) ---
wire status  : 503
wire body    : {"error":"Brak połączenia z serwerem uwierzytelniania. Spróbuj ponownie za chwilę."}
island reads : {"ok":false,"message":"Brak połączenia z serwerem uwierzytelniania. Spróbuj ponownie za chwilę.","status":503,"parsed":true}
is it the SESSION-EXPIRED copy? false
is it the OUTAGE copy?          true
```

**This is the only place in the change where D-07 is falsifiable at all**, and the pair differs in
exactly one character sequence: `status: 503,` → `status: 401,` at `src/middleware.ts:146`,
confirmed a one-line change by `diff` against the pristine copy before it was applied.

**How "the island receives" was measured, stated precisely because it is a boundary rather than a
mounted island.** A throwaway probe outside the repository imported the **real**
`src/lib/http.ts` — which has no imports of its own, so it needs no bundler — issued the **real**
request against the **real** running dev server, and passed the **real** `Response` object to
`readJsonResponse`. Nothing is fabricated. What is absent is the React tree around the call:
`readJsonResponse` is the whole of the decision `StudySession` delegates (that is why C10X-27
extracted it), and `StudySession.tsx:215` is its one call site on the rating path. The probe lived
in the scratch directory and never entered the repository; `git status --porcelain -uall` below is
the proof.

> **That boundary was then CLOSED rather than left standing** — see "The island itself, mounted and
> clicked" below. This paragraph originally went on to argue that mounting the component "would
> measure the same function with more moving parts". It was mounted, and the extra moving parts
> turned out to carry evidence the probe cannot: which of the island's **two** `readJsonResponse`
> call sites fire, that the message reaches a rendered `ServerError`, that the rating buttons
> survive so the user can retry, and that the session does **not** advance — the C10X-27 failure
> mode, checked on this new branch rather than assumed away.

Worth noting what the neutered row does **not** do: the 401 does not reach the other three
`fetch`-carrying islands as a wrong message, because `GeneratorForm`, `FlashcardWorkspace` and
`CandidateReviewWorkspace` all take a raw `res.json()` path and would surface the outage copy
either way (verified by enumeration: `readJsonResponse` has exactly one importer in `src/`). The
regression D-07 avoids is real and is confined to the study path.

### Row 7: the two things this run measured that the plan only cited

- **D-04's cost is now observed rather than quoted.** During the outage a user with a live session
  loading `/` gets the **guest landing** — `200`, the account e-mail absent, "Zaloguj się"
  present. `locals.user` is `null` by design (D-04 keeps the union `User | null`), so `/` and
  `Topbar.astro` read as signed-out. That is exactly what "What We're NOT Doing" says, and it is
  now a measurement instead of a forward reference to research §7.1.
- **The cookie-clearing side effect is not regressed.** Zero `Set-Cookie` headers on any outage
  response — the document redirect, the JSON `503`, and `/`. `_getUser` calls `_removeSession()`
  on `AuthSessionMissingError` **only**, so the transport class must leave the cookie alone; row 4
  is the consequence, and it is the strongest single reading in this run: **the same cookie, with
  no re-sign-in, lands `/decks` at `200` with the account e-mail on it after the port comes back.**
  The session was live throughout, which is precisely what row 1 denied.

### The naive fix, and why row 5 was run twice

`getUser()` answers with an error for the ordinary signed-out visitor too — before any network
call (`GoTrueClient.js:2493-2494`) — so a plain `if (error)` would banner every anonymous visitor.
Row 5 was therefore run in **both** stack states, and the outage variant is the load-bearing one:
with the backend dead, an anonymous visitor still gets the bare `302` and the untouched
`401 {"error":"Nie jesteś zalogowany"}`, because that short-circuit fires before any transport is
attempted. Row 5 (d) closes the circularity question in the same breath: `/`, `/auth/signin` and
`/auth/signup` all answer `200` during the outage, so nothing the classification does can gate the
page it redirects to.

### The same run, in a real browser — 2026-08-14

The `curl` run above is complete on its own and is the reproducible record. It was then repeated
in Chrome against the same dev server, for the four things `curl` structurally cannot do: read the
**live DOM** after hydration, issue a fetch whose `Sec-Fetch-Dest` the **browser** supplies rather
than the operator, watch the island's `history.replaceState` cleanup, and see the banner rendered.
Same account, signed in through the real form.

**The trick that makes the fetch row realistic is the C10X-51 one.** During an outage no protected
page RENDERS, so an island can only be fetching if its page was loaded **before** the backend went
away. So the tab was left on `/decks`, the dev server restarted underneath it against the dead
port, and the fetch issued from that still-live page — which is the actual user scenario, not a
convenience.

| step | state                                  | action                                    | observed                                                                                                                      |
| ---- | -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| b1   | stack live, signed out                 | load `/`                                  | guest landing, `h1: 10xCards`, **0** `[role="alert"]`                                                                         |
| b2   | stack live                             | sign in through the real form             | `/decks`, `title: Talie`, account e-mail rendered, **1** alert — and it is the **OpenRouter config banner**                   |
| b3   | tab still on `/decks`, **port killed** | `fetch('/api/study', {method:'POST', …})` | **`503`**, `redirected: false`, `content-type: application/json`, `Vary` identical, body = `AUTH_NETWORK_MESSAGE`             |
| b4   | dead port                              | navigate to `/decks`                      | lands `/auth/signin`, **1** alert, its text **equal to** `AUTH_NETWORK_MESSAGE`, config banner **absent**, `?error=` stripped |
| b5   | dead port                              | same page, scan for the misleading copy   | `"Twoja sesja wygasła…"` present **nowhere**; the outage copy appears **once**; the alert is a `<p>` with `bg-red-900/30`     |
| b6   | dead port                              | load `/auth/signin?error=<attacker text>` | **0** alerts, the string in neither `innerText` nor `innerHTML`, URL reads `/auth/signin` after mount                         |
| b7   | **port restored**, no re-sign-in       | load `/`                                  | `302 → /decks`, e-mail rendered, sign-out form back, outage copy gone, the single alert is the config banner again            |

**Step b4 is the row 5.5 claim in the form the Progress line actually words it**, and it is an
**equality** assertion rather than a containment one: `alerts.length === 1 && alerts[0].textContent.trim() === AUTH_NETWORK_MESSAGE`.
The scoping trap is measured in both directions by b2 and b4 — the same unscoped
`querySelector('[role="alert"]')` reads `Banner.astro`'s OpenRouter notice on one page and the
`ServerError` on the other. Screenshot:
`C:\Users\lirda\AppData\Local\Temp\claude-chrome-screenshots-2dDbE5\screenshot-1786721201432-6.jpg`.

**Step b4 also shows the one thing the server-side measurement cannot.** The URL reads
`/auth/signin` — the island has already stripped `?error=` — **while the banner is still on
screen**. Server-side, "the banner rendered" and "the banner rendered and then survived hydration"
are the same observation; here they are two, and both hold.

**Step b3 closes a gap the `curl` run left open and did not name.** Every JSON row above was
issued with `Sec-Fetch-Dest: empty` set **by hand**, so strictly they proved the guard's behaviour
given that header rather than that a real island sends it. The browser supplies it itself, and the
request lands on the same `503`. `redirected: false` is the other half worth reading: those are
the two things `readJsonResponse` tests first (`res.status === 401 || res.redirected`), so a
browser-native `Response` reaches the generic arm exactly as the Node probe's did — which is the
C10X-27 hazard checked on this new branch rather than assumed away.

**Step b6 observes something §7 lists as unobserved by any suite.** "Nothing observes the URL
cleanup automatically" is still true of the suite; here the island's `replaceState` strip was
watched directly, and on a value the closed set refuses — so rejection and cleanup were told apart
by watching both, which is the thing the server-side measurement is blind to.

#### A trap this run walked into, recorded because it is the C10X-51 one, met independently

The browser profile was **not** an anonymous client. Its first load of `/auth/signup` — a public
page, signed out by every marker the page itself carries (no "Wyloguj", no sign-out form) —
rendered the OpenRouter config banner, which `requiresSession: true` says an anonymous visitor must
never see. The tell was that contradiction, not the cookie: the extension blocks `document.cookie`,
so the session was confirmed instead by loading `/` and watching it **bounce to `/decks`** carrying
`manual-c10x51-browser-1786704600@example.com` — C10X-51's own browser account, still signed in.

Two things follow, and the second is the reason this is written down rather than fixed silently.
The `curl` evidence above is **unaffected**, because every "no cookie" row used an explicit jar and
no `-b`. And **"no sign-out button" does not mean "signed out" on a page that never renders one**:
`/auth/signup` uses `Layout.astro`, so the markers that make the check work on `/decks` are absent
there by construction. The profile was signed out before the run proper began, which is what makes
step b1's **0 alerts** a real reading and, incidentally, a browser-side confirmation that the
`requiresSession` gate works — the same fact C10X-51 recorded as a **correction** to a false note.
The tab was signed out again and closed at the end, so the next change does not inherit it.

### The island itself, mounted and clicked — 2026-08-14

This closes the boundary every section above states and none of them closes: **no React island was
mounted**. `StudySession` is the one island whose failure copy this change can get wrong (it is the
only importer of `readJsonResponse` in `src/`), so it was seeded, mounted, and driven with real
clicks against a dead backend.

**The seeding, and why it is three manual cards rather than a generation.** A deck
(`C10X52 Study Probe`, `29a77fed-440d-4474-a7fe-7567f9a0c022`) plus three cards created through the
real `POST /api/decks/<id>/cards` form endpoint — manual create writes `accepted` directly, so the
cards are due immediately and `listDueCards` seeds their schedule rows on the first session load.
Going through `/api/generate` would have produced `generated` candidates needing a second accept
step and bought nothing.

**The outage is applied UNDER the loaded page**, the C10X-51 trick, because during an outage no
protected page renders — so an island can only be mid-session if its page loaded first. Tab left on
`/study/<deck>`, dev server restarted against the dead port, no reload.

| step | action                                             | observed                                                                                                                             |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| i1   | load `/study/<deck>` while healthy                 | island mounted: `Kart na sesję`, `Zapisz`, `Pokaż odpowiedź`, `Karta 1 z 3`, front `C10X52 pytanie 1`                                |
| i2   | reveal the answer (client-side, no fetch)          | four rating buttons: `Powtórz za 1 dzień`, `Trudne za 2 dni`, `Dobre za 3 dni`, `Łatwe za 8 dni`                                     |
| i3   | **port killed**, then click **`Dobre`** — `rate()` | a `ServerError` renders carrying **exactly** `AUTH_NETWORK_MESSAGE`; `"Twoja sesja wygasła…"` present **nowhere** in the page        |
| i4   | same page, read the rest of the state              | still `Karta 1 z 3`, all four rating buttons still present, no progress counter — **the rating was refused, not counted**            |
| i5   | click **`Zapisz`** — `SessionSizeControl.save()`   | a **second** `ServerError` with the same copy; the page now carries **three** `[role="alert"]` nodes, two of them the outage message |
| i6   | port restored, page reloaded                       | `Karta 1 z 3`, front `C10X52 pytanie 1`, one alert (the config banner) — **nothing was written**                                     |

Screenshot of i3/i4:
`C:\Users\lirda\AppData\Local\Temp\claude-chrome-screenshots-2dDbE5\screenshot-1786721815295-7.jpg`.

**Step i3 is what D-07 buys, seen where a user would see it.** The Node probe proved
`readJsonResponse` returns the outage message for a `503` and the misleading one for a `401`; this
proves the returned message reaches a **rendered** `ServerError` in the mounted component. Under
the `401` the same click would have painted "Twoja sesja wygasła" over a live session — the
original defect, on the study screen, in Polish, to the user.

**Steps i4 and i6 together are the Risk #3 guardrail holding under an outage**, and they are worth
more than the copy. The C10X-27 defect was a rating silently discarded while the UI reported
progress; here the session refuses to advance, keeps the buttons so the click can be repeated, and
a reload after the backend returns finds **all three cards still due**. The schedule was neither
written nor corrupted.

**Step i5 was not in any plan and is the reason the file has two call sites, not one.**
`SessionSizeControl.save()` routes through the same helper (`StudySession.tsx:91`) and renders its
own `ServerError`. Both fire, both carry the outage copy, and the page ends with **three** alerts —
which is what forces the correction recorded against the row 2 (b) section above.

**One reading of mine was wrong and is corrected here rather than left in the table.** A first pass
reported `ratingButtonsStillThere: []` and it was a defect in the probe, not in the app: the filter
split each label on `\n`, and the labels contain no newline (`"Powtórzza 1 dzień"`). Re-measured
without the split, all four are present — which the i3 screenshot shows independently. Recorded
because an unexplained empty list would have read as "the island hid the way out".

**And a session-fixture fact worth carrying, observed incidentally.** Signing out in the browser
killed the **`curl`** jar as well: `GET /decks` with the old jar answered `302 → /auth/signin`
straight afterwards. That is `signOut()`'s default `scope: "global"`, exactly what test-plan §6.4
records as the reason a sign-out test must mint its own account — met here from the other
direction, with a browser sign-out invalidating a shell session held in a file.

### Restores

Every file restored by **byte copy** from the pristine set, then verified by hash — never by
reading, never by `git diff` alone.

| File                | md5 after restore                  | Matches pristine |
| ------------------- | ---------------------------------- | ---------------- |
| `.env`              | `d56648ca7e65776ccf80bdd31f4dbc32` | yes              |
| `src/middleware.ts` | `150ea05d2bde70874c54ab4b201d90ba` | yes              |

`git diff -- src/ tests/` is **empty**. A tree-wide grep over `src/` and `tests/` for `54399` and
this run's markers returns nothing; the one `status: 401,` remaining at `src/middleware.ts:167` is
the **shipped signed-out branch**, present at the same line in the pristine copy — checked rather
than assumed, because a hash match and a grep hit reading like residue is exactly the moment to
prove which one is right.

`git status --porcelain -uall` lists **one** path, `context/changes/bug-middleware-getuser-swallowed/plan.md`
— Phase 4's own SHA write-back, nothing outside the change folder. The dev server is stopped and
port 4321 has no listener.

### Full suite after the restore

Run **three times**, once per `.env` cycle — the `curl` half, the browser half and the island run —
because a green after the first restore says nothing about the second or the third.

```
Test Files  41 passed (41)     Test Files  41 passed (41)     Test Files  41 passed (41)
     Tests  521 passed (521)        Tests  521 passed (521)        Tests  521 passed (521)
      Seed  1786720542525            Seed  1786721412012            Seed  1786722047822
   (after the curl run)           (after the browser run)       (after the island run)
```

**521 / 41** every time, unchanged from Phase 4's closing figure, which is correct: this phase adds
no test and edits no source. Recorded from the runs rather than carried over from Phase 4, and
`.env` hashed `d56648ca7e65776ccf80bdd31f4dbc32` before each.

### Predictions against observations

| Prediction                                                          | Outcome                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Row 1 — the stashed fix reproduces the archived defect              | **Held**, and stronger than predicted: byte-identical to the anonymous row beside it, with 0 alerts on the landing |
| Row 2 — `302 → /auth/signin?error=<AUTH_NETWORK_MESSAGE>` + banner  | **Held.** Exactly one `role="alert"`, carrying the message                                                         |
| Row 3 — `503` with the outage body and the identical `Vary`         | **Held**, header string identical to the signed-out branch's                                                       |
| Row 4 — one-variable control returns the ordinary `200`             | **Held**, and it doubles as the session-survival reading                                                           |
| Row 5 — anonymous visitor unchanged                                 | **Held** in both stack states; the outage variant was not in the plan and is the stronger one                      |
| Row 6 — a `401` restores the original defect through `http.ts`      | **Held**, and measured on both sides of one line rather than argued                                                |
| _(unplanned)_ the plan's row ordering is the right ordering         | **Diverged.** Rows 6 and 4 were swapped so the control sits one variable from a re-measured outage reading         |
| _(unplanned)_ "the banner renders" is a single-occurrence claim     | **Diverged.** The message appears twice; one is a node, one is the hydration payload                               |
| _(unplanned)_ the outage landing carries the C10X-51 two-alert page | **Diverged, then diverged again.** One alert on `/auth/signin`; **three** on the study screen (i5)                 |
| _(unplanned)_ `curl` proves a real island reaches the JSON branch   | **Diverged.** It proves it _given_ a hand-set `Sec-Fetch-Dest`; step b3 supplies the browser's own                 |
| _(unplanned)_ the browser profile is an anonymous client            | **Diverged.** It carried C10X-51's live session; the tell was a config banner that should have been gated          |
| _(unplanned)_ mounting the island would add moving parts, not proof | **Diverged.** It produced i4/i6 — the session refuses to advance and nothing is written — which no probe reaches   |
| _(unplanned)_ the island has one `readJsonResponse` call site       | **Diverged.** Two, and both fire in the same outage (`rate()` and `SessionSizeControl.save()`)                     |

### What Phase 5 does NOT prove

- **Only one failure class was provoked.** `AuthRetryableFetchError` at status 0, from a refused
  connection. **Classes 500 and 429 were never provoked** and are carried by the truth table
  alone, as is `unconfigured` — no run here removed `SUPABASE_URL`/`SUPABASE_KEY`.
- **Nothing about Sentry, and this ticket adds no capture site at all** (D-01). The 500, 429 and
  `bad_jwt` classes reach no owner: they are classified, answered to the user, and reported to
  nobody. That is a decision, not an oversight, and it is the one place this change breaks with
  its four siblings' two-channel pattern.
- **The `/` and `Topbar.astro` symptom survives**, now measured (row 7) rather than cited.
- **One island was mounted; three were not.** `StudySession` was seeded, mounted and clicked
  (i1-i6), so its two failure branches are observed end to end. `GeneratorForm`,
  `FlashcardWorkspace` and `CandidateReviewWorkspace` were **not** driven — they take a raw
  `res.json()` path and would surface the outage body by construction, but that is an argument from
  reading, which is exactly what §7 says this project must keep doing for islands.
- **Nothing here is an automated test.** The island evidence is one recorded run on one machine; no
  layer in this project executes it, and a future edit to `StudySession`'s error handling will turn
  nothing red. §7's review-by-reading rule is unchanged and is if anything more load-bearing now
  that a second `readJsonResponse` call site is known to exist.
- **Announcement by assistive technology is claimed nowhere.** The browser run reads the DOM: the
  node exists, carries `role="alert"` and holds the message. What a screen reader says about it is
  not observed, exactly as C10X-34 and C10X-51 recorded for the same component.
- **The browser half is one profile, one Chrome, one session.** It corroborates the `curl` run row
  for row and adds four readings that `curl` cannot reach; it is not an independent second
  measurement of the same thing, because both drove the same dev server against the same stack.
- **One machine, one day, one local stack, one GoTrue build.** Whether hosted GoTrue answers the
  same statuses is unestablished — which is why the classifier keys on `name`/`code` and not on
  `status`.
- **`tests/middleware.test.ts` still gained no case for the new branch.** Its 23 are a regression
  proof that the signed-out path is byte-identical; they say nothing about anything above.

### Left in the local dev DB on purpose

`manual-c10x52-p5-1786720259@example.com`, the throwaway account every part of this run signed in
as — the `curl` half, the browser half and the island run share it, so the run adds exactly one
account. It joins the accumulation test-plan §6.6 already records, including `c10x52-probe-*` from
this change's research.

**Unlike the earlier halves, the island run also leaves ROWS**, and they are disclosed rather than
cleaned up, the C10X-49 precedent for its two orphan decks: one deck `C10X52 Study Probe`
(`29a77fed-440d-4474-a7fe-7567f9a0c022`), three accepted flashcards, and the three
`flashcard_schedule` rows `listDueCards` seeded on the first session load. **No rating landed** —
step i6 re-read all three as still due — so no schedule carries a review this run produced.

**One thing was deliberately taken away rather than left**: C10X-51's browser session
(`manual-c10x51-browser-1786704600@example.com`) was still live in the Chrome profile and was
signed out, so the next change meets a clean client instead of the trap this one walked into. The
account itself is untouched and stays in the dev DB.
