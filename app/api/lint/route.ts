import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import {
  LINT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_VALE_OUTPUT_BYTES,
  RequestError,
  assertTrustedRequest,
  enforceRateLimit,
  parseJson,
  parseLintRequest,
  readLimitedBody,
  withLintSlot,
} from '@/lib/lint-guards';
import type { CustomRule, LintRequest } from '@/lib/lint-guards';
import type { ApiErrorBody } from '@/lib/api-errors';
import { getFileExtension } from '@/lib/document-format';
import { runProcess } from '@/lib/run-process';
import { VOCABULARY_NAME, buildValeIni } from '@/lib/vale-config';
import { buildVocabularyFiles, hasTerms } from '@/lib/vocabulary';
import type { Vocabulary } from '@/types/vocabulary';

type ValeOutput = Record<string, unknown[]>;

function safeRuleFileName(name: string, used: Set<string>): string | null {
  const withExtension = name.endsWith('.yml') ? name : `${name}.yml`;
  // basename + character allowlist prevent path traversal out of the Custom style folder
  const base = path.basename(withExtension).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base || base === '.' || base === '..') return null;

  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) {
    candidate = base.replace(/\.yml$/, `-${n}.yml`);
  }
  used.add(candidate);
  return candidate;
}

/** Writes accept.txt and reject.txt where Vale looks for the `Project` vocabulary. */
async function writeVocabulary(stylesDir: string, vocabulary: Vocabulary): Promise<void> {
  if (!hasTerms(vocabulary)) return;
  const folder = path.join(stylesDir, 'config', 'vocabularies', VOCABULARY_NAME);
  await fs.mkdir(folder, { recursive: true });
  const files = buildVocabularyFiles(vocabulary);
  await fs.writeFile(path.join(folder, 'accept.txt'), files.accept);
  await fs.writeFile(path.join(folder, 'reject.txt'), files.reject);
}

/** Prepares the styles folder of one request. Returns whether a "Custom" style was written. */
async function writeStyles(tmpDir: string, customRules: CustomRule[], vocabulary: Vocabulary): Promise<boolean> {
  const tempStylesDir = path.join(tmpDir, 'styles');
  await fs.mkdir(tempStylesDir, { recursive: true });

  // Symlink the built-in styles so Vale finds them next to the temporary Custom style
  const stylesPath = path.join(process.cwd(), 'styles');
  try {
    for (const styleFolder of await fs.readdir(stylesPath)) {
      const fullPath = path.join(stylesPath, styleFolder);
      // "config" is where vocabularies live: a repository folder of that name must not shadow it
      if (styleFolder !== 'config' && (await fs.stat(fullPath)).isDirectory()) {
        await fs.symlink(fullPath, path.join(tempStylesDir, styleFolder), process.platform === 'win32' ? 'junction' : 'dir');
      }
    }
  } catch (err: unknown) {
    console.warn('Failed to symlink existing styles:', err);
  }

  await writeVocabulary(tempStylesDir, vocabulary);
  if (customRules.length === 0) return false;

  const customStyleDir = path.join(tempStylesDir, 'Custom');
  await fs.mkdir(customStyleDir, { recursive: true });
  await fs.writeFile(
    path.join(customStyleDir, 'meta.json'),
    JSON.stringify({ name: 'Custom', description: 'User-uploaded rules', feed: '' })
  );

  const used = new Set<string>();
  for (const rule of customRules) {
    const fileName = safeRuleFileName(rule.name, used);
    if (fileName) {
      await fs.writeFile(path.join(customStyleDir, fileName), rule.content);
    }
  }
  return true;
}

/**
 * Vale reads AsciiDoc by running `asciidoctor`, which is Ruby and is not there on serverless
 * platforms. scripts/bin/asciidoctor is a stand-in written for Node (see that file): it is put first
 * in PATH so Vale finds it, whatever else the machine has. Measured on a realistic document, Vale
 * gives the same alerts at the same positions with it as with the Ruby original.
 */
const ASCIIDOC_BIN_DIR = path.join(process.cwd(), 'scripts', 'bin');
const ASCIIDOC_COMMAND = path.join(ASCIIDOC_BIN_DIR, 'asciidoctor');

