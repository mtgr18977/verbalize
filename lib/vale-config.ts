import { hasTerms } from '@/lib/vocabulary';
import type { Vocabulary } from '@/types/vocabulary';

/** Name of the vocabulary folder Verbalize writes: styles/config/vocabularies/Project. */
export const VOCABULARY_NAME = 'Project';

interface ValeConfigOptions {
  stylesPath: string;
  style: string;
  /** Whether a "Custom" style with the user's uploaded rules exists. */
  hasCustomRules: boolean;
  vocabulary: Vocabulary;
}

/**
 * The .vale.ini for one request.
 *
 * Vale's built-in `Vale` style (Spelling, Terms, Avoid, Repetition) is switched on only when the
 * user has a vocabulary or asked for spelling, so nobody gets new alerts they did not ask for.
 * Repetition is always off: it has nothing to do with a vocabulary.
 */
export function buildValeIni({ stylesPath, style, hasCustomRules, vocabulary }: ValeConfigOptions): string {
  const withTerms = hasTerms(vocabulary);
  const useBuiltIn = withTerms || vocabulary.spelling;

  const styles = [style];
  if (hasCustomRules) styles.push('Custom');
  if (useBuiltIn) styles.push('Vale');

  const lines = ['StylesPath = ' + stylesPath, 'MinAlertLevel = suggestion'];
  if (withTerms) lines.push(`Vocab = ${VOCABULARY_NAME}`);
  lines.push('[*.md]', `BasedOnStyles = ${styles.join(', ')}`);

  if (useBuiltIn) {
    lines.push('Vale.Repetition = NO');
    if (!vocabulary.spelling) lines.push('Vale.Spelling = NO');
    if (!vocabulary.enforceCase) lines.push('Vale.Terms = NO');
  }
  return `${lines.join('\n')}\n`;
}
