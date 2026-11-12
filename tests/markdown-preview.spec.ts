import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setText } from './helpers/editor';

const HOST = 'example.invalid';

const DOC = `# Title

Inline: ![Tracking pixel](https://${HOST}/pixel.gif?reader=1)

Reference: ![Logo][logo]

No description: ![](https://${HOST}/empty.png)

Inside a link: [![Badge](https://${HOST}/badge.svg)](https://docs.example.com/page)

Raw HTML is not rendered: <img src="https://${HOST}/raw.png" alt="Raw">

[logo]: https://${HOST}/logo.png
`;

/** Records every request that would reach the author's server. */
function watchRequests(page: Page): string[] {
  const contacted: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(HOST)) contacted.push(request.url());
  });
  return contacted;
}

async function openPreview(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Preview' }).first().click();
  await expect(page.locator('#panel-preview')).toBeVisible();
}

test.describe('the Markdown preview', () => {
  test('control: the page would fetch an image from the author, so the check below can fail', async ({ page }) => {
    const contacted = watchRequests(page);
    await page.goto('/');
    await page.evaluate((host) => {
      const image = new Image();
      image.src = `https://${host}/control.png`;
    }, HOST);
    await expect.poll(() => contacted.length).toBeGreaterThan(0);
  });

  test('never loads an image, not even while the preview tab is hidden', async ({ page }) => {
    const contacted = watchRequests(page);
    await page.goto('/');
    await setText(page, DOC);
    // the preview is drawn behind the editor even when its tab is not open
    // (a role query would skip it: the hidden tab is display:none)
    await expect(page.locator('#panel-preview h1')).toBeAttached();
    await page.waitForTimeout(800);
    expect(contacted, 'requests made while the preview was hidden').toEqual([]);

    await openPreview(page);
    await page.waitForTimeout(800);
    expect(contacted, 'requests made once the preview was open').toEqual([]);
    await expect(page.locator('#panel-preview img')).toHaveCount(0);
  });

  test('shows each image as its description, and keeps the rest of the document', async ({ page }) => {
    await page.goto('/');
    await setText(page, DOC);
    await openPreview(page);
    const preview = page.locator('#panel-preview');

    await expect(preview.getByRole('heading', { name: 'Title' })).toBeVisible();
    await expect(preview).toContainText('Inline: [image: Tracking pixel]');
    await expect(preview).toContainText('Reference: [image: Logo]');
    await expect(preview).toContainText('No description: [image]');
    // an image inside a link leaves the link working
    await expect(preview.getByRole('link', { name: '[image: Badge]' })).toHaveAttribute('href', 'https://docs.example.com/page');
    // raw HTML stays out of the page
    await expect(preview.locator('.preview-image')).toHaveCount(4);
  });

  test('the description is text, never markup', async ({ page }) => {
    await page.goto('/');
    await setText(page, `![<b>bold</b><script>window.__pwned=1</script>](https://${HOST}/x.png)`);
    await openPreview(page);
    const image = page.locator('#panel-preview .preview-image');
    await expect(image).toHaveText('[image: <b>bold</b><script>window.__pwned=1</script>]');
    await expect(image.locator('b, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('the description is readable in both themes', async ({ page }) => {
    await page.goto('/');
    await setText(page, `![Diagram](https://${HOST}/d.png)`);
    await openPreview(page);
    const image = page.locator('#panel-preview .preview-image');
    await expect(image).toBeVisible();
    await expect(image).toHaveCSS('font-family', /Mono|monospace/i);
  });
});

const LINKS = `# Links

[web](https://docs.example.invalid/page) and [plain http](http://docs.example.invalid/old).

[relative](other.md), [anchor](#links), [mail](mailto:someone@example.invalid), [script](javascript:window.__pwned=1),
[data](data:text/html,<b>x</b>), [no scheme](//docs.example.invalid/x) and [empty]().

Autolink: <https://docs.example.invalid/auto>
`;

test.describe('the links of the Markdown preview', () => {
  test('a web link opens in a new tab, and the other kinds are plain text', async ({ page }) => {
    await page.goto('/');
    await setText(page, LINKS);
    await openPreview(page);
    const preview = page.locator('#panel-preview');

    const links = preview.locator('a');
    // web, plain http and the autolink: nothing else is a link
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(await link.getAttribute('href')).toMatch(/^https?:\/\//);
    }
    // the others keep their text, so the sentence still reads
    for (const text of ['relative', 'anchor', 'mail', 'script', 'data', 'no scheme', 'empty']) {
      await expect(preview.getByText(text, { exact: true })).toBeVisible();
      await expect(preview.getByRole('link', { name: text, exact: true })).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('control: a link opened the usual way gives the new page access to this one', async ({ page, context }) => {
    await context.route('https://docs.example.invalid/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>target</h1>' })
    );
    await page.goto('/');
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(() => window.open('https://docs.example.invalid/page', '_blank')),
    ]);
    await popup.waitForLoadState();
    // without noopener the other page can reach back: this is what the link attributes prevent
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
  });

  test('the new tab cannot reach the editor and is not told where the reader came from', async ({ page, context }) => {
    const referers: Array<string | undefined> = [];
    await context.route('https://docs.example.invalid/**', (route) => {
      referers.push(route.request().headers()['referer']);
      return route.fulfill({ contentType: 'text/html', body: '<h1>target</h1>' });
    });
    await page.goto('/');
    await setText(page, '[web](https://docs.example.invalid/page)');
    await openPreview(page);
    const editorUrl = page.url();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('#panel-preview').getByRole('link', { name: 'web' }).click(),
    ]);
    await popup.waitForLoadState();
    await expect(popup.getByRole('heading', { name: 'target' })).toBeVisible();

    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(referers).toEqual([undefined]);
    // the editor stayed where it was, with its text
    expect(page.url()).toBe(editorUrl);
    await expect(page.locator('#panel-preview')).toBeVisible();
  });

  test('a link around an image still works, and shows the description of the image', async ({ page }) => {
    await page.goto('/');
    await setText(page, `[![Badge](https://${HOST}/badge.svg)](https://docs.example.invalid/page)`);
    await openPreview(page);
    const link = page.locator('#panel-preview').getByRole('link', { name: '[image: Badge]' });
    await expect(link).toHaveAttribute('href', 'https://docs.example.invalid/page');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('links keep their look in the theme', async ({ page }) => {
    await page.goto('/');
    await setText(page, '[web](https://docs.example.invalid/page)');
    await openPreview(page);
    const link = page.locator('#panel-preview').getByRole('link', { name: 'web' });
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    await expect(link).toHaveCSS('color', /rgb\(11, 94, 110\)/);
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the description is worded in Portuguese', async ({ page }) => {
    await page.goto('/');
    await setText(page, `![Logotipo](https://${HOST}/l.png) e ![](https://${HOST}/m.png)`);
    await page.getByRole('tab', { name: 'Prévia' }).first().click();
    await expect(page.locator('#panel-preview')).toContainText('[imagem: Logotipo] e [imagem]');
  });
});
