'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, Compartment, EditorSelection, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, Language, LanguageSupport, defineLanguageFacet, syntaxHighlighting } from '@codemirror/language';
import { forEachDiagnostic, nextDiagnostic, previousDiagnostic, setDiagnostics } from '@codemirror/lint';
import type { Action, Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { GFM, parser as markdownParser } from '@lezer/markdown';

import { asciidoc } from '@/components/asciidoc-language';
import type { DocumentFormat } from '@/lib/document-format';
import type { AlertPosition, ReviewAlert } from '@/types/lint';
import { useI18n } from '@/i18n/provider';
import { isRuleName } from '@/lib/ignored-rules';
import { describeFix, getAlertFixes } from '@/lib/vale-fixes';
import { cleanVocabularyMessage } from '@/lib/vocabulary';
import type { Fix } from '@/lib/vale-fixes';
import { safeHttpUrl } from '@/lib/safe-url';

export interface LintEditorHandle {
  /** Selects the alert's text and scrolls it to the middle of the editor. */
  reveal: (id: number, options?: { focus?: boolean }) => void;
  /** Applies the `fixIndex`-th correction of an alert, if it is still in the document. */
  applyFix: (id: number, fixIndex: number) => void;
  /** Puts the cursor in the editor. */
  focus: () => void;
  /** Stops underlining these alerts, for ones resolved without changing the text. */
  dismiss: (ids: number[]) => void;
}

interface LintEditorProps {
  value: string;
  onChange: (text: string) => void;
  /** Alerts of the last review. Pass a new array only when there is a new review. */
  alerts: ReviewAlert[];
  /** The exact text that was reviewed. Underlines are shown only while the document still matches it. */
  reviewedText: string | null;
  /** Called with the current position of every alert still underlined, after each edit. */
  onPositionsChange: (positions: Map<number, AlertPosition>) => void;
  onFixApplied: (id: number) => void;
  /** The user chose to accept the word of a spelling alert into the project vocabulary. */
  onAcceptTerm: (id: number) => void;
  /** The user chose to ignore the rule of an alert (`Style.Rule`). */
  onIgnoreRule: (rule: string) => void;
  /**
   * Severity the user gave to rules since the review, by `Style.Rule`. It wins over the severity
   * in the alert, so the underline changes shape at once and keeps its tracked position.
   */
  severityOverrides: Readonly<Record<string, string>>;
  /** Decides the syntax highlighting. */
  format: DocumentFormat;
  placeholderText: string;
  ariaLabel: string;
  className?: string;
}

interface Callbacks {
  onChange: (text: string) => void;
  onPositionsChange: (positions: Map<number, AlertPosition>) => void;
  onFixApplied: (id: number) => void;
  onAcceptTerm: (id: number) => void;
  onIgnoreRule: (rule: string) => void;
}

/**
 * The editor is themed only with the CSS variables of the Diagnóstico theme (see globals.css),
 * so it follows light and dark mode without being reconfigured.
 */
/**
 * Marks a change that did not come from the user typing: the text was replaced from outside
 * (a file upload, "Clear editor" and its undo). Alerts that pointed into the old text are cleared
 * with it, and must not be mistaken for edits to alerts that are put back right afterwards.
 */
const externalChange = Annotation.define<boolean>();

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-scroller': {
    fontFamily: 'var(--font-editor), ui-monospace, monospace',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': { padding: '1rem 0', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0 1rem' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  // The selection stays visible when the editor is not focused: tapping an alert on a phone
  // selects the text without opening the keyboard.
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--select)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--select) 35%, transparent)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--ink-2)',
    border: 'none',
    borderRight: '1px solid var(--rule)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.6rem 0 0.9rem', minWidth: '2.4rem', fontSize: '0.82em' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-placeholder': { color: 'var(--ink-2)' },

  // Severity is told by the shape of the underline, not only by color
  '.cm-lintRange': { backgroundImage: 'none', paddingBottom: '0', textUnderlineOffset: '4px' },
  '.cm-lintRange-error': { textDecoration: 'underline wavy var(--err) 1.5px' },
  '.cm-lintRange-warning': { textDecoration: 'underline dashed var(--warn) 1.5px' },
  '.cm-lintRange-info': { textDecoration: 'underline dotted var(--ink-2) 1.5px' },
  '.cm-lintRange-active': { backgroundColor: 'var(--select)' },

  '.cm-tooltip': {
    border: '1px solid var(--ink-2)',
    borderRadius: '2px',
    backgroundColor: 'var(--sheet)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-ui), system-ui, sans-serif',
    fontSize: '14px',
    boxShadow: 'none',
  },
  '.cm-tooltip.cm-tooltip-lint': { maxWidth: '26rem' },
  '.cm-diagnostic': { padding: '8px 12px', marginLeft: '0', borderLeft: '3px solid var(--ink-2)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--err)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--ink-2)' },
  '.cm-diagnosticSource': {
    display: 'block',
    marginBottom: '2px',
    color: 'var(--ink-2)',
    fontFamily: 'var(--font-editor), ui-monospace, monospace',
    fontSize: '12px',
    opacity: '1',
  },
  '.cm-diagnosticText': { display: 'block' },
  '.cm-diagnosticAction': {
    marginLeft: '0',
    marginRight: '12px',
    marginTop: '6px',
    padding: '0',
    backgroundColor: 'transparent',
    color: 'var(--accent)',
    fontWeight: '600',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    cursor: 'pointer',
  },
  '.cm-diagnosticLink': { color: 'var(--accent)', textDecoration: 'underline', fontSize: '12px' },
});

