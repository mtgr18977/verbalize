import { test, expect } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';
import { docText, editor, review, setText } from './helpers/editor';

const DOC = 'We really use this in order to test it.\nThe file was deleted by the user.';
const toasts = (page: Page): Locator => page.getByTestId('toast');
const failWith = (status: number, code: string, params: Record<string, unknown> = {}) => (route: Route) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'x', code, params }) });

/** Every browser dialog that opens is recorded: there should be none. */
function watchDialogs(page: Page): string[] {
  const opened: string[] = [];
  page.on('dialog', (dialog) => {
    opened.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return opened;
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
}

test.describe('no browser dialogs', () => {
  test('are opened by any of the things that used to open them', async ({ page }) => {
    const opened = watchDialogs(page);
    await ready(page);

    // 1. reviewing nothing
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect(toasts(page)).toHaveCount(1);
    // 2. a failed review
    await page.route('**/api/lint', failWith(500, 'vale_failed'));
    await setText(page, DOC);
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect(page.getByTestId('toasts').getByRole('alert')).toBeVisible();
    // 3. no connection
    await page.unroute('**/api/lint');
    await page.route('**/api/lint', (route) => route.abort());
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect(page.getByTestId('toasts').getByRole('alert')).toContainText('Failed to connect');
    // 4. clearing the editor
    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect(toasts(page).filter({ hasText: 'Editor cleared.' })).toBeVisible();

    expect(opened).toEqual([]);
  });
});

test.describe('reviewing nothing', () => {
  test('says so, puts the cursor in the editor, and does not pile up', async ({ page }) => {
    await ready(page);
    const run = page.getByRole('button', { name: /Run Linting/ });
    await run.click();
    await run.click();
    await run.click();

    await expect(toasts(page)).toHaveCount(1);
    await expect(toasts(page)).toHaveText(/Please enter some text to lint\./);
    await expect(toasts(page)).toHaveAttribute('data-kind', 'info');
    await expect(editor(page)).toBeFocused();
  });
});

test.describe('a failed review', () => {
  test('is explained in a notice that stays until dismissed, and stays visible in the panel', async ({ page }) => {
    await page.route('**/api/lint', failWith(504, 'timeout', { seconds: 8 }));
    await ready(page);
    await review(page, DOC);

    const notice = page.getByTestId('toasts').getByRole('alert');
    await expect(notice).toContainText('Linting failed: Linting took longer than 8 s and was stopped. Lint a shorter section.');
    await expect(toasts(page)).toHaveAttribute('data-kind', 'error');
    // a time limit is not fixed by trying again
    await expect(notice.getByRole('button', { name: 'Try again' })).toHaveCount(0);

    // the panel and the status keep saying it after the notice is gone
    await expect(page.getByTestId('review-status')).toHaveText('Review failed');
    await notice.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(toasts(page)).toHaveCount(0);
    const panel = page.locator('#panel-alerts');
    await expect(panel).toContainText('The review failed');
    await expect(panel).toContainText('took longer than 8 s');
    await expect(page.getByTestId('review-status')).toHaveText('Review failed');
  });

  test('a busy server can be retried from the notice, and the notice goes away', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/lint', (route) => {
      calls += 1;
      return calls === 1 ? failWith(503, 'busy')(route) : route.continue();
    });
    await ready(page);
    await review(page, DOC);

    const notice = page.getByTestId('toasts').getByRole('alert');
    await expect(notice).toContainText('The linting service is busy.');
    await notice.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    expect(calls).toBe(2);
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
  });

  test('a lost connection can be retried from the panel too', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/lint', (route) => {
      calls += 1;
      return calls === 1 ? route.abort() : route.continue();
    });
    await ready(page);
    await review(page, DOC);
    await expect(page.getByTestId('toasts').getByRole('alert')).toContainText('Failed to connect to the linting service.');

    // the notice is dismissed, the panel still offers the way out
    await page.getByTestId('toasts').getByRole('alert').getByRole('button', { name: 'Dismiss notification' }).click();
    await page.locator('#panel-alerts').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#panel-alerts')).not.toContainText('The review failed');
  });

  test('a new review clears the old failure at once', async ({ page }) => {
    await page.route('**/api/lint', failWith(500, 'vale_failed'));
    await ready(page);
    await review(page, DOC);
    await expect(page.getByTestId('toasts').getByRole('alert')).toBeVisible();

    await page.unroute('**/api/lint');
    await editor(page).press('Control+Enter');
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    await expect(toasts(page)).toHaveCount(0);
  });

  test('clearing the editor also clears the failure', async ({ page }) => {
    await page.route('**/api/lint', failWith(500, 'vale_failed'));
    await ready(page);
    await review(page, DOC);
    await expect(page.getByTestId('review-status')).toHaveText('Review failed');

    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect(page.getByTestId('review-status')).toHaveText('Not reviewed');
    await expect(page.locator('#panel-alerts')).not.toContainText('The review failed');
  });
});

