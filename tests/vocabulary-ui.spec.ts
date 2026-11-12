import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { docText, editor, review, setText } from './helpers/editor';
import { MAX_VOCABULARY_TERMS } from '../lib/vocabulary';

const VOCABULARY_KEY = 'verbalize:vocabulary:v1';
const DOC = 'We deployed kubernetes with kubectl. Please utilize it in order to recieve the file.';

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: /vocabulary|vocabulário/i });
const acceptList = (page: Page): Locator => page.getByTestId('vocabulary-accept');
const rejectList = (page: Page): Locator => page.getByTestId('vocabulary-reject');
const alertCard = (page: Page, check: string): Locator => page.getByTestId('alert-card').filter({ hasText: check });

async function openVocabulary(page: Page): Promise<void> {
  await expect(editor(page)).toBeVisible();
  await page.getByRole('button', { name: /Edit vocabulary|Editar vocabulário/ }).click();
  await expect(dialog(page)).toBeVisible();
}

async function closeVocabulary(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
}

async function setVocabulary(page: Page, accept: string, reject: string): Promise<void> {
  await openVocabulary(page);
  await acceptList(page).fill(accept);
  await rejectList(page).fill(reject);
  await closeVocabulary(page);
}

async function storedVocabulary(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), VOCABULARY_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

test.describe('the vocabulary dialog', () => {
  test('opens from the settings, is a real dialog, and gives focus back when closed', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await expect(dialog(page).getByRole('heading', { name: 'Project vocabulary' })).toBeVisible();
    // keyboard focus is inside the dialog, not on the page behind it
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Edit vocabulary' })).toBeFocused();
  });

  test('closes with Done, with the close button and by clicking outside', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(dialog(page)).toBeHidden();

    await openVocabulary(page);
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await expect(dialog(page)).toBeHidden();

    await openVocabulary(page);
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toBeHidden();
  });

  test('the summary in the settings follows the lists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 0 · Rejected: 0');
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Spelling off');

    await openVocabulary(page);
    await acceptList(page).fill('Kubernetes\nkubectl');
    await rejectList(page).fill('utilize');
    await dialog(page).getByLabel('Check spelling').check();
    await closeVocabulary(page);

    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 2 · Rejected: 1');
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Spelling on');
  });

  test('a new line can be typed: the text is not rewritten under the cursor', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await acceptList(page).fill('one\n');
    await expect(acceptList(page)).toHaveValue('one\n');
    await acceptList(page).press('End');
    await page.keyboard.type('two');
    await expect(acceptList(page)).toHaveValue('one\ntwo');
    await expect(dialog(page)).toContainText('2 of 500');
  });

  test('explains the terms Vale cannot match, and the problems of a list', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await acceptList(page).fill('C++\n.NET\nKubernetes\nKubernetes\nkubernetes\nok');
    const issues = dialog(page).getByTestId('vocabulary-issue');
    // four problems: three are listed and the rest is counted
    await expect(issues).toHaveCount(3);
    await expect(issues.nth(0)).toContainText('“C++” starts or ends with a symbol');
    await expect(issues.nth(1)).toContainText('“.NET” starts or ends with a symbol');
    await expect(issues.nth(2)).toContainText('“Kubernetes” appears more than once');
    await expect(dialog(page)).toContainText('and 1 more problem');

    // rejected terms may differ in capitalization, and the problems are per list
    await rejectList(page).fill('Foo\nfoo');
    await expect(dialog(page).getByTestId('vocabulary-issue')).toHaveCount(3);
    // a duplicate in the rejected list is reported there, next to the three already shown for the other list
    await rejectList(page).fill('Foo\nFoo');
    await expect(dialog(page).getByTestId('vocabulary-issue')).toHaveCount(4);
    await expect(dialog(page)).toContainText('“Foo” appears more than once');
  });

  test('limits the lists, and says which terms are used', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    const many = Array.from({ length: MAX_VOCABULARY_TERMS + 5 }, (_, i) => `term${i}x`).join('\n');
    await acceptList(page).fill(many);
    await expect(dialog(page)).toContainText(`${MAX_VOCABULARY_TERMS + 5} of ${MAX_VOCABULARY_TERMS}`);
    await expect(dialog(page)).toContainText(`Only the first ${MAX_VOCABULARY_TERMS} terms are used.`);
    await closeVocabulary(page);
    await expect(page.getByTestId('vocabulary-summary')).toContainText(`Accepted: ${MAX_VOCABULARY_TERMS}`);

    await openVocabulary(page);
    await acceptList(page).fill('x'.repeat(81));
    await expect(dialog(page).getByTestId('vocabulary-issue').first()).toContainText('longer than 80 characters');
  });
});

