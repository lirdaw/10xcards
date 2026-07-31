---
date: 2026-07-31T19:57:44+02:00
researcher: lirdaw
git_commit: 465832e0de1e8a31df654cd65f41835c03253307
branch: main
repository: lirdaw/10xcards
topic: "Harden formData() on the two deck endpoints and close the ?error= read side on the deck surface"
tags: [research, codebase, decks, form-endpoints, input-validation, content-injection, risk-6]
status: complete
last_updated: 2026-07-31
last_updated_by: lirdaw
---

# Research: Harden `formData()` on the two deck endpoints, and close the `?error=` read side on the deck surface

**Date**: 2026-07-31T19:57:44+02:00
**Researcher**: lirdaw
**Git Commit**: `465832e0de1e8a31df654cd65f41835c03253307` (`main`, identical to `origin/main`)
**Repository**: lirdaw/10xcards

> **On references.** Every reference below is `path:line` against the commit in the frontmatter,
> which matches the repo's own convention in every other artifact under `context/`. The commit is
> pushed, so any reference can be turned into a permalink mechanically with
> `https://github.com/lirdaw/10xcards/blob/465832e0de1e8a31df654cd65f41835c03253307/<path>#L<line>`.
> They are deliberately NOT rewritten inline: this document will be read beside a working tree,
> where a clickable local path is worth more than a URL.

## Research Question

Two halves, joined by the choice recorded during scoping (build scope: **maximum**):

1. **C10X-37** — harden `formData()` reading on the two deck endpoints C10X-30's sweep missed,
   `src/pages/api/decks/index.ts:22-23` (create) and `src/pages/api/decks/[publicId].ts:31-32`
   (rename), which today answer an uncontrolled `500` on a non-form body and crash on a `File`
   part reaching `.trim()`. Add row-based tests per test-plan §6.10 and a breakage **pair**
   separating the endpoint's 1–100 rule from the DB CHECK.
2. **C10X-34 impl-review F1 (unticketed)** — close the **read** side of the `?error=` channel on
   the three deck pages, where the parameter is taken raw into a trust-carrying red banner: the
   same content-injection class the auth pages closed with `ownedAuthMessage`.

Four adjacent areas were mapped as reconnaissance without a build commitment: the deck-side
`?error=` value set, signed-out coverage of the redirect-style deck endpoints, the islands' 1–100
mirror, and how the name rule is layered.

## Summary

**Both defects are live and verbatim**, confirmed by first-hand reads, not only by report:
`decks/index.ts:22-23` and `decks/[publicId].ts:31-32` carry the unguarded `await
context.request.formData()` and the `((form.get("name") as string | null) ?? "").trim()` cast;
`decks/index.astro:22`, `decks/[publicId]/index.astro:86` and `decks/[publicId]/review.astro:115`
read `searchParams.get("error")` raw, while the two auth pages wrap it.

Seven findings change what the plan should say, ordered by how much they move the work:

1. **The `errorUrl` ordering constraint does not exist here — question closed.** `change.md:12` and
   C10X-30's `follow-ups/review-fixes.md:32-34` both leave it open ("Not verified during the
   review"). Verified: `decks/index.ts` builds a **fixed literal** URL (`/decks?error=…&open=create`,
   re-spelled inline at `:14`, `:27`, `:33`, `:41`), and `decks/[publicId].ts:20` builds `errorUrl`
   from the **route param** `publicId` — eleven lines before `formData()` is awaited, and already
   UUID-gated at `:17`. Neither endpoint has `[cardPublicId].ts`'s constraint. The guard can sit
   wherever it reads best.

2. **The one-message shape is the right one, and the evidence is a precedent, not a preference.**
   Both card endpoints deliberately use a single message for both `formData()` rejection causes
   (`cards/index.ts:40-51`), on the stated ground that the copy is truthful for both and is a
   literal the endpoint's other failure branches already carry — so the owned set does not grow.
   The deck endpoints already own exactly such literals (`"Nie udało się utworzyć talii"`,
   `"Nie udało się zmienić nazwy talii"`). The two-message split (`isFormContentType`) exists only
   on auth, where `AUTH_VALIDATION_MESSAGE` and `AUTH_GENERIC_MESSAGE` were already members of a
   closed set. `change.md`'s hypothesis ("they likely do not") is confirmed — **but see finding 4**,
   which is the one thing that could reopen it.

3. **The deck-side `?error=` set IS closed today — the follow-up's "first step" is done.** All
   eleven values reachable on a deck URL are project literals; no upstream, DB, or exception string
   can get in. `error.code` is read as a discriminator, never `error.message`, and both `catch`
   blocks on the card side bind no exception variable. So the fix is the `ownedAuthMessage` shape,
   not a redesign first.

