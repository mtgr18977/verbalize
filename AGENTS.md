# AGENTS.md

**Version:** 1.1  
**Last Updated:** February 04, 2026  
**Document Purpose:** Critical context, architectural guidelines, and operational instructions for AI agents (LLMs) interacting with the **Verbalize** repository.

---

## 1. Project Overview

**Verbalize** is a web-based assistant for Technical Writers. It provides a real-time linting interface for documentation, powered by the **Vale** CLI. It ensures that technical content adheres to specific style guides (Google, Microsoft, Red Hat).

### Core Tech Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | Next.js (App Router) | 15+ | Server-side rendering and routing |
| Language | TypeScript | Latest | Type-safe development |
| Styling | Tailwind CSS | Latest | Utility-first CSS framework |
| Icons | Lucide React | Latest | Icon system |
| Linter | Vale CLI | Latest | Prose linting engine |
| Testing | Playwright | Latest | End-to-end testing |

---

## 2. Repository Structure

```
verbalize/
├── app/
│   ├── api/
│   │   └── lint/
│   │       └── route.ts          # Core API endpoint for Vale integration
│   ├── layout.tsx                # Root layout component
│   └── page.tsx                  # Main application interface
├── components/
│   ├── draft-status.tsx          # "Saved" label and the restored-draft notice
│   └── lint-editor.tsx           # CodeMirror 6 editor with Vale diagnostics
├── hooks/
│   └── use-draft-autosave.ts     # Saves and restores the draft in localStorage
├── lib/
│   ├── draft-storage.ts          # Defensive localStorage helpers and draft parsing
│   ├── lint-guards.ts            # Limits and request guards for /api/lint
│   ├── vale-fixes.ts             # One-click fixes derived from Vale's `Action`
│   └── safe-url.ts               # Only http(s) links reach an href
├── types/
│   └── lint.ts                   # Vale alert types shared by the UI and the editor
├── styles/
│   ├── Google/                   # Google Developer Documentation Style Guide
│   ├── Microsoft/                # Microsoft Writing Style Guide
│   └── RedHat/                   # Red Hat Documentation Style Guide
├── scripts/
│   └── install-vale.js           # Vale binary installation script
├── tests/
│   └── *.spec.ts                 # Playwright E2E test specifications
├── .vale.ini                     # Vale configuration file
├── netlify.toml                  # Netlify deployment configuration
├── tsconfig.json                 # TypeScript configuration
└── package.json                  # Project dependencies and scripts
```

---

## 3. Architecture Flow

### Request-Response Cycle

```
┌─────────────────┐
│  User Interface │
│   (Browser)     │
└────────┬────────┘
         │
         │ POST /api/lint
         │ { text: string }
         ▼
┌─────────────────────────┐
│  Next.js API Route      │
│  /app/api/lint/route.ts │
└────────┬────────────────┘
         │
         │ 1. Receive text input
         │ 2. Create temporary file
         │ 3. Execute Vale CLI
         ▼
┌─────────────────┐
│   Vale Engine   │
│  (CLI Process)  │
└────────┬────────┘
         │
         │ 4. Load .vale.ini
         │ 5. Apply style rules
         │ 6. Generate diagnostics
         ▼
┌─────────────────────────┐
│  JSON Response          │
│  { diagnostics: [...] } │
└────────┬────────────────┘
         │
         │ 7. Parse results
         │ 8. Format response
         ▼
┌─────────────────┐
│  User Interface │
│  (Display lint  │
│   suggestions)  │
└─────────────────┘
```

### Data Flow Details

1. **Input Processing**: User text is sanitized and validated before processing.
2. **Temporary File Creation**: Vale requires file-based input; text is written to a temporary file.
3. **Vale Execution**: The Vale binary is invoked with the `.vale.ini` configuration.
4. **Result Parsing**: Vale outputs JSON-formatted diagnostics with severity levels (error, warning, suggestion).
5. **Response Formatting**: Diagnostics are transformed into a frontend-friendly structure.

