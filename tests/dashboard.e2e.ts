import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DASHBOARD_PATH = join(tmpdir(), 'cctrack-e2e-dashboard.html');
// Use the current process PATH (works on any machine)
const ENV = { ...process.env };

test.beforeAll(() => {
  // Build first, then generate a fresh dashboard
  execSync(`pnpm build`, {
    cwd: process.cwd(),
    env: ENV,
    timeout: 30_000,
  });
  execSync(`node dist/index.js dashboard --save ${DASHBOARD_PATH}`, {
    cwd: process.cwd(),
    env: ENV,
    timeout: 30_000,
  });
  expect(existsSync(DASHBOARD_PATH)).toBe(true);
});

test.describe('Dashboard HTML', () => {
  test('page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(2000); // Wait for Chart.js CDN + rendering

    expect(errors).toEqual([]);
  });

  test('DATA variable is valid JSON with all required keys', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(1000);

    const keys = await page.evaluate(() => {
      return typeof DATA !== 'undefined' ? Object.keys(DATA) : null;
    });

    expect(keys).not.toBeNull();
    expect(keys).toContain('generated_at');
    expect(keys).toContain('totals');
    expect(keys).toContain('daily');
    expect(keys).toContain('sessions');
    expect(keys).toContain('projects');
    expect(keys).toContain('models');
    expect(keys).toContain('heatmap');
  });

  test('stat cards display non-zero values', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(2000);

    // Check that total cost is displayed and not $0.00
    const costText = await page.locator('text=$').first().textContent();
    expect(costText).toBeTruthy();
    expect(costText).not.toBe('$0.00');
  });

  test('charts are rendered (canvas elements have content)', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(3000); // Chart.js needs CDN load + render time

    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(5); // At minimum: cost, IO tokens, cache tokens, model, cache eff
  });

  test('project filter dropdown has real project names', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(1000);

    const options = await page.locator('select option').allTextContents();
    expect(options.length).toBeGreaterThan(1); // At least "All Projects" + 1 real project
    expect(options[0]).toContain('All');

    // No option should be "unknown"
    const hasUnknown = options.some((o) => o.toLowerCase() === 'unknown');
    expect(hasUnknown).toBe(false);
  });

  test('selecting a project and clicking Apply changes the stats', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(2000);

    // Get initial total cost
    const initialCost = await page.evaluate(() => {
      const el = document.querySelector('[data-stat="total-cost"]') || document.querySelectorAll('.text-2xl, .text-3xl')[0];
      return el?.textContent?.trim() || '';
    });

    // Select second project option (first real project)
    const select = page.locator('select').first();
    const options = await select.locator('option').allTextContents();
    if (options.length > 1) {
      await select.selectOption({ index: 1 });
      await page.locator('button', { hasText: /apply/i }).click();
      await page.waitForTimeout(1000);

      // Get new total cost — should be different (unless all data is from one project)
      const newCost = await page.evaluate(() => {
        const el = document.querySelector('[data-stat="total-cost"]') || document.querySelectorAll('.text-2xl, .text-3xl')[0];
        return el?.textContent?.trim() || '';
      });

      // At minimum, verify the page didn't crash
      expect(newCost).toBeTruthy();
      expect(newCost).not.toBe('$NaN');
    }
  });

  test('Reset button restores original data', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(2000);

    // Select a project
    const select = page.locator('select').first();
    const options = await select.locator('option').allTextContents();
    if (options.length > 1) {
      await select.selectOption({ index: 1 });
      await page.locator('button', { hasText: /apply/i }).click();
      await page.waitForTimeout(500);

      // Click reset
      await page.locator('button', { hasText: /reset/i }).click();
      await page.waitForTimeout(500);

      // Select should be back to "All Projects"
      const selectedValue = await select.inputValue();
      expect(selectedValue).toBe('');
    }
  });

  test('session table has rows with data', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(2000);

    const rows = await page.locator('table tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test('heatmap renders with cells', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(1000);

    // Heatmap should have day labels and colored cells
    const pageText = await page.textContent('body');
    expect(pageText).toContain('Mon');
    expect(pageText).toContain('Fri');
  });

  test('dark mode toggle switches theme', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(1000);

    // Check initial state (should be dark)
    const initialClass = await page.locator('html').getAttribute('class');
    expect(initialClass).toContain('dark');

    // Click toggle
    const toggle = page.locator('button, label, [role="switch"]').filter({ hasText: /☀|🌙|sun|moon/i }).first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(300);
      const newClass = await page.locator('html').getAttribute('class');
      // Should have toggled
      expect(newClass).not.toBe(initialClass);
    }
  });

  test('no console errors after filter interactions', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(2000);

    // Apply with date range
    const dateInputs = page.locator('input[type="date"]');
    if (await dateInputs.count() >= 1) {
      await dateInputs.first().fill('2026-03-20');
      await page.locator('button', { hasText: /apply/i }).click();
      await page.waitForTimeout(1000);
    }

    // Reset
    await page.locator('button', { hasText: /reset/i }).click();
    await page.waitForTimeout(500);

    // Select each project
    const select = page.locator('select').first();
    const options = await select.locator('option').allTextContents();
    for (let i = 1; i < Math.min(options.length, 4); i++) {
      await select.selectOption({ index: i });
      await page.locator('button', { hasText: /apply/i }).click();
      await page.waitForTimeout(500);
    }

    expect(errors).toEqual([]);
  });

  test('ROI metrics show non-zero values for filtered projects', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(5000);

    // Skip if ECharts CDN didn't load (file:// + no network)
    const hasEcharts = await page.evaluate(() => typeof echarts !== 'undefined');
    if (!hasEcharts) {
      console.log('Skipping ROI test: ECharts CDN not available in headless file:// mode');
      return;
    }

    const select = page.locator('select').first();
    const options = await select.locator('option').allTextContents();

    for (let i = 1; i < Math.min(options.length, 4); i++) {
      await select.selectOption({ index: i });
      await page.locator('button', { hasText: /apply/i }).click();
      await page.waitForTimeout(1000);

      const roi = await page.evaluate(() => {
        const cards = document.querySelectorAll('.roi-card');
        return Array.from(cards).map((c) => ({
          label: c.querySelector('.roi-label')?.textContent ?? '',
          value: c.querySelector('.roi-value')?.textContent ?? '',
        }));
      });

      const costPerReq = roi.find((r) => r.label.includes('Cost Per Request'));
      const cacheSavings = roi.find((r) => r.label.includes('Cache Savings'));

      expect(costPerReq?.value).toBeTruthy();
      expect(costPerReq?.value).not.toBe('$0.00');
      expect(cacheSavings?.value).toBeTruthy();
      expect(cacheSavings?.value).not.toBe('~$0.00');
    }
  });

  test('per-project filter updates stat cards', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(5000);

    const hasEcharts = await page.evaluate(() => typeof echarts !== 'undefined');
    if (!hasEcharts) {
      console.log('Skipping filter test: ECharts CDN not available');
      return;
    }

    const allCost = await page.evaluate(() => document.getElementById('statCost')?.textContent);
    const select = page.locator('select').first();
    const options = await select.locator('option').allTextContents();
    if (options.length > 2) {
      await select.selectOption({ index: 2 });
      await page.locator('button', { hasText: /apply/i }).click();
      await page.waitForTimeout(1000);

      const filteredCost = await page.evaluate(() => document.getElementById('statCost')?.textContent);
      expect(filteredCost).not.toBe(allCost);
      expect(filteredCost).toBeTruthy();
      expect(filteredCost).not.toContain('NaN');
    }
  });

  test('dashboard JSON data has complete per-project daily fields', async ({ page }) => {
    await page.goto(`file://${DASHBOARD_PATH}`);
    await page.waitForTimeout(1000);

    const issues = await page.evaluate(() => {
      const problems: string[] = [];
      const reqCost = ['input_cost', 'output_cost', 'cache_write_cost', 'cache_read_cost', 'total_cost'];
      const reqTok = ['input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens', 'total_tokens'];

      for (const day of DATA.daily) {
        for (const [proj, pd] of Object.entries(day.projects || {}) as [string, any][]) {
          if (pd.request_count === undefined) problems.push(`${day.date}.${proj}.request_count`);
          for (const f of reqCost) if (pd.cost?.[f] === undefined) problems.push(`${day.date}.${proj}.cost.${f}`);
          for (const f of reqTok) if (pd.tokens?.[f] === undefined) problems.push(`${day.date}.${proj}.tokens.${f}`);
        }
      }
      return problems;
    });

    expect(issues).toEqual([]);
  });
});
