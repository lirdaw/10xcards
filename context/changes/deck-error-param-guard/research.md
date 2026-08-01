---
date: 2026-08-01T20:45:45+02:00
researcher: lirdaw
git_commit: 6ae879d1a88320f0cab2326ccffd4a7ade437e22
branch: main
repository: 10xcards (My10xCards_v2)
topic: "Adversarial audit of the ?error= read-side guard on the deck pages (C10X-40) — is it done, and is it done well?"
tags: [research, codebase, security, content-injection, redirect-errors, deck-pages, C10X-40, C10X-37]
status: complete
last_updated: 2026-08-01
last_updated_by: lirdaw
---

# Research: Audit of the `?error=` deck-page guard (C10X-40)

**Date**: 2026-08-01T20:45:45+02:00
**Researcher**: lirdaw
**Git Commit**: `6ae879d1a88320f0cab2326ccffd4a7ade437e22`
**Branch**: `main`
**Repository**: `lirdaw/10xcards`

## Research Question

C10X-40 (`deck-error-param-guard`) appears to be largely delivered already, under a foreign
key (C10X-37 / `deck-form-hardening`). Verify that claim adversarially rather than trusting it,
and additionally establish whether **everything associated with the ticket** has been handled,
and handled **well**.

## Summary

**The substantive scope of C10X-40 is delivered, and delivered above what the originating
finding asked for.** The security property the ticket exists to establish — a crafted
`?error=` link cannot render attacker-chosen text inside this project's red banner — holds, and
was verified here by measurement rather than by reading the record:

- **Read side**: all **5** `?error=` reads in `src/pages/` are wrapped (3 × `ownedRedirectMessage`,
  2 × `ownedAuthMessage`); **zero** raw reads anywhere in `src/`. No island ever calls `.get()` on
  a query parameter, so the server-side vouching cannot be routed around.
- **Producer side**: an independent enumeration of every `?error=` redirect in all of `src/pages/`
  gives **11 distinct strings against 11 declared members — an empty diff in both directions**.
  No inline literal, no computed value, no upstream string reaches any redirect URL. Exactly one
  `catch` in the whole of `src/pages/api/` binds an exception variable, and its value goes to a DB
  column only.
- **Tests**: **43 cases across the five files**, confirmed by running them, not by counting `it(`.
  `redirect-errors.test.ts` is textbook — equality with both the containment attack and the
  truncation mirror, a whole-set positive control that kills `() => null`, a no-empty-constant
  scan, templates interpolated from the live bounds, and a size + distinctness pin.
- **Tree state**: suite **333/333, 29 files green**; `tsc --noEmit` 0; `lint` 0 errors.

So there is **no implementation work outstanding on F1's own terms**. What the audit did find
splits into three groups, and only the first is genuinely this ticket's:

1. **Bookkeeping that is still open** — C10X-40 itself is unclosed in Jira while its work is
   already archived, and **`test-plan.md` states in four places that the read-side fix "never got
   a key"**, a claim the same change's own Phase 6 measured and refuted. A reader of `test-plan.md`
   today concludes C10X-40 does not exist. Plus one wrong arithmetic (`+1` should be `+3`,
   measured), one wording the same change's read-back already rescoped, one dead evidence path,
   and **no roadmap row at all** for `deck-form-hardening`.
2. **Durability gaps in the guards themselves** — the guards are strong at what they inspect, but
   several are keyed on a *token* or a *variable name* rather than on the construct, so ordinary
   refactors disarm them silently while all 43 tests stay green. The most consequential:
   **the closed set is enforced at almost no producer**, because ~20 of the ~29 emissions go
   through an `errorUrl(...)` helper whose call sites contain no `error=` text for the detector to
   match. None of these is a live security hole — the read-side guard holds regardless — but the
   failure mode is exactly the silent one the module's own docblock warns about.
3. **Adjacent instances of the same class, out of C10X-40's stated scope** — chiefly `?q=`, the
   one query parameter whose raw value **is** reflected as page text, unvouched and unbounded.

## Detailed Findings

### 1. Read side — verified complete

Every `?error=` read in `src/`, measured with `grep -rn 'searchParams.get("error")' src/`:

