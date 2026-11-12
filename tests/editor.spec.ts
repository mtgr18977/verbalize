import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { docText, editor, review } from './helpers/editor';
import { createTranslator } from '../i18n/translate';
import { describeFix, getFixes } from '../lib/vale-fixes';
import { safeHttpUrl } from '../lib/safe-url';

const DOC = '# Install.\n\nWe really use this in order to test it.\nThe file was deleted by the user.';

async function reviewed(page: Page, text: string = DOC): Promise<void> {
  await page.goto('/');
  await review(page, text);
  await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.cm-lintRange').first()).toBeVisible();
}

function wordList(page: Page): ReturnType<Page['locator']> {
  return page.getByTestId('alert-card').filter({ hasText: 'Google.WordList' });
}

test.describe('editor basics', () => {
  test('is an accessible multiline text box, with line numbers and a placeholder', async ({ page }) => {
    await page.goto('/');
    const box = editor(page);
    await expect(box).toHaveAttribute('aria-multiline', 'true');
    await expect(box).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator('.cm-placeholder')).toContainText('Start typing your documentation');

    await box.fill('one\ntwo\nthree');
    await expect(page.locator('.cm-lineNumbers')).toContainText('3');
  });

  test('Ctrl+Enter runs the review and does not insert a line', async ({ page }) => {
    await reviewed(page);
    expect(await docText(page)).toBe(DOC);
  });

  test('highlights Markdown: headings are bold', async ({ page }) => {
    await page.goto('/');
    await editor(page).fill('# A heading\n\nplain text');
    const weight = await page.locator('.cm-line').first().locator('span').first().evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(weight)).toBeGreaterThanOrEqual(700);
  });

  test('typing, undo and redo work', async ({ page }) => {
    await page.goto('/');
    await editor(page).click();
    await page.keyboard.type('hello');
    await page.keyboard.press('Control+z');
    expect(await docText(page)).toBe('');
    await page.keyboard.press('Control+Shift+z');
    expect(await docText(page)).toBe('hello');
  });

  test('text from outside (clear editor) replaces the document', async ({ page }) => {
    await page.goto('/');
    await editor(page).fill('something');
    await page.getByRole('button', { name: 'Clear editor' }).click();
    expect(await docText(page)).toBe('');
  });
});

