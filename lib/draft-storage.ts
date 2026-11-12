import type { CustomRule } from '@/types/lint';

/**
 * Browser storage for the draft and the preferences. Everything here is defensive: storage can be
 * blocked (private windows, site settings), full, or hold data written by another version.
 */

export const DRAFT_KEY = 'verbalize:draft:v1';
export const PREFS_KEY = 'verbalize:prefs:v1';

// Same limits as the API (lib/lint-guards.ts), repeated here because that module is server-only
const MAX_RULES = 10;
const MAX_RULE_LENGTH = 10 * 1024;
/** Well below the usual 5 MB quota, and far above the 200 KB the API accepts. */
const MAX_DRAFT_CHARS = 1_000_000;

export interface StoredDraft {
  text: string;
  customRules: CustomRule[];
  savedAt: number;
}

export interface StoredPrefs {
  autosave: boolean;
  style: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRule(value: unknown): value is CustomRule {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.content === 'string' &&
    value.content.length <= MAX_RULE_LENGTH
  );
}

/** Returns the stored draft, or null if there is none or it is not something this version wrote. */
export function parseDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.text !== 'string') return null;
    const customRules = Array.isArray(value.customRules) ? value.customRules.filter(isRule).slice(0, MAX_RULES) : [];
    const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : Date.now();
    return { text: value.text, customRules, savedAt };
  } catch {
    return null;
  }
}

/** Autosave is on unless the user turned it off. */
export function parsePrefs(raw: string | null): StoredPrefs {
  const fallback: StoredPrefs = { autosave: true, style: null };
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return fallback;
    return {
      autosave: value.autosave !== false,
      style: typeof value.style === 'string' ? value.style : null,
    };
  } catch {
    return fallback;
  }
}

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the browser refused the write (blocked or full storage). */
export function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // nothing to remove if storage is not available
  }
}

export interface SaveResult {
  outcome: 'saved' | 'removed' | 'failed';
  /** When the stored draft was written. Unchanged content keeps its original time. */
  savedAt: number;
}

/**
 * Saves the draft, or removes it when there is nothing to keep, so that clearing the editor
 * really clears what is stored. Content identical to what is already stored is not written again:
 * the draft keeps its original time, which is what "restored from" tells the user.
 */
export function saveDraft(text: string, customRules: CustomRule[], now: number = Date.now()): SaveResult {
  if (text.length === 0 && customRules.length === 0) {
    removeStorage(DRAFT_KEY);
    return { outcome: 'removed', savedAt: now };
  }
  if (text.length > MAX_DRAFT_CHARS) return { outcome: 'failed', savedAt: now };

  const current = parseDraft(readStorage(DRAFT_KEY));
  if (current && current.text === text && JSON.stringify(current.customRules) === JSON.stringify(customRules)) {
    return { outcome: 'saved', savedAt: current.savedAt };
  }

  const draft: StoredDraft = { text, customRules, savedAt: now };
  return { outcome: writeStorage(DRAFT_KEY, JSON.stringify(draft)) ? 'saved' : 'failed', savedAt: now };
}

export function savePrefs(prefs: StoredPrefs): void {
  writeStorage(PREFS_KEY, JSON.stringify(prefs));
}