4. **…but the set is not "deck messages", and naming it that would be a defect.** The card
   endpoints redirect to **deck pages**, so the set a deck page must vouch for spans deck routes,
   card routes, and one literal shared by six files. Two of the eleven are **templates over
   `FRONT_MAX`/`BACK_MAX`**, so the set has to be built by interpolation exactly as
   `tests/validation/cards.test.ts:45-46` builds its expectations — a copied string would drift the
   day a bound moves. Nine of the eleven are inline duplicates today; there is no shared module.
   This is the single largest piece of work the maximum scope adds.

5. **One of the six sinks bypasses `ServerError` entirely, and it is the widest.**
   `decks/[publicId]/index.astro:149-153` renders `bannerError` **directly in `.astro` markup** —
   red-banner classes byte-identical to `ServerError.tsx:35`, minus `role="alert"` — and needs **no
   companion parameter**, so a bare `/decks/<id>?error=X` reaches it. A component-level fix cannot
   reach that sink; the guard must sit at the three `.astro` reads. That is also the cheap news:
   wrapping `:86` covers all four of that page's sinks at once, because every one of them is derived
   from the same `error` const.

6. **The count oracle for decks has no `deck_id` to hang on, and the two obvious helpers are both
   wrong.** `deckNameExists` filters by one exact name and `.maybeSingle()`s; `listDecks` has no
   WHERE clause at all and decays exactly as `listDueCounts` did once the dev DB outgrew PostgREST's
   `max_rows` (test-plan §6.6, Phase 4). Since `deck` has no containing scope, the oracle must be a
   raw count scoped by a **per-case name marker** with `.like()` — and the marker must avoid `%`/`_`
   (`tests/fixtures/scoping.ts:31`). On rename the oracle is the **row** (`toEqual(before)`), as on
   card edit, because an UPDATE leaves every count untouched.

7. **The DB CHECK on `deck.name` is unnamed in the DDL — the breakage pair transfers, its assertion
   does not.** `init_core_schema.sql:45` declares `name text not null check (char_length(name)
   between 1 and 100)` inline, unlike `flashcard_front_check`, `flashcard_back_check` and
   `deck_session_size_check`, which `tests/validation/cards.test.ts` and `tests/study/study.test.ts`
   assert **by name** precisely to attribute which layer fired. Postgres auto-names it, and the
   repo carries evidence of what that produces: `20260728104500_flashcard_content_bounds.sql:42`
   successfully drops `flashcard_front_check`, an inline check declared at `init_core_schema.sql:62`
   — so the auto-name is `<table>_<column>_check` and the deck one is almost certainly
   `deck_name_check`. **That is inference from precedent, not a measurement**, and it must be read
   off the live database before it is written into an assertion.

Two facts bound the claim the change can make. The server's over-length branch is **not reachable
through the hydrated UI** — both deck islands run a `.trim()`-then-1..100 check and
`preventDefault()` on failure (`CreateDeckModal.tsx:41-47`, `DeckActions.tsx:46-52`), so what a
user meets is the island's own message; the server branch is reachable only by a request crafted
outside the UI, which is exactly Risk #6's scenario and exactly why the server test is the one
worth having. And **neither deck endpoint's own signed-out branch is tested**; the middleware
covers them as a class (`tests/middleware.test.ts:85`, `:94`, `:110`, `:118`), which is a different
claim.

## Detailed Findings

### A. The two endpoints — the defect, the shape, the ordering

`src/pages/api/decks/index.ts` (create, 45 lines). Statement order: `createClient` (`:12`) →
`!supabase` (`:13-15`) → `locals.user` (`:17-20`) → **unguarded `formData()`** (`:22`) → cast
(`:23`) → length (`:25-28`) → `deckNameExists` (`:31`) → `createDeck` (`:36`) → success
`context.redirect("/decks")` (`:44`).

```ts
// src/pages/api/decks/index.ts:22-23
const form = await context.request.formData();
const name = ((form.get("name") as string | null) ?? "").trim();
```

`src/pages/api/decks/[publicId].ts` (rename, 57 lines). Order: route param + `UUID_RE` (`:14-19`)
→ **`errorUrl` builder** (`:20`) → `createClient` (`:22`) → `locals.user` (`:27-29`) →
**unguarded `formData()`** (`:31`) → cast (`:32`) → length (`:34-36`) → `deckNameExists` (`:40`) →
`renameDeck` (`:45`) → `!updated → 404` (`:52-54`) → success `/decks/${publicId}` (`:56`).

```ts
// src/pages/api/decks/[publicId].ts:20
const errorUrl = (msg: string) => `/decks/${publicId}?error=${encodeURIComponent(msg)}&open=rename`;
```

