import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOFT_OBSERVATIONS, type AssertionOutcome } from "./assertions.ts";
import {
  RECORD_COMMAND,
  RECORD_PATH,
  RECORD_RELATIVE_PATH,
  buildRecord,
  serializeRecord,
} from "./eval-record.ts";
import { productionPromptFingerprint } from "./fingerprint.ts";
import { PRICING_AS_OF, PRICING_SOURCE, pricingAgeDays } from "./pricing.ts";

/**
 * Raport przejścia — wymaganie 9. Bez kosztu PER KOMÓRKA reżim kosztowy jest życzeniem, nie bramką.
 *
 * Tabela promptfoo pokazuje zieleń i czerwień, ale nie odpowiada na pytanie, za ile. Kwoty biorą
 * się tu z tokenów × `pricing.ts`, NIGDY z `total_cost_usd` SDK (myli się 14× dla gemini i 5× dla
 * haiku — patrz `pricing.ts`), a obok każdej kwoty jedzie WIEK CENNIKA, żeby czytelnik widział
 * „cennik z <data>, N dni temu” i sam ocenił, czy jej ufa. Cicha nieaktualność przestaje wtedy
 * być cicha, a to wystarcza.
 *
 * ⚑ Ten plik URUCHAMIA także samo przejście, i to jest decyzja, nie rozrost zakresu. `promptfoo
 * eval` kończy się kodem ≠ 0, gdy asercja pęknie — a wtedy raport jest POTRZEBNY NAJBARDZIEJ.
 * Złożenie tego w skrypcie npm operatorem powłoki dałoby albo raport tylko przy zieleni (`&&`),
 * albo skrypt niedziałający na jednej z dwóch powłok, na których to repo jedzie (`;` nie jest
 * separatorem w cmd.exe). Tutaj kolejność jest jawna: uruchom → wczytaj → wypisz → oddaj KOD
 * WYJŚCIA promptfoo bez zmiany, żeby bramka nadal była bramką.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, "promptfooconfig.yaml");

// ---------------------------------------------------------------------------------------------
// Odczyt wyniku. Kształt pliku `--output` promptfoo (`OutputFile`) czytamy DEFENSYWNIE: raport
// nie ma prawa wywalić się na brakującym polu, bo najczęściej brakuje ich właśnie w przebiegu,
// który poszedł źle — czyli w tym, dla którego raport istnieje.
// ---------------------------------------------------------------------------------------------

export interface ReportRow {
  readonly model: string;
  readonly fixture: string;
  /** `pass` / `fail` z recenzji albo `—`, gdy recenzji nie ma. */
  readonly verdict: string;
  /** `ok` albo klasa awarii (`[contract]`, `[provider]`, `[budget]`, `[config]`, `[unknown]`). */
  readonly contract: string;
  /**
   * Treść błędu komórki. Sama klasa awarii NIE wystarcza: przy `response.error` promptfoo wraca
   * przed `runAssertions`, więc rozbicie asercji jest puste i komunikat jest JEDYNĄ rzeczą, która
   * mówi, co się stało. Bez niego „komórka czerwona i NAZWANA" byłaby nazwana tylko z gatunku.
   */
  readonly errorMessage: string | null;
  readonly turns: number | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
  readonly cacheReadTokens: number | undefined;
  readonly costUsd: number | null;
  /** Powód braku kwoty — wypisywany zamiast zera, bo zero czyta się jak „komórka była darmowa”. */
  readonly costUnavailableReason: string | null;
  /**
   * Czas komórki, z `latencyMs` promptfoo (pole wyniku, nie metadanych naszego providera).
   *
   * Nie wchodzi do tabeli — wchodzi do DOWODU (`eval-record.json`), bo tam odpowiada na pytanie
   * „ile trwało to, za co zapłacono", którego kwota sama nie niesie. Wartość MYLĄCA przy trafieniu
   * cache'u (mierzy odczyt, nie wywołanie), i dlatego rekord niesie obok niej `cached`.
   */
  readonly durationMs: number | undefined;
  readonly cached: boolean;
  /**
   * SUROWE pola z SDK, przeniesione do rekordu obok `contract`.
   *
   * `contract` jest WNIOSKIEM (`failureKind` kończy się koszem `unknown`); te dwa są FAKTAMI.
   * Zapadka klasyfikuje niedowiezienie po podtypach WYMIENIONYCH Z IMIENIA — bez nich jedynym
   * nośnikiem tej informacji byłaby proza w `errorMessage`, czyli bramka na stringu pisanym dla
   * człowieka.
   */
  readonly subtype: string | null;
  readonly terminalReason: string | null;
  readonly assertionsPassed: number;
  readonly assertionsFailed: number;
  readonly failedAssertions: readonly string[];
  readonly ok: boolean;
  /**
   * Obserwacje MIĘKKIE — raportowane, NIE bramkujące. Osobne pole, a nie doklejone do
   * `failedAssertions`, bo zlanie ich w jedno kasowałoby całą różnicę: czerwień twarda znaczy
   * „przejście nie przeszło", miękka znaczy „zmierzone i świadomie nienaprawione".
   */
  readonly softObservations: readonly { readonly id: string; readonly outcome: AssertionOutcome }[];
}

