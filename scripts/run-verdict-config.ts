/* eslint-disable no-console -- this file IS the report: it says which values it read and where it
   wrote them. It deliberately lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of the verdict-config axis of the eval ratchet. Everything decidable lives next
// door in ./verdict-config.ts as pure functions with fixtures; this file reads argv, writes the
// record and owns the exit code. Same split as ./prompt-sources.ts ↔ ./run-prompt-sources.ts.
//
// Regenerating only. The GATE is ./check-verdict-config.ts, run by
// .github/workflows/eval-ratchet.yml, plus tests/lib/verdict-config.test.ts inside `npm test`.
//
// TWO WRITERS, ONE FILE, and this one owns exactly one key. `agents/review/evals/eval-record.json`
// carries two fingerprints with DISJOINT remedies: `callFingerprint` (paid — a matrix pass) and
// `verdictConfig` (free — rewriting values). This runner touches only the second and preserves
// everything else byte for byte. If it ever touched `matrix` or `callFingerprint`, the PAID axis
// would become greenable with a FREE command, which is the whole failure this split prevents.
//
// Zero runtime dependencies — `node:fs`, `node:crypto` and `node:url` only — matching
// ./check-schema-drift.ts and ./run-prompt-sources.ts, which is what lets it run under bare
// `node --experimental-strip-types` with no Vite and no install step.

import { readFileSync, writeFileSync } from "node:fs";
import {
  RECORD_COMMAND,
  RECORD_PATH,
  RECORD_RELATIVE_PATH,
  VERDICT_CONFIG_FIELDS,
  liveVerdictConfig,
  serializeRecord,
  withVerdictConfig,
} from "./verdict-config.ts";

const USAGE = [
  "Użycie:",
  "  node --experimental-strip-types scripts/run-verdict-config.ts            # wypisz dzisiejsze wartości",
  "  node --experimental-strip-types scripts/run-verdict-config.ts --write    # zapisz je do dowodu",
  "",
  `Odświeża blok \`verdictConfig\` w ${RECORD_RELATIVE_PATH}, zachowując wszystko inne.`,
  "NIE uruchamia macierzy evali i nie kosztuje ani centa — mierzy wyłącznie warstwę ODCZYTU",
  "odpowiedzi modelu (próg, skala, digest asercji).",
].join("\n");

/**
 * Brak pliku jest ODMOWĄ, nie okazją do jego utworzenia.
 *
 * Plik złożony wyłącznie z `verdictConfig` byłby dowodem bez ani jednego pomiaru — a zapadka
 * odczytałaby go jako „kształt zły" dopiero na CI. Kolejność jest odwrotna i taka ma zostać:
 * najpierw PŁATNE przejście macierzy wytwarza plik, potem ta komenda dopisuje do niego swój blok.
 */
const MISSING_HINT = [
  `[verdict-config] ${RECORD_RELATIVE_PATH} nie istnieje albo jest nieczytelny.`,
  "",
  "Ta komenda DOPISUJE swój blok do istniejącego dowodu, a nie tworzy dowodu — plik złożony",
  "z samej konfiguracji werdyktu nie opisywałby żadnego pomiaru.",
  "",
  `Najpierw przejedź macierz (TO JEST WYDATEK): ${RECORD_COMMAND}`,
].join("\n");

function main(argv: readonly string[]): number {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--write")) {
    console.error(USAGE);
    return 1;
  }

  const live = liveVerdictConfig();

  if (argv.length === 0) {
    for (const field of VERDICT_CONFIG_FIELDS) {
      const value = live[field];
      console.error(`[verdict-config] ${field} = ${typeof value === "string" ? `${value.slice(0, 12)}…` : value}`);
    }
    console.error(`[verdict-config] nic nie zapisano — dodaj --write, żeby odświeżyć ${RECORD_RELATIVE_PATH}.`);
    return 0;
  }

  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  } catch {
    console.error(MISSING_HINT);
    return 1;
  }

  writeFileSync(RECORD_PATH, serializeRecord(withVerdictConfig(existing, live)), "utf8");

  console.error(
    `[verdict-config] zapisano blok verdictConfig do ${RECORD_RELATIVE_PATH} ` +
      `(próg ${live.threshold}, skala ${live.scoreMin}–${live.scoreMax}, ` +
      `digest asercji ${live.assertionsDigest.slice(0, 12)}…).`,
  );
  console.error(
    "[verdict-config] przypomnienie: ten zapis niczego nie sprawdza — zapisze zgodę na próg, którego nikt nie przeczytał.",
  );

  return 0;
}

// `main()` + `try/catch`, matching ./check-schema-drift.ts, ./run-prompt-sources.ts and
// ./run-review-verdict.ts. The gate itself breaking is not "the values match" and must never be
// readable as it.
try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`[verdict-config] AWARIA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
