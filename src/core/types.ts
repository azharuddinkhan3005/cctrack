import { z } from 'zod/v4';

// === JSONL Entry Schema ===

export const UsageEntrySchema = z.object({
  timestamp: z.string().datetime(),
  sessionId: z.string().optional(),
  version: z.string().optional(),
  cwd: z.string().optional(),
  message: z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().optional().default(0),
      cache_read_input_tokens: z.number().optional().default(0),
      speed: z.enum(['standard', 'fast']).optional(),
    }),
    content: z.array(z.object({ text: z.string().optional() })).optional(),
  }),
  costUSD: z.number().optional(),
  requestId: z.string().optional(),
  isApiErrorMessage: z.boolean().optional(),
});

export type UsageEntry = z.infer<typeof UsageEntrySchema>;

// === Pricing Types ===

export interface ModelPricing {
  input_cost_per_million: number;
  output_cost_per_million: number;
  cache_creation_cost_per_million: number;
  cache_read_cost_per_million: number;
  input_cost_per_million_above_200k?: number;
  output_cost_per_million_above_200k?: number;
  cache_creation_cost_per_million_above_200k?: number;
  cache_read_cost_per_million_above_200k?: number;
  context_window: number;
  max_output?: number;
}

export interface PricingData {
  version: string;
  models: Record<string, ModelPricing>;
  aliases: Record<string, string>;
}

// === Aggregation Types ===

export interface TokenBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
}

export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  cache_write_cost: number;
  cache_read_cost: number;
  total_cost: number;
}

export interface AggregatedEntry {
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  request_count: number;
}

export interface DailyAggregate extends AggregatedEntry {
  date: string; // YYYY-MM-DD
  models: Record<string, AggregatedEntry>;
  projects: Record<string, AggregatedEntry>;
}

export interface MonthlyAggregate extends AggregatedEntry {
  month: string; // YYYY-MM
  models: Record<string, AggregatedEntry>;
}

export interface SessionAggregate extends AggregatedEntry {
  sessionId: string;
  project: string;
  startTime: string;
  endTime: string;
  primaryModel: string;
  models: Record<string, AggregatedEntry>;
}

export interface ProjectAggregate extends AggregatedEntry {
  project: string;
  models: Record<string, AggregatedEntry>;
}

// === CLI Types ===

export type CostMode = 'calculate' | 'display' | 'compare';
// OutputFormat removed — unused
export type SubscriptionPlan = 'pro' | 'max5' | 'max20';

export const PLAN_COSTS: Record<SubscriptionPlan, number> = {
  pro: 20,
  max5: 100,
  max20: 200,
};

export interface FilterOptions {
  since?: string;
  until?: string;
  project?: string;
  timezone?: string;
}

// === Block Types (5-hour rolling windows) ===

export const BLOCK_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours in ms

export interface BlockAggregate extends AggregatedEntry {
  block_start: string;
  block_end: string;
  block_index: number;
  is_current: boolean;
  time_remaining_ms: number;
  models: Record<string, AggregatedEntry>;
}

// === Burn Rate Types ===

export interface BurnRate {
  hourly_cost: number;
  daily_cost: number;
  projected_monthly: number;
  hours_analyzed: number;
  insufficient_data: boolean; // true when span < 1 hour (projections unreliable)
  time_until_budget_exhausted_ms?: number; // undefined if no budget set
}

// === Budget Types ===

export type BudgetLevel = 'safe' | 'warning' | 'critical' | 'exceeded';

export interface BudgetConfig {
  daily?: number;
  monthly?: number;
  block?: number; // per 5-hour block
}

export interface BudgetStatus {
  level: BudgetLevel;
  budget: number;
  spent: number;
  remaining: number;
  percentage: number;
}

export const BUDGET_THRESHOLDS: Record<BudgetLevel, number> = {
  safe: 0,
  warning: 50,
  critical: 80,
  exceeded: 100,
};

// === Rate Limit Types ===

export interface RateLimitWindow {
  used_percentage: number; // 0-100 from Anthropic
  resets_at: number; // Unix timestamp
}

export interface ExtraUsage {
  is_enabled: boolean;
  spent: number; // dollars spent
  limit: number; // dollar limit
  utilization: number; // 0-100
  resets_at: number;
}

export interface RateLimitData {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
  seven_day_sonnet?: RateLimitWindow;
  seven_day_opus?: RateLimitWindow;
  extra_usage?: ExtraUsage;
  source: 'statusline' | 'oauth' | 'estimated';
  captured_at: string;
}

// === Statusline Types ===

export interface StatuslineData {
  today_cost: number;
  session_cost: number;
  model: string;
  total_tokens: number;
  block_percentage: number;
  block_remaining: string;
  budget_level: BudgetLevel;
  rate_limits?: RateLimitData;
  updated_at: string;
}

// === Dashboard Types ===

export interface DashboardData {
  generated_at: string;
  date_range: { start: string; end: string };
  totals: AggregatedEntry;
  daily: DailyAggregate[];
  monthly: MonthlyAggregate[];
  sessions: SessionAggregate[];
  projects: ProjectAggregate[];
  models: Record<string, AggregatedEntry>;
  heatmap: number[][]; // 7×24 grid: day_of_week × hour_of_day
  project_heatmaps?: Record<string, number[][]>;
  burn_rate?: BurnRate;
  blocks?: BlockAggregate[];
  budget?: BudgetStatus;
}
