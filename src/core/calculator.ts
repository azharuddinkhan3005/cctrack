import type { UsageEntry, CostBreakdown, TokenBreakdown, CostMode } from './types.js';
import { calculateEntryCost } from './pricing.js';

export interface EntryResult {
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  calculatedCost: CostBreakdown;
  displayCost: number | undefined;
}

/**
 * Process a single entry: extract token breakdown and calculate costs.
 */
export function processEntry(entry: UsageEntry, mode: CostMode = 'calculate'): EntryResult {
  const usage = entry.message.usage;
  const model = entry.message.model ?? 'unknown';

  const tokens: TokenBreakdown = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    total_tokens:
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
  };

  // Always calculate for compare mode
  const calc = calculateEntryCost(
    model,
    tokens.input_tokens,
    tokens.output_tokens,
    tokens.cache_write_tokens,
    tokens.cache_read_tokens,
    entry.costUSD,
  );

  const calculatedCost: CostBreakdown = {
    input_cost: calc.input,
    output_cost: calc.output,
    cache_write_cost: calc.cacheWrite,
    cache_read_cost: calc.cacheRead,
    total_cost: calc.total,
  };

  let cost: CostBreakdown;

  switch (mode) {
    case 'display':
      cost = {
        input_cost: 0,
        output_cost: 0,
        cache_write_cost: 0,
        cache_read_cost: 0,
        total_cost: entry.costUSD ?? 0,
      };
      break;

    case 'compare':
    case 'calculate':
    default:
      cost = calculatedCost;
      break;
  }

  return {
    tokens,
    cost,
    calculatedCost,
    displayCost: entry.costUSD,
  };
}

/**
 * Create an empty token breakdown.
 */
export function emptyTokens(): TokenBreakdown {
  return { input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };
}

/**
 * Create an empty cost breakdown.
 */
export function emptyCost(): CostBreakdown {
  return { input_cost: 0, output_cost: 0, cache_write_cost: 0, cache_read_cost: 0, total_cost: 0 };
}

/**
 * Accumulate tokens into a running total.
 */
export function addTokens(a: TokenBreakdown, b: TokenBreakdown): TokenBreakdown {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

/**
 * Accumulate costs into a running total.
 */
export function addCosts(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    input_cost: a.input_cost + b.input_cost,
    output_cost: a.output_cost + b.output_cost,
    cache_write_cost: a.cache_write_cost + b.cache_write_cost,
    cache_read_cost: a.cache_read_cost + b.cache_read_cost,
    total_cost: a.total_cost + b.total_cost,
  };
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;
  const { setPricingData } = await import('./pricing.js');

  const testPricing = {
    version: 'test',
    models: {
      'claude-sonnet-4-20250514': {
        input_cost_per_million: 3.0,
        output_cost_per_million: 15.0,
        cache_creation_cost_per_million: 3.75,
        cache_read_cost_per_million: 0.30,
        context_window: 200000,
      },
    },
    aliases: {},
  };

  beforeEach(() => {
    setPricingData(testPricing);
  });

  const makeEntry = (overrides: Partial<UsageEntry> = {}): UsageEntry => ({
    timestamp: '2025-03-25T10:00:00Z',
    message: {
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      },
    },
    ...overrides,
  });

  describe('processEntry', () => {
    it('extracts correct token breakdown', () => {
      const result = processEntry(makeEntry());
      expect(result.tokens.input_tokens).toBe(1000);
      expect(result.tokens.output_tokens).toBe(500);
      expect(result.tokens.cache_write_tokens).toBe(200);
      expect(result.tokens.cache_read_tokens).toBe(300);
      expect(result.tokens.total_tokens).toBe(2000);
    });

    it('calculates cost in calculate mode', () => {
      const result = processEntry(makeEntry(), 'calculate');
      expect(result.cost.input_cost).toBeCloseTo(1000 * (3.0 / 1_000_000), 10);
      expect(result.cost.output_cost).toBeCloseTo(500 * (15.0 / 1_000_000), 10);
      expect(result.cost.cache_write_cost).toBeCloseTo(200 * (3.75 / 1_000_000), 10);
      expect(result.cost.cache_read_cost).toBeCloseTo(300 * (0.30 / 1_000_000), 10);
    });

    it('uses embedded cost in display mode', () => {
      const result = processEntry(makeEntry({ costUSD: 0.42 }), 'display');
      expect(result.cost.total_cost).toBe(0.42);
      expect(result.cost.input_cost).toBe(0);
    });

    it('uses 0 in display mode when no embedded cost', () => {
      const result = processEntry(makeEntry(), 'display');
      expect(result.cost.total_cost).toBe(0);
    });

    it('provides both calculated and display costs in compare mode data', () => {
      const entry = makeEntry({ costUSD: 0.42 });
      const result = processEntry(entry, 'compare');
      expect(result.calculatedCost.total_cost).toBeGreaterThan(0);
      expect(result.displayCost).toBe(0.42);
    });
  });

  describe('addTokens', () => {
    it('sums token breakdowns', () => {
      const a = { input_tokens: 10, output_tokens: 5, cache_write_tokens: 2, cache_read_tokens: 3, total_tokens: 20 };
      const b = { input_tokens: 20, output_tokens: 10, cache_write_tokens: 4, cache_read_tokens: 6, total_tokens: 40 };
      const result = addTokens(a, b);
      expect(result.input_tokens).toBe(30);
      expect(result.output_tokens).toBe(15);
      expect(result.total_tokens).toBe(60);
    });
  });

  describe('addCosts', () => {
    it('sums cost breakdowns', () => {
      const a = { input_cost: 1, output_cost: 2, cache_write_cost: 0.5, cache_read_cost: 0.1, total_cost: 3.6 };
      const b = { input_cost: 3, output_cost: 4, cache_write_cost: 1.5, cache_read_cost: 0.2, total_cost: 8.7 };
      const result = addCosts(a, b);
      expect(result.input_cost).toBe(4);
      expect(result.total_cost).toBeCloseTo(12.3, 6);
    });
  });

  describe('processEntry with missing model', () => {
    it('returns zero cost when model is undefined', () => {
      const entry = makeEntry({
        message: {
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      });
      const result = processEntry(entry);
      expect(result.cost.total_cost).toBe(0);
      expect(result.tokens.input_tokens).toBe(100);
    });
  });

  describe('emptyTokens and emptyCost', () => {
    it('emptyTokens returns all zeros', () => {
      const t = emptyTokens();
      expect(t.input_tokens).toBe(0);
      expect(t.output_tokens).toBe(0);
      expect(t.cache_write_tokens).toBe(0);
      expect(t.cache_read_tokens).toBe(0);
      expect(t.total_tokens).toBe(0);
    });

    it('emptyCost returns all zeros', () => {
      const c = emptyCost();
      expect(c.input_cost).toBe(0);
      expect(c.output_cost).toBe(0);
      expect(c.cache_write_cost).toBe(0);
      expect(c.cache_read_cost).toBe(0);
      expect(c.total_cost).toBe(0);
    });
  });
}
