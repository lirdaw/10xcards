# Unchecked `failed` audit-row insert on both generation failure paths — Implementation Plan

## Overview

`src/pages/api/generate.ts` discards the result of both `status: "failed"` audit-row inserts — the
transport/timeout `catch` at `:426` (answers 502) and the 0-saved boundary at `:477` (answers 422).
A failed audit write is therefore completely silent: no row, no log (`src/` forbids `console.*`), and
the user gets the same retriable error as if the failure had been recorded.

This change reads `{ error }` at both sites and signals a failed audit write on **two** channels: a
per-site response literal, and a `Sentry.captureException` carrying the lost row **fingerprinted
rather than quoted**. It is the last of the three swallowed-`await` sites in this file; C10X-48
(compensation) and C10X-49 (deck undo) are Done and both left explicit `owned by C10X-50`
annotations here.

## Current State Analysis

**The two call sites, and the five fields that differ between them:**

|                    | Site A — `generate.ts:426`                       | Site B — `generate.ts:477`                  |
| ------------------ | ------------------------------------------------ | ------------------------------------------- |
| Enclosing branch   | `catch` around `generateCandidates` (`:415`)     | `if (saved === 0)` (`:474`)                 |
| Response           | `:463` → `502 … retriable: true`                 | `:492` → `422 … retriable: true`            |
| `model`            | `resolveModel()`                                 | `result.model`                              |
| `generated_count`  | `0` (hard-coded)                                 | `result.generatedCount`                     |
| `error_message`    | `err.message` or `"Nieznany błąd generacji"`     | fixed `"Model nie zwrócił poprawnych kart"` |
| `request_payload`  | **null unless** `err instanceof OpenRouterError` | `result.rawRequest`                         |
| `response_payload` | **null unless** `err instanceof OpenRouterError` | `result.rawResponse`                        |

Identical at both: `user_id`, `source_text`, `language`, `requested_count`, `saved_count: 0`,
`status: "failed"`, `idempotency_key: null`. **Site A's row is strictly weaker even when it lands** —
both payload columns can legitimately be `null` — which is why the two sites are not interchangeable
in the response copy or in the Sentry tag.

**What already works and must not move.** `idempotency_key: null` at both sites is deliberate and is
argued in full at `:438-461`: "Ponów" replays the same key, so a keyed `failed` row would be the row
the retry collides with (plan-review F1 of the S-05 slice). The same comment forbids "simplifying"
the partial unique index's `status = 'succeeded'` predicate away on the strength of that NULL.

**The evidence position is better than either sibling's, and `change.md` understates it.**
`change.md:12` says "no test in this suite can reach these branches"; the parenthetical (module
doubles are confined to one file, §6.9) is right and the conclusion overshoots.
`tests/generation/failure-path.test.ts` drives **both** branches end to end today, and the split is
**3 to 1, not 2 to 2** — `:204`, `:249` and `:332` all land on Site A (the `:332` key-pin case
answers 502 at `:342`), while only `:292` reaches Site B. Every one goes through `sessionFor()`
(`:161-171`), which asserts **exactly one** row. So the _landed_ arm of both inserts is already
owned by four committed cases, but Site B's by a single one — which is the second reason Phase 4
provokes Site B rather than reasoning from Site A's run. What no layer can reach is the insert
**failing**.

**`createGenerationSession` has no caller anywhere in `tests/`** — exactly the state C10X-49 found
`deleteDeck` in.

## Desired End State

A failed `failed`-audit insert is:

1. **Detected** — `if (error)` at both sites, on the return of `createGenerationSession`.
2. **Signalled to the caller** — the 502/422 response carries a distinct, per-site literal naming
   that the failure could not be recorded. Status and `retriable` are unchanged.
3. **Routed toward an owner** — one `Sentry.captureException` per site, tagged with which site fired
   and with the PostgREST `code`, carrying every non-private column verbatim and `source_text` /
   `request_payload` / `response_payload` / the cause's free-form strings as **length + SHA-256
   prefix** rather than as content.
   - **Read this as "the capture is issued, present and composed", never as "an owner was
     reached"** (plan-review F4). The mechanism is verified as far as a mechanism can be here —
     `withSentry` installs the async-context strategy unconditionally, `wrangler.jsonc` carries
     `nodejs_compat`, `init()` attaches the client to the global default scope, and
     `sampleSentryEvent` passes a non-console event **unsampled** (`sentry-sampling.ts:88`) — but
     **no layer in this project asserts that an event ARRIVES**, and this change does not add one.
     That is a standing boundary, not an oversight: the capture fires only when a real
     `generation_session` insert fails in production, so provoking it would need a production DCL
     change, and C10X-54 deleted `/api/shipprobe` — the one instrument that could ever have shown a
     first-party error landing in the Sentry UI. The project's own standard (C10X-53, quoted in
     `src/worker.ts`) is that only an event in the Sentry UI proves monitoring; that proof is
     **deferred with an owner**, as a `follow-ups/` item, rather than claimed here.
4. **Guarded** — the privacy property is a truth table over fabricated rows; the wiring is a
   per-statement textual guard modelled on `tests/lib/sentry-wiring.test.ts`; the helper's error contract
   is a committed cross-account case with its positive control in its own `it()`.

Verify by: `npm test` green with the new cases; the five breakage runs in Phase 3 producing their
predicted colours (one of which is predicted **green**, deliberately); the two manual runs in Phase 4
showing the new body on the wire with no row in `psql`, each against a control differing in exactly
one privilege.

### Key Discoveries:

- **The precedent's headline rule does not transfer, and inheriting it would be a defect.**
  `createGenerationSession` is an INSERT ending `.select("id, public_id").single()`
  (`src/lib/generations.ts:24`). `.single()` sets an `Accept` header
  (`postgrest-js/dist/index.mjs:1041-1044`); the `data = null` coercion is gated on `isMaybeSingle`
  (`:357-371`) and is **unreachable through `.single()`** — verified in the installed source at
  version 2.105.3, and note the boundary: postgrest-js proves only that the CLIENT never synthesizes
  `data: null`, while "a zero row comes back as 406 / PGRST116" is a claim about the PostgREST
  server, driven by the `Accept` header `.single()` sets. A
  zero-row result comes back as `406 / PGRST116`. **`if (error)` is complete here.**
- **There is no deck to undo, provably.** `createdDeckPublicId` is declared at `:313`, assigned at
  exactly one site (`:518`, inside the `if (newDeckName && deckId === null)` opened at `:505`), and
  both insert sites return before that (`:463`, `:492`). The adoption path leaves it null on purpose
  (`:395-397`). C10X-49's `deckUndone` shape does not repeat.
- **The user-visible cost of a lost audit row is zero.** Nothing in `src/` reads `status`,
  `error_message`, `request_payload` or `response_payload`;
  `findSucceededSessionByIdempotencyKey` excludes `failed` rows by predicate; both sites write
  `idempotency_key: null`; the 502/422 bodies carry no `sessionPublicId`. The row is a pure
  write-only forensic artifact — which is why the response cannot be the only channel.
