// Testy cache'u zestawu evali — i to jest test NAJGROŹNIEJSZEJ klasy błędu w całej tej zmianie.
//
// Nie chodzi o to, że oszczędność działa. Chodzi o to, że UNIEWAŻNIENIE działa: nieświeży wynik
// podany jako zielona bramka jest gorszy niż brak cache'u, bo znika razem z informacją, że coś
// zniknęło. Zmiana taka jak `0d3eba5` (wzmocnienie instrukcji o kryteriach warunkowych) zostałaby
// wtedy zaserwowana ze starego wyniku i nikt by nie zauważył, że nic nie zmierzono.
//
// Dlatego przypadek (ii) — „zmieniony prompt → PUDŁO" — dostaje KONTROLĘ POZYTYWNĄ: wariant funkcji
// klucza pomijający odcisk promptu musi go zaczerwienić. Probe jest wykonywany realnie, a jego
// wynik zapisany w `context/changes/code-review-evals/verification.md`; „można by sprawdzić" nie
// jest dowodem (`lessons.md`: „Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką").
//
// Runner: `node:test` pod gołym `node --experimental-strip-types`, jak `run-review.test.ts` — ten
// plik MA zależności runtime (promptfoo, SDK przez `run-review.ts`), więc nie może dołączyć do
// kroku w `prompt-ratchet.yml`, który świadomie biega bez `npm ci`.
//
// ZERO wywołań modelu: `query` jest wstrzykiwany stubem, tak samo jak w `run-review.test.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { NonNullableUsage, SDKMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { CRITERIA, REVIEW_JSON_SCHEMA } from "../review-schema.ts";
import { SYSTEM_PROMPT } from "../prompt.ts";
import type { QueryFn } from "../run-review.ts";
import { cellCacheKey, fingerprintPrompt, isCacheEnabled, readCell } from "./cache.ts";
import ReviewProvider, { forgetCell, loadFixture, productionPromptFingerprint, runCell } from "./provider.ts";

const MODEL = "anthropic/claude-haiku-4.5";
/** Bezpiecznik bez znaczenia dla tych przypadków — żaden nie dochodzi do SDK. */
const MAX_BUDGET_USD = 0.6;

/**
 * Fikstura UNIKALNA per przebieg, i to jest warunek poprawności, nie higiena.
 *
 * Magazyn jest PRAWDZIWY (`~/.promptfoo/cache`, ten sam, którego użyje przebieg za pieniądze), więc
 * fikstura stała sprawiłaby, że drugie uruchomienie testu zaczyna od CIEPŁEGO klucza — przypadek
 * „pierwsze wywołanie idzie do modelu" przechodziłby wtedy z niewłaściwego powodu albo padał.
 * Każdy przypadek dostaje własną, i sam po sobie sprząta.
 */
function uniqueFixture(marker: string): string {
  return `diff --git a/${marker}.ts b/${marker}.ts\n+// ${randomUUID()}\n`;
}

/** Stub `query` liczący wywołania — bo obserwowalną tego testu jest „czy model został zawołany". */
function countingStub(): { query: QueryFn; calls: () => number } {
  let calls = 0;
  const query: QueryFn = () => {
    calls += 1;
    return (async function* stubbed() {
      yield successMessage() as unknown as SDKMessage;
    })();
  };
  return { query, calls: () => calls };
}

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

/**
 * Poprawne wyjście modelu, budowane Z TABLICY kryteriów — żeby nie było tu drugiej jej kopii.
 * Ten sam wzorzec co w `run-review.test.ts`; powielony świadomie, bo tamten plik zamraża kontrakt
 * ścieżki AWARII i wciągnięcie go tutaj związałoby dwa testy o różnych powodach istnienia.
 */
function successMessage(): SuccessFixture {
  const output: Record<string, unknown> = { verdict: "pass", summary: "Zmiana wygląda porządnie." };
  for (const criterion of CRITERIA) {
    output[criterion.key] = criterion.conditional ? null : 7;
    output[criterion.noteKey] = `nota: ${criterion.label}`;
  }
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    duration_ms: 1234,
    total_cost_usd: 0.42,
    terminal_reason: "completed",
    result: "",
    structured_output: output,
    usage: {
      input_tokens: 10,
      output_tokens: 4300,
      cache_creation_input_tokens: 5599,
      cache_read_input_tokens: 32152,
    },
  };
}

/**
 * `runReview` PRZESTAWIA trzy zmienne `ANTHROPIC_*` na starcie (to jej prekondycja, nie ozdoba),
 * więc każdy przypadek biegnie na zapisanym i przywróconym środowisku. Bez tego pierwszy przypadek
 * zostawiałby `ANTHROPIC_API_KEY=""` następnym, a przypadek odmowy przestałby cokolwiek znaczyć.
 */
