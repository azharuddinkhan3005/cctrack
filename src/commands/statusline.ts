import type { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CostMode, UsageEntry, StatuslineData, RateLimitData } from '../core/types.js';
import { BLOCK_DURATION_MS } from '../core/types.js';
import { UsageEntrySchema } from '../core/types.js';
import { processEntry } from '../core/calculator.js';
import { formatCost, formatTokens, formatDuration, shortenModelName, parseCostMode } from '../utils/format.js';

const CACHE_DIR = join(homedir(), '.cctrack');
const CACHE_FILE = join(CACHE_DIR, 'statusline.cache');
const RATELIMIT_FILE = join(CACHE_DIR, 'ratelimits.json');
const CACHE_MAX_AGE_MS = 30_000; // 30 seconds

/**
 * Try to read rate limit data from Claude Code's statusline stdin.
 * Returns null if not running as a statusline hook (no stdin or no rate_limits).
 */
function readStdinRateLimits(): RateLimitData | null {
  try {
    // Check if stdin has data (non-TTY means piped input from Claude Code)
    if (process.stdin.isTTY) return null;

    // Read stdin synchronously via fd 0
    const stdinContent = readFileSync(0, 'utf-8').trim();
    if (!stdinContent) return null;

    const input = JSON.parse(stdinContent);
    if (!input.rate_limits) return null;

    const rl: RateLimitData = {
      source: 'statusline',
      captured_at: new Date().toISOString(),
    };

    const limits = input.rate_limits;
    if (limits.five_hour) {
      rl.five_hour = { used_percentage: limits.five_hour.used_percentage, resets_at: limits.five_hour.resets_at };
    }
    if (limits.seven_day) {
      rl.seven_day = { used_percentage: limits.seven_day.used_percentage, resets_at: limits.seven_day.resets_at };
    }
    if (limits.seven_day_sonnet) {
      rl.seven_day_sonnet = { used_percentage: limits.seven_day_sonnet.used_percentage, resets_at: limits.seven_day_sonnet.resets_at };
    }
    if (limits.seven_day_opus) {
      rl.seven_day_opus = { used_percentage: limits.seven_day_opus.used_percentage, resets_at: limits.seven_day_opus.resets_at };
    }
    if (limits.extra_usage?.is_enabled) {
      rl.extra_usage = {
        is_enabled: true,
        spent: limits.extra_usage.used_credits ?? 0,
        limit: limits.extra_usage.monthly_limit ?? 0,
        utilization: limits.extra_usage.utilization ?? 0,
        resets_at: limits.extra_usage.resets_at ?? 0,
      };
    }

    // Persist to disk so other commands (blocks, live, dashboard) can read it
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(RATELIMIT_FILE, JSON.stringify(rl, null, 2), 'utf-8');
    } catch {}

    return rl;
  } catch {
    return null;
  }
}

/**
 * Read cached rate limit data from disk (written by statusline hook or OAuth).
 */
