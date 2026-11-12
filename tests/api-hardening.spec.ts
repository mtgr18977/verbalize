import { test, expect } from '@playwright/test';

const VALID_RULE = `extends: existence
message: "Avoid using '%s'"
level: error
tokens:
  - extremely`;

function lintBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: 'This is extremely good.', style: 'Google', ...overrides };
}

test.describe('POST /api/lint hardening', () => {
  test('rejects non-JSON content types (cross-site "simple" requests)', async ({ request }) => {
    const response = await request.post('/api/lint', {
      headers: { 'Content-Type': 'text/plain' },
      data: JSON.stringify(lintBody()),
    });
    expect(response.status()).toBe(415);
  });

  test('rejects cross-site and cross-origin callers', async ({ request }) => {
    const crossSite = await request.post('/api/lint', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      data: lintBody(),
    });
    expect(crossSite.status()).toBe(403);

    const crossOrigin = await request.post('/api/lint', {
      headers: { Origin: 'https://evil.example' },
      data: lintBody(),
    });
    expect(crossOrigin.status()).toBe(403);
  });

  test('rejects script rules, which can run forever', async ({ request }) => {
    const response = await request.post('/api/lint', {
      data: lintBody({
        customRules: [
          {
            name: 'loop.yml',
            content: 'extends: script\nmessage: x\nscope: raw\nscript: |\n  for true {\n  }\n',
          },
        ],
      }),
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('script rules are not allowed');
  });

  test('explains invalid custom rules instead of a generic failure', async ({ request }) => {
    const unknownType = await request.post('/api/lint', {
      data: lintBody({ customRules: [{ name: 'bad.yml', content: 'extends: banana\nmessage: x\n' }] }),
    });
    expect(unknownType.status()).toBe(400);
    expect((await unknownType.json()).error).toContain('"extends" must be one of');

    const brokenYaml = await request.post('/api/lint', {
      data: lintBody({ customRules: [{ name: 'broken.yml', content: 'extends: [existence\n' }] }),
    });
    expect(brokenYaml.status()).toBe(400);
    expect((await brokenYaml.json()).error).toContain('not valid YAML');
  });

  test('validates the type of every field before touching the disk', async ({ request }) => {
    for (const customRules of [[{ name: 123, content: 'x' }], [null], 'nope']) {
      const response = await request.post('/api/lint', { data: lintBody({ customRules }) });
      expect(response.status()).toBe(400);
    }
    const noStyle = await request.post('/api/lint', { data: { text: 'hello' } });
    expect(noStyle.status()).toBe(400);
  });

  test('limits the document size in bytes, not characters', async ({ request }) => {
    // 150,000 characters but 300,000 bytes in UTF-8: over the 200 KB default
    const response = await request.post('/api/lint', { data: lintBody({ text: 'é'.repeat(150_000) }) });
    expect(response.status()).toBe(413);
  });

  test('errors carry a code and parameters the interface can translate', async ({ request }) => {
    const media = await request.post('/api/lint', { headers: { 'Content-Type': 'text/plain' }, data: '{}' });
    expect((await media.json()).code).toBe('unsupported_media_type');

    const origin = await request.post('/api/lint', { headers: { Origin: 'https://evil.example' }, data: lintBody() });
    expect((await origin.json()).code).toBe('forbidden');

    const script = await request.post('/api/lint', {
      data: lintBody({ customRules: [{ name: 'loop.yml', content: 'extends: script\nmessage: x\n' }] }),
    });
    const scriptBody = await script.json();
    expect(scriptBody.code).toBe('rule_script');
    expect(scriptBody.params).toEqual({ rule: 'loop.yml' });
    // the English text stays for API consumers
    expect(scriptBody.error).toContain('script rules are not allowed');

    const big = await request.post('/api/lint', { data: lintBody({ text: 'é'.repeat(150_000) }) });
    const bigBody = await big.json();
    expect(bigBody.code).toBe('text_too_large');
    expect(bigBody.params).toEqual({ maxKb: 200 });

    const style = await request.post('/api/lint', { data: { text: 'hello', style: 'Nope' } });
    expect((await style.json()).code).toBe('invalid_style');
  });

  test('still accepts valid custom rules', async ({ request }) => {
    const response = await request.post('/api/lint', {
      data: lintBody({ customRules: [{ name: 'terms.yml', content: VALID_RULE }] }),
    });
    expect(response.ok()).toBeTruthy();
    const alerts: Array<{ Check: string }> = await response.json();
    expect(alerts.some((alert) => alert.Check === 'Custom.terms')).toBeTruthy();
  });
});
