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

---

## Phase 3: The `?error=` channel, both ends

Driven test-first (`/10x-tdd`), 2026-07-30, commit `f128f9b`. The phase is **mixed** by the
skill's own gate and was run that way deliberately: the membership helper and its cases went
through red→green, while the two `.astro` wirings and the two mount effects were built directly
from the plan's contract — a page frontmatter and an island's JSX have no test layer in this
project (§6.4, §7), so a failing test could not have led them.

### Runs

| # | Command | Result | Detail |
| --- | --- | --- | --- |
| 3.1 | `npx vitest run tests/auth/errors.test.ts` | **55 passed / 55** | seed `1785441701601`. Phase 2 left 51, so **+4**: the member case, the crafted case, the absent/empty case, and the all-constants positive control |
| 3.1 | `npm test` | **245 passed / 245, 19 files** | seed `1785441830476`, 3.14 s; re-run after the breakage restore at seed `1785441952964`, 2.76 s, same count. Phase 2 left 241 — the +4 is entirely this file |
| 3.3 | `npm run lint` | **exit 0** | unchanged: 0 errors, the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts:148-163` |
| 3.3 | `npm run build` | **exit 0** | server build complete in 6.58 s; the same pre-existing `[WARN] [@astrojs/sitemap]` about the missing `site` option |

### RED, before any production edit

**4 of 55 red**, all four on `TypeError: ownedAuthMessage is not a function` — i.e. on the
absence of the code about to be written, not on an assertion. The other 51 stayed green, which
is what shows the new block was added beside the existing claims rather than on top of them.

### Breakage check E — make the helper return its input unchanged

Neuter: the body replaced by `return raw;`.

**2 of 55 red**, and the plan predicted **1**. Recorded as observed:

```
AssertionError: expected 'Twoje konto zostało przejęte. Zadzwoń…' to be null
AssertionError: expected '' to be null
```

The first is the case the plan named. The second is `rejects an absent or empty parameter`,
which the identity function also fails on the empty-string half — the prediction was rounder
than the run, exactly as C10X-29's `missingLocal` neuter and C10X-30's case 8 were. The
conclusion is unchanged.

**What stayed GREEN is the evidence, not the reds.** `returns a project-owned message
unchanged` and the positive control `accepts every constant in the closed set` both passed
under the neuter. That asymmetry is what separates "these cases observe membership" from
"these cases observe a helper that rejects everything" — without the control, `() => null`
would satisfy all three rejection cases and read as perfect protection.

Restored; `git diff --no-index` against the pristine copy taken before the edit **empty**
(exit 0), pristine `MD5 D2624FD3C98F7F06BC481C2F60E93711`, and the file green again at 55/55
(seed `1785441922961`).

### Manual verification (browser, 2026-07-30)

**How these were run, because it is not the ordinary setup.** A dev server was already running
on `:4321` from an earlier session; a second `npm run dev` started for this phase took `:4322`
and **crashed on every render** with `Invalid hook call … more than one copy of React` →
`TypeError: Cannot read properties of null (reading 'useState')` at `SignInForm.tsx:13`. That is
two Astro dev servers competing over one `node_modules/.vite` during dependency
re-optimization — not a defect in this change, and the production `build` is clean. The checks
below therefore ran against the `:4321` instance, which watches the same working tree and had
hot-reloaded these edits (proven by the URL cleanup firing at all — that behaviour did not exist
before this commit). The second server was stopped afterwards; the pre-existing one was left
alone.

The browser carried a live session throughout, visible as the OpenRouter configuration banner
at the top of every screenshot. It does not affect any claim here — both auth pages render the
same way either way — and the banner's own gating is Phase 4's subject, not evidence collected
here.

| # | Check | Observed |
| --- | --- | --- |
| 3.4 | Crafted `?error=` on **sign-in** | `?error=Twoje konto zostało przejęte. Zadzwoń pod 0700-123-456` → **no banner**. Address bar rewritten to a bare `/auth/signin` |
| — | **Positive control**, same page | `?error=Nieprawidłowy e-mail lub hasło.` (a closed-set member) → banner rendered reading exactly that, URL likewise cleaned. Without this, 3.4's empty result would be indistinguishable from a broken page |
| 3.5 | Real failed sign-in | `nobody-c10x34@example.com` + a wrong password submitted through the form → banner **"Nieprawidłowy e-mail lub hasło."**, address bar `http://localhost:4321/auth/signin`, **no `error=`** |
| 3.6 | F5 on that page | **No banner replays**; both fields empty |
| 3.7 | Back / Forward | `/auth/signup` → `/auth/signin?error=<member>` → **one** Back landed on `/auth/signup`; Forward returned to `/auth/signin`. `history.length` stayed **7** across the whole sequence, so the effect added no entry — `replaceState`, not `pushState`. On Forward `bannerShown: false`: the history entry carries the cleaned URL, so a stale error does not resurface that way either |
| — | **Sign-up page mirror** | Crafted value → `bannerShown: false` and `document.body.innerText` does **not** contain `Zadzwoń pod 0700` anywhere on the page; member value `Konto z tym adresem e-mail już istnieje. Zaloguj się.` → rendered verbatim. Both pages are wired, so both were checked |

