'use client';

import { useEffect, useState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';

import type { DraftStatus } from '@/hooks/use-draft-autosave';
import { useI18n } from '@/i18n/provider';

interface DraftStatusLabelProps {
  status: DraftStatus;
}

interface RestoredNoticeProps {
  restoredAt: Date;
  onDismiss: () => void;
  onDiscard: () => void;
}

/** Tells whether the draft is safe in this browser. Shows nothing until there is something to say. */
export function DraftStatusLabel({ status }: DraftStatusLabelProps): React.JSX.Element | null {
  const { t, formatTime } = useI18n();

  if (status.kind === 'idle') return null;

  if (status.kind === 'off') {
    return (
      <span data-testid="draft-status" className="font-mono text-xs text-ink-2">
        {t('draft.off')}
      </span>
    );
  }

  if (status.kind === 'error') {
    return (
      <span
        data-testid="draft-status"
        title={t('draft.notSavedHelp')}
        className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-warn"
      >
        <TriangleAlert className="h-3 w-3" />
        {t('draft.notSaved')}
      </span>
    );
  }

  return (
    <span data-testid="draft-status" className="inline-flex items-center gap-1 font-mono text-xs text-ink-2">
      <Check className="h-3 w-3" />
      {t('draft.saved')}
      <span className="hidden sm:inline">&nbsp;{formatTime(status.at)}</span>
    </span>
  );
}

/** Shown after a draft was restored. Discarding takes two clicks, so it cannot happen by accident. */
export function RestoredNotice({ restoredAt, onDismiss, onDiscard }: RestoredNoticeProps): React.JSX.Element {
  const { t, formatDateTime } = useI18n();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <div
      role="status"
      data-testid="restored-notice"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule bg-paper px-4 py-1.5 text-sm text-ink"
    >
      <span>{t('draft.restored', { when: formatDateTime(restoredAt) })}</span>
      <span className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={confirming ? onDiscard : () => setConfirming(true)}
          className="min-h-9 px-1 font-medium text-accent underline underline-offset-2 lg:min-h-0"
        >
          {confirming ? t('draft.confirmDiscard') : t('draft.startFresh')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('draft.dismiss')}
          className="p-2 text-ink-2 hover:bg-select hover:text-ink lg:p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}
