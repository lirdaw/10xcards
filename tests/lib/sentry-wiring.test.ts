import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The wiring half of the Sentry sampling decision (C10X-54, 2026-08-12). Its sibling,
// `tests/lib/sentry-sampling.test.ts`, proves the DECISION is right; this file proves
// `src/worker.ts` still makes it.
//
// WHY BOTH ARE NEEDED, and it is the same split this project has already closed twice. The truth
// table stays fully green if `src/worker.ts` drops `beforeSend`, stops calling the helper, or
// imports it and re-implements the decision two lines down — and **no layer in this project loads
// `src/worker.ts`**: it is `wrangler.jsonc`'s `main`, it runs before Astro exists, and the only
// other mentions of Sentry under `tests/` are the e2e preflight blanking the DSN. Until this change
// the public `/api/shipprobe` route was the last end-to-end instrument for that property; deleting
// it is what makes this guard load-bearing rather than tidy. Precedents, both written for exactly
// this reason: `tests/lib/error-param-guard.test.ts` (C10X-34 impl-review F2 — "a regression
// deleting the `ownedAuthMessage(...)` call leaves the suite green") and
// `tests/lib/no-client-redirect-errors.test.ts` (C10X-40).
//
// WHY TEXTUAL: importing `src/worker.ts` would execute `@astrojs/cloudflare/entrypoints/server` at
// module scope — the adapter entrypoint, in a Node test process with no Worker and no `env`. The
// species already exists three times over in this folder (`error-param-guard.test.ts`,
// `no-client-redirect-errors.test.ts`, `no-logging.test.ts`), so the guard sits beside its siblings
// rather than inventing a mechanism.
//
// WHAT IT PROVES, and do not read it as more: the call is **present and composed**. It does NOT
// prove that Sentry actually invokes `beforeSend`, nor that the roll reaches the helper at runtime.
// Nothing in this project can assert either after the probe's removal.
//
// THE ACCEPTED TRADE, stated here so the next person weakens it deliberately or not at all:
// splitting the delegation across lines trips this guard even when the wiring is correct. That is
// the price of the per-LINE rule, and the rule is the point — co-presence of the import is exactly
// what a re-inlined decision would satisfy. Re-check the wiring and keep it on one line, or widen
// the pattern with a recorded reason. `src/worker.ts` carries the same note at the site.

const WORKER = fileURLToPath(new URL("../../src/worker.ts", import.meta.url));

/** A line that SUPPLIES `beforeSend` — the property shorthand and the method shorthand alike. */
const SUPPLIES_BEFORE_SEND = /(?<![\w$])beforeSend\s*[:(]/;

/** …and the only acceptable way to supply it: by calling the extracted decision, on the spot. */
const DELEGATES = /(?<![\w$])sampleSentryEvent\s*\(/;

/** The import that makes the delegation resolve to the audited module and not to something else. */
const IMPORTS_HELPER = /import\s*\{[^}]*\bsampleSentryEvent\b[^}]*\}\s*from\s*["']@\/lib\/sentry-sampling["']/;

/**
 * Lines with comment-only AND blank lines dropped — the same helper shape
 * `error-param-guard.test.ts` needed the moment its scan reached `.ts`. Load-bearing here rather
 * than defensive: the comment block directly above the delegation NAMES `beforeSend` while
 * explaining this very rule, so a scan that did not skip comments would report the documentation of
 * the guard as a violation of it.
 *
 * Blanks are dropped for the floor's sake rather than the patterns' (impl-review F3): neither
 * pattern below can match whitespace, but a count that included blanks let three deleted code lines
 * be masked by three blank ones, which is exactly the slack the floor's own comment disclaims.
 * `index` is assigned BEFORE the filter, so the reported line numbers stay the file's own.
 */
function codeLines(file: string): { text: string; index: number }[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim() !== "" && !/^\s*(\/\/|\*|\/\*)/.test(text));
}

