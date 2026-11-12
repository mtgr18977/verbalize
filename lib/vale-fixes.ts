import type { ValeAction } from '@/types/lint';

/** A one-click correction derived from the `Action` Vale attaches to an alert. */
export interface Fix {
  label: string;
  /** Receives the text currently under the alert and returns what should replace it. */
  apply: (matched: string) => string;
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

const REMOVE: Fix = { label: 'Remove', apply: () => '' };

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
      return [{ label: `Trim “${chars}”`, apply: (matched) => trimChars(matched, chars, side) }];
    }
    case 'regex': {
      const [pattern, replacement] = rest;
      if (pattern === undefined || replacement === undefined) return [];
      try {
        const expression = new RegExp(pattern);
        return [{ label: 'Apply suggested edit', apply: (matched) => matched.replace(expression, replacement) }];
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
          : { label: `Replace with “${replacement}”`, apply: () => replacement }
      );
    case 'remove':
      return [REMOVE];
    case 'edit':
      return getEditFixes(params);
    default:
      return [];
  }
}
