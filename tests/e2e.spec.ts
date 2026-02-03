
import { test, expect } from '@playwright/test';

test.describe('Writer Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should have the correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Writer Assistant/);
  });

  test('should toggle dark mode correctly', async ({ page }) => {
    const html = page.locator('html');
    const themeToggle = page.getByTitle('Toggle Theme');

    // Initial state might be light or system
    const isInitialDark = await html.evaluate(el => el.classList.contains('dark'));

    await themeToggle.click();

    // next-themes might take a moment to update class
    await expect(async () => {
      const isDarkAfter = await html.evaluate(el => el.classList.contains('dark'));
      expect(isDarkAfter).not.toBe(isInitialDark);
    }).toPass();
  });

  test('should perform basic linting', async ({ page }) => {
    const editor = page.locator('textarea');
    await editor.fill('We use this in order to test the linting.');

    // Match the button by text as it's rendered with uppercase CSS but the source text is "Run Linting"
    const lintButton = page.getByText('Run Linting');
    await lintButton.click();

    // Wait for the results column to show alerts
    const alertCards = page.locator('.p-4.rounded-xl.border');
    await expect(alertCards.first()).toBeVisible({ timeout: 15000 });

    const count = await alertCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('API should handle custom rules', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/lint', {
      data: {
        text: 'This is extremely very good.',
        style: 'Google',
        customRules: [
          {
            name: 'test-rule.yml',
            content: `extends: existence
message: "Avoid using '%s'"
level: error
tokens:
  - extremely`
          }
        ]
      }
    });

    expect(response.ok()).toBeTruthy();
    const results = await response.json();
    expect(Array.isArray(results)).toBeTruthy();
    expect(results.some((a: any) => a.Check === 'Custom.test-rule')).toBeTruthy();
  });
});
