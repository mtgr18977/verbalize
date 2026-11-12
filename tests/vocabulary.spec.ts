import { test, expect } from '@playwright/test';
import { buildValeIni } from '../lib/vale-config';
import {
  MAX_VOCABULARY_TERMS,
  buildVocabularyFiles,
  cleanVocabularyMessage,
  escapeTerm,
  findIssues,
  getCanonicalTerm,
  hasTerms,
  normalizeTerms,
  parseStoredVocabulary,
  parseVocabularyFile,
} from '../lib/vocabulary';
import { EMPTY_VOCABULARY } from '../types/vocabulary';
import type { Vocabulary } from '../types/vocabulary';

interface Alert {
  Check: string;
  Match: string;
  Message: string;
}

function vocab(overrides: Partial<Vocabulary> = {}): Vocabulary {
  return { ...EMPTY_VOCABULARY, ...overrides };
}

test.describe('terms as the user types them', () => {
  test('are trimmed, collapsed and de-duplicated', () => {
    expect(normalizeTerms(['  Kubernetes ', '', 'Red   Hat', 'Kubernetes', '\t', 'kubectl'])).toEqual(['Kubernetes', 'Red Hat', 'kubectl']);
  });

  test('regular expression syntax is escaped, so terms are literal', () => {
    expect(escapeTerm('Node.js')).toBe('Node\\.js');
    expect(escapeTerm('a|b')).toBe('a\\|b');
    expect(escapeTerm('C:\\temp')).toBe('C:\\\\temp');
    expect(escapeTerm('(x)[y]{z}^$*+?')).toBe('\\(x\\)\\[y\\]\\{z\\}\\^\\$\\*\\+\\?');
    expect(escapeTerm('plain words')).toBe('plain words');
  });

  test('the files are escaped, rejected terms ignore case, and unusable terms are left out', () => {
    const files = buildVocabularyFiles({ accept: ['Kubernetes', 'Node.js', 'C++', '.NET'], reject: ['utilize', 'in order to', '#tag'] });
    expect(files.accept).toBe('Kubernetes\nNode\\.js\n');
    expect(files.reject).toBe('(?i)utilize\n(?i)in order to\n');
    expect(buildVocabularyFiles({ accept: [], reject: [] })).toEqual({ accept: '', reject: '' });
  });

  test('terms that Vale cannot match are reported, with the reason', () => {
    const issues = findIssues('accept', ['C++', '.NET', 'ok', 'x'.repeat(81), 'ok', 'Kubernetes', 'kubernetes', '(NOT)']);
    expect(issues.map((issue) => [issue.term.slice(0, 6), issue.kind])).toEqual([
      ['C++', 'edge_symbol'],
      ['.NET', 'edge_symbol'],
      ['xxxxxx', 'too_long'],
      ['ok', 'duplicate'],
      ['kubern', 'case_conflict'],
      ['(NOT)', 'edge_symbol'],
    ]);
    // capitalization conflicts only matter for accepted terms
    expect(findIssues('reject', ['Kubernetes', 'kubernetes'])).toEqual([]);
    // letters with accents and a digit or underscore at the ends are fine
    expect(findIssues('accept', ['Ação', 'café', '3d', 'my_', "it's", 'foo-bar'])).toEqual([]);
  });

  test('hasTerms ignores terms that could never match', () => {
    expect(hasTerms({ accept: ['C++'], reject: ['.NET'] })).toBe(false);
    expect(hasTerms({ accept: ['Kubernetes'], reject: [] })).toBe(true);
  });
});

test.describe('importing a vocabulary file', () => {
  test('the files Verbalize writes come back as the same terms', () => {
    const original = { accept: ['Kubernetes', 'Node.js', 'a|b'], reject: ['utilize', 'in order to'] };
    const files = buildVocabularyFiles(original);
    expect(parseVocabularyFile(files.accept)).toEqual({ terms: original.accept, skipped: [] });
    expect(parseVocabularyFile(files.reject)).toEqual({ terms: original.reject, skipped: [] });
  });

  test('comments, blank lines and CRLF are handled', () => {
    expect(parseVocabularyFile('# products\r\nKubernetes\r\n\r\n  kubectl  \r\n')).toEqual({ terms: ['Kubernetes', 'kubectl'], skipped: [] });
  });

  test('lines with real regular expression syntax are skipped and reported, not corrupted', () => {
    const result = parseVocabularyFile('[Kk]ubernetes\nopen(shift)?\n.*ing\nPlain Term\n(?i)Case\n\\d+\n\\d\nfoo\\sbar\nC\\+\\+x\n');
    expect(result.terms).toEqual(['Plain Term', 'Case', 'C++x']);
    expect(result.skipped).toEqual(['[Kk]ubernetes', 'open(shift)?', '.*ing', '\\d+', '\\d', 'foo\\sbar']);
  });
});

