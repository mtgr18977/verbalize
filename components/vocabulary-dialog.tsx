'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';

import { useI18n } from '@/i18n/provider';
import {
  MAX_VOCABULARY_TERMS,
  MAX_VOCABULARY_TERM_LENGTH,
  buildVocabularyFiles,
  findIssues,
  normalizeTerms,
  parseTermLines,
  parseVocabularyFile,
} from '@/lib/vocabulary';
import type { Vocabulary, VocabularyList } from '@/types/vocabulary';

interface VocabularyDialogProps {
  open: boolean;
  onClose: () => void;
  vocabulary: Vocabulary;
  onChange: (vocabulary: Vocabulary) => void;
}

interface TermListProps {
  list: VocabularyList;
  title: string;
  help: string;
  vocabulary: Vocabulary;
  onChange: (vocabulary: Vocabulary) => void;
}

const MAX_ISSUES_SHOWN = 3;

const checkboxClass = 'mt-0.5 h-5 w-5 shrink-0 accent-accent lg:h-4 lg:w-4';
const smallButton =
  'inline-flex min-h-9 items-center gap-1.5 border border-rule px-2.5 text-sm font-medium text-ink hover:border-ink-2 hover:bg-paper disabled:cursor-not-allowed disabled:text-ink-2 disabled:hover:border-rule disabled:hover:bg-transparent lg:min-h-0 lg:py-1';

