// Siatka CHARAKTERYZUJĄCA na CLI agenta — powstaje PRZED jakąkolwiek ekstrakcją i ma przejść
// bez zmiany ani jednej asercji po tym, jak ciało `review(diff)` wyprowadzi się do `runReview`.
// „Ekstrakcja nic nie zmieniła" ma być pomiarem, nie deklaracją.
//
// Co dokładnie jest tu zamrożone: WSZYSTKO, co composite action i `pr-review.yml` czytają
// z uruchomienia agenta — kod wyjścia, pełna treść stderr co do znaku, zawartość
// `$GITHUB_OUTPUT` i KOLEJNOŚĆ efektów między nimi. Kontrakty tego agenta są stringowe
// (`.github/actions/review-agent/action.yml:188-189` woła go z przekierowaniami i czyta
// `model=` z `$GITHUB_OUTPUT`, `pr-review.yml:529` grepuje stderr), więc każda linia, którą
// ten test pinuje, jest linią, którą naprawdę ktoś czyta — a nie tekstem wymyślonym przez test.
//
// ŻADEN z czterech przypadków nie dochodzi do modelu: wszystkie kończą się przed pierwszym
// `query(...)`. Test jest więc darmowy i deterministyczny, i dlatego może powstać przed szwem —
// nie stubuje niczego i niczego nie wstrzykuje.
//
// Runner: `node:test` pod gołym `node --experimental-strip-types`, tak jak `prompt.test.ts`
// i z tego samego powodu (granica `agents/**` z `AGENTS.md` §Hard Rules). RÓŻNICA wobec
// `prompt.test.ts` jest jedna i istotna: ten plik ma zależność runtime — spawnuje agenta, czyli
// potrzebuje `node_modules` pakietu. Dlatego NIE może dołączyć do kroku w
// `.github/workflows/prompt-ratchet.yml`, który świadomie biegnie bez `npm ci`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Katalog pakietu — agent jest uruchamiany stąd, tak jak robi to `npm --prefix agents/review`. */
const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
/**
 * `tsx` przez jawną ścieżkę do jego CLI, a nie przez `npm run` ani przez shimy z `node_modules/.bin`.
 * Powód jest przenośnościowy: `npm` i `tsx` to na Windowsie pliki `.cmd`, których nie da się
 * spawnować bez `shell: true` — a shell wprowadziłby własne cytowanie do env i do przekierowań,
 * czyli dokładnie tę warstwę, której ten test ma nie mieć. Produkcyjna ścieżka
 * (`npm --silent run review` → `tsx review.ts`) kończy się tym samym procesem.
 */
const TSX_CLI = fileURLToPath(new URL("./node_modules/tsx/dist/cli.mjs", import.meta.url));

/**
 * Model przypięty w `review.ts:19` jako wartość domyślna.
 *
 * Ta literalna kopia jest tu ORAKLEM, nie drugą kopią kontraktu: na automatycznym wyzwalaczu
 * `pr-review.yml:371` podaje akcji `model: ''`, a `action.yml:23-28` opisuje pustą wartość jako
 * „whatever the agent pins" — więc ROZSTRZYGNIĘCIE DOMYŚLNE jest ścieżką produkcyjną, a nie
 * wariantem awaryjnym. Jeśli ktoś zmieni pin, ten test ma zaświecić na czerwono; komentarz przy
 * `REVIEW_MODEL` mówi wprost, że cichy podmian modelu jest tym, czemu pin ma zapobiegać.
 */
const PINNED_MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Zmienne, które `review.ts` czyta albo ustawia. Kasujemy je ze środowiska KAŻDEGO przebiegu,
 * zanim nałożymy env przypadku — inaczej klucz albo model z powłoki dewelopera zmieniłby wynik
 * i test przechodziłby (lub padał) z powodu, którego nie widać w jego kodzie.
 */
const AGENT_ENV_KEYS = [
  "REVIEW_MODEL",
  "REVIEW_MAX_BUDGET_USD",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "GITHUB_OUTPUT",
] as const;

