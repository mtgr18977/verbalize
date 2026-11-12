'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { useI18n } from '@/i18n/provider';

interface AsciidocPreviewProps {
  source: string;
}

type PreviewState = { status: 'loading' } | { status: 'ready'; html: string } | { status: 'failed' };

/** Wait this long after the last edit before building the preview: converting is not free. */
const PREVIEW_DELAY_MS = 250;

/**
 * Renders AsciiDoc the way Asciidoctor would, in the browser.
 *
 * Asciidoctor.js and DOMPurify are around 1 MB together, and only people who write AsciiDoc and
 * open the preview need them, so both are loaded the first time that happens. The document is
 * converted in secure mode (no file or network access) and the result is sanitized before it is
 * shown; see lib/asciidoc-html.ts for what is removed.
 */
export function AsciidocPreview({ source }: AsciidocPreviewProps): React.JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const isEmpty = source.trim().length === 0;

  useEffect(() => {
    if (isEmpty) return;
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const [{ convert }, { sanitizePreviewHtml }] = await Promise.all([import('@asciidoctor/core'), import('@/lib/asciidoc-html')]);
        const html = await convert(source, { safe: 'secure', standalone: false, attributes: ['showtitle', 'sectanchors!'] });
        if (cancelled) return;
        setState({
          status: 'ready',
          html: sanitizePreviewHtml(String(html), {
            image: t('preview.image'),
            imageWithAlt: (alt) => t('preview.imageWithAlt', { alt }),
          }),
        });
      } catch (error) {
        console.error('AsciiDoc preview failed:', error);
        if (!cancelled) setState({ status: 'failed' });
      }
    }, PREVIEW_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, isEmpty, t]);

  if (isEmpty) {
    return <p className="italic text-ink-2">{t('preview.emptyAsciidoc')}</p>;
  }
  if (state.status === 'failed') {
    return <p role="status" className="font-medium text-warn">{t('preview.failed')}</p>;
  }
  if (state.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
        <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {t('preview.loading')}
      </p>
    );
  }
  // The HTML was sanitized above, and nothing else reaches this attribute
  return <article data-testid="asciidoc-preview" className="prose prose-diagnostic asciidoc-preview" dangerouslySetInnerHTML={{ __html: state.html }} />;
}
