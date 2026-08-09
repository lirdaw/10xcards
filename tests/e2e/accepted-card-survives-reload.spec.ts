// Ryzyko (test-plan.md #1/#6 — rozszerzenie, nie nowy scenariusz; PRD US-01: "zaakceptowane
// karty stają się częścią talii, gotowe do nauki"): zaakceptowanie kandydata musi uczynić go
// częścią talii — i musi to przetrwać odświeżenie strony.
//
// Dlaczego to jest warstwa PRZEGLĄDARKOWA, a nie integracyjna. Orakl stoi na loaderze strony
// `.astro`, którego §6.4 świadomie NIGDY nie renderuje (`callEndpoint` jedzie wyłącznie
// routeType: "endpoint"), a droga do niego prowadzi przez cztery granice naraz: sesję, routing,
// /api/generate, wyspę React i /cards/batch, po czym wyspa sama przeładowuje dokument. Ta
// journey wchodzi dokładnie w dziurę, którą §6.6 (wpis Phase 1) trzyma jako otwartą po C10X-27:
// "dwa loadery stron .astro".
//
// ORAKL: bezтreściowe LICZENIE przycisków `Edytuj` na stronie talii, 0 → 1 → N, a po reload
// nadal N. Każdy krok asertuje INNĄ oczekiwaną liczbę, więc czerwień nazywa, które przejście
// padło.
//
// Dlaczego zero jest PRAWDZIWYM zerem, a nie proxy: `listFlashcards` filtruje
// `.eq("state_id", STATE_ACCEPTED)` (src/lib/flashcards.ts:97-104), więc karta w stanie
// `generated` jest na stronie talii NIEWIDOCZNA — punkt zerowy mierzy się na talii, która już
// ma wiersze w bazie. To jest asercja, którą breakage 5.2 wywraca.
//
// Dlaczego NIE na ekranie przeglądu (świadoma decyzja, nie oszczędność): ekran przeglądu sam
// woła `window.location.reload()` na gałęzi akceptacji (CandidateReviewWorkspace.tsx:138), więc
// asercja tam po części sprawdzałaby to, co aplikacja wykonuje DLA testu; a jego linia metryki
// akceptacji ukrywa się po cichu przy błędzie agregatu, więc jej obecność jest dowodem, ale jej
// nieobecność nie dowodzi niczego.
//
// CLEANUP: talia i sesja generacji są REJESTROWANE w `registry` (tests/e2e/fixtures.ts) przed
// zapisem, a usuwa je projekt `teardown` po całym przebiegu — nigdy ostatnia linijka testu.
// Rejestrujemy DWA rodzaje wpisów, bo teardown musi dosięgnąć dwóch tabel: `generation_session`
// nie ma żadnego klucza obcego do talii (generation_session.sql:24 wskazuje tylko na
// auth.users), więc skasowanie talii zostawiłoby wiersz sesji na stałe.
//
// Wzorzec: tests/e2e/seed.spec.ts (lokatory po roli, czekanie na STAN, dane unikalne) oraz
// tests/e2e/setup/auth.setup.ts (bramka hydracji: ponawiaj AKCJĘ, aż jej SKUTEK będzie widoczny).
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";

// TRZY, i ta liczba jest wiążąca w jednym miejscu: po akceptacji pojedynczej karty zostają
// DWIE, więc zaznaczenie pierwszej z nich NIE czyni zaznaczenia pełnym i „Zaznacz wszystkie"
// naprawdę dobiera resztę. Przy N=2 `toggleAll` (useSelection.ts:36-38) zobaczyłoby
// `allSelected === true` i WYCZYŚCIŁO zaznaczenie — bulk poszedłby na puste. Nie zmniejszaj tej
// stałej poniżej 3 bez przeczytania tamtej gałęzi.
const CANDIDATE_COUNT = 3;

