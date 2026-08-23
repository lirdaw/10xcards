import { appendFileSync } from "node:fs";
import { query as sdkQuery, type Options, type SDKMessage, type TerminalReason } from "@anthropic-ai/claude-agent-sdk";
import { REVIEW_SCHEMA, REVIEW_JSON_SCHEMA, type Review } from "./review-schema.ts";
import { SYSTEM_PROMPT, wrapDiff } from "./prompt.ts";

/**
 * Recenzja jako FUNKCJA — jedna, ta sama dla CI i dla zestawu evali.
 *
 * Powód wydzielenia jest kontraktowy, nie estetyczny: eval, który wywołuje agenta WŁASNYM
 * wywołaniem SDK, mierzy własną kopię ścieżki — bez `wrapDiff` z noncem, bez walidacji zodem,
 * bez klasyfikacji awarii — i jego zieleń nie mówi nic o tym, co robi CI. Jedna funkcja czyni
 * ten rozjazd niemożliwym PRZEZ KONSTRUKCJĘ, a nie przez czujność autora providera.
 *
 * Ta funkcja NICZEGO NIE DRUKUJE i nie woła `process.exit`. Formatowanie linii `[metryki]`
 * i wszystkie kody wyjścia zostają w `review.ts` — bo to KONTRAKTY CLI, czytane przez
 * `.github/actions/review-agent/action.yml` i `.github/workflows/pr-review.yml`, a nie
 * własność recenzji.
 */

/**
 * Limit wydatku na JEDEN przebieg, wyrażony w tej samej walucie co problem.
 *
 * Cap na bajty diffa w `pr-review.yml` zostaje, ale jest tym, czym jest: grubym filtrem
 * patologii. Nie da się nim uzasadnić żadnej kwoty, bo bajty wejścia nie przeliczają się na
 * rachunek — zmierzone: przebieg 32594772192 miał 222 051 bajtów, przeszedł cap 250 000
 * i dopiero dostawca odmówił, bo żądane 32 000 tokenów wyjścia nie mieściło się w 23 132
 * dostępnych. Wejście i koszt to dwie różne wielkości.
 *
 * `maxBudgetUsd` jest właściwą osią: SDK zatrzymuje zapytanie po przekroczeniu i zwraca wynik
 * o podtypie `error_max_budget_usd` (`sdk.d.ts:1727-1730`, `:4586`), czyli fakt strukturalny,
 * a nie tekst do zgadywania.
 *
 * **Zastrzeżenie, bez którego ta liczba kłamie:** SDK liczy koszt z cennika ANTHROPICA, a my
 * jedziemy przez OpenRoutera — więc to jest PRZYBLIŻENIE, nie rachunek. Ale jest to przybliżenie
 * właściwej wielkości, w odróżnieniu od bajtów, które nie przybliżają jej wcale.
 *
 * Wartość: zmierzone przebiegi to 0,0934 USD (fikstura) i 0,4426 USD (realny diff 2 711 linii).
 * 1,00 USD daje ponad dwukrotny zapas nad największym zaobserwowanym i zatrzymuje przebieg,
 * zanim koszt stanie się niespodzianką. Podnoszenie ma iść za liczbą z przebiegu.
 */
const DEFAULT_MAX_BUDGET_USD = 1.0;

/** Wynik walidacji capa: albo liczba, albo komplet linii odmowy — bez druku i bez `exit`. */
export type MaxBudgetResolution =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly messages: readonly string[] };

