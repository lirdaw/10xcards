# Plan: Pierwsze wdrożenie 10xCards na Cloudflare Workers

## Context

`context/foundation/infrastructure.md` rozstrzygnął platformę wdrożeniową na **Cloudflare Workers**
(5/5 agent-friendly, zero migracji, $0 przy tej skali). Ten plan operacjonalizuje sekcję
"Getting Started" tego kontraktu w wykonalny runbook pierwszego wdrożenia — z fazami śledzonymi
przez checkboxy, świadomym traktowaniem integracji zewnętrznych (Supabase, OpenRouter) i osobnym
playbookiem edge case'ów.

**Ustalenia z wywiadu:** (1) pierwszy deploy **ręcznie** z lokala, CI/CD jako osobna późniejsza
faza; (2) **brak** chmurowego Supabase — plan zawiera provisioning; (3) OpenRouter **pominięty** —
wdrażamy obecną aplikację auth (generacja fiszek nie jest jeszcze zaimplementowana).

## Stan zweryfikowany (co JUŻ jest zrobione)

Repo jest **już skonfigurowane pod Workers** — kluczowa różnica względem założeń infrastructure.md:

- ✅ `wrangler.jsonc` → tryb Workers: `main: "@astrojs/cloudflare/entrypoints/server"`,
  `compatibility_flags: ["nodejs_compat"]`, `compatibility_date: "2026-05-08"`, assets binding
  `ASSETS` → `./dist`, `observability.enabled: true`. **Brak** `pages_build_output_dir`,
  brak `public/_headers`, `_routes.json`, `functions/` → to czysty projekt Workers, nie Pages.
- ✅ `astro.config.mjs` → `adapter: cloudflare()`, `output: "server"`, schemat `astro:env`
  z `SUPABASE_URL`/`SUPABASE_KEY` (`context:"server"`, `access:"secret"`, `optional:true`).
- ✅ `@astrojs/cloudflare@^13.5.0`, `wrangler@^4.90.0`, `astro@^6.3.1`, Node 22.14.0 (`.nvmrc`).
- ✅ `.gitignore` ignoruje `.env`, `.dev.vars`, `.wrangler/`.
- ✅ CI (`.github/workflows/ci.yml`) buduje na `main` (lint + `astro sync` + build z sekretami
  z GitHub), ale **nie deployuje**.
- ✅ `src/lib/supabase.ts` czyta env wyłącznie przez `astro:env/server` i zwraca `null` gdy brak —
  zgodnie z hard rules z AGENTS.md.

**Wniosek:** żadna migracja konfiguracji Pages→Workers w kodzie nie jest potrzebna. Jedyny dryf
"Pages" to pole metadanych w `tech-stack.md` (Faza 0).

## Bramki manualne (human-only, świadomie poza automatyzacją)

Zgodnie z operational story z infrastructure.md — te kroki wykonuje człowiek, agent ich nie robi
bez nadzoru: założenie konta Cloudflare, `wrangler login` (OAuth w przeglądarce) lub wystawienie
scoped API tokenu, założenie projektu Supabase, toggle potwierdzania e-mail, zmiana planu (free→paid).

---

## Fazy wdrożenia

### ☑ Faza 0 — Synchronizacja metadanych (Pages → Workers) — UKOŃCZONA
- [x] `context/foundation/tech-stack.md`: `deployment_target: cloudflare-pages` → `cloudflare-workers`
  (frontmatter, linia 8).
- [x] `context/foundation/tech-stack.md`: w sekcji "Why this stack" (linia 33) `Cloudflare Pages`
  → `Cloudflare Workers`. Nic poza Pages→Workers (zgodnie z wcześniejszą, niezatwierdzoną zmianą).
- [x] `wrangler.jsonc`: `name: "10x-astro-starter"` → `"10xcards"`, żeby Worker i subdomena
  `*.workers.dev` pasowały do projektu. Wykonane przed pierwszym deployem (zmiana `name` PO deployu
  osierociłaby stary Worker pod innym URL).

