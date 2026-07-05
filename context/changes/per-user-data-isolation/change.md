---
change_id: per-user-data-isolation
title: Twarda izolacja danych per-konto (RLS) + rdzenne tabele
status: implementing
created: 2026-07-05
updated: 2026-07-05
archived_at: null
---

## Notes

Jira: C10X-1 (F-01, foundation) — https://lirdaw.atlassian.net/browse/C10X-1
Epic: C10X-10 Foundations & Infra. Fix version: MVP.

PRD refs: Access Control, Guardrails (izolacja danych per-user, prywatność), NFR: prywatność.

Zakres minimalny: wzorzec RLS + tabele Deck/Flashcard, których potrzebuje S-01/S-02.
GenerationSession dochodzi w S-04, pola harmonogramu SRS w S-03 (progresywne odsłanianie).

Risk: sekwencjonowana pierwsza — błąd tu (wyciek cudzych kart) łamie twardy guardrail
izolacji danych per-konto. Blokuje C10X-3 (S-01), C10X-6 (S-03), C10X-7 (S-04).
