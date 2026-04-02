import { describe, it, expect, beforeEach } from 'vitest';
import { discoverAgentMeta, buildSessionHierarchy } from './hierarchy.js';
import { setPricingData } from './pricing.js';
import type { UsageEntry, PricingData } from './types.js';

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

describe('discoverAgentMeta', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('returns empty map when no subagent files are present', () => {
    const files = [
      '/home/user/.claude/projects/-test/session-001/usage.jsonl',
      '/home/user/.claude/projects/-test/session-002/usage.jsonl',
    ];
    const result = discoverAgentMeta(files);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty file list', () => {
    const result = discoverAgentMeta([]);
    expect(result.size).toBe(0);
  });

  it('ignores non-agent JSONL files in subagents directory', () => {
    const files = [
      '/home/user/.claude/projects/-test/session-001/subagents/usage.jsonl',
      '/home/user/.claude/projects/-test/session-001/subagents/data.jsonl',
    ];
    const result = discoverAgentMeta(files);
    expect(result.size).toBe(0);
  });

  it('extracts agent ID from agent-*.jsonl filename', () => {
    const files = [
      '/home/user/.claude/projects/-test/session-001/subagents/agent-abc123.jsonl',
    ];
    const result = discoverAgentMeta(files);
    expect(result.size).toBe(1);
    expect(result.has('abc123')).toBe(true);
    const meta = result.get('abc123')!;
    expect(meta.agentId).toBe('abc123');
    expect(meta.parentSessionId).toBe('session-001');
    expect(meta.agentType).toBe('unknown');
    expect(meta.description).toBe('');
  });

  it('discovers multiple agents across sessions', () => {
    const files = [
      '/home/user/.claude/projects/-test/session-001/subagents/agent-a1.jsonl',
      '/home/user/.claude/projects/-test/session-001/subagents/agent-b2.jsonl',
      '/home/user/.claude/projects/-test/session-002/subagents/agent-c3.jsonl',
    ];
    const result = discoverAgentMeta(files);
    expect(result.size).toBe(3);
    expect(result.get('a1')!.parentSessionId).toBe('session-001');
    expect(result.get('b2')!.parentSessionId).toBe('session-001');
    expect(result.get('c3')!.parentSessionId).toBe('session-002');
  });
});

