/**
 * Machine-readable reasons for the errors of POST /api/lint. The `error` text of the response stays
 * in English for API consumers and logs; the interface shows its own translation of the code.
 */
export const API_ERROR_CODES = [
  'unsupported_media_type',
  'forbidden',
  'rate_limited',
  'busy',
  'timeout',
  'output_too_large',
  'body_too_large',
  'text_too_large',
  'text_required',
  'invalid_style',
  'invalid_format',
  'asciidoc_unavailable',
  'invalid_request',
  'too_many_rules',
  'rule_too_large',
  'rule_invalid_yaml',
  'rule_not_mapping',
  'rule_script',
  'rule_extends',
  'vocabulary_invalid',
  'vocabulary_too_many',
  'vocabulary_term_too_long',
  'ignored_rules_invalid',
  'ignored_rules_too_many',
  'vale_failed',
  'parse_failed',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ApiErrorParams = Record<string, string | number>;

export interface ApiErrorBody {
  error: string;
  code?: ApiErrorCode;
  params?: ApiErrorParams;
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}