function readCachedRateLimits(): RateLimitData | null {
  try {
    if (!existsSync(RATELIMIT_FILE)) return null;
    const raw = readFileSync(RATELIMIT_FILE, 'utf-8');
    const data: RateLimitData = JSON.parse(raw);
    // Stale after 10 minutes
    const age = Date.now() - new Date(data.captured_at).getTime();
    if (age > 10 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Export for other commands to use.
 */
export function getRateLimits(): RateLimitData | null {
  return readCachedRateLimits();
}

interface CacheFile {
  updated_at: string;
  data: StatuslineData;
}

// shortenModelName imported from ../utils/format.js

function readCache(): CacheFile | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(data: StatuslineData): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const cache: CacheFile = { updated_at: new Date().toISOString(), data };
    writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch {
    // Non-fatal
  }
}

function isCacheFresh(): boolean {
  try {
    if (!existsSync(CACHE_FILE)) return false;
    const stat = statSync(CACHE_FILE);
    return Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * Find all .jsonl files under the given directories, recursively.
 */
function findJsonlFilesSync(dirs: string[]): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip dirs we can't read
    }
  }

  for (const dir of dirs) {
    walk(dir);
  }

  return files;
}

/**
 * Get project directories (sync version for speed).
 */
function getProjectDirsSync(): string[] {
  const dirs: string[] = [];

  const customDir = process.env.CLAUDE_CONFIG_DIR;
  if (customDir) {
    const projectsDir = join(customDir, 'projects');
    if (existsSync(projectsDir)) dirs.push(projectsDir);
  }

  const home = homedir();
  const defaultPaths = [join(home, '.claude', 'projects'), join(home, '.config', 'claude', 'projects')];

  for (const p of defaultPaths) {
    if (existsSync(p)) dirs.push(p);
  }

  return [...new Set(dirs)];
}

/**
 * Parse JSONL files synchronously, only reading files modified in the last 24 hours.
 * Filters to only today's entries for speed.
 */
function parseRecentEntriesSync(files: string[], mode: CostMode): StatuslineData {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const todayStr = new Date().toISOString().slice(0, 10);
  const blockStart = now - BLOCK_DURATION_MS;

  let todayCost = 0;
  let totalTokens = 0;
  let blockTokens = 0;
  let blockRequests = 0;
  let latestModel = 'unknown';
  let latestTimestamp = '';
  let latestSessionId = '';
  const sessionCosts = new Map<string, number>();

  for (const file of files) {
    // Only parse files modified in the last 24 hours
    try {
      const stat = statSync(file);
      if (stat.mtimeMs < oneDayAgo) continue;
    } catch {
      continue;
    }

    // Read only the last 256KB of the file (today's entries are at the end)
    let content: string;
    try {
      const stat2 = statSync(file);
      const maxBytes = 256 * 1024;
      if (stat2.size > maxBytes) {
        const fd = openSync(file, 'r');
        const buf = Buffer.alloc(maxBytes);
        readSync(fd, buf, 0, maxBytes, stat2.size - maxBytes);
        closeSync(fd);
        content = buf.toString('utf-8');
        // Skip first partial line
        const firstNewline = content.indexOf('\n');
        if (firstNewline >= 0) content = content.slice(firstNewline + 1);
      } else {
        content = readFileSync(file, 'utf-8');
      }
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const raw = JSON.parse(trimmed);
        const parsed = UsageEntrySchema.safeParse(raw);
        if (!parsed.success) continue;

        const entry = parsed.data;
        if (entry.isApiErrorMessage === true) continue;
        if (entry.message.model === '<synthetic>') continue;

        // Only process today's entries
        const entryDate = entry.timestamp.slice(0, 10);
        if (entryDate !== todayStr) continue;

        const result = processEntry(entry, mode);
        todayCost += result.cost.total_cost;
        totalTokens += result.tokens.total_tokens;

        // Track latest model
        if (entry.timestamp > latestTimestamp) {
          latestTimestamp = entry.timestamp;
          latestModel = entry.message.model ?? 'unknown';
          if (entry.sessionId) latestSessionId = entry.sessionId;
        }

        // Accumulate per-session costs in a map
        if (entry.sessionId) {
          sessionCosts.set(entry.sessionId, (sessionCosts.get(entry.sessionId) ?? 0) + result.cost.total_cost);
        }

        // Block tracking (current 5-hour window)
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime >= blockStart) {
          blockTokens += result.tokens.total_tokens;
          blockRequests++;
        }
      } catch {
        continue;
      }
    }
  }

  // Look up session cost for the latest session from the map
  const sessionCost = latestSessionId ? (sessionCosts.get(latestSessionId) ?? 0) : 0;

  // Calculate block percentage based on token/request density
  // Since blocks are rolling windows, we show how "full" the current block is
  // relative to the average block capacity
  const blockPct = blockRequests > 0 ? Math.min(blockRequests, 100) : 0;
  const blockElapsed = now - blockStart;
  const blockRemaining = Math.max(BLOCK_DURATION_MS - blockElapsed, 0);

  // Compute budget level from config
  // Inline the budget logic to avoid importing budget.ts (which has top-level await in tests)
  let budgetLevel: import('../core/types.js').BudgetLevel = 'safe';
  try {
    const configPath = join(homedir(), '.cctrack', 'config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const dailyBudget = config?.budget?.daily;
      if (dailyBudget && dailyBudget > 0) {
        const pct = (todayCost / dailyBudget) * 100;
        if (pct >= 100) budgetLevel = 'exceeded';
        else if (pct >= 80) budgetLevel = 'critical';
        else if (pct >= 50) budgetLevel = 'warning';
      }
    }
  } catch {
    // Config not available, stay safe
  }

  return {
    today_cost: todayCost,
    session_cost: sessionCost,
    model: latestModel,
    total_tokens: totalTokens,
    block_percentage: Math.round(blockPct),
    block_remaining: formatDuration(blockRemaining),
    budget_level: budgetLevel,
    updated_at: new Date().toISOString(),
  };
}