| file:line | helper | verdict |
| --- | --- | --- |
| `src/pages/decks/index.astro:27` | `ownedRedirectMessage` | wrapped |
| `src/pages/decks/[publicId]/index.astro:94` | `ownedRedirectMessage` | wrapped |
| `src/pages/decks/[publicId]/review.astro:119` | `ownedRedirectMessage` | wrapped |
| `src/pages/auth/signin.astro:8` | `ownedAuthMessage` | wrapped |
| `src/pages/auth/signup.astro:8` | `ownedAuthMessage` | wrapped |

The **four sinks from one read** on `decks/[publicId]/index.astro` are confirmed: `bannerError`
(`:102` → the raw `.astro` banner at `:168-172`), rename modal (`:153`), create-card modal
(`:180`), inline edit (`:182`) — all descend from `:94`, and no second read of `error` exists on
the page (the other `error` identifiers at `:26`, `:54`, `:75` are destructured query results).

`src/components/auth/ServerError.tsx:7-8` returns `null` for a falsy message, so the guards'
rejection value genuinely degrades to **no banner**. `role="alert"` is present (`:44-45`).
Enumerated call sites: **13 JSX usages across 12 files** — matching the count in the component's
own comment.

Five islands seed `React.useState(serverError)` at first render (`CreateDeckModal.tsx:29`,
`DeckActions.tsx:30`, `CreateFlashcardModal.tsx:42`, `FlashcardItem.tsx:75`,
`CandidateItem.tsx:90`), which is *why* the guard must live at the page read: the value is
captured before `history.replaceState` strips the parameter.

**Bypass check, the one that would have mattered**: `grep -rn "searchParams.get\|location.search\|useSearchParams" src/components/ src/layouts/` returns **nothing**. Every island's URL touch is `.has()` + `.delete()` only.

### 2. Producer side — the closed set is genuinely closed

The "first step" F1 named and the C10X-34 review never took was done, and was re-done
independently here across **all** of `src/pages/` (not just `api/decks/`).

- **27+ redirects carrying `error=`** on the deck surface, spread over the six form endpoints.
  **Every one is an imported constant.** The only computed selections are two ternaries
  (`decks/index.ts:73`, `decks/[publicId].ts:75`) whose operands are both set members;
  `error.code` is consumed as a boolean discriminator and discarded.
- **`REDIRECT_MESSAGES` diff**: all 11 members have at least one live producer; no producer emits
  a non-member. Empty in both directions.
- **Upstream strings**: exactly **one** `catch` in all of `src/pages/api/` binds an exception
  (`generate.ts:270`), and its `err.message` reaches `error_message` (a DB column) only — that
  endpoint answers JSON and never redirects. Every other catch is a bare `} catch {`, so there is
  structurally no exception in scope to interpolate. No Zod `.issues`/`.format()`/`.flatten()`
  anywhere.
- **The two template members** (`CARD_FRONT_MESSAGE`, `CARD_BACK_MESSAGE`) are imported constants,
  not duplicated literals, and both producing endpoints import `FRONT_MAX`/`BACK_MAX` from the same
  module the templates interpolate from — so a bound change cannot desynchronise the message from
  the comparison.
- **`[cardPublicId].ts:50-51`** looks like a missing `encodeURIComponent` on a grep; it encodes one
  line above. Not a defect.

### 3. Tests — 43 cases, strong where they look, blind in named places

Runtime counts (measured, `describe.each`/`it.each` expanded):

| file | cases |
| --- | --- |
| `tests/lib/redirect-errors.test.ts` | 7 |
| `tests/lib/error-param-guard.test.ts` | 10 |
| `tests/lib/no-client-redirect-errors.test.ts` | 3 |
| `tests/lib/form-endpoint-guards.test.ts` | 7 |
| `tests/validation/decks.test.ts` | 16 |
| **total** | **43** |

**What holds up.** `redirect-errors.test.ts` has no unfalsifiable assertion: membership by equality
with the containment attack (`:34`) *and* the truncation mirror (`:35`); the whole-set positive
control (`:50-55`) guarded by a non-empty check so it cannot pass vacuously; the size + distinctness
pin (`:92-95`). All four guard files carry **both** halves of the control — walker reach *and*
detector-fires-on-the-regression. `tests/validation/decks.test.ts` follows §6.10 exactly: oracle
first, `errorParam(...)` by equality in all 13 uses, no-echo on the **raw** `Location` before
decoding, boundary controls asserting length **and** equality, and `countDecksNamed` is a raw
`count: "exact"` with only a `.like()` — no state- or status-filtered count anywhere.

