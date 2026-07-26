// What the study session island does with a rate response, kept out of the JSX.
//
// The companion to @/lib/http: that one decides "did this request succeed", this one
// decides what a session should DO about the answer. Both exist for the same reason — an
// island re-deciding it by hand is how StudySession.rate() ended up reading a signed-out
// redirect as a successful rating (C10X-27) — and both are pure, so they are the only part
// of an island this suite can reach at all (vitest runs `environment: "node"`; test-plan §7).

import type { JsonResult } from "@/lib/http";

/** The success shape of POST /api/study { action: "rate" } (src/pages/api/study.ts). */
export interface RateResponse {
  ok: boolean;
  alreadyApplied: boolean;
}

export interface RateOutcome {
  /** Move to the next card. */
  advance: boolean;
  /** Count this card in the end-of-session "Powtórzono kart" total. */
  countReviewed: boolean;
  /** Error copy to show, or null when the rating landed. */
  message: string | null;
  /** Offer "Pomiń kartę": this card cannot be rated in this session, retrying won't help. */
  skippable: boolean;
}

/**
 * A 404 means the card is no longer part of this session — it was rejected in the review
 * screen, or rated in another tab, since the batch (a load-time snapshot) was built. That is
 * the ONE failure a retry cannot fix, so it is the one that gets a way out; everything else
 * keeps retry-in-place. Branch on the status, never on the message text: `status` is pinned
 * by readJsonResponse precisely so this decision does not have to read Polish copy. Note
 * that status 0 is "the body was never JSON" — not a 404, and deliberately not skippable.
 */
export function rateOutcome(result: JsonResult<RateResponse>): RateOutcome {
  if (!result.ok) {
    return {
      advance: false,
      countReviewed: false,
      message: result.message,
      skippable: result.status === 404,
    };
  }

  // `alreadyApplied` is the endpoint's benign idempotent 200: the compare-and-set matched
  // zero rows because this exact rating had already landed, so NO transition happened. The
  // card is still finished for the user's purposes — advance — but counting it would let
  // the summary report more cards rescheduled than were.
  return {
    advance: true,
    countReviewed: !result.data.alreadyApplied,
    message: null,
    skippable: false,
  };
}
