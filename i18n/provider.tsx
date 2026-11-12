'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { LOCALE_COOKIE } from './locale';
import type { Locale } from './locale';
import { createTranslator } from './translate';
import type { Translate } from './translate';

interface I18nValue {
  locale: Locale;
  /** Switches the language at once, without reloading, and remembers the choice in a cookie. */
  setLocale: (locale: Locale) => void;
  t: Translate;
  /** Hour and minute, in the interface language. */
  formatTime: (date: Date) => string;
  /** Date and time, in the interface language. */
  formatDateTime: (date: Date) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

interface I18nProviderProps {
  /** Decided on the server (cookie, then Accept-Language), so the first paint is already right. */
  initialLocale: Locale;
  children: React.ReactNode;
}

export function I18nProvider({ initialLocale, children }: I18nProviderProps): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Assistive technology and the browser's own features (hyphenation, spellcheck) read this
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next);
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale),
      formatTime: (date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      formatDateTime: (date) => date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
