import { describe, it, expect, beforeEach } from 'vitest';
import { setPricingData } from './pricing.js';
import { aggregateSessions, filterEntries } from './aggregator.js';
import { processEntry } from './calculator.js';
import type { UsageEntry, PricingData, CostMode, SessionAggregate } from './types.js';

/**
 * Tests for session detail logic extracted from src/commands/session.ts.
 *
 * Since getSessionDetail is a private function inside the command module,
 * we replicate its logic here and test it against the core functions
 * it depends on (filterEntries, aggregateSessions, processEntry).
 *
 * This covers:
 * - Prefix matching (session ID is a prefix of the full ID)
 * - No matching session
 * - Ambiguous prefix match (multiple sessions matching)
 * - Session with null/undefined sessionId entries
 * - Single request session
 * - Session detail with different cost modes
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
    sessionId: 'session-abc123-full-id',
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

/**
 * Replicate getSessionDetail logic from session.ts for unit testing.
 */
function getSessionDetail(
  entries: UsageEntry[],
  sessionId: string,
  mode: CostMode,
): { session: SessionAggregate; requests: Array<{ timestamp: string; model: string; cost: number }> } | null {
  const matching = entries.filter((e) => e.sessionId?.startsWith(sessionId));
  if (matching.length === 0) return null;

  const fullId = matching[0].sessionId!;
  const sessionEntries = entries.filter((e) => e.sessionId === fullId);

  const requests = sessionEntries
    .map((e) => {
      const result = processEntry(e, mode);
      return {
        timestamp: e.timestamp,
        model: e.message.model ?? 'unknown',
        cost: result.cost.total_cost,
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const sessions = aggregateSessions(sessionEntries, mode);
  const session = sessions.find((s) => s.sessionId === fullId) ?? sessions[0];

  return { session, requests };
}

describe('session detail: prefix matching', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('matches session by full ID', () => {
    const entries = [
      makeEntry({ sessionId: 'session-abc123-full-id', requestId: 'req_1' }),
      makeEntry({ sessionId: 'session-abc123-full-id', requestId: 'req_2', timestamp: '2026-03-25T11:00:00Z' }),
    ];
    const result = getSessionDetail(entries, 'session-abc123-full-id', 'calculate');

    expect(result).not.toBeNull();
    expect(result!.session.sessionId).toBe('session-abc123-full-id');
    expect(result!.requests).toHaveLength(2);
  });

  it('matches session by prefix', () => {
    const entries = [
      makeEntry({ sessionId: 'session-abc123-full-id', requestId: 'req_p1' }),
      makeEntry({ sessionId: 'session-abc123-full-id', requestId: 'req_p2' }),
    ];
    const result = getSessionDetail(entries, 'session-abc', 'calculate');

    expect(result).not.toBeNull();
    expect(result!.session.sessionId).toBe('session-abc123-full-id');
  });

  it('returns null for non-matching session ID', () => {
    const entries = [
      makeEntry({ sessionId: 'session-abc123' }),
    ];
    const result = getSessionDetail(entries, 'session-xyz', 'calculate');
    expect(result).toBeNull();
  });

  it('returns null for empty entries array', () => {
    const result = getSessionDetail([], 'session-abc', 'calculate');
    expect(result).toBeNull();
  });
});

describe('session detail: ambiguous prefix', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('resolves to first matching session when prefix matches multiple', () => {
    const entries = [
      makeEntry({ sessionId: 'session-abc-111', requestId: 'req_m1', timestamp: '2026-03-25T10:00:00Z' }),
      makeEntry({ sessionId: 'session-abc-222', requestId: 'req_m2', timestamp: '2026-03-25T11:00:00Z' }),
      makeEntry({ sessionId: 'session-abc-333', requestId: 'req_m3', timestamp: '2026-03-25T12:00:00Z' }),
    ];

    // Prefix "session-abc" matches all three sessions
    const result = getSessionDetail(entries, 'session-abc', 'calculate');

    // getSessionDetail picks the first match's full sessionId
    expect(result).not.toBeNull();
    expect(result!.session.sessionId).toBe('session-abc-111');
    expect(result!.requests).toHaveLength(1);
  });

  it('detects ambiguous matches (multiple unique session IDs match prefix)', () => {
    const entries = [
      makeEntry({ sessionId: 'session-abc-111', requestId: 'req_a1' }),
      makeEntry({ sessionId: 'session-abc-222', requestId: 'req_a2' }),
    ];

    // Logic for detecting ambiguity (from session.ts command handler)
    const prefix = 'session-abc';
    const matchingSessions = [...new Set(
      entries.filter((e) => e.sessionId?.startsWith(prefix)).map((e) => e.sessionId),
    )];

    expect(matchingSessions.length).toBeGreaterThan(1);
    expect(matchingSessions).toContain('session-abc-111');
    expect(matchingSessions).toContain('session-abc-222');
  });
});

describe('session detail: entries with null/undefined sessionId', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('skips entries without sessionId when searching by prefix', () => {
    const entries = [
      makeEntry({ sessionId: undefined, requestId: 'req_no_session' }),
      makeEntry({ sessionId: 'session-abc', requestId: 'req_with_session' }),
    ];

    const result = getSessionDetail(entries, 'session-abc', 'calculate');
    expect(result).not.toBeNull();
    expect(result!.requests).toHaveLength(1);
  });

  it('returns null when all entries lack sessionId', () => {
    const entries = [
      makeEntry({ sessionId: undefined }),
      makeEntry({ sessionId: undefined }),
    ];

    const result = getSessionDetail(entries, 'session-abc', 'calculate');
    expect(result).toBeNull();
  });
});

