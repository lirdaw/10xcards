// Kształt DOWODU przejścia macierzy, jego serializacja i decyzja „czy ten dowód opisuje
// dzisiejsze wywołanie" — jako czyste funkcje. Bez `fs`, bez `console`, bez argv: zapis należy do
// `./report.ts --record`, a kod wyjścia do `./check-eval-record.ts`. Ten sam podział rdzeń/runner
// co `scripts/prompt-sources.ts` ↔ `scripts/run-prompt-sources.ts` ↔ `scripts/check-prompt-sources.ts`.
//
// CO TEN PLIK JEST, A CZEGO NIE JEST.
// `eval-record.json` to zapadka na DOWODZIE: macierz evali odpala CZŁOWIEK, ręcznie, za pieniądze,
// a CI sprawdza wyłącznie, czy w drzewie leży aktualny wynik tego przejścia. Żaden checker nie woła
// modelu ani razu i nie ma do tego klucza.
//
// DWA ODCISKI O ROZŁĄCZNYCH REMEDIACH, JEDEN PLIK.
//
//   * `callFingerprint` — TEN plik (a liczy go `./fingerprint.ts`). Hash czterech osi wywołania.
//     Zmienia to, CO MODEL ODPOWIEDZIAŁ, więc remedium jest PŁATNE: przejechać macierz.
//   * `verdictConfig` — CUDZY blok, właścicielem jest `scripts/verdict-config.ts`. Warstwa
//     ODCZYTU tej odpowiedzi, więc remedium jest DARMOWE: przepisać wartości.
//
// Rozłączność remediów jest treścią tego podziału, nie ozdobą — zlanie ich kazałoby kupować
// przejście macierzy po to, żeby udowodnić coś, o czym macierz nic nie mówi. Stąd dwie
// konsekwencje, których nie wolno „posprzątać":
//   1. TEN moduł nigdy nie liczy ani nie waliduje zawartości `verdictConfig` — przenosi go przez
//      zapis nietknięty. Granica kierunkowa (`scripts/` czyta z `agents/` DANE, nigdy kodu) działa
//      w obie strony: agent też nie sięga po stałe ze `scripts/`.
//   2. Każdy z dwóch zapisywaczy robi read-modify-write i ZACHOWUJE cudzy blok. Nie mogą dzielić
//      modułu serializującego, więc `serializeRecord` istnieje tu i w `scripts/verdict-config.ts`
//      w dwóch egzemplarzach — i dlatego każda strona ma własny test round-tripu, a checker trzeci,
//      na pliku ZACOMMITOWANYM.
//
// ⚑ ŻADNEGO IMPORTU `promptfoo`, także `import type` — ten plik jedzie w drzewie po
// `npm ci --omit=dev`, gdzie `promptfoo` nie istnieje również dla typów. Dlatego wiersze wchodzą
// tu przez STRUKTURALNY `RecordSourceRow`, a nie przez `import type { ReportRow } from "./report.ts"`:
// `report.ts` rozwiązuje entrypoint `promptfoo`, a przy okazji odwróciłoby to kierunek zależności.

/** Plik dowodu. Ścieżka liczona z położenia TEGO pliku, nie z `process.cwd()`. */
export const RECORD_PATH = new URL("./eval-record.json", import.meta.url);

/** Ta sama ścieżka w postaci, w jakiej ma się pojawić w komunikacie dla człowieka. */
export const RECORD_RELATIVE_PATH = "agents/review/evals/eval-record.json";

/** Komenda wytwarzająca dowód. KOSZTUJE — cytowana w remedium razem z tą informacją. */
export const RECORD_COMMAND = "npm --prefix agents/review run eval -- --record";

/** Komenda odświeżająca CUDZY blok. NIE kosztuje — cytowana, żeby nie mylić jej z powyższą. */
export const VERDICT_CONFIG_COMMAND = "node --experimental-strip-types scripts/run-verdict-config.ts --write";

/** Kotwica kosztu jednego ZIMNEGO przejścia 2×2 — zmierzona na fazie 7 poprzedniej zmiany. */
export const COLD_PASS_COST_ANCHOR_USD = 0.12;

