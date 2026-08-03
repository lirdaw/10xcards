import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — see
// test-plan.md §6.1 on why its test still sits in tests/lib/ beside the suite's other
// pure-function files rather than in a tests/scripts/ folder holding one file.
import { MIN_CHECKED_FILES, readCheckResult, readSyncResult } from "../../scripts/typecheck.ts";

// The half of the type gate that can be decided WITHOUT spawning a checker. The runner beside
// it (./run-typecheck.ts) spawns `astro sync`, `tsc` and `astro check` and owns the exit code;
// this half owns the one decision that makes the gate trustworthy, which is why it is a
// separate assertable module rather than a line of shell (the same split
// scripts/schema-drift.ts and scripts/kong-keepalive.ts already use).
//
// The spawns themselves are NOT covered here and cannot be: they are live invocations of two
// first-party CLIs. Their evidence is the recorded falsification runs in the change's
// verification.md — never an assertion in this suite. `npm test` covers this file and nothing
// else about the gate.
//
// WHAT THIS MODULE EXISTS FOR — read this before relaxing anything below. `astro check` exits
// **0 when its own tooling is missing**: astro/dist/cli/index.js:224 evaluates
// `process.exit(typeof checkServer === "boolean" && checkServer ? 1 : 0)`, and with
// @astrojs/check absent `checkServer` is not a boolean, so the ternary yields 0. Nothing was
// checked and the command reports success. That is exactly the class lessons.md names —
// "a command that ALWAYS exits 0 is not a gate" — so the verdict is based on the checker's
// OUTPUT, never on its exit code.

/**
 * `astro check`'s real green output on this repository, measured 2026-08-02 on `main`.
 *
 * Trailing space after the colon included deliberately: it is what the tool emits, and a
 * fixture tidied into what a reader expects is a fixture that stops testing the real format.
 * ANSI escapes are stripped because the runner captures with colour disabled; the four
 * `ts(6387)` hint blocks above the Result block are elided as `…` only in this comment — the
 * fixture below carries the Result block verbatim, which is the part the parser reads.
 */
const REAL_GREEN_RESULT = `Result (130 files):
- 0 errors
- 0 warnings
- 4 hints
`;

/**
 * The FM-1 output, measured — **and it has two shapes, which is worse than one**.
 *
 * Both were produced on 2026-08-02 by renaming `node_modules/@astrojs/check` away and running
 * `npx astro check`. Both exit **0**. Neither carries a `Result (N files):` line, which is the
 * single property this module keys on, and that is deliberate: keying on the `[ERROR]` string
 * would catch the CI shape and wave the local one straight through.
 */
const FM1_CI = `To continue, Astro requires the following dependency to be installed: @astrojs/check. Packages cannot be installed automatically in CI environments.
22:53:22 [ERROR] [check] The \`@astrojs/check\` and \`typescript\` packages are required for this command to work. Please manually install them into your project and try again.
`;

/**
 * The LOCAL shape, and the reason this fixture is a pair rather than a single string.
 *
 * Off a CI runner, `astro check` does not error at all — it offers to install the package and
 * waits for an answer. With stdin not a TTY the prompt resolves to nothing and the process
 * exits **0** having printed no `[ERROR]`, no diagnostic, and no Result block. The plan for
 * this change described only the CI shape; this one was found by measuring, and it is the more
 * dangerous of the two precisely because it looks like a clean run to a developer scrolling
 * past a prompt.
 */
const FM1_LOCAL = `To continue, Astro requires the following dependency to be installed: @astrojs/check.

  Astro will run the following command:
  If you skip this step, you can always run it yourself later
╭────────────────────────────────────╮
│  npm i @astrojs/check typescript   │
╰────────────────────────────────────╯
◆  Continue?
● Yes / ○ No
`;

