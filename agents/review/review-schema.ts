import { z } from "zod";

/**
 * JEDNA lista kryteriów — jedyne źródło, z którego mechanicznie powstają obie rzeczy,
 * które inaczej musiałyby być trzymane w zgodzie czujnością:
 *
 *   1. `REVIEW_SCHEMA` — kontrakt wyjścia modelu (redukcja po tej tablicy, niżej),
 *   2. `criteria.json` — dane dla `scripts/`, renderujących komentarz PR-a
 *      (generator `generate-criteria.ts`, bramka `git diff --exit-code` w composite action).
 *
 * Druga lista po stronie `scripts/` W OGÓLE NIE POWSTAJE — nie ma więc czemu dryfować.
 * `scripts/` czyta z agenta DANE, nigdy kodu: `agents/**` jest świadomie poza tsconfigiem
 * aplikacji, ESLintem i vitestem, a import przez tę granicę odebrałby agentowi przenośność,
 * która jest powodem, dla którego w ogóle budujemy własnego agenta zamiast brać gotową akcję.
 */
type Criterion = {
  /** Nazwa pola OCENY w JSON-ie wyniku. */
  readonly key: string;
  /** Nazwa pola UZASADNIENIA w JSON-ie wyniku. */
  readonly noteKey: string;
  /** Etykieta w polskim komentarzu PR-a. */
  readonly label: string;
  /** `true` → ocena może być `null` („nie dotyczy"); patrz komentarz przy `criteriaShape`. */
  readonly conditional: boolean;
  /** Opis pola oceny — patrz komentarz przy tablicy: to główna dźwignia sterowania modelem. */
  readonly describe: string;
};

/**
 * Kryteria zostają PŁASKIE (osobne pole oceny, osobne pole uzasadnienia), a nie zagnieżdżone
 * w obiekt `{ score, note }`. Powód jest pomiarowy, nie estetyczny: `z.number().nullable()`
 * zostało przez structured output ZMIERZONE (schemat emituje `anyOf: [{number},{null}]`,
 * model zwrócił `null`, `safeParse` dał `success: true`) — zagnieżdżony obiekt NIE został,
 * a to dokładnie ta klasa twierdzenia, którą to repo każe mierzyć, nie zakładać.
 *
 * Tablica obiektów zamiast nazwanych pól odpada z innego powodu: pozwoliłaby modelowi POMINĄĆ
 * kryterium, a wtedy brak wpisu byłby nieodróżnialny od oceny, o której zapomniał.
 *
 * PRÓG NIE POJAWIA SIĘ W ŻADNYM OPISIE. Próg wpleciony w prompt zmienia wejście modelu przy
 * każdej zmianie czułości — a więc zmienia też to, CO agent ocenia — i unieważnia porównanie
 * przebiegów sprzed i po zmianie progu, na którym stoi warunek wyjścia tej zmiany.
 */
