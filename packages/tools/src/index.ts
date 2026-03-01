/**
 * @agentkit/tools — Built-in tools for AgentKit agents.
 */

export { httpRequest } from './http.js';
export { calculator } from './calculator.js';
export { jsonExtract } from './json-extract.js';
export { currentTime } from './datetime.js';
export { textStats, textSearch } from './text.js';

/** Convenience: get all built-in tools as an array */
import { httpRequest } from './http.js';
import { calculator } from './calculator.js';
import { jsonExtract } from './json-extract.js';
import { currentTime } from './datetime.js';
import { textStats, textSearch } from './text.js';

export const allTools = [
  httpRequest,
  calculator,
  jsonExtract,
  currentTime,
  textStats,
  textSearch,
];
