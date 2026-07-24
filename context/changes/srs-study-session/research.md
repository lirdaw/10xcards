---
date: 2026-07-24T00:00:00+02:00
researcher: Dawid Liro
git_commit: dc94a01ef845178afdc0fb414c8aaf802d2053c2
branch: main
repository: 10xcards
topic: "SRS study-session slice (S-03) — grounding for /10x-plan: schema for FSRS scheduling, app wiring, Risk #3 test contract, UI/nav"
tags: [research, codebase, srs, study-session, ts-fsrs, fsrs, schema, rls, test-plan, risk-3]
status: complete
last_updated: 2026-07-24
last_updated_by: Dawid Liro
---

# Research: SRS study-session slice (S-03 `srs-study-session`)

**Date**: 2026-07-24 (Europe/Warsaw)
**Researcher**: Dawid Liro
**Git Commit**: dc94a01ef845178afdc0fb414c8aaf802d2053c2
**Branch**: main
**Repository**: 10xcards (Jira C10X-6)

## Research Question

Ground the implementation plan for the north-star slice S-03 (the SRS study
session): the user studies a deck in a spaced-repetition session — only
`accepted` cards enter, the FSRS scheduler (`ts-fsrs`) selects cards due today,
the user rates recall on each card and the rating shifts the next-review date,
and the schedule survives between sessions. Focus areas requested: (1)
schema/migration for the FSRS fields, (2) lib + endpoint + page wiring
patterns, (3) the Risk #3 schedule-correctness test harness, (4) UI/navigation
+ rating mapping. PRD refs US-02, FR-011, FR-012. Prereqs F-01, F-02, S-02 (all
done). The schedule-correctness test on the F-03 harness is a hard acceptance
condition.

## Summary

**S-03 is a schema slice + FSRS integration + UI — not "a page over existing
data".** Four foundational gaps all confirmed against live code:

1. **No SRS columns exist.** `flashcard` has only
   `id, public_id, deck_id, state_id, source_id, generation_id, front, back,
   created_at, updated_at` — no `due`/`stability`/`difficulty`/FSRS-`state`/
   `reps`/`lapses`/`last_review`. A migration is required
   ([init_core_schema.sql:57-66](supabase/migrations/20260705180246_init_core_schema.sql),
   [database.types.ts:65-76](src/db/database.types.ts)).
2. **`ts-fsrs` is not installed** and imported nowhere in `src/`
   ([package.json](package.json) has no `ts-fsrs`; grep of `src/` for
   `fsrs`/`Rating`/`createEmptyCard` = zero hits). S-03 is its first use.
3. **No `/study` page or study endpoint exists.** Existing routes: `auth`,
   `decks`, `decks/[publicId]/cards/*`, `generate`. None for study/review/rating.
4. **The "Nauka" nav item already exists but is disabled** (`enabled: false,
   href: null`) and the layout type union already includes `"study"` — S-03
   flips it on, it does not add a new item
   ([Sidebar.astro:25-31](src/components/Sidebar.astro),
   [AuthenticatedLayout.astro:7](src/layouts/AuthenticatedLayout.astro)).

**The load-bearing design fork** (for `/10x-plan`, not decided here): FSRS
schedule fields as columns **directly on `flashcard`** (1:1, inherits
`flashcard` join-RLS for free, matches the `state_id`/`source_id` precedent)
vs. a **separate 1:1 table** (matches the `generation_session` precedent), plus
whether a separate append-only **`review_log`** history table ships in this
slice (needed as the "no card is lost / survives restart" durability evidence)
or is deferred.

**The hard constraint that must not be violated:** the word "state" means two
different things. `flashcard.state_id` (1 generated / 2 accepted / 3 rejected,
lifecycle) is a **different axis** from FSRS `State` (0 New / 1 Learning /
2 Review / 3 Relearning, scheduling). They must be separate columns. Risk #3's
"only accepted cards enter a session" is the `state_id = 2` gate
([flashcards.ts:42,63-70](src/lib/flashcards.ts)); the deferral-ordering clause
is pure FSRS.

