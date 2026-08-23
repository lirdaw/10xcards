import type { AssertionValueFunctionContext, GradingResult } from "promptfoo";
import { CRITERIA, SCORE_MAX, SCORE_MIN, type Review } from "../review-schema.ts";

/**
 * Asercje TWARDE zestawu — te, które decydują o zieleni komórki.
 *
 * Wszystkie są `javascript` nad `context.providerResponse`, czyli deterministyczne i DARMOWE.
 * `llm-rubric` nie występuje tu w ogóle i jest to decyzja podjęta, nie odłożona: agent zwraca
 * structured output, więc „czy złapał klasę błędu” jest pytaniem o pole, nie o styl — a do tego
 * promptfoo nie raportuje kwoty sędziego w ogóle (`GradingResult` niesie `tokensUsed`, nie `cost`),
 * więc każde wywołanie rubryki byłoby wydatkiem POZA raportowanym budżetem.
 *
 * ⛑ A gdyby ktoś tę decyzję kiedyś cofnął — CZYTAJ TO NAJPIERW. `runReview` przestawia trzy zmienne
 * `ANTHROPIC_*` na GLOBALNYM `process.env` (`run-review.ts`, tuż przed `query`), i to jest słuszne:
 * jeden egzemplarz prekondycji jest jedynym sposobem, żeby CI i eval nie rozjechały się po cichu
 * na endpoincie i precedencji poświadczeń. Ale w evalu ta funkcja biega WEWNĄTRZ procesu promptfoo,
 * więc mutuje środowisko CAŁEGO przebiegu — dziś nieszkodliwie, bo nic innego w tym procesie do
 * modelu nie dzwoni. Sędzia oparty o Anthropica dodany do tej konfiguracji pojechałby na
 * `ANTHROPIC_API_KEY=""` i na `ANTHROPIC_BASE_URL` OpenRoutera, a jego awaria wyglądałaby na problem
 * z uprawnieniami sekretu, nie na skutek uboczny naszego providera. Kto dokłada gradera, dokłada
 * też jego izolację od tych trzech zmiennych — albo mierzy, że jej nie potrzebuje.
 *
 * ⚑ DWIE ASERCJE, KTÓRE SAME SIĘ PROSZĄ, ZOSTAŁY ŚWIADOMIE POMINIĘTE, bo są TAUTOLOGIAMI:
 * „komplet 20 pól kontraktu” i „kryteria warunkowe są typu `number | null`”. `runReview` oddaje
 * wynik WYŁĄCZNIE po udanym `REVIEW_SCHEMA.safeParse`, a schemat wymaga wszystkich 20 pól — zero
 * `.optional()` i zero `.passthrough()` w `review-schema.ts`. Asercja na nich nie potrafi zaświecić
 * na czerwono dla ŻADNEJ wartości, jaką provider jest w stanie zwrócić, a bramka, która nie potrafi
 * zaświecić na czerwono, jest gorsza niż jej brak, bo zdejmuje czujność. Ta sama pułapka co
 * `is-json` na wyjściu obiektowym (obiekt jest wcześniej serializowany, więc `is-json` przechodzi
 * zawsze) — dlatego kontrakt sprawdzamy asercją `javascript`, nie typem wbudowanym.
 *
 * Każda asercja niżej pilnuje czegoś, czego `safeParse` NIE gwarantuje. To jest jedyne kryterium
 * przyjęcia do tego pliku.
 */

/** Oceny miękkie (konkretne wartości) NIE są tu asercjami — idą do tabeli w `report.ts`. */

/**
 * Trzeci stan obok „przeszło” i „nie przeszło”: asercja NIE MIAŁA CZEGO SPRAWDZIĆ.
 *
 * Istnieje po to, żeby wynik „komórka wróciła z `error`, więc nie ma recenzji” nie chował się pod
 * zielenią pozostałych pięciu asercji. Bez niego jedna awaria czerwieniłaby wszystkie sześć naraz
 * i kontrola pozytywna z `assertions.test.ts` („mutacja czerwieni SWOJĄ asercję i tylko ją”)
 * przestałaby cokolwiek rozróżniać — a to ona jest tu dowodem, że asercje mierzą to, co deklarują.
 *
 * Odwzorowuje przy tym RZECZYWISTE zachowanie promptfoo, zmierzone w źródle ewaluatora
 * (`applyRunEvalResponseOutcome`): przy `response.error` ustawia `success: false` i **wraca przed
 * `runAssertions`**, więc w prawdziwym przebiegu pozostałe asercje faktycznie się nie wykonują.
 */
export type OutcomeStatus = "pass" | "fail" | "skip";

