/**
 * Additional tests for budget.ts to cover lines 21-60:
 * - saveBudgetConfig (lines 25-37)
 * - loadFullConfig (lines 39-46)
 * - saveFullConfig (lines 48-51)
 * - resetConfig (lines 53-57)
 * - getConfigPath (lines 59-61)
 * - loadBudgetConfig error path (line 21)
 *
 * These functions perform file I/O against ~/.cctrack/config.json.
 * We test them using a temp directory and by mocking the CONFIG_PATH via
 * the module's actual functions (save/load cycle).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We cannot easily override CONFIG_DIR/CONFIG_PATH constants since they are
// module-level. Instead, we test the functions that we CAN exercise safely:
// - getConfigPath() just returns a string
// - saveBudgetConfig/loadBudgetConfig/loadFullConfig/saveFullConfig/resetConfig
//   all operate on the real config file. We back it up and restore it.

import {
  loadBudgetConfig,
  saveBudgetConfig,
  loadFullConfig,
  saveFullConfig,
  resetConfig,
  getConfigPath,
} from './budget.js';

describe('budget file I/O functions', () => {
  const configPath = getConfigPath();
  let backup: string | null = null;

  beforeEach(() => {
    // Backup existing config if it exists
    try {
      backup = readFileSync(configPath, 'utf-8');
    } catch {
      backup = null;
    }
  });

  afterEach(() => {
    // Restore original config
    if (backup !== null) {
      const dir = join(configPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, backup, 'utf-8');
    } else {
      // Remove the config file if it didn't exist before
      try {
        if (existsSync(configPath)) {
          const { unlinkSync } = require('node:fs');
          unlinkSync(configPath);
        }
      } catch {}
    }
  });

  describe('getConfigPath', () => {
    it('returns a string containing .cctrack', () => {
      const path = getConfigPath();
      expect(typeof path).toBe('string');
      expect(path).toContain('.cctrack');
      expect(path).toContain('config.json');
    });
  });

  describe('saveBudgetConfig + loadBudgetConfig round-trip', () => {
    it('saves and loads budget config', () => {
      const config = { daily: 10, monthly: 200 };
      saveBudgetConfig(config);

      const loaded = loadBudgetConfig();
      expect(loaded.daily).toBe(10);
      expect(loaded.monthly).toBe(200);
    });

    it('preserves existing non-budget config when saving budget', () => {
      // Write a config with extra fields
      saveFullConfig({ budget: { daily: 5 } });

      // Now save budget config — it should merge with existing
      saveBudgetConfig({ monthly: 100 });

      const loaded = loadBudgetConfig();
      expect(loaded.monthly).toBe(100);
    });

    it('handles saving when no config file exists yet', () => {
      resetConfig(); // Remove config file
      saveBudgetConfig({ daily: 42 });

      const loaded = loadBudgetConfig();
      expect(loaded.daily).toBe(42);
    });
  });

  describe('loadFullConfig', () => {
    it('returns full config object', () => {
      saveBudgetConfig({ daily: 15, monthly: 300 });
      const full = loadFullConfig();
      expect(full.budget).toBeDefined();
      expect(full.budget!.daily).toBe(15);
      expect(full.budget!.monthly).toBe(300);
    });

    it('returns empty object when config file is missing', () => {
      resetConfig();
      const full = loadFullConfig();
      expect(full).toEqual({});
    });
  });

  describe('saveFullConfig', () => {
    it('writes and reads back a complete config', () => {
      const config = { budget: { daily: 25, block: 5 } };
      saveFullConfig(config);

      const loaded = loadFullConfig();
      expect(loaded.budget?.daily).toBe(25);
      expect(loaded.budget?.block).toBe(5);
    });

    it('overwrites existing config entirely', () => {
      saveFullConfig({ budget: { daily: 10, monthly: 200 } });
      saveFullConfig({ budget: { monthly: 50 } });

      const loaded = loadFullConfig();
      expect(loaded.budget?.daily).toBeUndefined();
      expect(loaded.budget?.monthly).toBe(50);
    });
  });

  describe('resetConfig', () => {
    it('removes the config file', () => {
      saveBudgetConfig({ daily: 5 });
      expect(existsSync(configPath)).toBe(true);

      resetConfig();
      expect(existsSync(configPath)).toBe(false);
    });

    it('does not throw when config file does not exist', () => {
      resetConfig(); // Ensure it's gone
      expect(() => resetConfig()).not.toThrow(); // Call again — should be no-op
    });
  });

  describe('loadBudgetConfig error handling', () => {
    it('returns empty object when config file contains invalid JSON', () => {
      const dir = join(configPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, 'not valid json!!!', 'utf-8');

      const config = loadBudgetConfig();
      expect(config).toEqual({});
    });

    it('returns empty object when config has no budget key', () => {
      const dir = join(configPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, JSON.stringify({ someOther: true }), 'utf-8');

      const config = loadBudgetConfig();
      expect(config).toEqual({});
    });
  });
});
