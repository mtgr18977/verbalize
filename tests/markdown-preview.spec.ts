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

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the description is worded in Portuguese', async ({ page }) => {
    await page.goto('/');
    await setText(page, `![Logotipo](https://${HOST}/l.png) e ![](https://${HOST}/m.png)`);
    await page.getByRole('tab', { name: 'Prévia' }).first().click();
    await expect(page.locator('#panel-preview')).toContainText('[imagem: Logotipo] e [imagem]');
  });
});
