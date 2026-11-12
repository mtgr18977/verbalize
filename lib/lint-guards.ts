import { parse as parseYaml } from 'yaml';

import type { ApiErrorCode, ApiErrorParams } from '@/lib/api-errors';
import { DEFAULT_FORMAT, isDocumentFormat } from '@/lib/document-format';
import type { DocumentFormat } from '@/lib/document-format';
import { EMPTY_VOCABULARY } from '@/types/vocabulary';
import type { Vocabulary } from '@/types/vocabulary';
import { MAX_VOCABULARY_TERMS, MAX_VOCABULARY_TERM_LENGTH, normalizeTerms } from '@/lib/vocabulary';
import { MAX_IGNORED_RULES, MAX_RULE_NAME_LENGTH, isRuleName, uniqueRules } from '@/lib/ignored-rules';
import { MAX_SEVERITY_OVERRIDES, isRuleSeverity } from '@/lib/rule-severity';
import type { SeverityOverrides } from '@/lib/rule-severity';

/**
 * Limits and request guards for POST /api/lint.
 *
 * Vale cost grows faster than linearly with the number of alerts (measured:
 * 25 KB of alert-dense text takes ~5 s, 100 KB takes ~66 s), so the size limit
 * alone cannot bound CPU time. LINT_TIMEOUT_MS is the real safety net.
 */

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Maximum document size in bytes (UTF-8). */
export const MAX_INPUT_SIZE = readPositiveInt('MAX_INPUT_SIZE', 200 * 1024);
/** Hard wall-clock limit for one Vale run. Kept under the 10 s Netlify limit. */
export const LINT_TIMEOUT_MS = readPositiveInt('LINT_TIMEOUT_MS', 8_000);
/** Vale processes allowed to run at the same time on this server instance. */
export const MAX_CONCURRENT_LINTS = readPositiveInt('MAX_CONCURRENT_LINTS', 2);
/** Requests per client per minute. */
export const RATE_LIMIT_MAX = readPositiveInt('RATE_LIMIT_MAX', 30);
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const MAX_CUSTOM_RULES = 10;
export const MAX_RULE_LENGTH = 10 * 1024;
/** Upper bound for Vale's JSON output (child_process default is only 1 MB). */
export const MAX_VALE_OUTPUT_BYTES = 16 * 1024 * 1024;
/** Request body cap; leaves room for JSON escaping of the text and the rules. */
export const MAX_BODY_BYTES =
  2 * MAX_INPUT_SIZE +
  2 * MAX_CUSTOM_RULES * MAX_RULE_LENGTH +
  2 * 2 * MAX_VOCABULARY_TERMS * MAX_VOCABULARY_TERM_LENGTH +
  2 * MAX_IGNORED_RULES * MAX_RULE_NAME_LENGTH +
  2 * MAX_SEVERITY_OVERRIDES * (MAX_RULE_NAME_LENGTH + 16) +
  8 * 1024;

export const ALLOWED_STYLES = ['Google', 'Microsoft', 'RedHat'] as const;
export type AllowedStyle = (typeof ALLOWED_STYLES)[number];

/**
 * Vale extension points that are plain data. `script` is deliberately absent:
 * it runs user-supplied Tengo code, which can loop forever.
 */
export const ALLOWED_RULE_EXTENDS = [
  'existence',
  'substitution',
  'occurrence',
  'repetition',
  'consistency',
  'conditional',
  'capitalization',
  'metric',
  'spelling',
  'sequence',
] as const;

export interface CustomRule {
  name: string;
  content: string;
}

export interface LintRequest {
  text: string;
  style: AllowedStyle;
  format: DocumentFormat;
  customRules: CustomRule[];
  vocabulary: Vocabulary;
  /** Rules switched off, as `Style.Rule`. Every name matches `isRuleName`. */
  ignoredRules: string[];
  /** Severity given to rules. Every key matches `isRuleName` and every value is a severity. */
  severities: SeverityOverrides;
}

interface RequestErrorOptions {
  /** Values the interface needs to word the message in the user's language. */
  params?: ApiErrorParams;
  headers?: Record<string, string>;
}

