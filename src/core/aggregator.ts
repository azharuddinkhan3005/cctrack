import type {
  UsageEntry,
  CostMode,
  FilterOptions,
  DailyAggregate,
  MonthlyAggregate,
  SessionAggregate,
  ProjectAggregate,
  AggregatedEntry,
  DashboardData,
} from './types.js';
import { processEntry, emptyTokens, emptyCost, addTokens, addCosts } from './calculator.js';
import { getPricingVersion } from './pricing.js';
import { toDateString, toMonthString, getHourAndDay, isInRange } from '../utils/date.js';
import { extractProjectName } from '../utils/fs.js';

export function emptyAggregate(): AggregatedEntry {
  return { tokens: emptyTokens(), cost: emptyCost(), request_count: 0 };
}

export function accumulate(agg: AggregatedEntry, result: ReturnType<typeof processEntry>): void {
  agg.tokens = addTokens(agg.tokens, result.tokens);
  agg.cost = addCosts(agg.cost, result.cost);
  agg.request_count++;
}

/**
 * Filter entries by date range and project.
 */
export function filterEntries(entries: UsageEntry[], options: FilterOptions): UsageEntry[] {
  return entries.filter((e) => {
    if (!isInRange(e.timestamp, options.since, options.until)) return false;
    if (options.project) {
      if (!e.cwd) return false;
      const project = extractProjectName(e.cwd);
      if (!project.toLowerCase().includes(options.project.toLowerCase())) return false;
    }
    return true;
  });
}

/**
 * Aggregate entries by day.
 */
export function aggregateDaily(
  entries: UsageEntry[],
  mode: CostMode = 'calculate',
  timezone?: string,
): DailyAggregate[] {
  const map = new Map<string, DailyAggregate>();

  for (const entry of entries) {
    const date = toDateString(entry.timestamp, timezone);
    const model = entry.message.model ?? 'unknown';
    const project = entry.cwd ? extractProjectName(entry.cwd) : 'unknown';

    if (!map.has(date)) {
      map.set(date, { date, ...emptyAggregate(), models: {}, projects: {} });
    }
    const day = map.get(date)!;
    const result = processEntry(entry, mode);

    accumulate(day, result);

    if (!day.models[model]) day.models[model] = emptyAggregate();
    accumulate(day.models[model], result);

    if (!day.projects[project]) day.projects[project] = emptyAggregate();
    accumulate(day.projects[project], result);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Aggregate entries by month.
 */
export function aggregateMonthly(
  entries: UsageEntry[],
  mode: CostMode = 'calculate',
  timezone?: string,
): MonthlyAggregate[] {
  const map = new Map<string, MonthlyAggregate>();

  for (const entry of entries) {
    const month = toMonthString(entry.timestamp, timezone);
    const model = entry.message.model ?? 'unknown';

    if (!map.has(month)) {
      map.set(month, { month, ...emptyAggregate(), models: {} });
    }
    const m = map.get(month)!;
    const result = processEntry(entry, mode);

    accumulate(m, result);

    if (!m.models[model]) m.models[model] = emptyAggregate();
    accumulate(m.models[model], result);
  }

  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Aggregate entries by session.
 */
export function aggregateSessions(
  entries: UsageEntry[],
  mode: CostMode = 'calculate',
): SessionAggregate[] {
  const map = new Map<string, SessionAggregate>();

  for (const entry of entries) {
    const sid = entry.sessionId ?? 'unknown';
    const model = entry.message.model ?? 'unknown';
    const project = entry.cwd ? extractProjectName(entry.cwd) : 'unknown';

    if (!map.has(sid)) {
      map.set(sid, {
        sessionId: sid,
        project,
        startTime: entry.timestamp,
        endTime: entry.timestamp,
        primaryModel: model,
        ...emptyAggregate(),
        models: {},
      });
    }
    const session = map.get(sid)!;
    const result = processEntry(entry, mode);

    accumulate(session, result);

    // Update time range
    if (entry.timestamp < session.startTime) session.startTime = entry.timestamp;
    if (entry.timestamp > session.endTime) session.endTime = entry.timestamp;

    // Track model usage for primary model detection
    if (!session.models[model]) session.models[model] = emptyAggregate();
    accumulate(session.models[model], result);

    // Primary model = most requests (incremental: compare current model against stored primary)
    const currentModelCount = session.models[model].request_count;
    const primaryCount = session.models[session.primaryModel]?.request_count ?? 0;
    if (currentModelCount >= primaryCount) {
      session.primaryModel = model;
    }
  }

  return [...map.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));
}

/**
 * Aggregate entries by project.
 */
export function aggregateProjects(
  entries: UsageEntry[],
  mode: CostMode = 'calculate',
): ProjectAggregate[] {
  const map = new Map<string, ProjectAggregate>();

  for (const entry of entries) {
    const project = entry.cwd ? extractProjectName(entry.cwd) : 'unknown';
    const model = entry.message.model ?? 'unknown';

    if (!map.has(project)) {
      map.set(project, { project, ...emptyAggregate(), models: {} });
    }
    const p = map.get(project)!;
    const result = processEntry(entry, mode);

    accumulate(p, result);

    if (!p.models[model]) p.models[model] = emptyAggregate();
    accumulate(p.models[model], result);
  }

  return [...map.values()].sort((a, b) => b.cost.total_cost - a.cost.total_cost);
}

/**
 * Aggregate entries by model.
 */
export function aggregateModels(
  entries: UsageEntry[],
  mode: CostMode = 'calculate',
): Record<string, AggregatedEntry> {
  const map: Record<string, AggregatedEntry> = {};

  for (const entry of entries) {
    const model = entry.message.model ?? 'unknown';
    if (!map[model]) map[model] = emptyAggregate();
    accumulate(map[model], processEntry(entry, mode));
  }

  return map;
}

/**
 * Build the usage heatmap (7 days × 24 hours).
 */
export function buildHeatmap(entries: UsageEntry[], timezone?: string): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);

  for (const entry of entries) {
    const { hour, day } = getHourAndDay(entry.timestamp, timezone);
    grid[day][hour] += entry.message.usage.input_tokens + entry.message.usage.output_tokens;
  }

  return grid;
}