---

## 4. Development Guidelines for Agents

### Code Conventions

| Convention | Standard | Example |
|-----------|----------|---------|
| **File Naming** | kebab-case for files | `lint-results.tsx` |
| **Component Naming** | PascalCase for components | `LintEditor.tsx` |
| **Function Naming** | camelCase for functions | `processLintResults()` |
| **Type/Interface Naming** | PascalCase with descriptive names | `LintDiagnostic`, `ValeConfig` |
| **Constant Naming** | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| **CSS Classes** | Tailwind utility classes | `flex items-center gap-2` |
| **Import Order** | 1. React<br>2. External libraries<br>3. Internal components<br>4. Types<br>5. Utilities | See example below |
| **Error Handling** | Try-catch with specific error types | `catch (error: ValeError)` |

#### Import Order Example

```typescript
// 1. React imports
import { useState, useEffect } from 'react';

// 2. External libraries
import { AlertCircle } from 'lucide-react';

// 3. Internal components
import { LintEditor } from '@/components/LintEditor';
import { ResultsPanel } from '@/components/ResultsPanel';

// 4. Types
import type { LintDiagnostic, ValeResponse } from '@/types';

// 5. Utilities
import { formatDiagnostic } from '@/lib/utils';
```

### TypeScript Standards

1. **Strict Mode Enabled**: All code must pass TypeScript strict mode checks.
2. **Explicit Return Types**: Functions must declare return types explicitly.
3. **Interface over Type**: Prefer `interface` for object shapes unless union/intersection is required.
4. **No `any` Types**: Use `unknown` or specific types instead of `any`.

#### Example Interface

```typescript
interface ValeResponse {
  diagnostics: LintDiagnostic[];
  metadata: {
    timestamp: string;
    valeVersion: string;
    rulesApplied: string[];
  };
}

interface LintDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'suggestion';
  message: string;
  rule: string;
  replacement?: string;
}
```

### Component Pattern Standards

```typescript
// Functional component with TypeScript props
interface EditorProps {
  initialValue?: string;
  onLint: (text: string) => Promise<void>;
  disabled?: boolean;
}

export function Editor({ initialValue = '', onLint, disabled = false }: EditorProps) {
  const [text, setText] = useState(initialValue);
  
  // Component logic with proper type safety
  const handleLint = async () => {
    try {
      await onLint(text);
    } catch (error) {
      console.error('Linting failed:', error);
    }
  };
  
  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        className="w-full p-4 border rounded-lg"
        aria-label="Text editor for documentation linting"
      />
      <button onClick={handleLint} disabled={disabled}>
        Run Lint
      </button>
    </div>
  );
}
```

### Vale Integration Guidelines

1. **Configuration Path**: Always reference `.vale.ini` from the project root.
2. **Style Directory**: Vale styles are located in `/styles` and should not be modified manually.
3. **Binary Location**: Vale binary should be in system PATH or `node_modules/.bin/`.
4. **Output Format**: Always use `--output=JSON` flag for structured results.

### Environment Configuration

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `VALE_CONFIG_PATH` | Path to .vale.ini | `./.vale.ini` | No |
| `VALE_STYLES_PATH` | Path to styles directory | `./styles` | No |
| `MAX_INPUT_SIZE` | Maximum document size in bytes (UTF-8) | 204800 (200 KB) | No |
| `LINT_TIMEOUT_MS` | Hard time limit for one Vale run; the process is killed and the API answers 504 | 8000 | No |
| `MAX_CONCURRENT_LINTS` | Vale processes allowed at once per server instance; extra requests get 503 | 2 | No |
| `RATE_LIMIT_MAX` | Requests per client per minute (in-memory, per instance); extra requests get 429 | 30 | No |
| `NODE_ENV` | Environment mode | `development` | Yes |

---

## 5. Local Setup & Commands

### Installation

