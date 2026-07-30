# Verification — auth-error-copy (C10X-34)

Every figure here is **observed**, recorded from the run that produced it, never predicted.
A count without a date and a command beside it is not evidence.

## Phase 0: Baseline

Measured 2026-07-30, before the first edit of this change. Research deliberately did not run the
suite — its live GoTrue probes and the suite share one rate-limit budget — so this is the first
green reading taken against these files, and the reason a red run later has one hypothesis
instead of two.

### Environment

| Precondition | Observed |
| --- | --- |
| Local Supabase stack | running — `npx supabase status` reports the stack up at `http://127.0.0.1:54321` (Studio `:54323`, Mailpit `:54324`) |
| `OPENROUTER_API_KEY` in `.env` | **absent** — `grep -c OPENROUTER_API_KEY .env` → `0` |
| `OPENROUTER_API_KEY` in the shell | **unset** |
| `SUPABASE_URL` / `SUPABASE_KEY` | set in `.env`; preflight's local-host and anon-key assertions passed on every run below |

The two probe accounts research left in the local `auth.users`
(`probe*-1785435299@example.com`) were still present for this baseline, as the plan's
Critical Implementation Details predicted. They are harmless — the suite provisions its own
accounts per run — and no run below was affected.

### Runs

| # | Command | Result | Detail |
| --- | --- | --- | --- |
| 0.2 | `npm test` | **228 passed / 228, 19 files** | seed `1785438294466`, duration 2.66 s. Matches test-plan §8's recorded state exactly (228/228, 19 files after C10X-32's impl-review) |
| 0.3 | `npx vitest run tests/auth/errors.test.ts` | **38 passed / 38, 1 file** | seed `1785438309984`, duration 1.12 s. Matches the count `change.md` recorded from the framing session |
| 0.4 | `npm run lint` | **exit 0** | 6 problems, **0 errors / 6 warnings**, all `no-console` in `evals/generation-quality.eval.ts:148-163`. Pre-existing and already recorded in test-plan §8 (C10X-32's impl-review F5 corrected their attribution to `evals/`, not `scripts/`) |
| 0.4 | `npm run build` | **exit 0** | server build complete in 5.11 s. One pre-existing `[WARN] [@astrojs/sitemap]` about the missing `site` option — unrelated to this change |

Both seeds are un-pinned by design (test-plan §6.2): the suite shuffles files **and** cases, so
this baseline is one permutation, not the only order in which these 228 pass.

### What this baseline does NOT establish

- It is a **reading of the current tree**, not a claim about the change. Nothing here has been
  falsified yet — the first deliberate-breakage run is Phase 1's check A.
- The counts above are the denominators every later split in this file is read against. When a
  phase adds cases, the denominator moves, and a split quoted without its own denominator is
  the exact rot Phase 6 §2 exists to correct.
- `npm test` collects **zero** eval files (C10X-31's structural exclusion), so nothing in this
  baseline touched the real OpenRouter provider, and the forced-language defect that eval
  records is neither reproduced nor contradicted here.

## Phase 1: Mapper — reachability and the closed set

Driven test-first (`/10x-tdd`), 2026-07-30. Two red→green loops; the RED runs are recorded
below beside the breakage checks, because on this phase they carry the same evidence — the RED
of loop A **is** breakage check A run before the entry existed rather than after it was removed.

### Runs

| # | Command | Result | Detail |
| --- | --- | --- | --- |
| 1.1 | `npx vitest run tests/auth/errors.test.ts` | **50 passed / 50** | seed `1785439297776`. Baseline was 38, so **+12**: six new `it.each(cases)` mapping rows and the six non-emptiness rows the same table drives |
| 1.2 | `npm test` | **240 passed / 240, 19 files** | seed `1785439413234`, 2.69 s. Baseline 228/228 — the +12 is entirely this file; no other file asserts on these constants, as the plan predicted |
| 1.5 | `npm run lint` | **exit 0** | unchanged from baseline: 0 errors, the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts` |

### RED, before any production edit

| Loop | Run | Observed |
| --- | --- | --- |
| A | full file | **2 of 40 red.** `maps anonymous_provider_disabled to its own constant` **and** the signup endpoint case, both on `AssertionError: expected 'Nie udało się dokończyć operacji. Spróbuj ponownie.' to be 'Podaj adres e-mail i hasło.'` |
| B | `-t "authErrorMessage"` | **6 red.** The five new mapping rows, plus `keeps the distinct code classes distinct` on `expected 14 to be 17` — 14 because the four not-yet-existing constants import as `undefined` and a `Set` collapses them into one. That collapse is itself the evidence the constants did not exist |

The loop-A endpoint red is the load-bearing one: it is a real request through the real route to
real GoTrue, so it shows the code arrives from upstream rather than only that the table agrees
with itself — which is exactly what the five inference-only rows cannot show.

### Breakage check A — remove the `anonymous_provider_disabled` entry

**2 of 50 red**, observed string identical in both:

```
AssertionError: expected 'Nie udało się dokończyć operacji. Spr…' to be 'Podaj adres e-mail i hasło.'
  Expected: "Podaj adres e-mail i hasło."
  Received: "Nie udało się dokończyć operacji. Spróbuj ponownie."
```

The two are `maps anonymous_provider_disabled to its own constant` (pure) and
`answers owned copy, never the upstream string, when the email part is a File` (endpoint). The
other 48 stayed green, which is what makes these two observe the entry rather than an incidental
failure. Restored from a pristine copy taken before the first breakage edit; `diff` **empty**,
`md5sum` identical (`58c8a788132f63eba6e6624fbabf5031` before and after).

### Breakage check B — repoint `captcha_failed` at `AUTH_GENERIC_MESSAGE`

**1 red**, in the filtered run (1 failed / 43 passed / 6 skipped, denominator 50):

```
AssertionError: expected 'Nie udało się dokończyć operacji. Spr…' to be 'Weryfikacja bezpieczeństwa nie powiod…'
  Expected: "Weryfikacja bezpieczeństwa nie powiodła się. Odśwież stronę i spróbuj ponownie."
  Received: "Nie udało się dokończyć operacji. Spróbuj ponownie."
```

**`keeps the distinct code classes distinct` stayed GREEN under this mutant** — measured, not
argued, and it is the point of running B separately. That `Set` is built from imported constants
and never calls the mapper, so it cannot observe a repointed map value. The case's own comment
claims it "is what a mutant that repoints one key at another constant breaks"; this run shows
that claim is false, which is the finding Phase 6 §1 row 4 corrects. Restored; `diff` empty.

### Manual verification (browser, 2026-07-30)

Driven against `npm run dev` at `http://localhost:4321`, Chrome. **The browser carried a live
session throughout** (confirmed by `/decks` rendering, a protected route). That is recorded
because it is visible in the screenshots, not because it affects the claim: neither
`signup.ts` nor `signin.ts` branches on the session — both call GoTrue whichever way — so the
mapping under test is session-independent.

| # | Check | Observed |
| --- | --- | --- |
| 1.6 | Empty e-mail on **sign-up** | URL became `/auth/signup?error=Podaj%20adres%20e-mail%20i%20has%C5%82o.` and the red banner read **"Podaj adres e-mail i hasło."** — the new mapping, not the catch-all |
| 1.7 | Empty e-mail on **sign-in** | URL became `/auth/signin?error=Popraw%20dane%20w%20formularzu%20i%20spr%C3%B3buj%20ponownie.`, banner **"Popraw dane w formularzu i spróbuj ponownie."** |

**The asymmetry is accepted, and it is upstream's.** GoTrue answers `anonymous_provider_disabled`
(422) on `/signup` and `validation_failed` (400) on `/token?grant_type=password` for the same
empty address — the measurement recorded in `auth-errors.ts` and in the test file. Both messages
are now true statements about what went wrong, which is the bar; making them identical would
mean overriding an upstream distinction for cosmetic symmetry, and is not done here.

**How the check had to be performed, and it is a finding in its own right.** The ordinary UI
path cannot reach this branch at all: `SignUpForm.validate()` (`SignUpForm.tsx:25-26,51-55`)
sets "Email is required" and calls `e.preventDefault()`, so no request leaves the browser —
observed first, and recorded here as what a user actually sees. The server branch was therefore
reached the way a client that does not run the island reaches it: a native
`HTMLFormElement.prototype.submit.call(form)`, which by specification does **not** fire
`onsubmit` handlers. That is a real, full-page POST to the real endpoint against real GoTrue,
with the real redirect and the real banner render — not a fabricated request.

This is the same class §7 records for `GeneratorForm`'s `maxLength`: a client-side belt in front
of a server branch, so the branch is unreachable through ordinary use and its copy is only ever
met by a caller that bypasses the island. Two consequences worth carrying: the new mapping's
user-visible value on **this** route is smaller than it looks (most users meet the island's
English "Email is required" instead), and the mapping still matters for every non-island caller
and for the `File`-part shape the suite drives. Note the two forms disagree about which language
they answer in — the island's is English, the banner's Polish — which is C10X-19's sweep, not
this change's.

### What Phase 1 does NOT prove

- **Five of the six new codes are INFERENCE, not measurement.** `email_address_not_authorized`,
  `email_provider_disabled`, `captcha_failed`, `conflict` and `request_timeout` cannot be
  produced against this project's local stack, and their `it.each` rows use the same literal as
  the map key — so the suite proves only that the module agrees with itself. A typo'd or renamed
  code is invisible to it **and** to Stryker. The mitigation is an artifact, not prose: all six
  were checked character-for-character against the `ErrorCode` union in
  `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` at auth-js **2.105.3**, and
  that path and version are recorded in the module's reachability record so a future reader
  re-derives rather than trusts this sentence.
- **Only `anonymous_provider_disabled` is proven reachable through a real route.** The other
  five have no endpoint case and cannot have one here.
- **The production-only divergences are inference too** — `user_already_exists` answering 200
  with an obfuscated user when confirmations are on, and `email_address_invalid` appearing to be
  hosted-only. Recorded in the module, unverifiable locally.
- **Nothing about the read side.** `?error=` is still consumed unconstrained by both auth pages;
  that is Phase 3.

---

## Phase 2: Falsifiability and the coverage asymmetry

Driven test-first (`/10x-tdd`), 2026-07-30. **No `src/` change ships in this phase** — the two
production edits below are breakage checks C and D, both restored and both verified restored.
The phase's whole claim is that two assertions became *killable*, so the evidence is not "the
suite is green" (it already was) but **the asymmetry between the same neuter before and after
the test edit**.

### Runs

| # | Command | Result | Detail |
| --- | --- | --- | --- |
| 2.1 | `npm test` | **241 passed / 241, 19 files** | seed `1785440443892`, 2.63 s. Phase 1 left 240; the +1 is the new signup discriminator case. The name-rung edit changes an input, not a count |
| 2.1 | `npx vitest run tests/auth/errors.test.ts` | **51 passed / 51** | seed `1785440423841`. 50 → 51 |
| 2.4 | `npm run lint` | **exit 0** | unchanged: 0 errors, the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts` |

### Breakage check C — delete `AuthRetryableFetchError` from `MESSAGE_BY_NAME`

Run **twice against the same neuter**, which is the only shape that carries this phase's claim.

| Against | Observed |
| --- | --- |
| The test **as it stood** (`status: 503`) | **0 of 50 red — the whole file green.** The production entry was deleted and nothing noticed |
| The test **after the edit** (`status: 0`) | **1 of 50 red**, on `separates a transport failure from a rejected credential, on \`name\` alone` |

```
AssertionError: expected 'Nie udało się dokończyć operacji. Spr…' to be 'Brak połączenia z serwerem uwierzytel…'
  Expected: "Brak połączenia z serwerem uwierzytelniania. Spróbuj ponownie za chwilę."
  Received: "Nie udało się dokończyć operacji. Spróbuj ponownie."
```

The first row is the finding, measured rather than argued: the case titled "on `name` alone"
supplied `status: 503`, and `messageByStatus(503)` returns the *same* constant, so the rung it
names was never observed. The second row is the same run after one input changed. **This
breakage check was impossible before this phase** — that is the deliverable.

`status: 0` is faithful, not contrived, and the source was read rather than trusted:
`@supabase/auth-js/dist/module/lib/fetch.js` constructs this class at three sites — `:26` (the
thrown value is not a Response) and `:112` (the fetch call itself threw, i.e. the ordinary
network failure) pass **0**, while `:30` passes a real status from
`NETWORK_ERROR_CODES [502,503,504,520-524,530]`. Only the `0` form is answerable by the `name`
rung alone. The `status >= 500` rung keeps its own separate input in `falls to status when
neither code nor name is recognised`, so deleting *that* rung stays catchable too: two rungs,
two inputs.

Restored; `git diff -- src/` **empty** and `Get-FileHash` identical to the pristine copy taken
before the first edit (`AF55893205137791A40205EC8BA679394EA5FA1FA81ECF3850D624A8047A4011`).

### Breakage check D — collapse `signup.ts:19` to always `AUTH_VALIDATION_MESSAGE`

**1 of 51 red**, on the new case, while `answers a project-owned redirect when the body is not a
form at all` — the branch that was already covered — stayed **green**. That split is the
coverage asymmetry stated as a measurement.

```
AssertionError: expected 'Popraw dane w formularzu i spróbuj po…' to be 'Nie udało się dokończyć operacji. Spr…'
  Expected: "Nie udało się dokończyć operacji. Spróbuj ponownie."
  Received: "Popraw dane w formularzu i spróbuj ponownie."
```

**What the failure string proves beyond the split**, and it is test-plan §6.10 confirmed by
measurement rather than cited: with the discriminator collapsed the route still answered a
`302`, still to `/auth/signup?`, still carrying an `error=` key. A status assertion would have
passed; `toContain("error=")` would have passed. Only the **equality** on the decoded parameter
went red — which is why this case asserts `toBe(AUTH_GENERIC_MESSAGE)` with
`not.toBe(AUTH_VALIDATION_MESSAGE)` beside it.

Restored; `git diff -- src/` **empty**, hash identical to pristine
(`CBA6DECBEC40795A6BB58C3EB56C57E5CC50737A59841CF69FA3E846574E7C49`).

Neither new case costs GoTrue budget: both return from the `catch` around `formData()`, before
`createClient` (`signup.ts:16-21` vs `:25`). The rate-limit hazard the plan flags is untouched
by this phase.

### What Phase 2 does NOT prove

- **Nothing new about production behaviour.** No `src/` line ships. Both branches under test
  already behaved correctly; what changed is that a regression in either is now visible.
- **`AUTH_UNAVAILABLE_MESSAGE` is still unobserved**, and is now *named* as such at the site a
  reader meets it rather than left to be inferred. Its branch needs `createClient() === null`,
  i.e. a double of `astro:env/server` — §6.9 confines module doubles to one file and admits them
  only for a claim unreachable otherwise. A surviving Stryker mutant on that constant is
  expected, not a gap.
- **The `name` rung is proven only through the pure mapper.** No test drives a real transport
  failure through a route; that would need the fetch seam, which this phase does not open.
- **`isFormContentType`'s own logic** is covered by `tests/lib/forms.test.ts`, not here — this
  case pins that `signup.ts` *consults* it on both branches, not what it decides.
