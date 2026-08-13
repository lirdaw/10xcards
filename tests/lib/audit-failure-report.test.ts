import { describe, expect, it } from "vitest";
import type { Json, TablesInsert } from "@/db/database.types";
import {
  buildAuditFailureReport,
  fingerprint,
  type AuditFailureCause,
  type AuditFailureReport,
  type AuditFailureSite,
  type ContentFingerprint,
} from "@/lib/audit-failure-report";

// The privacy truth table for the Sentry capture context C10X-50 sends when a `failed` audit-row
// insert does not land (`src/lib/audit-failure-report.ts`).
//
// WHY THIS FILE EXISTS. The builder decides what leaves the process toward a THIRD PARTY on a path
// that carries the user's pasted source text, the upstream request and the upstream response — the
// exact material test-plan.md §2 Risk #4 and the PRD's privacy guardrail exist to keep in. Held
// inline in the route, that property would be an argument about today's schema; held here it is an
// assertion over fabricated rows, with no database, no network and no Worker.
//
// WHAT IT DOES NOT PROVE, stated so nobody reads it as more. It says nothing about whether
// `src/pages/api/generate.ts` still CALLS the builder — that is
// `tests/lib/audit-failure-wiring.test.ts`, and the two are one claim split in half, exactly as
// `sentry-sampling.test.ts` and `sentry-wiring.test.ts` are. It also says nothing about whether a
// captured event ever ARRIVES in the Sentry UI; no layer in this project can assert that since
// C10X-54 deleted `/api/shipprobe`.
//
// EVERY VALUE HERE IS FABRICATED. The real row shapes live in the endpoint, and a test that
// imported them would drift with the endpoint instead of pinning it.

/** Distinct per field, so a red names WHICH one leaked rather than only that something did. */
const SOURCE_TEXT = "SENTINEL-source-text-4f1c pasted lecture notes";
const REQUEST_PAYLOAD = "SENTINEL-request-payload-9a37";
const RESPONSE_PAYLOAD = "SENTINEL-response-payload-2be5";
const USER_ID = "SENTINEL-user-id-7c04";
const CAUSE_MESSAGE = "SENTINEL-cause-message-1d88";
const CAUSE_DETAILS = "SENTINEL-cause-details-6e29";
const CAUSE_HINT = "SENTINEL-cause-hint-0b53";

const ERROR_MESSAGE = "OpenRouter HTTP 502";
const MODEL = "openai/gpt-4o-mini";

function row(overrides: Partial<TablesInsert<"generation_session">> = {}): TablesInsert<"generation_session"> {
  return {
    user_id: USER_ID,
    source_text: SOURCE_TEXT,
    model: MODEL,
    language: "pl",
    requested_count: 7,
    generated_count: 3,
    saved_count: 0,
    status: "failed",
    error_message: ERROR_MESSAGE,
    request_payload: { marker: REQUEST_PAYLOAD },
    response_payload: { marker: RESPONSE_PAYLOAD },
    idempotency_key: null,
    ...overrides,
  };
}

/**
 * The shape a real CHECK violation arrives in — the reason the cause is a builder PARAMETER rather
 * than the captured exception. Postgres puts `Failing row contains (…)`, i.e. the whole row, into
 * DETAIL, and PostgREST forwards it verbatim.
 */
function cause(overrides: Partial<AuditFailureCause> = {}): AuditFailureCause {
  return {
    code: "23514",
    message: `new row for relation "generation_session" violates check constraint ${CAUSE_MESSAGE}`,
    details: `Failing row contains (1, ${CAUSE_DETAILS}, ${SOURCE_TEXT}, …).`,
    hint: CAUSE_HINT,
    ...overrides,
  };
}

/**
 * The leak detector. Deliberately over-broad — the WHOLE serialised report, tags and extra
 * together — because a privacy assertion scoped to the fields you remembered to look at is the
 * "correct on what it looks at, silent about what it never looks at" class this project has
 * recorded four times.
 */
function carries(report: AuditFailureReport, needle: string): boolean {
  return JSON.stringify(report).includes(needle);
}

/** `extra` is deliberately `Record<string, unknown>` — this narrows one entry for its own assertions. */
function fingerprintAt(report: AuditFailureReport, key: string): ContentFingerprint | null {
  return report.extra[key] as ContentFingerprint | null;
}

