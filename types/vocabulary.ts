/** The project's own words, kept as Vale vocabulary files (accept.txt and reject.txt). */
export interface Vocabulary {
  /** Terms spelled and capitalized exactly like this: never a spelling mistake. */
  accept: string[];
  /** Terms to avoid, whatever their capitalization. */
  reject: string[];
  /** Check spelling with Vale's English dictionary. Noisy until the jargon is in `accept`. */
  spelling: boolean;
  /** Ask for the capitalization of accepted terms (Vale.Terms). */
  enforceCase: boolean;
}

export const EMPTY_VOCABULARY: Vocabulary = {
  accept: [],
  reject: [],
  spelling: false,
  enforceCase: true,
};

export type VocabularyList = 'accept' | 'reject';

export type VocabularyIssueKind = 'too_long' | 'edge_symbol' | 'duplicate' | 'case_conflict';

export interface VocabularyIssue {
  list: VocabularyList;
  /** The term as typed. */
  term: string;
  kind: VocabularyIssueKind;
}