/**
 * Nadpisanie istnieje WYŁĄCZNIE po to, żeby dało się dowieść, że ten limit działa.
 *
 * Bez tego szwu jedyną drogą do próby byłoby doprowadzenie realnego przebiegu do wydania
 * dolara — czyli bramka, której sprawdzenie kosztuje tyle, co jej brak. Ten sam układ, co przy
 * `REVIEW_MODEL`: nadpisanie podaje się ręcznie przy `workflow_dispatch`, żaden automatyczny
 * wyzwalacz go nie ustawia, a rozstrzygnięta wartość ląduje w logu — i to jest to, co odbiera
 * temu szwowi możliwość cichej zmiany zachowania.
 *
 * Odmowa zamiast cichego fallbacku na wartość domyślną: gdyby literówka w inpucie zwijała się
 * do 1.00, przebieg dowodowy „budżet 0.01" pojechałby na produkcyjnym limicie i skończył się
 * zielono — czyli para dowodowa pokazałaby zieleń w obu przebiegach i została odczytana jako
 * „limit nie działa", zamiast jako „limitu nie podano".
 *
 * Funkcja jest CZYSTA: linie odmowy WRACAJĄ, zamiast lądować na stderr stąd. Drukuje je i kończy
 * proces `review.ts` — bo to on jest CLI, i to jego kod wyjścia czyta composite action. Treść
 * linii zostaje w JEDNYM egzemplarzu, tutaj, więc siatka z fazy 1 nie ma czego z czym rozjechać.
 */
export function resolveMaxBudgetUsd(raw: string | undefined): MaxBudgetResolution {
  const text = raw?.trim();
  if (!text) return { ok: true, value: DEFAULT_MAX_BUDGET_USD };

  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      messages: [
        `REVIEW_MAX_BUDGET_USD musi być liczbą dodatnią (otrzymano: ${JSON.stringify(raw)}).`,
        "Zostawienie pustej wartości bierze limit domyślny; wartość niepoprawna to błąd, nie fallback.",
      ],
    };
  }
  return { ok: true, value };
}

/**
 * Trzy nazwane rodzaje awarii — bo „budżet wyczerpany" to NIE to samo co „dostawca padł".
 *
 * Bez tego rozróżnienia 402 z OpenRoutera czyta się jak awaria API, a jest DECYZJĄ naszego
 * limitu: nikt nic nie zepsuł, skończył się kredyt na kluczu. Operator, który przeczyta
 * „dostawca padł", pójdzie szukać incydentu u dostawcy zamiast doładować klucz.
 *
 * - `budget`   — zatrzymał nas WŁASNY limit: `maxBudgetUsd` SDK albo cap kredytu na kluczu (402).
 * - `provider` — dostawca albo sieć naprawdę zawiodły (inne `api_error`, `ENOTFOUND`, 5xx).
 * - `contract` — agent pojechał, ale wyjście nie spełniło kontraktu (structured output).
 * - `unknown`  — nie rozpoznaliśmy. Świadomie osobna wartość, a nie „na pewno provider":
 *                domyślne wrzucanie nieznanego do awarii dostawcy jest dokładnie tym
 *                mylącym przypisaniem, które ta klasyfikacja ma zlikwidować.
 */
export type FailureKind = "budget" | "provider" | "contract" | "unknown";

/**
 * Rzut recenzji niesie `FailureKind` STRUKTURALNIE, obok komunikatu — nie zamiast niego.
 *
 * Powód jest jeden i pochodzi od drugiego konsumenta tej funkcji. CI czyta rodzaj awarii z tekstu,
 * bo jego kanałem jest stderr i nic innego mieć nie może: `pr-review.yml:529` wyciąga powód przez
 * `grep -m1 -E '^[A-Za-z]*Error:'`. Provider evali woła tę funkcję W TYM SAMYM PROCESIE i gdyby
 * wyłuskiwał `[kind]` z `err.message`, zbudowałby bramkę na TREŚCI komunikatu (`lessons.md`:
 * „Wartość kontraktowa … nigdy nie trafia do promptu" ma tę samą oś — jedna wartość, jedna rola)
 * między dwoma plikami tego samego pakietu. Pole załatwia to bez ani jednego parsowania.
 *
 * **Kształt rzutu nie zmienia się o bajt** i to jest tu warunek, nie uwaga: prototypem zostaje
 * `Error` (żadnej podklasy), więc unhandled rejection nadal drukuje `Error: [kind] …` — dokładnie
 * tę linię, którą tamten `grep` czyta i której kształt zmierzono na przebiegu 32534464639.
 * Podklasa nazwałaby tę linię inaczej (`ReviewError:`) i zmieniłaby treść komentarza na publicznym
 * PR-ze, mimo że sam regex by ją jeszcze złapał.
 */
export interface ReviewFailure extends Error {
  readonly kind: FailureKind;
}

