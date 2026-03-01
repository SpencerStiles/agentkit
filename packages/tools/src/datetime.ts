/**
 * Date/time tool — get current time, format dates, compute durations.
 */

import { z } from 'zod';
import { defineTool } from '@agentkit/core';

export const currentTime = defineTool({
  name: 'current_time',
  description:
    'Get the current date and time in ISO 8601 format, with optional timezone offset.',
  parameters: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone name, e.g. "America/New_York". Defaults to UTC.'),
  }),
  async execute(input) {
    const now = new Date();
    const iso = now.toISOString();

    if (input.timezone) {
      try {
        const formatted = now.toLocaleString('en-US', {
          timeZone: input.timezone,
          dateStyle: 'full',
          timeStyle: 'long',
        });
        return { iso, formatted, timezone: input.timezone };
      } catch {
        return { iso, error: `Unknown timezone: ${input.timezone}` };
      }
    }

    return {
      iso,
      formatted: now.toUTCString(),
      timezone: 'UTC',
    };
  },
});
