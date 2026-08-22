/* eslint-disable no-console -- this file IS the report: it names the section that drifted and
   what to do about it. It deliberately lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The CI half of the prompt-distillate ratchet: recompute the digests of the sections
// `agents/review/prompt.ts` was distilled from and compare them with the committed record.
//
// **Why this exists at all, given that tests/lib/review-prompt-sources.test.ts already asserts
// the same thing.** That test runs only inside `npm test`, and `npm test` runs in exactly one
// place — the `ci` job of `.github/workflows/ci.yml`, whose trigger carries
// `paths-ignore: ["**/*.md", "context/**"]`. Every section this ratchet guards lives in
// `AGENTS.md` or `context/foundation/test-plan.md`, so a pull request that changes ONLY a
// guarded rule matches the ignore list, skips the whole workflow, and the gate never runs. It
// would have fired only by accident, on changes that happened to touch code as well — which is
// the unfalsifiable-gate class (`lessons.md:194-199`) this very agent's criterion 8 exists to
// catch. Measured, not assumed: the manual proof in verification.md §"Faza 7" was real and was
// run LOCALLY, which is precisely why it could not see that the CI path did not exist.
//
// The fact still has ONE home. Everything decidable — which sections are guarded, how a section
// is cut out, how it is hashed, what the remedy says — lives in ./prompt-sources.ts and is
// shared by this runner, ./run-prompt-sources.ts and the vitest file. What differs is only the
// reporting surface, exactly as ./schema-drift.ts is shared by ./check-schema-drift.ts and
// tests/lib/schema-drift.test.ts. Two homes for the same DECISION would be the defect; two
// callers of one decision is the repo's established shape.
//
// Zero runtime dependencies — `node:fs` and `node:crypto` only — which is what lets
// .github/workflows/prompt-ratchet.yml run it with no `npm ci` and finish in seconds.

import { readFileSync } from "node:fs";
import { PROMPT_SOURCES, RECORD_PATH, hashSections, remedyFor } from "./prompt-sources.ts";
import type { PromptSourceRecord } from "./prompt-sources.ts";

const RECORD_HINT =
  "Rekord agents/review/prompt-sources.json jest nieczytelny albo nie istnieje. " +
  "Jeśli to pierwszy przebieg po dodaniu źródła, uruchom najpierw: " +
  "node --experimental-strip-types scripts/run-prompt-sources.ts --write";

function readRecord(): PromptSourceRecord[] {
  const raw: unknown = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(RECORD_HINT);
  }
  return raw as PromptSourceRecord[];
}

function main(): number {
  const record = readRecord();

  // Both directions, same as the test: a source added to PROMPT_SOURCES without regenerating
  // leaves the record short, and a hand-edited record leaves it describing something nobody
  // hashes. Checking the shape first means a length mismatch reports as a length mismatch
  // rather than as three confusing digest failures.
  if (record.length !== PROMPT_SOURCES.length) {
    console.error(
      `::error title=Prompt-sources record out of shape::Rekord ma ${record.length} wpisów, ` +
        `a PROMPT_SOURCES wymienia ${PROMPT_SOURCES.length}. Uruchom: ` +
        "node --experimental-strip-types scripts/run-prompt-sources.ts --write",
    );
    return 1;
  }

  const live = hashSections(PROMPT_SOURCES);
  const drifted: number[] = [];

  for (const [index, source] of PROMPT_SOURCES.entries()) {
    const recorded = record[index];

    if (recorded?.path !== source.path || recorded.heading !== source.heading) {
      console.error(
        `::error title=Prompt-sources record out of order::Wpis ${index + 1} opisuje ` +
          `${recorded?.path ?? "?"} §${recorded?.heading ?? "?"}, a oczekiwano ` +
          `${source.path} §${source.heading}.`,
      );
      return 1;
    }

    if (live[index]?.sha256 !== recorded.sha256) {
      drifted.push(index);
    }
  }

  if (drifted.length === 0) {
    for (const { path, heading, sha256 } of live) {
      console.error(`[prompt-sources] ${path} §${heading} → ${sha256.slice(0, 12)}… OK`);
    }
    console.error(`[prompt-sources] ${live.length} sekcji zgadza się z destylatem w agents/review/prompt.ts.`);
    return 0;
  }

  // One annotation per drifted section rather than one summary line: a red has to name the
  // file and heading to go READ, not print two hex strings and leave the reader to diff them.
  for (const index of drifted) {
    const source = PROMPT_SOURCES[index];
    if (!source) continue;
    console.error(`::error file=${source.path},title=Prompt distillate is stale::${remedyFor(source)}`);
  }

  return 1;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`[prompt-sources] AWARIA: ${err instanceof Error ? err.message : String(err)}`);
  // The gate itself broke. That is not "the sections match" and must never be readable as it.
  process.exitCode = 1;
}
