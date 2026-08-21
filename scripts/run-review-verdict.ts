/* eslint-disable no-console -- this file IS the interface: one line on stdout is the
   workflow's `$GITHUB_OUTPUT` input and everything else is its log. It deliberately lives in
   `scripts/`, never `src/`, because tests/lib/no-logging.test.ts fails the build on any
   `console.*` under `src/`. */

// The I/O half of the review verdict. Everything decidable lives next door in
// ./review-verdict.ts and ./review-comment.ts as pure functions with fixtures; this file
// reads the agent's result, reads the committed criteria list, writes the comment body to a
// file and prints the verdict.
//
// **The comment goes to a FILE, never to an output or an argument.** It is multi-line
// Markdown containing arbitrary model-authored text; `$GITHUB_OUTPUT` would need delimiter
// juggling and an argument would need quoting, and both fail on exactly the text that makes
// the comment worth reading.
//
// **Exit code 0 even on `fail`.** Whether the RUN goes red is the workflow's decision, and it
// has exactly one rule: red means "review did not happen", never "review went badly". Making
// that call here would spread it across two files.
//
// Zero runtime dependencies — `node:fs` only — matching ./check-schema-drift.ts and
// ./run-db-cleanup.ts, which is what lets it run under bare `node --experimental-strip-types`.

import { readFileSync, writeFileSync } from "node:fs";
import { SCORE_THRESHOLD, decideVerdict, parseReview } from "./review-verdict.ts";
import type { Criterion } from "./review-verdict.ts";
import { renderComment, renderFailureHeader, renderNoCodeComment } from "./review-comment.ts";

/**
 * The criteria list is read as DATA from the agent's package, resolved from this file's own
 * location rather than from `process.cwd()` so the result does not depend on where the
 * workflow invoked it from.
 *
 * `scripts/` reading `agents/review/criteria.json` does NOT cross the boundary that keeps
 * `agents/**` out of this project's tsconfig, ESLint and vitest: what crosses is a generated
 * JSON file, never a module. Importing the agent's code would take away the portability that
 * is the whole reason for building our own agent instead of taking an off-the-shelf action.
 */
const CRITERIA_PATH = new URL("../agents/review/criteria.json", import.meta.url);

const USAGE = [
  "Użycie:",
  "  node --experimental-strip-types scripts/run-review-verdict.ts \\",
  "    --result <plik.json> --out <plik.md> --sha <sha> --model <id> [--run-url <url>]",
  "  … --no-code --out <plik.md> --sha <sha> [--run-url <url>]",
  "  … --failure <powód> --out <plik.md> [--previous <plik.md>] [--run-url <url>]",
].join("\n");

interface Args {
  result: string | null;
  out: string | null;
  previous: string | null;
  failure: string | null;
  sha: string | null;
  model: string | null;
  runUrl: string | null;
  noCode: boolean;
}

/**
 * Flags only, and an unknown one is a refusal rather than a shrug: a typo'd flag would
 * otherwise render a comment missing exactly the field the typo carried, silently.
 */
function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    result: null,
    out: null,
    previous: null,
    failure: null,
    sha: null,
    model: null,
    runUrl: null,
    noCode: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--no-code") {
      args.noCode = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Flaga \`${String(flag)}\` wymaga wartości.`);
    }
    index += 1;

    switch (flag) {
      case "--result":
        args.result = value;
        break;
      case "--out":
        args.out = value;
        break;
      case "--previous":
        args.previous = value;
        break;
      case "--failure":
        args.failure = value;
        break;
      case "--sha":
        args.sha = value;
        break;
      case "--model":
        args.model = value;
        break;
      case "--run-url":
        args.runUrl = value;
        break;
      default:
        throw new Error(`Nieznana flaga \`${String(flag)}\`.`);
    }
  }

  return args;
}

/**
 * Read the committed criteria list, holding it to the shape the pure half expects.
 *
 * A malformed list is a gate outage, not a review result — so it throws instead of degrading
 * to "no criteria, therefore nothing below threshold, therefore pass".
 */
