import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { editor, review } from './helpers/editor';
import { MAX_IGNORED_RULES, buildIgnoreLines, isRuleName, parseStoredIgnoredRules } from '../lib/ignored-rules';
import { buildValeIni } from '../lib/vale-config';
import { EMPTY_VOCABULARY } from '../types/vocabulary';

const IGNORED_KEY = 'verbalize:ignored-rules:v1';
const DOC = 'We deployed kubernetes with kubectl. Please utilize it in order to recieve the file. This is extremely good.';

const alertCard = (page: Page, check: string): Locator => page.getByTestId('alert-card').filter({ hasText: check });
const ignoredList = (page: Page): Locator => page.getByTestId('ignored-rules');
const toasts = (page: Page): Locator => page.getByTestId('toasts');

async function checks(page: Page): Promise<string[]> {
  return page.getByTestId('alert-card').evaluateAll((cards) =>
    cards.map((card) => card.querySelector('span.truncate')?.textContent ?? '')
  );
}

async function reviewed(page: Page): Promise<void> {
  await page.goto('/');
  await review(page, DOC);
  await expect(alertCard(page, 'Google.We').first()).toBeVisible();
}

async function lint(
  request: import('@playwright/test').APIRequestContext,
  overrides: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const response = await request.post('/api/lint', { data: { text: DOC, style: 'Google', ...overrides } });
  return { status: response.status(), body: await response.json() };
}

function checksOf(body: unknown): string[] {
  return [...new Set((body as Array<{ Check: string }>).map((alert) => alert.Check))].sort();
}

test.describe('the rule names', () => {
  test('only Style.Rule names are accepted, and never anything that could add a line to the ini', () => {
    for (const valid of ['Google.We', 'Vale.Spelling', 'Custom.1-rule', 'RedHat.TermsErrors', 'Custom.a_b-c']) {
      expect(isRuleName(valid), valid).toBe(true);
    }
    const invalid = [
      'Google',
      'Google.',
      '.We',
      'Google.We = NO',
      ' Google.We',
      'Google.We\n[*.md]\nBasedOnStyles = Microsoft',
      'Google.We\r',
      'Google.We;x',
      'Google.We#x',
      'Google.We]',
      'Google.a.b',
      '1Google.We',
      `${'a'.repeat(100)}.We`,
      '',
      5,
      null,
    ];
    for (const value of invalid) expect(isRuleName(value), String(value)).toBe(false);
  });

  test('stored rules are validated again when they are read', () => {
    expect(parseStoredIgnoredRules(null)).toBeNull();
    expect(parseStoredIgnoredRules('not json')).toBeNull();
    expect(parseStoredIgnoredRules('{"a":1}')).toBeNull();
    expect(parseStoredIgnoredRules('[]')).toBeNull();
    expect(parseStoredIgnoredRules('["Google.We","bad\\nrule",5,"Google.We","Vale.Spelling"]')).toEqual(['Google.We', 'Vale.Spelling']);
    const many = JSON.stringify(Array.from({ length: MAX_IGNORED_RULES + 20 }, (_, i) => `Google.R${i}`));
    expect(parseStoredIgnoredRules(many)).toHaveLength(MAX_IGNORED_RULES);
  });

  test('the .vale.ini puts the ignored rules last, without repeating them', () => {
    const ini = buildValeIni({
      stylesPath: '/tmp/styles',
      style: 'Google',
      format: 'markdown',
      hasCustomRules: false,
      vocabulary: { ...EMPTY_VOCABULARY, spelling: true },
      ignoredRules: ['Google.We', 'Vale.Spelling', 'Google.We'],
    });
    const lines = ini.trim().split('\n');
    expect(lines.slice(-2)).toEqual(['Google.We = NO', 'Vale.Spelling = NO']);
    expect(lines.filter((line) => line === 'Google.We = NO')).toHaveLength(1);
    // nothing else changes without ignored rules
    expect(buildValeIni({ stylesPath: '/tmp/styles', style: 'Google', format: 'markdown', hasCustomRules: false, vocabulary: EMPTY_VOCABULARY })).not.toContain('= NO');
    expect(buildIgnoreLines([])).toEqual([]);
  });
});

