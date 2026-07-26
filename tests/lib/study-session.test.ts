import { describe, expect, it } from "vitest";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/http";
import type { JsonResult } from "@/lib/http";
import { rateOutcome } from "@/lib/study-session";
import type { RateResponse } from "@/lib/study-session";

// What the session island DOES with a rate response, extracted from the JSX so it can be
// tested at all: vitest.config.ts runs `environment: "node"`, and the plan for C10X-27
// deliberately declines to add a DOM layer, so the component around this stays unreachable
// (test-plan §7). Same move as readJsonResponse in @/lib/http — the decision lives in one
// place instead of being re-made by hand, which is how the ok/parse ordering got inverted
// in the first place.
//
// Two defects are pinned here, both recorded by the C10X-27 audit and left unfixed at the
// time:
//   1. `reviewed` incremented on every 200, including the benign `alreadyApplied: true`
//      the endpoint returns when the compare-and-set found the rating had already landed.
//      The summary could therefore claim more cards rescheduled than were.
//   2. A card rejected in the review screen (or rated in another tab) answers 404 — the
//      batch is a load-time snapshot — and the island showed an error with no way past it.
//      The session was stuck until a page reload.

const failure = (status: number, message = "boom"): JsonResult<RateResponse> => ({
  ok: false,
  message,
  status,
});

const success = (alreadyApplied: boolean): JsonResult<RateResponse> => ({
  ok: true,
  data: { ok: true, alreadyApplied },
});

describe("rateOutcome", () => {
  it("counts a rating that actually moved the schedule", () => {
    expect(rateOutcome(success(false))).toEqual({
      advance: true,
      countReviewed: true,
      message: null,
      skippable: false,
    });
  });

  // The endpoint answers a replayed rating with a benign 200 and no second transition, so
  // counting it would overstate the session. The card is still DONE, though — advancing is
  // correct, only the tally is not.
  it("advances past an already-applied rating without counting it", () => {
    const outcome = rateOutcome(success(true));

    expect(outcome.advance).toBe(true);
    expect(outcome.countReviewed).toBe(false);
    expect(outcome.message).toBeNull();
  });

  it("offers a skip on a 404 — the card left this session, so retrying cannot help", () => {
    const outcome = rateOutcome(failure(404, "Karta nie istnieje"));

    expect(outcome.skippable).toBe(true);
    expect(outcome.advance).toBe(false);
    expect(outcome.countReviewed).toBe(false);
    expect(outcome.message).toBe("Karta nie istnieje");
  });

  // Everything else keeps retry-in-place. A skip offered on a transient failure would walk
  // the user past a card that was never rated — the silent-loss bug wearing a button.
  it("does not offer a skip on a failure that retrying could still fix", () => {
    expect(rateOutcome(failure(500)).skippable).toBe(false);
    expect(rateOutcome(failure(401, SESSION_EXPIRED_MESSAGE)).skippable).toBe(false);
    // status 0 is readJsonResponse's "the body was never JSON" — notably the 200 text/html
    // a followed sign-in redirect produces. It must not be mistaken for a genuine 404.
    expect(rateOutcome(failure(0)).skippable).toBe(false);
  });
});
