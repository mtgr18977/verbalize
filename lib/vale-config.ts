import { getFileExtension } from '@/lib/document-format';
import type { DocumentFormat } from '@/lib/document-format';
import { buildIgnoreLines } from '@/lib/ignored-rules';
import { buildSeverityLines } from '@/lib/rule-severity';
import type { SeverityOverrides } from '@/lib/rule-severity';
import { hasTerms } from '@/lib/vocabulary';
import type { Vocabulary } from '@/types/vocabulary';

/** Name of the vocabulary folder Verbalize writes: styles/config/vocabularies/Project. */
export const VOCABULARY_NAME = 'Project';

interface ValeConfigOptions {
  stylesPath: string;
  style: string;
  format: DocumentFormat;
  /** Whether a "Custom" style with the user's uploaded rules exists. */
  hasCustomRules: boolean;
  vocabulary: Vocabulary;
  /** Rules the user ignores, as `Style.Rule`. Already validated by `parseLintRequest`. */
  ignoredRules?: readonly string[];
  /** Severity the user gave to rules, by `Style.Rule`. Already validated by `parseLintRequest`. */
  severities?: SeverityOverrides;
}

/**
 * The .vale.ini for one request.
 *
 * Vale's built-in `Vale` style (Spelling, Terms, Avoid, Repetition) is switched on only when the
 * user has a vocabulary or asked for spelling, so nobody gets new alerts they did not ask for.
 * Repetition is always off: it has nothing to do with a vocabulary.
 *
 * The order of the rule lines matters, because when a key appears twice Vale keeps the FIRST one,
 * whatever the two values are (measured for every pair of NO, YES, error, warning and suggestion).
 * So the lines that switch rules off come first (the ones this file adds itself, then the ignored
 * rules) and the severities last: a severity cannot bring back a rule that was switched off, and an
 * ignored rule stays off whatever severity it was given. Written the other way round, `Vale.Spelling
 * = error` before `Vale.Spelling = NO` turns spelling on.
 *
 * A severity line also switches its rule on when the style is not active (measured), so severities
 * are written only for active styles. An ignored rule of an inactive style is harmless.
 */
export function buildValeIni({ stylesPath, style, format, hasCustomRules, vocabulary, ignoredRules = [], severities = {} }: ValeConfigOptions): string {
  const withTerms = hasTerms(vocabulary);
  const useBuiltIn = withTerms || vocabulary.spelling;

  const styles = [style];
  if (hasCustomRules) styles.push('Custom');
  if (useBuiltIn) styles.push('Vale');

  const lines = ['StylesPath = ' + stylesPath, 'MinAlertLevel = suggestion'];
  if (withTerms) lines.push(`Vocab = ${VOCABULARY_NAME}`);
  // The section must match the extension of the file Vale reads: that is how it picks the parser
  lines.push(`[*.${getFileExtension(format)}]`, `BasedOnStyles = ${styles.join(', ')}`);

  if (useBuiltIn) {
    lines.push('Vale.Repetition = NO');
    if (!vocabulary.spelling) lines.push('Vale.Spelling = NO');
    if (!vocabulary.enforceCase) lines.push('Vale.Terms = NO');
  }
  lines.push(...buildIgnoreLines(ignoredRules));
  lines.push(...buildSeverityLines(severities, styles));
  return `${lines.join('\n')}\n`;
}
