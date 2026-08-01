/**
 * The `?error=` channel's closed set of messages, and the read-side guard that enforces it.
 *
 * Why this module exists (Risk #4's read half, test-plan §2; C10X-34 impl-review F1). Six
 * protected `/api/*` routes are native `<form method="POST">` targets: they refuse by
 * REDIRECTING to a deck page with `?error=<message>`, and the deck pages read that parameter
 * straight into a trust-carrying red banner. Nothing checked where the value came from, so a
 * crafted link rendered attacker-chosen text inside this project's own error banner. Not XSS
 * (React escapes) — content injection, the low-grade phishing vector `auth-errors.ts` closed on
 * the auth pages with `ownedAuthMessage`. This is that fix, on the deck surface.
 *
 * Three properties are load-bearing, all inherited from `ownedAuthMessage` and all worth
 * restating in this surface's terms:
 *
 *   - **Membership by EQUALITY, never containment.** The attack is not inventing trusted copy
 *     from scratch, it is appending to copy the user already trusts — which any "does it look
 *     like one of ours?" test waves through.
 *   - **`null` is the rejection value, and that is a decision about what the user sees.**
 *     `ServerError.tsx:8` renders nothing for a falsy message, so a value this app cannot vouch
 *     for degrades to NO BANNER rather than to a banner with hedged copy. An error the app
 *     cannot vouch for must not be shown as one.
 *   - **The guard lives beside the set it enforces**, so a producer's reworded string and the
 *     consumer's expectation cannot drift apart. Drift here is silent: a message that falls out
 *     of the set does not fail loudly, the banner simply stops appearing.
 *
 * Why this is a SECOND set rather than an extension of `AUTH_MESSAGES`. Two different jobs:
 * `auth-errors.ts` translates an upstream GoTrue failure into owned copy (a mapper, with a
 * reachability record and its own mutation-coverage run); this file only vouches for a value
 * travelling through a URL. Merging them would put both jobs in one module and give each
 * surface the other's vocabulary — a deck page would then accept "Nieprawidłowy e-mail lub
 * hasło" as one of its own. Two sets side by side is deliberate.
 *
 * **Server-side only** — and the reason is surface hygiene, not bundle weight. This paragraph
 * used to say the module "imports `flashcards.ts`, which drags a query layer with it"; corrected
 * 2026-08-01 (C10X-37 impl-review F1) because that does not survive a check, in the direction
 * that reads as reassurance: `flashcards.ts:1-2` has only `import type` (the Supabase client
 * arrives as a parameter), so there is no query layer below this module at all — and three
 * islands already import `FRONT_MAX`/`BACK_MAX` from it as VALUES
 * (`CreateFlashcardModal.tsx`, `FlashcardItem.tsx`, `CandidateItem.tsx`), so it is in the client
 * bundle regardless.
 *
 * The rule still stands on its own terms: an eleven-string vouching set and the read-side guard
 * that enforces it belong to the server surface, where the producers are. An island that needed
 * one of these strings would be reaching around the `serverError` prop the page already passes
 * it. Because the old reason was false, the rule is now ENFORCED rather than asserted —
 * `tests/lib/no-client-redirect-errors.test.ts` fails if anything under `src/components/`
 * imports this module. The browser-safe half of the deck vocabulary is `deck-limits.ts`, which
 * imports nothing.
 */
import { DECK_NAME_MESSAGE } from "@/lib/deck-limits";
import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";

// Every constant below is the string its endpoint ALREADY redirected with; this module is
// their single definition, not a rewording. The values are asserted by equality in
// tests/validation/*.test.ts and vouched for by equality at every deck page's read, so a
// "tidied" string is a set member silently removed.

/** Emitted by all six endpoints before they reach any query, when `createClient` returns null. */
export const SUPABASE_UNCONFIGURED_MESSAGE = "Supabase nie jest skonfigurowany";

/** Deck name outside 1..100. Defined in `deck-limits.ts` so the islands can have it too. */
export { DECK_NAME_MESSAGE };

export const DECK_NAME_TAKEN_MESSAGE = "Talia o tej nazwie już istnieje";
export const DECK_CREATE_FAILED_MESSAGE = "Nie udało się utworzyć talii";
export const DECK_RENAME_FAILED_MESSAGE = "Nie udało się zmienić nazwy talii";
export const DECK_DELETE_FAILED_MESSAGE = "Nie udało się usunąć talii";
export const CARD_CREATE_FAILED_MESSAGE = "Nie udało się utworzyć fiszki";
export const CARD_SAVE_FAILED_MESSAGE = "Nie udało się zapisać zmian";
export const CARD_DELETE_FAILED_MESSAGE = "Nie udało się usunąć fiszki";

// Interpolated from the live bounds rather than copied, so moving FRONT_MAX/BACK_MAX cannot
// leave a stale member behind. The `1` is the endpoints' own lower bound, which has never had a
// constant — see cards/index.ts:70.
export const CARD_FRONT_MESSAGE = `Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków`;
export const CARD_BACK_MESSAGE = `Tył fiszki musi mieć od 1 do ${BACK_MAX} znaków`;

/**
 * Every value the six redirect-style endpoints can ever put in `?error=`.
 *
 * A test asserts membership against this set, which is what makes "the URL carries only
 * project-owned copy" checkable rather than argued case by case. Adding a message to an
 * endpoint means adding it here — otherwise the endpoint's own refusal renders as no banner.
 *
 * THREE of these constants are also reused, verbatim, by the three JSON endpoints, which answer
 * with a JSON body and never redirect: `api/generate.ts` takes `SUPABASE_UNCONFIGURED_MESSAGE`,
 * `DECK_NAME_TAKEN_MESSAGE` and `DECK_CREATE_FAILED_MESSAGE`; `api/study.ts` and
 * `cards/batch.ts` take the first. (Said "two" until 2026-08-01 — C10X-37 impl-review F4.)
 * That is copy reuse, not a channel change: this module is the home of the STRING, while the
 * guard below is about the `?error=` channel specifically.
 *
 * Which is why the ARRAY is not the place to follow that reuse. A message only a JSON endpoint
 * emits must NOT be added here: every member is a value the deck pages will render from a URL,
 * so adding one widens what a crafted link can surface without any producer needing it. Share
 * the constant, not the membership.
 */
export const REDIRECT_MESSAGES: readonly string[] = [
  SUPABASE_UNCONFIGURED_MESSAGE,
  DECK_NAME_MESSAGE,
  DECK_NAME_TAKEN_MESSAGE,
  DECK_CREATE_FAILED_MESSAGE,
  DECK_RENAME_FAILED_MESSAGE,
  DECK_DELETE_FAILED_MESSAGE,
  CARD_CREATE_FAILED_MESSAGE,
  CARD_SAVE_FAILED_MESSAGE,
  CARD_DELETE_FAILED_MESSAGE,
  CARD_FRONT_MESSAGE,
  CARD_BACK_MESSAGE,
];

/**
 * The READ side: an untrusted `?error=` value in, one of this project's own messages or
 * nothing out.
 *
 * Called at the page's read — `ownedRedirectMessage(Astro.url.searchParams.get("error"))` — and
 * nowhere later. It cannot be moved into the islands: every one of them seeds
 * `React.useState(serverError)` at first render, so the value is already captured by the time
 * their `history.replaceState` cleanup strips the parameter from the URL.
 */
export function ownedRedirectMessage(raw: string | null): string | null {
  if (raw === null) return null;
  return REDIRECT_MESSAGES.includes(raw) ? raw : null;
}
