import { createHash } from "node:crypto";
import { cache as promptfooCache } from "promptfoo";
import type { Review } from "../review-schema.ts";
import type { ReviewMetrics } from "../run-review.ts";

/**
 * Darmowe powtórzenie przebiegu — zbudowane W PROVIDERZE, bo promptfoo nie da go z pudełka.
 *
 * Jego własny cache dostają wyłącznie wywołania idące przez `fetchWithCache` albo provider, który
 * sam zadeklaruje `cached: true`. Nasz provider woła Agent SDK, a nie goły `fetch`, więc bez tego
 * pliku wymaganie „powtórne przejście jest darmowe" byłoby życzeniem. Magazyn zostaje promptfoo
 * (`getCache()`), więc `--no-cache` i `PROMPTFOO_CACHE_*` działają tak samo jak dla providerów
 * wbudowanych; nasze jest tylko to, CO trafia do klucza.
 *
 * ⚑ NIEŚWIEŻY WYNIK PODANY JAKO ZIELONA BRAMKA to najgroźniejsza klasa błędu w całym zestawie —
 * groźniejsza niż brak cache'u, bo znika razem z informacją, że coś zniknęło. Dlatego klucz niesie
 * ODCISK PROMPTU, a `cache.test.ts` dowodzi obu kierunków, z kontrolą pozytywną na tym ważniejszym.
 */

/** Wynik komórki w postaci, w jakiej wraca z cache'u — dokładnie to, co oddaje `runReview`. */
export interface CachedCell {
  readonly review: Review;
  readonly metrics: ReviewMetrics;
}

/** Wersja formatu wpisu. Podbicie unieważnia CAŁY cache — używać przy zmianie kształtu `CachedCell`. */
const CACHE_FORMAT_VERSION = "v1";

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

export interface CacheKeyParts {
  /** Treść fikstury (diff), nie jej nazwa — nazwa pliku może zostać ta sama przy zmienionej treści. */
  readonly fixture: string;
  readonly model: string;
  /** Wynik `fingerprintPrompt` — trzeci i najważniejszy wymiar tego klucza. */
  readonly promptFingerprint: string;
}

/**
 * Klucz komórki: (materiał, model, prompt+schemat). Model zostaje jawnym tekstem, bo przy grzebaniu
 * w `~/.promptfoo/cache` chce się widzieć, czyj to wpis, bez rozwiązywania hasha.
 */
export function cellCacheKey({ fixture, model, promptFingerprint }: CacheKeyParts): string {
  return `review-eval:${CACHE_FORMAT_VERSION}:${model}:${sha256(fixture)}:${promptFingerprint}`;
}

/** Przełącznik promptfoo, nie nasz — dzięki temu `--no-cache` obowiązuje także ten cache. */
export function isCacheEnabled(): boolean {
  return promptfooCache.isCacheEnabled();
}

/**
 * Odczyt wpisu. Wpis niedający się odczytać jest traktowany jak PUDŁO, ale głośno.
 *
 * Cicha obsługa byłaby tu tą samą klasą, przed którą broni cały ten plik: uszkodzony wpis
 * zniknąłby razem z informacją, że zniknął, a przebieg zapłaciłby za komórkę bez śladu dlaczego.
 */
export async function readCell(key: string): Promise<CachedCell | undefined> {
  const raw = await promptfooCache.getCache().get(key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as CachedCell;
  } catch (err) {
    process.stderr.write(
      `[cache] wpis ${key} jest nieczytelny i zostaje pominięty (${err instanceof Error ? err.message : String(err)})\n`,
    );
    return undefined;
  }
}

/** Zapis wpisu. Serializacja przez JSON, bo magazyn promptfoo jest dyskowy i trzyma tekst. */
export async function writeCell(key: string, cell: CachedCell): Promise<void> {
  await promptfooCache.getCache().set(key, JSON.stringify(cell));
}

/** Usunięcie wpisu — istnieje dla sprzątania po testach, które piszą do PRAWDZIWEGO magazynu. */
export async function deleteCell(key: string): Promise<void> {
  await promptfooCache.getCache().del(key);
}
