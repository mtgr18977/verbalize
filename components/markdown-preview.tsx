'use client';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { useI18n } from '@/i18n/provider';
import { safeHttpUrl } from '@/lib/safe-url';

interface MarkdownPreviewProps {
  source: string;
}

/**
 * The Markdown preview. Two things a document can do to the person reading it are closed here, the
 * same way the AsciiDoc preview closes them:
 *
 *  - Images. react-markdown does not render raw HTML, but `![alt](https://...)` becomes an <img>,
 *    and the browser would fetch it as soon as the preview is drawn: a document with a tracking
 *    pixel would learn the reader's address and when they opened it. No image is ever loaded; each
 *    one is shown as its alt text.
 *  - Links. A web link opens in a new tab without access to this page (`noopener`) and without
 *    telling the site where the reader came from (`noreferrer`). Any other link (a relative path, an
 *    anchor, `mailto:`) would only take the reader away from the editor, so it stays as plain text.
 */
export function MarkdownPreview({ source }: MarkdownPreviewProps): React.JSX.Element {
  const { t } = useI18n();

  const components: Components = {
    a: ({ href, children }) => {
      const url = safeHttpUrl(href);
      return url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      );
    },
    img: ({ alt }) => {
      const text = typeof alt === 'string' ? alt.trim() : '';
      return <span className="preview-image">{text ? t('preview.imageWithAlt', { alt: text }) : t('preview.image')}</span>;
    },
  };

  return (
    <article className="prose prose-diagnostic">
      <ReactMarkdown components={components}>{source || t('preview.empty')}</ReactMarkdown>
    </article>
  );
}
