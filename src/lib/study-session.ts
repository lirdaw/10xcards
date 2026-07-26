// What the study session island does with a rate response, kept out of the JSX.
//
// The companion to @/lib/http: that one decides "did this request succeed", this one
// decides what a session should DO about the answer. Both exist for the same reason — an
// island re-deciding it by hand is how StudySession.rate() ended up reading a signed-out
// redirect as a successful rating (C10X-27) — and both are pure, so they are the only part
// of an island this suite can reach at all (vitest runs `environment: "node"`; test-plan §7).

import type { JsonResult } from "@/lib/http";

/** The schedule as it stands on the server after the call — `progress` in the 200 body. */
export interface RateProgress {
  reps: number;
  due: string;
}

/**
 * The success shape of POST /api/study { action: "rate" } (src/pages/api/study.ts).
 *
 * The endpoint's 200 body also carries `ok: true`, deliberately NOT modelled here: it is
 * constant, so it carries no information, and a second field called `ok` sitting next to
 * `JsonResult.ok` in the same function is the "two axes share a name" trap this project
 * already records for state_id vs srs_state.
 *
 * `progress` IS optional here even though the endpoint always sends it, because
 * readJsonResponse casts an untrusted body without validating it — a missing field must
 * degrade, not throw.
 */
export interface RateResponse {
  alreadyApplied: boolean;
  progress?: RateProgress;
}

/**
 * Shown when the compare-and-set found the card had moved on. Deliberately NOT phrased as
 * an error: nothing failed, and the user's own grade may or may not be the one that landed.
 */
export const ALREADY_RATED_NOTICE =
  "Ta karta została w międzyczasie oceniona gdzie indziej. Oceń ją ponownie, jeśli chcesz zmienić harmonogram.";

export interface RateOutcome {
  /** Move to the next card. */
  advance: boolean;
  /** Count this card in the end-of-session "Powtórzono kart" total. */
  countReviewed: boolean;
  /** Error copy to show, or null when nothing failed. */
  message: string | null;
  /** Neutral copy: something worth saying that is NOT a failure. Never both with `message`. */
  notice: string | null;
  /** Offer "Pomiń kartę": this card cannot be rated in this session, retrying won't help. */
  skippable: boolean;
  /**
   * A fresh optimistic-lock version to adopt before the next attempt, or null to keep the
   * one the session was served with. This is what turns "your rating was discarded" into
   * "rate again and it will apply".
   */
  syncReps: number | null;
}

/**
 * A 404 means the card is no longer part of this session — it was rejected in the review
 * screen, or rated in another tab, since the batch (a load-time snapshot) was built. That is
 * the ONE failure a retry cannot fix, so it is the one that gets a way out; everything else
 * keeps retry-in-place. Branch on the status, never on the message text: `status` is pinned
 * by readJsonResponse precisely so this decision does not have to read Polish copy.
 *
 * `parsed` is the other half and is not optional: a 404 whose body is an HTML error page from
 * a proxy is not this endpoint answering, so it must not offer a skip. Only a 404 the API
 * itself produced — status AND a JSON body — means "this card left the session".
 */
export function rateOutcome(result: JsonResult<RateResponse>): RateOutcome {
  if (!result.ok) {
    return {
      advance: false,
      countReviewed: false,
      message: result.message,
      notice: null,
      skippable: result.status === 404 && result.parsed,
      syncReps: null,
    };
  }

  // `alreadyApplied` means the compare-and-set matched zero rows, so NO transition happened
  // here. Be precise about WHY, because the obvious reading is wrong: the CAS keys on
  // `.eq("reps", expectedReps)` — the optimistic-lock VERSION, not the grade (src/lib/study.ts).
  // So it says "this card was rated since the session served it", by this client or another —
  // NOT "this exact rating already landed". A second tab rating the same card with a DIFFERENT
  // grade lands here too.
  //
  // That used to `advance: true` with no message, which meant the user's grade was discarded in
  // silence — the very failure this module exists to end, surviving in the one place nobody
  // looked (impl-review F2). It does not advance any more. The user is told, and the endpoint's
  // `progress.reps` — always returned, previously ignored — is handed back so the NEXT attempt
  // carries the current version and actually applies. Losing a rating is now recoverable in
  // place rather than invisible.
  //
  // The server stays the sole authority on whether a transition happened; nothing here retries
  // on its own, because re-rating must be the user's decision (their grade may differ from the
  // one that landed, and we cannot tell — the CAS does not compare grades).
  if (result.data.alreadyApplied) {
    return {
      advance: false,
      countReviewed: false,
      message: null,
      notice: ALREADY_RATED_NOTICE,
      skippable: false,
      syncReps: result.data.progress?.reps ?? null,
    };
  }

  return {
    advance: true,
    countReviewed: true,
    message: null,
    notice: null,
    skippable: false,
    syncReps: null,
  };
}
