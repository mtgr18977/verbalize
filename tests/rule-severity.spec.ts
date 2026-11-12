import { test, expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { editor, review } from './helpers/editor';
import { MAX_SEVERITY_OVERRIDES, buildSeverityLines, isRuleSeverity, parseStoredSeverities } from '../lib/rule-severity';
import { buildValeIni } from '../lib/vale-config';
import { EMPTY_VOCABULARY } from '../types/vocabulary';

const SEVERITIES_KEY = 'verbalize:rule-severities:v1';
const DOC = 'We deployed kubernetes with kubectl. Please utilize it in order to recieve the file. This is extremely good.';

const alertCard = (page: Page, check: string): Locator => page.getByTestId('alert-card').filter({ hasText: check });
const severityList = (page: Page): Locator => page.getByTestId('rule-severities');
const cardSelect = (page: Page, rule: string): Locator => alertCard(page, rule).first().getByRole('combobox', { name: `Severity of ${rule}` });
const toasts = (page: Page): Locator => page.getByTestId('toasts');

async function reviewed(page: Page): Promise<void> {
  await page.goto('/');
  await review(page, DOC);
  await expect(alertCard(page, 'Google.We').first()).toBeVisible();
}

async function severitiesOf(page: Page, check: string): Promise<string[]> {
  return alertCard(page, check).evaluateAll((cards) => cards.map((card) => card.getAttribute('data-severity') ?? ''));
}

async function lint(
  request: APIRequestContext,
  overrides: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const response = await request.post('/api/lint', { data: { text: DOC, style: 'Google', ...overrides } });
  return { status: response.status(), body: await response.json() };
}

type ApiAlert = { Check: string; Severity: string };
const alertsOf = (body: unknown, check: string): ApiAlert[] => (body as ApiAlert[]).filter((alert) => alert.Check === check);

test.describe('the severity values', () => {
  test('only the three severities are valid, and never in another capitalization', () => {
    for (const value of ['error', 'warning', 'suggestion']) expect(isRuleSeverity(value), value).toBe(true);
    // Vale does not complain about these: it switches the rule off
    for (const value of ['Error', 'WARNING', 'NO', 'bogus', '', 'error\n[*.md]', 5, null]) expect(isRuleSeverity(value), String(value)).toBe(false);
  });

  test('stored severities are validated again when they are read', () => {
    expect(parseStoredSeverities(null)).toBeNull();
    expect(parseStoredSeverities('nope')).toBeNull();
    expect(parseStoredSeverities('[]')).toBeNull();
    expect(parseStoredSeverities('{}')).toBeNull();
    expect(
      parseStoredSeverities(JSON.stringify({ 'Google.We': 'error', 'bad\nrule': 'error', 'Google.Foo': 'Error', 'Vale.Terms': 'suggestion', 'Google.Bar': 5 }))
    ).toEqual({ 'Google.We': 'error', 'Vale.Terms': 'suggestion' });
    const many = Object.fromEntries(Array.from({ length: MAX_SEVERITY_OVERRIDES + 20 }, (_, i) => [`Google.R${i}`, 'warning']));
    expect(Object.keys(parseStoredSeverities(JSON.stringify(many)) ?? {})).toHaveLength(MAX_SEVERITY_OVERRIDES);
  });

  test('the lines are written for the styles that are active only', () => {
    const overrides = { 'Google.We': 'error', 'Microsoft.We': 'warning', 'Vale.Spelling': 'error', 'Custom.mine': 'suggestion' } as const;
    expect(buildSeverityLines(overrides)).toHaveLength(4);
    expect(buildSeverityLines(overrides, ['Google', 'Custom'])).toEqual(['Google.We = error', 'Custom.mine = suggestion']);
  });
});

test.describe('the .vale.ini of a request', () => {
  const base = { stylesPath: '/tmp/styles', style: 'Google', format: 'markdown', hasCustomRules: false } as const;

  test('every line that switches a rule off comes before the severities: Vale keeps the first line of a key', () => {
    const ini = buildValeIni({
      ...base,
      vocabulary: { ...EMPTY_VOCABULARY, accept: ['Kubernetes'] },
      ignoredRules: ['Google.Foo', 'Google.We'],
      severities: { 'Google.We': 'error', 'Vale.Spelling': 'error', 'Google.Bar': 'warning' },
    });
    const lines = ini.trim().split('\n');
    const at = (line: string): number => lines.indexOf(line);
    // Vale.Spelling is switched off by Verbalize here (spelling not asked for): the severity must not win
    expect(at('Vale.Spelling = NO')).toBeGreaterThan(-1);
    expect(at('Vale.Spelling = NO')).toBeLessThan(at('Vale.Spelling = error'));
    // an ignored rule stays off whatever severity it was given
    expect(at('Google.We = NO')).toBeLessThan(at('Google.We = error'));
    expect(at('Vale.Repetition = NO')).toBeLessThan(at('Google.Bar = warning'));
    // the severities close the file
    expect(lines.slice(-3)).toEqual(['Google.We = error', 'Vale.Spelling = error', 'Google.Bar = warning']);
  });

  test('a severity for a style that is not active is left out, because Vale would switch the rule on', () => {
    const ini = buildValeIni({
      ...base,
      vocabulary: EMPTY_VOCABULARY,
      severities: { 'Microsoft.We': 'error', 'Vale.Spelling': 'error', 'Custom.mine': 'warning', 'Google.We': 'warning' },
    });
    expect(ini).toContain('Google.We = warning');
    expect(ini).not.toContain('Microsoft.We');
    expect(ini).not.toContain('Vale.Spelling');
    expect(ini).not.toContain('Custom.mine');
  });

  test('is unchanged without severities', () => {
    expect(buildValeIni({ ...base, vocabulary: EMPTY_VOCABULARY })).toBe(
      buildValeIni({ ...base, vocabulary: EMPTY_VOCABULARY, severities: {}, ignoredRules: [] })
    );
  });
});

test.describe('POST /api/lint with severities', () => {
  test('raises and lowers the severity of a rule, and leaves the others alone', async ({ request }) => {
    const plain = await lint(request, {});
    expect(alertsOf(plain.body, 'Google.We').length).toBeGreaterThan(0);
    const otherBefore = (plain.body as ApiAlert[]).filter((alert) => alert.Check !== 'Google.We').map((alert) => alert.Severity);

    for (const level of ['error', 'warning', 'suggestion']) {
      const result = await lint(request, { severities: { 'Google.We': level } });
      expect(result.status).toBe(200);
      const we = alertsOf(result.body, 'Google.We');
      expect(we.length, level).toBe(alertsOf(plain.body, 'Google.We').length);
      expect(new Set(we.map((alert) => alert.Severity))).toEqual(new Set([level]));
      expect((result.body as ApiAlert[]).filter((alert) => alert.Check !== 'Google.We').map((alert) => alert.Severity)).toEqual(otherBefore);
    }
  });

  test('cannot switch on a rule of a style that is not active', async ({ request }) => {
    // Without the guard, Vale applies Microsoft.We just because a line mentions it
    const result = await lint(request, { severities: { 'Microsoft.We': 'error', 'Microsoft.Contractions': 'error' } });
    expect(result.status).toBe(200);
    expect((result.body as ApiAlert[]).filter((alert) => alert.Check.startsWith('Microsoft.'))).toEqual([]);
  });

  test('cannot bring back spelling that is off', async ({ request }) => {
    // no vocabulary at all: the built-in style is not even active
    const none = await lint(request, { severities: { 'Vale.Spelling': 'error' } });
    expect(alertsOf(none.body, 'Vale.Spelling')).toEqual([]);

    // the built-in style is active (there are accepted terms) but spelling was not asked for
    const vocabulary = { accept: ['Kubernetes'], reject: [], spelling: false, enforceCase: true };
    const off = await lint(request, { vocabulary, severities: { 'Vale.Spelling': 'error' } });
    expect(off.status).toBe(200);
    expect(alertsOf(off.body, 'Vale.Spelling')).toEqual([]);

    // and when spelling is on, the severity applies
    const on = await lint(request, { vocabulary: { ...vocabulary, spelling: true }, severities: { 'Vale.Spelling': 'error' } });
    const spelling = alertsOf(on.body, 'Vale.Spelling');
    expect(spelling.length).toBeGreaterThan(0);
    expect(new Set(spelling.map((alert) => alert.Severity))).toEqual(new Set(['error']));
  });

  test('an ignored rule stays off whatever its severity', async ({ request }) => {
    const result = await lint(request, { severities: { 'Google.We': 'error' }, ignoredRules: ['Google.We'] });
    expect(result.status).toBe(200);
    expect(alertsOf(result.body, 'Google.We')).toEqual([]);
  });

  test('refuses what is not a map of Style.Rule to one of the three severities', async ({ request }) => {
    const attempts: unknown[] = [
      { 'Google.We': 'Error' },
      { 'Google.We': 'bogus' },
      { 'Google.We': 'NO' },
      { 'Google.We': 'error\n[*.md]\nBasedOnStyles = Microsoft' },
      { 'Google.We\n[*.md]': 'error' },
      { 'Google.We = NO': 'error' },
      { Google: 'error' },
      { 'Google.We': 5 },
      { 'Google.We': null },
      ['Google.We'],
      'Google.We',
    ];
    for (const severities of attempts) {
      const result = await lint(request, { severities });
      expect(result.status, JSON.stringify(severities)).toBe(400);
      expect((result.body as { code: string }).code).toBe('severities_invalid');
    }
  });

  test('limits the map, and accepts exactly the limit', async ({ request }) => {
    const map = (count: number): Record<string, string> =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`Google.R${i}`, 'warning']));

    const tooMany = await lint(request, { severities: map(MAX_SEVERITY_OVERRIDES + 1) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toMatchObject({ code: 'severities_too_many', params: { max: MAX_SEVERITY_OVERRIDES } });
    expect((await lint(request, { severities: map(MAX_SEVERITY_OVERRIDES) })).status).toBe(200);
  });

  test('is optional', async ({ request }) => {
    for (const severities of [undefined, null, {}]) expect((await lint(request, { severities })).status).toBe(200);
  });
});

