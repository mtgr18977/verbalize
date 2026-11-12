import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { docText, editor, review, setText } from './helpers/editor';

const ADOC = `= Installing the CLI
:toc:

NOTE: We really use this command in order to install the tool.

== Prerequisites

* A cluster running OpenShift.
* The configuration file was deleted by the user.

[source,bash]
----
oc login --token=in order to
----

See link:https://example.com/guide[the guide].
`;

const selectFormat = (page: Page, value: 'markdown' | 'asciidoc'): Promise<unknown> =>
  page.getByLabel(/Document format|Formato do documento/).selectOption(value);

async function useAsciidoc(page: Page): Promise<void> {
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
  await selectFormat(page, 'asciidoc');
}

async function openPreview(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /^(Preview|Prévia)$/ }).first().click();
}

test.describe('choosing the format', () => {
  test('Markdown is the default, and AsciiDoc changes what the editor expects', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await expect(page.getByLabel('Document format')).toHaveValue('markdown');
    await expect(page.locator('.cm-placeholder')).toContainText('Markdown supported');

    await selectFormat(page, 'asciidoc');
    await expect(page.locator('.cm-placeholder')).toContainText('AsciiDoc supported');
  });

  test('is remembered', async ({ page }) => {
    await useAsciidoc(page);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('verbalize:prefs:v1'))).toContain('"format":"asciidoc"');
    await page.reload();
    await expect(page.getByLabel('Document format')).toHaveValue('asciidoc');
  });

  test('follows the file you upload, and keeps the current one for other files', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    const upload = page.locator('input[type="file"]:not([accept=".yml"]):not([accept*="txt"])').first();

    await upload.setInputFiles({ name: 'guide.adoc', mimeType: 'text/plain', buffer: Buffer.from('= Guide\n\nHello.\n') });
    await expect(page.getByLabel('Document format')).toHaveValue('asciidoc');
    expect(await docText(page)).toBe('= Guide\n\nHello.\n');

    await upload.setInputFiles({ name: 'README.md', mimeType: 'text/plain', buffer: Buffer.from('# Readme\n') });
    await expect(page.getByLabel('Document format')).toHaveValue('markdown');

    await selectFormat(page, 'asciidoc');
    await upload.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain notes\n') });
    await expect(page.getByLabel('Document format')).toHaveValue('asciidoc');
  });

  test('a review sends the format, and changing it afterwards makes the result out of date', async ({ page }) => {
    const bodies: Array<{ format: string }> = [];
    await page.route('**/api/lint', async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.continue();
    });
    await useAsciidoc(page);
    await review(page, ADOC);
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at', { timeout: 15000 });
    expect(bodies[0].format).toBe('asciidoc');

    await selectFormat(page, 'markdown');
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
    await expect(page.getByText(/format, custom rules or vocabulary changed/)).toBeVisible();
  });
});

test.describe('reviewing AsciiDoc', () => {
  test('underlines the words in the source and skips code blocks', async ({ page }) => {
    await useAsciidoc(page);
    await review(page, ADOC);
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });

    const underlined = await page.locator('.cm-lintRange').allTextContents();
    expect(underlined).toEqual(expect.arrayContaining(['We', 'in order to', 'was deleted']));
    // "in order to" also appears in the code block, which Vale does not read
    expect(underlined.filter((text) => text === 'in order to')).toHaveLength(1);
    await expect(page.getByTestId('alert-card').filter({ hasText: 'L4:' }).first()).toBeVisible();
  });

  test('works with the Red Hat style', async ({ page }) => {
    await useAsciidoc(page);
    await page.getByLabel('Base style guide').selectOption('RedHat');
    await review(page, ADOC);
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('alert-card').filter({ hasText: 'RedHat.' }).first()).toBeVisible();
  });

  test('a server without AsciiDoc support says so, in the interface language', async ({ page }) => {
    await page.route('**/api/lint', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'x', code: 'asciidoc_unavailable' }) })
    );
    await useAsciidoc(page);
    await setText(page, ADOC);
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect.poll(() => message).toBe('Linting failed: AsciiDoc support is not available on this server.');
  });
});