/** Strażnik dla drugiego konsumenta: rzut BEZ pola `kind` istnieje i nie wolno go udawać. */
export function isReviewFailure(err: unknown): err is ReviewFailure {
  return err instanceof Error && typeof (err as { kind?: unknown }).kind === "string";
}

/** Jedyne miejsce, które składa rzut recenzji — żeby prefiks i pole nie mogły się rozjechać. */
function reviewFailure(kind: FailureKind, detail: string): ReviewFailure {
  return Object.assign(new Error(`[${kind}] ${detail}`), { kind });
}

/** Rozpoznanie po faktach STRUKTURALNYCH tam, gdzie SDK je daje; po tekście tylko tam, gdzie nie daje. */
export function classifyFailure(
  subtype: string,
  terminalReason: string | null | undefined,
  detail: string,
): FailureKind {
  // SDK mówi to wprost — dwa niezależne pola, oba wystarczają.
  if (subtype === "error_max_budget_usd" || terminalReason === "budget_exhausted") return "budget";

  // Cap kredytu na kluczu OpenRoutera. SDK zna to tylko jako `api_error`, więc TU rozpoznanie
  // musi iść po tekście — i jest to jedyne miejsce w tym pliku, gdzie tak jest.
  if (/\b402\b/.test(detail) || /requires more credits|insufficient credits/i.test(detail)) return "budget";

  if (terminalReason === "api_error" || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|\b5\d\d\b/.test(detail)) return "provider";

  return "unknown";
}

/**
 * Rodzaj awarii wraca do harnessu tą samą drogą co model — patrz komentarz przy zapisie `model=`
 * w `review.ts`.
 *
 * Ta funkcja mieszka TUTAJ, a nie w wrapperze, mimo że jest efektem na `$GITHUB_OUTPUT`.
 * Jest wołana z DWÓCH miejsc na ścieżce awarii recenzji, a jedyną drogą, którą wrapper mógłby
 * poznać `FailureKind`, byłoby wyłuskanie `[kind]` z treści komunikatu — czyli bramka na TREŚCI
 * (`lessons.md:194-199`), w dodatku między dwoma plikami tego samego pakietu. Do tego wrapper
 * musiałby wtedy złapać rzut, a to kasuje linię `Error:`, którą czyta `pr-review.yml:529`.
 *
 * Poza CI jest CICHA: `GITHUB_OUTPUT` nie istnieje, więc w evalu nie zostawia żadnego śladu.
 */
function reportFailureKind(kind: FailureKind): void {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  try {
    appendFileSync(target, `failure-kind=${kind}\n`, "utf8");
  } catch {
    // Świadomie połknięte i to jedyny taki przypadek w tym pliku: jesteśmy już na ścieżce
    // awarii, a przewrócenie się TUTAJ zastąpiłoby prawdziwą przyczynę awarią raportowania
    // o niej. Konsument traktuje brak wartości jak `unknown`, czyli fail-closed.
  }
}

/**
 * Wywołanie SDK zwężone do tego, czego ta funkcja naprawdę używa: `for await` po wiadomościach.
 *
 * Węższy typ niż `typeof query` jest tu celem, nie skrótem — stub w teście ma być
 * async-generatorem na kilka linijek, a nie atrapą całego interfejsu `Query`.
 */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

/** Wszystko, co linia `[metryki]` składa dziś w tekst — jako DANE. Formatowanie należy do CLI. */
export interface ReviewMetrics {
  /** Model ROZSTRZYGNIĘTY przez wywołującego, nie zaraportowany przez model o sobie samym. */
  readonly model: string;
  readonly numTurns: number;
  readonly durationMs: number;
  /** PRZELICZNIK z cennika Anthropica, nie rachunek OpenRoutera — patrz `DEFAULT_MAX_BUDGET_USD`. */
  readonly totalCostUsd: number | undefined;
  readonly inputTokens: number | undefined;
  readonly cacheCreationInputTokens: number | undefined;
  readonly cacheReadInputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly terminalReason: TerminalReason | undefined;
}

