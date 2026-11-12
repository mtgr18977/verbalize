import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { docText, editor, setText } from './helpers/editor';
import { parseDraft, parsePrefs } from '../lib/draft-storage';

const DRAFT_KEY = 'verbalize:draft:v1';
const PREFS_KEY = 'verbalize:prefs:v1';
const TEXT = '# Install\n\nWe really use this in order to test it.';
const RULE = 'extends: existence\nmessage: "Avoid using \'%s\'"\nlevel: error\ntokens:\n  - extremely\n';

async function stored(page: Page, key: string = DRAFT_KEY): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), key);
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    // a value that is not JSON (planted by a test) counts as "nothing valid stored yet"
    return null;
  }
}

/** Waits for the debounced save: the stored text becomes `text`. */
async function waitSaved(page: Page, text: string): Promise<void> {
  await expect.poll(async () => (await stored(page))?.text, { timeout: 5000 }).toBe(text);
}

/** Runs before the page's own scripts, once per context, to prepare what the browser already has stored. */
async function seed(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((data) => {
    if (window.sessionStorage.getItem('seeded')) return;
    window.sessionStorage.setItem('seeded', '1');
    for (const [key, value] of Object.entries(data)) window.localStorage.setItem(key, value);
  }, entries);
}

test.describe('saving', () => {
  test('keeps the text and brings it back after a reload', async ({ page }) => {
    await page.goto('/');
    await setText(page, TEXT);
    await waitSaved(page, TEXT);
    await expect(page.getByTestId('draft-status')).toContainText('Saved');

    await page.reload();
    await expect.poll(() => docText(page)).toBe(TEXT);
    await expect(page.getByTestId('restored-notice')).toContainText('Restored your draft');
    // the review itself is not restored: it would describe text that may have changed
    await expect(page.getByTestId('review-status')).toHaveText('Not reviewed');
  });

  test('does not save on every key press', async ({ page }) => {
    await page.goto('/');
    await editor(page).click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as { writes: number }).writes = 0;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'verbalize:draft:v1') (window as unknown as { writes: number }).writes += 1;
        return original.call(this, key, value);
      };
    });
    await page.keyboard.type('typing quickly without pausing', { delay: 10 });
    await waitSaved(page, 'typing quickly without pausing');
    const writes = await page.evaluate(() => (window as unknown as { writes: number }).writes);
    expect(writes).toBeLessThanOrEqual(2);
  });

  test('saves the uploaded rules and the chosen style guide', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"][accept=".yml"]').setInputFiles({ name: 'terms.yml', mimeType: 'text/yaml', buffer: Buffer.from(RULE) });
    await page.getByLabel('Base style guide').selectOption('Microsoft');
    await setText(page, TEXT);
    await waitSaved(page, TEXT);

    await page.reload();
    await expect(page.getByLabel('Base style guide')).toHaveValue('Microsoft');
    await expect(page.getByText('terms.yml')).toBeVisible();
  });

  test('saves right away when the page is hidden, before the delay runs out', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await page.clock.install();
    await editor(page).click();
    await page.keyboard.type('written just before leaving');
    expect(await stored(page)).toBeNull();

    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect((await stored(page))?.text).toBe('written just before leaving');
  });

  test('clearing the editor clears what is stored', async ({ page }) => {
    await page.goto('/');
    await setText(page, TEXT);
    await waitSaved(page, TEXT);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect.poll(() => stored(page)).toBeNull();
  });
});

test.describe('restoring', () => {
  test('never overwrites a stored draft with the empty editor of a fresh load', async ({ page }) => {
    await seed(page, { [DRAFT_KEY]: JSON.stringify({ text: 'precious words', customRules: [], savedAt: Date.now() }) });
    await page.goto('/');
    await expect.poll(() => docText(page)).toBe('precious words');
    // wait longer than the save delay, then check nothing replaced the draft
    await page.waitForTimeout(1500);
    expect((await stored(page))?.text).toBe('precious words');
  });

  test('restoring does not rewrite the draft, so it keeps its original time', async ({ page }) => {
    const savedAt = new Date('2023-11-14T12:00:00Z').getTime();
    await seed(page, { [DRAFT_KEY]: JSON.stringify({ text: TEXT, customRules: [], savedAt }) });
    await page.goto('/');
    await expect.poll(() => docText(page)).toBe(TEXT);
    await page.waitForTimeout(1500);

    expect((await stored(page))?.savedAt).toBe(savedAt);
    await expect(page.getByTestId('restored-notice')).toContainText('2023');
    await expect(page.getByTestId('draft-status')).toContainText('Saved');

    await page.reload();
    await expect(page.getByTestId('restored-notice')).toContainText('2023');
  });

  test('restores without hydration errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await seed(page, { [DRAFT_KEY]: JSON.stringify({ text: TEXT, customRules: [], savedAt: Date.now() }) });
    await page.goto('/');
    await expect.poll(() => docText(page)).toBe(TEXT);
    expect(problems).toEqual([]);
  });

  test('"Start fresh" needs a second click and then empties everything', async ({ page }) => {
    await seed(page, { [DRAFT_KEY]: JSON.stringify({ text: TEXT, customRules: [{ name: 'terms.yml', content: RULE }], savedAt: Date.now() }) });
    await page.goto('/');
    const notice = page.getByTestId('restored-notice');
    await expect(notice).toBeVisible();

    await notice.getByRole('button', { name: 'Start fresh' }).click();
    await expect(notice.getByRole('button', { name: 'Click again to discard' })).toBeVisible();
    expect(await docText(page)).toBe(TEXT);

    await notice.getByRole('button', { name: 'Click again to discard' }).click();
    await expect(notice).toBeHidden();
    expect(await docText(page)).toBe('');
    await expect(page.getByText('terms.yml')).toHaveCount(0);
    await expect.poll(() => stored(page)).toBeNull();
  });

  test('the notice goes away once you start editing, or when dismissed', async ({ page }) => {
    await seed(page, { [DRAFT_KEY]: JSON.stringify({ text: TEXT, customRules: [], savedAt: Date.now() }) });
    await page.goto('/');
    const notice = page.getByTestId('restored-notice');
    await expect(notice).toBeVisible();

    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' More.');
    await expect(notice).toBeHidden();

    await page.reload();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toBeHidden();
    expect(await docText(page)).toContain('More.');
  });

  test('ignores data it cannot read instead of failing', async ({ page }) => {
    await seed(page, { [DRAFT_KEY]: '{not json', [PREFS_KEY]: '[1,2,3]' });
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    expect(await docText(page)).toBe('');
    await expect(page.getByTestId('restored-notice')).toHaveCount(0);

    await setText(page, 'still works');
    await waitSaved(page, 'still works');
  });
});

