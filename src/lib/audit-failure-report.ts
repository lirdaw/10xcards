import type { TablesInsert } from "@/db/database.types";

// The Sentry capture context for a `generation_session` audit row that FAILED TO INSERT
// (C10X-50, 2026-08-13). Both failure paths in `src/pages/api/generate.ts` write a
// `status: "failed"` row purely as forensics — nothing in `src/` ever reads it back — so when
// that write itself fails, the only thing left of the incident is whatever this module hands to
// Sentry. The endpoint's own response cannot be that record: it reaches the user, who can do
// nothing with it, and not an owner.
//
// WHY THIS IS A SEPARATE MODULE, and it is the whole reason rather than tidiness. It decides
// what leaves the process toward a third party, and a decision that lives inline in a route is
// provable only by a reviewer's attention. Extracted here it takes the row as a PARAMETER,
// imports no Sentry runtime, touches no network and no database, and returns a plain object —
// so `tests/lib/audit-failure-report.test.ts` can hold the privacy property as a truth table
// over fabricated rows. Same split, and for the same reason, as `@/lib/sentry-sampling` (the
// pure decision) plus `tests/lib/sentry-wiring.test.ts` (a guard that the caller still makes
// it); this change carries its own wiring guard for exactly that second half.
//
// THE PRIVACY RULE, in one sentence: **every free-form string that leaves this process on the
// Sentry channel passes through this module**, and everything that could carry user content
// leaves as a length plus a digest prefix rather than as content. That is what makes the truth
// table a TOTAL claim about the channel instead of a partial one, and it is why the caller
// captures a SYNTHETIC error and hands the PostgREST failure here as the `cause` parameter: the
// first argument to `captureException` is serialised onto the event where no builder can reach
// it, so a raw `PostgrestError` would ship its own `message` / `details` / `hint` past every
// guard this change builds. That is not hypothetical — `generation_session` carries
// `check (char_length(source_text) > 0)`
// (`supabase/migrations/20260712162349_generation_session.sql:25`), and a Postgres CHECK
// violation puts `Failing row contains (…)` — the whole row, pasted source text included — into
// DETAIL, which PostgREST forwards verbatim.
//
// THE ONE DELIBERATE EXCEPTION is `error_message`, which passes VERBATIM. At the 0-saved site it
// is a fixed project literal; at the transport site it is `err.message` — third-party text, and
// the single most useful thing the lost row existed to preserve. The endpoint already stores it
// in the row it was trying to write, so the exception costs nothing this project was otherwise
// keeping, and naming it here is what stops "fingerprint everything free-form" being read as
// total when it is not.
//
// `user_id` is deliberately ABSENT: it identifies a person and buys nothing the tags do not.

/**
 * Which of `generate.ts`'s two failure paths lost its audit row. Low-cardinality on purpose —
 * it is a Sentry TAG, i.e. something to group and filter by. The two are not interchangeable:
 * the transport site's row is strictly weaker even when it lands (both payload columns are
 * legitimately `null` there, and `generated_count` is hard-coded `0`), so a report that could
 * not say which site produced it would be ambiguous about what the missing row would have held.
 */
export type AuditFailureSite = "transport-failure" | "zero-saved";

/** A value's SHAPE, kept; the value itself, dropped. `sha256` is the digest's first 16 hex characters. */
export interface ContentFingerprint {
  length: number;
  sha256: string;
}

/**
 * The failure the insert came back with, structurally compatible with `PostgrestError` while
 * requiring none of it. Every field is optional because postgrest-js does not guarantee them: a
 * thrown `fetch` yields `{ code: "", status: 0 }` (`postgrest-js/dist/index.mjs:291-331`, the
 * empty `code` at `:294`) and a non-JSON body falls back to `{ message: body }` (`:384`, i.e. no
 * `code`, no `details`, no `hint` at all). Nothing here may branch on `code` being present.
 */
