import { createEmptyCard, fsrs, generatorParameters, Rating, State, TypeConvert } from "ts-fsrs";
import type { Card, Grade } from "ts-fsrs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// Single home for SRS scheduling + queries, mirroring src/lib/flashcards.ts: every
// function takes an already-created SSR client (so all queries are RLS-scoped to the
// signed-in user), addresses cards by public_id, returns the raw { data, error } on
// writes, and uses RETURNING so a 0-row RLS no-op is distinguishable from success.
// Error mapping to Polish copy stays in the endpoint.
type Client = SupabaseClient<Database>;

// Module-level, shared scheduler: ts-fsrs is pure/immutable, so one instance is safe
// to reuse across requests. FSRS-6 defaults with fuzz OFF — the schedule must be a
// deterministic function of (card, now, grade) so Risk #3's oracle test can assert an
// exact `due` rather than a fuzzed range.
export const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 36500 }));

// Relative "za N minut/godzin/dni" label for a rating button. An interval is a
// *duration*, so it carries no timezone (unlike the absolute dates in flashcards.ts);
// Intl.RelativeTimeFormat gives the correct Polish plural form for free. Computed
// server-side and handed to the presentational island — no hydration drift.
const relFmt = new Intl.RelativeTimeFormat("pl", { numeric: "always" });
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatInterval(now: Date, due: Date): string {
  const ms = due.getTime() - now.getTime();
  if (ms < HOUR_MS) return relFmt.format(Math.round(ms / MINUTE_MS), "minute");
  if (ms < DAY_MS) return relFmt.format(Math.round(ms / HOUR_MS), "hour");
  return relFmt.format(Math.round(ms / DAY_MS), "day");
}

// One row of study_due_cards. The generated RPC return type declares every FSRS
// column non-null, but the RPC LEFT-JOINs the schedule and SELECTs raw s.* (only
// the WHERE/ORDER coalesce `due`), so a never-seeded accepted card returns EVERY
// FSRS column NULL. This shape makes that nullability explicit for the mapping.
export interface DueCardRow {
  public_id: string;
  front: string;
  back: string;
  due: string | null;
  stability: number | null;
  difficulty: number | null;
  srs_state: number | null;
  reps: number | null;
  lapses: number | null;
  last_review: string | null;
}