test.describe('privacy switch', () => {
  test('turning it off deletes the draft, stops saving, and is remembered', async ({ page }) => {
    await page.goto('/');
    await setText(page, TEXT);
    await waitSaved(page, TEXT);

    await page.getByLabel(/Save my draft in this browser/).uncheck();
    await expect.poll(() => stored(page)).toBeNull();
    await expect(page.getByTestId('draft-status')).toHaveText('Autosave off');

    await setText(page, 'not to be stored');
    await page.waitForTimeout(1200);
    expect(await stored(page)).toBeNull();

    await page.reload();
    await expect(editor(page)).toBeVisible();
    expect(await docText(page)).toBe('');
    await expect(page.getByLabel(/Save my draft in this browser/)).not.toBeChecked();
    await expect(page.getByTestId('draft-status')).toHaveText('Autosave off');
  });

  test('turning it back on saves again', async ({ page }) => {
    await seed(page, { [PREFS_KEY]: JSON.stringify({ autosave: false, style: null }) });
    await page.goto('/');
    await setText(page, 'now saved');
    await page.waitForTimeout(1000);
    expect(await stored(page)).toBeNull();

    await page.getByLabel(/Save my draft in this browser/).check();
    await waitSaved(page, 'now saved');
  });

  test('a draft saved before it was turned off is not restored', async ({ page }) => {
    await seed(page, {
      [DRAFT_KEY]: JSON.stringify({ text: 'old draft', customRules: [], savedAt: Date.now() }),
      [PREFS_KEY]: JSON.stringify({ autosave: false, style: null }),
    });
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    expect(await docText(page)).toBe('');
  });
});

test.describe('when the browser refuses storage', () => {
  test('the editor keeps working and the status says the draft is not saved', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      };
    });
    await page.goto('/');
    await setText(page, TEXT);
    await expect(page.getByTestId('draft-status')).toHaveText('Not saved', { timeout: 5000 });
    expect(await docText(page)).toBe(TEXT);

    await editor(page).press('Control+Enter');
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
  });

  test('reading blocked storage does not break the page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new DOMException('Blocked', 'SecurityError');
      };
    });
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await setText(page, 'hello');
    expect(await docText(page)).toBe('hello');
    expect(errors).toEqual([]);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the status and the notice fit the screen', async ({ page }) => {
    await seed(page, { [DRAFT_KEY]: JSON.stringify({ text: TEXT, customRules: [], savedAt: Date.now() }) });
    await page.goto('/');
    await expect(page.getByTestId('restored-notice')).toBeVisible();
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' x');
    await expect(page.getByTestId('draft-status')).toContainText('Saved');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const status = await page.getByTestId('draft-status').boundingBox();
    expect(status!.x + status!.width).toBeLessThanOrEqual(390);
  });
});

test.describe('reading what is stored', () => {
  test('parseDraft accepts what it wrote and rejects the rest', () => {
    const good = parseDraft(JSON.stringify({ text: 'a', customRules: [{ name: 'r.yml', content: 'x' }], savedAt: 5 }));
    expect(good).toEqual({ text: 'a', customRules: [{ name: 'r.yml', content: 'x' }], savedAt: 5 });

    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('')).toBeNull();
    expect(parseDraft('nope')).toBeNull();
    expect(parseDraft('[]')).toBeNull();
    expect(parseDraft(JSON.stringify({ text: 42 }))).toBeNull();
  });

  test('parseDraft drops malformed or oversized rules and caps their number', () => {
    const rules = [
      { name: 'ok.yml', content: 'x' },
      { name: 1, content: 'x' },
      { name: 'big.yml', content: 'y'.repeat(10 * 1024 + 1) },
      null,
      ...Array.from({ length: 20 }, (_, i) => ({ name: `r${i}.yml`, content: 'x' })),
    ];
    const draft = parseDraft(JSON.stringify({ text: 't', customRules: rules }));
    expect(draft?.customRules).toHaveLength(10);
    expect(draft?.customRules[0].name).toBe('ok.yml');
    expect(draft?.customRules.every((rule) => typeof rule.name === 'string' && rule.content.length <= 10 * 1024)).toBe(true);
  });

  test('parsePrefs defaults to autosave on', () => {
    expect(parsePrefs(null)).toEqual({ autosave: true, style: null });
    expect(parsePrefs('garbage')).toEqual({ autosave: true, style: null });
    expect(parsePrefs('[1]')).toEqual({ autosave: true, style: null });
    expect(parsePrefs(JSON.stringify({ autosave: false, style: 'RedHat' }))).toEqual({ autosave: false, style: 'RedHat' });
    expect(parsePrefs(JSON.stringify({ style: 3 }))).toEqual({ autosave: true, style: null });
  });
});