// ---------------------------------------------------------------------------------------------
// Kształt.
// ---------------------------------------------------------------------------------------------

/**
 * Adnotacja mówiąca, czym ten plik NIE JEST — pięć pól, wszystkie obowiązkowe.
 *
 * OBIEKT, nie tablica zdań, i to jest ta jedna rzecz w kształcie, która nie jest kwestią gustu:
 * prettier zwija tablice wartości PROSTYCH do jednej linii poniżej 120 kolumn, a `lint-staged`
 * puszcza `prettier --write` na każdy zastagowany `*.json` (`agents/**` nie jest
 * w `.prettierignore`). Tablica zdań wróciłaby z pierwszego commita przeformatowana, czyli
 * zaczerwieniłaby round-trip na formatowaniu zamiast na dryfie.
 *
 * Adnotacja jest w PLIKU, a nie w planie zmiany, bo czyta ją człowiek, który do planu nie sięgnie:
 * ten, któremu bramka zaświeciła na czerwono za dwa lata.
 */
export interface EvalRecordNotes {
  /** Czyją reakcję ten dowód opisuje — i czyjej NIE. */
  readonly scope: string;
  /** Jedna komórka to jeden pomiar, nie średnia. */
  readonly oneMeasurement: string;
  /** Skąd biorą się kwoty, a skąd rozliczenie budżetu. */
  readonly costSource: string;
  /** Nazwana dziura po stronie INTERPRETACJI. */
  readonly uncovered: string;
  /** Nazwana dziura po stronie MATERIAŁU. */
  readonly fixtures: string;
}

/** Klucze adnotacji — kolejność zapisu ORAZ lista pól wymaganych przez checkera. */
export const NOTES_KEYS = ["scope", "oneMeasurement", "costSource", "uncovered", "fixtures"] as const;

/**
 * Treść adnotacji. Stała, nie generowana z niczego — każde zdanie jest ZMIERZONYM faktem albo
 * świadomie przyjętą dziurą, a nie streszczeniem kodu, które mogłoby się zestarzeć samo.
 */
export const MANDATORY_NOTES: EvalRecordNotes = {
  scope:
    "Ten dowód opisuje reakcję DWÓCH TANICH MODELI (anthropic/claude-haiku-4.5, " +
    "google/gemini-2.5-flash) na zmieniony prompt — NIE zachowanie recenzenta produkcyjnego " +
    "(anthropic/claude-sonnet-4.6). Regresja uderzająca w sonneta, a omijająca oba tanie modele, " +
    "przejdzie tę bramkę na ZIELONO z dowodem kompletnym i aktualnym. Nie zapisano nigdzie, że " +
    "modele z jednej rodziny regresują razem — to jest prawdopodobne i NIEZMIERZONE.",
  oneMeasurement:
    "Każda komórka to JEDEN pomiar, nie średnia z powtórzeń. Rozrzut kosztu i czasu między " +
    "przebiegami sięga dziesiątek procent, więc różnica liczb między dwoma rekordami NIE jest " +
    "sama z siebie sygnałem regresji.",
  costSource:
    "costUsd liczone z tokenów razy cennik OpenRoutera (agents/review/evals/pricing.ts), NIGDY " +
    "z total_cost_usd SDK — zmierzone przeszacowanie: 5,0x dla haiku, 14,0x dla gemini. Do " +
    "rozliczenia budżetu wchodzi wyłącznie odczyt /api/v1/key, nie ta suma i nie prognoza.",
  uncovered:
    "Poza blokiem verdictConfig warstwa INTERPRETACJI nie jest tu pilnowana: reguła agregacji " +
    "werdyktu, surowość parseReview, literały werdyktu w scripts/review-verdict.ts i mapowanie " +
    "etykiet w .github/workflows/pr-review.yml to KOD, a odcisk z wartości go nie widzi. To jest " +
    "dziura NAZWANA i przyjęta — nie „reszta jest pokryta przez review kodu”.",
  fixtures:
    "Ten dowód NIE obejmuje TREŚCI fikstur, na których macierz pojechała — a są dwie i leżą " +
    "w RÓŻNYCH miejscach: agents/review/sample.diff oraz " +
    "agents/review/evals/fixtures/clean-text-change.diff. (diffPath w promptfooconfig.yaml jest " +
    "ścieżką względem agents/review/, więc pierwsza z nich NIE leży pod evals/fixtures/ — glob " +
    "evals/fixtures/*.diff nazwałby tę dziurę w połowie.) Żadna fikstura nie wchodzi do czterech " +
    "osi callFingerprint, bo odcisk liczy się z wrapDiff z PUSTYM diffem, więc edycja " +
    "KTÓREJKOLWIEK z nich zostawia bramkę ZIELONĄ nad ocenami, które powstały na innym " +
    "materiale. Dziura nazwana i świadomie niezamknięta: jej remedium byłoby PŁATNE.",
};