### ☑ Faza 1 — Konto Cloudflare + autoryzacja wrangler *(bramka manualna)* — UKOŃCZONA
- [x] Konto Cloudflare istnieje (`lirdaw@gmail.com`, account ID `e7ec9236…0cbc5`), plan Free.
- [x] CLI zautoryzowane OAuth Tokenem (już zalogowane — `wrangler login` niepotrzebne).
- [x] Weryfikacja: `npx wrangler whoami` zwraca konto; scope `workers (write)` obecny.
- Uwaga (hardening na później): OAuth token ma szeroki scope; docelowo scoped API token tylko
  *Workers Scripts:Edit* przy przejściu na CI.

### ☑ Faza 2 — Provisioning chmurowego Supabase *(integracja zewnętrzna, bramka manualna)* — UKOŃCZONA
- [x] Projekt Supabase w chmurze utworzony (`https://bhwnautkdfzrhepkuozx.supabase.co`).
- [x] **Region:** potwierdzony przez użytkownika jako blisko docelowych użytkowników (PL) —
  ryzyko latencji z rejestru rozbrojone.
- [x] `Project URL` (→ `SUPABASE_URL`) i klucz **publishable** (`sb_publishable_…`, → `SUPABASE_KEY`)
  pobrane. Nie `service_role`.
- [x] „Confirm email" — decyzja podjęta (auth działa end-to-end, więc toggle OFF albo konto
  potwierdzone mailem).

### ☑ Faza 3 — Sekrety w Cloudflare Workers — UKOŃCZONA
- [x] `SUPABASE_URL` ustawiony (Project URL, `https://…supabase.co`).
- [x] `SUPABASE_KEY` ustawiony (klucz publishable `sb_publishable_…`).
- [x] Weryfikacja: `npx wrangler secret list` → dokładnie dwa sekrety.
- [x] Wartości nie są commitowane (`.env`/`.dev.vars` w `.gitignore`).
- Uwaga: po drodze powstał śmieciowy sekret nazwany URL-em (URL trafił jako nazwa) — usunięty,
  oba sekrety wpisane ponownie na czysto.

