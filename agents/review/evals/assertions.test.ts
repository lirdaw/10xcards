// Kontrola pozytywna asercji — dowód, że NOWY zestaw asercji umie zaświecić na czerwono.
//
// Bez niego powtarzamy błąd o poziom wyżej: wymieniamy bramkę, której nie da się zaświecić
// (`is-json` na wyjściu obiektowym, „komplet 20 pól” po `safeParse`), na bramkę, o której nie
// wiadomo, czy da się zaświecić. To, że asercja brzmi mocniej, nie jest dowodem — a dowód jest tu
// darmowy i offline: test operuje na OBIEKCIE, nie na przebiegu. Zero wywołań modelu, zero kosztu.
//
// Warunek, który czyni to kontrolą, a nie zbiorem czerwieni: każda mutacja czerwieni SWOJĄ asercję
// i TYLKO ją. Gdyby jedna mutacja wywaliła dwie, znaczyłoby to, że jedna z nich pilnuje czegoś
// innego, niż deklaruje — i to jest wynik do zapisania, nie do obejścia.
//
// Runner: `node:test` pod gołym `node --experimental-strip-types`, jak reszta pakietu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CRITERIA, SCORE_MAX, SCORE_MIN, type Review } from "../review-schema.ts";
import {
  HARD_ASSERTIONS,
  type CellExpectation,
  type CellUnderTest,
  type OutcomeStatus,
} from "./assertions.ts";

/**
 * Zestawy ocen ZAPISANE w `measurement-cheap-models.md` (Pomiar II, linia bazowa `0d3eba5`),
 * w kolejności z `criteria.json`. Trzy modele, ta sama fikstura `sample.diff`, wszystkie trzy
 * z `verdict: fail`, `swallowedError` liczbą i `gateIntegrity` równym `null`.
 *
 * ⚑ Pomiar zapisał OCENY i werdykt, nie treść uzasadnień (poza jedną zacytowaną notą gemini).
 * Uzasadnienia poniżej są więc odtworzone jako niepuste teksty — i to jest wszystko, czego
 * dotyczy asercja `notes-non-empty`; żadna asercja twarda nie czyta ich TREŚCI. Gdyby kiedyś
 * zaczęła, ten obiekt przestałby być materiałem z pomiaru i trzeba by go pomierzyć od nowa.
 */
const MEASURED_SCORES: ReadonlyArray<{ readonly model: string; readonly scores: ReadonlyArray<number | null> }> = [
  { model: "google/gemini-2.5-flash", scores: [1, 1, 3, 1, 1, 1, 1, null, 9] },
  { model: "anthropic/claude-haiku-4.5", scores: [1, 2, 2, 1, 1, 1, 2, null, 3] },
  { model: "anthropic/claude-sonnet-4.6", scores: [1, 1, 7, 1, 1, 1, 1, null, 8] },
];

/** Fikstura slotu 1 oczekuje `fail`; slot 2 (kontrola negatywna) — `pass`. */
const SAMPLE_DIFF: CellExpectation = { verdict: "fail" };
const CLEAN_TEXT: CellExpectation = { verdict: "pass" };

function reviewFrom(scores: ReadonlyArray<number | null>, verdict: Review["verdict"]): Review {
  assert.equal(scores.length, CRITERIA.length, "zestaw ocen ma inną długość niż lista kryteriów");
  const built: Record<string, unknown> = { verdict, summary: "Podsumowanie z przebiegu Pomiaru II." };
  CRITERIA.forEach((criterion, index) => {
    built[criterion.key] = scores[index];
    built[criterion.noteKey] = `nota odtworzona: ${criterion.label}`;
  });
  return built as unknown as Review;
}

/** Kanoniczny obiekt kontroli NEGATYWNEJ zestawu: poprawny, na nim wszystko ma być zielone. */
const FROZEN: Review = reviewFrom(MEASURED_SCORES[1]!.scores, "fail");

const cellOf = (review: Review): CellUnderTest => ({ output: review });

/** Mutacja JEDNEGO pola. Kopia płytka wystarcza — `Review` jest płaski z założenia. */
function mutate(review: Review, patch: Record<string, unknown>): Review {
  return { ...(review as unknown as Record<string, unknown>), ...patch } as unknown as Review;
}

/** Wynik przepuszczenia komórki przez KOMPLET asercji stosujących się do danej fikstury. */
function runAll(cell: CellUnderTest, expectation: CellExpectation, sampleDiff: boolean): Map<string, OutcomeStatus> {
  const statuses = new Map<string, OutcomeStatus>();
  for (const assertion of HARD_ASSERTIONS) {
    if (assertion.sampleDiffOnly && !sampleDiff) continue;
    statuses.set(assertion.id, assertion.run(cell, expectation).status);
  }
  return statuses;
}

/**
 * Jedyne orakl tego pliku: dokładnie JEDNA asercja czerwona, i jest nią ta wskazana.
 *
 * `expectSkipped` wymienia asercje, które przy tej mutacji nie mają czego sprawdzić. Wypisujemy je
 * JAWNIE, zamiast dopuszczać „pass albo skip” — inaczej test przechodziłby także wtedy, gdyby
 * asercja po cichu przestała cokolwiek widzieć.
 */
