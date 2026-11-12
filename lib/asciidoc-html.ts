import DOMPurify from 'dompurify';

/**
 * Makes the HTML Asciidoctor produces safe to show in the preview.
 *
 * The document comes from the user, and AsciiDoc has passthrough blocks (`++++`) that let raw HTML
 * through even in secure mode, so the result is never trusted as it is. Everything that could run
 * code, start a request or restyle the page is removed:
 *  - scripts, frames, forms, SVG and MathML, stylesheets and inline `style`;
 *  - images, which would load remote files just by opening the preview (the author's tracking
 *    pixel learns your address): each one becomes its alt text;
 *  - `javascript:`, `data:` and other non-web addresses in links (DOMPurify's default list);
 *  - ids, which are prefixed so a document cannot collide with the ids of the page itself.
 * External links open in a new tab without access to this page.
 */

export interface PreviewLabels {
  /** "[image]" */
  image: string;
  /** "[image: {alt}]" with the alt text already put in */
  imageWithAlt: (alt: string) => string;
}

const ID_PREFIX = 'adoc-';

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
      if (href.startsWith('#')) {
        node.setAttribute('href', `#${ID_PREFIX}${href.slice(1)}`);
      } else {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  purifier = instance;
  return instance;
}

export function sanitizePreviewHtml(html: string, previewLabels: PreviewLabels): string {
  labels = previewLabels;
  return getPurifier().sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'audio', 'video', 'source', 'svg', 'math'],
    FORBID_ATTR: ['style'],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}
