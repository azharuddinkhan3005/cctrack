import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CostMode, DailyAggregate } from '../core/types.js';
import { loadData } from '../core/data-pipeline.js';
import { filterEntries, aggregateDaily } from '../core/aggregator.js';
import { formatCost, formatTokens, parseCostMode } from '../utils/format.js';
import { loadBudgetConfig, calculateBudgetStatus, formatBudgetBar } from '../core/budget.js';
import { calculateBurnRate } from '../core/burnrate.js';

function dailyToCsv(data: DailyAggregate[], breakdown: boolean): string {
  const lines: string[] = [];

  if (breakdown) {
    lines.push('date,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,cost');
    for (const day of data) {
      for (const [model, agg] of Object.entries(day.models)) {
        lines.push(
          [
            day.date,
            model,
            agg.tokens.input_tokens,
            agg.tokens.output_tokens,
            agg.tokens.cache_write_tokens,
            agg.tokens.cache_read_tokens,
            agg.tokens.total_tokens,
            agg.cost.total_cost.toFixed(6),
          ].join(','),
        );
      }
    }
  } else {
    lines.push('date,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,cost');
    for (const day of data) {
      lines.push(
        [
          day.date,
          day.tokens.input_tokens,
          day.tokens.output_tokens,
          day.tokens.cache_write_tokens,
          day.tokens.cache_read_tokens,
          day.tokens.total_tokens,
          day.cost.total_cost.toFixed(6),
        ].join(','),
      );
    }
  }

  return lines.join('\n');
}

function dailyToTable(data: DailyAggregate[], breakdown: boolean): void {
  if (data.length === 0) {
    console.log(chalk.yellow('No data found for the specified range.'));
    return;
  }

  if (breakdown) {
    const table = new Table({
      head: ['Date', 'Model', 'Input', 'Output', 'Cache Write', 'Cache Read', 'Total', 'Cost'].map((h) =>
        chalk.cyan(h),
      ),
      colAligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: [], border: [] },
    });

    for (const day of data) {
      for (const [model, agg] of Object.entries(day.models)) {
        table.push([
          day.date,
          model,
          formatTokens(agg.tokens.input_tokens),
          formatTokens(agg.tokens.output_tokens),
          formatTokens(agg.tokens.cache_write_tokens),
          formatTokens(agg.tokens.cache_read_tokens),
          formatTokens(agg.tokens.total_tokens),
          formatCost(agg.cost.total_cost),
        ]);
      }
    }

    console.log(table.toString());
  } else {
    const table = new Table({
      head: ['Date', 'Input', 'Output', 'Cache Write', 'Cache Read', 'Total', 'Cost'].map((h) => chalk.cyan(h)),
      colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: [], border: [] },
    });

    const maxCost = Math.max(...data.map((d) => d.cost.total_cost), 1);
    for (const day of data) {
      const barLen = Math.round((day.cost.total_cost / maxCost) * 8);
      const bar = chalk.dim('\u2588'.repeat(barLen) + '\u2591'.repeat(8 - barLen));
      table.push([
        day.date,
        formatTokens(day.tokens.input_tokens),
        formatTokens(day.tokens.output_tokens),
        formatTokens(day.tokens.cache_write_tokens),
        formatTokens(day.tokens.cache_read_tokens),
        formatTokens(day.tokens.total_tokens),
        formatCost(day.cost.total_cost) + ' ' + bar,
      ]);
    }

    console.log(table.toString());
  }

  // Budget indicator (today only)
  const budgetConfig = loadBudgetConfig();
  if (budgetConfig.daily != null) {
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = data.find((d) => d.date === today);
    const todayCost = todayEntry?.cost.total_cost ?? 0;
    const status = calculateBudgetStatus(todayCost, budgetConfig.daily);
    console.log();
    console.log(`Daily Budget: ${formatBudgetBar(status.percentage)} (${formatCost(status.spent)} / ${formatCost(status.budget)})`);
  }

  // Summary row
  const totalCost = data.reduce((sum, d) => sum + d.cost.total_cost, 0);
  const totalTokens = data.reduce((sum, d) => sum + d.tokens.total_tokens, 0);
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.bold(`Total: ${formatTokens(totalTokens)} tokens, ${formatCost(totalCost)}`));
}

function showBurnRate(entries: import('../core/types.js').UsageEntry[], mode: CostMode): void {
  const rate = calculateBurnRate(entries, mode);
  if (rate.insufficient_data) return;
  console.log(
    chalk.dim(`Burn rate: ${formatCost(rate.hourly_cost)}/hr, ${formatCost(rate.daily_cost)}/day → projected ${formatCost(rate.projected_monthly)}/month`),
  );
}

export function registerDailyCommand(program: Command): void {
  program
    .command('daily')
    .description('Show daily usage breakdown')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--breakdown', 'Show per-model breakdown')
    .option('--mode <mode>', 'Cost mode: calculate|display|compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for date grouping (e.g. America/New_York)')
    .action(async (opts) => {
      const { entries: unique } = await loadData({ since: opts.since, until: opts.until });
      const filtered = filterEntries(unique, {
        since: opts.since,
        until: opts.until,
        project: opts.project,
        timezone: opts.timezone,
      });

      const mode = parseCostMode(opts.mode);
      const data = aggregateDaily(filtered, mode, opts.timezone);

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
      } else if (opts.csv) {
        console.log(dailyToCsv(data, opts.breakdown));
      } else {
        dailyToTable(data, opts.breakdown);
        showBurnRate(filtered, mode);
      }
    });
}
