// SONDA — plik TYMCZASOWY, usuwany drugą połową pary dowodowej.
//
// Istnieje po to, żeby dowieść, że `agents-gate.yml` potrafi zaświecić na CZERWONO na TEJ
// ŚCIEŻCE, na której będzie żył — a nie tylko lokalnie. Para: ten commit ma dać przebieg
// czerwony, a jego usunięcie zielony, przy jednej zmiennej różnicy.
//
// Celuje w KROK TYPECHECK, nie w testy: nazwa pliku nie pasuje do `*.test.ts`, więc runner
// testów jej nie widzi i czerwień nie może przyjść z dwóch miejsc naraz.
export const probe: number = "to nie jest liczba";
