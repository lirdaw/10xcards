import { describe, expect, it } from "vitest";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import type { Grade } from "ts-fsrs";
import { formatInterval, scheduleRowToCard, scheduler } from "@/lib/study";

// Pure unit tests for the SRS scheduler module — no DB. The scheduler is a
// deterministic, independent oracle (ts-fsrs is pure/immutable, enable_fuzz:false),
// so these assert the *property* Risk #3 cares about, never a copied constant.

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("study scheduler — rating→next-review ordering", () => {
  // The core Risk #3 property: a card the user knows better is deferred further.
  // Asserted against the app's own configured scheduler, not an inline fsrs(), so
  // this pins the module's config (FSRS-6 defaults) and not just the library.
  it("defers Easy further than Good, Good further than Hard, Hard further than Again", () => {
    const card = createEmptyCard(NOW);
    const due = (g: Grade) => scheduler.next(card, NOW, g).card.due.getTime();

    expect(due(Rating.Easy)).toBeGreaterThan(due(Rating.Good));
    expect(due(Rating.Good)).toBeGreaterThan(due(Rating.Hard));
    expect(due(Rating.Hard)).toBeGreaterThan(due(Rating.Again));
  });
});

describe("formatInterval — Polish relative button labels", () => {
  const later = (ms: number) => new Date(NOW.getTime() + ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // Grammatically-correct Polish (Intl handles the plural forms), chosen per tier:
  // minutes for learning steps, hours between, days for review intervals.
  it("labels sub-hour intervals in minutes", () => {
    expect(formatInterval(NOW, later(10 * MIN))).toBe("za 10 minut");
    expect(formatInterval(NOW, later(1 * MIN))).toBe("za 1 minutę");
  });

  it("labels sub-day intervals in hours", () => {
    expect(formatInterval(NOW, later(2 * HOUR))).toBe("za 2 godziny");
  });

  it("labels multi-day intervals in days", () => {
    expect(formatInterval(NOW, later(8 * DAY))).toBe("za 8 dni");
    expect(formatInterval(NOW, later(1 * DAY))).toBe("za 1 dzień");
  });
});

describe("scheduleRowToCard — DB row → ts-fsrs Card", () => {
  // study_due_cards LEFT-JOINs the schedule and SELECTs raw s.* (not coalesced in
  // the SELECT), so a never-seeded accepted card comes back with EVERY FSRS column
  // NULL. The mapping must coalesce each to its New-card literal — not just `due` —
  // so repeat()/next() get a valid New Card. This is the load-bearing case.
  it("maps a never-seeded (all-null) row to a valid New card due now", () => {
    const row = {
      public_id: "p",
      front: "f",
      back: "b",
      due: null,
      stability: null,
      difficulty: null,
      srs_state: null,
      reps: null,
      lapses: null,
      last_review: null,
    };

    const card = scheduleRowToCard(row, NOW);

    expect(card.due.getTime()).toBe(NOW.getTime());
    expect(card.stability).toBe(0);
    expect(card.difficulty).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.state).toBe(State.New);
    expect(card.last_review).toBeUndefined();
    // A New card mapped this way must be schedulable — a smoke check that the
    // shape ts-fsrs needs is intact, so `repeat` doesn't throw on a null-derived card.
    expect(() => scheduler.repeat(card, NOW)).not.toThrow();
  });

  // `scheduled_days` is written by cardToScheduleColumns and, until C10X-27, never read
  // back — so every load silently re-derived it as createEmptyCard's 0. Behaviour-neutral
  // today (the column is output-only in ts-fsrs 5.4.1 under either scheduler config), but
  // the persisted value is what FR-016's "due in 1 / 5 / 10 days" filter will read, and a
  // write-only column is the shape the learning_steps bug already shipped in once.
  it("prefers a persisted scheduled_days over the New-card literal", () => {
    const row = {
      public_id: "p",
      front: "f",
      back: "b",
      due: "2026-01-05T09:00:00.000Z",
      stability: 12.34,
      difficulty: 5.6,
      srs_state: State.Review,
      reps: 7,
      lapses: 2,
      last_review: "2025-12-20T09:00:00.000Z",
      scheduled_days: 16,
    };

    expect(scheduleRowToCard(row, NOW).scheduled_days).toBe(16);
  });

  // The RPC path cannot supply it (study_due_cards' `returns table` ends at last_review),
  // so the field is optional and its absence must still map to the New-card literal.
  it("falls back to 0 when the row carries no scheduled_days at all", () => {
    const row = {
      public_id: "p",
      front: "f",
      back: "b",
      due: "2026-01-05T09:00:00.000Z",
      stability: 12.34,
      difficulty: 5.6,
      srs_state: State.Review,
      reps: 7,
      lapses: 2,
      last_review: null,
    };

    expect(scheduleRowToCard(row, NOW).scheduled_days).toBe(0);
  });

  it("preserves persisted schedule fields for an in-cycle Review card", () => {
    const lastReview = "2025-12-20T09:00:00.000Z";
    const dueIso = "2026-01-05T09:00:00.000Z";
    const row = {
      public_id: "p",
      front: "f",
      back: "b",
      due: dueIso,
      stability: 12.34,
      difficulty: 5.6,
      srs_state: State.Review,
      reps: 7,
      lapses: 2,
      last_review: lastReview,
    };

    const card = scheduleRowToCard(row, NOW);

    expect(card.due.toISOString()).toBe(dueIso);
    expect(card.stability).toBe(12.34);
    expect(card.difficulty).toBe(5.6);
    expect(card.state).toBe(State.Review);
    expect(card.reps).toBe(7);
    expect(card.lapses).toBe(2);
    expect(card.last_review?.toISOString()).toBe(lastReview);
  });
});
