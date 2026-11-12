import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editor, setText } from './helpers/editor';

const LINKS = `= Links

[#section-one]
== Section one

https://docs.example.invalid/page[web] and http://docs.example.invalid/old[plain http].

link:other.adoc[relative], mailto:someone@example.invalid[mail] and <<section-one,jump>>.

[[mark]]Marked text.

++++
<p><a href="javascript:window.__pwned=1">script</a>, <a href="data:text/html,x">data</a>,
<a href="//docs.example.invalid/x">scheme</a>, <a href="vbscript:x"><b>bold dead</b></a></p>
++++
`;

async function useAsciidoc(page: Page): Promise<void> {
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
  await page.getByLabel(/Document format|Formato do documento/).selectOption('asciidoc');
}

async function openPreview(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /^(Preview|Prévia)$/ }).first().click();
  await expect(page.getByTestId('asciidoc-preview')).toBeVisible({ timeout: 15000 });
}

test.describe('the links of the AsciiDoc preview', () => {
  test('a web link opens in a new tab, and every other kind is plain text', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, LINKS);
    await openPreview(page);
    const preview = page.getByTestId('asciidoc-preview');
    await expect(preview.getByRole('heading', { name: 'Section one' })).toBeVisible();

    const report = await preview.evaluate((root) =>
      Array.from(root.querySelectorAll('a[href]')).map((a) => ({
        text: a.textContent,
        href: a.getAttribute('href') ?? '',
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
      }))
    );
    // two web links and the link to a place in the same document: nothing else is a link
    expect(report.map((link) => link.text)).toEqual(['web', 'plain http', 'jump']);
    for (const link of report.filter((entry) => entry.href.startsWith('http'))) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    }
    // a link inside the document points at the prefixed id and stays in this page
    const jump = report.find((entry) => entry.text === 'jump');
    expect(jump).toMatchObject({ href: '#adoc-section-one', target: null, rel: null });

    // the others keep their words, so the sentence still reads, and are not links
    for (const text of ['relative', 'mail', 'script', 'data', 'scheme', 'bold dead']) {
      await expect(preview.getByText(text, { exact: true })).toBeVisible();
      await expect(preview.getByRole('link', { name: text, exact: true })).toHaveCount(0);
    }
    // an unwrapped link keeps what was inside it
    await expect(preview.locator('span > b', { hasText: 'bold dead' })).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('nothing of the unwrapping is left in the page', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, LINKS);
    await openPreview(page);
    const html = await page.getByTestId('asciidoc-preview').innerHTML();
    expect(html).not.toContain('data-preview-dead');
    expect(html).not.toMatch(/href="(javascript|data|vbscript|mailto):/i);
    expect(html).not.toContain('other.adoc');
  });

  test('the anchor Asciidoctor writes for a target is kept, with its prefixed id', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, LINKS);
    await openPreview(page);
    await expect(page.getByTestId('asciidoc-preview').locator('#adoc-mark')).toHaveCount(1);
    await expect(page.getByTestId('asciidoc-preview')).toContainText('Marked text.');
  });

  test('a link to the same document works and does not leave the editor', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, LINKS);
    await openPreview(page);
    const popups: unknown[] = [];
    page.on('popup', (popup) => popups.push(popup));

    await page.getByTestId('asciidoc-preview').getByRole('link', { name: 'jump' }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#adoc-section-one');
    expect(popups).toEqual([]);
    await expect(page.getByTestId('asciidoc-preview')).toBeVisible();
  });

  test('the new tab cannot reach the editor and is not told where the reader came from', async ({ page, context }) => {
    const referers: Array<string | undefined> = [];
    await context.route('https://docs.example.invalid/**', (route) => {
      referers.push(route.request().headers()['referer']);
      return route.fulfill({ contentType: 'text/html', body: '<h1>target</h1>' });
    });
    await useAsciidoc(page);
    await setText(page, LINKS);
    await openPreview(page);
    const editorUrl = page.url();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('asciidoc-preview').getByRole('link', { name: 'web', exact: true }).click(),
    ]);
    await popup.waitForLoadState();
    await expect(popup.getByRole('heading', { name: 'target' })).toBeVisible();

    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(referers).toEqual([undefined]);
    expect(page.url()).toBe(editorUrl);
  });

  test('a link around text still works, and a web address is normalized like in Markdown', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, 'https://docs.example.invalid[bare origin]\n');
    await openPreview(page);
    const link = page.getByTestId('asciidoc-preview').getByRole('link', { name: 'bare origin' });
    await expect(link).toHaveAttribute('href', 'https://docs.example.invalid/');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the links behave the same way', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, LINKS);
    await openPreview(page);
    const preview = page.getByTestId('asciidoc-preview');
    await expect(preview.getByRole('link')).toHaveCount(3);
    await expect(preview.getByRole('link', { name: 'relative' })).toHaveCount(0);
  });
});
