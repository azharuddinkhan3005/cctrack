import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { UsageEntry } from './types.js';

/**
 * Edge case tests for cache.ts:
 * - Corrupt JSONL lines (partial JSON, empty lines, binary garbage)
 * - Entries without requestId or messageId (hash-only dedup in cache)
 * - getHistoryDir returns correct path
 * - loadCachedEntries with only `since` or only `until`
 * - cacheEntries with entries spanning many months
 */

const tmpBase = join(tmpdir(), `cctrackr-cache-edge-${Date.now()}`);
const historyDir = join(tmpBase, '.cctrackr', 'history');

function makeEntry(overrides: Partial<{
  timestamp: string;
  sessionId: string;
  model: string;
  requestId: string;
  messageId: string;
  input: number;
  output: number;
}> = {}): UsageEntry {
  return {
    timestamp: overrides.timestamp ?? '2026-03-25T14:30:00Z',
    sessionId: overrides.sessionId ?? 'session-abc',
    cwd: '/test/project',
    message: {
      id: overrides.messageId ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
      model: overrides.model ?? 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: overrides.input ?? 5000,
        output_tokens: overrides.output ?? 2000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    },
    costUSD: 0.05,
    requestId: overrides.requestId ?? `req_${Math.random().toString(36).slice(2, 10)}`,
  };
}

describe('cache edge cases', () => {
  let origHome: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    process.env.HOME = tmpBase;
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('loadCachedEntries skips corrupt JSONL lines gracefully', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');

    // Write a file with one valid line and several corrupt lines
    mkdirSync(historyDir, { recursive: true });
    const validLine = JSON.stringify({
      t: '2026-03-25T10:00:00Z',
      s: 'session-1',
      c: '/project',
      m: 'claude-sonnet-4-20250514',
      i: 1000,
      o: 500,
      cw: 0,
      cr: 0,
      r: 'req_valid',
    });
    const corruptContent = [
      validLine,
      'not json at all',
      '{incomplete json',
      '',
      '   ',
      validLine.slice(0, 10), // truncated JSON
    ].join('\n');

    writeFileSync(join(historyDir, '2026-03.jsonl'), corruptContent + '\n');

    const entries = loadCachedEntries();
    // Should get only the 1 valid entry, skipping all corrupt lines
    expect(entries).toHaveLength(1);
    expect(entries[0].requestId).toBe('req_valid');
  });

  it('cacheEntries deduplicates by messageId when requestId is absent', async () => {
    const { cacheEntries } = await import('./cache.js');

    // Create entries without requestId but with messageId
    const entry1: UsageEntry = {
      timestamp: '2026-03-25T10:00:00Z',
      sessionId: 'sess-1',
      cwd: '/project',
      message: {
        id: 'msg_unique_001',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      costUSD: 0.01,
      // No requestId
    };

    cacheEntries([entry1]);
    cacheEntries([entry1]); // Cache again -- should not duplicate

    const lines = readFileSync(join(historyDir, '2026-03.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('loadCachedEntries with only since parameter (no until)', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');

    const entries = [
      makeEntry({ timestamp: '2026-01-15T10:00:00Z', requestId: 'req_jan' }),
      makeEntry({ timestamp: '2026-03-15T10:00:00Z', requestId: 'req_mar' }),
      makeEntry({ timestamp: '2026-06-15T10:00:00Z', requestId: 'req_jun' }),
    ];

    cacheEntries(entries);

    // Load with only since -- should get March and June
    const result = loadCachedEntries('2026-03-01');
    expect(result.length).toBeGreaterThanOrEqual(2);
    const ids = result.map((e) => e.requestId);
    expect(ids).toContain('req_mar');
    expect(ids).toContain('req_jun');
    expect(ids).not.toContain('req_jan');
  });

  it('loadCachedEntries with only until parameter (no since)', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');

    const entries = [
      makeEntry({ timestamp: '2026-01-15T10:00:00Z', requestId: 'req_jan2' }),
      makeEntry({ timestamp: '2026-06-15T10:00:00Z', requestId: 'req_jun2' }),
    ];

    cacheEntries(entries);

    // Load with only until -- should get January only
    const result = loadCachedEntries(undefined, '2026-03-31');
    const ids = result.map((e) => e.requestId);
    expect(ids).toContain('req_jan2');
    expect(ids).not.toContain('req_jun2');
  });

  it('cacheEntries handles entries spanning many months', async () => {
    const { cacheEntries } = await import('./cache.js');

    const entries = Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0');
      return makeEntry({
        timestamp: `2026-${month}-15T10:00:00Z`,
        requestId: `req_month_${month}`,
      });
    });

    cacheEntries(entries);

    // Should create 12 separate files
    const files = require('node:fs').readdirSync(historyDir).filter((f: string) => f.endsWith('.jsonl'));
    expect(files).toHaveLength(12);
  });

  it('getHistoryDir returns the expected path', async () => {
    const { getHistoryDir } = await import('./cache.js');
    const dir = getHistoryDir();
    // Should end with .cctrackr/history
    expect(dir).toMatch(/\.cctrackr[/\\]history$/);
  });

  it('cacheEntries handles entries without optional fields', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');

    const sparseEntry: UsageEntry = {
      timestamp: '2026-03-25T10:00:00Z',
      // No sessionId, no cwd, no costUSD, no requestId
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    };

    cacheEntries([sparseEntry]);
    const loaded = loadCachedEntries();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].timestamp).toBe('2026-03-25T10:00:00Z');
    expect(loaded[0].sessionId).toBeUndefined();
    expect(loaded[0].cwd).toBeUndefined();
    expect(loaded[0].costUSD).toBeUndefined();
  });

  it('loadCachedEntries returns empty for non-existent history dir', async () => {
    const { loadCachedEntries } = await import('./cache.js');
    // tmpBase exists but .cctrackr/history/ does not
    const result = loadCachedEntries();
    expect(result).toEqual([]);
  });

  it('cacheEntries appends to existing file without overwriting', async () => {
    const { cacheEntries } = await import('./cache.js');

    const batch1 = [makeEntry({ timestamp: '2026-03-20T10:00:00Z', requestId: 'req_b1' })];
    const batch2 = [makeEntry({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_b2' })];

    cacheEntries(batch1);
    cacheEntries(batch2);

    const lines = readFileSync(join(historyDir, '2026-03.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
