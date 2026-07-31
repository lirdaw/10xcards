import { describe, expect, it } from "vitest";
import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";
import { DECK_NAME_TAKEN_MESSAGE, REDIRECT_MESSAGES, ownedRedirectMessage } from "@/lib/redirect-errors";

// The READ side of the `?error=` channel on the deck surface (test-plan §6.3, Risk #4's read
// half; C10X-34 impl-review F1, shipped here under C10X-37 by scope decision).
//
// What the defect was. Six protected `/api/*` routes are native form targets: they refuse by
// redirecting to a deck page with `?error=<message>`, and the three deck pages read that
// parameter straight into a trust-carrying red banner. Nothing checked where the value came
// from, so `/decks?open=create&error=<anything>` rendered attacker-chosen text inside this
// project's own error banner. Not XSS — React escapes — but content injection, the same
// low-grade phishing vector `ownedAuthMessage` closed on the auth pages.
//
// WHAT THIS FILE PROVES, and do not read it as more. It proves the HELPER behaves. Whether the
// pages still call it is a different claim with its own file (`error-param-guard.test.ts`), and
// whether an endpoint only ever emits set members is `tests/validation/*.test.ts`'s. Three files,
// three claims; a green run here says nothing about the other two.

const suffix = Date.now().toString(36);

describe("ownedRedirectMessage — the read side of the closed set", () => {
  it("returns a project-owned message unchanged", () => {
    expect(ownedRedirectMessage(DECK_NAME_TAKEN_MESSAGE)).toBe(DECK_NAME_TAKEN_MESSAGE);
  });

  it("rejects a crafted value, including one carrying a real message inside it", () => {
    // EQUALITY, never containment, and the second input is why. An attacker who cannot invent
    // trusted copy from scratch appends to copy the user already trusts — so the cheap
    // implementation ("does it look like one of ours?") waves through exactly the case that
    // matters. The truncation is the mirror image: a near-miss must fail too, or the check is a
    // prefix test wearing a membership test's name.
    expect(ownedRedirectMessage(`Twoje konto zostało zablokowane. Zadzwoń pod 0700-${suffix}.`)).toBeNull();
    expect(ownedRedirectMessage(`${DECK_NAME_TAKEN_MESSAGE} Zadzwoń pod 0700-${suffix}.`)).toBeNull();
    expect(ownedRedirectMessage(DECK_NAME_TAKEN_MESSAGE.slice(0, -1))).toBeNull();
  });

  it("rejects an absent or empty parameter", () => {
    // `null` is what `searchParams.get` answers for a parameter that is not there at all, and it
    // is the ordinary case — every clean page load takes this branch.
    expect(ownedRedirectMessage(null)).toBeNull();
    expect(ownedRedirectMessage("")).toBeNull();
    expect(ownedRedirectMessage("   ")).toBeNull();
  });

  // POSITIVE CONTROL, and it is what makes the three cases above falsifiable rather than
  // decorative: `() => null` satisfies all of them and reads as perfect protection. Driving the
  // WHOLE set rather than one member also means a constant added to `REDIRECT_MESSAGES` without
  // a thought for the read side cannot silently stop rendering.
  it("accepts every constant in the closed set", () => {
    expect(REDIRECT_MESSAGES.length).toBeGreaterThan(0);
    for (const message of REDIRECT_MESSAGES) {
      expect(ownedRedirectMessage(message)).toBe(message);
    }
  });

  // An empty constant renders as NO REASON AT ALL — `ServerError.tsx:8` returns null for a falsy
  // message, so a member that is `""` would make its endpoint's refusal indistinguishable from a
  // clean page load. C10X-28 added the same assertion to `AUTH_MESSAGES` after a Stryker run put
  // the mutant in front of it; the cost of carrying it here is one line.
  it("has no empty constant in the closed set", () => {
    for (const message of REDIRECT_MESSAGES) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  // The two card-content members are TEMPLATES over `FRONT_MAX`/`BACK_MAX`, not literals, so the
  // failure this pins is a moved bound leaving a stale member behind: the endpoint would then
  // redirect with "…od 1 do 250 znaków" while the set still vouched for "…do 200 znaków", and the
  // banner would disappear rather than anything going red. The expectation is INTERPOLATED from
  // the live bounds exactly as `redirect-errors.ts` builds it — importing the finished strings
  // would make the assertion agree with itself, the discipline `tests/validation/decks.test.ts`
  // records for `NAME_MESSAGE`.
  it("carries the card-content messages built from the live bounds", () => {
    expect(REDIRECT_MESSAGES).toContain(`Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków`);
    expect(REDIRECT_MESSAGES).toContain(`Tył fiszki musi mieć od 1 do ${BACK_MAX} znaków`);
  });
});
