import { describe, expect, it } from "vitest";
import { DECK_NAME_MESSAGE, NAME_MAX, NAME_MIN, QUERY_MAX, searchQuery } from "@/lib/deck-limits";

// The two pure decisions this module owns. Both live here for §6.1's reason: they are consumed in
// an `.astro` frontmatter and in a React island, neither of which any layer in this suite renders
// (§6.4, §7) — so a decision left inline is not merely untested, it is untestable.
//
// `searchQuery` is the `?q=` clamp added by C10X-40 (2026-08-01). Read `deck-limits.ts`'s own
// docblock before treating it as a security control: it is NOT one. The reflection it bounds sits
// behind a deck UUID the attacker would have to already know, which is what separates `?q=` from
// the `?error=` vector on `/decks` that `ownedRedirectMessage` exists for. This is hygiene on an
// unbounded string, and the tests below assert exactly that and nothing more.

describe("searchQuery — the ?q= clamp", () => {
  it("answers with the empty string for an absent parameter", () => {
    // `searchParams.get` returns null for a parameter that is not there, and that is the ordinary
    // case: every unfiltered deck view takes this branch, where "" is what switches the page back
    // to the full-list fetch rather than the search RPC.
    expect(searchQuery(null)).toBe("");
    expect(searchQuery("")).toBe("");
    expect(searchQuery("   ")).toBe("");
  });

  it("passes an ordinary query through untouched", () => {
    // The positive control. Without it every assertion below is satisfied by `() => ""`, which
    // would disable search entirely and read as perfect clamping.
    expect(searchQuery("fotosynteza")).toBe("fotosynteza");
    expect(searchQuery("  fotosynteza  ")).toBe("fotosynteza");
  });

  it("clamps at exactly QUERY_MAX, and accepts a query of exactly that length", () => {
    // Boundary on both sides: at the cap nothing is cut, one over is cut by one. A clamp asserted
    // only from above passes for a function that truncates everything to a shorter constant.
    const atCap = "a".repeat(QUERY_MAX);
    expect(searchQuery(atCap)).toBe(atCap);
    expect(searchQuery(atCap).length).toBe(QUERY_MAX);
    expect(searchQuery(`${atCap}b`).length).toBe(QUERY_MAX);
    expect(searchQuery("a".repeat(QUERY_MAX * 10)).length).toBe(QUERY_MAX);

    // …and it keeps the HEAD, not the tail. Every assertion above uses one repeated character, so
    // all four are satisfied by `slice(-QUERY_MAX)` — a clamp that silently returns the END of a
    // long query (verified: that mutant survived the whole file). One heterogeneous string is what
    // separates the two (C10X-40 impl-review F8).
    expect(searchQuery(`x${"a".repeat(QUERY_MAX)}`)).toBe(`x${"a".repeat(QUERY_MAX - 1)}`);
  });

  it("never leaves half a character at the cut", () => {
    // `.slice(0, QUERY_MAX)` counts UTF-16 units, so 199 ASCII plus one emoji produced a 200-unit
    // string ending in a LONE HIGH SURROGATE — ill-formed, and that is what supabase-js serialises
    // into the search RPC's request body and what the page renders into its own copy. Every other
    // case in this file uses `"a".repeat(...)`, which is exactly why the clamp's own boundary
    // assertions could not see it (C10X-40 impl-review F4).
    const halved = searchQuery(`${"a".repeat(QUERY_MAX - 1)}😀tail`);

    // The load-bearing assertion: no unpaired surrogate survives, whatever the length says.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(halved)).toBe(false);
    // The character that did not fit is dropped whole, not halved.
    expect(halved).toBe("a".repeat(QUERY_MAX - 1));

    // The control, without which "always drop the last unit" passes everything above: a pair that
    // DOES fit is kept, and the cap is still reached exactly.
    const fits = searchQuery(`${"a".repeat(QUERY_MAX - 2)}😀tail`);
    expect(fits.endsWith("😀")).toBe(true);
    expect(fits.length).toBe(QUERY_MAX);
  });

  it("trims before it clamps, so padding cannot push real text past the cap", () => {
    // Order matters and is the one thing a reimplementation gets wrong: clamp-then-trim would cut
    // the padding to the cap and leave the caller with whitespace instead of their query.
    const padded = `${" ".repeat(QUERY_MAX)}fotosynteza${" ".repeat(QUERY_MAX)}`;
    expect(searchQuery(padded)).toBe("fotosynteza");
  });
});

describe("the deck-name bound", () => {
  // The message is a member of the closed set (`redirect-errors.ts`) and is vouched for by
  // EQUALITY at every deck page's read, so a retouched wording does not change the banner — it
  // removes it. Interpolated here from the live constants rather than pasted, exactly as
  // `redirect-errors.test.ts` does for the card-content templates: importing the finished string
  // would make the assertion agree with itself.
  it("builds its message from the live bounds, without a trailing period", () => {
    expect(DECK_NAME_MESSAGE).toBe(`Nazwa talii musi mieć od ${NAME_MIN} do ${NAME_MAX} znaków`);
    expect(DECK_NAME_MESSAGE.endsWith(".")).toBe(false);
  });
});