const SITES: AuditFailureSite[] = ["transport-failure", "zero-saved"];

describe("buildAuditFailureReport", () => {
  describe("privacy — the row's own content", () => {
    it("carries neither the source text nor either payload", async () => {
      const report = await buildAuditFailureReport(row(), "transport-failure", cause());

      for (const sentinel of [SOURCE_TEXT, REQUEST_PAYLOAD, RESPONSE_PAYLOAD])
        expect(carries(report, sentinel)).toBe(false);
    });

    // …and the same claim from the other side, so "dropped everything" cannot satisfy it: the
    // fingerprints are PRESENT and describe the values that were dropped.
    it("replaces them with fingerprints that describe what was dropped", async () => {
      const report = await buildAuditFailureReport(row(), "transport-failure", cause());

      const printed = fingerprintAt(report, "source_text_fingerprint");
      expect(printed?.length).toBe(SOURCE_TEXT.length);
      expect(printed?.sha256).toMatch(/^[0-9a-f]{16}$/);
      expect(report.extra.request_payload_fingerprint).not.toBeNull();
      expect(report.extra.response_payload_fingerprint).not.toBeNull();
    });

    it("carries no user_id — it identifies a person and buys nothing the tags do not", async () => {
      const report = await buildAuditFailureReport(row(), "transport-failure", cause());

      expect(carries(report, USER_ID)).toBe(false);
    });
  });

  describe("privacy — the cause", () => {
    // The half a builder-only truth table would miss, and the reason F1 changed the design: the
    // PostgREST failure's own free-form strings must not travel either, because the alternative
    // shape — handing it to `captureException` directly — puts them on the event where no builder
    // and no guard can reach them.
    it("carries none of the cause's message, details or hint", async () => {
      const report = await buildAuditFailureReport(row(), "transport-failure", cause());

      for (const sentinel of [CAUSE_MESSAGE, CAUSE_DETAILS, CAUSE_HINT]) expect(carries(report, sentinel)).toBe(false);
      // …and the row's source text again, this time reached through the cause's DETAIL rather
      // than through the row — the concrete route a CHECK violation opens.
      expect(carries(report, SOURCE_TEXT)).toBe(false);
    });

    // Asserted in the same breath so the case above cannot be satisfied by dropping the cause
    // wholesale: `code` is a closed vocabulary carrying no submitted value, and it is what
    // discriminates failure classes in Sentry once the captured error is a fixed literal.
    it("keeps the code verbatim, and fingerprints the three free-form strings", async () => {
      const report = await buildAuditFailureReport(row(), "transport-failure", cause());

      expect(report.tags.code).toBe("23514");
      expect(report.extra.cause_message_fingerprint).not.toBeNull();
      expect(report.extra.cause_details_fingerprint).not.toBeNull();
      expect(report.extra.cause_hint_fingerprint).not.toBeNull();
    });

    // A thrown `fetch` yields `{ code: "", status: 0 }` (postgrest-js `index.mjs:291-331`), i.e.
    // the transport class — the likeliest failure on this path. An empty tag value would read in
    // Sentry as "no error" rather than as "the driver never got a code".
    it.each([{ code: "" }, { code: undefined }])(
      "substitutes a fixed literal for a missing code (%o)",
      async (over) => {
        const report = await buildAuditFailureReport(row(), "transport-failure", cause(over));

        expect(report.tags.code).toBe("none");
      },
    );
  });

  // THE POSITIVE CONTROL FOR EVERY PRIVACY CASE ABOVE. Without it a builder returning `{}` — or a
  // detector that never matches — satisfies all of them and reads as perfect protection.
  it("the leak detector fires on a report that DOES carry a sentinel", () => {
    const leaky: AuditFailureReport = {
      tags: { site: "transport-failure" },
      extra: { source_text: SOURCE_TEXT, cause_details: CAUSE_DETAILS, user_id: USER_ID },
    };

    for (const sentinel of [SOURCE_TEXT, CAUSE_DETAILS, USER_ID]) expect(carries(leaky, sentinel)).toBe(true);
  });

  describe("retention — an empty report is not a private one", () => {
    it("keeps every non-private column with its submitted value", async () => {
      const report = await buildAuditFailureReport(row(), "transport-failure", cause());

      expect(report.tags).toMatchObject({ status: "failed", language: "pl" });
      expect(report.extra).toMatchObject({
        requested_count: 7,
        generated_count: 3,
        saved_count: 0,
        model: MODEL,
        // The ONE deliberate free-form exception: at the transport site this is `err.message`,
        // upstream text, and it is the single most useful thing the lost row existed to preserve.
        error_message: ERROR_MESSAGE,
      });
    });

    it("reads error_message as null rather than dropping the key when the row carries none", async () => {
      const report = await buildAuditFailureReport(row({ error_message: null }), "zero-saved", cause());

      expect(report.extra).toHaveProperty("error_message", null);
    });
  });

  describe("site discrimination", () => {
    it.each(SITES)("carries %s through to the tag unchanged", async (site) => {
      const report = await buildAuditFailureReport(row(), site, cause());

      expect(report.tags.site).toBe(site);
    });
  });

  describe("the transport site's weaker row", () => {
    // Both payload columns are legitimately `null` there — the endpoint only fills them when the
    // thrown error is an `OpenRouterError`. An absent payload must stay legibly ABSENT rather than
    // becoming the fingerprint of the four characters `null`, or a reader cannot tell "nothing was
    // captured" from "the string 'null' was captured".
    it("fingerprints a null payload as null, distinguishably from the string 'null'", async () => {
      const report = await buildAuditFailureReport(
        row({ request_payload: null, response_payload: null }),
        "transport-failure",
        cause(),
      );

      expect(report.extra.request_payload_fingerprint).toBeNull();
      expect(report.extra.response_payload_fingerprint).toBeNull();
      expect(await fingerprint("null")).not.toBeNull();
    });
  });

  describe("it cannot throw — the contract that keeps the 502 a 502", () => {
    // Asserted as `resolves`, never as a caught throw: the property is that the failure path stays
    // on its feet. A test that CAUGHT the throw would pass over an implementation that still kills
    // the response — the transport site's capture sits inside a `catch`, and a throw from a `catch`
    // escapes its own `try` and replaces the 502 with an uncaught framework 500.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    it.each([
      { label: "a circular payload", payload: circular },
      { label: "a payload carrying a BigInt", payload: { big: 1n } },
    ])("resolves over $label, with every other field intact", async ({ payload }) => {
      const report = await buildAuditFailureReport(
        row({ request_payload: payload as unknown as Json }),
        "transport-failure",
        cause(),
      );

      expect(report.extra.request_payload_fingerprint).toEqual({ length: -1, sha256: "unserializable" });
      expect(report.extra).toMatchObject({ model: MODEL, requested_count: 7 });
      expect(report.tags.code).toBe("23514");
      // …and the sentinel must not be mistakable for a real reading of an empty value.
      expect(report.extra.request_payload_fingerprint).not.toEqual({ length: 0, sha256: "unserializable" });
    });
  });
});

