/* eslint-disable no-console -- this file IS the report: it is the gate's only output surface,
   and the checker output it relays plus the verdict it prints are the evidence a reader has
   that anything was checked at all. It deliberately lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of the type gate. Everything decidable is next door in ./typecheck.ts as a pure
// function with measured fixtures; this file spawns, captures, relays, and owns the exit code.
//
// THREE LEGS, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING:
//
//   1. `astro sync`  — regenerates `.astro/types.d.ts`.
//   2. `tsc --noEmit` — sees the `TS5xxx` config-error class that `astro check` is blind to.
//   3. `astro check` — the genuine superset: same tsconfig, full TS language service, plus the
//      18 `.astro` files `tsc` cannot parse at all.
//
// **Why sync comes first.** `tsc` hard-depends on `.astro/types.d.ts` — measured with that file
// absent, `tsc --noEmit` exits 2 with 13 errors (`TS2307 Cannot find module 'astro:env/server'`
// ×10, `astro:middleware` ×1, two `TS7006` in middleware.ts). `astro check` self-syncs and
// `tsc` does not, so with the leg order alone the gate would short-circuit on leg 2 and never
// reach the one leg that would have fixed it. Reachable in ordinary use: a fresh clone (`npm
// ci` does not sync), a branch switch that changed routes or content — the case AGENTS.md
// already documents for `lint` — or any `.astro/` wipe. Left unhandled that is a blocked push
// citing 13 errors in files the developer never touched, i.e. precisely the standing incentive
// to reach for `--no-verify` that the hook exists without.
//
// **Why tsc short-circuits astro check.** A non-zero `tsc` can mean the config itself is
// broken, and `astro check`'s verdict under a broken config is untrustworthy in a specific,
// measured way (FM-2): `strctNullChecks` in tsconfig makes `tsc` exit 2 with `TS5025` while
// `astro check` cheerfully reports `0 errors` over 130 files, because
// @volar/kit/lib/createChecker.js:15-17 drops the parsed command line's `errors` array. Running
// on regardless would also print the same diagnostics twice at ~3× the cost.
//
// **Why `process.execPath` rather than the `.bin` shims.** These scripts run under bare
// `node --experimental-strip-types` on Windows and on the Linux runner. `node_modules/.bin`
// carries `.cmd` shims on Windows, and spawning one without a shell fails with `EINVAL`.
// Invoking the packages' own JS entry points with the running Node binary sidesteps the whole
// class rather than papering over it, and needs no `shell: true` (which would put an argument
// vector through cmd.exe quoting).
//
// Zero runtime dependencies — `node:child_process` and `node:url` only, matching
// ./check-schema-drift.ts and ./disable-kong-keepalive.ts. That is what lets CI invoke this
// with bare `node --experimental-strip-types`.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MIN_CHECKED_FILES, readCheckResult, readSyncResult, readTscFailure } from "./typecheck.ts";

/**
 * Resolved from this file's own location, not from `process.cwd()`, so the gate checks the
 * checkout it ships with no matter where it is invoked from.
 */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Package entry points, invoked with the running Node binary — see the header on `.cmd`. */
const ASTRO_BIN = fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url));
const TSC_BIN = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

/**
 * `astro check` colours its output, and colour codes inside a `Result (…)` line would defeat
 * the parser. Stripped for PARSING only — what gets relayed to the reader is the raw capture,
 * so a developer keeps the colours the tool meant them to have.
 */
// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the whole point
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;

interface Ran {
  status: number;
  /** stdout and stderr interleaved as captured, colours intact. */
  output: string;
}

