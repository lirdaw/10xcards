import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// EVERY first-party `Sentry.captureException` under `src/` is registered below and routes its
// context through an audited builder.
//
// This file was `tests/lib/audit-failure-wiring.test.ts` until 2026-08-14 (C10X-51), where it was
// hardcoded to `src/pages/api/generate.ts` and claimed nothing at all about anywhere else. That
// was correct while `generate.ts` was the only capture site in the project — and it was an
// incomplete sweep left unstated the moment a second one landed, which is the exact class
// `error-param-guard.test.ts` and `form-endpoint-guards.test.ts` both exist to close. So the
// shape is theirs: a REGISTERED-TARGETS table plus a CATCH-ALL, and the catch-all is what turns
// "these two call sites are correct" into "no call site can land unguarded".
//
// WHY A GUARD AT ALL, and it is the split this project has now closed five times
// (`error-param-guard.test.ts`, `no-client-redirect-errors.test.ts`, `sentry-wiring.test.ts`,
// `form-endpoint-guards.test.ts`). Each builder has its own truth table —
// `tests/lib/audit-failure-report.test.ts` and the second half of
// `tests/lib/signout-outcome.test.ts` — and both stay FULLY green if a handler deletes a
// capture, builds the context inline instead of calling the builder, or hands the raw failure to
// `captureException` as its FIRST argument. In every one of those the builder is simply never
// reached, and a module nobody calls satisfies every assertion about what it returns.
//
// WHY TEXTUAL: the claim is about the CALL SITE, and this suite already carries the species four
// times over. Importing a route would prove nothing about the shape of the statement anyway —
// only that the module loads.
//
// WHAT IT PROVES, and do not read it as more: the calls are **present and composed**. It does
// NOT prove that an event is emitted, sampled, transported or delivered. Nothing in this project
// asserts that, at any layer — `/api/shipprobe`, the one instrument that ever showed a
// first-party error reaching the Sentry UI, was deleted by C10X-54, and neither the test runner
// nor `npm run dev` configures a DSN, so `captureException` is a no-op returning an event id in
// every environment this suite can reach. That debt has an owner:
// `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/follow-ups/sentry-delivery.md`
// — the ARCHIVE path, verified to resolve on 2026-08-14. Two live sites still carry the
// pre-archive `context/changes/…` form of it (`src/worker.ts`, `test-plan.md`'s §7 correction);
// they are pointer rot this file deliberately does not inherit.
//
// THE DEVIATION FROM `sentry-wiring.test.ts`, stated because it is a measurement rather than
// drift. That guard matches per LINE and records the trade in its own header: splitting the
// delegation across lines trips it even when the wiring is correct, which is acceptable there
// because the statement it guards FITS on one line. `generate.ts`'s does not — its transport-site
// capture is 136 characters at its indent against `printWidth: 120`, so Prettier wraps it and a
// per-line rule would redden correct code on the first `npm run format`. So this file joins
// continuation lines into a STATEMENT before matching, and asserts the join terminates
// (§ "the joiner is not run away", below) so a desync cannot quietly widen what a pattern sees.
// Reported line numbers stay file-true: a joined statement is reported at the line it starts on,
// the `index`-before-filter shape `sentry-wiring.test.ts:59-64` uses.

