import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const WITH_ALERTS = 'We really use this in order to test it.';
const CLEAN = 'Install the package.';

async function runLint(page: Page, text: string): Promise<void> {
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: /Run Linting/ }).click();
}

test.describe('review states', () => {
  test('does not claim the document is clean before any review', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Not reviewed yet')).toBeVisible();
    await expect(page.getByText(/No alerts in/)).toHaveCount(0);
    await expect(page.getByText('Document Clean')).toHaveCount(0);
  });

  test('says "no alerts" only after a review that found none', async ({ page }) => {
    await page.goto('/');
    await runLint(page, CLEAN);
    await expect(page.getByText('No alerts in 1 line')).toBeVisible();
  });

  test('marks results as out of date when the text changes', async ({ page }) => {
    await page.goto('/');
    await runLint(page, WITH_ALERTS);
    await expect(page.locator('.p-4.rounded-xl.border').first()).toBeVisible({ timeout: 15000 });

    await page.locator('textarea').fill(WITH_ALERTS + ' Edited.');
    await expect(page.getByText(/The text changed after the last review/)).toBeVisible();
    await expect(page.getByText('Line changed').first()).toBeVisible();

    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect(page.getByText(/The text changed after the last review/)).toHaveCount(0);
  });
});

test.describe('running a review', () => {
  test('Run Linting stays reachable with the sidebar collapsed, and Ctrl+Enter works', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Close settings' }).click();

    await expect(page.getByRole('button', { name: /Run Linting/ })).toBeVisible();

    await page.locator('textarea').fill(WITH_ALERTS);
    await page.locator('textarea').press('Control+Enter');
    await expect(page.locator('.p-4.rounded-xl.border').first()).toBeVisible({ timeout: 15000 });
  });

  test('controls inside the collapsed sidebar cannot receive focus', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.locator('aside')).toHaveAttribute('inert', '');

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const insideSidebar = await page.evaluate(() => Boolean(document.activeElement?.closest('aside')));
      expect(insideSidebar).toBe(false);
    }
  });
});

test.describe('theme toggle changes what the user sees', () => {
  async function surfaceColors(page: Page): Promise<{ sidebar: string; header: string }> {
    return page.evaluate(() => ({
      sidebar: getComputedStyle(document.querySelector('aside') as Element).backgroundColor,
      header: getComputedStyle(document.querySelector('header') as Element).backgroundColor,
    }));
  }

  test.describe('OS in light mode', () => {
    test.use({ colorScheme: 'light' });

    test('switching to dark darkens the panels, not only the page background', async ({ page }) => {
      await page.goto('/');
      const before = await surfaceColors(page);
      await page.getByTitle('Toggle Theme').click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      const after = await surfaceColors(page);
      expect(after.sidebar).not.toBe(before.sidebar);
      expect(after.header).not.toBe(before.header);
    });
  });

  test.describe('OS in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('switching to light lightens the panels', async ({ page }) => {
      await page.goto('/');
      const before = await surfaceColors(page);
      await page.getByTitle('Toggle Theme').click();
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      const after = await surfaceColors(page);
      expect(after.sidebar).not.toBe(before.sidebar);
      expect(after.header).not.toBe(before.header);
    });
  });
});