/**
 * Build complete dashboard data in a SINGLE PASS over all entries.
 * Previously this was 8+ separate passes each calling processEntry.
 */
export function buildDashboardData(
  entries: UsageEntry[],
  mode: CostMode = 'calculate',
  timezone?: string,
): DashboardData {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // All aggregation buckets
  const totals = emptyAggregate();
  const dailyMap = new Map<string, DailyAggregate>();
  const monthlyMap = new Map<string, MonthlyAggregate>();
  const sessionMap = new Map<string, SessionAggregate>();
  const projectMap = new Map<string, ProjectAggregate>();
  const modelMap: Record<string, AggregatedEntry> = {};
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const projectHeatmaps: Record<string, number[][]> = {};

  // Single pass
  for (const entry of sorted) {
    const result = processEntry(entry, mode); // Called ONCE per entry
    const date = toDateString(entry.timestamp, timezone);
    const month = date.slice(0, 7);
    const model = entry.message.model ?? 'unknown';
    const sid = entry.sessionId ?? 'unknown';
    const project = entry.cwd ? extractProjectName(entry.cwd) : 'unknown';
    const { hour, day } = getHourAndDay(entry.timestamp, timezone);
    const tokens = entry.message.usage.input_tokens + entry.message.usage.output_tokens;

    // Totals
    accumulate(totals, result);

    // Daily
    if (!dailyMap.has(date)) dailyMap.set(date, { date, ...emptyAggregate(), models: {}, projects: {} });
    const d = dailyMap.get(date)!;
    accumulate(d, result);
    if (!d.models[model]) d.models[model] = emptyAggregate();
    accumulate(d.models[model], result);
    if (!d.projects[project]) d.projects[project] = emptyAggregate();
    accumulate(d.projects[project], result);

    // Monthly
    if (!monthlyMap.has(month)) monthlyMap.set(month, { month, ...emptyAggregate(), models: {} });
    const m = monthlyMap.get(month)!;
    accumulate(m, result);
    if (!m.models[model]) m.models[model] = emptyAggregate();
    accumulate(m.models[model], result);

    // Session
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, { sessionId: sid, project, startTime: entry.timestamp, endTime: entry.timestamp, primaryModel: model, ...emptyAggregate(), models: {} });
    }
    const sess = sessionMap.get(sid)!;
    accumulate(sess, result);
    if (entry.timestamp < sess.startTime) sess.startTime = entry.timestamp;
    if (entry.timestamp > sess.endTime) sess.endTime = entry.timestamp;
    if (!sess.models[model]) sess.models[model] = emptyAggregate();
    accumulate(sess.models[model], result);
    const currentCount = sess.models[model].request_count;
    const primaryCount = sess.models[sess.primaryModel]?.request_count ?? 0;
    if (currentCount >= primaryCount) sess.primaryModel = model;

    // Project
    if (!projectMap.has(project)) projectMap.set(project, { project, ...emptyAggregate(), models: {} });
    const p = projectMap.get(project)!;
    accumulate(p, result);
    if (!p.models[model]) p.models[model] = emptyAggregate();
    accumulate(p.models[model], result);

    // Model
    if (!modelMap[model]) modelMap[model] = emptyAggregate();
    accumulate(modelMap[model], result);

    // Heatmap
    heatmap[day][hour] += tokens;

    // Project heatmap
    if (!projectHeatmaps[project]) {
      projectHeatmaps[project] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    }
    projectHeatmaps[project][day][hour] += tokens;
  }

  return {
    generated_at: new Date().toISOString(),
    date_range: {
      start: sorted[0]?.timestamp ?? '',
      end: sorted[sorted.length - 1]?.timestamp ?? '',
    },
    totals,
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    monthly: [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    sessions: [...sessionMap.values()].sort((a, b) => b.startTime.localeCompare(a.startTime)),
    projects: [...projectMap.values()].sort((a, b) => b.cost.total_cost - a.cost.total_cost),
    models: modelMap,
    heatmap,
    project_heatmaps: projectHeatmaps,
    pricing_version: getPricingVersion(),
  };
}

