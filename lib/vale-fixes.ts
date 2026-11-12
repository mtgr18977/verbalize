import type { Translate } from '@/i18n/translate';
import { getCanonicalTerm } from '@/lib/vocabulary';
import type { ValeAction, ValeAlert } from '@/types/lint';

export type FixKind = 'replace' | 'remove' | 'trim' | 'regex';

/** A one-click correction derived from the `Action` Vale attaches to an alert. */
export interface Fix {
  kind: FixKind;
  /** The replacement text for `replace`, the trimmed characters for `trim`; empty otherwise. */
  value: string;
  /** Receives the text currently under the alert and returns what should replace it. */
  apply: (matched: string) => string;
}

/** The wording of a fix in the interface language. */
export function describeFix(fix: Fix, t: Translate): string {
  switch (fix.kind) {
    case 'replace':
      return t('fix.replace', { value: fix.value });
    case 'trim':
      return t('fix.trim', { chars: fix.value });
    case 'regex':
      return t('fix.regex');
    default:
      return t('fix.remove');
  }
}

const MAX_SUGGESTIONS = 4;

type TrimSide = 'left' | 'right' | 'both';

function trimChars(value: string, chars: string, side: TrimSide): string {
  const set = new Set(Array.from(chars));
  const letters = Array.from(value);
  let start = 0;
  let end = letters.length;
  if (side !== 'right') {
    while (start < end && set.has(letters[start])) start += 1;
  }
  if (side !== 'left') {
    while (end > start && set.has(letters[end - 1])) end -= 1;
  }
  return letters.slice(start, end).join('');
}

const REMOVE: Fix = { kind: 'remove', value: '', apply: () => '' };

function getEditFixes(params: string[]): Fix[] {
  const [kind, ...rest] = params;

  switch (kind) {
    case 'remove':
      return [REMOVE];
    case 'trim':
    case 'trim_left':
    case 'trim_right': {
      const chars = rest[0] ?? ' ';
      const side: TrimSide = kind === 'trim_left' ? 'left' : kind === 'trim_right' ? 'right' : 'both';
      return [{ kind: 'trim', value: chars, apply: (matched) => trimChars(matched, chars, side) }];
    }
    case 'regex': {
      const [pattern, replacement] = rest;
      if (pattern === undefined || replacement === undefined) return [];
      try {
        const expression = new RegExp(pattern);
        return [{ kind: 'regex', value: '', apply: (matched) => matched.replace(expression, replacement) }];
      } catch {
        // Vale uses Go's regexp flavor; a pattern JavaScript cannot parse is simply not offered
        return [];
      }
    }
    default:
      return [];
  }
}

/** The fixes Verbalize can apply for an alert: replace, remove, trim and regex edits. */
export function getFixes(action: ValeAction | null | undefined): Fix[] {
  if (!action) return [];
  const params = action.Params ?? [];

  switch (action.Name) {
    case 'replace':
      return params.slice(0, MAX_SUGGESTIONS).map((replacement) =>
        replacement === ''
          ? REMOVE
          : { kind: 'replace', value: replacement, apply: () => replacement }
      );
    case 'remove':
      return [REMOVE];
    case 'edit':
      return getEditFixes(params);
    default:
      return [];
  }
}

/**
 * The fixes for an alert. Vale attaches an `Action` to most of its rules, but not to `Vale.Terms`:
 * there the capitalization it asks for is only in the message, so the fix is read from there.
 */
export function getAlertFixes(alert: Pick<ValeAlert, 'Action' | 'Check' | 'Message'>): Fix[] {
  const fixes = getFixes(alert.Action);
  if (fixes.length > 0) return fixes;

  const canonical = getCanonicalTerm(alert.Check, alert.Message);
  return canonical === null ? [] : [{ kind: 'replace', value: canonical, apply: () => canonical }];
}
