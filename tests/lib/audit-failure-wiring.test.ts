import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The wiring half of C10X-50's Sentry capture (2026-08-13). Its sibling,
// `tests/lib/audit-failure-report.test.ts`, proves the report may not carry user content;
// this file proves `src/pages/api/generate.ts` still routes its captures through it.
//
// WHY BOTH ARE NEEDED, and it is the split this project has now closed four times
// (`error-param-guard.test.ts`, `no-client-redirect-errors.test.ts`, `sentry-wiring.test.ts`).
// The truth table stays FULLY green if the endpoint deletes a capture, builds the context
// inline instead of calling the builder, or hands the raw `PostgrestError` to
// `captureException` as its first argument — because in every one of those the builder is
// simply never reached, and a module nobody calls satisfies every assertion about what it
// returns.
//
// WHY TEXTUAL: the claim is about the CALL SITE, and this suite already carries the species
// three times over. Importing `src/pages/api/generate.ts` would prove nothing about the shape
// of the statement anyway — only that the module loads.
//
// WHAT IT PROVES, and do not read it as more: the calls are **present and composed**. It does
// NOT prove that an event is emitted, sampled, transported or delivered. Nothing in this
// project asserts that — `/api/shipprobe`, the one instrument that ever showed a first-party
// error reaching the Sentry UI, was deleted by C10X-54. See the change's
// `follow-ups/sentry-delivery.md`.
//
// THE DEVIATION FROM `sentry-wiring.test.ts`, stated because it is a measurement rather than
// drift. That guard matches per LINE and records the trade in its own header: splitting the
// delegation across lines trips it even when the wiring is correct, which is acceptable there
// because the statement it guards FITS on one line. This one does not — the transport-site
// capture is 136 characters at its indent against `printWidth: 120`, so Prettier wraps it and
// a per-line rule would redden correct code on the first `npm run format`. So this file joins
// continuation lines into a STATEMENT before matching, and asserts the join terminates
// (§ "the joiner is not run away", below) so a desync cannot quietly widen what a pattern
// sees. Reported line numbers stay file-true: a joined statement is reported at the line it
// starts on, the `index`-before-filter shape `sentry-wiring.test.ts:59-64` uses.

const HANDLER = fileURLToPath(new URL("../../src/pages/api/generate.ts", import.meta.url));
const HANDLER_PATH = "src/pages/api/generate.ts";