export class RequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly params: ApiErrorParams;
  readonly headers: Record<string, string>;

  /** `message` is English, for API consumers and logs. The interface translates `code`. */
  constructor(message: string, status: number, code: ApiErrorCode, options: RequestErrorOptions = {}) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.params = options.params ?? {};
    this.headers = options.headers ?? {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function label(name: string): string {
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}

/** Throws unless the YAML is a single Vale rule that only uses data-only extension points. */
function assertSafeRule(rule: CustomRule): void {
  let parsed: unknown;
  try {
    parsed = parseYaml(rule.content, { maxAliasCount: 10 });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
    throw new RequestError(`Rule "${label(rule.name)}" is not valid YAML: ${reason}`, 400, 'rule_invalid_yaml', {
      params: { rule: label(rule.name), reason },
    });
  }

  if (!isRecord(parsed)) {
    throw new RequestError(`Rule "${label(rule.name)}" must be a YAML mapping with an "extends" key`, 400, 'rule_not_mapping', {
      params: { rule: label(rule.name) },
    });
  }

  const extendsValue = parsed.extends;
  if (extendsValue === 'script') {
    throw new RequestError(`Rule "${label(rule.name)}": script rules are not allowed`, 400, 'rule_script', {
      params: { rule: label(rule.name) },
    });
  }
  if (typeof extendsValue !== 'string' || !(ALLOWED_RULE_EXTENDS as readonly string[]).includes(extendsValue)) {
    throw new RequestError(
      `Rule "${label(rule.name)}": "extends" must be one of ${ALLOWED_RULE_EXTENDS.join(', ')}`,
      400,
      'rule_extends',
      { params: { rule: label(rule.name), allowed: ALLOWED_RULE_EXTENDS.join(', ') } }
    );
  }
}

/** Terms are written escaped, so any text is safe; only size and control characters are limited. */
function parseTermList(value: unknown, list: 'accept' | 'reject'): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RequestError(`vocabulary.${list} must be an array of strings`, 400, 'vocabulary_invalid');
  }

  const terms = value as string[];
  if (terms.length > MAX_VOCABULARY_TERMS) {
    throw new RequestError(`vocabulary.${list} has more than ${MAX_VOCABULARY_TERMS} terms`, 400, 'vocabulary_too_many', {
      params: { max: MAX_VOCABULARY_TERMS },
    });
  }
  for (const term of terms) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(term)) {
      throw new RequestError(`vocabulary.${list} contains control characters`, 400, 'vocabulary_invalid');
    }
    if (term.trim().length > MAX_VOCABULARY_TERM_LENGTH) {
      throw new RequestError(
        `A term in vocabulary.${list} is longer than ${MAX_VOCABULARY_TERM_LENGTH} characters`,
        400,
        'vocabulary_term_too_long',
        { params: { max: MAX_VOCABULARY_TERM_LENGTH } }
      );
    }
  }
  return normalizeTerms(terms);
}

function parseVocabulary(value: unknown): Vocabulary {
  if (value === undefined || value === null) return EMPTY_VOCABULARY;
  if (!isRecord(value)) {
    throw new RequestError('vocabulary must be an object', 400, 'vocabulary_invalid');
  }
  if (
    (value.spelling !== undefined && typeof value.spelling !== 'boolean') ||
    (value.enforceCase !== undefined && typeof value.enforceCase !== 'boolean')
  ) {
    throw new RequestError('vocabulary.spelling and vocabulary.enforceCase must be booleans', 400, 'vocabulary_invalid');
  }
  return {
    accept: parseTermList(value.accept, 'accept'),
    reject: parseTermList(value.reject, 'reject'),
    spelling: value.spelling === true,
    enforceCase: value.enforceCase !== false,
  };
}

/**
 * The names are written into the .vale.ini, which is line based: a name that is not exactly
 * `Style.Rule` is refused instead of being cleaned up, so nothing odd ever reaches the file.
 */
function parseIgnoredRules(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => !isRuleName(item))) {
    throw new RequestError('ignoredRules must be an array of rule names like "Google.We"', 400, 'ignored_rules_invalid');
  }
  const rules = uniqueRules(value as string[]);
  if (rules.length > MAX_IGNORED_RULES) {
    throw new RequestError(`More than ${MAX_IGNORED_RULES} ignored rules`, 400, 'ignored_rules_too_many', {
      params: { max: MAX_IGNORED_RULES },
    });
  }
  return rules;
}

/**
 * Both the names and the values are written into the .vale.ini. A value that is not exactly one of
 * the three severities is refused, because Vale does not complain about it: it switches the rule off.
 */
function parseSeverities(value: unknown): SeverityOverrides {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new RequestError('severities must be an object like {"Google.We": "error"}', 400, 'severities_invalid');
  }
  const entries = Object.entries(value);
  if (entries.some(([rule, severity]) => !isRuleName(rule) || !isRuleSeverity(severity))) {
    throw new RequestError('severities needs rule names like "Google.We" and the values error, warning or suggestion', 400, 'severities_invalid');
  }
  if (entries.length > MAX_SEVERITY_OVERRIDES) {
    throw new RequestError(`More than ${MAX_SEVERITY_OVERRIDES} rules with their own severity`, 400, 'severities_too_many', {
      params: { max: MAX_SEVERITY_OVERRIDES },
    });
  }
  return Object.fromEntries(entries) as SeverityOverrides;
}

