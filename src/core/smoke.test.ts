import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('CLI smoke test', () => {
  const run = (args: string) => {
    const out = execSync(`node dist/index.js ${args}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return out.trim();
  };

  it('--version outputs semver', () => {
    expect(run('--version')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('daily --json returns valid array', () => {
    const out = run('daily --since 2026-01-01 --until 2026-01-01 --json');
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
  });

  it('daily --json entries have correct shape', () => {
    const out = run('daily --json');
    const data = JSON.parse(out);
    expect(data.length).toBeGreaterThan(0); // Fail explicitly if no data
    if (data.length > 0) {
      const entry = data[0];
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('tokens');
      expect(entry).toHaveProperty('cost');
      expect(entry).toHaveProperty('request_count');
      expect(entry.tokens).toHaveProperty('input_tokens');
      expect(entry.tokens).toHaveProperty('output_tokens');
      expect(entry.tokens).toHaveProperty('cache_write_tokens');
      expect(entry.tokens).toHaveProperty('cache_read_tokens');
      expect(entry.cost).toHaveProperty('total_cost');
    }
  });

  it('monthly --json returns valid array', () => {
    const out = run('monthly --json');
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('month');
    }
  });

  it('session --json returns valid array', () => {
    const out = run('session --json');
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('sessionId');
      expect(data[0]).toHaveProperty('primaryModel');
    }
  });

  it('dashboard --json returns valid object with all keys', () => {
    const out = run('dashboard --json');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('generated_at');
    expect(data).toHaveProperty('totals');
    expect(data).toHaveProperty('daily');
    expect(data).toHaveProperty('monthly');
    expect(data).toHaveProperty('sessions');
    expect(data).toHaveProperty('projects');
    expect(data).toHaveProperty('models');
    expect(data).toHaveProperty('heatmap');
    expect(data.heatmap).toHaveLength(7);
    expect(data.heatmap[0]).toHaveLength(24);
  });

  it('pricing status outputs source info', () => {
    const out = run('pricing status');
    expect(out).toContain('Source:');
    expect(out).toContain('Models:');
  });

  it('export csv outputs header row', () => {
    const out = run('export csv --since 2026-01-01 --until 2026-01-01');
    const lines = out.split('\n');
    expect(lines[0]).toContain('date,session_id,project,model');
  });

  it('roi --plan max20 --json returns valid object', () => {
    const out = run('roi --plan max20 --json');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('total_tokens');
    expect(data).toHaveProperty('api_equivalent_cost');
    expect(data).toHaveProperty('subscription_cost');
    expect(data).toHaveProperty('savings');
    expect(data).toHaveProperty('projected_monthly_cost');
  });

  it('blocks command runs without error', () => {
    const out = run('blocks --json');
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('block_start');
    expect(data[0]).toHaveProperty('request_count');
    expect(data[0]).toHaveProperty('cost');
  });

  it('statusline runs without error', () => {
    const out = run('statusline --json');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('today_cost');
    expect(data).toHaveProperty('model');
    expect(data).toHaveProperty('total_tokens');
  });

  it('config get runs without error', () => {
    const out = run('config get');
    expect(out).toContain('Budget');
  });

  it('daily --csv has correct header', () => {
    const out = run('daily --since 2026-01-01 --until 2026-01-01 --csv');
    const lines = out.split('\n');
    expect(lines[0]).toBe('date,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,cost');
  });

  it('roi accepts fuzzy plan name "200"', () => {
    const out = run('roi --plan 200 --json');
    const data = JSON.parse(out);
    expect(data.plan).toBe('max20');
    expect(data.subscription_cost).toBe(200);
  });

  it('roi accepts fuzzy plan name "max"', () => {
    const out = run('roi --plan max --json');
    const data = JSON.parse(out);
    expect(data.plan).toBe('max5');
  });

  it('limits --json returns valid structure', () => {
    const out = run('limits --json');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('prediction');
    expect(data).toHaveProperty('consumption');
    expect(data.prediction).toHaveProperty('model_family');
    expect(data.prediction).toHaveProperty('current_consumption');
    expect(data.consumption).toHaveProperty('billable_tokens');
  });

  it('pricing list --json returns model data', () => {
    const out = run('pricing list --json');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('models');
    expect(data).toHaveProperty('aliases');
    expect(Object.keys(data.models).length).toBeGreaterThanOrEqual(10);
  });

  it('export json returns valid dashboard structure', () => {
    const out = run('export json --since 2026-03-25');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('totals');
    expect(data).toHaveProperty('daily');
    expect(data).toHaveProperty('sessions');
  });

  it('daily --mode display works', () => {
    const out = run('daily --json --mode display --since 2026-03-24');
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
  });

  it('daily --mode compare works', () => {
    const out = run('daily --json --mode compare --since 2026-03-24');
    const data = JSON.parse(out);
    expect(Array.isArray(data)).toBe(true);
  });

  it('invalid --mode exits with non-zero code', () => {
    let threw = false;
    try { run('daily --mode garbage --json --since 2026-01-01 --until 2026-01-01'); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  it('daily --breakdown --csv has model column', () => {
    const out = run('daily --csv --breakdown --since 2026-03-24');
    const header = out.split('\n')[0];
    expect(header).toContain('model');
  });

  it('session --csv has correct header', () => {
    const out = run('session --csv --since 2026-03-24');
    const header = out.split('\n')[0];
    expect(header).toContain('session_id');
    expect(header).toContain('project');
    expect(header).toContain('model');
  });

  it('dashboard --json has XSS-safe project names', () => {
    const out = run('dashboard --json');
    const data = JSON.parse(out);
    // All project names should be plain strings without HTML
    data.projects.forEach((p: { project: string }) => {
      expect(p.project).not.toContain('<');
      expect(p.project).not.toContain('>');
    });
  });
});