```bash
# Install dependencies
npm install

# Install Vale binary (if not in PATH)
node scripts/install-vale.js

# Verify Vale installation
vale --version
```

### Development Workflow

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npm run dev` | Start development server on port 3000 | Active development |
| `npm run build` | Create production build | Pre-deployment testing |
| `npm run start` | Start production server | Production environment |
| `npm test` | Run Playwright E2E tests | Before committing changes |
| `npm run lint` | Run ESLint checks | Code quality verification |
| `npm run type-check` | Run TypeScript type checking | Before build |

### Testing Commands

```bash
# Run all tests
npm test

# Run tests in UI mode
npm run test:ui

# Run specific test file
npx playwright test tests/lint.spec.ts

# Generate test report
npx playwright show-report
```

---

## 6. Context & Design Philosophy

**Primary Goal**: Productivity and clarity for technical writers.

### User Experience Principles

1. **Minimal Cognitive Load**: Interface prioritizes the writing workspace with non-intrusive feedback.
2. **Real-time Feedback**: Linting results appear immediately without page reloads.
3. **Accessibility First**: All interactive elements include proper ARIA labels and keyboard navigation.
4. **Single-Page Workshop**: Input (text editor) and output (diagnostics) are the primary focal points.

### Visual Theme ("Diagnóstico")

- Colors are semantic tokens defined in `app/globals.css` (`paper`, `sheet`, `ink`, `ink-2`, `rule`, `accent`, `err`, `warn`, `select`) and flip with the `.dark` class. Use `bg-sheet text-ink border-rule`, not `bg-gray-*` and not `dark:` variants.
- Every text/background pair must keep a contrast ratio of at least 4.5:1 (checked in `tests/theme.spec.ts`).
- Severity is never color-only: errors use a wavy underline, warnings a dashed one and suggestions a dotted one.
- Corners are 2-3 px, there are no shadows or gradients, labels are sentence case and at least 12 px (`text-xs`), and animations must respect `prefers-reduced-motion`.
- Fonts are Atkinson Hyperlegible Next (interface) and Atkinson Hyperlegible Mono (editor), loaded in `app/layout.tsx` with variables on `<html>`.
- Layout: below the `lg` breakpoint (1024 px) the app is a single column with a bottom tab bar (Editor, Preview, Alerts) and the settings are a drawer; from `lg` up the editor sits beside the alerts and Preview is a tab of the left pane. Use `h-dvh`, keep touch targets at 36 px or more on phones, and keep form fields at 16 px on phones so iOS does not zoom.
- Alerts render as compiler-style diagnostics: severity, rule, position, the offending line and a `^^^` pointer. Tests find them with `data-testid="alert-card"`.

### Editor (CodeMirror 6)

- The editor is `components/lint-editor.tsx`. It is themed only with the CSS variables of the theme, so it follows light and dark mode without being reconfigured.
- Alerts are CodeMirror diagnostics. `LintEditor` receives `alerts` (give it a new array only when there is a new review) and `reviewedText`; underlines are drawn only while the document still equals the reviewed text. After that the editor maps each alert through the user's edits and reports where it is now (`onPositionsChange`). An alert whose own text was edited is dropped, and the panel shows it as "text edited".
- One-click fixes come from Vale's `Action` (`replace`, `remove`, `edit` with `trim_*` or `regex`); see `lib/vale-fixes.ts`. Fixes appear in the hover tooltip and in the alert card, and both go through the same code.
- Ctrl/Cmd+Enter is removed from CodeMirror's keymap on purpose: the page uses it to run the review. F8 and Shift+F8 move between alerts.
- Markdown support is built on `@lezer/markdown` directly. Do not add `@codemirror/lang-markdown`: it adds about 87 KB (gzip) of embedded HTML, CSS and JavaScript highlighting that a prose editor does not use.
- Browser spellcheck is off, because its red squiggles would collide with the linter's underlines.
- Tests: use `tests/helpers/editor.ts` (`editor`, `setText`, `docText`, `review`). The editor mounts after hydration, so wait for it before reading its styles.

### Autosave (drafts)

- `hooks/use-draft-autosave.ts` keeps the text and the uploaded rules under `verbalize:draft:v1`, and the style guide and the autosave choice under `verbalize:prefs:v1`. The draft is restored on load with a notice ("Restored your draft from ..."); reviews are never stored, because they would describe text that may have changed.
- Saving starts only after the stored draft has been read. Never save before restoring: the empty editor of a fresh load would overwrite the draft.
- Writes are debounced (600 ms) and flushed on `pagehide` and when the page becomes hidden. Identical content is not rewritten, so a draft keeps its original time. Clearing the editor removes the stored draft.
- Every storage call is wrapped: blocked or full storage shows "Not saved" and the editor keeps working; unreadable or malformed data is ignored (`parseDraft` validates shape and limits).
- The documents can be confidential and `localStorage` is plain text, so "Save my draft in this browser" in the settings turns autosave off and deletes the stored draft.
- Known limitation: with two tabs open, the last tab to save wins; other tabs' writes are not merged.
- Tests: `tests/autosave.spec.ts` seeds storage with `addInitScript` (guarded with `sessionStorage` so it runs once per context).

### Design Constraints

- Documents up to 200 KB (`MAX_INPUT_SIZE`) are linted per request. Larger files must be linted in sections. Vale's run time grows faster than linearly with the number of alerts (measured: 25 KB of alert-dense text takes about 5 s, 100 KB about 66 s), so `LINT_TIMEOUT_MS` is what actually bounds CPU time.
- Custom rules may only use data-only `extends` types (`existence`, `substitution`, `occurrence`, `repetition`, `consistency`, `conditional`, `capitalization`, `metric`, `spelling`, `sequence`). `script` rules are rejected because they can run forever. The allow-list lives in `lib/lint-guards.ts`.
- `/api/lint` requires `Content-Type: application/json` and rejects cross-site callers (`Sec-Fetch-Site`, `Origin`).
- Lint results must display within 2 seconds for typical documents (< 10,000 words).
- Interface must be fully functional without JavaScript (progressive enhancement).

---

## 7. Known Constraints & Limitations

### Technical Constraints

| Constraint | Impact | Mitigation Strategy |
|-----------|--------|---------------------|
| **CLI Dependency** | Server-side execution required | Cache Vale binary; use serverless-friendly alternatives if needed |
| **File Size Limits** | Documents > 1MB may cause timeouts | Implement chunking for large files |
| **Style Guide Updates** | Manual sync required with upstream | Document update process; consider automation |
| **Binary Availability** | Vale must be installed in deployment environment | Use `install-vale.js` in CI/CD pipeline |
| **Concurrent Requests** | Multiple simultaneous lint operations | Implement request queuing or rate limiting |

### Performance Considerations

- **Large Files**: Documents exceeding 100,000 characters may require stream processing optimization.
- **Multiple Style Guides**: Enabling all style guides simultaneously increases processing time by approximately 40%.
- **Cold Starts**: First request after deployment may take 3-5 seconds due to Vale initialization.

### Deployment-Specific Notes

- **Netlify Functions**: API routes are deployed as Netlify Functions with a 10-second timeout limit.
- **Binary Persistence**: Vale binary must be included in deployment package or installed via build script.
- **Environment Variables**: Ensure all required environment variables are configured in Netlify dashboard.

---

## 8. Troubleshooting Guide

### Common Issues

#### Issue: Vale binary not found

**Symptoms:**
```
Error: spawn vale ENOENT
```

**Resolution:**
```bash
# Install Vale manually
node scripts/install-vale.js