export const CRITERIA = [
  {
    key: "implementationCorrectness",
    noteKey: "implementationCorrectnessNote",
    label: "Poprawność implementacji",
    conditional: false,
    describe:
      "Poprawność implementacji (skala 1-10): czy kod robi to, co deklaruje — na ścieżce głównej, " +
      "w przypadkach brzegowych i w obsłudze błędów. " +
      "1: logika jest błędna albo po cichu psuje istniejące zachowanie — warunek odwrócony, ścieżka błędu " +
      "renderuje się jako sukces (loader SSR pokazuje stan pusty zamiast błędu zapytania), endpoint JSON " +
      "odpowiada przekierowaniem, którego klient nie odróżni od sukcesu, plik .astro robi top-level return " +
      "we frontmatterze. " +
      "10: poprawny na ścieżce głównej, w przypadkach brzegowych (brak danych, zasób nieistniejący, żądanie " +
      "powtórzone) i w obsłudze błędów; błąd zapytania jest odróżniony od braku danych, a odmowa od awarii.",
  },
  {
    key: "idiomaticity",
    noteKey: "idiomaticityNote",
    label: "Idiomatyczność",
    conditional: false,
    describe:
      "Idiomatyczność (skala 1-10): zgodność z konwencjami języka I TEGO PROJEKTU. Konwencje projektu " +
      "(blok REGUŁY REPOZYTORIUM w prompcie systemowym) mają pierwszeństwo przed ogólnym gustem. " +
      "1: łamie twarde reguły repo — głębokie ścieżki względne zamiast @/*, odczyt środowiska przez " +
      "import.meta.env lub process.env zamiast astro:env/server (poza dwoma udokumentowanymi wyjątkami: " +
      "scripts/ i src/worker.ts), ręczne sklejanie klas Tailwind zamiast cn(), dyrektywy z Next.js " +
      "(use client), które w Astro nie robią nic, wyspa React tam, gdzie wystarczał statyczny .astro, " +
      "lokalne nadpisanie pierścienia focusu zamiast wspólnego tokenu --ring. " +
      "10: nieodróżnialny od kodu, który już w repo jest — te same importy, ten sam podział .astro/wyspa, " +
      "ta sama obsługa błędu formularza (przekierowanie z parametrem error), polska kopia UI, angielskie " +
      "identyfikatory.",
  },
  {
    key: "complexity",
    noteKey: "complexityNote",
    label: "Złożoność",
    conditional: false,
    describe:
      "Złożoność (skala 1-10): prostota rozwiązania WZGLĘDEM PROBLEMU, który rozwiązuje — nie krótkość kodu. " +
      "1: rozwiązanie nieproporcjonalne — warstwa abstrakcji dla jednego wywołania, konfiguracja pod przyszłe " +
      "potrzeby, których nikt nie zamówił, stan trzymany w dwóch miejscach i ręcznie synchronizowany, przepływ " +
      "sterowania, którego nie da się prześledzić bez rysowania. " +
      "10: najprostsza rzecz, która pokrywa opisane wymaganie; nowe pojęcia pojawiają się tylko tam, gdzie " +
      "problem je faktycznie ma; czytelnik trzyma całą ścieżkę w głowie naraz.",
  },
  {
    key: "testRiskCoverage",
    noteKey: "testRiskCoverageNote",
    label: "Pokrycie testami względem ryzyka",
    conditional: false,
    describe:
      "Pokrycie testami względem ryzyka (skala 1-10): nie „ile procent linii”, tylko czy testy dotykają tego, " +
      "co w TYM projekcie naprawdę potrafi zaboleć. Odniesieniem jest MAPA RYZYK z promptu systemowego wraz " +
      "z jej kolumną „co dowodzi ochrony”. " +
      "1: zmiana dotyka ścieżki z mapy ryzyk i nie przynosi żadnego testu, albo przynosi test, który przechodzi " +
      "niezależnie od zachowania (asercja niefalsyfikowalna, brak kontroli pozytywnej przy teście odmowy). " +
      "10: każda ścieżka ryzyka, której zmiana dotyka, ma test dowodzący dokładnie tego, co według mapy dowodzi " +
      "ochrony (np. dla ryzyka #1: konto B odbite na odczycie I na zapisie, przy jednoczesnym dowodzie, że konto A " +
      "nadal sięga po swoje); kod bez ryzyka nie jest obudowywany testami na siłę.",
  },
  {
    key: "documentationRationale",
    noteKey: "documentationRationaleNote",
    label: "Dokumentacja i uzasadnienie",
    conditional: false,
    describe:
      "Dokumentacja i uzasadnienie (skala 1-10): czy z diffa da się odtworzyć DLACZEGO, a nie tylko CO. " +
      "1: brak uzasadnienia tam, gdzie decyzja jest nieoczywista; komentarz opisuje linijkę pod nim " +
      "(„zwiększamy licznik”); komentarz-etykieta w rodzaju „best-effort” udaje decyzję, której nikt nie podjął; " +
      "zmiana łamie regułę spisaną w regułach repo i nigdzie tego nie odnotowuje; zmiana zachowania widocznego " +
      "dla użytkownika nie ma śladu w opisie zmiany. " +
      "10: nieoczywiste decyzje mają zapisany powód WRAZ Z KONSEKWENCJĄ (co się stanie, gdy założenie przestanie " +
      "obowiązywać, kto zauważy awarię); kontrakty, na których opiera się poprawność, są opisane jako kontrakty, " +
      "a nie jako dekoracja; dokumentacja projektowa jest aktualizowana wtedy i tylko wtedy, gdy zmiana " +
      "unieważniła jej treść.",
  },
  {
    key: "securitySafety",
    noteKey: "securitySafetyNote",
    label: "Bezpieczeństwo",
    conditional: false,
    describe:
      "Bezpieczeństwo (skala 1-10). " +
      "1: sekret trafia do repo, do logu albo do treści odpowiedzi; sprawdzenie właściciela zasobu zdjęte lub " +
      "obchodzone (identyfikator z URL-a traktowany jako dowód dostępu); nowa trasa chroniona zapomniana w liście " +
      "tras chronionych w middleware; tekst źródłowy użytkownika albo klucz LLM w komunikacie błędu (ryzyko #4). " +
      "10: dane wejściowe walidowane po stronie serwera niezależnie od UI (ryzyko #6); dostęp rozstrzygany na " +
      "tożsamości z sesji, nie na parametrze żądania; komunikaty błędów nie wynoszą treści użytkownika ani " +
      "sekretów; uprawnienia i zakres tokenów w CI ograniczone do tego, co dany krok naprawdę robi.",
  },
  {
    key: "swallowedError",
    noteKey: "swallowedErrorNote",
    label: "Połknięty błąd",
    conditional: true,
    describe:
      "Połknięty błąd (skala 1-10 albo null): czy wynik zapisu, kompensacji albo wywołania jest SPRAWDZANY, " +
      "czy cicho ignorowany. Sygnaturę wykrywalną z samego diffa opisuje blok POŁKNIĘTY BŁĄD promptu systemowego. " +
      "1: wynik operacji, która może się nie udać, jest porzucany albo sprowadzony do samego pola error; zapis " +
      "sprzątający po nieudanym kroku wygląda jak sprzątanie i milczy, gdy zawiedzie; zero dopasowanych wierszy " +
      "jest nieodróżnialne od udanego zapisu; komentarz „best-effort” zastępuje sprawdzenie. " +
      "10: każdy wynik jest odczytany i rozgałęziony na tym, co faktycznie dowodzi skutku (nie na samym braku " +
      "błędu); kompensacja jest traktowana jak zwykły zapis; tam, gdzie awaria ma pozostać nieobsłużona, jest to " +
      "zapisana decyzja z konsekwencją i wskazanym świadkiem awarii, a nie przeoczenie. " +
      "ZWRÓĆ null („nie dotyczy”), gdy diff nie dotyka żadnej ścieżki zapisu, kompensacji ani wywołania mogącego " +
      "zawieść — np. zmiana wyłącznie w treści UI, w dokumentacji, w statycznym stylu. " +
      "null NIE JEST OCENĄ i nie wolno go zastąpić liczbą: dziesiątka za brak ryzyka zawyżałaby wynik (zmiana, " +
      "która nie ruszyła żadnej ścieżki zapisu, wypadłaby lepiej niż zmiana, która ruszyła ją i obsłużyła " +
      "porządnie), a jedynka karałaby za ryzyko nieistniejące.",
  },
  {
    key: "gateIntegrity",
    noteKey: "gateIntegrityNote",
    label: "Integralność bramki",
    conditional: true,
    describe:
      "Integralność bramki (skala 1-10 albo null): jeśli zmiana dodaje albo modyfikuje SPRAWDZENIE — test, krok " +
      "CI, hook, asercję — to czy to sprawdzenie w ogóle potrafi zaświecić na czerwono. Bramka, która nie potrafi " +
      "zaświecić na czerwono, jest gorsza niż jej brak, bo zdejmuje czujność. " +
      "1: sprawdzenie jest niefalsyfikowalne — werdykt oparty na kodzie wyjścia komendy, która zawsze zwraca 0; " +
      "asercja na BRAKU negatywnego komunikatu zamiast na OBECNOŚCI pozytywnego; test, który przechodzi także na " +
      "celowo zepsutym kodzie; kontrola pozytywna oparta na cudzej fiksturze, więc zielona tylko w jednej " +
      "kolejności; krok CI, który zapisuje wynik do pliku i czyta pusty plik jako „brak różnic”. " +
      "10: pokazana albo oczywista jest droga do czerwieni — sprawdzenie zmierzone w OBU kierunkach (stan dobry " +
      "i celowo zepsuty), różnica między przebiegiem zielonym a czerwonym to dokładnie jedna rzecz, werdykt opiera " +
      "się na TREŚCI wyniku, a nie na samym kodzie wyjścia, a zmiana po stronie dostawcy wywala bramkę na czerwono " +
      "(fail closed) zamiast po cichu ją wyłączać. " +
      "ZWRÓĆ null („nie dotyczy”), gdy diff nie dodaje ani nie modyfikuje żadnego sprawdzenia. " +
      "null NIE JEST OCENĄ i nie wolno go zastąpić liczbą — uzasadnienie arytmetyczne jak przy kryterium " +
      "„Połknięty błąd”.",
  },
  {
    key: "scopeDiscipline",
    noteKey: "scopeDisciplineNote",
    label: "Dyscyplina zakresu",
    conditional: false,
    describe:
      "Dyscyplina zakresu (skala 1-10): czy zmiana robi dokładnie to, co deklaruje, bez przypadkowych poprawek " +
      "w sąsiednim kodzie. Kalibrację (co JEST, a co NIE JEST naruszeniem) opisuje blok ZAKRES promptu systemowego. " +
      "1: diff zawiera zmiany bez związku z deklaracją — oportunistyczny restyle współdzielonego komponentu, " +
      "„przy okazji” refaktor sąsiedniego modułu, zmiana formatowania w plikach, których zadanie nie dotyczyło, albo " +
      "dwie niezależne zmiany zlepione w jedną tak, że nie da się cofnąć jednej bez drugiej. " +
      "10: każdy dotknięty plik daje się wyprowadzić z deklaracji; rzeczy zauważone po drodze, a niebędące " +
      "w zakresie, są odłożone i odnotowane, a nie zrobione mimochodem; zmiana jest odwracalna jako całość. " +
      "To kryterium DOTYCZY KAŻDEJ zmiany bez wyjątku — nigdy nie zwracaj tu null.",
  },
] as const satisfies ReadonlyArray<Criterion>;

