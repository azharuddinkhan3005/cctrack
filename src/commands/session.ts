import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CostMode, SessionAggregate } from '../core/types.js';
import { getProjectDirs, findJsonlFiles } from '../utils/fs.js';
import { parseAllFiles } from '../core/parser.js';
import { deduplicateEntries } from '../core/dedup.js';
import { filterEntries, aggregateSessions } from '../core/aggregator.js';
import { formatCost, formatTokens, formatDuration, shortenModelName, csvEscape, parseCostMode } from '../utils/format.js';

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

export function registerSessionCommand(program: Command): void {
  program
    .command('session')
    .description('Show session-level usage')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for filtering')
    .option('--full', 'Show full session IDs and project names (no truncation)')
    .action(async (opts) => {
      const dirs = getProjectDirs();
      const files = findJsonlFiles(dirs);
      const { entries } = await parseAllFiles(files);
      const unique = deduplicateEntries(entries);
      const filtered = filterEntries(unique, {
        since: opts.since,
        until: opts.until,
        project: opts.project,
        timezone: opts.timezone,
      });

      const mode = parseCostMode(opts.mode);
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
