import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverAgentMeta, buildSessionHierarchy } from './hierarchy.js';
import { setPricingData } from './pricing.js';
import type { UsageEntry, PricingData } from './types.js';

/**
 * Edge case tests for hierarchy.ts:
 * - discoverAgentMeta with real meta.json files on disk (covers lines 58-61)
 * - discoverAgentMeta with corrupt meta.json
 * - buildSessionHierarchy with zero agents but multiple sessions
 * - buildSessionHierarchy with all entries being agent entries (no parent entries)
 * - buildSessionHierarchy with entries that have no cwd
 */

const testPricing: PricingData = {
  version: 'test',
  models: {
    'claude-sonnet-4-20250514': {
      input_cost_per_million: 3.0,
      output_cost_per_million: 15.0,
      cache_creation_cost_per_million: 3.75,
      cache_read_cost_per_million: 0.30,
      context_window: 200000,
    },
    'claude-opus-4-20250514': {
      input_cost_per_million: 15.0,
      output_cost_per_million: 75.0,
      cache_creation_cost_per_million: 18.75,
      cache_read_cost_per_million: 1.50,
      context_window: 200000,
    },
  },
  aliases: {},
};

function makeEntry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    timestamp: '2026-03-25T10:00:00Z',
    sessionId: 'session-001',
    cwd: '/test/project',
    message: {
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 5000,
        output_tokens: 2000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    },
    costUSD: 0.05,
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

const tmpBase = join(tmpdir(), `cctrackr-hierarchy-edge-${Date.now()}`);

describe('discoverAgentMeta with filesystem', () => {
  beforeEach(() => {
    setPricingData(testPricing);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('reads agent metadata from .meta.json file on disk', () => {
    // Set up directory structure:
    // <tmpBase>/session-001/subagents/agent-xyz.jsonl
    // <tmpBase>/session-001/subagents/agent-xyz.meta.json
    const subagentsDir = join(tmpBase, 'session-001', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, 'agent-xyz.jsonl'), '{}');
    writeFileSync(
      join(subagentsDir, 'agent-xyz.meta.json'),
      JSON.stringify({ agentType: 'code-reviewer', description: 'Reviews code for quality' }),
    );

    const files = [join(subagentsDir, 'agent-xyz.jsonl')];
    const result = discoverAgentMeta(files);

    expect(result.size).toBe(1);
    const meta = result.get('xyz')!;
    expect(meta.agentType).toBe('code-reviewer');
    expect(meta.description).toBe('Reviews code for quality');
    expect(meta.parentSessionId).toBe('session-001');
  });

  it('handles corrupt meta.json gracefully', () => {
    const subagentsDir = join(tmpBase, 'session-002', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, 'agent-bad.jsonl'), '{}');
    writeFileSync(join(subagentsDir, 'agent-bad.meta.json'), 'not valid json!!!');

    const files = [join(subagentsDir, 'agent-bad.jsonl')];
    const result = discoverAgentMeta(files);

    expect(result.size).toBe(1);
    const meta = result.get('bad')!;
    expect(meta.agentType).toBe('unknown');
    expect(meta.description).toBe('');
  });

  it('reads meta.json with missing optional fields', () => {
    const subagentsDir = join(tmpBase, 'session-003', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, 'agent-partial.jsonl'), '{}');
    writeFileSync(
      join(subagentsDir, 'agent-partial.meta.json'),
      JSON.stringify({}), // Empty object -- no agentType or description
    );

    const files = [join(subagentsDir, 'agent-partial.jsonl')];
    const result = discoverAgentMeta(files);

    expect(result.size).toBe(1);
    const meta = result.get('partial')!;
    expect(meta.agentType).toBe('unknown');
    expect(meta.description).toBe('');
  });
});

describe('discoverAgentMeta path patterns', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('handles files inside nested subagents/ subdirectory', () => {
    // Some structures might have extra nesting: .../subagents/group/agent-abc.jsonl
    const files = [
      '/home/user/.claude/projects/-test/session-001/subagents/group/agent-nested.jsonl',
    ];
    // This path includes '/subagents/' in the middle, so should be picked up
    const result = discoverAgentMeta(files);
    expect(result.size).toBe(1);
    expect(result.has('nested')).toBe(true);
    // parentSessionId comes from dirname of dirname, which is "group" in this case
    // This is an edge case where the hierarchy depth is unexpected
  });

  it('skips files that end with subagents but are not in subagents directory', () => {
    const files = [
      '/home/user/.claude/projects/-test/my-subagents/agent-fake.jsonl',
    ];
    // The dirname is "my-subagents" which ends with "subagents" -- but the check is
    // dir.endsWith('/subagents') or dir.includes('/subagents/')
    // "my-subagents" does not end with "/subagents" exactly
    const result = discoverAgentMeta(files);
    expect(result.size).toBe(0);
  });
});

