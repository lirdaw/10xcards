---
change_id: backlog-review-routine
title: Recurring agent review of the 15 parked roadmap ideas
status: new
created: 2026-08-25
updated: 2026-08-25
archived_at: null
---

## Notes

cykliczny przeglad 15 pozycji Parked ideas w roadmap.md — agent czyta kod i wystawia kazdej pozycji werdykt (zrobione mimochodem / nadal aktualny / zdezaktualizowany / nieznany) z dowodem: sciezka pliku i linia. Wynik do context/foundation/backlog-review.md, nadpisywany co przebieg, zeby git diff pokazywal zmiane od ostatniego razu. Cwiczenie do M5L5: tryb 3 — petle i routines. Trigger: workflow_dispatch jako jedyny aktywny, schedule zakomentowany. Przebieg realny w GitHub Actions na osobnym kluczu OpenRoutera OPENROUTER_BACKLOG_KEY, wylaczanym po cwiczeniu.

## Decyzja (punkt 6 zadania M5L5)

**Nie uruchamiamy tego cyklicznie.** `schedule:` zostaje zakomentowany — nie z powodu
kosztu ani zaufania do agenta, tylko dlatego, że **nie ma odbiorcy wyniku**. Cotygodniowy PR,
którego nikt nie jest zobowiązany przeczytać, to nie pokrycie, tylko szum. Ta sama reguła
stoi już w `.github/workflows/schema-diff.yml`.

**Co musiałoby się zmienić:** kanał powiadomień + nazwany właściciel wyniku. Wtedy
odkomentowanie `schedule:` to jedna linia.

**W kontekście zespołu (8 osób) blokerem nie jest narzędzie, tylko fundament.** Routine
potrzebuje repozytorium, triggera i miejsca na wynik — dziś nie ma żadnego z tych trzech
(skrypty per instancja klienta poza gitem, brak GitLaba/GitHuba w pracy). To nie jest
„za wcześnie", to brak podstawy. Najbliższy realny wariant zdalnej pracy tam to **tryb 1**
(Remote Control — agent lokalnie, kontrola z telefonu), nie pętla.

**Obserwacja z przebiegu, warta zapamiętania niezależnie od trybu:** raport wyglądał
wiarygodnie ZANIM ktokolwiek sprawdził choć jedną cytowaną linię. Cztery dowody
zweryfikowane ręcznie zgadzały się co do numeru linii — ale wrażenie wiarygodności
powstało wcześniej i było od tego niezależne. Dla zespołu wchodzącego w AI to znaczy:
**checklista review musi istnieć przed pierwszym PR-em od agenta, nie po nim.**