function assertOnlyOneRed(
  statuses: Map<string, OutcomeStatus>,
  expectedRed: string,
  expectSkipped: readonly string[] = [],
): void {
  const red = [...statuses.entries()].filter(([, status]) => status === "fail").map(([id]) => id);
  assert.deepEqual(red, [expectedRed], `czerwone asercje: ${red.join(", ") || "(żadna)"} — oczekiwano wyłącznie ${expectedRed}`);
  for (const [id, status] of statuses) {
    if (id === expectedRed) continue;
    const shouldSkip = expectSkipped.includes(id);
    assert.equal(status, shouldSkip ? "skip" : "pass", `asercja ${id} ma status ${status}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Kontrola negatywna zestawu — trzy ZMIERZONE zestawy ocen muszą przechodzić wszystkie asercje.
// ---------------------------------------------------------------------------------------------

for (const { model, scores } of MEASURED_SCORES) {
  test(`zapisany zestaw ocen z Pomiaru II (${model}) przechodzi wszystkie asercje twarde`, () => {
    const statuses = runAll(cellOf(reviewFrom(scores, "fail")), SAMPLE_DIFF, true);
    assert.equal(statuses.size, HARD_ASSERTIONS.length, "nie wszystkie asercje zostały wykonane");
    for (const [id, status] of statuses) {
      assert.equal(status, "pass", `asercja ${id} nie przeszła na zapisanym wyjściu modelu ${model}`);
    }
  });
}

test("kontrola negatywna (slot 2): obiekt z verdict `pass` przechodzi asercje wspólne", () => {
  // Materiał SYNTETYCZNY — kontrola negatywna nie jest jeszcze zmierzona (to robi faza 6). Ten
  // przypadek dowodzi wyłącznie, że asercja werdyktu czyta oczekiwanie z fikstury, a nie ze stałej.
  const statuses = runAll(cellOf(reviewFrom([8, 8, 9, 7, 8, 9, null, null, 10], "pass")), CLEAN_TEXT, false);
  assert.equal(statuses.size, HARD_ASSERTIONS.length - 1, "asercja slotu 1 nie może się wykonać na slocie 2");
  for (const [id, status] of statuses) {
    assert.equal(status, "pass", `asercja ${id} nie przeszła na kontroli negatywnej`);
  }
});

// ---------------------------------------------------------------------------------------------
// Kontrola POZYTYWNA — jedna mutacja na asercję, każda zmienia DOKŁADNIE JEDNO pole.
// ---------------------------------------------------------------------------------------------

test("mutacja: verdict odwrócony → czerwienieje wyłącznie asercja werdyktu", () => {
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { verdict: "pass" })), SAMPLE_DIFF, true), "verdict");
});

test(`mutacja: ocena ${SCORE_MAX + 32} (poza górną granicą) → czerwienieje wyłącznie asercja zakresu`, () => {
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { complexity: 42 })), SAMPLE_DIFF, true), "score-range");
});

test(`mutacja: ocena ${SCORE_MIN - 1} (poza dolną granicą) → czerwienieje wyłącznie asercja zakresu`, () => {
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { complexity: 0 })), SAMPLE_DIFF, true), "score-range");
});

test("mutacja: scopeDiscipline = null → czerwienieje wyłącznie asercja kryterium 9", () => {
  // Ta mutacja pokazuje też, dlaczego asercja zakresu POMIJA `null`: gdyby go nie pomijała,
  // jedno pole czerwieniłoby dwie asercje i żadna z nich nie mówiłaby, o co naprawdę chodzi.
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { scopeDiscipline: null })), SAMPLE_DIFF, true), "scope-discipline-scored");
});

test("mutacja: uzasadnienie z samych spacji → czerwienieje wyłącznie asercja uzasadnień", () => {
  // Wartość `"   "`, a nie `""` — pilnujemy `trim()`, a nie samej obecności pola. Puste pole
  // złapałby już `safeParse`; trzy spacje nie.
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { implementationCorrectnessNote: "   " })), SAMPLE_DIFF, true), "notes-non-empty");
});

test("mutacja: gateIntegrity liczbą przy swallowedError liczbą → czerwienieje wyłącznie asercja pary", () => {
  // Mutacja ODWROTNA do naprawy `0d3eba5`: model wystawia ocenę tam, gdzie materiału nie ma.
  // Wartość 7 jest legalna w skali, więc asercja zakresu jej nie widzi — czerwień należy do pary.
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { gateIntegrity: 7 })), SAMPLE_DIFF, true), "swallowed-error-pair");
});

test("mutacja: odpowiedź z `error` zamiast obiektu → czerwienieje wyłącznie asercja błędu, reszta POMIJA", () => {
  // Kształt, który provider zwraca po złapaniu rzutu z `runReview` (faza 4 §2).
  const cell: CellUnderTest = { error: "[contract] wyjście modelu nie przeszło walidacji schematem" };
  assertOnlyOneRed(runAll(cell, SAMPLE_DIFF, true), "no-provider-error", [
    "verdict",
    "score-range",
    "scope-discipline-scored",
    "notes-non-empty",
    "swallowed-error-pair",
  ]);
});

test("mutacja: swallowedError = null przy istniejącym materiale → czerwienieje wyłącznie asercja pary", () => {
  // Druga połowa tej samej pary i druga strona `0d3eba5`: `null` tam, gdzie materiał JEST.
  assertOnlyOneRed(runAll(cellOf(mutate(FROZEN, { swallowedError: null })), SAMPLE_DIFF, true), "swallowed-error-pair");
});
