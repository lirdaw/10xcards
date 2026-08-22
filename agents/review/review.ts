import { appendFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { REVIEW_SCHEMA, REVIEW_JSON_SCHEMA, type Review } from "./review-schema.ts";
import { SYSTEM_PROMPT, wrapDiff } from "./prompt.ts";

/**
 * Model PRZYPIĘTY jawnie, a nie wzięty z aliasu.
 *
 * Alias `"sonnet"` nie jest identyfikatorem OpenRoutera i po prostu nie zadziała — ale pin
 * jest decyzją SAMODZIELNĄ, nie skutkiem ubocznym zmiany dostawcy: warunek wyjścia tej zmiany
 * stoi na PORÓWNANIU przebiegów sprzed i po zmianie progu, a model podmieniony pod aliasem
 * po stronie dostawcy unieważniłby to porównanie po cichu.
 *
 * Nadpisanie przez `REVIEW_MODEL` istnieje WYŁĄCZNIE dla ręcznego `workflow_dispatch`
 * (dowód czerwieni: celowo nieistniejące id modelu). Żaden automatyczny wyzwalacz go nie
 * ustawia, a rozstrzygnięta wartość ląduje w linii metryk na stderr — i to właśnie odbiera
 * temu szwowi możliwość cichej zmiany zachowania.
 */
const REVIEW_MODEL = process.env.REVIEW_MODEL?.trim() || "anthropic/claude-sonnet-4.6";

/**
 * Rozstrzygnięty model wraca do harnessu przez `$GITHUB_OUTPUT` — i to jest jedyna droga,
 * jaką wolno mu wrócić.
 *
 * Komentarz PR-a niesie identyfikator modelu, który realnie wyprodukował werdykt, a JSON wyniku
 * wypełnia LLM: model NIE MA PRAWA raportować własnej tożsamości, bo mógłby ją zmyślić i nikt
 * by tego nie sprawdził. To druga strona lekcji „wartość kontraktowa nigdy nie trafia do promptu
 * LLM" (`lessons.md:215-221`) — nie wraca też Z niego. Wartość zna ten proces, bo sam ją przed
 * chwilą rozstrzygnął, więc sam ją zapisuje.
 *
 * Mechanizm: `GITHUB_OUTPUT` wskazuje plik, który runner czyta PO zakończeniu kroku i przypisuje
 * KROKOWI, który ten proces uruchomił — dziedziczenie zmiennej przez proces potomny wystarczy.
 * Composite action wystawia tę wartość dalej jednym wpisem w `outputs:`. Alternatywy odpadły
 * z powodów, które warto tu zostawić: duplikat domyślnego id w `action.yml` to druga kopia
 * wartości kontraktowej (dokładnie to, czego ten projekt unika przy `criteria.json`), a `sed`
 * po linii metryk to bramka na TREŚCI LOGU — klasa z `lessons.md:194-199`.
 *
 * Zapis idzie PRZED wywołaniem modelu, żeby ścieżka awarii (celowo nieistniejące id modelu
 * z fazy 6) też niosła rozstrzygniętą wartość. Poza CI zmiennej nie ma i cały blok jest no-op.
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
const REVIEW_MAX_BUDGET_USD = 1.0;

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

/** Rozpoznanie po faktach STRUKTURALNYCH tam, gdzie SDK je daje; po tekście tylko tam, gdzie nie daje. */
function classifyFailure(subtype: string, terminalReason: string | null | undefined, detail: string): FailureKind {
  // SDK mówi to wprost — dwa niezależne pola, oba wystarczają.
  if (subtype === "error_max_budget_usd" || terminalReason === "budget_exhausted") return "budget";

  // Cap kredytu na kluczu OpenRoutera. SDK zna to tylko jako `api_error`, więc TU rozpoznanie
  // musi iść po tekście — i jest to jedyne miejsce w tym pliku, gdzie tak jest.
  if (/\b402\b/.test(detail) || /requires more credits|insufficient credits/i.test(detail)) return "budget";

  if (terminalReason === "api_error" || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|\b5\d\d\b/.test(detail)) return "provider";

  return "unknown";
}

/** Rodzaj awarii wraca do harnessu tą samą drogą co model — patrz komentarz niżej. */
function reportFailureKind(kind: FailureKind): void {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  try {
    appendFileSync(target, `failure-kind=${kind}
`, "utf8");
  } catch {
    // Świadomie połknięte i to jedyny taki przypadek w tym pliku: jesteśmy już na ścieżce
    // awarii, a przewrócenie się TUTAJ zastąpiłoby prawdziwą przyczynę awarią raportowania
    // o niej. Konsument traktuje brak wartości jak `unknown`, czyli fail-closed.
  }
}

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  // Wartość pochodzi z inputu `workflow_dispatch`, czyli z tekstu wpisanego przez człowieka.
  // Znak nowej linii w niej to nie literówka, tylko wstrzyknięcie DOWOLNEGO outputu do kroku —
  // stąd odmowa, a nie ucieczka znaku ani ciche obcięcie.
  if (/[\r\n]/.test(REVIEW_MODEL)) {
    console.error(`Identyfikator modelu nie może zawierać znaku nowej linii: ${JSON.stringify(REVIEW_MODEL)}`);
    process.exit(1);
  }
  // Wrapped, and it is the only write on module scope that is. Everywhere else this file ends a
  // failure with `console.error` + `process.exit(1)`; an unwrapped `appendFileSync` here would
  // leave one path — an unwritable or vanished `$GITHUB_OUTPUT` — crashing during module load
  // with a raw stack instead. Same shape of defect as the one phase 1 removed further down: not
  // "it fails" but "it fails in a way that describes the wrong thing". Found by this
  // repository's own review agent on run 32593019701.
  try {
    appendFileSync(githubOutput, `model=${REVIEW_MODEL}\n`, "utf8");
  } catch (err) {
    console.error(`Nie udało się zapisać outputu \`model\` do $GITHUB_OUTPUT: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Bez tej wartości komentarz PR-a nie zna modelu, który wyprodukował werdykt — przerywam.");
    process.exit(1);
  }
}

/**
 * Bramka klucza PRZED czytaniem stdin i przed pierwszym wywołaniem sieciowym — umiejscowienie
 * jest tu całą wartością (wzorzec z `.github/workflows/eval.yml:109-118`). Bez niej brak klucza
 * objawia się serią retry SDK i komunikatem o API, a nie o tym, czego brakuje.
 *
 * Nazwa zmiennej to `ANTHROPIC_AUTH_TOKEN`, NIGDY `OPENROUTER_API_KEY`: ta druga przerywa
 * preflight `npm test` (suita asertuje liczby kart, które gwarantuje tylko generacja mockowa),
 * więc agent czytający ją wprost zmuszałby do wyboru między review a testami.
 *
 * `trim()` nie jest kosmetyką: precedens `eval-ci-dispatch` — sekret z BOM-em przechodził
 * każdą kontrolę „czy sekret istnieje" i padał dopiero na pierwszym realnym wywołaniu.
 */
const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN?.trim() ?? "";
if (!AUTH_TOKEN) {
  console.error("Brak klucza: ustaw ANTHROPIC_AUTH_TOKEN na klucz OpenRoutera.");
  // `OPENROUTER_REVIEW_KEY`, and specifically NOT `OPENROUTER_EVAL_KEY`. This line used to name
  // the eval key and was the ONLY thing an operator sees when the key is missing — so it sent
  // them to set the one secret that `.github/actions/review-agent/action.yml` forbids here. The
  // eval's low per-key cap is that eval's blast-radius limit; a second consumer drains it (run
  // 32534464639, `402 This request requires more credits`) and makes either bill unreadable.
  console.error("W CI to sekret repozytorium OPENROUTER_REVIEW_KEY podawany NA KROK, nie na job.");
  console.error("To jest WŁASNY klucz review — nie kieruj go na OPENROUTER_EVAL_KEY, który należy do evala.");
  console.error("Lokalnie: $env:ANTHROPIC_AUTH_TOKEN = '<klucz>' na jedno wywołanie —");
  console.error("nie eksportuj go na stałe i nie używaj nazwy OPENROUTER_API_KEY (psuje npm test).");
  process.exit(1);
}

// Routing przez OpenRoutera, ustawiany na module scope — czyli PRZED pierwszym `query(...)`.
process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
process.env.ANTHROPIC_AUTH_TOKEN = AUTH_TOKEN;
// Pusty ANTHROPIC_API_KEY jest OBOWIĄZKOWY, nie porządkowy: niepusty klucz WYGRYWA
// z ANTHROPIC_AUTH_TOKEN, więc zostawiony w środowisku (np. z innego projektu) wysyła
// wywołanie w złe miejsce ze złym kluczem — awaria wyglądająca na problem z uprawnieniami.
process.env.ANTHROPIC_API_KEY = "";

/** Diff wjeżdża przez stdin: `git diff | npx tsx review.ts` */
async function readDiff(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function review(diff: string): Promise<Review> {
  const result = query({
    // `wrapDiff`, never raw interpolation: the diff is authored by the person whose change is
    // being judged, so it is UNTRUSTED text, and pasting it straight after our sentence leaves
    // the model no boundary between our instructions and theirs. See `prompt.ts` — it wraps the
    // material in named delimiters AND neutralises any copy of those delimiters inside it, so
    // the fence cannot be closed early from within.
    prompt: wrapDiff(diff),
    options: {
      systemPrompt: SYSTEM_PROMPT, // własna rola zamiast presetu claude_code
      model: REVIEW_MODEL, // pin, nie alias — patrz komentarz przy REVIEW_MODEL
      tools: [], // ODCINAMY narzędzia: recenzja ma być wąska i przewidywalna
      maxTurns: 2, // tura 1: model czyta i ocenia | tura 2: emituje JSON wg schematu
      // Limit wydatku na przebieg — patrz REVIEW_MAX_BUDGET_USD. Przekroczenie daje wynik
      // o podtypie `error_max_budget_usd`, więc zatrzymanie jest odróżnialne od awarii dostawcy.
      maxBudgetUsd: REVIEW_MAX_BUDGET_USD,
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
        throw new Error(`[contract] Niepoprawny structured output: ${parsed.error.message}`);
      }

      // Metryki operacyjne — na stderr, żeby nie brudzić JSON-a na stdout.
      console.error(
        [
          `[metryki] model: ${REVIEW_MODEL}`,
          `tury: ${message.num_turns}`,
          `czas: ${message.duration_ms} ms`,
          // total_cost_usd to PRZELICZNIK z cennika Anthropica, nie rachunek OpenRoutera —
          // jedziemy przez OpenRoutera, więc ta liczba nie jest fakturą.
          `koszt (wg cennika Anthropica, nie OpenRoutera): ${message.total_cost_usd ?? "n/d"} USD`,
          `tokeny: ${message.usage?.input_tokens ?? "?"} in (bez cache)`,
          `cache: ${message.usage?.cache_creation_input_tokens ?? "?"} zapis / ${message.usage?.cache_read_input_tokens ?? "?"} odczyt`,
          `out: ${message.usage?.output_tokens ?? "?"}`,
          `terminal_reason: ${message.terminal_reason ?? "n/d"}`,
        ].join(" | "),
      );

      return parsed.data;
    }

    // Błąd łapiemy sami — inaczej SDK rzuci surowym wyjątkiem zamiast czytelnego komunikatu.
    // Komunikat MUSI nieść `terminal_reason` i tekst z SDK: to jest realna przyczyna
    // (np. `api_error` / `ENOTFOUND`), której połknięcie wysyłało operatora w złą stronę.
    // `result` żyje na wariancie success, `errors` na wariancie error — stąd dwa odczyty.
    const detail = "result" in message ? message.result : message.errors.join("; ");
    const kind = classifyFailure(message.subtype, message.terminal_reason, detail);
    reportFailureKind(kind);
    throw new Error(
      `[${kind}] Review nie powiodło się (subtype: ${message.subtype}, is_error: ${message.is_error}, ` +
        `terminal_reason: ${message.terminal_reason ?? "n/d"}): ${detail || "brak szczegółów"}`,
    );
  }

  throw new Error("Agent nie zwrócił wyniku");
}

const diff = await readDiff();
if (!diff.trim()) {
  console.error("Pusty diff na wejściu. Użyj: git diff | npx tsx review.ts");
  process.exit(1);
}
console.log(JSON.stringify(await review(diff), null, 2));