export interface AuditFailureCause {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** What `Sentry.captureException`'s second argument accepts, narrowed to the two keys this builds. */
export interface AuditFailureReport {
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

/**
 * The synthetic error's message, so the capture statement at each call site interpolates NOTHING
 * and the wiring guard can assert its first argument is a `new Error(...)` rather than the
 * PostgREST failure. The cost of a fixed literal is stated rather than hidden: Sentry groups on
 * it and there is no upstream stack, so the `code` tag is what discriminates classes.
 */
export const AUDIT_CAPTURE_MESSAGE = "generation_session failed-audit insert did not land";

/**
 * What a value that cannot be serialised or digested fingerprints to.
 *
 * `-1` rather than `0` deliberately: zero is a legitimate reading of `""`, so a failure must not
 * be able to masquerade as an empty value.
 */
const UNSERIALIZABLE: ContentFingerprint = { length: -1, sha256: "unserializable" };

/**
 * The `code` tag when the failure carries none. A fixed literal rather than `""`, because an
 * empty tag value reads in Sentry as "no error" rather than as "the driver never got a code" —
 * which is exactly the transport class this endpoint's likeliest failure belongs to.
 */
const NO_ERROR_CODE = "none";

/** Enough digest to correlate two occurrences; far too little to invert. */
const SHA256_PREFIX_LENGTH = 16;

/**
 * A value as text, or `undefined` when there is no text to be had.
 *
 * A FUNCTION with a declared return type rather than an inline ternary, and that is load-bearing
 * rather than style: `lib.es5.d.ts` types `JSON.stringify` as returning `string`, while it
 * RETURNS `undefined` — it does not throw — for a function, a symbol, or a bare `undefined`.
 * Inlined, the initialiser narrows to `string` and the honest runtime guard at the one call site
 * reads to the type-aware lint rules as a condition that can never hold, i.e. as dead code to be
 * deleted. Declaring the union here is what keeps that guard both true and legal.
 */
function serialise(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Reduce a value to its length and a digest prefix — the only shape in which anything that could
 * carry user content leaves this process.
 *
 * `null` in and `undefined` in give `null` out, so an absent payload stays legibly absent rather
 * than becoming the fingerprint of the four characters `null`. A non-string is `JSON.stringify`d
 * first, because the payload columns are `Json`.
 *
 * **IT CANNOT THROW, AND THAT IS A HARD CONTRACT RATHER THAN A NICETY.** The transport site's
 * caller sits inside a `catch` block, and a throw from a `catch` is NOT caught by its own `try`:
 * it runs `finally` and then propagates out of the handler, replacing the intended 502 with an
 * uncaught framework 500 — strictly worse than the bug this module exists to fix. The route is
 * real rather than theoretical: `OpenRouterError.rawRequest` / `rawResponse` are declared
 * `unknown` (`src/lib/openrouter.ts:51-52`), and `JSON.stringify` throws on a circular value or a
 * BigInt. So both the serialisation and the digest are wrapped and an unserializable input
 * resolves to {@link UNSERIALIZABLE}. A forensic report is best-effort by nature and must never
 * outrank the response it annotates.
 *
 * Exported so the property is testable directly rather than only through the report.
 */
export async function fingerprint(value: unknown): Promise<ContentFingerprint | null> {
  if (value === null || value === undefined) return null;
  try {
    const text = serialise(value);
    if (text === undefined) return UNSERIALIZABLE;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return { length: text.length, sha256: toHex(digest).slice(0, SHA256_PREFIX_LENGTH) };
  } catch {
    return UNSERIALIZABLE;
  }
}

/**
 * Build the capture context for a `generation_session` audit row that did not land.
 *
 * Async because the digest is (`crypto.subtle.digest` returns a Promise), which is why the call
 * sites `await` it inline on the capture statement — one statement, so the wiring guard can
 * assert the delegation. The cost is one hash of at most `SOURCE_MAX` characters plus two payload
 * serialisations, on a path that has already awaited an LLM call and a database round-trip and is
 * about to return an error.
 *
 * @param row the row the endpoint tried to insert — the ONLY record of the attempt that now exists
 * @param site which failure path lost it
 * @param cause what the insert came back with; `code` travels verbatim, every free-form string
 *   on it is fingerprinted like the row's own content
 */
export async function buildAuditFailureReport(
  row: TablesInsert<"generation_session">,
  site: AuditFailureSite,
  cause: AuditFailureCause,
): Promise<AuditFailureReport> {
  const [sourceText, requestPayload, responsePayload, causeMessage, causeDetails, causeHint] = await Promise.all([
    fingerprint(row.source_text),
    fingerprint(row.request_payload),
    fingerprint(row.response_payload),
    fingerprint(cause.message),
    fingerprint(cause.details),
    fingerprint(cause.hint),
  ]);

  return {
    // Tags are low-cardinality and indexed by Sentry — grouping and filtering, never content.
    // `code` is a closed vocabulary (`42501`, `23503`, `57014`, …) that carries no submitted
    // value, which is why it is the one thing from the cause that travels verbatim.
    tags: {
      site,
      status: row.status,
      language: row.language,
      code: cause.code === undefined || cause.code === "" ? NO_ERROR_CODE : cause.code,
    },
    // The forensic half. Counters and the model are what make a lost row reconstructible enough
    // to act on; the `_fingerprint` suffix on the other three is deliberate naming, so a reader
    // cannot mistake a digest for the value it stands in for.
    extra: {
      requested_count: row.requested_count,
      generated_count: row.generated_count,
      saved_count: row.saved_count,
      model: row.model,
      error_message: row.error_message ?? null,
      source_text_fingerprint: sourceText,
      request_payload_fingerprint: requestPayload,
      response_payload_fingerprint: responsePayload,
      cause_message_fingerprint: causeMessage,
      cause_details_fingerprint: causeDetails,
      cause_hint_fingerprint: causeHint,
    },
  };
}
