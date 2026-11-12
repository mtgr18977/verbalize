import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_FORMAT, detectFormat, getFileExtension, isDocumentFormat } from '../lib/document-format';
import { runProcess } from '../lib/run-process';
import { buildValeIni } from '../lib/vale-config';
import { EMPTY_VOCABULARY } from '../types/vocabulary';

const SHIM = path.join(__dirname, '..', 'scripts', 'bin', 'asciidoctor');

const REAL_DOC = `= Installing the CLI
:toc:
:product: OpenShift

NOTE: We really use this command in order to install the tool.

== Prerequisites

* A cluster running {product}.
* The configuration file was deleted by the user.

[source,bash]
----
oc login --token=in order to
----

.Procedure
. Run \`oc get pods\` and utilize the output.
. Click *Next* to recieve the file.

See link:https://example.com[the guide] and <<prereq,prerequisites>>.

// a comment: we very much like this
|===
| Name | Value
| utilize | very
|===
`;

interface Alert {
  Check: string;
  Match: string;
  Line: number;
  Span: [number, number];
  Message: string;
}

async function lint(
  request: APIRequestContext,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<{ status: number; alerts: Alert[]; body: Record<string, unknown> }> {
  const response = await request.post('/api/lint', { data: { text, style: 'Google', format: 'asciidoc', ...extra } });
  const body = (await response.json()) as unknown;
  return { status: response.status(), alerts: Array.isArray(body) ? (body as Alert[]) : [], body: Array.isArray(body) ? {} : (body as Record<string, unknown>) };
}

/**
 * Whether a process is still doing anything. kill(pid, 0) alone is not enough: a killed process
 * stays a zombie until its parent collects it, which containers without an init may never do, and
 * it still answers to signal 0. A zombie is dead, so its state is read from /proc.
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    return state !== 'Z' && state !== 'X';
  } catch {
    return true;
  }
}

function runShim(input: string, args: string[] = ['-s', '-']): string {
  return execFileSync('node', [SHIM, ...args], { input, encoding: 'utf8', cwd: path.join(__dirname, '..') });
}

test.describe('document formats', () => {
  test('are recognized from file names', () => {
    expect(detectFormat('guide.adoc')).toBe('asciidoc');
    expect(detectFormat('Guide.ASCIIDOC')).toBe('asciidoc');
    expect(detectFormat('notes.asc')).toBe('asciidoc');
    expect(detectFormat('README.md')).toBe('markdown');
    expect(detectFormat('page.mdx')).toBe('markdown');
    expect(detectFormat('notes.txt')).toBeNull();
    expect(detectFormat('adoc')).toBeNull();
  });

  test('map to the extension Vale uses to pick its parser', () => {
    expect(getFileExtension('markdown')).toBe('md');
    expect(getFileExtension('asciidoc')).toBe('adoc');
    expect(DEFAULT_FORMAT).toBe('markdown');
    expect(isDocumentFormat('asciidoc')).toBe(true);
    expect(isDocumentFormat('rst')).toBe(false);
  });

  test('the Vale configuration has a section for the right extension', () => {
    const base = { stylesPath: '/s', style: 'RedHat', hasCustomRules: false, vocabulary: EMPTY_VOCABULARY };
    expect(buildValeIni({ ...base, format: 'asciidoc' })).toBe(
      'StylesPath = /s\nMinAlertLevel = suggestion\n[*.adoc]\nBasedOnStyles = RedHat\n'
    );
    expect(buildValeIni({ ...base, format: 'markdown' })).toContain('[*.md]');
  });
});

test.describe('running a process with limits', () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const limits = { cwd: os.tmpdir(), env, timeoutMs: 5000, maxOutputBytes: 1024 * 1024 };

  test('returns what the command printed and how it ended', async () => {
    const result = await runProcess('sh', ['-c', 'echo out; echo err >&2; exit 3'], limits);
    expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 3, timedOut: false, outputTooLarge: false, spawnError: null });
  });

  test('kills the command AND what it started when time runs out', async () => {
    // the shell starts a long sleep, prints its pid, and waits for it
    const result = await runProcess('sh', ['-c', 'sleep 60 & echo $!; wait'], { ...limits, timeoutMs: 700 });
    expect(result.timedOut).toBe(true);
    const grandchild = Number.parseInt(result.stdout.trim(), 10);
    expect(Number.isInteger(grandchild)).toBe(true);

    // give the kernel a moment, then check it is really gone
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isRunning(grandchild)).toBe(false);
  });

  test('stops a command that prints too much', async () => {
    const result = await runProcess('sh', ['-c', 'yes'], { ...limits, maxOutputBytes: 4096 });
    expect(result.outputTooLarge).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
  });

  test('says so when the command cannot be started', async () => {
    const result = await runProcess('/definitely/not/here', [], limits);
    expect(result.spawnError).not.toBeNull();
    expect(result.exitCode).toBeNull();
  });

  test('a command that exits normally leaves nothing behind and is not reported as timed out', async () => {
    const result = await runProcess('sh', ['-c', 'echo done'], limits);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe('done\n');
  });
});

test.describe('the asciidoctor stand-in', () => {
  test('converts AsciiDoc to HTML the way Vale expects', () => {
    const html = runShim('== Heading\n\nSome *bold* text and a link:https://example.com[guide].\n\n* one\n* two\n');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com">guide</a>');
    expect(html).toContain('<li>');
  });

  test('is embedded output with -s, and honors attributes', () => {
    const embedded = runShim('= Title\n\nText {product}.', ['-s', '-a', 'product=Verbalize', '-']);
    expect(embedded).not.toContain('<html');
    expect(embedded).toContain('Text Verbalize.');
    expect(runShim('= Title\n\nText.', ['-'])).toContain('<html');
  });

  test('reads no local files, whatever its arguments say', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adoc-secret-'));
    const secretFile = path.join(dir, 'secret.txt');
    fs.writeFileSync(secretFile, 'TOP-SECRET-VALUE-12345\n');
    const doc = `before\n\ninclude::${secretFile}[]\n\nafter\n`;

    try {
      // control: without secure mode, Asciidoctor really would read the file. This is what the stand-in prevents
      const unsafe = execFileSync(
        'node',
        ['-e', `const a=require('@asciidoctor/core');a.convert(require('fs').readFileSync(0,'utf8'),{safe:'unsafe',standalone:false}).then(h=>process.stdout.write(h))`],
        { input: doc, encoding: 'utf8', cwd: path.join(__dirname, '..') }
      );
      expect(unsafe).toContain('TOP-SECRET-VALUE-12345');

      for (const args of [['-s', '-'], ['-s', '--safe-mode', 'unsafe', '-'], ['-s', '-S', 'unsafe', '-a', 'allow-uri-read', '-a', 'safe-mode-name=unsafe', '-']]) {
        expect(runShim(doc, args), args.join(' ')).not.toContain('TOP-SECRET-VALUE-12345');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads nothing from the network either', () => {
    const started = Date.now();
    const html = runShim('include::https://example.invalid/x.adoc[]\n\n:allow-uri-read:\n\ninclude::https://example.invalid/y.adoc[]\n', ['-s', '--safe-mode', 'unsafe', '-a', 'allow-uri-read', '-']);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(html).toContain('example.invalid');
  });

  test('copes with a 250 KB document quickly', () => {
    const sections = Array.from({ length: 1300 }, (_, i) => `== Section ${i}\n\nSome *text* with \`code\` and link:https://example.com/${i}[a link].\n\n* one\n* two\n`);
    const started = Date.now();
    const result = spawnSync('node', [SHIM, '-s', '-'], { input: sections.join('\n'), cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 });
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

test.describe('reviewing AsciiDoc with Vale', () => {
  test('finds what the style guide finds, at the right lines and columns of the source', async ({ request }) => {
    const { status, alerts } = await lint(request, REAL_DOC);
    expect(status).toBe(200);
    const found = alerts.map((alert) => [alert.Line, alert.Span[0], alert.Check, alert.Match]);
    expect(found).toEqual(
      expect.arrayContaining([
        [1, 18, 'Google.WordList', 'CLI'],
        [5, 7, 'Google.We', 'We'],
        [5, 34, 'Google.WordList', 'in order to'],
        [10, 26, 'Google.Passive', 'was deleted'],
      ])
    );
  });

  test('ignores code blocks and comments, as Vale does for markup', async ({ request }) => {
    const { alerts } = await lint(request, REAL_DOC);
    // "in order to" is in the code block on line 14, and "very much" in the comment: neither is reported
    expect(alerts.filter((alert) => alert.Line === 14)).toEqual([]);
    expect(alerts.filter((alert) => alert.Line === 23)).toEqual([]);
  });

  test('works with the Red Hat style, which is written for AsciiDoc', async ({ request }) => {
    const { status, alerts } = await lint(request, REAL_DOC, { style: 'RedHat' });
    expect(status).toBe(200);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((alert) => alert.Check.startsWith('RedHat.'))).toBe(true);
  });

  test('markdown stays the default when no format is sent', async ({ request }) => {
    const response = await request.post('/api/lint', { data: { text: '# Title\n\nWe act in order to win.\n', style: 'Google' } });
    const alerts = (await response.json()) as Alert[];
    expect(alerts.map((alert) => alert.Check)).toEqual(expect.arrayContaining(['Google.We', 'Google.WordList']));
  });

  test('the same words are read differently by each format', async ({ request }) => {
    // In Markdown a line of "=" is plain text; in AsciiDoc the line is the document title
    const text = '= We act in order to win\n\nBody.\n';
    const asciidoc = await lint(request, text);
    const markdown = await lint(request, text, { format: 'markdown' });
    expect(asciidoc.alerts.map((a) => a.Check)).toEqual(expect.arrayContaining(['Google.We']));
    expect(markdown.alerts.length).toBeGreaterThan(0);
  });

  test('rejects a format it does not know', async ({ request }) => {
    const { status, body } = await lint(request, 'text', { format: 'rst' });
    expect(status).toBe(400);
    expect(body.code).toBe('invalid_format');
    expect((await lint(request, 'text', { format: 42 })).status).toBe(400);
  });

  test('works with the project vocabulary and custom rules', async ({ request }) => {
    const rule = 'extends: existence\nmessage: "Avoid %s"\nlevel: warning\ntokens:\n  - extremely\n';
    const { alerts } = await lint(request, '== Title\n\nPlease utilize kubernetes and it is extremely good.\n', {
      vocabulary: { accept: ['Kubernetes'], reject: ['utilize'] },
      customRules: [{ name: 'terms.yml', content: rule }],
    });
    expect(alerts.map((alert) => `${alert.Check}:${alert.Match}`)).toEqual(
      expect.arrayContaining(['Vale.Avoid:utilize', 'Vale.Terms:kubernetes', 'Custom.terms:extremely'])
    );
  });

  test('a 200 KB document is reviewed within the time limit', async ({ request }) => {
    const sections = Array.from({ length: 900 }, (_, i) => `== Section ${i}\n\nThe server uses *ordinary* words here and there, with link:https://example.com/${i}[a link].\n\n* one item\n* another item\n`);
    const text = sections.join('\n');
    expect(Buffer.byteLength(text)).toBeLessThan(200 * 1024);
    const started = Date.now();
    const { status } = await lint(request, text);
    expect(status).toBe(200);
    expect(Date.now() - started).toBeLessThan(7000);
  });
});

test.describe('AsciiDoc from an untrusted author', () => {
  test('cannot make the server read a file and show it in the alerts', async ({ request }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adoc-api-secret-'));
    const secretFile = path.join(dir, 'secret.txt');
    fs.writeFileSync(secretFile, 'We really keep TOP-SECRET-API-VALUE in order to test.\n');
    try {
      const text = `== Title\n\ninclude::${secretFile}[]\n\ninclude::/etc/passwd[]\n\n:allow-uri-read:\n\ninclude::https://example.invalid/x[]\n\nAfter.\n`;
      const { status, alerts } = await lint(request, text);
      expect(status).toBe(200);
      const everything = JSON.stringify(alerts);
      expect(everything).not.toContain('TOP-SECRET-API-VALUE');
      expect(everything).not.toContain('root:');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cannot start anything: backticks, macros and attributes are only text', async ({ request }) => {
    const marker = path.join(os.tmpdir(), `adoc-marker-${Date.now()}`);
    const text = `== Title\n\n:sys: touch ${marker}\n\n{sys}\n\n+++<img src=x onerror=alert(1)>+++\n\nlink:javascript:alert(1)[x]\n\nkbd:[touch ${marker}]\n`;
    const { status } = await lint(request, text);
    expect(status).toBe(200);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
