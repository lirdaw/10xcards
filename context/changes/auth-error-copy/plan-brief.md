# Auth Error Copy — Plan Brief

> Full plan: `context/changes/auth-error-copy/plan.md`
> Research: `context/changes/auth-error-copy/research.md`

## What & Why

H-03's scope — the auth error mapper and the per-entry OpenRouter banner gate — **already shipped**
under a foreign ticket key (C10X-28, as Phase 1 and Phase 4 §1 of `ai-candidate-generation-test-2`).
Work done as a side quest is where unfinished edges hide, and research found nine actionable ones.
This change audits and closes them: it does not rebuild anything.

## Starting Point

The security invariant holds and is well built — `authErrorMessage` never interpolates input into
output, every return is a module constant, and the `Object.hasOwn` guard closes the prototype hole.
What is open: the mapper's table was written from a type union rather than from these two
endpoints' measured surface, one test observes a rung other than the one it names, the closed set
`AUTH_MESSAGES` is enforced only where messages are produced, the banner gate has **zero**
automated coverage, and five comments in the shipped test file state things the code contradicts.

## Desired End State

A failed sign-in or sign-up produces a Polish sentence that is **true** — including where a retry
cannot help, which is where today's catch-all lies. The `?error=` channel carries only project copy
in both directions: produced from the closed set, refused on read if not in it, and cleared from
the URL on mount. The banner gate's decision is a pure function with tests, so the self-hiding
"gate the block, not the entry" regression is catchable. The error surface announces itself to a
screen reader. No file in `src/` reads `import.meta.env`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Read-side `?error=` check (R13) | In scope | C10X-34 owns this channel end to end; the closed set already exists and is exported, so the check is a few lines | Plan |
| Banner gate coverage (R10) | Extract filter, unit-test it | The C10X-27 pattern — pull the decision out of an unrenderable surface rather than open a page-rendering layer §4 does not have | Plan |
| Unmapped GoTrue codes (R2/R3) | Map all five | The mapper stops being written from a type union and starts from these endpoints' real surface; "spróbuj ponownie" on a non-retryable failure is the worst possible copy | Plan |
| `import.meta.env` (R15) | Delete the branch, one honest copy | Removes the rule violation *and* the wrong heuristic (DEV ≠ confirmations off) without adding a config value that can itself drift from GoTrue | Plan |
| a11y (R16) | Announce + associate + autocomplete | Full PRD baseline for this surface; each is one attribute on an existing element | Plan |
| URL cleanup (R14) | In scope | `lessons.md:89-94` records the rule and four other islands follow it; auth follows none | Plan |
| `AUTH_UNAVAILABLE_MESSAGE` test | None — named negative space | Its branch needs an `astro:env/server` double, and §6.9 admits one only for a claim unreachable otherwise | Plan |
| `confirm-email` copy language | English | Matches the page it lives in; the whole auth UI is English and C10X-19 owns that sweep | Plan |
| Roadmap H-03 status | Left to `/10x-archive` | This change carries the id `auth-error-copy`, which `roadmap.md:248` names — so archiving matches the row and flips it, reversing C10X-28 impl-review F3 | Research (R17) |

## Scope

**In scope:** six new code mappings incl. reviving a dead constant; the falsifiability fix and
signup's untested branch; read-side membership check + URL cleanup; extracting and testing the
banner filter; deleting a dead export; `role="alert"` / `aria-invalid` / `aria-describedby` /
`autocomplete`; removing the `import.meta.env` branch; five comment corrections, cross-ticket
pointer rot, and the test-plan entry.

**Out of scope:** rebuilding the mapper or the gate (both correct on `main`); auth **input**
validation (**C10X-36**); the English→Polish UI sweep (**C10X-19**); the two deck endpoints'
unguarded `formData()` (**C10X-37** — only the false comment about them is corrected);
rendering `Layout.astro` through the Container API.

## Architecture / Approach

Three code surfaces, each independently verifiable. **The mapper** gains table entries and a
reachability record — no control-flow change to either route. **The `?error=` channel** gets its
missing second end: a pure helper beside the closed set it enforces, called by both `.astro`
pages, plus a mount effect stripping the parameter. **The banner gate** has its filter lifted from
`Layout.astro` into a pure function that takes the entry list *as a parameter* — without that, the
one entry whose gating matters (Supabase, never gated) is untestable, because `missingConfigs` is
computed at import time from `astro:env/server`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. Baseline | Clean green suite before the first edit | Research's live GoTrue probes shared the rate-limit budget; a stale baseline gives a later red two hypotheses |
| 1. Mapper | Six code mappings; the dead constant revived | Fixing R1 **turns an existing test red by design** — map entry and assertion must move in one commit |
| 2. Falsifiability | The `name` rung observable; signup's untested branch | The breakage check for this phase was *impossible* before it |
| 3. `?error=` channel | Read-side check + URL cleanup | Stripping the parameter must not clear the banner (prop is captured before the effect) |
| 4. Banner gate | Pure filter + tests; dead export removed | Refactoring a file that works today, with no bug to anchor it |
| 5. Auth surface | a11y attributes; `import.meta.env` gone | `FormField` is shared by both forms — visual regression needs a side-by-side check |
| 6. Docs & verification | Comments, pointers, test-plan, Stryker | Pointer rot must not be reintroduced by the document that ends it |

**Prerequisites:** local Supabase stack running, `OPENROUTER_API_KEY` unset, a browser for the
manual checks, and a `.env` backup before Phase 4's Supabase-unset check.
**Estimated effort:** ~2–3 sessions across 7 phases; the code is small, the verification is not.

## Open Risks & Assumptions

- **Several new mappings cannot be verified locally.** `email_address_not_authorized` needs
  built-in Supabase SMTP with confirmations on; `email_address_invalid` appears hosted-only. Those
  entries go in as documented inference, marked as such in both the module and the test-plan entry
  — never recorded as measurement.
- **The two routes answer different upstream codes for the same empty e-mail** (`validation_failed`
  vs `anonymous_provider_disabled`), so their copy differs after Phase 1. That is upstream's
  choice; it is recorded rather than smoothed over.
- **`role="alert"` on content present at mount** (after a full-page redirect, not inserted
  dynamically) has screen-reader-dependent announcement behaviour. Standard approach, not a
  guarantee — which is why Phase 5 carries a manual check rather than a claim.
- **`ServerError` is not an auth-only component and the edit is taken shared, deliberately**
  (plan-review F2): eight other components render it at eleven call sites, all *dynamically*, so
  the attribute is more correct off this surface than on it. Scope settled before the build, per
  lessons.md's "poleruj tylko własne komponenty slice'a"; Phase 5 gains a manual check on one
  dynamic site and Phase 6 records the eleven sites.
- **The GoTrue rate limit fails misleadingly**: 30 requests / 5 min / IP, and once it bites every
  equality assertion in `errors.test.ts` fails and reads as a validation regression.

## Success Criteria (Summary)

- A user who leaves the e-mail field blank is told to fill it, not told to "try again"; a user who
  hits a non-retryable failure is not told to retry.
- A crafted `/auth/signin?error=…` link renders no banner, and a real error disappears from the
  address bar once read.
- Both H-03 deliverables have falsifiable coverage: every new claim shown red by a recorded
  deliberate-breakage run, including the banner gate's self-hiding invariant, which had none.