/** Powód czerwieni komórki. Obiekt, nie goły string — patrz uzasadnienie przy `EvalRecordNotes`. */
export interface EvalRecordFailure {
  readonly reason: string;
}

/** Obserwacja MIĘKKA: zmierzona, raportowana, NIE bramkująca. */
export interface EvalRecordSoftObservation {
  readonly id: string;
  readonly status: string;
  readonly reason: string;
}

/** Jedna komórka macierzy — jeden model x jedna fikstura x jeden pomiar. */
export interface EvalRecordCell {
  readonly model: string;
  readonly fixture: string;
  /** `pass` / `fail` z recenzji albo `—`, gdy recenzji nie ma. */
  readonly verdict: string;
  /** Czy komórka przeszła asercje TWARDE. To jest pole, na które patrzy zapadka. */
  readonly ok: boolean;
  readonly cached: boolean;
  /** `ok` albo klasa awarii (`[contract]`, `[provider]`, `[budget]`, `[config]`). */
  readonly contract: string;
  readonly turns: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly durationMs: number | null;
  readonly failures: readonly EvalRecordFailure[];
  readonly softObservations: readonly EvalRecordSoftObservation[];
}

/**
 * Cały dowód.
 *
 * `verdictConfig` jest tu `Record<string, unknown>` CELOWO: ten moduł wie tylko tyle, że taki
 * klucz istnieje i należy do `scripts/verdict-config.ts`. Otypowanie go tutaj oznaczałoby, że
 * agent zna wartości ze `scripts/` — czyli dokładnie to przekroczenie granicy, którego
 * rozdzielenie dwóch odcisków ma unikać. Pole jest opcjonalne, bo pierwszy zapis (`--record`)
 * tworzy plik, którego drugi zapisywacz jeszcze nie dotknął.
 */
export interface EvalRecord {
  readonly notes: EvalRecordNotes;
  readonly generatedAt: string;
  readonly callFingerprint: string;
  readonly verdictConfig?: Readonly<Record<string, unknown>>;
  readonly matrix: readonly EvalRecordCell[];
}

/** Klucze pliku w kolejności zapisu — patrz `buildRecord`. */
export const RECORD_KEYS = ["notes", "generatedAt", "callFingerprint", "verdictConfig", "matrix"] as const;

// ---------------------------------------------------------------------------------------------
// Serializacja.
// ---------------------------------------------------------------------------------------------

/**
 * Dokładne bajty pliku dowodu.
 *
 * Dwuspacjowe wcięcie i domykający `\n` nie są preferencją: `lint-staged` puszcza
 * `prettier --write` na każdy zastagowany `*.json`, a `agents/**` nie jest w `.prettierignore` —
 * więc generator emitujący cokolwiek innego miałby wyjście przepisane przez pierwszy commit,
 * a zapadka czerwieniłaby się WIECZNIE na formatowaniu zamiast na dryfie.
 *
 * Prettier-czystość nie jest jednak własnością tej jednej linii, tylko KSZTAŁTU: prettier zwija
 * tablice wartości PROSTYCH poniżej 120 kolumn, więc żadne pole dowodu nie może być tablicą
 * stringów ani liczb (stąd `failures: [{ reason }]` zamiast `string[]`). Zmierzone na dowodzie
 * SFABRYKOWANYM, zanim padł pierwszy cent.
 */