test.describe('changing the severity of a rule from an alert', () => {
  test('the menu on a card shows the severity and changes every alert of the rule at once', async ({ page }) => {
    await reviewed(page);
    const count = await alertCard(page, 'Google.We').count();
    const underlinesBefore = await page.locator('.cm-lintRange-error').count();
    expect(await severitiesOf(page, 'Google.We')).toEqual(Array(count).fill('warning'));
    await expect(cardSelect(page, 'Google.We')).toHaveValue('warning');

    await cardSelect(page, 'Google.We').selectOption('error');

    expect(await severitiesOf(page, 'Google.We')).toEqual(Array(count).fill('error'));
    await expect(alertCard(page, 'Google.We').first()).toContainText('error');
    // the underline changes shape too: wavy is the error
    await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBe(underlinesBefore + count);
    // the same card count, and the review is exactly what a new one would give
    await expect(alertCard(page, 'Google.We')).toHaveCount(count);
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
    await expect(page.getByTestId('severity-summary')).toHaveText('1 rule with its own severity');
    await expect(severityList(page)).toContainText('Google.We');
  });

  test('clicking the menu does not jump to the text', async ({ page }) => {
    await reviewed(page);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await cardSelect(page, 'Google.We').selectOption('suggestion');
    // an alert card click would have selected the alert's text in the editor
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  });

  test('a new review sends the severities and comes back with them applied', async ({ page }) => {
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('suggestion');

    const request = page.waitForRequest('**/api/lint');
    await editor(page).press('Control+Enter');
    expect((await request).postDataJSON().severities).toEqual({ 'Google.We': 'suggestion' });
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
    const levels = await severitiesOf(page, 'Google.We');
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels)).toEqual(new Set(['suggestion']));
    await expect(cardSelect(page, 'Google.We')).toHaveValue('suggestion');
  });

  test('works on an alert whose text was edited: a severity belongs to the rule', async ({ page }) => {
    await reviewed(page);
    await editor(page).click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Intro. ');
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');

    await cardSelect(page, 'Google.We').selectOption('error');
    await expect(cardSelect(page, 'Google.We')).toHaveValue('error');
    // the review stays out of date: the text changed
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
  });

  test('the underlines keep their new shape when the language changes', async ({ page }) => {
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('error');
    await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBeGreaterThan(0);
    const wavy = await page.locator('.cm-lintRange-error').count();

    await page.getByLabel('Language / Idioma').selectOption('pt-BR');
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBe(wavy);
  });

  test('the tooltip of an underline shows the new severity as its border, not only the card', async ({ page }) => {
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('error');
    await page.locator('.cm-lintRange-error').first().hover();
    await expect(page.locator('.cm-tooltip-lint .cm-diagnostic-error')).toBeVisible();
  });
});

