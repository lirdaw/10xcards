// The generation input bounds (FR-003), in ONE place. Both ends of the request import
// from here — the endpoint (src/pages/api/generate.ts) and the island
// (src/components/generate/GeneratorForm.tsx) — so the client's guard and the server's
// schema cannot drift apart. That drift is exactly the mechanism test-plan §2 Risk #6
// describes ("the server trusts the client"); until now these four values existed twice.
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

/**
 * Allowed target languages. Whitelisted so a hand-crafted body cannot inject arbitrary
 * text into the LLM system prompt; `auto` = "same language as the source text".
 *
 * Values only — the island derives its own labels from these, so no UI shape lives in a
 * lib module and a language added here without a label is a type error there.
 */
export const LANGUAGES = ["auto", "polski", "angielski", "hiszpański", "niemiecki", "francuski"] as const;

export type Language = (typeof LANGUAGES)[number];

/**
 * The MODEL-facing name for each forced language — the twin of `GeneratorForm`'s
 * `LANGUAGE_LABELS`, which renders the same values for a human.
 *
 * The values above serve two contracts at once (the API's Zod enum and the
 * `generation_session.language` audit column), so they are Polish exonyms. Interpolating
 * one of those directly into the English system prompt is what produced the defect this
 * fixes: "Write the flashcards in this language: niemiecki." returned Polish cards in
 * 0/5 of the graded cards, four runs of four, while `francuski` did the same and
 * `auto` — which interpolates no name at all — was flawless at 25/25.
 * See context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md.
 *
 * Typed by the union, so a language added to LANGUAGES without a model-facing name is a
 * compile error here — the same guarantee the human-facing half already has.
 */
export const PROMPT_LANGUAGE_NAMES: Record<Exclude<Language, "auto">, string> = {
  polski: "Polish",
  angielski: "English",
  hiszpański: "Spanish",
  niemiecki: "German",
  francuski: "French",
};
