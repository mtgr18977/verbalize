import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { docText, editor, review, setText } from './helpers/editor';
import { describeApiError } from '../i18n/api-error';
import { DEFAULT_LOCALE, LOCALES, parseAcceptLanguage, resolveLocale } from '../i18n/locale';
import { en } from '../i18n/messages.en';
import { ptBR } from '../i18n/messages.pt-br';
import { createTranslator, getMessageKeys, getPlaceholders } from '../i18n/translate';
import { API_ERROR_CODES } from '../lib/api-errors';

const DOC = '# Install\n\nWe really use this in order to test it.\nThe file was deleted by the user.';

test.describe('choosing the language', () => {
  test('follows Accept-Language by quality, and treats any Portuguese as pt-BR', () => {
    expect(parseAcceptLanguage('pt-BR,pt;q=0.9,en;q=0.8')).toBe('pt-BR');
    expect(parseAcceptLanguage('pt-PT')).toBe('pt-BR');
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,pt;q=0.5')).toBe('pt-BR');
    expect(parseAcceptLanguage('en;q=0.5,pt;q=0.9')).toBe('pt-BR');
    expect(parseAcceptLanguage('pt;q=0,en')).toBe('en');
  });

  test('returns nothing when no supported language is listed', () => {
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
    expect(parseAcceptLanguage('fr,de;q=0.8')).toBeNull();
    expect(parseAcceptLanguage('*')).toBeNull();
    expect(parseAcceptLanguage('pt;q=abc')).toBeNull();
  });

  test('an explicit choice wins over the browser, and invalid values are ignored', () => {
    expect(resolveLocale('en', 'pt-BR')).toBe('en');
    expect(resolveLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(resolveLocale('xx', 'pt-BR')).toBe('pt-BR');
    expect(resolveLocale(undefined, 'fr')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null, null)).toBe(DEFAULT_LOCALE);
  });
});

test.describe('the catalogs', () => {
  test('Portuguese has exactly the keys of the English file', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
  });

  test('every message uses the same {placeholders} in both languages', () => {
    for (const key of getMessageKeys()) {
      expect(getPlaceholders(ptBR[key]), `placeholders of "${key}"`).toEqual(getPlaceholders(en[key]));
    }
  });

  test('no message is empty, and plural variants come in pairs', () => {
    for (const catalog of [en, ptBR] as Array<Record<string, string>>) {
      for (const [key, message] of Object.entries(catalog)) {
        expect(message.trim().length, `"${key}" is empty`).toBeGreaterThan(0);
        if (key.endsWith('_one')) expect(catalog[key.replace(/_one$/, '_other')], `"${key}" needs _other`).toBeDefined();
        if (key.endsWith('_other')) expect(catalog[key.replace(/_other$/, '_one')], `"${key}" needs _one`).toBeDefined();
      }
    }
  });

  test('nothing was left in English in the Portuguese file', () => {
    // Words that are the same in both languages, or deliberately bilingual
    const same = new Set(['settings.language', 'editor.editor']);
    for (const key of getMessageKeys()) {
      if (same.has(key)) continue;
      expect(ptBR[key], `"${key}" is identical to English`).not.toBe(en[key]);
    }
  });

  test('every error code of the API has a message in both languages', () => {
    // `in` instead of toHaveProperty: the keys contain dots, which toHaveProperty reads as a path
    for (const code of API_ERROR_CODES) {
      expect(`api.${code}` in en, `en api.${code}`).toBe(true);
      expect(`api.${code}` in ptBR, `pt-BR api.${code}`).toBe(true);
    }
  });
});

test.describe('the translator', () => {
  test('replaces placeholders and leaves unknown ones visible', () => {
    const t = createTranslator('en');
    expect(t('status.reviewedAt', { time: '14:32' })).toBe('Reviewed at 14:32');
    expect(t('status.reviewedAt')).toBe('Reviewed at {time}');
  });

  test('chooses the plural form by the language rules', () => {
    const en = createTranslator('en');
    expect(en('alerts.noAlertsTitle', { count: 1 })).toBe('No alerts in 1 line');
    expect(en('alerts.noAlertsTitle', { count: 12 })).toBe('No alerts in 12 lines');
    const pt = createTranslator('pt-BR');
    expect(pt('alerts.noAlertsTitle', { count: 1 })).toBe('Nenhum alerta em 1 linha');
    expect(pt('alerts.noAlertsTitle', { count: 12 })).toBe('Nenhum alerta em 12 linhas');
    expect(pt('editor.chars', { count: 1 })).toBe('1 caractere');
    // zero is plural in Brazilian Portuguese, although CLDR counts it as "one"
    expect(pt('editor.chars', { count: 0 })).toBe('0 caracteres');
    expect(createTranslator('en')('editor.chars', { count: 0 })).toBe('0 chars');
    expect(pt('editor.chars', { count: 2000 })).toBe('2000 caracteres');
  });

  test('every supported language has a translator', () => {
    for (const locale of LOCALES) expect(createTranslator(locale)('header.run').length).toBeGreaterThan(0);
  });

  test('error responses are worded from their code, with a fallback', () => {
    const pt = createTranslator('pt-BR');
    expect(describeApiError({ error: 'x', code: 'timeout', params: { seconds: 8 } }, pt)).toBe(
      'A revisão passou de 8 s e foi interrompida. Revise um trecho menor.'
    );
    expect(describeApiError({ error: 'English text', code: 'not_a_code' }, pt)).toBe('English text');
    expect(describeApiError({ error: '' }, pt)).toBe('Erro desconhecido');
    expect(describeApiError(null, pt)).toBe('Erro desconhecido');
    // parameters of the wrong type are ignored instead of being printed
    expect(describeApiError({ code: 'rate_limited', params: { seconds: { evil: true } } }, pt)).toContain('{seconds}');
  });
});