describe('session detail: cost modes', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('display mode uses embedded costUSD', () => {
    const entries = [
      makeEntry({ sessionId: 'session-001', costUSD: 0.99, requestId: 'req_d1' }),
    ];

    const result = getSessionDetail(entries, 'session-001', 'display');
    expect(result).not.toBeNull();
    expect(result!.requests[0].cost).toBe(0.99);
  });

  it('calculate mode computes cost from pricing', () => {
    const entries = [
      makeEntry({
        sessionId: 'session-001',
        costUSD: 0.99,
        requestId: 'req_c1',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 10000,
            output_tokens: 5000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
    ];

    const result = getSessionDetail(entries, 'session-001', 'calculate');
    expect(result).not.toBeNull();
    // Calculated cost should be different from embedded costUSD
    const expectedCost = 10000 * (3.0 / 1e6) + 5000 * (15.0 / 1e6);
    expect(result!.requests[0].cost).toBeCloseTo(expectedCost, 6);
  });
});

describe('session detail: request ordering', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('sorts requests by timestamp ascending', () => {
    const entries = [
      makeEntry({ sessionId: 'session-001', timestamp: '2026-03-25T14:00:00Z', requestId: 'req_3rd' }),
      makeEntry({ sessionId: 'session-001', timestamp: '2026-03-25T10:00:00Z', requestId: 'req_1st' }),
      makeEntry({ sessionId: 'session-001', timestamp: '2026-03-25T12:00:00Z', requestId: 'req_2nd' }),
    ];

    const result = getSessionDetail(entries, 'session-001', 'calculate');
    expect(result).not.toBeNull();
    expect(result!.requests[0].timestamp).toBe('2026-03-25T10:00:00Z');
    expect(result!.requests[1].timestamp).toBe('2026-03-25T12:00:00Z');
    expect(result!.requests[2].timestamp).toBe('2026-03-25T14:00:00Z');
  });
});

describe('session detail: model handling', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('handles entries with undefined model', () => {
    const entries = [
      makeEntry({
        sessionId: 'session-001',
        requestId: 'req_nomodel',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
    ];

    const result = getSessionDetail(entries, 'session-001', 'calculate');
    expect(result).not.toBeNull();
    expect(result!.requests[0].model).toBe('unknown');
  });

  it('handles session with mixed models', () => {
    const entries = [
      makeEntry({
        sessionId: 'session-001',
        requestId: 'req_sonnet',
        timestamp: '2026-03-25T10:00:00Z',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      }),
      makeEntry({
        sessionId: 'session-001',
        requestId: 'req_opus',
        timestamp: '2026-03-25T11:00:00Z',
        message: {
          model: 'claude-opus-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      }),
    ];

    const result = getSessionDetail(entries, 'session-001', 'calculate');
    expect(result).not.toBeNull();
    expect(result!.requests[0].model).toBe('claude-sonnet-4-20250514');
    expect(result!.requests[1].model).toBe('claude-opus-4-20250514');
    // Opus should cost more per token
    expect(result!.requests[1].cost).toBeGreaterThan(result!.requests[0].cost);
  });
});
