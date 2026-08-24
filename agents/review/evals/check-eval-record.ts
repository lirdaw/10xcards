// AGENCKA połowa zapadki evali: czy w drzewie leży AKTUALNY wynik ręcznego przejścia macierzy.
//
// ⚑ Ten plik PISZE na stderr i tak ma być: jego produktem jest RAPORT — nazwanie własności dowodu,
// która się rozjechała, i tego, co z nią zrobić — a kod wyjścia jest tylko jego streszczeniem.
// Wypis idzie na stderr, nie na stdout, bo adnotacje `::error`/`::notice` czyta GitHub Actions
// z obu strumieni, a stdout zostawiamy wolny dla ewentualnego potoku. Stał tu wcześniej
// `/* eslint-disable no-console */`, który NICZEGO nie wyłączał: `eslint.config.js:130` ignoruje
// `agents/**` w całości, więc lint tego pliku nigdy nie widział, a dyrektywa sugerowała zasięg,
// którego nie ma. Skanu `tests/lib/no-logging.test.ts` też nie dotyczy — ten chodzi po `src/`.
//
// Ten runner NIE WOŁA MODELU ani razu i nie ma do tego klucza — cały jego wkład to odczyt pliku,
// policzenie dzisiejszego odcisku i oddanie decyzji z rdzenia (`./eval-record.ts`). Macierz odpala
// CZŁOWIEK, ręcznie, za pieniądze; CI sprawdza wyłącznie, czy dowód opisuje dzisiejsze wywołanie.
//
// ⚑ IMPORTUJE WYŁĄCZNIE `./fingerprint.ts` I `./eval-record.ts` — nigdy `./provider.ts` ani
// `./cache.ts`. Oba ciągną `promptfoo` importem WARTOŚCIOWYM (`cache.ts:2`), a ten plik jedzie
// w drzewie po `npm ci --omit=dev`, gdzie `promptfoo` (devDependency) nie istnieje. Ta sama
// przyczyna wypchnęła `fingerprintPrompt` do osobnego modułu (D-7): to nie jest estetyka, tylko
// warunek uruchomienia. Uruchamiany przez `node --experimental-strip-types`, NIE przez `tsx` —
// `tsx` też jest devDependency.
//
// Podział na dwie klasy czerwieni jest treścią decyzji D-6 i nie wolno go „posprzątać":
//
//   * (B) PROMPT ZREGRESOWAŁ — odpowiedź PRZYSZŁA i nie spełnia asercji albo złamała schemat.
//     To BLOKUJE, a remedium jest PŁATNE.
//   * (A) MODEL NIE DOWIÓZŁ — nazwany podtyp niedowiezienia. Zapisywane, RAPORTOWANE jako
//     `::notice`, nie blokuje: odpowiedzi nie ma, więc nie ma czego porównywać z promptem.
//
// Wszystko, co nie dopasowało się do NAZWANEJ pozycji (A), czerwieni — fail-closed. Kosz na
// niewiadome (`[unknown]`) nie jest przepustką: nowy podtyp awarii SDK ma domyślnie BLOKOWAĆ,
// zamiast domyślnie milczeć.

import { readFileSync } from "node:fs";
import {
  RECORD_PATH,
  RECORD_RELATIVE_PATH,
  checkRecord,
  observationsFor,
  remedyFor,
  type EvalRecord,
} from "./eval-record.ts";
import { productionPromptFingerprint } from "./fingerprint.ts";

/** Bajty dowodu albo `undefined`, gdy pliku nie ma. Brak pliku to CZERWIEŃ, nie „brak danych". */
function readRaw(): string | undefined {
  try {
    return readFileSync(RECORD_PATH, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * `JSON.parse` bez rzutu — nieczytelny plik ma dojść do rdzenia jako `malformed`, a nie wywalić
 * runner. Awaria bramki i zły dowód to dwie różne rzeczy i mają dawać dwa różne komunikaty.
 */
function parseOrUndefined(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function main(): number {
  const raw = readRaw();
  const record = parseOrUndefined(raw);
  const problems = checkRecord({ raw, record, liveFingerprint: productionPromptFingerprint() });

  // Obserwacje (A) wypisujemy ZAWSZE, także przy czerwieni z innej osi: stan kwalifikacji modelu
  // jest informacją niezależną od tego, czy dowód jest aktualny. Czytane tylko z rekordu, który
  // przeszedł kształt — inaczej sięgałyby po pola, których nie ma.
  const shapeIsUsable = !problems.some((problem) => problem.kind === "malformed" || problem.kind === "missing");
  if (shapeIsUsable && record !== undefined) {
    for (const observation of observationsFor(record as EvalRecord)) {
      console.error(`::notice file=${RECORD_RELATIVE_PATH},title=${observation.title}::${observation.detail}`);
    }
  }

  if (problems.length === 0) {
    // Ślad na ścieżce SUKCESU — patrz uzasadnienie w `scripts/check-verdict-config.ts`.
    const cells = (record as EvalRecord).matrix.length;
    console.error(
      `[eval-record] odcisk ${productionPromptFingerprint().slice(0, 12)}… zgadza się z dowodem; ` +
        `${cells} komórek, żadna w klasie (B).`,
    );
    return 0;
  }

  // JEDNA adnotacja na PROBLEM, nie zbiorcza: czerwień ma powiedzieć, KTÓRA własność się
  // rozjechała i jakie jest JEJ remedium. Zbiorcza zostawiałaby jeden dostępny ruch — odruchowe
  // przepisanie pliku.
  for (const problem of problems) {
    console.error(`::error file=${RECORD_RELATIVE_PATH},title=${problem.title}::${remedyFor(problem)}`);
  }
  return 1;
}

try {
  process.exitCode = main();
} catch (err) {
  // Awaria SAMEJ bramki, odróżnialna od zgody — wzorzec `scripts/check-prompt-sources.ts`.
  console.error(`[eval-record] AWARIA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