test.describe('alerts in the text', () => {
  test('are underlined with a different shape per severity', async ({ page }) => {
    await reviewed(page);
    const shapes = await page.locator('.cm-lintRange').evaluateAll((marks) =>
      marks.map((mark) => ({ cls: mark.className, style: getComputedStyle(mark).textDecorationStyle, image: getComputedStyle(mark).backgroundImage }))
    );
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    for (const mark of shapes) {
      expect(mark.image).toBe('none');
      if (mark.cls.includes('cm-lintRange-warning')) expect(mark.style).toBe('dashed');
      if (mark.cls.includes('cm-lintRange-info')) expect(mark.style).toBe('dotted');
      if (mark.cls.includes('cm-lintRange-error')) expect(mark.style).toBe('wavy');
    }
  });

  test('hovering shows the rule, the message and a one-click fix', async ({ page }) => {
    await reviewed(page);
    await page.locator('.cm-lintRange-warning', { hasText: 'in order to' }).hover();
    const tooltip = page.locator('.cm-tooltip-lint');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Google.WordList');
    await expect(tooltip).toContainText("Use 'to' instead of 'in order to'.");
    await expect(tooltip.getByRole('button', { name: 'Replace with “to”' })).toBeVisible();
  });

  test('the tooltip fix edits the text and resolves the alert', async ({ page }) => {
    await reviewed(page);
    await page.locator('.cm-lintRange-warning', { hasText: 'in order to' }).hover();
    await page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Replace with “to”' }).click();

    expect(await docText(page)).toContain('We really use this to test it.');
    await expect(wordList(page)).toHaveCount(0);
    await expect(page.locator('.cm-lintRange', { hasText: 'in order to' })).toHaveCount(0);
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
  });

  test('the panel offers the same fix, and undo brings the text back', async ({ page }) => {
    await reviewed(page);
    await wordList(page).getByRole('button', { name: 'Replace with “to”' }).click();
    expect(await docText(page)).toContain('We really use this to test it.');
    await expect(wordList(page)).toHaveCount(0);

    await editor(page).click();
    await page.keyboard.press('Control+z');
    expect(await docText(page)).toBe(DOC);
  });

  test('keep their place when text is added above them', async ({ page }) => {
    await reviewed(page);
    await expect(wordList(page)).toContainText('L3:20');

    await editor(page).click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Enter');

    // the underline still wraps the same words and the card shows the new line, not "text edited"
    await expect(page.locator('.cm-lintRange', { hasText: 'in order to' })).toHaveCount(1);
    await expect(wordList(page)).toContainText('L4:20');
    await expect(wordList(page)).not.toContainText('text edited');
    await expect(wordList(page).getByRole('button', { name: 'Replace with “to”' })).toBeVisible();
  });

  test('stop being underlined when their own text is edited', async ({ page }) => {
    await reviewed(page);
    await wordList(page).click();
    await page.keyboard.type('x');

    await expect(page.locator('.cm-lintRange', { hasText: 'in order to' })).toHaveCount(0);
    await expect(wordList(page)).toContainText('text edited');
    // no fix is offered for text that moved; ignoring the rule does not depend on position
    await expect(wordList(page).getByRole('button')).toHaveCount(1);
    await expect(wordList(page).getByRole('button')).toHaveText('Ignore rule');
    // alerts elsewhere in the text are untouched
    await expect(page.locator('.cm-lintRange', { hasText: 'was deleted' })).toHaveCount(1);
  });

  test('are not shown when the text changed while the review was running', async ({ page }) => {
    await page.goto('/');
    await editor(page).fill(DOC);
    await page.route('**/api/lint', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await editor(page).fill(DOC + ' Typed while waiting.');
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.cm-lintRange')).toHaveCount(0);
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
  });

  test('F8 moves to the next alert from the keyboard', async ({ page }) => {
    await reviewed(page);
    await editor(page).click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('F8');
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected.length).toBeGreaterThan(0);
  });

  test('replacing the whole text from a file clears the underlines of the old one', async ({ page }) => {
    await reviewed(page);
    await expect(page.locator('.cm-lintRange').first()).toBeVisible();

    await page.locator('input[type="file"]:not([accept=".yml"]):not([accept*="txt"])').first().setInputFiles({
      name: 'other.md',
      mimeType: 'text/plain',
      buffer: Buffer.from('Completely new words.\n'),
    });
    await expect.poll(() => docText(page)).toBe('Completely new words.\n');
    await expect(page.locator('.cm-lintRange')).toHaveCount(0);
    await expect(page.getByText('text edited').first()).toBeVisible();
  });

  test('a new review replaces the underlines', async ({ page }) => {
    await reviewed(page);
    await editor(page).fill('Install the package.');
    await editor(page).press('Control+Enter');
    await expect(page.getByText('No alerts in 1 line')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.cm-lintRange')).toHaveCount(0);
  });
});

test.describe('fixes derived from Vale actions', () => {
  test('replace offers up to four suggestions', () => {
    const fixes = getFixes({ Name: 'replace', Params: ['a', 'b', 'c', 'd', 'e'] });
    expect(fixes.map((fix) => [fix.kind, fix.value])).toEqual([
      ['replace', 'a'],
      ['replace', 'b'],
      ['replace', 'c'],
      ['replace', 'd'],
    ]);
    expect(fixes[1].apply('anything')).toBe('b');
  });

  test('remove, trim and regex edits', () => {
    expect(getFixes({ Name: 'remove', Params: null })[0].apply('very')).toBe('');
    expect(getFixes({ Name: 'edit', Params: ['trim_right', '.'] })[0].apply('g.')).toBe('g');
    expect(getFixes({ Name: 'edit', Params: ['trim_left', '-'] })[0].apply('--x')).toBe('x');
    expect(getFixes({ Name: 'edit', Params: ['regex', '(\\w+)(\\s\\w+)', '$1'] })[0].apply('Utilize Utilize')).toBe('Utilize');
  });

  test('actions that cannot be applied are not offered', () => {
    expect(getFixes({ Name: '', Params: null })).toEqual([]);
    expect(getFixes({ Name: 'suggest', Params: ['x'] })).toEqual([]);
    expect(getFixes({ Name: 'edit', Params: ['swap', 'a', 'b'] })).toEqual([]);
    expect(getFixes({ Name: 'edit', Params: ['regex', '(unclosed', 'x'] })).toEqual([]);
    expect(getFixes(null)).toEqual([]);
  });

  test('fixes are worded in the interface language', () => {
    const en = createTranslator('en');
    const pt = createTranslator('pt-BR');
    const [replace] = getFixes({ Name: 'replace', Params: ['to'] });
    const [trim] = getFixes({ Name: 'edit', Params: ['trim_right', '.'] });
    const [remove] = getFixes({ Name: 'remove', Params: null });
    const [regex] = getFixes({ Name: 'edit', Params: ['regex', 'a', 'b'] });

    expect([replace, trim, remove, regex].map((fix) => describeFix(fix, en))).toEqual([
      'Replace with “to”',
      'Trim “.”',
      'Remove',
      'Apply suggested edit',
    ]);
    expect([replace, trim, remove, regex].map((fix) => describeFix(fix, pt))).toEqual([
      'Substituir por “to”',
      'Remover “.”',
      'Remover',
      'Aplicar a edição sugerida',
    ]);
  });
});

test.describe('links from rule files', () => {
  test('only http and https links are rendered', () => {
    expect(safeHttpUrl('https://developers.google.com/style')).toBe('https://developers.google.com/style');
    expect(safeHttpUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});