test.describe('the vocabulary in a review', () => {
  test('rejected terms are reported and underlined, whatever their capitalization', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, '', 'utilize\nin order to');
    await review(page, 'Utilize this. Please UTILIZE that.');

    await expect(page.getByTestId('alert-card').filter({ hasText: 'Vale.Avoid' })).toHaveCount(2, { timeout: 15000 });
    // exact matches: Playwright's hasText ignores case
    await expect(page.locator('.cm-lintRange', { hasText: /^Utilize$/ })).toHaveCount(1);
    await expect(page.locator('.cm-lintRange', { hasText: /^UTILIZE$/ })).toHaveCount(1);
  });

  test('accepted terms ask for their capitalization, with a one-click fix and a readable message', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes\nNode.js', '');
    await review(page, 'Run kubernetes and node.js.');

    const terms = alertCard(page, 'Vale.Terms');
    await expect(terms).toHaveCount(2, { timeout: 15000 });
    // the pattern Vale prints (Node\.js) is shown as the term it stands for
    await expect(terms.nth(1)).toContainText("Use 'Node.js' instead of 'node.js'.");
    await expect(terms.nth(1)).not.toContainText('\\');

    await terms.nth(0).getByRole('button', { name: 'Replace with “Kubernetes”' }).click();
    expect(await docText(page)).toBe('Run Kubernetes and node.js.');
  });

  test('capitalization can be switched off', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await acceptList(page).fill('Kubernetes');
    await dialog(page).getByLabel('Ask for the capitalization of accepted terms').uncheck();
    await closeVocabulary(page);
    await review(page, 'Run kubernetes. We use this in order to test.');
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    await expect(alertCard(page, 'Vale.Terms')).toHaveCount(0);
  });

  test('spelling is off until asked for', async ({ page }) => {
    await page.goto('/');
    await review(page, 'Click Next to recieve the file. We act.');
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    await expect(alertCard(page, 'Vale.Spelling')).toHaveCount(0);

    await openVocabulary(page);
    await dialog(page).getByLabel('Check spelling').check();
    await closeVocabulary(page);
    await editor(page).press('Control+Enter');
    await expect(alertCard(page, 'Vale.Spelling')).toHaveCount(1, { timeout: 15000 });
  });

  test('a vocabulary change after a review makes the result out of date', async ({ page }) => {
    await page.goto('/');
    await review(page, DOC);
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at', { timeout: 15000 });

    await openVocabulary(page);
    await rejectList(page).fill('utilize');
    await closeVocabulary(page);
    await expect(page.getByTestId('review-status')).toHaveText('Out of date');
    await expect(page.getByText(/custom rules or vocabulary changed/)).toBeVisible();
  });

  test('terms Vale cannot match are not sent, but stay in the list', async ({ page }) => {
    const bodies: Array<{ vocabulary: { accept: string[]; reject: string[] } }> = [];
    await page.route('**/api/lint', async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.continue();
    });
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes\nC++', '.NET\nutilize');
    await review(page, DOC);
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });

    expect(bodies[0].vocabulary.accept).toEqual(['Kubernetes']);
    expect(bodies[0].vocabulary.reject).toEqual(['utilize']);
    await openVocabulary(page);
    await expect(acceptList(page)).toHaveValue('Kubernetes\nC++');
  });
});

