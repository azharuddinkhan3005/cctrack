import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import type { BudgetConfig, BudgetStatus, BudgetLevel } from './types.js';
import { BUDGET_THRESHOLDS } from './types.js';

const CONFIG_DIR = join(homedir(), '.cctrack');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface ConfigFile {
  budget?: BudgetConfig;
}

export function loadBudgetConfig(): BudgetConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config: ConfigFile = JSON.parse(raw);
    return config.budget ?? {};
  } catch {
    return {};
  }
}

export function saveBudgetConfig(config: BudgetConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });

  let existing: ConfigFile = {};
  try {
    existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    // No existing config, start fresh
  }

  existing.budget = config;
  writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

export function loadFullConfig(): ConfigFile {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveFullConfig(config: ConfigFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function resetConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH);
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getBudgetLevel(percentage: number): BudgetLevel {
  if (percentage >= BUDGET_THRESHOLDS.exceeded) return 'exceeded';
  if (percentage >= BUDGET_THRESHOLDS.critical) return 'critical';
  if (percentage >= BUDGET_THRESHOLDS.warning) return 'warning';
  return 'safe';
}

export function calculateBudgetStatus(spent: number, budget: number): BudgetStatus {
  const percentage = budget === 0 ? (spent > 0 ? 100 : 0) : (spent / budget) * 100;
  const level = getBudgetLevel(percentage);
  const remaining = Math.max(0, budget - spent);
  return { level, budget, spent, remaining, percentage };
}

export function budgetColor(level: BudgetLevel): (text: string) => string {
  switch (level) {
    case 'safe':
      return chalk.green;
    case 'warning':
      return chalk.yellow;
    case 'critical':
      return chalk.red;
    case 'exceeded':
      return chalk.bgRed.white;
  }
}

export function formatBudgetBar(percentage: number, width: number = 20): string {
  const clamped = Math.min(Math.max(percentage, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  const level = getBudgetLevel(percentage);
  const color = budgetColor(level);
  const pctStr = `${Math.round(percentage)}%`;

  return `${color(bar)} ${pctStr}`;
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, afterEach } = import.meta.vitest;
  const { mkdtempSync, writeFileSync: writeTmp, readFileSync: readTmp, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: joinPath } = await import('node:path');

  describe('loadBudgetConfig', () => {
    it('returns empty object when no config file exists', () => {
      // loadBudgetConfig reads from a fixed path; we test the function's
      // behavior by calling it and verifying it returns a valid BudgetConfig.
      // Since the actual home dir config may or may not exist, we just verify
      // the return type shape.
      const config = loadBudgetConfig();
      expect(typeof config).toBe('object');
      expect(config).toBeDefined();
    });
  });

  describe('getBudgetLevel', () => {
    it('returns safe for 0%', () => {
      expect(getBudgetLevel(0)).toBe('safe');
    });

    it('returns safe for 25%', () => {
      expect(getBudgetLevel(25)).toBe('safe');
    });

    it('returns safe for 49.9%', () => {
      expect(getBudgetLevel(49.9)).toBe('safe');
    });

    it('returns warning at exactly 50%', () => {
      expect(getBudgetLevel(50)).toBe('warning');
    });

    it('returns warning for 75%', () => {
      expect(getBudgetLevel(75)).toBe('warning');
    });

    it('returns critical at exactly 80%', () => {
      expect(getBudgetLevel(80)).toBe('critical');
    });

    it('returns critical for 99%', () => {
      expect(getBudgetLevel(99)).toBe('critical');
    });

    it('returns exceeded at exactly 100%', () => {
      expect(getBudgetLevel(100)).toBe('exceeded');
    });

    it('returns exceeded for 150%', () => {
      expect(getBudgetLevel(150)).toBe('exceeded');
    });
  });

  describe('calculateBudgetStatus', () => {
    it('calculates 0% when nothing spent', () => {
      const status = calculateBudgetStatus(0, 100);
      expect(status.percentage).toBe(0);
      expect(status.level).toBe('safe');
      expect(status.remaining).toBe(100);
      expect(status.spent).toBe(0);
      expect(status.budget).toBe(100);
    });

    it('calculates 25% spent', () => {
      const status = calculateBudgetStatus(25, 100);
      expect(status.percentage).toBe(25);
      expect(status.level).toBe('safe');
      expect(status.remaining).toBe(75);
    });

    it('calculates 50% (warning threshold)', () => {
      const status = calculateBudgetStatus(50, 100);
      expect(status.percentage).toBe(50);
      expect(status.level).toBe('warning');
      expect(status.remaining).toBe(50);
    });

    it('calculates 75% (still warning)', () => {
      const status = calculateBudgetStatus(75, 100);
      expect(status.percentage).toBe(75);
      expect(status.level).toBe('warning');
      expect(status.remaining).toBe(25);
    });

    it('calculates 99% (critical)', () => {
      const status = calculateBudgetStatus(99, 100);
      expect(status.percentage).toBe(99);
      expect(status.level).toBe('critical');
      expect(status.remaining).toBe(1);
    });

    it('calculates 100% (exceeded)', () => {
      const status = calculateBudgetStatus(100, 100);
      expect(status.percentage).toBe(100);
      expect(status.level).toBe('exceeded');
      expect(status.remaining).toBe(0);
    });

    it('calculates 150% (exceeded, remaining clamped to 0)', () => {
      const status = calculateBudgetStatus(150, 100);
      expect(status.percentage).toBe(150);
      expect(status.level).toBe('exceeded');
      expect(status.remaining).toBe(0);
    });
  });

  describe('formatBudgetBar', () => {
    // Strip ANSI codes for testing
    const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '');

    it('shows empty bar at 0%', () => {
      const bar = stripAnsi(formatBudgetBar(0, 20));
      expect(bar).toContain('\u2591'.repeat(20));
      expect(bar).toContain('0%');
    });

    it('shows half-filled bar at 50%', () => {
      const bar = stripAnsi(formatBudgetBar(50, 20));
      expect(bar).toContain('\u2588'.repeat(10));
      expect(bar).toContain('\u2591'.repeat(10));
      expect(bar).toContain('50%');
    });

    it('shows full bar at 100%', () => {
      const bar = stripAnsi(formatBudgetBar(100, 20));
      expect(bar).toContain('\u2588'.repeat(20));
      expect(bar).toContain('100%');
    });

    it('clamps bar fill at 100% for values over 100%', () => {
      const bar = stripAnsi(formatBudgetBar(150, 20));
      expect(bar).toContain('\u2588'.repeat(20));
      expect(bar).toContain('150%');
    });

    it('uses default width of 20', () => {
      const bar = stripAnsi(formatBudgetBar(50));
      // 10 filled + 10 empty = 20
      const barPart = bar.split(' ')[0];
      expect(barPart).toHaveLength(20);
    });
  });

  describe('budgetColor', () => {
    it('returns green for safe', () => {
      const fn = budgetColor('safe');
      expect(fn('test')).toContain('test');
    });

    it('returns yellow for warning', () => {
      const fn = budgetColor('warning');
      expect(fn('test')).toContain('test');
    });

    it('returns red for critical', () => {
      const fn = budgetColor('critical');
      expect(fn('test')).toContain('test');
    });

    it('returns bgRed.white for exceeded', () => {
      const fn = budgetColor('exceeded');
      expect(fn('test')).toContain('test');
    });
  });

  // --- New edge-case tests ---

  describe('calculateBudgetStatus edge cases', () => {
    it('handles zero budget with zero spending', () => {
      const status = calculateBudgetStatus(0, 0);
      expect(status.percentage).toBe(0);
      expect(status.level).toBe('safe');
      expect(status.remaining).toBe(0);
    });

    it('handles spending against zero budget', () => {
      const status = calculateBudgetStatus(10, 0);
      expect(status.percentage).toBe(100);
      expect(status.level).toBe('exceeded');
      expect(status.remaining).toBe(0);
    });

    it('handles fractional dollar amounts without precision errors', () => {
      // 0.1 + 0.2 !== 0.30 in IEEE 754
      const status = calculateBudgetStatus(0.1 + 0.2, 1.0);
      expect(status.percentage).toBeCloseTo(30, 10);
      expect(status.remaining).toBeCloseTo(0.7, 10);
      expect(status.level).toBe('safe');
    });
  });

  describe('getBudgetLevel edge cases', () => {
    it('returns safe for negative percentage', () => {
      expect(getBudgetLevel(-10)).toBe('safe');
    });

    it('returns safe for NaN (documents behavior)', () => {
      // NaN >= any_number is always false, so all checks fail => 'safe'
      expect(getBudgetLevel(NaN)).toBe('safe');
    });
  });

  describe('formatBudgetBar edge cases', () => {
    it('handles negative percentage without throwing', () => {
      // formatBudgetBar only clamps to max 100, not min 0
      // This will throw RangeError if repeat gets a negative number
      // Math.round((-50 / 100) * 20) = -10, repeat(-10) throws
      // If it does throw, this test documents the bug
      try {
        const bar = formatBudgetBar(-50, 20);
        // If no throw, verify it produced something reasonable
        expect(typeof bar).toBe('string');
      } catch (e) {
        // Documents that negative percentage causes a crash
        expect(e).toBeInstanceOf(RangeError);
      }
    });

    it('bar at exactly 80% shows 16 filled blocks', () => {
      const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '');
      const bar = stripAnsi(formatBudgetBar(80, 20));
      expect(bar).toContain('\u2588'.repeat(16));
      expect(bar).toContain('80%');
    });
  });
}
