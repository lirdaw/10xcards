import { describe, expect, it } from "vitest";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/http";
import type { JsonResult } from "@/lib/http";
import { ALREADY_RATED_NOTICE, rateOutcome } from "@/lib/study-session";
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

const failure = (status: number, message = "boom", parsed = true): JsonResult<RateResponse> => ({
  ok: false,
  message,
  status,
  parsed,
});

const success = (alreadyApplied: boolean, reps = 4): JsonResult<RateResponse> => ({
  ok: true,
  data: { alreadyApplied, progress: { reps, due: "2026-08-01T00:00:00.000Z" } },
});

describe("rateOutcome", () => {
  it("counts a rating that actually moved the schedule", () => {
    expect(rateOutcome(success(false))).toEqual({
      advance: true,
      countReviewed: true,
      message: null,
      notice: null,
      skippable: false,
      syncReps: null,
    });
  });

  // This case used to assert `advance: true` with no message, and that WAS the behaviour:
  // an already-applied reply moved the session on in silence. The compare-and-set keys on
  // the `reps` version, not on the grade, so "another tab rated this card with a different
  // grade" lands here too — and that user's grade was discarded without a word. The last
  // silent rating loss in the codebase, in the one place nobody looked (impl-review F2).
  //
  // Now it holds the card, says so, and hands back the server's current `reps` so the next
  // attempt carries the right version and actually applies.
  it("holds the card and offers a recovery when the rating was not applied", () => {
    expect(rateOutcome(success(true, 7))).toEqual({
      advance: false,
      countReviewed: false,
      message: null,
      notice: ALREADY_RATED_NOTICE,
      skippable: false,
      syncReps: 7,
    });
  });

  // It must be a NOTICE, never an error: nothing failed, and the island keys its error state
  // off `message` — putting copy there would hide the rating buttons the recovery needs.
  it("reports an unapplied rating as a notice, not as a failure", () => {
    const outcome = rateOutcome(success(true));

    expect(outcome.message).toBeNull();
    expect(outcome.notice).not.toBeNull();
  });

  // readJsonResponse casts the body without validating it, so a reply missing `progress`
  // must degrade to "keep the version you have" rather than throw or sync `undefined`.
  it("survives an already-applied reply that carries no progress", () => {
    const outcome = rateOutcome({ ok: true, data: { alreadyApplied: true } });

    expect(outcome.advance).toBe(false);
    expect(outcome.notice).toBe(ALREADY_RATED_NOTICE);
    expect(outcome.syncReps).toBeNull();
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
    // A 200 text/html — what a followed sign-in redirect produces — must never be mistaken
    // for a genuine 404.
    expect(rateOutcome(failure(200, "boom", false)).skippable).toBe(false);
  });

  // The status alone is not enough (impl-review F7). A 404 carrying an HTML error page is a
  // proxy or CDN answering, not this API saying "that card left your session" — retrying it
  // may well work, so it must NOT get a skip. Only status AND a JSON body together mean the
  // endpoint itself refused the card.
  it("withholds the skip on a 404 whose body was never JSON", () => {
    expect(rateOutcome(failure(404, "Karta nie istnieje")).skippable).toBe(true);
    expect(rateOutcome(failure(404, "boom", false)).skippable).toBe(false);
  });
});
