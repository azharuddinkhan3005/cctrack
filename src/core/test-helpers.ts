import type { UsageEntry } from './types.js';

/**
 * Shared test helper: create a UsageEntry with sensible defaults.
 * Used across all in-source test files.
 */
export function makeEntry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    timestamp: '2025-03-25T10:00:00Z',
    message: {
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    ...overrides,
  };
}