describe('buildSessionHierarchy', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('returns null for unknown session ID', () => {
    const entries = [makeEntry({ sessionId: 'session-001' })];
    const agentMeta = new Map();
    const result = buildSessionHierarchy('nonexistent-session', entries, agentMeta);
    expect(result).toBeNull();
  });

  it('returns null when entries array is empty', () => {
    const result = buildSessionHierarchy('session-001', [], new Map());
    expect(result).toBeNull();
  });

  it('creates root node with correct structure for session without agents', () => {
    const entries = [
      makeEntry({ sessionId: 'session-001', timestamp: '2026-03-25T10:00:00Z' }),
      makeEntry({ sessionId: 'session-001', timestamp: '2026-03-25T10:05:00Z' }),
    ];
    const agentMeta = new Map();
    const result = buildSessionHierarchy('session-001', entries, agentMeta);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('session-001');
    expect(result!.type).toBe('session');
    expect(result!.project).toBe('/test/project');
    expect(result!.children).toHaveLength(0);
    expect(result!.requestCount).toBe(2);
    // With no children, ownTokens should equal totalTokens
    expect(result!.totalTokens).toBe(result!.ownTokens);
    expect(result!.totalCost).toBe(result!.ownCost);
    // Tokens should be positive
    expect(result!.ownTokens).toBeGreaterThan(0);
    expect(result!.ownCost).toBeGreaterThan(0);
  });

  it('separates parent and agent entries into correct nodes', () => {
    const parentEntry = makeEntry({
      sessionId: 'session-001',
      timestamp: '2026-03-25T10:00:00Z',
      requestId: 'req_parent_1',
    });
    // Simulate a subagent entry (carries agentId field)
    const agentEntry = {
      ...makeEntry({
        sessionId: 'session-001',
        timestamp: '2026-03-25T10:05:00Z',
        requestId: 'req_agent_1',
      }),
      agentId: 'agent-x',
    } as UsageEntry;

    const agentMeta = new Map([
      ['agent-x', {
        agentId: 'agent-x',
        agentType: 'code-reviewer',
        description: 'Reviews code quality',
        parentSessionId: 'session-001',
        jsonlPath: '/tmp/agent-x.jsonl',
      }],
    ]);

    const result = buildSessionHierarchy('session-001', [parentEntry, agentEntry], agentMeta);

    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(1);
    expect(result!.requestCount).toBe(2); // parent + agent
    // Child node should have the agent metadata
    const child = result!.children[0];
    expect(child.id).toBe('agent-x');
    expect(child.type).toBe('agent');
    expect(child.agentType).toBe('code-reviewer');
    expect(child.description).toBe('Reviews code quality');
    expect(child.requestCount).toBe(1);
    expect(child.children).toHaveLength(0); // flat hierarchy
  });

  it('ignores agents that belong to a different session', () => {
    const entries = [
      makeEntry({ sessionId: 'session-001' }),
    ];
    const agentMeta = new Map([
      ['agent-other', {
        agentId: 'agent-other',
        agentType: 'test',
        description: '',
        parentSessionId: 'session-999', // different session
        jsonlPath: '/tmp/agent-other.jsonl',
      }],
    ]);

    const result = buildSessionHierarchy('session-001', entries, agentMeta);

    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(0);
  });

  it('computes totalCost as sum of own + children costs', () => {
    const parentEntry = makeEntry({
      sessionId: 'session-001',
      requestId: 'req_parent',
    });
    const agentEntry = {
      ...makeEntry({
        sessionId: 'session-001',
        requestId: 'req_agent',
        message: {
          model: 'claude-opus-4-20250514',
          usage: {
            input_tokens: 10000,
            output_tokens: 5000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
      agentId: 'agent-y',
    } as UsageEntry;

    const agentMeta = new Map([
      ['agent-y', {
        agentId: 'agent-y',
        agentType: 'reviewer',
        description: '',
        parentSessionId: 'session-001',
        jsonlPath: '/tmp/agent-y.jsonl',
      }],
    ]);

    const result = buildSessionHierarchy('session-001', [parentEntry, agentEntry], agentMeta);

    expect(result).not.toBeNull();
    const childCost = result!.children[0].totalCost;
    // total = own + child
    expect(result!.totalCost).toBeCloseTo(result!.ownCost + childCost, 10);
    expect(result!.totalTokens).toBe(result!.ownTokens + result!.children[0].totalTokens);
  });

  it('sorts children by cost descending', () => {
    // Two agents: one with more expensive model (Opus) should come first
    const parentEntry = makeEntry({ sessionId: 'session-001', requestId: 'req_p' });
    const cheapAgent = {
      ...makeEntry({
        sessionId: 'session-001',
        requestId: 'req_cheap',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      }),
      agentId: 'agent-cheap',
    } as UsageEntry;
    const expensiveAgent = {
      ...makeEntry({
        sessionId: 'session-001',
        requestId: 'req_expensive',
        message: {
          model: 'claude-opus-4-20250514',
          usage: { input_tokens: 10000, output_tokens: 5000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      }),
      agentId: 'agent-expensive',
    } as UsageEntry;

    const agentMeta = new Map([
      ['agent-cheap', { agentId: 'agent-cheap', agentType: 'lint', description: '', parentSessionId: 'session-001', jsonlPath: '' }],
      ['agent-expensive', { agentId: 'agent-expensive', agentType: 'review', description: '', parentSessionId: 'session-001', jsonlPath: '' }],
    ]);

    const result = buildSessionHierarchy('session-001', [parentEntry, cheapAgent, expensiveAgent], agentMeta);

    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(2);
    // The more expensive agent should be first
    expect(result!.children[0].totalCost).toBeGreaterThanOrEqual(result!.children[1].totalCost);
    expect(result!.children[0].id).toBe('agent-expensive');
    expect(result!.children[1].id).toBe('agent-cheap');
  });
});