**Where they are blind** (none is a live hole; each is a silent-regression path):

- **G1 — the closed set is enforced at almost no producer.** `form-endpoint-guards.test.ts:43`
  fires only on a quoted literal syntactically adjacent to the text `error=`. But ~20 of the ~29
  emissions go through an `errorUrl(msg)` helper, and those call sites contain no `error=` text at
  all. `return context.redirect(errorUrl("Nowy komunikat"))` passes all 43 tests. The companion
  case at `:164` only checks the file *imports* the module somewhere — all 7 do. Failure mode:
  `ownedRedirectMessage` cannot vouch → banner silently stops appearing.
- **G2 — nothing forbids `errorUrl(err.message)`.** test-plan §6.6 cites a **grep** as the evidence
  that no upstream string reaches a redirect branch; that grep was never turned into a test. The
  injection class stays closed (the read guard rejects non-members), but a private/upstream string
  in a URL, browser history and access log is Risk #4's *leak* half.
- **G3 — `RAW_READ` is keyed on the literal token `searchParams`** (`error-param-guard.test.ts:47`).
  `const params = Astro.url.searchParams; const error = params.get("error");` produces **zero
  findings**. Not exotic: `[publicId]/index.astro` reads five params and `review.astro` five, so
  hoisting that binding is the natural tidy-up — and it disarms the guard on both pages at once.
- **G4 — the catch-all is rooted at `src/pages`** (`:169`). Seven `.astro` files live outside it
  (`src/layouts/Layout.astro`, `AuthenticatedLayout.astro`, `src/components/{Banner,Sidebar,Topbar,Welcome}.astro`,
  `ui/LibBadge.astro`). `Astro.url` works in any of them, and a raw read in `Layout.astro` would
  put an attacker-controlled banner on **every page**. Latent today (verified: no such read exists),
  but it is verbatim the class the catch-all's own comment says it exists to close, one directory up.
- **G5 — the registered-surface exclusion is a prefix match with no separator** (`:171`). Simulated:
  `src/pages/decks-archive/x.astro` is **excluded** from the catch-all *and* never reached by the
  per-surface walk. Neither scanned nor reported.
- **G6 — the `formString` sweep is keyed on the variable name `form`** (`form-endpoint-guards.test.ts:39`).
  Renaming the local to `fd` exempts that endpoint from the narrowing check while the reader count
  and the `try {` check both stay green — so the `File`-part `.trim()` crash can return under a
  rename with the suite green.
- **G8 — two CREATE cases carry a run-unique marker and do not count.** `decks.test.ts:258`
  (`json-body-${suffix}`) and `:289` (`file-part-${suffix}`) both carry a marker, while the file
  header (`:44-51`) claims blanket that these cases have "no name to carry a marker". A regression
  that parsed the JSON body leniently, or read the `File`'s text, would write a deck named exactly
  that and nothing counts. The header's over-broad claim is what would tell a future contributor not
  to look.

### 4. Adjacent findings — same class, outside C10X-40's scope

- **`?q=` is the only query parameter whose raw value is rendered as text — and it is NOT the same
  vector.** `decks/[publicId]/index.astro:41` reads it with only `.trim()`;
  `FlashcardWorkspace.tsx:207` renders `Brak fiszek pasujących do „{query}".` and
  `DeckContentToolbar.tsx:42` puts it in `defaultValue`. React escapes it, so not XSS.

  > **Corrected after this section was first written.** It read "same class, weaker surface", and
  > that is too generous to the threat. The reflection exists **only** on `/decks/<publicId>`, and
  > that page answers a hard **404** when the deck does not exist or RLS hides someone else's
  > (`[publicId]/index.astro:20-34`, deliberately 404 and never 403). So an attacker would need the
  > **UUID of the victim's own deck** — a secret they do not have and cannot guess. The `?error=`
  > vector needed only `/decks`, an address everyone knows. That is a qualitative difference, not a
  > matter of degree, and it changes the recommendation: `?q=` does not warrant a vouching set.
  >
  > What survives the correction is unremarkable and real: the value was **unbounded** in both the
  > reflection and the search-RPC argument, and unlike `error` it is **deliberately not stripped**
  > from the URL (`:38-40`), so it survives reload. Closed as hygiene by `QUERY_MAX` +
  > `searchQuery()` in `src/lib/deck-limits.ts`, with the reasoning recorded there so the audit is
  > not repeated. **The clamp is not a security control and the module says so.**