/*
 * Markdown support built straight on the Lezer parser. @codemirror/lang-markdown would add about
 * 87 KB (gzip) for embedded HTML, CSS and JavaScript highlighting that a prose editor never uses.
 */
const markdownSupport = new LanguageSupport(
  new Language(defineLanguageFacet(), markdownParser.configure(GFM), [], 'markdown')
);

function languageFor(format: DocumentFormat): Extension {
  return format === 'asciidoc' ? asciidoc() : markdownSupport;
}

const markdownHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: tags.heading, fontWeight: '700', color: 'var(--ink)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, color: 'var(--ink)', backgroundColor: 'var(--paper)' },
  { tag: tags.quote, color: 'var(--ink-2)' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--ink-2)' },
]);

function contentAttributes(ariaLabel: string): Extension {
  return EditorView.contentAttributes.of({
    'aria-label': ariaLabel,
    'aria-multiline': 'true',
    // Browser spellcheck would draw its own red squiggles over the linter's underlines
    spellcheck: 'false',
    autocorrect: 'off',
    autocapitalize: 'off',
  });
}

function getSeverity(severity: string): Diagnostic['severity'] {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function samePositions(a: Map<number, AlertPosition>, b: Map<number, AlertPosition>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, position] of a) {
    const other = b.get(id);
    if (!other || other.from !== position.from || other.to !== position.to) return false;
  }
  return true;
}

/** Applies a fix to [from, to]. Removing a word between two spaces also removes one of them. */
function runFix(view: EditorView, from: number, to: number, fix: Fix): void {
  const replacement = fix.apply(view.state.doc.sliceString(from, to));
  let start = from;
  if (replacement === '') {
    const before = start > 0 ? view.state.doc.sliceString(start - 1, start) : '';
    const after = view.state.doc.sliceString(to, to + 1);
    if (before === ' ' && (after === ' ' || after === '')) start -= 1;
  }
  view.dispatch({ changes: { from: start, to, insert: replacement }, userEvent: 'input.complete' });
}