type Unknown = Record<string, unknown>;

const asRecord = (value: unknown): Unknown | undefined =>
  typeof value === "object" && value !== null ? (value as Unknown) : undefined;

const asNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Klasa awarii z `metadata.failureKind`, a nie z parsowania tekstu błędu po raz drugi. */
function contractOf(metadata: Unknown | undefined, error: string | undefined): string {
  if (!error) return "ok";
  const kind = asString(metadata?.["failureKind"]);
  return kind ? `[${kind}]` : "[nienazwana]";
}

function assertionsOf(gradingResult: Unknown | undefined): {
  passed: number;
  failed: number;
  failedTitles: string[];
} {
  const components = gradingResult?.["componentResults"];
  if (!Array.isArray(components)) {
    // Brak rozbicia to NIE „zero asercji”: przy `response.error` promptfoo czerwieni komórkę
    // i wraca PRZED `runAssertions`, więc rozbicia po prostu nie ma. Zwracamy zera i pokazujemy
    // to w tabeli jako `—`, zamiast udawać, że komplet asercji przeszedł.
    return { passed: 0, failed: 0, failedTitles: [] };
  }
  let passed = 0;
  let failed = 0;
  const failedTitles: string[] = [];
  for (const raw of components) {
    const component = asRecord(raw);
    if (!component) continue;
    if (component["pass"] === true) passed += 1;
    else {
      failed += 1;
      failedTitles.push(asString(component["reason"]) ?? "(bez powodu)");
    }
  }
  return { passed, failed, failedTitles };
}

