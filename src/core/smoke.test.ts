import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Smoke tests run the real CLI binary against synthetic fixture data.
 * We create a temp directory with JSONL files that mimic the Claude Code
 * project structure, then point the CLI at it via CLAUDE_CONFIG_DIR.
 *
 * This ensures tests pass in CI where ~/.claude/projects/ does not exist.
 */
describe('CLI smoke test', { timeout: 30_000 }, () => {
  const fixtureDir = join(tmpdir(), `cctrack-smoke-${Date.now()}`);
  const projectsDir = join(fixtureDir, 'projects');
  // Encoded project dir: simulates /Users/ci/Sites/testproject
  const encodedProject = '-Users-ci-Sites-testproject';
  const sessionDir = join(projectsDir, encodedProject, 'session-abc123');

  function makeEntry(overrides: {
    timestamp?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    sessionId?: string;
  } = {}): string {
    return JSON.stringify({
      timestamp: overrides.timestamp ?? '2026-03-25T14:30:00Z',
      sessionId: overrides.sessionId ?? 'session-abc123',
      cwd: '/Users/ci/Sites/testproject',
      message: {
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        model: overrides.model ?? 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: overrides.input_tokens ?? 5000,
          output_tokens: overrides.output_tokens ?? 2000,
          cache_creation_input_tokens: overrides.cache_creation_input_tokens ?? 1000,
          cache_read_input_tokens: overrides.cache_read_input_tokens ?? 500,
        },
      },
      costUSD: 0.05,
      requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    });
  }

  beforeAll(() => {
    mkdirSync(sessionDir, { recursive: true });

    // Create fixture JSONL with multiple entries across different times
    const lines = [
      // Entries on 2026-03-25 (covers --since 2026-03-25 and --since 2026-03-24)
      makeEntry({ timestamp: '2026-03-25T09:00:00Z', input_tokens: 3000, output_tokens: 1000 }),
      makeEntry({ timestamp: '2026-03-25T10:30:00Z', input_tokens: 8000, output_tokens: 3000 }),
      makeEntry({ timestamp: '2026-03-25T14:00:00Z', input_tokens: 5000, output_tokens: 2000, model: 'claude-opus-4-20250514' }),
      // Entries on 2026-03-26
      makeEntry({ timestamp: '2026-03-26T08:00:00Z', input_tokens: 4000, output_tokens: 1500 }),
      makeEntry({ timestamp: '2026-03-26T16:00:00Z', input_tokens: 6000, output_tokens: 2500 }),
      // Entry on 2026-03-27 (today in the fixture)
      makeEntry({ timestamp: '2026-03-27T12:00:00Z', input_tokens: 7000, output_tokens: 3000 }),
    ];

    writeFileSync(join(sessionDir, 'usage.jsonl'), lines.join('\n') + '\n');
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  const run = (args: string) => {
    const out = execSync(`node dist/index.js ${args}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: process.env.PATH,
        CLAUDE_CONFIG_DIR: fixtureDir,
        // Prevent tests from reading the user's real data
        HOME: fixtureDir,
      },
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
    expect(data.length).toBeGreaterThan(0);
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
    // Blocks may be empty in CI since entries may fall outside the current 5h window
    // Just verify the structure is valid JSON array
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

  it('session <id> --json returns session detail with requests array', () => {
    // Use a prefix of the known session ID from fixture data
    const out = run('session session-abc123 --json');
    const data = JSON.parse(out);
    expect(data).toHaveProperty('session');
    expect(data).toHaveProperty('requests');
    expect(Array.isArray(data.requests)).toBe(true);
    expect(data.requests.length).toBeGreaterThan(0);
    // Each request should have the expected shape
    const req = data.requests[0];
    expect(req).toHaveProperty('timestamp');
    expect(req).toHaveProperty('model');
    expect(req).toHaveProperty('input_tokens');
    expect(req).toHaveProperty('output_tokens');
    expect(req).toHaveProperty('cost');
    // Session aggregate should have standard fields
    expect(data.session).toHaveProperty('sessionId');
    expect(data.session.sessionId).toBe('session-abc123');
    expect(data.session).toHaveProperty('project');
    expect(data.session).toHaveProperty('primaryModel');
  });

  it('session <id> --hierarchy --json returns hierarchy tree', () => {
    const out = run('session session-abc123 --hierarchy --json');
    const data = JSON.parse(out);
    // Should be an AgentNode-shaped object (the root node)
    expect(data).toHaveProperty('id');
    expect(data.id).toBe('session-abc123');
    expect(data).toHaveProperty('type');
    expect(data.type).toBe('session');
    expect(data).toHaveProperty('ownTokens');
    expect(data).toHaveProperty('ownCost');
    expect(data).toHaveProperty('totalTokens');
    expect(data).toHaveProperty('totalCost');
    expect(data).toHaveProperty('requestCount');
    expect(data).toHaveProperty('children');
    expect(Array.isArray(data.children)).toBe(true);
    // No subagents in fixture data, so children should be empty
    expect(data.children).toHaveLength(0);
    // totalTokens should equal ownTokens when no children
    expect(data.totalTokens).toBe(data.ownTokens);
    expect(data.totalCost).toBe(data.ownCost);
  });

  it('mcp --help outputs MCP server description', () => {
    const out = run('mcp --help');
    expect(out).toContain('MCP');
    expect(out).toContain('server');
  });
});