**The Risk #3 oracle is solved by ts-fsrs's explicit `now` argument.** Because
`next(card, now, grade)` takes `now` as a parameter, FSRS is pure/immutable, and
`enable_fuzz` defaults to `false`, the scheduler is a deterministic *independent
oracle*. The test asserts the **property** ("Easy defers further than Hard"),
not a copied constant — dissolving the oracle problem. The one design
constraint the plan must impose on S-03: make `now` injectable into the rating
path, or accept that exact-`due` assertions live only in a unit test.

## Detailed Findings

### 1. Schema / migration for the FSRS fields

**Migration conventions (the template every new migration must mirror), from
[init_core_schema.sql](supabase/migrations/20260705180246_init_core_schema.sql):**
- Naming: `<YYYYMMDDHHMMSS>_<snake_case>.sql` (14-digit UTC prefix).
- Extensions in the `extensions` schema (`create extension if not exists …
  schema extensions;`, [:16](supabase/migrations/20260705180246_init_core_schema.sql)).
- Dynamic tables: `id bigint generated always as identity (start with 100000)
  primary key` ([:42,:58](supabase/migrations/20260705180246_init_core_schema.sql));
  dictionary rows use ids `<100000`.
- `public_id uuid not null default gen_random_uuid() unique` — the only
  external handle; internal `bigint id` never leaves the server ([:43,:59]).
- `user_id uuid not null references auth.users (id) on delete cascade` ([:44]).
- `moddatetime` trigger for `updated_at` ([:75-81]).
- Index every FK / filter column ([:51,:68,:69]).
- RLS block ([:83-149]): `enable row level security`; `revoke all … from anon`;
  `grant select, insert, update, delete … to authenticated`; policies use the
  `(select auth.uid())` initPlan form (Supabase perf recommendation).
- **Migrations are NOT idempotent for tables** — bare `create table` (not `if
  not exists`), so `npm run db:reset` (replays the whole chain) is the clean
  local path, not re-running one file.

**Precedents for the design fork:**
- **Columns-on-`flashcard`** has direct precedent: `state_id` and `source_id`
  are plain columns on `flashcard`
  ([init_core_schema.sql:61](supabase/migrations/20260705180246_init_core_schema.sql),
  [manual_card_source.sql:30-31](supabase/migrations/20260710195327_manual_card_source.sql)).
  Columns added here **automatically inherit** the `flashcard_select` join-RLS —
  a `due <= now` query stays per-user with **no new policy**.
- **Separate-table** precedent is `generation_session`
  ([generation_session.sql:21-74](supabase/migrations/20260712162349_generation_session.sql)):
  standard identity/`public_id`, but it carries `user_id` **directly** (so its
  RLS is the deck shape `user_id = (select auth.uid())`, [:58-74]), and it is
  **written-once / immutable — no `updated_at`, no moddatetime trigger** ([:9-12]).
  This is the closest structural model for an append-only `review_log`.
- **Additive-column hazards:** adding a `not null` column to now-populated
  `flashcard` needs a default or a backfill. The `source_id` add got away with
  `not null` + no default **only because the table was empty then**
  ([manual_card_source.sql:6-7](supabase/migrations/20260710195327_manual_card_source.sql));
  that shortcut does **not** apply now. `generation_id` shows the safe additive
  pattern for a nullable FK: `… references generation_session (id) on delete set
  null` + index ([generation_session.sql:46-49]).

**RLS for a new SRS/`review_log` table:** if it hangs off `flashcard_id`, copy
the two-hop `exists` join through `deck.user_id` (the `flashcard_*` policy
shape, [init_core_schema.sql:126-142]); if it carries `user_id`, use the
`generation_session` direct shape. Grants: `revoke all … from anon` + `grant
select, insert, update, delete … to authenticated`. **Service-role is forbidden
on user paths** — RLS is the only lock ([init_core_schema.sql:88-89],
[supabase.ts](src/lib/supabase.ts) uses anon key + user JWT only).

**RPC option (if the due query needs SQL):** `search_flashcards_in_deck` is the
precedent — `security invoker` (default) so `flashcard_select` RLS still
filters, `set search_path = ''`, `grant execute … to authenticated`; a
`SECURITY DEFINER` would bypass RLS and is explicitly warned against
([deck_keyword_search.sql:38-65](supabase/migrations/20260712162359_deck_keyword_search.sql)).

