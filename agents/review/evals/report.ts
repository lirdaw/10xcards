import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  readonly cached: boolean;
  readonly assertionsPassed: number;
  readonly assertionsFailed: number;
  readonly failedAssertions: readonly string[];
  readonly ok: boolean;
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
    const error = asString(response["error"]) ?? asString(result["error"]) ?? undefined;
    const assertions = assertionsOf(asRecord(result["gradingResult"]));

    const costUsd = metadata?.["costUsd"];
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
        cached: response["cached"] === true || metadata?.["cached"] === true,
        assertionsPassed: assertions.passed,
        assertionsFailed: assertions.failed,
        failedAssertions: assertions.failedTitles,
        ok: result["success"] === true,
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

const num = (value: number | undefined): string => (value === undefined ? "—" : String(value));
const usd = (value: number | null): string => (value === null ? "—" : value.toFixed(6));

function renderTable(rows: readonly ReportRow[]): string[] {
  const body = rows.map((row) => [
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
  ]);

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
  const priced = rows.filter((row) => row.costUsd !== null);
  const unpriced = rows.filter((row) => row.costUsd === null);
  const total = priced.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const hits = rows.filter((row) => row.cached).length;
  const longRuns = priced.filter((row) => (row.turns ?? 0) > 2);

  const lines = [
    `Suma przejścia: ${usd(total)} USD z ${priced.length}/${rows.length} komórek; trafienia cache'u: ${hits}/${rows.length}.`,
    `Cennik: ${PRICING_AS_OF} (${pricingAgeDays(now)} dni temu), źródło ${PRICING_SOURCE}. Kwoty liczone z tokenów, NIE z total_cost_usd SDK.`,
  ];
  if (unpriced.length > 0) {
    lines.push(
      `Bez kwoty (${unpriced.length}): ${unpriced
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
    "",
    ...renderTotals(rows, now),
    "",
    ...renderFailures(rows),
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

/** Uruchomienie przejścia + odczyt wyniku. Katalog tymczasowy, bo plik wyniku nie jest artefaktem repo. */
export function runEval(extraArgs: readonly string[]): RunResult {
  const workDir = mkdtempSync(join(tmpdir(), "review-eval-"));
  const outputPath = join(workDir, "results.json");
  try {
    const child = spawnSync(
      process.execPath,
      [promptfooEntrypoint(), "eval", "--config", CONFIG_PATH, "--output", outputPath, ...extraArgs],
      { stdio: "inherit", env: process.env },
    );
    // Kod ≠ 0 NIE przerywa raportu: to właśnie przebieg z czerwoną asercją najbardziej go potrzebuje.
    const exitCode = child.status ?? 1;
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

// Porównanie po ZNORMALIZOWANEJ ścieżce, nie po surowym `argv[1]`: na Windowsie separatory
// i wielkość liter potrafią się różnić, a wtedy raport po cichu nigdy by się nie uruchomił.
const isEntrypoint =
  process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isEntrypoint) {
  const { exitCode, rows } = runEval(process.argv.slice(2));
  process.stdout.write(renderReport(rows, new Date()));
  process.exitCode = exitCode;
}
