import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { CustomRule } from '@/types/lint';
import {
  DRAFT_KEY,
  IGNORED_RULES_KEY,
  PREFS_KEY,
  VOCABULARY_KEY,
  parseDraft,
  parsePrefs,
  readIgnoredRules,
  readStorage,
  readVocabulary,
  removeStorage,
  saveDraft,
  saveIgnoredRules,
  savePrefs,
  saveVocabulary,
} from '@/lib/draft-storage';
import type { DocumentFormat } from '@/lib/document-format';
import type { Vocabulary } from '@/types/vocabulary';

/** Wait this long after the last edit before writing, so typing does not hit storage per key. */
const SAVE_DELAY_MS = 600;

export type DraftStatus =
  | { kind: 'idle' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error' }
  | { kind: 'off' };

export interface RestoredDraft {
  text: string;
  customRules: CustomRule[];
  /** The style guide chosen last time, if any. */
  style: string | null;
  /** The format last used, if any. */
  format: DocumentFormat | null;
  /** The project vocabulary. Restored without a notice: it is configuration, not a draft. */
  vocabulary: Vocabulary | null;
  /** Rules the user ignores. Configuration too, so restored without a notice. */
  ignoredRules: string[] | null;
}

interface UseDraftAutosaveOptions {
  text: string;
  style: string;
  format: DocumentFormat;
  customRules: CustomRule[];
  vocabulary: Vocabulary;
  ignoredRules: string[];
  /** Called once, while rendering, with what was found in storage. */
  onRestore: (draft: RestoredDraft) => void;
}

export interface DraftAutosave {
  enabled: boolean;
  /** Turning it off also deletes the stored draft. */
  setEnabled: (enabled: boolean) => void;
  status: DraftStatus;
  /** When the restored draft was saved. Null once the user changes the text or dismisses it. */
  restoredAt: Date | null;
  dismissRestored: () => void;
  /** Deletes the stored draft. The caller clears the editor. */
  discard: () => void;
}

function subscribeNoop(): () => void {
  return () => {};
}

// Fires when another tab writes to storage. Only the first read matters: after the draft has been
// restored, later changes made elsewhere are ignored on purpose (last tab to save wins).
function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/**
 * Keeps the editor content, the uploaded rules and the style guide in this browser's storage.
 *
 * Saving only starts after the stored draft has been read, otherwise the empty editor of a fresh
 * page load would overwrite the draft it is about to restore.
 */
export function useDraftAutosave({ text, style, format, customRules, vocabulary, ignoredRules, onRestore }: UseDraftAutosaveOptions): DraftAutosave {
  // false on the server and during hydration, true afterwards
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const rawDraft = useSyncExternalStore(subscribeStorage, () => readStorage(DRAFT_KEY), () => null);
  const rawPrefs = useSyncExternalStore(subscribeStorage, () => readStorage(PREFS_KEY), () => null);
  const rawVocabulary = useSyncExternalStore(subscribeStorage, () => readStorage(VOCABULARY_KEY), () => null);
  const rawIgnoredRules = useSyncExternalStore(subscribeStorage, () => readStorage(IGNORED_RULES_KEY), () => null);

  const [restoreDone, setRestoreDone] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const [status, setStatus] = useState<DraftStatus>({ kind: 'idle' });
  const [restored, setRestored] = useState<{ at: Date; text: string } | null>(null);

  if (hydrated && !restoreDone) {
    setRestoreDone(true);
    const prefs = parsePrefs(rawPrefs);
    setEnabledState(prefs.autosave);
    if (!prefs.autosave) setStatus({ kind: 'off' });

    const draft = prefs.autosave ? parseDraft(rawDraft) : null;
    const storedVocabulary = prefs.autosave ? readVocabulary(rawVocabulary) : null;
    const storedIgnoredRules = prefs.autosave ? readIgnoredRules(rawIgnoredRules) : null;
    if (draft || prefs.style || prefs.format || storedVocabulary || storedIgnoredRules) {
      onRestore({
        text: draft?.text ?? '',
        customRules: draft?.customRules ?? [],
        style: prefs.style,
        format: prefs.format,
        vocabulary: storedVocabulary,
        ignoredRules: storedIgnoredRules,
      });
    }
    if (draft && (draft.text.length > 0 || draft.customRules.length > 0)) {
      setRestored({ at: new Date(draft.savedAt), text: draft.text });
    }
  }

  const active = hydrated && restoreDone && enabled;

  // Debounced save
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      const result = saveDraft(text, customRules);
      setStatus(
        result.outcome === 'saved'
          ? { kind: 'saved', at: new Date(result.savedAt) }
          : result.outcome === 'failed'
            ? { kind: 'error' }
            : { kind: 'idle' }
      );
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, text, customRules]);

  // The project vocabulary is kept like the draft: only while autosave is on
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => saveVocabulary(vocabulary), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, vocabulary]);

  // So are the ignored rules
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => saveIgnoredRules(ignoredRules), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, ignoredRules]);

  // Save right away when the page is hidden or closed: a timer may never get to run, and on
  // phones the browser can discard a background tab without warning.
  const latestRef = useRef({ text, customRules, vocabulary, ignoredRules, active });
  useEffect(() => {
    latestRef.current = { text, customRules, vocabulary, ignoredRules, active };
  });
  useEffect(() => {
    const flush = (): void => {
      const latest = latestRef.current;
      if (!latest.active) return;
      saveDraft(latest.text, latest.customRules);
      saveVocabulary(latest.vocabulary);
      saveIgnoredRules(latest.ignoredRules);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The style guide, the format and the autosave choice are preferences, kept even when there is no draft
  useEffect(() => {
    if (hydrated && restoreDone) savePrefs({ autosave: enabled, style, format });
  }, [hydrated, restoreDone, enabled, style, format]);

  const setEnabled = useCallback((next: boolean): void => {
    setEnabledState(next);
    if (next) {
      setStatus({ kind: 'idle' });
    } else {
      removeStorage(DRAFT_KEY);
      removeStorage(VOCABULARY_KEY);
      removeStorage(IGNORED_RULES_KEY);
      setRestored(null);
      setStatus({ kind: 'off' });
    }
  }, []);

  const discard = useCallback((): void => {
    removeStorage(DRAFT_KEY);
    setRestored(null);
    setStatus({ kind: 'idle' });
  }, []);

  const dismissRestored = useCallback((): void => setRestored(null), []);

  return {
    enabled,
    setEnabled,
    status,
    restoredAt: restored && restored.text === text ? restored.at : null,
    dismissRestored,
    discard,
  };
}
