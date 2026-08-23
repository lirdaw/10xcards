import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — see
// test-plan.md §6.1 on why its test still sits in tests/lib/ beside the suite's other
// pure-function files rather than in a tests/scripts/ folder holding one file.
import {
  ASSERTIONS_PATH,
  ASSERTIONS_RELATIVE_PATH,
  REFRESH_COMMAND,
  VERDICT_CONFIG_FIELDS,
  VERDICT_SOURCE_RELATIVE_PATH,
  compareVerdictConfig,
  liveAssertionsDigest,
  liveVerdictConfig,
  remedyFor,
  serializeRecord,
  withVerdictConfig,
} from "../../scripts/verdict-config.ts";
import type { VerdictConfig, VerdictConfigField } from "../../scripts/verdict-config.ts";

// Oś INTERPRETACJI dowodu evali: cztery pola, których zmiana zmienia ODCZYT odpowiedzi modelu,
// a nie samą odpowiedź — więc ich remedium jest DARMOWE i nie wolno go pomylić z płatnym
// przejściem macierzy.
//
// Dwie połowy, i druga jest tą, która nadaje pierwszej sens:
//
//   1. porównanie reaguje na KAŻDE z czterech pól — osobno, i tylko na swoje;
//   2. remedium mówi człowiekowi, co ZROBIĆ, i nie sugeruje, że narzędzie zrobi to za niego.
//
// Połowa 2 nie jest ceremonią. Remedium, które mówi tylko „rozjechało się", zostawia jedyny
// dostępny ruch: odruchowe przepisanie wartości bez przeczytania czegokolwiek — a wtedy bramka
// zapisuje zgodę na próg, którego nikt nie widział, i jest gorsza niż jej brak.

/** Hex o poprawnym kształcie, który na pewno nie jest digestem żadnego pliku w tym repo. */
const WRONG_DIGEST = `${"0".repeat(63)}1`;

/** Wartość, która na pewno różni się od żywej — jedna na typ pola. */
function differentValue(field: VerdictConfigField, live: VerdictConfig): string | number {
  return field === "assertionsDigest" ? WRONG_DIGEST : live[field] + 1;
}

const live = liveVerdictConfig();

describe("compareVerdictConfig", () => {
  it("milczy, gdy rekord opisuje dzisiejsze drzewo", () => {
    expect(compareVerdictConfig({ ...live }, live)).toEqual([]);
  });

  // KONTROLA POZYTYWNA, pole po polu. Bez niej wszystkie asercje wyżej przechodziłyby także dla
  // porównania patrzącego wyłącznie na `threshold` — a wtedy zmiana skali albo asercji jechałaby
  // na zielono nad rekordem, który jej nie opisuje.
  for (const field of VERDICT_CONFIG_FIELDS) {
    it(`czerwieni DOKŁADNIE ${field}, gdy rekord różni się wyłącznie tym polem`, () => {
      const recorded = { ...live, [field]: differentValue(field, live) };
      const drifted = compareVerdictConfig(recorded, live).map((drift) => drift.field);

      expect(
        drifted,
        `rekord różniący się WYŁĄCZNIE na ${field} zgłasza ${JSON.stringify(drifted)}, a miał zgłosić ` +
          `["${field}"] — czyli albo mutacja nie czerwieni swojego pola (pole nie wchodzi do porównania), ` +
          "albo czerwieni cudze (pola nakładają się na siebie)",
      ).toEqual([field]);
    });
  }

  // Rekord bez pola nie opisuje go — a `undefined === undefined` jest właśnie tą drogą, którą
  // brakujące pole przechodziłoby na zielono.
  it("traktuje brak pola jak rozjazd, nie jak zgodę", () => {
    expect(compareVerdictConfig(undefined, live).map((drift) => drift.field)).toEqual([...VERDICT_CONFIG_FIELDS]);
    expect(compareVerdictConfig({}, live).map((drift) => drift.field)).toEqual([...VERDICT_CONFIG_FIELDS]);
  });

  it("zgłasza rozjazdy w kolejności VERDICT_CONFIG_FIELDS, nie w kolejności kluczy rekordu", () => {
    const reversed = Object.fromEntries(
      [...VERDICT_CONFIG_FIELDS].reverse().map((field) => [field, differentValue(field, live)]),
    );

    expect(compareVerdictConfig(reversed, live).map((drift) => drift.field)).toEqual([...VERDICT_CONFIG_FIELDS]);
  });

  it("niesie obie wartości, żeby komunikat miał co zacytować", () => {
    const [drift] = compareVerdictConfig({ ...live, threshold: 8 }, live);

    expect(drift).toEqual({ field: "threshold", recorded: 8, live: live.threshold });
  });
});

