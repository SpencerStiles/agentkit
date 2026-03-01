/**
 * HTTP request tool — lets agents make web requests.
 */

import { z } from 'zod';
import { defineTool } from '@agentkit/core';

/**
 * Validates that a URL does not point to private/internal network addresses.
 * Blocks: localhost, loopback, link-local, RFC-1918 private ranges, and the
 * cloud metadata endpoint (169.254.169.254).
 *
 * Throws an error if the URL is disallowed.
 */
function validateNoSSRF(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject non-http(s) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Request to private/internal URLs is not allowed');
  }

  // Exact hostname blocklist
  const blockedHostnames = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254', // AWS/GCP metadata
    'metadata.google.internal',
  ];
  if (blockedHostnames.includes(hostname)) {
    throw new Error('Request to private/internal URLs is not allowed');
  }

  // Block *.localhost
  if (hostname.endsWith('.localhost')) {
    throw new Error('Request to private/internal URLs is not allowed');
  }

  // Parse dotted-quad IPv4 address and check private ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    // 127.x.x.x — loopback
    if (a === 127) throw new Error('Request to private/internal URLs is not allowed');
    // 10.x.x.x — RFC-1918
    if (a === 10) throw new Error('Request to private/internal URLs is not allowed');
    // 172.16.x.x – 172.31.x.x — RFC-1918
    if (a === 172 && b >= 16 && b <= 31) throw new Error('Request to private/internal URLs is not allowed');
    // 192.168.x.x — RFC-1918
    if (a === 192 && b === 168) throw new Error('Request to private/internal URLs is not allowed');
    // 169.254.x.x — link-local / cloud metadata
    if (a === 169 && b === 254) throw new Error('Request to private/internal URLs is not allowed');
    // 0.x.x.x
    if (a === 0) throw new Error('Request to private/internal URLs is not allowed');
    // Validate each octet is 0–255
    if ([a, b, c, d].some((octet) => octet > 255)) {
      throw new Error('Request to private/internal URLs is not allowed');
    }
  }
}

export const httpRequest = defineTool({
  name: 'http_request',
  description:
    'Make an HTTP request to a URL. Supports GET, POST, PUT, PATCH, DELETE. Returns the response status, headers, and body.',
  parameters: z.object({
    url: z.string().url().describe('The URL to request'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      .default('GET')
      .describe('HTTP method'),
    headers: z
      .record(z.string())
      .optional()
      .describe('Request headers as key-value pairs'),
    body: z
      .string()
      .optional()
      .describe('Request body (for POST/PUT/PATCH)'),
    timeout: z
      .number()
      .int()
      .min(1000)
      .max(60_000)
      .default(10_000)
      .describe('Timeout in milliseconds'),
  }),
  timeout: 60_000,
  async execute(input) {
    // Block SSRF before making any network request
    validateNoSSRF(input.url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeout);

    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      let body: string;

      if (contentType.includes('application/json')) {
        body = JSON.stringify(await res.json(), null, 2);
      } else {
        body = await res.text();
      }

      // Truncate very large responses
      if (body.length > 10_000) {
        body = body.slice(0, 10_000) + '\n...(truncated)';
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  },
});
