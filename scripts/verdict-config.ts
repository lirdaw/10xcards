// Oś INTERPRETACJI dowodu evali, jako czyste funkcje. Bez console, bez argv, bez zapisu — to
// wszystko należy do runnerów obok (./run-verdict-config.ts zapisuje, ./check-verdict-config.ts
// czerwieni), ten sam podział rdzeń/runner co ./prompt-sources.ts ↔ ./run-prompt-sources.ts
// i ./review-verdict.ts ↔ ./run-review-verdict.ts. Podział jest tu nośny, nie stylistyczny:
// tests/lib/verdict-config.test.ts importuje ten moduł, a vitest.config.ts przypina
// `sequence: { shuffle: true }`, więc kod CLI w zakresie modułu wykonałby się na argv vitesta
// w losowym momencie przebiegu.
//
// CO TO PILNUJE, I DLACZEGO OSOBNO OD ODCISKU WYWOŁANIA.
// `agents/review/evals/eval-record.json` niesie DWA odciski o ROZŁĄCZNYCH remediach:
//
//   * `callFingerprint` — hash czterech osi wywołania (prompt systemowy, schemat wyjścia, kształt
//     wiadomości, stałe SDK). Zmienia to, CO MODEL ODPOWIEDZIAŁ, więc jego remedium jest PŁATNE:
//     trzeba przejechać macierz evali. Liczy go `agents/review/evals/fingerprint.ts`.
//   * `verdictConfig` — TEN plik. Cztery pola zmieniające wyłącznie ODCZYT tej odpowiedzi, więc
//     remedium jest DARMOWE: przepisanie wartości. Model nie musi zostać zawołany ani razu.
//
// Zlanie ich w jeden odcisk kazałoby kupować przejście macierzy (~0,12 USD) po to, żeby udowodnić
// coś, o czym macierz nic nie mówi — a wtedy człowiek wykonuje ruch tańszy: zieleni bramkę bez
// pomiaru. Rozłączność remediów jest treścią tego podziału, nie jego ozdobą.
//
// TRZY PIERWSZE POLA WCHODZĄ JAKO WARTOŚCI, NIE JAKO HASH. Dzięki temu sam diff rekordu czyta się
// `5 → 8`, a komunikat czerwieni ma co nazwać. Hash mógłby powiedzieć tylko „rozjechało się" — i to
// jest dokładnie ten kształt, po którym odcisk przepisuje się odruchowo, bez czytania. Czwarte,
// `assertionsDigest`, jest hashem Z KONIECZNOŚCI: dla całego pliku nie istnieje forma wartościowa,
// więc nazwa pola mówi wprost, że to digest, zamiast udawać liczbę.
//
// GRANICA KIERUNKOWA ZOSTAJE NIENARUSZONA. `scripts/` czyta z `agents/` DANE, nigdy kodu
// (`review-schema.ts:6-12`, `run-review-verdict.ts:29-37`) — a digest liczy się z BAJTÓW pliku
// przez `node:fs`, nie przez import. Ten moduł ma zero zależności runtime, więc jego checker biega
// pod gołym `node --experimental-strip-types`, przed `npm ci`.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SCORE_MAX, SCORE_MIN, SCORE_THRESHOLD } from "./review-verdict.ts";

/** Pola bloku `verdictConfig`, w kolejności, w jakiej wchodzą do rekordu i do komunikatu. */
export const VERDICT_CONFIG_FIELDS = ["threshold", "scoreMin", "scoreMax", "assertionsDigest"] as const;

export type VerdictConfigField = (typeof VERDICT_CONFIG_FIELDS)[number];

/** Warstwa interpretacji odpowiedzi modelu, jaką dziś widzi werdykt. */
export interface VerdictConfig {
  /** `SCORE_THRESHOLD` — czułość całej bramki review. */
  readonly threshold: number;
  /** `SCORE_MIN` — dolny koniec skali ocen. */
  readonly scoreMin: number;
  /** `SCORE_MAX` — górny koniec skali ocen. */
  readonly scoreMax: number;
  /** sha256 bajtów `agents/review/evals/assertions.ts` — patrz `liveAssertionsDigest`. */
  readonly assertionsDigest: string;
}