/** A statement that CAPTURES — the SDK call, on the namespace import both handlers use. */
const CAPTURES = /(?<![\w$])Sentry\s*\.\s*captureException\s*\(/;

/**
 * The FIRST argument must be a synthetic error, never the failure itself.
 *
 * This is the assertion the delegation rule does NOT carry, and the two are jointly satisfiable
 * without it: `captureException(cause, await buildTheReport(...))` delegates perfectly AND ships
 * the failure's own free-form strings to a third party — serialised onto the event as
 * `exception.values[].value`, where no builder can reach them and where neither truth table ever
 * looks. The route is real at both sites. On `generate.ts` a Postgres CHECK violation puts
 * `Failing row contains (…)` — the pasted source text included — into a PostgREST error's DETAIL.
 * On `signout.ts` an `AuthError`'s `message` is the field GoTrue interpolates the submitted
 * address into (`Email address %q is invalid`). A guard that policed the second argument and
 * ignored the first would be "correct on what it looks at, silent about what it never looks at".
 */
const SYNTHETIC_FIRST_ARG = /(?<![\w$])captureException\s*\(\s*new\s+Error\s*\(/;

/** Regex-safe form of a literal that travels through a `RegExp` constructor. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** The only acceptable way to build a capture's context: by calling THIS target's audited builder. */
function delegates(builder: string): RegExp {
  return new RegExp(`(?<![\\w$])${literal(builder)}\\s*\\(`);
}

/** The import that makes the delegation resolve to the audited module and not to something else. */
function importsBuilder(builder: string, module: string): RegExp {
  return new RegExp(`import\\s*\\{[^}]*\\b${literal(builder)}\\b[^}]*\\}\\s*from\\s*["']${literal(module)}["']`);
}

/**
 * The identifiers that carry user content ON THIS TARGET — the textual half of each change's
 * privacy decision (C10X-50 D-04, C10X-51 D-13).
 *
 * A capture statement naming any of them is passing content to Sentry directly, whatever the
 * builder does. The semantic half — that the builder itself fingerprints them — lives in each
 * builder's own truth table; neither file covers the other's claim.
 */
function contentField(fields: readonly string[]): RegExp {
  return new RegExp(`(?<![\\w$])(${fields.map(literal).join("|")})(?![\\w$])`);
}

interface CaptureTarget {
  /** Repo-relative path of the handler, and the base every reported line is relative to. */
  path: string;
  /**
   * A token proving the file read is THAT handler. `export const POST: APIRoute` is asserted for
   * every row and does not discriminate — both targets are POST routes — so each row names
   * something only it contains.
   */
  marker: string;
  /**
   * Lower bound on the file's code lines, and the slack is a DECISION rather than laziness. This
   * guard's own deliberate-breakage run deletes a capture statement from the target — four lines
   * on `generate.ts`, three on `signout.ts` — so a floor AT the measured value would go red under
   * the very neuter it exists to attribute, which is C10X-46 §6.11's rule ("check what your
   * neuter does to the harness before you read its colour") committed by the control itself. The
   * shrink direction is covered where it belongs: a deleted capture reddens the exact-count
   * assertion below, by name.
   */
  lineFloor: number;
  /** What the floor was measured at, and when — so the next reader re-measures rather than guesses. */
  measured: string;
  /** The builder every capture on this target must compose its context with. */
  builder: string;
  /** …imported from here, so the delegation cannot resolve to a local look-alike. */
  module: string;
  /** How many statements may capture. A count is the half that catches a DELETED capture. */
  captures: number;
  /** Identifiers this target's capture statements may never name — see {@link contentField}. */
  contentFields: readonly string[];
}

const TARGETS: CaptureTarget[] = [
  {
    path: "src/pages/api/generate.ts",
    marker: "createGenerationSession(",
    lineFloor: 330,
    measured: "334 code lines, 2026-08-14",
    builder: "buildAuditFailureReport",
    module: "@/lib/audit-failure-report",
    captures: 2,
    contentFields: ["source_text", "rawRequest", "rawResponse", "request_payload", "response_payload"],
  },
  {
    path: "src/pages/api/auth/signout.ts",
    marker: "supabase.auth.signOut()",
    lineFloor: 30,
    measured: "35 code lines, 2026-08-14",
    builder: "buildSignOutFailureReport",
    module: "@/lib/signout-outcome",
    captures: 1,
    // `message` is the whole of it here, and it is the one field an `AuthError` carries that can
    // echo what the user typed. The three beside it are not fields of any value on this path —
    // they are named so a future "let's attach a bit more context" edit is red rather than
    // reviewed, which is the direction this class actually fails in.
    contentFields: ["message", "email", "access_token", "refresh_token"],
  },
];

/**
 * Lines with comment-only AND blank lines dropped — the shape `sentry-wiring.test.ts` and
 * `error-param-guard.test.ts` both needed. Load-bearing rather than defensive here for two
 * reasons: the comment block above each capture NAMES the identifiers these patterns match while
 * explaining this very rule, and a comment carrying an unbalanced parenthesis would desync the
 * joiner below.
 *
 * `index` is assigned BEFORE the filter, so reported line numbers stay the file's own.
 */
function codeLines(file: string): { text: string; index: number }[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim() !== "" && !/^\s*(\/\/|\*|\/\*)/.test(text));
}

/** Net parenthesis depth of one line. Braces are deliberately NOT counted — see `captureStatements`. */
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
 * Joining starts AT a capture line and runs until the parentheses balance, rather than grouping
 * the whole file into statements — narrower, so a stray parenthesis elsewhere cannot desync what
 * the patterns see. `depth` is returned so the caller can assert the join terminated; braces are
 * not counted on purpose, because `generate.ts` opens one at `export const POST` and closes it
 * 300 lines later, which would swallow the entire file into a single "statement".
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

/** How a red names the edit rather than the rule, as this file's four siblings do. */
function locator(path: string) {
  return ({ text, index }: { text: string; index: number }): string => `${path}:${index + 1}: ${text}`;
}

function resolveFromRepo(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url));
}