/** A statement that CAPTURES — the SDK call, on the namespace import this file uses. */
const CAPTURES = /(?<![\w$])Sentry\s*\.\s*captureException\s*\(/;

/** …and the only acceptable way to build its context: by calling the audited builder. */
const DELEGATES = /(?<![\w$])buildAuditFailureReport\s*\(/;

/**
 * The FIRST argument must be a synthetic error, never the failure itself.
 *
 * This is the assertion the delegation rule does NOT carry, and the two are jointly
 * satisfiable without it: `captureException(auditError, await buildAuditFailureReport(...))`
 * delegates perfectly AND ships the `PostgrestError`'s own `message` / `details` / `hint` to a
 * third party — serialised onto the event as `exception.values[].value`, where the builder
 * cannot reach it and where the truth table never looks. The route is real: a Postgres CHECK
 * violation puts `Failing row contains (…)` — the pasted source text included — into DETAIL,
 * and PostgREST forwards it. A guard that policed the second argument and ignored the first
 * would be "correct on what it looks at, silent about what it never looks at".
 */
const SYNTHETIC_FIRST_ARG = /(?<![\w$])captureException\s*\(\s*new\s+Error\s*\(/;

/** The import that makes the delegation resolve to the audited module and not to something else. */
const IMPORTS_BUILDER =
  /import\s*\{[^}]*\bbuildAuditFailureReport\b[^}]*\}\s*from\s*["']@\/lib\/audit-failure-report["']/;

/**
 * The columns and properties that carry user content — the textual half of D-04.
 *
 * A capture statement naming any of them is passing content to Sentry directly, whatever the
 * builder does. The semantic half (that the builder itself fingerprints them) is
 * `tests/lib/audit-failure-report.test.ts`; neither file covers the other's claim.
 */
const CONTENT_FIELD = /(?<![\w$])(source_text|rawRequest|rawResponse|request_payload|response_payload)(?![\w$])/;

/**
 * Lines with comment-only AND blank lines dropped — the shape `sentry-wiring.test.ts` and
 * `error-param-guard.test.ts` both needed. Load-bearing rather than defensive here for two
 * reasons: the comment block above each capture NAMES the identifiers these patterns match
 * while explaining this very rule, and a comment carrying an unbalanced parenthesis would
 * desync the joiner below.
 *
 * `index` is assigned BEFORE the filter, so reported line numbers stay the file's own.
 */
function codeLines(file: string): { text: string; index: number }[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim() !== "" && !/^\s*(\/\/|\*|\/\*)/.test(text));
}

/** Net parenthesis depth of one line. Braces are deliberately NOT counted — see `statements`. */
function parenDepth(line: string): number {
  let depth = 0;
  for (const char of line) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
  }
  return depth;
}

/**
 * Every `Sentry.captureException(...)` as ONE joined statement, with the line it starts on.
 *
 * Joining starts AT a capture line and runs until the parentheses balance, rather than
 * grouping the whole file into statements — narrower, so a stray parenthesis elsewhere cannot
 * desync what the patterns see. `depth` is returned so the caller can assert the join
 * terminated; braces are not counted on purpose, because the handler opens one at
 * `export const POST` and closes it 300 lines later, which would swallow the entire file into
 * a single "statement".
 */
function captureStatements(lines: { text: string; index: number }[]): { text: string; index: number; depth: number }[] {
  const found: { text: string; index: number; depth: number }[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    const first = lines[start];
    if (!first || !CAPTURES.test(first.text)) continue;
    const parts: string[] = [];
    let depth = 0;
    for (let cursor = start; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line) break;
      parts.push(line.text.trim());
      depth += parenDepth(line.text);
      if (depth <= 0) break;
    }
    found.push({ text: parts.join(" "), index: first.index, depth });
  }
  return found;
}

/** How a red names the edit rather than the rule, as this file's three siblings do. */
function at({ text, index }: { text: string; index: number }): string {
  return `${HANDLER_PATH}:${index + 1}: ${text}`;
}