function buildProgressBarCompact(percentage: number, width: number = 8): string {
  const pct = Math.min(Math.max(percentage, 0), 100);
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

function formatOutput(data: StatuslineData, template?: string): string {
  if (template) {
    return template
      .replace('{cost}', formatCost(data.today_cost))
      .replace('{model}', shortenModelName(data.model))
      .replace('{tokens}', formatTokens(data.total_tokens))
      .replace('{block_pct}', `${data.block_percentage}%`)
      .replace('{block_remaining}', data.block_remaining);
  }

  const parts = [
    formatCost(data.today_cost) + ' today',
    shortenModelName(data.model),
    formatTokens(data.total_tokens) + ' tok',
  ];

  // Show real rate limits if available, otherwise show estimated
  if (data.rate_limits?.five_hour) {
    const pct = Math.round(data.rate_limits.five_hour.used_percentage);
    const bar = buildProgressBarCompact(pct);
    const resetMs = data.rate_limits.five_hour.resets_at * 1000 - Date.now();
    const resetStr = resetMs > 0 ? formatDuration(resetMs) : 'now';
    parts.push(`${bar} ${pct}% 5h (${resetStr})`);
  }
  if (data.rate_limits?.seven_day) {
    parts.push(`7d: ${Math.round(data.rate_limits.seven_day.used_percentage)}%`);
  }
  if (data.rate_limits?.extra_usage) {
    const eu = data.rate_limits.extra_usage;
    parts.push(`extra: $${eu.spent.toFixed(2)}/$${eu.limit.toFixed(0)}`);
  }
  if (!data.rate_limits) {
    parts.push(`${buildProgressBarCompact(data.block_percentage)} ~${data.block_percentage}%`);
  }

  return parts.join(' \u2502 ');
}

export function registerStatuslineCommand(program: Command): void {
  program
    .command('statusline')
    .description('Ultra-lightweight cached output for tmux/neovim/hooks')
    .option('--format <template>', 'Custom format with placeholders: {cost}, {model}, {tokens}, {block_pct}, {block_remaining}')
    .option('--no-cache', 'Force fresh parse (skip cache)')
    .option('--json', 'Output as JSON')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .action((opts) => {
      const mode = parseCostMode(opts.mode);
      const useCache = opts.cache !== false;

      // Try to capture rate limits from Claude Code's stdin (when used as statusline hook)
      const stdinLimits = readStdinRateLimits();

      let data: StatuslineData;

      // Fast path: try cache first
      if (useCache && isCacheFresh()) {
        const cached = readCache();
        if (cached) {
          data = cached.data;
        } else {
          const dirs = getProjectDirsSync();
          const files = findJsonlFilesSync(dirs);
          data = parseRecentEntriesSync(files, mode);
          writeCache(data);
        }
      } else {
        const dirs = getProjectDirsSync();
        const files = findJsonlFilesSync(dirs);
        data = parseRecentEntriesSync(files, mode);
        if (useCache) writeCache(data);
      }

      // Attach rate limits (from stdin capture or disk cache)
      data.rate_limits = stdinLimits ?? readCachedRateLimits() ?? undefined;

      // Update block percentage from real data if available
      if (data.rate_limits?.five_hour) {
        data.block_percentage = Math.round(data.rate_limits.five_hour.used_percentage);
        const resetMs = data.rate_limits.five_hour.resets_at * 1000 - Date.now();
        data.block_remaining = formatDuration(Math.max(resetMs, 0));
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(data));
      } else {
        process.stdout.write(formatOutput(data, opts.format));
      }
    });
}
