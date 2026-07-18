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

## /10x-archive owns the roadmap Status → done flip — doc-sync updates Outcome only

- **Context**: Roadmap status bookkeeping — `context/foundation/roadmap.md`; the doc-sync phase of any change (`/10x-plan` doc-sync, `/10x-implement`, `/10x-archive`).
- **Problem**: `/10x-plan` routinely emits "set Status → done" in doc-sync, but `roadmap.md` reserves the Status flip and the `## Done` entry for `/10x-archive` („NIE wypełniać ręcznie"). Setting it manually pre-declares done before the change ships and duplicates archive's job — or, when correctly skipped, leaves an unexplained mismatch.
- **Rule**: `/10x-archive` is the sole owner of the roadmap Status → done flip and the `## Done` entry (`roadmap.md:234`). Plan/implement doc-sync updates only the Outcome; never set Status → done manually. If a plan instructs the flip, treat it as a defect and defer to archive.
- **Applies to**: plan (do not emit "Status → done"), implement (doc-sync updates Outcome only), impl-review (flag manual Status flips)
