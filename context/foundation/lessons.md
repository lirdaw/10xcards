# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Match branch names in CI/hooks to the repo's actual default (`main`)

- **Context**: CI/CD workflows and git-related config (`.github/workflows/*.yml`, husky hooks) — implement / review phase.
- **Problem**: The scaffolded `ci.yml` triggered only on `master`, but the repo's working branch is `main`, so CI silently never ran on any push or PR. Caught during M1L4 setup.
- **Rule**: When generating or reviewing CI/CD workflows, git hooks, or any branch-referencing config, confirm branch names match the repo's actual default branch. This project uses `main` — do not assume `master`.
- **Applies to**: implement, impl-review

## One deploy pipeline per Cloudflare Worker — Workers Builds XOR GitHub Actions

- **Context**: Wiring CI/CD auto-deploy for a Cloudflare Workers project connected to a Git repo (Cloudflare Workers Builds and/or GitHub Actions + `cloudflare/wrangler-action`).
- **Problem**: Both can be active on the same Worker at once, so every push triggers two competing deploys. On this project Workers Builds failed with "build token deleted or rolled" while GitHub Actions deployed fine — confusing "build failed" alerts despite a live deploy, plus risk of the two pipelines racing/overwriting each other.
- **Rule**: Pick exactly one deploy pipeline per Worker. If using GitHub Actions + `cloudflare/wrangler-action`, disconnect Cloudflare Workers Builds from the repo (Dashboard → Worker → Settings → Build). Never run both for the same Worker.
- **Applies to**: plan, implement

## @astrojs/cloudflare deploys the generated dist config — rebuild after editing wrangler.jsonc

- **Context**: Deploying an Astro project with `@astrojs/cloudflare` via `wrangler deploy` (local or CI); any edit to `wrangler.jsonc`.
- **Problem**: `wrangler deploy` uses the adapter-generated `dist/server/wrangler.json` (via a `.wrangler/deploy/config.json` redirect), not `wrangler.jsonc` directly. Editing `wrangler.jsonc` without rebuilding means the change never reaches the deploy — cost two failed deploys before we saw the added id wasn't in the generated config.
- **Rule**: After editing `wrangler.jsonc`, run `npm run build` before `wrangler deploy` so the adapter regenerates `dist/server/wrangler.json`. Verify propagation by inspecting the generated file, not `wrangler.jsonc`.
- **Applies to**: implement, impl-review

## @astrojs/cloudflare auto-enables a SESSION KV binding — bind a real namespace with an id

- **Context**: Deploying Astro 6 + `@astrojs/cloudflare` to Workers (sessions enabled by default).
- **Problem**: The adapter injects a `SESSION` KV binding with no id into the generated config. Without a `kv_namespaces` entry carrying a concrete `id` in `wrangler.jsonc`, `wrangler deploy` tries to auto-provision the namespace and fails (HTTP 400 "a namespace with this title already exists" once one exists). Blocked the first production deploy.
- **Rule**: Declare `kv_namespaces: [{ binding: "SESSION", id: "<id>", preview_id: "<id>" }]` in `wrangler.jsonc` pointing at a real namespace (create with `wrangler kv namespace create`), then rebuild. Don't rely on deploy-time auto-provisioning.
- **Applies to**: implement

## Local Cloudflare secrets: use .env OR .dev.vars, never both

- **Context**: Local dev secrets for Astro 6 + `@astrojs/cloudflare` (wrangler 4.x, Aug-2025+ tooling), read via `astro:env/server`.
- **Problem**: `.env` and `.dev.vars` are mutually exclusive in Cloudflare's local tooling — if `.dev.vars` exists, `.env` is silently ignored. Keeping both (e.g. via the legacy `cp .env .dev.vars`) means edits to `.env` don't take effect; `astro dev` runs on real workerd and reads either, so the staleness is invisible until values drift.
- **Rule**: Keep exactly one local secrets file. For this stack use `.env` as the single source; do not create `.dev.vars`. Production secrets go via `wrangler secret put`, independent of both.
- **Applies to**: implement, impl-review

## Cloud migration is a separate step from app deploy

- **Context**: any change carrying a database migration / schema change targeting cloud Supabase; the deploy/ship phase.
- **Problem**: Merge to main deploys the Worker but does NOT apply migrations to the cloud database — a "shipped" app then runs against an un-migrated schema.
- **Rule**: Treat cloud migration as a step distinct from app deploy. "Shipped" = app deploy AND `db push`: `supabase login` (access-token, separate from the keys in `.env`) → `supabase link --project-ref <ref>` → `supabase db push`.
- **Applies to**: implement, impl-review

## Add RETURNING to RLS write-isolation tests in Supabase Studio

- **Context**: testing RLS write isolation (DELETE/UPDATE) via the Supabase Studio SQL editor.
- **Problem**: In Studio, DELETE/UPDATE without RETURNING always reports "No rows returned" — whether it touched 0 or 1 rows — so a policy failure reads as a PASS (false positive).
- **Rule**: Add RETURNING to DELETE/UPDATE in RLS write-isolation tests so "no rows" truly means 0 rows affected. In psql this is explicit anyway (DELETE 0 vs DELETE 1); in Studio, RETURNING is what makes the distinction visible.
- **Applies to**: implement, impl-review

## RLS tests need role + JWT claims AND a positive control

- **Context**: testing RLS policies for per-user data isolation.
- **Problem**: `SET ROLE authenticated` alone leaves `auth.uid() = NULL`, so every policy denies everything — the user sees 0 others' rows AND 0 of their own. That looks like isolation but is actually a broken policy. Testing as `postgres` (superuser) bypasses RLS entirely.
- **Rule**: An RLS test must set the role AND the JWT claims (`set local request.jwt.claims` with a `sub`), AND include a positive control: `count(*) > 0` for the user's own data. Never test RLS as `postgres`.
- **Applies to**: implement, impl-review

## Put commit conventions in AGENTS.md, not context memory

- **Context**: git commit conventions in an agent-driven repo.
- **Problem**: A freshly-cleared agent won't follow a convention that lives only in conversation/context memory — it will commit inconsistently.
- **Rule**: Encode commit conventions (English + Jira-number scope, e.g. `feat(C10X-1): …`, one line, imperative) in AGENTS.md so a cleared agent commits correctly on its own. When a convention matters, write it into the rules file — don't rely on context memory.
- **Applies to**: all

## Loadery SSR rozróżniają błąd zapytania od braku danych

