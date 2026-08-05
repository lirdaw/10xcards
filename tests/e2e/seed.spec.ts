// SEED TEST — wzorzec, z którego /10x-e2e uczy się Twoich konwencji.
// Ryzyko (test-plan.md): utworzona talia musi przetrwać odświeżenie strony.
import { test, expect, type Page } from "@playwright/test";

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

test("utworzona talia przetrwa odświeżenie strony", async ({ page }) => {
  const deckName = `E2E deck ${Date.now()}`; // unikalne dane => brak kolizji między przebiegami

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

  // Cleanup: wejdź w talię i usuń ją, żeby kolejny przebieg startował czysto.
  await page.getByRole("link", { name: deckName }).click();
  const deleteDialog = await openModal(page, "Usuń", "Usuń talię");
  await deleteDialog.getByRole("button", { name: "Usuń" }).click();

  await page.goto("/decks");
  await expect(page.getByRole("link", { name: deckName })).toHaveCount(0);
});