export function serializeRecord(record: unknown): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Zapis (połowa AGENCKA — `callFingerprint` + `matrix`).
// ---------------------------------------------------------------------------------------------

/**
 * Wiersz przejścia, w kształcie, w jakim ten moduł go czyta.
 *
 * Interfejs STRUKTURALNY, a nie `import type { ReportRow }`: `report.ts` rozwiązuje entrypoint
 * `promptfoo`, więc import w tę stronę wciągnąłby devDependency do modułu, który ma jej nie mieć,
 * i odwróciłby kierunek zależności (runner → rdzeń). `ReportRow` jest przypisywalny do tego typu,
 * a bramka typów pakietu agenta pilnuje, że pozostanie.
 */
export interface RecordSourceRow {
  readonly model: string;
  readonly fixture: string;
  readonly verdict: string;
  readonly contract: string;
  readonly errorMessage: string | null;
  readonly turns: number | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly costUsd: number | null;
  readonly durationMs: number | undefined;
  readonly cached: boolean;
  readonly failedAssertions: readonly string[];
  readonly ok: boolean;
  readonly softObservations: readonly {
    readonly id: string;
    readonly outcome: { readonly status: string; readonly reason: string };
  }[];
}

/** `undefined` → `null`, bo `JSON.stringify` KASUJE klucz o wartości `undefined`. */
const orNull = (value: number | undefined): number | null => (value === undefined ? null : value);

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/**
 * Komórka rekordu z wiersza przejścia.
 *
 * `errorMessage` wchodzi jako PIERWSZY powód czerwieni, a nie osobnym polem: przy awarii providera
 * promptfoo wraca PRZED `runAssertions`, więc `failedAssertions` jest puste i komunikat błędu jest
 * JEDYNĄ rzeczą, która mówi, co się stało. Pominięty zostawiłby czerwoną komórkę bez powodu.
 */
export function cellFromRow(row: RecordSourceRow): EvalRecordCell {
  return {
    model: row.model,
    fixture: row.fixture,
    verdict: row.verdict,
    ok: row.ok,
    cached: row.cached,
    contract: row.contract,
    turns: orNull(row.turns),
    inputTokens: orNull(row.inputTokens),
    outputTokens: orNull(row.outputTokens),
    costUsd: row.costUsd,
    durationMs: orNull(row.durationMs),
    failures: [
      ...(row.errorMessage === null ? [] : [{ reason: row.errorMessage }]),
      ...row.failedAssertions.map((reason) => ({ reason })),
    ],
    softObservations: row.softObservations.map((observation) => ({
      id: observation.id,
      status: observation.outcome.status,
      reason: observation.outcome.reason,
    })),
  };
}

/**
 * Dowód po zapisie połowy AGENCKIEJ — read-modify-write, który ZACHOWUJE cudzy blok.
 *
 * Klucze wychodzą w kolejności `RECORD_KEYS`, a nie w zastanej, żeby dwaj niezależni zapisywacze
 * nie przestawiali ich sobie nawzajem przy każdym przebiegu (git churn na pliku, który ma się
 * zmieniać wyłącznie wtedy, gdy zmienił się pomiar). `verdictConfig` przechodzi NIETKNIĘTY i znika
 * z wyjścia, gdy go nie ma — `JSON.stringify` kasuje klucze o wartości `undefined`, więc świeży
 * plik po prostu go nie niesie, dopóki nie dopisze go `scripts/run-verdict-config.ts --write`.
 *
 * Adnotacja: zastana zostaje, brakująca powstaje z `MANDATORY_NOTES`. Zastana zostaje dlatego, że
 * człowiek ma prawo dopisać dziurę, której dziś nie znamy — a nadpisywanie kasowałoby to przy
 * każdym przejściu, czyli karałoby za jedyną rzecz, którą ten plik prosi zrobić ręcznie.
 */
