'use client';

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from 'next-themes';
import { Sun, Moon, Upload, Copy, Check, Trash2, Sidebar, PlayCircle, ExternalLink, FileText, FileSearch, LoaderCircle, TriangleAlert, X } from 'lucide-react';

interface ValeAlert {
  Action: {
    Name: string;
    Params: string[] | null;
  };
  Span: [number, number];
  Check: string;
  Description: string;
  Link: string;
  Message: string;
  Severity: string;
  Match: string;
  Line: number;
}

interface CustomRule {
  name: string;
  content: string;
}

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

const SNIPPET_CHARS_BEFORE = 30;
const SNIPPET_CHARS_AFTER = 40;

function subscribeNoop(): () => void {
  return () => {};
}

function getRulesKey(rules: CustomRule[]): string {
  return rules.map((rule) => `${rule.name}\u0000${rule.content}`).join('\u0001');
}

function getSeverityTone(severity: string): SeverityTone {
  if (severity === 'error') return { text: 'text-err', decoration: 'decoration-wavy' };
  if (severity === 'warning') return { text: 'text-warn', decoration: 'decoration-dashed' };
  return { text: 'text-ink-2', decoration: 'decoration-dotted' };
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

/** Label for the small column headers: sentence case, at least 12 px */
function ColumnLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-xs font-semibold text-ink-2">{children}</span>;
}

