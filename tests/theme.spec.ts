import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editor, setText } from './helpers/editor';

const WITH_ALERTS = 'We really use this in order to test it.\nThe file was deleted by the user.';

/** WCAG contrast ratio between two computed `rgb(...)` colors. */
function contrast(a: string, b: string): number {
  const luminance = (rgb: string): number => {
    const [r, g, bl] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

async function color(page: Page, selector: string, property: 'color' | 'backgroundColor'): Promise<string> {
  return page.locator(selector).first().evaluate((el, prop) => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(el)[prop as 'color'];
    document.body.appendChild(probe);
    // Resolve modern color functions (lab, oklch) to rgb through a canvas
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = probe.style.color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    probe.remove();
    return `rgb(${r}, ${g}, ${b})`;
  }, property);
}

test.describe('Diagnóstico theme', () => {
  test('uses the Verbalize brand and no longer shows a fake "Live" badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('verbalize');
    await expect(page.getByText(/live editor/i)).toHaveCount(0);
    await expect(page.getByTestId('review-status')).toHaveText('Not reviewed');
  });

  test('status text follows the real state of the review', async ({ page }) => {
    await page.goto('/');
    await setText(page, WITH_ALERTS);
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('review-status')).toHaveText(/^Reviewed at/);
    await setText(page, WITH_ALERTS + ' Edited.');
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
  });

  test('alerts read like compiler diagnostics: rule, position, excerpt and pointer', async ({ page }) => {
    await page.goto('/');
    await setText(page, WITH_ALERTS);
    await page.keyboard.press('Control+Enter');
    const card = page.getByTestId('alert-card').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toContainText('Google.We');
    await expect(card).toContainText('L1:1');
    await expect(card.locator('pre')).toContainText('1 │ We really use this');
    await expect(card.locator('pre')).toContainText('^^');
  });

  test('severity is also encoded by underline shape, not only by color', async ({ page }) => {
    await page.goto('/');
    await setText(page, 'We really use this in order to test it.\nThe file was deleted by the user.');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });

    const styles = await page.getByTestId('alert-card').evaluateAll((cards) =>
      cards.map((card) => {
        const label = card.querySelector('span') as HTMLElement;
        return { severity: card.getAttribute('data-severity'), line: getComputedStyle(label).textDecorationStyle };
      })
    );
    const byShape: Record<string, string> = { warning: 'dashed', suggestion: 'dotted', error: 'wavy' };
    for (const item of styles) {
      expect(item.line).toBe(byShape[item.severity ?? '']);
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${scheme} mode`, () => {
      test.use({ colorScheme: scheme });

      test('primary text and secondary text meet WCAG AA on their surfaces', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        const sheet = await color(page, 'section', 'backgroundColor');
        const ink = await color(page, '.cm-content', 'color');
        const secondary = await color(page, 'header span[data-testid="review-status"]', 'color').catch(() => ink);
        expect(contrast(ink, sheet)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(secondary, await color(page, 'header', 'backgroundColor'))).toBeGreaterThanOrEqual(4.5);
      });

      test('Run Linting button text is readable on the accent', async ({ page }) => {
        await page.goto('/');
        const button = 'header button[title^="Run Linting"]';
        expect(contrast(await color(page, button, 'color'), await color(page, button, 'backgroundColor'))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  test('interface and editor use Atkinson Hyperlegible, not the template font', async ({ page }) => {
    await page.goto('/');
    // CodeMirror mounts after hydration
    await expect(editor(page)).toBeVisible();
    const fonts = await page.evaluate(() => ({
      ui: getComputedStyle(document.body).fontFamily,
      editor: getComputedStyle(document.querySelector('.cm-content') as Element).fontFamily,
    }));
    expect(fonts.ui).toContain('Atkinson Hyperlegible Next');
    expect(fonts.editor).toContain('Atkinson Hyperlegible Mono');
    expect(fonts.ui).not.toContain('Geist');
  });
});