describe('buildSessionHierarchy edge cases', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('handles session with all entries being agent entries (no parent-only entries)', () => {
    const agentEntry1 = {
      ...makeEntry({ sessionId: 'session-001', requestId: 'req_a1' }),
      agentId: 'agent-a',
    } as UsageEntry;
    const agentEntry2 = {
      ...makeEntry({ sessionId: 'session-001', requestId: 'req_a2' }),
      agentId: 'agent-a',
    } as UsageEntry;

    const agentMeta = new Map([
      ['agent-a', {
        agentId: 'agent-a',
        agentType: 'test-agent',
        description: 'Test',
        parentSessionId: 'session-001',
        jsonlPath: '/tmp/agent-a.jsonl',
      }],
    ]);

    const result = buildSessionHierarchy('session-001', [agentEntry1, agentEntry2], agentMeta);

    expect(result).not.toBeNull();
    // Parent should have 0 own requests
    const parentRequestCount = result!.requestCount - result!.children.reduce((s, c) => s + c.requestCount, 0);
    expect(parentRequestCount).toBe(0);
    expect(result!.ownTokens).toBe(0);
    expect(result!.ownCost).toBe(0);
    // But total should include children
    expect(result!.totalTokens).toBeGreaterThan(0);
    expect(result!.children).toHaveLength(1);
    expect(result!.children[0].requestCount).toBe(2);
  });

  it('handles session with entry that has undefined cwd', () => {
    const entry = makeEntry({ sessionId: 'session-001', cwd: undefined });
    const agentMeta = new Map();

    const result = buildSessionHierarchy('session-001', [entry], agentMeta);

    expect(result).not.toBeNull();
    // Project should fall back to the first entry's cwd which is undefined
    expect(result!.project).toBe('unknown');
  });

  it('handles multiple agents with zero entries each', () => {
    const parentEntry = makeEntry({ sessionId: 'session-001', requestId: 'req_p' });

    const agentMeta = new Map([
      ['agent-empty1', {
        agentId: 'agent-empty1',
        agentType: 'lint',
        description: '',
        parentSessionId: 'session-001',
        jsonlPath: '',
      }],
      ['agent-empty2', {
        agentId: 'agent-empty2',
        agentType: 'review',
        description: '',
        parentSessionId: 'session-001',
        jsonlPath: '',
      }],
    ]);

    const result = buildSessionHierarchy('session-001', [parentEntry], agentMeta);

    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(2);
    // Both children should have 0 cost and 0 requests
    for (const child of result!.children) {
      expect(child.requestCount).toBe(0);
      expect(child.ownCost).toBe(0);
      expect(child.ownTokens).toBe(0);
    }
    // Total should equal parent's own
    expect(result!.totalCost).toBe(result!.ownCost);
    expect(result!.totalTokens).toBe(result!.ownTokens);
  });

  it('correctly handles single entry session', () => {
    const entry = makeEntry({ sessionId: 'session-single' });
    const agentMeta = new Map();

    const result = buildSessionHierarchy('session-single', [entry], agentMeta);

    expect(result).not.toBeNull();
    expect(result!.requestCount).toBe(1);
    expect(result!.children).toHaveLength(0);
    expect(result!.ownCost).toBeGreaterThan(0);
    expect(result!.totalCost).toBe(result!.ownCost);
  });

  it('filters out entries from other sessions correctly', () => {
    const entries = [
      makeEntry({ sessionId: 'session-001', requestId: 'req_s1' }),
      makeEntry({ sessionId: 'session-002', requestId: 'req_s2' }),
      makeEntry({ sessionId: 'session-003', requestId: 'req_s3' }),
    ];
    const agentMeta = new Map();

    const result = buildSessionHierarchy('session-001', entries, agentMeta);

    expect(result).not.toBeNull();
    expect(result!.requestCount).toBe(1);
  });

  it('uses display cost mode when specified', () => {
    const entry = makeEntry({
      sessionId: 'session-001',
      costUSD: 0.42,
    });
    const agentMeta = new Map();

    const calcResult = buildSessionHierarchy('session-001', [entry], agentMeta, 'calculate');
    const displayResult = buildSessionHierarchy('session-001', [entry], agentMeta, 'display');

    expect(calcResult).not.toBeNull();
    expect(displayResult).not.toBeNull();
    // Display mode uses embedded costUSD, calculate mode uses formula
    expect(displayResult!.ownCost).toBe(0.42);
    expect(calcResult!.ownCost).not.toBe(displayResult!.ownCost);
  });
});
