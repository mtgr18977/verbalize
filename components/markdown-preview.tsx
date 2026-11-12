'use client';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { useI18n } from '@/i18n/provider';

interface MarkdownPreviewProps {
  source: string;
}

/**
 * The Markdown preview. react-markdown does not render raw HTML, but `![alt](https://...)` becomes
 * an <img>, and the browser would fetch it as soon as the preview is drawn: a document with a
 * tracking pixel would learn the reader's address and when they opened it. So no image is ever
 * loaded; each one is shown as its alt text, the same way the AsciiDoc preview does.
 */
export function MarkdownPreview({ source }: MarkdownPreviewProps): React.JSX.Element {
  const { t } = useI18n();

  const components: Components = {
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