/**
 * Build per-project heatmaps.
 */
export function buildProjectHeatmaps(
  entries: UsageEntry[],
  timezone?: string,
): Record<string, number[][]> {
  const maps: Record<string, number[][]> = {};

  for (const entry of entries) {
    const project = entry.cwd ? extractProjectName(entry.cwd) : 'unknown';
    if (!maps[project]) {
      maps[project] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    }
    const { hour, day } = getHourAndDay(entry.timestamp, timezone);
    maps[project][day][hour] += entry.message.usage.input_tokens + entry.message.usage.output_tokens;
  }

  return maps;
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

  const { makeEntry } = await import('./test-helpers.js');

  describe('aggregateDaily', () => {
    it('groups entries by date', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T14:00:00Z' }),
        makeEntry({ timestamp: '2025-03-26T10:00:00Z' }),
      ];
      const result = aggregateDaily(entries);
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2025-03-25');
      expect(result[0].request_count).toBe(2);
      expect(result[1].date).toBe('2025-03-26');
    });

    it('tracks per-model breakdown', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({
          timestamp: '2025-03-25T11:00:00Z',
          message: {
            model: 'other-model',
            usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        }),
      ];
      const result = aggregateDaily(entries);
      expect(Object.keys(result[0].models)).toHaveLength(2);
    });

    it('respects timezone for date grouping', () => {
      // 2025-03-25T23:00:00Z = March 26 in UTC+5
      const entries = [makeEntry({ timestamp: '2025-03-25T23:00:00Z' })];
      const result = aggregateDaily(entries, 'calculate', 'Asia/Kolkata');
      expect(result[0].date).toBe('2025-03-26');
    });
  });

  describe('aggregateSessions', () => {
    it('groups entries by sessionId', () => {
      const entries = [
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T10:05:00Z' }),
        makeEntry({ sessionId: 's2', timestamp: '2025-03-25T11:00:00Z' }),
      ];
      const result = aggregateSessions(entries);
      expect(result).toHaveLength(2);
    });

    it('tracks session time range', () => {
      const entries = [
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T10:30:00Z' }),
      ];
      const result = aggregateSessions(entries);
      expect(result[0].startTime).toBe('2025-03-25T10:00:00Z');
      expect(result[0].endTime).toBe('2025-03-25T10:30:00Z');
    });
  });

  describe('buildHeatmap', () => {
    it('creates 7×24 grid', () => {
      const heatmap = buildHeatmap([]);
      expect(heatmap).toHaveLength(7);
      expect(heatmap[0]).toHaveLength(24);
    });

    it('accumulates tokens in correct cell', () => {
      // 2025-03-25 is a Tuesday (day=2), 10:00 UTC
      const entries = [makeEntry({ timestamp: '2025-03-25T10:00:00Z' })];
      const heatmap = buildHeatmap(entries);
      expect(heatmap[2][10]).toBe(1500); // 1000 input + 500 output
    });
  });

  describe('aggregateMonthly', () => {
    it('groups entries by month', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-26T10:00:00Z' }),
        makeEntry({ timestamp: '2025-04-01T10:00:00Z' }),
      ];
      const result = aggregateMonthly(entries);
      expect(result).toHaveLength(2);
      expect(result[0].month).toBe('2025-03');
      expect(result[0].request_count).toBe(2);
      expect(result[1].month).toBe('2025-04');
      expect(result[1].request_count).toBe(1);
    });

    it('tracks per-model breakdown in monthly', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({
          timestamp: '2025-03-25T11:00:00Z',
          message: {
            model: 'other-model',
            usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        }),
      ];
      const result = aggregateMonthly(entries);
      expect(Object.keys(result[0].models)).toHaveLength(2);
    });
  });

  describe('aggregateProjects', () => {
    it('groups entries by project (cwd)', () => {
      const entries = [
        makeEntry({ cwd: '/home/.claude/projects/-Users-me-proj1/session.jsonl' }),
        makeEntry({ cwd: '/home/.claude/projects/-Users-me-proj1/session.jsonl' }),
        makeEntry({ cwd: '/home/.claude/projects/-Users-me-proj2/session.jsonl' }),
      ];
      const result = aggregateProjects(entries);
      expect(result).toHaveLength(2);
    });

    it('sorts by cost descending', () => {
      const entries = [
        makeEntry({ cwd: '/home/.claude/projects/cheap/f.jsonl', message: { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
        makeEntry({ cwd: '/home/.claude/projects/expensive/f.jsonl', message: { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100000, output_tokens: 50000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
      ];
      const result = aggregateProjects(entries);
      expect(result[0].cost.total_cost).toBeGreaterThan(result[1].cost.total_cost);
    });

    it('uses unknown for entries without cwd', () => {
      const entries = [makeEntry()];
      const result = aggregateProjects(entries);
      expect(result[0].project).toBe('unknown');
    });
  });

  describe('aggregateModels', () => {
    it('groups entries by model name', () => {
      const entries = [
        makeEntry(),
        makeEntry({
          message: {
            model: 'other-model',
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        }),
      ];
      const result = aggregateModels(entries);
      expect(Object.keys(result)).toHaveLength(2);
      expect(result['claude-sonnet-4-20250514']).toBeDefined();
      expect(result['other-model']).toBeDefined();
    });

    it('uses unknown for entries without model', () => {
      const entries = [
        makeEntry({
          message: {
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        }),
      ];
      const result = aggregateModels(entries);
      expect(result['unknown']).toBeDefined();
    });
  });

  describe('aggregateSessions (extended)', () => {
    it('detects primary model by request count', () => {
      const entries = [
        makeEntry({ sessionId: 's1' }),
        makeEntry({ sessionId: 's1' }),
        makeEntry({
          sessionId: 's1',
          message: {
            model: 'other-model',
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        }),
      ];
      const result = aggregateSessions(entries);
      expect(result[0].primaryModel).toBe('claude-sonnet-4-20250514');
    });

    it('uses unknown sessionId when missing', () => {
      const entries = [makeEntry()];
      const result = aggregateSessions(entries);
      expect(result[0].sessionId).toBe('unknown');
    });

    it('sorts sessions by startTime descending (newest first)', () => {
      const entries = [
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T08:00:00Z' }),
        makeEntry({ sessionId: 's2', timestamp: '2025-03-25T12:00:00Z' }),
      ];
      const result = aggregateSessions(entries);
      expect(result[0].sessionId).toBe('s2');
      expect(result[1].sessionId).toBe('s1');
    });
  });

  describe('buildDashboardData', () => {
    it('returns all required fields', () => {
      const entries = [
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T11:00:00Z' }),
      ];
      const data = buildDashboardData(entries);
      expect(data.generated_at).toBeTruthy();
      expect(data.date_range.start).toBe('2025-03-25T10:00:00Z');
      expect(data.date_range.end).toBe('2025-03-25T11:00:00Z');
      expect(data.totals.request_count).toBe(2);
      expect(data.daily).toHaveLength(1);
      expect(data.monthly).toHaveLength(1);
      expect(data.sessions).toHaveLength(1);
      expect(data.heatmap).toHaveLength(7);
      expect(Object.keys(data.models)).toHaveLength(1);
    });

    it('handles empty entries', () => {
      const data = buildDashboardData([]);
      expect(data.totals.request_count).toBe(0);
      expect(data.daily).toHaveLength(0);
      expect(data.date_range.start).toBe('');
    });
  });

  describe('filterEntries', () => {
    it('filters by date range', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-24T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-26T10:00:00Z' }),
      ];
      const result = filterEntries(entries, { since: '2025-03-25', until: '2025-03-25' });
      expect(result).toHaveLength(1);
    });

    it('returns all entries with no filters', () => {
      const entries = [makeEntry(), makeEntry()];
      expect(filterEntries(entries, {})).toHaveLength(2);
    });

    it('filters by since only', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-24T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
      ];
      expect(filterEntries(entries, { since: '2025-03-25' })).toHaveLength(1);
    });

    it('filters by until only', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-24T10:00:00Z' }),
        makeEntry({ timestamp: '2025-03-25T10:00:00Z' }),
      ];
      expect(filterEntries(entries, { until: '2025-03-24' })).toHaveLength(1);
    });

    it('filters by project name (case-insensitive substring)', () => {
      const entries = [
        makeEntry({ cwd: 'tradeforge' }),
        makeEntry({ cwd: 'cctrack' }),
        makeEntry({ cwd: 'TradeForge' }),
      ];
      const result = filterEntries(entries, { project: 'trade' });
      expect(result).toHaveLength(2);
    });

    it('excludes entries without cwd when project filter is set', () => {
      const entries = [makeEntry(), makeEntry({ cwd: 'cctrack' })];
      expect(filterEntries(entries, { project: 'cctrack' })).toHaveLength(1);
    });
  });

  describe('aggregateDaily (project breakdown)', () => {
    it('tracks per-project breakdown in daily', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z', cwd: 'proj-a' }),
        makeEntry({ timestamp: '2025-03-25T11:00:00Z', cwd: 'proj-b' }),
      ];
      const result = aggregateDaily(entries);
      expect(Object.keys(result[0].projects)).toHaveLength(2);
      expect(result[0].projects['proj-a'].request_count).toBe(1);
      expect(result[0].projects['proj-b'].request_count).toBe(1);
    });

    it('per-project daily data has complete cost and token fields', () => {
      const entries = [makeEntry({ timestamp: '2025-03-25T10:00:00Z', cwd: 'proj-a' })];
      const result = aggregateDaily(entries);
      const projData = result[0].projects['proj-a'];

      // Must have request_count (needed for Cost Per Request ROI metric)
      expect(projData.request_count).toBe(1);

      // Must have all cost fields (needed for Cache Savings ROI metric)
      expect(projData.cost.input_cost).toBeDefined();
      expect(projData.cost.output_cost).toBeDefined();
      expect(projData.cost.cache_write_cost).toBeDefined();
      expect(projData.cost.cache_read_cost).toBeDefined();
      expect(projData.cost.total_cost).toBeDefined();
      expect(typeof projData.cost.cache_read_cost).toBe('number');

      // Must have all token fields
      expect(projData.tokens.input_tokens).toBeDefined();
      expect(projData.tokens.output_tokens).toBeDefined();
      expect(projData.tokens.cache_write_tokens).toBeDefined();
      expect(projData.tokens.cache_read_tokens).toBeDefined();
      expect(projData.tokens.total_tokens).toBeDefined();
    });

    it('per-project data produces non-zero ROI when summed (catches the $0.00 bug)', () => {
      const entries = [
        makeEntry({ timestamp: '2025-03-25T10:00:00Z', cwd: 'proj-a' }),
        makeEntry({ timestamp: '2025-03-25T11:00:00Z', cwd: 'proj-a' }),
        makeEntry({ timestamp: '2025-03-25T12:00:00Z', cwd: 'proj-b' }),
      ];
      const result = aggregateDaily(entries);
      const projA = result[0].projects['proj-a'];

      // Simulate what the dashboard does: sum per-project daily data for ROI
      const totalCost = projA.cost.total_cost;
      const totalReqs = projA.request_count;
      const cacheReadCost = projA.cost.cache_read_cost;

      const costPerReq = totalReqs > 0 ? totalCost / totalReqs : 0;
      const cacheSavings = cacheReadCost * 9;

      // These must NOT be zero (the bug that was caught)
      expect(totalReqs).toBe(2);
      expect(costPerReq).toBeGreaterThan(0);
      // cache_read_cost is 0 for test data with 0 cache tokens, but the field must exist
      expect(typeof cacheReadCost).toBe('number');
    });
  });

  describe('buildProjectHeatmaps', () => {
    it('creates separate heatmaps per project', () => {
      const entries = [
        makeEntry({ cwd: 'proj-a', timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ cwd: 'proj-b', timestamp: '2025-03-25T14:00:00Z' }),
      ];
      const maps = buildProjectHeatmaps(entries);
      expect(Object.keys(maps)).toHaveLength(2);
      expect(maps['proj-a']).toHaveLength(7);
      expect(maps['proj-a'][2][10]).toBe(1500); // Tuesday 10:00, 1000+500 tokens
    });

    it('returns empty object for no entries', () => {
      expect(buildProjectHeatmaps([])).toEqual({});
    });
  });

  describe('buildDashboardData (single-pass)', () => {
    it('includes project_heatmaps', () => {
      const entries = [makeEntry({ cwd: 'proj-a', sessionId: 's1', timestamp: '2025-03-25T10:00:00Z' })];
      const data = buildDashboardData(entries);
      expect(data.project_heatmaps).toBeDefined();
      expect(data.project_heatmaps!['proj-a']).toHaveLength(7);
    });

    it('produces consistent totals across aggregations', () => {
      const entries = [
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T10:00:00Z' }),
        makeEntry({ sessionId: 's1', timestamp: '2025-03-25T11:00:00Z' }),
        makeEntry({ sessionId: 's2', timestamp: '2025-03-26T10:00:00Z' }),
      ];
      const data = buildDashboardData(entries);
      expect(data.totals.request_count).toBe(3);
      expect(data.daily.reduce((s, d) => s + d.request_count, 0)).toBe(3);
      expect(data.sessions.reduce((s, d) => s + d.request_count, 0)).toBe(3);
    });
  });
}
