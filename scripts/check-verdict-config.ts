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
  REFRESH_COMMAND,
  compareVerdictConfig,
  liveVerdictConfig,
  remedyFor,
  VERDICT_CONFIG_FIELDS,
} from "./verdict-config.ts";

const MISSING_RECORD = [
  `Brak dowodu evali: ${RECORD_RELATIVE_PATH} nie istnieje albo jest nieczytelny.`,
  "",
  "Ta połowa zapadki pilnuje wyłącznie bloku `verdictConfig`, więc bez pliku nie ma czego",
  "porównać. Plik wytwarza PRZEJŚCIE MACIERZY (to kosztuje), a ten blok dopisuje się osobno",
  `i za darmo: ${REFRESH_COMMAND}`,
].join("\n");

const MISSING_BLOCK = [
  `Dowód ${RECORD_RELATIVE_PATH} istnieje, ale NIE MA w nim bloku \`verdictConfig\`.`,
  "",
  "To jest stan po pierwszym `--record`: zapisywacz agencki tworzy plik i CELOWO nie dotyka",
  "cudzego bloku. Druga połowa dowodu dopisuje się osobno i NIE KOSZTUJE:",
  `  ${REFRESH_COMMAND}`,
  "",
  "Sam krok zapisujący niczego nie sprawdza — zapisze zgodę na próg, którego nikt nie przeczytał.",
].join("\n");

/** Blok `verdictConfig` z rekordu, albo NAZWANY powód, dla którego go nie ma. */
function readRecordedConfig(): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  } catch {
    return { ok: false, message: MISSING_RECORD };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: MISSING_RECORD };
  }

  const block = (parsed as Record<string, unknown>).verdictConfig;
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return { ok: false, message: MISSING_BLOCK };
  }
  return { ok: true, value: block as Record<string, unknown> };
}

function main(): number {
  const recorded = readRecordedConfig();
  if (!recorded.ok) {
    console.error(
      `::error file=${RECORD_RELATIVE_PATH},title=Brak bloku verdictConfig w dowodzie::${recorded.message}`,
    );
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