test.describe('highlighting', () => {
  const styles = (page: Page): Promise<Array<{ text: string; weight: string; fontStyle: string }>> =>
    page.locator('.cm-line span').evaluateAll((spans) =>
      spans.map((span) => ({
        text: span.textContent ?? '',
        weight: getComputedStyle(span).fontWeight,
        fontStyle: getComputedStyle(span).fontStyle,
      }))
    );

  test('AsciiDoc structure is colored: titles, inline marks and comments', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, '= Title\n\n== Section\n\nSome *strong* and _soft_ text.\n\n// hidden note\n');
    await expect.poll(async () => (await styles(page)).length).toBeGreaterThan(3);
    const found = await styles(page);

    const bold = (text: string): boolean => found.some((span) => span.text.includes(text) && Number(span.weight) >= 700);
    expect(bold('= Title')).toBe(true);
    expect(bold('== Section')).toBe(true);
    expect(bold('*strong*')).toBe(true);
    expect(found.some((span) => span.text.includes('_soft_') && span.fontStyle === 'italic')).toBe(true);
    expect(found.some((span) => span.text.includes('// hidden note') && span.fontStyle === 'italic')).toBe(true);
  });

  test('delimited code blocks are not read as markup', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, '----\n*not bold* in code\n----\n\n*bold* outside\n');
    await expect.poll(async () => (await styles(page)).length).toBeGreaterThan(1);
    const found = await styles(page);
    expect(found.some((span) => span.text.includes('*not bold*') && Number(span.weight) >= 700)).toBe(false);
    expect(found.some((span) => span.text.includes('*bold*') && Number(span.weight) >= 700)).toBe(true);
  });

  test('the highlighting follows the format, for the same text', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await setText(page, '# Markdown title\n\n= AsciiDoc title\n');

    // the bold part of each line: Markdown splits "# Markdown title" into its mark and its text
    const boldPerLine = (): Promise<string[]> =>
      page.locator('.cm-line').evaluateAll((lines) =>
        lines.map((line) =>
          Array.from(line.querySelectorAll('span'))
            .filter((span) => Number(getComputedStyle(span).fontWeight) >= 700)
            .map((span) => span.textContent ?? '')
            .join('')
        )
      );

    await expect.poll(boldPerLine).toEqual(['# Markdown title', '', '', '']);

    await selectFormat(page, 'asciidoc');
    await expect.poll(boldPerLine).toEqual(['', '', '= AsciiDoc title', '']);
  });
});

test.describe('the AsciiDoc preview', () => {
  test('renders the structure of the document', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, ADOC);
    await openPreview(page);

    const preview = page.getByTestId('asciidoc-preview');
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview.getByRole('heading', { name: 'Installing the CLI', level: 1 })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'Prerequisites', level: 2 })).toBeVisible();
    await expect(preview.locator('li')).toHaveCount(3);
    await expect(preview.locator('.admonitionblock')).toContainText('We really use this command');
    await expect(preview.locator('pre')).toContainText('oc login --token=in order to');
  });

  test('external links open in a new tab without access to this page', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, ADOC);
    await openPreview(page);
    const link = page.getByTestId('asciidoc-preview').getByRole('link', { name: 'the guide' });
    await expect(link).toHaveAttribute('href', 'https://example.com/guide');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('follows the text and the format', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, '== First\n');
    await openPreview(page);
    await expect(page.getByTestId('asciidoc-preview').getByRole('heading', { name: 'First' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('tab', { name: 'Editor' }).first().click();
    await setText(page, '== Second\n');
    await openPreview(page);
    await expect(page.getByTestId('asciidoc-preview').getByRole('heading', { name: 'Second' })).toBeVisible();

    await selectFormat(page, 'markdown');
    await expect(page.getByTestId('asciidoc-preview')).toHaveCount(0);
    await expect(page.locator('#panel-preview article')).toContainText('== Second');
  });

  test('says there is nothing to show for an empty document', async ({ page }) => {
    await useAsciidoc(page);
    await openPreview(page);
    await expect(page.locator('#panel-preview')).toContainText('The preview will appear here');
  });

  test('is loaded only when it is needed', async ({ page }) => {
    const loaded = (): Promise<string[]> =>
      page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /asciidoctor/i.test(name)));

    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await selectFormat(page, 'asciidoc');
    await setText(page, ADOC);
    expect(await loaded()).toEqual([]);

    await openPreview(page);
    await expect(page.getByTestId('asciidoc-preview')).toBeVisible({ timeout: 15000 });
    expect((await loaded()).length).toBeGreaterThan(0);
  });
});