- **A real "owned message renders nowhere" path.** `cards/[cardPublicId].ts:49-52` catches a
  `formData()` failure *before* it reads `from`, so a broken body posted from the **review** screen
  redirects to the **deck view** carrying `edit=<id>`. On the deck view `bannerError` is suppressed
  when `editId` is truthy (`[publicId]/index.astro:102`), and `listFlashcards` filters
  `state_id = STATE_ACCEPTED` (`flashcards.ts:88`) — so for a `generated`/`rejected` card no
  `FlashcardItem` matches and the message renders nowhere. The message is a valid set member, so
  the guard is not at fault; the ordering is documented as deliberate at `:41-45`, but this
  consequence is not. Narrow (crafted or aborted multipart body only), UX not security.
- **`batch.ts:101`** inlines `"Nie udało się zapisać zmian"`, a verbatim copy of
  `CARD_SAVE_FAILED_MESSAGE`, while importing `SUPABASE_UNCONFIGURED_MESSAGE` from the same module.
  JSON channel, so the closed set is untouched — but `redirect-errors.ts:86-88`'s accounting of
  which strings the JSON endpoints reuse is therefore incomplete, and
  `CandidateReviewWorkspace.tsx:117` already carries a **diverged** copy with a trailing period.
- **`decks/[publicId]/index.astro:17`** does not UUID-gate `Astro.params.publicId`, unlike
  `review.astro:27-28` and `study/[publicId].astro:14-15`. Never rendered, so no injection surface —
  but a malformed id reaches Postgres as an invalid uuid and produces the 500 branch rather than the
  404 the page's own comment says a bogus URL deserves.
- **`review.astro` has no page-level banner sink** — `error` is consumed only behind
  `editId ? … : null` (`:219`). **Checked and NOT live**: the only producer that can target
  `/review` (`cards/[cardPublicId].ts:63-64`) always appends `&edit=`, so the gate is never starved
  of a real message. A future producer redirecting there without the companion parameter would
  create the hole.

### 5. The paper trail — scope delivered, bookkeeping open

The scope decision is recorded in three places before anyone could stumble on it
(`change.md:14-26`, `plan.md:8-12`, `plan-brief.md:48`), and every clause of C10X-34's F1 maps to
delivered work — including the "first step" (enumeration → eleven literals, closed by construction)
and a sink F1 never saw (the raw `.astro` banner with no `role="alert"` and no companion parameter,
which no change to `ServerError.tsx` could have covered).

What is **open**:

| # | Item | Evidence |
| --- | --- | --- |
| 1 | **C10X-40 is unclosed in Jira while its work is archived** — currently `W toku`, `customfield_10041 = deck-error-param-guard`, one comment from 09:12 recording the C10X-37 delivery and leaving it "in triage for a conscious decision" | Jira C10X-40; `jira-map.md:216-219` |
| 2 | **C10X-37's `Change ID` is map-side only** — `customfield_10041` unset in Jira | `jira-map.md:61`, `:196-203` |
| 3 | The closing instruction points at the **pre-archive** path | `jira-map.md:217` vs `context/archive/2026-07-31-deck-form-hardening/` |
| 4 | **`test-plan.md` says in four places that the read-side fix "never got a key"** — refuted by the same change's own Phase 6 and by `jira-map.md:65`. A reader concludes C10X-40 does not exist | `test-plan.md:43-44`, `:1992`, `:2108`, `:3191` |
| 5 | **`+1` in `signed-out.test.ts` should be `+3`** — measured at **12** runtime cases; the entry's own arithmetic (3+7+2+1+1 = 14) does not reach its declared 298 → 314 (= 16) | `test-plan.md:3307` |
| 6 | §8 carries the wording the same change's read-back already rescoped (`JSON.stringify` / "any deck-route branch" → "the redirect branches") | `test-plan.md:3190-3191` vs `verification.md:557` |
| 7 | Dead evidence path in the header (`context/changes/…` instead of `context/archive/…`) — a systemic class, eight such in the header block | `test-plan.md:70` |
| 8 | **`roadmap.md` has no row for `deck-form-hardening`** (nor for `local-stack-transport-flake`) — `grep` returns **0** hits for either change-id or for C10X-37/39/40. An archived change left no trace in `## Done`, the mirror of the H-04 situation that had to be backfilled | `roadmap.md` |
| 9 | Not this ticket, found in passing: the suite is **333/333**, not the documented 332 — `tests/lib/kong-keepalive.test.ts` carries 19 cases against a recorded `+18` | `test-plan.md:36`, `:3375`; measured run |

