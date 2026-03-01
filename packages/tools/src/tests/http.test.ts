/**
 * Tests for the HTTP request tool:
 *   - SSRF prevention (private/internal URLs are blocked)
 *   - Valid public URLs succeed (fetch is mocked)
 *   - Calculator tool handles basic math correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolDefinition, ToolContext } from '@agentkit/core';
import { httpRequest } from '../http.js';
import { calculator } from '../calculator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockContext: ToolContext = {
  agentId: 'test-agent',
  memory: {
    add: async () => ({ id: '', content: '', metadata: {}, createdAt: new Date(), updatedAt: new Date() }),
    search: async () => [],
    get: async () => null,
    delete: async () => {},
    list: async () => [],
    clear: async () => {},
  },
  signal: new AbortController().signal,
  emit: () => {},
};

/** Invoke a tool's execute function directly, bypassing the agent runtime */
async function callTool<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  return tool.execute(input, mockContext);
}

// ---------------------------------------------------------------------------
// SSRF prevention
// ---------------------------------------------------------------------------

describe('httpRequest — SSRF prevention', () => {
  const blockedUrls = [
    'http://localhost/secret',
    'http://localhost:8080/admin',
    'http://127.0.0.1/etc/passwd',
    'http://127.0.0.1:9200/_cat/indices', // Elasticsearch
    'http://0.0.0.0/anything',
    'http://169.254.169.254/latest/meta-data/', // AWS metadata
    'http://169.254.169.254/computeMetadata/v1/', // GCP metadata
    'http://10.0.0.1/internal',
    'http://10.255.255.255/internal',
    'http://172.16.0.1/internal',
    'http://172.31.255.255/internal',
    'http://192.168.1.1/router',
    'http://192.168.0.100/api',
    'http://metadata.google.internal/',
  ];

  for (const url of blockedUrls) {
    it(`blocks ${url}`, async () => {
      await expect(
        callTool(httpRequest, { url, method: 'GET', timeout: 5000 }),
      ).rejects.toThrow(/private\/internal|not allowed/i);
    });
  }

  it('blocks localhost subdomains', async () => {
    await expect(
      callTool(httpRequest, {
        url: 'http://evil.localhost/steal',
        method: 'GET',
        timeout: 5000,
      }),
    ).rejects.toThrow(/private\/internal|not allowed/i);
  });
});

// ---------------------------------------------------------------------------
// Valid public URLs (fetch mocked)
// ---------------------------------------------------------------------------

describe('httpRequest — valid public URLs', () => {
  beforeEach(() => {
    // Replace global fetch with a vitest spy so no real network calls are made
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) =>
            name === 'content-type' ? 'application/json' : null,
          forEach: (
            cb: (value: string, key: string) => void,
          ) => cb('application/json', 'content-type'),
        },
        json: async () => ({ hello: 'world' }),
        text: async () => '{"hello":"world"}',
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls fetch for a valid public HTTPS URL', async () => {
    const result = await callTool(httpRequest, {
      url: 'https://api.example.com/data',
      method: 'GET',
      timeout: 5000,
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
    expect(result.statusText).toBe('OK');
  });

  it('passes method, headers, and body to fetch', async () => {
    await callTool(httpRequest, {
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
      timeout: 5000,
    });

    const [calledUrl, calledOpts] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('https://api.example.com/data');
    expect(calledOpts.method).toBe('POST');
    expect((calledOpts.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(calledOpts.body).toBe('{"key":"value"}');
  });

  it('truncates very large responses to 10 000 characters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => 'text/plain',
          forEach: (cb: (value: string, key: string) => void) =>
            cb('text/plain', 'content-type'),
        },
        text: async () => 'x'.repeat(20_000),
      }),
    );

    const result = await callTool(httpRequest, {
      url: 'https://api.example.com/big',
      method: 'GET',
      timeout: 5000,
    });

    expect(result.body.length).toBeLessThanOrEqual(10_020); // 10k + truncation notice
    expect(result.body).toContain('truncated');
  });
});

// ---------------------------------------------------------------------------
// Calculator tool
// ---------------------------------------------------------------------------

describe('calculator — basic math', () => {
  it('adds two numbers', async () => {
    const result = await callTool(calculator, { expression: '2 + 3' });
    expect(result.result).toBe(5);
  });

  it('subtracts two numbers', async () => {
    const result = await callTool(calculator, { expression: '10 - 4' });
    expect(result.result).toBe(6);
  });

  it('multiplies two numbers', async () => {
    const result = await callTool(calculator, { expression: '6 * 7' });
    expect(result.result).toBe(42);
  });

  it('divides two numbers', async () => {
    const result = await callTool(calculator, { expression: '15 / 4' });
    expect(result.result).toBeCloseTo(3.75);
  });

  it('evaluates a compound expression with parentheses', async () => {
    const result = await callTool(calculator, { expression: '(2 + 3) * 4' });
    expect(result.result).toBe(20);
  });

  it('handles exponentiation', async () => {
    const result = await callTool(calculator, { expression: '2 ** 10' });
    expect(result.result).toBe(1024);
  });

  it('handles modulo', async () => {
    const result = await callTool(calculator, { expression: '17 % 5' });
    expect(result.result).toBe(2);
  });

  it('echoes back the original expression', async () => {
    const result = await callTool(calculator, { expression: '1 + 1' });
    expect(result.expression).toBe('1 + 1');
  });

  it('throws on invalid expression characters', async () => {
    await expect(
      callTool(calculator, { expression: 'process.exit(1)' }),
    ).rejects.toThrow(/invalid expression/i);
  });

  it('throws on division resulting in Infinity', async () => {
    await expect(
      callTool(calculator, { expression: '1 / 0' }),
    ).rejects.toThrow(/non-finite/i);
  });
});