The banner and `history.length` readings are `javascript_tool` evaluations in the page, not
readings of a screenshot — `history.length` in particular has no visual form, and it is the one
observation that separates `replaceState` from `pushState`.

### What Phase 3 does NOT prove

- **Only the helper is asserted.** That the two pages *call* it, and that the two islands strip
  the parameter, rest entirely on the browser checks above. `.astro` frontmatter is not rendered
  by any layer here (§6.4) and island JSX is unreachable by construction (§7) — the same
  negative space `GeneratorForm`'s `maxLength` and `SessionSizeControl`'s bounds sit in. A
  regression that deletes the `ownedAuthMessage(...)` call from `signin.astro` leaves the suite
  **green**.
- **Nothing observes the URL cleanup automatically.** No assertion anywhere reads
  `window.location`; 3.5–3.7 are one human-driven pass.
- **Other `?error=` consumers are untouched and unprotected.** `decks/index.astro:22`,
  `decks/[publicId]/index.astro:86` and `review.astro:115` still read the parameter
  unconstrained. Their messages come from a different closed set (or from none), so the helper
  does not apply as written — out of scope, and named here rather than left to be inferred from
  a helper that looks general.
- **The helper does not sanitize, and must not be read as doing so.** It admits exact members of
  `AUTH_MESSAGES` and nothing else, so its guarantee is only as good as that set's contents.
  Moot today — React escapes, and the set is 19 hand-written Polish sentences — but a
  constant carrying markup would pass unchanged.
- **The banner's `role`/live-region semantics are still absent.** Phase 5's subject; nothing here
  makes the message announceable.

---

## Phase 4: The banner gate — make the decision testable

Driven test-first (`/10x-tdd`), 2026-07-30. The extraction and its cases went through
red→green; §3's deletion of the dead `isOpenRouterConfigured` export is a mechanical removal
with no observable behaviour, so it was made inline and is carried by the enumerated search
below plus a clean build.

### Runs

| # | Command | Result | Detail |
| --- | --- | --- | --- |
| 4.1 | `npx vitest run tests/lib/config-status.test.ts` | **6 passed / 6** | seed `1785442727428`; the file is new, so all six are this phase's |
| 4.1 | `npm test` | **251 passed / 251, 20 files** | seed `1785442791332`, 2.72 s. Phase 3 left 245 in 19 files — the +6 and the +1 file are entirely this one |
| 4.3 | `grep -rn "isOpenRouterConfigured" --include=*.ts --include=*.tsx --include=*.astro` (excluding `node_modules`, `dist`) | **zero hits**, exit 1 | before the deletion the same search returned exactly one line, `src/lib/openrouter.ts:62` — its own definition. No call site existed to update |
| 4.4 | `npm run lint` | **exit 0** | unchanged: 0 errors, the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts:148-163` |
| 4.4 | `npm run build` | **exit 0** | server built in 5.11 s; the same pre-existing `[WARN] [@astrojs/sitemap]` about the missing `site` option |

### RED, before any production edit

**6 of 6 red**, every one on `TypeError: visibleConfigStatuses is not a function` — the absence
of the code about to be written, not a failed assertion. The function did not exist in any form:
the filter lived inline in `Layout.astro:17` as an expression no layer in this project can
reach.

### Breakage check F — gate the whole block instead of each entry

Neuter: the body replaced by `return hasSession ? entries : [];` — the exact regression the
per-entry design exists to prevent, and the one that is self-hiding in production (an
unconfigured Supabase forces `locals.user = null` on every path, `supabase.ts:6-9` +
`middleware.ts:50,52`, so the banner explaining the breakage would disappear precisely when
Supabase is what broke).

**2 of 6 red**, exactly as predicted, both on the ungated entry in the signed-out state:

```
FAIL  visibleConfigStatuses > shows an ungated entry in both session states
AssertionError: expected [] to deeply equal [ { name: 'Supabase', …(3) } ]