test.describe('reading Vale messages about terms', () => {
  test('the capitalization Vale asks for is read from its message', () => {
    expect(getCanonicalTerm('Vale.Terms', "Use 'Kubernetes' instead of 'kubernetes'.")).toBe('Kubernetes');
    expect(getCanonicalTerm('Vale.Terms', "Use 'Node\\.js' instead of 'node.js'.")).toBe('Node.js');
    expect(getCanonicalTerm('Vale.Avoid', "Use 'x' instead of 'y'.")).toBeNull();
    expect(getCanonicalTerm('Vale.Terms', 'Something else.')).toBeNull();
  });

  test('patterns in a message are shown as the terms they stand for', () => {
    expect(cleanVocabularyMessage('Vale.Terms', "Use 'Node\\.js' instead of 'node.js'.")).toBe("Use 'Node.js' instead of 'node.js'.");
    expect(cleanVocabularyMessage('Vale.Avoid', "Avoid using 'x\\.y'.")).toBe("Avoid using 'x\\.y'.");
    expect(cleanVocabularyMessage('Vale.Terms', 'Odd message')).toBe('Odd message');
  });
});

test.describe('what is stored', () => {
  test('is read back, and anything unreadable is ignored', () => {
    expect(parseStoredVocabulary(null)).toBeNull();
    expect(parseStoredVocabulary('nope')).toBeNull();
    expect(parseStoredVocabulary('[]')).toBeNull();
    expect(parseStoredVocabulary(JSON.stringify({ accept: ['A', 'A', 3, 'B'], reject: 'x', spelling: 'yes' }))).toEqual({
      accept: ['A', 'B'],
      reject: [],
      spelling: false,
      enforceCase: true,
    });
  });

  test('is capped', () => {
    const many = Array.from({ length: MAX_VOCABULARY_TERMS + 50 }, (_, i) => `term${i}`);
    expect(parseStoredVocabulary(JSON.stringify({ accept: many, reject: [] }))?.accept).toHaveLength(MAX_VOCABULARY_TERMS);
  });
});

test.describe('the Vale configuration', () => {
  const base = { stylesPath: '/s', style: 'Google', format: 'markdown' as const, hasCustomRules: false };

  test('without a vocabulary nothing changes: no built-in Vale style, no vocabulary', () => {
    expect(buildValeIni({ ...base, vocabulary: EMPTY_VOCABULARY })).toBe(
      'StylesPath = /s\nMinAlertLevel = suggestion\n[*.md]\nBasedOnStyles = Google\n'
    );
  });

  test('terms switch on Vale.Terms and Vale.Avoid, but not spelling, and never repetition', () => {
    const ini = buildValeIni({ ...base, vocabulary: vocab({ accept: ['Kubernetes'] }) });
    expect(ini).toContain('Vocab = Project');
    expect(ini).toContain('BasedOnStyles = Google, Vale');
    expect(ini).toContain('Vale.Repetition = NO');
    expect(ini).toContain('Vale.Spelling = NO');
    expect(ini).not.toContain('Vale.Terms = NO');
  });

  test('spelling alone does not need a vocabulary file', () => {
    const ini = buildValeIni({ ...base, vocabulary: vocab({ spelling: true }) });
    expect(ini).not.toContain('Vocab =');
    expect(ini).toContain('BasedOnStyles = Google, Vale');
    expect(ini).not.toContain('Vale.Spelling = NO');
  });

  test('capitalization can be switched off, and custom rules keep their place', () => {
    const ini = buildValeIni({ ...base, hasCustomRules: true, vocabulary: vocab({ accept: ['Kubernetes'], enforceCase: false }) });
    expect(ini).toContain('BasedOnStyles = Google, Custom, Vale');
    expect(ini).toContain('Vale.Terms = NO');
  });

  test('terms that could never match do not switch the built-in style on', () => {
    expect(buildValeIni({ ...base, vocabulary: vocab({ accept: ['C++'] }) })).not.toContain('Vale');
  });
});