describe("remedyFor", () => {
  it("cytuje komendę odświeżającą i mówi wprost, że macierzy przejeżdżać NIE TRZEBA", () => {
    for (const field of VERDICT_CONFIG_FIELDS) {
      const remedy = remedyFor(compareVerdictConfig({ ...live, [field]: differentValue(field, live) }, live));

      expect(remedy).toContain(REFRESH_COMMAND);
      expect(remedy).toContain("NIE wymaga przejścia macierzy");
      expect(remedy).toContain("agents/review/evals/eval-record.json");
    }
  });

  it("dla trzech liczb podaje STARĄ i NOWĄ wartość oraz plik, w którym mieszkają", () => {
    for (const field of ["threshold", "scoreMin", "scoreMax"] as const) {
      const recorded = differentValue(field, live);
      const remedy = remedyFor(compareVerdictConfig({ ...live, [field]: recorded }, live));

      // Obie wartości, bo remedium brzmi „przepisz" — a przepisać da się tylko to, co widać.
      expect(remedy).toContain(`${JSON.stringify(recorded)} → ${JSON.stringify(live[field])}`);
      expect(remedy).toContain(VERDICT_SOURCE_RELATIVE_PATH);
    }
  });

  // Ta połowa remedium jest najłatwiejsza do napisania ŹLE — „odśwież digest" brzmi jak krok
  // mechaniczny, a nim nie jest: z rekordu nie da się wyprowadzić, czy zapisane `ok` bronią się
  // pod nowymi asercjami, bo asercje startują od pełnego obiektu `Review`, którego rekord nie ma.
  // Dlatego treść tej gałęzi idzie pod test tak samo jak reszta.
  it("dla assertionsDigest nazywa czynność LUDZKĄ i nie udaje, że narzędzie ją wykona", () => {
    const remedy = remedyFor(compareVerdictConfig({ ...live, assertionsDigest: WRONG_DIGEST }, live));

    expect(remedy).toContain(ASSERTIONS_RELATIVE_PATH);
    expect(remedy).toContain("OCEŃ SAM");
    expect(remedy).toContain("nie zrobi za ciebie żadne narzędzie");
    // „przelicz" w dowolnej odmianie obiecywałoby krok, którego nie ma.
    expect(remedy).not.toMatch(/przelicz/i);
    // Dwa nieczytelne hexy obok siebie czytają się jak zaproszenie do przepisania jednego
    // w miejsce drugiego — czyli do ruchu, przed którym to remedium ostrzega.
    expect(remedy).not.toContain(WRONG_DIGEST);
    expect(remedy).not.toContain(live.assertionsDigest);
  });

  it("kończy się ostrzeżeniem, że sam krok odświeżający niczego nie sprawdza", () => {
    const remedy = remedyFor(compareVerdictConfig({ ...live, threshold: 8 }, live));

    expect(remedy.trimEnd().endsWith("nikt nie przeczytał.")).toBe(true);
  });
});

// Fikstura WŁASNA tego pliku, tworzona i mutowana w jego własnych `it()` — nigdy plik z repo
// (lessons.md, „A positive control must OWN the fixture it mutates"). `sequence: { shuffle: true }`
// w vitest.config.ts sprawiłby, że zależność od sąsiada objawiłaby się flakiem, a nie złą
// odpowiedzią.
const fixtureDir = mkdtempSync(join(tmpdir(), "verdict-config-"));

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function fixtureUrl(name: string, content: string): URL {
  const path = join(fixtureDir, name);
  writeFileSync(path, content, "utf8");
  return pathToFileURL(path);
}

