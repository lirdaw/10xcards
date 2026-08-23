import { appendFileSync } from "node:fs";
import { resolveMaxBudgetUsd, runReview } from "./run-review.ts";

/**
 * CLI agenta — i WYŁĄCZNIE CLI. Recenzja mieszka w `run-review.ts`.
 *
 * Zostaje tu tylko to, czego nie da się przenieść bez zmiany zachowania PROCESU: odczyt env,
 * odmowy z kodem wyjścia, zapis `model=` do `$GITHUB_OUTPUT`, bramka klucza (komunikat dla
 * CZŁOWIEKA przy CLI), odczyt stdin, dwie linie diagnostyczne i jedyny `console.log`.
 * Wszystkie te rzeczy są KONTRAKTAMI: `.github/actions/review-agent/action.yml:188-189` woła
 * ten plik z przekierowaniami i czyta `model=`, a `pr-review.yml:529` grepuje stderr.
 * `agents/review/review-cli.test.ts` zamraża je co do znaku.
 *
 * Trzech rzeczy tu NIE MA i to jest decyzja, nie przeoczenie: `reportFailureKind`,
 * przestawienie zmiennych `ANTHROPIC_*` i jakikolwiek `try/catch` wokół `runReview`. Dwie
 * pierwsze mieszkają w `run-review.ts` (patrz komentarze tam). Trzeciej nie ma dziś i nie może
 * się pojawić: rzut z `runReview` ma zostać unhandled rejection, bo dopiero Node drukuje go
 * OSOBNĄ LINIĄ `Error: [kind] …` nad stackiem — a to ta linia wpada w
 * `grep -m1 -E '^[A-Za-z]*Error:'` z `pr-review.yml:529`. `console.error(err.message)` skasowałby
 * prefiks `Error:`, ekstrakcja spadłaby do gałęzi „Nothing was thrown", a komentarz na publicznym
 * PR-ze zmieniłby treść. Jeśli ten plik zaczyna rosnąć, to znak, że coś, co należy do
 * `runReview`, zostało tutaj.
 */

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
 * Walidacja capa jest CZYSTA i mieszka w `run-review.ts`; tutaj zostaje wyłącznie jej skutek
 * procesowy — druk linii odmowy i kod wyjścia 1.
 *
 * Miejsce tego bloku jest KONTRAKTEM, nie stylem: stoi PRZED blokiem `$GITHUB_OUTPUT` niżej,
 * więc przebieg odrzucony na złym capie nie zapisuje `model=`. Gdyby te dwa efekty się
 * zamieniły, komentarz PR-a dostałby model dla przebiegu, który nigdy nie ruszył.
 */
const budget = resolveMaxBudgetUsd(process.env.REVIEW_MAX_BUDGET_USD);
if (!budget.ok) {
  for (const line of budget.messages) console.error(line);
  process.exit(1);
}
const REVIEW_MAX_BUDGET_USD = budget.value;

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
 * To jedyny fragment obsługi klucza, który ZOSTAJE w CLI, i zostaje z jednego powodu: jest
 * komunikatem dla CZŁOWIEKA, a nie prekondycją wywołania. Prekondycja — trzy zmienne
 * `ANTHROPIC_*` — mieszka w `runReview`, w jednym egzemplarzu, żeby CI i eval nie mogły
 * pojechać do różnych endpointów tą samą funkcją.
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

/** Diff wjeżdża przez stdin: `git diff | npx tsx review.ts` */
async function readDiff(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Zapisane PRZED wywołaniem, nie w linii metryk: metryki drukują się tylko na ścieżce sukcesu,
// a przebieg zatrzymany przez budżet z definicji tam nie dochodzi. Bez tej linii para dowodowa
// „ten sam diff, inny budżet" nie miałaby w logu żadnego śladu, czym się różniła.
console.error(
  `[konfiguracja] model: ${REVIEW_MODEL} | budżet: ${REVIEW_MAX_BUDGET_USD} USD ` +
    "(limit SDK, liczony z cennika Anthropica — przybliżenie, nie rachunek OpenRoutera)",
);

const diff = await readDiff();
if (!diff.trim()) {
  console.error("Pusty diff na wejściu. Użyj: git diff | npx tsx review.ts");
  process.exit(1);
}

// BEZ `try/catch` — patrz komentarz na górze pliku. Rzut ma dojść do Node jako unhandled
// rejection, bo tylko wtedy powstaje linia `Error: [kind] …`, którą czyta `pr-review.yml:529`.
const { review, metrics } = await runReview(diff, {
  model: REVIEW_MODEL,
  maxBudgetUsd: REVIEW_MAX_BUDGET_USD,
});

// Metryki operacyjne — na stderr, żeby nie brudzić JSON-a na stdout.
console.error(
  [
    `[metryki] model: ${metrics.model}`,
    `tury: ${metrics.numTurns}`,
    `czas: ${metrics.durationMs} ms`,
    // total_cost_usd to PRZELICZNIK z cennika Anthropica, nie rachunek OpenRoutera —
    // jedziemy przez OpenRoutera, więc ta liczba nie jest fakturą.
    `koszt (wg cennika Anthropica, nie OpenRoutera): ${metrics.totalCostUsd ?? "n/d"} USD`,
    `tokeny: ${metrics.inputTokens ?? "?"} in (bez cache)`,
    `cache: ${metrics.cacheCreationInputTokens ?? "?"} zapis / ${metrics.cacheReadInputTokens ?? "?"} odczyt`,
    `out: ${metrics.outputTokens ?? "?"}`,
    `terminal_reason: ${metrics.terminalReason ?? "n/d"}`,
  ].join(" | "),
);

console.log(JSON.stringify(review, null, 2));
