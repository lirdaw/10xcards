// Raport przejścia — i przejście CAŁEJ macierzy bez ani jednego wywołania modelu.
//
// Dwie warstwy, bo pilnują dwóch różnych rzeczy:
//
//   (A) render z zapisanego wyniku — czysta funkcja, natychmiastowa, pokazuje, że tabela niesie
//       komplet kolumn i że wiek cennika jedzie OBOK kwot;
//   (B) przejście end-to-end na zaseedowanym cache'u — dowód, że config, provider, asercje
//       i raport są ze sobą realnie spięte. Sam render przechodziłby także wtedy, gdyby
//       `promptfooconfig.yaml` wskazywał na nieistniejącą funkcję asercji.
//
// ⚑ Warstwa (B) biegnie z USUNIĘTYM `ANTHROPIC_AUTH_TOKEN`, i to nie jest higiena, tylko ORAKL:
// bramka klucza w `runCell` stoi PO odczycie cache'u, więc trafienie przechodzi bez poświadczeń,
// a każde PUDŁO kończy się odmową `[config]` i czerwoną komórką. „Zero wywołań modelu" jest więc
// zagwarantowane przez KONSTRUKCJĘ i widoczne w wyniku, a nie deklarowane w komentarzu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CRITERIA, type Review } from "../review-schema.ts";
import type { ReviewMetrics } from "../run-review.ts";
import { cellCacheKey, isCacheEnabled, writeCell } from "./cache.ts";
import { PRICING_AS_OF } from "./pricing.ts";
import { productionPromptFingerprint } from "./provider.ts";
import { renderReport, rowsFromOutputFile, runEval, type ReportRow } from "./report.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");

// ---------------------------------------------------------------------------------------------
// (A) Render.
// ---------------------------------------------------------------------------------------------

const ROW: ReportRow = {
  model: "anthropic/claude-haiku-4.5",
  fixture: "sample.diff",
  verdict: "fail",
  contract: "ok",
  errorMessage: null,
  turns: 2,
  inputTokens: 10,
  outputTokens: 6995,
  cacheWriteTokens: 38365,
  cacheReadTokens: 0,
  costUsd: 0.082941,
  costUnavailableReason: null,
  cached: false,
  assertionsPassed: 6,
  assertionsFailed: 0,
  failedAssertions: [],
  ok: true,
  softObservations: [],
};

test("(A1) tabela niesie komplet kolumn, sumę i WIEK cennika obok kwot", () => {
  const report = renderReport([ROW], new Date("2026-08-30T00:00:00Z"));
  for (const column of ["model", "fikstura", "werdykt", "kontrakt", "tury", "koszt USD", "cache", "asercje"]) {
    assert.ok(report.includes(column), `w tabeli brakuje kolumny „${column}"`);
  }
  assert.ok(report.includes("0.082941"), "kwota komórki nie trafiła do tabeli");
  assert.ok(report.includes(PRICING_AS_OF), "data cennika nie jedzie obok kwot");
  assert.ok(report.includes("7 dni temu"), "wiek cennika nie jest policzony wobec podanego „teraz”");
  assert.ok(report.includes("NIE z total_cost_usd"), "raport nie mówi, skąd NIE bierze kwot");
});

test("(A2) komórka bez kwoty jest WYMIENIONA, a nie doliczona jako zero", () => {
  const report = renderReport(
    [ROW, { ...ROW, model: "google/gemini-2.5-flash", costUsd: null, costUnavailableReason: "SDK nie podało liczników: outputTokens" }],
    new Date("2026-08-23T00:00:00Z"),
  );
  assert.ok(report.includes("Bez kwoty (1)"), "brak kwoty nie został wymieniony");
  assert.ok(report.includes("SDK nie podało liczników"), "powód braku kwoty zniknął z raportu");
  assert.ok(report.includes("1/2 komórek"), "suma nie mówi, ilu komórek dotyczy");
});

