import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// Whitelist of allowed styles to prevent configuration injection
const ALLOWED_STYLES = ['Google', 'Microsoft', 'RedHat'];
const MAX_TEXT_LENGTH = 1024 * 1024; // 1MB
const MAX_CUSTOM_RULES = 10;
const MAX_RULE_LENGTH = 10 * 1024; // 10KB

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, style, customRules } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'No text provided or invalid format' }, { status: 400 });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `Text exceeds maximum allowed length of ${MAX_TEXT_LENGTH} characters` }, { status: 400 });
    }

    if (!ALLOWED_STYLES.includes(style)) {
      return NextResponse.json({ error: 'Invalid style guide selected' }, { status: 400 });
    }

    if (customRules && Array.isArray(customRules)) {
      if (customRules.length > MAX_CUSTOM_RULES) {
        return NextResponse.json({ error: `Too many custom rules. Maximum is ${MAX_CUSTOM_RULES}` }, { status: 400 });
      }

      for (const rule of customRules) {
        if (rule.content && typeof rule.content === 'string' && rule.content.length > MAX_RULE_LENGTH) {
          return NextResponse.json({ error: `Rule "${rule.name}" exceeds maximum allowed length of ${MAX_RULE_LENGTH} characters` }, { status: 400 });
        }
      }
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vale-'));
    const tmpFile = path.join(tmpDir, 'doc.md');
    await fs.writeFile(tmpFile, text);

    // Create a temporary styles directory to house both built-in and custom styles
    const tempStylesDir = path.join(tmpDir, 'styles');
    await fs.mkdir(tempStylesDir, { recursive: true });

    // Symlink existing styles into the temporary styles directory
    const stylesPath = path.join(process.cwd(), 'styles');
    try {
      const existingStyles = await fs.readdir(stylesPath);
      for (const styleFolder of existingStyles) {
        const fullPath = path.join(stylesPath, styleFolder);
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          // Using junction for Windows compatibility if needed, but on Linux 'dir' works fine.
          // In serverless (Linux), symlink is standard.
          await fs.symlink(fullPath, path.join(tempStylesDir, styleFolder), process.platform === 'win32' ? 'junction' : 'dir');
        }
      }
    } catch (err) {
      console.warn('Failed to symlink existing styles:', err);
    }

    let basedOnStyles = style;

    if (customRules && Array.isArray(customRules) && customRules.length > 0) {
      const customStyleDir = path.join(tempStylesDir, 'Custom');
      await fs.mkdir(customStyleDir, { recursive: true });

      // Add a minimal meta.json for the Custom style to be recognized by Vale
      await fs.writeFile(path.join(customStyleDir, 'meta.json'), JSON.stringify({
        name: 'Custom',
        description: 'User-uploaded rules',
        feed: ''
      }));

      for (const rule of customRules) {
        if (rule.name && rule.content) {
          // Ensure rule name ends with .yml
          const ruleName = rule.name.endsWith('.yml') ? rule.name : `${rule.name}.yml`;
          // Normalize and sanitize the rule name to prevent path traversal
          const baseName = path.basename(ruleName);
          const safeRuleName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
          if (!safeRuleName || safeRuleName === '.' || safeRuleName === '..') {
            continue;
          }
          await fs.writeFile(path.join(customStyleDir, safeRuleName), rule.content);
        }
      }

      basedOnStyles = `${style}, Custom`;
    }

    const valeIni = `
StylesPath = ${tempStylesDir}
MinAlertLevel = suggestion
[*.md]
BasedOnStyles = ${basedOnStyles}
`;
    const iniFile = path.join(tmpDir, '.vale.ini');
    await fs.writeFile(iniFile, valeIni);

    const valePath = path.join(process.cwd(), process.platform === 'win32' ? 'vale.exe' : 'vale');

    // Ensure the binary is executable. This is crucial for serverless environments
    // where file permissions might not be preserved during deployment.
    try {
      await fs.chmod(valePath, 0o755);
    } catch (err) {
      console.warn('Could not chmod vale binary:', err);
    }

    try {
      // Use --config to point to our temporary .vale.ini
      const { stdout } = await execFileAsync(valePath, [`--config=${iniFile}`, '--output=JSON', tmpFile]);
      const results = JSON.parse(stdout);
      return NextResponse.json(results[tmpFile] || []);
    } catch (error: unknown) {
      // Vale returns non-zero exit code if it finds any alerts
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        try {
            const results = JSON.parse(execError.stdout);
            return NextResponse.json(results[tmpFile] || []);
        } catch {
            return NextResponse.json({ error: 'Failed to parse Vale output' }, { status: 500 });
        }
      }
      console.error('Vale execution failed:', execError.message || execError);
      return NextResponse.json({ error: 'Vale execution failed' }, { status: 500 });
    } finally {
      // Clean up temporary files
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (rmError) {
        console.error('Failed to remove temp directory:', rmError);
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Internal server error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
