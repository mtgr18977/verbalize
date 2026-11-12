import { MAX_IGNORED_RULES, isRuleName } from '@/lib/ignored-rules';

/**
 * The severity a user gave to a rule, by rule name (`Google.We`). It reaches the .vale.ini as
 * `Google.We = error`. Three things were measured with Vale 3.9.5, and each shapes this module:
 *
 *  - Anything but `error`, `warning` or `suggestion` (`Error`, `bogus`) does not fail: it silently
 *    **switches the rule off**. Values are therefore checked, never passed through.
 *  - A severity line **switches a rule on** when its style is not active (`Microsoft.We = error`
 *    under the Google style, `Vale.Spelling = error` without the built-in style). `buildValeIni`
 *    writes lines only for active styles.
 *  - When a key appears twice the FIRST line wins, whatever the values. Severities are therefore
 *    written after every line that turns a rule off, so they can neither bring a rule back nor
 *    override an ignored one.
 *
 * No server-only imports: the interface reads stored values with the same checks.
 */

export const RULE_SEVERITIES = ['error', 'warning', 'suggestion'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];
export type SeverityOverrides = Record<string, RuleSeverity>;

export const MAX_SEVERITY_OVERRIDES = MAX_IGNORED_RULES;

export function isRuleSeverity(value: unknown): value is RuleSeverity {
  return typeof value === 'string' && (RULE_SEVERITIES as readonly string[]).includes(value);
}

/** The style a rule belongs to: `Google` for `Google.We`. */
export function styleOfRule(rule: string): string {
  return rule.slice(0, rule.indexOf('.'));
}

/**
 * The lines of a .vale.ini that set the severity of rules: `Google.We = error`. With `activeStyles`,
 * rules of other styles are left out (see above: they would be switched on).
 */
export function buildSeverityLines(overrides: Readonly<Record<string, RuleSeverity>>, activeStyles?: readonly string[]): string[] {
  return Object.entries(overrides)
    .filter(([rule]) => !activeStyles || activeStyles.includes(styleOfRule(rule)))
    .map(([rule, severity]) => `${rule} = ${severity}`);
}

/** Reads what was stored. Entries that are not a valid rule name with a valid severity are dropped. */
export function parseStoredSeverities(raw: string | null): SeverityOverrides | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const entries = Object.entries(value).filter(
      (entry): entry is [string, RuleSeverity] => isRuleName(entry[0]) && isRuleSeverity(entry[1])
    );
    return entries.length > 0 ? Object.fromEntries(entries.slice(0, MAX_SEVERITY_OVERRIDES)) : null;
  } catch {
    return null;
  }
}