**`database.types.ts` is generator-owned**, produced by `npm run db:types`
(`supabase gen types typescript --local`, [package.json:18](package.json)) off
the running local stack. Flow: write migration → `db:reset` → `db:types`. It is
listed under test-plan §7 "deliberately don't test" — regenerate, never
hand-edit. `TablesInsert<…>`/`TablesUpdate<…>` are already used
([generations.ts:2,21](src/lib/generations.ts)).

**`ts-fsrs` install:** decision recorded (FSRS-6, 4-grade) but **no version
pinned anywhere** — the concrete version is an open item. FSRS fields to persist
per F-02: `stability, difficulty, due, state, reps, lapses, last_review`
(+ optional `elapsed_days, scheduled_days`); default params `request_retention =
0.9`, `maximum_interval = 36500`
([srs-library-research.md:66-68](context/archive/2026-07-09-srs-library-choice/srs-library-research.md)).

### 2. Lib + endpoint + page wiring

**`src/lib/` data-access convention (the template for a new `src/lib/study.ts`):**
- Every function takes an already-created RLS-scoped `SupabaseClient<Database>`
  as its first arg ([decks.ts:4-9](src/lib/decks.ts),
  [flashcards.ts:4-10](src/lib/flashcards.ts),
  [generations.ts:4-9](src/lib/generations.ts)).
- Functions **return the raw Supabase `{ data, error }`** — they do not throw,
  do not remap; error→Polish-copy mapping stays in the endpoint.
- `public_id` (uuid) is the only external handle; `.maybeSingle()` for 0-or-1
  rows; callers branch on `error` before treating `data == null` as not-found
  ([flashcards.ts:52-57](src/lib/flashcards.ts)).
- Writes use `.select(...)` (RETURNING) so a 0-row RLS no-op is distinguishable
  from success ([decks.ts:33-42](src/lib/decks.ts),
  [flashcards.ts:101-119](src/lib/flashcards.ts)).
- **The "accepted-only" precedent already exists:** `listFlashcards` filters
  `.eq("state_id", STATE_ACCEPTED)` (`STATE_ACCEPTED = 2`, pinned as a code
  constant) and orders `created_at desc`
  ([flashcards.ts:42,63-70](src/lib/flashcards.ts)). The "cards due today" query
  = this filter **plus** a `due <= now` predicate.
- `deckIdByPublicId(supabase, publicId)` resolves `public_id`→internal `id`
  before per-deck work ([flashcards.ts:55-57]). `getDeckByPublicId` selects
  `id, public_id, name`, `maybeSingle()` ([decks.ts:15-19]).
- Dates are preformatted server-side via a fixed `Europe/Warsaw`
  `Intl.DateTimeFormat` to avoid hydration drift
  ([flashcards.ts:29-37](src/lib/flashcards.ts)) — any next-review date the study
  island shows should be preformatted the same way.

**API endpoint contract — two styles:**
- **JSON style** (the model for a "rate a card" endpoint) — `/api/generate` is
  the project's only JSON endpoint
  ([generate.ts](src/pages/api/generate.ts)): build client via
  `createClient(context.request.headers, context.cookies)` ([:57]); null-check
  creds → `json(500, …)` ([:58-60]); auth guard `if (!context.locals.user)
  return json(401, …)` ([:62-65]); read JSON in try/catch → 400 ([:67-72]);
  validate with **Zod** `safeParse` → 400, whitelist enums ([:37-47,:74-77]);
  status codes in use 200/400/401/404/409/422/500/502; error-vs-empty on reads
  (branch on `error` first, only genuine `null` is 404 — never reveal a foreign
  deck) ([:95-101]).
- **Native form-POST → redirect style** (all CRUD endpoints, e.g.
  [api/decks/index.ts](src/pages/api/decks/index.ts),
  [cards/index.ts](src/pages/api/decks/[publicId]/cards/index.ts)): errors
  redirect with `?error=<pl>`; unauth → `context.redirect("/auth/signin")`;
  reads `formData()`; UUID route params validated with a regex before use,
  malformed → `new Response(null, {status:404})`.
- **Signal:** a mid-session "rate → next card" loop wants a structured response
  without a page reload → the JSON style is the template. Timeout apparatus in
  `generate.ts` (`SERVER_TIMEOUT_MS = 40_000` via `setTimeout` +
  `AbortController`, [:26-31]) is generation-specific and study likely does not
  need it (DB-only, fast).