test.describe('clearing the editor', () => {
  test('happens at once, with no question, and can be undone', async ({ page }) => {
    await ready(page);
    await setText(page, DOC);
    await page.getByRole('button', { name: 'Clear editor' }).click();

    expect(await docText(page)).toBe('');
    const notice = toasts(page).filter({ hasText: 'Editor cleared.' });
    await expect(notice).toBeVisible();

    await notice.getByRole('button', { name: 'Undo' }).click();
    expect(await docText(page)).toBe(DOC);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('undo brings back the review too, with its underlines', async ({ page }) => {
    await ready(page);
    await review(page, DOC);
    await expect(page.getByTestId('alert-card').first()).toBeVisible({ timeout: 15000 });
    const alertCount = await page.getByTestId('alert-card').count();
    const underlined = await page.locator('.cm-lintRange').count();
    expect(underlined).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect(page.getByTestId('alert-card')).toHaveCount(0);
    await expect(page.locator('.cm-lintRange')).toHaveCount(0);

    await toasts(page).getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('alert-card')).toHaveCount(alertCount);
    await expect(page.locator('.cm-lintRange')).toHaveCount(underlined);
    await expect(page.getByTestId('review-status')).toContainText('Reviewed at');
  });

  test('the offer disappears when the user starts writing, so undo can never overwrite new work', async ({ page }) => {
    await ready(page);
    await setText(page, DOC);
    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect(toasts(page)).toHaveCount(1);

    await editor(page).click();
    await page.keyboard.type('New work.');
    await expect(toasts(page)).toHaveCount(0);
    expect(await docText(page)).toBe('New work.');
  });

  test('has nothing to undo when the editor is already empty', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect(toasts(page)).toHaveCount(0);
  });

  test('undo also puts the draft back in storage', async ({ page }) => {
    await ready(page);
    await setText(page, DOC);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('verbalize:draft:v1'))).toContain('We really');
    await page.getByRole('button', { name: 'Clear editor' }).click();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('verbalize:draft:v1'))).toBeNull();
    await toasts(page).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('verbalize:draft:v1'))).toContain('We really');
  });
});

