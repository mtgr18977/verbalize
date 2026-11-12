import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { docText, editor, setText } from './helpers/editor';

const DOC = '# Install\n\nWe really use this in order to test it.\nThe file was deleted by the user.';

async function fillAndReview(page: Page, text: string = DOC): Promise<void> {
  await setText(page, text);
  await page.getByRole('button', { name: /Run Linting/ }).click();
}

/** True when a drawn selection overlaps the underlined alert text: the editor selected that alert. */
async function selectionCoversAlert(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const selection = document.querySelector('.cm-selectionBackground')?.getBoundingClientRect();
    if (!selection) return false;
    return [...document.querySelectorAll('.cm-lintRange')].some((mark) => {
      const box = mark.getBoundingClientRect();
      return box.left < selection.right && box.right > selection.left && box.top < selection.bottom && box.bottom > selection.top;
    });
  });
}

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('editor and alerts sit side by side and the preview is a tab', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await expect(page.locator('#panel-alerts')).toBeVisible();
    await expect(page.locator('#panel-preview')).toBeHidden();
    // the phone navigation does not exist on desktop
    await expect(page.getByRole('tablist', { name: 'Panels' })).toBeHidden();

    await setText(page, '# Hello\n\nSome *text*.');
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('#panel-preview').getByRole('heading', { name: 'Hello' })).toBeVisible();
    await expect(editor(page)).toBeHidden();
    await expect(page.locator('#panel-alerts')).toBeVisible();

    await page.getByRole('tab', { name: 'Editor' }).click();
    expect(await docText(page)).toBe('# Hello\n\nSome *text*.');
  });

  test('tabs follow the keyboard pattern: arrow keys move between them', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Editor' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Preview' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking an alert while the preview is open goes back to the editor and selects the text', async ({ page }) => {
    await page.goto('/');
    await fillAndReview(page);
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });

    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(editor(page)).toBeHidden();

    await page.getByTestId('alert-card').first().click();
    await expect(editor(page)).toBeVisible();
    await expect(editor(page)).toBeFocused();
    await expect.poll(() => selectionCoversAlert(page)).toBe(true);
  });
});

test.describe('phone layout (390 x 844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('fits the screen: no horizontal scroll and the header is fully visible', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    for (const name of [/Run Linting/, 'Toggle theme', 'Open settings']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
  });

  test('opens on the editor with usable width, and the settings drawer starts closed', async ({ page }) => {
    await page.goto('/');
    const area = await page.getByTestId('editor').boundingBox();
    expect(area!.width).toBeGreaterThan(340);

    await expect(page.locator('aside')).toHaveAttribute('inert', '');
    const drawer = await page.locator('aside').boundingBox();
    expect(drawer!.x + drawer!.width).toBeLessThanOrEqual(0);

    // 16 px keeps iOS from zooming the page when the field is focused
    const fontSize = await editor(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test('shows one panel at a time through the bottom tabs', async ({ page }) => {
    await page.goto('/');
    const tabs = page.getByRole('tablist', { name: 'Panels' }).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('#panel-alerts')).toBeHidden();

    await tabs.nth(2).click();
    await expect(page.locator('#panel-alerts')).toBeVisible();
    await expect(editor(page)).toBeHidden();
    await expect(page.getByText('Not reviewed yet')).toBeVisible();

    await tabs.nth(0).click();
    await setText(page, '# Title\n\nBody text');
    await tabs.nth(1).click();
    await expect(page.locator('#panel-preview').getByRole('heading', { name: 'Title' })).toBeVisible();
  });

  test('running a review takes you to the alerts, and tapping one returns to the selected text', async ({ page }) => {
    await page.goto('/');
    await fillAndReview(page);

    await expect(page.locator('#panel-alerts')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('alert-card').first()).toBeVisible();
    await expect(editor(page)).toBeHidden();
    // the tab shows how many alerts there are
    await expect(page.getByRole('tab', { name: /Alerts\s*\d+/ })).toBeVisible();

    await page.getByTestId('alert-card').first().click();
    await expect(editor(page)).toBeVisible();
    await expect.poll(() => selectionCoversAlert(page)).toBe(true);
    // the keyboard stays closed: the selection is drawn without focusing the editor
    await expect(editor(page)).not.toBeFocused();
  });

  test('settings open as a drawer and close with Escape or by tapping outside', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.locator('aside')).not.toHaveAttribute('inert', '');
    const open = await page.locator('aside').boundingBox();
    expect(open!.x).toBeGreaterThanOrEqual(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('aside')).toHaveAttribute('inert', '');

    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.locator('aside')).not.toHaveAttribute('inert', '');
    // tap on the dimmed area to the right of the 288 px drawer
    await page.mouse.click(350, 400);
    await expect(page.locator('aside')).toHaveAttribute('inert', '');
  });

  test('touch targets are large enough', async ({ page }) => {
    await page.goto('/');
    for (const tab of await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab').all()) {
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    for (const name of ['Open settings', 'Toggle theme', 'Copy content', 'Clear editor']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(36);
      expect(box!.width).toBeGreaterThanOrEqual(36);
    }
  });

  test('declares viewport-fit=cover so the tab bar clears the home indicator', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  });
});
