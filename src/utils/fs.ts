import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function getProjectDirs(): string[] {
  const dirs: string[] = [];

  // Support CLAUDE_CONFIG_DIR env var
  const customDir = process.env.CLAUDE_CONFIG_DIR;
  if (customDir) {
    const projectsDir = join(customDir, 'projects');
    if (existsSync(projectsDir)) dirs.push(projectsDir);
  }

  // Default paths
  const home = homedir();
  const defaultPaths = [join(home, '.claude', 'projects'), join(home, '.config', 'claude', 'projects')];

  for (const p of defaultPaths) {
    if (existsSync(p)) dirs.push(p);
  }

  return [...new Set(dirs)];
}

/**
 * Build a map of JSONL file path -> project name.
 * The project name comes from the Claude project directory structure:
 * ~/.claude/projects/<encoded-project-dir>/<session-id>/<file>.jsonl
 *
 * The <encoded-project-dir> uses `-` to encode `/` in the absolute path.
 * e.g. `-Users-john-Sites-myproject` -> `myproject`
 *
 * This is the authoritative project identity. The `cwd` field in JSONL entries
 * can differ for subagents (e.g. `tradeforge/backend`) but they all live under
 * the same project directory.
 */
const fileProjectMap = new Map<string, string>();

export function findJsonlFiles(dirs: string[]): string[] {
  fileProjectMap.clear(); // Reset stale mappings from previous calls
  const files: string[] = [];

  for (const dir of dirs) {
    try {
      // Each child of the projects dir is an encoded project path
      const projectDirs = readdirSync(dir, { withFileTypes: true });
      for (const pdir of projectDirs) {
        if (!pdir.isDirectory()) continue;
        const projectName = decodeProjectDir(pdir.name);
        const projectPath = join(dir, pdir.name);
        walkCollect(projectPath, files, projectName);
      }
    } catch {
      // Skip dirs we can't read
    }
  }

  return files;
}

function walkCollect(dir: string, files: string[], projectName: string): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkCollect(fullPath, files, projectName);
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
        fileProjectMap.set(fullPath, projectName);
      }
    }
  } catch {
    // Skip dirs we can't read
  }
}

/**
 * Decode a Claude project directory name to the real project path.
 * e.g. `-Users-john-Sites-myproject` -> `/Users/john/Sites/myproject`
 *
 * Claude encodes `/` as `-`, but directory names can also contain `-`.
 * So we reconstruct the path by checking which segments exist on disk.
 */
const statCache = new Map<string, boolean>();
function dirExists(path: string): boolean {
  if (statCache.has(path)) return statCache.get(path)!;
  try { const r = statSync(path).isDirectory(); statCache.set(path, r); return r; }
  catch { statCache.set(path, false); return false; }
}

function decodeProjectDir(encoded: string): string {
  const segments = encoded.replace(/^-/, '').split('-');

  let currentPath = '/';
  let i = 0;
  while (i < segments.length) {
    let matched = false;
    // Try longest possible segment first (greedy match for hyphenated dir names)
    for (let len = segments.length - i; len >= 1; len--) {
      const candidate = segments.slice(i, i + len).join('-');
      // Try the candidate as-is, then with underscores replacing hyphens
      const variants = [candidate, candidate.replace(/-/g, '_')];
      let found = false;
      for (const variant of variants) {
        const testPath = join(currentPath, variant);
        if (dirExists(testPath)) {
            currentPath = testPath;
            i += len;
            matched = true;
            found = true;
            break;
        } else {
          // doesn't exist
        }
      }
      if (found) break;
    }
    if (!matched) {
      // Can't resolve on disk — use last segment as best guess
      // This handles test environments and deleted directories
      return segments[segments.length - 1] || encoded;
    }
  }

  // Return just the basename for clean display
  const parts = currentPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || encoded;
}

/**
 * Get the project name for a JSONL file path.
 * Uses the file -> project mapping built during findJsonlFiles.
 */
export function getProjectForFile(filePath: string): string {
  return fileProjectMap.get(filePath) ?? 'unknown';
}

/**
 * Get the project name for a usage entry.
 * After parsing, cwd is already normalized to the project name
 * (e.g. "tradeforge", "cctrack", "astral").
 */
export function extractProjectName(cwd: string): string {
  if (!cwd) return 'unknown';
  return cwd;
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const tmpBase = joinPath(tmpdir(), 'cctrack-test-fs');

  beforeEach(() => {
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  describe('findJsonlFiles', () => {
    it('finds .jsonl files inside project directories', () => {
      // Simulate: tmpBase/projects/-Users-me-myproject/session1/usage.jsonl
      const projDir = joinPath(tmpBase, '-Users-me-myproject', 'session1');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(joinPath(projDir, 'usage.jsonl'), '{}');

      const result = findJsonlFiles([tmpBase]);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('usage.jsonl');
    });

    it('maps files to project names via getProjectForFile', () => {
      // Use a dir name that can't resolve on filesystem, so it falls back to last segment
      const projDir = joinPath(tmpBase, '-xtest-zfake-myproject', 'sess');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(joinPath(projDir, 'data.jsonl'), '{}');

      const result = findJsonlFiles([tmpBase]);
      expect(result).toHaveLength(1);
      expect(getProjectForFile(result[0])).toBe('myproject');
    });

    it('returns empty for empty directory', () => {
      expect(findJsonlFiles([tmpBase])).toHaveLength(0);
    });

    it('returns empty for non-existent directory', () => {
      expect(findJsonlFiles([joinPath(tmpBase, 'nope')])).toHaveLength(0);
    });
  });

  describe('getProjectDirs', () => {
    it('includes CLAUDE_CONFIG_DIR when set', () => {
      const customDir = joinPath(tmpBase, 'custom');
      mkdirSync(joinPath(customDir, 'projects'), { recursive: true });

      const original = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = customDir;
      try {
        const dirs = getProjectDirs();
        expect(dirs.some((d) => d.includes('custom'))).toBe(true);
      } finally {
        if (original !== undefined) process.env.CLAUDE_CONFIG_DIR = original;
        else delete process.env.CLAUDE_CONFIG_DIR;
      }
    });

    it('deduplicates paths', () => {
      const dirs = getProjectDirs();
      expect(dirs.length).toBe(new Set(dirs).size);
    });
  });

  describe('extractProjectName', () => {
    it('returns cwd as-is (already normalized by parser)', () => {
      expect(extractProjectName('tradeforge')).toBe('tradeforge');
    });

    it('returns unknown for empty string', () => {
      expect(extractProjectName('')).toBe('unknown');
    });

    it('returns the normalized project name', () => {
      expect(extractProjectName('cctrack')).toBe('cctrack');
    });
  });

  describe('decodeProjectDir', () => {
    it('decodes encoded project directory to last component', () => {
      const projDir = joinPath(tmpBase, '-xtest-zfake-tradeforge', 'sess');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(joinPath(projDir, 'test.jsonl'), '{}');
      const files = findJsonlFiles([tmpBase]);
      expect(getProjectForFile(files[0])).toBe('tradeforge');
    });
  });
}
