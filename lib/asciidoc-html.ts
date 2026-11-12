import DOMPurify from 'dompurify';

import { safeHttpUrl } from '@/lib/safe-url';

/**
 * Makes the HTML Asciidoctor produces safe to show in the preview.
 *
 * The document comes from the user, and AsciiDoc has passthrough blocks (`++++`) that let raw HTML
 * through even in secure mode, so the result is never trusted as it is. Everything that could run
 * code, start a request or restyle the page is removed:
 *  - scripts, frames, forms, SVG and MathML, stylesheets and inline `style`;
 *  - images, which would load remote files just by opening the preview (the author's tracking
 *    pixel learns your address): each one becomes its alt text;
 *  - ids, which are prefixed so a document cannot collide with the ids of the page itself.
 *
 * Links follow the same rule as the Markdown preview (components/markdown-preview.tsx): a web link
 * opens in a new tab without access to this page and without telling the site where the reader came
 * from; any other link (a relative path, `mailto:`, `javascript:`, `data:`) would only take the reader
 * away from the editor, so it stays as plain text. The one difference is a link to somewhere in the
 * same document (`#section`, a table of contents, a footnote): AsciiDoc gives its headings ids, so
 * those work, and they point at the prefixed ids.
 */

export interface PreviewLabels {
  /** "[image]" */
  image: string;
  /** "[image: {alt}]" with the alt text already put in */
  imageWithAlt: (alt: string) => string;
}

const ID_PREFIX = 'adoc-';
/** Marks a link that is not a web link or an anchor in the document, until it is unwrapped. */
const DEAD_LINK_ATTRIBUTE = 'data-preview-dead';

let purifier: ReturnType<typeof DOMPurify> | null = null;
let labels: PreviewLabels | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const instance = DOMPurify(window);

  instance.addHook('beforeSanitizeElements', (node) => {
    if (node.nodeName === 'IMG') {
      const alt = (node as Element).getAttribute('alt')?.trim() ?? '';
      const replacement = document.createElement('span');
      replacement.className = 'preview-image';
      replacement.textContent = alt ? (labels?.imageWithAlt(alt) ?? `[${alt}]`) : (labels?.image ?? '[image]');
      node.parentNode?.replaceChild(replacement, node);
    }
  });

  instance.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;

    const id = node.getAttribute('id');
    if (id) node.setAttribute('id', `${ID_PREFIX}${id}`);

    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      const web = safeHttpUrl(href);
      if (href.startsWith('#')) {
        node.setAttribute('href', `#${ID_PREFIX}${href.slice(1)}`);
      } else if (web) {
        node.setAttribute('href', web);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        // Not a link any more. DOMPurify has already dropped `javascript:` and similar addresses, so
        // an <a> without href that holds something is one of those: it is unwrapped after sanitizing.
        // (An empty <a id="..."> is an anchor Asciidoctor writes for a target: it stays.)
        node.removeAttribute('href');
        node.removeAttribute('target');
        node.removeAttribute('rel');
        if (node.textContent?.trim() || node.children.length > 0) node.setAttribute(DEAD_LINK_ATTRIBUTE, '');
      }
    }
  });

  purifier = instance;
  return instance;
}

export function sanitizePreviewHtml(html: string, previewLabels: PreviewLabels): string {
  labels = previewLabels;
  const fragment = getPurifier().sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'audio', 'video', 'source', 'svg', 'math'],
    FORBID_ATTR: ['style'],
    RETURN_DOM_FRAGMENT: true,
  });

  // Unwrap the links that are not links: the words stay, in the same place, as plain text
  fragment.querySelectorAll(`a[${DEAD_LINK_ATTRIBUTE}]`).forEach((link) => {
    const text = document.createElement('span');
    const id = link.getAttribute('id');
    if (id) text.setAttribute('id', id);
    text.append(...Array.from(link.childNodes));
    link.replaceWith(text);
  });

  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
}
