
import { test, expect } from '@playwright/test';

test('verify yellowish selection color and centered scroll', async ({ page }) => {
  await page.goto('/');

  const textarea = page.locator('textarea');

  const content = 'Line 1\n' + 'Wrap '.repeat(100) + '\n'.repeat(50) + 'Target Alert\n' + '\n'.repeat(50) + 'End';
  await textarea.fill(content);

  const result = await page.evaluate(() => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const content = textarea.value;
    const targetText = 'Target Alert';

    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(targetText)) {
        break;
      }
      offset += lines[i].length + 1;
    }

    const end = offset + targetText.length;

    const shadow = document.createElement('textarea');
    const style = window.getComputedStyle(textarea);
    const props = [
      'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'font-size', 'font-family', 'line-height', 'box-sizing',
      'word-wrap', 'white-space', 'letter-spacing', 'text-transform',
      'text-align', 'text-indent', 'overflow-wrap'
    ];
    props.forEach(prop => {
      shadow.style.setProperty(prop, style.getPropertyValue(prop));
    });
    shadow.style.position = 'absolute';
    shadow.style.visibility = 'hidden';
    shadow.style.height = '0';
    shadow.style.overflow = 'hidden';
    shadow.value = content.substring(0, end);
    document.body.appendChild(shadow);
    const selectionBottom = shadow.scrollHeight;
    document.body.removeChild(shadow);

    const scrollTo = selectionBottom - (textarea.clientHeight / 2);
    textarea.scrollTop = Math.max(0, scrollTo);

    const viewportMiddle = textarea.scrollTop + (textarea.clientHeight / 2);
    return {
        selectionBottom,
        scrollTop: textarea.scrollTop,
        clientHeight: textarea.clientHeight,
        scrollHeight: textarea.scrollHeight,
        viewportMiddle,
        diff: Math.abs(selectionBottom - viewportMiddle)
    };
  });

  if (process.env.DEBUG_UI_TESTS) {
    console.log('Result:', result);
  }
  expect(result.diff).toBeLessThan(5);
});
