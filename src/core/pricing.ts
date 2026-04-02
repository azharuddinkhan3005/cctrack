import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { PricingData, ModelPricing, PricingSnapshot } from './types.js';

let pricingData: PricingData | null = null;

const CACHE_DIR = join(homedir(), '.cctrack');
const CACHE_FILE = join(CACHE_DIR, 'pricing.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing';

// === Fetching & Caching ===

interface CachedPricing {
  fetched_at: string;
  data: PricingData;
}

function getCacheAge(): number {
  try {
    if (!existsSync(CACHE_FILE)) return Infinity;
    const cached: CachedPricing = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return Date.now() - new Date(cached.fetched_at).getTime();
  } catch {
    return Infinity;
  }
}

function readCache(): PricingData | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const cached: CachedPricing = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return cached.data;
  } catch {
    return null;
  }
}

function writeCache(data: PricingData): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const cached: CachedPricing = { fetched_at: new Date().toISOString(), data };
    writeFileSync(CACHE_FILE, JSON.stringify(cached, null, 2), 'utf-8');
  } catch {
    // Non-fatal: pricing still works, just not cached
  }
}

function loadBundled(): PricingData {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // Try multiple paths: from src/core/ (dev) and from dist/ (production)
  const candidates = [
    join(__dirname, '..', '..', 'pricing', 'models.json'),  // src/core/ → ../../pricing
    join(__dirname, '..', 'pricing', 'models.json'),         // dist/ → ../pricing
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as PricingData;
    } catch { /* try next */ }
  }
  throw new Error('Could not find bundled pricing/models.json');
}

/**
 * Parse pricing from the Anthropic pricing HTML page.
 * Extracts model names, input/output/cache costs from the pricing tables.
 */