Two consequences, both live: a crafted non-form body rejects out of `formData()` as an unhandled
`TypeError` → framework `500` with no project-owned body; a multipart `name` part of type `File`
survives the compile-time cast and throws the same way at `.trim()`.

**Six `formData()` readers exist under `src/pages/api/`**, not four — the count is settled and
already corrected in three live places (`src/lib/forms.ts:16-25`,
`tests/lib/forms.test.ts:5-12`, `context/foundation/test-plan.md:126-128` and `:328-332`). Four are
guarded (`auth/signin.ts:26`, `auth/signup.ts:17`, `cards/index.ts:49`, `cards/[cardPublicId].ts:41`);
these two are not. Three further endpoints read **no** body at all — `auth/signout.ts`,
`decks/[publicId]/delete.ts`, `cards/[cardPublicId]/delete.ts` — so deck delete is out of this
class, and three more (`generate.ts`, `study.ts`, `cards/batch.ts`) are JSON endpoints.

One off-by-one to know about before quoting a document: `src/lib/forms.ts:20` cites `:23` and `:32`,
which are the **cast** lines; the `formData()` awaits are `:22` and `:31`.

### B. The hardening pattern to copy, and the one-message decision

`src/pages/api/decks/[publicId]/cards/index.ts:47-54` is the shape that fits both deck endpoints:

```ts
let form: FormData;
try {
  form = await context.request.formData();
} catch {
  return context.redirect(errorUrl("Nie udało się utworzyć fiszki"));
}
const front = formString(form.get("front")).trim();
const back = formString(form.get("back")).trim();
```

Its comment at `:40-46` states the rule the deck endpoints inherit: both rejection causes share one
message because the copy is truthful for both, and it is a literal the handler's other failure
branches already carry — so no new copy enters the owned set.

The auth variant (`auth/signin.ts:24-32`, `auth/signup.ts:15-23`) branches on
`isFormContentType(context.request)` into `AUTH_GENERIC_MESSAGE` vs `AUTH_VALIDATION_MESSAGE`. Both
were already members of `AUTH_MESSAGES` (`src/lib/auth-errors.ts:75-95`), and `src/lib/forms.ts:44-69`
records why the discriminator is the **header** and not the exception: both causes throw a bare
`TypeError`, measured.

`formString` (`src/lib/forms.ts:37-39`) only ever narrows — identity for a genuine string, `""` for
a `File` or a missing part — so it falls into whatever empty-input guard the endpoint already owns.
For the deck endpoints that is the existing `name.length < 1` half of the 1–100 check, which means
**a `File` part needs no new message at all**. Nine cases already pin the helper
(`tests/lib/forms.test.ts`), including the one that matters here: `formString(file) === ""` with
`expect(() => (file as unknown as string).trim()).toThrow(TypeError)` as the positive control
(`:32-39`).

### C. The name rule's enforcement layers

