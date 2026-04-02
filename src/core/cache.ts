import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageEntry } from './types.js';

function getHistoryPath(): string {
  return join(homedir(), '.cctrackr', 'history');
}

function ensureHistoryDir(): void {
  mkdirSync(getHistoryPath(), { recursive: true });
}

/**
 * Compact representation of an entry for caching.
 * Only the fields needed to reconstruct a UsageEntry.
 */
interface CachedEntry {
  t: string;   // timestamp
  s?: string;  // sessionId
  c?: string;  // cwd (project)
  m?: string;  // model
  i: number;   // input_tokens
  o: number;   // output_tokens
  cw: number;  // cache_creation_input_tokens
  cr: number;  // cache_read_input_tokens
  u?: number;  // costUSD
  r?: string;  // requestId
  mi?: string; // message.id
}

function compactEntry(entry: UsageEntry): CachedEntry {
  return {
    t: entry.timestamp,
    s: entry.sessionId,
    c: entry.cwd,
    m: entry.message.model,
    i: entry.message.usage.input_tokens,
    o: entry.message.usage.output_tokens,
    cw: entry.message.usage.cache_creation_input_tokens ?? 0,
    cr: entry.message.usage.cache_read_input_tokens ?? 0,
    u: entry.costUSD,
    r: entry.requestId,
    mi: entry.message.id,
  };
}

function expandEntry(cached: CachedEntry): UsageEntry {
  return {
    timestamp: cached.t,
    sessionId: cached.s,
    cwd: cached.c,
    message: {
      id: cached.mi,
      model: cached.m,
      usage: {
        input_tokens: cached.i,
        output_tokens: cached.o,
        cache_creation_input_tokens: cached.cw,
        cache_read_input_tokens: cached.cr,
      },
    },
    costUSD: cached.u,
    requestId: cached.r,
  };
}

/**
 * Get the month key (YYYY-MM) from an ISO timestamp.
 */
function monthKey(timestamp: string): string {
  return timestamp.slice(0, 7);
}

/**
 * Save parsed entries to monthly history files.
 * Appends only entries not already in the file (by checking file existence per month).
 * Uses compact JSONL format for minimal disk usage.
 */
export function cacheEntries(entries: UsageEntry[]): void {
  if (entries.length === 0) return;
  ensureHistoryDir();

  // Group entries by month
  const byMonth = new Map<string, UsageEntry[]>();
  for (const entry of entries) {
    const month = monthKey(entry.timestamp);
    let arr = byMonth.get(month);
    if (!arr) {
      arr = [];
      byMonth.set(month, arr);
    }
    arr.push(entry);
  }

  // Load existing requestIds per month to avoid duplicates
  for (const [month, monthEntries] of byMonth) {
    const filePath = join(getHistoryPath(), `${month}.jsonl`);
    const existingIds = new Set<string>();

    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const cached: CachedEntry = JSON.parse(line);
            if (cached.r) existingIds.add(cached.r);
            if (cached.mi) existingIds.add(cached.mi);
          } catch { /* skip corrupt lines */ }
        }
      } catch { /* file read error, will overwrite */ }
    }

    // Filter out entries already in cache
    const newEntries = monthEntries.filter((e) => {
      if (e.requestId && existingIds.has(e.requestId)) return false;
      if (e.message.id && existingIds.has(e.message.id)) return false;
      return true;
    });

    if (newEntries.length === 0) continue;

    // Append new entries atomically (write to temp → rename prevents corruption on crash)
    const lines = newEntries.map((e) => JSON.stringify(compactEntry(e))).join('\n') + '\n';
    try {
      if (existsSync(filePath)) {
        // Read existing + append new, write atomically
        const existing = readFileSync(filePath, 'utf-8');
        const tmpPath = filePath + '.tmp.' + process.pid;
        writeFileSync(tmpPath, existing + lines, 'utf-8');
        renameSync(tmpPath, filePath);
      } else {
        const tmpPath = filePath + '.tmp.' + process.pid;
        writeFileSync(tmpPath, lines, 'utf-8');
        renameSync(tmpPath, filePath);
      }
    } catch {
      // Non-fatal: caching failure doesn't break the tool
    }
  }
}

/**
 * Load all cached entries from history files.
 * Returns entries from months that match the optional date range filter.
 */
export function loadCachedEntries(since?: string, until?: string): UsageEntry[] {
  if (!existsSync(getHistoryPath())) return [];

  const entries: UsageEntry[] = [];
  const sinceMonth = since ? since.slice(0, 7) : '';
  const untilMonth = until ? until.slice(0, 7) : 'z'; // 'z' > any date string

  try {
    const files = readdirSync(getHistoryPath()).filter((f) => f.endsWith('.jsonl')).sort();

    for (const file of files) {
      const month = file.replace('.jsonl', '');
      // Skip months outside the date range
      if (month < sinceMonth || month > untilMonth) continue;

      const filePath = join(getHistoryPath(), file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const cached: CachedEntry = JSON.parse(line);
            entries.push(expandEntry(cached));
          } catch { /* skip corrupt lines */ }
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* directory read error */ }

  return entries;
}

/**
 * Get the history directory path.
 */
export function getHistoryDir(): string {
  return getHistoryPath();
}