// Przeładowanie po batchu to pełny round-trip serwera z renderem SSR, a w trybie dev pierwsze
// wejście na trasę jeszcze ją kompiluje — domyślne 5 s na `expect` bywa za krótkie. Limit jest
// JAWNY tylko tam, gdzie czekamy na nawigację; nigdzie nie zastępuje czekania na stan.
const RELOAD_TIMEOUT = 20_000;

/**
 * Przyciski „Edytuj" — orakl zawartości talii, ale TYLKO gdy przeglądarka stoi na
 * /decks/<publicId>. `Edytuj` renderuje się w tej apce w DWÓCH miejscach: FlashcardItem.tsx:241
 * (strona talii, ×N) i CandidateItem.tsx:287 (ekran przeglądu, ×N na kandydata) — sprawdzone
 * enumeracją, to jedyne dwa wystąpienia w src/. Poza stroną talii ta liczba nie znaczy nic.
 *
 * Nie liczymy `Usuń`: pod getByRole wychodzi N+1 (przycisk usunięcia TALII w przyklejonym
 * nagłówku), a w surowym DOM N+2 (trzeci siedzi w zamkniętym <dialog>).
 */
function deckCardEditButtons(page: Page): Locator {
  return page.getByRole("button", { name: "Edytuj", exact: true });
}

/**
 * Przyciski „Akceptuj" per karta na ekranie przeglądu — i jednocześnie licznik pozostałych
 * kandydatów.
 *
 * `exact: true` jest tu NOŚNE, nie kosmetyczne: przycisk per karta nazywa się goło `Akceptuj`
 * (CandidateItem.tsx:268-278), a przycisk paska zbiorczego to `Akceptuj (2 fiszki)`
 * (CandidateReviewWorkspace.tsx:231). Dopasowanie nazwy w Playwrightcie jest domyślnie
 * PODCIĄGIEM, więc bez `exact` ta lokalizacja łapie oba — i liczy o jeden za dużo, kiedy pasek
 * jest widoczny. Ten spec asertuje liczbę właśnie w takim momencie (patrz asercja przy
 * „Zaznaczono: 2"), żeby ta flaga była falsyfikowalna, a nie deklaratywna.
 */
function candidateAcceptButtons(page: Page): Locator {
  return page.getByRole("button", { name: "Akceptuj", exact: true });
}

/** Pasek akcji zbiorczych. Renderuje się dopiero, gdy cokolwiek jest zaznaczone. */
function selectionBar(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Akcje na zaznaczonych fiszkach" });
}

/**
 * BRAMKA HYDRACJI wyspy przeglądu — i zaznaczenie pierwszego kandydata w jednym ruchu.
 *
 * `CandidateSelectionBar` zwraca `null`, dopóki nic nie jest zaznaczone (CandidateSelectionBar.tsx:39),
 * więc pojawienie się paska to SKUTEK, który nie może zaistnieć bez Reacta — dokładnie taki
 * sygnał, jakiego wymaga auth.setup.ts:76-96 (przełącznik hasła) i seed.spec.ts:14-22 (modal).
 * Klik w checkbox przed hydracją przepada bez śladu: `checked` jest kontrolowane przez
 * `selection`, więc bez nasłuchu nic się nie dzieje.
 *
 * Guard na początku jest OBOWIĄZKOWY, nie ozdobny: klik PRZEŁĄCZA, więc ponowienie po udanym
 * kliknięciu odznaczyłoby kartę i pętla wisiałaby w nieskończoność.
 *
 * Po przejściu tej bramki cała wyspa jest żywa — przyciski per karta należą do tego samego
 * komponentu — więc każda następna interakcja na tym ekranie jest zwykłym klikiem.
 */
async function selectFirstCandidate(page: Page): Promise<Locator> {
  const bar = selectionBar(page);

  await expect(async () => {
    if (await bar.isVisible()) return;
    await page.getByRole("checkbox", { name: "Zaznacz fiszkę 1", exact: true }).click();
    await expect(bar).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });

  return bar;
}

