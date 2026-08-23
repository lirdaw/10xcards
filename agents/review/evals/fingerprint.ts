// Odcisk WYWOŁANIA — wydzielony z `cache.ts` i `provider.ts` po to, żeby dało się go policzyć
// BEZ `promptfoo`.
//
// To nie jest porządkowanie. `cache.ts` robi `import { cache as promptfooCache } from "promptfoo"`
// importem WARTOŚCIOWYM, a `promptfoo` jest devDependency — więc każda ścieżka prowadząca przez ten
// plik wymaga pełnej instalacji (~2 099 MB, mediana 38 302 ms wg
// `context/archive/2026-08-22-code-review-evals/change.md:38-42`). Zapadka evali
// (`.github/workflows/eval-ratchet.yml`) biega na KAŻDYM PR-ze i potrzebuje wyłącznie odcisku, więc
// jedzie na `npm ci --omit=dev` (~335 MB) — a to jest możliwe tylko wtedy, gdy odcisk mieszka
// w module, którego zależnościami są WYŁĄCZNIE `zod` (przez `../review-schema.ts`)
// i `@anthropic-ai/claude-agent-sdk` (przez `../run-review.ts`), czyli obie produkcyjne.
//
// ⚑ Stąd twardy zakaz: ŻADNEGO importu `promptfoo` w tym pliku, także `import type`. Type stripping
// Node'a wyrzuca `import type` i pod runtime'em nic by się nie stało — ale `tsc -p` go widzi,
// a w drzewie po `--omit=dev` `promptfoo` nie istnieje również dla typów, więc bramka typów
// pakietu agenta zaczerwieniłaby się w miejscu, w którym nikt nie szuka zależności.
//
// Nazwy zostają na miejscu: `cache.ts` re-eksportuje `FINGERPRINT_NONCE`, `fingerprintPrompt`
// i `CallFingerprintParts`, `provider.ts` — `productionPromptFingerprint`, więc żaden istniejący
// import się nie zmienia. Ten plik jest ich JEDYNYM egzemplarzem.

import { createHash } from "node:crypto";
import { REVIEW_JSON_SCHEMA } from "../review-schema.ts";
import { SYSTEM_PROMPT, wrapDiff } from "../prompt.ts";
import { FIXED_CALL_OPTIONS } from "../run-review.ts";

// Własny egzemplarz, NIE import z `cache.ts` — bo import w tę stronę wciągnąłby z powrotem
// `promptfoo`, czyli dokładnie to, przed czym ten plik istnieje. Kierunek zależności jest
// jednostronny: `cache.ts` → `fingerprint.ts`, nigdy odwrotnie.
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Nonce podstawiany pod `wrapDiff` WYŁĄCZNIE na potrzeby odcisku.
 *
 * Prawdziwy nonce jest losowy per wywołanie i do klucza wejść NIE MOŻE — wpuszczony tam czyniłby
 * cache martwym kodem, który zawsze pudłuje. Ale sam KSZTAŁT wiadomości użytkownika (dwa zdania
 * instrukcji plus etykieta ogranicznika) jest stały, jedzie do modelu tak samo jak prompt
 * systemowy, i do klucza wejść MUSI. Stała wartość zdejmuje losowość, zostawiając kształt.
 */
export const FINGERPRINT_NONCE = "fingerprint";

/**
 * Cztery osie odcisku — czyli CAŁE wywołanie poza materiałem, a nie sam prompt systemowy.
 *
 * Osie idą ARGUMENTAMI, a nie importem stałych, z dwóch powodów naraz. Po pierwsze, test może
 * wtedy wyrazić „to się zmieniło" bez mutowania modułu, czyli kierunek unieważnienia da się
 * w ogóle sprawdzić. Po drugie, wywołujący (provider) podaje te same wartości, które `runReview`
 * naprawdę wysyła, więc odcisk nie może opisywać innego wywołania niż wysłane.
 */
export interface CallFingerprintParts {
  /** Instrukcja systemowa (`SYSTEM_PROMPT`). */
  readonly systemPrompt: string;
  /** Schemat wymuszonego wyjścia (`REVIEW_JSON_SCHEMA`). */
  readonly jsonSchema: unknown;
  /** Kształt wiadomości użytkownika bez materiału i bez losowego nonce'u — `wrapDiff("", FINGERPRINT_NONCE)`. */
  readonly userMessageShape: string;
  /** Stałe opcje wywołania SDK — `FIXED_CALL_OPTIONS` z `run-review.ts` (`tools`, `maxTurns`). */
  readonly callOptions: unknown;
}

/**
 * Odcisk CAŁEGO wywołania poza materiałem.
 *
 * Nazwa historyczna (`…Prompt`) zostaje, bo tak nazywa się pole klucza — ale ZAKRESEM jest
 * wywołanie, i tak ma zostać: każda nowa wartość przekazywana do `query(...)` w `runReview`
 * należy TUTAJ, a nie do komentarza „pamiętaj podbić wersję". Wąski odcisk jest groźniejszy niż
 * brak cache'u: pominięta oś oznacza, że zmiana w niej zostaje zaserwowana ze STAREGO wyniku
 * i wygląda jak zielona bramka.
 *
 * Każda oś jest pilnowana osobno przez `cache.test.ts` — przypadkiem unieważnienia ORAZ kontrolą
 * pozytywną: wariant odcisku ślepy na tę oś musi zaczerwienić DOKŁADNIE jej przypadek i tylko jego.
 */
export function fingerprintPrompt(parts: CallFingerprintParts): string {
  // Separator, który NIE MOŻE wystąpić w żadnym z łączonych tekstów — inaczej `(A, BC)` i `(AB, C)`
  // dawałyby ten sam odcisk, czyli zmiana na jednej osi mogłaby zostać zamaskowana zmianą na innej.
  // Zapisany ESCAPE'em, nie literalnie: literalny bajt NUL w źródle sprawia, że git widzi ten plik
  // jako binarny i przestaje pokazywać jego diff.
  const SEPARATOR = "\u0000";
  return sha256(
    [
      parts.systemPrompt,
      JSON.stringify(parts.jsonSchema),
      parts.userMessageShape,
      JSON.stringify(parts.callOptions),
    ].join(SEPARATOR),
  );
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
