# Bramka regresji na zmianach promptu agenta review — Plan Brief

> Full plan: `context/changes/review-eval-gate/plan.md`
> Requirements: `context/changes/review-eval-gate/requirements.md`
> Research: `context/changes/review-eval-gate/research.md`

## What & Why

Zestaw evali agenta review istnieje i jest zmierzony, ale **żaden z sześciu workflow go nie
uruchamia ani się do niego nie odwołuje** — zmiana `SYSTEM_PROMPT` wchodzi dziś na `main` bez
jednego pomiaru. Ta zmiana domyka drugie zdanie zadania z M5L3: zestaw zostaje bramką regresji.
Kształt to **zapadka na dowodzie**, nie uruchamianie macierzy w CI: krok CI sprawdza, czy zmiana
promptu ma dołączony AKTUALNY wynik ręcznego przejścia. Macierz w CI byłaby bramką flaky (ten sam
model, fikstura i prompt dały koszt komórki różniący się o 58%), a bramka flaky to bramka, którą
wszyscy uczą się przeklikiwać.

## Starting Point

`npm --prefix agents/review run eval` odpala macierz 2×2 (`haiku-4.5`, `gemini-2.5-flash` ×
`sample.diff`, kontrola negatywna `clean-text-change.diff`) z asercjami deterministycznymi
i rachunkiem per komórka. Odcisk wywołania — `productionPromptFingerprint()`, cztery osie liczone
z WARTOŚCI faktycznie wysyłanych do modelu — też już istnieje i jest pilnowany per oś przez
`cache.test.ts`. Nie istnieje: plik dowodu, checker, workflow.

## Desired End State

Na każdym PR-ze do `main` biegnie job `Eval ratchet`, który za 0 USD i bez żadnego sekretu
sprawdza `agents/review/evals/eval-record.json` i czerwieni, gdy dowodu brak, gdy jest nieaktualny,
gdy macierz jest niepełna, gdy komórka jest czerwona albo gdy plik został przeformatowany.
Komunikat czerwieni nazywa, KTÓRY odcisk się rozjechał, cytuje starą i nową wartość tam, gdzie są
czytelne (`próg 5 → 8`), i mówi, czy remedium kosztuje.

## Key Decisions Made

| Decyzja                      | Wybór                                                        | Dlaczego                                                                                                          | Źródło       |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| Kształt bramki               | Zapadka na dowodzie, macierz odpala człowiek                 | Bramka ma być deterministyczna; koszt komórki ma rozrzut dziesiątek procent                                       | Requirements |
| Zakres dowodu                | Pełna macierz 2×2, blokująca, fail-closed przy braku pliku   | Kolumna niezmierzona to kolumna, o której nic nie wiadomo; zielono przy braku = ciche wyłączenie bramki           | Req. + D2    |
| Model produkcyjny w dowodzie | NIE (sonnet poza macierzą)                                   | 0,1935 USD/komórka = ~0,50 USD za jeden przebieg; dziura NAZWANA w adnotacji, nie przeoczona                      | Research D3  |
| Treść dowodu                 | Pełna tabela + OBOWIĄZKOWA adnotacja „czym te liczby nie są" | Jedyne miejsce w repo z trendem kosztu; liczby bez adnotacji odtwarzają klasę C10X-39                             | Research D1  |
| Dom zapadki                  | Własny `.github/workflows/eval-ratchet.yml`, bez filtra      | `prompt-ratchet` traci bezzależnościowość; `agents-gate` ma filtr `agents/**`, który NIE sięga progu w `scripts/` | Plan         |
| Próg `SCORE_THRESHOLD`       | Druga oś dowodu — `verdictConfig` jako WARTOŚCI, nie hash    | Diff czyta się `5 → 8`, więc remedium ma co nazwać, a przepisanie jest czynnością, w której widać co się zmienia  | Plan         |
| Zakres `verdictConfig`       | `threshold`, `scoreMin`, `scoreMax` + `assertionsDigest`     | Linia podziału to ODPOWIEDŹ vs INTERPRETACJA: asercje nie jadą do modelu, kryteria są już w odcisku wywołania     | Plan (D-3)   |
| Fikstury w dowodzie          | NIE — dziura nazwana w `notes.fixtures`                      | Fikstura jest po stronie ODPOWIEDZI, więc jej remedium byłoby płatne; zlałoby to dwa rozłączne remedia z D-2      | Plan (D-3)   |
| Miejsce i format dowodu      | `agents/review/evals/eval-record.json`, kształt ZMIERZONY    | Widzą go cztery workflow; prettier zwija tablice wartości prostych, więc czystość jest kryterium, nie założeniem  | Plan         |
| Kontrola pozytywna           | Test per oś + próba czerwieni na ŻYWYM CI, zwykłym pushem    | `lessons.md:250-255`; zweryfikowane, że `pre-push` (rootowy typecheck) sond nie blokuje — API GitHuba zbędne      | Plan         |

## Scope

**In scope:** wydzielenie odcisku spod `promptfoo`; rdzeń + zapisywacz + checker dla obu osi; plik
dowodu z adnotacją; nowy workflow bez filtra `paths`; testy kontroli pozytywnej per oś; jedno płatne
przejście macierzy; dwie sondy czerwieni na żywym CI; wyłączenie dowodu z recenzowanego diffa; dwa
wpisy w AGENTS.md §Commands.

