/** The languages the interface is available in. */
export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Remembers an explicit choice. A functional cookie, so that the server can render the right language. */
export const LOCALE_COOKIE = 'verbalize-locale';

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a supported language from an `Accept-Language` header: the first tag, by quality, that is
 * English or Portuguese. Any Portuguese variant maps to pt-BR. Returns null when none matches.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const q = quality ? Number.parseFloat(quality.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { tag } of ranked) {
    if (tag === 'pt' || tag.startsWith('pt-')) return 'pt-BR';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return null;
}

/** An explicit choice (cookie) wins over the browser's language, which wins over the default. */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
