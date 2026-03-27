import type { Command } from 'commander';
import { statSync } from 'node:fs';
import chalk from 'chalk';
import type { CostMode } from '../core/types.js';
import { getProjectDirs, findJsonlFiles } from '../utils/fs.js';
import { parseAllFiles } from '../core/parser.js';
import { deduplicateEntries } from '../core/dedup.js';
import { filterEntries, aggregateDaily, aggregateSessions } from '../core/aggregator.js';
import { formatCost, formatTokens, formatDuration, parseCostMode } from '../utils/format.js';
import { calculateBurnRate } from '../core/burnrate.js';
import { loadBudgetConfig, calculateBudgetStatus, formatBudgetBar } from '../core/budget.js';

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

async function loadAndDisplay(mode: CostMode, project?: string, timezone?: string): Promise<void> {
  const dirs = getProjectDirs();
  const files = findJsonlFiles(dirs);

  if (files.length === 0) {
    console.log(chalk.yellow('No JSONL files found. Waiting for data...'));
    return;
  }

  const { entries, errors } = await parseAllFiles(files);
  const unique = deduplicateEntries(entries);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = filterEntries(unique, { since: today, project, timezone });

  clearScreen();

  console.log(chalk.bold.cyan('  CCTrack Live Monitor'));
  console.log(chalk.dim(`  ${new Date().toLocaleTimeString()} | ${unique.length} usage entries | ${files.length} files\n`));

  // Today's summary
  const dailyData = aggregateDaily(filtered, mode, timezone);
  const todayData = dailyData.find((d) => d.date === today);

  if (todayData) {
    console.log(chalk.bold('  Today'));
    console.log(`  Requests:     ${chalk.white(todayData.request_count.toLocaleString())}`);
    console.log(`  Input:        ${chalk.white(formatTokens(todayData.tokens.input_tokens))}`);
    console.log(`  Output:       ${chalk.white(formatTokens(todayData.tokens.output_tokens))}`);
    console.log(`  Cache Write:  ${chalk.white(formatTokens(todayData.tokens.cache_write_tokens))}`);
    console.log(`  Cache Read:   ${chalk.white(formatTokens(todayData.tokens.cache_read_tokens))}`);
    console.log(`  Total:        ${chalk.white(formatTokens(todayData.tokens.total_tokens))}`);
    console.log(`  Cost:         ${chalk.white(formatCost(todayData.cost.total_cost))}`);

    // Burn rate
    const rate = calculateBurnRate(filtered, mode);
    if (!rate.insufficient_data) {
      console.log(`  Burn rate:    ${chalk.dim(formatCost(rate.hourly_cost) + '/hr → ' + formatCost(rate.projected_monthly) + '/month projected')}`);
    }
  } else {
    console.log(chalk.dim('  No activity today yet.'));
  }

  // Active sessions (from today's data)
  const sessions = aggregateSessions(filtered, mode);
  if (sessions.length > 0) {
    console.log(chalk.bold('\n  Recent Sessions'));
    const recent = sessions.slice(0, 5);
    for (const s of recent) {
      const duration = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
      const id = s.sessionId.length > 12 ? s.sessionId.slice(0, 12) + '...' : s.sessionId;
      console.log(
        `  ${chalk.dim(id)} ${chalk.white(s.primaryModel)} ${chalk.dim(formatDuration(duration))} ${formatTokens(s.tokens.total_tokens)} ${chalk.white(formatCost(s.cost.total_cost))}`,
      );
    }
  }

  // Model breakdown for today
  if (todayData && Object.keys(todayData.models).length > 0) {
    console.log(chalk.bold('\n  Models Today'));
    for (const [model, agg] of Object.entries(todayData.models)) {
      console.log(
        `  ${chalk.white(model)} ${chalk.dim('|')} ${agg.request_count} reqs ${chalk.dim('|')} ${formatTokens(agg.tokens.total_tokens)} ${chalk.dim('|')} ${chalk.white(formatCost(agg.cost.total_cost))}`,
      );
    }
  }

  // File watch stats
  const newestFile = files.reduce((newest, f) => {
    try {
      const mtime = statSync(f).mtimeMs;
      return mtime > newest.time ? { path: f, time: mtime } : newest;
    } catch {
      return newest;
    }
  }, { path: '', time: 0 });

  if (newestFile.path) {
    const ago = Date.now() - newestFile.time;
    console.log(chalk.dim(`\n  Last file update: ${formatDuration(ago)} ago`));
  }

  // Budget status
  const budgetConfig = loadBudgetConfig();
  if (budgetConfig.daily && todayData) {
    const status = calculateBudgetStatus(todayData.cost.total_cost, budgetConfig.daily);
    console.log(chalk.bold('\n  Budget'));
    console.log(`  Daily: ${formatBudgetBar(status.percentage)} (${formatCost(status.spent)} / ${formatCost(status.budget)})`);
  }

  console.log(chalk.dim('\n  Press Ctrl+C to exit'));
}

export function registerLiveCommand(program: Command): void {
  program
    .command('live')
    .description('Real-time terminal monitor')
    .option('--interval <seconds>', 'Refresh interval in seconds', '5')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for date grouping')
    .action(async (opts) => {
      const intervalMs = Math.max(1, parseInt(opts.interval ?? '5', 10)) * 1000;
      const mode = parseCostMode(opts.mode);

      // Initial render
      await loadAndDisplay(mode, opts.project, opts.timezone);

      // Periodic refresh using setTimeout to prevent overlap
      let stopped = false;
      async function scheduleNext() {
        if (stopped) return;
        await new Promise((r) => setTimeout(r, intervalMs));
        if (stopped) return;
        try {
          await loadAndDisplay(mode, opts.project, opts.timezone);
        } catch {
          // Silently continue on transient errors
        }
        scheduleNext();
      }
      scheduleNext();

      // Graceful shutdown
      process.on('SIGINT', () => {
        stopped = true;
        clearScreen();
        console.log(chalk.dim('Live monitor stopped.'));
        process.exit(0);
      });
    });
}
