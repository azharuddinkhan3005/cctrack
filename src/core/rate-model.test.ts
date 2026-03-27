/**
 * Additional tests for rate-model.ts to cover:
 * - saveModel (lines 62-64) — called internally by recordCalibration
 * - recordCalibration (lines 84-123) — both first-event and update paths
 * - predictUtilization minutesToLimit=0 path (line 203)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  loadModel,
  recordCalibration,
  loadEvents,
  currentWindowConsumption,
  predictUtilization,
  type RateLimitEvent,
} from './rate-model.js';
import { makeEntry } from './test-helpers.js';

const DATA_DIR = join(homedir(), '.cctrack');
const EVENTS_FILE = join(DATA_DIR, 'rate-events.jsonl');
const MODEL_FILE = join(DATA_DIR, 'rate-model.json');

describe('recordCalibration', () => {
  let eventsBackup: string | null = null;
  let modelBackup: string | null = null;

  beforeEach(() => {
    // Backup existing files
    try { eventsBackup = readFileSync(EVENTS_FILE, 'utf-8'); } catch { eventsBackup = null; }
    try { modelBackup = readFileSync(MODEL_FILE, 'utf-8'); } catch { modelBackup = null; }

    // Clean slate for tests
    try { unlinkSync(EVENTS_FILE); } catch {}
    try { unlinkSync(MODEL_FILE); } catch {}
  });

  afterEach(() => {
    // Restore backups
    if (eventsBackup !== null) writeFileSync(EVENTS_FILE, eventsBackup, 'utf-8');
    else { try { unlinkSync(EVENTS_FILE); } catch {} }

    if (modelBackup !== null) writeFileSync(MODEL_FILE, modelBackup, 'utf-8');
    else { try { unlinkSync(MODEL_FILE); } catch {} }
  });

  it('creates a new model entry on first calibration', () => {
    const event: RateLimitEvent = {
      timestamp: '2026-03-25T10:00:00Z',
      model: 'claude-opus-4-6-20260205',
      tokens_in_window: 500000,
      input_tokens_in_window: 400000,
    };

    recordCalibration(event);

    const model = loadModel();
    expect(model.limits['opus']).toBeDefined();
    expect(model.limits['opus'].estimated_limit).toBe(400000);
    expect(model.limits['opus'].sample_count).toBe(1);
    expect(model.limits['opus'].confidence).toBeCloseTo(0.3, 5);
    expect(model.limits['opus'].last_calibration).toBe('2026-03-25T10:00:00Z');
    expect(model.limits['opus'].alpha).toBe(0.3);
  });

  it('updates existing model entry with EMA on subsequent calibrations', () => {
    const event1: RateLimitEvent = {
      timestamp: '2026-03-25T10:00:00Z',
      model: 'claude-opus-4-6-20260205',
      tokens_in_window: 500000,
      input_tokens_in_window: 400000,
    };

    const event2: RateLimitEvent = {
      timestamp: '2026-03-25T12:00:00Z',
      model: 'claude-opus-4-6-20260205',
      tokens_in_window: 600000,
      input_tokens_in_window: 500000,
    };

    recordCalibration(event1);
    recordCalibration(event2);

    const model = loadModel();
    const opus = model.limits['opus'];
    expect(opus.sample_count).toBe(2);
    // EMA: 0.3 * 500000 + 0.7 * 400000 = 150000 + 280000 = 430000
    expect(opus.estimated_limit).toBeCloseTo(430000, 0);
    // Confidence: min(1 - 1/(2+1), 0.95) = min(0.667, 0.95) ~= 0.667
    expect(opus.confidence).toBeCloseTo(1 - 1 / 3, 5);
    expect(opus.last_calibration).toBe('2026-03-25T12:00:00Z');
  });

  it('appends events to the events file', () => {
    const event: RateLimitEvent = {
      timestamp: '2026-03-25T10:00:00Z',
      model: 'claude-sonnet-4-20250514',
      tokens_in_window: 300000,
      input_tokens_in_window: 200000,
    };

    recordCalibration(event);

    const events = loadEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.model).toBe('claude-sonnet-4-20250514');
    expect(last.input_tokens_in_window).toBe(200000);
  });

  it('handles multiple model families independently', () => {
    const opusEvent: RateLimitEvent = {
      timestamp: '2026-03-25T10:00:00Z',
      model: 'claude-opus-4-6-20260205',
      tokens_in_window: 500000,
      input_tokens_in_window: 400000,
    };

    const sonnetEvent: RateLimitEvent = {
      timestamp: '2026-03-25T10:00:00Z',
      model: 'claude-sonnet-4-20250514',
      tokens_in_window: 300000,
      input_tokens_in_window: 250000,
    };

    recordCalibration(opusEvent);
    recordCalibration(sonnetEvent);

    const model = loadModel();
    expect(model.limits['opus']).toBeDefined();
    expect(model.limits['sonnet']).toBeDefined();
    expect(model.limits['opus'].estimated_limit).toBe(400000);
    expect(model.limits['sonnet'].estimated_limit).toBe(250000);
  });

  it('confidence approaches 0.95 asymptotically with many calibrations', () => {
    for (let i = 0; i < 20; i++) {
      recordCalibration({
        timestamp: `2026-03-25T${String(i).padStart(2, '0')}:00:00Z`,
        model: 'claude-haiku-4-5-20251001',
        tokens_in_window: 100000,
        input_tokens_in_window: 80000,
      });
    }

    const model = loadModel();
    const haiku = model.limits['haiku'];
    expect(haiku.sample_count).toBe(20);
    expect(haiku.confidence).toBeLessThanOrEqual(0.95);
    expect(haiku.confidence).toBeGreaterThan(0.9);
  });
});

describe('loadModel', () => {
  let modelBackup: string | null = null;

  beforeEach(() => {
    try { modelBackup = readFileSync(MODEL_FILE, 'utf-8'); } catch { modelBackup = null; }
  });

  afterEach(() => {
    if (modelBackup !== null) writeFileSync(MODEL_FILE, modelBackup, 'utf-8');
    else { try { unlinkSync(MODEL_FILE); } catch {} }
  });

  it('returns empty model when file does not exist', () => {
    try { unlinkSync(MODEL_FILE); } catch {}
    const model = loadModel();
    expect(model.limits).toEqual({});
    expect(model.updated_at).toBeDefined();
  });

  it('returns empty model when file has invalid JSON', () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MODEL_FILE, 'not json', 'utf-8');
    const model = loadModel();
    expect(model.limits).toEqual({});
  });
});

describe('loadEvents', () => {
  let eventsBackup: string | null = null;

  beforeEach(() => {
    try { eventsBackup = readFileSync(EVENTS_FILE, 'utf-8'); } catch { eventsBackup = null; }
  });

  afterEach(() => {
    if (eventsBackup !== null) writeFileSync(EVENTS_FILE, eventsBackup, 'utf-8');
    else { try { unlinkSync(EVENTS_FILE); } catch {} }
  });

  it('returns empty array when events file does not exist', () => {
    try { unlinkSync(EVENTS_FILE); } catch {}
    const events = loadEvents();
    expect(events).toEqual([]);
  });

  it('returns empty array when events file has invalid content', () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(EVENTS_FILE, 'not json\n', 'utf-8');
    const events = loadEvents();
    // JSON.parse will throw, caught by the try/catch
    expect(events).toEqual([]);
  });
});

describe('predictUtilization — minutesToLimit edge cases', () => {
  let modelBackup: string | null = null;

  beforeEach(() => {
    try { modelBackup = readFileSync(MODEL_FILE, 'utf-8'); } catch { modelBackup = null; }
  });

  afterEach(() => {
    if (modelBackup !== null) writeFileSync(MODEL_FILE, modelBackup, 'utf-8');
    else { try { unlinkSync(MODEL_FILE); } catch {} }
  });

  it('returns minutesToLimit=0 when consumption exceeds estimated limit', () => {
    // Set up a model with a very low limit that our entries will exceed
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MODEL_FILE, JSON.stringify({
      limits: {
        opus: {
          estimated_limit: 100, // Very low limit
          confidence: 0.8,
          sample_count: 5,
          last_calibration: '2026-03-25T00:00:00Z',
          alpha: 0.3,
        },
      },
      updated_at: '2026-03-25T00:00:00Z',
    }));

    const now = new Date();
    // Create entries that exceed the limit, placed well within the window
    // and far enough from window start so elapsedHours > 0.1
    const entries = [
      makeEntry({
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 500,
            output_tokens: 200,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 0,
          },
        },
      }),
    ];

    const result = predictUtilization(entries, 'claude-opus-4-6');
    expect(result.source).toBe('calibrated');
    // billable = 500 + 100 = 600, which exceeds limit of 100
    // remaining = 100 - 600 = -500, which is <= 0 → minutesToLimit = 0
    expect(result.minutes_to_limit).toBe(0);
  });

  it('returns minutesToLimit=null when not enough elapsed time', () => {
    // Set up a model with calibration data
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MODEL_FILE, JSON.stringify({
      limits: {
        opus: {
          estimated_limit: 1000000,
          confidence: 0.8,
          sample_count: 5,
          last_calibration: '2026-03-25T00:00:00Z',
          alpha: 0.3,
        },
      },
      updated_at: '2026-03-25T00:00:00Z',
    }));

    // No entries means 0 billable tokens, so elapsedHours > 0.1 but billable = 0
    // → the if condition `consumption.billable_tokens > 0` fails → minutesToLimit stays null
    const result = predictUtilization([], 'claude-opus-4-6');
    expect(result.source).toBe('calibrated');
    expect(result.minutes_to_limit).toBeNull();
  });

  it('caps estimated_utilization at 100', () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MODEL_FILE, JSON.stringify({
      limits: {
        opus: {
          estimated_limit: 100,
          confidence: 0.9,
          sample_count: 10,
          last_calibration: '2026-03-25T00:00:00Z',
          alpha: 0.3,
        },
      },
      updated_at: '2026-03-25T00:00:00Z',
    }));

    const now = new Date();
    const entries = [
      makeEntry({
        timestamp: new Date(now.getTime() - 60000).toISOString(),
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
    ];

    const result = predictUtilization(entries, 'claude-opus-4-6');
    expect(result.estimated_utilization).toBe(100);
  });
});