- **Context**: Astro SSR page-loadery odczytujące dane z Supabase w `.astro` frontmatter (np. `decks/index.astro`, `decks/[publicId]/index.astro`) — faza implement/impl-review.
- **Problem**: Loadery czytały tylko `{ data }` z zapytania i pomijały `{ error }`. Przejściowy błąd Supabase/DB renderował się wtedy jako stan pusty („Nie masz jeszcze talii") albo 404 — awaria bazy podszywała się pod brak danych / nieistnienie, myląc diagnostykę.
- **Rule**: W loaderach SSR zawsze rozgałęziaj na `error` z zapytania i renderuj odrębny stan błędu („coś poszło nie tak"), zamiast utożsamiać błąd z pustym wynikiem lub 404.
- **Applies to**: implement, impl-review

## Keep main linear after a GitHub PR merge

- **Context**: local `main` after merging a PR on GitHub, when local `main` still had un-pushed commits.
- **Problem**: `git pull` wants to create an ugly merge-commit because local `main` diverged from `origin/main`.
- **Rule**: To keep linear history: `git reset --hard origin/main` → `git cherry-pick <local-sha>` → `git push`.
- **Applies to**: implement

## Nie rób top-level `return` we frontmatterze .astro

- **Context**: Strony/endpointy Astro SSR robiące przekierowanie lub odpowiedź statusową we frontmatterze `.astro` (redirect gościa/zalogowanego, 404 na brak zasobu).
- **Problem**: Top-level `return Astro.redirect(...)` albo `return new Response(null, {status})` we frontmatterze wykłada regułę `@typescript-eslint/no-misused-promises` — implicit async wrapper frontmattera ma null parent, więc reguła rzuca wyjątek w trakcie trawersacji i kładzie CAŁY lint; `eslint-disable-next-line` nie pomaga (crash jest przed filtrowaniem raportu). Ugryzło dwa razy: redirect „/"→"/decks" oraz 404 na obcy public_id.
- **Rule**: Nie rób top-level `return` we frontmatterze `.astro`. Przekierowania przenoś do `src/middleware.ts` (`context.redirect(...)`); dla statusu ustaw `Astro.response.status = ...` + render warunkowy, zamiast zwracać `Response` z frontmattera.
- **Applies to**: implement, impl-review

## Błąd formularza POST wraca do modala, nie w tle

- **Context**: Formularze natywny POST → redirect (tworzenie/zmiana nazwy talii; przyszłe formularze fiszek), gdzie błąd walidacji/serwera ma wrócić do modala.
- **Problem**: Natywny POST przeładowuje stronę, więc błąd serwera (np. duplikat nazwy) łatwo ląduje jako baner W TLE, a re-otwarty modal jest pusty; do tego parametry `?error=` zostają w URL i F5 odtwarza modal ze starym błędem oraz wpisaną nazwą.
- **Rule**: Round-trip błędu przez `?error=<msg>&open=<modal>`; strona przekazuje `serverError` do wyspy React, która pokazuje go WEWNĄTRZ modala (nie baner w tle) i seeduje nim stan błędu. Na mount wyczyść `open`/`error` z URL (`history.replaceState`), przy zamknięciu wyzeruj pole+błąd, `autoComplete="off"` na polu nazwy.
- **Applies to**: plan, implement, impl-review

## Poleruj tylko własne komponenty slice'a — zakres sąsiednich rozstrzygaj przed budową

- **Context**: Faza implementacji dowolnego slice'a, w momencie polerki/poprawek UI — zwłaszcza gdy edycja dotyka komponentów spoza plików, które ten slice tworzy: współdzielone prymitywy (`src/components/ui/*`), powłoka (`Sidebar.astro`, `AuthenticatedLayout.astro`), `global.css`. Typowy wyzwalacz: batch uwag zbieranych po fazie („przy okazji popraw X").
- **Problem**: Oportunistyczna polerka UI na sąsiednich/współdzielonych komponentach („jestem tu, to od razu poprawię") po cichu rozszerza zakres slice'a. W S-02 (manual-card-crud) commit p3 wwiózł Sidebar collapse, stopkę-mock i restyle przycisków poza zakresem card-CRUD — wyłapane dopiero w impl-review (F2), gdy było już zbudowane i zacommitowane, więc nie dało się tanio odłożyć.
- **Rule**: Poleruj tylko własne, nowe komponenty slice'a, w miejscu. Zanim dotkniesz komponentu, którego slice nie stworzył (powłoka, wspólny prymityw używany gdzie indziej), rozstrzygnij zakres PRZED budową: w zakresie → rób; poza → zapisz jako Deferred idea i odłóż. Nie rozstrzygaj tego po fakcie.
- **Applies to**: implement, plan-review, impl-review, plan

## Klient↔serwer timeouty + „Ponów" wymagają idempotencji zapisu

- **Context**: Endpointy wołające zewnętrzne, płatne API (LLM) z timeoutem po stronie serwera ORAZ klienta, plus retriable przycisk „Ponów" (FR-018). Ścieżka: `src/pages/api/generate.ts` (timeouty), `src/components/generate/GeneratorForm.tsx` (klient + retry).
- **Problem**: Nawet przy poprawnej kolejności timeoutów (klient 55s > serwer 40s) zostaje wąskie okno: gdy zapisy po stronie serwera (sesja + karty) przeciągną się po odpowiedzi modelu, klient abortuje na 55s i pokazuje „Ponów", a serwer i tak commituje. „Ponów" dokłada drugi komplet → duplikaty. Sam ordering timeoutów NIE eliminuje wyścigu — tylko go zawęża.
- **Rule**: Gdy zapis stanu jest wyzwalany przez wywołanie z timeoutem klient+serwer i retriable „Ponów", zaprojektuj zapis idempotentnie (idempotency key / dedup po identyfikatorze żądania), zamiast polegać wyłącznie na różnicy timeoutów. Jeśli idempotencja jest odłożona, zapisz to jawnie jako znany tradeoff i domknij, gdy pojawi się warstwa dedupu.
- **Applies to**: plan, implement, impl-review

## Operacje migracji Supabase — z folderu worktree; nie ślepo `repair`/`db pull` z podpowiedzi CLI

- **Context**: praca z migracjami Supabase w git worktree (równoległe slice'y, M2L5); faza ship / `db push`.
- **Problem**: `supabase link`/`db push` uruchomione z folderu NADRZĘDNEGO (nie z worktree) → CLI widzi niepełny zestaw migracji i rzuca mylące „Remote migration versions not found". Ślepe odpalenie podpowiedzianego `migration repair --status reverted <bazowe>` oznaczyło dwie bazowe migracje na PROD jako cofnięte = desync historii (schemat/dane NIETKNIĘTE — `repair` rusza tylko tabelę `schema_migrations`, nie SQL). Migracja o wcześniejszym timestampie niż już-wypchnięta (out-of-order) wymaga osobnej obsługi.
- **Rule**: Komendy `supabase` uruchamiaj ZAWSZE z folderu worktree danego slice'a (potwierdź `git branch --show-current` przed operacją na prod). NIE uruchamiaj na ślepo `migration repair`/`db pull`, które CLI podsuwa w treści błędu — to sugestie, nie instrukcje. Przy desyncu: `repair --status applied <te same ID>` → `migration list` (Remote wraca) → `db push`. Dla pending migracji starszej niż ostatnia na remote użyj `db push --include-all` (bezpieczne: migracje addytywne i niezależne, kolejność bez znaczenia dla schematu).
- **Applies to**: implement, impl-review

## Zweryfikuj, że feature DZIAŁA na PROD — nie tylko że się zdeployował

- **Context**: ship slice'a z zewnętrzną integracją wymagającą sekretu (LLM/OpenRouter); faza PROD-sanity.
- **Problem**: `.env` jest lokalny i NIE trafia na Cloudflare — sekrety prod idą osobno przez `wrangler secret put`. Bez ustawionego `OPENROUTER_API_KEY` na workerze feature wpadł w tryb MOCK na prodzie (przykładowe karty zamiast realnej generacji). CI-deploy „success" i strona się ładowała, więc brak sekretu był niewidoczny — wyszedł dopiero, gdy w sanity uruchomiono REALNY przepływ.
- **Rule**: W PROD-sanity uruchom realny przepływ feature'a (np. faktyczną generację), nie tylko sprawdź, że strona wstaje. Sekrety prod ustaw przez `wrangler secret put <NAZWA>` (niezależnie od `.env`) i potwierdź, że feature działa naprawdę (baner „nieskonfigurowany" / tryb mock = brak sekretu).
- **Applies to**: implement, impl-review

## Commit `/10x-archive` powstaje po merdżu na gałęzi → wprowadź go na main osobno

- **Context**: domknięcie slice'a przez `jira-finish` RUN 2 → `/10x-archive`, gdy feature był już zmergowany PR-em; faza po-ship.
- **Problem**: `/10x-archive` (przeniesienie change→archive + roadmap→done + status) tworzy commit na gałęzi feature PO merdżu PR-a i świadomie NIE pushuje. Efekt: archiwum i roadmap-done zostają na gałęzi, a na MAIN ich nie ma (zdarzyło się dla OBU slice'ów M2L5). Do tego `git branch -d` po wprowadzeniu tego commita na main cherry-pickiem odmówi (inny SHA → gałąź „niezmergowana" wg osiągalności).
- **Rule**: Po `/10x-archive` wprowadź commit archiwum na main osobno: `git checkout main` → `git pull --ff-only` → `git cherry-pick <sha>` → `git push`. Przed skasowaniem gałęzi potwierdź, że treść jest na main: `git cherry -v main <branch>` (same „-" = patch na main) → wtedy `git branch -D` (nie `-d`) jest bezpieczne.
- **Applies to**: implement, impl-review

## Astro Container API nie uruchamia middleware projektu — `locals` wstrzykuj ręcznie

- **Context**: testy integracyjne endpointów API renderowanych przez `experimental_AstroContainer` (`renderToResponse` z `routeType: "endpoint"`); faza implement/plan.
- **Problem**: Container montuje `NOOP_MIDDLEWARE_FN` — źródłowo potwierdzone w zainstalowanym `astro@6.3.1` (`dist/container/index.js` woła `createManifest(manifest, renderers)` z trzecim argumentem `middleware` = undefined). Dokumentacja Astro 6 o tym MILCZY, więc test oparty na założeniu „middleware się wykona" cicho dostaje `locals.user === undefined` zamiast błędu. W tym projekcie middleware jest jedynym miejscem, które ustawia `locals.user`.
- **Rule**: Testując endpoint przez Container API, wstrzykuj `locals` jawnie (`renderToResponse(mod, { locals })` — JSDoc opcji wprost mówi „without the use of middleware"). Auth oparte na cookie NADAL działa, ale tylko dlatego, że każdy endpoint sam buduje klienta z `createClient(request.headers, cookies)`; gdyby endpoint polegał na kliencie z `locals`, test testowałby atrapę. Nie testuj przez Container API tego, co robi middleware (np. guard `PROTECTED_ROUTES`) — Container tego nie uruchomi.
- **Applies to**: plan, implement, impl-review

## Nigdy nie sklejaj ręcznie cookie sesji `@supabase/ssr` — przechwyć je przez `setAll`

- **Context**: fabrykowanie realnej sesji zalogowanego użytkownika w testach (nagłówek `Cookie` dla `createServerClient`); faza implement.
- **Problem**: Format jest WEWNĘTRZNY i nieudokumentowany jako kontrakt: nazwa to `sb-${hostname.split(".")[0]}-auth-token` (więc `127.0.0.1` → `sb-127-auth-token`, a `localhost` → INNA nazwa), wartość to `"base64-" + base64url(JSON.stringify(session))`, a dokumentacja opisuje chunkowanie BŁĘDNIE — co samo w sobie dowodzi, że to nie jest utrzymywany kontrakt publiczny. Najgorsze: ścieżka odczytu połyka zepsutą wartość z samym `console.warn` i traktuje sesję jako NIEOBECNĄ — literówka w serializacji objawia się jako „test tajemniczo wylogowany", nigdy jako błąd.
- **Rule**: Zbuduj jednorazowy `createServerClient`, którego `getAll` zwraca `[]`, a `setAll` wpycha pary `{name, value}` do tablicy, zaloguj się na nim (`signInWithPassword`) i zserializuj przechwycone pary do nagłówka `Cookie`. Nazwa, kodowanie i chunkowanie wychodzą poprawne z konstrukcji. Uwaga: `createServerClient` ma `autoRefreshToken: false`, a `setAll` odpala się tylko przy realnej zmianie storage — przechwyconych cookies nie cache'uj na dysk, generuj per run (`jwt_expiry = 3600`).
- **Applies to**: implement, impl-review

## Pliki gitignored nie przechodzą do nowego `git worktree`

- **Context**: tworzenie git worktree pod równoległą pracę (M2L5); setup worktree.
- **Problem**: `git worktree add` odtwarza tylko pliki ŚLEDZONE — gitignored nie są kopiowane. Nowy worktree nie ma `.claude/` (→ skille `/10x-*` nie działają), `.env` (→ brak sekretów lokalnych), `context/foundation/jira-workflow.md`, `node_modules` (→ lint/build padają), ani linku Supabase (`supabase/.temp/` → „not linked").
- **Rule**: Po `git worktree add` dograj ręcznie do każdego worktree pliki gitignored, których slice potrzebuje: `.claude/`, `.env`, `context/foundation/jira-workflow.md`; zrób `npm install`; zlinkuj Supabase osobno (`supabase link`). PowerShell: `Copy-Item -Path .claude,.env -Destination ..\wt\ -Recurse -Force` + osobno jira-workflow do `..\wt\context\foundation\`.
- **Applies to**: implement

## Test preflight must assert the target host is local — anon ≠ local

- **Context**: Test harness / preflight that talks to a real backend (Supabase, DB, any auth) — the test-runner bootstrap in test-plan rollout phases, e.g. `tests/setup/preflight.ts`.
- **Problem**: A preflight that only checks "creds set + key is anon + backend reachable" still passes when pointed at PRODUCTION: a prod project's anon key IS anon and it IS reachable. The documented "swap cloud creds into SUPABASE_URL" workflow then makes `npm test` sign up real accounts (with a hardcoded password) and create/delete real rows in production — fail-open exactly on the developer machine.
- **Rule**: A backend-mutating test harness must hard-assert in preflight that the target host is local (`127.0.0.1`/`localhost`) and `fail()` before any request. The "key is anon" check is NOT sufficient — a production anon key passes it (anon ≠ local). No env opt-out: a genuine non-local run must require a deliberate code edit.
- **Applies to**: plan (the preflight contract must include the local-host assertion), implement (build it, no opt-out), impl-review (flag its absence as a data-safety critical)

## Preflight musi domknąć KAŻDY nielokalny szew, nie tylko bazę

- **Context**: Harness testowy dotykający realnego backendu, gdzie determinizm suite'a opiera się na tym, że jakaś zewnętrzna, płatna integracja jest wyłączona (`tests/setup/preflight.ts`; ścieżka generacji przez `src/lib/openrouter.ts`). Uogólnienie reguły „Test preflight must assert the target host is local — anon ≠ local".
- **Problem**: Preflight twardo asertował host Supabase (127.0.0.1) z polityką „no opt-out", ale o `OPENROUTER_API_KEY` milczał. Tryb mock był deklarowany jako fakt w nagłówku testu i w test-plan.md §6.5 — i nic go nie egzekwowało. Deweloper, który ustawi klucz, by sprawdzić realną generację (co `.env.example` wprost dokumentuje), a potem odpali `npm test`, dostaje płatne wywołania openrouter.ai z tekstem testowym, asercje zależne od modelu zamiast od `mockCards`, i inwersję timeoutów (SERVER_TIMEOUT_MS 40 s > testTimeout 30 s). Zabezpieczenie jednego szwu stworzyło złudzenie, że zamknięte są wszystkie.
- **Rule**: Wylicz WSZYSTKIE zewnętrzne szwy, do których suite może sięgnąć, i zablokuj każdy w preflight — nie tylko bazę. Jeśli determinizm testu opiera się na tym, że integracja jest w trybie mock, preflight ma `fail()` gdy jej sekret JEST ustawiony (bez opt-outu przez env). Założenie zapisane w komentarzu lub w dokumencie nie jest zabezpieczeniem.
- **Applies to**: plan (kontrakt preflightu wylicza wszystkie szwy), implement (zbuduj bez opt-outu), impl-review (brak blokady szwu = finding)

## Jeden token focusu zasila DWA mechanizmy — lokalna łatka ukrywa defekt systemowy

- **Context**: Globalny wskaźnik focusu w projekcie Tailwind 4 + shadcn (`src/styles/global.css`, `src/components/ui/*`); faza implement/impl-review, a także każde zgłoszenie „focus ring słabo widoczny na kontrolce X".
- **Problem**: Token `--ring` zasila DWIE ścieżki naraz: `ring-*` (box-shadow) na współdzielonych prymitywach ORAZ `outline-color` ustawiany na `*` w `@layer base`. Nie widać tego z deklaracji tokena ani ze zgłoszenia. Skutki są dwa. Po pierwsze, defekt jest globalny, a wygląda na lokalny — w C10X-22 43 z 48 kontrolek nie spełniało 3:1, bo aplikacja renderuje się stale ciemno (`bg-cosmic`), a tokeny rozwiązują się do wartości motywu JASNEGO (wariant `dark` nigdy się nie aktywuje). Po drugie, wokół zbyt słabej wartości domyślnej narosły trzy niezależne łatki lokalne (`focus-visible:ring-white/80` w wariancie `destructive`, `focus-visible:border-white/40` w `fieldClass` generatora i sesji nauki, `focus:ring-purple-400` w polu auth) — każda z nich naprawiała JEDNĄ powierzchnię i jednocześnie maskowała fakt, że domyślna wartość jest zepsuta wszędzie indziej. Diagnoza w zgłoszeniu („`ring-*` nie mapuje się na realny `box-shadow`, zła konfiguracja Tailwind 4") była przy tym FAŁSZYWA: ring malował się poprawnie, miał tylko kontrast 2,4:1.
- **Rule**: Przy zgłoszeniu dotyczącym focusu najpierw ZMIERZ, co realnie maluje się w przeglądarce (`--tw-ring-shadow`, `outline*`, `border*` względem stanu rozmytego, kolory rozwiązane przez canvas, tło kompozytowane z przodków), zanim przyjmiesz jakąkolwiek przyczynę — także tę z ticketu. Naprawiaj w tokenie, nie w komponencie: jedna lokalna łatka `focus-visible:ring-*` to sygnał, że wartość domyślna jest za słaba dla WSZYSTKICH pozostałych kontrolek. Jeśli komponent gasi outline (`outline-none`), musi wystawić własny wskaźnik na tym samym elemencie. I nie licz na `outline: auto` przeglądarki — Chromium honoruje autorski `outline-color`, ale IGNORUJE `outline-width`, więc dopóki nie zadeklarujesz jawnego `outline`, nie kontrolujesz, ile wskaźnika się maluje.
- **Applies to**: frame (nie przyjmuj przyczyny z ticketu bez pomiaru), plan, implement, impl-review

## Pomiar stylu tuż po `.focus()` jest NIEŚWIEŻY, gdy element ma `transition`

- **Context**: Każdy pomiar `getComputedStyle` sterowany skryptem po programowym `.focus()` / `.blur()` — weryfikacja a11y, testy wizualne, debug w konsoli. W tym projekcie dotyczy wszystkich prymitywów (`transition-all` przy `0.15s`).
- **Problem**: Odczyt w tym samym zadaniu co `.focus()` zwraca wartość SPRZED przejścia, więc własność animowana (tu `border-color`) czyta się jako „nie zmienia się". Własności nieanimowane w tym samym pomiarze są poprawne — w C10X-22 ring (`--tw-ring-shadow`, custom property, nieinterpolowana) pokazywał się prawidłowo, a border nie. Efekt wygląda jak REALNY podział zachowania między komponentami („Buttony nie przestawiają bordera, Inputy tak") i tak też został początkowo zinterpretowany. Dłuższe czekanie nie jest dobrym lekarstwem: w karcie w tle timery są dławione do ~1 s, więc `setTimeout` na kontrolkę zamienił przebieg 62 kontrolek w timeout CDP.
- **Rule**: Na czas pomiaru WYŁĄCZ przejścia zamiast się z nimi ścigać: wstrzyknij `*,*::before,*::after{transition:none!important;animation:none!important}`, zmierz, usuń. Gdy widzisz „ta własność się nie zmienia", sprawdź `transitionProperty`/`transitionDuration` elementu, zanim uznasz to za fakt o aplikacji. Porównuj też kolory przez piksel z canvasu, nie przez string — ta sama barwa bywa raportowana jako `oklch(...)` w jednym stanie i `oklab(...)` w drugim, co jako string czyta się jako zmiana, której nie było.
- **Applies to**: implement, impl-review

## /10x-archive owns the roadmap Status → done flip — doc-sync updates Outcome only

- **Context**: Roadmap status bookkeeping — `context/foundation/roadmap.md`; the doc-sync phase of any change (`/10x-plan` doc-sync, `/10x-implement`, `/10x-archive`).
- **Problem**: `/10x-plan` routinely emits "set Status → done" in doc-sync, but `roadmap.md` reserves the Status flip and the `## Done` entry for `/10x-archive` („NIE wypełniać ręcznie"). Setting it manually pre-declares done before the change ships and duplicates archive's job — or, when correctly skipped, leaves an unexplained mismatch.
- **Rule**: `/10x-archive` is the sole owner of the roadmap Status → done flip and the `## Done` entry (`roadmap.md:401`). Plan/implement doc-sync updates only the Outcome; never set Status → done manually. If a plan instructs the flip, treat it as a defect and defer to archive.
- **Applies to**: plan (do not emit "Status → done"), implement (doc-sync updates Outcome only), impl-review (flag manual Status flips)

## Middleware nie może odpowiadać endpointowi JSON redirectem — klient czyta 302 jako sukces

- **Context**: Guard autoryzacji w `src/middleware.ts` (`PROTECTED_ROUTES` → `context.redirect("/auth/signin")`) wobec endpointów JSON wołanych `fetch`em z wysp React — `/api/study`, `/api/generate`, `/api/decks/[publicId]/cards/batch`. Faza implement / impl-review, a także każde zgłoszenie „zapis nie działa, ale nie ma błędu".
- **Problem**: Guard zwraca 302 na stronę HTML, a `fetch` domyślnie podąża za redirectem (POST → GET, body odpada). Cel redirectu (`/auth/signin`) jest publiczny, więc renderuje się z **200** — i `res.ok` jest `true`. Klient, który rozgałęzia się tylko na `!res.ok`, czyta utratę sesji jako SUKCES: w C10X-27 `StudySession.rate()` przewijał karty i podbijał licznik, nie zapisując ani jednej oceny — użytkownik przechodził całą sesję nauki bez błędu i bez harmonogramu. Wtedy własny, poprawnie napisany `401` endpointu jest **nieosiągalny na produkcji** (middleware biegnie pierwszy), więc test tego 401 przechodzi, a realna ścieżka nie jest pokryta. Kolejność ok/parse jest przy tym łatwa do przeoczenia w review: cztery inne wyspy w tym repo parsują body PRZED `ok` i awarię by ujawniły — tylko `rate()` miał ją odwróconą.
- **Rule**: Guard w middleware musi odpowiadać w formacie, którego oczekuje wołający: dla `/api/*` zwróć `401` JSON, nie `redirect` — redirect zostaw stronom. W kliencie nigdy nie rozgałęziaj się wyłącznie na `!res.ok`: sparsuj body przed sprawdzeniem `ok` (albo sprawdź `res.redirected` / `content-type`), tak jak robią pozostałe wyspy. Zanim uznasz gałąź `401` w endpoincie za pokrytą, ustal, czy cokolwiek ją na produkcji osiąga.
- **Applies to**: plan, implement, impl-review, frame

## Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką — sprawdź exit code, zanim na niej zbudujesz gate

- **Context**: Budowanie bramki CI wokół zewnętrznego CLI, którego wynik odczytujesz z kodu wyjścia — w tym projekcie `supabase migration list` i `supabase db diff` jako kandydaci na wykrywacz driftu schematu (`.github/workflows/*.yml`); fazy plan / implement / impl-review.
- **Problem**: Obie komendy **zawsze zwracają 0**, niezależnie od wyniku, i sygnał wypisują tam, gdzie nikt go nie czyta. `migration list` renderuje tabelę (glamour ASCII, brak `--output json`), a rozjazd to _pusta komórka_ w wierszu — nie błąd. `db diff` przy braku różnic wypisuje `No schema changes found` na **stderr**, a `diff` na stdout. Krok `run:` napisany z dokumentacji wygląda poprawnie, przechodzi review i **jest zielony na zawsze** — czyli nie egzekwuje niczego, a jednocześnie tworzy wrażenie, że ryzyko jest domknięte. To ta sama klasa co niefalsyfikowalna asercja: bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej brak, bo zdejmuje czujność.
- **Rule**: Zanim zbudujesz bramkę na cudzej komendzie, **zmierz jej kod wyjścia w obu kierunkach** (stan dobry i celowo zepsuty) na wersji przypiętej w lockfile — nie ufaj dokumentacji ani intuicji. Jeśli exit code nie rozróżnia wyników, oprzyj werdykt na treści: `[ -s diff.sql ]` zamiast `$?`, a przy parsowaniu komunikatu asertuj **pozytywny** string, nigdy braku negatywnego — dla `supabase db push --dry-run` (jedynej z tej trójki, której exit code cokolwiek rozróżnia, ale która i tak kończy się **0** w zwykłym przypadku „scommitowane, nigdy niewypchnięte") tym stringiem jest `Remote database is up to date.` — zmiana wording u dostawcy ma wtedy wywalić bramkę na czerwono (fail closed), a nie po cichu ją wyłączyć. Przy przekierowaniu wyjścia do pliku (`> diff.sql`) zadbaj, by `bash -e` był w mocy, inaczej padnięty CLI zostawia pusty plik czytany jako „brak różnic". I zawsze uruchom próbę zepsucia z **kontrolą pozytywną** — przebieg zielony i przebieg czerwony różniące się dokładnie jedną rzeczą; sam przebieg czerwony nie dowodzi, że to bramka go wywołała.
- **Applies to**: plan, implement, impl-review

## A positive control must OWN the fixture it mutates — and run the suite shuffled to prove it

- **Context**: Any suite whose discipline pairs every denial with a positive control against a shared `beforeAll` fixture — here `tests/isolation/`, `tests/review/`, `tests/study/` (test-plan §6.2). Phases implement / impl-review, and any "the test passes alone but fails in the suite" report.
- **Problem**: The control is the cheapest to write against the fixture already standing — and that is exactly what couples it to its siblings. In C10X-32 **six** case-pairs across three files were green only in declaration order: "still lets A edit A's own card" rewrote the very card three denials compared to a file-scope `A_FRONT`; the audit-rewrite control persisted a new `error_message` into the one session the read denial asserts the seeded value on. Two failure modes, both quiet. Reading side: a denial that asserts a **file-scope constant** captured before a sibling could move it is fragile, while its neighbours asserting a value **re-read inside the `it()`** are safe — the same file carried both. Aggregate side: a case that owns NO fixture (the `srs_state = 3` canary, positive control `length > 0` over an account-wide scan) passes only because siblings already wrote rows — and under parallel workers it can flake _green_ off another file's rows while its main assertion is vacuous. Nothing about any of this is visible in declaration order, and three shuffled seeds fired only four of the six: "shuffle until green" under-counts, so the inventory has to come from reading.
- **Rule**: A mutating positive control creates the deck / row / session it mutates **inside its own `it()`** — never the shared fixture, and never in a shared container the denials count rows in. An aggregate with no fixture seeds one row it owns before scanning (keep the scan broad; the owned row only stops the control being vacuous). Assert what you re-read inside the `it()`, never a constant captured at file scope. Do **not** "fix" this by restoring the fixture after mutating — restore-after-mutate is order-dependent hygiene, not independence. Enable `sequence: { shuffle: true }` permanently with the seed **un-pinned** (each config separately if a project has several), so the class fails loudly and CI accumulates permutations; the banner's seed replays a red exactly (`npx vitest run --sequence.seed=<n>`). And before blaming order: a red that does **not** reproduce at its own seed is a different animal — measure it with shuffle off before treating it as an ordering defect.
- **Applies to**: plan, implement, impl-review

## Odmowa wyrażona redirectem potrzebuje orakla wierszowego i asercji przez RÓWNOŚĆ komunikatu

- **Context**: Endpointy będące celem natywnego `<form method="POST">`, które odmawiają przez `context.redirect("…?error=…")` zamiast statusem 4xx — w tym projekcie sześć chronionych tras `/api/*` (create/edit/delete fiszki, rename/delete talii) plus `signin`/`signup`. Fazy plan / implement / impl-review, a także każdy test walidacji serwerowej na takiej trasie.
- **Problem**: Odmowa i sukces mają **ten sam status** — oba są `302`, różni je wyłącznie `Location`. Więc `expect(status).toBe(302)` nie dowodzi niczego, a naturalna asercja „w URL-u jest błąd", czyli `toContain("error=")`, jest gorsza niż bezużyteczna: kiedy właściwy strażnik przestaje działać, żądanie **nie** przestaje być redirectem — spada do _innej_ gałęzi błędu tego samego handlera, która przekierowuje z **innym** własnym komunikatem i tym samym kluczem `error=`. Zmierzone w C10X-30 (przebieg zepsucia 1): po odspojeniu porównania długości w endpoincie odpowiedź nadal była `302` z `error=` i `open=create-card`, a jedyną asercją, która zaświeciła się na czerwono, była **równość** zdekodowanego parametru. Druga połowa pułapki jest po stronie orakla: funkcja, na którą naprowadza potrzeba („policz fiszki w tej talii" → `countFlashcards`, `listFlashcards`), filtruje po `state_id = STATE_ACCEPTED`, więc wiersz zapisany w innym stanie jest dla niej niewidoczny i „licznik bez zmian" czyta się na zielono nad realnym zapisem.
- **Rule**: Na trasie odmawiającej redirectem: (1) orakl **wierszowy** — surowy licznik niezależny od statusu i od stanu, zawężony wyłącznie `deck_id`, albo `toEqual(before)` na wierszu, gdy zapisem byłby UPDATE, którego żaden licznik nie widzi — nie jest dodatkiem do asercji statusu, tylko **jedyną** asercją; (2) zdekodowany parametr `error` asertuj przez **równość** z projektową stałą, nigdy `toContain`; (3) orakl wierszowy stawiaj **pierwszy**, bo runner przerywa test na pierwszym nieudanym `expect` — przy dwóch warstwach egzekwowania (endpoint + CHECK w bazie) tylko kolejność „licznik przed komunikatem" sprawia, że **para** przebiegów zepsucia daje różne stringi błędu i rozdziela „złapał endpoint" od „złapała baza"; kolejność bez komentarza w kodzie zostanie przy okazji „posprzątana". Echo wejścia sprawdzaj na **surowym** `Location`, zanim go zdekodujesz — percent-encoding ukrywa marker przed odczytem po dekodowaniu, ale nie przed paskiem adresu ani logiem dostępu.
- **Applies to**: plan, implement, impl-review

## Wartość kontraktowa (enum API / kolumna audytowa) nigdy nie trafia do promptu LLM — wyrenderuj nazwę dla modelu

- **Context**: Każde miejsce, gdzie string wstrzykiwany do promptu LLM pochodzi z tej samej stałej, która jest jednocześnie kontraktem — wartością enuma w API, wartością zapisywaną do bazy, kluczem w `<select>`. W tym projekcie: `LANGUAGES` z `src/lib/generation-limits.ts` zasilało naraz Zoda w `/api/generate`, kolumnę `generation_session.language` i zdanie `Write the flashcards in this language: ${language}.` w `src/lib/openrouter.ts`. Fazy frame / plan / implement / impl-review.
- **Problem**: Wartość dobrana pod kontrakt jest dobrana pod CZYTELNIKA MASZYNOWEGO, nie pod model — i wtedy prompt niesie token, którego model nie musi zrozumieć tak, jak zakłada autor. Zmierzone: polski egzonim w angielskim zdaniu (`… : niemiecki.`) dawał **0/5 kart w języku docelowym, cztery przebiegi z czterech** dla niemieckiego i francuskiego, podczas gdy gałąź `auto` — która nie wstrzykuje żadnej nazwy — była bezbłędna (25/25). Trzy rzeczy czynią tę klasę podstępną. Po pierwsze, defekt jest CICHY: aplikacja zwraca poprawny JSON, poprawną liczbę kart, status 200 i zero błędów — użytkownik dostaje po prostu zły produkt (a w tym projekcie: kartę do odrzucenia, czyli bezpośredni ciężar na metryce 75% akceptacji z PRD). Po drugie, jest CZĘŚCIOWY i dlatego wygląda na losowy: `polski` i `angielski` przechodziły na tym samym kodzie, więc „nie działa forsowanie języka" nie było prawdą — działało dla trzech z pięciu wartości. Po trzecie, żadna warstwa testów deterministycznych go nie widzi: kontrakt odpowiedzi jest zachowany, więc czerwone może zaświecić wyłącznie eval z sędzią-LLM. Ta sama wartość zmieniła zresztą później typ (egzonim → dwuliterowy kod) — co dowodzi, że wiązanie promptu z kontraktem wiąże też prompt z każdą przyszłą migracją tego kontraktu.
- **Rule**: Rozdziel role: **jedna wartość = jedna rola**. Kontrakt (enum, klucz, kolumna audytowa) trzymaj stabilny i maszynowy; do promptu wstrzykuj osobno wyrenderowaną **nazwę dla modelu**, tak samo jak do UI wstrzykujesz osobną etykietę dla człowieka. Warstwa renderująca należy do wywołującego, nie do biblioteki: `generateCandidates` przyjmuje już-rozwiązane `targetLanguage: string | null`, dzięki czemu w module generatora nie ma ŻADNEGO słownika języków ani sentinela `"auto"` (tryb wyraża `null`) — a instrument akceptacyjny (`npm run eval`) może go wołać bez bazy danych. Gdy nazwy są danymi (tabela słownikowa), pilnuj JEDNEGO pinu między tym, co widzi model w evalu, a tym, co siedzi w bazie (`tests/fixtures/language-names.ts`), inaczej literówka w seedzie przechodzi po obu stronach. I pamiętaj, że enum kontraktowy bywał przy okazji **strażnikiem prompt-injection** — zdejmując go, przenieś tę powinność JAWNIE, a nie milcząco. Tutaj rozkłada się na dwie warstwy o różnym zasięgu: regex kształtu (`^[a-z]{2,8}$`) chroni ŻĄDANIE przed zapytaniem do bazy, a to, że treść wiersza jest bezpieczna, trzyma wyłącznie fakt, że tabeli nie da się zapisać z aplikacji (`revoke` uprawnień zapisu ORAZ brak polityki zapisu — dwa niezależne egzekutory, bo `grant select` sam z siebie nic nie zawęża przy domyślnych uprawnieniach Supabase). Zapisz to tam, gdzie przeczyta je autor przyszłego panelu, bo z jego kodu ta powinność nie będzie widoczna.
- **Applies to**: frame, plan, implement, impl-review

## Równe timeouty keep-alive po obu stronach puli to przypadek PATOLOGICZNY — proxy musi zamykać PRZED backendem

- **Context**: Każda para proxy↔upstream trzymająca pulę połączeń keep-alive, gdzie „losowe" `502` pojawiają się po przerwie w ruchu. W tym projekcie: Kong ↔ PostgREST w lokalnym stacku Supabase CLI (`502 upstream prematurely closed connection`, absorbowane przez `tests/setup/retry-transport.ts`). Fazy frame / research / plan / implement.
- **Problem**: Naturalna hipoteza — i ta, którą ten projekt zapisał w DWÓCH dokumentach i w nagłówku pliku, nigdy jej nie mierząc — brzmi „proxy trzyma połączenie DŁUŻEJ niż backend". Brzmi jak błąd kolejności, czyli coś, co da się naprawić przestawieniem jednej liczby. Pomiar (C10X-39) pokazał co innego: `upstream_keepalive_idle_timeout` Konga to **60 s**, a PostgREST/warp zamyka bezczynne połączenie po **60,0 s** (mierzone z pominięciem Konga) — są **RÓWNE**. To gorsze niż zła kolejność: żadna strona nie zamyka niezawodnie pierwsza, więc o tym, czy następne żądanie trafi na żywy socket, decyduje wyścig — i dokładnie dlatego defekt jest okazjonalny, a nie deterministyczny. Druga połowa błędnego opisu też kosztuje: to nie „pierwsze żądanie po przerwie", tylko **klaster w pierwszych 1-2 s serii** (43/43) po medianie 27 s ciszy — kto szuka jednego żądania, przegapi kształt. A gdy obie wartości są tą samą liczbą i żadnej nie da się ustawić przez wspieraną powierzchnię (tu zweryfikowane wprost: env kontenera to zaszyty slice w Go, `kong.yml` jest `//go:embed`-owany, `config.toml` nie ustawia obrazu, PostgREST nigdy nie miał tej pokrętki), to nie ma czego „poprawić w konfiguracji".
- **Rule**: Zanim zapiszesz mechanizm flake'a transportowego, **zmierz OBIE strony** — wartość proxy z jego własnego zrzutu ustawień, wartość backendu bezpośrednio, z pominięciem proxy. Nie zapisuj wnioskowania jako faktu, zwłaszcza gdy brzmi ono uspokajająco („to tylko kolejność"). Zdrowa konfiguracja to proxy zamykające **wyraźnie wcześniej** niż upstream; równe timeouty projektuj jako defekt. Gdy żadna ze stron nie jest twoja do zmiany, lekarstwo przenieś **na harness, nie na stack**: (a) obejście w warstwie testu, które absorbuje dokładnie tę jedną odpowiedź i nic więcej, z predykatem wyniesionym do czystej funkcji i asertowanym; (b) opcjonalnie zdjęcie puli u proxy (`KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` — nie ma czego stracić, jeśli nie ma czego trzymać), ale jeśli wymaga to kroku niewspieranego i per-maszyna, to **nie zastępuje** obejścia, tylko je uzupełnia. I mierz efekt przez **parę** przebiegów w tej samej sesji (naprawiony vs kontrolny na stockowej wartości), nigdy przez sam cichy log: dwie kontrole godzinę od siebie różniły się tu SIEDMIOKROTNIE, więc pojedyncza liczba z innego dnia nie jest punktem odniesienia.
- **Applies to**: frame, research, plan, implement, impl-review

## `.insert(...).select(...).single()` to FAŁSZYWY orakl na zduplikowany zapis — potrzebny licznik zawężony do przypadku

- **Context**: Każdy szew testowy (helper `seedX` / `createX`, kontrola pozytywna, bezpośredni insert), w którym żądanie zapisu może zostać **powtórzone** — retry w kliencie, retry w harnessie, przycisk „Ponów", replay transportowy. W tym projekcie: sześć szwów w `tests/study/`, `tests/review/`, `tests/generation/`, `tests/validation/` pod wrapperem `retry-transport.ts`. Fazy plan / implement / impl-review.
- **Problem**: `.single()` wygląda jak asercja liczności („dokładnie jeden wiersz") i nią NIE jest: widzi wyłącznie **jedną odpowiedź HTTP**, a powtórzony insert przychodzi w **innej** odpowiedzi, z innym `public_id`. Oba wywołania zwracają `201` i oba przechodzą. Klasa jest cicha w najgorszy sposób — zmierzone (C10X-39): eksperyment wymuszający po jednym replayu na każde lokalne żądanie nie-`GET` dał **81 × `POST /rest/v1/flashcard` i 18 × `POST /rest/v1/generation_session` z parą `201 → 201`**, duplikaty realnie wylądowały, a **23 z 29 plików niczego nie zauważyło**. Czytanie kodu nie domyka tej listy: wcześniejszy wyczerpujący przegląd wskazał cztery szwy, pomiar znalazł sześć, i jeden z dwóch dodatkowych (`createCard` w `study.test.ts`) nie był na żadnej liście — jego orakl to `listFlashcards(…).find(...)`, a `find` zwraca pierwsze trafienie i z definicji nie umie liczyć. Ta sama pułapka co przy odmowie redirectem: funkcja, na którą naprowadza potrzeba, filtruje coś, co czyni ją ślepą (`succeededSessions` filtruje `status = 'succeeded'`, więc zasianego wiersza `failed` nie zobaczy nigdy).
- **Rule**: Po każdym zapisie w szwie testowym postaw **licznik zawężony do przypadku** i asertuj **dokładnie jeden** — surowy `count: "exact"` po kolumnach, które identyfikują ten konkretny zapis (`(deck_id, front)`, `(user_id, source_text, status)`), nigdy `.single()`, nigdy `.maybeSingle()`, nigdy `find`, nigdy licznik filtrowany po stanie. Dwa zyski w jednym: wykrywacz duplikatu ORAZ strażnik autorstwa — dwa call-site'y kolidujące na tej samej wartości padają teraz w setupie, zamiast po cichu dzielić orakl. Jeśli kusi cię zamiast tego ograniczenie UNIQUE w bazie — sprawdź najpierw, czy duplikat nie jest gdzieś **legalny** (tutaj jest: `generate.test.ts` POST-uje dwa razy bez klucza idempotencji do jednej talii, a `mockCards` zwraca identyczne fronty), bo inaczej wprowadzisz regułę produktową z powodu harnessowego. I dowodź falsyfikowalności **przed** napisaniem asercji: napisz duplikat, potwierdź, że przebieg jest ZIELONY, dopiero potem dołóż orakl i sprawdź, że czerwienieje dokładnie jeden przypadek.
- **Applies to**: plan, implement, impl-review

## Doc-sync edytuje ŻYWĄ deklarację; datowany snapshot dostaje datowaną korektę, nigdy nadpisania

- **Context**: Krok doc-sync dowolnej zmiany (`/10x-plan` emitujący pozycje doc-sync, `/10x-implement` je wykonujący, `/10x-impl-review` je sprawdzający) wobec `context/foundation/*` — zwłaszcza `roadmap.md`, którego sekcja `## Baseline` jest ostemplowana „Co jest już w bazie kodu na `2026-07-04`", oraz `test-plan.md`, który w większości składa się z datowanych wpisów rejestru.
- **Problem**: Pozycja doc-sync w planie wskazuje plik i NUMER LINII („zaktualizuj linię Outcome o observability, `roadmap.md:105`"), a wskazana linia okazuje się leżeć wewnątrz datowanego snapshotu historycznego, a nie być żywą deklaracją. Wykonanie instrukcji sfałszowałoby zapis tego, co było prawdą w swojej dacie; pominięcie zostawia niewyjaśnioną lukę, którą następny recenzent czyta jako przeoczony doc-sync. W C10X-53 sąsiadami wskazanej linii były „Testy: absent — brak runnera" i „Data: absent — migrations puste" — oba dziś rażąco fałszywe i oba poprawne jako historia, co jest właśnie sygnałem rozpoznawczym. Numer linii jest tym, co czyni tę pułapkę łatwą do wdepnięcia: wskazuje MIEJSCE, a miejsce nie niesie żadnego dowodu na to, czy otaczająca sekcja jest żywa, czy zamrożona.
- **Rule**: Zanim wyedytujesz cel doc-syncu, przeczytaj NAGŁÓWEK SEKCJI i jej preambułę, nie samą linię. Sekcja ostemplowana datą — albo taka, której rodzeństwo jest jednolicie nieaktualne — jest zapisem historycznym: zostaw ją i umieść żywe stwierdzenie tam, gdzie żyją żywe stwierdzenia (nowy wpis roadmapy, nowy wiersz rejestru), albo dopisz pod nią datowaną korektę. Nadpisywanie jest wyłącznie dla żywych deklaracji. Pisząc plan, wskazuj cele doc-syncu przez sekcję i treść twierdzenia, nigdy przez sam numer linii — numer linii rozwiązuje się do miejsca, a decyzja potrzebuje RODZAJU tego miejsca.
- **Applies to**: plan, implement, impl-review

## Wynik zapisu KOMPENSUJĄCEGO sprawdzasz jak każdy inny — a bez jawnego `.select()` nie ma czego sprawdzić

- **Context**: Każda operacja kompensująca po nieudanym kroku wielozapisowej sekwencji, której nie da się objąć jedną transakcją, bo drugi zapis potrzebuje klucza z pierwszego — w tym projekcie `retireGenerationSession` po nieudanym `insertCandidates` oraz `deleteDeck` po nieudanym wstawieniu sesji (`src/pages/api/generate.ts`). Fazy plan / implement / impl-review, ale najostrzej przy code review, bo defekt wygląda dokładnie jak sprzątanie.
- **Problem**: DWIE warstwy, i każda z osobna wystarczy, żeby awaria kompensacji była całkowicie niema. (1) Wynik `await` bywa porzucany, uzasadniony komentarzem „best-effort" — a to słowo weszło do kodu jako KOMENTARZ, nigdy jako decyzja, i rozeszło się przez symetrię na sąsiedni zapis i przez pięć ticketów. (2) Nawet dopisanie `if (error)` NIE domyka sprawy: bez jawnego `.select()` PostgREST odpowiada na UPDATE/DELETE pod `Prefer: return=minimal`, więc aktualizacja pasująca do ZERA wierszy rozwiązuje się jako `{ data: null, error: null }` — bajtowo nie do odróżnienia od zapisu, który wylądował. Pod RLS to jest właśnie kształt zniknięcia wiersza albo nieczytelnego `auth.uid()`. Najgorsze jest sprzężenie: na najbardziej prawdopodobnej drodze do pierwszej awarii kompensacja też zawodzi (ten sam connection, ten sam token, to samo proxy), więc swap jest cichy DOKŁADNIE wtedy, kiedy ma znaczenie. W C10X-48 kosztowało to wiersz audytu `status='succeeded', saved_count>0` z zerem kart za nim, z żywym kluczem idempotencji — czyli TRWAŁE 500 na „Ponów" dla tego klucza i odwrócone FR-018, przy zielonym całym zestawie testów.
- **Rule**: Zapis kompensujący jest zwykłym zapisem: jego wynik ma być odczytany, a nie porzucony, i rozgałęziony na `data`, nie na samo `error`. Domykaj to w helperze, nie w wywołaniu — dopisz `.select("<kolumna>").maybeSingle()` do UPDATE/DELETE i napisz w jego docblocku, że to KONTRAKT, nie dekoracja (wzorzec: `deleteDeck` w `src/lib/decks.ts`). Zero wierszy pod RLS to NIE jest błąd, więc `data == null` bez `error` traktuj jako kompensację NIEUDANĄ. Jeżeli kompensacja ma jednocześnie wyłączyć wiersz z ponowienia, zrób to w TYM SAMYM `update` (u nas: `status` + wyzerowany licznik + `idempotency_key: null`), żeby nie zostawić stanu pośredniego. I zważ na granicę zmierzoną przy tej okazji: potwierdzenie „dopasowano wiersz" chroni wyłącznie przed dopasowaniem do zera wierszy — nie mówi nic o tym, czy zapis zrobił to, co miał, więc nie buduj na nim więcej, niż unosi. Wreszcie: „best-effort" w komentarzu nie jest decyzją. Albo zapisz uzasadnienie z konsekwencją („kto jest jedynym świadkiem tej awarii i co naprawia stan przy następnej próbie"), albo sprawdź wynik.
- **Applies to**: plan, implement, impl-review

## Gwarancja w workflow należy do konfiguracji PLIKU, nie do czujności autora

- **Context**: Pisanie albo review plików `.github/workflows/*.yml` i composite actions — faza plan / implement / impl-review.
- **Problem**: Dwa defekty tej samej klasy w jednej zmianie (`ci-cd-code-review`). (1) Zapadka na dryf destylatu promptu żyła w `npm test`, a `npm test` biega w repo tylko w jobie `ci`, którego wyzwalacze niosą `paths-ignore: ["**/*.md", "context/**"]` — wszystkie pilnowane sekcje leżą w `AGENTS.md` i `test-plan.md`, więc bramka świeciła wyłącznie PRZYPADKIEM, przy commitach dotykających też kodu. Weryfikacja ręczna była prawdziwa i LOKALNA, więc nie mogła tego zobaczyć. (2) `COMMENT_ID=$(gh api … | tail -n 1)` brał status od `tail`: awaria `gh api` dawała pusty id, zielony krok i DRUGI sticky komentarz zamiast edycji pierwszego — mimo że repo miało już zmierzoną lekcję o `| tee` kończącym się kodem 0 na czerwonym przebiegu, a sąsiedni composite action wprost ją cytował.
- **Rule**: (1) Zanim dopniesz bramkę, sprawdź, czy jej WYZWALACZ sięga plików, których pilnuje. `paths-ignore` filtruje cały workflow, nie job, więc bramka na pliki `.md` potrzebuje własnego pliku workflow; przy `pull_request` filtr liczy się względem całego diffa PR-a. Próbę czerwieni rób NA TEJ ŚCIEŻCE, na której bramka będzie żyła — nie lokalnie. (2) KAŻDY nowy plik workflow dostaje `defaults: run: shell: bash` na starcie. Nie „pamiętaj o `pipefail` przy rurach": domyślny shell w pliku to jedno miejsce zamiast każdej rury z osobna, a pamiętanie o `pipefail` w momencie pisania rury jest dokładnie tym, czego się wtedy nie ma.
- **Applies to**: plan, implement, impl-review