Six enforcement sites in application code plus the DB CHECK — census re-run first-hand, and it
matches the count `src/lib/generation-limits.ts:19-20` names ("the deck-name 1..100 bound, which
lives in six places. Out of scope for this change, and named so the next reader knows it was left,
not missed"):

| # | Site | Form |
| --- | --- | --- |
| 1 | `src/pages/api/decks/index.ts:25-26` | `name.length < 1 \|\| > 100` + inline message |
| 2 | `src/pages/api/decks/[publicId].ts:34-35` | same |
| 3 | `src/components/decks/CreateDeckModal.tsx:43-45` | `trimmed.length < 1 \|\| > 100` + same message |
| 4 | `src/components/decks/DeckActions.tsx:48-50` | identical to #3 |
| 5 | `src/components/generate/GeneratorForm.tsx:144` + `:282` | different wording (trailing period) + `maxLength={100}` |
| 6 | `src/pages/api/generate.ts:75` | `z.string().trim().min(1).max(100)` |
| DB | `supabase/migrations/20260705180246_init_core_schema.sql:45` | `check (char_length(name) between 1 and 100)`, **unnamed** |

Plus `constraint deck_user_name_unique unique (user_id, name)` at `:48`, which the endpoints map to
`23505 → "Talia o tej nazwie już istnieje"` (`decks/index.ts:38-40`, `[publicId].ts:47-48`).

Two properties of the CHECK matter for test design. It is **unnamed** — see Summary finding 7. And
`char_length` counts code points while JS `.length` counts UTF-16 units, so `char_length ≤ .length`
always and the CHECK **can never reject a name the endpoint accepted** — which is precisely why the
independence case has to go around the endpoint through a direct RLS-scoped insert, as
`tests/validation/cards.test.ts:429-473` does, and why boundary strings must be ASCII
(`cards.test.ts:50-55`).

### D. The `?error=` channel — producers

Six native-form endpoints produce it; the three JSON endpoints never do (`api/generate.ts:19`
records the convention split). **Eleven distinct literals**, and the set is closed:

| # | Literal | Sites |
| --- | --- | --- |
| 1 | `Supabase nie jest skonfigurowany` | `decks/index.ts:14`, `decks/[publicId].ts:24`, `decks/[publicId]/delete.ts:23`, `cards/index.ts:26`, `cards/[cardPublicId].ts:61`, `cards/[cardPublicId]/delete.ts:23` — **six inline copies** |
| 2 | `Nazwa talii musi mieć od 1 do 100 znaków` | `decks/index.ts:26`, `decks/[publicId].ts:35` |
| 3 | `Talia o tej nazwie już istnieje` | `decks/index.ts:5`, `decks/[publicId].ts:5` — two independent module consts |
| 4 | `Nie udało się utworzyć talii` | `decks/index.ts:40` |
| 5 | `Nie udało się zmienić nazwy talii` | `decks/[publicId].ts:48` |
| 6 | `Nie udało się usunąć talii` | `decks/[publicId]/delete.ts:33` |
| 7 | `Nie udało się utworzyć fiszki` | `cards/index.ts:51`, `:64`, `:79` |
| 8 | `Nie udało się zapisać zmian` | `cards/[cardPublicId].ts:43`, `:76`, `:93` |
| 9 | `Nie udało się usunąć fiszki` | `cards/[cardPublicId]/delete.ts:34`, `:44` |
| 10 | `Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków` | `cards/index.ts:71`, `cards/[cardPublicId].ts:83` |
| 11 | `Tył fiszki musi mieć od 1 do ${BACK_MAX} znaków` | `cards/index.ts:74`, `cards/[cardPublicId].ts:86` |

Closure was established by reading every branch, not by grep alone: no `.message`, `String(err)` or
`JSON.stringify` appears on any deck-route branch (the only such interpolations are
`api/study.ts:40`, `api/generate.ts:88`, `:267`, `cards/batch.ts:42`, all JSON bodies, and
`generate.ts:267` routes its value to the DB audit column, never to a URL). Both card-side `catch`
blocks bind no exception variable.

Companion parameters are equality switches, not data: `open` ∈ {`create`, `rename`, `create-card`},
plus `edit=<cardPublicId>`, `saved=<cardPublicId>`, and on review `generation=` (UUID-gated) and
`state=`.

### E. The `?error=` channel — consumers, and the auth pattern to mirror

Five page-level reads exist in `src/`; three are raw (confirmed first-hand):

```
src/pages/auth/signin.astro:8:            ownedAuthMessage(Astro.url.searchParams.get("error"))
src/pages/auth/signup.astro:8:            ownedAuthMessage(Astro.url.searchParams.get("error"))
src/pages/decks/index.astro:22:           Astro.url.searchParams.get("error")            ← RAW
src/pages/decks/[publicId]/index.astro:86: Astro.url.searchParams.get("error")           ← RAW
src/pages/decks/[publicId]/review.astro:115: Astro.url.searchParams.get("error")         ← RAW
```

Six sinks hang off those three reads:

| URL shape | Sink | Renderer |
| --- | --- | --- |
| `/decks?open=create&error=X` | `CreateDeckModal` | `ServerError`, `CreateDeckModal.tsx:80` |
| `/decks/<id>?error=X` (no companion) | **page-level banner** | raw `.astro` markup, `[publicId]/index.astro:149-153` |
| `/decks/<id>?open=rename&error=X` | `DeckActions` | `ServerError`, `DeckActions.tsx:101` |
| `/decks/<id>?open=create-card&error=X` | `CreateFlashcardModal` | `ServerError`, `:121` |
| `/decks/<id>?edit=<cardPublicId>&error=X` | `FlashcardItem` | `ServerError`, `:159` |
| `/decks/<id>/review?edit=<cardPublicId>&error=X` | `CandidateItem` | `ServerError`, `:175` |

On `[publicId]/index.astro` all four sinks derive from the one `error` const (`:86`) through
`bannerError` (`:94`), `serverError={openRename ? error : null}` (`:145`),
`serverError={openCreateCard ? error : null}` (`:161`) and `editError={editId ? error : null}`
(`:163`) — so one wrap at `:86` closes all four.

The pattern to mirror, five lines, `src/lib/auth-errors.ts:117-120`:

```ts
export function ownedAuthMessage(raw: string | null): string | null {
  if (raw === null) return null;
  return AUTH_MESSAGES.includes(raw) ? raw : null;
}
```

Its docblock (`:97-116`) names the three load-bearing properties: membership by **equality, never
containment** ("the attack is not inventing trusted copy from scratch — it is appending to copy the
user already trusts"); `null` as the rejection value **because `ServerError.tsx:7-8` renders nothing
for a falsy message**, so an unvouchable value degrades to *no banner*; and residence **beside the
set it enforces** so producer and consumer cannot drift.

`replaceState` is not a mitigation and must not be read as one. All four islands strip `error`/`open`
on mount (`CreateDeckModal.tsx:25-32`, `DeckActions.tsx:31-38`, `FlashcardWorkspace.tsx:90-104`,
`CandidateReviewWorkspace.tsx:85-93`) — but every one of them seeds `React.useState(serverError)` at
first render, so the value is captured before the URL is cleaned. The guard has to sit at the
`.astro` read.

Blast radius of the banner itself: twelve `<ServerError>` call sites across eleven components, of
which five seed from an unguarded URL parameter, five are client-fetch state, and two are the
already-guarded auth forms — plus the thirteenth, non-component render at
`[publicId]/index.astro:149-153` that a change to `ServerError.tsx` would not reach.

### F. Test landscape, and what the deck oracle has to be

`tests/validation/cards.test.ts` (475 lines, 13 `it()`) is the template, and its header
(`:11-37`) is the §6.10 rationale in the project's own words: a refusal and a success are both a
`302`; **assertion order is load-bearing** (oracle first, message last), because the breakage pair
makes the same case fail on both and only the differing failure strings separate the endpoint from
the database; and every refusal asserts the decoded `error` by **equality**, since under breakage
run 1 the endpoint still answers `302` with an `error=` param from a different branch.

Reusable pieces, by name: `sized(marker, length)` (`:57`, ASCII on purpose), `errorParam(location)`
(`:168-170`, the decoded reader), `postCard(deckPublicId, body: BodyInit)` (`:127`, takes `BodyInit`
so a malformed body travels the same path as a form), and the raw-`Location` no-echo case
(`:272-287`). The malformed-body case needs no header override — a **string** body is what
`callEndpoint` labels `application/json` (`tests/fixtures/endpoint.ts:74-80`); the one case that
does need an override is "announced as a form, arrives broken", whose shape is
`tests/auth/errors.test.ts:424-443`.

**The deck oracle is the part that does not transfer.** `cards.test.ts` scopes its raw count by
`deck_id` (`:104-112`), with an explicit warning at `:95-103` against `countFlashcards` /
`listFlashcards` because both filter `state_id = STATE_ACCEPTED`. `deck` has no such containing
column, and the two helpers this need points at are both unusable for a different reason each:
`deckNameExists` (`src/lib/decks.ts:21-23`) filters one exact name and `.maybeSingle()`s;
`listDecks` (`:11-13`) has **no WHERE clause at all**, RLS-only scoping, so it returns every deck
the account owns across the whole run and decays into a false pass past PostgREST's `max_rows`
exactly as the `listDueCounts` denial did (test-plan §6.6, Phase 4). The workable oracle is a raw
count filtered by a per-case **name marker** with `.like()` — which works because the over-length
name under test *is* the marker (`sized("over-name-<suffix>-", 101)` opens with it) — and the marker
must avoid `%` and `_`, per `tests/fixtures/scoping.ts:31`. On rename the oracle is the **row**,
`toEqual(before)`, as at `cards.test.ts:338-352`.

Existing deck coverage (`tests/isolation/decks.test.ts`, 5 `it()`) is ownership only: rename and
delete denied for B, A's own delete as the positive control, `listDecks` read denial. It asserts
**no** input validation, **no** malformed body, **no** `File` part, **no** boundary, **no** decoded
`error` param, **no** duplicate-name/`23505` case, and **no** signed-out request. Its own helper
comment (`:34-35`) already warns that "the endpoint redirects on failure too … so the status alone
proves nothing" — the §6.10 rule, discovered on this very endpoint back at
`context/archive/2026-07-15-verification-harness/reviews/impl-review.md:79-88`.

By folder convention the new file is `tests/validation/decks.test.ts` — one file covering create and
rename, plus a DB-layer `describe`, exactly as `cards.test.ts` covers create and edit. Baseline to
move from: **262 passing across 23 files**, corroborated by arithmetic over `it(`/`it.each` rows
rather than by an executed run (the suite needs `npm run db:start`). Unlike the auth file, deck
cases cost **no** GoTrue budget — nothing here reaches the 30-per-5-minutes sign-in limit.

Two hazards specific to this table. `deck_user_name_unique` means a duplicated insert answers
`23505`, which `tests/setup/retry-transport.ts:37-44` explicitly relies on as the loud failure mode
— so deck fixtures must carry the run suffix. And restoring a dropped CHECK is **not** symmetric
with restoring a function: the suite persists rows the constraint forbids while it is absent, so the
re-add fails with `violated by some row` until they are deleted (procedure at
`context/archive/2026-07-28-server-side-validation-test/verification.md:213-278`; distilled at
test-plan `:1677-1690`).

The textual-guard species that would cover the read side already exists:
`tests/lib/auth-error-param-guard.test.ts` (3 cases) scans `src/pages/auth` per **line**, with
`RAW_READ` (`:39`) and `WRAPPED_READ` (`:42`), two positive controls, and a co-presence near-miss
case so an unused import cannot satisfy it. It already anticipates this work — `:99-101` asserts it
does **not** fire on `?open=`, with the comment "`open` is read beside `error` on the deck pages".
Pointed at `src/pages/decks`, the same regexes report **three** unwrapped reads today.

### G. The islands — the mirror, and what it does to reachability

Both deck forms are native `<form method="POST">` with `noValidate`: `CreateDeckModal.tsx:61` →
`/api/decks`, `DeckActions.tsx:77-83` → `/api/decks/${publicId}`, and a third, field-less form at
`:126` → `/api/decks/${publicId}/delete`. Neither island touches the response; both files contain no
`fetch` at all.

Neither name input carries `maxLength` — verified across the whole components tree, where
`maxLength` appears **only** at `GeneratorForm.tsx:282` and `:310`. But both islands do run a submit
guard that mirrors the server's rule and cancels the submit:

```ts
// src/components/decks/CreateDeckModal.tsx:41-47
function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    e.preventDefault();
    setError("Nazwa talii musi mieć od 1 do 100 znaków");
  }
}
```

`DeckActions.tsx:46-52` is the same logic on `value`. So the branch a **user** meets is the island's,
and the server's length branch is reachable only from outside the UI — which is Risk #6's premise,
not an argument against testing it. The `NAME_TAKEN` duplicate branches, the `23505` races and the
generic failure branches have no client counterpart and are reachable normally.

Accessibility on this surface, for completeness: `aria-invalid` on both inputs
(`CreateDeckModal.tsx:75`, `DeckActions.tsx:96`), `role="alert"` inside `ServerError.tsx:33`, and
**no** `role="alert"` on the page-level banner at `[publicId]/index.astro:149-153` — the same sink
that also bypasses the component.

### H. Signed-out coverage

`callEndpoint` always injects `locals.user` (`tests/fixtures/endpoint.ts:88-93`), so nothing driven
through it exercises a signed-out request. Neither deck endpoint's own
`if (!user) return context.redirect("/auth/signin")` (`decks/index.ts:17-20`,
`[publicId].ts:27-29`) is executed by any test. What exists is middleware-level and class-wide:
`tests/middleware.test.ts:85` / `:94` drive the real `PROTECTED_ROUTES`, `:110` pins a native form
POST to a deck endpoint as `302`, `:118` the same path as `401` for a JSON caller.

test-plan §6.6's Phase 1 note has recorded this gap since C10X-27 ("the six redirect-style deck
endpoints still have no signed-out test of their **own** — the guard now covers them as a class,
which is a different claim"). The precedent for closing it cheaply is `studySignedOut` in
`tests/study/study.test.ts`: a local helper rendering the endpoint with `locals: { user: null }`,
bypassing `callEndpoint`, needing no database.

## Code References

- `src/pages/api/decks/index.ts:22-23` — unguarded `formData()` + `as string | null` cast (create)
- `src/pages/api/decks/index.ts:5`, `:14`, `:26`, `:40` — the four literals this endpoint can emit
- `src/pages/api/decks/[publicId].ts:31-32` — the same two defects (rename)
- `src/pages/api/decks/[publicId].ts:20` — `errorUrl` from the route param, eleven lines before the body read
- `src/pages/api/decks/[publicId]/cards/index.ts:40-54` — the one-message guard shape to copy
- `src/pages/api/auth/signin.ts:24-32` — the two-message variant, and why it is auth-only
- `src/lib/forms.ts:37-39`, `:70-73` — `formString`, `isFormContentType`
- `src/lib/forms.ts:16-25` — the comment that must stop saying the class is open once this lands
- `src/lib/decks.ts:11-13`, `:21-23` — `listDecks` / `deckNameExists`, both wrong as count oracles
- `src/lib/auth-errors.ts:75-95`, `:117-120` — the closed set and the read-side guard to mirror
- `src/pages/decks/index.astro:22` — raw read #1
- `src/pages/decks/[publicId]/index.astro:86`, `:94`, `:145`, `:161`, `:163` — raw read #2 and its four sinks
- `src/pages/decks/[publicId]/index.astro:149-153` — the sink that bypasses `ServerError`
- `src/pages/decks/[publicId]/review.astro:115` — raw read #3
- `src/components/decks/CreateDeckModal.tsx:41-47`, `:61`, `:80` — client guard, native form, banner
- `src/components/decks/DeckActions.tsx:46-52`, `:77-83`, `:101`, `:126` — rename + delete forms
- `src/components/auth/ServerError.tsx:7-8`, `:33-39` — falsy → renders nothing; the red `role="alert"` banner
- `supabase/migrations/20260705180246_init_core_schema.sql:45`, `:48` — the unnamed CHECK, the unique constraint
- `supabase/migrations/20260728104500_flashcard_content_bounds.sql:42`, `:45` — the precedent for the auto-name
- `tests/validation/cards.test.ts:11-37`, `:57`, `:95-112`, `:127`, `:168-170`, `:272-287`, `:289-326`, `:429-473` — the template
- `tests/isolation/decks.test.ts:34-35`, `:58-129` — existing deck coverage, and its own §6.10 warning
- `tests/lib/forms.test.ts:5-12`, `:32-39` — helper coverage, and the header naming C10X-37
- `tests/lib/auth-error-param-guard.test.ts:36-59`, `:99-101` — the textual guard and its deck-page control
- `tests/fixtures/endpoint.ts:60-65`, `:74-80`, `:88-93` — no redirect following, string body ⇒ JSON, injected `locals`
- `tests/fixtures/scoping.ts:5-11`, `:31` — the 414 trap and the LIKE-wildcard rule
- `tests/setup/retry-transport.ts:37-44` — why a duplicated `deck` insert is loud

## Architecture Insights

- **A closed set enforced only where messages are produced is half a guarantee.** The deck surface
  is the auth surface one ticket earlier: producers already emit nothing but literals, and the read
  side vouches for none of it. The asymmetry is invisible from either end alone, which is why
  test-plan §6.3 grew a bullet for it after C10X-34.
- **Redirect-style refusals invert the usual assertion hierarchy.** Status proves nothing, message
  containment is worse than nothing, and the row oracle is the assertion rather than its backup.
  This project has now paid for that lesson twice on these very endpoints — once at
  `verification-harness` (a `302`-only assertion called "decorative") and once at C10X-30 (breakage
  run 1, where only the equality assertion went red).
- **The project's habit is a commented copy; single-sourcing is the exception.**
  `src/lib/generation-limits.ts:14-20` says so explicitly and names the deck-name bound as the
  deliberate leftover. Whether this change ends that duplication is a scope decision, not a
  correctness one — but if it does, note that the two deck islands and the two endpoints share both
  the *number* and the *string*, while `GeneratorForm` shares only the number (its copy ends with a
  period).
- **One value serving two readers is this repo's recurring defect shape.** `lessons.md:215-220`
  records it for the LLM prompt (contract value ≠ model-facing name); the deck-surface message set
  is the same shape one layer over: a value chosen for a URL now has to be vouched for by a
  renderer. Keeping the set beside the guard — as `auth-errors.ts` does — is what stops the two
  drifting.
- **A guard's own falsifiability is a first-class deliverable here.** Both the closed-set helper and
  the textual page guard can pass vacuously (`() => null` satisfies every rejection case; a walker
  returning `[]` satisfies every scan). The auth precedent answers both with positive controls over
  the *whole* set and a floor assertion on the file count.

## Historical Context (from prior changes)

- `context/archive/2026-07-28-server-side-validation-test/reviews/impl-review.md:64-110` — F1, the
  finding that created C10X-37. Its verdict at `:79-80`: "The enumeration was incomplete, not a
  scope decision: nothing in 'What We're NOT Doing' excludes them." Fix B (patch without tests) was
  rejected at `:103-104` as "exactly the assumed-not-asserted hardening plan-review F4 rejected".
- `context/archive/2026-07-28-server-side-validation-test/follow-ups/review-fixes.md:6-38` — the
  handed-over scope, including `:32-34`'s unverified `errorUrl`-ordering question, **now answered**.
- `context/archive/2026-07-28-server-side-validation-test/verification.md:126-211` — the breakage
  pair with its observed splits (2 of 12, then 3 of 12) and, at `:150-157`, the reading that matters:
  "**The passing assertion is the evidence here, not the failing one.**" Restore procedure and the
  `NOT VALID` caveat at `:213-278`.
- `context/archive/2026-07-30-auth-error-copy/reviews/impl-review.md:51-90` — F1, the deck-page
  `?error=` vector, with its severity qualifier (behind the middleware guard, victim must be signed
  in) and its blind spot at `:76-77`: whether the deck messages form a closed set "has not been
  enumerated; that is the first step of the follow-up". Enumerated here — they do.
- `context/archive/2026-07-30-auth-error-copy/follow-ups/review-fixes.md:8`, `:18-25` — the shape of
  the fix and the note that it is still **unticketed** ("to be ticketed via `/jira-backlog-sync`.
  No key yet.").
- `context/archive/2026-07-30-auth-error-copy/verification.md:278-298` — breakage check E on
  `ownedAuthMessage`: 2 of 55 red where the plan predicted 1, and "**What stayed GREEN is the
  evidence, not the reds**".
- `context/archive/2026-07-07-deck-workspace/` — the slice that built these endpoints.
  `plan-brief.md:37-39` records the form-POST-plus-`?error=` convention, manual 1–100 validation
  with the DB as backstop, and the TOCTOU pre-check; `reviews/impl-review.md:67-75` (F5) is where
  `UUID_RE` was added to `[publicId].ts` — the reason the rename `errorUrl` is route-param-derived
  today; `reviews/plan-review.md:37-38` shows the rename round-trip was added at review, not planned.
- `context/archive/2026-07-15-verification-harness/reviews/impl-review.md:79-88` — the earliest
  statement of the §6.10 problem, on this endpoint: "answers **every** error path with a 302 too …
  it is decorative."
- `context/foundation/jira-map.md:169-186` — C10X-37's `Change ID` is **empty on both sides** because
  the ticket was opened from a review finding before a change folder existed; the id is minted when
  the work is picked up, and "**that** is the moment to fill both sides". `deck-form-hardening` is
  that id.
- `context/foundation/lessons.md:208-213` — the standing rule this change's tests must follow
  (row oracle, equality on the decoded message, oracle first).

## Related Research

- `context/archive/2026-07-28-server-side-validation-test/research.md:341-344` — the four/six
  enumeration as it stood when C10X-30 was scoped.
- `context/archive/2026-07-30-auth-error-copy/research.md:272-283` — R13, the read-side risk that
  produced `ownedAuthMessage`.
- `context/archive/2026-07-26-ai-candidate-generation-test-2/research.md:247-251` — the earlier
  census of the deck-name 1–100 duplication.
- `context/foundation/test-plan.md` §6.10 (`:2298-2347`) — the convention; §6.6's C10X-30 and
  C10X-34 entries (`:1692-1702`, `:1894-1915`) — the two does-NOT-prove bullets this change closes.

## Open Questions

1. **What is the deck CHECK's actual constraint name?** `deck_name_check` is inference from the
   `flashcard_front_check` precedent, not a measurement. Read it off the live local stack
   (`select conname from pg_constraint where conrelid = 'public.deck'::regclass and contype = 'c'`)
   before writing it into an assertion — or decide instead to name it explicitly in a migration,
   which is what `20260728104500` did for the flashcard checks and which would make the deck pair
   symmetric with the card pair. That is a schema change with its own blast radius and belongs to the
   plan, not to research.
2. **What is the closed set called, and where does it live?** It spans deck **and** card routes
   (finding 4), so `DECK_MESSAGES` would misname it. Candidates: a per-surface set beside the pages
   it guards, or one module for every native-form message with a single `ownedRedirectMessage`. The
   second subsumes `AUTH_MESSAGES`; whether to refactor auth into it, or leave two sets side by
   side, is a design call.
3. **Does the closed set become the single source of the eleven literals, or a second copy of them?**
   A set that merely *lists* strings already written inline in six files is a seventh copy and can
   drift silently. Hoisting the literals into the module and importing them at each endpoint is the
   version that cannot — at the cost of touching all six endpoints, i.e. well beyond the two this
   ticket names.
4. **One textual page guard or two?** `tests/lib/auth-error-param-guard.test.ts` hard-codes
   `AUTH_PAGES_DIR` and a `WRAPPED_READ` regex naming `ownedAuthMessage`. If the deck helper has a
   different name, the guard needs either a second regex or a parameterised rewrite; if the two
   surfaces share one helper (open question 2), one guard over `src/pages` covers everything.
5. **Does the two-message split reopen if the messages are hoisted?** The one-message decision rests
   on the deck endpoints already owning a truthful "operation failed" literal. It stands as long as
   that literal stays in the set — worth re-checking after question 3 is settled, not before.
6. **Is the signed-out branch in scope?** Cheap (`studySignedOut` pattern, no database), closes a gap
   test-plan has carried since C10X-27, and touches the same two endpoints — but it is a third
   concern in a change that already absorbed a second. Decide in the plan, explicitly, per
   `lessons.md:96-101`.
7. **Does the read-side half get its own Jira key, or is it absorbed into C10X-37?** It is unticketed
   by design (`follow-ups/review-fixes.md:8`). The maximum-scope decision folds it in; the record
   should say so in one of the two places, or the next reader finds a follow-up whose fix shipped
   under a foreign key — the precise confusion C10X-34 was written to untangle.
