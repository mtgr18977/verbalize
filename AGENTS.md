# AGENTS.md

This document provides critical context, architectural guidelines, and operational instructions for AI agents (LLMs) interacting with the **Verbalize** repository.

## 1. Project Overview
**Verbalize** is a web-based assistant for Technical Writers. It provides a real-time linting interface for documentation, powered by the **Vale** CLI. It ensures that technical content adheres to specific style guides (Google, Microsoft, Red Hat).

### Core Tech Stack:
- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript (Strict mode)
- **Styling:** Tailwind CSS + Lucide React (Icons)
- **Core Engine:** Vale (Linter for Prose)
- **Testing:** Playwright (E2E)

## 2. Repository Structure
- `/app`: Contains the Next.js App Router logic.
  - `/api/lint/route.ts`: The core API that receives text, executes the Vale binary, and returns JSON diagnostics.
- `/styles`: Contains Vale style guide configurations (YAML).
- `/scripts`: Contains lifecycle scripts like `install-vale.js` to handle binary dependencies in CI/CD environments.
- `/tests`: Playwright end-to-end tests.
- `.vale.ini`: The main configuration file for the Vale engine.

## 3. Development Guidelines for Agents

### AI Interaction Rules:
1. **TypeScript First:** Always use TypeScript with proper interfaces for API responses and component props.
2. **Component Pattern:** Use functional components with Tailwind for styling. Maintain accessibility (ARIA labels) as this is a tool for writers.
3. **Vale Integration:** When modifying the linting logic, ensure that the path to styles and the `.vale.ini` config are correctly handled. The application expects Vale to be present in the system path or local bin.
4. **Environment Awareness:** The project is configured for deployment on Netlify (see `netlify.toml`).

### Local Setup & Commands:
- `npm run dev`: Start development server.
- `npm run build`: Production build.
- `npm test`: Run Playwright E2E tests.
- `node scripts/install-vale.js`: Use this to manually trigger the Vale binary download if it's missing.

## 4. Context & Tone
The goal of this project is **productivity and clarity**. Any UI/UX suggestions should prioritize reducing the cognitive load for writers. The interface is a "single-page workshop" where the input (text) and output (suggestions) are the primary focus.

## 5. Known Constraints
- The project relies on the server-side execution of a CLI tool (`vale`).
- Large files may require optimization in the stream/buffer handling within the API route.
- Style guides in `/styles` are synced with upstream community standards; avoid manual edits to them unless explicitly requested.

---
**Note:** Before proposing architectural changes, always check `package.json` for dependency versions and `tsconfig.json` for path aliases.