# Or add Vale to system PATH
export PATH="$PATH:/path/to/vale"

# Verify installation
vale --version
```

---

#### Issue: Style guide not loading

**Symptoms:**
```
Error: Could not find style 'Google'
```

**Resolution:**
1. Verify `.vale.ini` configuration:
```ini
StylesPath = styles
[*.md]
BasedOnStyles = Google, Microsoft
```

2. Ensure styles directory exists:
```bash
ls -la styles/
# Should show Google/, Microsoft/, RedHat/ directories
```

3. Re-sync style guides if necessary:
```bash
vale sync
```

---

#### Issue: TypeScript compilation errors

**Symptoms:**
```
Type 'X' is not assignable to type 'Y'
```

**Resolution:**
1. Check `tsconfig.json` path aliases:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

2. Verify interface definitions match usage
3. Run type check:
```bash
npm run type-check
```

---

#### Issue: API timeout errors

**Symptoms:**
```
Error: Request timeout after 10 seconds
```

**Resolution:**
1. Reduce document size (< 50KB recommended for optimal performance)
2. Disable unused style guides in `.vale.ini`
3. Increase timeout in `netlify.toml`:
```toml
[functions]
  timeout = 30
```

---

#### Issue: Playwright tests failing

**Symptoms:**
```
Error: Page did not load within 30 seconds
```

**Resolution:**
```bash
# Update Playwright browsers
npx playwright install

