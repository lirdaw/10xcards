# Izolacja danych per-konto (RLS) + rdzenne tabele — Plan Brief

> Full plan: `context/changes/per-user-data-isolation/plan.md`

## What & Why

Budujemy warstwę danych 10xCards od zera: tabele **Deck** i **Flashcard** plus słownik
**flashcard_state**, z twardą izolacją per-konto przez Supabase RLS. To fundament F-01 —
przy celu produktu `quality` izolacja nie może czekać za funkcjami: błąd tu (wyciek cudzych
kart) łamie twardy guardrail prywatności. Każdy kolejny slice dziedziczy granicę „żaden
użytkownik nie widzi cudzych danych".

## Starting Point

Warstwa danych jest pusta (`supabase/migrations/` nie istnieje, tylko `auth.users`). Auth
jest w pełni podpięte: SSR klient Supabase (`src/lib/supabase.ts`) niesie sesję użytkownika
i klucz `anon`, więc `auth.uid()` w politykach RLS zadziała out-of-the-box.

## Desired End State

Trzy tabele z włączonym RLS: zalogowany użytkownik robi CRUD tylko na swoich taliach i
kartach, `anon` nie widzi nic, wewnętrzne bigint ID nie muszą wyciekać (jest `public_id
uuid`), repo ma typowany `database.types.ts`, a w folderze zmiany leży udokumentowany dowód
izolacji dwóch kont.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Egzekwowanie RLS na karcie | Przez join z Deck (`EXISTS`) | Jedno źródło prawdy o właścicielu (talia); karta nie duplikuje `user_id` | Plan |
| Klucz główny | bigint IDENTITY od 100000 | <100000 zarezerwowane na numerację wewnętrzną (enum statusów) | Plan |
| Ekspozycja ID | `public_id uuid` na deck+flashcard | Wewnętrzne bigint mają być niewidoczne dla frontu | Plan |
| Wartości stanu | Tabela słownikowa `flashcard_state` + FK | Znormalizowane, rozszerzalne o przyszłe statusy | Plan |
| Pole `state` | Zaszyte teraz (NOT NULL, bez defaultu) | S-02 wymaga cyklu statusów; brak defaultu = jawny stan przy insert | Plan |
| Pole `source` | Odroczone do S-04 | W S-01/S-02 wszystkie karty są ręczne | Plan |
| Usuwanie talii | `ON DELETE CASCADE` | Brak osieroconych kart; kosz odroczony do osobnego story | Plan |
| Nazwa talii | `UNIQUE (user_id, name)` | Czysta przestrzeń nazw per użytkownik | Plan |
| `updated_at` | Trigger `moddatetime` | Niezawodny timestamp niezależny od klienta | Plan |
| Typy DB | Generowane teraz + skrypt `db:types` | Agent-friendly; typowany klient dla S-01/S-02 | Plan |
| Weryfikacja izolacji | Ręczna, udokumentowana (2 konta) | Brak runnera w baseline; automatyzacja to F-03 | Roadmap |

## Scope

**In scope:** tabele `deck`/`flashcard`/`flashcard_state` + seed, identity 100000, `public_id`,
FK/cascade, unikalność nazwy, CHECK-i, triggery `updated_at`, RLS deny-by-default + polityki +
grants, typowany klient, ręczny dowód izolacji.

**Out of scope:** GenerationSession (S-04), pola SRS (S-03), `source` (S-04), kosz/miękkie
usuwanie (osobne story), UI/endpointy (S-01+), automatyczny test izolacji (F-03).

## Architecture / Approach

Jedna migracja SQL (`init_core_schema`) w dwóch krokach: schemat (Faza 1), potem RLS + grants
(Faza 2), następnie zastosowanie lokalnie + generacja typów + ręczny dowód izolacji (Faza 3).
`deck` filtrowane po `auth.uid()`; `flashcard` przez przynależność do własnej talii. Klucz
`anon` (nie service-role) po stronie użytkownika, by RLS realnie chronił.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schemat rdzenny | Tabele + słownik + seed + triggery w migracji | Konwencja identity 100000 / FK uuid vs bigint |
| 2. RLS + grants | Polityki izolacji + deny-by-default + grants | Błędny predykat polityki = wyciek danych |
| 3. Zastosowanie + typy + weryfikacja | Typowany klient + udokumentowany dowód izolacji | Fałszywe „działa" bez realnego testu dwóch kont |

**Prerequisites:** działający lokalny stack Supabase (`npx supabase start`, Docker); auth już
obecne w baseline.
**Estimated effort:** ~1 sesja, 3 fazy (mała, skoncentrowana zmiana fundamentowa).

## Open Risks & Assumptions

- RLS chroni tylko dopóki ścieżki użytkownika używają klucza `anon` z sesją — wprowadzenie
  service-role obeszłoby izolację.
- Ręczna weryfikacja izolacji nie jest wymuszana w CI aż do F-03 — dyscyplina wykonania
  procedury spoczywa na implementującym.
- Kosz odroczony: dopóki nie powstanie follow-up story, twarde usunięcie talii jest
  nieodwracalne.

## Success Criteria (Summary)

- Zalogowany użytkownik widzi i modyfikuje wyłącznie własne talie i karty; `anon` nie widzi nic.
- Udokumentowany dowód: użytkownik A nie widzi danych użytkownika B.
- Repo ma stosującą się czysto migrację i typowany klient DB; `lint` + `build` przechodzą.
