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
  observationsFor,
  serializeRecord,
  type EvalRecord,
  type EvalRecordCell,
  type EvalRecordProblem,
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
    subtype: "success",
    terminalReason: "completed",
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

  // ⚑ Pin LITERAŁEM, obok pinu przez stałą, i to nie jest powtórzenie tej samej asercji.
  // `RECORD_KEYS` jest współdzielone przez kod i ten test, więc samo porównanie z nim przechodzi
  // także wtedy, gdy ktoś zmieni listę — a druga kopia tej kolejności żyje po drugiej stronie
  // granicy kierunkowej, w `scripts/verdict-config.ts`, i o zmianie się nie dowie. Literał tutaj
  // zmusza do świadomego dotknięcia OBU miejsc. Bliźniaczy pin: tests/lib/verdict-config.test.ts.
  assert.deepEqual(
    [...RECORD_KEYS],
    ["notes", "generatedAt", "callFingerprint", "verdictConfig", "previousDelivery", "matrix"],
    "kolejność kluczy zmieniła się TUTAJ — druga kopia listy jest w scripts/verdict-config.ts i musi dostać to samo",
  );
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
    subtype: "success",
    terminalReason: "completed",
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

// ---------------------------------------------------------------------------------------------
// (D) Rozdzielenie przyczyn: (A) model nie dowiózł vs (B) prompt zregresował — decyzja D-6.
//
// Każdy przypadek jest DWUSTRONNY: mutacja ma zaczerwienić DOKŁADNIE swój przypadek i tylko jego.
// Wzorzec `blindTo` z `cache.test.ts:92-104`.
// ---------------------------------------------------------------------------------------------

/** Komórka rekordu w kształcie po zapisie — punkt wyjścia mutacji. */
function cell(overrides: Partial<EvalRecordCell> = {}): EvalRecordCell {
  return { ...cellFromRow(row()), ...overrides };
}

/** Rekord z podanymi komórkami, gotowy do `checkRecord` (macierz 2x2, żeby nie czerwienić na kompletności). */
function recordWith(cells: readonly EvalRecordCell[], extra: Record<string, unknown> = {}): { raw: string; parsed: unknown } {
  const built = {
    notes: MANDATORY_NOTES,
    generatedAt: NOW.toISOString(),
    callFingerprint: FINGERPRINT,
    ...extra,
    matrix: cells,
  };
  const raw = serializeRecord(built);
  return { raw, parsed: JSON.parse(raw) };
}

const FOUR_CELLS: readonly EvalRecordCell[] = [
  cell({ model: "m1", fixture: "f1" }),
  cell({ model: "m1", fixture: "f2" }),
  cell({ model: "m2", fixture: "f1" }),
  cell({ model: "m2", fixture: "f2" }),
];

function problemsOf(cells: readonly EvalRecordCell[], extra: Record<string, unknown> = {}): EvalRecordProblem[] {
  const { raw, parsed } = recordWith(cells, extra);
  return checkRecord({ raw, record: parsed, liveFingerprint: FINGERPRINT });
}

/** Podmiana JEDNEJ komórki macierzy — reszta zostaje zielona, więc czerwień ma jednego autora. */
function withCell(patch: Partial<EvalRecordCell>): EvalRecordCell[] {
  return [{ ...FOUR_CELLS[0]!, ...patch }, FOUR_CELLS[1]!, FOUR_CELLS[2]!, FOUR_CELLS[3]!];
}

test("(D1) kontrola zerowa: cztery komórki dowiezione i zielone nie dają ŻADNEGO problemu", () => {
  assert.deepEqual(problemsOf(FOUR_CELLS), []);
});

test("(D2) (A) NAZWANY podtyp `error_max_turns` NIE czerwieni — to stan kwalifikacji modelu", () => {
  const problems = problemsOf(
    withCell({ ok: false, contract: "[unknown]", subtype: "error_max_turns", terminalReason: "max_turns" }),
  );
  assert.deepEqual(
    problems,
    [],
    "albo klasa (A) czerwieni, choć nie powinna, albo przestała być rozpoznawana po nazwanym podtypie",
  );
});