describe("readCheckResult", () => {
  // THE POSITIVE CONTROL, and it is load-bearing rather than decorative: every rejection case
  // below is satisfied by a function that returns `ok: false` for everything, which would read
  // as perfect protection while blocking every push and every CI run.
  it("accepts the real green output and reports the file count it parsed", () => {
    const verdict = readCheckResult(REAL_GREEN_RESULT);

    expect(verdict.ok).toBe(true);
    expect(verdict.files).toBe(130);
  });

  // FM-1, CI shape.
  it("rejects the missing-tooling output that `astro check` exits 0 on, in CI", () => {
    const verdict = readCheckResult(FM1_CI);

    expect(verdict.ok).toBe(false);
    expect(verdict.files).toBeNull();
  });

  // FM-1, local shape — the one that carries no `[ERROR]` at all. Keeping both fixtures is
  // what pins that the parser keys on the ABSENCE of a Result line rather than on the presence
  // of an error string.
  it("rejects the missing-tooling prompt that `astro check` exits 0 on, locally", () => {
    const verdict = readCheckResult(FM1_LOCAL);

    expect(verdict.ok).toBe(false);
    expect(verdict.files).toBeNull();
  });

  // A Result line can also lie downward. `tsconfig.json`'s `include` is `["**/*"]` plus one
  // explicit entry, so a bad edit there — or an `exclude` that swallowed `src/` — produces a
  // checker that ran, reported success, and looked at a handful of files. The floor
  // distinguishes "checked the project" from "checked almost nothing"; it is deliberately NOT
  // an equality against today's 130, because a pinned count goes stale the day a file is added
  // and this repository has recorded a count going stale four separate times.
  it("rejects a Result line whose file count is below the floor", () => {
    const verdict = readCheckResult("Result (3 files): \n- 0 errors\n");

    expect(verdict.ok).toBe(false);
    expect(verdict.files).toBe(3);
  });

  // The floor's own positive control: a count exactly AT it passes, so the comparison cannot
  // silently be strict-greater over a value nobody would notice.
  it("accepts a count exactly at the floor", () => {
    const verdict = readCheckResult(`Result (${String(MIN_CHECKED_FILES)} files): \n- 0 errors\n`);

    expect(verdict.ok).toBe(true);
    expect(verdict.files).toBe(MIN_CHECKED_FILES);
  });

  // The boundary this module deliberately does NOT own. `astro check` already exits 1 when it
  // finds errors, and the runner propagates that; re-deciding it here would give the gate two
  // disagreeing opinions about the same run. This verdict answers exactly one question — "did
  // the checker look at the project?" — so a red run that DID look at the project is `ok: true`
  // here and still fails the gate, at the exit code, where it belongs.
  it("is about coverage, not cleanliness: a run with real errors still counts as having run", () => {
    const verdict = readCheckResult("Result (130 files): \n- 7 errors\n- 0 warnings\n- 4 hints\n");

    expect(verdict.ok).toBe(true);
    expect(verdict.files).toBe(130);
  });

  // The reason travels to a human through the runner's own summary, so it must name the state
  // the reader is actually in — for FM-1 that means naming the packages to install, since
  // "something failed" over a zero exit code is the least actionable message this gate could
  // produce.
  it("explains an FM-1 rejection by naming what to install", () => {
    const verdict = readCheckResult(FM1_CI);

    expect(verdict.reason).toContain("@astrojs/check");
    expect(verdict.reason).toContain("typescript");
  });

  it("explains a below-floor rejection by naming the count and the floor", () => {
    const verdict = readCheckResult("Result (3 files): \n- 0 errors\n");

    expect(verdict.reason).toContain("3");
    expect(verdict.reason).toContain(String(MIN_CHECKED_FILES));
  });
});

/**
 * `astro sync` finishing its work and THEN aborting at process teardown — measured on this
 * Windows machine, 2026-08-02, at roughly **one run in five** (1/5 in the first sampled batch).
 *
 * `0xC0000409` is Windows' abort code; the libuv assertion is a teardown race in the child, and
 * it fires *after* `[types] Generated` — i.e. after `.astro/types.d.ts` has actually been
 * written. Discovered by a falsification probe for something else entirely, which is the only
 * reason it was not shipped as an intermittently red gate blaming `astro.config.mjs`.
 */
const SYNC_TEARDOWN_ABORT = `Using secrets defined in .env
22:58:20 [types] Generated 919ms
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94
`;

/** A genuine config failure, measured the same day by appending invalid JS to the config. */
const SYNC_REAL_FAILURE = `[astro] Unable to load your Astro config

Failed to parse source for import analysis because the content contains invalid JS syntax.
  Location:
    astro.config.mjs:1:0
`;

/** The ordinary success, for completeness. */
const SYNC_CLEAN = `Using secrets defined in .env
22:57:12 [types] Generated 934ms
`;

describe("readSyncResult", () => {
  it("accepts an ordinary clean sync", () => {
    expect(readSyncResult(SYNC_CLEAN, 0).ok).toBe(true);
  });

  // THE CASE THIS FUNCTION EXISTS FOR. `astro sync` writes `.astro/types.d.ts` and then, about
  // one run in five on Windows, aborts at teardown with a libuv assertion. The work is DONE —
  // the marker proves it — so treating the exit code as the oracle would fail the gate on a
  // successful sync and, worse, blame `astro.config.mjs` in the message. Judging the leg by its
  // output rather than its status is the same rule ./typecheck.ts applies to `astro check`,
  // arrived at independently and for the opposite reason: there a zero exit hid a failure, here
  // a non-zero exit hides a success.
  it("accepts a sync that generated types and then aborted at teardown", () => {
    const verdict = readSyncResult(SYNC_TEARDOWN_ABORT, 3221226505);

    expect(verdict.ok).toBe(true);
  });

  // THE POSITIVE CONTROL, and without it the case above is satisfied by `() => ({ ok: true })`
  // — which would make the sync leg unfalsifiable and let a broken config reach `tsc` as a pile
  // of confusing `TS2307`s. A real failure never reaches the marker.
  it("rejects a sync that failed before generating anything", () => {
    const verdict = readSyncResult(SYNC_REAL_FAILURE, 1);

    expect(verdict.ok).toBe(false);
  });

  // The message has to send the reader to the right file: a config failure reported as a type
  // error is the wrong diagnosis, which is the whole reason this leg reports separately.
  it("explains a real failure by pointing at the config rather than at types", () => {
    expect(readSyncResult(SYNC_REAL_FAILURE, 1).reason).toContain("config");
  });
});

describe("MIN_CHECKED_FILES", () => {
  // A floor, not an equality — but a floor set above the count it is meant to catch is just a
  // pinned count wearing a different name, and one set at 0 is no assertion at all. This pins
  // it into the band where it separates "the project" from "nothing" without tracking the
  // project's size.
  it("is a generous floor, well below today's real count and well above zero", () => {
    expect(MIN_CHECKED_FILES).toBeGreaterThan(0);
    expect(MIN_CHECKED_FILES).toBeLessThan(130);
  });
});
