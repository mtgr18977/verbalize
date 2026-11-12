import { test, expect } from '@playwright/test';
import { review } from './helpers/editor';

const FILLER = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} describes the install step.`).join('\n\n');

test('selecting an alert scrolls it to the middle of the editor and highlights it', async ({ page }) => {
  await page.goto('/');

  await review(page, `${FILLER}\n\nWe really use this in order to test it.\n\n${FILLER}`);
  const card = page.getByTestId('alert-card').filter({ hasText: 'Google.WordList' });
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();

  const geometry = await expect
    .poll(async () =>
      page.evaluate(() => {
        const scroller = document.querySelector('.cm-scroller')?.getBoundingClientRect();
        const selection = document.querySelector('.cm-selectionBackground')?.getBoundingClientRect();
        if (!scroller || !selection) return null;
        const middleOfEditor = scroller.top + scroller.height / 2;
        const middleOfSelection = selection.top + selection.height / 2;
        return Math.abs(middleOfEditor - middleOfSelection);
      })
    )
    .toBeLessThan(40);
  void geometry;

  // the selected text is drawn with the theme's selection color
  const background = await page.locator('.cm-selectionBackground').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
});
