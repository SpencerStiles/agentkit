# Conductor

> TypeScript AI agent runtime — task graphs, tool orchestration, memory, and structured output

[![npm](https://img.shields.io/npm/v/@spencerstiles/conductor)](https://www.npmjs.com/package/@spencerstiles/conductor)
[![Tests](https://img.shields.io/badge/tests-40%20passing-brightgreen)](https://github.com/SpencerStiles/agentkit/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

```bash
npm install @spencerstiles/conductor
```

---

## Quick Start

```typescript
import { createAgent, createOpenAIProvider, defineTool } from '@spencerstiles/conductor';
import { calculator, httpRequest } from '@spencerstiles/conductor-tools';
import { z } from 'zod';

const agent = createAgent({
  id: 'assistant',
  name: 'Research Assistant',
  systemPrompt: 'You are a helpful research assistant.',
  llm: createOpenAIProvider({ model: 'gpt-4o' }),
  tools: [calculator, httpRequest],
});

const run = await agent.run('What is 2^10 + the current BTC price in USD?');
console.log(run.output); // "The answer is 1024 + $67,234 = $68,258"
```

## Why Conductor vs. LangChain.js / Vercel AI SDK?

| | Conductor | LangChain.js | Vercel AI SDK |
|-|-----------|-------------|--------------|
| TypeScript-first | ✅ Full strict mode | ⚠️ Partial | ✅ |
| Task graph support | ✅ Built-in | ❌ | ❌ |
| Multi-agent workflows | ✅ | ⚠️ Complex | ❌ |
| Bundle size | Small | Large | Small |
| Observability | ✅ Event emitter | ⚠️ | ⚠️ |
| Memory | ✅ Built-in | Plugin | ❌ |

Conductor is purpose-built for TypeScript developers who want type-safe, observable, composable agents — without the complexity of LangChain or the constraints of opinionated frameworks.

## Features

- **Task Graphs** — Define complex multi-step workflows as dependency graphs; execute in parallel where possible
- **Tool Orchestration** — Strongly-typed tools with Zod input/output schemas
- **Memory** — Built-in short and long-term memory interfaces
- **Multi-Provider** — OpenAI, Anthropic, and extensible provider interface
- **Observability** — Event emitter on every agent run (tokens, tool calls, errors)
- **40 Tests** — Core graph engine, tool execution, parallel scheduling all tested

## Packages

| Package | Description |
|---------|-------------|
| `@spencerstiles/conductor` | Agent engine, task graph, memory, providers |
| `@spencerstiles/conductor-tools` | Pre-built tools: calculator, HTTP, datetime, text, JSON |

## Multi-Agent Example

```typescript
import { createGraph, createAgent } from '@spencerstiles/conductor';

const researchAgent = createAgent({ id: 'researcher', ... });
const writerAgent = createAgent({ id: 'writer', ... });

const graph = createGraph([
  { id: 'research', agent: researchAgent, task: 'Research {topic}' },
  { id: 'write', agent: writerAgent, task: 'Write article from: {research}', depends: ['research'] },
]);

const result = await graph.run({ topic: 'TypeScript AI agents in 2026' });
```

## Contributing

Conductor is MIT-licensed and open to contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/SpencerStiles/agentkit
cd agentkit
pnpm install
pnpm test   # 40 tests should pass
```

## Built with Conductor? Need a custom agent system?

I do consulting work for teams building AI-powered features. [Work with me →](https://cal.com/spencerstiles)