**Astro page + island pattern:**
- Loader in `.astro` frontmatter: build client, guard null inline (`supabase ?
  await listDecks(supabase) : { data: [], error: null }`,
  [generate.astro:11-12](src/pages/generate.astro)); **branch error-vs-empty**
  and render a distinct error state (lessons rule,
  [lessons.md:68-73](context/foundation/lessons.md)); **no top-level `return` in
  frontmatter** — set `Astro.response.status` + conditional render; redirects go
  in middleware ([lessons.md:82-87]); map DB rows to a public view (strip `id`,
  preformat dates); pass to island with `client:load`
  ([decks/[publicId]/index.astro:141-166](src/pages/decks/[publicId]/index.astro)).
- Two mutation idioms coexist: **fetch-JSON** for generation
  ([GeneratorForm.tsx:127-161](src/components/generate/GeneratorForm.tsx)) vs.
  **native form POST→redirect** for CRUD
  ([FlashcardItem.tsx:96-97](src/components/flashcards/FlashcardItem.tsx)). The
  study rating loop maps to the fetch-JSON `Status = "idle"|"pending"|"error"|
  "done"` state machine ([GeneratorForm.tsx:71,127-161]).
- Round-trip params (`?error=`,`?open=`,`?saved=`) are consumed once on mount
  and stripped via `history.replaceState`
  ([FlashcardWorkspace.tsx:73-87](src/components/flashcards/FlashcardWorkspace.tsx),
  lessons rule [lessons.md:89-94]).

**Middleware & routing:** `PROTECTED_ROUTES = ["/dashboard", "/decks",
"/api/decks", "/generate", "/api/generate"]`, prefix-matched
([middleware.ts:4,23-27](src/middleware.ts)). **S-03 must add its study page +
endpoint paths here** or they are unprotected (the prefix-match gap flagged in
test-plan §6.6). `locals.user` is set only here. **Route naming is English
despite Polish UI** (`/decks`, `/generate`) → follow convention with `/study` +
`/api/study` (English route, Polish "Nauka" label).

### 3. UI / navigation + rating mapping

- **Nav item exists, disabled.** [Sidebar.astro:25-31](src/components/Sidebar.astro):
  `{ key: "study", label: "Nauka", href: null, enabled: false, icon: […] }`.
  Disabled → non-navigable `<span aria-disabled title="Dostępne wkrótce">`
  ([:106-132]); enabled → `<a href aria-current>` ([:75-105]). S-03 sets
  `href: "/study"`, `enabled: true`. `activeItem="study"` highlighting is
  already wired and typed ([Sidebar.astro:2-3],
  [AuthenticatedLayout.astro:7](src/layouts/AuthenticatedLayout.astro)). Turning
  it on touches the shared shell (`Sidebar.astro`), but it is in-scope for this
  slice (lessons rule on neighbouring-component scope,
  [lessons.md:96-101](context/foundation/lessons.md)).
- **Layout:** every authenticated page uses `<AuthenticatedLayout title=…
  activeItem="study">` ([AuthenticatedLayout.astro:5-73]).
- **Deck picker — two reusable idioms:** grid of clickable deck cards
  ([decks/index.astro:26-38](src/pages/decks/index.astro)) or the native
  `<select>` deck dropdown from `listDecks → { publicId, name }`
  ([GeneratorForm.tsx:186-204](src/components/generate/GeneratorForm.tsx)).
- **Front/back render to echo for the reveal-back flow:**
  [FlashcardItem.tsx:202-211](src/components/flashcards/FlashcardItem.tsx) —
  uppercase muted "Przód" over `front`, divider, "Tył" over `back`, both
  `whitespace-pre-wrap break-words`. Card data shape `FlashcardView =
  { publicId, front, back, createdAtLabel, updatedAtLabel, edited }`
  ([flashcards.ts:16-25](src/lib/flashcards.ts)).
