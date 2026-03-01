/**
 * Memory stores for agent state persistence.
 *
 * - InMemoryStore: Simple in-process store (dev/testing)
 * - VectorMemoryStore: Embedding-backed semantic search (production)
 */

import type { MemoryEntry, MemoryStore } from './types.js';

let _idCounter = 0;
function nextId(): string {
  return `mem_${Date.now()}_${++_idCounter}`;
}

/**
 * Simple in-memory store. Good for testing, single-run agents, and
 * short-lived conversations. Data is lost when the process exits.
 */
export class InMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();

  async add(content: string, metadata: Record<string, unknown> = {}): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: nextId(),
      content,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    const q = query.toLowerCase();
    const scored = Array.from(this.entries.values())
      .map((entry) => {
        const text = entry.content.toLowerCase();
        // Simple keyword overlap scoring
        const queryWords = q.split(/\s+/).filter(Boolean);
        const hits = queryWords.filter((w) => text.includes(w)).length;
        const score = queryWords.length > 0 ? hits / queryWords.length : 0;
        return { ...entry, score };
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async list(filter?: Record<string, unknown>): Promise<MemoryEntry[]> {
    let results = Array.from(this.entries.values());
    if (filter) {
      results = results.filter((entry) =>
        Object.entries(filter).every(
          ([key, value]) => entry.metadata[key] === value,
        ),
      );
    }
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/**
 * Embedding-backed memory store configuration.
 * Used to create a VectorMemoryStore with a custom embedding function.
 */
export interface VectorMemoryConfig {
  /** Function that generates embedding vectors from text */
  embed: (texts: string[]) => Promise<number[][]>;
  /** Cosine similarity threshold (default: 0.7) */
  similarityThreshold?: number;
}

/**
 * Vector memory store with semantic search via embeddings.
 * Stores entries in-process but uses real embeddings for similarity search.
 */
export class VectorMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private embed: (texts: string[]) => Promise<number[][]>;
  private similarityThreshold: number;

  constructor(config: VectorMemoryConfig) {
    this.embed = config.embed;
    this.similarityThreshold = config.similarityThreshold ?? 0.7;
  }

  async add(content: string, metadata: Record<string, unknown> = {}): Promise<MemoryEntry> {
    const [embedding] = await this.embed([content]);
    const entry: MemoryEntry = {
      id: nextId(),
      content,
      metadata,
      embedding,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    const [queryEmbedding] = await this.embed([query]);

    const scored = Array.from(this.entries.values())
      .filter((e) => e.embedding)
      .map((entry) => ({
        ...entry,
        score: cosineSimilarity(queryEmbedding, entry.embedding!),
      }))
      .filter((e) => e.score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async list(filter?: Record<string, unknown>): Promise<MemoryEntry[]> {
    let results = Array.from(this.entries.values());
    if (filter) {
      results = results.filter((entry) =>
        Object.entries(filter).every(
          ([key, value]) => entry.metadata[key] === value,
        ),
      );
    }
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Compute cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dot / magnitude;
}
