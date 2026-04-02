import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { loadData } from '../core/data-pipeline.js';
import { filterEntries, aggregateDaily, aggregateSessions, buildDashboardData } from '../core/aggregator.js';
import { loadBudgetConfig, calculateBudgetStatus } from '../core/budget.js';
import { calculateBurnRate } from '../core/burnrate.js';
import { processEntry } from '../core/calculator.js';
import { initPricing } from '../core/pricing.js';
import type { CostMode, FilterOptions } from '../core/types.js';
import { parseCostMode } from '../utils/format.js';

/**
 * Create and configure the cctrackr MCP server.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'cctrackr',
    version: '0.2.0',
  });

  // --- Tool: get_daily_usage ---
  server.tool(
    'get_daily_usage',
    'Get daily usage breakdown with cost, tokens, and model info',
    {
      since: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      until: z.string().optional().describe('End date (YYYY-MM-DD)'),
      project: z.string().optional().describe('Filter by project name'),
      mode: z.string().optional().describe('Cost mode: calculate, display, compare'),
    },
    async (args) => {
      const { entries } = await loadData({ since: args.since, until: args.until });
      const filtered = filterEntries(entries, {
        since: args.since,
        until: args.until,
        project: args.project,
      });
      const mode = parseCostMode(args.mode ?? 'calculate');
      const daily = aggregateDaily(filtered, mode);
      return { content: [{ type: 'text' as const, text: JSON.stringify(daily, null, 2) }] };
    },
  );

  // --- Tool: get_session_list ---
  server.tool(
    'get_session_list',
    'List all sessions with cost and token summaries',
    {
      since: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      until: z.string().optional().describe('End date (YYYY-MM-DD)'),
      project: z.string().optional().describe('Filter by project name'),
      limit: z.number().optional().describe('Max sessions to return (default: 50)'),
    },
    async (args) => {
      const { entries } = await loadData({ since: args.since, until: args.until });
      const filtered = filterEntries(entries, {
        since: args.since,
        until: args.until,
        project: args.project,
      });
      const sessions = aggregateSessions(filtered, 'calculate');
      const limited = sessions.slice(0, args.limit ?? 50);
      return { content: [{ type: 'text' as const, text: JSON.stringify(limited, null, 2) }] };
    },
  );

  // --- Tool: get_session_detail ---
  server.tool(
    'get_session_detail',
    'Get per-request breakdown for a specific session',
    {
      session_id: z.string().describe('Session ID (or prefix) to look up'),
    },
    async (args) => {
      const { entries } = await loadData();
      const matching = entries.filter((e) => e.sessionId?.startsWith(args.session_id));
      if (matching.length === 0) {
        return { content: [{ type: 'text' as const, text: `No session found matching "${args.session_id}"` }] };
      }
      const fullId = matching[0].sessionId!;
      const sessionEntries = entries.filter((e) => e.sessionId === fullId);
      const requests = sessionEntries.map((e) => {
        const result = processEntry(e, 'calculate');
        return {
          timestamp: e.timestamp,
          model: e.message.model ?? 'unknown',
          input_tokens: result.tokens.input_tokens,
          output_tokens: result.tokens.output_tokens,
          cost: result.cost.total_cost,
        };
      }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const sessions = aggregateSessions(sessionEntries, 'calculate');
      return { content: [{ type: 'text' as const, text: JSON.stringify({ session: sessions[0], requests }, null, 2) }] };
    },
  );

  // --- Tool: get_budget_status ---
  server.tool(
    'get_budget_status',
    'Get current budget status (daily, monthly, block)',
    {},
    async () => {
      const { entries } = await loadData();
      const today = new Date().toISOString().slice(0, 10);
      const todayEntries = filterEntries(entries, { since: today, until: today });
      const daily = aggregateDaily(todayEntries, 'calculate');
      const todaySpend = daily.reduce((s, d) => s + d.cost.total_cost, 0);

      const budgetConfig = loadBudgetConfig();
      const result: Record<string, unknown> = {};

      if (budgetConfig.daily) {
        result.daily = calculateBudgetStatus(todaySpend, budgetConfig.daily);
      }
      if (budgetConfig.monthly) {
        const month = today.slice(0, 7);
        const monthEntries = filterEntries(entries, { since: `${month}-01` });
        const monthSpend = monthEntries.reduce((s, e) => {
          const r = processEntry(e, 'calculate');
          return s + r.cost.total_cost;
        }, 0);
        result.monthly = calculateBudgetStatus(monthSpend, budgetConfig.monthly);
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- Tool: get_roi_analysis ---
  server.tool(
    'get_roi_analysis',
    'Calculate ROI vs API-equivalent cost for a subscription plan',
    {
      plan: z.string().optional().describe('Plan: pro, max5, max20 (default: max5)'),
      since: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      until: z.string().optional().describe('End date (YYYY-MM-DD)'),
      project: z.string().optional().describe('Filter by project name'),
    },
    async (args) => {
      const { entries } = await loadData({ since: args.since, until: args.until });
      const filtered = filterEntries(entries, {
        since: args.since,
        until: args.until,
        project: args.project,
      });

      let totalCost = 0;
      let totalTokens = 0;
      for (const e of filtered) {
        const r = processEntry(e, 'calculate');
        totalCost += r.cost.total_cost;
        totalTokens += r.tokens.total_tokens;
      }

      const daily = aggregateDaily(filtered, 'calculate');
      const days = daily.length || 1;
      const projectedMonthly = (totalCost / days) * 30;

      const planCosts: Record<string, number> = { pro: 20, max5: 100, max20: 200 };
      const plan = args.plan ?? 'max5';
      const subCost = planCosts[plan] ?? 100;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            plan,
            total_tokens: totalTokens,
            api_equivalent_cost: totalCost,
            subscription_cost: subCost,
            savings: totalCost - subCost,
            projected_monthly_cost: projectedMonthly,
            days_analyzed: days,
          }, null, 2),
        }],
      };
    },
  );

  // --- Tool: get_rate_limits ---
  server.tool(
    'get_rate_limits',
    'Get current rate limit utilization and burn rate',
    {},
    async () => {
      const { entries } = await loadData();
      const burnRate = calculateBurnRate(entries, 'calculate');
      return { content: [{ type: 'text' as const, text: JSON.stringify({ burn_rate: burnRate }, null, 2) }] };
    },
  );

  // --- Tool: get_dashboard_data ---
  server.tool(
    'get_dashboard_data',
    'Generate complete dashboard data with all aggregations',
    {
      since: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      until: z.string().optional().describe('End date (YYYY-MM-DD)'),
      project: z.string().optional().describe('Filter by project name'),
    },
    async (args) => {
      const { entries } = await loadData({ since: args.since, until: args.until });
      const filtered = filterEntries(entries, {
        since: args.since,
        until: args.until,
        project: args.project,
      });
      const data = buildDashboardData(filtered, 'calculate');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 */
export async function startMcpServer(): Promise<void> {
  await initPricing();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