test.describe('accepting a word from a spelling alert', () => {
  async function withSpelling(page: Page, text: string): Promise<void> {
    await page.goto('/');
    await openVocabulary(page);
    await dialog(page).getByLabel('Check spelling').check();
    await closeVocabulary(page);
    await review(page, text);
    await expect(alertCard(page, 'Vale.Spelling').first()).toBeVisible({ timeout: 15000 });
  }

  test('from the card: the word joins the vocabulary and every alert for it goes away', async ({ page }) => {
    await withSpelling(page, 'Run kubectl now. Then kubectl again. Click Next to recieve it.');
    await expect(alertCard(page, 'Vale.Spelling')).toHaveCount(3);
    await expect(page.locator('.cm-lintRange', { hasText: 'kubectl' })).toHaveCount(2);

    await alertCard(page, 'Vale.Spelling').filter({ hasText: 'kubectl' }).first().getByRole('button', { name: 'Accept “kubectl”' }).click();

    // both occurrences are cleared, the misspelling is not
    await expect(alertCard(page, 'Vale.Spelling')).toHaveCount(1);
    await expect(alertCard(page, 'Vale.Spelling')).toContainText('recieve');
    await expect(page.locator('.cm-lintRange', { hasText: 'kubectl' })).toHaveCount(0);
    await expect(page.locator('.cm-lintRange', { hasText: 'recieve' })).toHaveCount(1);
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 1');

    await openVocabulary(page);
    await expect(acceptList(page)).toHaveValue('kubectl');
    await closeVocabulary(page);

    // and the next review no longer flags it
    await editor(page).press('Control+Enter');
    await expect(alertCard(page, 'Vale.Spelling')).toHaveCount(1, { timeout: 15000 });
    await expect(alertCard(page, 'Vale.Spelling')).toContainText('recieve');
  });

  test('from the tooltip in the text', async ({ page }) => {
    await withSpelling(page, 'Run kubectl now.');
    await page.locator('.cm-lintRange', { hasText: 'kubectl' }).hover();
    await page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Accept “kubectl”' }).click();
    await expect(alertCard(page, 'Vale.Spelling')).toHaveCount(0);
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 1');
  });

  test('a real misspelling is not offered a fix that would corrupt the text', async ({ page }) => {
    await withSpelling(page, 'Click Next to recieve it.');
    // spelling alerts carry no replacement from Vale: the only action is to accept the word
    await expect(alertCard(page, 'Vale.Spelling').getByRole('button')).toHaveCount(1);
    expect(await docText(page)).toBe('Click Next to recieve it.');
  });
});

test.describe('importing and exporting', () => {
  test('exports the files exactly as Vale reads them', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes\nNode.js', 'utilize\nin order to');
    await openVocabulary(page);

    const [accept] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Download accept.txt' }).click()]);
    expect(accept.suggestedFilename()).toBe('accept.txt');
    expect(await (await accept.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))).toBe('Kubernetes\nNode\\.js\n');

    const [reject] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Download reject.txt' }).click()]);
    expect(reject.suggestedFilename()).toBe('reject.txt');
    expect(await (await reject.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))).toBe('(?i)utilize\n(?i)in order to\n');
  });

  test('there is nothing to download from an empty list', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await expect(dialog(page).getByRole('button', { name: 'Download accept.txt' })).toBeDisabled();
    await expect(dialog(page).getByRole('button', { name: 'Download reject.txt' })).toBeDisabled();
  });

  test('imports a file, merging with what is there, and reports regular expressions it skipped', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await acceptList(page).fill('Existing');
    await page.getByTestId('vocabulary-accept-file').setInputFiles({
      name: 'accept.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('# project terms\r\nKubernetes\r\n\r\n[Kk]ubectl\r\nNode\\.js\r\nExisting\r\nopen(shift)?\r\n'),
    });

    await expect(acceptList(page)).toHaveValue('Existing\nKubernetes\nNode.js');
    const status = dialog(page).getByRole('status');
    await expect(status).toContainText('2 terms imported.');
    await expect(status).toContainText('2 lines look like regular expressions and were not imported: [Kk]ubectl, open(shift)?');
  });

  test('says so when a file has no terms', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await page.getByTestId('vocabulary-reject-file').setInputFiles({ name: 'reject.txt', mimeType: 'text/plain', buffer: Buffer.from('\n# only a comment\n') });
    await expect(dialog(page).getByRole('status')).toContainText('No terms found in that file.');
  });

  test('what was exported can be imported again', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes\nNode.js\na|b', '');
    await openVocabulary(page);
    const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Download accept.txt' }).click()]);
    const content = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks));

    await acceptList(page).fill('');
    await page.getByTestId('vocabulary-accept-file').setInputFiles({ name: 'accept.txt', mimeType: 'text/plain', buffer: content });
    await expect(acceptList(page)).toHaveValue('Kubernetes\nNode.js\na|b');
  });
});

