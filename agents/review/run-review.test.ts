// Testy WYDZIELONEJ funkcji recenzji — czyli pokrycie, którego przed szwem nie dało się napisać.
//
// Siatka procesowa z `review-cli.test.ts` zamraża kontrakty CLI, ale wszystkie jej cztery
// przypadki kończą się PRZED pierwszym `query(...)`. Ścieżka awarii recenzji — ta, na której
// powstaje `[kind]` w komunikacie i `failure-kind=` w `$GITHUB_OUTPUT` — jest dla niej
// z definicji niewidoczna. Ten plik ją domyka, i robi to bez ANI JEDNEGO wywołania modelu:
// `runReview` przyjmuje wstrzykiwalny `query`, dokładnie jak `wrapDiff` przyjmuje `nonce`.
//
// Runner: `node:test` pod gołym `node --experimental-strip-types`, wzorem `prompt.test.ts`
// i z tego samego powodu (granica `agents/**` z `AGENTS.md` §Hard Rules). RÓŻNICA wobec
// `prompt.test.ts` jest ta sama co przy `review-cli.test.ts`: ten plik MA zależność runtime
// (importuje SDK przez `run-review.ts`), więc nie może dołączyć do kroku w
// `.github/workflows/prompt-ratchet.yml`, który świadomie biegnie bez `npm ci`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  NonNullableUsage,
  SDKMessage,
  SDKResultError,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import { CRITERIA } from "./review-schema.ts";
import { runReview, type FailureKind, type QueryFn } from "./run-review.ts";

const MODEL = "anthropic/claude-sonnet-4.6";
/** Cap bez znaczenia dla tych przypadków — żaden z nich nie dochodzi do SDK. */
const MAX_BUDGET_USD = 0.6;
const DIFF = "diff --git a/x.ts b/x.ts\n+const x = 1;\n";

/**
 * Fikstury wiadomości SDK opisane przez `Pick<...>` z PRAWDZIWYCH typów SDK, a nie przez własny
 * interfejs obok nich.
 *
 * Powód jest ratchetowy: `Pick` po nazwie pola nie skompiluje się, gdy SDK to pole przemianuje
 * albo usunie — czyli rozjazd między tym, co czyta `runReview`, a tym, co SDK naprawdę wysyła,
 * czerwieni się TUTAJ, zamiast objawić się dopiero na przebiegu za pieniądze. Wypisanie
 * kompletnych literałów `SDKResultSuccess` / `SDKResultError` odpada z innego powodu: wymagałoby
 * kilkunastu zagnieżdżonych obiektów, których ta funkcja nigdy nie czyta, a każde nowe pole
 * w SDK czerwieniłoby ten plik z powodu niezwiązanego z recenzją.
 */
type UsageFixture = Pick<
  NonNullableUsage,
  "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens"
>;

type SuccessFixture = Pick<
  SDKResultSuccess,
  | "type"
  | "subtype"
  | "is_error"
  | "num_turns"
  | "duration_ms"
  | "total_cost_usd"
  | "terminal_reason"
  | "result"
  | "structured_output"
> & { readonly usage: UsageFixture };

type ErrorFixture = Pick<
  SDKResultError,
  "type" | "subtype" | "is_error" | "num_turns" | "duration_ms" | "total_cost_usd" | "terminal_reason" | "errors"
> & { readonly usage: UsageFixture };

const USAGE: UsageFixture = {
  input_tokens: 1234,
  output_tokens: 567,
  cache_creation_input_tokens: 89,
  cache_read_input_tokens: 4321,
};

/**
 * Stub `query` — async generator na kilka linijek, bo `runReview` używa wyłącznie `for await`.
 *
 * Jedyne rzutowanie w tym pliku i jedyne, którego nie da się uniknąć: `SDKMessage` to unia
 * kilkudziesięciu wariantów z kilkunastoma polami wymaganymi na wariant. Rzutowanie NIE ukrywa
 * literówki w nazwie pola — te pilnują `Pick`i wyżej; zdejmuje wyłącznie obowiązek wypełnienia
 * pól, których recenzja nie czyta.
 */