**Out of scope:** uruchamianie macierzy w CI; rozszerzanie macierzy (sonnet, nowe fikstury); strojenie
progu 5; awansowanie `conditional-null-contract` do asercji twardej; podbicie `CACHE_FORMAT_VERSION`;
zmiany w `.prettierignore`; zmiana doradczego charakteru bramki review.

## Architecture / Approach

Jeden plik dowodu, dwa bloki, dwóch właścicieli — wymuszone granicą kierunkową repo (`scripts/`
czyta z `agents/` DANE, nigdy kodu, bo import odebrałby agentowi przenośność):

```
agents/review/evals/eval-record.json
├── callFingerprint  ← pisze i sprawdza strona AGENCKA (zod + SDK, npm ci --omit=dev)
│                       remedium PŁATNE: npm --prefix agents/review run eval -- --record
└── verdictConfig    ← pisze i sprawdza strona scripts/ (ZERO zależności)
    {threshold, scoreMin, scoreMax, assertionsDigest}
                        remedium NIEPŁATNE: scripts/run-verdict-config.ts --write
                        (digest asercji: remedium to CZYNNOŚĆ LUDZKA, nie przeliczenie)

.github/workflows/eval-ratchet.yml  (bez paths, bez sekretu)
  1. setup-node (22)                ← wymagane przez --experimental-strip-types
  2. check-verdict-config.ts        ← sekundy, PRZED `npm ci`
  3. npm ci --omit=dev  → check-eval-record.ts
```

`fingerprintPrompt` przenosi się do `agents/review/evals/fingerprint.ts`, żeby ścieżka zapadki nie
ciągnęła `promptfoo` — ~335 MB instalacji zamiast ~2 099 MB na workflow biegającym na każdym PR-ze.

## Phases at a Glance

| Faza                              | Co dostarcza                                                 | Główne ryzyko                                                               |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1. Rdzenie odcisków               | `fingerprint.ts` bez promptfoo + `scripts/verdict-config.ts` | Przeniesienie funkcji rusza odcisk — kryterium sukcesu przypina `59ee111b…` |
| 2. Zapisywacze + pomiar prettiera | `--record`, `--write`, kształt dowodu ZMIERZONY              | Prettier-brudny kształt wykryty po zapłaceniu za przejście                  |
| 3. Przejście macierzy (PŁATNE)    | Prawdziwy `eval-record.json` + rozliczenie budżetu           | Zimne we wszystkich komórkach; komórka czerwona bez zmiany promptu          |
| 4. Zapadka                        | Dwa checkery, workflow, kontrola pozytywna w testach         | `promptfoo` przecieka importem i psuje `--omit=dev`                         |
| 5. Kontrola pozytywna na CI       | Dwie czerwienie + zieleń po rewercie, `verification.md`      | Sonda czerwieni więcej niż jedną bramkę (P2 celowo czerwieni też `ci`)      |

**Prerequisites:** `OPENROUTER_REVIEW_KEY` dostępny na czas fazy 3 (mapowany na komendę, nigdy
ustawiany na stałe — `OPENROUTER_API_KEY` psuje `npm test`); husky zainstalowany w checkoucie;
budżet 0,50 USD na wywołania modeli; **otwarty PR `review-eval-gate` → `main` przed fazą 5** —
zapadka biegnie na `pull_request[main]`, więc bez PR-a sonda nie uruchamia niczego, a otwarcie PR-a
musi iść PO `gh workflow disable "PR code review"`, bo `opened` i każdy `synchronize` to płatny
przebieg review (kotwica 0,6447345 USD, run `32637738782`), i ta bramka MUSI zostać włączona
z powrotem jako warunek zamknięcia fazy 5.

**Estimated effort:** ~4–5 sesji; jedno płatne przejście macierzy (~0,12 USD zimno) plus rezerwa.

## Open Risks & Assumptions

- Dwie kopie skali `SCORE_MIN`/`SCORE_MAX` nadal nie mają nic, co pilnowałoby ich zgodności —
  `verdictConfig` zapisuje kopię ze `scripts/`, kopia agencka zostaje niepilnowana.
- Flake gemini na asercji TWARDEJ zmusi do zapłacenia za ponowne przejście (przyjęte świadomie).
- Dowód da się sfałszować ręczną edycją pliku; domknięta jest tylko droga przez własne narzędzie
  (`--from` wyklucza się z `--record`).
- Regresja uderzająca wyłącznie w `anthropic/claude-sonnet-4.6` przejdzie tę bramkę na ZIELONO.
  Dziura nazwana i zapisana w adnotacji dowodu; **nie zapisujemy, że modele z jednej rodziny
  regresują razem** — to prawdopodobne i NIEZMIERZONE.

## Success Criteria (Summary)

- Zmiana `SYSTEM_PROMPT`, opisu kryterium albo schematu wyjścia bez dołączonego świeżego wyniku
  macierzy **nie wchodzi na `main`** — czerwień joba, nie ostrzeżenie.
- Zmiana progu werdyktu czerwieni osobno, z komunikatem `5 → 8` i darmowym remedium.
- Obie czerwienie i zieleń po rewercie **zaobserwowane na żywym CI**, nie tylko lokalnie.
