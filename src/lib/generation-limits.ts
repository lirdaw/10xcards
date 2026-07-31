// The generation input bounds (FR-003), in ONE place. Both ends of the request import
// from here — the endpoint (src/pages/api/generate.ts) and the island
// (src/components/generate/GeneratorForm.tsx) — so the client's guard and the server's
// schema cannot drift apart. That drift is exactly the mechanism test-plan §2 Risk #6
// describes ("the server trusts the client"); until now these values existed twice.
//
// Why a new module rather than an existing one. `src/lib/flashcards.ts` already
// single-sources FRONT_MAX/BACK_MAX and three islands import from it, so it would work
// mechanically — but it is the FLASHCARD resource and these are the GENERATION concern.
// `src/lib/generations.ts` is the right concern and has never been imported by a client
// component; sending its query layer to the browser to reach four numbers is the worse
// trade. This file imports nothing, so the island pays only for the values.
//
// Be honest about what this is: `StudySession.tsx` and `CandidateReviewWorkspace.tsx`
// mirror their bounds with a "Mirrors …" comment, so a commented copy is this project's
// habit and single-sourcing is the exception. This changes a convention; it does not
// repair a lapse.
//
// Deliberately NOT here: the deck-name 1..100 bound, which lives in six places. Out of
// scope for this change, and named so the next reader knows it was left, not missed.

/**
 * Hard cap on the pasted source text, applied to the RAW string.
 *
 * The asymmetry is load-bearing and both ends share it: the endpoint's schema caps the
 * untrimmed value and re-checks the MINIMUM after trimming (generate.ts), while the
 * island's `maxLength` likewise counts raw characters. So text that trims back under the
 * cap is still refused — pinned by tests/generation/generate.test.ts.
 */
export const SOURCE_MAX = 10_000;

/** How many candidate cards one generation may be asked for. */
export const COUNT_MIN = 1;
export const COUNT_MAX = 15;

// The language set used to live here too, as `LANGUAGES` / `Language` (the offered values,
// the endpoint's Zod enum and its prompt-injection guard) and, from Phase 1 of C10X-41, as
// `PROMPT_LANGUAGE_NAMES` (their model-facing English names). All three are GONE: the set
// is now the `language` table, read through `src/lib/languages.ts`, so shipping or
// retiring a language is data rather than a deploy. The three roles that value used to
// serve at once are now separate columns — `code` on the wire and in the audit column,
// `ui_label` for the selector, `prompt_name` for the model — which is the whole point of
// the change (see lessons.md, "A contract value must never be interpolated into a prompt").
//
// The shape guard the enum used to provide moved WITH the decision it belonged to:
// `LANGUAGE_CODE_RE` in `src/pages/api/generate.ts` bounds the string before any DB
// round-trip, and the table decides membership.
