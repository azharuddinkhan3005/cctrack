import { createReadStream, appendFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { UsageEntrySchema, type UsageEntry } from './types.js';
import { getProjectForFile } from '../utils/fs.js';

export interface ParseResult {
  entries: UsageEntry[];
  errors: number;
  skipped: { apiErrors: number; synthetic: number };
}

/**
 * Parse a single JSONL file, streaming line-by-line.
 * Validates each entry against the Zod schema.
 * Filters out API errors and synthetic model entries.
 * Stamps each entry's cwd with the project name derived from the file path.
 */
export async function parseJsonlFile(filePath: string): Promise<ParseResult> {
  const entries: UsageEntry[] = [];
  let errors = 0;
  const skipped = { apiErrors: 0, synthetic: 0 };

  // Get project name from the file's location in the project directory tree
  const projectName = getProjectForFile(filePath);

  const rl = createInterface({
    input: createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const raw = JSON.parse(trimmed);

      // Skip non-usage entries (user messages, progress, file snapshots, etc.)
      // These are valid JSONL but don't contain token usage data
      if (!raw.message?.usage) continue;

      const parsed = UsageEntrySchema.safeParse(raw);

      if (!parsed.success) {
        errors++; // Actual schema validation failure on a usage entry
        continue;
      }

      const entry = parsed.data;

      // Filter API error entries — but save rate limit events for analysis
      if (entry.isApiErrorMessage === true) {
        skipped.apiErrors++;
        // Save rate limit events to a separate file for predictive modeling
        try {
          const content = entry.message.content;
          const hasRateLimit = content?.some((c: { text?: string }) => c.text?.includes('rate limit') || c.text?.includes('hit your limit'));
          if (hasRateLimit) {
            const dir = join(homedir(), '.cctrack');
            mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, 'rate-events.jsonl'),
              JSON.stringify({ timestamp: entry.timestamp, model: entry.message.model, content: content?.map((c: { text?: string }) => c.text).join(' ') }) + '\n');
          }
        } catch {}
        continue;
      }

      // Filter synthetic model entries
      if (entry.message.model === '<synthetic>') {
        skipped.synthetic++;
        continue;
      }

      // Override cwd with the authoritative project name from file path
      // This ensures subagent entries (cwd=/tradeforge/backend) are grouped
      // under the parent project (tradeforge), not treated as separate projects
      if (projectName !== 'unknown') {
        entry.cwd = projectName;
      }

      entries.push(entry);
    } catch {
      errors++;
    }
  }

  return { entries, errors, skipped };
}

/**
 * Parse multiple JSONL files and combine results.
 */
