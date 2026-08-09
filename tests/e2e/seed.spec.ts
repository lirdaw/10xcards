// SEED TEST — wzorzec, z którego /10x-e2e uczy się Twoich konwencji.
// Ryzyko (test-plan.md): utworzona talia musi przetrwać odświeżenie strony.
// Sprzątanie NIE jest krokiem testu — `test`/`expect` biorą się z ./fixtures.ts, które dokłada
// fixture `registry`. Powód jest zmierzony, nie stylistyczny: ten plik kasował talię własną
// ostatnią linijką, więc awaria WCZEŚNIEJ w spec-u pomijała sprzątanie na stałe — i tak się
// stało: `E2E deck 1785947414992` wisi osierocona od 2026-08-05. Rejestracja przed zapisem +
// projekt teardown domykają obie połowy tej dziury.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";

// Otwarcie modala to wyspa React: przycisk istnieje w SSR, zanim Astro podepnie onClick.
// Klikamy i czekamy, aż dialog naprawdę się otworzy; jeśli klik przepadł (przed hydracją),
// Playwright ponawia. Guard isVisible() chroni przed klikaniem w już otwarty modal.
async function openModal(page: Page, triggerName: string, dialogName: string) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await page.getByRole("button", { name: triggerName }).click();
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  return dialog;
}

test("utworzona talia przetrwa odświeżenie strony", async ({ page, registry }) => {
  const deckName = `E2E deck ${Date.now()}`; // unikalne dane => brak kolizji między przebiegami

  // PRZED zapisem, nie po. Nazwa jest wybrana już teraz, więc rejestracja nic nie kosztuje, a
  // zamyka okno, w którym spec ginący między utworzeniem a zapisem zostawia wiersz na zawsze.
  registry.deck(deckName);

  await page.goto("/decks"); // start zalogowany dzięki storageState

  // Tworzenie talii — po ROLI, w obrębie otwartego dialogu.
  const createDialog = await openModal(page, "Nowa talia", "Nowa talia");
  await createDialog.getByRole("textbox", { name: "Nazwa talii" }).fill(deckName);
  await createDialog.getByRole("button", { name: "Utwórz" }).click();

  // Trwałość sprawdzamy WPROST na liście — nie zakładamy, dokąd przekierował POST.
  await page.goto("/decks");
  await expect(page.getByRole("link", { name: deckName })).toBeVisible();

  // Sedno ryzyka: po odświeżeniu talia nadal istnieje (czekamy na STAN, nie na czas).
  await page.reload();
  await expect(page.getByRole("link", { name: deckName })).toBeVisible();

  // Koniec testu. Talię usuwa projekt `teardown` (tests/e2e/teardown/cleanup.teardown.ts) po
  // całym przebiegu, niezależnie od jego wyniku — patrz komentarz przy imporcie.
});
