// What /api/generate DOES with the result of a replay lookup, kept out of the handler.
//
// Third of the pure-decision extractions this project uses where a decision would otherwise
// be re-made by hand inside something the suite cannot reach — after `readJsonResponse`
// (@/lib/http) and `rateOutcome` (@/lib/study-session). Here the unreachable thing is not an
// island but a branch: reaching `replaySession`'s empty arm through the endpoint needs a
// session row that exists with zero cards behind it, which is a state only a failed
// compensation produces. Extracting the decision makes it assertable with no database, no
// container and no session; the I/O around it (the key-clearing UPDATE, the fall-through)
// stays in the endpoint, where it belongs.
//
// THE DEFECT THIS SPLITS APART. `generate.ts` read the lookup as `if (error || !data)` — one
// branch over two facts that mean opposite things:
//
//   - the query FAILED, so we know nothing about the session. Transient; the request must
//     stop, and the copy must not claim anything about the user's cards.
//   - the query SUCCEEDED and the session has no cards. Permanent as long as the row's
//     idempotency key stands: every future "Ponów" on that key finds the same succeeded row,
//     reads the same zero cards, and dies the same way. The row itself is the problem, so
//     the caller can act on it — which is impossible while it is indistinguishable from an
//     outage (C10X-48).
//
// Error is classified BEFORE absence, the same ordering the handler cites in five comments
// and `lessons.md` records as "Loadery SSR rozróżniają błąd zapytania od braku danych".
// Absence-first would read every outage as "this session is empty" and heal a row it had no
// evidence about.

/**
 * The three arms, over whatever payload the lookup carries. Generic rather than pinned to
 * `generationResultByGenerationId`'s shape so this module imports no Supabase types and
 * states no opinion about the body — the caller keeps its own type, structurally.
 */
export type ReplayClassification<T> = { kind: "query-failed" } | { kind: "replayable"; result: T } | { kind: "empty" };

/**
 * Classifies the `{ data, error }` pair `generationResultByGenerationId` already returns.
 *
 * `error` is typed `unknown` on purpose: the only thing this decision needs from it is
 * whether it is there, and narrowing it to `PostgrestError` would drag a Supabase type into
 * a module that has no business knowing where the pair came from.
 */
export function classifyReplay<T>(outcome: { data: T | null; error: unknown }): ReplayClassification<T> {
  if (outcome.error) return { kind: "query-failed" };
  if (!outcome.data) return { kind: "empty" };
  return { kind: "replayable", result: outcome.data };
}