async function withEnv(patch: Record<string, string | undefined>, body: () => Promise<void>): Promise<void> {
  const keys = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", ...Object.keys(patch)];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Bez tej asercji oba przypadki cache'u przechodziłyby PUSTO przy `PROMPTFOO_CACHE_ENABLED=false`:
 * (i) „trafienie" nie miałoby czego trafić, a red-flagą byłby dopiero brak red-flagi.
 */
function assertCacheOn(): void {
  assert.ok(isCacheEnabled(), "cache promptfoo jest wyłączony — te przypadki nie mierzyłyby niczego");
}

test("(i) ten sam materiał i ten sam prompt → TRAFIENIE, model wołany dokładnie raz", async () => {
  assertCacheOn();
  const diff = uniqueFixture("cache-hit");
  const promptFingerprint = productionPromptFingerprint();
  const { query, calls } = countingStub();

  await withEnv({ ANTHROPIC_AUTH_TOKEN: "test-token" }, async () => {
    try {
      const cold = await runCell({ diff, model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, promptFingerprint, query });
      assert.ok(cold.ok, "pierwszy przebieg miał się udać");
      assert.equal(cold.cached, false, "pierwszy przebieg nie mógł być trafieniem");
      assert.equal(calls(), 1, "pierwszy przebieg miał zawołać model dokładnie raz");

      const warm = await runCell({ diff, model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, promptFingerprint, query });
      assert.ok(warm.ok, "drugi przebieg miał się udać");
      assert.equal(warm.cached, true, "drugi przebieg miał być TRAFIENIEM");
      assert.equal(calls(), 1, "drugi przebieg zawołał model — cache nie zadziałał");
      assert.deepEqual(warm.review, cold.review, "wynik z cache'u różni się od zapisanego");
    } finally {
      await forgetCell({ diff, model: MODEL, promptFingerprint });
    }
  });
});

test("(ii) zmieniony SYSTEM_PROMPT → PUDŁO, model wołany drugi raz", async () => {
  assertCacheOn();
  const diff = uniqueFixture("cache-miss-on-prompt-change");
  const before = fingerprintPrompt(SYSTEM_PROMPT, REVIEW_JSON_SCHEMA);
  // Zmiana promptu wyrażona tak, jak wygląda naprawdę: dopisany blok instrukcji, dokładnie jak
  // `0d3eba5`. Nie „inny string" — zmieniona TREŚĆ tego samego promptu.
  const after = fingerprintPrompt(`${SYSTEM_PROMPT}\n\nDodatkowa instrukcja o kryteriach warunkowych.`, REVIEW_JSON_SCHEMA);
  assert.notEqual(before, after, "odcisk nie zmienił się przy zmienionym promptcie");

  const { query, calls } = countingStub();

  await withEnv({ ANTHROPIC_AUTH_TOKEN: "test-token" }, async () => {
    try {
      const cold = await runCell({
        diff,
        model: MODEL,
        maxBudgetUsd: MAX_BUDGET_USD,
        promptFingerprint: before,
        query,
      });
      assert.ok(cold.ok, "przebieg na starym promptcie miał się udać");
      assert.equal(calls(), 1, "przebieg na starym promptcie miał zawołać model raz");

      const afterChange = await runCell({
        diff,
        model: MODEL,
        maxBudgetUsd: MAX_BUDGET_USD,
        promptFingerprint: after,
        query,
      });
      assert.ok(afterChange.ok, "przebieg na nowym promptcie miał się udać");
      assert.equal(
        afterChange.cached,
        false,
        "zmieniony prompt TRAFIŁ w cache — nieświeży wynik zostałby podany jako zielona bramka",
      );
      assert.equal(calls(), 2, "zmieniony prompt nie zawołał modelu — cache nie został unieważniony");
    } finally {
      await forgetCell({ diff, model: MODEL, promptFingerprint: before });
      await forgetCell({ diff, model: MODEL, promptFingerprint: after });
    }
  });
});

test("(iii) provider pisze pod kluczem policzonym z PRODUKCYJNEGO promptu i schematu", async () => {
  assertCacheOn();
  const diff = uniqueFixture("provider-uses-production-prompt");
  const promptFingerprint = productionPromptFingerprint();
  const { query, calls } = countingStub();
  const provider = new ReviewProvider({
    id: "review:test",
    config: { model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, query },
  });

  await withEnv({ ANTHROPIC_AUTH_TOKEN: "test-token" }, async () => {
    try {
      const response = await provider.callApi("znacznik fikstury", {
        vars: { diff },
        prompt: { raw: "znacznik fikstury", label: "znacznik fikstury" },
      });
      assert.equal(response.error, undefined, `provider zwrócił błąd: ${response.error}`);
      assert.equal(calls(), 1);

      // Klucz liczony NIEZALEŻNIE, z `SYSTEM_PROMPT` i `REVIEW_JSON_SCHEMA` wprost. Gdyby provider
      // odciskał cokolwiek innego (stałą, pusty string, sam schemat), ten odczyt byłby pudłem —
      // i wtedy przypadek (ii) pilnowałby unieważnienia, którego produkcja i tak by nie robiła.
      const written = await readCell(
        cellCacheKey({ fixture: diff, model: MODEL, promptFingerprint: fingerprintPrompt(SYSTEM_PROMPT, REVIEW_JSON_SCHEMA) }),
      );
      assert.ok(written, "provider zapisał komórkę pod innym kluczem niż produkcyjny odcisk promptu");
      assert.equal(written.metrics.model, MODEL);
    } finally {
      await forgetCell({ diff, model: MODEL, promptFingerprint });
    }
  });
});

test("(iv) brak ANTHROPIC_AUTH_TOKEN → czytelna odmowa i ZERO wywołań", async () => {
  const diff = uniqueFixture("no-token");
  const promptFingerprint = productionPromptFingerprint();
  const { query, calls } = countingStub();

  await withEnv({ ANTHROPIC_AUTH_TOKEN: undefined }, async () => {
    try {
      const result = await runCell({ diff, model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, promptFingerprint, query });
      assert.equal(result.ok, false, "bez klucza komórka nie może być zielona");
      assert.equal(result.failureKind, "config", "brak klucza to NIE awaria dostawcy — patrz `CellFailureKind`");
      assert.match(result.message, /ANTHROPIC_AUTH_TOKEN/, "odmowa ma nazywać brakującą zmienną");
      assert.equal(calls(), 0, "bez klucza padło wywołanie — a miała paść odmowa");
    } finally {
      await forgetCell({ diff, model: MODEL, promptFingerprint });
    }
  });
});

test("(v) pusta zmienna `diff` → odmowa providera, bez wywołania", async () => {
  const { query, calls } = countingStub();
  const provider = new ReviewProvider({ id: "review:test", config: { model: MODEL, maxBudgetUsd: MAX_BUDGET_USD, query } });

  await withEnv({ ANTHROPIC_AUTH_TOKEN: "test-token" }, async () => {
    const response = await provider.callApi("znacznik", { vars: {}, prompt: { raw: "znacznik", label: "znacznik" } });
    assert.match(String(response.error), /diff/, "brak fikstury ma być nazwany, a nie zamieniony w pustą recenzję");
    assert.equal(calls(), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Fikstura z `vars` — i pułapka, którą ta faza ZMIERZYŁA, zamiast na nią wpaść na przebiegu za
// pieniądze. Wszystkie trzy przypadki są offline i nie dotykają cache'u.
// ---------------------------------------------------------------------------------------------

test("(vi) `diffPath` wczytuje TREŚĆ fikstury z repo, nie jej ścieżkę", () => {
  const loaded = loadFixture({ diffPath: "sample.diff" });
  assert.ok(loaded.ok, `fikstura się nie wczytała: ${loaded.ok ? "" : loaded.message}`);
  assert.ok(loaded.diff.startsWith("diff --git"), "wczytana wartość nie wygląda jak diff");
  // Orakl na DŁUGOŚĆ, nie na sam prefiks: nierozwinięta referencja `file://../sample.diff` ma
  // 21 znaków i przy asercji „zaczyna się od" przeszłaby, gdyby ktoś ją tak nazwał.
  assert.ok(loaded.diff.length > 500, `fikstura ma ${loaded.diff.length} znaków — to nie jest treść pliku`);
});

test("(vii) referencja `file://` w `vars` to GŁOŚNA odmowa, nie recenzja ścieżki", () => {
  // Dokładnie ta wartość, którą promptfoo przepuszcza jako tekst dla rozszerzenia `.diff`.
  const loaded = loadFixture({ diffPath: "file://../sample.diff" });
  assert.equal(loaded.ok, false, "nierozwinięta referencja przeszła jako materiał — model recenzowałby ścieżkę");
  assert.match(loaded.message, /file:\/\//);
  assert.match(loaded.message, /\.diff/, "odmowa ma nazywać rozszerzenie, na którym promptfoo się poddaje");
});

test("(viii) `diffPath` i `diff` naraz → odmowa; żadnej z nich → odmowa", () => {
  const both = loadFixture({ diffPath: "sample.diff", diff: "diff --git a/x b/x\n" });
  assert.equal(both.ok, false, "dwa źródła materiału naraz nie mogą być zielone");
  const neither = loadFixture({ fixture: "sample.diff" });
  assert.equal(neither.ok, false, "brak materiału nie może być zielony");
});