test.describe('the server decides the first paint', () => {
  test('answers in Portuguese for a Portuguese browser, with the right lang', async ({ request }) => {
    const html = await (await request.get('/', { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' } })).text();
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain('Não revisado');
    expect(html).toContain('Revisar');
    expect(html).not.toContain('Not reviewed');
  });

  test('answers in English by default and for languages it does not have', async ({ request }) => {
    for (const header of [undefined, 'fr-FR,fr;q=0.9', 'en-US']) {
      const html = await (await request.get('/', { headers: header ? { 'Accept-Language': header } : {} })).text();
      expect(html).toContain('lang="en"');
      expect(html).toContain('Not reviewed');
    }
  });

  test('the cookie wins over the browser language, and a bad cookie is ignored', async ({ request }) => {
    const forced = await (await request.get('/', { headers: { 'Accept-Language': 'en-US', Cookie: 'verbalize-locale=pt-BR' } })).text();
    expect(forced).toContain('lang="pt-BR"');
    const bad = await (await request.get('/', { headers: { 'Accept-Language': 'pt-BR', Cookie: 'verbalize-locale=xx' } })).text();
    expect(bad).toContain('lang="pt-BR"');
  });

  test('the page description follows the language', async ({ request }) => {
    const html = await (await request.get('/', { headers: { 'Accept-Language': 'pt-BR' } })).text();
    expect(html).toContain('assistente de escrita');
  });
});

async function runAndWait(page: Page): Promise<void> {
  await review(page, DOC);
  await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
}

test.describe('the interface in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('is in Portuguese from the first paint, without hydration errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('button', { name: /Revisar/ })).toBeVisible();
    await expect(page.getByTestId('review-status')).toHaveText('Não revisado');
    await expect(page.getByText('Ainda não revisado')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Prévia' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    await expect(page.locator('.cm-placeholder')).toContainText('Comece a escrever');
    await expect(page.getByRole('textbox', { name: 'Texto do documento' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a review reads in Portuguese while the rule messages stay in English', async ({ page }) => {
    await page.goto('/');
    await runAndWait(page);

    const card = page.getByTestId('alert-card').filter({ hasText: 'Google.WordList' });
    await expect(card).toContainText('aviso');
    await expect(card).toContainText("Use 'to' instead of 'in order to'.");
    await expect(card.getByRole('button', { name: 'Substituir por “to”' })).toBeVisible();
    // only some rules link to their guide: Google.We does
    const withLink = page.getByTestId('alert-card').filter({ hasText: 'Google.We' });
    await expect(withLink.getByRole('link', { name: /guia de estilo/i })).toBeVisible();
    await expect(page.getByTestId('review-status')).toContainText('Revisado às');
    await expect(page.getByText(/caracteres/)).toBeVisible();

    await setText(page, 'Texto completamente diferente.');
    await expect(page.getByTestId('review-status')).toHaveText('Desatualizado');
    await expect(page.getByText('texto editado').first()).toBeVisible();
  });

  test('says "no alerts" in Portuguese, with the right plural', async ({ page }) => {
    await page.goto('/');
    await review(page, 'Install the package.');
    await expect(page.getByText('Nenhum alerta em 1 linha')).toBeVisible({ timeout: 15000 });
  });

  test('the tooltip fix is in Portuguese too', async ({ page }) => {
    await page.goto('/');
    await runAndWait(page);
    await page.locator('.cm-lintRange-warning', { hasText: 'in order to' }).hover();
    await expect(page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Substituir por “to”' })).toBeVisible();
    await expect(page.locator('.cm-tooltip-lint a')).toContainText('Guia de estilo');
  });

  test('an error from the server is explained in Portuguese', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"][accept=".yml"]').setInputFiles({
      name: 'loop.yml',
      mimeType: 'text/yaml',
      buffer: Buffer.from('extends: script\nmessage: x\nscope: raw\nscript: |\n  for true {}\n'),
    });
    await setText(page, 'hello world');
    await page.getByRole('button', { name: /Revisar/ }).click();
    await expect(page.getByTestId('toasts').getByRole('alert')).toContainText('A revisão falhou: Regra “loop.yml”: regras de script não são permitidas.');
  });

  test('dates and times follow the language', async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('seeded')) return;
      window.sessionStorage.setItem('seeded', '1');
      window.localStorage.setItem('verbalize:draft:v1', JSON.stringify({ text: 'x', customRules: [], savedAt: Date.UTC(2023, 10, 14, 12, 0) }));
    });
    await page.goto('/');
    await expect(page.getByTestId('restored-notice')).toContainText('Rascunho restaurado de 14 de nov. de 2023');
  });

  test('fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('tablist', { name: 'Painéis' }).getByRole('tab', { name: 'Alertas' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const run = await page.getByRole('button', { name: /Revisar/ }).boundingBox();
    expect(run!.x + run!.width).toBeLessThanOrEqual(390);
  });
});