/**
 * Typ wyniku wyprowadzony z tablicy, a nie wypisany ręcznie obok niej — inaczej byłaby to
 * trzecia kopia listy kryteriów i pierwsza, która potrafi zdryfować po cichu, bo kompilator
 * nie widzi runtime'owej redukcji niżej.
 */
type ScoreOf<C> = C extends { readonly conditional: true } ? number | null : number;

export type Review = {
  readonly [C in (typeof CRITERIA)[number] as C["key"]]: ScoreOf<C>;
} & {
  readonly [C in (typeof CRITERIA)[number] as C["noteKey"]]: string;
} & {
  readonly verdict: "pass" | "fail";
  readonly summary: string;
};

/**
 * Schemat pól kryteriów budowany MECHANICZNIE z tablicy: rozjazd między schematem a listą
 * znika przez konstrukcję, a nie przez czujność.
 *
 * Score'y to zwykłe `z.number()`, bo structured output Anthropica odrzuca `minimum`/`maximum`
 * na typie liczbowym — zakres 1-10 wymuszamy wyłącznie OPISEM pola. Dlatego `describe` w tablicy
 * wyżej nie jest kosmetyką, tylko jedyną realną dźwignią sterowania modelem.
 */
const criteriaShape = CRITERIA.reduce<Record<string, z.ZodType>>((shape, criterion) => {
  shape[criterion.key] = criterion.conditional
    ? // `null` = „nie dotyczy”: wartość ROZRÓŻNIALNA od każdej oceny — nie zero i nie puste pole.
      z.number().nullable().describe(criterion.describe)
    : z.number().describe(criterion.describe);
  shape[criterion.noteKey] = z.string().describe(
    `Uzasadnienie oceny „${criterion.label}” — jedno-dwa zdania. Wskaż konkretny plik, fragment albo NAZWANY ` +
      `brakujący dowód; nie parafrazuj opisu kryterium. ` +
      // Zmierzone na przebiegu kontrolnym (czysty diff, same zmiany tekstowe): przy wysokich ocenach model
      // schodził na ogólne stwierdzenia braku („żadnych sekretów, żadnych tras”), które dają się napisać
      // BEZ czytania tego diffa — czyli uzasadnienie nieodróżnialne od domyślnego. Zdanie niżej jest
      // odpowiedzią na ten pomiar, nie ostrożnością na zapas.
      `Dotyczy to TAKŻE ocen wysokich: napisz, CO konkretnie w tym diffie sprawdziłeś (nazwij plik albo ` +
      `fragment), a nie tylko czego nie znalazłeś — uzasadnienie, które pasowałoby do dowolnej zmiany, ` +
      `nie jest uzasadnieniem.` +
      (criterion.conditional
        ? ` Gdy ocena to null („nie dotyczy”), napisz, DLACZEGO kryterium nie ma zastosowania do tego diffa.`
        : ``),
  );
  return shape;
}, {});

