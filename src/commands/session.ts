import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CostMode, SessionAggregate, UsageEntry } from '../core/types.js';
import { loadData } from '../core/data-pipeline.js';
import { filterEntries, aggregateSessions } from '../core/aggregator.js';
import { processEntry } from '../core/calculator.js';
import { formatCost, formatTokens, formatDuration, shortenModelName, csvEscape, parseCostMode } from '../utils/format.js';
import { discoverAgentMeta, buildSessionHierarchy } from '../core/hierarchy.js';
import type { AgentNode } from '../core/hierarchy.js';
import { findJsonlFiles, getProjectDirs } from '../utils/fs.js';

function sessionDuration(session: SessionAggregate): number {
  return new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
}

function truncateId(id: string, length: number = 12): string {
  if (id.length <= length) return id;
  return id.slice(0, length) + '...';
}

function sessionToCsv(data: SessionAggregate[]): string {
  const lines: string[] = [];
  lines.push('session_id,project,model,duration_ms,requests,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,cost');

  for (const s of data) {
    const duration = sessionDuration(s);
    lines.push(
      [
        csvEscape(s.sessionId),
        csvEscape(s.project),
        csvEscape(s.primaryModel),
        duration,
        s.request_count,
        s.tokens.input_tokens,
        s.tokens.output_tokens,
        s.tokens.cache_write_tokens,
        s.tokens.cache_read_tokens,
        s.tokens.total_tokens,
        s.cost.total_cost.toFixed(6),
      ].join(','),
    );
  }

  return lines.join('\n');
}

function sessionToTable(data: SessionAggregate[], full: boolean = false): void {
  if (data.length === 0) {
    console.log(chalk.yellow('No sessions found for the specified range.'));
    return;
  }

  const table = new Table({
    head: ['Session ID', 'Project', 'Model', 'Duration', 'Requests', 'Tokens', 'Cost'].map((h) => chalk.cyan(h)),
    colAligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right'],
    style: { head: [], border: [] },
  });

  for (const s of data) {
    const duration = sessionDuration(s);
    table.push([
      full ? s.sessionId : truncateId(s.sessionId),
      full ? s.project : truncateId(s.project, 20),
      shortenModelName(s.primaryModel) + (Object.keys(s.models || {}).length > 1 ? chalk.dim(` +${Object.keys(s.models).length - 1}`) : ''),
      formatDuration(duration),
      s.request_count.toString(),
      formatTokens(s.tokens.total_tokens),
      formatCost(s.cost.total_cost),
    ]);
  }

  console.log(table.toString());

  const totalCost = data.reduce((sum, s) => sum + s.cost.total_cost, 0);
  const totalTokens = data.reduce((sum, s) => sum + s.tokens.total_tokens, 0);
  const totalRequests = data.reduce((sum, s) => sum + s.request_count, 0);
  console.log(
    chalk.bold(`\n${data.length} sessions, ${totalRequests} requests, ${formatTokens(totalTokens)} tokens, ${formatCost(totalCost)}`),
  );
}

interface RequestDetail {
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost: number;
  requestId?: string;
}

