/**
 * Additional tests for parser.ts to cover:
 * - Rate limit event detection and saving (lines 57-65)
 * - Project name override for cwd (line 79-81)
 * - Non-usage JSONL entries (line 42)
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { parseJsonlFile, parseAllFiles } from './parser.js';
import { findJsonlFiles, getProjectForFile } from '../utils/fs.js';

const tmpDir = join(tmpdir(), 'cctrack-test-parser-extra');

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function writeTempJsonl(name: string, lines: string[]): string {
  mkdirSync(tmpDir, { recursive: true });
  const path = join(tmpDir, name);
  writeFileSync(path, lines.join('\n'));
  return path;
}

describe('parseJsonlFile — rate limit event detection (lines 57-65)', () => {
  const EVENTS_FILE = join(homedir(), '.cctrack', 'rate-events.jsonl');
  let eventsBackup: string | null = null;

  beforeEach(() => {
    try { eventsBackup = readFileSync(EVENTS_FILE, 'utf-8'); } catch { eventsBackup = null; }
  });

  afterAll(() => {
    if (eventsBackup !== null) writeFileSync(EVENTS_FILE, eventsBackup, 'utf-8');
    else { try { unlinkSync(EVENTS_FILE); } catch {} }
  });

  it('saves rate limit events from API error entries', async () => {
    const rateLimitLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      message: {
        model: 'claude-opus-4-6-20260205',
        usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ text: 'You have hit your limit for this 5-hour window.' }],
      },
      isApiErrorMessage: true,
    });

    // Count events before
    let eventsBefore = 0;
    try {
      const existing = readFileSync(EVENTS_FILE, 'utf-8');
      eventsBefore = existing.split('\n').filter(Boolean).length;
    } catch {}

    const path = writeTempJsonl('rate-limit.jsonl', [rateLimitLine]);
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    // The entry should be counted as an API error
    expect(result.skipped.apiErrors).toBe(1);
    expect(result.entries).toHaveLength(0);

    // The rate limit event should have been appended to the events file
    const eventsContent = readFileSync(EVENTS_FILE, 'utf-8');
    const events = eventsContent.split('\n').filter(Boolean);
    expect(events.length).toBe(eventsBefore + 1);

    const lastEvent = JSON.parse(events[events.length - 1]);
    expect(lastEvent.model).toBe('claude-opus-4-6-20260205');
    expect(lastEvent.content).toContain('hit your limit');
  });

  it('detects "rate limit" text in API error content', async () => {
    const rateLimitLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ text: 'You have exceeded the rate limit. Please wait.' }],
      },
      isApiErrorMessage: true,
    });

    let eventsBefore = 0;
    try {
      const existing = readFileSync(EVENTS_FILE, 'utf-8');
      eventsBefore = existing.split('\n').filter(Boolean).length;
    } catch {}

    const path = writeTempJsonl('rate-limit2.jsonl', [rateLimitLine]);
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    expect(result.skipped.apiErrors).toBe(1);

    const eventsContent = readFileSync(EVENTS_FILE, 'utf-8');
    const events = eventsContent.split('\n').filter(Boolean);
    expect(events.length).toBe(eventsBefore + 1);
  });

  it('does not save non-rate-limit API errors to events file', async () => {
    const normalErrorLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ text: 'Internal server error. Please try again.' }],
      },
      isApiErrorMessage: true,
    });

    let eventsBefore = 0;
    try {
      const existing = readFileSync(EVENTS_FILE, 'utf-8');
      eventsBefore = existing.split('\n').filter(Boolean).length;
    } catch {}

    const path = writeTempJsonl('normal-error.jsonl', [normalErrorLine]);
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    expect(result.skipped.apiErrors).toBe(1);

    // Events file should not have grown
    let eventsAfter = 0;
    try {
      const content = readFileSync(EVENTS_FILE, 'utf-8');
      eventsAfter = content.split('\n').filter(Boolean).length;
    } catch {}
    expect(eventsAfter).toBe(eventsBefore);
  });

  it('handles API error with no content field gracefully', async () => {
    const noContentLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      isApiErrorMessage: true,
    });

    const path = writeTempJsonl('no-content.jsonl', [noContentLine]);
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    expect(result.skipped.apiErrors).toBe(1);
    expect(result.entries).toHaveLength(0);
  });
});

describe('parseJsonlFile — project name cwd override (line 79-81)', () => {
  it('overrides cwd with project name when project is known', async () => {
    // Create a fake project directory structure that findJsonlFiles can map
    const projBase = join(tmpDir, 'projects');
    const projDir = join(projBase, '-xtest-zfake-testproject', 'session1');
    mkdirSync(projDir, { recursive: true });

    const validLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      cwd: '/some/random/subdir',
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      requestId: 'req_1',
    });

    const filePath = join(projDir, 'usage.jsonl');
    writeFileSync(filePath, validLine);

    // Register the file with findJsonlFiles so getProjectForFile works
    findJsonlFiles([projBase]);

    const result = await parseJsonlFile(filePath);
    expect(result.entries).toHaveLength(1);
    // The cwd should be overridden to the project name
    expect(result.entries[0].cwd).toBe('testproject');
  });

  it('preserves original cwd when project is unknown', async () => {
    // Create a file NOT registered via findJsonlFiles
    const validLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      cwd: '/Users/me/my-project',
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      requestId: 'req_1',
    });

    const path = writeTempJsonl('unknown-proj.jsonl', validLine.split('\n'));
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    expect(result.entries).toHaveLength(1);
    // cwd should NOT be overridden since projectName is 'unknown'
    expect(result.entries[0].cwd).toBe('/Users/me/my-project');
  });
});

describe('parseJsonlFile — non-usage entries (line 42)', () => {
  it('skips entries without message.usage', async () => {
    const userMessageLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      type: 'user_message',
      message: {
        role: 'user',
        content: 'Hello world',
      },
    });

    const progressLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:01Z',
      type: 'progress',
      progress: 50,
    });

    const validLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:02Z',
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    const path = writeTempJsonl('mixed-entries.jsonl', [userMessageLine, progressLine, validLine]);
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    // Only the valid usage entry should be parsed
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toBe(0);
  });

  it('skips entries where message exists but usage is undefined', async () => {
    const noUsageLine = JSON.stringify({
      timestamp: '2026-03-25T10:00:00Z',
      message: {
        model: 'claude-sonnet-4-20250514',
        content: [{ text: 'some response' }],
      },
    });

    const path = writeTempJsonl('no-usage.jsonl', [noUsageLine]);
    const result = await parseJsonlFile(path);
    unlinkSync(path);

    expect(result.entries).toHaveLength(0);
    expect(result.errors).toBe(0); // Not counted as an error, just skipped
  });
});