FAIL  visibleConfigStatuses > returns only the ungated entry from a mixed list when signed out
AssertionError: expected [] to deeply equal [ { name: 'Supabase', …(3) } ]
```

**The asymmetry is the evidence, not the reds.** Both `requiresSession: true` cases stayed
green under the neuter — a block-level gate hides a gated entry from an anonymous visitor just
as correctly as a per-entry one does, which is why a suite that only tested the OpenRouter
semantics would have been fully green over this regression. The signed-in positive control
(`shows every entry to a signed-in visitor, whatever its gating`) also stayed green, so the
four survivors are not survivors of a function that returns everything.

Restored from the pristine copy taken before the edit; `md5sum` **`fa58657d13b33ccfddd31cfccd8e9c48`**
before and after, identical, and the file green again at 6/6.

### The parameter is load-bearing, and this is where it is recorded

`missingConfigs` is computed at import time from `astro:env/server` (`config-status.ts:28,37`),
so under the runner it can only ever describe the local stack — Supabase **configured**,
OpenRouter not. A filter closing over that constant would leave the one entry whose gating
matters most (an *un*configured Supabase) unreachable by any test, and breakage check F above
would have had nothing to go red on. Every entry in the test file is therefore fabricated; the
real constant appears in no assertion.

### Manual verification (browser, 2026-07-31)

Run against the dev server already listening on `:4321` (the same instance Phase 3 used, and for
the same reason — a second `npm run dev` competes with it over `node_modules/.vite`). Readings
are `javascript_tool` evaluations in the page plus two screenshots; the banner's presence is
tested on the served HTML (`OpenRouter nie jest skonfigurowany` / `Supabase nie jest
skonfigurowany`), not by eye.

| # | Check | Observed |
| --- | --- | --- |
| 4.6 | Signed in, `OPENROUTER_API_KEY` unset | Session `manual-c10x30@example.com`; `/` redirected to `/decks` and the page carried **"Uwaga: OpenRouter nie jest skonfigurowany — generacja fiszek działa w trybie mock (przykładowe karty). Zobacz dokumentację OpenRouter."** — one banner, at the top of a protected page |
| 4.5 | Signed out, same key state | After "Wyloguj": no `sb-` cookie, `/` served the guest landing. `/`, `/auth/signin`, `/auth/signup` all **200 with no `Uwaga:` substring at all** — not merely no OpenRouter entry, no banner element. Screenshot of `/auth/signin` shows the page with no banner strip, against 4.6's pink strip |
| 4.7 | `SUPABASE_URL`/`SUPABASE_KEY` commented out, signed out | `/auth/signin` served **"Uwaga: Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone."** while the OpenRouter entry stayed **absent from the same response** — the per-entry gate visible in one render rather than across two |
| 4.7 | **Independent oracle** that the env change reached the server | `POST /api/auth/signin` answered a redirect to `/auth/signin?error=Uwierzytelnianie%20jest%20chwilowo%20niedost%C4%99pne.%20Spr%C3%B3buj%20ponownie%20p%C3%B3%C5%BAniej.` — i.e. `createClient()` genuinely returned `null`. Without this, "the banner appeared" and "the server never reloaded `.env`" would be told apart by nothing |
| 4.7 | Restore | `.env` copied back from the pristine copy taken before the edit: `diff` **empty** (exit 0), `md5` **`d9ddbf2e05c76862c41808617bfcbaa5`** identical to pristine, zero `TMP-C10X34` markers left. The running server picked the restore up as well — `/auth/signin` and `/` back to **no `Uwaga:` at all** |

**A trap worth recording, because it cost a false reading here.** The first 4.5 probe fetched
`/auth/signin` while the browser still carried the session, and the OpenRouter banner was
present — which looks like the gate failing on an auth page. It is not: the gate keys on the
**session**, not on the path, so a signed-in visitor sitting on `/auth/signin` is shown the
gated entry correctly. A signed-out check has to actually be signed out; `fetch` from a page
sends the cookie.

**Incidental, and it changes no claim.** 4.7's oracle is the first time
`AUTH_UNAVAILABLE_MESSAGE` has been observed end to end — the plan names it as deliberate
negative space (Phase 2 §3), and it stays that: seen once by hand, asserted nowhere.

### What Phase 4 does NOT prove

- **Only the decision is asserted.** That `Layout.astro` *calls* `visibleConfigStatuses`, that it
  passes `Boolean(Astro.locals.user)` rather than something else, and that `Banner.astro` renders
  what comes back, rest on the manual checks below — the same `.astro` negative space as Phase 3
  (§6.4, §7). A regression restoring an inline filter in the layout leaves the suite green.
- **Nothing tests `configured` itself.** The `Boolean(SUPABASE_URL && SUPABASE_KEY)` /
  `Boolean(OPENROUTER_API_KEY)` reads are import-time env access, i.e. the seam §6.9 confines to
  one file; `missingConfigs`'s own contents are unasserted by decision.
- **`requiresSession: false` on the Supabase entry is a data claim, not a tested one.** The
  function honours whatever flag an entry carries; that Supabase's entry carries `false` is
  pinned by its own doc comment and by manual check 4.7, not by an assertion.
- **The deletion of `isOpenRouterConfigured` is carried by search and build**, not by a test —
  it had no callers, so no behaviour changed and none could be observed.