test.describe('the interface in English', () => {
  test('explains a server error in English too', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"][accept=".yml"]').setInputFiles({
      name: 'loop.yml',
      mimeType: 'text/yaml',
      buffer: Buffer.from('extends: script\nmessage: x\nscope: raw\nscript: |\n  for true {}\n'),
    });
    await setText(page, 'hello world');
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect(page.getByTestId('toasts').getByRole('alert')).toContainText('Linting failed: Rule “loop.yml”: script rules are not allowed.');
  });
});

test.describe('switching the language', () => {
  const select = (page: Page): ReturnType<Page['locator']> => page.getByLabel('Language / Idioma');

  test('changes everything at once, without reloading, and keeps the work', async ({ page }) => {
    await page.goto('/');
    await setText(page, 'Words I wrote.');
    await expect(page.getByRole('button', { name: /Run Linting/ })).toBeVisible();

    await select(page).selectOption('pt-BR');
    await expect(page.getByRole('button', { name: /Revisar/ })).toBeVisible();
    await expect(page.getByTestId('review-status')).toHaveText('Não revisado');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    expect(await docText(page)).toBe('Words I wrote.');

    await select(page).selectOption('en');
    await expect(page.getByRole('button', { name: /Run Linting/ })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('is remembered, and beats the browser language', async ({ page, context }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await select(page).selectOption('pt-BR');
    await expect(page.getByRole('button', { name: /Revisar/ })).toBeVisible();

    const cookie = (await context.cookies()).find((entry) => entry.name === 'verbalize-locale');
    expect(cookie?.value).toBe('pt-BR');
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.httpOnly).toBe(false);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('button', { name: /Revisar/ })).toBeVisible();
    await expect(select(page)).toHaveValue('pt-BR');
  });

  test('rewords the editor and its alerts in place', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await expect(page.locator('.cm-placeholder')).toContainText('Start typing');
    await select(page).selectOption('pt-BR');
    await expect(page.locator('.cm-placeholder')).toContainText('Comece a escrever');
    await expect(page.getByRole('textbox', { name: 'Texto do documento' })).toBeVisible();
    await select(page).selectOption('en');

    await runAndWait(page);
    const underlined = await page.locator('.cm-lintRange').count();
    expect(underlined).toBeGreaterThanOrEqual(3);
    await page.locator('.cm-lintRange-warning', { hasText: 'in order to' }).hover();
    await expect(page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Replace with “to”' })).toBeVisible();

    await select(page).selectOption('pt-BR');
    // the underlines are still where they were, and the tooltip now speaks Portuguese
    await expect(page.locator('.cm-lintRange')).toHaveCount(underlined);
    await expect(page.locator('.cm-lintRange', { hasText: 'in order to' })).toHaveCount(1);
    await page.mouse.move(0, 0);
    await page.locator('.cm-lintRange-warning', { hasText: 'in order to' }).hover();
    await expect(page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Substituir por “to”' })).toBeVisible();

    // and the fix still works after the switch
    await page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Substituir por “to”' }).click();
    expect(await docText(page)).toContain('We really use this to test it.');
  });

  test('is offered in a label that can be found from either language', async ({ page }) => {
    await page.goto('/');
    await expect(select(page)).toBeVisible();
    await expect(select(page).locator('option')).toHaveText(['English', 'Português (Brasil)']);
    await expect(select(page).locator('option[value="pt-BR"]')).toHaveAttribute('lang', 'pt-BR');
  });

  test('still the same editor after switching: typing keeps working', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await select(page).selectOption('pt-BR');
    await editor(page).click();
    await page.keyboard.type('Ainda escrevo.');
    expect(await docText(page)).toBe('Ainda escrevo.');
  });
});
