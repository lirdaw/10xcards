// Ryzyko (test-plan.md #1; PRD §Access Control: "all flashcard and study routes are gated"):
// niezalogowany użytkownik nie może wejść na trasę chronioną.
//
// Sedno NIE brzmi "PROTECTED_ROUTES ma test" — to pokrywa tests/middleware.test.ts, które od
// C10X-27 jedzie it.each nad REALNĄ, zaimportowaną tablicą, na obu gałęziach (401 JSON / 302
// dokument). Sedno brzmi: guard jest ZAMONTOWANY i wykonuje się na prawdziwym żądaniu
// przeglądarki. Żadna istniejąca warstwa tego nie widzi:
//   - tests/middleware.test.ts woła onRequest na sfabrykowanym kontekście,
//   - Container API (tests/fixtures/endpoint.ts) świadomie NIE jest tam użyte, bo montuje
//     NOOP_MIDDLEWARE_FN, i renderuje wyłącznie routeType: "endpoint" — nigdy strony.
// Skutek: middleware, który przestał być montowany (plik przemianowany, export usunięty,
// zmiana adaptera), zostawia tamte przypadki w PEŁNI zielone, a produkcję otwartą.
//
// Orakl to FINALNY URL przeglądarki — nigdy status fetcha. fetch podąża za 302, a
// /auth/signin odpowiada 200: dokładnie tak ukrył się bug C10X-27 (StudySession.rate()
// czytało 302→HTML 200 jako sukces i po cichu gubiło oceny).
//
// Wszystko realne: prawdziwy middleware, prawdziwy routing, prawdziwy brak ciasteczka.
// Nic nie jest mockowane, bo nie ma tu zewnętrznej granicy do zmockowania.
//
// CLEANUP: nie ma czego rejestrować w `registry` (tests/e2e/fixtures.ts), bo ten plik nie
// zapisuje ani jednego wiersza w TABELACH APLIKACJI — stąd import wprost z @playwright/test.
// Zakres tego zdania jest świadomie węższy niż "nie tworzy ani jednego wiersza w bazie", bo
// tamto jest fałszywe dla kontroli pozytywnej #2: middleware woła supabase.auth.getUser(), a
// getUser() na wygasłym tokenie odpala refresh, który dotyka auth.refresh_tokens. To schemat
// `auth`, nie nasz, rośnie o stałą na przebieg i nie ma go jak sprzątnąć przez RLS — więc
// deklarujemy go, zamiast twierdzić, że go nie ma.
//
// Wzorzec: tests/e2e/seed.spec.ts (lokatory po roli, czekanie na STAN, dane unikalne).
import { test, expect } from "@playwright/test";

// Czekanie na STAN zawsze z JAWNYM limitem: `navigationTimeout` domyślnie wynosi 0, więc bez
// tego nieudane przekierowanie wisi do 30 s timeoutu testu z komunikatem o niczym. Przy pięciu
// trasach to 2,5 minuty na każdy przebieg deliberate-breakage zamiast ~25 s — a te przebiegi
// robi się seriami i ich koszt jest częścią kosztu tej warstwy.
const REDIRECT_TIMEOUT = 10_000;

// Kopia — świadoma, nie przeoczenie. Spec przeglądarkowy nie może zaimportować
// PROTECTED_ROUTES z @/middleware: ten moduł ciągnie astro:middleware oraz (przez
// @/lib/supabase) astro:env/server, a runner Playwrighta nie rozwiązuje wirtualnych modułów
// Astro.
//
// Kopia ma DWIE strony i test-plan.md opisuje tylko pierwszą (koszt). Druga jest zyskiem i bez
// niej pierwszy porządkujący czytelnik skasuje tę tablicę jako dług:
//   1. Koszt: dopisanie nowej trasy chronionej NIE dokłada tu wiersza automatycznie.
//      Właścicielem asercji nad REALNĄ tablicą pozostaje tests/middleware.test.ts.
//   2. Zysk: ta kopia jest JEDYNYM orakiem na USUNIĘCIE wpisu z PROTECTED_ROUTES. it.each nad
//      realną tablicą po prostu traci wiersz i zostaje w 100% zielone — zniknięcie ochrony nie
//      ma tam żadnego świadka. Tutaj ma. Dokładnie to mierzy breakage A.
//
// Wyłącznie trasy STRON, bo tylko one są nawigacją dokumentową. Powodem pominięcia /api/* jest
// TYLKO to, że przeglądarka użytkownika tam nie chodzi — NIE "inna konwencja (401 JSON)":
// dyskryminatorem w src/middleware.ts:20-21 jest WYWOŁUJĄCY, nie ścieżka, więc
// page.goto("/api/decks") to Sec-Fetch-Dest: document i dostałoby zwykłe 302. Konwencję JSON
// pokrywa tests/middleware.test.ts na obu gałęziach.
const PROTECTED_PAGE_ROUTES = [
  "/decks",
  // Guard biegnie PRZED loaderem strony, więc talia nie musi istnieć. UUID jest zmyślony
  // celowo: gdyby guard zniknął, ta trasa dałaby 404/500 zamiast redirectu — a asercja na
  // finalnym URL-u idzie na czerwono w obu tych przypadkach.
  "/decks/11111111-1111-4111-8111-111111111111",
  "/generate",
  "/study",
  "/dashboard",
];