- **ui primitives** in `src/components/ui/`: `button.tsx` (cva variants
  `default|destructive|outline|secondary|ghost|link`, sizes incl. `icon` —
  **no distinct Again/Hard/Good/Easy colour set**, style via `className` +
  `cn()`), `card.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `Modal.tsx`
  (native `<dialog>` wrapper). Missing: no radix `dialog`, no `select`, no
  `progress`, no React `badge`.
- **Rating mapping:** 4 buttons **Again / Hard / Good / Easy** →
  `Rating.Again(1)/Hard(2)/Good(3)/Easy(4)`; `repeat(card, now)` previews all
  four intervals for the button labels; `next(card, now, grade)` applies the
  chosen rating
  ([ts-fsrs-api-reference.md:52-58,77-89](context/archive/2026-07-09-srs-library-choice/ts-fsrs-api-reference.md)).
  Polish labels for the four buttons do not exist yet — a copy decision.
- **Conventions:** `@/*` alias (no deep relative paths), `cn()` for class merge
  ([utils.ts:4-6](src/lib/utils.ts)), Polish UI copy, `lucide-react` icons.

### 4. Risk #3 schedule-correctness test (the hard acceptance condition)

**Runner** ([vitest.config.ts](vitest.config.ts)): Vitest via `getViteConfig()`
so `@/*` + `astro:env/server` resolve as in the app ([:1,22,4-6]); the
Cloudflare plugin is stripped ([:13-20,38-41]); `environment: "node"`; glob
`tests/**/*.test.ts` ([:26]); `globalSetup: ["tests/setup/preflight.ts",
"tests/setup/accounts.ts"]` ordered ([:31]); `testTimeout: 30_000` ([:33-34]).

**Fixtures (the apparatus Phase 4 reuses):**
- `provisionAccounts()` mints a per-run id `Date.now().toString(36)` and
  provisions accounts A/B once via the **anon** key
  ([accounts.ts:71-74,41-63,16-18](tests/fixtures/accounts.ts)).
- `signInAndCaptureCookies` captures the `Cookie` header via `setAll` (never
  hand-rolled), failing loudly on empty
  ([session.ts:38-67,57-61](tests/fixtures/session.ts)).
- `clientFor(cookieHeader)` builds the app's real `createClient` → a read is
  **RLS-scoped exactly as the app** ([session.ts:80-84,69-72]). This reads
  schedule rows back as their owner.
- `callEndpoint` renders an API route via the Astro Container API and **injects
  `locals.user` by hand** (Container does not run middleware); the cookie → JWT
  → RLS → Postgres chain is real
  ([endpoint.ts:56-84,78-83,11-17](tests/fixtures/endpoint.ts)). JSON body only
  when `typeof body === "string"` ([:67-70]); redirects not followed ([:51-55]).

**Preflight** ([preflight.ts:132-141](tests/setup/preflight.ts)) hard-asserts,
with no env opt-out: creds set; **key is anon/publishable** (a service_role key
bypasses RLS = the only lock, [:33-64,24-31]); **host is local**
127.0.0.1/localhost ([:78-93]); **`OPENROUTER_API_KEY` unset** ([:110-118]);
stack reachable ([:120-130]). Phase 4 inherits a guaranteed-local, RLS-real
Postgres but must run against `npm run db:start`.

**Existing test conventions to follow** ([decks.test.ts](tests/isolation/decks.test.ts),
[flashcards.test.ts](tests/isolation/flashcards.test.ts),
[generate.test.ts](tests/generation/generate.test.ts)): row-based assertions
paired with an **inline positive control**; "**404, never 403**"; rows seeded by
driving the **real endpoint**, then read back with `clientFor(...)`, or queried
directly through the RLS-scoped client where no read endpoint exists
([generate.test.ts:108-128]); counts scoped by a **file-level**
`Date.now().toString(36)` namespace (distinct from the per-run id), and scoped
**twice** (by content and by the test's own deck, [generate.test.ts:166-172]);
deliberate-breakage verification (neuter the guard → confirm red).

**The deterministic-`now` oracle (the crux).** No injectable clock exists today
(the only time source is display formatting,
[flashcards.ts:36](src/lib/flashcards.ts)). The injection point is ts-fsrs's
explicit `now`: `next(card, now, grade)`, `repeat(card, now)`,
`createEmptyCard(now?)` all take `now` as a parameter; FSRS is pure/immutable
and `enable_fuzz` defaults to `false`, so with fixed inputs it is deterministic
([ts-fsrs-api-reference.md:86,83,121,186,27]). This makes the **library run an
independent oracle** and dissolves the "assertion copied from implementation"
anti-pattern. The test asserts the **property**, e.g.:

```
const scheduler = fsrs();               // FSRS-6 defaults, enable_fuzz:false
const card = createEmptyCard(NOW);
const easyDue = scheduler.next(card, NOW, Rating.Easy).card.due;
const hardDue = scheduler.next(card, NOW, Rating.Hard).card.due;
expect(easyDue.getTime()).toBeGreaterThan(hardDue.getTime());  // Easy > Good > Hard > Again
```

Then the integration layer drives the app's rating endpoint with a fixed `now`,
reads the persisted `due`/`stability`/`difficulty`/`state` back via
`clientFor(...).from("flashcard")`, and asserts they match a direct ts-fsrs call
with the same `now`+rating (persistence) **and** the ordering holds.

**"Survives a restart"** needs no fake clock: rate a card, then re-read via a
**fresh** `clientFor(...)` (new client instance = the restart) and assert the
schedule columns persisted unchanged.

**Where it lives** (test-plan §6): the **unit** rating→next-review mapping test
is the anticipated §6.1 home ("Phase 4 extends this…"); the **integration**
tests go in a **new `tests/study/` (or `tests/srs/`) folder** (§6.2's
"sibling folder named after the concern"), files named after the resource, one
file per resource. Run `npm test` or `npx vitest run tests/study/<file>.test.ts`.
Phase 4's final sub-phase fills in a §6 SRS cookbook entry and a §6.6 note.

## Code References

- `supabase/migrations/20260705180246_init_core_schema.sql:57-66,83-149` — `flashcard` DDL (no SRS columns) + the RLS/grants/trigger template
- `supabase/migrations/20260712162349_generation_session.sql:9-12,21-74,46-49` — separate-table + immutable/append-only + additive-nullable-FK precedent
- `supabase/migrations/20260710195327_manual_card_source.sql:6-7,30-31` — additive column; empty-table `not null` shortcut (does NOT apply now)
- `supabase/migrations/20260712162359_deck_keyword_search.sql:38-65` — `security invoker` RPC precedent (keeps RLS)
- `src/db/database.types.ts:65-76` — `flashcard.Row` (confirms absent SRS columns)
- `src/lib/flashcards.ts:42,63-70,29-37` — `STATE_ACCEPTED=2` accepted-only filter + preformatted-date helper
- `src/lib/decks.ts:4-42`, `src/lib/generations.ts:4-9,29-34` — data-access convention (client-arg, raw `{data,error}`, RETURNING, compensating update)
- `src/pages/api/generate.ts:37-101` — JSON-endpoint contract (Zod validate, auth guard, error-vs-empty, status codes)
- `src/pages/api/decks/[publicId]/cards/index.ts` — form-POST→redirect endpoint + UUID param validation
- `src/pages/decks/[publicId]/index.astro:141-166`, `src/pages/generate.astro:11-33` — loader + island prop-passing
- `src/middleware.ts:4,23-27` — `PROTECTED_ROUTES` (must add study paths)
- `src/components/Sidebar.astro:25-31,106-132` — disabled "Nauka" item to enable
- `src/layouts/AuthenticatedLayout.astro:5-73` — layout + `activeItem="study"` already typed
- `src/components/generate/GeneratorForm.tsx:71,127-161,186-204` — fetch-JSON state machine + native `<select>` deck picker
- `src/components/flashcards/FlashcardItem.tsx:202-211` — front/back render to echo
- `vitest.config.ts:22,26,31,33` — runner config
- `tests/fixtures/{accounts,session,endpoint}.ts` — the reusable harness
- `tests/setup/preflight.ts:132-141` — the hard, no-opt-out gate
- `tests/isolation/decks.test.ts`, `tests/generation/generate.test.ts:108-128,166-172` — assertion + count-scoping conventions
- `context/archive/2026-07-09-srs-library-choice/ts-fsrs-api-reference.md:52-58,77-89,86` — Rating enum, study loop, `next(card, now, grade)`

## Architecture Insights

- **Progressive schema disclosure is the project's deliberate pattern** — F-01
  built only Deck/Flashcard, S-04 added `generation_session`, and SRS fields
  were explicitly deferred to S-03 ([roadmap.md:93](context/foundation/roadmap.md)).
  S-03 owns the FSRS schema; it is expected, not scope creep.
- **RLS is the single lock; the app carries no `user_id` predicates on read.**
  Every design choice (columns-on-flashcard inherits RLS for free; a new table
  needs its own policy; service-role is banned; preflight asserts anon-only)
  flows from this. A schema choice that breaks the RLS inheritance is the
  highest-risk mistake.
- **Two mutation idioms are a real fork, not an accident**: fetch-JSON (no
  reload, structured response) vs. form-POST→redirect (full reload). The
  interactive rate→next-card loop points at fetch-JSON.
- **The "state" collision is the sharpest correctness trap** — conflating
  `state_id` (lifecycle) with FSRS `State` (scheduling) would both corrupt the
  session-entry gate and the schedule. Keep them separate columns with distinct
  names (prior research suggests `srs_state`).
- **The Risk #3 oracle is not a testing afterthought — it constrains the S-03
  design.** For the integration test to assert exact `due`, S-03 must thread an
  injectable `now` into the rating path. If it hardcodes `new Date()`, the exact
  mapping can only be unit-tested against ts-fsrs directly, with integration
  limited to ordering + persistence. The plan should make this an explicit S-03
  design requirement.

## Historical Context (from prior changes)

- `context/archive/2026-07-09-srs-library-choice/srs-library-research.md` — the
  F-02 buy decision: `ts-fsrs` (FSRS-6), 4-grade scale, the seven schedule
  fields, `request_retention=0.9`, `maximum_interval=36500`, and the explicit
  "`srs_state` is a separate column from `state_id`" constraint (:50-53,66-68).
- `context/archive/2026-07-09-srs-library-choice/ts-fsrs-api-reference.md` — the
  concrete API (`createEmptyCard`/`repeat`/`next`, `Card`/`ReviewLog` shapes,
  `TypeConvert` hydration helpers, "due <= now" for the session query).
- `context/foundation/test-plan.md` §2 Risk #3, §3 Phase 4, §6.1/§6.2/§6.4 —
  the QA contract this slice's test must satisfy; §7 (types not tested).
- `context/foundation/lessons.md` — SSR loader error-vs-empty (:68-73), no
  top-level `return` in `.astro` (:82-87), error-round-trip to modal (:89-94),
  polish-only-your-slice scope (:96-101), Container API `locals` injection
  (:131-136), never hand-roll the session cookie (:138-143), preflight closes
  every non-local seam (:159-164).

## Related Research

- `context/archive/2026-07-09-srs-library-choice/research.md` — the F-02 phase's
  own research artifact (library selection).
- No prior `research.md` exists for any SRS *study-session* work — this is the
  first.

## Open Questions

1. **Schema shape (load-bearing):** FSRS columns on `flashcard` (1:1, free
   RLS inheritance, `state_id`/`source_id` precedent) vs. a separate 1:1
   `flashcard_schedule` table (`generation_session` precedent). Evidence tilts
   toward columns-on-`flashcard`, but it is the planner's call.
2. **`review_log` history table in-slice or deferred?** It is the durability
   evidence for "no card is lost / survives restart" and enables
   `rollback`/`reschedule`, but may exceed the minimal slice. Affects how the
   Risk #3 "survives restart" clause is asserted.
3. **Injectable `now`.** Will S-03 thread `now` into the rating endpoint (making
   exact-`due` integration assertions possible) or hardcode `new Date()`
   (exact mapping → unit-only)? A design requirement the plan should set.
4. **`not null` + backfill.** New SRS columns on the populated `flashcard` need
   a default (FSRS `createEmptyCard()` initial values: `due=now, srs_state=0,
   stability=0, difficulty=0, reps=0, lapses=0`) or nullable + backfill. The
   empty-table shortcut used for `source_id` no longer applies.
5. **`ts-fsrs` version** to pin (decision records FSRS-6 / 4-grade only).
6. **Route naming:** `/study` + `/api/study` (English, matches convention) —
   confirm vs. Polish `/nauka`.
7. **Rating submit surface:** JSON endpoint (fetch, `generate.ts` template) vs.
   form-POST→redirect. The interactive loop points at JSON.
8. **Due query "now" source** for `due <= now` filtering (server clock), and
   whether it flows through an RPC or a lib query with `.lte("due", nowIso)`.
9. **Polish copy** for the four rating buttons (Again/Hard/Good/Easy) — none
   exist yet.
