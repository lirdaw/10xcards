# Unchecked `failed` audit-row insert on both generation failure paths — Plan Brief

> Full plan: `context/changes/bug-generation-failed-audit-swallowed/plan.md`
> Research: `context/changes/bug-generation-failed-audit-swallowed/research.md`

## What & Why

Both failure paths in `src/pages/api/generate.ts` — the transport/timeout `catch` at `:426` (502) and
the 0-saved boundary at `:477` (422) — `await` their `status: "failed"` audit-row insert without
reading the result. A failed audit write is therefore completely silent: no row, no log (`src/`
forbids `console.*`), and the user gets the same retriable error as if the failure had been recorded.
This is the last of the three swallowed-`await` sites in this file; C10X-48 and C10X-49 are Done and
both left explicit `owned by C10X-50` annotations here.

## Starting Point

Both branches are already exercised end to end by four committed cases in
`tests/generation/failure-path.test.ts`, each asserting the `failed` row exists exactly once — so the
_landed_ arm is well owned. What no layer reaches is the insert **failing**. Meanwhile
`createGenerationSession` has no caller anywhere in `tests/` at all, the same gap C10X-49 found for
`deleteDeck`.

## Desired End State

When the audit write fails, the caller gets a distinct per-site message saying the error itself could
not be recorded (same status, still retriable), and a Sentry event is issued carrying the lost row's
forensic value — every non-private column verbatim, and `source_text`, both payloads **and the
PostgREST cause's own `message`/`details`/`hint`** as length + SHA-256 prefix rather than as
content, with only the error `code` passing verbatim as a tag. The captured exception is therefore a
**synthetic** error, never the raw `PostgrestError`: its first argument lands on the event where no
builder can reach it. Both properties are falsifiable in the suite: the privacy rule by a truth
table over fabricated rows, the wiring by a per-statement guard. What is **not** claimed is that an
owner was reached — no layer here asserts an event arrives, and that half is deferred with an owner
(`follow-ups/sentry-delivery.md`).

## Key Decisions Made

| Decision               | Choice                                                                                                                  | Why (1 sentence)                                                                                                                                                                                                          | Source         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Signal channel         | Response body **and** Sentry                                                                                            | The response is consistent and manually verifiable; Sentry is the only channel that reaches an owner                                                                                                                      | Plan           |
| Response copy          | A separate literal per site                                                                                             | The two branches carry different primary messages, and Site A's row is strictly weaker (both payloads may be null)                                                                                                        | Plan           |
| The check itself       | `if (error)` alone — no `!data` arm                                                                                     | `.single()` has no zero-row arm, so a second arm is a branch no breakage run could ever redden                                                                                                                            | Research       |
| Sentry payload         | Full row shape, content **fingerprinted**; the cause fingerprinted too, `code` verbatim; a **synthetic** captured error | `captureException`'s first argument lands where the builder cannot reach it, so passing the `PostgrestError` would leak `Failing row contains (…)` past every guard — Risk #4 needs no amendment only once that is closed | Plan-review F1 |
| Sentry evidence        | Pure truth table + per-**statement** wiring guard, **not** a DSN run; delivery deferred with an owner                   | Makes the composition falsifiable in the suite; an emitted event is provable only on a deployed Worker, and this capture is not provokable without a prod DCL change                                                      | Plan / F4      |
| Committed test         | Cross-account `42501` denial + control in its **own** `it()`                                                            | Deterministic with no double and no DDL; C10X-49 measured that a shared control never runs under its own neuter                                                                                                           | Research       |
| Manual evidence        | **Both** sites provoked                                                                                                 | Site B has never been provoked by either sibling, and the two rows differ in five fields                                                                                                                                  | Plan           |
| Status and `retriable` | Unchanged — 502 / 422, `retriable: true`                                                                                | The primary failure is the generation; nothing was written, so a repeat re-runs cleanly                                                                                                                                   | Research       |

## Scope

**In scope:** reading the insert result at both sites; two new inline response literals; a new pure
`src/lib/audit-failure-report.ts` and its truth table; one `Sentry.captureException` per site; a
wiring guard; the helper's first-ever test coverage; two manual reachability runs with controls;
doc-sync across `test-plan.md` (six ownership targets plus two new entries), `roadmap.md` (H-18), a
dated note in `src/worker.ts`, and `follow-ups/sentry-delivery.md` for the deferred delivery proof.