describe("src/worker.ts delegates beforeSend to the extracted sampling decision", () => {
  const lines = codeLines(WORKER);
  const source = readFileSync(WORKER, "utf8");

  // Positive control on the READ itself, load-bearing rather than ceremony. `readFileSync` throws
  // on a missing file, so a delete is already red — but a file that was emptied, renamed to
  // something the adapter no longer loads, or replaced by a stub would leave every assertion below
  // vacuously true. The named token is the one that makes this file the Sentry wrapper at all.
  it("reads the real Worker entry", () => {
    // Floor AT the measured value (17 lines of real code), not a round number below it — slack here
    // gives away the shrink direction, and shrink is the silent one. Same rule as
    // `error-param-guard.test.ts`'s unregistered-file floor and `form-endpoint-guards.test.ts`'s
    // emission floor. Comment AND blank lines are already dropped, so neither documenting this file
    // nor re-spacing it moves the count — which is what makes "AT the measured value" literal
    // rather than approximate (impl-review F3: it read 20 while three of those were blank).
    expect(lines.length).toBeGreaterThanOrEqual(17);
    expect(source).toContain("Sentry.withSentry");
  });

  // The other half of the control: the detector fires on the regression it claims to detect and
  // stays silent on the shipped shape. Without this, a pattern matching nothing would make the
  // assertion below pass while guarding nothing at all.
  it("detects an undelegated beforeSend, and accepts the delegated one", () => {
    // The pre-extraction shape — the method shorthand opening an inline block. This is the exact
    // line the second deliberate-breakage run restores, and the one a re-inline produces even when
    // the import is left in place.
    const inlineOpen = "    beforeSend(event) {";
    expect(SUPPLIES_BEFORE_SEND.test(inlineOpen)).toBe(true);
    expect(DELEGATES.test(inlineOpen)).toBe(false);

    // …and the one-line re-inline, which is the same defect without the block.
    const inlineArrow = "    beforeSend: (event) => (DEPENDENCY_NOISE.some((p) => p.test(x)) ? null : event),";
    expect(SUPPLIES_BEFORE_SEND.test(inlineArrow)).toBe(true);
    expect(DELEGATES.test(inlineArrow)).toBe(false);

    // The shipped shape.
    const shipped = "    beforeSend: (event) => sampleSentryEvent(event, Math.random()),";
    expect(SUPPLIES_BEFORE_SEND.test(shipped)).toBe(true);
    expect(DELEGATES.test(shipped)).toBe(true);

    // False positives matter as much: this file fails the build, so a guard that fires on a
    // neighbouring option or on a lookalike identifier gets weakened by the next person it annoys.
    for (const sample of [
      "    beforeSendTransaction: (event) => event,",
      "    integrations: [Sentry.captureConsoleIntegration({ levels: ['warn', 'error'] })],",
      "    dsn: env.SENTRY_DSN,",
    ])
      expect(SUPPLIES_BEFORE_SEND.test(sample)).toBe(false);

    // The import detector, both directions. A bare mention must not satisfy it, or the guard
    // degrades into the co-presence check it exists to be stricter than.
    expect(IMPORTS_HELPER.test('import { sampleSentryEvent } from "@/lib/sentry-sampling";')).toBe(true);
    expect(IMPORTS_HELPER.test("// see sampleSentryEvent in @/lib/sentry-sampling")).toBe(false);
    expect(IMPORTS_HELPER.test('import { somethingElse } from "@/lib/sentry-sampling";')).toBe(false);
  });

  // The import, so the delegation cannot resolve to a local re-implementation that happens to carry
  // the same name.
  it("imports the decision from @/lib/sentry-sampling", () => {
    expect(lines.filter(({ text }) => IMPORTS_HELPER.test(text))).toHaveLength(1);
  });

  // THE ASSERTION. Exactly one line supplies `beforeSend`, and it is the line that delegates.
  // Reported with file and line number, as its siblings do, so a red names the edit rather than the
  // rule.
  it("supplies beforeSend on exactly one line, and that line calls the helper", () => {
    const supplying = lines.filter(({ text }) => SUPPLIES_BEFORE_SEND.test(text));

    expect(supplying.map(({ text, index }) => `src/worker.ts:${index + 1}: ${text.trim()}`)).toHaveLength(1);
    expect(
      supplying
        .filter(({ text }) => !DELEGATES.test(text))
        .map(({ text, index }) => `src/worker.ts:${index + 1}: ${text.trim()}`),
    ).toEqual([]);
  });
});