async function isAsciidocAvailable(): Promise<boolean> {
  // The stand-in is a script with a shebang: there is no way to run it on Windows
  if (process.platform === 'win32') return false;
  try {
    // Serverless deployments may not preserve the executable bit
    await fs.chmod(ASCIIDOC_COMMAND, 0o755).catch(() => undefined);
    await fs.access(ASCIIDOC_COMMAND, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runVale(tmpDir: string, request: LintRequest): Promise<unknown[]> {
  if (request.format === 'asciidoc' && !(await isAsciidocAvailable())) {
    throw new RequestError('AsciiDoc support is not available on this server', 503, 'asciidoc_unavailable');
  }

  const tmpFile = path.join(tmpDir, `doc.${getFileExtension(request.format)}`);
  await fs.writeFile(tmpFile, request.text);

  const hasCustomRules = await writeStyles(tmpDir, request.customRules, request.vocabulary);
  const iniFile = path.join(tmpDir, '.vale.ini');
  await fs.writeFile(
    iniFile,
    buildValeIni({
      stylesPath: path.join(tmpDir, 'styles'),
      style: request.style,
      format: request.format,
      hasCustomRules,
      vocabulary: request.vocabulary,
    })
  );

  const valePath = path.join(process.cwd(), process.platform === 'win32' ? 'vale.exe' : 'vale');

  // Serverless deployments may not preserve the executable bit
  try {
    await fs.chmod(valePath, 0o755);
  } catch (err: unknown) {
    console.warn('Could not chmod vale binary:', err);
  }

  const result = await runProcess(valePath, [`--config=${iniFile}`, '--output=JSON', tmpFile], {
    cwd: tmpDir,
    // Vale does not need the server's environment (tokens, cloud credentials, ...). Its helpers do
    // need node (the AsciiDoc stand-in is a Node script), so the folder of this node comes along.
    env: {
      PATH: [ASCIIDOC_BIN_DIR, path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
      HOME: tmpDir,
      NODE_ENV: process.env.NODE_ENV,
    },
    timeoutMs: LINT_TIMEOUT_MS,
    maxOutputBytes: MAX_VALE_OUTPUT_BYTES,
  });

  if (result.outputTooLarge) {
    throw new RequestError('This text produced too many alerts to return. Lint a shorter section.', 413, 'output_too_large');
  }
  if (result.timedOut) {
    throw new RequestError(
      `Linting took longer than ${Math.round(LINT_TIMEOUT_MS / 1000)} s and was stopped. Lint a shorter section.`,
      504,
      'timeout',
      { params: { seconds: Math.round(LINT_TIMEOUT_MS / 1000) } }
    );
  }

  // Vale exits with a non-zero code when it finds alerts, but still prints valid JSON
  if (result.stdout.trim().length > 0) {
    try {
      const results = JSON.parse(result.stdout) as ValeOutput;
      return results[tmpFile] ?? [];
    } catch {
      throw new RequestError('Failed to parse Vale output', 500, 'parse_failed');
    }
  }

  console.error('Vale execution failed:', result.spawnError?.message ?? result.stderr.slice(0, 500));
  throw new RequestError('Vale execution failed', 500, 'vale_failed');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let tmpDir: string | undefined;

  try {
    assertTrustedRequest(req);
    enforceRateLimit(req);

    const request = parseLintRequest(parseJson(await readLimitedBody(req, MAX_BODY_BYTES)));

    const alerts = await withLintSlot(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vale-'));
      return runVale(tmpDir, request);
    });
    return NextResponse.json(alerts);
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      const body: ApiErrorBody = { error: error.message, code: error.code, params: error.params };
      return NextResponse.json(body, { status: error.status, headers: error.headers });
    }
    console.error('Internal server error:', error);
    const body: ApiErrorBody = { error: 'Internal server error', code: 'internal' };
    return NextResponse.json(body, { status: 500 });
  } finally {
    // Covers every path after mkdtemp, including validation and write failures
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (rmError: unknown) {
        console.error('Failed to remove temp directory:', rmError);
      }
    }
  }
}