test("(A3) przebieg dłuższy niż dwie tury jest oznaczony jako DOLNE oszacowanie", () => {
  // Zmierzone: `usage` w wyniku SDK pochodzi z OSTATNIEJ wiadomości, nie z sumy po turach, więc
  // rekonstrukcja zaniża dla przebiegu trzyturowego (gemini z Pomiaru II: 0,0173 wobec 0,0323).
  const report = renderReport([{ ...ROW, turns: 3 }], new Date("2026-08-23T00:00:00Z"));
  assert.ok(report.includes("DOLNE oszacowanie"), "raport nie ostrzega przy turach > 2");
});

test("(A4) czerwona komórka wypisuje POWÓD każdej pękniętej asercji", () => {
  const report = renderReport(
    [{ ...ROW, ok: false, assertionsPassed: 5, assertionsFailed: 1, failedAssertions: ["[verdict] verdict = \"pass\", oczekiwano \"fail\""] }],
    new Date("2026-08-23T00:00:00Z"),
  );
  assert.ok(report.includes("Czerwone komórki (1/1)"), "czerwień nie została podliczona");
  assert.ok(report.includes("oczekiwano"), "powód pękniętej asercji zniknął z raportu");
});

test("(A5) puste przejście mówi WPROST, że nie ma wierszy", () => {
  // Zero wierszy nie może wyglądać jak zielone przejście za 0 USD — to jest ta sama klasa,
  // co zero wpisane „dla porządku" w kolumnie kosztu.
  assert.ok(renderReport([], new Date("2026-08-23T00:00:00Z")).includes("BRAK WIERSZY"));
});