export function buildRecord(input: {
  readonly rows: readonly RecordSourceRow[];
  readonly existing: unknown;
  readonly callFingerprint: string;
  readonly now: Date;
}): Record<string, unknown> {
  const existing = asRecord(input.existing) ?? {};
  const known = new Set<string>(RECORD_KEYS);
  const unknownKeys = Object.fromEntries(Object.entries(existing).filter(([key]) => !known.has(key)));

  return {
    notes: asRecord(existing["notes"]) ?? MANDATORY_NOTES,
    generatedAt: input.now.toISOString(),
    callFingerprint: input.callFingerprint,
    verdictConfig: existing["verdictConfig"],
    matrix: input.rows.map(cellFromRow),
    // Klucze, których ten moduł nie zna, przeżywają zapis — inaczej pierwszy `--record` po
    // rozszerzeniu pliku przez kogoś innego cicho by je skasował.
    ...unknownKeys,
  };
}

// ---------------------------------------------------------------------------------------------
// Decyzja: czy ten dowód opisuje dzisiejsze wywołanie.
// ---------------------------------------------------------------------------------------------

export type EvalRecordProblemKind =
  | "missing"
  | "malformed"
  | "callFingerprint"
  | "matrixIncomplete"
  | "cellRed"
  | "reformatted";

/** Jeden nazwany problem dowodu. Runner robi z niego JEDNĄ adnotację `::error`, nie zbiorczą. */
export interface EvalRecordProblem {
  readonly kind: EvalRecordProblemKind;
  /** Tytuł adnotacji — mówi, KTÓRA własność dowodu się rozjechała. */
  readonly title: string;
  /** Co konkretnie znaleziono. Wchodzi do remedium jako pierwsze zdanie. */
  readonly detail: string;
}

const isString = (value: unknown): value is string => typeof value === "string";

const isNumberOrNull = (value: unknown): boolean =>
  value === null || (typeof value === "number" && Number.isFinite(value));

function shapeProblem(detail: string): EvalRecordProblem {
  return { kind: "malformed", title: "Dowód evali ma zły kształt", detail };
}

/** Czy `value` jest komórką macierzy. Zwraca POWÓD odmowy, nie boolean — komunikat ma co nazwać. */
function cellShapeError(value: unknown, index: number): string | undefined {
  const cell = asRecord(value);
  if (!cell) return `matrix[${index}] nie jest obiektem`;
  for (const key of ["model", "fixture", "verdict", "contract"]) {
    if (!isString(cell[key])) return `matrix[${index}].${key} nie jest stringiem`;
  }
  for (const key of ["ok", "cached"]) {
    if (typeof cell[key] !== "boolean") return `matrix[${index}].${key} nie jest booleanem`;
  }
  for (const key of ["turns", "inputTokens", "outputTokens", "costUsd", "durationMs"]) {
    if (!isNumberOrNull(cell[key])) return `matrix[${index}].${key} nie jest liczbą ani null`;
  }
  if (!Array.isArray(cell["failures"])) return `matrix[${index}].failures nie jest tablicą`;
  if (!Array.isArray(cell["softObservations"])) return `matrix[${index}].softObservations nie jest tablicą`;
  return undefined;
}

/**
 * Kształt dowodu, albo powód, dla którego to nie jest dowód.
 *
 * Sprawdzenie kształtu idzie PRZED wszystkim innym i przerywa: rekord, którego nie da się
 * przeczytać, dałby inaczej trzy mylące czerwienie („odcisk się nie zgadza", „macierz niepełna",
 * „plik przeformatowany") zamiast jednej prawdziwej.
 */