export default function Home() {
  const [text, setText] = useState('');
  const [style, setStyle] = useState('Google');
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [results, setResults] = useState<ValeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // false on the server and during hydration, true afterwards: avoids a theme-icon mismatch
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  // `theme` is "system" until the user picks one; `resolvedTheme` is what is actually shown
  const { resolvedTheme, setTheme } = useTheme();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const handleLint = useCallback(async (): Promise<void> => {
    if (loading) return;
    if (!text.trim()) {
      alert('Please enter some text to lint.');
      return;
    }

    // Normalize newlines to \n to ensure consistent line/column reporting from Vale
    const normalizedText = text.replace(/\r\n/g, '\n');
    if (normalizedText !== text) {
      setText(normalizedText);
    }

    setLoading(true);
    setResults([]);
    setSnapshot(null);
    try {
      const response = await fetch('/api/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizedText, style, customRules }),
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data)) {
        setResults(data as ValeAlert[]);
        setSnapshot({ text: normalizedText, style, rulesKey: getRulesKey(customRules), at: new Date() });
      } else {
        console.error('Linting error:', data);
        alert('Linting failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to lint:', error);
      alert('Failed to connect to the linting service.');
    } finally {
      setLoading(false);
    }
  }, [loading, text, style, customRules]);

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

  const clearEditor = () => {
    if (text && confirm('Are you sure you want to clear the editor?')) {
      setText('');
      setResults([]);
      setSnapshot(null);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const source = e.currentTarget;
    const target = source === editorRef.current ? previewRef.current : editorRef.current;

    if (target) {
      const percentage = source.scrollTop / (source.scrollHeight - source.clientHeight);
      target.scrollTop = percentage * (target.scrollHeight - target.clientHeight);
    }
  };

  const handleAlertClick = (alert: ValeAlert, e: React.MouseEvent) => {
    // Prevent the click from being handled by parent elements if we clicked a link
    if ((e.target as HTMLElement).closest('a')) return;

    e.preventDefault();
    e.stopPropagation();

    if (!editorRef.current) return;

    const textarea = editorRef.current;
    // Use the actual textarea value which has normalized newlines
    const currentValue = textarea.value;
    const lines = currentValue.split('\n');
    let offset = 0;

    // Calculate offset based on current textarea value
    for (let i = 0; i < Math.min(alert.Line - 1, lines.length); i++) {
      offset += lines[i].length + 1; // +1 for \n
    }

    const start = offset + alert.Span[0] - 1;
    const end = offset + alert.Span[1];

    // Use a shadow textarea to calculate the scroll position accurately (handles wrapping)
    const shadow = document.createElement('textarea');
    const style = window.getComputedStyle(textarea);
    const props = [
      'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'font-size', 'font-family', 'line-height', 'box-sizing',
      'word-wrap', 'white-space', 'letter-spacing', 'text-transform',
      'text-align', 'text-indent', 'overflow-wrap'
    ];

    // Copy styles to shadow textarea
    props.forEach(prop => {
      shadow.style.setProperty(prop, style.getPropertyValue(prop));
    });

    shadow.style.position = 'absolute';
    shadow.style.visibility = 'hidden';
    shadow.style.height = '0';
    shadow.style.overflow = 'hidden';

    // Measure height up to the end of the selection
    shadow.value = currentValue.substring(0, end);
    document.body.appendChild(shadow);
    const selectionBottom = shadow.scrollHeight;
    document.body.removeChild(shadow);

    // Center the selection
    const scrollTo = selectionBottom - (textarea.clientHeight / 2);
    textarea.scrollTop = Math.max(0, scrollTo);

    textarea.focus();
    // Setting selection range after focus and scroll for better compatibility
    textarea.setSelectionRange(start, end);
  };

  // Review state: results only count as current while the editor, style and rules still match
  const normalizedText = text.replace(/\r\n/g, '\n');
  const isStale =
    snapshot !== null &&
    (snapshot.text !== normalizedText || snapshot.style !== style || snapshot.rulesKey !== getRulesKey(customRules));
  const textChanged = snapshot !== null && snapshot.text !== normalizedText;
  const styleLabel = STYLE_OPTIONS.find((option) => option.value === style)?.label ?? style;
  const reviewedLines = snapshot ? snapshot.text.split('\n') : [];
  const currentLines = normalizedText.split('\n');
  // An alert is out of date when the line it points at is no longer the line that was reviewed
  const isAlertStale = (alert: ValeAlert): boolean =>
    textChanged && reviewedLines[alert.Line - 1] !== currentLines[alert.Line - 1];

  const reviewTime = snapshot ? snapshot.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  // Replaces the old "Live Editor" badge: the status always reflects the real state of the text
  const statusLabel = loading ? 'Reviewing…' : snapshot === null ? 'Not reviewed' : isStale ? 'Out of date' : `Reviewed at ${reviewTime}`;

  const renderEmptyState = (): React.JSX.Element => {
    if (loading) {
      return (
        <PanelMessage
          icon={<LoaderCircle className="w-4 h-4 text-accent animate-spin motion-reduce:animate-none" />}
          title="Reviewing…"
          detail={`Checking the text against ${styleLabel}.`}
        />
      );
    }
    if (snapshot === null) {
      return (
        <PanelMessage
          icon={<FileSearch className="w-4 h-4 text-ink-2" />}
          title="Not reviewed yet"
          detail={`Press Run Linting (Ctrl+Enter) to check this document against ${styleLabel}.`}
        />
      );
    }
    if (isStale) {
      return (
        <PanelMessage
          icon={<FileSearch className="w-4 h-4 text-ink-2" />}
          title="The last review found no alerts"
          detail="The document changed since then, so this result no longer applies."
        />
      );
    }
    const lineCount = snapshot.text.split('\n').length;
    return (
      <PanelMessage
        icon={<Check className="w-4 h-4 text-accent" />}
        title={`No alerts in ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`}
        detail={`Reviewed at ${reviewTime} with ${styleLabel}.`}
      />
    );
  };

  const staleMessage = textChanged
    ? 'The text changed after the last review. Alerts on edited lines are marked. Press Run Linting (Ctrl+Enter) to refresh.'
    : 'The style guide or custom rules changed after the last review. Press Run Linting (Ctrl+Enter) to refresh.';

  const secondaryButton =
    'flex w-full items-center justify-center gap-2 border border-rule bg-transparent px-3 py-2 text-sm font-medium text-ink hover:border-ink-2 hover:bg-paper';
  const iconButton = 'p-1.5 text-ink-2 hover:bg-select hover:text-ink';

  return (
    <div className="flex h-screen overflow-hidden bg-paper font-sans text-ink">
      {/* Sidebar. `inert` keeps the hidden controls out of the tab order when it is collapsed. */}
      <aside
        inert={!sidebarOpen}
        aria-label="Settings"
        className={`${sidebarOpen ? 'w-72' : 'w-0'} flex shrink-0 flex-col overflow-hidden border-r border-rule bg-sheet transition-[width] duration-200 motion-reduce:transition-none`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-5">
          <h2 className="text-base font-bold text-ink">Settings</h2>
          <button onClick={() => setSidebarOpen(false)} aria-label="Close settings" className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 space-y-7 overflow-y-auto p-5">
          {/* Style Guide Selection */}
          <div className="space-y-2">
            <label htmlFor="style-guide" className="block text-xs font-semibold text-ink-2">Base style guide</label>
            <select
              id="style-guide"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full cursor-pointer border border-rule bg-paper px-3 py-2 text-sm font-medium text-ink"
            >
              {STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-xs text-ink-2">Primary ruleset for validation.</p>
          </div>

          {/* Document Upload */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-ink-2">Document</span>
            <button onClick={() => docInputRef.current?.click()} className={secondaryButton}>
              <FileText className="h-4 w-4" />
              <span>Upload MD/MDX</span>
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
              <span className="text-xs font-semibold text-ink-2">Custom rules</span>
              <a
                href="/example-style.yml"
                download
                className="text-xs font-medium text-accent underline underline-offset-2"
              >
                Download example
              </a>
            </div>

            {customRules.length > 0 && (
              <ul className="border-t border-rule">
                {customRules.map((rule, idx) => (
                  <li key={idx} className="flex items-center justify-between border-b border-rule py-1.5">
                    <span className="mr-2 truncate font-mono text-xs text-ink">{rule.name}</span>
                    <button onClick={() => removeCustomRule(idx)} aria-label={`Remove rule ${rule.name}`} className="p-1 text-ink-2 hover:text-err">
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
              <span>Upload .yml rule</span>
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
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule bg-sheet px-5">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} aria-label="Open settings" className={iconButton}>
                <Sidebar className="h-5 w-5" />
              </button>
            )}
            {/* The wavy underline is the universal "linter found something" mark */}
            <h1 className="font-mono text-lg font-semibold text-ink underline decoration-err decoration-wavy decoration-[1.5px] underline-offset-[5px]">
              verbalize
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <span
              data-testid="review-status"
              className={`hidden font-mono text-xs sm:inline ${isStale ? 'font-semibold text-warn' : 'text-ink-2'}`}
            >
              {statusLabel}
            </span>
            <button
              onClick={() => void handleLint()}
              disabled={loading}
              title="Run Linting (Ctrl/⌘ + Enter)"
              className="flex items-center gap-2 border border-accent bg-accent px-4 py-1.5 text-sm font-bold text-on-accent hover:bg-ink hover:border-ink disabled:cursor-wait disabled:bg-ink-2 disabled:border-ink-2"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <PlayCircle className="h-4 w-4" />}
              <span>{loading ? 'Analyzing...' : 'Run Linting'}</span>
              <kbd className="hidden font-mono text-xs font-normal md:inline">Ctrl ↵</kbd>
            </button>
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="border border-rule p-1.5 text-ink-2 hover:border-ink-2 hover:text-ink"
                title="Toggle Theme"
                aria-label="Toggle theme"
              >
                {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            )}
          </div>
        </header>

        {/* 3-Column Grid */}
        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-3">

          {/* Column 1: Editor */}
          <section className="flex flex-col overflow-hidden border-r border-rule bg-sheet">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-rule bg-paper px-4">
              <div className="flex items-baseline gap-3">
                <ColumnLabel>Editor</ColumnLabel>
                <span className="font-mono text-xs text-ink-2">{text.length} chars</span>
              </div>
              <div className="flex gap-1">
                <button onClick={copyToClipboard} title="Copy Content" aria-label="Copy content" className={`${iconButton} ${copied ? 'text-accent' : ''}`}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
                <button onClick={clearEditor} title="Clear All" aria-label="Clear editor" className={`${iconButton} hover:text-err`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <textarea
              ref={editorRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onScroll={handleScroll}
              aria-label="Document text"
              className="custom-scrollbar flex-1 resize-none bg-transparent p-6 font-mono text-[14.5px] leading-7 text-ink placeholder:text-ink-2 focus-visible:outline-offset-[-2px]"
              placeholder="Start typing your documentation (Markdown supported)..."
            />
          </section>

          {/* Column 2: Preview */}
          <section className="flex flex-col overflow-hidden border-r border-rule bg-sheet">
            <div className="flex h-10 shrink-0 items-center border-b border-rule bg-paper px-4">
              <ColumnLabel>Preview</ColumnLabel>
            </div>
            <div
              ref={previewRef}
              onScroll={handleScroll}
              className="custom-scrollbar flex-1 overflow-y-auto p-8"
            >
              <article className="prose prose-diagnostic max-w-none">
                {/* ReactMarkdown is secure by default as it does not render HTML unless explicitly configured with rehype-raw */}
                <ReactMarkdown>{text || '*Rich preview will appear here...*'}</ReactMarkdown>
              </article>
            </div>
          </section>

          {/* Column 3: Results */}
          <section className="flex flex-col overflow-hidden bg-paper">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-rule px-4">
              <div className="flex items-baseline gap-2">
                <ColumnLabel>Alerts</ColumnLabel>
                {results.length > 0 && (
                  <span className="font-mono text-xs font-semibold text-ink">{results.length}</span>
                )}
              </div>
              {results.length > 0 && (
                <button onClick={() => { setResults([]); setSnapshot(null); }} className="text-xs font-medium text-accent underline underline-offset-2">Clear</button>
              )}
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto">
              {isStale && (
                <div role="status" className="flex items-start gap-2 border-b border-rule bg-sheet px-4 py-3 text-sm font-medium text-warn">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{staleMessage}</span>
                </div>
              )}
              {results.length === 0 ? (
                renderEmptyState()
              ) : (
                <ol>
                  {results.map((alert, index) => {
                    const stale = isAlertStale(alert);
                    const tone = getSeverityTone(alert.Severity);
                    const snippet = buildSnippet(reviewedLines[alert.Line - 1] ?? '', alert.Span, alert.Line);
                    return (
                      <li
                        key={index}
                        data-testid="alert-card"
                        data-severity={alert.Severity}
                        onClick={stale ? undefined : (e) => handleAlertClick(alert, e)}
                        className={`border-b border-rule px-4 py-3 ${stale ? '' : 'cursor-pointer hover:bg-select'}`}
                      >
                        <div className="flex items-baseline gap-3 text-xs">
                          <span className={`font-mono font-semibold underline decoration-[1.5px] underline-offset-4 ${tone.text} ${tone.decoration}`}>
                            {alert.Severity}
                          </span>
                          <span className="min-w-0 truncate font-mono text-ink-2">{alert.Check}</span>
                          <span className="ml-auto shrink-0 font-mono text-ink-2">
                            {stale ? 'line changed' : `L${alert.Line}:${alert.Span[0]}`}
                          </span>
                        </div>
                        <p className={`mt-1.5 text-sm leading-snug text-ink ${stale ? 'italic' : ''}`}>{alert.Message}</p>
                        <pre className="custom-scrollbar mt-2 overflow-x-auto font-mono text-xs leading-5 text-ink-2">
                          {`${snippet.gutter} │ ${snippet.code}\n${' '.repeat(snippet.gutter.length)} │ `}
                          <span className={tone.text}>{snippet.pointer}</span>
                        </pre>
                        {alert.Link && (
                          <a
                            href={alert.Link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent underline underline-offset-2"
                            aria-label={`Open the style guide page for ${alert.Check}`}
                          >
                            Style guide <ExternalLink className="h-3 w-3" />
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
      </main>
    </div>
  );
}