test.describe('keeping the vocabulary', () => {
  test('is restored after a reload, and used in the review', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes', 'utilize');
    await expect.poll(() => storedVocabulary(page)).toMatchObject({ accept: ['Kubernetes'], reject: ['utilize'] });

    await page.reload();
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 1 · Rejected: 1');
    await review(page, 'Please utilize kubernetes.');
    await expect(alertCard(page, 'Vale.Avoid')).toHaveCount(1, { timeout: 15000 });
    await expect(alertCard(page, 'Vale.Terms')).toHaveCount(1);
  });

  test('is kept when the draft is discarded, because it is configuration', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes', '');
    await setText(page, 'some text');
    await expect.poll(() => storedVocabulary(page)).not.toBeNull();
    await page.reload();
    await page.getByTestId('restored-notice').getByRole('button', { name: 'Start fresh' }).click();
    await page.getByTestId('restored-notice').getByRole('button', { name: 'Click again to discard' }).click();
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 1');
  });

  test('is removed, and not stored again, when autosave is turned off', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes', '');
    await expect.poll(() => storedVocabulary(page)).not.toBeNull();

    await page.getByLabel(/Save my draft in this browser/).uncheck();
    await expect.poll(() => storedVocabulary(page)).toBeNull();

    await setVocabulary(page, 'Kubernetes\nkubectl', '');
    await page.waitForTimeout(1200);
    expect(await storedVocabulary(page)).toBeNull();
    // it still works for this session
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 2');
  });

  test('returning to the defaults removes what was stored', async ({ page }) => {
    await page.goto('/');
    await setVocabulary(page, 'Kubernetes', '');
    await expect.poll(() => storedVocabulary(page)).not.toBeNull();
    await setVocabulary(page, '', '');
    await expect.poll(() => storedVocabulary(page)).toBeNull();
  });

  test('unreadable stored data is ignored', async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('seeded')) return;
      window.sessionStorage.setItem('seeded', '1');
      window.localStorage.setItem('verbalize:vocabulary:v1', '{"accept": 5');
    });
    await page.goto('/');
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 0 · Rejected: 0');
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('the dialog and its messages are translated', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await expect(dialog(page).getByRole('heading', { name: 'Vocabulário do projeto' })).toBeVisible();
    await acceptList(page).fill('C++\nKubernetes');
    await expect(dialog(page).getByTestId('vocabulary-issue')).toContainText('começa ou termina com um símbolo');
    await expect(dialog(page).getByRole('button', { name: 'Baixar accept.txt' })).toBeVisible();
    await expect(dialog(page).getByLabel('Verificar ortografia')).toBeVisible();
    await closeVocabulary(page);
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Aceitos: 2 · Rejeitados: 0');
  });

  test('the accept action and the fix are in Portuguese', async ({ page }) => {
    await page.goto('/');
    await openVocabulary(page);
    await acceptList(page).fill('Kubernetes');
    await dialog(page).getByLabel('Verificar ortografia').check();
    await closeVocabulary(page);
    await review(page, 'Run kubernetes and kubectl.');
    await expect(alertCard(page, 'Vale.Spelling').first()).toBeVisible({ timeout: 15000 });
    await expect(alertCard(page, 'Vale.Spelling').first().getByRole('button', { name: 'Aceitar “kubectl”' })).toBeVisible();
    await expect(alertCard(page, 'Vale.Terms').getByRole('button', { name: 'Substituir por “Kubernetes”' })).toBeVisible();
  });

  test('a vocabulary API error is explained in Portuguese', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await page.route('**/api/lint', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'x', code: 'vocabulary_too_many', params: { max: 500 } }) })
    );
    await setText(page, 'hello');
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.dismiss();
    });
    await page.getByRole('button', { name: /Revisar/ }).click();
    await expect.poll(() => message).toBe('A revisão falhou: O vocabulário tem termos demais. O máximo é 500 por lista.');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the dialog fits the screen and everything in it can be reached', async ({ page }) => {
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Edit vocabulary' }).click();
    await expect(dialog(page)).toBeVisible();

    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // the lists stack, text is 16 px so iOS does not zoom, and the Done button is reachable
    const accept = await acceptList(page).boundingBox();
    const reject = await rejectList(page).boundingBox();
    expect(reject!.y).toBeGreaterThan(accept!.y + accept!.height - 1);
    expect(await acceptList(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await dialog(page).getByRole('button', { name: 'Done' }).scrollIntoViewIfNeeded();
    await expect(dialog(page).getByRole('button', { name: 'Done' })).toBeInViewport();
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(dialog(page)).toBeHidden();
  });
});