export interface AssertionOutcome {
  readonly status: OutcomeStatus;
  /** Powód GOTOWY do wpisania w tabelę — także przy `pass`, bo raport pokazuje, co dokładnie przeszło. */
  readonly reason: string;
}

/** Dokładnie tyle, ile niesie `ProviderResponse` — asercja nie ma widzieć więcej niż promptfoo. */
export interface CellUnderTest {
  readonly output?: unknown;
  readonly error?: string;
}

/** Oczekiwanie przypisane fiksturze. Mieszka w `promptfooconfig.yaml` (`vars`), nie tutaj. */
export interface CellExpectation {
  readonly verdict: Review["verdict"];
}

const pass = (reason: string): AssertionOutcome => ({ status: "pass", reason });
const fail = (reason: string): AssertionOutcome => ({ status: "fail", reason });
const skip = (reason: string): AssertionOutcome => ({ status: "skip", reason });

/** Powód pominięcia, wypisany JEDNYM tekstem, żeby w tabeli dało się go policzyć. */
const NO_REVIEW = "brak recenzji w odpowiedzi — o tym mówi asercja `no-provider-error`";

/**
 * Wyciągnięcie recenzji z odpowiedzi.
 *
 * Przyjmuje obiekt ORAZ tekst JSON, bo promptfoo serializuje wyjście providera na potrzeby swojej
 * tabeli i nie ma kontraktu na to, w której z tych postaci trafia do asercji. Tolerancja nie
 * ukrywa tu niczego: tekst, który nie parsuje się do obiektu, jest odmową z nazwaną przyczyną,
 * a nie cichym `undefined`. Postać, która przyszła NAPRAWDĘ, jest zapisana w
 * `context/changes/code-review-evals/verification.md` (faza 5) — zmierzona na przebiegu, nie założona.
 */