export interface RunReviewOptions {
  /** Pin, nie alias — rozstrzyga wywołujący, patrz `REVIEW_MODEL` w `review.ts`. */
  readonly model: string;
  /** Limit SDK na przebieg; walidację ma za sobą (`resolveMaxBudgetUsd`). */
  readonly maxBudgetUsd: number;
  /**
   * `query` jest wstrzykiwalny WYŁĄCZNIE po to, żeby test mógł być deterministyczny —
   * dokładnie tak, jak `nonce` w `wrapDiff` (`prompt.ts:299`). Domyślną wartością jest
   * prawdziwe `query` z SDK, więc żadna ścieżka produkcyjna go nie podaje.
   */
  readonly query?: QueryFn;
}

export interface RunReviewResult {
  readonly review: Review;
  readonly metrics: ReviewMetrics;
}

/**
 * Stałe opcje wywołania SDK — te, które nie zależą ani od materiału, ani od modelu, ani od capa.
 *
 * Wyniesione ze środka `query(...)` do JEDNEGO egzemplarza z tego samego powodu, dla którego
 * jednym egzemplarzem są trzy zmienne `ANTHROPIC_*`: ma je czytać jeszcze KTOŚ POZA tą funkcją.
 * Tym kimś jest odcisk cache'u zestawu evali (`evals/cache.ts`), któremu wolno serwować stary
 * wynik wyłącznie wtedy, gdy CAŁE wywołanie jest to samo. Zapisane tu literałem, a odciśnięte
 * tam z kopii, dawałyby cache trafiający po zmianie `maxTurns` — czyli nieświeży wynik podany
 * jako zielona bramka.
 */
export const FIXED_CALL_OPTIONS = {
  /** ODCINAMY narzędzia: recenzja ma być wąska i przewidywalna. */
  tools: [] as readonly string[],
  /**
   * tura 1: model czyta i ocenia | tura 2: emituje JSON wg schematu.
   *
   * ⚑ To jest ZAŁOŻENIE O WIELKOŚCI I KSZTAŁCIE WEJŚCIA, nie własność agenta — ten sam limit
   * wystarcza na `sample.diff` i nie wystarcza na kontroli negatywnej (`error_max_turns`).
   * Warunek zmiany opisany w planie zmiany `code-review-evals` jako Open Risk 4.
   */
  maxTurns: 2,
} as const;

/**
 * Ta sama funkcja jedzie w CI i w evalu. Przy awarii RZUCA, niosąc `[FailureKind]` na początku
 * komunikatu — bo to ten prefiks, po sformatowaniu przez Node jako unhandled rejection, trafia
 * w `grep -m1 -E '^[A-Za-z]*Error:'` z `pr-review.yml:529`.
 */