describe("src/pages/api/generate.ts routes every Sentry capture through the audited builder", () => {
  const lines = codeLines(HANDLER);
  const source = readFileSync(HANDLER, "utf8");
  const captures = captureStatements(lines);

  // Positive control on the READ itself, load-bearing rather than ceremony. `readFileSync`
  // throws on a missing file, so a delete is already red — but a file emptied, renamed, or
  // replaced by a stub would leave every assertion below vacuously true. The named token is
  // what makes this file the generation endpoint at all.
  it("reads the real generation handler", () => {
    // 334 code lines measured 2026-08-13; the floor sits FOUR below it, and that slack is a
    // decision rather than laziness. This guard's own deliberate-breakage run deletes one
    // four-line capture statement — so a floor AT the measured value would go red under the
    // very neuter it exists to attribute, which is the C10X-46 §6.11 rule ("check what your
    // neuter does to the harness before you read its colour") committed by the control itself.
    // The shrink direction is covered where it belongs: a deleted capture reddens the
    // exactly-two assertion below, by name.
    expect(lines.length).toBeGreaterThanOrEqual(330);
    expect(source).toContain("export const POST: APIRoute");
  });

  // The other half of the control: the detectors fire on the regressions they claim to detect
  // and stay silent on the shipped shape. Without this, patterns matching nothing would make
  // every assertion below pass while guarding nothing at all.
  it("detects an undelegated, an inline-object and a raw-cause capture", () => {
    // The pre-fix shape: no context at all.
    const undelegated = "      Sentry.captureException(err);";
    expect(CAPTURES.test(undelegated)).toBe(true);
    expect(DELEGATES.test(undelegated)).toBe(false);

    // The inline re-implementation — the defect the delegation rule exists for, and note it
    // also trips the content rule, which is the second guard catching the same edit.
    const inlineObject =
      '      Sentry.captureException(new Error(AUDIT_CAPTURE_MESSAGE), { tags: { site: "zero-saved" }, extra: { source_text: auditRow.source_text } });';
    expect(CAPTURES.test(inlineObject)).toBe(true);
    expect(DELEGATES.test(inlineObject)).toBe(false);
    expect(CONTENT_FIELD.test(inlineObject)).toBe(true);

    // The one a delegation-only guard waves through: perfect second argument, leaking first.
    const rawCause =
      '      Sentry.captureException(auditError, await buildAuditFailureReport(auditRow, "zero-saved", auditError));';
    expect(CAPTURES.test(rawCause)).toBe(true);
    expect(DELEGATES.test(rawCause)).toBe(true);
    expect(SYNTHETIC_FIRST_ARG.test(rawCause)).toBe(false);

    // The shipped shape, as the joiner hands it over (wrapped in the file, joined here).
    const shipped =
      'Sentry.captureException( new Error(AUDIT_CAPTURE_MESSAGE), await buildAuditFailureReport(auditRow, "transport-failure", auditError), );';
    expect(CAPTURES.test(shipped)).toBe(true);
    expect(DELEGATES.test(shipped)).toBe(true);
    expect(SYNTHETIC_FIRST_ARG.test(shipped)).toBe(true);
    expect(CONTENT_FIELD.test(shipped)).toBe(false);

    // False positives matter as much: this file fails the build, so a guard that fires on a
    // neighbouring SDK call or a lookalike identifier gets weakened by the next person it
    // annoys.
    for (const sample of [
      "      Sentry.captureMessage(AUDIT_CAPTURE_MESSAGE);",
      "      mySentry.captureException(err);",
      "      const captureExceptionLater = () => 0;",
    ])
      expect(CAPTURES.test(sample)).toBe(false);

    // The import detector, both directions. A bare mention must not satisfy it, or the guard
    // degrades into the co-presence check it exists to be stricter than.
    expect(
      IMPORTS_BUILDER.test(
        'import { AUDIT_CAPTURE_MESSAGE, buildAuditFailureReport } from "@/lib/audit-failure-report";',
      ),
    ).toBe(true);
    expect(IMPORTS_BUILDER.test("// see buildAuditFailureReport in @/lib/audit-failure-report")).toBe(false);
    expect(IMPORTS_BUILDER.test('import { somethingElse } from "@/lib/audit-failure-report";')).toBe(false);
  });

  // The joiner's own control. A statement whose parentheses never balance would have run to
  // the end of the file, quietly handing every pattern below the whole handler to match
  // against — which reads as green and guards nothing. A non-zero depth here says the join
  // never terminated, not that the wiring is wrong.
  it("joins each capture into a terminated statement", () => {
    expect(captures.filter(({ depth }) => depth !== 0).map(at)).toEqual([]);
  });

  // The import, so the delegation cannot resolve to a local re-implementation that happens to
  // carry the same name.
  it("imports the builder from @/lib/audit-failure-report", () => {
    expect(lines.filter(({ text }) => IMPORTS_BUILDER.test(text))).toHaveLength(1);
  });

  // THE ASSERTION. Exactly two statements capture — one per failure path — and each of them
  // delegates. A count is the half that catches a DELETED capture; the delegation filter is
  // the half that catches a re-inlined one.
  it("captures on exactly two statements, and both call the builder", () => {
    const located = captures.map(at);
    // The count's failure message carries the statements it DID find. Vitest abbreviates a
    // long array to `[ Array(1) ]` on `toHaveLength`, so without this a deleted capture reds
    // with a bare number and the reader has to go looking — while the delegation assertion
    // below, which diffs arrays, names file and line for free.
    expect(located, located.join("\n")).toHaveLength(2);
    expect(captures.filter(({ text }) => !DELEGATES.test(text)).map(at)).toEqual([]);
  });

  // …and the first argument of each is synthetic, which the assertion above cannot see.
  it("passes a synthetic Error as the first argument, never the failure itself", () => {
    expect(captures.filter(({ text }) => !SYNTHETIC_FIRST_ARG.test(text)).map(at)).toEqual([]);
  });

  // The textual half of D-04. The builder is what fingerprints the row's content; a statement
  // that names a content field is reaching past it, whatever the builder then does.
  it("names no content field on any capture statement", () => {
    expect(captures.filter(({ text }) => CONTENT_FIELD.test(text)).map(at)).toEqual([]);
  });
});
