/**
 * Example: Research Agent
 *
 * A multi-step agent that researches a topic using web requests,
 * extracts key information, and produces a structured summary.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... pnpm start
 */

import 'dotenv/config';
import { z } from 'zod';
import {
  createAgent,
  createOpenAIProvider,
  createTaskGraph,
  defineTool,
  type TaskIO,
} from '@agentkit/core';
import { httpRequest, calculator, currentTime } from '@agentkit/tools';

// ---------------------------------------------------------------------------
// Custom tool: extract key facts from text
// ---------------------------------------------------------------------------

const extractFacts = defineTool({
  name: 'extract_facts',
  description:
    'Extract key facts from a body of text. Returns a structured list of facts with categories.',
  parameters: z.object({
    text: z.string().describe('The text to extract facts from'),
    maxFacts: z.number().int().min(1).max(20).default(10).describe('Maximum number of facts'),
  }),
  async execute(input) {
    // Simple keyword-based extraction (in production, this would use NLP)
    const sentences = input.text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    const facts = sentences.slice(0, input.maxFacts).map((sentence, i) => ({
      id: i + 1,
      text: sentence,
      confidence: Math.round((0.7 + Math.random() * 0.3) * 100) / 100,
    }));

    return { factCount: facts.length, facts };
  },
});

// ---------------------------------------------------------------------------
// Single-agent example
// ---------------------------------------------------------------------------

async function runSingleAgent() {
  console.log('\n=== Single Agent Example ===\n');

  const llm = createOpenAIProvider({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  });

  const agent = createAgent({
    id: 'research-assistant',
    name: 'Research Assistant',
    systemPrompt: `You are a research assistant. You can use tools to look up information,
perform calculations, and check the current time.

When asked to research a topic:
1. Use the http_request tool to fetch relevant information
2. Summarize your findings clearly
3. Include specific data points where possible

Be concise and factual.`,
    llm,
    tools: [httpRequest, calculator, currentTime, extractFacts],
    maxIterations: 10,
  });

  // Listen for events
  agent.events.on('agent:tool_call', ({ toolCall }) => {
    console.log(`  🔧 Calling tool: ${toolCall.function.name}`);
  });
  agent.events.on('agent:tool_result', ({ result }) => {
    if (result.error) {
      console.log(`  ❌ Tool error: ${result.error}`);
    } else {
      console.log(`  ✅ Tool result (${result.durationMs}ms)`);
    }
  });

  const run = await agent.run(
    'What time is it right now? Also, what is 2^10 + 3^5?',
  );

  console.log('\nResult:', run.result);
  console.log(`\nUsage: ${run.usage.total_tokens} tokens, ${run.iterations} iterations`);
  console.log(`Status: ${run.status}`);
}

// ---------------------------------------------------------------------------
// Task graph example
// ---------------------------------------------------------------------------

async function runTaskGraph() {
  console.log('\n=== Task Graph Example ===\n');

  const llm = createOpenAIProvider({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  });

  const graph = createTaskGraph({
    id: 'research-pipeline',
    name: 'Research Pipeline',
    input: { topic: 'TypeScript AI agent frameworks' },
    tasks: [
      {
        id: 'gather-context',
        name: 'Gather Context',
        execute: async (input: TaskIO) => {
          console.log('  📋 Gathering context for:', input.topic);
          return {
            topic: input.topic,
            prompt: `Research the current landscape of ${input.topic}. What are the top 3 frameworks, their key features, and how they compare? Be concise.`,
          };
        },
      },
      {
        id: 'research',
        name: 'Research Phase',
        dependsOn: ['gather-context'],
        inputMap: { prompt: 'gather-context.prompt' },
        agent: {
          id: 'researcher',
          name: 'Researcher',
          systemPrompt:
            'You are a technical researcher. Provide factual, concise analysis of AI/ML tools and frameworks. Do not use any tools — rely on your training data.',
          llm,
        },
      },
      {
        id: 'summarize',
        name: 'Summarize',
        dependsOn: ['research'],
        inputMap: { researchResult: 'research.result' },
        agent: {
          id: 'summarizer',
          name: 'Summarizer',
          systemPrompt:
            'You are a technical writer. Given research notes, produce a clear executive summary with bullet points. Max 200 words.',
          llm,
        },
      },
    ],
    onTaskComplete: async (result) => {
      console.log(
        `  ✅ Task "${result.taskId}" completed in ${result.durationMs}ms`,
      );
    },
  });

  // Listen for events
  graph.events.on('task:start', ({ taskId }) => {
    console.log(`  ▶️  Starting task: ${taskId}`);
  });

  const run = await graph.run();

  console.log(`\nGraph status: ${run.status}`);
  console.log(`Tasks completed: ${run.taskResults.size}`);

  // Print final summary
  const summaryResult = run.taskResults.get('summarize');
  if (summaryResult?.output?.result) {
    console.log('\n--- Final Summary ---');
    console.log(summaryResult.output.result);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    console.error('Usage: OPENAI_API_KEY=sk-... pnpm start');
    process.exit(1);
  }

  try {
    await runSingleAgent();
    await runTaskGraph();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
