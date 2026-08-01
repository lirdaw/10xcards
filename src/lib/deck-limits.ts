// The deck-name bound (1..100), in ONE place — the leftover `generation-limits.ts:19-20`
// names explicitly ("Deliberately NOT here: the deck-name 1..100 bound, which lives in six
// places. Out of scope for this change, and named so the next reader knows it was left, not
// missed"). This module is that pointer's destination.
//
// The six sites it ends: the create and rename endpoints (`api/decks/index.ts`,
// `api/decks/[publicId].ts`), their two islands (`CreateDeckModal.tsx`, `DeckActions.tsx`),
// and the generation surface, which shares the NUMBER but not the wording
// (`GeneratorForm.tsx` says "Nazwa NOWEJ talii …", with a trailing period; `api/generate.ts`
// bounds `newDeckName` in Zod). Both ends of every request therefore move together, which is
// the drift test-plan §2 Risk #6 describes.
//
// This file imports nothing, exactly as `generation-limits.ts` does and for the same reason: the
// two deck islands are browser bundles and should pay only for two numbers and a string. Keep it
// that way — in particular, do NOT import `redirect-errors.ts` here; the dependency runs the
// other way, and that module is server-side because the vouching guard and its message set
// belong to the server surface. (This line used to justify the split by "it pulls a query layer
// in via flashcards.ts"; corrected 2026-08-01, C10X-37 impl-review F1 — `flashcards.ts` has only
// type imports and is already in the client bundle, so that reason was false.)
//
// The DB CHECK `deck_name_check` (`char_length(name) between 1 and 100`,
// supabase/migrations/20260705180246_init_core_schema.sql) is the second enforcer and is NOT
// generated from these constants, so the numbers are duplicated there: a change to either side
// needs a migration on the other. Same standing arrangement as FRONT_MAX/BACK_MAX
// (`src/lib/flashcards.ts:58-70`).

/** Deck-name length bounds, applied to the TRIMMED string on both ends. */
export const NAME_MIN = 1;
export const NAME_MAX = 100;

/**
 * The refusal copy both deck endpoints and both deck islands show for a name outside the
 * bounds.
 *
 * Interpolated from the constants above, and it must keep producing
 * `Nazwa talii musi mieć od 1 do 100 znaków` character for character — including the ABSENT
 * trailing period, which is what distinguishes it from `GeneratorForm`'s own "Nazwa nowej
 * talii …" copy. It is a member of the closed set (`redirect-errors.ts`), so a value a page
 * renders is vouched for by equality against exactly this string: retouch the wording here and
 * the banner does not change wording, it disappears.
 */
export const DECK_NAME_MESSAGE = `Nazwa talii musi mieć od ${NAME_MIN} do ${NAME_MAX} znaków`;
