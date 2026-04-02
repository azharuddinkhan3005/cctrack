import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMcpServer } from './server.js';
import { setPricingData } from '../core/pricing.js';
import type { PricingData } from '../core/types.js';

/**
 * Tests for MCP server tool handlers.
 *
 * Strategy: Create a fixture directory with JSONL data, point HOME and
 * CLAUDE_CONFIG_DIR at it, then invoke tool handlers directly through the
 * McpServer internal API. Each tool handler calls loadData() internally,
 * which reads from the fixture directory.
 *
 * This covers the ~88% of uncovered lines in server.ts (the handler bodies).
 */

const testPricing: PricingData = {
  version: 'test',
  models: {
    'claude-sonnet-4-20250514': {
      input_cost_per_million: 3.0,
      output_cost_per_million: 15.0,
      cache_creation_cost_per_million: 3.75,
      cache_read_cost_per_million: 0.30,
      context_window: 200000,
    },
    'claude-opus-4-20250514': {
      input_cost_per_million: 15.0,
      output_cost_per_million: 75.0,
      cache_creation_cost_per_million: 18.75,
      cache_read_cost_per_million: 1.50,
      context_window: 200000,
    },
  },
  aliases: {},
};

const tmpBase = join(tmpdir(), `cctrackr-mcp-handler-test-${Date.now()}`);
const projectsDir = join(tmpBase, '.claude', 'projects');
const sessionDir = join(projectsDir, '-Users-ci-Sites-testproject', 'session-mcp001');

function makeJsonlLine(overrides: {
  timestamp?: string;
  sessionId?: string;
  model?: string;
  input?: number;
  output?: number;
  requestId?: string;
} = {}): string {
  return JSON.stringify({
    timestamp: overrides.timestamp ?? '2026-03-25T14:30:00Z',
    sessionId: overrides.sessionId ?? 'session-mcp001',
    cwd: '/Users/ci/Sites/testproject',
    message: {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      model: overrides.model ?? 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: overrides.input ?? 5000,
        output_tokens: overrides.output ?? 2000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    },
    costUSD: 0.05,
    requestId: overrides.requestId ?? `req_${Math.random().toString(36).slice(2, 10)}`,
  });
}

/**
 * Call a tool handler through the McpServer internal _registeredTools map.
 */
async function callTool(server: ReturnType<typeof createMcpServer>, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const internal = server as unknown as {
    _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }>;
  };
  const tool = internal._registeredTools[toolName];
  if (!tool) throw new Error(`Tool "${toolName}" not found`);
  return tool.handler(args, {});
}

describe('MCP server tool handlers', () => {
  let origHome: string | undefined;
  let origConfigDir: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = tmpBase;
    process.env.CLAUDE_CONFIG_DIR = join(tmpBase, '.claude');

    setPricingData(testPricing);

    mkdirSync(sessionDir, { recursive: true });
    const lines = [
      makeJsonlLine({ timestamp: '2026-03-25T10:00:00Z', requestId: 'req_mcp1' }),
      makeJsonlLine({ timestamp: '2026-03-25T11:00:00Z', requestId: 'req_mcp2' }),
      makeJsonlLine({ timestamp: '2026-03-25T14:00:00Z', requestId: 'req_mcp3', model: 'claude-opus-4-20250514' }),
    ];
    writeFileSync(join(sessionDir, 'usage.jsonl'), lines.join('\n') + '\n');
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = origConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('get_daily_usage returns daily aggregation', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_daily_usage', { since: '2026-03-25', until: '2026-03-25' }) as { content: Array<{ text: string }> };

    expect(result.content).toHaveLength(1);
    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('date');
    expect(data[0]).toHaveProperty('tokens');
    expect(data[0]).toHaveProperty('cost');
  });

  it('get_daily_usage accepts mode parameter', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_daily_usage', {
      since: '2026-03-25',
      until: '2026-03-25',
      mode: 'display',
    }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data)).toBe(true);
  });

  it('get_session_list returns session aggregation', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_session_list', {}) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('sessionId');
  });

  it('get_session_list respects limit parameter', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_session_list', { limit: 1 }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data.length).toBeLessThanOrEqual(1);
  });

  it('get_session_detail returns detail for valid session', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_session_detail', { session_id: 'session-mcp001' }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('session');
    expect(data).toHaveProperty('requests');
    expect(data.session.sessionId).toBe('session-mcp001');
  });

  it('get_session_detail returns error message for unknown session', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_session_detail', { session_id: 'nonexistent-session' }) as { content: Array<{ text: string }> };

    expect(result.content[0].text).toContain('No session found');
    expect(result.content[0].text).toContain('nonexistent-session');
  });

  it('get_session_detail supports prefix matching', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_session_detail', { session_id: 'session-mcp' }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('session');
    expect(data.session.sessionId).toBe('session-mcp001');
  });

  it('get_budget_status returns budget info', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_budget_status', {}) as { content: Array<{ text: string }> };

    // Budget might be empty if no budget is configured, but it should be valid JSON
    const data = JSON.parse(result.content[0].text);
    expect(typeof data).toBe('object');
  });

  it('get_roi_analysis returns ROI calculation', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_roi_analysis', {
      plan: 'max5',
      since: '2026-03-25',
      until: '2026-03-25',
    }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('plan', 'max5');
    expect(data).toHaveProperty('total_tokens');
    expect(data).toHaveProperty('api_equivalent_cost');
    expect(data).toHaveProperty('subscription_cost', 100);
    expect(data).toHaveProperty('savings');
    expect(data).toHaveProperty('projected_monthly_cost');
    expect(data).toHaveProperty('days_analyzed');
  });

  it('get_roi_analysis defaults to max5 plan', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_roi_analysis', {
      since: '2026-03-25',
      until: '2026-03-25',
    }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data.plan).toBe('max5');
  });

  it('get_rate_limits returns burn rate data', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_rate_limits', {}) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('burn_rate');
  });

  it('get_dashboard_data returns complete dashboard structure', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_dashboard_data', {
      since: '2026-03-25',
      until: '2026-03-25',
    }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('generated_at');
    expect(data).toHaveProperty('totals');
    expect(data).toHaveProperty('daily');
    expect(data).toHaveProperty('monthly');
    expect(data).toHaveProperty('sessions');
    expect(data).toHaveProperty('projects');
    expect(data).toHaveProperty('models');
    expect(data).toHaveProperty('heatmap');
    expect(data.heatmap).toHaveLength(7);
  });

  it('get_dashboard_data supports project filter', async () => {
    const server = createMcpServer();
    const result = await callTool(server, 'get_dashboard_data', {
      project: 'testproject',
    }) as { content: Array<{ text: string }> };

    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveProperty('totals');
    // Should have data since we're filtering by the project we set up
    expect(data.totals.request_count).toBeGreaterThan(0);
  });
});