test.describe('the preview of untrusted AsciiDoc', () => {
  const HOSTILE = `= Hostile

++++
<img src="https://example.invalid/pixel.png" onerror="window.__pwned = 1">
<script>window.__pwned = 2</script>
<iframe src="https://example.invalid/frame"></iframe>
<svg onload="window.__pwned = 3"><circle r="5"/></svg>
<form action="https://example.invalid/post"><input name="x"><button>go</button></form>
<style>body { display: none }</style>
<a href="javascript:window.__pwned = 4">js link</a>
<div onclick="window.__pwned = 5" style="position:fixed;inset:0">clickjack</div>
++++

link:javascript:window.__pwned=6[script link]

link:data:text/html,<b>x</b>[data link]

image::https://example.invalid/track.png[Tracking pixel]

[#panel-editor]
Paragraph with an id that belongs to the app.

<<panel-alerts,jump>>
`;

  test('nothing that can run, load or restyle reaches the page', async ({ page }) => {
    const contacted: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('example.invalid')) contacted.push(request.url());
    });
    await useAsciidoc(page);
    await setText(page, HOSTILE);
    await openPreview(page);
    const preview = page.getByTestId('asciidoc-preview');
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview).toContainText('Hostile');
    await page.waitForTimeout(500);

    const report = await preview.evaluate((root) => {
      const attributes = new Set<string>();
      root.querySelectorAll('*').forEach((element) => {
        for (const attribute of Array.from(element.attributes)) attributes.add(attribute.name);
      });
      return {
        forbidden: Array.from(root.querySelectorAll('script, iframe, svg, form, input, button, style, link, meta, object, embed, img, video, audio')).map((e) => e.tagName),
        handlers: Array.from(attributes).filter((name) => name.startsWith('on')),
        inlineStyles: root.querySelectorAll('[style]').length,
        unsafeLinks: Array.from(root.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href') ?? '')
          .filter((href) => /^(javascript|data|vbscript):/i.test(href.trim())),
        text: root.textContent ?? '',
      };
    });

    expect(report.forbidden).toEqual([]);
    expect(report.handlers).toEqual([]);
    expect(report.inlineStyles).toBe(0);
    expect(report.unsafeLinks).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    // images are never loaded: nothing was requested from the author's server
    expect(contacted).toEqual([]);
    // each image is shown as its description
    expect(report.text).toContain('[image: Tracking pixel]');
    // the page around the preview is untouched
    await expect(page.getByRole('tablist', { name: 'Document view' })).toBeVisible();
  });

  test('ids of the document cannot take the place of the ids of the app', async ({ page }) => {
    await useAsciidoc(page);
    await setText(page, HOSTILE);
    await openPreview(page);
    await expect(page.getByTestId('asciidoc-preview')).toBeVisible({ timeout: 15000 });

    // the app's own element still owns the id, and the document's got a prefix
    expect(await page.evaluate(() => document.getElementById('panel-editor')?.getAttribute('role'))).toBe('tabpanel');
    await expect(page.getByTestId('asciidoc-preview').locator('#adoc-panel-editor')).toHaveCount(1);
    // links inside the document point at the prefixed ids
    await expect(page.getByTestId('asciidoc-preview').getByRole('link', { name: 'jump' })).toHaveAttribute('href', '#adoc-panel-alerts');
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the format, the placeholder and the preview speak Portuguese', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await expect(page.getByLabel('Formato do documento')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar Markdown ou AsciiDoc' })).toBeVisible();

    await selectFormat(page, 'asciidoc');
    await expect(page.locator('.cm-placeholder')).toContainText('AsciiDoc é aceito');
    await openPreview(page);
    await expect(page.locator('#panel-preview')).toContainText('A prévia aparece aqui');

    await page.getByRole('tab', { name: 'Editor' }).first().click();
    await setText(page, 'image::https://example.invalid/x.png[Logotipo]\n');
    await openPreview(page);
    await expect(page.getByTestId('asciidoc-preview')).toContainText('[imagem: Logotipo]', { timeout: 15000 });
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the format can be chosen and the preview fits the screen', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await selectFormat(page, 'asciidoc');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await setText(page, ADOC);
    await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'Preview' }).click();
    await expect(page.getByTestId('asciidoc-preview')).toBeVisible({ timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
