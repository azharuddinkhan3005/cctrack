import { getProjectDirs, findJsonlFiles } from '../utils/fs.js';
import { parseAllFiles } from './parser.js';
import { deduplicateEntries } from './dedup.js';
import { cacheEntries, loadCachedEntries } from './cache.js';
import type { UsageEntry } from './types.js';

export interface LoadDataOptions {
  since?: string;
  until?: string;
  noCache?: boolean;
}

export interface LoadDataResult {
  entries: UsageEntry[];
  errors: number;
}

/**
 * Unified data loading pipeline used by all commands.
 *
 * 1. Load cached entries from ~/.cctrackr/history/ (surviving 30-day deletion)
 * 2. Parse current JSONL files from Claude Code's projects directory
 * 3. Merge and deduplicate (3-tier dedup handles overlap between cache and fresh)
 * 4. Cache any new entries for future runs
 * 5. Return the complete, deduplicated dataset
 */
export async function loadData(options: LoadDataOptions = {}): Promise<LoadDataResult> {
  // Step 1: Load cached historical entries
  const cached = options.noCache ? [] : loadCachedEntries(options.since, options.until);

  // Step 2: Parse current JSONL files
  const dirs = getProjectDirs();
  const files = findJsonlFiles(dirs);
  const { entries: fresh, errors } = await parseAllFiles(files);

  // Step 3: Merge and deduplicate
  const merged = [...cached, ...fresh];
  const unique = deduplicateEntries(merged);

  // Step 4: Cache new entries (non-blocking, fire-and-forget)
  if (!options.noCache && fresh.length > 0) {
    try {
      cacheEntries(fresh);
    } catch {
      // Non-fatal: caching failure doesn't break the tool
    }
  }

  return { entries: unique, errors };
}