function getSessionDetail(entries: UsageEntry[], sessionId: string, mode: CostMode): { session: SessionAggregate; requests: RequestDetail[] } | null {
  // Find all entries matching session (prefix match)
  const matching = entries.filter((e) => e.sessionId?.startsWith(sessionId));
  if (matching.length === 0) return null;

  // Get the full sessionId from the first match
  const fullId = matching[0].sessionId!;
  const sessionEntries = entries.filter((e) => e.sessionId === fullId);

  // Build per-request details
  const requests: RequestDetail[] = sessionEntries
    .map((e) => {
      const result = processEntry(e, mode);
      return {
        timestamp: e.timestamp,
        model: e.message.model ?? 'unknown',
        input_tokens: result.tokens.input_tokens,
        output_tokens: result.tokens.output_tokens,
        cache_write_tokens: result.tokens.cache_write_tokens,
        cache_read_tokens: result.tokens.cache_read_tokens,
        cost: result.cost.total_cost,
        requestId: e.requestId,
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Build session aggregate
  const sessions = aggregateSessions(sessionEntries, mode);
  const session = sessions.find((s) => s.sessionId === fullId) ?? sessions[0];

  return { session, requests };
}

function hierarchyToTable(node: AgentNode): void {
  console.log(chalk.bold(`\nSession: ${truncateId(node.id, 20)}`));
  console.log(`Project: ${chalk.cyan(node.project)}`);
  console.log(`Total: ${formatTokens(node.totalTokens)} tokens, ${formatCost(node.totalCost)}, ${node.requestCount} requests`);
  console.log('');

  const table = new Table({
    head: ['Agent', 'Type', 'Description', 'Requests', 'Tokens', 'Cost', '% of Total'].map((h) => chalk.cyan(h)),
    colAligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right'],
    style: { head: [], border: [] },
  });

  // Parent's own row
  const parentPct = node.totalCost > 0 ? ((node.ownCost / node.totalCost) * 100).toFixed(1) : '0.0';
  table.push([
    chalk.bold('(parent session)'),
    '',
    '',
    (node.requestCount - node.children.reduce((s, c) => s + c.requestCount, 0)).toString(),
    formatTokens(node.ownTokens),
    formatCost(node.ownCost),
    parentPct + '%',
  ]);

  // Child agents
  for (const child of node.children) {
    const pct = node.totalCost > 0 ? ((child.totalCost / node.totalCost) * 100).toFixed(1) : '0.0';
    table.push([
      chalk.dim(truncateId(child.id, 14)),
      chalk.yellow(child.agentType ?? ''),
      truncateId(child.description ?? '', 30),
      child.requestCount.toString(),
      formatTokens(child.totalTokens),
      formatCost(child.totalCost),
      pct + '%',
    ]);
  }

  console.log(table.toString());

  if (node.children.length === 0) {
    console.log(chalk.dim('\nNo subagents found for this session.'));
  } else {
    console.log(chalk.dim('\nNote: Claude Code logs API usage under the parent session. Per-agent cost attribution is not available from JSONL data.'));
  }
}

function sessionDetailToTable(session: SessionAggregate, requests: RequestDetail[], limit: number): void {
  console.log(chalk.bold(`\nSession: ${session.sessionId}`));
  console.log(`Project: ${chalk.cyan(session.project)}`);
  console.log(`Model: ${chalk.cyan(session.primaryModel)}`);
  console.log(`Duration: ${formatDuration(new Date(session.endTime).getTime() - new Date(session.startTime).getTime())}`);
  console.log(`Total: ${formatTokens(session.tokens.total_tokens)} tokens, ${formatCost(session.cost.total_cost)}`);
  console.log('');

  const showing = requests.slice(0, limit);
  const table = new Table({
    head: ['Time', 'Model', 'Input', 'Output', 'Cache W', 'Cache R', 'Cost'].map((h) => chalk.cyan(h)),
    colAligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
    style: { head: [], border: [] },
  });

  for (const r of showing) {
    table.push([
      r.timestamp.slice(11, 19), // HH:MM:SS
      shortenModelName(r.model),
      formatTokens(r.input_tokens),
      formatTokens(r.output_tokens),
      formatTokens(r.cache_write_tokens),
      formatTokens(r.cache_read_tokens),
      formatCost(r.cost),
    ]);
  }

  console.log(table.toString());
  if (requests.length > limit) {
    console.log(chalk.dim(`\nShowing ${limit} of ${requests.length} requests. Use --limit to show more.`));
  }
}

export function registerSessionCommand(program: Command): void {
  program
    .command('session')
    .description('Show session-level usage, or detail for a specific session')
    .argument('[id]', 'Session ID (or prefix) to show per-request detail')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for filtering')
    .option('--full', 'Show full session IDs and project names (no truncation)')
    .option('--hierarchy', 'Show agent/subagent cost hierarchy for a session')
    .option('--limit <n>', 'Max requests to show in detail view', '100')
    .action(async (id, opts) => {
      const { entries: unique } = await loadData({ since: opts.since, until: opts.until });
      const filtered = filterEntries(unique, {
        since: opts.since,
        until: opts.until,
        project: opts.project,
        timezone: opts.timezone,
      });

      const mode = parseCostMode(opts.mode);

      // Session detail mode
      if (id) {
        const detail = getSessionDetail(filtered, id, mode);
        if (!detail) {
          // Check for ambiguous matches
          const matchingSessions = [...new Set(filtered.filter((e) => e.sessionId?.startsWith(id)).map((e) => e.sessionId))];
          if (matchingSessions.length > 1) {
            console.error(chalk.red(`Ambiguous session ID "${id}". Matches:`));
            matchingSessions.forEach((s) => console.error(`  ${s}`));
          } else {
            console.error(chalk.red(`No session found matching "${id}".`));
            console.error(chalk.dim('Run `cctrackr session` to see all sessions.'));
          }
          process.exit(1);
        }

        // Hierarchy mode: show agent cost breakdown
        if (opts.hierarchy) {
          const dirs = getProjectDirs();
          const allFiles = findJsonlFiles(dirs);
          const agentMeta = discoverAgentMeta(allFiles);
          const tree = buildSessionHierarchy(detail.session.sessionId, filtered, agentMeta, mode);

          if (opts.json) {
            console.log(JSON.stringify(tree, null, 2));
          } else if (tree) {
            hierarchyToTable(tree);
          } else {
            console.log(chalk.yellow('No hierarchy data available for this session.'));
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({ session: detail.session, requests: detail.requests }, null, 2));
        } else {
          sessionDetailToTable(detail.session, detail.requests, parseInt(opts.limit, 10));
        }
        return;
      }

      // Session list mode (existing behavior)
      const data = aggregateSessions(filtered, mode);

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
      } else if (opts.csv) {
        console.log(sessionToCsv(data));
      } else {
        sessionToTable(data, !!opts.full);
      }
    });
}