describe("fingerprint", () => {
  it("is stable — the same input twice gives the same digest", async () => {
    const [first, second] = await Promise.all([fingerprint(SOURCE_TEXT), fingerprint(SOURCE_TEXT)]);

    expect(first).toEqual(second);
  });

  it("discriminates — a one-character change gives a different digest", async () => {
    const [first, second] = await Promise.all([fingerprint("abcdef"), fingerprint("abcdeg")]);

    expect(first?.sha256).not.toBe(second?.sha256);
  });

  it("reports the input's own length", async () => {
    expect((await fingerprint("abcdef"))?.length).toBe(6);
    expect((await fingerprint(""))?.length).toBe(0);
  });

  it("returns null for null and for undefined", async () => {
    expect(await fingerprint(null)).toBeNull();
    expect(await fingerprint(undefined)).toBeNull();
  });

  // A non-string is serialised first, because the payload columns are `Json` — and the digest must
  // still discriminate two payloads that differ only in a value.
  it("serialises a non-string before digesting, and still discriminates", async () => {
    const [first, second] = await Promise.all([fingerprint({ a: 1 }), fingerprint({ a: 2 })]);

    expect(first?.sha256).not.toBe(second?.sha256);
    expect(first?.length).toBe(JSON.stringify({ a: 1 }).length);
  });

  it("returns the sentinel rather than throwing on an unserializable value", async () => {
    expect(await fingerprint(() => "a function is not JSON")).toEqual({ length: -1, sha256: "unserializable" });
  });
});
