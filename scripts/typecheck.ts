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
 * A **floor, deliberately not an equality**. `astro check` reports 133 files today (115 tsc
 * roots + 18 `.astro`), and pinning that number would make the gate go red the day someone adds
 * a file — this repository has recorded a count going stale four separate times, so a
 * self-invalidating assertion is a known-cost mistake here, not a hypothetical one.
 *
 * The number in the previous paragraph read **130** until 2026-08-03, which made it the fifth,
 * three lines above the sentence citing the rule: it was measured while this gate was being
 * built and went stale against the three files that building it added. Nothing depended on it —
 * the floor is 50 and the parser is a regex — and the fix is to keep the count out of anything
 * executable, which is why the test asserts the floor is *generous* rather than comparing it to
 * today's total.
 *
 * What the floor has to separate is "checked the project" from "checked nothing", and the
 * failure it guards against beyond FM-1 is a `tsconfig.json` whose `include`/`exclude` stopped
 * matching `src/` — a checker that genuinely ran, genuinely reported success, and genuinely
 * looked at a handful of files. 50 sits far enough below the real total to survive an ordinary
 * deletion sweep and far enough above a handful to catch that.
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
 * Node's own code for "the entry point I was told to run is not there" — i.e. the checker was
 * never installed, and the sync has nothing to say about the project at all.
 *
 * **This needs its own branch because it does NOT reach the runner's catch.** The runner spawns
 * `process.execPath` with a package entry point as its first argument, and `process.execPath`
 * always exists — so an absent `node_modules` is a module-resolution failure *inside* Node, which
 * `spawnSync` reports as an ordinary `status: 1` with `error` **undefined** (measured
 * 2026-08-03). Without this branch it falls through to the config-problem reason below, and a
 * developer on a fresh clone or a new worktree is sent to `astro.config.mjs` — which is fine —
 * while the runner's "run `npm ci`" line, written for exactly this case, never prints.
 *
 * Keyed on the CODE rather than on the English sentence beside it: `Error: Cannot find module …`
 * is prose that a Node major may reword, `MODULE_NOT_FOUND` is the stable half.
 */
const MISSING_MODULE = "MODULE_NOT_FOUND";

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
 *
 * A genuine failure then splits again, and the split is the point: "the checker is missing"
 * (`MISSING_MODULE`) and "your config is broken" send the reader to different files, so they get
 * different reasons. Reporting the second for the first is the same defect `readTscFailure`
 * exists to fix one leg over — a message naming a state the reader is not in.
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

  if (output.includes(MISSING_MODULE)) {
    return {
      ok: false,
      reason:
        "the checker itself is not installed — Node could not load `astro`'s entry point, so " +
        "nothing was checked and this says nothing about your code. On a fresh clone or a new " +
        "worktree, run `npm ci` first.",
    };
  }

  return {
    ok: false,
    reason:
      "astro sync failed before generating any types — this is a config problem, not a type " +
      "error. `astro.config.mjs` and the content/route definitions are what to look at.",
  };
}

/** What `readTscFailure` concluded about a captured, failing `tsc --noEmit` run. */
export interface TscFailure {
  /** Did `tsc` reject the CONFIG (the `TS5xxx` range) rather than the code? */
  configError: boolean;
  /** Explanation lines, ordered, to print under the runner's own header. */
  lines: string[];
}

/**
 * `TS5023`, `TS5025`, … — TypeScript's command-line/configuration range. A diagnostic in it means
 * `tsconfig.json` itself is wrong, which is a different diagnosis from a wrong line of source.
 */
const CONFIG_ERROR = /\bTS5\d{3}\b/;

/** `TS2307` on an `astro:*` specifier — the signature of generated types that never got made. */
const STALE_TYPES = /TS2307[^\n]*astro:/;

/**
 * Explain why the `tsc` leg stopped the gate before `astro check` ran.
 *
 * **There are two reasons and they are not interchangeable — which is the defect this function
 * exists to fix.** The runner used to print the config-error rationale unconditionally, so an
 * ordinary `TS2322` came back as "a tsconfig error (TS5xxx) makes `astro check`'s own verdict
 * untrustworthy". Measured on a real blocked push: a one-line type error in `src/lib/utils.ts`
 * told the developer to go and look at `tsconfig.json`. That is verbatim the class this project
 * keeps recording — a message naming a state the reader is not in — and on a `pre-push` hook it
 * is worse than untidy, because the whole reason the gate sits on push rather than commit is to
 * remove standing incentives to reach for `--no-verify`. A misdiagnosis is such an incentive.
 *
 * So the branch is on the diagnostics actually captured:
 *
 *   - a `TS5xxx` present → the config really is broken, and FM-2 applies: `astro check` would
 *     report `0 errors` over the whole project anyway, because
 *     @volar/kit/lib/createChecker.js:15-17 drops the parsed command line's `errors` array. Its
 *     opinion is worthless here and is deliberately not collected.
 *   - otherwise → ordinary type errors, and the reason to stop is that `astro check` has nothing
 *     to add about them: it resolves the same `tsconfig.json` at the same strictness, so it
 *     would reprint these same diagnostics at ~3× the cost.
 *
 * The stale-generated-types line rides along in both branches as a belt for the residue: leg 1
 * (`astro sync`) has already run and succeeded by the time this is reached, so `astro:*` still
 * being unresolved means something else broke the generated types, and the reader should be told
 * the one command that rebuilds them. It ADDS a line; the runner never suppresses or rewrites
 * `tsc`'s own output.
 *
 * @param output `tsc`'s combined stdout+stderr, ANSI already stripped by the runner.
 */
export function readTscFailure(output: string): TscFailure {
  const configError = CONFIG_ERROR.test(output);

  const lines = configError
    ? [
        "A tsconfig error (TS5xxx) makes `astro check`'s own verdict untrustworthy — it reports",
        "`0 errors` over the whole project under a broken config — so its opinion is deliberately",
        "not collected on top of this one. Fix `tsconfig.json` first.",
      ]
    : [
        "These are ordinary type errors, not a config problem. `astro check` runs the same",
        "compiler at the same strictness, so it would only reprint them at ~3× the cost; fix the",
        "lines above and the gate re-runs both legs.",
      ];

  if (STALE_TYPES.test(output)) {
    lines.push("Generated types look stale — run `npx astro sync` and try again.");
  }

  return { configError, lines };
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
 * `Result (N files):` — the line `astro check` prints exactly once, at the end of a run that
 * happened. Tolerant of the singular, of extra spacing and of a trailing space after the colon
 * (which the real output carries), because none of those are the thing being asserted.
 *
 * Matched globally and read from the END, because the block is emitted *after* every diagnostic
 * (`@astrojs/check/dist/index.js:71`). Taking the first match instead would let any earlier line
 * matching at column 0 win — which fails closed in the usual direction (a small number falls
 * below the floor) but would be a **false green** for an earlier large one, and a false green is
 * the single thing this module exists to prevent. Free to make unreachable, so it is.
 */
const RESULT_LINE = /^Result \((\d+) files?\)/gm;

/**
 * Decide whether a captured `astro check` run is evidence of anything.
 *
 * @param output the checker's combined stdout+stderr, ANSI already stripped by the runner.
 */
export function readCheckResult(output: string): CheckVerdict {
  // `.at(-1)`, never `.exec` — see RESULT_LINE. A `g` regex also carries `lastIndex` across
  // calls, so `matchAll` (which works on a fresh iterator) is the safe reader as well as the
  // correct one.
  const match = [...output.matchAll(RESULT_LINE)].at(-1);

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