test.describe('the severities in the settings', () => {
  test('a menu there changes the cards too, and the reset button makes the review out of date', async ({ page }) => {
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('error');

    await severityList(page).getByRole('combobox', { name: 'Severity of Google.We' }).selectOption('suggestion');
    await expect(cardSelect(page, 'Google.We')).toHaveValue('suggestion');
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');

    await severityList(page).getByRole('button', { name: 'Use the default severity of Google.We' }).click();
    await expect(severityList(page)).toContainText('No rule has its own severity');
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');

    // the default comes back with a new review
    await editor(page).press('Control+Enter');
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
    expect(new Set(await severitiesOf(page, 'Google.We'))).toEqual(new Set(['warning']));
  });

  test('are kept in this browser and restored after a reload', async ({ page }) => {
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('error');
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), SEVERITIES_KEY))
      .toBe(JSON.stringify({ 'Google.We': 'error' }));

    await page.reload();
    await expect(page.getByTestId('severity-summary')).toHaveText('1 rule with its own severity');
    const request = page.waitForRequest('**/api/lint');
    await review(page, DOC);
    expect((await request).postDataJSON().severities).toEqual({ 'Google.We': 'error' });
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();
    expect(new Set(await severitiesOf(page, 'Google.We'))).toEqual(new Set(['error']));
  });

  test('turning autosave off deletes them, like the vocabulary', async ({ page }) => {
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('error');
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), SEVERITIES_KEY)).not.toBeNull();

    await page.getByLabel('Save my draft in this browser').uncheck();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), SEVERITIES_KEY)).toBeNull();
    await expect(severityList(page)).toContainText('Google.We');
  });

  test('stored entries that are not valid are ignored', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!window.sessionStorage.getItem('seeded')) {
          window.sessionStorage.setItem('seeded', '1');
          window.localStorage.setItem(key, value);
        }
      },
      [SEVERITIES_KEY, JSON.stringify({ 'Google.We': 'error', 'bad\n[*.md]': 'error', 'Google.Foo': 'Error', 'Google.Bar': 5 })]
    );
    await page.goto('/');
    await expect(page.getByTestId('severity-summary')).toHaveText('1 rule with its own severity');
    await expect(severityList(page)).toContainText('Google.We');
    await expect(severityList(page)).not.toContainText('bad');
    await expect(severityList(page)).not.toContainText('Google.Foo');
  });

  test('a severity kept for another style guide does nothing in this one', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!window.sessionStorage.getItem('seeded')) {
          window.sessionStorage.setItem('seeded', '1');
          window.localStorage.setItem(key, value);
        }
      },
      [SEVERITIES_KEY, JSON.stringify({ 'Microsoft.We': 'error', 'Microsoft.Contractions': 'error' })]
    );
    await page.goto('/');
    await review(page, DOC);
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();
    await expect(alertCard(page, 'Microsoft.')).toHaveCount(0);
  });

  test('are copied with the ignored rules, the ignored ones first', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await reviewed(page);
    await cardSelect(page, 'Google.We').selectOption('error');
    const other = (await page.getByTestId('alert-card').first().evaluate((card) => card.querySelector('span.truncate')?.textContent)) ?? '';
    const target = other === 'Google.We' ? 'Google.WordList' : other;
    await alertCard(page, target).first().getByRole('button', { name: `Ignore rule ${target}` }).click();

    await page.getByRole('button', { name: 'Copy as .vale.ini lines' }).click();
    await expect(toasts(page)).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${target} = NO\nGoogle.We = error`);
  });

  test('say so when there are none', async ({ page }) => {
    await page.goto('/');
    await expect(severityList(page)).toContainText('No rule has its own severity');
    await expect(severityList(page).getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy as .vale.ini lines' })).toHaveCount(0);
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the menu, the options and the list are translated', async ({ page }) => {
    await page.goto('/');
    await review(page, DOC);
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();

    const select = alertCard(page, 'Google.We').first().getByRole('combobox', { name: 'Gravidade da regra Google.We' });
    await expect(select.locator('option')).toHaveText(['erro', 'aviso', 'sugestão']);
    await select.selectOption('error');
    await expect(page.getByTestId('severity-summary')).toHaveText('1 regra com gravidade própria');
    await expect(severityList(page)).toContainText('Gravidade das regras');
    await expect(severityList(page).getByRole('button', { name: 'Usar a gravidade padrão da regra Google.We' })).toBeVisible();
    await expect(alertCard(page, 'Google.We').first()).toContainText('erro');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the menu is a comfortable touch target and works from the alerts tab', async ({ page }) => {
    await page.goto('/');
    await review(page, DOC);
    await expect(alertCard(page, 'Google.We').first()).toBeVisible();

    const select = cardSelect(page, 'Google.We');
    const box = await select.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
    // 16 px: smaller text makes iOS zoom the page when a field is focused
    await expect(select).toHaveCSS('font-size', '16px');

    await select.selectOption('error');
    expect(new Set(await severitiesOf(page, 'Google.We'))).toEqual(new Set(['error']));
    // nothing sticks out of the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