test.describe("guard tras chronionych — wylogowana przeglądarka", () => {
  // storageState z playwright.config.ts jest globalny i ZALOGOWANY. Bez tej linii ten opis
  // testowałby dokładnie odwrotny przypadek i przechodziłby na zielono, nie dotykając ryzyka.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PROTECTED_PAGE_ROUTES) {
    test(`nawigacja na ${route} bez sesji ląduje na /auth/signin`, async ({ page }) => {
      await page.goto(route);

      // Czekamy na STAN (URL po przekierowaniu), nigdy na czas.
      await page.waitForURL("**/auth/signin", { timeout: REDIRECT_TIMEOUT });

      // "Sign in" jest w tej apce CZTEROkrotnie niejednoznaczne: tytuł dokumentu
      // (Layout title="Sign in"), nagłówek h1 (signin.astro:16), przycisk submit
      // (SignInForm.tsx:102) oraz LINK w topbarze strony publicznej (Topbar.astro:27-29).
      // Ten czwarty jest tu najważniejszy, bo jako jedyny stoi na ścieżce kontroli pozytywnej
      // niżej — to on sprawia, że zawężenie do ROLI jest nośne, a nie kosmetyczne. Strona
      // logowania jest wciąż po angielsku (C10X-19 nie domknięte).
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
  }

  // Kontrola pozytywna #1 — przekierowanie jest SELEKTYWNE. Bez niej aplikacja, która
  // wyrzuca KAŻDE żądanie na /auth/signin (zepsuty routing, padnięty Supabase, guard
  // podpięty za szeroko) czyta się jako perfekcyjna ochrona. To ta sama zasada, którą
  // test-plan.md §6.2 stawia obok każdej odmowy.
  test("trasa publiczna / pozostaje dostępna bez sesji", async ({ page }) => {
    await page.goto("/");

    // Predykat zamiast /:\d+\/$/: tamten wzorzec WYMAGAŁ jawnego portu w baseURL i wiązał
    // przypadek ze środowiskiem — pod baseURL bez portu nie dałoby się go spełnić.
    await expect(page).toHaveURL((url) => url.pathname === "/");

    // OBECNOŚĆ, nie sama nieobecność. Wersja sprzed adopcji sprawdzała wyłącznie, że nie ma
    // nagłówka "Sign in" — a to przechodzi na zielono nad aplikacją zwracającą 500 na "/",
    // czyli nad "padnięty Supabase", tą samą klasą, którą komentarz wyżej deklaruje jako
    // pokrytą. Nieobecność w nieograniczonym zbiorze nie jest falsyfikowalna (ta sama pułapka,
    // co czteropolicyjny neuter z §6.6). Nagłówek "10xCards" to h1 z Welcome.astro:32-36.
    await expect(page.getByRole("heading", { name: "10xCards" })).toBeVisible();
    // …i dopiero teraz nieobecność: guard nie przekierował strony publicznej. Zawężenie do
    // roli jest tu nośne — na tej samej stronie stoi <a>Sign in</a> z topbara (E3 wyżej).
    await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  });
});

// Kontrola pozytywna #2 — z sesją guard PRZEPUSZCZA. Osobny describe, bo świadomie
// korzysta z globalnego (zalogowanego) storageState.
// Od Phase 3 artefakt playwright/.auth/user.json MA producenta (projekt `setup`, który loguje
// się przez prawdziwy formularz i asertuje fakt DOM-owy zanim cokolwiek zapisze), więc czerwień
// TUTAJ jest znowu dowodem o guardzie, a nie najpierw podejrzeniem o wygasłą sesję. Gdyby sesja
// jednak nie powstała, przebieg pada wcześniej i głośno — w projekcie `setup`, nie tutaj.
test.describe("kontrola pozytywna — sesja obecna", () => {
  test("zalogowana nawigacja na /decks nie jest przekierowana na logowanie", async ({ page }) => {
    await page.goto("/decks");

    await expect(page).toHaveURL((url) => url.pathname === "/decks");

    // OBECNOŚĆ, dokładnie z tego powodu co E1 w kontroli #1 — znalezione weryfikacją manualną
    // fazy 4, nie było na liście E1-E7. Bez tej linii przypadek składa się wyłącznie z URL-a i
    // NIEobecności nagłówka logowania, więc przechodzi na zielono nad /decks zwracającym 500:
    // "nie przekierowano" jest wtedy prawdą, a strony i tak nie ma. `Talie` to jedyny nagłówek
    // pod tym URL-em (decks/index.astro:32-37; layout i sidebar nie mają żadnego).
    await expect(page.getByRole("heading", { name: "Talie" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  });
});
