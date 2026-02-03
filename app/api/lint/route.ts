import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

// Whitelist of allowed styles to prevent configuration injection
const ALLOWED_STYLES = ['Google', 'Microsoft', 'RedHat'];

export async function POST(req: NextRequest) {
  try {
    const { text, style, customRules } = await req.json();

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    if (!ALLOWED_STYLES.includes(style)) {
      return NextResponse.json({ error: 'Invalid style guide selected' }, { status: 400 });
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
          await fs.symlink(fullPath, path.join(tempStylesDir, styleFolder));
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
      const { stdout } = await execAsync(`${valePath} --config=${iniFile} --output=JSON ${tmpFile}`);
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
      return NextResponse.json({ error: 'Vale execution failed', details: execError.message }, { status: 500 });
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
