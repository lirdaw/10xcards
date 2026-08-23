import type { ReviewMetrics } from "../run-review.ts";

/**
 * Cennik jako STATYCZNA tabela w repo — bo obie alternatywy odpadły z powodów zmierzonych, a nie
 * estetycznych.
 *
 * `total_cost_usd` z SDK odpadło definitywnie: licznik stosuje katalog modeli ANTHROPICA, w którym
 * identyfikatorów OpenRoutera nie ma wcale (0 trafień na `anthropic/claude-haiku-4.5` w `sdk.mjs`),
 * więc dla każdej taniej kolumny jest to cena innego modelu przyłożona do naszych tokenów —
 * zmierzone przeszacowanie 5,0× dla haiku i 14,0× dla gemini
 * (`context/changes/code-review-evals/measurement-cheap-models.md`, Pomiar II).
 *
 * Odczyt sieciowy przy każdym przebiegu odpadł, bo czyniłby przebieg NIEODTWARZALNYM: ta sama
 * komórka policzona dwa razy dawałaby dwie kwoty, a wtedy tabela kosztów przestaje być punktem
 * odniesienia dla następnej.
 *
 * Cenę cichej nieaktualności płacimy JAWNIE: `PRICING_AS_OF` idzie do raportu obok każdej kwoty,
 * więc czytelnik widzi „cennik z <data>" i sam ocenia, czy jej ufa. Nie automatyzujemy odświeżania
 * — automat, który podmienia stawki bez czytelnika, zamienia znany błąd w nieznany.
 */

/** Stawki za MILION tokenów, w USD. Cztery osie, bo tyle rozróżnia OpenRouter i tyle raportuje SDK. */
export interface ModelPricing {
  /** Tokeny wejścia NIEobjęte cache'em (`prompt` u OpenRoutera). */
  readonly inputPerM: number;
  /** Tokeny wyjścia (`completion`). */
  readonly outputPerM: number;
  /** Zapis cache'u prefiksu (`input_cache_write`). */
  readonly cacheWritePerM: number;
  /** Odczyt z cache'u prefiksu (`input_cache_read`). */
  readonly cacheReadPerM: number;
}

/** Data, na którą stawki poniżej zostały odczytane. Idzie do raportu OBOK kwot. */
export const PRICING_AS_OF = "2026-08-23";

/** Skąd wzięte — endpoint katalogu modeli, ten sam, który zasila stronę cennika. */
export const PRICING_SOURCE = "https://openrouter.ai/api/v1/models";

/**
 * Stawki przepisane z `PRICING_SOURCE` w dniu `PRICING_AS_OF` (pola `pricing.prompt`,
 * `pricing.completion`, `pricing.input_cache_write`, `pricing.input_cache_read`, przeliczone
 * z ceny za token na cenę za milion).
 *
 * Sonnet NIE JEST w macierzy — jest tu jako kolumna odniesienia, bo to na niej metoda liczenia
 * dostała potwierdzenie z obu stron: dla sonneta `total_cost_usd` z SDK zgadza się z rachunkiem
 * OpenRoutera co do szóstego miejsca po przecinku (cennik przypadkiem ten sam), więc zgodność
 * rekonstrukcji z tą kwotą sprawdza arytmetykę, a nie tylko jej samą ze sobą. Obecność wpisu nie
 * włącza kolumny — o tym decyduje `promptfooconfig.yaml`.
 */
export const PRICING: Readonly<Record<string, ModelPricing>> = {
  "anthropic/claude-haiku-4.5": {
    inputPerM: 1.0,
    outputPerM: 5.0,
    cacheWritePerM: 1.25,
    cacheReadPerM: 0.1,
  },
  "google/gemini-2.5-flash": {
    inputPerM: 0.3,
    outputPerM: 2.5,
    cacheWritePerM: 0.0833333333333333,
    cacheReadPerM: 0.03,
  },
  "anthropic/claude-sonnet-4.6": {
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheWritePerM: 3.75,
    cacheReadPerM: 0.3,
  },
};

/**
 * Rachunek komórki: albo kwota z rozbiciem, albo POWÓD, dla którego jej nie ma.
 *
 * Kształt jest ten sam co `MaxBudgetResolution` w `run-review.ts` i z tego samego powodu: zwrócenie
 * `0` przy nieznanym modelu albo przy braku licznika tokenów wpisałoby do tabeli kosztów zero,
 * które czyta się jak „ta komórka była darmowa". Bramka kosztowa, która nie potrafi zaświecić na
 * czerwono, jest gorsza niż jej brak (`lessons.md`: „Komenda, która ZAWSZE kończy się kodem 0…").
 */
