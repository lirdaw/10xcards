/* eslint-disable no-console -- this file IS the report: one machine-readable line on stdout and
   the diagnosis on stderr. It lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of the stderr scrub. Everything decidable lives next door in ./scrub-secrets.ts
// as pure functions with fixtures; this file reads a path, rewrites the file in place and owns
// the exit code — the pure/runner split this repository uses four times over
// (schema-drift/check-schema-drift, typecheck/run-typecheck, db-cleanup/run-db-cleanup,
// review-verdict/run-review-verdict).
//
// **The secret arrives in the ENVIRONMENT, never in argv.** Command lines are readable by any
// process on the box through `/proc/<pid>/cmdline`, and the runner echoes the command it runs
// into the log. `env:` on the step is the shape the rest of this repository already uses.
//
// Contract: prints exactly one line on stdout, `scrubbed=true|false`, for redirection into
// `$GITHUB_OUTPUT`. `false` is a VERDICT, not a crash — it means the caller must not quote the
// file — so it still exits 0. A non-zero exit is reserved for this script itself breaking, and
// the action maps that to `scrubbed=false` as well.

import { readFileSync, writeFileSync } from "node:fs";
import { scrubSecrets } from "./scrub-secrets.ts";

const USAGE = [
  "Użycie:",
  "  SCRUB_SECRET=<klucz> node --experimental-strip-types scripts/run-scrub-secrets.ts --file <plik>",
  "",
  "Wycina klucz z pliku W MIEJSCU i wypisuje `scrubbed=true|false`. `false` znaczy",
  "„nie wolno cytować tej treści”, a nie „skrypt padł”.",
].join("\n");

function main(argv: readonly string[]): number {
  if (argv.length !== 2 || argv[0] !== "--file") {
    console.error(USAGE);
    return 1;
  }

  const file = argv[1];
  if (file === undefined) {
    console.error(USAGE);
    return 1;
  }

  const raw = readFileSync(file, "utf8");
  const { text, clean, reason } = scrubSecrets({ text: raw, secret: process.env.SCRUB_SECRET ?? "" });

  // Written back even when `clean` is false: the shape pass still removed what it recognised,
  // so the file on disk is never left WORSE than it arrived. What `false` withholds is
  // permission to quote it, not the scrubbing itself.
  writeFileSync(file, text, "utf8");

  if (!clean) {
    console.error(`[scrub] NIE poświadczam czystości: ${reason ?? "nieznany powód"}`);
    console.error("[scrub] treść tego pliku nie może trafić do komentarza na publicznym PR-ze.");
  } else {
    console.error("[scrub] klucz wycięty, brak pozostałości o kształcie klucza.");
  }

  console.log(`scrubbed=${String(clean)}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`[scrub] AWARIA: ${err instanceof Error ? err.message : String(err)}`);
  // No `scrubbed=` line on stdout at all. The action treats a missing or non-`true` value as
  // false, so a crash here fails CLOSED — the comment gets the generic reason.
  process.exitCode = 1;
}