# Run tests with debug mode
npx playwright test --debug

# Check if dev server is running
npm run dev
```

---

### Debug Mode

To enable verbose logging for troubleshooting:

```bash
# Set debug environment variable
DEBUG=vale:* npm run dev

# Or in .env.local
NEXT_PUBLIC_DEBUG=true
```

### Log Locations

- **Development Logs**: Console output during `npm run dev`
- **Production Logs**: Check Netlify Functions logs in dashboard
- **Test Logs**: `test-results/` directory after Playwright execution

---

## 9. External Documentation

### Core Technologies

| Technology | Documentation URL | Focus Areas |
|-----------|-------------------|-------------|
| **Next.js App Router** | https://nextjs.org/docs/app | API routes, Server Components, Route Handlers |
| **TypeScript** | https://www.typescriptlang.org/docs/ | Strict mode, Type inference, Advanced types |
| **Tailwind CSS** | https://tailwindcss.com/docs | Utility classes, Responsive design |
| **Vale** | https://vale.sh/docs/ | Configuration, Style guides, CLI usage |
| **Playwright** | https://playwright.dev/docs/intro | Testing patterns, Assertions, Selectors |

### Style Guide References

| Style Guide | Source Repository | Documentation |
|-------------|------------------|---------------|
| **Google** | https://github.com/errata-ai/Google | https://developers.google.com/style |
| **Microsoft** | https://github.com/errata-ai/Microsoft | https://learn.microsoft.com/style-guide |
| **Red Hat** | https://github.com/errata-ai/RedHat | https://redhat-documentation.github.io/ |

### Additional Resources

- **Vale Package Registry**: https://vale.sh/docs/topics/packages/
- **Next.js Deployment**: https://nextjs.org/docs/deployment
- **Netlify Functions**: https://docs.netlify.com/functions/overview/
- **TypeScript Configuration**: https://www.typescriptlang.org/tsconfig

---

## 10. Pre-Contribution Checklist

Before proposing architectural changes or submitting code, verify:

- [ ] `package.json` reviewed for dependency versions and compatibility
- [ ] `tsconfig.json` examined for path aliases and compiler options
- [ ] `.vale.ini` configuration understood for linting rule modifications
- [ ] Local tests pass: `npm test`
- [ ] TypeScript compilation succeeds: `npm run build`
- [ ] Code follows conventions table in Section 4
- [ ] Changes documented in appropriate README or comment blocks
- [ ] No breaking changes to Vale integration without discussion

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-02-04 | Added: Code conventions table, architecture diagram, troubleshooting section, external documentation links |
| 1.0 | 2026-01-15 | Initial document creation |

---

**Maintained by:** Verbalize Development Team  
**Feedback:** Submit issues via GitHub repository  
**License:** Refer to repository LICENSE file

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