export async function parseAllFiles(filePaths: string[]): Promise<ParseResult> {
  const combined: ParseResult = {
    entries: [],
    errors: 0,
    skipped: { apiErrors: 0, synthetic: 0 },
  };

  const BATCH_SIZE = 20;
  for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
    const batch = filePaths.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(parseJsonlFile));
    for (const result of results) {
      // Use a loop instead of push(...spread) to avoid stack overflow with large arrays
      for (const entry of result.entries) {
        combined.entries.push(entry);
      }
      combined.errors += result.errors;
      combined.skipped.apiErrors += result.skipped.apiErrors;
      combined.skipped.synthetic += result.skipped.synthetic;
    }
  }

  return combined;
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect, afterAll } = import.meta.vitest;
  const { writeFileSync, unlinkSync, mkdirSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const tmpDir = join(tmpdir(), 'cctrack-test-parser');
  afterAll(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  function writeTempJsonl(name: string, lines: string[]): string {
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, name);
    writeFileSync(path, lines.join('\n'));
    return path;
  }

  const validLine = JSON.stringify({
    timestamp: '2025-03-25T10:00:00Z',
    message: {
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    requestId: 'req_1',
  });

  const apiErrorLine = JSON.stringify({
    timestamp: '2025-03-25T10:00:00Z',
    message: {
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    isApiErrorMessage: true,
  });

  const syntheticLine = JSON.stringify({
    timestamp: '2025-03-25T10:00:00Z',
    message: {
      model: '<synthetic>',
      usage: { input_tokens: 50, output_tokens: 20 },
    },
  });

  describe('parseJsonlFile', () => {
    it('parses valid entries', async () => {
      const path = writeTempJsonl('valid.jsonl', [validLine]);
      const result = await parseJsonlFile(path);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].message.usage.input_tokens).toBe(100);
      expect(result.errors).toBe(0);
      unlinkSync(path);
    });

    it('filters API error entries', async () => {
      const path = writeTempJsonl('api-err.jsonl', [validLine, apiErrorLine]);
      const result = await parseJsonlFile(path);
      expect(result.entries).toHaveLength(1);
      expect(result.skipped.apiErrors).toBe(1);
      unlinkSync(path);
    });

    it('filters synthetic model entries', async () => {
      const path = writeTempJsonl('synthetic.jsonl', [validLine, syntheticLine]);
      const result = await parseJsonlFile(path);
      expect(result.entries).toHaveLength(1);
      expect(result.skipped.synthetic).toBe(1);
      unlinkSync(path);
    });

    it('counts invalid JSON as errors', async () => {
      const path = writeTempJsonl('invalid.jsonl', [validLine, 'not json at all', '{"broken']);
      const result = await parseJsonlFile(path);
      expect(result.entries).toHaveLength(1);
      expect(result.errors).toBe(2);
      unlinkSync(path);
    });

    it('counts schema validation failures as errors', async () => {
      // Has message.usage (so it's not skipped) but timestamp is invalid
      const badSchema = JSON.stringify({ timestamp: 'not-a-date', message: { usage: { input_tokens: 1, output_tokens: 1 } } });
      const path = writeTempJsonl('bad-schema.jsonl', [validLine, badSchema]);
      const result = await parseJsonlFile(path);
      expect(result.entries).toHaveLength(1);
      expect(result.errors).toBe(1);
      unlinkSync(path);
    });

    it('defaults cache tokens to 0', async () => {
      const path = writeTempJsonl('no-cache.jsonl', [validLine]);
      const result = await parseJsonlFile(path);
      expect(result.entries[0].message.usage.cache_creation_input_tokens).toBe(0);
      expect(result.entries[0].message.usage.cache_read_input_tokens).toBe(0);
      unlinkSync(path);
    });

    it('handles empty files', async () => {
      const path = writeTempJsonl('empty.jsonl', ['']);
      const result = await parseJsonlFile(path);
      expect(result.entries).toHaveLength(0);
      unlinkSync(path);
    });
  });

  describe('parseAllFiles', () => {
    it('combines entries from multiple files', async () => {
      const path1 = writeTempJsonl('multi1.jsonl', [validLine]);
      const path2 = writeTempJsonl('multi2.jsonl', [validLine]);
      const result = await parseAllFiles([path1, path2]);
      expect(result.entries).toHaveLength(2);
      expect(result.errors).toBe(0);
      unlinkSync(path1);
      unlinkSync(path2);
    });

    it('combines errors and skipped counts', async () => {
      const path1 = writeTempJsonl('comb1.jsonl', [validLine, apiErrorLine]);
      const path2 = writeTempJsonl('comb2.jsonl', [syntheticLine, 'bad json']);
      const result = await parseAllFiles([path1, path2]);
      expect(result.entries).toHaveLength(1);
      expect(result.skipped.apiErrors).toBe(1);
      expect(result.skipped.synthetic).toBe(1);
      expect(result.errors).toBe(1);
      unlinkSync(path1);
      unlinkSync(path2);
    });

    it('handles empty file list', async () => {
      const result = await parseAllFiles([]);
      expect(result.entries).toHaveLength(0);
      expect(result.errors).toBe(0);
    });

    it('handles more than BATCH_SIZE (20) files', async () => {
      const paths: string[] = [];
      for (let i = 0; i < 25; i++) {
        paths.push(writeTempJsonl(`batch-${i}.jsonl`, [validLine]));
      }
      const result = await parseAllFiles(paths);
      expect(result.entries).toHaveLength(25);
      expect(result.errors).toBe(0);
      for (const p of paths) unlinkSync(p);
    });
  });
}