test.describe('how notices behave', () => {
  test('are announced to assistive technology, and have a name', async ({ page }) => {
    await ready(page);
    const region = page.getByRole('region', { name: 'Notifications' });
    await expect(region).toHaveAttribute('aria-live', 'polite');

    await setText(page, DOC);
    await page.getByRole('button', { name: 'Clear editor' }).click();
    // an information notice is a status, an error is an alert
    await expect(region.getByRole('status').filter({ hasText: 'Editor cleared.' })).toBeVisible();
    await expect(region.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
  });

  test('an information notice leaves by itself, but waits while it is being read', async ({ page }) => {
    await ready(page);
    await page.clock.install();
    await setText(page, DOC);
    await page.getByRole('button', { name: 'Clear editor' }).click();
    const notice = toasts(page).filter({ hasText: 'Editor cleared.' });
    await expect(notice).toBeVisible();

    // hovering stops the countdown
    await notice.hover();
    await page.clock.fastForward(60_000);
    await expect(notice).toBeVisible();

    // leaving starts it again
    await page.mouse.move(5, 5);
    await page.clock.fastForward(11_000);
    await expect(notice).toHaveCount(0);
  });

  test('keyboard focus also stops the countdown', async ({ page }) => {
    await ready(page);
    await page.clock.install();
    await setText(page, DOC);
    await page.getByRole('button', { name: 'Clear editor' }).click();
    const notice = toasts(page).filter({ hasText: 'Editor cleared.' });
    await notice.getByRole('button', { name: 'Undo' }).focus();
    await page.clock.fastForward(60_000);
    await expect(notice).toBeVisible();
  });

  test('an error is never timed', async ({ page }) => {
    await page.route('**/api/lint', failWith(500, 'vale_failed'));
    await ready(page);
    await page.clock.install();
    await setText(page, DOC);
    await page.getByRole('button', { name: /Run Linting/ }).click();
    await expect(page.getByTestId('toasts').getByRole('alert')).toBeVisible();
    await page.clock.fastForward(10 * 60_000);
    await expect(page.getByTestId('toasts').getByRole('alert')).toBeVisible();
  });

  test('never take the focus away from what the user is doing', async ({ page }) => {
    await page.route('**/api/lint', failWith(500, 'vale_failed'));
    await ready(page);
    await editor(page).click();
    await page.keyboard.type('Writing along');
    await editor(page).press('Control+Enter');
    await expect(page.getByTestId('toasts').getByRole('alert')).toBeVisible();
    await expect(editor(page)).toBeFocused();
  });
});

test.describe('the accepted terms list is full', () => {
  test('is explained in a notice, and nothing is added', async ({ page }) => {
    const opened = watchDialogs(page);
    await ready(page);
    await page.getByRole('button', { name: 'Edit vocabulary' }).click();
    const dialog = page.getByRole('dialog', { name: 'Project vocabulary' });
    await dialog.getByTestId('vocabulary-accept').fill(Array.from({ length: 500 }, (_, i) => `term${i}x`).join('\n'));
    await dialog.getByLabel('Check spelling').check();
    await page.keyboard.press('Escape');

    await review(page, 'Run kubectl now.');
    const card = page.getByTestId('alert-card').filter({ hasText: 'Vale.Spelling' });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: 'Accept “kubectl”' }).click();

    await expect(page.getByTestId('toasts').getByRole('alert')).toContainText('The accepted terms list is full (500 terms). Remove one to add another.');
    await expect(page.getByTestId('vocabulary-summary')).toContainText('Accepted: 500');
    await expect(card).toBeVisible();
    expect(opened).toEqual([]);
  });
});

test.describe('in Portuguese', () => {
  test.use({ locale: 'pt-BR' });

  test('every notice and the failed state are translated', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: /Revisar/ }).click();
    await expect(toasts(page)).toHaveText(/Digite algum texto para revisar\./);
    await toasts(page).getByRole('button', { name: 'Dispensar notificação' }).click();

    await page.route('**/api/lint', failWith(503, 'busy'));
    await setText(page, DOC);
    await page.getByRole('button', { name: /Revisar/ }).click();
    const notice = page.getByTestId('toasts').getByRole('alert');
    await expect(notice).toContainText('A revisão falhou: O serviço de revisão está ocupado.');
    await expect(notice.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    await expect(page.getByTestId('review-status')).toHaveText('Revisão com falha');
    await expect(page.locator('#panel-alerts')).toContainText('A revisão falhou');

    await page.unroute('**/api/lint');
    await page.getByRole('button', { name: 'Limpar editor' }).click();
    await expect(toasts(page).filter({ hasText: 'Editor limpo.' }).getByRole('button', { name: 'Desfazer' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Notificações' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('notices sit above the tab bar and fit the screen', async ({ page }) => {
    await ready(page);
    await setText(page, DOC);
    await page.getByRole('button', { name: 'Clear editor' }).click();
    const notice = toasts(page).filter({ hasText: 'Editor cleared.' });
    await expect(notice).toBeVisible();

    const box = await notice.boundingBox();
    const bar = await page.getByRole('tablist', { name: 'Panels' }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // the buttons are big enough to touch
    for (const name of ['Undo', 'Dismiss notification']) {
      const button = await notice.getByRole('button', { name }).boundingBox();
      expect(button!.height).toBeGreaterThanOrEqual(32);
      expect(button!.width).toBeGreaterThanOrEqual(32);
    }
  });

  test('a failed review from the phone header is visible without switching panels', async ({ page }) => {
    await page.route('**/api/lint', failWith(500, 'vale_failed'));
    await ready(page);
    await setText(page, DOC);
    await page.getByRole('button', { name: /Run Linting/ }).click();
    // the editor tab stays open: the notice is what tells the user
    await expect(page.getByTestId('toasts').getByRole('alert')).toBeVisible();
    await expect(editor(page)).toBeVisible();
  });
});
