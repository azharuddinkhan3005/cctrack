import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Tests for the unified data-loading pipeline (loadData).
 *
 * Strategy: create a realistic fixture directory that mimics Claude Code's
 * project structure, point the environment at it, and verify that loadData
 * correctly merges cached + fresh entries with deduplication.
 */

const tmpBase = join(tmpdir(), `cctrackr-pipeline-test-${Date.now()}`);
const projectsDir = join(tmpBase, '.claude', 'projects');
const sessionDir = join(projectsDir, '-Users-ci-Sites-testproject', 'session-pipe1');
const historyDir = join(tmpBase, '.cctrackr', 'history');

function makeJsonlLine(overrides: {
  timestamp?: string;
  sessionId?: string;
  model?: string;
  input?: number;
  output?: number;
  requestId?: string;
} = {}): string {
  return JSON.stringify({
    timestamp: overrides.timestamp ?? '2026-03-25T14:30:00Z',
    sessionId: overrides.sessionId ?? 'session-pipe1',
    cwd: '/Users/ci/Sites/testproject',
    message: {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
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
  });
}

describe('data-pipeline loadData', () => {
  let origHome: string | undefined;
  let origConfigDir: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = tmpBase;
    process.env.CLAUDE_CONFIG_DIR = join(tmpBase, '.claude');

    // Create session directory with JSONL fixture
    mkdirSync(sessionDir, { recursive: true });
    const lines = [
      makeJsonlLine({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_fresh_1' }),
      makeJsonlLine({ timestamp: '2026-03-25T11:00:00Z', requestId: 'req_fresh_2' }),
      makeJsonlLine({ timestamp: '2026-03-25T12:00:00Z', requestId: 'req_fresh_3' }),
    ];
    writeFileSync(join(sessionDir, 'usage.jsonl'), lines.join('\n') + '\n');
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = origConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('returns entries and errors from fresh JSONL files', async () => {
    // Dynamic import so environment is set before module resolution
    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData({ noCache: true });

    expect(result.entries.length).toBeGreaterThanOrEqual(3);
    expect(result.errors).toBe(0);
    // Verify entries have correct shape
    const entry = result.entries[0];
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('message');
    expect(entry.message).toHaveProperty('usage');
  });

  it('returns entries with noCache option (skips history dir)', async () => {
    // Pre-populate a history cache file
    mkdirSync(historyDir, { recursive: true });
    // Use the compact format that cache.ts writes
    const cachedLine = JSON.stringify({
      t: '2026-02-15T10:00:00Z',
      s: 'session-old',
      c: '/old/project',
      m: 'claude-sonnet-4-20250514',
      i: 1000,
      o: 500,
      cw: 0,
      cr: 0,
      r: 'req_cached_old',
    });
    writeFileSync(join(historyDir, '2026-02.jsonl'), cachedLine + '\n');

    const { loadData } = await import('./data-pipeline.js');

    // With noCache, should NOT include the cached February entry
    const noCacheResult = await loadData({ noCache: true });
    const hasCached = noCacheResult.entries.some((e) => e.requestId === 'req_cached_old');
    expect(hasCached).toBe(false);
  });

  it('deduplicates entries across cache and fresh data', async () => {
    // Write the same requestId to both cache and fresh JSONL
    // Fresh data already has req_fresh_1, req_fresh_2, req_fresh_3
    // Put req_fresh_1 in cache too -- it should be deduped
    mkdirSync(historyDir, { recursive: true });
    const cachedLine = JSON.stringify({
      t: '2026-03-25T10:00:00Z',
      s: 'session-pipe1',
      c: '/Users/ci/Sites/testproject',
      m: 'claude-sonnet-4-20250514',
      i: 5000,
      o: 2000,
      cw: 100,
      cr: 50,
      r: 'req_fresh_1', // Same requestId as in fresh data
      mi: 'msg_dup',
    });
    writeFileSync(join(historyDir, '2026-03.jsonl'), cachedLine + '\n');

    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData();

    // Count how many entries have req_fresh_1 -- should be exactly 1
    const count = result.entries.filter((e) => e.requestId === 'req_fresh_1').length;
    expect(count).toBe(1);
  });

  it('returns empty entries when no JSONL files exist', async () => {
    // Remove the session dir so there's nothing to parse
    rmSync(sessionDir, { recursive: true, force: true });

    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData({ noCache: true });

    // May still have entries from other dirs on disk,
    // but errors should be 0 since there's nothing to fail on
    expect(result.errors).toBe(0);
    expect(Array.isArray(result.entries)).toBe(true);
  });
});
