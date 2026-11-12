import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
import { VOCABULARY_NAME, buildValeIni } from '@/lib/vale-config';
import { buildVocabularyFiles, hasTerms } from '@/lib/vocabulary';
import type { Vocabulary } from '@/types/vocabulary';

const execFileAsync = promisify(execFile);

interface ExecError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
}

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

async function runVale(tmpDir: string, request: LintRequest): Promise<unknown[]> {
  const tmpFile = path.join(tmpDir, 'doc.md');
  await fs.writeFile(tmpFile, request.text);

  const hasCustomRules = await writeStyles(tmpDir, request.customRules, request.vocabulary);
  const iniFile = path.join(tmpDir, '.vale.ini');
  await fs.writeFile(
    iniFile,
    buildValeIni({
      stylesPath: path.join(tmpDir, 'styles'),
      style: request.style,
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

  const parse = (stdout: string): unknown[] => {
    const results = JSON.parse(stdout) as ValeOutput;
    return results[tmpFile] ?? [];
  };

  try {
    const { stdout } = await execFileAsync(valePath, [`--config=${iniFile}`, '--output=JSON', tmpFile], {
      cwd: tmpDir,
      // Vale does not need the server's environment (tokens, cloud credentials, ...)
      env: { PATH: process.env.PATH ?? '', HOME: tmpDir, NODE_ENV: process.env.NODE_ENV },
      timeout: LINT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_VALE_OUTPUT_BYTES,
    });
    return parse(stdout);
  } catch (error: unknown) {
    const execError = error as ExecError;

    if (execError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new RequestError('This text produced too many alerts to return. Lint a shorter section.', 413, 'output_too_large');
    }
    if (execError.killed || execError.signal === 'SIGKILL') {
      throw new RequestError(
        `Linting took longer than ${Math.round(LINT_TIMEOUT_MS / 1000)} s and was stopped. Lint a shorter section.`,
        504,
        'timeout',
        { params: { seconds: Math.round(LINT_TIMEOUT_MS / 1000) } }
      );
    }

    // Vale exits with a non-zero code when it finds alerts, but still prints valid JSON
    if (execError.stdout) {
      try {
        return parse(execError.stdout);
      } catch {
        throw new RequestError('Failed to parse Vale output', 500, 'parse_failed');
      }
    }

    console.error('Vale execution failed:', execError.stderr?.slice(0, 500) || execError.message);
    throw new RequestError('Vale execution failed', 500, 'vale_failed');
  }
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