describe("liveAssertionsDigest", () => {
  // THE kontrola pozytywna. Digest liczony z czegoś, co nie jest treścią pliku (albo ze stałej),
  // byłby idealnie stabilny i nie opisywałby niczego — bramka świeciłaby na zielono na zawsze.
  it("zmienia się, gdy zmienia się treść pliku", () => {
    const before = liveAssertionsDigest(fixtureUrl("a.ts", "export const x = 1;\n"));
    const after = liveAssertionsDigest(fixtureUrl("b.ts", "export const x = 2;\n"));

    expect(after).not.toBe(before);
  });

  it("nie zmienia się od samej nazwy pliku — liczy treść, nie ścieżkę", () => {
    const first = liveAssertionsDigest(fixtureUrl("c.ts", "export const x = 1;\n"));
    const second = liveAssertionsDigest(fixtureUrl("d.ts", "export const x = 1;\n"));

    expect(second).toBe(first);
  });

  it("jest niewrażliwy na CRLF, bo .gitattributes przypina eol=lf", () => {
    const lf = liveAssertionsDigest(fixtureUrl("lf.ts", "export const x = 1;\nexport const y = 2;\n"));
    const crlf = liveAssertionsDigest(fixtureUrl("crlf.ts", "export const x = 1;\r\nexport const y = 2;\r\n"));

    expect(crlf).toBe(lf);
  });

  // Domknięcie od strony ŚCIEŻKI: `ASSERTIONS_PATH` wskazujący nieistniejący plik rzuca (więc
  // widać go od razu), ale wskazujący plik NIE TEN dawałby digest idealnie poprawny i opisujący
  // coś innego. Marker jest brany z asercji, których ta oś dotyczy.
  it("wskazuje PRAWDZIWY plik asercji, nie inny plik o poprawnym kształcie", () => {
    const source = readFileSync(new URL(`../../${ASSERTIONS_RELATIVE_PATH}`, import.meta.url), "utf8");

    expect(source).toContain("export function checkScopeDisciplineScored");
    expect(live.assertionsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(live.assertionsDigest).toBe(liveAssertionsDigest(ASSERTIONS_PATH));
  });
});

// Zapisywacz połowy `scripts/`. Dwaj zapisywacze piszą do JEDNEGO pliku i każdy musi przenieść
// blok drugiego nietknięty — a nie mogą dzielić modułu serializującego, bo `scripts/` nie wolno
// importować kodu agenta. Stąd dwa egzemplarze `serializeRecord` i dwa testy round-tripu; ten
// jest tym po stronie `scripts/`.
//
// Rzecz, której ten test pilnuje NAPRAWDĘ: gdyby ten zapisywacz dotykał `callFingerprint` albo
// `matrix`, oś PŁATNA (przejście macierzy) dałaby się zazielenić komendą DARMOWĄ — czyli
// rozłączność remediów, na której stoi cała ta zapadka, przestałaby obowiązywać.
describe("withVerdictConfig", () => {
  const FOREIGN = {
    notes: { scope: "s", oneMeasurement: "o", costSource: "c", uncovered: "u", fixtures: "f" },
    generatedAt: "2026-08-23T12:00:00.000Z",
    callFingerprint: "a".repeat(64),
    matrix: [{ model: "m", fixture: "f", ok: true }],
  };

  it("podmienia WYŁĄCZNIE swój blok, a cudze przenosi co do wartości", () => {
    const written = withVerdictConfig({ ...FOREIGN, verdictConfig: { threshold: 999 } }, live);

    expect(written.callFingerprint).toBe(FOREIGN.callFingerprint);
    expect(written.matrix).toEqual(FOREIGN.matrix);
    expect(written.notes).toEqual(FOREIGN.notes);
    expect(written.generatedAt).toBe(FOREIGN.generatedAt);
    expect(written.verdictConfig).toEqual({ ...live });
  });

  it("wypisuje klucze w tej samej kolejności co zapisywacz agencki", () => {
    const written = withVerdictConfig(FOREIGN, live);

    expect(Object.keys(written)).toEqual(["notes", "generatedAt", "callFingerprint", "verdictConfig", "matrix"]);
  });

  it("przenosi klucze, których nie zna, zamiast je kasować", () => {
    const written = withVerdictConfig({ ...FOREIGN, somethingNew: { kept: true } }, live);

    expect(written.somethingNew).toEqual({ kept: true });
  });

  it("nie dorabia pustych pól, gdy dowodu jeszcze nie ma w całości", () => {
    const parsed: unknown = JSON.parse(serializeRecord(withVerdictConfig({}, live)));

    expect(Object.keys(parsed as object)).toEqual(["verdictConfig"]);
  });
});

describe("serializeRecord", () => {
  it("round-trip: bajty przeżywają odczyt, a obiekt serializację", () => {
    const record = withVerdictConfig(
      {
        notes: { scope: "s", oneMeasurement: "o", costSource: "c", uncovered: "u", fixtures: "f" },
        generatedAt: "2026-08-23T12:00:00.000Z",
        callFingerprint: "a".repeat(64),
        matrix: [{ model: "m", fixture: "f", ok: true, failures: [{ reason: "r" }] }],
      },
      live,
    );
    const raw = serializeRecord(record);

    expect(serializeRecord(JSON.parse(raw))).toBe(raw);
    expect(raw.endsWith("\n")).toBe(true);
  });

  // Ta sama linia stoi w agents/review/evals/eval-record.ts. Rozjazd między nimi objawiłby się
  // jako plik przeformatowany przez jednego zapisywacza i czerwony round-trip u drugiego — więc
  // asertujemy KSZTAŁT wyjścia, nie samą równość dwóch implementacji, których nie wolno importować.
  it("wcina dwiema spacjami — inaczej lint-staged przepisałby dowód przy pierwszym commicie", () => {
    const raw = serializeRecord({ a: { b: 1 } });

    expect(raw).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n');
  });
});
