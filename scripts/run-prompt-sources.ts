/* eslint-disable no-console -- this file IS the report: it says which sections it hashed and
   where it wrote them. It deliberately lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of the prompt-distillate ratchet. Everything decidable lives next door in
// ./prompt-sources.ts as pure functions with fixtures; this file reads argv, writes the
// record and owns the exit code.
//
// Regenerating only. The GATE is ./check-prompt-sources.ts, run by
// .github/workflows/prompt-ratchet.yml, plus tests/lib/review-prompt-sources.test.ts inside
// `npm test`.
//
// This comment used to say the test alone was the gate, "which runs in `npm test` on every
// change" — and that was FALSE in the only way that mattered. `npm test` runs in one place,
// the `ci` job of ci.yml, whose triggers carry `paths-ignore: ["**/*.md", "context/**"]`;
// every section this ratchet guards lives in AGENTS.md or test-plan.md, so a docs-only change
// skipped the workflow and the gate never ran. Hence the separate runner and workflow.
//
// The old warning against "a second check mode here" still stands, and this is why the check
// went NEXT DOOR rather than behind a `--check` flag on this file: the DECISION (which
// sections, how they are cut, how they are hashed, what the remedy says) has one home in
// ./prompt-sources.ts, and all three callers share it. Same shape as ./schema-drift.ts, read
// by both ./check-schema-drift.ts and tests/lib/schema-drift.test.ts.
//
// Zero runtime dependencies — `node:fs` and `node:crypto` only — matching
// ./check-schema-drift.ts and ./run-review-verdict.ts, which is what lets it run under bare
// `node --experimental-strip-types` with no Vite and no install step.

import { writeFileSync } from "node:fs";
import { PROMPT_SOURCES, RECORD_PATH, hashSections, serializeRecord } from "./prompt-sources.ts";

const USAGE = [
  "Użycie:",
  "  node --experimental-strip-types scripts/run-prompt-sources.ts --write",
  "",
  "Przelicza hashe sekcji, z których zdestylowany jest prompt agenta review, i zapisuje je",
  "do agents/review/prompt-sources.json. Uruchom to PO zaktualizowaniu destylatu",
  "w agents/review/prompt.ts, nigdy zamiast tego.",
].join("\n");

// `--write` is required rather than defaulted, and an unknown flag is a refusal rather than a
// shrug: a run that rewrites a committed gate file is not the thing to do on a typo.
const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0] !== "--write") {
  console.error(USAGE);
  process.exitCode = 1;
} else {
  const records = hashSections(PROMPT_SOURCES);
  writeFileSync(RECORD_PATH, serializeRecord(records), "utf8");

  for (const { path, heading, sha256 } of records) {
    console.error(`[prompt-sources] ${path} §${heading} → ${sha256.slice(0, 12)}…`);
  }
  console.error(`[prompt-sources] zapisano ${records.length} sekcji do ${RECORD_PATH.pathname}`);
  console.error(
    "[prompt-sources] przypomnienie: rekord ma sens tylko wtedy, gdy destylat w prompt.ts jest już zaktualizowany.",
  );
}