- **Importing the Sentry SDK into `src/` is safe, measured rather than argued.**
  `@sentry/cloudflare` 10.70.0 has **no** `cloudflare:` runtime import outside its `./vite` export
  (the one hit is a string literal in an AST transform). Probed under plain Node 22 ESM: the module
  loads, `captureException` is a function, and with no client it returns an event id string and does
  nothing else. `crypto.subtle.digest` is a global in both Node 22 and workerd.
- **`captureException(err, { tags, extra })` is a supported call shape** —
  `@sentry/core`'s `captureException(exception, hint?: ExclusiveEventHintOrCaptureContext)`, where
  `CaptureContext` includes `Partial<ScopeContext>` and `ScopeContext` carries `tags` and `extra`
  (`@sentry/core/build/types/scope.d.ts:22`).
- **`sampleSentryEvent` is fail-open for non-console events** (`src/lib/sentry-sampling.ts`), so a
  first-party capture passes **unsampled** — the desired behaviour, and it needs no change.
- **The raw-body sentinel trap is live, on THREE of the four cases** — `:225-227`, `:274-276`,
  `:309-311`, each `expect(raw).not.toContain(...)` over `await response.text()`. Relaying
  `error.message` from PostgREST into the response body could turn those red — which would be the
  guard working (Risk #4), and is the same constraint C10X-49 respected. **`:361` is not one of
  them and was mis-cited here** (plan-review F7): the key-pin case at `:332` never reads the
  response body at all — `:356` asserts on the OUTBOUND request body and `:361` on the audit ROW
  (`expect(JSON.stringify(row)).not.toContain(SENTINEL_KEY)`). That case is still relevant, just to
  a different claim: it is the existing pin that the API key reaches no audit column, which is the
  neighbour of this change's own privacy rule for the Sentry channel.
- **`roadmap.md` H-17 is `Status: done`, not `in progress`** (archived 2026-08-13). Research §8.2
  classifies it as a live target to edit; it is a **dated** entry, so — exactly as H-17 itself did
  with H-16 — it is left untouched and the non-edit is recorded.

## What We're NOT Doing

- **No `if (error || !data)` arm.** The second arm is unreachable through `.single()` (D-03). A
  branch no breakage run can redden is the "assertion that cannot fail" class this project treats
  as a defect.
- **No change to `src/lib/generations.ts`.** `createGenerationSession` already returns the shape the
  fix branches on. Unlike C10X-48, no helper is renamed or re-contracted.
- **No status change.** Both sites keep 502 / 422 on every arm — the primary failure is the
  generation, the audit write is secondary, and all four existing `failure-path.test.ts` cases pin
  the status.
- **No `retriable: false`.** Neither sibling's argument applies (§ D-09): nothing was written, the
  key is `null` so there is no row to collide with, no deck exists to make `deckNameExists` fire, and
  the dominant causes are transient. A failed _audit_ write must not be less retriable than the
  failure it was auditing.
- **No new `REDIRECT_MESSAGES` member.** Both literals are inline at their return sites —
  `src/lib/redirect-errors.ts:78-95` is explicit ("share the constant, not the membership") and the
  set is size-pinned at 11.
- **No `source_text`, payload or PostgREST-error CONTENT to Sentry.** Fingerprints only (D-04) —
  including the cause's `message` / `details` / `hint`, and therefore **no raw `PostgrestError` as
  the captured exception**. This is what keeps test-plan §2 Risk #4 and the PRD privacy guardrail
  intact, and it is what makes `src/worker.ts`'s `maxRequestBodySize: "none"` still mean what it
  says.
- **No touching `idempotency_key: null`, the index-predicate warning at `:438-461`, or the partial
  unique index.**
- **No migration.** Nothing in `supabase/` changes; the C10X-29 drift gate is not involved.
- **`src/pages/api/auth/signout.ts:7` is out of scope** — it is the last remaining discarded-result
  Supabase mutation in `src/` after this change, and it is **C10X-51**. Every "last of them"
  sentence this change writes must carve it out explicitly (D-11).
- **The `:568-570` pointer C10X-49's impl-review F2 left** ("hoisting the undo above this block …
  belongs to its own ticket") is **not** closed here — different branch, different defect. The plan
  says so rather than leaving it ambiguous (D-11).
- **No cloud backfill.** Already-lost audit rows are not reconstructed; there is nothing to
  reconstruct them from.
- **No Sentry DSN run.** The Sentry half's evidence is the truth table plus the wiring guard
  (D-05); an end-to-end emission is provable only on a deployed Worker and no layer here asserts it.

## Implementation Approach

Split the decision from the wiring, which is this project's own proven shape for exactly this
problem — `src/lib/sentry-sampling.ts` (the pure decision, truth-tabled) plus
`tests/lib/sentry-wiring.test.ts` (a per-line guard that `src/worker.ts` still makes it). Applied
here that split is what turns the privacy property from an argument into an assertion:

- **`src/lib/audit-failure-report.ts`** builds the Sentry payload from the row that failed to land.
  It imports **no** Sentry runtime, takes the row as a parameter, and returns a plain object. Every
  privacy claim about it is therefore testable with fabricated rows and no network, no database and
  no Worker.
- **`src/pages/api/generate.ts`** owns the randomness-free wiring: one **statement** per site that
  calls `Sentry.captureException` **and** the builder, in the same expression — the same shape
  `sentry-wiring.test.ts` guards, with one measured difference: that statement is 136 characters and
  Prettier wraps it, so the guard here joins continuation lines before matching (Phase 2 §1,
  Phase 3 §2).

The response half is a two-arm return at each site: the existing literal when the audit row landed,
a distinct one when it did not. Both arms keep the status and `retriable: true`.

The row object literal at each site is lifted to a named `const` so it can be passed to the builder.
The large `idempotency_key` comment block stays inside that literal, unmoved.

## Critical Implementation Details

**Ordering at both sites.** The audit insert must stay where it is, before the return — the fix adds
a branch to the return, never a reordering.

**Nothing on Site A's new path may throw, and the capture statement contains TWO awaits, not one**
(plan-review F3). Site A sits inside the `catch` at `:415`, whose `finally` clears the timeout
(`:464-466`) — and a throw from a `catch` block is **not** caught by its own `try`: it runs
`finally` and then propagates out of the handler, replacing the intended 502 with an uncaught
framework 500, i.e. strictly worse than the bug being fixed. `Sentry.captureException` cannot throw
with no client (measured), which closes one of the two; the other is
`await buildAuditFailureReport(...)`, whose own contract says a non-string is `JSON.stringify`d
first, over `OpenRouterError.rawRequest` / `rawResponse` — both declared `unknown`
(`src/lib/openrouter.ts:51-52`). `JSON.stringify` throws on a circular value or a BigInt. So the
builder **must not be able to throw**: `fingerprint()` wraps both the serialisation and the digest
and returns a sentinel shape (`{ length: -1, sha256: "unserializable" }`) instead. A forensic
report is best-effort by nature and must never outrank the response it annotates — the same rule
C10X-42 applied to its report writer.

**Neither channel may relay the PostgREST error, and the second half of that sentence is the one
this plan nearly got wrong.** `failure-path.test.ts` asserts the raw body contains none of its
sentinels (three of its four cases do; the fourth, the key pin, asserts on the outbound request body
and the audit row instead); a PostgREST `message`/`details` could in principle echo submitted
values. Both new literals are therefore fixed module-local strings with no interpolation.

**The same rule binds the Sentry channel, where it is easier to miss.** `captureException`'s first
argument is serialised onto the event where no builder can reach it, so handing it `auditError`
would ship exactly the strings the paragraph above forbids — outside the truth table, outside the
wiring guard, and outside `src/worker.ts`'s `maxRequestBodySize: "none"`. Hence the synthetic error
plus the fingerprinted `cause` parameter (Phase 1 §1, Phase 2 §1) and the first-argument assertion
in the wiring guard (Phase 3 §2). The concrete route is not hypothetical: `generation_session`
carries `check (char_length(source_text) > 0)`
(`supabase/migrations/20260712162349_generation_session.sql:25`), and a Postgres CHECK violation
puts `Failing row contains (…)` — the whole row — into DETAIL, which PostgREST forwards.

**The fingerprint is async.** `crypto.subtle.digest` returns a Promise, so
`buildAuditFailureReport` is `async` and the call site awaits it inline — which keeps the capture on
one line and therefore guardable. This is on a failure path that has already awaited several
round-trips; the cost is a single hash of at most `SOURCE_MAX` characters.

**`PostgrestError` may have no `code`.** On a transport failure postgrest-js falls back to
`{ message: body }` (`index.mjs:372-386`), and a thrown `fetch` yields `{ code: "", status: 0 }`
(`:319-332`). Nothing in this change may branch on `error.code`.

## Phase 1: The pure half — the report builder and its privacy truth table

### Overview

Build and test the thing that decides what leaves the process, before anything calls it. Nothing in
`src/pages/` changes in this phase.

### Changes Required:

#### 1. The report builder

**File**: `src/lib/audit-failure-report.ts` (new)

**Intent**: Turn the `generation_session` row that failed to insert into a Sentry capture context
that carries the row's forensic value without carrying the user's content. It exists as a separate
module for one reason and the header must say so: it makes the privacy property assertable by a
test instead of by a reviewer's attention.

**Contract**:

- `export type AuditFailureSite = "transport-failure" | "zero-saved";`
- `export interface ContentFingerprint { length: number; sha256: string }` — `sha256` is the first
  16 hex characters of the SHA-256 digest.
- `export async function fingerprint(value: unknown): Promise<ContentFingerprint | null>` — `null`
  in and `undefined` in give `null` out; a non-string is `JSON.stringify`d first (the payload columns
  are `Json`). Exported so it is directly testable.
  - **It cannot throw, and that is a hard contract rather than a nicety** (plan-review F3): both the
    serialisation and the digest are wrapped, and an unserializable input resolves to the sentinel
    `{ length: -1, sha256: "unserializable" }`. `rawRequest` / `rawResponse` are declared `unknown`
    (`src/lib/openrouter.ts:51-52`) and `JSON.stringify` throws on a circular value or a BigInt —
    and Site A's capture sits inside a `catch`, where a throw escapes the whole try/catch/finally
    and turns the 502 into an uncaught 500. `-1` rather than `0` on purpose: a zero length is a
    legitimate reading of `""`, so a failure must not be able to masquerade as an empty value.
- `export async function buildAuditFailureReport(row: TablesInsert<"generation_session">, site: AuditFailureSite, cause: { code?: string; message?: string; details?: string | null; hint?: string | null }): Promise<{ tags: Record<string, string>; extra: Record<string, unknown> }>`
  - `tags`: `{ site, status: row.status, language: row.language, code }` — low-cardinality, so
    Sentry can group and filter on them. `code` is the PostgREST error code **verbatim**: it is a
    closed vocabulary (`42501`, `23503`, `57014`, …) and carries no submitted value. It is `""` on
    a thrown fetch (postgrest-js `index.mjs:295`), so it falls back to a fixed literal —
    an empty tag value reads as "no error" rather than as "transport".
  - `extra`: `requested_count`, `generated_count`, `saved_count`, `model`, `error_message`, plus
    `source_text`, `request_payload` and `response_payload` **replaced by their fingerprints** under
    the same key names with a `_fingerprint` suffix, so a reader cannot mistake one for the other.
  - **The cause's own free-form strings — `message`, `details`, `hint` — are fingerprinted too**,
    under `cause_message_fingerprint` / `cause_details_fingerprint` / `cause_hint_fingerprint`.
    This is the whole reason `cause` is a parameter rather than the captured exception: a Postgres
    CHECK violation puts `Failing row contains (…)` — the row, `source_text` included — into
    DETAIL, and PostgREST forwards it. `generation_session` already carries
    `check (char_length(source_text) > 0)`, so the route is one schema edit from wide rather than
    hypothetical. The header must say this: **every free-form string that leaves this process
    passes through this module**, which is what makes the truth table a total claim instead of a
    partial one.
  - `user_id` is deliberately **absent**: it identifies a person and buys nothing the tags do not.
  - **`error_message` passes verbatim at Site B** (a fixed project literal) and **at Site A it is
    `err.message`** — an upstream string. That is the one field carrying third-party text, it is
    exactly what the lost row existed to preserve, and it is already what the endpoint stores; the
    header must name it as the deliberate exception to "fingerprint everything free-form".

#### 2. The truth table

**File**: `tests/lib/audit-failure-report.test.ts` (new)

**Intent**: Prove the builder keeps what it claims to keep and drops what it claims to drop, over
fabricated rows only — no database, no network, no Worker.

**Contract**: cases covering, in both directions —

- **Privacy**: a row whose `source_text` and both payloads carry distinct sentinels produces a report
  whose `JSON.stringify` contains **none** of them.
- **Privacy of the CAUSE, which is the half a builder-only truth table would miss**: a `cause` whose
  `message`, `details` and `hint` each carry a distinct sentinel — modelled on the real shape, a
  `23514` whose `details` is `Failing row contains (…, <source text>, …)` — produces a report
  containing none of the three. `code` is asserted present and verbatim in the same case, so the
  assertion cannot be satisfied by dropping the cause wholesale.
- **The positive control for that assertion**: a fabricated _leaky_ report containing a sentinel IS
  caught by the same helper the case above uses. Without this, a builder returning `{}` satisfies
  every privacy assertion and reads as perfect protection.
- **Retention**: `requested_count`, `generated_count`, `saved_count`, `model`, `status`, `language`
  and `error_message` are present with their submitted values — so an empty report fails.
- **Fingerprint stability and discrimination**: the same input twice gives the same `sha256`; a
  one-character change gives a different one; `length` matches the input.
- **Null handling**: Site A's weaker shape — both payloads `null` — yields `null` fingerprints, and
  those are distinguishable in the report from a fingerprint of the string `"null"`.
- **The builder cannot throw**: a payload carrying a circular reference (and a second case, a
  BigInt) resolves to the `{ length: -1, sha256: "unserializable" }` sentinel, and the report is
  still produced with every other field intact. Asserted as `resolves`, never as a caught throw —
  the property is that the failure path stays on its feet, and a test that catches the throw would
  pass over an implementation that still kills the 502.
- **Site discrimination**: the two `site` values reach `tags.site` unchanged.
- **`user_id` absence**: a row carrying a sentinel `user_id` produces a report not containing it.

### Success Criteria:

#### Automated Verification:

- The new test file passes: `npx vitest run tests/lib/audit-failure-report.test.ts`
- `@sentry/cloudflare` resolves under this project's Vitest/Vite configuration, not merely under bare
  Node — proved by a throwaway spec that imports it and asserts `typeof captureException === "function"`, run once and deleted (the load risk is that `generate.ts` is imported by two committed test files)
- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full suite green: `npm test`

#### Manual Verification:

- The builder's header states, in its own words, why the module exists separately and which single
  field (`error_message`) deliberately carries free-form upstream text

---

## Phase 2: Wire both call sites

### Overview

Read the insert's result at `:426` and `:477`, branch the return, emit the capture. Remove the two
`owned by C10X-50` annotations and correct the file's own invariant sentence.

### Changes Required:

#### 1. Both failure paths

**File**: `src/pages/api/generate.ts`

**Intent**: Stop discarding the audit insert's result; answer differently when it failed; tell an
owner. Keep the primary failure — which is what the user acts on — as the leading half of both
messages.

**Contract**:

- Import `* as Sentry from "@sentry/cloudflare"` and `buildAuditFailureReport` (+ its site type and
  the fixed `AUDIT_CAPTURE_MESSAGE` literal the synthetic error carries — module-local to the
  builder, so the capture line interpolates nothing).
- At each site, lift the row literal to a named `const auditRow` (the `idempotency_key` comment block
  moves with it, unchanged), then
  `const { error: auditError } = await createGenerationSession(supabase, auditRow);`
- `if (auditError)` → one **statement** calling both, so the wiring guard can assert it per statement:
  `Sentry.captureException(new Error(AUDIT_CAPTURE_MESSAGE), await buildAuditFailureReport(auditRow, "transport-failure", auditError));`
  — and then return the failed-audit literal. Otherwise return the existing literal, unchanged.
  - **The captured exception is a SYNTHETIC error carrying a fixed module-local literal, never
    `auditError` itself**, and this is not stylistic. `captureException`'s first argument is
    serialised onto the event as `exception.values[].value`, where the builder cannot reach it — so
    passing the `PostgrestError` would send its `message`/`details`/`hint` to a third party outside
    every guard this change builds, which is the exact echo risk the "Critical Implementation
    Details" section forbids for the response body. The cause travels as the builder's third
    argument instead, fingerprinted. The cost is stated rather than hidden: Sentry groups on the
    literal and there is no upstream stack, so the `code` tag is what discriminates classes.
  - **Counted, not assumed: the Site A statement is 136 characters at its indent, against
    `printWidth: 120` — so Prettier WILL wrap it, and a naive per-LINE guard would redden correct
    code.** `tests/lib/sentry-wiring.test.ts:30-34` records the per-line rule as an accepted trade
    for a statement that happens to fit; this one does not, so the trade does not transfer. Phase 3
    §2 therefore matches per **statement** (join continuation lines before applying the patterns),
    and the deviation from the sibling guard is stated at the site with this measurement as its
    reason. Re-measure with `npm run format` once the identifiers are final rather than trusting
    this number — if a shorter builder or literal name brings it under 120, the per-line rule
    becomes available again and is the simpler guard.
- **Site A literals**: landed — `"Nie udało się wygenerować fiszek. Spróbuj ponownie."` (unchanged);
  not landed — a distinct literal naming that the error itself could not be recorded, still ending in
  a retry instruction.
- **Site B literals**: landed — `"Model nie zwrócił poprawnych fiszek. Spróbuj ponownie."`
  (unchanged); not landed — its own distinct literal, same shape.
- Both new literals are fixed strings with **no interpolation** of `auditError` (the raw-body
  sentinel constraint above).
- `retriable: true` and the status stay on every arm.

**Comments this phase owes, at the sites**: why `if (error)` alone is the whole check here while the
two branches below this one read `data` (`.single()` vs `.maybeSingle()`, and that there is no
zero-row arm to swallow); that the response is deliberately **not** the only witness any more, and
what the Sentry half does and does not prove; and that the capture carries fingerprints rather than
content, with a pointer to the builder.

#### 2. The file's invariant sentence

**File**: `src/pages/api/generate.ts` (`:609-611`, inside C10X-49's block)

**Intent**: The sentence "The exceptions left in this file are the two failure-path
`createGenerationSession` inserts, owned by C10X-50" becomes false the moment this phase lands.
C10X-49's research Open Question 5 is a direct instruction to update it rather than duplicate it.

**Contract**: it becomes a dated statement that the class is closed **in this file**, explicitly
carving out `src/pages/api/auth/signout.ts` (C10X-51) as the remaining discarded-result Supabase
mutation in `src/` — the trap `test-plan.md`'s C10X-49 ledger entry already half-set.

#### 3. The two annotations

**File**: `src/pages/api/generate.ts` (`:422-425`, `:475-476`)

**Intent**: Delete them. They exist to say "this bare `await` is deliberate and owned"; the `await`
is no longer bare.

### Success Criteria:

#### Automated Verification:

- The four existing branch cases still pass, unchanged: `npx vitest run tests/generation/failure-path.test.ts`
- Full suite green: `npm test`
- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- No first-party log line was introduced: `npx vitest run tests/lib/no-logging.test.ts`
- No forbidden env accessor was introduced: `npx vitest run tests/lib/no-env-access.test.ts`

#### Manual Verification:

- Both new literals lead with the primary failure and its action ("Ponów"), and the audit clause
  reads as **informational** — it must not imply a different or additional action, because there is
  none. Reworded from "one sentence a user can act on", which was **unsatisfiable as written**
  (plan-review F6): this change's own Key Discovery is that the user-visible cost of a lost audit
  row is zero, so status, `retriable` and the next move are identical on both arms. Unlike the two
  siblings — C10X-49's literal named an orphan deck the user would collide with, C10X-48's a
  poisoned key — this clause describes a record the user cannot see. Say so, and check the
  weaker property that IS achievable: it does not read as a second problem to solve
- `git diff` shows the `idempotency_key` comment block moved verbatim, with no wording change

---

## Phase 3: Committed tests, guards, and the breakage runs that prove them

### Overview

Close the helper's error contract (no caller in `tests/` today), guard the Sentry wiring, and prove
each new assertion can go red. One prediction here is **green**, deliberately — it is how the
coverage boundary gets measured instead of asserted.

### Changes Required:

#### 1. The helper's error contract

**File**: `tests/generation/generate.test.ts`

**Intent**: `createGenerationSession` has no caller anywhere in `tests/`. Close the arm the fix
branches on — and note it differs from both siblings': they closed a **zero-row** arm, this closes an
**error** arm, because there is no zero-row arm to close.

**Contract**: two cases, following `tests/isolation/decks.test.ts:102-150`.

- **The denial `it()`**: `createGenerationSession(clientFor(b.cookieHeader), { user_id: a.userId, … })`
  resolves `data === null` with a **non-null** `error` — `generation_session_insert`'s `WITH CHECK`
  is `user_id = (select auth.uid())`, so this raises `42501` deterministically with no double, no
  DDL and no fabrication. Row-based, never return-based: assert A's table gained nothing, scoped by
  the file's `createScoping` marker with `.like(...)` and read through **`allSessions`**, never
  `succeededSessions` (which filters `status = 'succeeded'` and is blind to exactly the rows these
  branches write).
- **The positive control, in its OWN `it()`**: A's own client inserting A's own row resolves
  `error === null` with non-null `data` carrying `id` and `public_id`, and the row is readable back.
  A separate case rather than three more lines, because Vitest aborts a case at its first failed
  `expect` — C10X-49 measured a shared control never running under the very neuter it exists to be
  attributed against (`2 failed | 4 passed (6)`).
- A case-scoped count oracle of exactly one after the control's insert (`generation_session` is one
  of the six named silent seams).

#### 2. The wiring guard

**File**: `tests/lib/audit-failure-wiring.test.ts` (new)

**Intent**: Make the Sentry half falsifiable in the suite. Nothing here loads a Worker or a Sentry
client; the claim is narrower and must be stated as such — the calls are **present and composed**,
never that an event was emitted.

**Contract**: textual, per **statement**, modelled on `tests/lib/sentry-wiring.test.ts` including its
`codeLines` comment/blank filter and its two positive controls — but joining continuation lines
before matching, because the capture statement measures 136 characters against `printWidth: 120`
and Prettier wraps it (Phase 2 §1 carries the count). The sibling's per-LINE rule is an accepted
trade for a statement that fits; say at the site that this one does not, so the deviation reads as
a measurement rather than as drift. Reported line numbers stay file-true: keep the sibling's
assign-index-before-filter shape (`sentry-wiring.test.ts:59-64`) and report a joined statement at
the line it starts on.

- A read control: the file is the real handler (a token that makes it so, plus a code-line floor at
  the measured value).
- A detector control: the patterns fire on an undelegated `Sentry.captureException(err)` and on an
  inline-object capture, and stay silent on the shipped shape and on lookalikes.
- **The assertion**: exactly **two** lines in `src/pages/api/generate.ts` call
  `Sentry.captureException`, and **every** one of them also calls `buildAuditFailureReport` on the
  same line. A red names file and line.
- The import of the builder from `@/lib/audit-failure-report` is present exactly once — so the
  delegation cannot resolve to a local re-implementation with the same name.
- One assertion the sibling guard has no equivalent of, and it is this ticket's own privacy rule:
  **no capture statement mentions `source_text`, `rawRequest`, `rawResponse`, `request_payload` or
  `response_payload`.** That is the textual half of D-04; the semantic half is Phase 1's truth
  table.
- **And its other half, which is what F1 closes: every `captureException`'s FIRST argument is a
  `new Error(...)`, never `auditError`.** Without it the two halves above are jointly satisfiable
  by a call that hands the raw `PostgrestError` to Sentry — where the builder cannot reach its
  `message`/`details`/`hint` and the truth table never looks. A guard that polices the second
  argument and ignores the first is "correct on what it looks at, silent about what it never looks
  at", which is the failure shape `test-plan.md` records four times.

### Success Criteria:

#### Automated Verification:

- New and existing cases pass: `npx vitest run tests/generation/generate.test.ts tests/lib/audit-failure-wiring.test.ts`
- Full suite green: `npm test`
- Suite count measured by **running**, not by arithmetic, and recorded with its file breakdown
- **Breakage run B1** — neuter `generation_session_insert`'s `WITH CHECK` to `true` against the live
  local DB via `docker exec -i … psql`: the denial case goes red, the positive control stays
  **green**. Restore and verify with a `pg_policies` `qual`/`with_check` before/after `diff`
- **Breakage run B2, a PAIR** — (a) pass `source_text` through verbatim in the builder: the row
  privacy case goes red naming the leaked field; (b) pass the cause's `details` through verbatim:
  the CAUSE privacy case goes red instead, while (a)'s case stays green. Two edits rather than one
  because the two assertions must be shown to observe different fields — a single run leaves
  "the cause case would have caught it" as an argument. Retention, `code` and fingerprint cases
  stay green in both
- **Breakage run B3** — delete the `Sentry.captureException` line at Site A: the wiring guard goes
  red naming file and line, and `tests/lib/audit-failure-report.test.ts` stays **fully green** —
  which is the whole reason it is two files
- **Breakage run B4, a PAIR** — (a) replace the builder call with an inline object literal on the
  capture statement: the wiring guard goes red on the delegation assertion while the import
  assertion stays green; (b) swap the synthetic error back to `auditError` as the first argument
  (the F1 defect, restored): the guard goes red on the **first-argument** assertion while the
  delegation and privacy assertions stay green. The split is the attribution — it shows the
  first-argument rule is not carried incidentally by the delegation rule
- **Breakage run B5, predicted GREEN** — at Site A, make the failed-audit arm return the **ordinary**
  literal, so both arms of the return are identical: the user-visible half of the bug is restored
  and the **whole suite stays green**. Recorded as the measurement of this ticket's coverage
  boundary, not as a passing check. If it goes red, something reaches the branch that this plan says
  cannot, and Phase 4's scope changes.
  - **The neuter is the RETURN, deliberately not `if (auditError)` itself** (plan-review F2).
    Deleting the branch deletes its body, so the capture count goes 2 → 1 and Phase 3 §2's
    exactly-two assertion reddens **by construction, every time** — a red that says nothing about
    the coverage boundary while reading exactly like the falsification this criterion is watching
    for. Same lesson as C10X-46's two runs that never started: **check what your neuter does to the
    harness before you read its colour** (§6.11)
- Every restore verified: `git diff -- src/` empty plus per-file `md5sum` against a pristine copy
  taken before the first edit; the policy restore by `pg_policies` `diff`

#### Manual Verification:

- Each breakage run's observed failure string and red/green split with its denominator recorded in
  `verification.md`, read from a `--reporter=verbose` run (the default reporter names only failures,
  so a "control stayed green" claim is otherwise unobserved)
- B5's green is written up as a finding with its reasoning, in the C10X-48 idiom — "a breakage run
  that stays green is a claim about the EDIT before it is a claim about the guard"

---

## Phase 4: Manual reachability runs — both sites

### Overview

The suite owns the helper's contract; nothing in it can make the endpoint's insert fail. Two recorded
manual runs own that, each with a control differing in exactly one privilege. C10X-49's run is the
template; **Site B has never been provoked by either sibling**.

### Changes Required:

#### 1. Site A — transport failure with the grant revoked

**File**: none committed. Environment + DCL only.

**Intent**: Drive the real app through `:426` with `INSERT` revoked, and observe the new body on the
wire with no row in the database.

**Contract**, in order:

- Record the environment **before the first revoke**: local `SUPABASE_URL`, cloud credentials still
  parked under `PROD_`, **no `.dev.vars`**, `OPENROUTER_API_KEY` unset, mock-mode banner confirmed in
  the browser.
- Create a **fresh throwaway account through the real sign-up form** — never the e2e harness account;
  this run leaves artifacts.
- Dump `information_schema.role_table_grants` for `generation_session` **plus one untouched sibling**
  (`deck`) as the later `relacl` control.
- `revoke insert on public.generation_session from authenticated;` — one revoke, because unlike
  C10X-49 one is sufficient here and the write-up must say so rather than copy "two".
- Put a **bogus `OPENROUTER_API_KEY`** in `.env` (C10X-48's own recorded provocation): a real call is
  attempted, `OpenRouter HTTP 401` throws into the `catch`, and the `model` without the `(mock)`
  suffix is the proof a real call happened.
- Drive the browser; capture the wire separately; read the oracle directly in `psql` — **no new
  `generation_session` row** for that `source_text`.
- **The control run**: re-grant `INSERT`, keep the bogus key, use a fresh `source_text`. Expect the
  **ordinary** 502 literal and a `failed` row present. Without it, a message that fires on every
  failure is indistinguishable from one that fires on the right failure (C10X-49 plan-review F3).
- Restore and verify with **four** oracles: the same `information_schema` projection line for line,
  raw `pg_class.relacl` byte-identical against the untouched sibling, `has_table_privilege` = `t`,
  and the full suite green.

#### 2. Site B — zero-saved with the grant revoked

**File**: a temporary spec under `tests/generation/`, run once and **deleted**.

**Intent**: Site B is not steerable from `.env` — the model would have to return cards that all fail
Zod. The one honest route is C10X-48's method: reuse `failure-path.test.ts`'s confined
`astro:env/server` + pass-through `fetch` double to queue an upstream body whose cards all fail
validation, so `saved === 0` and the branch is entered for its real reason.

**This is a SECOND module-double file, and test-plan §6.9 forbids exactly that** — "Module doubles
live in that ONE file. If you find yourself adding a second one somewhere else, that is the moment
to re-read this section rather than to imitate it." Re-read, and the deviation is taken
deliberately (plan-review F5). Why it is admissible on §6.9's own terms: the section admits a double
only for a claim unreachable otherwise, and Site B is unreachable otherwise — `mockCards` always
returns cards that pass Zod, so no `.env` value, no fixture and no DCL can produce `saved === 0`.
Why it does not widen the rule: the file is **temporary**, runs **alone**, is **deleted**, and the
deletion is **proved** (criterion 4.2), so the suite's steady state still contains exactly one file
with a double. What is NOT claimed: that this is precedent. The next contributor reaching for a
second double meets §6.9, not this paragraph.

**Contract**:

- The spec runs **alone** (`npx vitest run <file>`), never as part of the suite — the revoked grant
  would redden unrelated files.
- Add `--disable-console-intercept`: Vitest's `agent` reporter swallowed the output on C10X-48's
  first attempt.
- Assert on the response: status `422` and the failed-audit literal; then read `psql` for the absent
  row.
- **The control**: the same spec with `INSERT` re-granted → ordinary 422 literal, row present.
- Delete the spec afterwards and prove it: `git status --porcelain -uall` clean under
  `tests/`, plus a tree-wide grep for the spec's marker.

### Success Criteria:

#### Automated Verification:

- Full suite green after every restore: `npm test`
- No committed residue from the temporary spec: `git status --porcelain -uall` shows nothing under
  `tests/`, and a tree-wide grep for its marker is clean
- Grants restored: the `information_schema` projection matches the pre-revoke dump line for line, and
  `has_table_privilege('authenticated', 'public.generation_session', 'INSERT')` is `t`

#### Manual Verification:

- Site A: the failed-audit 502 body observed on the wire, `psql` showing no row, and the control run
  showing the ordinary body **with** a row — one privilege apart
- Site B: the same pair at 422
- Sentry is a **no-op locally** (no DSN), and the run confirms the capture call does not disturb the
  response path — recorded as the incidental end-to-end evidence it is, never as proof an event was
  delivered
- The throwaway account and its artifacts named in `verification.md` and left in place as the record
- The §6.9 deviation recorded in `verification.md` on its own terms — second double, admissible
  because Site B is unreachable otherwise, temporary, run alone, deleted, deletion proved, and
  explicitly **not** precedent — rather than left to be inferred from the `git status` line

---

## Phase 5: Doc-sync and bookkeeping

### Overview

**Six ownership targets across THREE documents, six of them inside `test-plan.md` alone** — plus
`generate.ts` (3 sites, handled in Phase 2) and `roadmap.md` (2, both inside dated `done` blocks and
therefore untouched). Counted rather than carried over: an earlier draft of this line said "six
documents", which is the total-vs-breakdown slip `test-plan.md` records against C10X-39, C10X-40 and
C10X-42, committed by the phase whose whole job is correcting other people's stale claims
(plan-review F7). One of the corrections is a correction-to-a-correction, for which this file has no
precedent. Resolve every target by walking up to its enclosing **heading** with `awk` — the plan's
line numbers will have moved by the time this phase runs, and this fix moves `:426` / `:477` itself.

### Changes Required:

#### 1. `context/foundation/test-plan.md`

**Intent**: Record what this change covers and, at equal length, what it does not.

**Contract**, per target and by kind (live → edit in place; dated → an appended dated correction,
never a rewrite):

- **Header block** (live) — demote the current entry to "Previously:", write C10X-50's own block,
  stating the two-channel signal, the `.single()` boundary, the B5 green, and the evidence split.
- **§6.6, C10X-48's dated note** naming the two sites as C10X-50's — dated correction.
- **§6.6, C10X-49's dated correction to that note** — a **third** dated line. No precedent in this
  file; say so at the site rather than inventing a silent convention.
- **§6.6, C10X-49's own note** — dated correction.
- **§8, C10X-48's ledger entry** (two spots) — dated correction.
- **§8, C10X-49's entry** — dated correction, and note that it pins the literal line numbers
  `:426` / `:477`, which this change moves.
- **New §6.6 note** for C10X-50, carrying the claims table and the does-NOT-prove list.
- **New §8 ledger entry**, with the suite figure measured by running and its per-file breakdown.
- **§7's dependency-log bullet** — this is a target research did not list. Its C10X-54 dated
  correction says "no layer asserts that Sentry invokes `beforeSend` at all"; that stays true, and
  a first-party route-level capture is new information for that bullet. Add a dated note stating
  what the new guard proves (the call is present and composed) and what it still does not.
- **§6.5's `saved_count` bullet** — **checked and left alone**; every clause in it is about
  `retireGenerationSession`. Record the non-edit so nobody hunts for one.
- **§2's Risk #4 row and §3's table** — **checked and not moved**: a failed audit write is not a new
  leak scenario, and D-04 keeps user content out of the new channel. Record the non-edit, with the
  reason, because the Sentry addition is exactly what would make a reader expect a Risk #4 edit.

#### 2. `context/foundation/roadmap.md`

**Intent**: Give `/10x-archive` something to close. A change archiving with no row has vanished from
the roadmap four times (H-04, H-07, H-08, H-13) and was pre-empted twice (H-15/H-16/H-17 practice).

**Contract**: new **H-18** row and detail block at `Status: in progress`, opened during
implementation rather than backfilled; the table currently ends at H-17. `/10x-archive` owns the flip
to `done`, matching on `Change ID`. **H-17's block is `Status: done`, i.e. dated — leave it
untouched** (exactly as it did with H-16) and record the non-edit.

#### 3. `src/worker.ts` and `src/lib/sentry-sampling.ts`

**Intent**: `worker.ts`'s integration comment says `captureConsoleIntegration` "captures NONE of the
swallowed-error audit findings (C10X-48…52) — those are dropped results, and each ticket owns
checking its own error." That sentence stays **true** and precise, and it now sits next to a ticket
that sends to Sentry explicitly rather than through the console integration.

**Contract**: a dated note at the `captureConsoleIntegration` site recording that C10X-50 emits a
first-party capture from a route, that it therefore arrives **unsampled** through
`sampleSentryEvent`'s fail-open branch for `logger !== "console"`, and that this is intended.
Check `sentry-sampling.ts` and record the non-edit if none is needed.

**And the boundary in the same breath, because this file is where a reader will look for it**
(plan-review F4): the mechanism is verified — ALS strategy installed unconditionally,
`nodejs_compat` on, client on the global default scope — but **nothing in this project asserts that
an event arrives**, and C10X-54 removed the only production instrument that could have shown one.
That sentence belongs next to C10X-54's own dated correction, which already says as much about
`beforeSend`, so the two read as one claim rather than as two half-claims.

#### 5. `follow-ups/sentry-delivery.md`

**Intent**: Give the deferred half an owner instead of letting it evaporate. Every other deferral
in this project that stayed in prose alone got rediscovered (`test-plan.md` §8 records it three
times); the ones with a file got tickets.

**Contract**: name what is unproven (a first-party route capture arriving in the Sentry UI), why it
is not proven here (not provokable without a production DCL change; `/api/shipprobe` is gone), and
the two routes that would prove it — a temporary DSN pointed at a local sink during a Phase-4-style
run, or a deliberate provocation on a deployed Worker with the `deploy-runbook.md` procedure. **To
be ticketed via `/jira-backlog-sync`**, the idiom C10X-31's deferred `workflow_dispatch` leg used.

#### 4. `context/changes/bug-generation-failed-audit-swallowed/change.md`

**Intent**: `status: planned` (this plan) → `implemented` at the end, `updated` stamped; and its
claim that "no test in this suite can reach these branches" corrected — the branches are reached by
four committed cases, only the failed-insert arm is not.

**Note**: `context/foundation/jira-map.md` is owned by the Jira skills and must **not** be
hand-edited; `customfield_10041` is `/jira-finish-work`'s to fill.

### Success Criteria:

#### Automated Verification:

- Every gate green after doc-sync: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- Markdown is prettier-clean and **idempotent**: run the probe on **copies in the scratchpad**, never
  on the live files, with `--config ./.prettierrc.json` from the repo root (prettier resolves
  `plugins` relative to the config's directory)
- No stale `owned by C10X-50` claim survives: a tree-wide grep over `src/`, `tests/` and
  `context/foundation/` returns only dated historical entries

#### Manual Verification:

- Each of the six ownership targets resolved by heading and treated by kind, with the
  correction-to-a-correction called out as unprecedented at the site
- Every "last of them" sentence carves out `signout.ts` / C10X-51 explicitly
- The three recorded non-edits (§6.5, §2/§3, roadmap H-17) are written down rather than left as
  absences
- `follow-ups/sentry-delivery.md` exists and names the unproven half, its reason, and the two routes
  that would close it — so the boundary has an owner rather than only a paragraph

---

## Testing Strategy

### Unit Tests:

- `tests/lib/audit-failure-report.test.ts` — the privacy truth table, with its own positive control
  so a builder returning `{}` cannot pass; retention of the non-private columns; fingerprint
  stability, discrimination and null handling; `user_id` absence.

### Integration Tests:

- `tests/generation/generate.test.ts` — `createGenerationSession`'s **error** arm via a cross-account
  `42501`, plus its landed arm as a positive control in its own `it()`, row-based and marker-scoped
  through `allSessions`.

### Guard Tests:

- `tests/lib/audit-failure-wiring.test.ts` — exactly two `captureException` lines in `generate.ts`,
  each delegating to the builder on the same line, none mentioning a content field.

### Manual Testing Steps:

1. Record the environment, create a throwaway account, dump the grants (Phase 4).
2. Revoke `INSERT`, set a bogus OpenRouter key, drive a generation, capture the wire, read `psql`.
3. Re-grant and repeat with a fresh source text — the control.
4. Run the temporary Site B spec alone with the grant revoked, then its control, then delete it.
5. Restore and verify with the four oracles.

## Performance Considerations

One SHA-256 over at most `SOURCE_MAX` characters plus two payload serialisations, on a path that has
already awaited an LLM call and a database round-trip and is about to return an error. Negligible,
and it runs **only** on the failed-audit arm — the landed arm builds no report at all.

## Migration Notes

None. No schema change, no migration file, nothing pushed to the cloud, and the C10X-29 drift gate is
not involved.

## References

- Research: `context/changes/bug-generation-failed-audit-swallowed/research.md`
- Change identity: `context/changes/bug-generation-failed-audit-swallowed/change.md`
- The two call sites: `src/pages/api/generate.ts:426`, `:477`; their annotations `:422-425`, `:475-476`
- The invariant sentence to update: `src/pages/api/generate.ts:609-611`
- The `retriable` convention: `src/pages/api/generate.ts:98-113`
- The helper: `src/lib/generations.ts:23-25`
- The pure-decision + wiring-guard precedent: `src/lib/sentry-sampling.ts`, `tests/lib/sentry-wiring.test.ts`
- The denial + own-`it()`-control template: `tests/isolation/decks.test.ts:102-150`
- The four cases that already own the landed arm: `tests/generation/failure-path.test.ts:204`, `:249`, `:292`, `:332`
- The right reader: `tests/generation/generate.test.ts:229-236` (`allSessions`) and `:208-228` (why `succeededSessions` is blind)
- Sibling changes: `context/archive/2026-08-12-bug-generation-compensation-swallowed/`, `context/archive/2026-08-13-bug-generation-deck-undo-swallowed/`

## Decisions

| #    | Decision                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Signal on **both** channels — response body and Sentry                                                                                                                                                                                                  | The response is consistent with both siblings and manually verifiable; Sentry is the only channel that reaches an owner, and the Sentry slice parked it for exactly these tickets                                                                                                                                                                                                                                                                                                                                                                           |
| D-02 | A **per-site** response literal, not one shared — with the audit clause carried as **informational**, not as an action                                                                                                                                  | The two branches carry different primary messages and different meanings, and Site A's row is strictly weaker; the primary failure stays the leading half. The clause earns its place as Phase 4's only wire-observable oracle (psql alone shows an absent row, which the BUGGY build also produces) and for sibling consistency — **not** because the user can act on it, which they cannot: the lost row costs them nothing. Stated rather than implied, because the criterion first written here demanded an action that does not exist (plan-review F6) |
| D-03 | `if (error)` alone — **no** `!data` arm                                                                                                                                                                                                                 | `.single()` has no zero-row arm (measured in postgrest-js); a second arm would be a branch no breakage run can redden                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D-04 | Sentry carries the row with `source_text` / both payloads **fingerprinted**, and the captured exception is a **synthetic** error while the PostgREST cause travels as a builder parameter, `code` verbatim and `message`/`details`/`hint` fingerprinted | Keeps attempt identity and correlation without handing user content to a third party. The synthetic half is not decoration: `captureException`'s first argument lands on the event where the builder cannot reach it, so `captureException(auditError, …)` would leak `Failing row contains (…)` past every guard here — plan-review F1. Routing it through the builder makes "every free-form string that leaves passes through one truth-tabled module" a total claim, which is what lets Risk #4 and the PRD privacy guardrail stand unamended           |
| D-05 | The Sentry half's evidence is a pure truth table + a per-statement wiring guard, **not** a DSN run; the delivery half is **deferred with an owner** (`follow-ups/sentry-delivery.md`)                                                                   | Makes the composition falsifiable in the suite. An emitted event is provable only on a deployed Worker, this capture is not provokable without a production DCL change, and C10X-54 removed `/api/shipprobe` — so the boundary is written down AND ticketed rather than left in prose, because every prose-only deferral in this project got rediscovered (plan-review F4)                                                                                                                                                                                  |
| D-06 | The committed test closes the helper's **error** arm, with its positive control in its **own** `it()`                                                                                                                                                   | Cross-account `42501` is deterministic with no double and no DDL; C10X-49 measured that a shared control never runs under the neuter it attributes                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-07 | Manual runs cover **both** sites                                                                                                                                                                                                                        | Site B has never been provoked by either sibling; Site A's run cannot stand for it, because the two rows differ in five fields                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-08 | Status stays **502 / 422** on every arm                                                                                                                                                                                                                 | The primary failure is the generation; all four existing cases pin the status                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D-09 | `retriable` stays **true**                                                                                                                                                                                                                              | Nothing was written, the key is `null`, no deck exists, and the dominant causes are transient — a failed audit write must not be less retriable than what it audited                                                                                                                                                                                                                                                                                                                                                                                        |
| D-10 | `roadmap.md` **H-18** opened during implementation at `in progress`                                                                                                                                                                                     | The H-15/H-16/H-17 practice; a change archiving with no row has vanished from the roadmap four times                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-11 | `signout.ts` (C10X-51) and the `:568-570` hoist pointer are **out of scope**, and named as such                                                                                                                                                         | Both are different defects; the "last of them" sentence is a trap already half-set in `test-plan.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-12 | `roadmap.md`'s **H-17 block is dated (`Status: done`) and stays untouched**, contra research §8.2                                                                                                                                                       | H-17 did exactly this with H-16; the non-edit is recorded so it is not hunted for later                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The pure half — the report builder and its privacy truth table

#### Automated

- [x] 1.1 New test file passes: `npx vitest run tests/lib/audit-failure-report.test.ts` — f42aa65
- [x] 1.2 `@sentry/cloudflare` resolves under this project's Vitest/Vite config (throwaway spec, run once and deleted) — f42aa65
- [x] 1.3 Type gate passes: `npm run typecheck` — f42aa65
- [x] 1.4 Lint passes: `npm run lint` — f42aa65
- [x] 1.5 Full suite green: `npm test` — f42aa65

#### Manual

- [x] 1.6 The builder's header states why the module exists separately and names `error_message` as the deliberate free-form exception — f42aa65

### Phase 2: Wire both call sites

#### Automated

- [x] 2.1 The four existing branch cases still pass: `npx vitest run tests/generation/failure-path.test.ts`
- [x] 2.2 Full suite green: `npm test`
- [x] 2.3 Type gate passes: `npm run typecheck`
- [x] 2.4 Lint passes: `npm run lint`
- [x] 2.5 Build passes: `npm run build`
- [x] 2.6 No first-party log line introduced: `npx vitest run tests/lib/no-logging.test.ts`
- [x] 2.7 No forbidden env accessor introduced: `npx vitest run tests/lib/no-env-access.test.ts`

#### Manual

- [x] 2.8 Both new literals lead with the primary failure and "Ponów"; the audit clause is informational and does not read as a second problem to solve
- [x] 2.9 `git diff` shows the `idempotency_key` comment block moved verbatim

### Phase 3: Committed tests, guards, and the breakage runs that prove them

#### Automated

- [ ] 3.1 New and existing cases pass: `npx vitest run tests/generation/generate.test.ts tests/lib/audit-failure-wiring.test.ts`
- [ ] 3.2 Full suite green, count measured by running with its per-file breakdown: `npm test`
- [ ] 3.3 Breakage B1 — `WITH CHECK` neutered: denial red, positive control green; policy restored and `diff`ed
- [ ] 3.4 Breakage B2 (pair) — (a) `source_text` verbatim → row privacy case red; (b) cause `details` verbatim → cause privacy case red, (a)'s green; retention/`code`/fingerprint green in both
- [ ] 3.5 Breakage B3 — Site A capture line deleted: wiring guard red, truth table fully green
- [ ] 3.6 Breakage B4 (pair) — (a) inline object instead of the builder → guard red on delegation, import green; (b) `auditError` back as the first argument → guard red on the first-argument rule, delegation/privacy green
- [ ] 3.7 Breakage B5 — Site A's failed-audit arm returns the ordinary literal (both arms identical; the capture stays, so the wiring guard is untouched): **predicted GREEN**, recorded as the coverage boundary
- [ ] 3.8 Every restore verified: `git diff -- src/` empty plus per-file `md5sum`

#### Manual

- [ ] 3.9 Each run's observed failure string and split recorded from a `--reporter=verbose` run
- [ ] 3.10 B5's green written up as a finding, not as a pass

### Phase 4: Manual reachability runs — both sites

#### Automated

- [ ] 4.1 Full suite green after every restore: `npm test`
- [ ] 4.2 No committed residue from the temporary spec (`git status --porcelain -uall`, marker grep)
- [ ] 4.3 Grants restored: `information_schema` projection matches line for line; `has_table_privilege` is `t`

#### Manual

- [ ] 4.4 Site A: failed-audit 502 on the wire, no row in `psql`, plus the one-privilege-apart control
- [ ] 4.5 Site B: the same pair at 422, via the temporary spec, then deleted
- [ ] 4.6 Sentry confirmed a local no-op that does not disturb the response path — recorded as incidental, not as delivery
- [ ] 4.7 Throwaway account and artifacts named in `verification.md`
- [ ] 4.8 The §6.9 second-double deviation recorded on its own terms in `verification.md`, and explicitly not as precedent

### Phase 5: Doc-sync and bookkeeping

#### Automated

- [ ] 5.1 Every gate green: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
- [ ] 5.2 Markdown prettier-clean and idempotent (probe on scratchpad copies, `--config ./.prettierrc.json`)
- [ ] 5.3 No stale `owned by C10X-50` claim survives outside dated historical entries

#### Manual

- [ ] 5.4 Six ownership targets resolved by heading and treated by kind; the correction-to-a-correction called out as unprecedented
- [ ] 5.5 Every "last of them" sentence carves out `signout.ts` / C10X-51
- [ ] 5.6 The three non-edits (§6.5, §2/§3, roadmap H-17) recorded rather than left as absences
- [ ] 5.7 `roadmap.md` H-18 row and detail block opened at `in progress`
- [ ] 5.8 `change.md` stamped and its "no test can reach these branches" claim corrected
- [ ] 5.9 `follow-ups/sentry-delivery.md` written — the unproven delivery half, its reason, and the two routes that would close it
