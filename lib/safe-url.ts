/**
 * Returns the URL only if it uses http or https. Alert links come from rule files, which can be
 * uploaded by the user, so anything else (javascript:, data:, ...) must never reach an href.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