**Out of scope:** `src/lib/generations.ts` (unchanged); any status or `retriable` change; a
`REDIRECT_MESSAGES` member; any migration; sending user content to Sentry; a DSN-backed Sentry run;
`src/pages/api/auth/signout.ts` (**C10X-51** — the last discarded-result Supabase mutation in `src/`
after this change, which every "last of them" sentence must carve out); the `:568-570` undo-hoist
pointer C10X-49's impl-review left.

## Architecture / Approach

Split the decision from the wiring — this project's own proven shape for exactly this problem
(`src/lib/sentry-sampling.ts` + `tests/lib/sentry-wiring.test.ts`). A pure builder module takes the
row that failed to land and returns a Sentry capture context, importing no Sentry runtime, so every
privacy claim is testable with fabricated rows and no network. The endpoint owns one line per site
that calls `captureException` **and** the builder in the same expression, which is precisely the
shape the existing per-line guard already knows how to police.

## Phases at a Glance

| Phase                           | What it delivers                                                       | Key risk                                                                        |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Pure half                    | The builder + its privacy truth table; SDK-loads-under-Vitest proof    | The SDK failing to resolve would redden two committed test files                |
| 2. Wire both sites              | `if (error)`, two literals, two captures; annotations removed          | Relaying the PostgREST message would trip the raw-body sentinel guard           |
| 3. Tests, guards, breakage runs | Helper contract + wiring guard, each proved able to go red             | One run is predicted **green** — if it reddens, Phase 4's scope changes         |
| 4. Manual reachability runs     | Both sites provoked under a revoked grant, each against a control      | A restore that silently no-ops; Site B needs a temporary spec, run then deleted |
| 5. Doc-sync and bookkeeping     | Six ownership targets, two new entries, H-18, three recorded non-edits | A correction-to-a-correction with no precedent in the file                      |

**Prerequisites:** local Supabase stack up (`npm run db:start`); `OPENROUTER_API_KEY` unset for the
suite; `psql` via `docker exec -i` for Phases 3–4; a throwaway account created through the real
sign-up form for Phase 4.
**Estimated effort:** ~2–3 sessions across 5 phases — Phases 1–3 are one sitting, Phase 4 is its own
because of the DCL and restore discipline, Phase 5 is doc-heavy.

## Open Risks & Assumptions

- **The endpoint's use of the checked result has no automated witness and cannot have one.** The
  suite owns the helper's contract; two recorded manual runs own the endpoint. Nothing bridges them —
  the same boundary both siblings carry, stated up front rather than discovered at review.
- **Breakage run B5 is predicted green** — Site A's failed-audit arm returns the ORDINARY literal, so
  the user-visible bug is restored while the capture statement survives. It deliberately does **not**
  delete `if (auditError)`: that would take the capture count 2 → 1 and redden the wiring guard by
  construction, producing a red that says nothing about the coverage boundary while reading exactly
  like the falsification this run watches for (plan-review F2). A genuine red here would falsify the
  plan's central claim and widen Phase 4.
- **The Sentry half proves the call is present and composed, never that an event arrived.** No layer
  in this project asserts that Sentry invokes anything (test-plan §7, C10X-54), and C10X-54 deleted
  the one production instrument that could have shown it. Deferred with an owner rather than claimed.
- **Nothing on the new path may throw.** Site A's capture sits inside a `catch`, where a throw escapes
  the whole try/catch/finally and turns the 502 into an uncaught 500 — so `fingerprint()` cannot
  throw, and an unserializable payload resolves to a sentinel instead (plan-review F3).
- **`error_message` is the one field that passes to Sentry verbatim**, and at Site A it is an upstream
  string. It is what the lost row existed to preserve and is already stored in the database; named as
  the deliberate exception to "fingerprint everything free-form".
- **Research §8.2 mis-classifies `roadmap.md` H-17** as a live target — it is `Status: done`, hence
  dated, hence untouched. Verified during planning.

## Success Criteria (Summary)

- A failed audit write produces a distinct, per-site message on the wire with no row in the database,
  demonstrated at both sites against a control differing in exactly one privilege.
- `source_text`, both payloads and the PostgREST cause's free-form strings provably cannot reach
  Sentry — asserted by a truth table with its own positive control, and by a textual rule on the
  capture statements themselves covering **both** arguments, not only the second.
- Deleting either capture statement, inlining the payload instead of delegating, or passing the raw
  `PostgrestError` as the captured exception, turns the suite red and names the file and line.