function toReview(cell: CellUnderTest): Review | undefined {
  const { output } = cell;
  if (typeof output === "string") {
    try {
      const parsed: unknown = JSON.parse(output);
      return typeof parsed === "object" && parsed !== null ? (parsed as Review) : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof output === "object" && output !== null ? (output as Review) : undefined;
}

const scoreOf = (review: Review, key: string): unknown => (review as unknown as Record<string, unknown>)[key];

// ---------------------------------------------------------------------------------------------
// Asercje twarde — funkcje CZYSTE, wołane zarówno przez adaptery promptfoo (niżej), jak i wprost
// przez `assertions.test.ts`. Test operuje na obiekcie, nie na przebiegu: zero wywołań, zero kosztu.
// ---------------------------------------------------------------------------------------------

/**
 * Odpowiedź nie niesie `error` — czyli `runReview` NIE rzuciło.
 *
 * Jedyna asercja w tym zestawie, która odróżnia „agent ocenił źle” od „agent w ogóle nie dojechał”.
 * Bez niej regresja kontraktu wyjścia (`[contract]`, czyli jedno z dwóch pytań, na które ten zestaw
 * istnieje) byłaby w tabeli nieodróżnialna od padniętej sieci.
 *
 * ⚑ ZMIERZONA GRANICA: w prawdziwym przebiegu promptfoo ta asercja się NIE WYKONA, bo ewaluator
 * przy `response.error` czerwieni komórkę i wraca przed `runAssertions`. Komórka jest więc czerwona
 * tak czy inaczej — ta asercja dokłada NAZWĘ w raporcie i jest jedynym miejscem, w którym warunek
 * „`safeParse` przeszedł” jest zapisany jako sprawdzenie, a nie jako obietnica. Czerwień potrafi
 * pokazać (`assertions.test.ts`, mutacja „odpowiedź z `error`”), więc nie jest niefalsyfikowalna;
 * jest defense-in-depth nad bramką, którą promptfoo trzyma sam.
 */
export function checkNoProviderError(cell: CellUnderTest): AssertionOutcome {
  if (typeof cell.error === "string" && cell.error.length > 0) {
    return fail(`komórka wróciła z błędem: ${cell.error}`);
  }
  if (!toReview(cell)) {
    return fail("odpowiedź nie niesie recenzji ani błędu — nie ma czego oceniać");
  }
  return pass("recenzja dojechała, bez błędu");
}

/** `verdict` zgodny z oczekiwanym dla fikstury (`fail` dla slotu 1, `pass` dla slotu 2). */
export function checkVerdict(cell: CellUnderTest, expectation: CellExpectation): AssertionOutcome {
  const review = toReview(cell);
  if (!review) return skip(NO_REVIEW);
  if (review.verdict !== expectation.verdict) {
    return fail(`verdict = ${JSON.stringify(review.verdict)}, oczekiwano ${JSON.stringify(expectation.verdict)}`);
  }
  return pass(`verdict = ${review.verdict}`);
}

/**
 * Każda z dziewięciu ocen mieści się w `SCORE_MIN`..`SCORE_MAX`, gdy nie jest `null`.
 *
 * Schemat tego NIE wymusza i mówi o tym wprost: structured output Anthropica odrzuca
 * `minimum`/`maximum` na typie liczbowym, więc zakres trzyma wyłącznie OPIS pola. To jedyne
 * miejsce, w którym da się go w ogóle egzekwować.
 */
export function checkScoresWithinScale(cell: CellUnderTest): AssertionOutcome {
  const review = toReview(cell);
  if (!review) return skip(NO_REVIEW);

  const offenders: string[] = [];
  for (const criterion of CRITERIA) {
    const value = scoreOf(review, criterion.key);
    if (value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < SCORE_MIN || value > SCORE_MAX) {
      offenders.push(`${criterion.key} = ${JSON.stringify(value)}`);
    }
  }
  if (offenders.length > 0) {
    return fail(`poza skalą ${SCORE_MIN}-${SCORE_MAX}: ${offenders.join(", ")}`);
  }
  return pass(`wszystkie oceny w skali ${SCORE_MIN}-${SCORE_MAX} (albo null tam, gdzie wolno)`);
}

/**
 * `scopeDiscipline !== null`.
 *
 * Kryterium 9 jest BEZWARUNKOWE — jego opis mówi wprost „nigdy nie zwracaj tu null”
 * (`review-schema.ts`) — a schemat i tak dopuszcza `null` na każdej ocenie, bo `conditional`
 * rozstrzyga się przy budowie kształtu, nie przy walidacji wartości. Tę regułę trzyma więc
 * wyłącznie prompt i wyłącznie ta asercja.
 */
export function checkScopeDisciplineScored(cell: CellUnderTest): AssertionOutcome {
  const review = toReview(cell);
  if (!review) return skip(NO_REVIEW);
  const value = scoreOf(review, "scopeDiscipline");
  if (value === null || value === undefined) {
    return fail("scopeDiscipline = null, a kryterium 9 dotyczy KAŻDEJ zmiany bez wyjątku");
  }
  return pass(`scopeDiscipline = ${JSON.stringify(value)}`);
}

/** Każde z dziewięciu uzasadnień jest niepuste po `trim()` — `z.string()` przepuszcza `""`. */
export function checkNotesNonEmpty(cell: CellUnderTest): AssertionOutcome {
  const review = toReview(cell);
  if (!review) return skip(NO_REVIEW);

  const offenders = CRITERIA.filter((criterion) => {
    const note = scoreOf(review, criterion.noteKey);
    return typeof note !== "string" || note.trim().length === 0;
  }).map((criterion) => criterion.noteKey);

  if (offenders.length > 0) {
    return fail(`uzasadnienie puste po trim(): ${offenders.join(", ")}`);
  }
  return pass("wszystkie dziewięć uzasadnień niepuste");
}

/**
 * Slot 1: `swallowedError` jest LICZBĄ przy `gateIntegrity === null`.
 *
 * To jest dokładnie ta para, którą naprawiał `0d3eba5`, i jedyna rzecz w tym zestawie, która
 * realnie pilnuje wykrywania klasy błędu na `sample.diff`: materiał połkniętego błędu tam JEST
 * (`if (!error) { deleted++ }` w pętli), a żadnego sprawdzenia diff nie dodaje. Zmierzone na
 * wszystkich trzech modelach po `0d3eba5` (Pomiar II) — asercja stoi na pomiarze, nie na
 * przewidywaniu.
 */
export function checkSwallowedErrorPair(cell: CellUnderTest): AssertionOutcome {
  const review = toReview(cell);
  if (!review) return skip(NO_REVIEW);

  const swallowed = scoreOf(review, "swallowedError");
  const gate = scoreOf(review, "gateIntegrity");
  const problems: string[] = [];
  if (typeof swallowed !== "number") {
    problems.push(`swallowedError = ${JSON.stringify(swallowed)}, a materiał połkniętego błędu w tym diffie JEST`);
  }
  if (gate !== null) {
    problems.push(`gateIntegrity = ${JSON.stringify(gate)}, a ten diff nie dodaje ani nie modyfikuje żadnego sprawdzenia`);
  }
  if (problems.length > 0) return fail(problems.join("; "));
  return pass(`swallowedError = ${JSON.stringify(swallowed)} (liczba), gateIntegrity = null`);
}

// ---------------------------------------------------------------------------------------------
// OBSERWACJE MIĘKKIE — trafiają do raportu, NIE bramkują zieleni.
//
// Nie jest to kategoria „na wszelki wypadek". Powstała z konkretnego pomiaru (faza 6,
// `measurement-negative-control.md`): na kontroli negatywnej haiku wystawiło `swallowedError: 10`
// i `gateIntegrity: 10` zamiast `null`, z notami mówiącymi WPROST „kryterium nie dotyczy, ale
// ocena 10 oddaje fakt braku ryzyka". Model rozpoznał materiał poprawnie i odrzucił samą regułę.
//
// Twarda asercja `=== null` byłaby tu poprawna merytorycznie i BŁĘDNA proceduralnie: czerwieniłaby
// każde przejście na defekcie, który jest ZMIERZONY i ŚWIADOMIE nienaprawiony, a wtedy czerwień
// przestaje odróżniać „nowa regresja" od „znany, opisany stan". Obserwacja miękka utrzymuje
// różnicę między „zmierzone i nienaprawione" a „niemierzone" — a to jest dokładnie to, po co ten
// zestaw powstał.
//
// Warunek, na którym to przestaje być obserwacją i staje się bramką, jest zapisany w planie
// (sekcja „Open Risks") jako PYTANIE DO POMIARU, nie jako zadanie do odhaczenia.
// ---------------------------------------------------------------------------------------------

/** Oczekiwanie miękkie fikstury — czyta się z `vars`, tak samo jak twarde. */
export interface SoftExpectation {
  /** `true` wyłącznie dla materiału, w którym OBA kryteria warunkowe są bez zastosowania. */
  readonly conditionalCriteriaShouldBeNull: boolean;
}

export interface SoftObservation {
  readonly id: string;
  readonly title: string;
  readonly run: (cell: CellUnderTest, expectation: SoftExpectation) => AssertionOutcome;
}

/**
 * Czy kryteria warunkowe zostały rozstrzygnięte przez `null`, czy przez liczbę.
 *
 * `null` NIE JEST OCENĄ — mówi, że materiału nie ma. Liczba w jego miejscu zawyża wynik
 * arytmetycznie: zmiana, która nie ruszyła żadnej ścieżki zapisu, wypada wtedy LEPIEJ niż zmiana,
 * która ruszyła ją i obsłużyła porządnie. To jest powód, dla którego ta obserwacja w ogóle jest
 * w raporcie, a nie tylko w notatce pomiarowej.
 */
export function observeConditionalNullContract(cell: CellUnderTest, expectation: SoftExpectation): AssertionOutcome {
  if (!expectation.conditionalCriteriaShouldBeNull) {
    return skip("fikstura nie deklaruje, że oba kryteria warunkowe są bez zastosowania");
  }
  const review = toReview(cell);
  if (!review) return skip(NO_REVIEW);

  const offenders = CRITERIA.filter((criterion) => criterion.conditional).flatMap((criterion) => {
    const value = scoreOf(review, criterion.key);
    return value === null ? [] : [`${criterion.key} = ${JSON.stringify(value)}`];
  });

  if (offenders.length > 0) {
    return fail(`ocena zamiast \`null\` tam, gdzie kryterium nie ma zastosowania: ${offenders.join(", ")}`);
  }
  return pass("oba kryteria warunkowe rozstrzygnięte przez `null`");
}

export const SOFT_OBSERVATIONS: readonly SoftObservation[] = [
  {
    id: "conditional-null-contract",
    title: "kryteria warunkowe rozstrzygnięte przez `null`, nie oceną",
    run: observeConditionalNullContract,
  },
];

// ---------------------------------------------------------------------------------------------
// Rejestr — jedno miejsce, z którego czytają i test, i raport.
// ---------------------------------------------------------------------------------------------

export interface HardAssertion {
  /** Identyfikator używany w `promptfooconfig.yaml` (`metric`) i w raporcie. */
  readonly id: string;
  readonly title: string;
  readonly run: (cell: CellUnderTest, expectation: CellExpectation) => AssertionOutcome;
  /** `true` → dotyczy wyłącznie `sample.diff`; w konfiguracji wpięta tylko pod tym testem. */
  readonly sampleDiffOnly: boolean;
  /**
   * Nazwa eksportowanego adaptera, którą `promptfooconfig.yaml` wpina jako
   * `value: file://assertions.ts:<adapter>`.
   *
   * Zadeklarowana TUTAJ, a nie wywnioskowana z `id`, bo to ona jest tym, co pilnuje
   * `assertions.test.ts`: rejestr, eksport i wpięcie w YAML-u to trzy listy, a bez tego pola
   * nie ma czego z czym porównać. `byId` broni kierunku „adapter bez wpisu w rejestrze";
   * to pole otwiera kierunek ODWROTNY — asercja w rejestrze, której prawdziwe przejście nigdy
   * nie uruchamia, bo nikt jej nie wpiął. Taka przechodzi zielono w tym pliku, a raport pokazuje
   * komplet — czyli bramka, której nie da się zaświecić na czerwono.
   */
  readonly adapter: string;
}

export const HARD_ASSERTIONS: readonly HardAssertion[] = [
  { id: "no-provider-error", title: "odpowiedź nie niesie `error`", run: (cell) => checkNoProviderError(cell), sampleDiffOnly: false, adapter: "noProviderError" },
  { id: "verdict", title: "verdict zgodny z oczekiwanym dla fikstury", run: checkVerdict, sampleDiffOnly: false, adapter: "verdictMatchesFixture" },
  { id: "score-range", title: `oceny w skali ${SCORE_MIN}-${SCORE_MAX}`, run: (cell) => checkScoresWithinScale(cell), sampleDiffOnly: false, adapter: "scoresWithinScale" },
  { id: "scope-discipline-scored", title: "scopeDiscipline nie jest null", run: (cell) => checkScopeDisciplineScored(cell), sampleDiffOnly: false, adapter: "scopeDisciplineScored" },
  { id: "notes-non-empty", title: "uzasadnienia niepuste po trim()", run: (cell) => checkNotesNonEmpty(cell), sampleDiffOnly: false, adapter: "notesNonEmpty" },
  { id: "swallowed-error-pair", title: "swallowedError liczbą przy gateIntegrity = null", run: (cell) => checkSwallowedErrorPair(cell), sampleDiffOnly: true, adapter: "swallowedErrorPair" },
];

// ---------------------------------------------------------------------------------------------
// Adaptery promptfoo. Każdy wpinany osobno (`file://assertions.ts:<nazwa>`), żeby czerwień była
// przypisana do KONKRETNEJ asercji, a nie do jednej zbiorczej, w której nie widać, co pękło.
// ---------------------------------------------------------------------------------------------

/**
 * `vars.expectedVerdict` jest WYMAGANY i jego brak jest czerwienią, nie wartością domyślną.
 *
 * Domyślne `fail` przepuściłoby test, w którym ktoś zapomniał wpisać oczekiwanie — czyli asercja
 * werdyktu przestałaby cokolwiek znaczyć dokładnie w chwili, w której konfiguracja się rozjeżdża.
 */
function expectationOf(context: AssertionValueFunctionContext): CellExpectation | string {
  const raw = context.vars?.["expectedVerdict"];
  if (raw !== "pass" && raw !== "fail") {
    return `[config] \`vars.expectedVerdict\` musi być "pass" albo "fail" (otrzymano: ${JSON.stringify(raw)})`;
  }
  return { verdict: raw };
}

function cellOf(context: AssertionValueFunctionContext): CellUnderTest {
  return { output: context.providerResponse?.output, error: context.providerResponse?.error };
}

/** `skip` mapuje się na `pass`, bo promptfoo nie zna trzeciego stanu — powód zostaje w `reason`. */
function toGrading(outcome: AssertionOutcome, id: string): GradingResult {
  const passed = outcome.status !== "fail";
  return { pass: passed, score: passed ? 1 : 0, reason: `[${id}] ${outcome.reason}` };
}

function adapt(assertion: HardAssertion) {
  return (_output: string, context: AssertionValueFunctionContext): GradingResult => {
    const expectation = expectationOf(context);
    if (typeof expectation === "string") {
      return { pass: false, score: 0, reason: `[${assertion.id}] ${expectation}` };
    }
    return toGrading(assertion.run(cellOf(context), expectation), assertion.id);
  };
}

const byId = (id: string): HardAssertion => {
  const found = HARD_ASSERTIONS.find((assertion) => assertion.id === id);
  if (!found) throw new Error(`[config] brak asercji o id ${JSON.stringify(id)} w HARD_ASSERTIONS`);
  return found;
};

export const noProviderError = adapt(byId("no-provider-error"));
export const verdictMatchesFixture = adapt(byId("verdict"));
export const scoresWithinScale = adapt(byId("score-range"));
export const scopeDisciplineScored = adapt(byId("scope-discipline-scored"));
export const notesNonEmpty = adapt(byId("notes-non-empty"));
export const swallowedErrorPair = adapt(byId("swallowed-error-pair"));
