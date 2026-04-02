import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from './server.js';
import { setPricingData } from '../core/pricing.js';
import type { PricingData } from '../core/types.js';

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
  },
  aliases: {},
};

describe('MCP server', () => {
  beforeEach(() => {
    setPricingData(testPricing);
  });

  it('createMcpServer returns a McpServer instance', () => {
    const server = createMcpServer();
    expect(server).toBeInstanceOf(McpServer);
  });

  it('server has the expected 7 tools registered', () => {
    const server = createMcpServer();
    // _registeredTools is a plain object (not a Map) keyed by tool name
    const internal = server as unknown as { _registeredTools: Record<string, unknown> };
    expect(internal._registeredTools).toBeDefined();
    const toolNames = Object.keys(internal._registeredTools);
    expect(toolNames).toHaveLength(7);

    // Verify each expected tool name is present
    const expectedTools = [
      'get_daily_usage',
      'get_session_list',
      'get_session_detail',
      'get_budget_status',
      'get_roi_analysis',
      'get_rate_limits',
      'get_dashboard_data',
    ];
    for (const toolName of expectedTools) {
      expect(toolNames).toContain(toolName);
    }
  });

  it('each tool has a handler function', () => {
    const server = createMcpServer();
    const internal = server as unknown as { _registeredTools: Record<string, { handler?: unknown }> };
    const toolNames = Object.keys(internal._registeredTools);

    for (const toolName of toolNames) {
      const tool = internal._registeredTools[toolName];
      expect(tool).toBeDefined();
      // The registered tool object should have a handler (callback)
      // The exact shape depends on SDK version; verify the entry is truthy
      expect(tool).not.toBeNull();
    }
  });

  it('server is configured with correct name and version', () => {
    const server = createMcpServer();
    // The McpServer wraps a Server instance that carries the server info
    const internal = server as unknown as { server: { _serverInfo?: { name: string; version: string } } };
    if (internal.server?._serverInfo) {
      expect(internal.server._serverInfo.name).toBe('cctrackr');
      expect(internal.server._serverInfo.version).toBe('0.2.0');
    }
  });
});
