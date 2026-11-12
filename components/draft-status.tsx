'use client';

import { useEffect, useState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';

import type { DraftStatus } from '@/hooks/use-draft-autosave';

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
  if (status.kind === 'idle') return null;

  if (status.kind === 'off') {
    return (
      <span data-testid="draft-status" className="font-mono text-xs text-ink-2">
        Autosave off
      </span>
    );
  }

  if (status.kind === 'error') {
    return (
      <span
        data-testid="draft-status"
        title="The browser blocked or filled its storage, so this draft only exists in this tab. Copy your text somewhere safe."
        className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-warn"
      >
        <TriangleAlert className="h-3 w-3" />
        Not saved
      </span>
    );
  }

  const time = status.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span data-testid="draft-status" className="inline-flex items-center gap-1 font-mono text-xs text-ink-2">
      <Check className="h-3 w-3" />
      Saved<span className="hidden sm:inline">&nbsp;{time}</span>
    </span>
  );
}

/** Shown after a draft was restored. Discarding takes two clicks, so it cannot happen by accident. */
export function RestoredNotice({ restoredAt, onDismiss, onDiscard }: RestoredNoticeProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const when = restoredAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div
      role="status"
      data-testid="restored-notice"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule bg-paper px-4 py-1.5 text-sm text-ink"
    >
      <span>Restored your draft from {when}.</span>
      <span className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={confirming ? onDiscard : () => setConfirming(true)}
          className="min-h-9 px-1 font-medium text-accent underline underline-offset-2 lg:min-h-0"
        >
          {confirming ? 'Click again to discard' : 'Start fresh'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-2 text-ink-2 hover:bg-select hover:text-ink lg:p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}
