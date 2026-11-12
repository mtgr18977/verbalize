import type { Locator, Page } from '@playwright/test';

/** The CodeMirror content element, found the way a screen reader would find it. */
export function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Document text' });
}

export async function setText(page: Page, text: string): Promise<void> {
  await editor(page).fill(text);
}

/** The document as plain text. `innerText` adds a newline for every empty line, so read the lines one by one. */
export async function docText(page: Page): Promise<string> {
  return page.locator('.cm-line').evaluateAll((lines) =>
    lines
      .map((line) => {
        // an empty editor shows its placeholder inside the first line: it is not document text
        const copy = line.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.cm-placeholder').forEach((node) => node.remove());
        return copy.textContent ?? '';
      })
      .join('\n')
  );
}

/** Types and runs a review with the keyboard shortcut. */
export async function review(page: Page, text: string): Promise<void> {
  await setText(page, text);
  await editor(page).press('Control+Enter');
}
