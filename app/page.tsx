'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from 'next-themes';
import { Sun, Moon, Upload, Copy, Check, Trash2, Settings, PlayCircle, ExternalLink, FileText, FileSearch, LoaderCircle, TriangleAlert, X } from 'lucide-react';

import { DraftStatusLabel, RestoredNotice } from '@/components/draft-status';
import { LintEditor } from '@/components/lint-editor';
import type { LintEditorHandle } from '@/components/lint-editor';
import { useDraftAutosave } from '@/hooks/use-draft-autosave';
import { describeApiError } from '@/i18n/api-error';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/i18n/locale';
import { useI18n } from '@/i18n/provider';
import type { Translate } from '@/i18n/translate';
import type { AlertPosition, CustomRule, ReviewAlert, ValeAlert } from '@/types/lint';
import { describeFix, getFixes } from '@/lib/vale-fixes';
import { safeHttpUrl } from '@/lib/safe-url';

/** What was linted, so the UI can tell when the results no longer match the editor. */
interface ReviewSnapshot {
  text: string;
  style: string;
  rulesKey: string;
  at: Date;
}

interface PanelMessageProps {
  icon: React.ReactNode;
  title: string;
  detail: string;
}

interface SeverityTone {
  /** Text color of the label and of the ^^^ pointer */
  text: string;
  /** Underline shape: severity is readable without color */
  decoration: string;
}

type ViewMode = 'editor' | 'preview' | 'alerts';

interface TabButtonProps {
  mode: ViewMode;
  scope: 'desktop' | 'mobile';
  selected: boolean;
  onSelect: (mode: ViewMode) => void;
  className: string;
  children: React.ReactNode;
}

interface Snippet {
  gutter: string;
  code: string;
  pointer: string;
}

const STYLE_OPTIONS = [
  { value: 'Google', label: 'Google Developer' },
  { value: 'Microsoft', label: 'Microsoft Writing' },
  { value: 'RedHat', label: 'Red Hat Style' },
] as const;

// Matches Tailwind's `lg` breakpoint: below it the layout is a single column with tabs
const DESKTOP_QUERY = '(min-width: 1024px)';
const TAB_ORDER_DESKTOP: ViewMode[] = ['editor', 'preview'];
const TAB_ORDER_MOBILE: ViewMode[] = ['editor', 'preview', 'alerts'];

const SNIPPET_CHARS_BEFORE = 30;
const SNIPPET_CHARS_AFTER = 40;

function subscribeNoop(): () => void {
  return () => {};
}

function subscribeDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getDesktopSnapshot(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

// The server cannot know the screen size: assume desktop. Visibility is driven by CSS,
// this value only decides which collapsed controls are made inert.
function getDesktopServerSnapshot(): boolean {
  return true;
}

function getRulesKey(rules: CustomRule[]): string {
  return rules.map((rule) => `${rule.name}\u0000${rule.content}`).join('\u0001');
}

function getSeverityTone(severity: string): SeverityTone {
  if (severity === 'error') return { text: 'text-err', decoration: 'decoration-wavy' };
  if (severity === 'warning') return { text: 'text-warn', decoration: 'decoration-dashed' };
  return { text: 'text-ink-2', decoration: 'decoration-dotted' };
}

/** Vale reports severities in English; the interface shows them in its own language. */
function getSeverityLabel(severity: string, t: Translate): string {
  if (severity === 'error') return t('severity.error');
  if (severity === 'warning') return t('severity.warning');
  if (severity === 'suggestion') return t('severity.suggestion');
  return severity;
}

/** Builds the compiler-style excerpt: the offending line with a ^^^ pointer under the match. */
function buildSnippet(line: string, span: [number, number], lineNumber: number): Snippet {
  const flat = line.replace(/\t/g, ' ');
  // Vale spans are 1-based and inclusive
  const startIndex = Math.max(0, span[0] - 1);
  const endIndex = Math.min(flat.length, Math.max(startIndex + 1, span[1]));
  const from = Math.max(0, startIndex - SNIPPET_CHARS_BEFORE);
  const to = Math.min(flat.length, endIndex + SNIPPET_CHARS_AFTER);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < flat.length ? '…' : '';

  return {
    gutter: String(lineNumber),
    code: `${prefix}${flat.slice(from, to)}${suffix}`,
    pointer: `${' '.repeat(prefix.length + startIndex - from)}${'^'.repeat(Math.max(1, endIndex - startIndex))}`,
  };
}

function PanelMessage({ icon, title, detail }: PanelMessageProps): React.JSX.Element {
  return (
    <div role="status" className="p-6">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
      </p>
      <p className="mt-2 text-sm text-ink-2 max-w-[34ch]">{detail}</p>
    </div>
  );
}

function TabButton({ mode, scope, selected, onSelect, className, children }: TabButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={`${scope}-tab-${mode}`}
      data-tab={mode}
      aria-selected={selected}
      aria-controls={`panel-${mode}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(mode)}
      className={className}
    >
      {children}
    </button>
  );
}

/** Label for the small column headers: sentence case, at least 12 px */
function ColumnLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-xs font-semibold text-ink-2">{children}</span>;
}

export default function Home() {
  const [text, setText] = useState('');
  const [style, setStyle] = useState('Google');
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [results, setResults] = useState<ReviewAlert[]>([]);
  // Alerts fixed with one click: hidden from the list until the next review
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<number>>(() => new Set());
  // Where each alert is in the document now. The editor keeps these up to date while the user types.
  const [positions, setPositions] = useState<Map<number, AlertPosition>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // null = the user has not chosen yet: open on desktop, closed (a drawer) on mobile
  const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
  const [view, setView] = useState<ViewMode>('editor');
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getDesktopServerSnapshot);
  const sidebarVisible = sidebarOpen ?? isDesktop;
  // false on the server and during hydration, true afterwards: avoids a theme-icon mismatch
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const { t, locale, setLocale, formatTime } = useI18n();
  // `theme` is "system" until the user picks one; `resolvedTheme` is what is actually shown
  const { resolvedTheme, setTheme } = useTheme();

  // Keeps the text, the uploaded rules and the style guide in this browser, and restores them on load
  const draft = useDraftAutosave({
    text,
    style,
    customRules,
    onRestore: (restored) => {
      setText(restored.text);
      setCustomRules(restored.customRules);
      if (restored.style && STYLE_OPTIONS.some((option) => option.value === restored.style)) setStyle(restored.style);
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const editorHandleRef = useRef<LintEditorHandle>(null);
  const pendingRevealRef = useRef<number | null>(null);

  const handleLint = useCallback(async (): Promise<void> => {
    if (loading) return;
    if (!text.trim()) {
      alert(t('error.emptyText'));
      return;
    }

    // Normalize newlines to \n to ensure consistent line/column reporting from Vale
    const normalizedText = text.replace(/\r\n/g, '\n');
    if (normalizedText !== text) {
      setText(normalizedText);
    }

    setLoading(true);
    setResults([]);
    setResolvedIds(new Set());
    setPositions(new Map());
    setSnapshot(null);
    try {
      const response = await fetch('/api/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizedText, style, customRules }),
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data)) {
        setResults((data as ValeAlert[]).map((alert, id) => ({ ...alert, id })));
        setSnapshot({ text: normalizedText, style, rulesKey: getRulesKey(customRules), at: new Date() });
        // On a phone the results are on another tab: take the user there
        if (!window.matchMedia(DESKTOP_QUERY).matches) setView('alerts');
      } else {
        console.error('Linting error:', data);
        alert(t('error.lintFailed', { message: describeApiError(data, t) }));
      }
    } catch (error) {
      console.error('Failed to lint:', error);
      alert(t('error.connection'));
    } finally {
      setLoading(false);
    }
  }, [loading, text, style, customRules, t]);

  // Ctrl/Cmd + Enter runs the review from anywhere, including with the sidebar closed
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleLint();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleLint]);

  // On a phone the settings are a drawer: Escape closes it
  useEffect(() => {
    if (sidebarOpen !== true || isDesktop) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, isDesktop]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCustomRules(prev => [...prev, { name: file.name, content }]);
      };
      reader.readAsText(file);
    });
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string).replace(/\r\n/g, '\n');
      setText(content);
    };
    reader.readAsText(file);
    if (docInputRef.current) docInputRef.current.value = '';
  };

  const removeCustomRule = (index: number) => {
    setCustomRules(prev => prev.filter((_, i) => i !== index));
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // "Start fresh" on the restored-draft notice: forget the stored draft and empty the editor
  const discardDraft = (): void => {
    draft.discard();
    setText('');
    setCustomRules([]);
    setResults([]);
    setResolvedIds(new Set());
    setSnapshot(null);
  };

  const clearEditor = () => {
    if (text && confirm(t('editor.confirmClear'))) {
      setText('');
      setResults([]);
      setResolvedIds(new Set());
      setSnapshot(null);
    }
  };

  // On a phone the keyboard stays closed: the selection is shown without focusing the editor
  const revealAlert = (id: number): void => {
    editorHandleRef.current?.reveal(id, { focus: isDesktop });
  };

  const handleAlertClick = (alert: ReviewAlert, e: React.MouseEvent) => {
    // Prevent the click from being handled by parent elements if we clicked a link or a button
    if ((e.target as HTMLElement).closest('a, button')) return;

    e.preventDefault();
    e.stopPropagation();

    if (view === 'editor') {
      revealAlert(alert.id);
    } else {
      // The editor is hidden (preview or alerts tab): show it first, then select the text
      pendingRevealRef.current = alert.id;
      setView('editor');
    }
  };

  // Runs once the editor is visible again, because a hidden editor cannot scroll to the text
  useEffect(() => {
    if (view === 'editor' && pendingRevealRef.current !== null) {
      const id = pendingRevealRef.current;
      pendingRevealRef.current = null;
      revealAlert(id);
    }
  });

  const markResolved = useCallback((id: number): void => {
    setResolvedIds((previous) => new Set(previous).add(id));
  }, []);

  const handleTabKeys = (event: React.KeyboardEvent<HTMLElement>, order: ViewMode[]): void => {
    const current = order.indexOf(view);
    const lastIndex = order.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight') next = current >= lastIndex ? 0 : current + 1;
    if (event.key === 'ArrowLeft') next = current <= 0 ? lastIndex : current - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = lastIndex;
    if (next < 0) return;

    event.preventDefault();
    setView(order[next]);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${order[next]}"]`)?.focus();
  };

  // Review state: results only count as current while the editor, style and rules still match
  const normalizedText = text.replace(/\r\n/g, '\n');
  const isStale =
    snapshot !== null &&
    (snapshot.text !== normalizedText || snapshot.style !== style || snapshot.rulesKey !== getRulesKey(customRules));
  const textChanged = snapshot !== null && snapshot.text !== normalizedText;
  const styleLabel = STYLE_OPTIONS.find((option) => option.value === style)?.label ?? style;
  const visibleAlerts = useMemo(() => results.filter((alert) => !resolvedIds.has(alert.id)), [results, resolvedIds]);
  const currentLines = useMemo(() => normalizedText.split('\n'), [normalizedText]);
  const reviewedLines = useMemo(() => (snapshot ? snapshot.text.split('\n') : []), [snapshot]);
  const lineStarts = useMemo(() => {
    const starts = [0];
    for (let i = 0; i < normalizedText.length; i += 1) {
      if (normalizedText.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  }, [normalizedText]);

  /** Line and column (both 1-based) of a document offset, by binary search over the line starts. */
  const locate = (offset: number): { line: number; column: number } => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };

  const reviewTime = snapshot ? formatTime(snapshot.at) : '';
  const runLabel = t('header.run');
  // Replaces the old "Live Editor" badge: the status always reflects the real state of the text
  const statusLabel = loading
    ? t('status.reviewing')
    : snapshot === null
      ? t('status.notReviewed')
      : isStale
        ? t('status.outOfDate')
        : t('status.reviewedAt', { time: reviewTime });

  const renderEmptyState = (): React.JSX.Element => {
    if (loading) {
      return (
        <PanelMessage
          icon={<LoaderCircle className="w-4 h-4 text-accent animate-spin motion-reduce:animate-none" />}
          title={t('alerts.reviewingTitle')}
          detail={t('alerts.reviewingDetail', { style: styleLabel })}
        />
      );
    }
    if (snapshot === null) {
      return (
        <PanelMessage
          icon={<FileSearch className="w-4 h-4 text-ink-2" />}
          title={t('alerts.notReviewedTitle')}
          detail={t('alerts.notReviewedDetail', { run: runLabel, style: styleLabel })}
        />
      );
    }
    if (isStale) {
      return (
        <PanelMessage
          icon={<FileSearch className="w-4 h-4 text-ink-2" />}
          title={t('alerts.noOpenTitle')}
          detail={t('alerts.noOpenDetail', { run: runLabel })}
        />
      );
    }
    const lineCount = snapshot.text.split('\n').length;
    return (
      <PanelMessage
        icon={<Check className="w-4 h-4 text-accent" />}
        title={t('alerts.noAlertsTitle', { count: lineCount })}
        detail={t('alerts.noAlertsDetail', { time: reviewTime, style: styleLabel })}
      />
    );
  };

  const staleMessage = t(textChanged ? 'alerts.staleText' : 'alerts.staleRules', { run: runLabel });

  const secondaryButton =
    'flex w-full items-center justify-center gap-2 border border-rule bg-transparent px-3 py-2.5 text-sm font-medium text-ink hover:border-ink-2 hover:bg-paper';
  // Larger touch targets on phones, compact on desktop
  const iconButton = 'p-2.5 text-ink-2 hover:bg-select hover:text-ink lg:p-1.5';

  const tabClass = (selected: boolean): string =>
    `flex h-full items-center px-4 text-sm font-semibold border-b-2 ${
      selected ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
    }`;
  const mobileTabClass = (selected: boolean): string =>
    `flex flex-1 items-center justify-center gap-2 border-t-2 py-3 text-sm font-semibold ${
      selected ? 'border-accent text-ink' : 'border-transparent text-ink-2'
    }`;

  // Mobile shows one panel at a time. On desktop the alerts are always visible next to the
  // editor, and the editor/preview tabs switch the left pane.
  const documentPaneClass = view === 'alerts' ? 'hidden lg:flex' : 'flex';
  const alertsPaneClass = view === 'alerts' ? 'flex' : 'hidden lg:flex';

  return (
    <div className="flex h-dvh overflow-hidden bg-paper font-sans text-ink">
      {/* Backdrop for the mobile drawer */}
      {sidebarOpen === true && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-ink/40 lg:hidden"
        />
      )}

      {/* Settings: a drawer on phones, a column on desktop. `inert` keeps hidden controls out of the tab order. */}
      <aside
        inert={!sidebarVisible}
        aria-label={t('settings.title')}
        className={`fixed inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col overflow-hidden border-r border-rule bg-sheet transition-[transform,width] duration-200 motion-reduce:transition-none lg:static lg:z-auto ${
          sidebarOpen === true ? 'translate-x-0' : '-translate-x-full'
        } ${sidebarOpen === false ? 'lg:w-0 lg:translate-x-0' : 'lg:w-72 lg:translate-x-0'}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-5">
          <h2 className="text-base font-bold text-ink">{t('settings.title')}</h2>
          <button onClick={() => setSidebarOpen(false)} aria-label={t('settings.close')} className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 space-y-7 overflow-y-auto p-5">
          {/* Style Guide Selection */}
          <div className="space-y-2">
            <label htmlFor="style-guide" className="block text-xs font-semibold text-ink-2">{t('settings.styleGuide')}</label>
            {/* 16 px on phones: smaller text makes iOS zoom the page when a field is focused */}
            <select
              id="style-guide"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full cursor-pointer border border-rule bg-paper px-3 py-2.5 text-base font-medium text-ink lg:text-sm"
            >
              {STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-xs text-ink-2">{t('settings.styleGuideHelp')}</p>
          </div>

          {/* Document Upload */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-ink-2">{t('settings.document')}</span>
            <button onClick={() => docInputRef.current?.click()} className={secondaryButton}>
              <FileText className="h-4 w-4" />
              <span>{t('settings.uploadDocument')}</span>
            </button>
            <input
              type="file"
              ref={docInputRef}
              onChange={handleDocUpload}
              accept=".md,.mdx"
              className="hidden"
            />
          </div>

          {/* Custom Rules */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-ink-2">{t('settings.customRules')}</span>
              <a
                href="/example-style.yml"
                download
                className="text-xs font-medium text-accent underline underline-offset-2"
              >
                {t('settings.downloadExample')}
              </a>
            </div>

            {customRules.length > 0 && (
              <ul className="border-t border-rule">
                {customRules.map((rule, idx) => (
                  <li key={idx} className="flex items-center justify-between border-b border-rule py-1.5">
                    <span className="mr-2 truncate font-mono text-xs text-ink">{rule.name}</span>
                    <button onClick={() => removeCustomRule(idx)} aria-label={t('settings.removeRule', { name: rule.name })} className="p-2 text-ink-2 hover:text-err lg:p-1">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 border border-dashed border-ink-2 px-3 py-3 text-sm font-medium text-ink-2 hover:border-ink hover:text-ink"
            >
              <Upload className="h-4 w-4" />
              <span>{t('settings.uploadRule')}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".yml"
              className="hidden"
              multiple
            />
          </div>

          {/* Drafts */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-ink-2">{t('settings.drafts')}</span>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => draft.setEnabled(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-accent lg:h-4 lg:w-4"
              />
              <span>
                {t('settings.saveDraft')}
                <span className="mt-0.5 block text-xs text-ink-2">{t('settings.saveDraftHelp')}</span>
              </span>
            </label>
          </div>

          {/* Language: the label is bilingual so it can be found from the wrong language */}
          <div className="space-y-2">
            <label htmlFor="language" className="block text-xs font-semibold text-ink-2">{t('settings.language')}</label>
            <select
              id="language"
              value={locale}
              onChange={(e) => {
                if (isLocale(e.target.value)) setLocale(e.target.value);
              }}
              className="w-full cursor-pointer border border-rule bg-paper px-3 py-2.5 text-base font-medium text-ink lg:text-sm"
            >
              {LOCALES.map((code) => (
                <option key={code} value={code} lang={code}>{LOCALE_NAMES[code]}</option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-rule bg-sheet px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            {/* Always available on phones; on desktop only after the sidebar was closed */}
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label={t('settings.open')}
              className={`${iconButton} ${sidebarOpen === false ? '' : 'lg:hidden'}`}
            >
              <Settings className="h-5 w-5" />
            </button>
            {/* The wavy underline is the universal "linter found something" mark */}
            <h1 className="font-mono text-base font-semibold text-ink underline decoration-err decoration-wavy decoration-[1.5px] underline-offset-[5px] sm:text-lg">
              verbalize
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span
              data-testid="review-status"
              className={`hidden font-mono text-xs sm:inline ${isStale ? 'font-semibold text-warn' : 'text-ink-2'}`}
            >
              {statusLabel}
            </span>
            <button
              onClick={() => void handleLint()}
              disabled={loading}
              title={t('header.runTitle')}
              className="flex items-center gap-2 border border-accent bg-accent px-3 py-2 text-sm font-bold text-on-accent hover:bg-ink hover:border-ink disabled:cursor-wait disabled:bg-ink-2 disabled:border-ink-2 sm:px-4 lg:py-1.5"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <PlayCircle className="h-4 w-4" />}
              <span>{loading ? t('header.running') : runLabel}</span>
              <kbd className="hidden font-mono text-xs font-normal md:inline">Ctrl ↵</kbd>
            </button>
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="border border-rule p-2.5 text-ink-2 hover:border-ink-2 hover:text-ink lg:p-1.5"
                title={t('header.toggleTheme')}
                aria-label={t('header.toggleTheme')}
              >
                {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            )}
          </div>
        </header>

        {/* One panel at a time on phones; document (editor or preview) beside the alerts on desktop */}
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30%)]">

          {/* Document: editor or preview */}
          <section aria-label={t('editor.documentRegion')} className={`${documentPaneClass} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sheet lg:border-r lg:border-rule`}>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-rule bg-paper pl-4 pr-2 lg:pl-0">
              <div className="flex h-full items-center">
                <div
                  role="tablist"
                  aria-label={t('editor.documentView')}
                  onKeyDown={(e) => handleTabKeys(e, TAB_ORDER_DESKTOP)}
                  className="hidden h-full lg:flex"
                >
                  <TabButton mode="editor" scope="desktop" selected={view !== 'preview'} onSelect={setView} className={tabClass(view !== 'preview')}>{t('editor.editor')}</TabButton>
                  <TabButton mode="preview" scope="desktop" selected={view === 'preview'} onSelect={setView} className={tabClass(view === 'preview')}>{t('editor.preview')}</TabButton>
                </div>
                <span className="lg:hidden"><ColumnLabel>{view === 'preview' ? t('editor.preview') : t('editor.editor')}</ColumnLabel></span>
                <span className="ml-3 font-mono text-xs text-ink-2">{t('editor.chars', { count: text.length })}</span>
                <span className="ml-3"><DraftStatusLabel status={draft.status} /></span>
              </div>
              {view !== 'preview' && (
                <div className="flex gap-1">
                  <button onClick={copyToClipboard} title={t('editor.copy')} aria-label={t('editor.copy')} className={`${iconButton} ${copied ? 'text-accent' : ''}`}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button onClick={clearEditor} title={t('editor.clear')} aria-label={t('editor.clear')} className={`${iconButton} hover:text-err`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {draft.restoredAt && (
              <RestoredNotice restoredAt={draft.restoredAt} onDismiss={draft.dismissRestored} onDiscard={discardDraft} />
            )}

            <div id="panel-editor" role="tabpanel" aria-label={t('editor.editor')} className={`${view === 'preview' ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}>
              <LintEditor
                ref={editorHandleRef}
                // 16 px on phones: smaller text makes iOS zoom the page when the editor is focused
                className="min-h-0 flex-1 overflow-hidden text-base lg:text-[14.5px]"
                value={text}
                onChange={setText}
                alerts={results}
                reviewedText={snapshot?.text ?? null}
                onPositionsChange={setPositions}
                onFixApplied={markResolved}
                placeholderText={t('editor.placeholder')}
                ariaLabel={t('editor.ariaLabel')}
              />
            </div>

            <div id="panel-preview" role="tabpanel" aria-label={t('editor.preview')} className={`${view === 'preview' ? 'block' : 'hidden'} custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5 lg:p-8`}>
              <article className="prose prose-diagnostic">
                {/* ReactMarkdown is secure by default as it does not render HTML unless explicitly configured with rehype-raw */}
                <ReactMarkdown>{text || t('preview.empty')}</ReactMarkdown>
              </article>
            </div>
          </section>

          {/* Alerts */}
          <section id="panel-alerts" role="tabpanel" aria-label={t('editor.alerts')} className={`${alertsPaneClass} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper`}>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-rule px-4">
              <div className="flex items-baseline gap-2">
                <ColumnLabel>{t('editor.alerts')}</ColumnLabel>
                {visibleAlerts.length > 0 && (
                  <span className="font-mono text-xs font-semibold text-ink">{visibleAlerts.length}</span>
                )}
              </div>
              {results.length > 0 && (
                <button onClick={() => { setResults([]); setSnapshot(null); }} className="py-2 text-xs font-medium text-accent underline underline-offset-2">{t('alerts.clear')}</button>
              )}
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto">
              {isStale && (
                <div role="status" className="flex items-start gap-2 border-b border-rule bg-sheet px-4 py-3 text-sm font-medium text-warn">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{staleMessage}</span>
                </div>
              )}
              {visibleAlerts.length === 0 ? (
                renderEmptyState()
              ) : (
                <ol>
                  {visibleAlerts.map((alert) => {
                    // The editor reports where the alert is now; no position means its text was edited
                    const live = positions.get(alert.id);
                    const stale = textChanged && !live;
                    const tone = getSeverityTone(alert.Severity);
                    let line = alert.Line;
                    let span: [number, number] = alert.Span;
                    if (live) {
                      const start = locate(live.from);
                      const end = locate(Math.max(live.from, live.to - 1));
                      line = start.line;
                      span = [start.column, end.column];
                    }
                    const snippet = buildSnippet((live ? currentLines : reviewedLines)[line - 1] ?? '', span, line);
                    const fixes = stale ? [] : getFixes(alert.Action);
                    const href = safeHttpUrl(alert.Link);
                    return (
                      <li
                        key={alert.id}
                        data-testid="alert-card"
                        data-severity={alert.Severity}
                        onClick={stale ? undefined : (e) => handleAlertClick(alert, e)}
                        className={`border-b border-rule px-4 py-3 ${stale ? '' : 'cursor-pointer hover:bg-select'}`}
                      >
                        <div className="flex items-baseline gap-3 text-xs">
                          <span className={`font-mono font-semibold underline decoration-[1.5px] underline-offset-4 ${tone.text} ${tone.decoration}`}>
                            {getSeverityLabel(alert.Severity, t)}
                          </span>
                          <span className="min-w-0 truncate font-mono text-ink-2">{alert.Check}</span>
                          <span className="ml-auto shrink-0 font-mono text-ink-2">
                            {stale ? t('alerts.edited') : `L${line}:${span[0]}`}
                          </span>
                        </div>
                        <p className={`mt-1.5 text-sm leading-snug text-ink ${stale ? 'italic' : ''}`}>{alert.Message}</p>
                        <pre className="custom-scrollbar mt-2 overflow-x-auto font-mono text-xs leading-5 text-ink-2">
                          {`${snippet.gutter} │ ${snippet.code}\n${' '.repeat(snippet.gutter.length)} │ `}
                          <span className={tone.text}>{snippet.pointer}</span>
                        </pre>
                        {fixes.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {fixes.map((fix, fixIndex) => (
                              <button
                                key={`${fix.kind}:${fix.value}`}
                                type="button"
                                onClick={() => editorHandleRef.current?.applyFix(alert.id, fixIndex)}
                                className="min-h-9 border border-accent px-2.5 text-xs font-semibold text-accent hover:bg-accent hover:text-on-accent lg:min-h-0 lg:py-1"
                              >
                                {describeFix(fix, t)}
                              </button>
                            ))}
                          </div>
                        )}
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 py-1 text-xs font-medium text-accent underline underline-offset-2"
                            aria-label={t('alerts.styleGuideLabel', { rule: alert.Check })}
                          >
                            {t('alerts.styleGuide')} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>

        {/* Phone navigation: the three panels as tabs, within thumb reach */}
        <div
          role="tablist"
          aria-label={t('editor.panels')}
          onKeyDown={(e) => handleTabKeys(e, TAB_ORDER_MOBILE)}
          className="flex shrink-0 border-t border-rule bg-sheet pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <TabButton mode="editor" scope="mobile" selected={view === 'editor'} onSelect={setView} className={mobileTabClass(view === 'editor')}>{t('editor.editor')}</TabButton>
          <TabButton mode="preview" scope="mobile" selected={view === 'preview'} onSelect={setView} className={mobileTabClass(view === 'preview')}>{t('editor.preview')}</TabButton>
          <TabButton mode="alerts" scope="mobile" selected={view === 'alerts'} onSelect={setView} className={mobileTabClass(view === 'alerts')}>
            {t('editor.alerts')}
            {visibleAlerts.length > 0 && (
              <span className={`font-mono text-xs ${isStale ? 'text-warn' : 'text-ink-2'}`}>{visibleAlerts.length}</span>
            )}
          </TabButton>
        </div>
      </main>
    </div>
  );
}
