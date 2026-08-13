<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Checked deck undo after a failed generation-session insert

- **Plan**: `context/changes/bug-generation-deck-undo-swallowed/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-13
- **Verdict**: REVISE
- **Findings**: 0 critical, 5 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

8/8 paths ✓, 10/10 symbols ✓, brief↔plan ✓

Verified against the tree at review time: `generate.ts:596-598` verbatim as quoted; the sibling
`deckUndone` shape at `:628-632`; the `:552-553` comment's "runs on every one of these paths"
claim and the `:566` early return that falsifies it; `decks.ts:40-42`'s
`.select("public_id").maybeSingle()`; `REDIRECT_MESSAGES`' length-11 assertion at
`tests/lib/redirect-errors.test.ts:92-95`; `generate.test.ts:871`; `GeneratorForm.tsx:192`'s
absent-means-retriable read and `:224`'s verbatim replay; roadmap's last row is H-16 (H-17 free);
`test-plan.md:1731` and `:5234` both sit inside dated C10X-48 entries, as the plan states.
`deleteDeck` has exactly two production callers (`generate.ts`, `decks/[publicId]/delete.ts`) and
no caller in `tests/` — both as claimed.

Two grounding notes that did not become findings. `roadmap.md:426` also names C10X-49 (H-16's
`Parallel with:` line) and the plan already declares it a dated entry left untouched. `jira-map.md:156`
records C10X-49 with no Change ID; the plan correctly routes that to the Jira skills.

## Findings

### F1 — `retriable: true` offers a "Ponów" that provably 409s

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §1–§2 (D-03); plan-brief "Key Decisions"
- **Detail**: On the arm the plan says will actually fire (`error`, research §3/§6), the orphan deck
  EXISTS after the response. `handleRetry` replays `lastPayload` VERBATIM (`GeneratorForm.tsx:224`) —
  same key, same `newDeckName`. That request finds no keyed session (the insert failed), leaves
  `healedKey` false, meets the orphan at `deckNameExists` and returns `409 retriable:false` at
  `generate.ts:362-363`. Deterministic, every time. So the second click reproduces today's exact
  defect — misleading name-clash copy, affordance withdrawn — and the plan-brief's summary ("instead
  of a 500 followed by a name-clash 409 that takes the button away") describes an outcome the change
  does not produce. It also cuts against the endpoint's own stated convention, quoted at
  `GeneratorForm.tsx:184-186`: the flag "marks the ones a repeat provably cannot fix (the validation
  400s, the 401, the 404, the name-taken 409s)". A verbatim repeat here provably cannot fix it. D-08
  is a rule about FORGOTTEN flags disarming an affordance by omission — it does not argue for `true`
  where `false` is the measured truth, and the plan's rationale ("with copy that names the deck, a
  retry is genuinely actionable") conflates "Ponów" with a fresh submit after editing the name.
  Editing any field clears `status`/`error` and therefore the retry gate, so the recovery the copy
  describes never goes through this button. Research Open Question #2 raised this in exactly these
  terms and the plan resolved it without engaging the "provably cannot fix" clause.
- **Fix A ⭐ Recommended**: `retriable: false` on the orphan-left-behind branch, with the copy carrying
  the whole recovery route (which it already does)
  - Strength: Matches the endpoint's own documented meaning of the flag, and matches `:513`'s existing
    precedent — the name-taken 409 is flagged `false` for the identical reason. The user is steered to
    the two routes that work instead of to a button that cannot.
  - Tradeoff: It is the first `retriable: false` on a 500 in this handler; needs one sentence in
    `change.md` defending it against a naive reading of D-08.
  - Confidence: HIGH — the 409 trace is verified line-by-line in research §5 and unchanged by this plan.
  - Blind spot: On the zero-row arm (see F2) the retry WOULD work, so this flag is only unambiguously
    right if the branches split.
- **Fix B**: Keep `retriable: true`, and make "Ponów" not doomed — mint a fresh idempotency key on
  retry, or have the retry path drop `newDeckName` in favour of the orphan's `deckPublicId`
  - Strength: Delivers the outcome the brief's summary promises; the user clicks once and gets cards.
  - Tradeoff: Island + endpoint change, re-opens the adoption decision C10X-48 weighed and declined
    (D-06), and risks `generate.test.ts:871`. Far outside this change's scope.
  - Confidence: MEDIUM — plausible but unscoped here.
  - Blind spot: Interaction with the single-use heal (D-10) unexamined.
- **Decision**: FIXED via Fix A — `retriable: false`, argued in Desired End State, carried through
  Phase 1 §1, Phase 3 §4, Progress 3.6, Phase 4 §3's D-03, and both `plan-brief.md` sites (the
  Key-Decisions row and the over-promising Success-Criteria bullet).

### F2 — One literal, two arms with opposite truths

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 — the message wording
- **Detail**: `deckUndone = !deleteError && deleted !== null` is false on two arms, and the plan gives
  them one message asserting a database fact: "pusta talia o tej nazwie została utworzona". On the
  `error` arm the deck exists and the claim is true. On the zero-row arm the row did not match, i.e.
  the deck is GONE (research §6: the one realistic route is an account cascade) — the claim is FALSE
  and the retry would work. In a change whose stated premise is that the response body is the entire
  observability surface, shipping copy that states a false DB fact on one of its two branches is worth
  one word. The zero-row arm is near-unreachable, which is why this is LOW impact rather than a redesign.
- **Fix**: Hedge the assertion so it is true on both arms — e.g. "…mogła zostać pusta talia o tej
  nazwie. Jeśli tak, wybierz ją z listy talii albo zmień nazwę i spróbuj ponownie." — or split the two
  arms and give each its own literal (which also resolves F1 cleanly).
- **Decision**: FIXED — wording hedged (`mogła zostać` / `jeśli tak`), with a paragraph in Phase 1 §2
  stating the hedge is load-bearing and that tightening it means splitting the arms and the flag.
  Desired End State and `plan-brief.md` follow. The flag's own residual on the zero-row arm is
  recorded explicitly in Desired End State rather than left to be rediscovered.

### F3 — Phase 3's control run cannot run as written

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 + "Manual Testing Steps" 1–4
- **Detail**: Two procedure defects. (a) The control says "the SAME request must answer the ORDINARY
  `sessionFailure` message". It cannot. Run 1 has just left an orphan deck under that `newDeckName`,
  so the repeat is stopped at `generate.ts:362` with `409 DECK_NAME_TAKEN_MESSAGE` — before
  `createDeck`, before `:531`, before the undo. The control needs a FRESH deck name (or the orphan
  removed first — which itself needs psql or a re-grant, since `delete on public.deck` is revoked).
  (b) The step order is inconsistent with itself: Testing Strategy step 2 re-grants
  `delete on public.deck`; step 3 then says "On the state from (1)". After step 2 that state no longer
  exists, so the browser check would run against a stack that can delete decks.
- **Fix**: Reorder to 1 (both revokes, name X) → browser check on that same state → control (re-grant
  delete, name **Y**) → restore + three oracles + `npm test`. State in the Contract that the control
  uses a distinct name and why, so it is not "simplified" back later.
- **Decision**: FIXED — Phase 3 resequenced to provocation → browser check (before any re-grant) →
  control → restore. The control's contract now requires a fresh name **Y ≠ X** and states why the
  alternative (deleting X first) is worse. The restore step now covers both tables' oracles, since
  step 3 re-grants one of them. Manual Testing Steps, Success Criteria and Progress 3.3–3.5 follow;
  `plan-brief.md`'s phase table carries the trap.

### F4 — The promised recovery route is not on the screen showing the banner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §2 (copy) + Phase 3 §4 (browser check)
- **Detail**: `generate.astro:21-28` reads `listDecks` in the frontmatter and passes `decks` to the
  island as a PROP. `GeneratorForm` consumes it at `:117` and `:262` and never refetches (grep: no
  `decks` fetch anywhere in the island). The orphan is created during the failing request, i.e. AFTER
  the page rendered — so it is not in the selector the user is looking at. Only a reload puts it there.
  That makes Phase 3 §4's check weaker than it reads: its own Intent says "if it is not there the copy
  is a lie", but performed after any navigation or refresh it passes, while the user staring at the
  banner still cannot act on the sentence. Research §5 established the deck is "visible and pickable";
  what it did not check is WHEN.
- **Fix A ⭐ Recommended**: Point the copy at a route that is true without a reload — the decks page
  (`/decks`), or an explicit "odśwież stronę"
  - Strength: The sentence becomes actionable from the screen the user is on, which is the whole reason
    the message design was made this change's central decision.
  - Tradeoff: Slightly longer literal, on a banner that already renders `items-center` with no
    `break-words`.
  - Confidence: HIGH — the prop-only data flow is grep-verified.
  - Blind spot: Whether "lista talii" already reads as `/decks` to a Polish user is a copy judgement,
    not a measurement.
- **Fix B**: Keep the copy; split Phase 3 §4 into two observations — the selector WITHOUT a reload
  (expected: absent) and AFTER one (present)
  - Strength: Records the real behaviour instead of a check that can pass vacuously; no copy change.
  - Tradeoff: Ships a message whose recovery route needs a step the message does not mention.
  - Confidence: HIGH — cheap and honest.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — the literal now reads "…**odśwież stronę i** wybierz ją z listy
  talii albo zmień nazwę i spróbuj ponownie", with a paragraph in Phase 1 §2 recording the prop-only
  data flow that makes the word load-bearing. Phase 3 §2 additionally requires the sentence to be
  executed in its own order (banner → reload → selector), because reloading first makes the
  observation vacuous. Progress 3.7 and the Manual Testing Steps follow.

### F5 — Progress heading does not match its Phase header

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `plan.md:297` vs `plan.md:540`
- **Detail**: Body reads `## Phase 3: Reachability — one recorded DCL run, and the promise the copy
makes`; Progress reads `### Phase 3: Reachability — one recorded DCL run`. `progress-format.md`
  requires the Progress heading to match the `## Phase N:` header. Verified this will NOT break
  execution — `/10x-implement` matches on the `### Phase N:` prefix — but it breaks the documented
  contract and the TaskCreate label, and step titles become immutable once the plan is reviewed. All
  24 step indices and their Automated/Manual split are otherwise correct.
