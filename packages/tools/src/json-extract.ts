/**
 * JSON extraction tool — parse and query JSON data.
 */

import { z } from 'zod';
import { defineTool } from '@agentkit/core';

export const jsonExtract = defineTool({
  name: 'json_extract',
  description:
    'Parse a JSON string and optionally extract a value at a dot-notation path. Returns the parsed data or the extracted value.',
  parameters: z.object({
    json: z.string().describe('The JSON string to parse'),
    path: z
      .string()
      .optional()
      .describe(
        'Optional dot-notation path to extract a value, e.g. "data.users[0].name"',
      ),
  }),
  async execute(input) {
    let data: unknown;
    try {
      data = JSON.parse(input.json);
    } catch {
      throw new Error('Invalid JSON string');
    }

    if (!input.path) {
      return { data };
    }

    // Navigate the path
    const parts = input.path.split(/[.[\]]+/).filter(Boolean);
    let current: unknown = data;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return { data: null, path: input.path, found: false };
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return { data: null, path: input.path, found: false };
      }
    }

    return { data: current, path: input.path, found: true };
  },
});
