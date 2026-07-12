<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Generacja kandydatów fiszek AI z wklejonego tekstu (S-04 / C10X-7)

- **Plan**: `context/changes/ai-candidate-generation/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-11
- **Verdict**: REVISE → SOUND (po triage; wszystkie findings naprawione)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F1) → naprawione |
| Lean Execution | WARNING (F5) → naprawione |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F3) → naprawione |
| Plan Completeness | WARNING (F2, F4) → naprawione |

## Grounding

8/8 ścieżek ✓, symbole ✓ (STATE_ACCEPTED/SOURCE_MANUAL/FRONT_MAX/BACK_MAX, `listFlashcards`
bez filtra stanu, `createDeck` bez `.select()`, `deckIdByPublicId`, Sidebar „generate" wyłączony,
schemat env, RLS deck-join, migracje init + manual_card_source). brief↔plan: rozbieżność wykryta
w F1 (przełącznik stanów) — usunięta w triage.

## Findings

### F1 — End State obiecuje przełącznik stanów, którego Faza 5 nie buduje

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — decyzja oczywista, wąski zakres (przeredagowanie)
- **Dimension**: End-State Alignment
- **Location**: Desired End State (plan:54-55) + plan-brief vs Phase 5
- **Detail**: Desired End State i brief obiecywały „przełącznik pozwala zobaczyć generated/rejected",
  ale Faza 5 explicite buduje tylko domyślny filtr `accepted` i odkłada przełącznik do S-05.
  Obietnica end-state bez pokrycia → ryzyko fałszywego driftu w impl-review.
- **Fix**: Zaktualizować Desired End State (plan + brief), by mówił tylko o domyślnym filtrze
  `accepted`; oglądanie generated/rejected (przełącznik) jawnie oznaczyć jako odłożone do S-05.
- **Decision**: FIXED (Fix in plan — plan.md Desired End State + plan-brief Desired End State
  i wiersz „Wyciek do talii"; zakres wąski, bez ruszania Faz/kodu/S-06)

### F2 — Semantyka liczników przy korekcie niedoprecyzowana

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny styk kontraktu odpowiedzi
- **Dimension**: Plan Completeness
- **Location**: Phase 2 (walidacja) → Phase 3 (zwrot `counts`)
- **Detail**: `counts: {generated, saved, skipped}` i `generation_session` liczniki bez definicji
  jak liczyć `generated`/`skipped`; „zapisano N / pominięto M" (twarde kryterium done) dwuznaczne.
- **Fix**: Zdefiniować `generated`/`saved`/`skipped = generated − saved`, te same wartości do sesji,
  mapowanie N=saved, M=skipped.
- **Decision**: FIXED (Fix in plan — definicja dodana w Fazie 2 i Fazie 3; sformułowana neutralnie,
  następnie doprecyzowana po decyzji F5: `generated` = karty z pojedynczego bazowego calla)

### F3 — Brak serwerowego dławika na płatny endpoint

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — decyzja oczywista, wąski zakres
- **Dimension**: Blind Spots
- **Location**: Phase 3 (endpoint) + Performance
- **Detail**: `/api/generate` woła płatny OpenRouter dla każdego zalogowanego bez rate-limitu;
  „Ponów" + wyścig timeoutu mogą zwielokrotnić calle. Budżet $5 wspomniany, throttling — nie.
- **Fix**: Dopisać do „What We're NOT Doing" jawne odłożenie rate-limitu (świadoma decyzja MVP);
  odnotować nieosłonięty serwer (klient blokuje przycisk w pending).
- **Decision**: FIXED (Fix in plan — nowy wpis w „What We're NOT Doing")

### F4 — Zła nazwa nagłówka OpenRouter

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — poprawka jednego identyfikatora
- **Dimension**: Plan Completeness
- **Location**: Phase 2 (openrouter.ts contract, plan:238)
- **Detail**: Plan podawał `X-OpenRouter-Title`; realny opcjonalny nagłówek atrybucji to `X-Title`
  (obok `HTTP-Referer`). Opcjonalny, więc nie blokuje działania, ale identyfikator błędny.
- **Fix**: Zmienić na `X-Title` (albo pominąć — opcjonalny).
- **Decision**: FIXED (Fix in plan — poprawiono na `X-Title`, oznaczono jako opcjonalny)

### F5 — Korekta re-call: możliwy gold-plating na MVP

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny tradeoff jakość vs prostota
- **Dimension**: Lean Execution
- **Location**: Phase 2 (walidacja + korygujący re-call)
- **Detail**: Master-prompt z self-checkiem + fallback „pomiń wadliwe" już dają działający wynik.
  1-shot korekta dokłada drugą ścieżkę calla i logikę scalania/liczników. Dźwignia pod metrykę 75%,
  ale też koszt złożoności na pierwszym slice. Decyzja keep/cut.
- **Fix**: Wyciąć korektę na MVP — pojedynczy bazowy call + fallback; 1-shot korekta odłożona jako
  dźwignia jakości do rewizji, jeśli skip-rate okaże się wysoki.
- **Decision**: FIXED (Cut — usunięto re-call spójnie w plan.md: Overview, Faza 2 #3, Faza 3
  „Granica 0 zapisanych", Critical Details, Performance, Testing, Progress 2.5; oraz w plan-brief:
  wiersze „Wadliwe karty" / „Phases at a Glance" i Architecture; dodano wpis odłożenia w „NOT Doing")