export type CellCost =
  | {
      readonly ok: true;
      readonly usd: number;
      readonly breakdown: {
        readonly input: number;
        readonly output: number;
        readonly cacheWrite: number;
        readonly cacheRead: number;
      };
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Koszt komórki z tokenów × tabela wyżej. **Nigdy** z `metrics.totalCostUsd`.
 *
 * ⚑ ZNANA GRANICA TEJ LICZBY, zmierzona przy pisaniu tej funkcji na czterech przebiegach
 * z `measurement-cheap-models.md`. `usage` w wyniku SDK pochodzi z OSTATNIEJ wiadomości, nie z sumy
 * po turach — więc rekonstrukcja jest wiarygodna dla przebiegu dwuturowego i ZANIŻA dla dłuższego:
 *
 * | przebieg                          | tury | policzone | rachunek OpenRoutera | iloraz |
 * | --------------------------------- | ---- | --------- | -------------------- | ------ |
 * | haiku-4.5 (Pomiar II)             | 2    | 0,082941  | 0,084648             | 0,98   |
 * | sonnet-4.6 (Pomiar II)            | 2    | 0,188797  | 0,193523             | 0,98   |
 * | gemini-2.5-flash (Pomiar I, p. 5) | 2    | 0,013508  | 0,012074             | 1,12   |
 * | gemini-2.5-flash (Pomiar II)      | 3    | 0,017300  | 0,032321             | 0,54   |
 *
 * Trzy pierwsze wiersze mieszczą się w ±12%, czwarty myli się prawie dwukrotnie — i różni się od
 * nich WYŁĄCZNIE liczbą tur. Dlatego raport ma pokazywać `numTurns` obok kwoty: przy `> 2` kwota
 * jest DOLNYM oszacowaniem, a nie rachunkiem. Zamiast korygować to współczynnikiem (który byłby
 * dopasowaniem do jednego punktu) zostawiamy liczbę surową i widoczny warunek jej ważności.
 */
export function cellCostUsd(metrics: ReviewMetrics): CellCost {
  const pricing = PRICING[metrics.model];
  if (!pricing) {
    return {
      ok: false,
      reason: `brak stawek dla modelu ${JSON.stringify(metrics.model)} w tabeli z ${PRICING_AS_OF}`,
    };
  }

  // Brak licznika to NIE zero. `ReviewMetrics` niesie `undefined` dokładnie tam, gdzie SDK nic nie
  // podało (`run-review.ts` świadomie nie podstawia zer), więc podstawienie ich TUTAJ odzyskałoby
  // tamtą różnicę tylko po to, żeby ją zgubić w kwocie.
  const missing = (
    [
      ["inputTokens", metrics.inputTokens],
      ["outputTokens", metrics.outputTokens],
      ["cacheCreationInputTokens", metrics.cacheCreationInputTokens],
      ["cacheReadInputTokens", metrics.cacheReadInputTokens],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (missing.length > 0) {
    return { ok: false, reason: `SDK nie podało liczników: ${missing.join(", ")}` };
  }

  const perMillion = (tokens: number, rate: number): number => (tokens * rate) / 1_000_000;
  const breakdown = {
    input: perMillion(metrics.inputTokens ?? 0, pricing.inputPerM),
    output: perMillion(metrics.outputTokens ?? 0, pricing.outputPerM),
    cacheWrite: perMillion(metrics.cacheCreationInputTokens ?? 0, pricing.cacheWritePerM),
    cacheRead: perMillion(metrics.cacheReadInputTokens ?? 0, pricing.cacheReadPerM),
  };

  return {
    ok: true,
    usd: breakdown.input + breakdown.output + breakdown.cacheWrite + breakdown.cacheRead,
    breakdown,
  };
}

/**
 * Wiek cennika w pełnych dobach, liczony wobec PODANEGO „teraz".
 *
 * Zegar jest argumentem, a nie odczytem wewnątrz — bo inaczej ta funkcja nie ma testu, który
 * przechodzi jutro. Wywołujący (raport) podaje `new Date()`.
 */
export function pricingAgeDays(now: Date): number {
  const asOf = Date.parse(`${PRICING_AS_OF}T00:00:00Z`);
  return Math.floor((now.getTime() - asOf) / 86_400_000);
}