export const LintEditor = forwardRef<LintEditorHandle, LintEditorProps>(function LintEditor(
  { value, onChange, alerts, reviewedText, onPositionsChange, onFixApplied, onAcceptTerm, onIgnoreRule, severityOverrides, format, placeholderText, ariaLabel, className },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacksRef = useRef<Callbacks>({ onChange, onPositionsChange, onFixApplied, onAcceptTerm, onIgnoreRule });
  const lastEmittedRef = useRef(value);
  const lastPositionsRef = useRef<Map<number, AlertPosition>>(new Map());
  // Diagnostic objects keep their original positions; this ties each one to its alert id
  const alertIdsRef = useRef(new WeakMap<Diagnostic, number>());
  const alertsByIdRef = useRef(new Map<number, ReviewAlert>());
  // Text that depends on the language lives in compartments, so it can change without a new editor
  const languageCompartmentRef = useRef(new Compartment());
  const placeholderCompartmentRef = useRef(new Compartment());
  const attributesCompartmentRef = useRef(new Compartment());

  const { t, locale } = useI18n();
  const translateRef = useRef(t);
  const severityRef = useRef(severityOverrides);
  useEffect(() => {
    translateRef.current = t;
    severityRef.current = severityOverrides;
  });

  /** Where every underlined alert is now. */
  const collectPositions = useCallback((view: EditorView): Map<number, AlertPosition> => {
    const positions = new Map<number, AlertPosition>();
    forEachDiagnostic(view.state, (diagnostic, from, to) => {
      const id = alertIdsRef.current.get(diagnostic);
      if (id !== undefined) positions.set(id, { from, to });
    });
    return positions;
  }, []);

  /** Builds the CodeMirror diagnostic of an alert: tooltip text and fixes, in the current language. */
  const buildDiagnostic = useCallback((alert: ReviewAlert, from: number, to: number): Diagnostic => {
    const translate = translateRef.current;
    const actions: Action[] = getAlertFixes(alert).map((fix) => ({
      name: describeFix(fix, translate),
      apply: (actionView, actionFrom, actionTo) => {
        runFix(actionView, actionFrom, actionTo, fix);
        callbacksRef.current.onFixApplied(alert.id);
      },
    }));
    // A word the spelling check does not know may be jargon of the project: offer to accept it
    if (alert.Check === 'Vale.Spelling') {
      actions.push({
        name: translate('vocab.acceptTerm', { term: alert.Match }),
        apply: () => callbacksRef.current.onAcceptTerm(alert.id),
      });
    }
    // Not every rule can be switched off by name (see isRuleName): offer it only where it works
    if (isRuleName(alert.Check)) {
      actions.push({
        name: translate('ignore.button'),
        apply: () => callbacksRef.current.onIgnoreRule(alert.Check),
      });
    }
    const cleanMessage = cleanVocabularyMessage(alert.Check, alert.Message);
    const href = safeHttpUrl(alert.Link);

    const diagnostic: Diagnostic = {
      from,
      to,
      severity: getSeverity(severityRef.current[alert.Check] ?? alert.Severity),
      source: alert.Check,
      message: cleanMessage,
      actions,
      renderMessage: () => {
        const wrapper = document.createElement('span');
        const message = document.createElement('span');
        message.textContent = cleanMessage;
        wrapper.appendChild(message);
        if (href) {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.className = 'cm-diagnosticLink';
          link.textContent = ` ${translateRef.current('alerts.styleGuide')}`;
          wrapper.appendChild(link);
        }
        return wrapper;
      },
    };
    alertIdsRef.current.set(diagnostic, alert.id);
    return diagnostic;
  }, []);

  useEffect(() => {
    callbacksRef.current = { onChange, onPositionsChange, onFixApplied, onAcceptTerm, onIgnoreRule };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reportPositions = (view: EditorView): void => {
      const next = new Map<number, AlertPosition>();
      forEachDiagnostic(view.state, (diagnostic, from, to) => {
        const id = alertIdsRef.current.get(diagnostic);
        if (id !== undefined) next.set(id, { from, to });
      });
      if (!samePositions(lastPositionsRef.current, next)) {
        lastPositionsRef.current = next;
        callbacksRef.current.onPositionsChange(next);
      }
    };

    // An alert whose text was edited no longer says anything reliable: stop underlining it
    const dropEdited = (view: EditorView, edited: Array<[number, number]>): void => {
      const kept: Diagnostic[] = [];
      let dropped = false;
      forEachDiagnostic(view.state, (diagnostic, from, to) => {
        const touched = from === to || edited.some(([start, end]) => from < end && to > start);
        if (touched) {
          dropped = true;
          return;
        }
        if (from === diagnostic.from && to === diagnostic.to) {
          kept.push(diagnostic);
        } else {
          const moved: Diagnostic = { ...diagnostic, from, to };
          const id = alertIdsRef.current.get(diagnostic);
          if (id !== undefined) alertIdsRef.current.set(moved, id);
          kept.push(moved);
        }
      });
      if (dropped) view.dispatch(setDiagnostics(view.state, kept));
      reportPositions(view);
    };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          EditorView.lineWrapping,
          languageCompartmentRef.current.of(languageFor(format)),
          syntaxHighlighting(markdownHighlight),
          placeholderCompartmentRef.current.of(placeholder(placeholderText)),
          theme,
          keymap.of([
            // Ctrl/Cmd+Enter runs the review (handled by the page), not "insert blank line"
            ...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'),
            ...historyKeymap,
            { key: 'F8', run: nextDiagnostic },
            { key: 'Shift-F8', run: previousDiagnostic },
          ]),
          attributesCompartmentRef.current.of(contentAttributes(ariaLabel)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            lastEmittedRef.current = text;
            callbacksRef.current.onChange(text);

            // A replacement from outside already cleared the old alerts, and new ones may have arrived since
            if (update.transactions.some((transaction) => transaction.annotation(externalChange))) return;

            const edited: Array<[number, number]> = [];
            update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => edited.push([fromB, toB]));
            // Diagnostics cannot be changed while an update is in progress
            queueMicrotask(() => {
              if (viewRef.current === update.view) dropEdited(update.view, edited);
            });
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once; later changes to props are synchronized by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text changed from outside (file upload, "clear editor"): replace the document
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalChange.of(true),
    });
    // The alerts belonged to the old text. Any that apply to the new one are set again by the
    // effect below, in this same render, when a review is put back.
    view.dispatch(setDiagnostics(view.state, []));
    lastPositionsRef.current = new Map();
    callbacksRef.current.onPositionsChange(new Map());
  }, [value]);

  // A new review arrived: underline its alerts, but only if the document is still the reviewed one
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const diagnostics: Diagnostic[] = [];
    const alertsById = new Map<number, ReviewAlert>();
    alertsByIdRef.current = alertsById;
    if (reviewedText !== null && view.state.doc.toString() === reviewedText) {
      const doc = view.state.doc;
      for (const alert of alerts) {
        if (alert.Line < 1 || alert.Line > doc.lines) continue;
        const line = doc.line(alert.Line);
        const from = Math.min(line.to, line.from + alert.Span[0] - 1);
        const to = Math.min(line.to, line.from + alert.Span[1]);
        if (to <= from) continue;

        alertsById.set(alert.id, alert);
        const diagnostic = buildDiagnostic(alert, from, to);
        diagnostics.push(diagnostic);
      }
    }

    view.dispatch(setDiagnostics(view.state, diagnostics));

    const positions = collectPositions(view);
    lastPositionsRef.current = positions;
    callbacksRef.current.onPositionsChange(positions);
  }, [alerts, reviewedText, buildDiagnostic, collectPositions]);

  // The document format changed: highlight it as the right markup
  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageCompartmentRef.current.reconfigure(languageFor(format)) });
  }, [format]);

  // The language changed, or a rule got another severity: reword the placeholder, the accessible
  // name and the fixes in the tooltips, and redraw the underlines. The diagnostics are rebuilt where
  // they are now, so alerts keep their tracked positions.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: [
        placeholderCompartmentRef.current.reconfigure(placeholder(placeholderText)),
        attributesCompartmentRef.current.reconfigure(contentAttributes(ariaLabel)),
      ],
    });

    const rebuilt: Diagnostic[] = [];
    forEachDiagnostic(view.state, (diagnostic, from, to) => {
      const id = alertIdsRef.current.get(diagnostic);
      const alert = id === undefined ? undefined : alertsByIdRef.current.get(id);
      if (alert) rebuilt.push(buildDiagnostic(alert, from, to));
    });
    if (rebuilt.length > 0) view.dispatch(setDiagnostics(view.state, rebuilt));
  }, [locale, placeholderText, ariaLabel, severityOverrides, buildDiagnostic]);

  useImperativeHandle(ref, () => {
    const find = (id: number): { diagnostic: Diagnostic; from: number; to: number } | null => {
      const view = viewRef.current;
      if (!view) return null;
      let found: { diagnostic: Diagnostic; from: number; to: number } | null = null;
      forEachDiagnostic(view.state, (diagnostic, from, to) => {
        if (alertIdsRef.current.get(diagnostic) === id) found = { diagnostic, from, to };
      });
      return found;
    };

    return {
      reveal: (id, options) => {
        const view = viewRef.current;
        const target = find(id);
        if (!view || !target) return;
        view.dispatch({
          selection: EditorSelection.single(target.from, target.to),
          effects: EditorView.scrollIntoView(EditorSelection.range(target.from, target.to), { y: 'center' }),
        });
        if (options?.focus !== false) view.focus();
      },
      applyFix: (id, fixIndex) => {
        const view = viewRef.current;
        const target = find(id);
        const action = target?.diagnostic.actions?.[fixIndex];
        if (view && target && action) action.apply(view, target.from, target.to);
      },
      focus: () => viewRef.current?.focus(),
      dismiss: (ids) => {
        const view = viewRef.current;
        if (!view || ids.length === 0) return;
        const gone = new Set(ids);

        // Keep the others where they are now: the diagnostics hold their original positions
        const kept: Diagnostic[] = [];
        forEachDiagnostic(view.state, (diagnostic, from, to) => {
          const id = alertIdsRef.current.get(diagnostic);
          if (id === undefined || gone.has(id)) return;
          const moved: Diagnostic = { ...diagnostic, from, to };
          alertIdsRef.current.set(moved, id);
          kept.push(moved);
        });
        view.dispatch(setDiagnostics(view.state, kept));

        const positions = collectPositions(view);
        lastPositionsRef.current = positions;
        callbacksRef.current.onPositionsChange(positions);
      },
    };
  }, [collectPositions]);

  return <div ref={hostRef} data-testid="editor" className={className} />;
});