/** Jedno pole, które w rekordzie mówi co innego niż dzisiejsze drzewo. */
export interface VerdictConfigDrift {
  readonly field: VerdictConfigField;
  /** Co niesie rekord. `undefined`, gdy pola w nim po prostu nie ma. */
  readonly recorded: unknown;
  readonly live: string | number;
}

/**
 * Ścieżka pliku asercji — liczona z położenia TEGO pliku, nie z `process.cwd()`, żeby digest
 * opisywał checkout, z którym ten kod jedzie, niezależnie od katalogu wywołania. Ta sama decyzja
 * co w ./prompt-sources.ts i ./check-schema-drift.ts.
 */
export const ASSERTIONS_PATH = new URL("../agents/review/evals/assertions.ts", import.meta.url);

/** Ta sama ścieżka w postaci, w jakiej ma się pojawić w komunikacie dla człowieka. */
export const ASSERTIONS_RELATIVE_PATH = "agents/review/evals/assertions.ts";

/**
 * Plik dowodu — czytany i zapisywany jako DANE (JSON), nigdy importem. To jest to samo przejście
 * granicy co `criteria.json` w `run-review-verdict.ts`: `scripts/` bierze z `agents/` wygenerowany
 * plik danych, a nie moduł, więc przenośność agenta zostaje nietknięta.
 */
export const RECORD_PATH = new URL("../agents/review/evals/eval-record.json", import.meta.url);

/** Ta sama ścieżka dla człowieka. */
export const RECORD_RELATIVE_PATH = "agents/review/evals/eval-record.json";

/** Komenda wytwarzająca drugą połowę dowodu. KOSZTUJE — cytowana, żeby jej z tą nie mylić. */
export const RECORD_COMMAND = "npm --prefix agents/review run eval -- --record";

/** Plik, w którym mieszkają trzy liczby — cytowany w remedium, żeby nie trzeba było go szukać. */
export const VERDICT_SOURCE_RELATIVE_PATH = "scripts/review-verdict.ts";

/** Komenda odświeżająca blok, cytowana w każdym remedium, żeby dała się wkleić. */
export const REFRESH_COMMAND = "node --experimental-strip-types scripts/run-verdict-config.ts --write";

/**
 * Digest CAŁEGO pliku asercji.
 *
 * Całego, a nie wybranych funkcji, bo dla kodu nie istnieje forma wartościowa, którą dałoby się
 * porównać sensowniej — i cena tego jest zapisana, nie przemilczana: zaczerwieni go także edycja
 * samego komentarza. Repo przyjęło już tę własność dla `prompt-sources.ts`, a przy remedium
 * DARMOWYM jest ona do zniesienia.
 *
 * CRLF zwijane przed liczeniem, tak samo jak w `extractSection`. `.gitattributes` przypina
 * `eol=lf`, więc dziś nie ma czego zwijać — ale gdyby ten pin kiedyś puścił, objawem byłby digest
 * różny między checkoutem windowsowym a runnerem, czyli czerwień, która nie reprodukuje się nigdzie.
 */
