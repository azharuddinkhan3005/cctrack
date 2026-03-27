import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageEntry } from './types.js';

const DATA_DIR = join(homedir(), '.cctrack');
const EVENTS_FILE = join(DATA_DIR, 'rate-events.jsonl');
const MODEL_FILE = join(DATA_DIR, 'rate-model.json');

// 5-hour window in ms
const WINDOW_MS = 5 * 60 * 60 * 1000;

// === Rate Limit Event (calibration point) ===

export interface RateLimitEvent {
  timestamp: string;
  model: string;
  tokens_in_window: number; // total tokens consumed in the 5h window before hitting the limit
  input_tokens_in_window: number; // input tokens only (cache_read doesn't count toward limits)
  reset_time?: string; // parsed from error message
  content?: string; // raw error text
}

// === Learned Model ===

export interface LearnedLimits {
  /** Estimated 5-hour token limit (input + cache_creation, excluding cache_read) */
  estimated_limit: number;
  /** How confident we are (0-1), based on number of calibration events */
  confidence: number;
  /** Number of calibration events used */
  sample_count: number;
  /** Last calibration timestamp */
  last_calibration: string;
  /** EMA alpha (higher = more weight on recent events) */
  alpha: number;
}

export interface RateModelState {
  limits: Record<string, LearnedLimits>; // keyed by model family (opus, sonnet, etc.)
  updated_at: string;
}

// === Core Functions ===

/**
 * Load the learned rate model from disk.
 */
export function loadModel(): RateModelState {
  try {
    if (existsSync(MODEL_FILE)) {
      return JSON.parse(readFileSync(MODEL_FILE, 'utf-8'));
    }
  } catch {}
  return { limits: {}, updated_at: new Date().toISOString() };
}

/**
 * Save the learned rate model to disk.
 */
function saveModel(model: RateModelState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  model.updated_at = new Date().toISOString();
  writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2), 'utf-8');
}

/**
 * Extract model family from a full model name.
 * claude-opus-4-6-20260205 → opus
 * claude-sonnet-4-20250514 → sonnet
 */
function modelFamily(model: string): string {
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return 'unknown';
}

/**
 * Record a calibration event: we hit the rate limit.
 * This is called by the parser when it finds a rate limit error in JSONL.
 */
export function recordCalibration(event: RateLimitEvent): void {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf-8');

  // Update the EMA model
  const model = loadModel();
  const family = modelFamily(event.model);
  const alpha = 0.3; // EMA weight: 30% new, 70% historical

  if (!model.limits[family]) {
    model.limits[family] = {
      estimated_limit: event.input_tokens_in_window,
      confidence: 0.3,
      sample_count: 1,
      last_calibration: event.timestamp,
      alpha,
    };
  } else {
    const prev = model.limits[family];
    // Exponential Moving Average: new_estimate = alpha * new_value + (1 - alpha) * old_estimate
    prev.estimated_limit = alpha * event.input_tokens_in_window + (1 - alpha) * prev.estimated_limit;
    prev.sample_count++;
    prev.confidence = Math.min(1 - (1 / (prev.sample_count + 1)), 0.95); // approaches 0.95 asymptotically
    prev.last_calibration = event.timestamp;
  }

  saveModel(model);
}

/**
 * Load all calibration events from disk.
 */
export function loadEvents(): RateLimitEvent[] {
  try {
    if (!existsSync(EVENTS_FILE)) return [];
    return readFileSync(EVENTS_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Calculate current consumption in the rolling 5-hour window.
 * Only counts input_tokens + cache_creation_input_tokens (not cache_read — those don't count toward limits).
 */
export function currentWindowConsumption(entries: UsageEntry[]): {
  billable_tokens: number;
  total_tokens: number;
  requests: number;
  window_start: Date;
} {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MS);

  let billable = 0;
  let total = 0;
  let requests = 0;

  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp).getTime();
    if (entryTime < windowStart.getTime()) continue;
    if (entryTime > now) continue;

    const usage = entry.message.usage;
    // Billable = input + cache_creation (cache_read is free toward limits)
    billable += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0);
    total += usage.input_tokens + usage.output_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    requests++;
  }

  return { billable_tokens: billable, total_tokens: total, requests, window_start: windowStart };
}

/**
 * Predict current utilization and time-to-limit.
 */
export interface RatePrediction {
  /** Current model family being predicted for */
  model_family: string;
  /** Estimated utilization percentage (0-100) */
  estimated_utilization: number;
  /** How confident we are in this estimate */
  confidence: number;
  /** Estimated limit (billable tokens in 5h window) */
  estimated_limit: number;
  /** Current billable tokens consumed in window */
  current_consumption: number;
  /** Minutes until estimated limit at current burn rate, null if not enough data */
  minutes_to_limit: number | null;
  /** Number of calibration events this estimate is based on */
  calibration_events: number;
  /** Source of estimate */
  source: 'calibrated' | 'uncalibrated';
}

