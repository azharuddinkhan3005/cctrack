/**
 * Additional tests for pricing.ts to cover:
 * - loadPricing from disk cache (lines 214-221)
 * - initPricing async fetch+merge path (lines 233-250)
 * - getPricingInfo with formatted cache age (lines 270-272)
 * - fetchPricing network error path
 * - updatePricing merge logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PricingData } from './types.js';

import {
  setPricingData,
  resetPricing,
  getPricingInfo,
  getAllPricing,
  getModelPricing,
  initPricing,
  fetchPricing,
  updatePricing,
} from './pricing.js';

const CACHE_DIR = join(homedir(), '.cctrack');
const CACHE_FILE = join(CACHE_DIR, 'pricing.json');

describe('loadPricing from disk cache', () => {
  let cacheBackup: string | null = null;

  beforeEach(() => {
    // Backup existing cache
    try { cacheBackup = readFileSync(CACHE_FILE, 'utf-8'); } catch { cacheBackup = null; }
    // Reset in-memory cache so loadPricing actually reads from disk
    resetPricing();
  });

  afterEach(() => {
    // Restore cache
    if (cacheBackup !== null) {
      writeFileSync(CACHE_FILE, cacheBackup, 'utf-8');
    } else {
      try { unlinkSync(CACHE_FILE); } catch {}
    }
    resetPricing();
  });

  it('loads from disk cache when cache is fresh', () => {
    // Write a fresh cache file
    const cachedData: PricingData = {
      version: 'cached-test',
      models: {
        'test-model-from-cache': {
          input_cost_per_million: 99.0,
          output_cost_per_million: 199.0,
          cache_creation_cost_per_million: 10.0,
          cache_read_cost_per_million: 1.0,
          context_window: 100000,
        },
      },
      aliases: {},
    };

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      fetched_at: new Date().toISOString(), // fresh
      data: cachedData,
    }, null, 2), 'utf-8');

    // getAllPricing calls loadPricing internally
    const data = getAllPricing();
    expect(data.version).toBe('cached-test');
    expect(data.models['test-model-from-cache']).toBeDefined();
    expect(data.models['test-model-from-cache'].input_cost_per_million).toBe(99.0);
  });

  it('falls back to bundled when cache is stale', () => {
    // Write a stale cache file (>24 hours old)
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const cachedData: PricingData = {
      version: 'stale-cache',
      models: {
        'stale-model': {
          input_cost_per_million: 1.0,
          output_cost_per_million: 2.0,
          cache_creation_cost_per_million: 1.0,
          cache_read_cost_per_million: 0.1,
          context_window: 100000,
        },
      },
      aliases: {},
    };

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      fetched_at: staleDate,
      data: cachedData,
    }, null, 2), 'utf-8');

    const data = getAllPricing();
    // Should fall back to bundled, not the stale cache
    expect(data.version).not.toBe('stale-cache');
  });

  it('falls back to bundled when cache file has invalid JSON', () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, 'invalid json content', 'utf-8');

    const data = getAllPricing();
    // Should get bundled pricing (has real models)
    expect(Object.keys(data.models).length).toBeGreaterThan(0);
  });
});

describe('getPricingInfo with cache age formatting', () => {
  let cacheBackup: string | null = null;

  beforeEach(() => {
    try { cacheBackup = readFileSync(CACHE_FILE, 'utf-8'); } catch { cacheBackup = null; }
    resetPricing();
  });

  afterEach(() => {
    if (cacheBackup !== null) {
      writeFileSync(CACHE_FILE, cacheBackup, 'utf-8');
    } else {
      try { unlinkSync(CACHE_FILE); } catch {}
    }
    resetPricing();
  });

  it('returns "no cache" when no cache file exists', () => {
    try { unlinkSync(CACHE_FILE); } catch {}

    const info = getPricingInfo();
    expect(info.cacheAge).toBe('no cache');
    expect(info.source).toBe('bundled');
  });

  it('returns formatted hours and minutes when cache exists and is fresh', () => {
    // Write cache from 2 hours and 15 minutes ago
    const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000 + 15 * 60 * 1000));
    const cachedData: PricingData = {
      version: 'cache-age-test',
      models: {
        'test-model': {
          input_cost_per_million: 3.0,
          output_cost_per_million: 15.0,
          cache_creation_cost_per_million: 3.75,
          cache_read_cost_per_million: 0.3,
          context_window: 200000,
        },
      },
      aliases: {},
    };

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      fetched_at: twoHoursAgo.toISOString(),
      data: cachedData,
    }, null, 2), 'utf-8');

    const info = getPricingInfo();
    // Should contain "h" and "m" format
    expect(info.cacheAge).toMatch(/\d+h \d+m ago/);
    expect(info.source).toBe('cached (fetched)');
  });

  it('returns "bundled" source when cache is older than 24 hours', () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      fetched_at: oldDate.toISOString(),
      data: { version: 'old', models: {}, aliases: {} },
    }, null, 2), 'utf-8');

    const info = getPricingInfo();
    expect(info.source).toBe('bundled');
    // cacheAge should still show the formatted time, not "no cache"
    expect(info.cacheAge).toMatch(/\d+h \d+m ago/);
  });
});

describe('initPricing', () => {
  let cacheBackup: string | null = null;

  beforeEach(() => {
    try { cacheBackup = readFileSync(CACHE_FILE, 'utf-8'); } catch { cacheBackup = null; }
    resetPricing();
  });

  afterEach(() => {
    if (cacheBackup !== null) {
      writeFileSync(CACHE_FILE, cacheBackup, 'utf-8');
    } else {
      try { unlinkSync(CACHE_FILE); } catch {}
    }
    resetPricing();
  });

  it('does nothing when cache is fresh', async () => {
    // Write a fresh cache
    const cachedData: PricingData = {
      version: 'fresh',
      models: {
        'fresh-model': {
          input_cost_per_million: 1.0,
          output_cost_per_million: 2.0,
          cache_creation_cost_per_million: 1.0,
          cache_read_cost_per_million: 0.1,
          context_window: 100000,
        },
      },
      aliases: {},
    };

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      fetched_at: new Date().toISOString(),
      data: cachedData,
    }, null, 2), 'utf-8');

    // initPricing should see fresh cache and not fetch
    await initPricing();

    // The in-memory data should not have been set by initPricing (cache is fresh)
    // After resetting, it should still load from cache
    resetPricing();
    const data = getAllPricing();
    expect(data.version).toBe('fresh');
  });

  it('attempts fetch when cache is stale (network will fail in test)', async () => {
    // Delete cache to make it "stale" (Infinity age)
    try { unlinkSync(CACHE_FILE); } catch {}

    // initPricing will try to fetch from the real URL, which may timeout or fail
    // In test environment, it should handle the failure gracefully
    // and leave pricingData as null (falling back to bundled on next access)
    await initPricing();

    // After init, we should still be able to get pricing (bundled fallback)
    const data = getAllPricing();
    expect(Object.keys(data.models).length).toBeGreaterThan(0);
  });
});

describe('fetchPricing', () => {
  it('returns null on network error', async () => {
    // Mock fetch to throw
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };

    try {
      const result = await fetchPricing();
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 500 });

    try {
      const result = await fetchPricing();
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null when HTML has no pricing data', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('<html><body>no pricing here</body></html>', { status: 200 });

    try {
      const result = await fetchPricing();
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses pricing from HTML response', async () => {
    const html = `
      <table>
        <tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>
      </table>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(html, { status: 200 });

    try {
      const result = await fetchPricing();
      expect(result).not.toBeNull();
      expect(result!.models['claude-sonnet-4-20250514']).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('updatePricing', () => {
  let cacheBackup: string | null = null;

  beforeEach(() => {
    try { cacheBackup = readFileSync(CACHE_FILE, 'utf-8'); } catch { cacheBackup = null; }
    resetPricing();
  });

  afterEach(() => {
    if (cacheBackup !== null) {
      writeFileSync(CACHE_FILE, cacheBackup, 'utf-8');
    } else {
      try { unlinkSync(CACHE_FILE); } catch {}
    }
    resetPricing();
  });

  it('returns bundled data when fetch fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network down'); };

    try {
      const result = await updatePricing();
      expect(result.source).toBe('bundled (fetch failed)');
      expect(result.newModels).toEqual([]);
      expect(Object.keys(result.data.models).length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns bundled data when fetch returns empty models', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('<html>no data</html>', { status: 200 });

    try {
      const result = await updatePricing();
      expect(result.source).toBe('bundled (fetch failed)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('merges fetched models with bundled and identifies new models', async () => {
    // Use a model name that matches the parser regex: claude-(opus|sonnet|haiku)-...
    const html = `
      <table>
        <tr><td>claude-opus-99-20260101</td><td>$50.00</td><td>$100.00</td></tr>
      </table>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(html, { status: 200 });

    try {
      const result = await updatePricing();
      expect(result.source).toBe('fetched + bundled');
      expect(result.newModels).toContain('claude-opus-99-20260101');
      // Should contain both bundled and fetched models
      expect(result.data.models['claude-opus-99-20260101']).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
