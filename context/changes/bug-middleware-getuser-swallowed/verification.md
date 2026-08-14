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

Pending.