function stubQuery(...messages: readonly (SuccessFixture | ErrorFixture)[]): QueryFn {
  return () =>
    (async function* stubbed() {
      for (const message of messages) yield message as unknown as SDKMessage;
    })();
}

/** Poprawne wyjście modelu, budowane Z TABLICY kryteriów — żeby nie było tu drugiej jej kopii. */
function validReviewOutput(): Record<string, unknown> {
  const output: Record<string, unknown> = { verdict: "pass", summary: "Zmiana wygląda porządnie." };
  for (const criterion of CRITERIA) {
    // Kryteria warunkowe dostają `null` — czyli ZMIERZONY wariant `anyOf: [{number},{null}]`,
    // ten, o którym komentarz w `review-schema.ts` mówi, że przeszedł przez structured output.
    output[criterion.key] = criterion.conditional ? null : 7;
    output[criterion.noteKey] = `nota: ${criterion.label}`;
  }
  return output;
}

interface FailureObservation {
  /** Komunikat rzutu — to on, po sformatowaniu przez Node, wpada w grep z `pr-review.yml:529`. */
  readonly message: string;
  /** Zawartość pliku po przebiegu BEZ `$GITHUB_OUTPUT` — dowód, że w evalu funkcja jest cicha. */
  readonly writtenWithoutGithubOutput: string;
  /** Zawartość TEGO SAMEGO pliku po następnym przebiegu, już Z podstawioną zmienną. */
  readonly writtenWithGithubOutput: string;
}

/**
 * Puszcza ten sam przypadek DWA razy na tym samym pliku: NAJPIERW bez `$GITHUB_OUTPUT`, potem z.
 *
 * Kolejność jest tu warunkiem poprawności, nie porządkiem. `reportFailureKind` DOPISUJE
 * (`appendFileSync`), więc przebieg z ustawioną zmienną zostawia bajty, których żaden późniejszy
 * odczyt już nie odróżni od bajtów przebiegu bez niej — pusty plik jest falsyfikowalnym oraklem
 * tylko wtedy, gdy czyta się go PRZED pierwszym dopisaniem.
 *
 * Połowa „bez zmiennej" nie jest ozdobą: `reportFailureKind` mieszka wewnątrz `runReview`
 * (a nie w wrapperze) i to jest decyzja tej fazy — więc trzeba POKAZAĆ, że poza CI, gdzie tej
 * zmiennej nie ma, funkcja nie zostawia po sobie żadnego śladu.
 */
