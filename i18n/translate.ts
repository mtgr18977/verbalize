import { en } from './messages.en';
import { ptBR } from './messages.pt-br';
import type { Locale } from './locale';

type MessageKey = keyof typeof en;

/** The plural variants (`key_one`, `key_other`) are addressed by their base key. */
type PluralBase<K extends string> = K extends `${infer Base}_one` | `${infer Base}_other` ? Base : K;
export type TranslationKey = PluralBase<MessageKey>;
export type TranslationParams = Record<string, string | number>;
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, 'pt-BR': ptBR };

export function getCatalog(locale: Locale): Record<MessageKey, string> {
  return CATALOGS[locale];
}

/** All keys, plural variants included. */
export function getMessageKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}

/** Placeholders (`{name}`) used by a message. */
export function getPlaceholders(message: string): string[] {
  return Array.from(new Set(Array.from(message.matchAll(/\{(\w+)\}/g), (match) => match[1]))).sort();
}

export function createTranslator(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  const plurals = new Intl.PluralRules(locale);

  return (key, params) => {
    const lookup = catalog as Record<string, string | undefined>;
    let message = lookup[key];

    if (typeof params?.count === 'number') {
      // Zero takes the plural form ("0 caracteres", "0 chars"), although CLDR's rule for Portuguese
      // counts 0 as "one". Categories other than "one" (few, many...) use the general form.
      const category = params.count === 0 ? 'other' : plurals.select(params.count);
      message = lookup[`${key}_${category === 'one' ? 'one' : 'other'}`] ?? lookup[`${key}_other`] ?? message;
    }

    // A key that does not exist is shown as it is, so that it stands out instead of being blank
    const template = message ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name];
      return value === undefined ? placeholder : String(value);
    });
  };
}