interface RunOptions {
  /** Nadpisania env przypadku, nakładane na wyczyszczone środowisko. */
  readonly env?: Readonly<Record<string, string>>;
  /** Treść podawana na stdin. Domyślnie pusta — czyli przypadek „pusty diff". */
  readonly stdin?: string;
  /** Czy podstawić plik pod `$GITHUB_OUTPUT`. `false` odwzorowuje uruchomienie poza CI. */
  readonly withGithubOutput?: boolean;
}

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Zawartość podstawionego `$GITHUB_OUTPUT`; pusty string, gdy nic nie zapisano. */
  readonly githubOutput: string;
}

/**
 * Uruchamia agenta tak, jak robi to `action.yml:188-189`: PRZEKIEROWANIA, nigdy potok.
 *
 * To nie jest wierność dla samej wierności. Potok w tamtym pliku był zmierzoną pułapką (status
 * bierze się od ostatniego procesu rury), a tu daje dodatkowo to, czego pipe nie da: stdin
 * kończy się EOF-em natychmiast, więc `readDiff()` nie może zawisnąć, i żadna z trzech ścieżek
 * nie zależy od bufora rury.
 */
function runAgent({ env = {}, stdin = "", withGithubOutput = true }: RunOptions = {}): RunResult {
  const dir = mkdtempSync(join(tmpdir(), "review-cli-test-"));
  const stdinPath = join(dir, "stdin");
  const stdoutPath = join(dir, "stdout");
  const stderrPath = join(dir, "stderr");
  const githubOutputPath = join(dir, "github-output");

  writeFileSync(stdinPath, stdin, "utf8");
  // Runner tworzy ten plik PRZED krokiem, więc pusty plik jest wierniejszy niż jego brak.
  if (withGithubOutput) writeFileSync(githubOutputPath, "", "utf8");

  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of AGENT_ENV_KEYS) delete childEnv[key];
  if (withGithubOutput) childEnv.GITHUB_OUTPUT = githubOutputPath;
  Object.assign(childEnv, env);

  const stdinFd = openSync(stdinPath, "r");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  try {
    const child = spawnSync(process.execPath, [TSX_CLI, "review.ts"], {
      cwd: PACKAGE_DIR,
      env: childEnv,
      stdio: [stdinFd, stdoutFd, stderrFd],
      timeout: 60_000,
    });

    closeSync(stdinFd);
    closeSync(stdoutFd);
    closeSync(stderrFd);

    if (child.error) throw child.error;

    return {
      status: child.status,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
      githubOutput: withGithubOutput ? readFileSync(githubOutputPath, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Linia `[konfiguracja]` co do znaku (`review.ts:206-209`). Drukuje się PRZED odczytem stdin,
 * więc widzi ją także przebieg zatrzymany na pustym diffie — i to jest jedyny ślad w logu,
 * czym różniły się dwa przebiegi pary dowodowej „ten sam diff, inny budżet".
 */
const KONFIGURACJA_DOMYSLNA =
  `[konfiguracja] model: ${PINNED_MODEL} | budżet: 1 USD ` +
  "(limit SDK, liczony z cennika Anthropica — przybliżenie, nie rachunek OpenRoutera)\n";

test("pusty stdin: `[konfiguracja]`, potem odmowa — a `model=` zdążył wylądować w $GITHUB_OUTPUT", () => {
  const run = runAgent({ env: { ANTHROPIC_AUTH_TOKEN: "test-token" } });

  assert.equal(run.status, 1);
  assert.equal(
    run.stderr,
    KONFIGURACJA_DOMYSLNA + "Pusty diff na wejściu. Użyj: git diff | npx tsx review.ts\n",
  );
  // Kontrakt akcji: „stdout to WYŁĄCZNIE JSON" — na ścieżce odmowy oznacza to zero bajtów.
  assert.equal(run.stdout, "");
  // `model=` bez `REVIEW_MODEL` w env: rozstrzygnięcie domyślne, czyli ścieżka automatycznego
  // wyzwalacza (`pr-review.yml:371` podaje wtedy pusty `model`).
  assert.equal(run.githubOutput, `model=${PINNED_MODEL}\n`);
});

test("niepoprawny REVIEW_MAX_BUDGET_USD: odmowa PRZED zapisem `model=` (asercja na kolejność)", () => {
  const run = runAgent({
    env: { ANTHROPIC_AUTH_TOKEN: "test-token", REVIEW_MAX_BUDGET_USD: "abc" },
  });

  assert.equal(run.status, 1);
  assert.equal(
    run.stderr,
    'REVIEW_MAX_BUDGET_USD musi być liczbą dodatnią (otrzymano: "abc").\n' +
      "Zostawienie pustej wartości bierze limit domyślny; wartość niepoprawna to błąd, nie fallback.\n",
  );
  assert.equal(run.stdout, "");
  // TO jest właściwa asercja tego przypadku: walidacja capa (`review.ts:78-91`) zachodzi na
  // module scope PRZED blokiem `$GITHUB_OUTPUT` (`:137-159`), więc plik zostaje PUSTY. Gdyby
  // ekstrakcja przestawiła te dwa efekty, komentarz PR-a dostałby model dla przebiegu, który
  // nigdy nie ruszył.
  assert.equal(run.githubOutput, "");
});

test("brak ANTHROPIC_AUTH_TOKEN: komplet linii bramki klucza, a `model=` JUŻ zapisany", () => {
  const run = runAgent();

  assert.equal(run.status, 1);
  assert.equal(
    run.stderr,
    "Brak klucza: ustaw ANTHROPIC_AUTH_TOKEN na klucz OpenRoutera.\n" +
      "W CI to sekret repozytorium OPENROUTER_REVIEW_KEY podawany NA KROK, nie na job.\n" +
      "To jest WŁASNY klucz review — nie kieruj go na OPENROUTER_EVAL_KEY, który należy do evala.\n" +
      "Lokalnie: $env:ANTHROPIC_AUTH_TOKEN = '<klucz>' na jedno wywołanie —\n" +
      "nie eksportuj go na stałe i nie używaj nazwy OPENROUTER_API_KEY (psuje npm test).\n",
  );
  assert.equal(run.stdout, "");
  // Druga strona tej samej asercji na kolejność: bramka klucza (`:173-186`) stoi ZA zapisem
  // `model=`, więc przebieg bez klucza mimo wszystko oddaje harnessowi rozstrzygnięty model.
  // Ta linia jest tu po to, żeby przeniesienie bramki „przy okazji" nie przeszło niezauważone.
  assert.equal(run.githubOutput, `model=${PINNED_MODEL}\n`);
});

test("REVIEW_MODEL ze znakiem nowej linii: odmowa, `$GITHUB_OUTPUT` nietknięty", () => {
  // Przesłanka POPRAWNOŚCI tego przypadku, nie szczegół: sprawdzenie nowej linii siedzi
  // WEWNĄTRZ `if (githubOutput)` (`review.ts:138-145`). Bez podstawionego `$GITHUB_OUTPUT`
  // proces poszedłby dalej i skończył exit 1 na PUSTYM DIFFIE — ten sam kod wyjścia, inna
  // linia, test zielony z niewłaściwego powodu.
  const hostile = `${PINNED_MODEL}\nevil=1`;
  const run = runAgent({ env: { ANTHROPIC_AUTH_TOKEN: "test-token", REVIEW_MODEL: hostile } });

  assert.equal(run.status, 1);
  assert.equal(
    run.stderr,
    `Identyfikator modelu nie może zawierać znaku nowej linii: ${JSON.stringify(hostile)}\n`,
  );
  assert.equal(run.stdout, "");
  // Odmowa, nie ucieczka znaku i nie ciche obcięcie: do pliku nie trafia ANI JEDEN bajt.
  assert.equal(run.githubOutput, "");
});