test("(A6) wiersze powstają z kształtu, który promptfoo naprawdę zapisuje w `--output`", () => {
  const rows = rowsFromOutputFile({
    results: {
      version: 3,
      results: [
        {
          success: true,
          vars: { fixture: "sample.diff", diffPath: "sample.diff", expectedVerdict: "fail" },
          provider: { id: "review:anthropic/claude-haiku-4.5", label: "haiku-4.5" },
          response: {
            cached: true,
            tokenUsage: { prompt: 10, completion: 6995, completionDetails: { cacheCreationInputTokens: 38365, cacheReadInputTokens: 0 } },
            metadata: { model: "anthropic/claude-haiku-4.5", verdict: "fail", numTurns: 2, costUsd: 0.082941, costUnavailableReason: null },
          },
          gradingResult: { pass: true, score: 1, reason: "", componentResults: [{ pass: true, reason: "[verdict] ok" }, { pass: false, reason: "[score-range] poza skalą" }] },
        },
      ],
    },
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.model, "anthropic/claude-haiku-4.5");
  assert.equal(row.fixture, "sample.diff");
  assert.equal(row.cached, true);
  assert.equal(row.costUsd, 0.082941);
  assert.equal(row.assertionsPassed, 1);
  assert.equal(row.assertionsFailed, 1);
});

test("(A7) komórka z `error` dostaje NAZWANY kontrakt, nie „ok”", () => {
  const rows = rowsFromOutputFile({
    results: {
      results: [
        {
          success: false,
          vars: { fixture: "sample.diff" },
          provider: { id: "review:google/gemini-2.5-flash", label: "gemini-2.5-flash" },
          response: {
            error: "[contract] wyjście modelu nie przeszło walidacji schematem",
            metadata: { model: "google/gemini-2.5-flash", failureKind: "contract" },
          },
        },
      ],
    },
  });
  assert.equal(rows[0]?.contract, "[contract]");
  assert.match(rows[0]?.errorMessage ?? "", /walidacji schematem/, "treść błędu musi dojechać do raportu — sama klasa awarii nie mówi, co się stało");
  assert.equal(rows[0]?.verdict, "—", "brak werdyktu nie może udawać werdyktu");
  assert.equal(rows[0]?.ok, false);
});

// ---------------------------------------------------------------------------------------------
// (B) Przejście end-to-end na zaseedowanym cache'u — kryterium 5.2.
// ---------------------------------------------------------------------------------------------

const MATRIX = [
  { model: "anthropic/claude-haiku-4.5", fixture: "sample.diff", path: join(PACKAGE_ROOT, "sample.diff"), verdict: "fail" as const },
  { model: "google/gemini-2.5-flash", fixture: "sample.diff", path: join(PACKAGE_ROOT, "sample.diff"), verdict: "fail" as const },
  {
    model: "anthropic/claude-haiku-4.5",
    fixture: "clean-text-change.diff",
    path: join(HERE, "fixtures", "clean-text-change.diff"),
    verdict: "pass" as const,
  },
  {
    model: "google/gemini-2.5-flash",
    fixture: "clean-text-change.diff",
    path: join(HERE, "fixtures", "clean-text-change.diff"),
    verdict: "pass" as const,
  },
];

/** Wynik, który dla obu fikstur przechodzi KOMPLET asercji twardych tej fazy. */
function seededReview(verdict: Review["verdict"]): Review {
  const built: Record<string, unknown> = { verdict, summary: "Wynik zaseedowany w teście — model nie był wołany." };
  for (const criterion of CRITERIA) {
    // `swallowedError` liczbą przy `gateIntegrity` równym null — para wymagana przez slot 1
    // i legalna na slocie 2 (asercja `=== null` wchodzi tam dopiero po fazie 6).
    built[criterion.key] = criterion.key === "gateIntegrity" ? null : 4;
    built[criterion.noteKey] = `nota zaseedowana: ${criterion.label}`;
  }
  return built as unknown as Review;
}

const seededMetrics = (model: string): ReviewMetrics => ({
  model,
  numTurns: 2,
  durationMs: 1000,
  totalCostUsd: 0.42,
  inputTokens: 10,
  cacheCreationInputTokens: 38365,
  cacheReadInputTokens: 0,
  outputTokens: 6995,
  terminalReason: "completed",
});

test(
  "(B) przejście macierzy 2×2 na zaseedowanym cache'u: pełna tabela, cztery TRAFIENIA, zero wywołań modelu",
  { timeout: 300_000 },
  async () => {
    // ⚑ WŁASNY KATALOG CACHE'U, i to jest wynik pomiaru, nie ostrożność. Cache promptfoo to JEDEN
    // plik `cache.json` obsługiwany przez `KeyvFile` (`getCacheInstance` w pakiecie), który wczytuje
    // całą mapę do pamięci i zapisuje ją w całości. Dwa procesy piszące równolegle KASUJĄ sobie
    // wpisy — zmierzone: ten przypadek jest zielony uruchomiony sam, a czerwony (cztery PUDŁA)
    // w komplecie `npm run test`, gdzie `node --test` biegnie równolegle z `cache.test.ts`, który
    // pisze do tego samego pliku. Rozdzielenie magazynów usuwa wyścig u źródła; `cache.test.ts`
    // zostaje przy magazynie PRAWDZIWYM, bo to on dowodzi klucza produkcyjnego.
    //
    // Konsekwencja WYKRACZAJĄCA poza test i zapisana w `verification.md`: dwa przebiegi evali
    // uruchomione naraz na jednym koncie mogą sobie unieważnić cache. Przebiegi faz 6-7 idą
    // sekwencyjnie, więc ich to nie dotyczy.
    const savedCachePath = process.env["PROMPTFOO_CACHE_PATH"];
    const cacheDir = mkdtempSync(join(tmpdir(), "review-eval-cache-"));
    process.env["PROMPTFOO_CACHE_PATH"] = cacheDir;

    assert.ok(isCacheEnabled(), "cache promptfoo jest wyłączony — ten przypadek nie mierzyłby niczego");
    const promptFingerprint = productionPromptFingerprint();
    const seeded = MATRIX.map((cell) => ({ ...cell, diff: readFileSync(cell.path, "utf8") }));

    for (const cell of seeded) {
      await writeCell(cellCacheKey({ fixture: cell.diff, model: cell.model, promptFingerprint }), {
        review: seededReview(cell.verdict),
        metrics: seededMetrics(cell.model),
      });
    }

    const savedToken = process.env["ANTHROPIC_AUTH_TOKEN"];
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
    try {
      const { exitCode, rows } = runEval([]);
      const report = renderReport(rows, new Date("2026-08-23T00:00:00Z"));

      assert.equal(rows.length, 4, `przejście zwróciło ${rows.length} komórek zamiast czterech:\n${report}`);
      for (const row of rows) {
        assert.equal(row.cached, true, `komórka ${row.model}/${row.fixture} NIE była trafieniem — poszłaby do modelu:\n${report}`);
        assert.equal(row.contract, "ok", `komórka ${row.model}/${row.fixture} wróciła jako ${row.contract}:\n${report}`);
        assert.equal(row.ok, true, `komórka ${row.model}/${row.fixture} czerwona:\n${report}`);
      }
      // Kolumna `[config]` NIE MOŻE się pojawić: klucza nie ma, więc każde pudło cache'u byłoby
      // odmową — jej brak jest dowodem, że model nie został wywołany ani razu.
      assert.ok(!report.includes("[config]"), `w przejściu padła odmowa konfiguracji — czyli było PUDŁO cache'u:\n${report}`);
      assert.equal(exitCode, 0, `promptfoo zwróciło ${exitCode}:\n${report}`);
      assert.ok(report.includes("Wszystkie komórki zielone"), report);
    } finally {
      if (savedToken !== undefined) process.env["ANTHROPIC_AUTH_TOKEN"] = savedToken;
      // Sprzątanie przez USUNIĘCIE katalogu, nie przez `forgetCell`: po przywróceniu zmiennej
      // `forgetCell` celowałoby już w magazyn produkcyjny, czyli kasowałoby cudze wpisy.
      if (savedCachePath === undefined) delete process.env["PROMPTFOO_CACHE_PATH"];
      else process.env["PROMPTFOO_CACHE_PATH"] = savedCachePath;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  },
);

test("(A8) trafienie cache'u NIE jest liczone jako wydatek przejścia", () => {
  // Defekt zauważony na żywym przebiegu fazy 6: pojedyncza „suma przejścia" pokazywała kwotę
  // komórki nad wierszem `TRAFIENIE`, czyli czytała się jak wydatek za przebieg, który nie
  // kosztował nic. Wymaganie 6 („powtórzenie jest darmowe") sprawdza się dokładnie tą liczbą.
  const report = renderReport([{ ...ROW, cached: true }], new Date("2026-08-23T00:00:00Z"));
  assert.ok(report.includes("Koszt komórek: 0.082941"), "koszt komórki zniknął z raportu");
  assert.ok(report.includes("ZAPŁACONE w tym przejściu: 0.000000"), "trafienie zostało policzone jako wydatek");
});

test("(A9) obserwacja miękka jest raportowana OSOBNO i mówi wprost, że nie bramkuje", () => {
  const rows = rowsFromOutputFile({
    results: {
      results: [
        {
          success: true,
          vars: { fixture: "clean-text-change.diff", expectConditionalNull: true },
          provider: { id: "review:anthropic/claude-haiku-4.5", label: "haiku-4.5" },
          response: {
            // Zmierzone wyjście haiku z fazy 6 — oba kryteria warunkowe jako 10 zamiast `null`.
            output: { verdict: "pass", swallowedError: 10, gateIntegrity: 10 },
            metadata: { model: "anthropic/claude-haiku-4.5", verdict: "pass" },
          },
          gradingResult: { pass: true, componentResults: [{ pass: true, reason: "[verdict] ok" }] },
        },
      ],
    },
  });
  const report = renderReport(rows, new Date("2026-08-23T00:00:00Z"));
  assert.equal(rows[0]?.ok, true, "obserwacja miękka NIE MOŻE czerwienić komórki");
  assert.ok(report.includes("Wszystkie komórki zielone"), "twarde przeszły, więc przejście jest zielone");
  assert.ok(report.includes("NIE bramkują zieleni"), "raport nie mówi, że sekcja miękka nie bramkuje");
  assert.ok(report.includes("swallowedError = 10"), "obserwacja nie wypisała, co konkretnie zobaczyła");
});

// ---------------------------------------------------------------------------------------------
// BRAK ZMIERZONY — komórka uruchomiona, wynik nie powstał. Trzy rodzaje pustki, trzy różne zdania.
// ---------------------------------------------------------------------------------------------

/** Kształt, który zwrócił gemini na kontroli negatywnej w fazie 6. */
const ABSENT_ROW: ReportRow = {
  ...ROW,
  model: "google/gemini-2.5-flash",
  fixture: "clean-text-change.diff",
  verdict: "—",
  contract: "[unknown]",
  errorMessage: "[unknown] Review nie powiodło się (subtype: error_max_turns, terminal_reason: max_turns): Reached maximum number of turns (2)",
  turns: undefined,
  inputTokens: undefined,
  outputTokens: undefined,
  cacheWriteTokens: undefined,
  cacheReadTokens: undefined,
  costUsd: null,
  costUnavailableReason: null,
  cached: false,
  assertionsPassed: 0,
  assertionsFailed: 0,
  failedAssertions: [],
  ok: false,
};

test("(A10) brak zmierzony dostaje WŁASNĄ sekcję z klasą awarii i komunikatem", () => {
  const report = renderReport([ROW, ABSENT_ROW], new Date("2026-08-23T00:00:00Z"));
  assert.ok(report.includes("BRAKI ZMIERZONE"), "brak zmierzony nie dostał własnej sekcji");
  assert.ok(report.includes("[unknown]"), "klasa awarii zniknęła z raportu");
  assert.ok(report.includes("maximum number of turns"), "komunikat awarii zniknął z raportu");
  assert.ok(report.includes("To NIE jest luka w pokryciu"), "raport nie mówi, czym ten brak NIE jest");
  assert.ok(
    report.includes("brak wyniku NIE oznacza braku rachunku"),
    "raport pozwala przeczytać brak zmierzony jako komórkę darmową — a ta kosztowała ~0,031 USD",
  );
});

test("(A11) brak zmierzony NIE miesza się z brakiem licznika ani z komórką nieuruchomioną", () => {
  const noCounter: ReportRow = { ...ROW, costUsd: null, costUnavailableReason: "SDK nie podało liczników: outputTokens" };
  const report = renderReport([noCounter, ABSENT_ROW], new Date("2026-08-23T00:00:00Z"));

  // Dwa różne zdania o dwóch różnych dziurach — i oba muszą być w raporcie naraz.
  assert.ok(report.includes("SDK nie podało liczników"), "brak licznika stracił swój powód");
  assert.ok(report.includes("BRAKI ZMIERZONE"), "brak wyniku stracił swoją sekcję");
  assert.ok(report.includes("nie uruchomiono jej wcale"), "raport nie nazywa trzeciego rodzaju pustki");
  // Brak zmierzony NIE może trafić do wiersza „Bez kwoty" — tam mieszkają komórki, które DOJECHAŁY.
  assert.ok(report.includes("Bez kwoty (1)"), `brak licznika policzony źle:
${report}`);
});

test("(A12) brak zmierzony nie wchodzi do mianownika kwot ani do trafień cache'u", () => {
  const report = renderReport([{ ...ROW, cached: true }, ABSENT_ROW], new Date("2026-08-23T00:00:00Z"));
  assert.ok(report.includes("1/1 komórek ZMIERZONYCH"), `mianownik liczy komórkę, która nie dojechała:
${report}`);
  assert.ok(report.includes("trafienia cache'u: 1/1"), "trafienia liczone wobec komórek nieistniejących");
  assert.ok(report.includes("BRAKÓW ZMIERZONYCH 1"), "raport nie mówi, ile komórek nie dojechało");
});

test("(A13) w tabeli wiersz bez wyniku ma `BRAK`, a nie ten sam znak co brakujący licznik", () => {
  const report = renderReport([ABSENT_ROW], new Date("2026-08-23T00:00:00Z"));
  const row = report.split("\n").find((line) => line.includes("gemini-2.5-flash"));
  assert.ok(row, "wiersz zniknął z tabeli");
  assert.ok(row.includes("BRAK"), `wiersz bez wyniku nie jest oznaczony jako BRAK: ${row}`);
  assert.ok(!row.includes("—"), `wiersz bez wyniku używa znaku zarezerwowanego dla braku licznika: ${row}`);
});