async function lint(
  request: import('@playwright/test').APIRequestContext,
  text: string,
  vocabulary: Partial<Vocabulary> | undefined,
  extra: Record<string, unknown> = {}
): Promise<{ status: number; alerts: Alert[]; body: Record<string, unknown> }> {
  const response = await request.post('/api/lint', { data: { text, style: 'Google', vocabulary, ...extra } });
  const body = (await response.json()) as unknown;
  return { status: response.status(), alerts: Array.isArray(body) ? (body as Alert[]) : [], body: Array.isArray(body) ? {} : (body as Record<string, unknown>) };
}

const checks = (alerts: Alert[]): string[] => alerts.map((alert) => `${alert.Check}:${alert.Match}`);

test.describe('the vocabulary in a real review', () => {
  test('without one, the review is what it always was', async ({ request }) => {
    const { alerts } = await lint(request, 'We deployed kubernetes and recieve the file. The the end.', undefined);
    expect(alerts.every((alert) => alert.Check.startsWith('Google.'))).toBe(true);
  });

  test('rejected terms are reported in any capitalization', async ({ request }) => {
    const { alerts } = await lint(request, 'Utilize this. Please UTILIZE that. Or utilize it.', { reject: ['utilize'] });
    expect(checks(alerts.filter((alert) => alert.Check === 'Vale.Avoid'))).toEqual(['Vale.Avoid:Utilize', 'Vale.Avoid:UTILIZE', 'Vale.Avoid:utilize']);
    expect(alerts[0].Message).toBe("Avoid using 'Utilize'.");
  });

  test('accepted terms ask for their capitalization, and only when it is wrong', async ({ request }) => {
    const { alerts } = await lint(request, 'Run kubernetes. Then run Kubernetes.', { accept: ['Kubernetes'] });
    const terms = alerts.filter((alert) => alert.Check === 'Vale.Terms');
    expect(terms).toHaveLength(1);
    expect(terms[0].Message).toBe("Use 'Kubernetes' instead of 'kubernetes'.");
  });

  test('capitalization can be switched off', async ({ request }) => {
    const { alerts } = await lint(request, 'Run kubernetes.', { accept: ['Kubernetes'], enforceCase: false });
    expect(alerts.filter((alert) => alert.Check === 'Vale.Terms')).toEqual([]);
  });

  test('spelling is off unless asked for, and accepted terms are not misspellings', async ({ request }) => {
    const off = await lint(request, 'Click Next to recieve kubectl.', { accept: ['kubectl'] });
    expect(off.alerts.filter((alert) => alert.Check === 'Vale.Spelling')).toEqual([]);

    const on = await lint(request, 'Click Next to recieve kubectl.', { accept: ['kubectl'], spelling: true });
    expect(checks(on.alerts.filter((alert) => alert.Check === 'Vale.Spelling'))).toEqual(['Vale.Spelling:recieve']);

    const noVocabulary = await lint(request, 'Click Next to recieve kubectl.', { spelling: true });
    expect(checks(noVocabulary.alerts.filter((alert) => alert.Check === 'Vale.Spelling'))).toEqual(['Vale.Spelling:recieve', 'Vale.Spelling:kubectl']);
  });

  test('repetition stays off, because it has nothing to do with a vocabulary', async ({ request }) => {
    const { alerts } = await lint(request, 'This is the the end.', { accept: ['Kubernetes'], spelling: true });
    expect(alerts.filter((alert) => alert.Check === 'Vale.Repetition')).toEqual([]);
  });

  test('phrases, accents and symbols in the middle of a term work', async ({ request }) => {
    const { alerts } = await lint(
      request,
      'Try red hat openshift and Ótimo ideas. Use a|b and node.js and foo-bar and IT\'S.',
      { accept: ['Red Hat OpenShift', 'Node.js'], reject: ['ótimo', 'a|b', 'foo-bar', "it's"] }
    );
    const found = checks(alerts.filter((alert) => alert.Check.startsWith('Vale.')));
    expect(found).toEqual(
      expect.arrayContaining(['Vale.Terms:red hat openshift', 'Vale.Avoid:Ótimo', 'Vale.Avoid:a|b', 'Vale.Terms:node.js', 'Vale.Avoid:foo-bar', "Vale.Avoid:IT'S"])
    );
  });

  test('terms Vale cannot match are harmless: the request works and the others still apply', async ({ request }) => {
    const { status, alerts } = await lint(request, 'We love C++ and .NET and utilize things.', { accept: ['C++'], reject: ['.NET', '(NOT)', 'utilize'] });
    expect(status).toBe(200);
    expect(checks(alerts.filter((alert) => alert.Check.startsWith('Vale.')))).toEqual(['Vale.Avoid:utilize']);
  });

  test('terms with regular expression syntax cannot break or crash the linter', async ({ request }) => {
    for (const term of ['[abc', '(unclosed', 'a{2,1}', '*', '+x+', '\\', '(?<n>x)\\k<n>', '(?=x)y']) {
      const { status } = await lint(request, 'Some ordinary text here.', { accept: [`a${term}b`], reject: [`a${term}b`] });
      expect(status, `term ${term}`).toBe(200);
    }
  });

  test('works together with custom rules', async ({ request }) => {
    const rule = 'extends: existence\nmessage: "Avoid %s"\nlevel: warning\ntokens:\n  - extremely\n';
    const { alerts } = await lint(request, 'It is extremely good, and we utilize it.', { reject: ['utilize'] }, { customRules: [{ name: 'terms.yml', content: rule }] });
    expect(checks(alerts)).toEqual(expect.arrayContaining(['Custom.terms:extremely', 'Vale.Avoid:utilize']));
  });

  test('a full vocabulary stays within the time limit', async ({ request }) => {
    const accept = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, i) => `Term${i}x`);
    const reject = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, i) => `bad${i}x`);
    const started = Date.now();
    const { status, alerts } = await lint(request, 'The server uses Term10x and bad42x with ordinary words.', { accept, reject });
    expect(status).toBe(200);
    expect(checks(alerts)).toContain('Vale.Avoid:bad42x');
    expect(Date.now() - started).toBeLessThan(6000);
  });
});