export function predictUtilization(entries: UsageEntry[], primaryModel: string): RatePrediction {
  const family = modelFamily(primaryModel);
  const model = loadModel();
  const learned = model.limits[family];

  const consumption = currentWindowConsumption(entries);

  // If we have calibration data, use it
  if (learned && learned.sample_count > 0) {
    const utilization = (consumption.billable_tokens / learned.estimated_limit) * 100;

    // Calculate burn rate and time to limit
    const elapsedMs = Date.now() - consumption.window_start.getTime();
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    let minutesToLimit: number | null = null;

    if (elapsedHours > 0.1 && consumption.billable_tokens > 0) {
      const hourlyRate = consumption.billable_tokens / elapsedHours;
      const remaining = learned.estimated_limit - consumption.billable_tokens;
      if (remaining > 0 && hourlyRate > 0) {
        minutesToLimit = Math.round((remaining / hourlyRate) * 60);
      } else {
        minutesToLimit = 0;
      }
    }

    return {
      model_family: family,
      estimated_utilization: Math.min(Math.round(utilization * 10) / 10, 100),
      confidence: learned.confidence,
      estimated_limit: Math.round(learned.estimated_limit),
      current_consumption: consumption.billable_tokens,
      minutes_to_limit: minutesToLimit,
      calibration_events: learned.sample_count,
      source: 'calibrated',
    };
  }

  // No calibration data — return what we know
  return {
    model_family: family,
    estimated_utilization: 0,
    confidence: 0,
    estimated_limit: 0,
    current_consumption: consumption.billable_tokens,
    minutes_to_limit: null,
    calibration_events: 0,
    source: 'uncalibrated',
  };
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { makeEntry } = await import('./test-helpers.js');

  describe('modelFamily', () => {
    it('extracts opus', () => expect(modelFamily('claude-opus-4-6-20260205')).toBe('opus'));
    it('extracts sonnet', () => expect(modelFamily('claude-sonnet-4-20250514')).toBe('sonnet'));
    it('extracts haiku', () => expect(modelFamily('claude-haiku-4-5-20251001')).toBe('haiku'));
    it('returns unknown for unrecognized', () => expect(modelFamily('gpt-4')).toBe('unknown'));
  });

  describe('currentWindowConsumption', () => {
    it('counts only entries in last 5 hours', () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 60000).toISOString(); // 1 min ago
      const old = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(); // 6h ago

      const entries = [
        makeEntry({ timestamp: recent }),
        makeEntry({ timestamp: old }),
      ];
      const result = currentWindowConsumption(entries);
      expect(result.requests).toBe(1); // only the recent one
    });

    it('billable tokens exclude cache_read', () => {
      const now = new Date();
      const ts = new Date(now.getTime() - 60000).toISOString();
      const entries = [
        makeEntry({
          timestamp: ts,
          message: {
            model: 'claude-opus-4-6',
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 5000 },
          },
        }),
      ];
      const result = currentWindowConsumption(entries);
      // billable = input(100) + cache_creation(200) = 300 (NOT cache_read 5000)
      expect(result.billable_tokens).toBe(300);
    });

    it('returns zero for empty entries', () => {
      const result = currentWindowConsumption([]);
      expect(result.billable_tokens).toBe(0);
      expect(result.requests).toBe(0);
    });
  });

  describe('predictUtilization', () => {
    it('returns uncalibrated when no model data', () => {
      const result = predictUtilization([], 'claude-opus-4-6');
      expect(result.source).toBe('uncalibrated');
      expect(result.confidence).toBe(0);
      expect(result.calibration_events).toBe(0);
    });

    it('returns calibrated when model has learned limits', async () => {
      const { writeFileSync: wf, mkdirSync: md, readFileSync: rf, existsSync: ex, unlinkSync } = await import('node:fs');
      const { join: jn } = await import('node:path');
      const { homedir: hd } = await import('node:os');
      const dir = jn(hd(), '.cctrack');
      md(dir, { recursive: true });
      const modelPath = jn(dir, 'rate-model.json');
      const backup = ex(modelPath) ? rf(modelPath, 'utf-8') : null;

      wf(modelPath, JSON.stringify({
        limits: { opus: { estimated_limit: 1000000, confidence: 0.8, sample_count: 5, last_calibration: '2026-03-25T00:00:00Z', alpha: 0.3 } },
        updated_at: '2026-03-25T00:00:00Z',
      }));

      const now = new Date();
      const entries = [
        makeEntry({ timestamp: new Date(now.getTime() - 60000).toISOString(), message: { model: 'claude-opus-4-6', usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 } } }),
      ];

      const result = predictUtilization(entries, 'claude-opus-4-6');
      expect(result.source).toBe('calibrated');
      expect(result.confidence).toBe(0.8);
      expect(result.estimated_limit).toBe(1000000);
      expect(result.current_consumption).toBe(600);

      // Restore
      if (backup) wf(modelPath, backup);
      else { try { unlinkSync(modelPath); } catch {} }
    });
  });
}
