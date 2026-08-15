/* eslint-disable no-console -- this file IS the report: it is the operation's only output
   surface, and the before/after census it prints is the evidence a reader has that the delete did
   what it claimed and nothing more. It deliberately lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of `npm run db:clean`. Everything decidable is next door in ./db-cleanup.ts as
// pure functions with fixtures; this file reads `supabase/config.toml`, runs the census through
// `docker exec … psql`, prints the report, and on `--yes` deletes, re-censuses, verifies, and
// owns the exit code.
//
// **REPORT FIRST.** A bare invocation counts and prints and deletes NOTHING. The delete is the
// one irreversible operation in this tooling, and the rows it removes cannot be reconstructed
// from anything in the repository, so the confirmation is a separate deliberate act:
//
//     npm run db:clean            → census only
//     npm run db:clean -- --yes   → census, delete, re-census, verify
//
// The `--` is load-bearing and not a stylistic nicety. npm parses `-`-prefixed arguments itself
// unless they follow a `--` separator, and `yes` is a real npm config key — measured on npm
// 11.16.0, `npm run db:clean --yes` hands this script an EMPTY argv and therefore reports only.
// That failure is in the safe direction, which is why it is documented rather than defended
// against: there is no spelling of the npm invocation that deletes by accident.
//
// **LOCAL-ONLY BY CONSTRUCTION.** This script reaches Postgres solely through `docker exec` on a
// container whose name is derived from THIS checkout's `supabase/config.toml`
// (`supabase_db_<project_id>`). It holds no URL, no key and no connection string, so it cannot
// address a cloud project at all. That is a stronger safety property than a runtime host
// assertion — there is nothing to assert about, and nothing a `.env` swap can redirect. Same
// pattern, same reasoning, as ./disable-kong-keepalive.ts.
//
// **FAIL CLOSED.** Every failure path exits non-zero, including the two that a naive script would
// report as success:
//
//   - a census that does not parse (./db-cleanup.ts refuses to read a short result as `0 harness
//     rows`, which would say "nothing to clean");
//   - a delete after which the harness count is not zero, or after which any NON-harness count
//     moved. The second is the safety invariant: seven manual-run artifact decks that archived
//     documents cite as the record of a recorded verification run live in this database, and
//     their survival must be a property of the tooling rather than of the operator's attention.
//
// No `MSYS_NO_PATHCONV` handling is needed and no heredoc is used: `execFileSync` never invokes a
// shell, and every statement goes in as a `-c` ARGUMENT. That closes by construction the silent
// no-op test-plan.md §6.6 records — a heredoc piped to `docker exec` without `-i` reaches psql as
// nothing at all and reports success.
//
// Zero runtime dependencies — `node:fs` and `node:child_process` only, matching
// ./check-schema-drift.ts and ./disable-kong-keepalive.ts. That is what lets this be invoked with
// bare `node --experimental-strip-types`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  CENSUS_TABLES,
  HARNESS_EMAIL_PATTERN,
  censusStatement,
  dbContainerName,
  deleteStatement,
  harnessRemnants,
  nonHarnessDrift,
  parseArgs,
  parseCensus,
  readProjectId,
  totalHarnessRows,
} from "./db-cleanup.ts";
import type { Census } from "./db-cleanup.ts";

/**
 * Resolved from this file's own location, not from `process.cwd()`, so the script operates on the
 * checkout it ships with no matter where it is invoked from.
 */
const CONFIG_TOML = new URL("../supabase/config.toml", import.meta.url);

/**
 * `psql` inside the local Postgres container, in the exact output mode ./db-cleanup.ts parses.
 *
 * `-t` drops the header and the row count, `-A` drops alignment padding, `-F'|'` sets the
 * separator, and `-v ON_ERROR_STOP=1` makes psql exit non-zero on a SQL error instead of printing
 * to stderr and exiting 0 — the `lessons.md` "a command that always exits 0 is not a gate" class,
 * one vendor over. `execFileSync` throws on a non-zero exit, so that flag is what turns a failed
 * statement into a refusal rather than into an empty result the parser would then have to catch.
 */
function psql(container: string, sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-F|",
      "-c",
      sql,
    ],
    // `timeout` added by impl-review F4 (2026-08-15). The sibling scripts carry none, and for them
    // that is fine — a wedged Docker daemon there is merely a hang. Here one of the three calls
    // runs AFTER the irreversible delete, so a hang at that point leaves the operator staring at
    // `db:clean: deleting harness accounts…` with no way to tell whether it landed. A named
    // failure the `catch` block below can explain is strictly better than an ambiguous one.
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
  ).trim();
}

function census(container: string): Census {
  return parseCensus(psql(container, censusStatement()));
}

/** Right-aligned so the two columns are comparable at a glance in a terminal. */
function report(title: string, counts: Census): void {
  const width = Math.max(...CENSUS_TABLES.map((table) => table.length));
  console.log("");
  console.log(title);
  console.log(`  ${"table".padEnd(width)}  ${"harness".padStart(9)}  ${"other".padStart(9)}`);
  for (const table of CENSUS_TABLES) {
    const { harness, other } = counts[table];
    console.log(`  ${table.padEnd(width)}  ${String(harness).padStart(9)}  ${String(other).padStart(9)}`);
  }
}

