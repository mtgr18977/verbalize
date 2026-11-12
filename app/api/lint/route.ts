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

async function writeStyles(tmpDir: string, style: string, customRules: CustomRule[]): Promise<string> {
  const tempStylesDir = path.join(tmpDir, 'styles');
  await fs.mkdir(tempStylesDir, { recursive: true });

  // Symlink the built-in styles so Vale finds them next to the temporary Custom style
  const stylesPath = path.join(process.cwd(), 'styles');
  try {
    for (const styleFolder of await fs.readdir(stylesPath)) {
      const fullPath = path.join(stylesPath, styleFolder);
      if ((await fs.stat(fullPath)).isDirectory()) {
        await fs.symlink(fullPath, path.join(tempStylesDir, styleFolder), process.platform === 'win32' ? 'junction' : 'dir');
      }
    }
  } catch (err: unknown) {
    console.warn('Failed to symlink existing styles:', err);
  }

  if (customRules.length === 0) return style;

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
  return `${style}, Custom`;
}

async function runVale(tmpDir: string, request: LintRequest): Promise<unknown[]> {
  const tmpFile = path.join(tmpDir, 'doc.md');
  await fs.writeFile(tmpFile, request.text);

  const basedOnStyles = await writeStyles(tmpDir, request.style, request.customRules);
  const iniFile = path.join(tmpDir, '.vale.ini');
  await fs.writeFile(iniFile, `StylesPath = ${path.join(tmpDir, 'styles')}\nMinAlertLevel = suggestion\n[*.md]\nBasedOnStyles = ${basedOnStyles}\n`);

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
      throw new RequestError('This text produced too many alerts to return. Lint a shorter section.', 413);
    }
    if (execError.killed || execError.signal === 'SIGKILL') {
      throw new RequestError(
        `Linting took longer than ${Math.round(LINT_TIMEOUT_MS / 1000)} s and was stopped. Lint a shorter section.`,
        504
      );
    }

    // Vale exits with a non-zero code when it finds alerts, but still prints valid JSON
    if (execError.stdout) {
      try {
        return parse(execError.stdout);
      } catch {
        throw new RequestError('Failed to parse Vale output', 500);
      }
    }

    console.error('Vale execution failed:', execError.stderr?.slice(0, 500) || execError.message);
    throw new RequestError('Vale execution failed', 500);
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
      return NextResponse.json({ error: error.message }, { status: error.status, headers: error.headers });
    }
    console.error('Internal server error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
