/* eslint-disable no-console -- this file IS the report: it names the field that drifted, both
   values, and what to do about it. It lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// Bezzależnościowa POŁOWA zapadki evali: sprawdza, czy blok `verdictConfig` w
// `agents/review/evals/eval-record.json` opisuje dzisiejsze wartości warstwy INTERPRETACJI.
//
// Dlaczego to osobny plik od checkera agenckiego, skoro pilnują jednego rekordu. Granica
// kierunkowa: `scripts/` czyta z `agents/` DANE, nigdy kodu (`review-schema.ts:6-12`,
// `run-review-verdict.ts:29-37`), a odcisk WYWOŁANIA wymaga KODU agenta — importuje
// `../prompt.ts`, `../review-schema.ts` i `../run-review.ts`. Jeden checker nie może dotknąć obu
// stron bez złamania tej granicy, więc są dwa, w jednym jobie.
//
// Ta połowa ma ZERO zależności runtime (`node:fs` + siostrzany `./verdict-config.ts`), i dlatego
// `.github/workflows/eval-ratchet.yml` uruchamia ją PRZED `npm ci` — rozjazd progu czerwieni
// w sekundach, nie po instalacji. To jedyne miejsce w tym workflow, gdzie kolejność kroków ma
// znaczenie funkcjonalne, a nie kosmetyczne.
//
// Ten checker NIGDY nie liczy `callFingerprint` i nie woła modelu. Remedium jego czerwieni jest
// DARMOWE (przepisanie wartości), w odróżnieniu od remedium drugiej połowy.

import { readFileSync } from "node:fs";
import {
  RECORD_PATH,
  RECORD_RELATIVE_PATH,
  compareVerdictConfig,
  liveVerdictConfig,
  recordedVerdictConfig,
  remedyFor,
  VERDICT_CONFIG_FIELDS,
  type RecordedConfig,
} from "./verdict-config.ts";

/**
 * Odczyt pliku. Tylko I/O — który stan zaszedł i co z nim zrobić, rozstrzyga
 * `recordedVerdictConfig` w rdzeniu, żeby dało się to przetestować bez uruchamiania skryptu.
 *
 * Nieudany `JSON.parse` i nieudany `readFileSync` schodzą się w `undefined` celowo: dla tej połowy
 * zapadki „pliku nie ma" i „pliku nie da się przeczytać" mają JEDNO remedium, a rozdzielanie ich
 * dałoby dwa komunikaty prowadzące do tej samej komendy.
 */
function readRecordedConfig(): RecordedConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  } catch {
    parsed = undefined;
  }
  return recordedVerdictConfig(parsed);
}

function main(): number {
  const recorded = readRecordedConfig();
  if (!recorded.ok) {
    // Tytuł idzie ZA rozstrzygniętym stanem, nie jest jeden na oba: „brak bloku" nad brakującym
    // PLIKIEM wysyłałby po darmową komendę tam, gdzie remedium jest płatne.
    const title = recorded.reason === "missingRecord" ? "Brak dowodu evali" : "Brak bloku verdictConfig w dowodzie";
    console.error(`::error file=${RECORD_RELATIVE_PATH},title=${title}::${recorded.message}`);
    return 1;
  }

  const live = liveVerdictConfig();
  const drifts = compareVerdictConfig(recorded.value, live);

  if (drifts.length === 0) {
    // Wypis na ścieżce SUKCESU nie jest ozdobą: bez niego zielony przebieg nie zostawia w logu
    // żadnego śladu, czym właściwie był — a wtedy „bramka przeszła" i „bramki nie było" wyglądają
    // w logu tak samo.
    for (const field of VERDICT_CONFIG_FIELDS) {
      const value = live[field];
      console.error(`[verdict-config] ${field} = ${typeof value === "string" ? `${value.slice(0, 12)}…` : value} OK`);
    }
    console.error(`[verdict-config] ${VERDICT_CONFIG_FIELDS.length} pola zgadzają się z ${RECORD_RELATIVE_PATH}.`);
    return 0;
  }

  // JEDNA adnotacja na ROZJECHANE POLE, nie zbiorcza — remedium ma nazwać starą i nową wartość
  // konkretnego pola, a nie kazać przepisać cały blok. `remedyFor` rozdziela przy tym gałąź trzech
  // liczb od gałęzi `assertionsDigest`, bo tej drugiej NIE da się przeliczyć z rekordu.
  console.error(
    `::error file=${RECORD_RELATIVE_PATH},title=Konfiguracja werdyktu rozjechała się z dowodem::${remedyFor(drifts)}`,
  );
  return 1;
}

try {
  process.exitCode = main();
} catch (err) {
  // Awaria SAMEJ bramki. To nie jest „wartości się zgadzają" i nie wolno tego tak przeczytać.
  console.error(`[verdict-config] AWARIA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