async function observeFailure(
  messages: readonly (SuccessFixture | ErrorFixture)[],
): Promise<FailureObservation> {
  const dir = mkdtempSync(join(tmpdir(), "run-review-test-"));
  const githubOutputPath = join(dir, "github-output");
  // Runner tworzy ten plik PRZED krokiem, więc pusty plik jest wierniejszy niż jego brak.
  writeFileSync(githubOutputPath, "", "utf8");
  const previous = process.env.GITHUB_OUTPUT;

  const run = async (): Promise<string> => {
    try {
      await runReview(DIFF, { model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, query: stubQuery(...messages) });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    assert.fail("runReview nie rzuciło — a ten przypadek jest ścieżką awarii");
  };

  try {
    delete process.env.GITHUB_OUTPUT;
    const message = await run();
    const writtenWithoutGithubOutput = readFileSync(githubOutputPath, "utf8");

    process.env.GITHUB_OUTPUT = githubOutputPath;
    const messageWithGithubOutput = await run();
    // Ten sam przypadek ma dawać ten sam komunikat niezależnie od obecności zmiennej CI.
    assert.equal(messageWithGithubOutput, message, "komunikat rzutu zależy od $GITHUB_OUTPUT");

    return {
      message,
      writtenWithoutGithubOutput,
      writtenWithGithubOutput: readFileSync(githubOutputPath, "utf8"),
    };
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Para asercji, którą siatka procesowa z fazy 1 nie umiała postawić — i dopiero razem pokrywają
 * ścieżkę awarii recenzji:
 *
 * (a) komunikat zaczyna się od `[kind]`, bo to ten prefiks trafia w
 *     `grep -m1 -E '^[A-Za-z]*Error:'` z `pr-review.yml:529` i mówi czytelnikowi komentarza,
 *     czy zawiódł dostawca, czy kontrakt wyjścia;
 * (b) `$GITHUB_OUTPUT` dostaje DOKŁADNIE `failure-kind=<kind>\n` — ani bajtu więcej — a bez tej
 *     zmiennej nie dostaje niczego.
 */
function assertFailure(observed: FailureObservation, kind: FailureKind, expectedPrefix: string): void {
  assert.ok(
    observed.message.startsWith(expectedPrefix),
    `komunikat nie zaczyna się od ${JSON.stringify(expectedPrefix)}: ${observed.message}`,
  );
  assert.equal(observed.writtenWithGithubOutput, `failure-kind=${kind}\n`);
  assert.equal(observed.writtenWithoutGithubOutput, "");
}

test("sukces: kontrakt dziewięciu ocen i dziewięciu not wraca sparsowany, metryki jako dane", async () => {
  const { review, metrics } = await runReview(DIFF, {
    model: MODEL,
    maxBudgetUsd: MAX_BUDGET_USD,
    query: stubQuery({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 2,
      duration_ms: 41_234,
      total_cost_usd: 0.0934,
      terminal_reason: "completed",
      result: "gotowe",
      structured_output: validReviewOutput(),
      usage: USAGE,
    }),
  });

  // Dziewięć ocen + dziewięć not + `verdict` + `summary`. Liczba jest tu ORAKLEM: dołożenie
  // kryterium bez dołożenia noty (albo odwrotnie) świeci się na czerwono właśnie tutaj.
  assert.equal(Object.keys(review).length, 20);
  assert.equal(CRITERIA.length, 9);
  for (const criterion of CRITERIA) {
    assert.equal(review[criterion.key], criterion.conditional ? null : 7, `ocena: ${criterion.key}`);
    assert.equal(review[criterion.noteKey], `nota: ${criterion.label}`, `nota: ${criterion.noteKey}`);
  }
  assert.equal(review.verdict, "pass");
  assert.equal(review.summary, "Zmiana wygląda porządnie.");

  // Metryki wracają jako DANE — surowe wartości z SDK, bez „n/d" i bez zer podstawionych za brak.
  // Formatowanie linii `[metryki]` należy do `review.ts` i to je zamraża `review-cli.test.ts`.
  assert.deepEqual(metrics, {
    model: MODEL,
    numTurns: 2,
    durationMs: 41_234,
    totalCostUsd: 0.0934,
    inputTokens: 1234,
    cacheCreationInputTokens: 89,
    cacheReadInputTokens: 4321,
    outputTokens: 567,
    terminalReason: "completed",
  });
});

test("routing przez OpenRoutera ustawia SAMA runReview — jeden egzemplarz prekondycji", async () => {
  // TO jest szew, przed którym broni ta faza. Gdyby te trzy przypisania zostały po stronie CLI,
  // provider evali musiałby je odtworzyć — a wtedy CI i eval jadą tą samą funkcją do INNEGO
  // endpointu, z INNĄ precedencją poświadczeń, i nic w wyniku o tym nie mówi. Niepusty
  // ANTHROPIC_API_KEY WYGRYWA z ANTHROPIC_AUTH_TOKEN, więc jego wyzerowanie jest częścią
  // prekondycji, a nie porządkami.
  const previous = {
    token: process.env.ANTHROPIC_AUTH_TOKEN,
    key: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  };

  try {
    process.env.ANTHROPIC_AUTH_TOKEN = "  test-token  ";
    process.env.ANTHROPIC_API_KEY = "klucz-z-innego-projektu";
    delete process.env.ANTHROPIC_BASE_URL;

    await runReview(DIFF, {
      model: MODEL,
      maxBudgetUsd: MAX_BUDGET_USD,
      query: stubQuery({
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 2,
        duration_ms: 1,
        total_cost_usd: 0.1,
        terminal_reason: "completed",
        result: "gotowe",
        structured_output: validReviewOutput(),
        usage: USAGE,
      }),
    });

    assert.equal(process.env.ANTHROPIC_BASE_URL, "https://openrouter.ai/api");
    // `trim()` nie jest kosmetyką: precedens `eval-ci-dispatch` — sekret z BOM-em przechodził
    // każdą kontrolę „czy sekret istnieje" i padał dopiero na pierwszym realnym wywołaniu.
    assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, "test-token");
    assert.equal(process.env.ANTHROPIC_API_KEY, "");
  } finally {
    for (const [name, value] of [
      ["ANTHROPIC_AUTH_TOKEN", previous.token],
      ["ANTHROPIC_API_KEY", previous.key],
      ["ANTHROPIC_BASE_URL", previous.baseUrl],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("[contract]: wyjście łamiące schemat — rzut i `failure-kind=contract`", async () => {
  const broken = validReviewOutput();
  delete broken.summary;

  const observed = await observeFailure([
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 2,
      duration_ms: 1,
      total_cost_usd: 0.1,
      terminal_reason: "completed",
      result: "gotowe",
      structured_output: broken,
      usage: USAGE,
    },
  ]);

  assertFailure(observed, "contract", "[contract] Niepoprawny structured output: ");
});

test("[provider]: `subtype` inny niż success — rzut i `failure-kind=provider`", async () => {
  const observed = await observeFailure([
    {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 1,
      duration_ms: 1,
      total_cost_usd: 0,
      terminal_reason: "api_error",
      errors: ["upstream connect error"],
      usage: USAGE,
    },
  ]);

  assertFailure(observed, "provider", "[provider] Review nie powiodło się (subtype: error_during_execution, ");
  // `errors` wariantu error, nie `result` — komunikat MUSI nieść realną przyczyną z SDK,
  // bo jej połknięcie wysyłało operatora szukać incydentu tam, gdzie go nie było.
  assert.ok(observed.message.endsWith("upstream connect error"), observed.message);
});

test("[provider]: `subtype: success` RAZEM z `is_error: true` — fałszywy orakl nie przechodzi", async () => {
  // Ten przypadek jest powodem, dla którego sukces rozstrzygamy na OBU polach naraz. Przy awarii
  // łączności SDK zwraca `subtype: "success"` z `is_error: true` i `structured_output: undefined`;
  // wcześniejsza wersja wpuszczała go do zoda i raportowała „Niepoprawny structured output" —
  // diagnozę kontraktu wyjścia zamiast realnej przyczyny.
  const observed = await observeFailure([
    {
      type: "result",
      subtype: "success",
      is_error: true,
      num_turns: 1,
      duration_ms: 1,
      total_cost_usd: 0,
      terminal_reason: "api_error",
      result: "getaddrinfo ENOTFOUND openrouter.ai",
      structured_output: undefined,
      usage: USAGE,
    },
  ]);

  assertFailure(observed, "provider", "[provider] Review nie powiodło się (subtype: success, is_error: true, ");
});

test("[budget]: `error_max_budget_usd` — rzut i `failure-kind=budget`", async () => {
  const observed = await observeFailure([
    {
      type: "result",
      subtype: "error_max_budget_usd",
      is_error: true,
      num_turns: 2,
      duration_ms: 1,
      total_cost_usd: 0.61,
      terminal_reason: "budget_exhausted",
      errors: ["max budget exceeded"],
      usage: USAGE,
    },
  ]);

  // Rozpoznanie idzie po FAKCIE STRUKTURALNYM, nie po tekście — i to jest cała wartość tego
  // rozróżnienia: „zatrzymał nas własny limit" to nie to samo co „dostawca padł".
  assertFailure(observed, "budget", "[budget] Review nie powiodło się (subtype: error_max_budget_usd, ");
});

test("brak wiadomości `result` w strumieniu kończy się własnym rzutem", async () => {
  let thrown: Error | undefined;
  try {
    await runReview(DIFF, { model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, query: stubQuery() });
  } catch (err) {
    thrown = err as Error;
  }

  // Bez `[kind]` i bez `failure-kind=` — świadomie: to nie jest awaria recenzji, tylko strumień,
  // który się skończył, nie mówiąc nic. Wrapper i tak zamienia to na kod wyjścia 1.
  assert.equal(thrown?.message, "Agent nie zwrócił wyniku");
});