export function liveAssertionsDigest(path: URL = ASSERTIONS_PATH): string {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Warstwa interpretacji, jaką widzi dzisiejsze drzewo.
 *
 * Trzy liczby idą IMPORTEM z `./review-verdict.ts`, nie przepisane — przepisana kopia porównywałaby
 * kopię z kopią i nie zauważyłaby, że werdykt egzekwuje co innego.
 */
export function liveVerdictConfig(): VerdictConfig {
  return {
    threshold: SCORE_THRESHOLD,
    scoreMin: SCORE_MIN,
    scoreMax: SCORE_MAX,
    assertionsDigest: liveAssertionsDigest(),
  };
}

/**
 * Co w zapisanym bloku mówi co innego niż drzewo — lista, nie boolean.
 *
 * Lista, bo komunikat czerwieni ma nazwać POLE i obie wartości; `false` nazwałby tylko fakt, że coś
 * się nie zgadza, a wtedy jedynym dostępnym ruchem jest odruchowe przepisanie rekordu.
 *
 * Brak pola w rekordzie (`undefined`) jest rozjazdem, nie zgodą: rekord napisany ręcznie albo
 * zapisany starszą wersją nie opisuje pola, którego nie ma.
 */
export function compareVerdictConfig(
  recorded: Readonly<Record<string, unknown>> | undefined,
  live: VerdictConfig,
): VerdictConfigDrift[] {
  return VERDICT_CONFIG_FIELDS.filter((field) => recorded?.[field] !== live[field]).map((field) => ({
    field,
    recorded: recorded?.[field],
    live: live[field],
  }));
}

const FIELD_LABEL: Readonly<Record<VerdictConfigField, string>> = {
  threshold: `próg akceptacji (SCORE_THRESHOLD w ${VERDICT_SOURCE_RELATIVE_PATH})`,
  scoreMin: `dolny koniec skali (SCORE_MIN w ${VERDICT_SOURCE_RELATIVE_PATH})`,
  scoreMax: `górny koniec skali (SCORE_MAX w ${VERDICT_SOURCE_RELATIVE_PATH})`,
  assertionsDigest: `digest asercji (${ASSERTIONS_RELATIVE_PATH})`,
};

/** Wiersz rozjazdu. Dla trzech liczb obie wartości są czytelne i mają paść wprost. */
function driftLine(drift: VerdictConfigDrift): string {
  if (drift.field === "assertionsDigest") {
    // Obie wartości to hex sha256 — komunikat NIE udaje, że da się je porównać wzrokiem, tylko
    // mówi, który plik się zmienił. Wypisanie ich obok siebie byłoby zaproszeniem do przepisania
    // jednej w miejsce drugiej, czyli dokładnie do ruchu, przed którym ostrzega remedium niżej.
    return `  - ${FIELD_LABEL[drift.field]}: plik się zmienił, digest w rekordzie już go nie opisuje`;
  }
  return `  - ${FIELD_LABEL[drift.field]}: ${JSON.stringify(drift.recorded)} → ${JSON.stringify(drift.live)}`;
}

/**
 * Co ZROBIĆ z rozjazdem — a nie tylko że dwie wartości się różnią.
 *
 * Dwie gałęzie, bo remedia są różne, i pomylenie ich kosztuje. Trzy liczby przepisuje się wprost.
 * `assertionsDigest` — nie: żeby wiedzieć, czy zapisane `ok` w ogóle jeszcze obowiązują, trzeba
 * przeczytać macierz i ocenić ją SAMEMU, bo z rekordu nie da się tego wyprowadzić (niesie werdykt,
 * `ok`, kontrakt, powody porażek i metryki — a każda asercja startuje od pełnego obiektu `Review`,
 * który żyje wyłącznie w cache'u promptfoo, lokalnie i nieskomitowany).
 *
 * Obie gałęzie kończą się tym samym zdaniem o kroku odświeżającym, bo obie mają ten sam najtańszy
 * zły ruch: uruchomić odświeżacz i zazielenić bramkę bez przeczytania czegokolwiek.
 */
export function remedyFor(drifts: readonly VerdictConfigDrift[]): string {
  const digestDrifted = drifts.some((drift) => drift.field === "assertionsDigest");

  const lines = [
    "Blok `verdictConfig` w agents/review/evals/eval-record.json opisuje INNE wartości niż dzisiejsze drzewo.",
    "",
    "Ta oś NIE wymaga przejścia macierzy evali i nie kosztuje ani centa. Macierz mierzy ODPOWIEDŹ",
    "modelu; te pola opisują wyłącznie sposób, w jaki tę odpowiedź się ODCZYTUJE.",
    "",
    "Co się rozjechało:",
    ...drifts.map(driftLine),
    "",
    "Co zrobić, w tej kolejności:",
  ];

  if (digestDrifted) {
    lines.push(
      `  1. Przeczytaj, co zmieniło się w ${ASSERTIONS_RELATIVE_PATH}.`,
      "  2. Otwórz macierz w eval-record.json i OCEŃ SAM, czy zapisane wyniki każdej komórki",
      "     trzymają się pod nowymi asercjami. Tego kroku nie zrobi za ciebie żadne narzędzie i nie",
      "     da się go wyprowadzić z rekordu: każda asercja startuje od pełnego obiektu `Review`,",
      "     a rekord niesie tylko werdykt, `ok`, kontrakt, powody porażek i metryki.",
      "  3. Jeśli któraś komórka przestaje się bronić — przejedź macierz na nowo (TO JEST WYDATEK),",
      "     zamiast przepisywać digest nad wynikiem, który już nie obowiązuje.",
      `  4. Dopiero teraz odśwież blok: ${REFRESH_COMMAND}`,
      "  5. Zacommituj eval-record.json RAZEM ze zmianą asercji.",
    );
  } else {
    lines.push(
      `  1. Przeczytaj, dlaczego wartość się zmieniła — mieszka w ${VERDICT_SOURCE_RELATIVE_PATH}.`,
      `  2. Odśwież blok: ${REFRESH_COMMAND}`,
      "  3. Zacommituj eval-record.json RAZEM ze zmianą, która ruszyła te wartości.",
    );
  }

  lines.push(
    "",
    "Sam krok odświeżający zieleni bramkę i nie sprawdza niczego — zapisze zgodę na próg, którego",
    "nikt nie przeczytał.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Zapis — połowa `scripts/`. Drugą połowę pisze `agents/review/evals/report.ts --record`.
// ---------------------------------------------------------------------------------------------

/**
 * Dokładne bajty pliku dowodu.
 *
 * ⚑ ZDUBLOWANE z `agents/review/evals/eval-record.ts` i to jest CENA granicy kierunkowej, nie
 * przeoczenie: dwaj zapisywacze piszą do jednego pliku, a `scripts/` nie wolno importować kodu
 * agenta. Dlatego każda strona ma WŁASNY test round-tripu, a checker trzeci — na pliku
 * ZACOMMITOWANYM. Rozjazd tych dwóch linii objawia się natychmiast: plik przeformatowany przez
 * jednego zapisywacza czerwieni round-trip drugiego, zamiast po cichu podmieniać formatowanie.
 *
 * Dwuspacjowe wcięcie i domykający `\n` nie są preferencją: `lint-staged` puszcza
 * `prettier --write` na każdy zastagowany `*.json`, a `agents/**` nie jest w `.prettierignore`.
 */
export function serializeRecord(record: unknown): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Klucze dowodu w kolejności zapisu — druga połowa duplikatu opisanego wyżej. */
const RECORD_KEYS = ["notes", "generatedAt", "callFingerprint", "verdictConfig", "matrix"] as const;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/**
 * Dowód po zapisie połowy `scripts/` — read-modify-write, który ZACHOWUJE cudze bloki.
 *
 * Podmieniany jest WYŁĄCZNIE klucz `verdictConfig`; `callFingerprint` i `matrix` przechodzą co do
 * bajtu. To nie jest ostrożność, tylko warunek działania obu odcisków naraz: gdyby ten zapisywacz
 * dotykał macierzy, oś PŁATNA dałaby się zazielenić komendą DARMOWĄ.
 *
 * Klucze wychodzą w kolejności `RECORD_KEYS` — takiej samej, jaką emituje zapisywacz agencki —
 * żeby dwaj niezależni zapisywacze nie przestawiali ich sobie nawzajem przy każdym przebiegu.
 * Klucze o wartości `undefined` znikają w `JSON.stringify`, więc plik bez `notes` czy `matrix`
 * (stan przejściowy między dwoma zapisami) nie zyskuje tu pustych pól.
 */
export function withVerdictConfig(existing: unknown, config: VerdictConfig): Record<string, unknown> {
  const record = asRecord(existing) ?? {};
  const known = new Set<string>(RECORD_KEYS);
  const unknownKeys = Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)));

  return {
    notes: record.notes,
    generatedAt: record.generatedAt,
    callFingerprint: record.callFingerprint,
    verdictConfig: config,
    matrix: record.matrix,
    ...unknownKeys,
  };
}