function main(): number {
  const { confirmed } = parseArgs(process.argv.slice(2));
  const projectId = readProjectId(readFileSync(CONFIG_TOML, "utf8"));
  const container = dbContainerName(projectId);

  console.log(`db:clean: ${container} — harness accounts match \`${HARNESS_EMAIL_PATTERN}\``);

  const before = census(container);
  report("before:", before);

  const removable = totalHarnessRows(before);

  if (!confirmed) {
    console.log("");
    if (removable === 0) {
      console.log("db:clean: nothing to clean — no harness rows. (Report only; nothing was deleted.)");
    } else {
      console.log(`db:clean: ${removable} harness row(s) would be deleted. Nothing was deleted.`);
      console.log("db:clean: to delete, re-run with:  npm run db:clean -- --yes");
      console.log("db:clean: the `--` is required — npm eats a bare `--yes` and this script reports only.");
    }
    return 0;
  }

  if (removable === 0) {
    console.log("");
    console.log("db:clean: nothing to delete — no harness rows.");
    return 0;
  }

  console.log("");
  console.log(`db:clean: deleting harness accounts — the cascade removes their decks, flashcards,`);
  console.log("db:clean: schedules and generation sessions. This cannot be undone.");
  // psql prints `DELETE <n>` on stdout; under `-t -A` that is the whole output. It is reported
  // because it is free, and it is NOT the oracle: the re-census below is.
  console.log(`db:clean: ${psql(container, deleteStatement())}`);

  const after = census(container);
  report("after:", after);
  console.log("");

  // ORACLE 1 — the delete landed. A `delete` that matched nothing exits 0 and prints `DELETE 0`,
  // so the statement's own success says nothing about whether the pattern reached anything.
  //
  // The message ENUMERATES rather than asserts, for the reason the `catch` block below states and
  // this branch originally ignored (impl-review F3): the census, the delete and the re-census are
  // three separate `docker exec` invocations with no snapshot between them, so the likeliest cause
  // of a remnant is not a failed delete at all — it is a `vitest` run in another terminal minting
  // fresh harness accounts between them. Asserting "the delete did not do what it reported" there
  // is a wrapper being right about the exit code and wrong about the diagnosis, which is exactly
  // the class this project has already paid for once (C10X-43's `readTscFailure`).
  const remnants = harnessRemnants(after);
  if (remnants.length > 0) {
    console.error(`db:clean: harness rows SURVIVE in ${remnants.join(", ")}. Nothing further was deleted.`);
    console.error("  Likely causes, in the order worth checking:");
    console.error("    - a `vitest` run in flight — each invocation mints ~2 harness accounts and");
    console.error("      ~68 decks, and one landing after the delete looks exactly like this");
    console.error("    - the delete genuinely did not do what it reported — re-run to distinguish:");
    console.error("      a concurrent run leaves a SMALL remnant that a second pass clears");
    return 1;
  }

  // ORACLE 2 — and nothing else moved. This is the invariant that keeps the manual-run artifacts
  // safe as a property of the tooling. It reddens here rather than after the evidence is gone.
  const drift = nonHarnessDrift(before, after);
  if (drift.length > 0) {
    console.error(`db:clean: NON-harness counts changed in ${drift.join(", ")} — rows outside the pattern were`);
    console.error("db:clean: destroyed. This is a defect in the pattern or in the statement, not a warning.");
    for (const table of drift) {
      console.error(`db:clean:   ${table}: ${before[table].other} → ${after[table].other}`);
    }
    return 1;
  }

  console.log(`db:clean: OK — ${removable} harness row(s) removed, every non-harness count unchanged.`);
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error("");
  console.error(`db:clean: ${String(err)}`);
  console.error("");
  // ENUMERATED rather than asserted, and that wording was earned by a breakage run rather than
  // chosen. This block first read "The local stack must be running before this step" as a flat
  // statement — and the run that fed the script a deliberately short census got exactly that
  // advice for a failure that had nothing to do with the stack, which was up and answering. A
  // wrapper can be right about the exit code and wrong about the diagnosis, and this project has
  // paid for that once already (C10X-43's `readTscFailure`, which announced a `tsconfig` problem
  // for an ordinary `TS2322`). The message above is the specific one; these are the candidates.
  console.error("  Likely causes, in the order worth checking:");
  console.error("    - the local stack is not running — `npm run db:start`");
  console.error("    - a `census:` message above means the query ran but its result did not parse;");
  console.error("      that is deliberate — a result this script cannot read is never counted as zero");
  console.error("    - an unrecognised flag; the only accepted one is `--yes`, after a `--` separator");
  console.error("");
  console.error("  Nothing was deleted unless a message above says otherwise.");
  process.exitCode = 1;
}
