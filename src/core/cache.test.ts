import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { UsageEntry } from './types.js';

// We need to override HISTORY_DIR for tests. Import the module and mock the path.
// Since cache.ts uses a const for HISTORY_DIR, we'll test via the public API
// after temporarily setting HOME to redirect ~/.cctrackr/history/

const tmpBase = join(tmpdir(), `cctrackr-cache-test-${Date.now()}`);
const historyDir = join(tmpBase, '.cctrackr', 'history');

function makeEntry(overrides: Partial<{ timestamp: string; sessionId: string; model: string; requestId: string; messageId: string; input: number; output: number }> = {}): UsageEntry {
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

describe('cache module', () => {
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

  it('cacheEntries creates history directory and JSONL files', async () => {
    // Dynamic import so HOME is set before module loads
    const { cacheEntries } = await import('./cache.js');
    const entries = [
      makeEntry({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_a' }),
      makeEntry({ timestamp: '2026-03-26T10:00:00Z', requestId: 'req_b' }),
      makeEntry({ timestamp: '2026-04-01T10:00:00Z', requestId: 'req_c' }),
    ];

    cacheEntries(entries);

    // Should create files for both months
    expect(existsSync(join(historyDir, '2026-03.jsonl'))).toBe(true);
    expect(existsSync(join(historyDir, '2026-04.jsonl'))).toBe(true);

    // March file should have 2 entries
    const marchLines = readFileSync(join(historyDir, '2026-03.jsonl'), 'utf-8').trim().split('\n');
    expect(marchLines).toHaveLength(2);

    // April file should have 1 entry
    const aprilLines = readFileSync(join(historyDir, '2026-04.jsonl'), 'utf-8').trim().split('\n');
    expect(aprilLines).toHaveLength(1);
  });

  it('cacheEntries does not duplicate entries on re-cache', async () => {
    const { cacheEntries } = await import('./cache.js');
    const entries = [
      makeEntry({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_dedup1' }),
      makeEntry({ timestamp: '2026-03-26T10:00:00Z', requestId: 'req_dedup2' }),
    ];

    cacheEntries(entries);
    cacheEntries(entries); // Re-cache same entries

    const lines = readFileSync(join(historyDir, '2026-03.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2); // Still 2, not 4
  });

  it('loadCachedEntries returns empty when no history exists', async () => {
    const { loadCachedEntries } = await import('./cache.js');
    const entries = loadCachedEntries();
    expect(entries).toHaveLength(0);
  });

  it('loadCachedEntries round-trips entries through cache', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');
    const original = [
      makeEntry({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_rt1', model: 'claude-opus-4-20250514' }),
      makeEntry({ timestamp: '2026-03-26T10:00:00Z', requestId: 'req_rt2', input: 8000, output: 3000 }),
    ];

    cacheEntries(original);
    const loaded = loadCachedEntries();

    expect(loaded).toHaveLength(2);
    expect(loaded[0].timestamp).toBe('2026-03-25T10:00:00Z');
    expect(loaded[0].requestId).toBe('req_rt1');
    expect(loaded[0].message.model).toBe('claude-opus-4-20250514');
    expect(loaded[1].message.usage.input_tokens).toBe(8000);
  });

  it('loadCachedEntries filters by date range', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');
    const entries = [
      makeEntry({ timestamp: '2026-02-15T10:00:00Z', requestId: 'req_feb' }),
      makeEntry({ timestamp: '2026-03-15T10:00:00Z', requestId: 'req_mar' }),
      makeEntry({ timestamp: '2026-04-15T10:00:00Z', requestId: 'req_apr' }),
    ];

    cacheEntries(entries);

    // Only March
    const marchOnly = loadCachedEntries('2026-03-01', '2026-03-31');
    expect(marchOnly).toHaveLength(1);
    expect(marchOnly[0].requestId).toBe('req_mar');
  });

  it('cacheEntries handles empty array gracefully', async () => {
    const { cacheEntries } = await import('./cache.js');
    cacheEntries([]);
    // Should not create any files
    expect(existsSync(historyDir)).toBe(false);
  });

  it('compact format preserves all critical fields', async () => {
    const { cacheEntries, loadCachedEntries } = await import('./cache.js');
    const entry = makeEntry({
      timestamp: '2026-03-25T10:00:00Z',
      sessionId: 'sess-123',
      requestId: 'req-456',
      messageId: 'msg-789',
      model: 'claude-opus-4-20250514',
      input: 10000,
      output: 5000,
    });
    entry.cwd = '/my/project';
    entry.costUSD = 1.23;

    cacheEntries([entry]);
    const [loaded] = loadCachedEntries();

    expect(loaded.timestamp).toBe('2026-03-25T10:00:00Z');
    expect(loaded.sessionId).toBe('sess-123');
    expect(loaded.requestId).toBe('req-456');
    expect(loaded.message.id).toBe('msg-789');
    expect(loaded.message.model).toBe('claude-opus-4-20250514');
    expect(loaded.message.usage.input_tokens).toBe(10000);
    expect(loaded.message.usage.output_tokens).toBe(5000);
    expect(loaded.cwd).toBe('/my/project');
    expect(loaded.costUSD).toBe(1.23);
  });

  it('cache writes to HOME-relative path, not the real home directory', async () => {
    const { cacheEntries, getHistoryDir } = await import('./cache.js');

    // getHistoryDir should point to our tmpBase (set in beforeEach), not the original home
    const dir = getHistoryDir();
    expect(dir).toContain(tmpBase);
    expect(dir).toBe(join(tmpBase, '.cctrackr', 'history'));

    // Write an entry and verify it lands in the tmp directory
    cacheEntries([makeEntry({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_isolation_test' })]);
    // Verify it IS in the tmp directory (not the real home)
    const tmpCachePath = join(tmpBase, '.cctrackr', 'history', '2026-03.jsonl');
    expect(existsSync(tmpCachePath)).toBe(true);
    const tmpContent = readFileSync(tmpCachePath, 'utf-8');
    expect(tmpContent).toContain('req_isolation_test');
  });
});