/** Validates the decoded JSON body. Every field is checked for type before it is used. */
export function parseLintRequest(body: unknown): LintRequest {
  if (!isRecord(body)) {
    throw new RequestError('Request body must be a JSON object', 400, 'invalid_request');
  }

  const { text, style, customRules, vocabulary, format, ignoredRules, severities } = body;

  if (typeof text !== 'string' || text.length === 0) {
    throw new RequestError('No text provided or invalid format', 400, 'text_required');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_SIZE) {
    throw new RequestError(
      `Text exceeds the maximum size of ${Math.round(MAX_INPUT_SIZE / 1024)} KB. Lint a shorter section.`,
      413,
      'text_too_large',
      { params: { maxKb: Math.round(MAX_INPUT_SIZE / 1024) } }
    );
  }
  if (typeof style !== 'string' || !(ALLOWED_STYLES as readonly string[]).includes(style)) {
    throw new RequestError('Invalid style guide selected', 400, 'invalid_style');
  }

  if (format !== undefined && format !== null && !isDocumentFormat(format)) {
    throw new RequestError('Invalid document format selected', 400, 'invalid_format');
  }

  const rules: CustomRule[] = [];
  if (customRules !== undefined && customRules !== null) {
    if (!Array.isArray(customRules)) {
      throw new RequestError('customRules must be an array', 400, 'invalid_request');
    }
    if (customRules.length > MAX_CUSTOM_RULES) {
      throw new RequestError(`Too many custom rules. Maximum is ${MAX_CUSTOM_RULES}`, 400, 'too_many_rules', {
        params: { max: MAX_CUSTOM_RULES },
      });
    }
    for (const item of customRules as unknown[]) {
      if (!isRecord(item) || typeof item.name !== 'string' || typeof item.content !== 'string') {
        throw new RequestError('Each custom rule needs a string "name" and a string "content"', 400, 'invalid_request');
      }
      if (item.content.length > MAX_RULE_LENGTH) {
        throw new RequestError(
          `Rule "${label(item.name)}" exceeds the maximum size of ${MAX_RULE_LENGTH} characters`,
          400,
          'rule_too_large',
          { params: { rule: label(item.name), max: MAX_RULE_LENGTH } }
        );
      }
      const rule: CustomRule = { name: item.name, content: item.content };
      assertSafeRule(rule);
      rules.push(rule);
    }
  }

  return {
    text,
    style: style as AllowedStyle,
    format: isDocumentFormat(format) ? format : DEFAULT_FORMAT,
    customRules: rules,
    vocabulary: parseVocabulary(vocabulary),
    ignoredRules: parseIgnoredRules(ignoredRules),
    severities: parseSeverities(severities),
  };
}

/** Reads the request body as text, aborting as soon as it grows past the limit. */
export async function readLimitedBody(req: Request, limitBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw new RequestError('Request body is too large', 413, 'body_too_large');
  }
  if (!req.body) {
    throw new RequestError('Request body is empty', 400, 'invalid_request');
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limitBytes) {
      await reader.cancel();
      throw new RequestError('Request body is too large', 413, 'body_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestError('Request body is not valid JSON', 400, 'invalid_request');
  }
}

/**
 * Rejects cross-site callers. A text/plain POST is a "simple" cross-origin request
 * that browsers send without a preflight, so the content type is checked as well.
 */
export function assertTrustedRequest(req: Request): void {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new RequestError('Content-Type must be application/json', 415, 'unsupported_media_type');
  }

  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new RequestError('Cross-site requests are not allowed', 403, 'forbidden');
  }

  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== host) {
      throw new RequestError('Cross-origin requests are not allowed', 403, 'forbidden');
    }
  }
}

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateWindows = new Map<string, RateWindow>();

function clientKey(req: Request): string {
  // Only trustworthy behind a proxy that overwrites these headers (Netlify, Vercel, nginx).
  const forwarded = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Fixed-window counter kept in memory. On serverless platforms each instance has its own
 * counter, so this limits bursts per instance rather than enforcing a global quota.
 */
export function enforceRateLimit(req: Request, now: number = Date.now()): void {
  if (rateWindows.size > 1_000) {
    for (const [key, window] of rateWindows) {
      if (window.resetAt <= now) rateWindows.delete(key);
    }
  }

  const key = clientKey(req);
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }

  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new RequestError('Too many requests. Wait a moment and try again.', 429, 'rate_limited', {
      params: { seconds: retryAfter },
      headers: { 'Retry-After': String(retryAfter) },
    });
  }
}

let activeLints = 0;

/** Runs `task` only if a Vale slot is free; otherwise answers 503 instead of queueing CPU work. */
export async function withLintSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeLints >= MAX_CONCURRENT_LINTS) {
    throw new RequestError('The linting service is busy. Try again in a few seconds.', 503, 'busy', {
      headers: { 'Retry-After': '5' },
    });
  }
  activeLints += 1;
  try {
    return await task();
  } finally {
    activeLints -= 1;
  }
}