test("(D3) (A) rozpoznawana też po samym `terminalReason` — dwa pola opisują ten sam moment", () => {
  const problems = problemsOf(
    withCell({ ok: false, contract: "[unknown]", subtype: null, terminalReason: "structured_output_retry_exhausted" }),
  );
  assert.deepEqual(problems, [], "czytamy OBA pola, nie jedno — inaczej brak `subtype` wywraca rozpoznanie");
});

test("(D4) ⚑ `[unknown]` BEZ nazwanego podtypu CZERWIENI — kosz na niewiadome nie jest przepustką", () => {
  // To jest test na FAIL-CLOSED i on jest powodem, dla którego lista (A) jest wymieniona z imienia.
  // Gdyby (A) brzmiało „wszystko, co nie jest (B)", ten przypadek przeszedłby na zielono — i tą
  // samą drogą przeszłaby kiedyś awaria WYWOŁANA promptem.
  const problems = problemsOf(withCell({ ok: false, contract: "[unknown]", subtype: "error_nowy_podtyp_sdk", terminalReason: null }));

  assert.equal(problems.length, 1, "albo kosz nie czerwieni, albo czerwieni cudzy przypadek");
  assert.equal(problems[0]!.kind, "cellUnclassified");
  assert.match(problems[0]!.detail, /error_nowy_podtyp_sdk/, "komunikat ma nieść SUROWY podtyp, nie samą klasę");
});

test("(D5) (B) `contract: ok` z `ok: false` czerwieni jako regresja, nie jako niedowiezienie", () => {
  const problems = problemsOf(withCell({ ok: false, contract: "ok" }));

  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.kind, "cellRed");
});

test("(D6) ⚑ `[contract]` czerwieni jako (B), NIE jako niedowiezienie — odpowiedź PRZYSZŁA", () => {
  // Model odpowiedział i złamał wymuszony schemat. To jest sygnał o PROMPCIE — dokładnie klasa,
  // którą naprawiał `0d3eba5`. Wrzucona do (A) byłaby połknięciem regresji.
  const problems = problemsOf(
    withCell({ ok: false, contract: "[contract]", subtype: "success", terminalReason: "completed" }),
  );

  assert.equal(problems.length, 1, "albo `[contract]` nie czerwieni, albo czerwieni jako cudza klasa");
  assert.equal(problems[0]!.kind, "cellRed");
});

test("(D7) `[config]` czerwieni WŁASNĄ klasą — „nie odbyło się” to nie „nie umiemy nazwać”", () => {
  const problems = problemsOf(withCell({ ok: false, contract: "[config]", subtype: null, terminalReason: null }));

  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.kind, "cellNotRun", "diagnoza wskazująca nie tę przyczynę jest tu całym defektem");
});

test("(D8) obserwacje (A) trafiają do OSOBNEGO kanału, a komórka nierozpoznana NIE trafia tam wcale", () => {
  const cells = [
    { ...FOUR_CELLS[0]!, ok: false, contract: "[unknown]", subtype: "error_max_turns", terminalReason: "max_turns" },
    { ...FOUR_CELLS[1]!, ok: false, contract: "[unknown]", subtype: "error_nieznany", terminalReason: null },
    FOUR_CELLS[2]!,
    FOUR_CELLS[3]!,
  ];
  const { parsed } = recordWith(cells);
  const observations = observationsFor(parsed as EvalRecord);

  assert.equal(observations.length, 1, "obserwacje to NIE „reszta po odfiltrowaniu problemów”");
  assert.match(observations[0]!.title, /Model nie dowiózł/);
  assert.match(observations[0]!.detail, /KWALIFIKACJI MODELU/);
});

// ---------------------------------------------------------------------------------------------
// (E) D-9: przejście „dowiózł → nie dowiózł" pod NOWYM odciskiem.
// ---------------------------------------------------------------------------------------------

