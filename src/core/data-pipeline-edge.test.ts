import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Additional edge case tests for data-pipeline.ts:
 * - Cache enabled (default) path actually merges cached + fresh
 * - Empty JSONL files (no entries in session dir)
 * - since/until filtering passed to loadData
 * - Pipeline with only cached data (no fresh files)
 */

const tmpBase = join(tmpdir(), `cctrackr-pipeline-edge-${Date.now()}`);
const projectsDir = join(tmpBase, '.claude', 'projects');
const sessionDir = join(projectsDir, '-Users-ci-Sites-testproject', 'session-edge1');
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
    sessionId: overrides.sessionId ?? 'session-edge1',
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

describe('data-pipeline edge cases', () => {
  let origHome: string | undefined;
  let origConfigDir: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = tmpBase;
    process.env.CLAUDE_CONFIG_DIR = join(tmpBase, '.claude');
    mkdirSync(tmpBase, { recursive: true });
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

  it('merges cached and fresh entries when cache is enabled', async () => {
    // Set up fresh data
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'usage.jsonl'),
      makeJsonlLine({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_fresh_only' }) + '\n',
    );

    // Set up cached data from a different month (won't overlap with fresh)
    mkdirSync(historyDir, { recursive: true });
    const cachedLine = JSON.stringify({
      t: '2026-02-15T10:00:00Z',
      s: 'session-old',
      c: '/Users/ci/Sites/testproject',
      m: 'claude-sonnet-4-20250514',
      i: 1000,
      o: 500,
      cw: 0,
      cr: 0,
      r: 'req_cached_only',
    });
    writeFileSync(join(historyDir, '2026-02.jsonl'), cachedLine + '\n');

    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData(); // cache enabled by default

    // Should contain both cached and fresh entries
    const ids = result.entries.map((e) => e.requestId);
    expect(ids).toContain('req_fresh_only');
    expect(ids).toContain('req_cached_only');
  });

  it('handles empty JSONL file gracefully', async () => {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'usage.jsonl'), '');

    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData({ noCache: true });

    expect(result.errors).toBe(0);
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it('passes since/until to cache loading for date range filtering', async () => {
    // Set up cached data in two months
    mkdirSync(historyDir, { recursive: true });
    const janLine = JSON.stringify({
      t: '2026-01-15T10:00:00Z', s: 'session-jan', c: '/project',
      m: 'claude-sonnet-4-20250514', i: 1000, o: 500, cw: 0, cr: 0, r: 'req_jan',
    });
    const junLine = JSON.stringify({
      t: '2026-06-15T10:00:00Z', s: 'session-jun', c: '/project',
      m: 'claude-sonnet-4-20250514', i: 1000, o: 500, cw: 0, cr: 0, r: 'req_jun',
    });
    writeFileSync(join(historyDir, '2026-01.jsonl'), janLine + '\n');
    writeFileSync(join(historyDir, '2026-06.jsonl'), junLine + '\n');

    // No fresh data
    mkdirSync(join(projectsDir, '-Users-ci-Sites-testproject'), { recursive: true });

    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData({ since: '2026-05-01', until: '2026-07-01' });

    // Only June should be loaded from cache
    const ids = result.entries.map((e) => e.requestId);
    expect(ids).toContain('req_jun');
    // January should not be loaded (outside the since range)
    expect(ids).not.toContain('req_jan');
  });

  it('returns only cached data when no JSONL files exist on disk', async () => {
    // Only cached data, no session directories
    mkdirSync(historyDir, { recursive: true });
    const cachedLine = JSON.stringify({
      t: '2026-03-15T10:00:00Z', s: 'session-cached', c: '/project',
      m: 'claude-sonnet-4-20250514', i: 2000, o: 1000, cw: 0, cr: 0, r: 'req_cache_only',
    });
    writeFileSync(join(historyDir, '2026-03.jsonl'), cachedLine + '\n');

    const { loadData } = await import('./data-pipeline.js');
    const result = await loadData();

    const ids = result.entries.map((e) => e.requestId);
    expect(ids).toContain('req_cache_only');
    expect(result.errors).toBe(0);
  });

  it('caches fresh entries for future runs when cache is enabled', async () => {
    mkdirSync(sessionDir, { recursive: true });
    const freshLine = makeJsonlLine({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_to_cache' });
    writeFileSync(join(sessionDir, 'usage.jsonl'), freshLine + '\n');

    const { loadData } = await import('./data-pipeline.js');
    await loadData(); // Should cache the fresh entry

    // Now the history dir should have a file for 2026-03
    const { existsSync, readFileSync } = require('node:fs');
    const cachePath = join(historyDir, '2026-03.jsonl');
    expect(existsSync(cachePath)).toBe(true);
    const content = readFileSync(cachePath, 'utf-8');
    expect(content).toContain('req_to_cache');
  });
});
