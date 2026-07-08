---
change_id: deck-workspace
title: Tworzenie i nazywanie własnych talii (prywatna przestrzeń)
status: implemented
created: 2026-07-07
updated: 2026-07-08
archived_at: null
---

## Notes

Pierwszy pionowy slice produktowy: zalogowany użytkownik tworzy i nazywa własne talie w prywatnej przestrzeni. Zakres: bramkowany dostęp (rejestracja/logowanie gatują wejście, niezalogowany nie wchodzi do przestrzeni talii), tworzenie i nazywanie talii, lista wyłącznie własnych talii. Kryteria akceptacji: użytkownik tworzy talię i nadaje jej nazwę (FR-017); widzi tylko własne talie, żadna cudza nie jest widoczna (US-03, izolacja z F-01); auth bramkuje dostęp (FR-001, FR-002); talia należy wyłącznie do konta, które ją utworzyło. Prerequisite F-01 (twarda izolacja per-konto/RLS) jest Done. PRD refs: US-03, FR-017, FR-001, FR-002. (source: C10X-3)