describe.each(TARGETS)("$path routes every Sentry capture through its audited builder", (target) => {
  const file = resolveFromRepo(target.path);
  const lines = codeLines(file);
  const source = readFileSync(file, "utf8");
  const captures = captureStatements(lines);
  const at = locator(target.path);
  const DELEGATES = delegates(target.builder);
  const IMPORTS_BUILDER = importsBuilder(target.builder, target.module);
  const CONTENT_FIELD = contentField(target.contentFields);

  // Positive control on the READ itself, load-bearing rather than ceremony. `readFileSync` throws
  // on a missing file, so a delete is already red — but a file emptied, renamed, or replaced by a
  // stub would leave every assertion below vacuously true. The marker is what makes this file
  // THAT handler rather than any route; the floor is what stops a gutted one passing.
  it(`reads the real handler (${target.measured})`, () => {
    expect(lines.length).toBeGreaterThanOrEqual(target.lineFloor);
    expect(source).toContain("export const POST: APIRoute");
    expect(source).toContain(target.marker);
  });

  // The joiner's own control. A statement whose parentheses never balance would have run to the
  // end of the file, quietly handing every pattern below the whole handler to match against —
  // which reads as green and guards nothing. A non-zero depth here says the join never
  // terminated, not that the wiring is wrong.
  it("joins each capture into a terminated statement", () => {
    expect(captures.filter(({ depth }) => depth !== 0).map(at)).toEqual([]);
  });

  // The import, so the delegation cannot resolve to a local re-implementation that happens to
  // carry the same name. Per LINE, which means the import statement must stay on one line — the
  // same trade `error-param-guard.test.ts` records: re-check the wiring rather than widening the
  // pattern because a reformat annoyed you.
  it(`imports the builder from ${target.module}`, () => {
    expect(lines.filter(({ text }) => IMPORTS_BUILDER.test(text))).toHaveLength(1);
  });

  // THE ASSERTION. Exactly N statements capture — one per failure path — and each of them
  // delegates. The count is the half that catches a DELETED capture; the delegation filter is the
  // half that catches a re-inlined one.
  it(`captures on exactly ${target.captures} statement(s), and all call the builder`, () => {
    const located = captures.map(at);
    // The count's failure message carries the statements it DID find. Vitest abbreviates a long
    // array to `[ Array(1) ]` on `toHaveLength`, so without this a deleted capture reds with a
    // bare number and the reader has to go looking — while the delegation assertion below, which
    // diffs arrays, names file and line for free.
    expect(located, located.join("\n")).toHaveLength(target.captures);
    expect(captures.filter(({ text }) => !DELEGATES.test(text)).map(at)).toEqual([]);
  });

  // …and the first argument of each is synthetic, which the assertion above cannot see.
  it("passes a synthetic Error as the first argument, never the failure itself", () => {
    expect(captures.filter(({ text }) => !SYNTHETIC_FIRST_ARG.test(text)).map(at)).toEqual([]);
  });

  // The textual half of the privacy decision. The builder is what fingerprints free-form content;
  // a statement that names a content field is reaching past it, whatever the builder then does.
  it("names no content field on any capture statement", () => {
    expect(captures.filter(({ text }) => CONTENT_FIELD.test(text)).map(at)).toEqual([]);
  });
});