- **Fix**: Make the Progress heading the full body title.
- **Decision**: FIXED — Progress heading now matches `## Phase 3:` verbatim.

### F6 — Phase 2's breakage neuter reddens two cases, not one

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Success Criteria, breakage run
- **Detail**: Dropping `.maybeSingle()` makes a zero-row DELETE resolve to `[]`, not `null`. `[]` is
  truthy, so `src/pages/api/decks/[publicId]/delete.ts:37`'s `if (!deleted)` stops firing and the
  endpoint answers `302` instead of `404` — reddening the EXISTING endpoint-level denial at
  `tests/isolation/decks.test.ts:86-100` alongside the new helper case. The plan's attribution sentence
  ("the positive control must stay GREEN, which is what attributes the red to the contract rather than
  to a helper that broke for everyone") is then only half true: this neuter does break the helper for
  its other caller. Both positive controls do stay green. Predicting one red where two fire is
  precisely the class this plan cites against C10X-29's `missingLocal` neuter and C10X-30's case 8.
- **Fix**: Predict two reds in the same file and name the second, OR use a narrower neuter with cleaner
  attribution — drop `.select("public_id")` instead, which makes `data` null for BOTH callers, so the
  denial passes and only the positive control goes red.
- **Decision**: FIXED via option 1 — Phase 2 now predicts both reds by name (the new helper denial
  on `expected [] to be null`, and the endpoint denial at `:86-100` answering `302` where it expects
  `404`), states that BOTH positive controls staying green is the attribution, and records the
  narrower `.select("public_id")` alternative with the reason it was not taken: it exercises the
  `.select()` half of `lessons.md:243-248` rather than the `.maybeSingle()` half the endpoint's
  `deleted !== null` depends on. Progress 2.3 follows.

## Triage summary

All six findings fixed (F1 via Fix A, F4 via Fix A, F6 via option 1, the rest via their single fix).
No finding was skipped, accepted-as-risk or dismissed.

**Verdict after fixes: SOUND.** The two End-State findings were the load-bearing pair — the change
now removes the doomed affordance instead of offering it, and the copy that replaces it names a
route the user can actually take from the screen they are on. The two Blind-Spot findings closed a
false factual claim in the copy and a Phase 3 procedure that could not have executed as written.
Nothing in the fixes widened scope: no code beyond `generate.ts`'s one branch, no new test, no
migration.
