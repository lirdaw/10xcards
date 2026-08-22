import { writeFileSync } from "node:fs";
import { CRITERIA } from "./review-schema.ts";

/**
 * Generator `criteria.json` — wzorzec, który to repo już stosuje przy `src/db/database.types.ts`:
 * jedno źródło GENERUJE zacommitowany plik, konsument czyta DANE, a bramka w CI regeneruje
 * i porównuje (`git diff --exit-code`).
 *
 * Po co: `scripts/` renderuje komentarz PR-a i potrzebuje do tego etykiet oraz informacji
 * o warunkowości kryteriów — ale NIE MOŻE importować kodu agenta. `agents/**` jest świadomie
 * poza tsconfigiem aplikacji, ESLintem i vitestem, a import przez tę granicę odebrałby agentowi
 * przenośność, która jest powodem, dla którego budujemy własnego agenta zamiast brać gotową akcję.
 *
 * Co to kupuje: druga lista kryteriów po stronie `scripts/` w ogóle nie powstaje, więc nie ma
 * czemu dryfować. Jedyna para (`CRITERIA` → `criteria.json`) jest domknięta mechanicznie —
 * bez parsowania źródła regexem.
 *
 * `describe` NIE wchodzi do pliku: to instrukcja dla modelu, nie dane do renderowania. Wpuszczenie
 * jej tutaj zrobiłoby z `criteria.json` drugą kopię promptu i wystawiłoby ją na pokusę edycji
 * po stronie konsumenta.
 */
const OUTPUT_PATH = new URL("./criteria.json", import.meta.url);

const payload = CRITERIA.map(({ key, noteKey, label, conditional }) => ({ key, noteKey, label, conditional }));

/**
 * Formatowanie MUSI być bit w bit tym, co wypluje prettier, i to nie jest kosmetyka.
 * `lint-staged` uruchamia `prettier --write` na każdym stagowanym `*.json`, a `agents/**`
 * NIE jest w `.prettierignore` — więc gdyby generator emitował cokolwiek innego, pierwszy commit
 * przeformatowałby plik, a bramka `git diff --exit-code` w composite action byłaby czerwona
 * NA ZAWSZE. I to czerwień myląca: o formatowaniu, nie o dryfie kontraktu.
 *
 * Zgodność z prettierem (wcięcie 2 spacje z `.prettierrc.json`, znak nowej linii na końcu pliku)
 * jest sprawdzana wprost — `npx prettier --check agents/review/criteria.json` jest kryterium
 * sukcesu tej fazy, a nie założeniem.
 */
writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.error(`[criteria] zapisano ${payload.length} kryteriów do ${OUTPUT_PATH.pathname}`);
