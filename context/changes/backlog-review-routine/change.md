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
