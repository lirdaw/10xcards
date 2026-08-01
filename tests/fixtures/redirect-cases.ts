/**
 * Shared apparatus for the redirect-style (native form) endpoint cases — test-plan §6.10.
 *
 * WHY IT IS A FIXTURE. Both halves below were authored in `tests/validation/cards.test.ts`
 * (C10X-30) and are needed verbatim by `tests/validation/decks.test.ts` (C10X-37), which
 * covers the two endpoints C10X-30's sweep missed. A character-for-character copy between
 * two test files is the drift `tests/fixtures/scoping.ts` was extracted to end (C10X-28
 * impl-review F7) — `tests/fixtures/` is where shared apparatus lives, so this arrived here
 * rather than as a second copy.
 *
 * Neither function touches the database, the container or an account, so importing it costs
 * a test file nothing it was not already paying.
 */

/** The origin every `callEndpoint` Request is built against (`tests/fixtures/endpoint.ts`). */
const ORIGIN = "http://localhost:4321";

/**
 * A string of EXACTLY `length` characters, opening with `marker` so each case's rows and
 * failure strings are identifiable.
 *
 * ASCII padding on purpose, and it is load-bearing on every surface that has a DB CHECK
 * beneath the endpoint: `char_length` counts code points while the endpoint counts UTF-16
 * units, so `char_length <= .length` always and a boundary string built from astral
 * characters measures differently on the two sides — the case then stops testing the bound
 * it names. See `supabase/migrations/20260728104500_flashcard_content_bounds.sql` for the
 * card side and `deck_name_check` (`20260705180246_init_core_schema.sql:45`) for the deck one.
 */
export function sized(marker: string, length: number): string {
  return (marker + "x".repeat(length)).slice(0, length);
}

/**
 * The decoded `error` param of a redirect's `Location`.
 *
 * Assert what this returns by EQUALITY, never with `toContain("error=")`: when the guard
 * under test stops working the request does not stop being a redirect — it falls through to
 * another error branch of the same handler, which redirects with a DIFFERENT owned message
 * under the same `error=` key. Measured in C10X-30's breakage run 1, where only the equality
 * assertion went red (test-plan §6.10).
 */
export function errorParam(location: string | null): string | null {
  return new URL(location ?? "", ORIGIN).searchParams.get("error");
}
