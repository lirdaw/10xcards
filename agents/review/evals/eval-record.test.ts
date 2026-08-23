// Dowód przejścia macierzy: kształt, serializacja i trzy odmowy zapisu.
//
// Dwie połowy, i druga jest tą, która nadaje pierwszej sens:
//
//   (A) round-trip i zachowanie CUDZEGO bloku — dwaj zapisywacze piszą do jednego pliku, więc
//       każdy z nich musi przenieść blok drugiego nietknięty. Bez tego druga komenda kasowałaby
//       pracę pierwszej i widać by to było dopiero na CI, jako czerwień o cudzej osi.
//   (B) odmowy `--record` — dowód zapisany z przebiegu ZAWĘŻONEGO albo z pliku (`--from`) jest
//       zgodny z odciskiem i nic nie znaczy. Zgodny i pusty jest gorszy niż żaden: zapadka
//       świeci wtedy na zielono nad pomiarem, którego nie było.
//
// Odmowy testujemy na CZYSTYCH funkcjach (`recordArgsRefusal`, `recordRowsRefusal`), a nie przez
// uruchomienie CLI — bo pierwsza z nich ma paść PRZED przejściem, a przejście kosztuje.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANDATORY_NOTES,
  NOTES_KEYS,
  RECORD_KEYS,
  buildRecord,
  cellFromRow,
  checkRecord,
  serializeRecord,
  type RecordSourceRow,
} from "./eval-record.ts";
import { narrowingArgs, recordArgsRefusal, recordRowsRefusal, splitArgs, type ReportRow } from "./report.ts";

const FINGERPRINT = "a".repeat(64);
const OTHER_FINGERPRINT = "b".repeat(64);
const NOW = new Date("2026-08-23T12:00:00.000Z");

/** Wiersz przejścia w kształcie, w jakim oddaje go `rowsFromOutputFile`. */
function row(overrides: Partial<RecordSourceRow> = {}): RecordSourceRow {
  return {
    model: "anthropic/claude-haiku-4.5",
    fixture: "sample.diff",
    verdict: "fail",
    contract: "ok",
    errorMessage: null,
    turns: 2,
    inputTokens: 10,
    outputTokens: 6995,
    costUsd: 0.082941,
    durationMs: 41_233,
    cached: false,
    failedAssertions: [],
    ok: true,
    softObservations: [
      { id: "conditional-null-contract", outcome: { status: "pass", reason: "kryteria warunkowe są null" } },
    ],
    ...overrides,
  };
}

/** Pełna, realistyczna macierz 2×2 — ta sama, na której mierzy się prettier-czystość. */
const MATRIX_ROWS: RecordSourceRow[] = [
  row(),
  row({ fixture: "clean-text-change.diff", verdict: "pass" }),
  row({ model: "google/gemini-2.5-flash", costUsd: 0.001234, durationMs: 22_101 }),
  row({
    model: "google/gemini-2.5-flash",
    fixture: "clean-text-change.diff",
    verdict: "pass",
    costUsd: 0.000987,
    durationMs: 19_540,
  }),
];

// ---------------------------------------------------------------------------------------------
// (A) Kształt, serializacja, cudzy blok.
// ---------------------------------------------------------------------------------------------

test("(A1) round-trip: obiekt przeżywa serializację, a bajty przeżywają odczyt", () => {
  const record = buildRecord({ rows: MATRIX_ROWS, existing: undefined, callFingerprint: FINGERPRINT, now: NOW });
  const raw = serializeRecord(record);

  assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(record)));
  assert.equal(serializeRecord(JSON.parse(raw)), raw, "ponowna serializacja odczytanego pliku dała inne bajty");
  assert.ok(raw.endsWith("\n"), "plik nie kończy się znakiem nowej linii — prettier dopisze go przy pierwszym commicie");
});

test("(A2) klucze wychodzą w kolejności RECORD_KEYS, niezależnie od kolejności w pliku zastanym", () => {
  const scrambled = {
    matrix: [],
    callFingerprint: OTHER_FINGERPRINT,
    verdictConfig: { threshold: 5 },
    generatedAt: "2020-01-01T00:00:00.000Z",
    notes: MANDATORY_NOTES,
  };
  const record = buildRecord({ rows: MATRIX_ROWS, existing: scrambled, callFingerprint: FINGERPRINT, now: NOW });

  assert.deepEqual(Object.keys(record), [...RECORD_KEYS]);
});

test("(A3) zapisywacz agencki przenosi CUDZY blok verdictConfig co do wartości", () => {
  const verdictConfig = { threshold: 5, scoreMin: 1, scoreMax: 10, assertionsDigest: "c".repeat(64) };
  const record = buildRecord({
    rows: MATRIX_ROWS,
    existing: { notes: MANDATORY_NOTES, verdictConfig, callFingerprint: OTHER_FINGERPRINT, matrix: [] },
    callFingerprint: FINGERPRINT,
    now: NOW,
  });

  assert.deepEqual(record["verdictConfig"], verdictConfig, "cudzy blok został zmieniony przez zapisywacza agenckiego");
  assert.equal(record["callFingerprint"], FINGERPRINT, "własny odcisk nie został odświeżony");
});

test("(A4) świeży plik nie niesie klucza verdictConfig zamiast niosącego null", () => {
  const record = buildRecord({ rows: MATRIX_ROWS, existing: undefined, callFingerprint: FINGERPRINT, now: NOW });
  const parsed: unknown = JSON.parse(serializeRecord(record));

  assert.ok(parsed !== null && typeof parsed === "object");
  assert.equal(
    Object.hasOwn(parsed as object, "verdictConfig"),
    false,
    "pusty blok verdictConfig wyglądałby jak zapisany, a nie jak niezapisany",
  );
});