const PREVIOUS_DELIVERED = {
  fingerprint: OTHER_FINGERPRINT,
  cells: [
    { model: "m1", fixture: "f1", delivered: true },
    { model: "m1", fixture: "f2", delivered: true },
    { model: "m2", fixture: "f1", delivered: true },
    { model: "m2", fixture: "f2", delivered: true },
  ],
};

test("(E1) ⚑ komórka, która PRZESTAŁA dowozić pod ZMIENIONYM odciskiem, czerwieni", () => {
  // Bez tej reguły klasa (A) połknęłaby regresję: zmiana promptu wpychająca model w pętlę kończy
  // się `max_turns`, czyli objawem nieodróżnialnym od niedowiezienia.
  const problems = problemsOf(
    withCell({ ok: false, contract: "[unknown]", subtype: "error_max_turns", terminalReason: "max_turns" }),
    { previousDelivery: PREVIOUS_DELIVERED },
  );

  assert.equal(problems.length, 1, "albo przejście nie czerwieni, albo czerwieni komórkę, która się nie zmieniła");
  assert.equal(problems[0]!.kind, "deliveryRegression");
  assert.match(problems[0]!.detail, /m1 \/ f1/);
});

test("(E2) to samo przejście pod TYM SAMYM odciskiem NIE czerwieni — to niestabilność modelu", () => {
  const problems = problemsOf(
    withCell({ ok: false, contract: "[unknown]", subtype: "error_max_turns", terminalReason: "max_turns" }),
    { previousDelivery: { ...PREVIOUS_DELIVERED, fingerprint: FINGERPRINT } },
  );

  assert.deepEqual(problems, [], "reguła D-9 ma się opierać na RÓŻNICY odcisków, a nie na samym przejściu");
});

test("(E3) komórka, która NIE dowoziła też poprzednio, nie czerwieni — nie da się zregresować z zera", () => {
  const problems = problemsOf(
    withCell({ ok: false, contract: "[unknown]", subtype: "error_max_turns", terminalReason: "max_turns" }),
    {
      previousDelivery: {
        ...PREVIOUS_DELIVERED,
        cells: [{ model: "m1", fixture: "f1", delivered: false }, ...PREVIOUS_DELIVERED.cells.slice(1)],
      },
    },
  );

  assert.deepEqual(problems, [], "to jest NAZWANA ślepota linii bazowej, a nie przeoczenie");
});

test("(E4) brak bloku `previousDelivery` nie czerwieni niczego — reguła jest wtedy bezczynna", () => {
  const problems = problemsOf(
    withCell({ ok: false, contract: "[unknown]", subtype: "error_max_turns", terminalReason: "max_turns" }),
  );
  assert.deepEqual(problems, []);
});

test("(E5) `buildRecord` PRZENOSI klasyfikację zastępowanego rekordu razem z jego odciskiem", () => {
  const existing = {
    notes: MANDATORY_NOTES,
    generatedAt: NOW.toISOString(),
    callFingerprint: OTHER_FINGERPRINT,
    matrix: [cell({ model: "m1", fixture: "f1" })],
  };
  const built = buildRecord({ rows: [row()], existing, callFingerprint: FINGERPRINT, now: NOW });
  const previous = built["previousDelivery"] as { fingerprint: string; cells: { delivered: boolean | null }[] };

  assert.equal(previous.fingerprint, OTHER_FINGERPRINT, "odcisk POPRZEDNI, nie dzisiejszy — inaczej reguła nigdy nie odpali");
  assert.deepEqual(previous.cells, [{ model: "m1", fixture: "f1", delivered: true }]);
});

test("(E6) pierwszy zapis (brak pliku) nie wymyśla bloku `previousDelivery`", () => {
  const built = buildRecord({ rows: [row()], existing: undefined, callFingerprint: FINGERPRINT, now: NOW });
  assert.equal(built["previousDelivery"], undefined, "pusty blok byłby twierdzeniem o przeszłości, której nie było");
});
