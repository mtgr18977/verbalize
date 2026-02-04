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
| `MAX_INPUT_SIZE` | Maximum text input size (bytes) | 1048576 (1MB) | No |
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

### Design Constraints

- Text editor must support documents up to 1MB.
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