function parseRecord(value: unknown): { record: EvalRecord } | { problem: EvalRecordProblem } {
  const raw = asRecord(value);
  if (!raw) return { problem: shapeProblem("plik nie zawiera obiektu JSON") };

  const notes = asRecord(raw["notes"]);
  if (!notes) return { problem: shapeProblem("brak obowiązkowej adnotacji `notes`") };
  for (const key of NOTES_KEYS) {
    if (!isString(notes[key]) || notes[key] === "") {
      return { problem: shapeProblem(`adnotacja \`notes.${key}\` jest pusta albo jej nie ma — a jest OBOWIĄZKOWA`) };
    }
  }

  if (!isString(raw["generatedAt"])) return { problem: shapeProblem("`generatedAt` nie jest stringiem") };
  const fingerprint = raw["callFingerprint"];
  if (!isString(fingerprint) || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    return { problem: shapeProblem("`callFingerprint` nie jest sha256 w postaci 64 znaków hex") };
  }

  const matrix = raw["matrix"];
  if (!Array.isArray(matrix)) return { problem: shapeProblem("`matrix` nie jest tablicą") };
  for (const [index, cell] of matrix.entries()) {
    const error = cellShapeError(cell, index);
    if (error !== undefined) return { problem: shapeProblem(error) };
  }

  return { record: raw as unknown as EvalRecord };
}

/**
 * Macierz NIEPEŁNA sprawdzana STRUKTURALNIE, nie listą nazw modeli.
 *
 * Iloczyn liczby różnych modeli i różnych fikstur, przy co najmniej dwóch każdego — dzięki temu
 * późniejsze poszerzenie macierzy nie wymaga dotykania zapadki, a dowód z jednej kolumny nie
 * przechodzi. Dowód z jednej kolumny nie jest dowodem: kontrakt `null` bywa u gemini NIESTABILNY,
 * więc kolumna, której się nie zmierzyło, jest kolumną, o której się nic nie wie.
 */
function matrixProblem(matrix: readonly EvalRecordCell[]): EvalRecordProblem | undefined {
  const models = new Set(matrix.map((cell) => cell.model));
  const fixtures = new Set(matrix.map((cell) => cell.fixture));
  const expected = models.size * fixtures.size;
  if (models.size >= 2 && fixtures.size >= 2 && matrix.length === expected) return undefined;
  return {
    kind: "matrixIncomplete",
    title: "Macierz evali jest niepełna",
    detail:
      `dowód niesie ${matrix.length} komórek dla ${models.size} modeli i ${fixtures.size} fikstur ` +
      `(oczekiwano ${expected}, przy co najmniej 2 modelach i 2 fiksturach)`,
  };
}

/**
 * Czy dowód opisuje dzisiejsze wywołanie — lista NAZWANYCH problemów, nie boolean.
 *
 * Lista, bo czerwień ma powiedzieć, KTÓRA własność się rozjechała i jakie jest JEJ remedium;
 * `false` zostawiałby jeden dostępny ruch — odruchowe przepisanie pliku.
 */