## Code References

- `src/lib/redirect-errors.ts:97-123` — the 11-member closed set and `ownedRedirectMessage`
- `src/pages/decks/index.astro:27`, `src/pages/decks/[publicId]/index.astro:94`, `src/pages/decks/[publicId]/review.astro:119` — the three wrapped reads
- `src/pages/decks/[publicId]/index.astro:102` — `bannerError`, the derivation feeding the raw `.astro` banner at `:168-172`
- `src/components/auth/ServerError.tsx:7-8` — `if (!message) return null;`, what makes rejection mean "no banner"
- `src/pages/api/decks/index.ts:73-74`, `src/pages/api/decks/[publicId].ts:75-76` — the only computed selections, both over set members
- `src/pages/api/generate.ts:270-284` — the single exception-binding catch; `err.message` reaches a DB column only
- `src/pages/api/decks/[publicId]/cards/[cardPublicId].ts:46-52` — the catch whose fallback target creates the "renders nowhere" path
- `tests/lib/error-param-guard.test.ts:47` — `RAW_READ`, keyed on the literal token `searchParams` (G3)
- `tests/lib/error-param-guard.test.ts:169-171` — catch-all root and the separator-less prefix match (G4, G5)
- `tests/lib/form-endpoint-guards.test.ts:39,43` — `FORM_GET` keyed on the name `form` (G6); `INLINE_ERROR_LITERAL` blind to `errorUrl(...)` (G1)
- `tests/validation/decks.test.ts:44-51,258,289` — the header's blanket "no marker" claim vs the two cases that do carry one (G8)
- `src/pages/decks/[publicId]/index.astro:41` + `src/components/flashcards/FlashcardWorkspace.tsx:207` — the `?q=` reflection

## Architecture Insights

- **Two closed sets side by side, deliberately.** `AUTH_MESSAGES` is a *mapper's* output vocabulary;
  `REDIRECT_MESSAGES` only vouches for a value travelling through a URL. Merging them would give
  each surface the other's vocabulary. The page guard's per-surface table exists precisely so a deck
  page wrapped in `ownedAuthMessage` is rejected as lexically-a-wrap-but-wrong-vocabulary.
- **The pattern that keeps recurring in this repo, and recurs again here**: a rule enforced by a
  guard that inspects a *spelling* rather than a *construct*. `no-logging`, `no-env-access`,
  `error-param-guard`, `form-endpoint-guards` are all textual by necessity (no DOM layer, `.astro`
  frontmatter unreachable), and each buys real protection — but G1/G3/G6 are the same shape as the
  sweeps this project has already had to fix three times: correct on what they look at, silent about
  what they never look at.
- **Fail-safe, and therefore silent.** Every failure mode found here (a producer emitting a
  non-member, a message routed to a page that suppresses it) degrades to *no banner*, never to an
  error. That is the right default and it is why the producer-side enforcement gap matters more than
  its severity suggests: nothing will ever go red.

## Historical Context (from prior changes)

- `context/archive/2026-07-30-auth-error-copy/reviews/impl-review.md` (F1) and
  `follow-ups/review-fixes.md:6-26` — the origin of this ticket, including the "first step" nobody
  had taken
- `context/archive/2026-07-31-deck-form-hardening/change.md:14-26` — the scope decision putting
  C10X-40's work under C10X-37's key
- `context/archive/2026-07-31-deck-form-hardening/reviews/impl-review.md` — 9 findings, 8 fixed
  in-session, 1 accepted (F9: the Jira bookkeeping that is item 1-2 above)
- `context/archive/2026-07-31-deck-form-hardening/verification.md:517-525,557` — the Phase 6
  read-back that refuted the "no key" claim and rescoped the `JSON.stringify` wording; both
  corrections reached `change.md` and `jira-map.md` but **not** `test-plan.md`