// The other half of the control: the detectors fire on the regressions they claim to detect and
// stay silent on the shipped shapes. Without this, patterns matching nothing would make every
// assertion above pass while guarding nothing at all. Every string here is FABRICATED — a
// detector control that read the tree would go green and red with the tree, which is the one
// thing it must not do.
describe("the detectors", () => {
  const DELEGATES = delegates("buildAuditFailureReport");

  it("detect an undelegated, an inline-object and a raw-cause capture", () => {
    // The pre-fix shape: no context at all.
    const undelegated = "      Sentry.captureException(err);";
    expect(CAPTURES.test(undelegated)).toBe(true);
    expect(DELEGATES.test(undelegated)).toBe(false);

    // The inline re-implementation — the defect the delegation rule exists for, and note it also
    // trips the content rule, which is the second guard catching the same edit.
    const inlineObject =
      '      Sentry.captureException(new Error(AUDIT_CAPTURE_MESSAGE), { tags: { site: "zero-saved" }, extra: { source_text: auditRow.source_text } });';
    expect(CAPTURES.test(inlineObject)).toBe(true);
    expect(DELEGATES.test(inlineObject)).toBe(false);
    expect(contentField(["source_text"]).test(inlineObject)).toBe(true);

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
    expect(contentField(["source_text", "rawRequest"]).test(shipped)).toBe(false);

    // False positives matter as much: this file fails the build, so a guard that fires on a
    // neighbouring SDK call or a lookalike identifier gets weakened by the next person it annoys.
    for (const sample of [
      "      Sentry.captureMessage(AUDIT_CAPTURE_MESSAGE);",
      "      mySentry.captureException(err);",
      "      const captureExceptionLater = () => 0;",
    ])
      expect(CAPTURES.test(sample)).toBe(false);
  });

  // The sign-out row's own shapes, because its content field is a COMMON word where
  // `generate.ts`'s five are column names. `message` inside `SIGNOUT_CAPTURE_MESSAGE` must not
  // trip it (case, plus the identifier boundaries), or the guard would redden the shipped line
  // and be turned off by the next person it annoys.
  it("tell the sign-out capture apart from one that attaches the auth error's message", () => {
    const SIGNOUT_CONTENT = contentField(TARGETS[1]?.contentFields ?? []);
    const shipped =
      "    Sentry.captureException(new Error(SIGNOUT_CAPTURE_MESSAGE), await buildSignOutFailureReport(outcome.cause));";
    const leaky =
      "    Sentry.captureException(new Error(SIGNOUT_CAPTURE_MESSAGE), { extra: { message: outcome.cause.message } });";

    expect(CAPTURES.test(shipped)).toBe(true);
    expect(delegates("buildSignOutFailureReport").test(shipped)).toBe(true);
    expect(SYNTHETIC_FIRST_ARG.test(shipped)).toBe(true);
    expect(SIGNOUT_CONTENT.test(shipped)).toBe(false);

    expect(SIGNOUT_CONTENT.test(leaky)).toBe(true);
    expect(delegates("buildSignOutFailureReport").test(leaky)).toBe(false);
  });

  // The import detector, both directions. A bare mention must not satisfy it, or the guard
  // degrades into the co-presence check it exists to be stricter than.
  it("read an import of the builder, and not a mention of one", () => {
    const IMPORTS = importsBuilder("buildAuditFailureReport", "@/lib/audit-failure-report");

    expect(
      IMPORTS.test('import { AUDIT_CAPTURE_MESSAGE, buildAuditFailureReport } from "@/lib/audit-failure-report";'),
    ).toBe(true);
    expect(IMPORTS.test("// see buildAuditFailureReport in @/lib/audit-failure-report")).toBe(false);
    expect(IMPORTS.test('import { somethingElse } from "@/lib/audit-failure-report";')).toBe(false);
    // …and it must be keyed on the target's OWN module, or the table degrades into one shared
    // rule and a handler could import the other target's builder and pass.
    expect(IMPORTS.test('import { buildAuditFailureReport } from "@/lib/signout-outcome";')).toBe(false);
  });
});