function run(args: string[]): Ran {
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // Never inherit stdin. Without this, `astro check` with its tooling missing puts an
    // interactive "Continue?" install prompt on the terminal and waits — measured 2026-08-02.
    // Closing stdin turns that hang into the exit-0-with-no-Result-line that ./typecheck.ts
    // is built to reject.
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;

  return {
    // `status` is null when the child was killed by a signal; that is a failure, not a zero.
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
}

/**
 * A child's status, made safe to hand to `process.exitCode`.
 *
 * A process exit code is one byte. `process.exitCode = 256` makes the shell see **0** (measured),
 * so relaying a child's raw status can turn a failed leg into a green gate — the one outcome this
 * whole file exists to prevent. On Linux it cannot happen (a child status is already 0-255), and
 * on Windows no observed status has a zero low byte: `astro sync`'s teardown abort is
 * `0xC0000409`, low byte `0x09`. So this closes a latent edge rather than a live defect, which is
 * exactly when closing it is cheap.
 *
 * The RAW status is still what gets printed — `readSyncResult` quotes it in its message, and
 * `3221226505` is the searchable string there, not `9`. This narrowing applies only where the
 * number stops being information and becomes a signal.
 */
function exitFor(status: number): number {
  const low = Math.abs(status) % 256;
  return low === 0 ? 1 : low;
}

function main(): number {
  // ── Leg 1: sync ────────────────────────────────────────────────────────────────────────
  // A sync failure is a DIFFERENT diagnosis from a type error — a broken `astro.config.mjs`
  // reported as "3 type errors" sends the reader to the wrong file — so it reports as itself
  // and stops here.
  //
  // Its EXIT CODE is not the oracle: measured at ~1 run in 5 on Windows, `astro sync` writes
  // the types and then aborts at teardown with a libuv assertion. ./typecheck.ts owns that
  // distinction, with both shapes as measured fixtures.
  const sync = run([ASTRO_BIN, "sync"]);
  const syncVerdict = readSyncResult(sync.output.replace(ANSI, ""), sync.status);
  if (!syncVerdict.ok) {
    console.error(sync.output);
    console.error(`typecheck: ${syncVerdict.reason}`);
    return exitFor(sync.status);
  }

  // ── Leg 2: tsc ─────────────────────────────────────────────────────────────────────────
  const tsc = run([TSC_BIN, "--noEmit"]);
  if (tsc.status !== 0) {
    console.log(tsc.output);
    console.error("typecheck: `tsc --noEmit` failed — stopping before `astro check`.");

    // WHICH reason applies is decided next door, on the captured diagnostics, because it is
    // decidable without spawning anything and because printing the wrong one is a real cost:
    // this branch used to assert "a tsconfig error (TS5xxx)" for EVERY non-zero tsc, so a plain
    // `TS2322` sent the reader to `tsconfig.json`. See readTscFailure.
    for (const line of readTscFailure(tsc.output.replace(ANSI, "")).lines) {
      console.error(`  ${line}`);
    }
    return exitFor(tsc.status);
  }

  // ── Leg 3: astro check ─────────────────────────────────────────────────────────────────
  // `--minimumSeverity warning` so a green log is genuinely empty: the four permanent
  // `ts(6387)` diagnostics on `tseslint.config` are tallied as HINTS despite printing a yellow
  // `warning` label (disambiguated by measurement — `--minimumFailingSeverity warning` → 0,
  // `hint` → 1). Never `--minimumFailingSeverity hint`, which those four turn red today, and
  // never `--watch`, whose promise never resolves (astro/dist/cli/index.js:220-221).
  const check = run([ASTRO_BIN, "check", "--minimumSeverity", "warning"]);
  console.log(check.output);

  // The verdict is applied to the OUTPUT, never to the exit code, because `astro check` exits 0
  // when its own tooling is missing — see ./typecheck.ts, which owns this decision and its
  // measured fixtures.
  const verdict = readCheckResult(check.output.replace(ANSI, ""));

  if (!verdict.ok) {
    console.error("");
    console.error(`typecheck: ${verdict.reason}`);
    console.error("");
    console.error("  This is a failure even though `astro check` may have exited 0. A checker");
    console.error("  that looked at nothing is the false green this gate exists to prevent.");
    return 1;
  }

  if (check.status !== 0) {
    // "across N files" read as "N files have errors" — measured on a one-error probe that
    // printed "found errors across 133 files". The count is the COVERAGE figure (it is what
    // the floor above is asserted against), so it goes in the parenthetical where the green
    // line already puts it, not in the sentence's object position.
    console.error(`typecheck: astro check reported errors (${String(verdict.files)} files checked).`);
    return exitFor(check.status);
  }

  console.log(`typecheck: OK — ${String(verdict.files)} files checked (floor ${String(MIN_CHECKED_FILES)}).`);
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error("");
  console.error(`typecheck: ${String(err)}`);
  console.error("");

  // `spawnSync` sets `error` for failures of the SPAWN, not of the child — the child's own
  // failures come back as a status and are diagnosed in `main`. Two shapes reach here, and they
  // send the reader to different places, so they are not collapsed into one message.
  //
  // Note which shape does NOT reach here: an absent `node_modules`. The binary spawned is always
  // `process.execPath`, so that is a module-resolution failure INSIDE the child — `status: 1`,
  // `error` undefined — and `readSyncResult` owns it.
  if (err instanceof Error && "code" in err && err.code === "ENOBUFS") {
    console.error("  The checker produced more output than the 32 MB capture buffer, so it was");
    console.error("  killed and its output is truncated. This is NOT a verdict about your code:");
    console.error("  run `npx astro check` directly to see the diagnostics.");
  } else {
    console.error("  The checker could not be started at all. If this is a fresh clone, run");
    console.error("  `npm ci` first.");
  }

  process.exitCode = 1;
}
