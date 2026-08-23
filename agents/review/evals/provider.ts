import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApiProvider,
  CallApiContextParams,
  ProviderOptions,
  ProviderResponse,
  TokenUsage,
} from "promptfoo";
import { REVIEW_JSON_SCHEMA, type Review } from "../review-schema.ts";
import { SYSTEM_PROMPT, wrapDiff } from "../prompt.ts";
import {
  FIXED_CALL_OPTIONS,
  isReviewFailure,
  runReview,
  type FailureKind,
  type QueryFn,
  type ReviewMetrics,
} from "../run-review.ts";
import {
  cellCacheKey,
  deleteCell,
  FINGERPRINT_NONCE,
  fingerprintPrompt,
  isCacheEnabled,
  readCell,
  writeCell,
  type CachedCell,
} from "./cache.ts";
import { cellCostUsd, PRICING_AS_OF, type CellCost } from "./pricing.ts";

/**
 * Provider evali — JEDNA klasa wpinana do macierzy N razy z różnym `label` i `config.model`.
 *
 * Woła `runReview`, czyli DOKŁADNIE tę funkcję, którą wywołuje CI. Zestaw jadący własnym
 * wywołaniem SDK mierzyłby własną kopię ścieżki — bez `wrapDiff` z noncem, bez walidacji zodem,
 * bez klasyfikacji awarii — i jego zieleń nie mówiłaby nic o tym, co robi review na PR-ze.
 *
 * **Ten provider NIE ustawia `ANTHROPIC_*` w ogóle.** Robi to `runReview` i tylko ona. Nie jest to
 * uproszczenie: dwie kopie tej samej prekondycji rozjeżdżają się CICHO — oba wywołania jadą wtedy
 * do innego endpointu z inną precedencją poświadczeń, tą samą funkcją, i nic w wyniku o tym nie
 * mówi. Klucz czytamy wyłącznie po to, żeby odmówić czytelnie, gdy go nie ma, i nie zapisujemy go
 * z powrotem do środowiska.
 */

/** Konfiguracja wpięcia — to, co w `promptfooconfig.yaml` siedzi pod `config:`. */
export interface ReviewProviderConfig {
  /** Pin modelu w notacji OpenRoutera, np. `anthropic/claude-haiku-4.5`. */
  readonly model: string;
  /**
   * Bezpiecznik od patologii, NIE bramka kosztowa. SDK liczy go z cennika Anthropica, w którym
   * identyfikatorów OpenRoutera nie ma, więc jest to limit kwoty FIKCYJNEJ — zmierzone
   * przeszacowanie 5,0× dla haiku i 14,0× dla gemini. Bramką kosztową jest `pricing.ts`.
   */
  readonly maxBudgetUsd: number;
  /**
   * `query` jest wstrzykiwalny WYŁĄCZNIE po to, żeby test był deterministyczny — dokładnie tak, jak
   * `nonce` w `wrapDiff` (`prompt.ts:299`) i `query` w `runReview`. Z YAML-a nie da się go podać
   * (nie jest to wartość, którą da się zapisać w konfiguracji), więc żadna ścieżka przebiegu za
   * pieniądze go nie widzi.
   */
  readonly query?: QueryFn;
}

/**
 * Klasy awarii komórki: cztery z `runReview` plus JEDNA własna.
 *
 * `config` istnieje osobno, bo wciśnięcie braku klucza do `provider` byłoby dokładnie tym mylącym
 * przypisaniem, dla którego `FailureKind` w ogóle powstało — czytelnik poszedłby szukać incydentu
 * u dostawcy zamiast ustawić zmienną. To nie jest awaria recenzji; to zestaw, który się nie odpalił.
 */
export type CellFailureKind = FailureKind | "config";

/** Wynik komórki widziany przez wywołującego — sukces z metrykami albo NAZWANA awaria. */
export type CellResult =
  | {
      readonly ok: true;
      readonly review: Review;
      readonly metrics: ReviewMetrics;
      readonly cached: boolean;
      readonly cost: CellCost;
    }
  | {
      readonly ok: false;
      readonly failureKind: CellFailureKind;
      /** Komunikat GOTOWY, z prefiksem `[kind]` — bo na ścieżce `runReview` prefiks jest już w rzucie. */
      readonly message: string;
    };

export interface RunCellInput {
  /** Treść fikstury. Materiał, nie ścieżka — klucz cache'u liczy się z treści. */
  readonly diff: string;
  readonly model: string;
  readonly maxBudgetUsd: number;
  /**
   * Odcisk promptu i schematu, policzony PRZEZ WYWOŁUJĄCEGO z wartości, które `runReview` naprawdę
   * wyśle. Jest argumentem, a nie odczytem stałej tutaj, bo inaczej kierunek unieważnienia cache'u
   * („prompt się zmienił → PUDŁO") nie miałby jak zostać sprawdzony — a to jest najgroźniejsza
   * klasa błędu w tym zestawie.
   */
  readonly promptFingerprint: string;
  readonly query?: QueryFn;
}

