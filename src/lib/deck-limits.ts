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

/**
 * The keyword-search box's bound (FR-015).
 *
 * WHY IT EXISTS, recorded because the audit that added it also concluded the scarier reading was
 * WRONG and the next reader deserves both halves (C10X-40, 2026-08-01).
 *
 * `?q=` is the only query parameter in this app whose raw value is rendered as TEXT —
 * `FlashcardWorkspace.tsx` puts it inside `Brak fiszek pasujących do „…"` and
 * `DeckContentToolbar.tsx` seeds the input with it. That is the same content-injection SHAPE that
 * `ownedRedirectMessage` closes on `?error=`, so it was audited as a candidate for the same
 * treatment. It is not one, for a reason that is structural rather than a judgement call: the
 * reflection lives ONLY on `/decks/<publicId>`, and that page answers a hard 404 for a deck the
 * caller does not own (`[publicId]/index.astro:20-34`). **An attacker would need the UUID of the
 * victim's own deck**, which they do not have and cannot guess — where the `?error=` vector needed
 * only `/decks`, an address everyone knows. The text also lands in neutral copy rather than in the
 * red banner that reads as the app speaking. So: no vouching set, no equality guard, deliberately.
 *
 * What DID survive the audit is unremarkable and is what this constant fixes: the value was
 * unbounded, so it was reflected at unbounded length and passed at unbounded length to the search
 * RPC. Clamping is hygiene, not a security control — do not add one here believing it is.
 */
export const QUERY_MAX = 200;

/**
 * The `?q=` value as every consumer must see it: trimmed, then clamped.
 *
 * A function rather than two inline operations in the page frontmatter, for §6.1's reason: an
 * `.astro` frontmatter is unreachable by every layer in this suite, so a decision left there
 * cannot be asserted at all. Extracted, it costs one import and gains `tests/lib/deck-limits.test.ts`.
 * Trim BEFORE the clamp, so 200 characters of padding cannot push real text past the cap.
 */
export function searchQuery(raw: string | null): string {
  return (raw ?? "").trim().slice(0, QUERY_MAX);
}
