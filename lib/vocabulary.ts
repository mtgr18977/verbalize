import type { Vocabulary, VocabularyIssue, VocabularyList } from '@/types/vocabulary';

/**
 * Helpers shared by the interface and the server for the project vocabulary.
 *
 * Vale reads vocabulary entries as regular expressions, and wraps each one in `\b...\b`. Three
 * consequences shape this module:
 *  - A malformed expression makes Vale fail, and some make it crash. Terms are therefore always
 *    written escaped, so what the user types is matched literally.
 *  - `reject` is case sensitive in Vale. Rejected terms get `(?i)`, so "Utilize" is found too.
 *  - A term that starts or ends with a symbol (C++, .NET) can never match, because `\b` needs a
 *    letter or digit next to it. Those are reported instead of being accepted silently.
 */

/**
 * Vale compiles every entry on each run, so the cost follows the number of terms, not the size of
 * the document. Measured with Vale 3.9.5: 500 terms per list ~0.5 s, 1000 ~1.4 s, 3000 ~8.5 s.
 */
export const MAX_VOCABULARY_TERMS = 500;
export const MAX_VOCABULARY_TERM_LENGTH = 80;

const REGEX_SYNTAX = /[\\^$.|?*+()[\]{}]/g;
const STARTS_WITH_WORD = /^[\p{L}\p{N}_]/u;
const ENDS_WITH_WORD = /[\p{L}\p{N}_]$/u;

/** Trims each term, collapses inner whitespace and drops empty lines and exact duplicates. */
export function normalizeTerms(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const line of lines) {
    const term = line.replace(/\s+/g, ' ').trim();
    if (term.length === 0 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

/** The terms of a textarea: one per line. */
export function parseTermLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function hasMatchableEdges(term: string): boolean {
  return STARTS_WITH_WORD.test(term) && ENDS_WITH_WORD.test(term);
}

export function escapeTerm(term: string): string {
  return term.replace(REGEX_SYNTAX, '\\$&');
}

/**
 * Problems with a list, for the interface to explain. Duplicates are reported on the raw lines
 * (before they are merged), and terms that differ only in capitalization conflict in `accept`.
 */
export function findIssues(list: VocabularyList, lines: readonly string[]): VocabularyIssue[] {
  const issues: VocabularyIssue[] = [];
  const seen = new Set<string>();
  const seenLower = new Map<string, string>();

  for (const line of lines) {
    const term = line.replace(/\s+/g, ' ').trim();
    if (term.length === 0) continue;

    if (seen.has(term)) {
      issues.push({ list, term, kind: 'duplicate' });
      continue;
    }
    seen.add(term);

    if (term.length > MAX_VOCABULARY_TERM_LENGTH) issues.push({ list, term, kind: 'too_long' });
    if (!hasMatchableEdges(term)) issues.push({ list, term, kind: 'edge_symbol' });

    if (list === 'accept') {
      const lower = term.toLowerCase();
      const other = seenLower.get(lower);
      if (other !== undefined && other !== term) issues.push({ list, term, kind: 'case_conflict' });
      else seenLower.set(lower, term);
    }
  }
  return issues;
}

/** Terms Vale can use: not too long and with a letter or digit at both ends. */
export function usableTerms(terms: readonly string[]): string[] {
  return terms.filter((term) => term.length <= MAX_VOCABULARY_TERM_LENGTH && hasMatchableEdges(term));
}

export interface VocabularyFiles {
  accept: string;
  reject: string;
}

/** The content of accept.txt and reject.txt exactly as Vale will read them. */
export function buildVocabularyFiles(vocabulary: Pick<Vocabulary, 'accept' | 'reject'>): VocabularyFiles {
  const lines = (terms: string[], prefix: string): string =>
    usableTerms(normalizeTerms(terms))
      .map((term) => `${prefix}${escapeTerm(term)}`)
      .join('\n');
  const accept = lines(vocabulary.accept, '');
  const reject = lines(vocabulary.reject, '(?i)');
  return { accept: accept ? `${accept}\n` : '', reject: reject ? `${reject}\n` : '' };
}

export function hasTerms(vocabulary: Pick<Vocabulary, 'accept' | 'reject'>): boolean {
  return usableTerms(vocabulary.accept).length + usableTerms(vocabulary.reject).length > 0;
}

export interface ImportResult {
  terms: string[];
  /** Lines that are regular expressions: they cannot be used as plain terms. */
  skipped: string[];
}

/**
 * Reads a vocabulary file. The format of the files Verbalize writes (escaped terms, `(?i)` on
 * rejected ones) round-trips. A line with real regular expression syntax is skipped and reported
 * rather than turned into a literal that would never match what its author meant.
 */
export function parseVocabularyFile(content: string): ImportResult {
  const terms: string[] = [];
  const skipped: string[] = [];

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const withoutFlag = line.replace(/^\(\?i\)/, '');
    // Regular expression syntax, not characters of a term: an operator that is not escaped, or an
    // escaped letter or digit (\d, \s, \b...). Verbalize only ever escapes symbols, never letters.
    if (/(^|[^\\])[[\](){}*+?|^$]/.test(withoutFlag) || /\\[A-Za-z0-9]/.test(withoutFlag)) {
      skipped.push(line);
      continue;
    }
    terms.push(withoutFlag.replace(/\\(.)/g, '$1'));
  }
  return { terms: normalizeTerms(terms), skipped };
}

const TERMS_MESSAGE = /^Use '([\s\S]*)' instead of '([\s\S]*)'\.$/;

/** Vale prints the accepted term as the pattern it was written with: `Node\.js`. */
function unescapePattern(pattern: string): string {
  return pattern.replace(/\\(.)/g, '$1');
}

/** The capitalization Vale.Terms asks for, read from its message. Null for any other alert. */
export function getCanonicalTerm(check: string, message: string): string | null {
  if (check !== 'Vale.Terms') return null;
  const match = TERMS_MESSAGE.exec(message);
  return match ? unescapePattern(match[1]) : null;
}

/** The message of an alert as the user should read it: patterns shown as the terms they stand for. */
export function cleanVocabularyMessage(check: string, message: string): string {
  if (check !== 'Vale.Terms') return message;
  const match = TERMS_MESSAGE.exec(message);
  return match ? `Use '${unescapePattern(match[1])}' instead of '${match[2]}'.` : message;
}

export function isVocabulary(value: unknown): value is Vocabulary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const isTerms = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === 'string');
  return (
    isTerms(record.accept) &&
    isTerms(record.reject) &&
    typeof record.spelling === 'boolean' &&
    typeof record.enforceCase === 'boolean'
  );
}

/** Reads a stored vocabulary, keeping only what is valid. Anything else gives the empty vocabulary. */
export function parseStoredVocabulary(raw: string | null): Vocabulary | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const terms = (items: unknown): string[] =>
      Array.isArray(items)
        ? normalizeTerms(items.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 200))).slice(
            0,
            MAX_VOCABULARY_TERMS
          )
        : [];
    return {
      accept: terms(record.accept),
      reject: terms(record.reject),
      spelling: record.spelling === true,
      enforceCase: record.enforceCase !== false,
    };
  } catch {
    return null;
  }
}
