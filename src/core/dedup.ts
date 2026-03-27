import { createHash } from 'node:crypto';
import type { UsageEntry } from './types.js';

/**
 * Create a dedup key for a usage entry.
 * Priority: requestId > message.id > content hash
 * Every entry gets a key — no silent null-returns.
 */
export function createDedupKey(entry: UsageEntry): string {
  // Primary: requestId (globally unique per API call)
  if (entry.requestId) return `req:${entry.requestId}`;

  // Secondary: messageId (unique per message)
  if (entry.message.id) return `msg:${entry.message.id}`;

  // Tertiary: content hash for entries without IDs
  const hash = createHash('sha256')
    .update(
      `${entry.timestamp}|${entry.message.model}|${entry.message.usage.input_tokens}|${entry.message.usage.output_tokens}`,
    )
    .digest('hex')
    .slice(0, 16);
  return `hash:${hash}`;
}

/**
 * Deduplicate an array of usage entries.
 * Returns unique entries preserving insertion order.
 */
export function deduplicateEntries(entries: UsageEntry[]): UsageEntry[] {
  const seen = new Set<string>();
  const result: UsageEntry[] = [];

  for (const entry of entries) {
    const key = createDedupKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }

  return result;
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const { makeEntry } = await import('./test-helpers.js');

  describe('createDedupKey', () => {
    it('uses requestId when available (highest priority)', () => {
      const entry = makeEntry({ requestId: 'req_123', message: { ...makeEntry().message, id: 'msg_456' } });
      expect(createDedupKey(entry)).toBe('req:req_123');
    });

    it('falls back to message.id when no requestId', () => {
      const entry = makeEntry({ message: { ...makeEntry().message, id: 'msg_456' } });
      expect(createDedupKey(entry)).toBe('msg:msg_456');
    });

    it('falls back to hash when no requestId or message.id', () => {
      const entry = makeEntry();
      const key = createDedupKey(entry);
      expect(key).toMatch(/^hash:[a-f0-9]{16}$/);
    });

    it('produces same hash for identical entries', () => {
      const a = makeEntry();
      const b = makeEntry();
      expect(createDedupKey(a)).toBe(createDedupKey(b));
    });

    it('produces different hash for different token counts', () => {
      const a = makeEntry();
      const b = makeEntry({ message: { ...makeEntry().message, usage: { ...makeEntry().message.usage, input_tokens: 999 } } });
      expect(createDedupKey(a)).not.toBe(createDedupKey(b));
    });

    it('treats empty-string requestId as falsy (falls through to msg or hash)', () => {
      const entry = makeEntry({ requestId: '' });
      const key = createDedupKey(entry);
      expect(key).not.toBe('req:');
      expect(key).toMatch(/^(msg:|hash:)/);
    });
  });

  describe('deduplicateEntries', () => {
    it('removes duplicates by requestId', () => {
      const entries = [makeEntry({ requestId: 'r1' }), makeEntry({ requestId: 'r1' }), makeEntry({ requestId: 'r2' })];
      expect(deduplicateEntries(entries)).toHaveLength(2);
    });

    it('removes duplicates by message.id', () => {
      const entries = [
        makeEntry({ message: { ...makeEntry().message, id: 'm1' } }),
        makeEntry({ message: { ...makeEntry().message, id: 'm1' } }),
      ];
      expect(deduplicateEntries(entries)).toHaveLength(1);
    });

    it('removes duplicates by hash fallback', () => {
      const entries = [makeEntry(), makeEntry()];
      expect(deduplicateEntries(entries)).toHaveLength(1);
    });

    it('preserves insertion order', () => {
      const entries = [makeEntry({ requestId: 'r1' }), makeEntry({ requestId: 'r2' }), makeEntry({ requestId: 'r1' })];
      const result = deduplicateEntries(entries);
      expect(result[0].requestId).toBe('r1');
      expect(result[1].requestId).toBe('r2');
    });

    it('handles cross-file dedup (same requestId different entries)', () => {
      // Simulates entries from different JSONL files with same requestId
      const a = makeEntry({ requestId: 'r1', cwd: '/project-a' });
      const b = makeEntry({ requestId: 'r1', cwd: '/project-b' });
      expect(deduplicateEntries([a, b])).toHaveLength(1);
    });

    it('returns empty array for empty input', () => {
      expect(deduplicateEntries([])).toHaveLength(0);
    });
  });
}
