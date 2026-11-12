/**
 * English interface text, and the source of truth for the keys.
 *
 * - `{name}` is replaced by a parameter.
 * - A key that depends on a number has `_one` and `_other` variants and is called with `count`.
 * - The Portuguese file must have exactly these keys and the same `{placeholders}`
 *   (checked at compile time and by tests/i18n.spec.ts).
 */
export const en = {
  'meta.description': 'A writing assistant for technical writers, with Vale linting',

  'settings.title': 'Settings',
  'settings.open': 'Open settings',
  'settings.close': 'Close settings',
  'settings.styleGuide': 'Base style guide',
  'settings.styleGuideHelp': 'Primary ruleset for validation. The guides check English text, and their messages are in English.',
  'settings.document': 'Document',
  'settings.uploadDocument': 'Upload MD/MDX',
  'settings.customRules': 'Custom rules',
  'settings.downloadExample': 'Download example',
  'settings.uploadRule': 'Upload .yml rule',
  'settings.removeRule': 'Remove rule {name}',
  'settings.drafts': 'Drafts',
  'settings.saveDraft': 'Save my draft in this browser',
  'settings.saveDraftHelp':
    'The text and rules stay on this device and are never sent anywhere except to be reviewed. Turn this off on a shared computer: it also deletes the saved draft.',
  'settings.language': 'Language / Idioma',

  'header.run': 'Run Linting',
  'header.running': 'Analyzing...',
  'header.runTitle': 'Run Linting (Ctrl/⌘ + Enter)',
  'header.toggleTheme': 'Toggle theme',

  'status.notReviewed': 'Not reviewed',
  'status.reviewing': 'Reviewing…',
  'status.reviewedAt': 'Reviewed at {time}',
  'status.outOfDate': 'Out of date',

  'editor.editor': 'Editor',
  'editor.preview': 'Preview',
  'editor.alerts': 'Alerts',
  'editor.chars_one': '{count} char',
  'editor.chars_other': '{count} chars',
  'editor.placeholder': 'Start typing your documentation (Markdown supported)...',
  'editor.ariaLabel': 'Document text',
  'editor.copy': 'Copy content',
  'editor.clear': 'Clear editor',
  'editor.confirmClear': 'Are you sure you want to clear the editor?',
  'editor.documentView': 'Document view',
  'editor.panels': 'Panels',
  'editor.documentRegion': 'Document',
  'preview.empty': '*Rich preview will appear here...*',

  'alerts.clear': 'Clear',
  'alerts.notReviewedTitle': 'Not reviewed yet',
  'alerts.notReviewedDetail': 'Press {run} (Ctrl+Enter) to check this document against {style}.',
  'alerts.reviewingTitle': 'Reviewing…',
  'alerts.reviewingDetail': 'Checking the text against {style}.',
  'alerts.noOpenTitle': 'No open alerts',
  'alerts.noOpenDetail': 'The document changed after the last review. Run {run} again to confirm.',
  'alerts.noAlertsTitle_one': 'No alerts in {count} line',
  'alerts.noAlertsTitle_other': 'No alerts in {count} lines',
  'alerts.noAlertsDetail': 'Reviewed at {time} with {style}.',
  'alerts.staleText':
    'The text changed after the last review. Alerts follow your edits, and the ones you edited are marked. Press {run} (Ctrl+Enter) to refresh.',
  'alerts.staleRules':
    'The style guide or custom rules changed after the last review. Press {run} (Ctrl+Enter) to refresh.',
  'alerts.edited': 'text edited',
  'alerts.styleGuide': 'Style guide',
  'alerts.styleGuideLabel': 'Open the style guide page for {rule}',

  'severity.error': 'error',
  'severity.warning': 'warning',
  'severity.suggestion': 'suggestion',

  'fix.replace': 'Replace with “{value}”',
  'fix.remove': 'Remove',
  'fix.trim': 'Trim “{chars}”',
  'fix.regex': 'Apply suggested edit',

  'draft.saved': 'Saved',
  'draft.notSaved': 'Not saved',
  'draft.notSavedHelp':
    'The browser blocked or filled its storage, so this draft only exists in this tab. Copy your text somewhere safe.',
  'draft.off': 'Autosave off',
  'draft.restored': 'Restored your draft from {when}.',
  'draft.startFresh': 'Start fresh',
  'draft.confirmDiscard': 'Click again to discard',
  'draft.dismiss': 'Dismiss',

  'error.emptyText': 'Please enter some text to lint.',
  'error.lintFailed': 'Linting failed: {message}',
  'error.connection': 'Failed to connect to the linting service.',
  'error.unknown': 'Unknown error',

  'api.unsupported_media_type': 'The request must be sent as JSON.',
  'api.forbidden': 'Requests from other sites are not allowed.',
  'api.rate_limited': 'Too many requests. Wait {seconds} s and try again.',
  'api.busy': 'The linting service is busy. Try again in a few seconds.',
  'api.timeout': 'Linting took longer than {seconds} s and was stopped. Lint a shorter section.',
  'api.output_too_large': 'This text produced too many alerts to return. Lint a shorter section.',
  'api.body_too_large': 'The request is too large.',
  'api.text_too_large': 'The text is larger than {maxKb} KB. Lint a shorter section.',
  'api.text_required': 'There is no text to lint.',
  'api.invalid_style': 'That style guide is not available.',
  'api.invalid_request': 'The request is not valid.',
  'api.too_many_rules': 'Too many custom rules. The maximum is {max}.',
  'api.rule_too_large': 'Rule “{rule}” is larger than {max} characters.',
  'api.rule_invalid_yaml': 'Rule “{rule}” is not valid YAML: {reason}',
  'api.rule_not_mapping': 'Rule “{rule}” must be a YAML mapping with an "extends" key.',
  'api.rule_script': 'Rule “{rule}”: script rules are not allowed.',
  'api.rule_extends': 'Rule “{rule}”: "extends" must be one of {allowed}.',
  'api.vale_failed': 'The linter failed to run. Try again.',
  'api.parse_failed': 'The linter returned a result that could not be read.',
  'api.internal': 'Something went wrong on the server. Try again.',
} as const;