/**
 * Jedna komórka macierzy: cache → (klucz) → `runReview` → cache.
 *
 * Wydzielone z `callApi`, bo `callApi` jest adapterem do promptfoo (rozpakowanie `config` i `vars`,
 * zapakowanie `ProviderResponse`), a to jest ta część, którą trzeba dać się przetestować bez
 * budowania konfiguracji promptfoo wokół każdego przypadku.
 */
export async function runCell(input: RunCellInput): Promise<CellResult> {
  const { diff, model, maxBudgetUsd, promptFingerprint, query } = input;
  const key = cellCacheKey({ fixture: diff, model, promptFingerprint });
  const cacheOn = isCacheEnabled();

  if (cacheOn) {
    const hit = await readCell(key);
    if (hit) {
      return { ok: true, review: hit.review, metrics: hit.metrics, cached: true, cost: cellCostUsd(hit.metrics) };
    }
  }

  // Bramka klucza stoi PO odczycie cache'u i przed pierwszym wywołaniem. Kolejność jest decyzją:
  // trafienie w cache nie potrzebuje poświadczeń, więc odmowa przed nim zamieniłaby darmowe
  // powtórzenie w awarię konfiguracji.
  if (!process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return {
      ok: false,
      failureKind: "config",
      message:
        "[config] Brak ANTHROPIC_AUTH_TOKEN — zestaw evali NIE wykonał wywołania. " +
        "Zmapuj klucz na jedno uruchomienie, np. `ANTHROPIC_AUTH_TOKEN=$OPENROUTER_REVIEW_KEY npm run eval`.",
    };
  }

  try {
    const { review, metrics } = await runReview(diff, { model, maxBudgetUsd, query });
    if (cacheOn) await writeCell(key, { review, metrics } satisfies CachedCell);
    return { ok: true, review, metrics, cached: false, cost: cellCostUsd(metrics) };
  } catch (err) {
    // Klasa awarii bierze się z POLA na rzucie, nie z parsowania `[kind]` z komunikatu — patrz
    // `isReviewFailure` w `run-review.ts`. Rzut bez tego pola istnieje (strumień bez wiadomości
    // `result`) i dostaje `unknown`, bo zgadywanie „na pewno provider" jest właśnie tym mylącym
    // przypisaniem, które ta klasyfikacja likwiduje.
    return {
      ok: false,
      failureKind: isReviewFailure(err) ? err.kind : "unknown",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Usunięcie wpisu komórki — dla testów, które piszą do PRAWDZIWEGO magazynu promptfoo. */
export async function forgetCell(input: Pick<RunCellInput, "diff" | "model" | "promptFingerprint">): Promise<void> {
  await deleteCell(cellCacheKey({ fixture: input.diff, model: input.model, promptFingerprint: input.promptFingerprint }));
}

/**
 * Odcisk PRODUKCYJNEGO wywołania — jedno miejsce, jeden egzemplarz, cztery osie.
 *
 * Wszystkie cztery wartości pochodzą stąd, skąd bierze je `runReview`, a nie z kopii: `SYSTEM_PROMPT`
 * i `REVIEW_JSON_SCHEMA` z modułów kontraktu, kształt wiadomości z tego samego `wrapDiff`
 * (z nonce'em ustalonym, bo losowy uczyniłby cache martwym kodem), a stałe wywołania z
 * `FIXED_CALL_OPTIONS`. Dzięki temu odcisk NIE MOŻE opisywać innego wywołania niż wysłane —
 * tak samo jak trzy zmienne `ANTHROPIC_*` nie mogą się rozjechać, bo mają jeden egzemplarz.
 */
export function productionPromptFingerprint(): string {
  return fingerprintPrompt({
    systemPrompt: SYSTEM_PROMPT,
    jsonSchema: REVIEW_JSON_SCHEMA,
    userMessageShape: wrapDiff("", FINGERPRINT_NONCE),
    callOptions: FIXED_CALL_OPTIONS,
  });
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Korzeń pakietu agenta (`agents/review/`), liczony z położenia TEGO pliku, nie z `cwd`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Materiał komórki: albo treść diffa, albo NAZWANY powód, dla którego jej nie ma. */
export type FixtureLoad = { readonly ok: true; readonly diff: string } | { readonly ok: false; readonly message: string };

/**
 * Fikstura z `vars`: DOKŁADNIE JEDNA z dwóch dróg — `diffPath` (ścieżka) albo `diff` (treść).
 *
 * ⚑ To NIE jest ozdobne walidowanie wejścia. Zmierzone przy pisaniu tej fazy, zanim padł pierwszy
 * cent: `vars: { diff: file://../sample.diff }` NIE rozwija się do treści pliku, bo
 * `loadFileReference` w promptfoo obsługuje `.json`, `.yaml`, `.js`/`.ts`, `.py`, `.txt`, `.md`
 * i brak rozszerzenia — a `.diff` odpada. Do providera trafia wtedy 21-znakowy string
 * `"file://..\\sample.diff"`, model recenzuje TĘ ŚCIEŻKĘ, zwraca poprawny kontrakt i sensownie
 * wyglądający werdykt, a cała macierz jest zielona nad materiałem, którego nikt nie przeczytał.
 * Defekt jest CICHY po obu stronach: promptfoo nie zgłasza błędu, a agent nie ma jak zauważyć,
 * że dostał ścieżkę zamiast diffa. Dlatego wartość zaczynająca się od `file://` jest tu twardą
 * odmową z nazwaną przyczyną, a nie materiałem.
 *
 * Dwie drogi zamiast jednej, bo mają różnych wywołujących i różne własności: `diffPath` obsługuje
 * fikstury z repo (i to nim jedzie macierz), `diff` — materiał zbudowany w teście, którego nie ma
 * sensu zapisywać na dysk. Rozłączność jest wymuszona: podanie obu naraz to odmowa, bo wtedy
 * pytanie „co właściwie zrecenzowano" nie ma odpowiedzi w konfiguracji.
 */
export function loadFixture(vars: Record<string, unknown> | undefined): FixtureLoad {
  const path = vars?.["diffPath"];
  const inline = vars?.["diff"];
  const hasPath = path !== undefined;
  const hasInline = inline !== undefined;

  if (hasPath && hasInline) {
    return { ok: false, message: "[config] podano naraz `diffPath` i `diff` — dokładnie jedna z nich ma być ustawiona." };
  }
  if (!hasPath && !hasInline) {
    return { ok: false, message: "[config] brak fikstury: ustaw `diffPath` (ścieżka względem `agents/review/`) albo `diff` (treść)." };
  }

  if (hasInline) {
    if (!isNonEmptyString(inline)) {
      return { ok: false, message: "[config] zmienna `diff` jest pusta albo nie jest tekstem — fikstura nie dojechała." };
    }
    if (inline.startsWith("file://")) {
      return { ok: false, message: unresolvedFileRef("diff", inline) };
    }
    return { ok: true, diff: inline };
  }

  if (!isNonEmptyString(path)) {
    return { ok: false, message: "[config] zmienna `diffPath` jest pusta albo nie jest tekstem." };
  }
  if (path.startsWith("file://")) {
    return { ok: false, message: unresolvedFileRef("diffPath", path) };
  }

  const resolved = resolve(PACKAGE_ROOT, path);
  let diff: string;
  try {
    diff = readFileSync(resolved, "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `[config] nie udało się wczytać fikstury ${JSON.stringify(path)} (${resolved}): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (diff.trim().length === 0) {
    return { ok: false, message: `[config] fikstura ${JSON.stringify(path)} jest pusta (${resolved}).` };
  }
  return { ok: true, diff };
}

function unresolvedFileRef(varName: string, value: string): string {
  return (
    `[config] zmienna \`${varName}\` niesie NIEROZWINIĘTĄ referencję ${JSON.stringify(value)}. ` +
    "promptfoo rozwija `file://` w `vars` tylko dla `.json`, `.yaml`, `.js`/`.ts`, `.py`, `.txt`, `.md` " +
    "i plików bez rozszerzenia — dla `.diff` przepuszcza ścieżkę jako TEKST, a wtedy recenzowana " +
    "jest ścieżka, nie diff. Podaj zwykłą ścieżkę względem `agents/review/` w `diffPath`."
  );
}

/** Rozpakowanie `config:` z YAML-a. Odmowa zamiast wartości domyślnej — patrz `resolveMaxBudgetUsd`. */
function parseConfig(raw: unknown, id: string): ReviewProviderConfig {
  const config = (raw ?? {}) as Partial<ReviewProviderConfig>;
  if (!isNonEmptyString(config.model)) {
    throw new Error(`[config] ${id}: brakuje \`config.model\` (pin modelu w notacji OpenRoutera).`);
  }
  if (typeof config.maxBudgetUsd !== "number" || !Number.isFinite(config.maxBudgetUsd) || config.maxBudgetUsd <= 0) {
    throw new Error(
      `[config] ${id}: \`config.maxBudgetUsd\` musi być liczbą dodatnią (otrzymano: ${JSON.stringify(config.maxBudgetUsd)}).`,
    );
  }
  return { model: config.model, maxBudgetUsd: config.maxBudgetUsd, query: config.query };
}

export default class ReviewProvider implements ApiProvider {
  readonly label: string | undefined;
  private readonly providerId: string;
  /** Publiczne, bo `ApiProvider` deklaruje `config?: any` — pole prywatne o tej nazwie nie implementuje interfejsu. */
  readonly config: ReviewProviderConfig;

  constructor(options: ProviderOptions = {}) {
    this.label = options.label;
    this.config = parseConfig(options.config, options.id ?? options.label ?? "review-provider");
    // Tożsamość niesie MODEL, a NIE `options.id` — i to jest decyzja, nie skrót. Ten sam plik jest
    // wpięty do macierzy dwa razy, więc `options.id` jest dla obu kolumn tym samym stringiem
    // (`file://provider.ts`); wzięty jako tożsamość dawałby dwie komórki nazwane identycznie, co
    // czyta się jako powtórzenie jednego pomiaru zamiast jako dwa różne.
    this.providerId = `review:${this.config.model}`;
  }

  id(): string {
    return this.providerId;
  }

  /**
   * Adapter promptfoo. Diff jedzie przez `context.vars.diff`, NIE przez `prompt` — prompt tej
   * macierzy jest znacznikiem fikstury, a materiał trafia do `wrapDiff` wewnątrz `runReview`.
   *
   * **Awaria wraca jako `{ error }`, a nie jako rzut, i to jest kontrakt, nie ostrożność.** Rzut
   * wypuszczony stąd sprawia, że promptfoo znaczy komórkę jako błąd PROVIDERA i asercji nie
   * wykonuje wcale — a wtedy regresja kontraktu wyjścia (`[contract]`, czyli jedno z dwóch pytań,
   * na które ten zestaw istnieje) wygląda identycznie jak padnięta sieć. Złapana i nazwana jest
   * czerwona ORAZ czytelna, a kryterium „`safeParse` przeszedł" daje się odczytać z raportu.
   */
  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const fixture = loadFixture(context?.vars);
    if (!fixture.ok) {
      return {
        error: `${fixture.message} (provider: ${this.providerId})`,
        metadata: { model: this.config.model, failureKind: "config" satisfies CellFailureKind, pricingAsOf: PRICING_AS_OF },
      };
    }

    const result = await runCell({
      diff: fixture.diff,
      model: this.config.model,
      maxBudgetUsd: this.config.maxBudgetUsd,
      promptFingerprint: productionPromptFingerprint(),
      query: this.config.query,
    });

    if (!result.ok) {
      // `message` niesie prefiks `[kind]` już z rzutu `runReview` — doklejenie go tutaj drugi raz
      // dałoby `[contract] [contract] …`, czyli tekst, w którym nikt nie ufa ani jednej klasie.
      return {
        error: result.message,
        metadata: { model: this.config.model, failureKind: result.failureKind, pricingAsOf: PRICING_AS_OF },
      };
    }

    return {
      output: result.review,
      cached: result.cached,
      // `cost` zostaje NIEPODANY, gdy nie da się go policzyć. Zero wpisane „dla porządku" czyta się
      // w tabeli jak „ta komórka była darmowa" — patrz `CellCost` w `pricing.ts`.
      ...(result.cost.ok ? { cost: result.cost.usd } : {}),
      tokenUsage: toTokenUsage(result.metrics),
      metadata: {
        model: result.metrics.model,
        verdict: result.review.verdict,
        numTurns: result.metrics.numTurns,
        durationMs: result.metrics.durationMs,
        terminalReason: result.metrics.terminalReason,
        cached: result.cached,
        pricingAsOf: PRICING_AS_OF,
        costUsd: result.cost.ok ? result.cost.usd : null,
        costUnavailableReason: result.cost.ok ? null : result.cost.reason,
        /** Rachunek SDK obok naszego — do porównania, NIGDY jako źródło kwoty. */
        sdkCostUsd: result.metrics.totalCostUsd ?? null,
      },
    };
  }
}

/** Metryki SDK przełożone na kształt, w którym promptfoo sumuje tokeny w swojej tabeli. */
function toTokenUsage(metrics: ReviewMetrics): TokenUsage {
  return {
    prompt: metrics.inputTokens,
    completion: metrics.outputTokens,
    cached: metrics.cacheReadInputTokens,
    numRequests: 1,
    completionDetails: {
      cacheReadInputTokens: metrics.cacheReadInputTokens,
      cacheCreationInputTokens: metrics.cacheCreationInputTokens,
    },
  };
}