function readCriteria(): Criterion[] {
  const raw: unknown = JSON.parse(readFileSync(CRITERIA_PATH, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`\`${CRITERIA_PATH.pathname}\` nie jest niepustą tablicą kryteriów.`);
  }

  return raw.map((entry: unknown, index): Criterion => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Criterion).key !== "string" ||
      typeof (entry as Criterion).noteKey !== "string" ||
      typeof (entry as Criterion).label !== "string" ||
      typeof (entry as Criterion).conditional !== "boolean"
    ) {
      throw new Error(`Wpis ${index + 1} w \`criteria.json\` nie ma kształtu { key, noteKey, label, conditional }.`);
    }
    return entry as Criterion;
  });
}

/** Absent file → no previous body, which is a legitimate state on the first failing run. */
function readPrevious(path: string | null): string | null {
  if (path === null) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`[verdict] brak pliku z poprzednią treścią (${path}) — renderuję sam nagłówek awarii.`);
    return null;
  }
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);

  if (args.out === null) {
    console.error(USAGE);
    throw new Error("Wymagana flaga `--out` (plik, do którego trafi treść komentarza).");
  }

  // FAILURE first: it is the state in which nothing else can be trusted to exist — no result
  // file, possibly no model id — so it must not be gated behind any of their checks.
  if (args.failure !== null) {
    writeFileSync(
      args.out,
      renderFailureHeader(readPrevious(args.previous), { reason: args.failure, runUrl: args.runUrl }),
      "utf8",
    );
    // Neither `pass` nor `fail`: the workflow keys label handling off this value, and review
    // that did not happen must stay distinguishable from review that went badly.
    console.log("verdict=failed-to-run");
    return 0;
  }

  if (args.noCode) {
    if (args.sha === null) {
      throw new Error("Tryb `--no-code` wymaga `--sha`.");
    }
    writeFileSync(args.out, renderNoCodeComment({ sha: args.sha, runUrl: args.runUrl }), "utf8");
    // The fourth value the plan's three-way enum does not name. It is deliberate rather than
    // a stretch of `failed-to-run`: that one means the run goes red and this state is green
    // by design, and it must not collapse into `pass` either, because no result label is
    // applied here at all.
    console.log("verdict=no-code");
    return 0;
  }

  if (args.result === null || args.sha === null || args.model === null) {
    console.error(USAGE);
    throw new Error("Tryb normalny wymaga `--result`, `--sha` i `--model`.");
  }

  const criteria = readCriteria();
  const raw: unknown = JSON.parse(readFileSync(args.result, "utf8"));

  // Two passes over twenty fields, deliberately: the pure half's contract is the plan's
  // (`decideVerdict` takes the raw result), and keeping the parse inside it is what stops a
  // caller from handing the decision an object nobody checked.
  const { summary, scores } = parseReview(raw, criteria);
  const { verdict, failing, skipped } = decideVerdict({ review: raw, criteria, threshold: SCORE_THRESHOLD });

  writeFileSync(
    args.out,
    renderComment({
      verdict,
      failing,
      skipped,
      scores,
      summary,
      sha: args.sha,
      model: args.model,
      runUrl: args.runUrl,
      threshold: SCORE_THRESHOLD,
    }),
    "utf8",
  );

  console.error(
    `[verdict] ${verdict} — poniżej progu ${SCORE_THRESHOLD}: ${failing.length}, ` +
      `„nie dotyczy”: ${skipped.length}, komentarz: ${args.out}`,
  );
  // The ONLY line on stdout, so the workflow can redirect it straight into `$GITHUB_OUTPUT`.
  console.log(`verdict=${verdict}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`[verdict] AWARIA: ${err instanceof Error ? err.message : String(err)}`);
  // A usage or contract failure exits 1 — it is the one case where this script itself is what
  // broke, and it must not be readable as a verdict.
  process.exitCode = 1;
}
