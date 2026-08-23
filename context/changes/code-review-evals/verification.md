# Verification — Promptfoo evals for the code review agent

> Dziennik dowodowy do `context/changes/code-review-evals/plan.md`. Każda faza dopisuje własną
> sekcję. Numery przebiegów są tu, a nie w `plan.md`, bo `## Progress` niesie stan, nie dowody.
>
> Repo: `lirdaw/10xcards`. Adres przebiegu: `https://github.com/lirdaw/10xcards/actions/runs/<id>`.

## Phase 3 — Bramka pakietu agenta (typecheck + testy zależne) w CI

**Data**: 2026-08-23
**PR**: [#48](https://github.com/lirdaw/10xcards/pull/48) (`code-review-evals` → `main`)

### Para dowodowa NA ŚCIEŻCE CI (kryterium 3.4)

Trzy przebiegi `Agents gate`, różniące się **jedną** rzeczą — obecnością pliku
`agents/review/probe.ts` z jednym błędem typu. Sonda celuje w krok TYPECHECK, a nie w testy:
jej nazwa nie pasuje do `*.test.ts`, więc runner testów jej nie widzi i czerwień nie może
przyjść z dwóch miejsc naraz.

| Przebieg                                                                   | Commit    | Sonda | Wynik              | Gdzie padło                              |
| -------------------------------------------------------------------------- | --------- | ----- | ------------------ | ---------------------------------------- |
| [32627834182](https://github.com/lirdaw/10xcards/actions/runs/32627834182) | `1bbbbe1` | brak  | **success** (20 s) | —                                        |
| [32627895583](https://github.com/lirdaw/10xcards/actions/runs/32627895583) | `de97385` | jest  | **failure**        | `Typecheck the agent package`, kod **2** |
| [32627937663](https://github.com/lirdaw/10xcards/actions/runs/32627937663) | `c4b2901` | brak  | **success**        | —                                        |

Treść czerwieni, dosłownie z loga przebiegu 32627895583:

```
##[error]probe.ts(9,14): error TS2322: Type 'string' is not assignable to type 'number'.
##[error]Process completed with exit code 2.
```

Czerwień przyszła z kroku nazwanego typecheckiem, z kodem 2 (czyli od `tsc`, nie od shella),
i wskazała plik sondy — więc to bramka ją wywołała, a nie cokolwiek innego w przebiegu.

### Sonda przeszła ZWYKŁYM gitem (kryterium 3.5)

Potwierdzone wykonaniem, nie rozumowaniem: `git commit` + `git push` bez `--no-verify` na
`de97385`. Oba hooki przepuściły ją tak, jak przewidywał plan — `pre-commit` (`lint-staged`)
odpala `eslint --fix` na `*.ts`, ale `eslint.config.js` ignoruje `agents/**`; `pre-push`
odpala rootowy `npm run typecheck`, a rootowy `tsconfig.json` ma `exclude: […, "agents"]`
(w logu pushu: `typecheck: OK — 176 files checked (floor 50)`). Ścieżka przez GitHub Contents
API, przewidziana w planie jako awaryjna, nie była potrzebna.

### Filtr `paths` — obie strony (kryterium 3.6)

- **Strona pozytywna**: wszystkie trzy przebiegi wyżej wystartowały na commitach ruszających
  `agents/**` (`agents/review/tsconfig.json`, `package.json`, `probe.ts`).
- **Kontrola negatywna**: commit wprowadzający TEN plik rusza wyłącznie `context/**` — czyli
  ani `agents/**`, ani `.github/workflows/agents-gate.yml`. `Agents gate` **nie wystartował**
  na nim (obserwacja odnotowana przy tym commicie; `Prompt ratchet`, który filtra nie ma,
  wystartował — i to jest różnica, która czyni tę kontrolę czymś więcej niż brakiem zdarzenia).

### Dwie rzeczy zmierzone, nie założone

**`node --test` bez ANI JEDNEGO wykrytego pliku kończy się kodem 0.** Zmierzone lokalnie
w pustym katalogu i z wzorcem pasującym do niczego: `ℹ tests 0`, `EXIT=0`. Sam skrypt testowy
nie odróżnia więc „wszystko przeszło" od „nie było czego uruchomić" — a to druga z tych rzeczy
była tu realnym ryzykiem, bo wykrywanie plików `.ts` przez wbudowany runner zależy od tego, czy
w danej wersji Node'a type-stripping jest włączony (lokalnie v24.18.0, w CI v22). To dokładnie
klasa z `lessons.md` („Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką"), więc krok
testowy w `agents-gate.yml` stoi na DWÓCH nogach: kodzie wyjścia runnera ORAZ asercji na
pozytywny string w planie TAP (`1..N` dla N ≥ 1), bez rury.

**Node w CI to v22.23.2 i wykrywa `.ts` domyślnym discovery.** Z loga przebiegu 32627834182:
`node: v22.23.2`, a krok testowy wypisał `1..17`, `# tests 17`, `# pass 17`, `# fail 0` — czyli
tyle, ile jest lokalnie (prompt 6 + review-cli 4 + run-review 7). Floor się nie odezwał, bo nie
miał po co; jego wartość jest w tym, że odezwie się w dniu, w którym discovery przestanie
działać.

### Kontrole pozytywne wykonane lokalnie przed pushem

- `agents/review/tsconfig.json` z `include: ["**/*.ts"]` czerwieni się na **nowym** pliku
  (`probe-local.ts`, `TS2322`, exit 2) — czyli bramka sięga plików, których dziś nie ma,
  a więc obejmie `agents/review/evals/` z fazy 4 bez dopisywania czegokolwiek.
- Test położony w **podkatalogu** (`probe-dir/probe.test.ts`) został wykryty (`tests 18`)
  i zaczerwienił runner (`EXIT=1`) — ta sama gwarancja po stronie testów.

### Koszt: `PR code review` anulowany na tym PR-ze, trzy razy

`pr-review.yml` nie ma filtra ścieżek i odpala się na `opened` i każdym `synchronize`, a jest
przypięty do `anthropic/claude-sonnet-4.6`. Przefiltrowany diff tej gałęzi to 1391 linii /
68 250 bajtów, czyli mieści się w capie 250 000 i pojechałby — wg pomiarów z
`measurement-cheap-models.md` rzędu 0,20–0,30 USD za przebieg, przy ~0,50 USD rezerwy, z której
fazy 6–7 potrzebują ~0,23 USD.

Decyzja: przebiegi recenzji anulowane ręcznie zaraz po starcie, ZANIM dojdzie do wywołania
modelu (instalacja pakietu agenta to ~335 MB i 1–2 minuty, więc okno jest szerokie).
Anulowane: **32627834180** (`1bbbbe1`), **32627895581** (`de97385`), **32627937670** (`c4b2901`).
`pr-review.yml` i composite action pozostają NIETKNIĘTE — kryterium 7.7 nie jest tym naruszone.
Recenzja tego PR-a jest doradcza (nagłówek `pr-review.yml`: nie jest w `needs:`, nie jest
required check), więc anulowanie nie zdejmuje żadnej bramki.