export async function runReview(
  diff: string,
  { model, maxBudgetUsd, query = sdkQuery }: RunReviewOptions,
): Promise<RunReviewResult> {
  // Routing przez OpenRoutera ustawiany TUTAJ, czyli w jednym egzemplarzu i zawsze PRZED
  // pierwszym `query(...)`. Gdyby te trzy przypisania zostały po stronie CLI, provider evali
  // musiałby je odtworzyć — a wtedy CI i eval jadą do INNEGO endpointu z INNĄ precedencją
  // poświadczeń, tą samą funkcją, i nic w wyniku o tym nie mówi.
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim() ?? "";
  process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
  process.env.ANTHROPIC_AUTH_TOKEN = authToken;
  // Pusty ANTHROPIC_API_KEY jest OBOWIĄZKOWY, nie porządkowy: niepusty klucz WYGRYWA
  // z ANTHROPIC_AUTH_TOKEN, więc zostawiony w środowisku (np. z innego projektu) wysyła
  // wywołanie w złe miejsce ze złym kluczem — awaria wyglądająca na problem z uprawnieniami.
  process.env.ANTHROPIC_API_KEY = "";

  const result = query({
    // `wrapDiff`, never raw interpolation: the diff is authored by the person whose change is
    // being judged, so it is UNTRUSTED text, and pasting it straight after our sentence leaves
    // the model no boundary between our instructions and theirs. See `prompt.ts` — it wraps the
    // material in named delimiters AND neutralises any copy of those delimiters inside it, so
    // the fence cannot be closed early from within.
    prompt: wrapDiff(diff),
    options: {
      systemPrompt: SYSTEM_PROMPT, // własna rola zamiast presetu claude_code
      model, // pin, nie alias — patrz komentarz przy REVIEW_MODEL
      // Stałe wywołania z JEDNEGO egzemplarza — patrz `FIXED_CALL_OPTIONS`. Literał w tym
      // miejscu byłby drugą kopią, a jej drugim czytelnikiem jest odcisk cache'u evali.
      tools: [...FIXED_CALL_OPTIONS.tools],
      maxTurns: FIXED_CALL_OPTIONS.maxTurns,
      // Limit wydatku na przebieg — patrz DEFAULT_MAX_BUDGET_USD. Przekroczenie daje wynik
      // o podtypie `error_max_budget_usd`, więc zatrzymanie jest odróżnialne od awarii dostawcy.
      maxBudgetUsd,
      outputFormat: { type: "json_schema", schema: REVIEW_JSON_SCHEMA },
    },
  });

  for await (const message of result) {
    if (message.type !== "result") continue;

    // Sam `subtype === "success"` to FAŁSZYWY ORAKL: przy awarii łączności SDK zwraca
    // `subtype: "success"` RAZEM z `is_error: true`, `terminal_reason: "api_error"`
    // i `structured_output: undefined`. Taki wynik wchodził do walidacji zodem i agent
    // raportował „Niepoprawny structured output" — diagnozę kontraktu wyjścia zamiast
    // realnej przyczyny. Sukces rozstrzygamy więc na OBU polach naraz.
    if (message.subtype === "success" && message.is_error !== true) {
      // structured_output jest typowane jako unknown — parsujemy po swojemu,
      // żeby mieć gwarancję typu Review, a nie samą obietnicę SDK.
      const parsed = REVIEW_SCHEMA.safeParse(message.structured_output);
      if (!parsed.success) {
        reportFailureKind("contract");
        throw reviewFailure("contract", `Niepoprawny structured output: ${parsed.error.message}`);
      }

      // Metryki jako DANE — surowe wartości z SDK, łącznie z ich brakiem. Podstawienie tutaj
      // „n/d" albo zera zamieniłoby „SDK nie podało" na „SDK podało zero", a tej różnicy nie
      // dałoby się już odzyskać ani w linii `[metryki]`, ani w rachunku evala.
      return {
        review: parsed.data,
        metrics: {
          model,
          numTurns: message.num_turns,
          durationMs: message.duration_ms,
          totalCostUsd: message.total_cost_usd,
          inputTokens: message.usage?.input_tokens,
          cacheCreationInputTokens: message.usage?.cache_creation_input_tokens,
          cacheReadInputTokens: message.usage?.cache_read_input_tokens,
          outputTokens: message.usage?.output_tokens,
          terminalReason: message.terminal_reason,
        },
      };
    }

    // Błąd łapiemy sami — inaczej SDK rzuci surowym wyjątkiem zamiast czytelnego komunikatu.
    // Komunikat MUSI nieść `terminal_reason` i tekst z SDK: to jest realna przyczyna
    // (np. `api_error` / `ENOTFOUND`), której połknięcie wysyłało operatora w złą stronę.
    // `result` żyje na wariancie success, `errors` na wariancie error — stąd dwa odczyty.
    const detail = "result" in message ? message.result : message.errors.join("; ");
    const kind = classifyFailure(message.subtype, message.terminal_reason, detail);
    reportFailureKind(kind);
    throw reviewFailure(
      kind,
      `Review nie powiodło się (subtype: ${message.subtype}, is_error: ${message.is_error}, ` +
        `terminal_reason: ${message.terminal_reason ?? "n/d"}): ${detail || "brak szczegółów"}`,
    );
  }

  // Jedyny rzut tej funkcji BEZ `FailureKind` — i zostaje bez niego świadomie. Dorobienie prefiksu
  // zmieniłoby linię, którą czyta `pr-review.yml:529`, a zgadnięcie klasy („na pewno provider")
  // jest dokładnie tym mylącym przypisaniem, które `FailureKind` ma likwidować: strumień skończył
  // się bez wiadomości `result`, więc nie wiemy, kto zawiódł. Drugi konsument ma na to `unknown`
  // przez `isReviewFailure` zwracające `false`.
  throw new Error("Agent nie zwrócił wyniku");
}
