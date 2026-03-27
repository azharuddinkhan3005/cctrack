import type { Command } from 'commander';
import type { CostMode, UsageEntry } from '../core/types.js';
import { getProjectDirs, findJsonlFiles, extractProjectName } from '../utils/fs.js';
import { parseAllFiles } from '../core/parser.js';
import { deduplicateEntries } from '../core/dedup.js';
import { filterEntries, buildDashboardData } from '../core/aggregator.js';
import { processEntry } from '../core/calculator.js';
import { csvEscape, parseCostMode } from '../utils/format.js';

function entriesToCsv(entries: UsageEntry[], mode: CostMode): string {
  const lines: string[] = [];
  lines.push(
    'date,session_id,project,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cost_calculated,cost_embedded,request_id',
  );

  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 10);
    const sessionId = entry.sessionId ?? '';
    const project = entry.cwd ? extractProjectName(entry.cwd) : '';
    const model = entry.message.model ?? 'unknown';
    const usage = entry.message.usage;
    const result = processEntry(entry, mode);

    lines.push(
      [
        date,
        csvEscape(sessionId),
        csvEscape(project),
        csvEscape(model),
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_creation_input_tokens ?? 0,
        usage.cache_read_input_tokens ?? 0,
        result.calculatedCost.total_cost.toFixed(6),
        entry.costUSD?.toFixed(6) ?? '',
        entry.requestId ?? '',
      ].join(','),
    );
  }

  return lines.join('\n');
}

export function registerExportCommand(program: Command): void {
  const exportCmd = program.command('export').description('Export usage data');

  exportCmd
    .command('csv')
    .description('Export flat CSV with one row per request')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for filtering')
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

      // Sort chronologically for export
      const sorted = [...filtered].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const mode = parseCostMode(opts.mode);
      console.log(entriesToCsv(sorted, mode));
    });

  exportCmd
    .command('json')
    .description('Export structured JSON matching dashboard data format')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for date grouping')
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
      const data = buildDashboardData(filtered, mode, opts.timezone);
      console.log(JSON.stringify(data, null, 2));
    });
}