### ☑ Faza 4 — Lokalny test na runtime workerd PRZED deployem — UKOŃCZONA
**Rewizja po researchu (2 niezależne + test empiryczny):** w Astro 6 + `@astrojs/cloudflare` v13
`astro dev` biegnie na **prawdziwym workerd** (Cloudflare Vite plugin), więc daje wierność produkcji —
osobny `wrangler dev` jest zbędny. Sekrety: **jedno źródło `.env`**, BEZ `.dev.vars` (oba naraz
wykluczają się — obecność `.dev.vars` cicho nadpisuje `.env`; reguła „either/or" z docs Cloudflare).
- [x] `.env` jako jedyne źródło lokalnych sekretów; `.dev.vars` usunięty (był duplikatem, blokował `.env`).
- [x] `npm run build` — zielony (`Complete!`, adapter `@astrojs/cloudflare`, output `server`).
- [x] `astro dev` na workerd czyta `.env` — **potwierdzone empirycznie**: `/` renderuje się bez banera
  „Supabase nie jest skonfigurowany" → sekrety załadowane, `createClient` niepuste, middleware
  `auth.getUser()` przeszło bez błędu `crypto`/`Buffer` na workerd.
- [x] Pełny round-trip auth potwierdzony (użytkownik: signup → login → `/dashboard` z e-mailem;
  realne wywołanie Supabase Auth przeszło — brak błędów `crypto`/`Buffer` na workerd).

### ☑ Faza 5 — Pierwszy deploy produkcyjny — UKOŃCZONA
- [x] `npm run build` → `npx wrangler deploy` (po naprawie bindingu KV `SESSION`, patrz Faza 5a).
- [x] URL: **https://10xcards.lirdaw.workers.dev**.
- [x] `npx wrangler deployments list` → aktywna wersja `d53c71a2` (100%).

> **Faza 5a (napotkany blocker, rozwiązany):** deploy padał na `Experimental: bindings need to be
> provisioned: env.SESSION KV` → 400 „a namespace with this title already exists". Przyczyna: deploy
> idzie przez generowany `dist/server/wrangler.json`, w którym adapter wstawiał binding `SESSION`
> **bez id** → auto-provisioning próbował utworzyć istniejący już namespace. Fix: dodano
> `kv_namespaces` (SESSION → istniejący `16e4d72e…`, + `preview_id`) do `wrangler.jsonc` i
> **przebudowano** (id propaguje do configu deployu dopiero po rebuildzie). Commit `8eb28b7`.

### ☑ Faza 6 — Weryfikacja po deployu (na żywym URL) — UKOŃCZONA
Live URL: **https://10xcards.lirdaw.workers.dev** (Version `d53c71a2-b5c4-4bc3-a006-993a6e123b37`)
- [x] Strona główna 200, UI renderuje się (SSR na workerd), ~283 ms.
- [x] Brak banera „Supabase nie skonfigurowany" → sekrety załadowane na prod (`nodejs_compat`×Supabase OK).
- [x] `/dashboard` bez sesji → 302 na `/auth/signin` (guard `src/middleware.ts` działa na edge).
- [x] `/auth/signin` i `/auth/signup` → 200.
- [x] Pełny round-trip auth potwierdzony przez użytkownika: signup → login → `/dashboard` z e-mailem
  (user zapisany w `auth.users` w Supabase).
- [ ] *(opcjonalnie, nie zrobione)* `npx wrangler tail` podczas klikania — podgląd logów runtime.

### ☐ Faza 7 — Próba rollbacku (zanim będzie potrzebny) — ODROCZONA
> Historia wersji istnieje (m.in. `e214b51b`, `edd8116d` z 13:39–13:41), ale to wersje **sprzed**
> naprawy bindingu KV (powstały głównie przy `wrangler secret put`) — rollback do nich mógłby zepsuć
> live. Czysty rollback-drill zrób po **drugim znanym-dobrym deployu** (cofasz good-v2 → good-v1 bez
> ryzyka). `deployments list` (odczyt) już wykonany: aktywna `d53c71a2`.
- [ ] `npx wrangler deployments list` → weź poprzednie **znane-dobre** `version-id`.
- [ ] `npx wrangler rollback [version-id]` (bez id = poprzednia wersja) → potwierdź powrót.
- [ ] **Caveat:** rollback cofa tylko Workera; zmiany schematu/danych Supabase NIE cofają się z nim.

### ☐ Faza 8 — Poza zakresem tego wdrożenia (świadomie odroczone)
- [ ] **CI auto-deploy-on-merge** — dodanie kroku `wrangler deploy` do `ci.yml` + `CLOUDFLARE_API_TOKEN`
  w GitHub secrets. Osobna faza na życzenie (stack zakłada `auto-deploy-on-merge`, ale infra-research
  formalnie nie obejmuje CI/CD).
- [ ] **OpenRouter / generacja fiszek** — niezaimplementowane. Gdy ruszy: dodać
  `OPENROUTER_API_KEY: envField.string({ context:"server", access:"secret" })` do schematu
  `astro:env` w `astro.config.mjs`, `wrangler secret put OPENROUTER_API_KEY`, endpoint np.
  `src/pages/api/cards/generate.ts`. **Wtedy** aktywują się ryzyka CPU 10ms / bundle 3MB z rejestru.

---

## Playbook edge case'ów (dodatkowe wsparcie)

| Objaw | Przyczyna | Krok naprawczy |
|---|---|---|
| `crypto`/`Buffer` error tylko na workerd (Faza 4/6), OK w `astro dev` | `nodejs_compat` nie pokrywa ścieżki `@supabase/ssr` | Potwierdź `compatibility_flags:["nodejs_compat"]` i świeżą `compatibility_date`; sprawdź [astro#issues](https://github.com/withastro/astro/issues) + [workers-sdk issues](https://github.com/cloudflare/workers-sdk/issues) pod kątem konkretnego API; w ostateczności przypnij wersję adaptera. |
| Logowanie „przechodzi", ale `/dashboard` nie widzi usera | Brak/zły sekret → `createClient`→`null`, auth cicho wyłączone | `wrangler secret list`; ponów `wrangler secret put`; re-deploy. |
| `wrangler deploy` odbija: bundle too large | Bundle > 3 MB gzip (limit free) | Zmierz rozmiar; tree-shake; rozważ plan $5 (limit 10 MB). |
| Deploy w „martwą ścieżkę" / komendy nie działają | Pomyłka Pages vs Workers | Repo jest Workers — używaj `wrangler deploy`, NIE komend Pages. |
| Statyczne assety gubią prefiks przy `base` | Bug [astro#16276](https://github.com/withastro/astro/issues/16276) | Nie ustawiaj sub-path `base`; jeśli musisz — zweryfikuj URL assetów na preview. |
| Po signup nie da się od razu zalogować | `Confirm email` = ON w Supabase | Albo kliknij link z maila, albo wyłącz toggle (Faza 2) do testów. `confirm-email.astro` pokaże wariant „Check your email" (poprawne). |
| Breaking change po `npm update` | Astro 6 wciąż beta (early 2026) | Przypnij wersje Astro + adaptera; `astro sync` + build w CI na każdy bump; śledź changelog. |

**Niuans (NIE blocker):** `import.meta.env.DEV` w `src/pages/auth/confirm-email.astro:4` to
statyczna flaga Vite podmieniana na `false` w buildzie — działa poprawnie na Workers, pokazując
komunikat „Check your email" na produkcji. Nie wymaga zmiany.

## Pliki dotykane w tym planie

- `context/foundation/tech-stack.md` — korekta metadanych Pages→Workers (Faza 0).
- `wrangler.jsonc` — opcjonalny rename `name` → `10xcards` (Faza 0).
- `.env` — jedyne źródło lokalnych sekretów (git-ignored); `.dev.vars` USUNIĘTY (na obecnym stacku
  duplikat, który cicho nadpisywałby `.env`). Sekrety produkcyjne osobno w Cloudflare (Faza 3).
- *Bez zmian w kodzie aplikacji* — starter jest gotowy do wdrożenia jak jest.
- Artefakt planu utrwalony w `context/changes/deployment/deployment-plan.md`
  (audit trail „co miało się wydarzyć" wg CLAUDE.md).

## Weryfikacja end-to-end (definicja sukcesu)

1. `npx wrangler whoami` → zautoryzowane konto.
2. `npm run build` → zielony build produkcyjny.
3. `astro dev` (workerd) z `.env` → sekrety wczytane, brak banera; pełny flow auth lokalnie.
4. `npx wrangler deploy` → aktywna wersja na `*.workers.dev`.
5. Na żywym URL: signup → signin → `/dashboard` z e-mailem; guard redirectuje niezalogowanych.
6. `npx wrangler tail` → brak runtime errorów.
7. `npx wrangler rollback` → potwierdzony powrót do poprzedniej wersji.

## Mapowanie na rejestr ryzyk infrastructure.md

- `nodejs_compat` × Supabase → Faza 4 (test na workerd przed prodem) + playbook.
- Brak sekretu → cichy null → Faza 3 weryfikacja + Faza 6 kontrola + playbook.
- Bundle 3MB / CPU 10ms → monitorowane; CPU nieaktywne dopóki brak generacji (OpenRouter odroczony).
- Pages↔Workers mismatch → rozbrojone (repo już Workers; Faza 0 czyści metadane).
- Astro 6 beta → przypięte wersje + CI; playbook.
- Region Supabase → Faza 2 (wybór regionu blisko użytkowników).