function parsePricingHtml(html: string): PricingData | null {
  try {
    const models: Record<string, ModelPricing> = {};
    const aliases: Record<string, string> = {};

    // Extract model blocks - look for model IDs in the HTML
    const modelIdPattern = /claude-(?:opus|sonnet|haiku)-[\d.-]+(?:-\d{8})?/g;
    const foundModelIds = new Set<string>();
    let match;
    while ((match = modelIdPattern.exec(html)) !== null) {
      foundModelIds.add(match[0]);
    }

    // Try to extract structured data from table rows
    // Pattern: model name followed by pricing values in same row/section
    const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowPattern) || [];

    for (const row of rows) {
      // Find model ID in this row
      const modelMatch = row.match(/claude-(?:opus|sonnet|haiku)-[\w.-]+/);
      if (!modelMatch) continue;

      const modelId = modelMatch[0];

      // Extract all dollar amounts from this row
      const prices: number[] = [];
      let priceMatch;
      const rowPricePattern = /\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g;
      while ((priceMatch = rowPricePattern.exec(row)) !== null) {
        prices.push(parseFloat(priceMatch[1].replace(/,/g, '')));
      }

      // Typical table: Input, Output (minimum 2 prices)
      if (prices.length >= 2) {
        const pricing: ModelPricing = {
          input_cost_per_million: prices[0],
          output_cost_per_million: prices[1],
          cache_creation_cost_per_million: prices[0] * 1.25, // 1.25x input
          cache_read_cost_per_million: prices[0] * 0.1, // 0.1x input
          context_window: 200000,
        };

        // If more prices, they may be cache or tiered
        if (prices.length >= 4) {
          pricing.cache_creation_cost_per_million = prices[2];
          pricing.cache_read_cost_per_million = prices[3];
        }

        models[modelId] = pricing;
      }
    }

    if (Object.keys(models).length === 0) return null;

    // Generate common aliases
    for (const modelId of Object.keys(models)) {
      // claude-opus-4-6-20260205 -> claude-opus-4-6
      const shortMatch = modelId.match(/^(claude-(?:opus|sonnet|haiku)-[\d.-]+)-\d{8}$/);
      if (shortMatch) {
        aliases[shortMatch[1]] = modelId;
        aliases[shortMatch[1] + '-latest'] = modelId;
      }
    }

    return {
      version: new Date().toISOString().slice(0, 10),
      models,
      aliases,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch latest pricing from Anthropic's docs.
 * Returns parsed pricing data or null on failure.
 */
export async function fetchPricing(): Promise<PricingData | null> {
  try {
    const response = await fetch(PRICING_URL, {
      headers: { 'User-Agent': 'cctrack/0.1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const html = await response.text();
    return parsePricingHtml(html);
  } catch {
    return null;
  }
}

/**
 * Update pricing: fetch from Anthropic, merge with bundled, and cache.
 * Returns the merged pricing data and whether any new models were found.
 */
export async function updatePricing(): Promise<{ data: PricingData; newModels: string[]; source: string }> {
  const bundled = loadBundled();
  const fetched = await fetchPricing();

  if (!fetched || Object.keys(fetched.models).length === 0) {
    if (process.env.DEBUG) console.warn('cctrack: pricing fetch returned 0 models, using bundled pricing');
    return { data: bundled, newModels: [], source: 'bundled (fetch failed)' };
  }

  // Merge: fetched models override bundled, bundled fills gaps
  const merged: PricingData = {
    version: new Date().toISOString().slice(0, 10),
    models: { ...bundled.models },
    aliases: { ...bundled.aliases },
  };

  const newModels: string[] = [];
  for (const [id, pricing] of Object.entries(fetched.models)) {
    if (!merged.models[id]) {
      newModels.push(id);
    }
    merged.models[id] = pricing;
  }

  // Merge aliases
  for (const [alias, target] of Object.entries(fetched.aliases)) {
    merged.aliases[alias] = target;
  }

  writeCache(merged);
  return { data: merged, newModels, source: 'fetched + bundled' };
}

// === Loading (with cache priority) ===

/**
 * Load pricing with priority:
 * 1. In-memory cache (for current process)
 * 2. Disk cache (~/.cctrack/pricing.json) if fresh
 * 3. Bundled pricing/models.json
 */
/**
 * Load pricing synchronously. Uses in-memory cache after first call.
 * Sync I/O only happens once (first call) — subsequent calls return cached data.
 * This is safe for live mode since initPricing() pre-loads at startup.
 */
function loadPricing(): PricingData {
  if (pricingData) return pricingData;

  // Try disk cache first
  const cacheAge = getCacheAge();
  if (cacheAge < CACHE_TTL_MS) {
    const cached = readCache();
    if (cached) {
      pricingData = cached;
      return pricingData;
    }
  }

  // Fall back to bundled
  pricingData = loadBundled();
  return pricingData;
}

/**
 * Initialize pricing with a background fetch if cache is stale.
 * Call this at startup — it returns immediately with cached/bundled data
 * and kicks off an async refresh if needed.
 */
export async function initPricing(): Promise<void> {
  const cacheAge = getCacheAge();

  if (cacheAge >= CACHE_TTL_MS) {
    // Cache is stale — try to refresh
    const fetched = await fetchPricing();
    if (fetched && Object.keys(fetched.models).length > 0) {
      const bundled = loadBundled();
      const merged: PricingData = {
        version: new Date().toISOString().slice(0, 10),
        models: { ...bundled.models, ...fetched.models },
        aliases: { ...bundled.aliases, ...fetched.aliases },
      };
      writeCache(merged);
      pricingData = merged;
    }
  }
}

/** For testing: inject pricing data directly */
export function setPricingData(data: PricingData): void {
  pricingData = data;
}

/** For testing: reset cached pricing */
export function resetPricing(): void {
  pricingData = null;
}

/** Get the current pricing source info */
export function getPricingInfo(): { source: string; modelCount: number; version: string; cacheAge: string } {
  const data = loadPricing();
  const age = getCacheAge();
  let cacheAge: string;
  if (age === Infinity) {
    cacheAge = 'no cache';
  } else {
    const hours = Math.floor(age / (60 * 60 * 1000));
    const mins = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
    cacheAge = `${hours}h ${mins}m ago`;
  }

  const source = age < CACHE_TTL_MS ? 'cached (fetched)' : 'bundled';

  return {
    source,
    modelCount: Object.keys(data.models).length,
    version: data.version,
    cacheAge,
  };
}

/** Get all loaded pricing data */
export function getAllPricing(): PricingData {
  return loadPricing();
}

/**
 * Resolve a model name to its pricing.
 * 1. Exact match
 * 2. Alias lookup
 * 3. null (no match — caller should fall back to costUSD or 0)
 *
 * NEVER does substring/fuzzy matching.
 */
export function getModelPricing(modelName: string): ModelPricing | null {
  const data = loadPricing();

  // Exact match
  if (data.models[modelName]) return data.models[modelName];

  // Alias lookup
  const resolved = data.aliases[modelName];
  if (resolved && data.models[resolved]) return data.models[resolved];

  return null;
}

/**
 * Get the current pricing data version string.
 */
export function getPricingVersion(): string {
  try {
    return loadPricing().version;
  } catch {
    return 'unknown';
  }
}

/**
 * Capture a snapshot of the pricing used for a model at this moment.
 * Returns null if the model has no known pricing.
 */
export function snapshotPricing(modelName: string): PricingSnapshot | null {
  const pricing = getModelPricing(modelName);
  if (!pricing) return null;
  const data = loadPricing();
  return {
    model: modelName,
    input_per_million: pricing.input_cost_per_million,
    output_per_million: pricing.output_cost_per_million,
    cache_write_per_million: pricing.cache_creation_cost_per_million,
    cache_read_per_million: pricing.cache_read_cost_per_million,
    pricing_version: data.version,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Calculate cost for a single token type with tiered pricing.
 * Threshold is applied per-request, matching Anthropic's billing.
 */
export function calculateTieredCost(
  tokens: number,
  basePricePerMillion: number,
  tieredPricePerMillion?: number,
  threshold: number = 200_000,
): number {
  if (tokens <= 0) return 0;

  const baseRate = basePricePerMillion / 1_000_000;

  if (tieredPricePerMillion !== undefined && tokens > threshold) {
    const tieredRate = tieredPricePerMillion / 1_000_000;
    return threshold * baseRate + (tokens - threshold) * tieredRate;
  }

  return tokens * baseRate;
}

/**
 * Calculate cost breakdown for a single usage entry.
 */
export function calculateEntryCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  embeddedCostUSD?: number,
): { input: number; output: number; cacheWrite: number; cacheRead: number; total: number } {
  const pricing = getModelPricing(modelName);

  if (!pricing) {
    // Fall back to embedded costUSD
    if (embeddedCostUSD !== undefined) {
      return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: embeddedCostUSD };
    }
    // No pricing info at all
    return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  }

  const input = calculateTieredCost(
    inputTokens,
    pricing.input_cost_per_million,
    pricing.input_cost_per_million_above_200k,
  );

  const output = calculateTieredCost(
    outputTokens,
    pricing.output_cost_per_million,
    pricing.output_cost_per_million_above_200k,
  );

  const cacheWrite = calculateTieredCost(
    cacheWriteTokens,
    pricing.cache_creation_cost_per_million,
    pricing.cache_creation_cost_per_million_above_200k,
  );

  const cacheRead = calculateTieredCost(
    cacheReadTokens,
    pricing.cache_read_cost_per_million,
    pricing.cache_read_cost_per_million_above_200k,
  );

  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    total: input + output + cacheWrite + cacheRead,
  };
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;

  const testPricing: PricingData = {
    version: 'test',
    models: {
      'claude-sonnet-4-20250514': {
        input_cost_per_million: 3.0,
        output_cost_per_million: 15.0,
        cache_creation_cost_per_million: 3.75,
        cache_read_cost_per_million: 0.30,
        input_cost_per_million_above_200k: 6.0,
        output_cost_per_million_above_200k: 30.0,
        cache_creation_cost_per_million_above_200k: 7.50,
        cache_read_cost_per_million_above_200k: 0.60,
        context_window: 200000,
      },
      'claude-opus-4-20250514': {
        input_cost_per_million: 15.0,
        output_cost_per_million: 75.0,
        cache_creation_cost_per_million: 18.75,
        cache_read_cost_per_million: 1.50,
        input_cost_per_million_above_200k: 30.0,
        output_cost_per_million_above_200k: 150.0,
        cache_creation_cost_per_million_above_200k: 37.50,
        cache_read_cost_per_million_above_200k: 3.00,
        context_window: 200000,
      },
      'claude-haiku-3-5-20241022': {
        input_cost_per_million: 0.80,
        output_cost_per_million: 4.0,
        cache_creation_cost_per_million: 1.0,
        cache_read_cost_per_million: 0.08,
        context_window: 200000,
      },
    },
    aliases: {
      'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
      'claude-opus-4-6': 'claude-opus-4-20250514',
    },
  };

  beforeEach(() => {
    setPricingData(testPricing);
  });

  describe('getModelPricing', () => {
    it('returns pricing for exact model match', () => {
      const pricing = getModelPricing('claude-sonnet-4-20250514');
      expect(pricing).not.toBeNull();
      expect(pricing!.input_cost_per_million).toBe(3.0);
    });

    it('resolves alias to pricing', () => {
      const pricing = getModelPricing('claude-sonnet-4-6');
      expect(pricing).not.toBeNull();
      expect(pricing!.input_cost_per_million).toBe(3.0);
    });

    it('returns null for unknown model (no fuzzy matching)', () => {
      const pricing = getModelPricing('claude-sonnet');
      expect(pricing).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getModelPricing('')).toBeNull();
    });

    it('returns null for partial match (no substring matching)', () => {
      expect(getModelPricing('sonnet-4-20250514')).toBeNull();
    });
  });

  describe('calculateTieredCost', () => {
    it('returns 0 for 0 tokens', () => {
      expect(calculateTieredCost(0, 3.0, 6.0)).toBe(0);
    });

    it('returns 0 for negative tokens', () => {
      expect(calculateTieredCost(-100, 3.0, 6.0)).toBe(0);
    });

    it('calculates base rate for tokens under threshold', () => {
      const cost = calculateTieredCost(100_000, 3.0, 6.0);
      expect(cost).toBeCloseTo(0.30, 6);
    });

    it('calculates base rate at exactly 200k threshold', () => {
      const cost = calculateTieredCost(200_000, 3.0, 6.0);
      expect(cost).toBeCloseTo(0.60, 6);
    });

    it('applies tiered pricing above 200k', () => {
      const cost = calculateTieredCost(200_001, 3.0, 6.0);
      const expected = 200_000 * (3.0 / 1_000_000) + 1 * (6.0 / 1_000_000);
      expect(cost).toBeCloseTo(expected, 10);
    });

    it('calculates large tiered cost correctly', () => {
      const cost = calculateTieredCost(1_000_000, 3.0, 6.0);
      const expected = 200_000 * (3.0 / 1_000_000) + 800_000 * (6.0 / 1_000_000);
      expect(cost).toBeCloseTo(expected, 6);
      expect(cost).toBeCloseTo(0.60 + 4.80, 6);
    });

    it('uses base rate when no tiered price provided', () => {
      const cost = calculateTieredCost(300_000, 0.80);
      expect(cost).toBeCloseTo(300_000 * (0.80 / 1_000_000), 6);
    });
  });

  describe('calculateEntryCost', () => {
    it('calculates cost for known model', () => {
      const result = calculateEntryCost('claude-sonnet-4-20250514', 1000, 500, 200, 300);
      expect(result.input).toBeCloseTo(1000 * (3.0 / 1_000_000), 10);
      expect(result.output).toBeCloseTo(500 * (15.0 / 1_000_000), 10);
      expect(result.cacheWrite).toBeCloseTo(200 * (3.75 / 1_000_000), 10);
      expect(result.cacheRead).toBeCloseTo(300 * (0.30 / 1_000_000), 10);
      expect(result.total).toBeCloseTo(
        result.input + result.output + result.cacheWrite + result.cacheRead,
        10,
      );
    });

    it('falls back to costUSD for unknown model', () => {
      const result = calculateEntryCost('unknown-model', 1000, 500, 0, 0, 0.42);
      expect(result.total).toBe(0.42);
      expect(result.input).toBe(0);
    });

    it('returns zero cost when no pricing and no embedded cost', () => {
      const result = calculateEntryCost('unknown-model', 1000, 500, 0, 0);
      expect(result.total).toBe(0);
    });

    it('works with alias model names', () => {
      const result = calculateEntryCost('claude-opus-4-6', 1000, 500, 0, 0);
      expect(result.input).toBeCloseTo(1000 * (15.0 / 1_000_000), 10);
      expect(result.output).toBeCloseTo(500 * (75.0 / 1_000_000), 10);
    });
  });

  describe('parsePricingHtml', () => {
    it('returns null for empty HTML', () => {
      expect(parsePricingHtml('')).toBeNull();
    });

    it('returns null for HTML with no pricing tables', () => {
      expect(parsePricingHtml('<html><body>no data</body></html>')).toBeNull();
    });

    it('extracts pricing from table rows with 2 prices', () => {
      const html = `
        <tr><td>claude-sonnet-4-20250514</td><td>$3.00 / MTok</td><td>$15.00 / MTok</td></tr>
      `;
      const result = parsePricingHtml(html);
      expect(result).not.toBeNull();
      expect(result!.models['claude-sonnet-4-20250514']).toBeDefined();
      expect(result!.models['claude-sonnet-4-20250514'].input_cost_per_million).toBe(3.0);
      expect(result!.models['claude-sonnet-4-20250514'].output_cost_per_million).toBe(15.0);
    });

    it('extracts pricing with 4 prices (including cache)', () => {
      const html = `
        <tr><td>claude-opus-4-20250514</td><td>$15.00</td><td>$75.00</td><td>$18.75</td><td>$1.50</td></tr>
      `;
      const result = parsePricingHtml(html);
      expect(result).not.toBeNull();
      const p = result!.models['claude-opus-4-20250514'];
      expect(p.input_cost_per_million).toBe(15.0);
      expect(p.output_cost_per_million).toBe(75.0);
      expect(p.cache_creation_cost_per_million).toBe(18.75);
      expect(p.cache_read_cost_per_million).toBe(1.50);
    });

    it('extracts multiple models from HTML', () => {
      const html = `
        <table>
          <tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>
          <tr><td>claude-opus-4-20250514</td><td>$15.00</td><td>$75.00</td></tr>
        </table>
      `;
      const result = parsePricingHtml(html);
      expect(result).not.toBeNull();
      expect(Object.keys(result!.models)).toHaveLength(2);
    });

    it('generates aliases for dated model IDs', () => {
      const html = `
        <tr><td>claude-sonnet-4-6-20260217</td><td>$3.00</td><td>$15.00</td></tr>
      `;
      const result = parsePricingHtml(html);
      expect(result).not.toBeNull();
      expect(result!.aliases['claude-sonnet-4-6']).toBe('claude-sonnet-4-6-20260217');
      expect(result!.aliases['claude-sonnet-4-6-latest']).toBe('claude-sonnet-4-6-20260217');
    });

    it('skips rows without model IDs', () => {
      const html = `
        <tr><td>Some header</td><td>Input</td><td>Output</td></tr>
        <tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>
      `;
      const result = parsePricingHtml(html);
      expect(result).not.toBeNull();
      expect(Object.keys(result!.models)).toHaveLength(1);
    });

    it('skips rows with only 1 price', () => {
      const html = `
        <tr><td>claude-sonnet-4-20250514</td><td>$3.00</td></tr>
      `;
      const result = parsePricingHtml(html);
      expect(result).toBeNull(); // Not enough prices for a valid entry
    });

    it('handles invalid JSON-LD gracefully', () => {
      const html = `
        <script type="application/ld+json">not json</script>
        <tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>
      `;
      const result = parsePricingHtml(html);
      expect(result).not.toBeNull();
    });

    it('sets version to current date', () => {
      const html = `<tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>`;
      const result = parsePricingHtml(html);
      expect(result!.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('defaults context_window to 200000', () => {
      const html = `<tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>`;
      const result = parsePricingHtml(html);
      expect(result!.models['claude-sonnet-4-20250514'].context_window).toBe(200000);
    });

    it('derives cache costs from input when only 2 prices', () => {
      const html = `<tr><td>claude-sonnet-4-20250514</td><td>$3.00</td><td>$15.00</td></tr>`;
      const result = parsePricingHtml(html);
      const p = result!.models['claude-sonnet-4-20250514'];
      expect(p.cache_creation_cost_per_million).toBeCloseTo(3.0 * 1.25, 6); // 1.25x input
      expect(p.cache_read_cost_per_million).toBeCloseTo(3.0 * 0.1, 6); // 0.1x input
    });
  });

  describe('getPricingInfo', () => {
    it('returns correct model count', () => {
      const info = getPricingInfo();
      expect(info.modelCount).toBe(3); // testPricing has 3 models
    });

    it('returns version', () => {
      const info = getPricingInfo();
      expect(info.version).toBe('test');
    });
  });

  describe('getAllPricing', () => {
    it('returns the full pricing data', () => {
      const data = getAllPricing();
      expect(data.models).toBeDefined();
      expect(data.aliases).toBeDefined();
      expect(Object.keys(data.models)).toHaveLength(3);
    });
  });

  describe('cache functions', () => {
    it('resetPricing clears in-memory cache', () => {
      setPricingData(testPricing);
      expect(getModelPricing('claude-sonnet-4-20250514')).not.toBeNull();

      // Reset and re-inject to verify it was cleared
      resetPricing();
      setPricingData({ version: 'empty', models: {}, aliases: {} });
      expect(getModelPricing('claude-sonnet-4-20250514')).toBeNull();

      // Restore for other tests
      setPricingData(testPricing);
    });

    it('setPricingData overrides all lookups', () => {
      const custom: PricingData = {
        version: 'custom',
        models: {
          'my-custom-model': {
            input_cost_per_million: 99.0,
            output_cost_per_million: 199.0,
            cache_creation_cost_per_million: 10.0,
            cache_read_cost_per_million: 1.0,
            context_window: 100000,
          },
        },
        aliases: { 'my-alias': 'my-custom-model' },
      };
      setPricingData(custom);

      expect(getModelPricing('my-custom-model')).not.toBeNull();
      expect(getModelPricing('my-custom-model')!.input_cost_per_million).toBe(99.0);
      expect(getModelPricing('my-alias')!.input_cost_per_million).toBe(99.0);
      expect(getModelPricing('claude-sonnet-4-20250514')).toBeNull();

      // Restore
      setPricingData(testPricing);
    });
  });

  describe('calculateEntryCost edge cases', () => {
    it('calculates with all four token types using tiered pricing', () => {
      // Use opus which has tiered pricing, with tokens above threshold
      const result = calculateEntryCost(
        'claude-opus-4-20250514',
        300_000, // above 200k threshold
        100_000,
        50_000,
        10_000,
      );
      // Input: 200k * $15/M + 100k * $30/M = $3 + $3 = $6
      expect(result.input).toBeCloseTo(200_000 * (15 / 1e6) + 100_000 * (30 / 1e6), 6);
      expect(result.output).toBeCloseTo(100_000 * (75 / 1e6), 6);
      expect(result.total).toBeGreaterThan(0);
    });

    it('handles zero tokens for all types', () => {
      const result = calculateEntryCost('claude-sonnet-4-20250514', 0, 0, 0, 0);
      expect(result.total).toBe(0);
      expect(result.input).toBe(0);
      expect(result.output).toBe(0);
    });
  });
}
