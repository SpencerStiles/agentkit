/**
 * Text manipulation tools — summarize, count, search, replace.
 */

import { z } from 'zod';
import { defineTool } from '@agentkit/core';

export const textStats = defineTool({
  name: 'text_stats',
  description:
    'Compute statistics about a text string: word count, character count, sentence count, and paragraph count.',
  parameters: z.object({
    text: z.string().describe('The text to analyze'),
  }),
  async execute(input) {
    const text = input.text;
    const words = text.split(/\s+/).filter(Boolean).length;
    const characters = text.length;
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

    return { words, characters, sentences, paragraphs };
  },
});

export const textSearch = defineTool({
  name: 'text_search',
  description:
    'Search for a pattern (string or regex) in text. Returns all matches with their positions.',
  parameters: z.object({
    text: z.string().describe('The text to search in'),
    pattern: z.string().describe('The search pattern (string or regex)'),
    isRegex: z
      .boolean()
      .default(false)
      .describe('If true, treat pattern as a regular expression'),
    caseSensitive: z
      .boolean()
      .default(false)
      .describe('If true, search is case-sensitive'),
  }),
  async execute(input) {
    const flags = input.caseSensitive ? 'g' : 'gi';
    let regex: RegExp;

    try {
      regex = input.isRegex
        ? new RegExp(input.pattern, flags)
        : new RegExp(escapeRegex(input.pattern), flags);
    } catch (err) {
      throw new Error(
        `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const matches: Array<{ match: string; index: number; line: number }> = [];
    let m: RegExpExecArray | null;

    while ((m = regex.exec(input.text)) !== null) {
      const lineNum =
        input.text.slice(0, m.index).split('\n').length;
      matches.push({
        match: m[0],
        index: m.index,
        line: lineNum,
      });
      if (matches.length >= 100) break;
    }

    return { count: matches.length, matches };
  },
});

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