const REVIEW_OBJECT = z.object({
  ...criteriaShape,
  verdict: z
    .enum(["pass", "fail"])
    .describe(
      "Wiążący werdykt dla całej zmiany. Wystaw go na podstawie tego, co widzisz — progu nie znasz " +
        "i nie masz go zgadywać.",
    ),
  summary: z
    .string()
    .describe("Podsumowanie w Markdown (2-3 zdania), na podstawie którego autor zmiany będzie mógł działać"),
});

/**
 * Rzutowanie jest tu JEDNYM świadomym ustępstwem i ma nazwaną granicę: `z.object(...)` zbudowane
 * z `Record<string, z.ZodType>` traci literalne nazwy pól, więc bez tego `safeParse` zwracałby
 * `Record<string, unknown>` i kontrakt istniałby wyłącznie w runtime. Rzutowanie NIE osłabia
 * walidacji — `REVIEW_OBJECT` waliduje dokładnie te pola, które wygenerowała redukcja — zmienia
 * tylko to, co o nich wie kompilator. Oba końce (redukcja i typ `Review`) pochodzą z tej samej
 * tablicy `CRITERIA`, więc rozjazd wymagałby zmiany jej KSZTAŁTU, nie treści.
 */
export const REVIEW_SCHEMA = REVIEW_OBJECT as unknown as z.ZodType<Review>;

/** Claude Agent SDK przyjmuje JSON Schema, nie obiekt zoda — stąd konwersja. */
export const REVIEW_JSON_SCHEMA = z.toJSONSchema(REVIEW_OBJECT, { target: "draft-07" });
