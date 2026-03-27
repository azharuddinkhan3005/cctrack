import type { UsageEntry, CostMode, BurnRate, BudgetConfig } from './types.js';
import { processEntry } from './calculator.js';

/**
 * Calculate burn rates from usage entries.
 * Derives hourly, daily, and projected monthly costs from the time span of entries.
 */
export function calculateBurnRate(
  entries: UsageEntry[],
  mode: CostMode,
  budget?: BudgetConfig,
): BurnRate {
  if (entries.length === 0) {
    return {
      hourly_cost: 0,
      daily_cost: 0,
      projected_monthly: 0,
      hours_analyzed: 0,
      insufficient_data: true,
    };
  }

  // Sort by timestamp to find first and last
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const firstTime = new Date(sorted[0].timestamp).getTime();
  const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();

  // Calculate total cost
  let totalCost = 0;
  for (const entry of sorted) {
    const result = processEntry(entry, mode);
    totalCost += result.cost.total_cost;
  }

  const spanMs = lastTime - firstTime;
  const spanHours = Math.max(spanMs / (1000 * 60 * 60), 1); // Minimum 1 hour to avoid division spikes

  const hourly_cost = totalCost / spanHours;

  // If more than 24 hours of data, use actual daily average
  const spanDays = spanHours / 24;
  const daily_cost = spanDays >= 1 ? totalCost / spanDays : hourly_cost * 24;

  const projected_monthly = daily_cost * 30;

  const result: BurnRate = {
    hourly_cost,
    daily_cost,
    projected_monthly,
    hours_analyzed: spanHours,
    insufficient_data: spanMs < 60 * 60 * 1000, // less than 1 hour of data
  };

  // Calculate time until budget exhausted if budget provided
  if (budget?.monthly !== undefined && hourly_cost > 0) {
    const remaining = budget.monthly - totalCost;
    if (remaining <= 0) {
      result.time_until_budget_exhausted_ms = 0;
    } else {
      result.time_until_budget_exhausted_ms = (remaining / hourly_cost) * 60 * 60 * 1000;
    }
  }

  return result;
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
        cache_read_cost_per_million: 0.3,
        context_window: 200000,
      },
    },
    aliases: {},
  };

  beforeEach(() => {
    setPricingData(testPricing);
  });

  const { makeEntry } = await import('./test-helpers.js');

  describe('calculateBurnRate', () => {
    it('returns zero rates for zero entries', () => {
      const result = calculateBurnRate([], 'calculate');
      expect(result.hourly_cost).toBe(0);
      expect(result.daily_cost).toBe(0);
      expect(result.projected_monthly).toBe(0);
      expect(result.hours_analyzed).toBe(0);
      expect(result.time_until_budget_exhausted_ms).toBeUndefined();
    });

    it('calculates burn rate with 1 hour of data', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T11:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate');

      expect(result.hours_analyzed).toBeCloseTo(1, 2);
      expect(result.hourly_cost).toBeGreaterThan(0);
      // With 1 hour of data (< 1 day), daily = hourly * 24
      expect(result.daily_cost).toBeCloseTo(result.hourly_cost * 24, 6);
      expect(result.projected_monthly).toBeCloseTo(result.daily_cost * 30, 6);
    });

    it('calculates burn rate with multiple days of data', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-26T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-27T10:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate');

      // Span is 48 hours = 2 days
      expect(result.hours_analyzed).toBeCloseTo(48, 2);
      // With > 1 day, daily = total / days
      const spanDays = result.hours_analyzed / 24;
      expect(spanDays).toBeGreaterThanOrEqual(1);

      // Verify projected monthly
      expect(result.projected_monthly).toBeCloseTo(result.daily_cost * 30, 6);
    });

    it('projected monthly calculation is accurate', () => {
      // Create exactly 24 hours of data with known cost
      const entries = [
        makeEntry({ timestamp: '2025-03-25T00:00:00Z' }),
        makeEntry({ timestamp: '2025-03-26T00:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate');

      // With exactly 1 day of data, daily_cost should be total cost / 1 day
      // projected_monthly should be daily * 30
      expect(result.projected_monthly).toBeCloseTo(result.daily_cost * 30, 6);
      expect(result.projected_monthly).toBeGreaterThan(0);
    });

    it('calculates time_until_budget_exhausted with budget config', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T11:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate', { monthly: 100 });

      expect(result.time_until_budget_exhausted_ms).toBeDefined();
      expect(result.time_until_budget_exhausted_ms!).toBeGreaterThan(0);
    });

    it('returns 0 exhaustion time when budget already exceeded', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T11:00:00Z' }),
      ];
      // Set budget to effectively 0
      const result = calculateBurnRate(entries, 'calculate', { monthly: 0 });

      expect(result.time_until_budget_exhausted_ms).toBe(0);
    });

    it('does not include exhaustion time without budget config', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T11:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate');

      expect(result.time_until_budget_exhausted_ms).toBeUndefined();
    });

    // --- New edge-case tests ---

    it('clamps to minimum 1 hour for a single entry (avoids infinite rates)', () => {
      const entries = [makeEntry({ timestamp: '2025-03-25T10:00:00Z' })];
      const result = calculateBurnRate(entries, 'calculate');

      expect(result.hours_analyzed).toBe(1);
      expect(Number.isFinite(result.hourly_cost)).toBe(true);
      expect(result.hourly_cost).toBeGreaterThan(0);
      // daily = hourly * 24 since span < 1 day
      expect(result.daily_cost).toBeCloseTo(result.hourly_cost * 24, 6);
    });

    it('hourly cost matches hand-calculated value', () => {
      // 2 entries over 2 hours, each: 1000 input + 500 output, no cache
      // Cost per entry: 1000*(3/1e6) + 500*(15/1e6) = 0.003 + 0.0075 = 0.0105
      // Total cost: 0.0105 * 2 = 0.021
      // Span: 2 hours => hourly = 0.021 / 2 = 0.0105
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T12:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate');

      expect(result.hourly_cost).toBeCloseTo(0.0105, 6);
      expect(result.hours_analyzed).toBeCloseTo(2, 2);
    });

    it('time_until_budget_exhausted_ms matches expected value', () => {
      // Hourly cost = 0.0105, total spent = 0.021, budget = $1.00
      // remaining = $0.979, hours = 0.979 / 0.0105 = 93.238...
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T12:00:00Z' }),
      ];
      const result = calculateBurnRate(entries, 'calculate', { monthly: 1.0 });

      const expectedHourly = 0.0105;
      const totalCost = 0.021;
      const remaining = 1.0 - totalCost;
      const expectedMs = (remaining / expectedHourly) * 60 * 60 * 1000;

      expect(result.time_until_budget_exhausted_ms).toBeDefined();
      expect(result.time_until_budget_exhausted_ms!).toBeCloseTo(expectedMs, -1);
      expect(result.time_until_budget_exhausted_ms!).toBeGreaterThan(0);
    });

    it('returns 0 exhaustion time when spending exceeds budget (realistic overspend)', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T12:00:00Z' }),
      ];
      // Total cost ~$0.021, budget $0.01 => already exceeded
      const result = calculateBurnRate(entries, 'calculate', { monthly: 0.01 });
      expect(result.time_until_budget_exhausted_ms).toBe(0);
    });

    it('handles unsorted entries correctly', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T12:00:00Z' }), // later first
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }), // earlier second
      ];
      const result = calculateBurnRate(entries, 'calculate');

      expect(result.hours_analyzed).toBeCloseTo(2, 2);
      expect(result.hourly_cost).toBeCloseTo(0.0105, 6);
    });

  });
}
