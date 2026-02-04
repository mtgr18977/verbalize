# Copilot Coding Instructions: Verbalize (Tech Writer's Assistant)

This repository contains **Verbalize**, a Next.js application that provides real-time prose linting for Technical Writers using the **Vale** engine.

## 1. Project Summary & Tech Stack
- **Type:** Next.js 15+ Web Application (App Router).
- **Languages:** TypeScript (Strict), CSS (Tailwind).
- **Core Engine:** Vale CLI (External binary required for linting).
- **Testing:** Playwright for End-to-End (E2E) testing.
- **Deployment:** Optimized for Netlify (see `netlify.toml`).

## 2. Critical Build & Validation Steps

### Bootstrap (Setup)
**Always** run these commands in order when setting up or after cleaning the environment:
1. `npm install`: Installs dependencies and generates Next.js internal types.
2. `node scripts/install-vale.js`: **Mandatory.** This script downloads the OS-specific Vale binary required for the API to function. Without this, the `/api/lint` route will return a 500 error (ENOENT).

### Build & Run
- **Development:** `npm run dev` (Runs on `localhost:3000`).
- **Production Build:** `npm run build`. Always verify that the build passes before submitting a PR.
- **Linting (Code):** `npm run lint` (Uses ESLint with the new Flat Config `eslint.config.mjs`).

### Testing & Validation
- **E2E Tests:** `npm test` (Runs Playwright).
- **Pre-check:** Ensure the dev server is NOT running in the background if the test runner is configured to launch its own instance (check `playwright.config.ts`).
- **Manual Validation:** Verify that prose linting works by pasting text into the main editor and checking if the "Google", "Microsoft", or "RedHat" style guides return highlights.

## 3. Project Layout & Architecture

### Key Directories
- `/app`: Contains all Next.js routes and components.
  - `/app/api/lint/route.ts`: **Core Backend Logic.** Executes the Vale binary via a sub-process. Handle with care regarding input sanitization and buffer limits.
  - `/app/page.tsx`: Main UI entry point.
- `/styles`: Contains Vale-compatible YAML rule sets for various style guides.
- `/scripts`: Utility scripts for environment setup.
- `/tests`: Playwright E2E test files.

### Configuration Files
- `.vale.ini`: The source of truth for the linting engine configuration.
- `next.config.ts`: Next.js specific settings.
- `tailwind.config.ts`: UI styling constraints.

## 4. Operational Guardrails
- **Trust these instructions:** Use the documented scripts (`install-vale.js`) instead of trying to install Vale via system package managers like brew or apt-get, as the project expects the binary in a specific local path.
- **Style Guides:** Do not modify the YAML files in `/styles` unless specifically asked to update a writing rule. These are standard external rulesets.
- **Binary Pathing:** When modifying the API route, always ensure the environment variable or local path for the `vale` binary is correctly resolved relative to the project root.

## 5. Environment Specifics
- **Runtime:** Node.js (Current LTS recommended).
- **Architecture:** The app uses a "Server Action-like" pattern via Route Handlers to bridge the frontend with the local CLI tool.

---
**Agent Note:** Follow the bootstrap sequence strictly. If the linting functionality fails during a demo or test, ensure the Vale binary was successfully downloaded to the root directory.