/** Przełożenie pliku `--output` promptfoo na wiersze raportu. Czysta funkcja — stąd jej test. */
export function rowsFromOutputFile(outputFile: unknown): ReportRow[] {
  const results = asRecord(asRecord(outputFile)?.["results"])?.["results"];
  if (!Array.isArray(results)) return [];

  return results.flatMap((raw): ReportRow[] => {
    const result = asRecord(raw);
    if (!result) return [];
    const response = asRecord(result["response"]) ?? {};
    const metadata = asRecord(response["metadata"]);
    const tokenUsage = asRecord(response["tokenUsage"]);
    const completionDetails = asRecord(tokenUsage?.["completionDetails"]);
    const vars = asRecord(result["vars"]) ?? {};
    // ⚑ WYŁĄCZNIE `response.error`, NIGDY `result.error` — i to jest naprawa błędu złapanego na
    // pierwszym pełnym przejściu fazy 7. `result.error` w promptfoo niesie powód, dla którego
    // TEST nie przeszedł, więc przy pękniętej ASERCJI zawiera jej treść; wzięte jako sygnał
    // awarii providera klasyfikowało komórkę, która DOJECHAŁA i została poprawnie oceniona jako
    // zła, jako „brak zmierzony". To jest dokładnie to zlanie dwóch dziur, przed którym broni
    // sekcja BRAKI ZMIERZONE — popełnione w kodzie, który miał przed nim bronić.
    // `response.error` ustawia WYŁĄCZNIE nasz provider, gdy `runReview` rzuciło (faza 4 §2).
    const error = asString(response["error"]) ?? undefined;
    const assertions = assertionsOf(asRecord(result["gradingResult"]));

    const costUsd = metadata?.["costUsd"];
    const cell = { output: response["output"], error };
    const softExpectation = { conditionalCriteriaShouldBeNull: vars["expectConditionalNull"] === true };
    const softObservations = SOFT_OBSERVATIONS.map((observation) => ({
      id: observation.id,
      outcome: observation.run(cell, softExpectation),
    }));
    return [
      {
        model: asString(metadata?.["model"]) ?? asString(asRecord(result["provider"])?.["label"]) ?? "(nieznany)",
        fixture: asString(vars["fixture"]) ?? asString(vars["diffPath"]) ?? "(nieznana)",
        verdict: asString(metadata?.["verdict"]) ?? "—",
        contract: contractOf(metadata, error),
        errorMessage: error ?? null,
        turns: asNumber(metadata?.["numTurns"]),
        inputTokens: asNumber(tokenUsage?.["prompt"]),
        outputTokens: asNumber(tokenUsage?.["completion"]),
        cacheWriteTokens: asNumber(completionDetails?.["cacheCreationInputTokens"]),
        cacheReadTokens: asNumber(completionDetails?.["cacheReadInputTokens"]),
        costUsd: typeof costUsd === "number" ? costUsd : null,
        costUnavailableReason: asString(metadata?.["costUnavailableReason"]) ?? null,
        durationMs: asNumber(result["latencyMs"]),
        cached: response["cached"] === true || metadata?.["cached"] === true,
        subtype: asString(metadata?.["subtype"]) ?? null,
        terminalReason: asString(metadata?.["terminalReason"]) ?? null,
        assertionsPassed: assertions.passed,
        assertionsFailed: assertions.failed,
        failedAssertions: assertions.failedTitles,
        ok: result["success"] === true,
        softObservations,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------------------------------

const COLUMNS = [
  "model",
  "fikstura",
  "werdykt",
  "kontrakt",
  "tury",
  "in",
  "out",
  "cache zapis",
  "cache odczyt",
  "koszt USD",
  "cache",
  "asercje",
] as const;

/**
 * Komórka URUCHOMIONA, która NIE WYPRODUKOWAŁA wyniku — czyli BRAK ZMIERZONY.
 *
 * ⚑ To jest inny rodzaj dziury niż dwa pozostałe, jakie ta tabela potrafi pokazać, i czytelnik
 * NIE MA tego zgadywać z kontekstu. Trzy rodzaje pustki, świadomie rozróżnione:
 *
 *   1. **BRAK ZMIERZONY** (`BRAK` w komórkach, sekcja „BRAKI ZMIERZONE") — komórka pojechała
 *      i nie dojechała. Klasa awarii jest NAZWANA, powód zapisany. To jest WYNIK: wiemy, że tego
 *      modelu na tym materiale nie da się dziś zmierzyć, i wiemy dlaczego.
 *   2. **Brak licznika** (`—` w kolumnie liczbowej, sekcja „Bez kwoty") — komórka DOJECHAŁA,
 *      recenzja jest, ale SDK nie podało któregoś licznika tokenów. Wynik jest, kwoty nie ma.
 *   3. **Komórka nieobecna w tabeli** — nie została uruchomiona wcale (zawężenie przebiegu
 *      filtrem). Nie ma o niej ANI wyniku, ANI informacji, że go nie ma.
 *
 * Zlanie (1) z (2) pod wspólnym `—` byłoby dokładnie tą klasą błędu, którą ten zestaw ma łapać:
 * „nie zmierzono" wyglądałoby jak „zmierzono i wyszło pusto".
 */
const isMeasuredAbsence = (row: ReportRow): boolean => row.contract !== "ok";

/** Pustka typu (2): licznika nie ma, ale wynik JEST. */
const num = (value: number | undefined): string => (value === undefined ? "—" : String(value));
const usd = (value: number | null): string => (value === null ? "—" : value.toFixed(6));

/** Pustka typu (1): wyniku NIE MA i wiadomo dlaczego. Inny znak, bo inne znaczenie. */
const ABSENT = "BRAK";

function renderTable(rows: readonly ReportRow[]): string[] {
  const body = rows.map((row) => {
    // Wiersz, który nie dojechał, dostaje `BRAK` we WSZYSTKICH kolumnach wynikowych — nie `—`.
    // Kolumna `kontrakt` niesie przy tym klasę awarii, więc wiersz sam mówi, czym ten brak jest.
    if (isMeasuredAbsence(row)) {
      return [row.model, row.fixture, ABSENT, row.contract, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT, ABSENT];
    }
    return [
      row.model,
      row.fixture,
      row.verdict,
      row.contract,
      num(row.turns),
      num(row.inputTokens),
      num(row.outputTokens),
      num(row.cacheWriteTokens),
      num(row.cacheReadTokens),
      usd(row.costUsd),
      row.cached ? "TRAFIENIE" : "zimna",
      row.assertionsPassed + row.assertionsFailed === 0 ? "—" : `${row.assertionsPassed}/${row.assertionsPassed + row.assertionsFailed}`,
    ];
  });

  const widths = COLUMNS.map((header, index) =>
    Math.max(header.length, ...body.map((cells) => cells[index]?.length ?? 0)),
  );
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ")} |`;

  return [line(COLUMNS), line(widths.map((width) => "-".repeat(width))), ...body.map(line)];
}

/**
 * Suma przejścia. Wiersz bez kwoty NIE jest liczony jako zero — jest wymieniony z nazwy, żeby
 * suma nigdy nie wyglądała na kompletną, kiedy nie jest.
 */
function renderTotals(rows: readonly ReportRow[], now: Date): string[] {
  // Mianownik liczy komórki ZMIERZONE, nie wszystkie. Wrzucenie brakw zmierzonych do „Bez kwoty"
  // postawiłoby obok siebie dwa zdania o zupełnie różnym znaczeniu — „wynik jest, kwoty nie ma"
  // i „wyniku nie ma wcale" — pod jednym nagłówkiem.
  const measured = rows.filter((row) => !isMeasuredAbsence(row));
  const absent = rows.filter(isMeasuredAbsence);
  const priced = measured.filter((row) => row.costUsd !== null);
  const unpriced = measured.filter((row) => row.costUsd === null);
  const total = priced.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const hits = measured.filter((row) => row.cached).length;
  const longRuns = priced.filter((row) => (row.turns ?? 0) > 2);

  // DWIE kwoty, nie jedna, i to jest naprawa defektu zauważonego na żywym przebiegu: przy komplecie
  // trafień pojedyncza „suma przejścia" pokazywała 0,0886 USD nad wierszem `TRAFIENIE`, czyli
  // czytała się jak WYDATEK za przebieg, który nie kosztował nic. W bramce kosztowej to nie jest
  // kosmetyka — wymaganie 6 („powtórzenie jest darmowe") sprawdza się dokładnie tą liczbą.
  const paid = priced.filter((row) => !row.cached).reduce((sum, row) => sum + (row.costUsd ?? 0), 0);

  const lines = [
    `Koszt komórek: ${usd(total)} USD z ${priced.length}/${measured.length} komórek ZMIERZONYCH; trafienia cache'u: ${hits}/${measured.length}.`,
    `ZAPŁACONE w tym przejściu: ${usd(paid)} USD (trafienia cache'u nie kosztują).`,
    `Cennik: ${PRICING_AS_OF} (${pricingAgeDays(now)} dni temu), źródło ${PRICING_SOURCE}. Kwoty liczone z tokenów, NIE z total_cost_usd SDK.`,
  ];
  if (absent.length > 0) {
    lines.push(
      `Komórek uruchomionych: ${rows.length}; z tego ZMIERZONYCH ${measured.length}, ` +
        `BRAKÓW ZMIERZONYCH ${absent.length} (nie wchodzą do żadnej kwoty — patrz sekcja niżej).`,
    );
  }
  if (unpriced.length > 0) {
    lines.push(
      `Bez kwoty (${unpriced.length}) — komórka DOJECHAŁA, ale SDK nie podało licznika: ${unpriced
        .map((row) => `${row.model}/${row.fixture} — ${row.costUnavailableReason ?? "brak metryk"}`)
        .join("; ")}`,
    );
  }
  if (longRuns.length > 0) {
    lines.push(
      `⚑ DOLNE oszacowanie w ${longRuns.length} komórce/-ach (tury > 2): ${longRuns
        .map((row) => `${row.model}/${row.fixture} (${row.turns} tur)`)
        .join(", ")} — \`usage\` SDK pochodzi z OSTATNIEJ wiadomości, nie z sumy po turach.`,
    );
  }
  return lines;
}

/**
 * BRAKI ZMIERZONE — komórki URUCHOMIONE, które nie wyprodukowały wyniku.
 *
 * Sekcja istnieje, żeby taki brak był WYNIKIEM, a nie pustą kratką. Różnica jest praktyczna, nie
 * retoryczna: pusta kratka mówi czytelnikowi „nie wiadomo", a brak zmierzony mówi „wiadomo, że
 * się nie da, i wiadomo dlaczego" — a to drugie jest odpowiedzią na pytanie z `requirements.md`,
 * nie luką w niej. Dlatego sekcja nazywa klasę awarii, cytuje komunikat i odsyła do ryzyka.
 *
 * Stoi NAD sumami, bo czytelnik ma zobaczyć, ilu komórek kwoty NIE dotyczą, zanim przeczyta kwoty.
 */
function renderMeasuredAbsences(rows: readonly ReportRow[]): string[] {
  const absent = rows.filter(isMeasuredAbsence);
  if (absent.length === 0) return [];
  return [
    "",
    `BRAKI ZMIERZONE — komórka URUCHOMIONA, wynik NIE POWSTAŁ (${absent.length} z ${rows.length}):`,
    ...absent.flatMap((row) => [
      `  ✗ ${row.model} / ${row.fixture} — klasa awarii ${row.contract}`,
      `      ${row.errorMessage ?? "(bez komunikatu)"}`,
    ]),
    "  ⚑ To NIE jest luka w pokryciu ani pusta komórka: przebieg się odbył i został POLICZONY",
    "    przez dostawcę — brak wyniku NIE oznacza braku rachunku. Kwoty tej komórki nie da się",
    "    policzyć (SDK nie oddało liczników), więc nie ma jej w sumach WYŻEJ; różnicę widać",
    "    dopiero w odczycie `/api/v1/key`. Zmierzone: przejście fazy 7 policzyło 0,0819 USD,",
    "    a klucz obciążono o 0,1185 USD — brakujące ~0,031 to właśnie ta komórka.",
    "    Odróżnij od dwóch pozostałych rodzajów pustki w tym raporcie:",
    "      • wiersz `Bez kwoty` w sumach — komórka DOJECHAŁA, recenzja jest, brakuje licznika tokenów.",
    "      • komórka nieobecna w tabeli — nie uruchomiono jej wcale (zawężenie przebiegu filtrem);",
    "        o niej raport nie mówi NIC, także tego, że jej nie ma.",
  ];
}

function renderFailures(rows: readonly ReportRow[]): string[] {
  const broken = rows.filter((row) => !row.ok);
  if (broken.length === 0) return ["Wszystkie komórki zielone na asercjach twardych."];
  return [
    `Czerwone komórki (${broken.length}/${rows.length}):`,
    ...broken.flatMap((row) => [
      `  ${row.model} / ${row.fixture} — kontrakt ${row.contract}`,
      ...(row.errorMessage ? [`    ✗ ${row.errorMessage}`] : []),
      ...row.failedAssertions.map((reason) => `    ✗ ${reason}`),
    ]),
  ];
}

/**
 * Obserwacje miękkie. Wypisywane ZAWSZE, gdy któraś ma status inny niż `skip` — także gdy
 * wszystkie przeszły, bo „zmierzone i w porządku" jest informacją, a nie brakiem informacji.
 *
 * Sekcja stoi POD werdyktem przejścia i mówi wprost, że nie bramkuje. Bez tego zdania czytelnik
 * zobaczyłby czerwony wiersz nad linią „Wszystkie komórki zielone" i musiałby sam zgadywać, które
 * z nich obowiązuje.
 */
function renderSoft(rows: readonly ReportRow[]): string[] {
  const spoken = rows.flatMap((row) =>
    row.softObservations
      .filter((observation) => observation.outcome.status !== "skip")
      .map((observation) => ({ row, observation })),
  );
  if (spoken.length === 0) return [];

  const broken = spoken.filter(({ observation }) => observation.outcome.status === "fail");
  return [
    "",
    `Obserwacje MIĘKKIE (raportowane, NIE bramkują zieleni) — ${broken.length} niedotrzymanych z ${spoken.length}:`,
    ...spoken.map(
      ({ row, observation }) =>
        `  ${observation.outcome.status === "fail" ? "✗" : "✓"} ${row.model} / ${row.fixture} [${observation.id}] ${observation.outcome.reason}`,
    ),
    ...(broken.length > 0
      ? [
          "  ⚑ Stan ZMIERZONY i świadomie nienaprawiony — patrz sekcja Open Risks w planie zmiany,",
          "    gdzie warunek zamknięcia jest zapisany jako PYTANIE DO POMIARU, nie jako zadanie.",
        ]
      : []),
  ];
}

/** Cały raport jako TEKST — żeby dał się przetestować bez przechwytywania stdout. */
export function renderReport(rows: readonly ReportRow[], now: Date): string {
  if (rows.length === 0) {
    return "Raport przejścia: BRAK WIERSZY — przejście nie zwróciło ani jednej komórki.\n";
  }
  return [
    "",
    "=== Raport przejścia zestawu evali ===",
    "",
    ...renderTable(rows),
    ...renderMeasuredAbsences(rows),
    "",
    ...renderTotals(rows, now),
    "",
    ...renderFailures(rows),
    ...renderSoft(rows),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Uruchomienie.
// ---------------------------------------------------------------------------------------------

/**
 * Ścieżka do entrypointu promptfoo, rozwiązana przez resolvera Node'a — nie przez `.bin` i nie
 * przez powłokę: wpis w `.bin` to na Windowsie `.cmd`, a na POSIX symlink, więc uruchamianie go
 * wymagałoby powłoki i rozjeżdżałoby się między platformami.
 *
 * Rozwiązujemy `promptfoo`, a NIE `promptfoo/package.json` — ta druga ścieżka jest zablokowana
 * przez `exports` pakietu (`ERR_PACKAGE_PATH_NOT_EXPORTED`, zmierzone). `bin.promptfoo` leży
 * w tym samym katalogu co `main`, więc bierzemy go stamtąd.
 */
function promptfooEntrypoint(): string {
  const require = createRequire(import.meta.url);
  const entrypoint = join(dirname(require.resolve("promptfoo")), "entrypoint.js");
  if (!existsSync(entrypoint)) {
    throw new Error(
      `[raport] nie znaleziono entrypointu promptfoo pod ${entrypoint} — czy \`npm ci\` w agents/review przeszło?`,
    );
  }
  return entrypoint;
}

export interface RunResult {
  readonly exitCode: number;
  readonly rows: ReportRow[];
}

/**
 * Przerenderowanie raportu z ZAPISANEGO wyniku, bez uruchamiania przejścia.
 *
 * Powstało z konkretnego rachunku: poprawka w samym RAPORCIE nie ma prawa kosztować kolejnego
 * przejścia macierzy. Plik bierze się z `--output` albo z `promptfoo export eval <evalId>`,
 * więc każdy przebieg, który się kiedykolwiek odbył, daje się opisać na nowo za darmo.
 */
export function rowsFromFile(path: string): ReportRow[] {
  return rowsFromOutputFile(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Sufit czasu na JEDNO przejście macierzy.
 *
 * `spawnSync` jest SYNCHRONICZNY, więc blokuje pętlę zdarzeń — deklarowany limit `node:test`
 * w `report.test.ts` nie ma jak wystrzelić, dopóki dziecko nie wróci, i bez tej opcji zawieszony
 * promptfoo (padnięta sieć na PUDLE cache'u, zablokowany zapis `cache.json`) wisi bez końca.
 * Wzorzec istnieje w tym pakiecie: `review-cli.test.ts` daje swojemu `spawnSync` `timeout: 60_000`.
 *
 * Wymiar wzięty ze ZMIERZONYCH przebiegów, nie z wyczucia: 22-67 s na komórkę × 4 komórki to
 * ~4,5 minuty w najgorszym zapisanym przypadku, więc 20 minut zostawia ~4× zapasu na zimną sieć
 * i nie odcina przejścia, które po prostu jest wolne. `SIGKILL`, bo proces wiszący na I/O potrafi
 * przespać `SIGTERM`, a wtedy limit byłby deklaracją.
 */
const EVAL_TIMEOUT_MS = 20 * 60_000;

/**
 * Nazwanie awarii, której kod wyjścia nie odróżnia — czysta funkcja, stąd jej test.
 *
 * Stan niesiony przez DWA pola czyta się z dwóch: `status` mówi, że nie było zera, a `error`
 * mówi DLACZEGO nie było. Ten sam kształt co `subtype` + `is_error` w wyniku SDK
 * (`run-review.ts`), gdzie sam `subtype === \"success\"` okazał się fałszywym oraklem.
 */
export function describeSpawnFailure(error: Error | undefined, timeoutMs: number): string | undefined {
  if (!error) return undefined;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT") {
    return `[raport] przejście PRZERWANE po ${timeoutMs} ms limitu czasu — to nie jest wynik: kwot ani werdyktów z tego przebiegu nie ma`;
  }
  return `[raport] promptfoo NIE URUCHOMIŁO SIĘ (${code ?? "bez kodu"}): ${error.message} — czy \`npm ci\` w agents/review przeszło?`;
}

/** Uruchomienie przejścia + odczyt wyniku. Katalog tymczasowy, bo plik wyniku nie jest artefaktem repo. */
export function runEval(extraArgs: readonly string[], timeoutMs: number = EVAL_TIMEOUT_MS): RunResult {
  const workDir = mkdtempSync(join(tmpdir(), "review-eval-"));
  const outputPath = join(workDir, "results.json");
  try {
    const child = spawnSync(
      process.execPath,
      [promptfooEntrypoint(), "eval", "--config", CONFIG_PATH, "--output", outputPath, ...extraArgs],
      { stdio: "inherit", env: process.env, timeout: timeoutMs, killSignal: "SIGKILL" },
    );
    // Kod ≠ 0 NIE przerywa raportu: to właśnie przebieg z czerwoną asercją najbardziej go potrzebuje.
    //
    // Ale kod wyjścia to POŁOWA stanu, który `spawnSync` niesie. Proces, który się nie uruchomił
    // (ENOENT, EPERM), i proces ubity limitem czasu (ETIMEDOUT) dają `status: null`, czyli ten sam
    // `exitCode = 1` co przebieg zamknięty czerwoną asercją. Rozróżnia je WYŁĄCZNIE `child.error`
    // — i bez jego odczytu jedynym komunikatem byłoby „nie udało się wczytać wyniku”, czyli diagnoza
    // PLIKU zamiast diagnozy przyczyny, dokładnie wtedy, gdy przyczyna jest najbardziej potrzebna.
    const exitCode = child.status ?? 1;
    const spawnFailure = describeSpawnFailure(child.error, timeoutMs);
    if (spawnFailure !== undefined) process.stderr.write(`${spawnFailure}
`);
    let rows: ReportRow[] = [];
    try {
      rows = rowsFromOutputFile(JSON.parse(readFileSync(outputPath, "utf8")));
    } catch (err) {
      process.stderr.write(
        `[raport] nie udało się wczytać wyniku przejścia z ${outputPath}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return { exitCode, rows };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Zapis DOWODU (`--record`).
// ---------------------------------------------------------------------------------------------

export interface ParsedArgs {
  /** `--from <plik>`: renderuj z zapisanego wyniku, bez wywołania modelu. */
  readonly from: string | undefined;
  /** `--record`: po przejściu zapisz dowód do `eval-record.json`. */
  readonly record: boolean;
  /** Reszta, przekazywana `promptfoo eval` bez zmian. */
  readonly rest: readonly string[];
}

/**
 * `--from <plik>` i `--record` są KONSUMOWANE; reszta argumentów leci do `promptfoo eval`.
 *
 * Konsumpcja `--record` nie jest detalem stylu: nieskonsumowana reszta jedzie w całości do
 * `promptfoo eval` (patrz `runEval`), więc flaga zostawiona w `rest` dojechałaby tam jako nieznana
 * opcja i wywaliłaby przejście — czyli PO zapłaceniu za nie.
 */
export function splitArgs(argv: readonly string[]): ParsedArgs {
  const withoutRecord = argv.filter((arg) => arg !== "--record");
  const record = withoutRecord.length !== argv.length;

  const index = withoutRecord.indexOf("--from");
  if (index === -1) return { from: undefined, record, rest: withoutRecord };
  const from = withoutRecord[index + 1];
  if (from === undefined) throw new Error("[raport] `--from` wymaga ścieżki do pliku wyniku.");
  return { from, record, rest: [...withoutRecord.slice(0, index), ...withoutRecord.slice(index + 2)] };
}

/** Argumenty ZAWĘŻAJĄCE przebieg. Prefiks, nie lista nazw — promptfoo ma ich osiem i przybywa. */
export function narrowingArgs(rest: readonly string[]): string[] {
  return rest.filter((arg) => arg.startsWith("--filter"));
}

/**
 * Odmowa zapisu rozstrzygana Z ARGUMENTÓW — czyli PRZED przejściem, zanim padnie pierwszy cent.
 *
 * Obie odmowy są TWARDE, nie ostrzeżeniami, bo dowód zapisany w tych warunkach jest zgodny
 * z odciskiem i nic nie znaczy — a to gorzej niż jego brak:
 *
 *   * `--from` renderuje raport z ZAPISANEGO wyniku, a odcisk liczy się ŻYWO w chwili zapisu.
 *     Para `--from --record` wyprodukowałaby więc dowód zgodny z dzisiejszym odciskiem, opisujący
 *     przebieg sprzed zmiany promptu. To jedyna droga do sfałszowania dowodu, którą otwierałoby
 *     WŁASNE narzędzie — i dlatego jest domknięta. Ręcznej edycji pliku nie domknie nic i nie
 *     udajemy, że domykamy.
 *   * `--filter…` zawęża przebieg, a dowód z jednej kolumny nie jest dowodem. Zapadka złapałaby
 *     to i tak (macierz niepełna), ale dopiero na CI i już po wydatku.
 */
export function recordArgsRefusal(args: ParsedArgs): string | undefined {
  if (!args.record) return undefined;

  if (args.from !== undefined) {
    return [
      "[dowód] ODMOWA: `--record` i `--from` wykluczają się wzajemnie.",
      "",
      "`--from` renderuje raport z ZAPISANEGO wyniku, a odcisk wywołania liczy się ŻYWO w chwili",
      "zapisu — więc ta para wyprodukowałaby dowód zgodny z dzisiejszym odciskiem i opisujący",
      "przebieg sprzed zmiany promptu. Dowód, który zgadza się z odciskiem i nie opisuje go, jest",
      "gorszy niż brak dowodu.",
      "",
      `Chcesz zapisać dowód → przejedź macierz: ${RECORD_COMMAND}`,
      "Chcesz tylko przerenderować raport → zostaw samo `--from`.",
    ].join("\n");
  }

  const narrowing = narrowingArgs(args.rest);
  if (narrowing.length > 0) {
    return [
      `[dowód] ODMOWA: przebieg jest zawężony (${narrowing.join(", ")}), więc jego wynik nie jest dowodem.`,
      "",
      "Zapadka wymaga PEŁNEJ macierzy: kolumna, której się nie zmierzyło, jest kolumną, o której",
      "nic nie wiadomo. Dowód z zawężonego przejścia byłby zgodny z odciskiem i pusty.",
      "",
      `Przejedź pełną macierz: ${RECORD_COMMAND}`,
    ].join("\n");
  }

  return undefined;
}

/** Trzecia odmowa — rozstrzygalna dopiero PO przejściu: zero wierszy to nie jest pomiar. */
export function recordRowsRefusal(rows: readonly ReportRow[]): string | undefined {
  if (rows.length > 0) return undefined;
  return [
    "[dowód] ODMOWA: przejście zwróciło ZERO wierszy, więc nie ma czego zapisać.",
    "",
    "Pusty dowód zgadzałby się z odciskiem i nie mówiłby nic — a zapadka odczytałaby go jako",
    "macierz niepełną dopiero na CI. Przeczytaj wyjście promptfoo WYŻEJ: przejście najpewniej",
    "w ogóle się nie odbyło.",
  ].join("\n");
}

/**
 * Zapis połowy AGENCKIEJ dowodu. Read-modify-write: cudzy blok `verdictConfig` przeżywa.
 *
 * Nieczytelny albo nieistniejący plik NIE jest błędem — pierwszy zapis tworzy go od zera. Nie ma
 * tu miejsca na `try/catch` szerszy niż odczyt: awaria SAMEGO zapisu ma dojść do `main`.
 */
function writeRecord(rows: readonly ReportRow[], now: Date): void {
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
  } catch {
    existing = undefined;
  }
  const record = buildRecord({ rows, existing, callFingerprint: productionPromptFingerprint(), now });
  writeFileSync(RECORD_PATH, serializeRecord(record), "utf8");
}

// Porównanie po ZNORMALIZOWANEJ ścieżce, nie po surowym `argv[1]`: na Windowsie separatory
// i wielkość liter potrafią się różnić, a wtedy raport po cichu nigdy by się nie uruchomił.
const isEntrypoint =
  process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isEntrypoint) {
  const args = splitArgs(process.argv.slice(2));
  const argsRefusal = recordArgsRefusal(args);

  if (argsRefusal !== undefined) {
    // PRZED przejściem — odmowa po wydatku byłaby odmową wartą 0,12 USD.
    process.stderr.write(`${argsRefusal}\n`);
    process.exitCode = 1;
  } else if (args.from === undefined) {
    const { exitCode, rows } = runEval(args.rest);
    process.stdout.write(renderReport(rows, new Date()));
    process.exitCode = exitCode;

    if (args.record) {
      const rowsRefusal = recordRowsRefusal(rows);
      if (rowsRefusal !== undefined) {
        process.stderr.write(`${rowsRefusal}\n`);
        process.exitCode = 1;
      } else {
        // Zapis idzie także wtedy, gdy któraś komórka jest CZERWONA, i to jest decyzja: dowód ma
        // opisywać przejście, które się odbyło. Czerwoną komórkę zapadka złapie sama i nazwie —
        // dowód „poprawiony" przez pominięcie jej byłby dowodem czegoś, czego nie zmierzono.
        writeRecord(rows, new Date());
        process.stderr.write(
          `[dowód] zapisano ${rows.length} komórek do ${RECORD_RELATIVE_PATH}. ` +
            "Druga połowa (verdictConfig) NIE jest tym zapisem objęta — patrz " +
            "scripts/run-verdict-config.ts --write.\n",
        );
      }
    }
  } else {
    // Tryb odczytu: raport, ale ŻADNEGO wywołania modelu. Kod wyjścia bierze się z wierszy,
    // bo nie ma procesu promptfoo, którego kodu można by nie zmienić.
    const rows = rowsFromFile(args.from);
    process.stdout.write(renderReport(rows, new Date()));
    process.exitCode = rows.every((row) => row.ok) ? 0 : 1;
  }
}