/**
 * What the catch-all inspects: `.astro` and the TypeScript sources beside them, i.e. everything
 * `Sentry` could be called from. Same reach, and for the same reason, as `no-logging.test.ts` and
 * `error-param-guard.test.ts`.
 */
function scannableFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return scannableFiles(full);
    return /\.(astro|ts|tsx)$/i.test(entry.name) ? [full] : [];
  });
}

// THE CATCH-ALL, and it is what makes this file close the class rather than add a row.
//
// Everything above is scoped to the two REGISTERED targets. That leaves the whole rest of `src/`
// unlooked-at: a third handler capturing to Sentry would not fail here, it would not be reported
// here, it simply would not be inspected — the "incomplete sweep left unstated" class that
// produced C10X-37 (from C10X-30 sweeping four of six `formData()` readers) and that this file
// was itself an instance of until 2026-08-14.
//
// So: every file under `src/` outside the table must carry NO capture at all. A new capture site
// has two honest options and no third — register a row above (declaring its builder, its module
// and the content it may not name), or do not capture. It cannot drift in unnoticed.
//
// `src/worker.ts` is deliberately NOT a registered target and passes vacuously, which is correct
// rather than a hole: it configures the SDK (`withSentry`, the two integrations, `beforeSend`)
// and captures nothing. What it configures is guarded by `tests/lib/sentry-wiring.test.ts` and
// `tests/lib/sentry-sampling.test.ts`, which are a different claim about a different line.
describe("no unregistered file under src/ captures to Sentry", () => {
  const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
  const registered = new Set(TARGETS.map((t) => resolveFromRepo(t.path)));
  const files = scannableFiles(srcRoot);
  const unregistered = files.filter((file) => !registered.has(file));
  const named = unregistered.map((f) => relative(srcRoot, f).split(sep).join("/"));

  // Positive control: without it, a walker that returned nothing — or a `registered` filter that
  // swallowed the whole tree — would make the assertion below pass while scanning zero files.
  // Floor AT the measured value (80 = every `.ts`/`.tsx`/`.astro` under `src/`, 2026-08-14), not
  // a round number below it: nothing in this guard's own breakage runs deletes a file, so there
  // is no slack to justify here and slack would give away the shrink direction.
  it("scans every file outside the registered targets", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
    expect(named).toEqual(
      expect.arrayContaining([
        // The SDK's other first-party consumer, which configures and never captures…
        "worker.ts",
        // …the two builders, which name `Sentry.captureException` in their docblocks and prove
        // the comment filter is doing its job…
        "lib/signout-outcome.ts",
        "lib/audit-failure-report.ts",
        // …and a file with nothing to do with any of it, so the walk is shown to be a walk.
        "middleware.ts",
      ]),
    );
    // …and it must genuinely EXCLUDE the registered ones, or this block would duplicate the
    // per-target assertions and go red on their (correct, delegating) captures.
    expect(named).not.toContain("pages/api/generate.ts");
    expect(named).not.toContain("pages/api/auth/signout.ts");
  });

  it("finds no Sentry.captureException outside the registered targets", () => {
    const stray = unregistered.flatMap((file) => {
      const path = relative(srcRoot, file).split(sep).join("/");
      return codeLines(file)
        .filter(({ text }) => CAPTURES.test(text))
        .map(locator(`src/${path}`));
    });

    expect(stray).toEqual([]);
  });
});
