# Generacja kandydatów fiszek AI — Plan Brief

> Full plan: `context/changes/ai-candidate-generation/plan.md`

## What & Why

Slice S-04 / C10X-7: użytkownik wkleja tekst źródłowy i dostaje kandydatów fiszek
wygenerowanych przez LLM (OpenRouter), zapisanych jako `generated`/`ai` i powiązanych z
sesją generacji. To rdzeń tezy produktu (metryka 75% akceptacji) — usuwa najdroższy krok
tworzenia talii. Obsługa błędu/timeoutu + „Ponów" (FR-018) i widoczny postęp są częścią
ukończenia, nie osobnym przyrostem.

## Starting Point

Istnieją: talie i ręczne CRUD fiszek (stan `accepted`), słowniki stanu (1=generated) i
źródła (2=ai) już zaseedowane, RLS per-user. Brak: tabeli `generation_session`,
jakiejkolwiek integracji LLM, endpointu JSON/async, Zoda oraz helpera fetch/timeout. Nav
„Generuj fiszki" jest wyłączony. `listFlashcards` nie filtruje po stanie.

## Desired End State

Zalogowany użytkownik w „Generuj fiszki" wybiera talię (lub tworzy nową), język i liczbę
kart, wkleja tekst (≤10k), klika „Generuj", widzi postęp, a potem read-only listę
wygenerowanych kart („zapisano N / pominięto M"). Karty są w bazie jako `generated`
powiązane z audytowaną sesją. Błąd/timeout → komunikat + „Ponów". Widok talii domyślnie
pokazuje tylko `accepted` (filtr w warstwie danych, bez UI); oglądanie `generated`/`rejected`
przez przełącznik stanów jest odłożone do S-05.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Talia docelowa | Selektor istniejącej + inline „Nowa talia" | Karta wymaga `deck_id`; nav globalny; działa dla nowego konta | Plan |
| Po generacji | Read-only lista wyników na generatorze | Domyka US-01 dla S-04 bez wchodzenia w recenzję (S-05) | Plan |
| Wyciek do talii | Domyślny filtr `accepted` w liście talii (bez UI); przełącznik stanów → S-05 | Kandydaci `generated` nie mieszają się z `accepted` (sliver FR-014) | Plan |
| Architektura | Wyspa React → `fetch` JSON `/api/generate` (sync) | Prosto, spełnia progress/no-freeze, min. ryzyko na Workers | Plan |
| Dostawca/model | OpenRouter, `fetch` REST, model w env (`OPENROUTER_MODEL`) | Tuning modelu bez redeploya; omija bundle/`nodejs_compat` SDK | Plan / Infra |
| Limit tekstu | ~10 000 znaków | Balans użyteczność vs koszt/CPU/timeout Workers | Plan |
| Język kart | Selektor języka (domyślnie „ten sam co tekst") | Jawna kontrola użytkownika | Plan |
| Sesja generacji | source_text, model, język, liczniki, status/error, **pełny request/response (jsonb)** | Audyt/tuning pod metrykę 75% | Plan |
| Liczba kart | Wybiera użytkownik (1..15) | Pełna kontrola na MVP | Plan |
| Walidacja LLM | Wymuszony JSON (`response_format` json_schema) + Zod | Deterministyczny parse; Zod przyda się dalej | Plan |
| Wadliwe karty | Master prompt z regułami + self-check; walidacja Zod; **pomiń wadliwe** (bez re-calla) | Prosto na MVP, pojedynczy call; 1-shot korekta świadomie odłożona (F5) | Plan |
| FR-018 | Client `AbortController` (~45–60s) + „Ponów"; serwer → JSON error | Wprost realizuje jasny komunikat + retry | Plan |
| Weryfikacja | Manualna + smoke-test na preview + mock bez klucza | Zgodne z brakiem suite; łapie edge/`nodejs_compat` | Plan |

## Scope

**In scope:** migracja `generation_session` + `flashcard.generation_id`; klient OpenRouter
(fetch, mock, timeout); Zod; endpoint JSON `/api/generate`; strona `generate.astro` + wyspa
`GeneratorForm`; włączenie nav; przełącznik stanów w widoku talii.

**Out of scope:** recenzja accept/edit/reject i bulk (S-05); pełny FR-014 (zakres dat);
wyszukiwanie (S-06); SRS (S-03); streaming/joby; SDK OpenRouter; import plików; framework testów.

## Architecture / Approach

Pionowo od dołu: **DB → warstwa danych → klient LLM → endpoint JSON → UI → toggle talii.**
Wyspa React robi `fetch` do `/api/generate`; endpoint (auth → walidacja → resolve/utworzenie
talii → OpenRouter structured JSON → walidacja Zod (pomiń wadliwe) → zapis sesji + kart) zwraca
JSON. Mirror konwencji `decks.ts`/`flashcards.ts` (surowe `{data,error}`, błędy w endpoincie)
i `supabase.ts` (null-check env). Sesja jest rodzicem kart (`generation_id` = `ON DELETE SET NULL`).

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Schemat + dane | migracja `generation_session` + `generation_id`, `generations.ts` | RLS/typy DB poprawne |
| 2. Klient LLM + env + Zod | `openrouter.ts`, sekrety, walidacja Zod (pomiń wadliwe) | structured outputs zależne od modelu; timeout na workerd |
| 3. Endpoint `/api/generate` | pierwszy endpoint JSON, orkiestracja | `nodejs_compat`/CPU na edge — smoke-test preview |
| 4. Strona + wyspa + nav | UI generatora, progress, „Ponów", lista wyników | UX progress/FR-018; a11y |
| 5. Toggle stanów w talii | filtr `listFlashcards`, przełącznik stanu | brak regresji manual-card-crud |

**Prerequisites:** F-01 (RLS, C10X-1) i S-01 (talie, C10X-3) — oba Done. Lokalny stack
Supabase; `OPENROUTER_API_KEY` w `.env` (mock działa bez).
**Estimated effort:** ~3–4 sesje przez 5 faz.

## Open Risks & Assumptions

- Domyślny model OpenRouter musi wspierać `structured_outputs` — dobór/tuning przez env.
- Free tier Workers (10 ms CPU, 50 subrequestów) może wymagać planu $5 przy realnym ruchu.
- `nodejs_compat` to shim — realny call weryfikować na deployed preview, nie tylko `astro dev`.
- Faza 5 dotyka pliku sąsiedniego slice'a (widok talii) — zmiana konieczna (anty-wyciek), nie polerka.

## Success Criteria (Summary)

- Wklejenie tekstu → generacja → zapisani kandydaci `generated` powiązani z sesją; widoczny
  postęp bez zawieszania UI.
- Błąd/timeout → jasny komunikat po polsku + działający „Ponów" (FR-018).
- Kandydaci nie wyciekają do widoku talii `accepted`; smoke-test realnej generacji na preview OK.
