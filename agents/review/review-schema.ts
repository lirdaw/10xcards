import { z } from "zod";

/**
 * Rola recenzenta. Podajemy ją JAWNIE zamiast presetu `claude_code`,
 * bo chcemy recenzję wąską i przewidywalną — bez CLAUDE.md, skilli i narzędzi repo.
 */
export const SYSTEM_PROMPT = `Jesteś precyzyjnym, konstruktywnym recenzentem kodu oceniającym pull request.
Oceń podany diff w pięciu kryteriach w skali 1-10 (1 = poważne braki, 10 = wzorowo):
poprawność implementacji, idiomatyczność, złożoność, pokrycie testami względem ryzyka, bezpieczeństwo.
Następnie wydaj wiążący werdykt (pass/fail) dla całej zmiany i dołącz krótkie podsumowanie (2-3 zdania)
w Markdown, na podstawie którego autor PR-a będzie mógł działać.`;

/**
 * Kontrakt wyjścia — jedno źródło prawdy.
 *
 * Score'y to zwykłe z.number(): structured output Anthropica odrzuca minimum/maximum
 * na typie integer, więc zakres 1-10 wymuszamy OPISEM pola i promptem, nie schematem.
 * Dlatego `.describe()` to nie kosmetyka, tylko główna dźwignia sterowania modelem.
 */
export const REVIEW_SCHEMA = z.object({
  implementationCorrectness: z
    .number()
    .describe(
      "Poprawność implementacji: czy kod robi to, co deklaruje (skala 1-10). " +
        "1: logika jest błędna lub po cichu psuje istniejące zachowania. " +
        "10: poprawny na ścieżce głównej, w przypadkach brzegowych i w obsłudze błędów."
    ),
  idiomaticity: z
    .number()
    .describe("Idiomatyczność: zgodność z konwencjami języka i projektu (skala 1-10)"),
  complexity: z
    .number()
    .describe("Złożoność: prostota rozwiązania względem problemu (skala 1-10)"),
  testRiskCoverage: z
    .number()
    .describe("Pokrycie testami proporcjonalne do ryzyka zmienianych ścieżek (skala 1-10)"),
  securitySafety: z
    .number()
    .describe("Bezpieczeństwo: brak podatności i wycieków sekretów (skala 1-10)"),
  verdict: z.enum(["pass", "fail"]).describe("Wiążący werdykt dla całej zmiany"),
  summary: z.string().describe("Podsumowanie w Markdown, gotowe jako komentarz do PR-a"),
});

/** Claude Agent SDK przyjmuje JSON Schema, nie obiekt zoda — stąd konwersja. */
export const REVIEW_JSON_SCHEMA = z.toJSONSchema(REVIEW_SCHEMA, { target: "draft-07" });

export type Review = z.infer<typeof REVIEW_SCHEMA>;
