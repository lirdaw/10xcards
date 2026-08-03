// Everything about the type gate that can be decided WITHOUT spawning a checker. No
// child_process, no filesystem, no console — all of that lives in the runner beside this file
// (./run-typecheck.ts), which is what makes this half testable with ordinary fixtures. Same
// split as scripts/schema-drift.ts and scripts/kong-keepalive.ts.
//
// WHY THE GATE CANNOT TRUST AN EXIT CODE. `astro check` exits **0 when its own tooling is
// missing**: astro/dist/cli/index.js:224 evaluates
// `process.exit(typeof checkServer === "boolean" && checkServer ? 1 : 0)`, and with
// @astrojs/check absent `checkServer` never becomes a boolean, so the ternary yields 0. The
// command reports success having checked nothing. That is verbatim the class lessons.md names
// ("Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką"), and the rule it prescribes is
// the one applied here: base the verdict on the command's OUTPUT, asserting a **positive**
// string rather than the absence of a negative one.
//
// Measured 2026-08-02 by renaming `node_modules/@astrojs/check` away, the failure has **two**
// shapes and only one of them says `[ERROR]`:
//
//   - on a CI runner — "Packages cannot be installed automatically in CI environments" plus an
//     `[ERROR] [check]` line, exit 0;
//   - locally — an interactive "Continue?" install prompt that resolves to nothing when stdin
//     is not a TTY, printing no error at all, exit 0.
//
// So the positive string this module requires is `astro check`'s own Result block, whose
// absence covers both shapes. Keying on `[ERROR]` would have caught the first and waved the
// second — the more dangerous one — straight through.
//
// Why this file sits in `scripts/` rather than `src/`: the runner prints, and
// tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. Keeping this
// half next to it makes their import a sibling instead of the deep relative `../src/lib/…`
// path AGENTS.md's first Hard Rule forbids (the `@/*` alias does not resolve under Node's type
// stripping).

/**
 * The smallest file count that still means "the checker looked at this project".
 *
 * A **floor, deliberately not an equality**. `astro check` reports 130 files today (112 tsc
 * roots + 18 `.astro`), and pinning that number would make the gate go red the day someone adds
 * a file — this repository has recorded a count going stale four separate times, so a
 * self-invalidating assertion is a known-cost mistake here, not a hypothetical one.
 *
 * What the floor has to separate is "checked the project" from "checked nothing", and the
 * failure it guards against beyond FM-1 is a `tsconfig.json` whose `include`/`exclude` stopped
 * matching `src/` — a checker that genuinely ran, genuinely reported success, and genuinely
 * looked at a handful of files. 50 sits far enough below 130 to survive an ordinary deletion
 * sweep and far enough above a handful to catch that.
 */
export const MIN_CHECKED_FILES = 50;

/** What a leg of the gate concluded about a captured run. */
export interface SyncVerdict {
  /** Did `.astro/types.d.ts` actually get written? */
  ok: boolean;
  /** Human-readable, and pointed at the right file. */
  reason: string;
}

/**
 * The line `astro sync` prints once it has written the generated types. Its presence is proof
 * the leg did its job — which the exit code, measured, is not.
 */
const TYPES_GENERATED = "[types] Generated";

/**
 * Decide whether `astro sync` did its job.
 *
 * **The exit code is not the oracle here, and this is the mirror image of `readCheckResult`'s
 * problem rather than a repeat of it.** There, a zero exit hid a failure. Here, a NON-zero exit
 * hides a success: measured on Windows 2026-08-02 at roughly one run in five, `astro sync`
 * writes the types, prints `[types] Generated 919ms`, and then aborts at process teardown with
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` and
 * status `3221226505` (`0xC0000409`, Windows' abort code). The work is done; the process just
 * fails to shut down cleanly.
 *
 * Trusting the status would make the gate intermittently red on a SUCCESSFUL sync — and, worse,
 * red with the wrong diagnosis, since a failing sync leg reports "this is a config problem".
 * A developer meeting that at random on `git push` has every incentive to reach for
 * `--no-verify`, which is exactly what the hook is designed not to need.
 *
 * A genuine failure never reaches the marker: measured by appending invalid JS to
 * `astro.config.mjs`, `astro sync` exits 1 printing `[astro] Unable to load your Astro config`
 * and nothing else — so the marker separates the two cleanly, in both directions.
 */
export function readSyncResult(output: string, status: number): SyncVerdict {
  if (status === 0) {
    return { ok: true, reason: "astro sync completed." };
  }

  if (output.includes(TYPES_GENERATED)) {
    return {
      ok: true,
      reason:
        `astro sync generated the types and then exited ${String(status)} — a teardown abort, ` +
        "not a failure. The generated types are on disk, so the gate continues.",
    };
  }

  return {
    ok: false,
    reason:
      "astro sync failed before generating any types — this is a config problem, not a type " +
      "error. `astro.config.mjs` and the content/route definitions are what to look at.",
  };
}

/** What `readCheckResult` concluded about a captured `astro check` run. */
export interface CheckVerdict {
  /**
   * Did the checker actually look at the project?
   *
   * **Not "is the code clean".** `astro check` already exits 1 on errors and the runner
   * propagates that, so re-deciding cleanliness here would give the gate two opinions about one
   * run. A red run that DID check the project is `ok: true` here and still fails the gate — at
   * the exit code, where it belongs.
   */
  ok: boolean;
  /** The count parsed out of the Result block, or `null` when no such block was produced. */
  files: number | null;
  /** Human-readable, and written for the terminal the developer is actually in. */
  reason: string;
}

/**
 * `Result (130 files):` — the line `astro check` prints exactly once, at the end of a run that
 * happened. Tolerant of the singular, of extra spacing and of a trailing space after the colon
 * (which the real output carries), because none of those are the thing being asserted.
 */
const RESULT_LINE = /^Result \((\d+) files?\)/m;

/**
 * Decide whether a captured `astro check` run is evidence of anything.
 *
 * @param output the checker's combined stdout+stderr, ANSI already stripped by the runner.
 */
export function readCheckResult(output: string): CheckVerdict {
  const match = RESULT_LINE.exec(output);

  if (!match) {
    return {
      ok: false,
      files: null,
      reason:
        "`astro check` produced no `Result (N files):` line, so it checked nothing — and it " +
        "exits 0 in that state, which is why this is asserted rather than inferred from the " +
        "exit code. The usual cause is missing tooling: install it with " +
        "`npm i @astrojs/check typescript`. Off a CI runner the same failure appears as an " +
        "interactive install prompt and prints no error at all.",
    };
  }

  const files = Number(match[1]);

  if (files < MIN_CHECKED_FILES) {
    return {
      ok: false,
      files,
      reason:
        `\`astro check\` reported only ${String(files)} files, below the floor of ` +
        `${String(MIN_CHECKED_FILES)}. It ran, but over almost nothing — check ` +
        "`tsconfig.json`'s `include` / `exclude`.",
    };
  }

  return {
    ok: true,
    files,
    reason: `\`astro check\` covered ${String(files)} files.`,
  };
}