// Builds a ts-fsrs Card from a schedule row, coalescing every NULL FSRS field to
// its New-card literal (not just `due`) so repeat()/next() get a valid Card even
// for a card that has no schedule row yet. createEmptyCard supplies the derived
// fields (elapsed_days/scheduled_days/learning_steps); persisted columns override.
export function scheduleRowToCard(row: DueCardRow, now: Date): Card {
  const base = createEmptyCard(row.due ? new Date(row.due) : now);
  return {
    ...base,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    state: row.srs_state != null ? TypeConvert.state(row.srs_state) : State.New,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

// Inverse of scheduleRowToCard: a ts-fsrs Card → the flashcard_schedule columns to
// persist. `srs_state` stores the numeric FSRS State (0–3); `last_review` is the
// review moment ts-fsrs stamps on next(); dates serialise to ISO for timestamptz.
function cardToScheduleColumns(card: Card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    srs_state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    scheduled_days: card.scheduled_days,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

// The public view of a due card handed to the session island. No internal id: the
// card's public_id is the handle. The four preview interval labels are computed
// server-side (repeat) so the island stays presentational — no hydration drift.
// `reps` is the optimistic-lock version echoed back on rate (see rateCard).
export interface DueCardView {
  publicId: string;
  front: string;
  back: string;
  reps: number;
  intervals: { again: string; hard: string; good: string; easy: string };
}

// New-card literal columns for seeding a schedule row (matches createEmptyCard and
// the Phase 1 backfill), parameterised by the session's `now`.
function newScheduleColumns(flashcardId: number, now: Date) {
  return {
    flashcard_id: flashcardId,
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    srs_state: 0,
    reps: 0,
    lapses: 0,
    scheduled_days: 0,
  };
}

// Idempotent insert-on-conflict-do-nothing keyed on the unique flashcard_id, seeding
// New-card literals for the given cards. Safe on the read path: an existing row is
// left untouched (ignoreDuplicates ⇒ ON CONFLICT DO NOTHING), so it never resets a
// card's real schedule. Resolves the cards' internal ids RLS-scoped first, so a card
// the caller can't see contributes no row. Covers cards created after the migration
// backfill without coupling to the S-02/S-05 accept paths.
export async function ensureSchedule(supabase: Client, cardPublicIds: string[], now: Date) {
  if (cardPublicIds.length === 0) return { error: null };
  const { data: cards, error } = await supabase.from("flashcard").select("id").in("public_id", cardPublicIds);
  if (error) return { error };
  const rows = cards.map((card) => newScheduleColumns(card.id, now));
  const { error: upsertError } = await supabase
    .from("flashcard_schedule")
    .upsert(rows, { onConflict: "flashcard_id", ignoreDuplicates: true });
  return { error: upsertError };
}

// Builds the bounded session batch for a deck: the due-selection RPC (accepted-only,
// missing schedule treated as New/due-now), then seeds schedule rows for the returned
// set so a later rate() finds a row, and attaches the four preview interval labels
// via repeat(card, now). Returns { data: DueCardView[] | null, error }.
export async function listDueCards(supabase: Client, deckId: number, now: Date, limit: number) {
  const { data, error } = await supabase.rpc("study_due_cards", {
    p_deck_id: deckId,
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (error) return { data: null, error };

  // Seed rows for the whole (accepted, due) batch up front, so rating any card in the
  // session hits an existing schedule row for the compare-and-set. Idempotent.
  const { error: ensureError } = await ensureSchedule(
    supabase,
    data.map((row) => row.public_id),
    now,
  );
  if (ensureError) return { data: null, error: ensureError };

  const views: DueCardView[] = data.map((row) => {
    // The generated RPC type declares FSRS columns non-null; at runtime a never-seeded
    // card returns them NULL (see DueCardRow, which widens them). scheduleRowToCard
    // coalesces each to its New-card literal, so the non-null → nullable widening is safe.
    const card = scheduleRowToCard(row, now);
    const preview = scheduler.repeat(card, now);
    return {
      publicId: row.public_id,
      front: row.front,
      back: row.back,
      reps: card.reps,
      intervals: {
        again: formatInterval(now, preview[Rating.Again].card.due),
        hard: formatInterval(now, preview[Rating.Hard].card.due),
        good: formatInterval(now, preview[Rating.Good].card.due),
        easy: formatInterval(now, preview[Rating.Easy].card.due),
      },
    };
  });

  return { data: views, error: null };
}

// The result of a rate attempt. `alreadyApplied` lets the endpoint return a benign
// idempotent 200 (no second transition) when the compare-and-set found the rating had
// already landed. `data` carries the current schedule progress (post-transition, or
// the unchanged current row when alreadyApplied); `null` data with no error is a 404.
export interface RateResult {
  data: { reps: number; due: string } | null;
  error: unknown;
  alreadyApplied: boolean;
}

// Applies a recall rating to one card and persists the shifted schedule, idempotently.
// `reps` is the optimistic-lock version: next() increments it by exactly one, so the
// compare-and-set `... where flashcard_id = <resolved> and reps = expectedReps` applies
// the transition at most once. A retried/double-clicked rate with a stale expectedReps
// updates 0 rows; a re-read then disambiguates: row still present ⇒ already applied
// (benign), row gone ⇒ 404. `now` defaults to the server clock and is never
// client-supplied (a client could otherwise steer its own schedule). grade is 1–4.
export async function rateCard(
  supabase: Client,
  deckId: number,
  cardPublicId: string,
  grade: Grade,
  expectedReps: number,
  now: Date = new Date(),
): Promise<RateResult> {
  // Resolve the card's internal id, scoped to the deck (on top of RLS) so a card in a
  // different — even owned — deck resolves to a clean 404 rather than being rated.
  const { data: resolved, error: resolveError } = await supabase
    .from("flashcard")
    .select("id")
    .eq("public_id", cardPublicId)
    .eq("deck_id", deckId)
    .maybeSingle();
  if (resolveError) return { data: null, error: resolveError, alreadyApplied: false };
  if (!resolved) return { data: null, error: null, alreadyApplied: false };

  const { data: sched, error: schedError } = await supabase
    .from("flashcard_schedule")
    .select("due, stability, difficulty, srs_state, reps, lapses, last_review")
    .eq("flashcard_id", resolved.id)
    .maybeSingle();
  if (schedError) return { data: null, error: schedError, alreadyApplied: false };
  if (!sched) return { data: null, error: null, alreadyApplied: false };

  const card = scheduleRowToCard({ public_id: cardPublicId, front: "", back: "", ...sched }, now);
  const next = scheduler.next(card, now, grade).card;

  const { data: updated, error: updateError } = await supabase
    .from("flashcard_schedule")
    .update(cardToScheduleColumns(next))
    .eq("flashcard_id", resolved.id)
    .eq("reps", expectedReps)
    .select("reps, due")
    .maybeSingle();
  if (updateError) return { data: null, error: updateError, alreadyApplied: false };

  if (!updated) {
    // 0 rows: the row existed above, so reps ≠ expectedReps ⇒ the rating already
    // landed. Re-read current progress; if the row vanished meanwhile, it's a 404.
    const { data: current, error: rereadError } = await supabase
      .from("flashcard_schedule")
      .select("reps, due")
      .eq("flashcard_id", resolved.id)
      .maybeSingle();
    if (rereadError) return { data: null, error: rereadError, alreadyApplied: false };
    if (!current) return { data: null, error: null, alreadyApplied: false };
    return { data: current, error: null, alreadyApplied: true };
  }

  return { data: updated, error: null, alreadyApplied: false };
}