test.describe('POST /api/lint with ignoredRules', () => {
  test('switches the listed rules off and keeps every other alert', async ({ request }) => {
    const all = await lint(request, {});
    expect(all.status).toBe(200);
    expect(checksOf(all.body)).toContain('Google.We');

    const without = await lint(request, { ignoredRules: ['Google.We'] });
    expect(without.status).toBe(200);
    expect(checksOf(without.body)).toEqual(checksOf(all.body).filter((check) => check !== 'Google.We'));
  });

  test('repeated and unknown rules are harmless', async ({ request }) => {
    const all = await lint(request, {});
    const result = await lint(request, { ignoredRules: ['Google.We', 'Google.We', 'Nope.Nothing', 'Microsoft.Contractions'] });
    expect(result.status).toBe(200);
    expect(checksOf(result.body)).toEqual(checksOf(all.body).filter((check) => check !== 'Google.We'));
  });

  test('an ignored rule stays off even when something else would switch it on', async ({ request }) => {
    const vocabulary = { accept: [], reject: [], spelling: true, enforceCase: true };
    const spelled = await lint(request, { vocabulary });
    expect(checksOf(spelled.body)).toContain('Vale.Spelling');

    const ignored = await lint(request, { vocabulary, ignoredRules: ['Vale.Spelling'] });
    expect(ignored.status).toBe(200);
    expect(checksOf(ignored.body)).not.toContain('Vale.Spelling');
  });

  test('refuses anything that is not a list of Style.Rule names, instead of cleaning it up', async ({ request }) => {
    // The first one would add a section to the .vale.ini and change which styles Vale applies
    const attempts: unknown[] = [
      ['Google.We\n[*.md]\nBasedOnStyles = Microsoft'],
      ['Google.We = NO'],
      [' Google.We'],
      ['Google'],
      [`${'a'.repeat(100)}.We`],
      [5],
      [null],
      'Google.We',
      { rule: 'Google.We' },
    ];
    for (const ignoredRules of attempts) {
      const result = await lint(request, { ignoredRules });
      expect(result.status, JSON.stringify(ignoredRules)).toBe(400);
      expect((result.body as { code: string }).code).toBe('ignored_rules_invalid');
    }
  });

  test('limits the list, and accepts exactly the limit', async ({ request }) => {
    const rules = (count: number): string[] => Array.from({ length: count }, (_, i) => `Google.R${i}`);

    const tooMany = await lint(request, { ignoredRules: rules(MAX_IGNORED_RULES + 1) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toMatchObject({ code: 'ignored_rules_too_many', params: { max: MAX_IGNORED_RULES } });

    const exact = await lint(request, { ignoredRules: rules(MAX_IGNORED_RULES) });
    expect(exact.status).toBe(200);
  });

  test('is optional', async ({ request }) => {
    for (const ignoredRules of [undefined, null, []]) {
      expect((await lint(request, { ignoredRules })).status).toBe(200);
    }
  });
});

test.describe('ignoring a rule from the alerts', () => {
  test('the card button hides the alerts of that rule at once and keeps the review current', async ({ page }) => {
    await reviewed(page);
    const before = await checks(page);
    expect(before.filter((check) => check === 'Google.We').length).toBeGreaterThan(0);
    expect(new Set(before).size).toBeGreaterThan(1);

    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();

    const after = await checks(page);
    expect(after).toEqual(before.filter((check) => check !== 'Google.We'));
    // the other alerts are not marked out of date: the review is exactly what a new one would give
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
    await expect(toasts(page)).toContainText('Google.We is now ignored');
    await expect(ignoredList(page)).toContainText('Google.We');
    await expect(page.getByTestId('ignored-summary')).toHaveText('1 rule ignored');
  });

  test('a new review sends the ignored rules and does not report them', async ({ page }) => {
    await reviewed(page);
    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();

    const request = page.waitForRequest('**/api/lint');
    await editor(page).press('Control+Enter');
    expect((await request).postDataJSON().ignoredRules).toEqual(['Google.We']);
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
    expect(await checks(page)).not.toContain('Google.We');
    expect((await checks(page)).length).toBeGreaterThan(0);
  });

  test('Undo brings the alerts and their underlines back', async ({ page }) => {
    await reviewed(page);
    const before = await checks(page);
    const underlines = await page.locator('.cm-lintRange').count();
    expect(underlines).toBeGreaterThan(0);

    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();
    await expect.poll(() => page.locator('.cm-lintRange').count()).toBeLessThan(underlines);

    await toasts(page).getByRole('button', { name: 'Undo' }).click();
    expect(await checks(page)).toEqual(before);
    await expect.poll(() => page.locator('.cm-lintRange').count()).toBe(underlines);
    await expect(ignoredList(page)).toContainText('No rules ignored');
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
  });

  test('stopping to ignore a rule marks the review out of date, and a new review brings the rule back', async ({ page }) => {
    await reviewed(page);
    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();

    await ignoredList(page).getByRole('button', { name: 'Stop ignoring Google.We' }).click();
    await expect(ignoredList(page)).toContainText('No rules ignored');
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');

    await editor(page).press('Control+Enter');
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();
  });

  test('the tooltip of an underlined text offers the same action', async ({ page }) => {
    await reviewed(page);
    const before = await checks(page);

    await page.locator('.cm-lintRange').first().hover();
    const tooltip = page.locator('.cm-tooltip-lint');
    await expect(tooltip).toBeVisible();
    const rule = (await tooltip.locator('.cm-diagnosticSource').first().textContent())?.trim() ?? '';
    expect(rule).toMatch(/^[A-Za-z]+\.[A-Za-z0-9-]+$/);
    await tooltip.getByRole('button', { name: 'Ignore rule' }).first().click();

    expect(await checks(page)).toEqual(before.filter((check) => check !== rule));
    await expect(ignoredList(page)).toContainText(rule);
  });

  test('works on a card whose text was edited, because it does not depend on position', async ({ page }) => {
    await reviewed(page);
    await editor(page).click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Intro. ');
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');

    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();
    expect(await checks(page)).not.toContain('Google.We');
    // the review stays out of date: the text changed
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
  });
});

test.describe('the ignored rules in the settings', () => {
  test('are kept in this browser and restored after a reload', async ({ page }) => {
    await reviewed(page);
    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), IGNORED_KEY))
      .toBe(JSON.stringify(['Google.We']));

    await page.reload();
    await expect(ignoredList(page)).toContainText('Google.We');
    const request = page.waitForRequest('**/api/lint');
    await review(page, DOC);
    expect((await request).postDataJSON().ignoredRules).toEqual(['Google.We']);
  });

  test('turning autosave off deletes them, like the vocabulary', async ({ page }) => {
    await reviewed(page);
    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), IGNORED_KEY)).not.toBeNull();

    await page.getByLabel('Save my draft in this browser').uncheck();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), IGNORED_KEY)).toBeNull();
    // they still apply in this session
    await expect(ignoredList(page)).toContainText('Google.We');
  });

  test('stored names that are not valid rule names are ignored', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!window.sessionStorage.getItem('seeded')) {
          window.sessionStorage.setItem('seeded', '1');
          window.localStorage.setItem(key, value);
        }
      },
      [IGNORED_KEY, JSON.stringify(['Google.We', 'bad\n[*.md]', 5, 'Vale.Spelling', 'Google.We'])]
    );
    await page.goto('/');
    await expect(page.getByTestId('ignored-summary')).toHaveText('2 rules ignored');
    await expect(ignoredList(page)).toContainText('Google.We');
    await expect(ignoredList(page)).toContainText('Vale.Spelling');
    await expect(ignoredList(page)).not.toContainText('bad');
  });

  test('can be copied as .vale.ini lines', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await reviewed(page);
    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' }).click();
    const second = (await checks(page))[0];
    await alertCard(page, second).first().getByRole('button', { name: `Ignore rule ${second}` }).click();

    await ignoredList(page).getByRole('button', { name: 'Copy as .vale.ini lines' }).click();
    await expect(toasts(page)).toContainText('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`Google.We = NO\n${second} = NO`);
  });

  test('say so when there are none', async ({ page }) => {
    await page.goto('/');
    await expect(ignoredList(page)).toContainText('No rules ignored');
    await expect(ignoredList(page).getByRole('button')).toHaveCount(0);
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the button, the notice and the list are translated', async ({ page }) => {
    await page.goto('/');
    await review(page, DOC);
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();

    await alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignorar a regra Google.We' }).click();
    await expect(toasts(page)).toContainText('A regra Google.We agora é ignorada');
    await expect(toasts(page)).toContainText('alerta');
    await expect(ignoredList(page)).toContainText('Regras ignoradas');
    await expect(page.getByTestId('ignored-summary')).toHaveText('1 regra ignorada');
    await expect(ignoredList(page).getByRole('button', { name: 'Parar de ignorar a regra Google.We' })).toBeVisible();
    await expect(ignoredList(page).getByRole('button', { name: 'Copiar como linhas do .vale.ini' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the button is a comfortable touch target and works from the alerts tab', async ({ page }) => {
    await page.goto('/');
    await review(page, DOC);
    // the review takes the user to the alerts
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();

    const button = alertCard(page, 'Google.We').first().getByRole('button', { name: 'Ignore rule Google.We' });
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);

    await button.tap();
    await expect(toasts(page)).toContainText('Google.We is now ignored');
    expect(await checks(page)).not.toContain('Google.We');
  });
});