test.describe('the vocabulary field of the API', () => {
  const bad = async (
    request: import('@playwright/test').APIRequestContext,
    vocabulary: unknown
  ): Promise<{ status: number; code: unknown; params: unknown }> => {
    const { status, body } = await lint(request, 'hello', vocabulary as Partial<Vocabulary>);
    return { status, code: body.code, params: body.params };
  };

  test('rejects the wrong shapes with a code the interface can word', async ({ request }) => {
    expect(await bad(request, 'text')).toMatchObject({ status: 400, code: 'vocabulary_invalid' });
    expect(await bad(request, ['a'])).toMatchObject({ status: 400, code: 'vocabulary_invalid' });
    expect(await bad(request, { accept: 'Kubernetes' })).toMatchObject({ status: 400, code: 'vocabulary_invalid' });
    expect(await bad(request, { reject: [1, 2] })).toMatchObject({ status: 400, code: 'vocabulary_invalid' });
    expect(await bad(request, { spelling: 'yes' })).toMatchObject({ status: 400, code: 'vocabulary_invalid' });
    expect(await bad(request, { accept: ['a\u0000b'] })).toMatchObject({ status: 400, code: 'vocabulary_invalid' });
  });

  test('limits the number and the length of terms', async ({ request }) => {
    const many = Array.from({ length: MAX_VOCABULARY_TERMS + 1 }, (_, i) => `t${i}x`);
    expect(await bad(request, { accept: many })).toEqual({ status: 400, code: 'vocabulary_too_many', params: { max: MAX_VOCABULARY_TERMS } });
    expect(await bad(request, { reject: ['x'.repeat(81)] })).toEqual({ status: 400, code: 'vocabulary_term_too_long', params: { max: 80 } });
  });

  test('is optional, and null means none', async ({ request }) => {
    expect((await lint(request, 'Install the package.', null as unknown as undefined)).status).toBe(200);
    expect((await lint(request, 'Install the package.', {})).status).toBe(200);
  });
});