test("zaakceptowana fiszka trafia do talii i przetrwa odświeżenie", async ({ page, registry }) => {
  // Cała ścieżka to jedna generacja, dwie akceptacje (każda z przeładowaniem SSR) i cztery
  // wejścia na strony, a w trybie dev pierwsze wejście na każdą trasę ją kompiluje. Domyślne
  // 30 s nie wystarcza; to jest cena tej warstwy, nie objaw.
  test.setTimeout(180_000);

  const deckName = `E2E deck (journey A) ${Date.now()}`;
  // Marker musi być POCZĄTKIEM `source_text` i musi być KRÓTKI: teardown filtruje
  // `like("source_text", "<marker>%")`, a filtr PostgREST z długą wartością dostaje 414, zanim
  // zapytanie w ogóle poleci (pułapka C10X-28 z §6.6). Bez `%` ani `_` — to wieloznaczniki LIKE.
  const marker = `e2e-${Date.now()}`;
  // Bez wiodących i końcowych spacji: `validate()` wysyła `sourceText.trim()`, a licznik znaków
  // niżej liczy `value.trim().length` — dzięki temu długość surowa i przycięta są tą samą liczbą
  // i bramka hydracji może asertować konkretną wartość.
  const sourceText =
    `${marker} Fotosynteza to proces, w którym rośliny przekształcają energię świetlną w energię ` +
    `chemiczną. Zachodzi w chloroplastach, a jej produktem ubocznym jest tlen. Faza jasna wymaga ` +
    `światła i biegnie w tylakoidach; faza ciemna, czyli cykl Calvina, zachodzi w stromie i wiąże ` +
    `dwutlenek węgla w cukry proste.`;

  // PRZED zapisem, nie po — oba wpisy. Nazwa talii i marker są znane już teraz, więc rejestracja
  // nic nie kosztuje, a zamyka okno, w którym spec ginący między utworzeniem a zapisem zostawia
  // wiersz na zawsze (tak osierocono `E2E deck 1785947414992` w 2026-08-05).
  registry.deck(deckName);
  registry.generation(marker);

  // ── Generacja ───────────────────────────────────────────────────────────────────────────
  await page.goto("/generate"); // start zalogowany dzięki storageState

  const source = page.getByLabel("Tekst źródłowy");

  // BRAMKA HYDRACJI wyspy generatora, i ten sygnał jest wybrany po namyśle, nie pierwszy z
  // ręki. Oczywisty kandydat — „wybierz + Nowa talia i poczekaj, aż pojawi się pole nazwy" —
  // NIE jest sygnałem: przy koncie bez ani jednej talii `decks[0]?.publicId ?? NEW_DECK`
  // (GeneratorForm.tsx:117) czyni `isNewDeck` prawdą już w SSR, więc pole stoi w HTML przed
  // hydracją i guard wyszedłby natychmiast nad martwą wyspą. Konto e2e dzieli stan między
  // przebiegami (change.md D-01), więc obie te sytuacje są realne.
  //
  // Licznik znaków pod polem (`CharCount`, GeneratorForm.tsx:96-104) tego nie ma: jego treść
  // zmienia się WYŁĄCZNIE przez re-render Reacta na `onChange`. `fill()` przed hydracją zapisuje
  // wartość w DOM, ale licznik zostaje na „0 / …" — i to jest różnica, której samo
  // `toHaveValue` nie widzi (auth.setup.ts:76-96 zmierzyło ten sam błąd na formularzu logowania:
  // sonda po wartości to wyścig przebrany za czekanie).
  //
  // Regex zamiast importu SOURCE_MAX: pinujemy LEWĄ liczbę, czyli to, że licznik odbija NASZ
  // tekst; prawa to tylko stała formatu i nie ma tu nic do udowodnienia.
  const charCount = page.getByText(/^\d+ \/ \d+$/);
  await expect(async () => {
    await source.fill(sourceText);
    await expect(charCount).toHaveText(new RegExp(`^${String(sourceText.length)} / \\d+$`), { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });

  // Od tej linii wyspa jest żywa, więc niżej są zwykłe interakcje z POST-warunkami — nie czekania.

  // Nowa talia, jawnie: przy koncie, które już ma talie, domyślnie wybrana jest pierwsza z nich.
  await page.getByLabel("Talia docelowa").selectOption({ label: "+ Nowa talia" });
  const newDeckName = page.getByLabel("Nazwa nowej talii");
  await expect(newDeckName).toBeVisible();
  await newDeckName.fill(deckName);
  await expect(newDeckName).toHaveValue(deckName);

  const count = page.getByLabel("Liczba kart");
  await count.fill(String(CANDIDATE_COUNT));
  await expect(count).toHaveValue(String(CANDIDATE_COUNT));

  // `exact: true` również tutaj, jako reguła całej warstwy (auth.setup.ts:66-72), a nie dopiero
  // po tym, jak jakiś lokator na to nadepnie: „Generuj" jest PREFIKSEM stanu „Generuję…".
  await page.getByRole("button", { name: "Generuj", exact: true }).click();

  // Tryb mock (`OPENROUTER_API_KEY` wymuszony na "" przez webServer.env) odpowiada od razu, ale
  // pierwsze wejście w /api/generate w trybie dev jeszcze tę trasę kompiluje.
  const reviewLink = page.getByRole("link", { name: "Przejrzyj kandydatów", exact: true });
  await expect(reviewLink).toBeVisible({ timeout: RELOAD_TIMEOUT });

  await reviewLink.click();
  await expect(page).toHaveURL(/\/decks\/[^/]+\/review\?generation=/, { timeout: RELOAD_TIMEOUT });

  // Adres talii bierzemy z URL-a PRZEGLĄDARKI, nie z atrybutu w DOM — to ten sam identyfikator,
  // po którym poszła nawigacja. Odczyt jest ASERTOWANY, a nie ratowany przez `?? ""`: cichy
  // fallback zamieniłby nieudane wyłuskanie w test wykonany na „/decks/", czyli na cudzej
  // stronie, i liczba 0 czytałaby się jak wynik.
  const reviewUrl = page.url();
  const deckPublicId = /\/decks\/([^/]+)\/review/.exec(reviewUrl)?.[1];
  expect(deckPublicId, `nie udało się wyłuskać publicId talii z ${reviewUrl}`).toBeTruthy();
  const deckPath = `/decks/${String(deckPublicId)}`;

  // ── Punkt ZEROWY: karty istnieją, ale żadna nie jest zaakceptowana ──────────────────────
  await page.goto(deckPath);
  // OBECNOŚĆ przed nieobecnością, dokładnie z powodu E1 z journey B: `toHaveCount(0)` przechodzi
  // na zielono nad stroną błędu, nad „Nie znaleziono talii" i nad każdym 500 — nieobecność w
  // nieograniczonym zbiorze nie jest falsyfikowalna. `<h1>` to nazwa talii
  // (decks/[publicId]/index.astro:147-149), a gałęzie błędu i braku mają w layoucie inne tytuły
  // („Błąd", „Nie znaleziono") i żadnego takiego nagłówka — więc ta linia rozstrzyga, że patrzymy
  // na WŁAŚCIWĄ, wyrenderowaną stronę talii.
  await expect(page.getByRole("heading", { name: deckName, exact: true })).toBeVisible();
  await expect(deckCardEditButtons(page)).toHaveCount(0);

  // ── Akceptacja #1: ścieżka POJEDYNCZEJ karty ────────────────────────────────────────────
  await page.goto(reviewUrl);
  await expect(page.getByRole("heading", { name: `Przegląd — ${deckName}`, exact: true })).toBeVisible();
  await expect(candidateAcceptButtons(page)).toHaveCount(CANDIDATE_COUNT);

  // Bramka hydracji zostawia pierwszego kandydata ZAZNACZONEGO — i to jest w porządku: akcja per
  // karta dostaje `[card.publicId]` niezależnie od zaznaczenia (CandidateItem.tsx:264). Efekt
  // uboczny jest wręcz pożądany: pasek zbiorczy stoi wtedy na ekranie ze swoim
  // `Akceptuj (1 fiszkę)`, więc `exact: true` niżej naprawdę coś rozstrzyga.
  await selectFirstCandidate(page);
  await candidateAcceptButtons(page).first().click();

  // Wyspa po udanym batchu sama woła `window.location.reload()`, więc czekamy na STAN po
  // przeładowaniu — nigdy na czas i nigdy na samo „zniknięcie" przycisku.
  await expect(candidateAcceptButtons(page)).toHaveCount(CANDIDATE_COUNT - 1, { timeout: RELOAD_TIMEOUT });

  await page.goto(deckPath);
  await expect(page.getByRole("heading", { name: deckName, exact: true })).toBeVisible();
  await expect(deckCardEditButtons(page)).toHaveCount(1);

  // ── Akceptacja #2: ścieżka ZBIORCZA (pasek narzędzi) ────────────────────────────────────
  await page.goto(reviewUrl);
  await expect(candidateAcceptButtons(page)).toHaveCount(CANDIDATE_COUNT - 1);

  const bar = await selectFirstCandidate(page);

  // Nazwa checkboxa nosi licznik („Zaznacz wszystkie (2)"), więc TU dopasowanie podciągiem jest
  // świadome — a jest jednoznaczne, bo lokalizacja jest zawężona do paska.
  await bar.getByRole("checkbox", { name: "Zaznacz wszystkie" }).check();
  await expect(bar.getByText(`Zaznaczono: ${String(CANDIDATE_COUNT - 1)}`, { exact: true })).toBeVisible();

  // Ta asercja jest jedynym miejscem, w którym `exact: true` z `candidateAcceptButtons` jest
  // FALSYFIKOWALNE: pasek jest teraz widoczny ze swoim `Akceptuj (2 fiszki)`, więc bez tej flagi
  // liczba wyszłaby o jeden za duża. Merytorycznie mówi: zaznaczenie pokrywa wszystkich
  // pozostałych kandydatów, więc bulk niżej domknie talię do N.
  await expect(candidateAcceptButtons(page)).toHaveCount(CANDIDATE_COUNT - 1);

  await bar.getByRole("button", { name: "Akceptuj" }).click();

  // Cała generacja przejrzana — to jest ten jeden z trzech pustych stanów, który dotyczy zakresu
  // `?generation=` (CandidateReviewWorkspace.tsx:188-195). Znów OBECNOŚĆ obok liczby zero.
  await expect(page.getByText("Wszystkie fiszki z tej generacji zostały przejrzane.")).toBeVisible({
    timeout: RELOAD_TIMEOUT,
  });
  await expect(candidateAcceptButtons(page)).toHaveCount(0);

  // ── Sedno ryzyka: wszystkie N są w talii i PRZETRWAJĄ odświeżenie ───────────────────────
  await page.goto(deckPath);
  await expect(page.getByRole("heading", { name: deckName, exact: true })).toBeVisible();
  await expect(deckCardEditButtons(page)).toHaveCount(CANDIDATE_COUNT);

  await page.reload();
  await expect(page.getByRole("heading", { name: deckName, exact: true })).toBeVisible();
  await expect(deckCardEditButtons(page)).toHaveCount(CANDIDATE_COUNT);

  // Koniec testu. Talię i wiersz `generation_session` usuwa projekt `teardown` po całym
  // przebiegu, niezależnie od jego wyniku.
});