/** One list of terms: a textarea with one term per line, its problems, and import and download. */
function TermList({ list, title, help, vocabulary, onChange }: TermListProps): React.JSX.Element {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The text is kept here as typed: turning it into a normalized list on every key would eat the
  // blank line the user just typed to start a new term.
  const [text, setText] = useState(() => vocabulary[list].join('\n'));
  const [notice, setNotice] = useState('');

  const lines = parseTermLines(text);
  const terms = normalizeTerms(lines);
  const issues = findIssues(list, lines);
  const tooMany = terms.length > MAX_VOCABULARY_TERMS;
  const id = `vocabulary-${list}`;

  const commit = (nextText: string): void => {
    setText(nextText);
    onChange({ ...vocabulary, [list]: normalizeTerms(parseTermLines(nextText)).slice(0, MAX_VOCABULARY_TERMS) });
  };

  const importFile = async (file: File): Promise<void> => {
    const { terms: imported, skipped } = parseVocabularyFile(await file.text());
    if (imported.length === 0 && skipped.length === 0) {
      setNotice(t('vocab.importEmpty'));
      return;
    }
    const before = new Set(terms);
    const merged = normalizeTerms([...lines, ...imported]);
    commit(merged.join('\n'));
    // Count what is new: a term that was already in the list is not "imported"
    const parts = [t('vocab.imported', { count: merged.filter((term) => !before.has(term)).length })];
    if (skipped.length > 0) {
      parts.push(t('vocab.importSkipped', { count: skipped.length, lines: skipped.slice(0, 3).join(', ') }));
    }
    setNotice(parts.join(' '));
  };

  const download = (): void => {
    const content = buildVocabularyFiles(vocabulary)[list];
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${list}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const hasDownload = buildVocabularyFiles(vocabulary)[list].length > 0;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-bold text-ink">{title}</label>
        <span className={`font-mono text-xs ${tooMany ? 'font-semibold text-warn' : 'text-ink-2'}`}>
          {t('vocab.count', { count: terms.length, max: MAX_VOCABULARY_TERMS })}
        </span>
      </div>
      {/* Two lines tall beside the other list, so both text areas start at the same height */}
      <p id={`${id}-help`} className="text-xs text-ink-2 md:min-h-8">{help}</p>
      <textarea
        id={id}
        data-testid={id}
        value={text}
        onChange={(e) => commit(e.target.value)}
        aria-describedby={`${id}-help ${id}-issues`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={9}
        className="custom-scrollbar block w-full resize-y border border-rule bg-paper p-3 font-mono text-base leading-6 text-ink lg:text-sm"
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => fileInputRef.current?.click()} aria-label={t('vocab.importLabel', { list: title })} className={smallButton}>
          <Upload className="h-4 w-4" />
          {t('vocab.import')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          data-testid={`${id}-file`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
        <button type="button" onClick={download} disabled={!hasDownload} aria-label={t('vocab.downloadLabel', { file: `${list}.txt` })} className={smallButton}>
          <Download className="h-4 w-4" />
          {t('vocab.download')} {list}.txt
        </button>
      </div>

      <div id={`${id}-issues`} aria-live="polite" className="space-y-1 text-xs">
        {tooMany && <p className="font-medium text-warn">{t('vocab.tooMany', { max: MAX_VOCABULARY_TERMS })}</p>}
        {issues.slice(0, MAX_ISSUES_SHOWN).map((issue, index) => (
          <p key={`${issue.kind}:${issue.term}:${index}`} data-testid="vocabulary-issue" className="font-medium text-warn">
            {t(`vocab.issue.${issue.kind}`, { term: issue.term, max: MAX_VOCABULARY_TERM_LENGTH })}
          </p>
        ))}
        {issues.length > MAX_ISSUES_SHOWN && (
          <p className="text-ink-2">{t('vocab.issuesMore', { count: issues.length - MAX_ISSUES_SHOWN })}</p>
        )}
        {notice && <p role="status" className="text-ink-2">{notice}</p>}
      </div>
    </div>
  );
}

function VocabularyForm({ vocabulary, onChange, onClose }: Omit<VocabularyDialogProps, 'open'>): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="flex max-h-[inherit] flex-col">
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 id="vocabulary-title" className="text-base font-bold">{t('vocab.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('vocab.close')} className="p-2.5 text-ink-2 hover:bg-select hover:text-ink lg:p-1.5">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <p className="max-w-[70ch] text-sm text-ink-2">{t('vocab.intro')}</p>

        <div className="grid gap-6 md:grid-cols-2">
          <TermList list="accept" title={t('vocab.acceptTitle')} help={t('vocab.acceptHelp')} vocabulary={vocabulary} onChange={onChange} />
          <TermList list="reject" title={t('vocab.rejectTitle')} help={t('vocab.rejectHelp')} vocabulary={vocabulary} onChange={onChange} />
        </div>

        <div className="space-y-4 border-t border-rule pt-5">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={vocabulary.spelling}
              onChange={(e) => onChange({ ...vocabulary, spelling: e.target.checked })}
              className={checkboxClass}
            />
            <span>
              {t('vocab.spelling')}
              <span className="mt-0.5 block text-xs text-ink-2">{t('vocab.spellingHelp')}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={vocabulary.enforceCase}
              onChange={(e) => onChange({ ...vocabulary, enforceCase: e.target.checked })}
              className={checkboxClass}
            />
            <span>
              {t('vocab.enforceCase')}
              <span className="mt-0.5 block text-xs text-ink-2">{t('vocab.enforceCaseHelp')}</span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex justify-end border-t border-rule px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 border border-accent bg-accent px-5 text-sm font-bold text-on-accent hover:border-ink hover:bg-ink lg:min-h-0 lg:py-1.5"
        >
          {t('vocab.done')}
        </button>
      </div>
    </div>
  );
}

/**
 * The project vocabulary editor. It uses the native <dialog> element, which keeps keyboard focus
 * inside, closes with Escape and gives focus back to the button that opened it.
 */
export function VocabularyDialog({ open, onClose, vocabulary, onChange }: VocabularyDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="vocabulary-title"
      onClose={onClose}
      // A click on the dimmed area outside the box closes it
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-1.5rem)] w-[min(56rem,calc(100vw-1.5rem))] border border-ink bg-sheet p-0 text-ink backdrop:bg-ink/40"
    >
      {/* Rendered only while open, so each opening starts from what is stored */}
      {open && <VocabularyForm vocabulary={vocabulary} onChange={onChange} onClose={onClose} />}
    </dialog>
  );
}
