import { appendFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { REVIEW_SCHEMA, REVIEW_JSON_SCHEMA, type Review } from "./review-schema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

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
    prompt: `Zrecenzuj ten diff:\n\n${diff}`,
    options: {
      systemPrompt: SYSTEM_PROMPT, // własna rola zamiast presetu claude_code
      model: REVIEW_MODEL, // pin, nie alias — patrz komentarz przy REVIEW_MODEL
      tools: [], // ODCINAMY narzędzia: recenzja ma być wąska i przewidywalna
      maxTurns: 2, // tura 1: model czyta i ocenia | tura 2: emituje JSON wg schematu
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
        throw new Error(`Niepoprawny structured output: ${parsed.error.message}`);
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
    throw new Error(
      `Review nie powiodło się (subtype: ${message.subtype}, is_error: ${message.is_error}, ` +
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