test("(A5) adnotacja jest obowiązkowa: brakująca powstaje, zastana zostaje", () => {
  const fresh = buildRecord({ rows: MATRIX_ROWS, existing: {}, callFingerprint: FINGERPRINT, now: NOW });
  assert.deepEqual(fresh["notes"], MANDATORY_NOTES);
  for (const key of NOTES_KEYS) {
    assert.ok(MANDATORY_NOTES[key].length > 0, `adnotacja \`notes.${key}\` jest pusta`);
  }

  const extended = { ...MANDATORY_NOTES, scope: "rozszerzone ręcznie" };
  const kept = buildRecord({
    rows: MATRIX_ROWS,
    existing: { notes: extended },
    callFingerprint: FINGERPRINT,
    now: NOW,
  });
  assert.deepEqual(kept["notes"], extended, "ręczne rozszerzenie adnotacji zostało skasowane przez zapis");
});

test("(A6) klucze nieznane temu modułowi przeżywają zapis", () => {
  const record = buildRecord({
    rows: MATRIX_ROWS,
    existing: { somethingNew: { kept: true } },
    callFingerprint: FINGERPRINT,
    now: NOW,
  });

  assert.deepEqual(record["somethingNew"], { kept: true });
});

test("(A7) komórka niesie powód czerwieni także wtedy, gdy asercje nie zdążyły się wykonać", () => {
  const cell = cellFromRow(row({ ok: false, contract: "[provider]", errorMessage: "SDK padło", failedAssertions: [] }));

  assert.deepEqual(cell.failures, [{ reason: "SDK padło" }]);
});

test("(A8) `undefined` z metryk staje się `null`, bo JSON.stringify kasuje klucz", () => {
  const cell = cellFromRow(row({ turns: undefined, inputTokens: undefined, durationMs: undefined }));
  const parsed = JSON.parse(serializeRecord(cell)) as Record<string, unknown>;

  assert.equal(parsed["turns"], null);
  assert.equal(parsed["inputTokens"], null);
  assert.equal(parsed["durationMs"], null);
});

test("(A9) `ReportRow` jest przypisywalny do `RecordSourceRow` — kontrakt strukturalny trzyma", () => {
  const reportRow: ReportRow = {
    model: "anthropic/claude-haiku-4.5",
    fixture: "sample.diff",
    verdict: "fail",
    contract: "ok",
    errorMessage: null,
    turns: 2,
    inputTokens: 10,
    outputTokens: 6995,
    cacheWriteTokens: 38_365,
    cacheReadTokens: 0,
    costUsd: 0.082941,
    costUnavailableReason: null,
    durationMs: 41_233,
    cached: false,
    assertionsPassed: 6,
    assertionsFailed: 0,
    failedAssertions: [],
    ok: true,
    softObservations: [],
  };
  const source: RecordSourceRow = reportRow;

  assert.equal(cellFromRow(source).model, "anthropic/claude-haiku-4.5");
});

test("(A10) dowód zbudowany z pełnej macierzy przechodzi własnego checkera", () => {
  const record = buildRecord({ rows: MATRIX_ROWS, existing: undefined, callFingerprint: FINGERPRINT, now: NOW });
  const raw = serializeRecord(record);

  assert.deepEqual(checkRecord({ raw, record: JSON.parse(raw), liveFingerprint: FINGERPRINT }), []);
});

// ---------------------------------------------------------------------------------------------
// (B) Trzy odmowy `--record`.
// ---------------------------------------------------------------------------------------------

test("(B1) `--record` jest KONSUMOWANY i nie dojeżdża do promptfoo jako nieznana opcja", () => {
  const parsed = splitArgs(["--record", "--verbose"]);

  assert.equal(parsed.record, true);
  assert.deepEqual([...parsed.rest], ["--verbose"], "flaga została w reszcie argumentów przekazywanej promptfoo");
});

test("(B2) odmowa: `--record` razem z `--from`", () => {
  const refusal = recordArgsRefusal(splitArgs(["--record", "--from", "wynik.json"]));

  assert.ok(refusal !== undefined, "para --record --from została przepuszczona");
  assert.match(refusal, /ODMOWA/);
  assert.match(refusal, /ŻYWO/, "odmowa nie mówi, DLACZEGO ta para produkuje dowód zgodny i pusty");
});

test("(B3) odmowa: przebieg zawężony filtrem", () => {
  assert.deepEqual(narrowingArgs(["--verbose", "--filter-first-n", "1"]), ["--filter-first-n"]);

  const refusal = recordArgsRefusal(splitArgs(["--record", "--filter-providers", "haiku"]));

  assert.ok(refusal !== undefined, "zawężony przebieg został przepuszczony do zapisu");
  assert.match(refusal, /--filter-providers/, "odmowa nie nazywa argumentu, który ją wywołał");
});

test("(B4) odmowa: przejście zwróciło zero wierszy", () => {
  const refusal = recordRowsRefusal([]);

  assert.ok(refusal !== undefined, "pusty przebieg został zapisany jako dowód");
  assert.match(refusal, /ZERO wierszy/);
});

test("(B5) bez `--record` żadna z odmów nie obowiązuje — zwykły przebieg zostaje zwykłym", () => {
  assert.equal(recordArgsRefusal(splitArgs(["--from", "wynik.json"])), undefined);
  assert.equal(recordArgsRefusal(splitArgs(["--filter-first-n", "1"])), undefined);
});
