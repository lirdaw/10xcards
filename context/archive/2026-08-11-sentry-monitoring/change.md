---
change_id: sentry-monitoring
title: Sentry monitoring on production — Astro 6 on Cloudflare Workers
status: archived
created: 2026-08-11
updated: 2026-08-12
archived_at: 2026-08-12T17:47:00Z
---

## Notes

Setup Sentry (monitoring produkcji) dla 10xCards — Astro 6.3.1 na Cloudflare Workers.

WAŻNE dla /10x-plan: zbadaj AKTUALNY stan konfiguracji pod moje wersje z package.json,
nie przepisuj snippetów sprzed miesięcy. Krytyczna rozbieżność: @astrojs/cloudflare v13
używa custom entry point (main w wrangler.toml → sentry.server.config.ts owijający
handler), a v14 emituje virtual:cloudflare/worker-entry i wymaga innego podejścia
(getsentry/sentry-javascript issue #21901). Ustal, którą wersję adaptera mam, i wybierz
właściwą ścieżkę. Sprawdź minimalne wersje @sentry/astro/@sentry/cloudflare wspierające
mój wariant.

Wymagania:

- integ. captureConsoleIntegration({ levels: ["warn","error"] }) — żeby ciche
  console.warn z handlerów (klasa swallowed-error z audytu) trafiały do Sentry,
- DSN czytany ze zmiennej środowiskowej / sekretu Cloudflare, NIE hardkodowany;
  tryb no-op gdy DSN pusty (ten sam kod na env z i bez Sentry),
- wrangler.toml: nodejs_compat włączony,
- nic nie deployuj samodzielnie — zatrzymaj się przed deploymentem, deploy zrobię sam.

Jira: C10X-53
