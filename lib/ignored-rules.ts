/**
 * Rules the user chose to ignore. A rule is named like Vale names it in an alert: `Style.Rule`
 * (`Google.We`, `Vale.Spelling`, `Custom.terms`).
 *
 * The names reach the generated .vale.ini as `Style.Rule = NO`. The ini format is line based, so a
 * name with a line break could add a whole section (measured: a value written raw changed which
 * styles Vale applied). Names are therefore checked against a strict pattern, on the server and
 * again wherever they are read back from storage. This module has no server-only imports.
 */

export const MAX_IGNORED_RULES = 200;
export const MAX_RULE_NAME_LENGTH = 80;

/**
 * Style, a dot, rule. The rule may start with a digit because a custom rule file can (`1-rule.yml`
 * is reported as `Custom.1-rule`); Vale cuts a file name at its first dot, so no further dot occurs.
 */
const RULE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isRuleName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_RULE_NAME_LENGTH && RULE_NAME_PATTERN.test(value);
}

/** Removes repeated names, keeping the order in which the user ignored them. */
export function uniqueRules(rules: readonly string[]): string[] {
  return [...new Set(rules)];
}

/** The lines of a .vale.ini that switch the rules off: `Google.We = NO`. */
export function buildIgnoreLines(rules: readonly string[]): string[] {
  return uniqueRules(rules).map((rule) => `${rule} = NO`);
}

/** Reads what was stored. Anything that is not a valid list of rule names is ignored. */
export function parseStoredIgnoredRules(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    const rules = uniqueRules(value.filter(isRuleName)).slice(0, MAX_IGNORED_RULES);
    return rules.length > 0 ? rules : null;
  } catch {
    return null;
  }
}
