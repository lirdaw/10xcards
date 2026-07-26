/**
 * Per-case source-text markers, and the LIKE pattern that scopes a count by one.
 *
 * WHY THIS EXISTS AT ALL — the trap it encodes is not obvious and costs an afternoon.
 * PostgREST carries filters in the query string and Kong caps the request line at ~8 KB, so
 * `.eq("source_text", <a 10 000-character body>)` answers **`414 URI too long`** — measured
 * against this stack: n=8000 through, n=10000 and n=10001 → 414. The generation bounds cases
 * send exactly such bodies, so a text-scoped oracle goes red on the transport for a reason
 * with nothing to do with the behaviour under test. Scope by a short marker in the FIRST
 * characters of every source text instead, and the filter stays a few dozen bytes whatever
 * the body's length.
 *
 * WHY IT IS A FIXTURE — it was copied character-for-character between
 * `tests/generation/generate.test.ts` and `tests/generation/failure-path.test.ts`, which is
 * the same one-rule-two-definitions drift `src/lib/generation-limits.ts` exists to end one
 * layer down (impl-review F7). `tests/fixtures/` is where shared apparatus lives.
 *
 * The `suffix` a caller passes is §6.5's file-level `Date.now().toString(36)` namespace. It
 * separates RUNS; the case name separates the `it()`s of one run, which all read as the same
 * account A and would otherwise be summed by an unscoped `count(*)`.
 */

/**
 * Case names must stay LIKE-safe.
 *
 * `%` and `_` are wildcards in a LIKE pattern, so a name carrying either would silently turn
 * a scoped count into one that matches other cases' rows — a false green, not an error. The
 * names are authored in test files, so this is a setup assertion rather than input
 * validation: fail loudly at the point of authorship.
 */
const SAFE_CASE_NAME = /^[a-z0-9-]+$/;

export interface Scoping {
  /** The marker that opens one case's source text. `]` terminates it, so no marker is a prefix of another's. */
  mark: (caseName: string) => string;
  /** The LIKE pattern for a source text: its marker alone, whatever the body's length. */
  scope: (sourceText: string) => string;
}

export function createScoping(suffix: string): Scoping {
  return {
    mark(caseName: string): string {
      if (!SAFE_CASE_NAME.test(caseName)) {
        throw new Error(
          `Setup failed: case name "${caseName}" must match ${String(SAFE_CASE_NAME)} — ` +
            `LIKE treats % and _ as wildcards, so an unsafe name scopes a count to more rows than it names.`,
        );
      }
      return `[${suffix}:${caseName}]`;
    },

    scope(sourceText: string): string {
      const end = sourceText.indexOf("]");
      if (end < 0) throw new Error(`Setup failed: "${sourceText.slice(0, 40)}…" carries no marker.`);
      return `${sourceText.slice(0, end + 1)}%`;
    },
  };
}
