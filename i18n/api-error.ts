import { isApiErrorCode } from '@/lib/api-errors';
import type { ApiErrorParams } from '@/lib/api-errors';
import type { Translate } from './translate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Words an error response of /api/lint in the interface language, from its `code` and `params`.
 * A response without a known code falls back to the English `error` text, then to a generic message.
 */
export function describeApiError(data: unknown, t: Translate): string {
  if (!isRecord(data)) return t('error.unknown');

  if (isApiErrorCode(data.code)) {
    const params: ApiErrorParams = {};
    if (isRecord(data.params)) {
      for (const [name, value] of Object.entries(data.params)) {
        if (typeof value === 'string' || typeof value === 'number') params[name] = value;
      }
    }
    return t(`api.${data.code}`, params);
  }

  return typeof data.error === 'string' && data.error.length > 0 ? data.error : t('error.unknown');
}