- `context/foundation/jira-map.md:204-219` — the note recording that this map, not a review's
  follow-up note, is the source of truth about a deferred finding's key

## Related Research

- `context/archive/2026-07-31-deck-form-hardening/research.md:73-85` — the original enumeration
  closing F1's two blind spots
- `context/foundation/test-plan.md` §6.10 — the redirect-style endpoint cookbook the deck tests
  follow
- `context/foundation/lessons.md` — "Odmowa wyrażona redirectem potrzebuje orakla wierszowego…"
  (the rule `decks.test.ts` implements)

## Outcome — what was executed from this research (2026-08-01)

All four groups were carried out on branch `C10X-40-deck-error-param-guard`, in the order below
rather than the order they are listed above: **the code went first**, because the bookkeeping
group contains test counts, and writing those before adding tests would have reproduced the exact
defect being fixed.

| # | Group | What landed | Falsified by |
| --- | --- | --- | --- |
| 2 | Producers (G1, G2) | `form-endpoint-guards.test.ts` resolves every value entering the channel — a bare identifier that is either a set member or a local built from one. Rejects literals and `err.message`/`String(err)` by demanding POSITIVE evidence rather than blacklisting spellings | `errorUrl("Talia jest zablokowana")` and `errorUrl(String(err))` → 1 of 10 red each, **while the old `INLINE_ERROR_LITERAL` case stayed green** |
| 3 | Read side (G3, G4, G5, G6, G8) | `RAW_READ`/`wrappedRead` widened to any receiver; catch-all re-rooted at `src/`; registered-surface prefix given a separator plus its own control; `formData` receiver derived from the assignment; the two CREATE cases that carry a marker given count oracles | hoisted `params.get("error")` → 1 red; raw read in `Layout.astro` → 1 red; full receiver rename → 1 red; `File`-part text read → red on `expected 1 to be +0` |
| 4 | `?q=` | `QUERY_MAX` + `searchQuery()` in `deck-limits.ts`, mirrored by `maxLength` on the input, with the "why this is NOT a security control" reasoning recorded at the site; `tests/lib/deck-limits.test.ts` | clamp removed → 1 red; clamp-before-trim → 1 red |
| 1 | Bookkeeping | four "never got a key" statements corrected, `+1`→`+3`, `332/+18`→`333/+19`, the `JSON.stringify` wording rescoped, the dead evidence path repointed, a new header + §8 entry; roadmap H-07/H-08 backfilled per the H-04 precedent and H-09 opened; `jira-map.md` row and note corrected | — (documents) |

Suite **342/342, 30 files**; `tsc` 0, `lint` 0 errors, `build` 0; `git diff -- src/` empty after
every breakage restore, each verified by `md5sum`.

**Deliberately NOT done here, and it is a boundary rather than an omission**: the two Jira writes.
`customfield_10041` on **C10X-37** is still map-side only, and **C10X-40** is not transitioned.
This repo assigns Jira writes to `/jira-finish-work` (`jira-map.md`: "`/10x-implement` nie pisze do
Jiry"), and honouring that boundary is worth more than closing two fields early.

## Open Questions

1. **Is `?q=` in scope for this ticket or its own?** It is the same class (unvouched attacker text
   reflected on an authenticated page) on a lower-trust surface, and it is the only remaining one.
   A cheap answer is a length cap plus moving the phrase out of a full sentence; the expensive one
   is treating search input like the error channel.
2. **Should the producer side be enforced rather than grepped?** G1 + G2 are the two claims
   `test-plan.md` carries as evidence-by-grep. Making them falsifiable means resolving
   `errorUrl(X)` arguments to identifiers imported from the closed set.
3. **How far should the textual guards' scope widen** — re-root at `src/` (G4), fix the separator
   (G5), key on the receiver instead of the token/name (G3, G6)? Each is small; together they are
   the difference between "the sweep is complete" and "the sweep is complete where it looks".
4. **Does the `test-plan.md` correction belong to this ticket?** Four sentences there actively tell
   a reader C10X-40 was never ticketed. The precedent in this repo is that an archived artifact
   takes a dated correction line and a live document is corrected in place — but nobody owns the
   live document's correction yet.
5. **Roadmap rows for two archived changes** (`deck-form-hardening`, `local-stack-transport-flake`)
   are missing entirely. Backfill, or accept that not every change gets a roadmap slice?
