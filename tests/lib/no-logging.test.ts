import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Risk #4's log-line half (test-plan §2): "private source text or the LLM API key escapes
// into a log line or an error response body". The response-body half is carried by the
// endpoint's fixed literals; THIS file carries the log half, and only for what this repo
// writes.
//
// Why a test rather than the lint rule: `no-console` is configured "warn"
// (eslint.config.js:23) and the script is a bare `eslint .` with no `--max-warnings`, so a
// `console.log(sourceText)` would ship with CI green. A failing test is the gate.
//
// SCOPE — the whole of `src/`, deliberately, not the request-path subset. Every `.astro`
// frontmatter runs server-side on each request and reaches Workers Logs identically to an
// API route; `src/pages/generate.astro` and `src/pages/study/[publicId].astro` handle
// exactly the private data this risk is about. A narrower allow-list would read as
// coverage while leaving them open.
//
// THE BOUNDARY, stated so nobody mistakes this for more than it is. It covers first-party
// code only. Dependencies do log, those lines are inside Risk #4's scope, and they are NOT
// owned here: `@supabase/ssr/dist/module/cookies.js:22,29` and
// `@supabase/auth-js/dist/module/lib/fetch.js:110` reach Workers Logs via
// `wrangler.jsonc:17-19` (`observability.enabled: true`, no sampling). They were measured
// and carry session/transport material — on `fetch.js:110` the logged value is a fetch
// `TypeError` (message + stack), not the request `init` — never pasted source text. Pinning
// `node_modules` internals would break on every patch bump with no user-visible cause.

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * Textual on purpose. `.astro` files are not parseable by anything this suite loads, so an
 * AST pass would silently skip a third of the tree — the third that renders pages. The cost
 * is that a mention inside a comment or a string also trips the guard; that is the intended
 * trade (reword the comment) and the failure message names file and line.
 */
const CONSOLE_CALL = /console\s*\.\s*[A-Za-z_$][\w$]*\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

function consoleCallsIn(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) =>
      CONSOLE_CALL.test(line) ? [`${relative(SRC_DIR, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`] : [],
    );
}

describe("src/ writes no log lines", () => {
  const files = sourceFiles(SRC_DIR);

  // Positive control, and it is load-bearing rather than ceremony: a walker that returned
  // an empty list, or a regex that matched nothing, would make the assertion below pass
  // while guarding nothing at all.
  it("scans the whole src/ tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => relative(SRC_DIR, f).split(sep).join("/"))).toEqual(
      expect.arrayContaining(["middleware.ts", "lib/openrouter.ts", "pages/api/generate.ts", "pages/generate.astro"]),
    );
  });

  // The other half of the control: the detector fires on what it claims to detect,
  // including the spacings and aliases a plain `includes("console.log(")` would miss.
  it("detects a console call when there is one", () => {
    for (const sample of [
      "console.log(x)",
      "console . error ( e )",
      "console.warn(`${a}`)",
      "globalThis.console.debug(",
    ])
      expect(CONSOLE_CALL.test(sample)).toBe(true);
    expect(CONSOLE_CALL.test("// the console shows it")).toBe(false);
  });

  it("contains no console.* call anywhere", () => {
    expect(files.flatMap(consoleCallsIn)).toEqual([]);
  });
});