export function checkRecord(input: {
  /** Bajty pliku. `undefined` = pliku nie ma (to jest czerwień, nie „brak danych"). */
  readonly raw: string | undefined;
  /** Ten sam plik po `JSON.parse`. */
  readonly record: unknown;
  /** `productionPromptFingerprint()` policzony ŻYWO w chwili sprawdzenia. */
  readonly liveFingerprint: string;
}): EvalRecordProblem[] {
  if (input.raw === undefined) {
    return [
      {
        kind: "missing",
        title: "Brak dowodu przejścia evali",
        detail: `${RECORD_RELATIVE_PATH} nie istnieje`,
      },
    ];
  }

  const parsed = parseRecord(input.record);
  if ("problem" in parsed) return [parsed.problem];
  const { record } = parsed;

  const problems: EvalRecordProblem[] = [];

  if (record.callFingerprint !== input.liveFingerprint) {
    problems.push({
      kind: "callFingerprint",
      title: "Odcisk wywołania rozjechał się z dowodem",
      detail:
        `dowód opisuje wywołanie ${record.callFingerprint.slice(0, 12)}…, ` +
        `a dziś do modelu pojechałoby ${input.liveFingerprint.slice(0, 12)}…`,
    });
  }

  const incomplete = matrixProblem(record.matrix);
  if (incomplete) problems.push(incomplete);

  // Jedna adnotacja NA KOMÓRKĘ, nie zbiorcza: człowiek ma zobaczyć, która komórka i dlaczego,
  // bez otwierania pliku. Dowód regresji nie jest dowodem jej braku.
  for (const cell of record.matrix.filter((candidate) => !candidate.ok)) {
    problems.push({
      kind: "cellRed",
      title: `Czerwona komórka w dowodzie: ${cell.model} / ${cell.fixture}`,
      detail:
        `komórka ${cell.model} / ${cell.fixture} ma ok: false (kontrakt ${cell.contract})` +
        (cell.failures.length === 0 ? "" : `: ${cell.failures.map((failure) => failure.reason).join("; ")}`),
    });
  }

  if (serializeRecord(record) !== input.raw) {
    problems.push({
      kind: "reformatted",
      title: "Dowód nie przechodzi round-tripu serializacji",
      detail: `bajty ${RECORD_RELATIVE_PATH} różnią się od tego, co wypisałby zapisywacz`,
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------
// Remedium.
// ---------------------------------------------------------------------------------------------

const PAID_REMEDY = [
  "Ta oś wymaga PRZEJŚCIA MACIERZY i KOSZTUJE — kotwica zimnego przejścia 2x2 to",
  `~${COLD_PASS_COST_ANCHOR_USD.toFixed(2)} USD, z rozrzutem dziesiątek procent między przebiegami.`,
  "Nie da się jej domknąć przepisaniem wartości: odcisk opisuje to, CO MODEL ODPOWIEDZIAŁ,",
  "a tego nie wie nikt, kto modelu nie zawołał.",
].join("\n");

const PASS_STEPS = [
  `  1. Przejedź macierz i zapisz dowód: ${RECORD_COMMAND}`,
  "     (klucz OpenRoutera mapowany NA CZAS komendy, nigdy na stałe).",
  "  2. Przeczytaj raport przejścia: czy któraś komórka zaczerwieniła się z powodu, który jest",
  "     REGRESJĄ, a nie flakiem? Czerwona komórka jest WYNIKIEM, nie przeszkodą do obejścia.",
  `  3. Zacommituj ${RECORD_RELATIVE_PATH} RAZEM ze zmianą, która ruszyła odcisk.`,
].join("\n");

const NOT_THE_OTHER_AXIS = [
  "",
  "To NIE jest oś `verdictConfig` — tamta (próg, skala, digest asercji) jest DARMOWA i odświeża",
  `się komendą ${VERDICT_CONFIG_COMMAND}. Jeśli czerwień mówi o progu, przeczytaj JEJ remedium.`,
].join("\n");

const REFRESH_IS_NOT_A_CHECK =
  "Sam krok zapisujący zieleni bramkę i nie sprawdza niczego — zapisze zgodę na przejście, którego\nnikt nie przeczytał.";

/**
 * Co ZROBIĆ z problemem — a nie tylko że coś się nie zgadza.
 *
 * Gałęzie są rozdzielone, bo remedia są RÓŻNE i pomylenie ich kosztuje w obie strony: zapłata za
 * przejście macierzy, które nic nie mierzy, albo przepisanie odcisku nad wynikiem, który już nie
 * obowiązuje. Każda gałąź kończy się zdaniem o tym, że sam krok zapisujący niczego nie sprawdza.
 */
export function remedyFor(problem: EvalRecordProblem): string {
  const head = `${problem.title}: ${problem.detail}.`;

  switch (problem.kind) {
    case "missing":
      return [
        head,
        "",
        "Zapadka evali wymaga dowodu w drzewie — bez niego bramka czerwieni się CELOWO: „nie wiadomo”",
        "nie jest tym samym co „zmierzono i jest dobrze”.",
        "",
        PAID_REMEDY,
        "",
        "Co zrobić, w tej kolejności:",
        PASS_STEPS,
        `  4. Dopisz drugą połowę dowodu (to już NIE kosztuje): ${VERDICT_CONFIG_COMMAND}`,
        "",
        REFRESH_IS_NOT_A_CHECK,
      ].join("\n");

    case "malformed":
      return [
        head,
        "",
        `${RECORD_RELATIVE_PATH} jest WYTWARZANY komendą, nie pisany ręcznie. Ręczna edycja, która`,
        "zepsuła kształt, zepsuła też jedyną rzecz, którą ten plik jest — zapis POMIARU.",
        "",
        "Co zrobić:",
        `  1. Przywróć plik z gita (git checkout -- ${RECORD_RELATIVE_PATH}), jeśli zmiana była pomyłką.`,
        `  2. Jeśli nie — przejedź macierz na nowo (TO JEST WYDATEK): ${RECORD_COMMAND}`,
        "",
        REFRESH_IS_NOT_A_CHECK,
      ].join("\n");

    case "callFingerprint":
      return [
        head,
        "",
        "Zmieniła się któraś z czterech osi wywołania: prompt systemowy (agents/review/prompt.ts),",
        "schemat wymuszonego wyjścia (agents/review/review-schema.ts, w tym opisy kryteriów),",
        "kształt wiadomości użytkownika albo stałe wywołania SDK (agents/review/run-review.ts).",
        "Dowód w drzewie opisuje przejście na POPRZEDNIM wywołaniu i nie mówi nic o dzisiejszym.",
        "",
        PAID_REMEDY,
        "",
        "Co zrobić, w tej kolejności:",
        PASS_STEPS,
        NOT_THE_OTHER_AXIS,
        "",
        REFRESH_IS_NOT_A_CHECK,
      ].join("\n");

    case "matrixIncomplete":
      return [
        head,
        "",
        "Dowód z jednej kolumny nie jest dowodem: kontrakt `null` bywa u gemini NIESTABILNY, więc",
        "kolumna, której się nie zmierzyło, jest kolumną, o której się nic nie wie. Najczęstsza",
        "przyczyna to przejście zawężone filtrem — `--record` odmawia takiego zapisu, więc ten",
        "kształt znaczy raczej ręczną edycję albo przejście przerwane w połowie.",
        "",
        PAID_REMEDY,
        "",
        "Co zrobić:",
        `  1. Przejedź PEŁNĄ macierz, bez żadnego --filter…: ${RECORD_COMMAND}`,
        "",
        REFRESH_IS_NOT_A_CHECK,
      ].join("\n");

    case "cellRed":
      return [
        head,
        "",
        "Dowód REGRESJI nie jest dowodem jej braku — dlatego zapadka czerwieni także wtedy, gdy",
        "dowód jest kompletny i aktualny, ale któraś komórka nie przeszła asercji twardych.",
        "",
        "Co zrobić, w tej kolejności:",
        "  1. Przeczytaj powód czerwieni WYŻEJ i rozstrzygnij, czy to regresja promptu, czy flake",
        "     (gemini bywa niestabilny między przebiegami przy tym samym prompcie — zmierzone).",
        "  2. Regresja → napraw prompt albo asercję, świadomie i z uzasadnieniem.",
        `  3. Flake → przejedź macierz ponownie (TO JEST WYDATEK): ${RECORD_COMMAND}`,
        "  4. Nigdy nie przepisuj `ok` w pliku ręcznie. To jedyny ruch, który zamienia tę zapadkę",
        "     w ozdobę.",
        "",
        REFRESH_IS_NOT_A_CHECK,
      ].join("\n");

    case "reformatted":
      return [
        head,
        "",
        "Plik został przepisany przez coś innego niż zapisywacz — najpewniej przez prettier --write",
        "z lint-staged, albo ręcznie. Bajty, których zapisywacz by nie wypisał, znaczą, że dowodu",
        "nie da się porównać z niczym w sposób, któremu można ufać.",
        "",
        "Co zrobić:",
        `  1. Odśwież obie połowy: ${RECORD_COMMAND}, a potem ${VERDICT_CONFIG_COMMAND}`,
        "  2. Jeśli różnica wraca po każdym commicie — to jest defekt KSZTAŁTU dowodu (prettier",
        "     zwija tablice wartości prostych), a nie tego jednego pliku. Napraw serializator.",
        "",
        REFRESH_IS_NOT_A_CHECK,
      ].join("\n");
  }
}
