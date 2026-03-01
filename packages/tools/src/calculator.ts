/**
 * Calculator tool — safe math evaluation for agents.
 */

import { z } from 'zod';
import { defineTool } from '@spencerstiles/conductor';

export const calculator = defineTool({
  name: 'calculator',
  description:
    'Evaluate a mathematical expression. Supports basic arithmetic (+, -, *, /, %), exponentiation (**), and parentheses. Returns the numeric result.',
  parameters: z.object({
    expression: z
      .string()
      .describe('The math expression to evaluate, e.g. "(2 + 3) * 4"'),
  }),
  async execute(input) {
    const expr = input.expression.trim();

    // Validate: only allow safe characters
    if (!/^[\d\s+\-*/%().e]+$/i.test(expr)) {
      throw new Error(
        `Invalid expression: only numbers, operators (+, -, *, /, %, **), and parentheses are allowed`,
      );
    }

    try {
      // Use Function constructor for sandboxed eval of math expressions
      const fn = new Function(`"use strict"; return (${expr});`);
      const result = fn();

      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error(`Expression evaluated to non-finite number: ${result}`);
      }

      return { expression: expr, result };
    } catch (err) {
      throw new Error(
        `Failed to evaluate "${expr}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
