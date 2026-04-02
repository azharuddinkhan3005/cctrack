import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CostMode, MonthlyAggregate } from '../core/types.js';
import { loadData } from '../core/data-pipeline.js';
import { filterEntries, aggregateMonthly } from '../core/aggregator.js';
import { formatCost, formatTokens, parseCostMode } from '../utils/format.js';
import { loadBudgetConfig, calculateBudgetStatus, formatBudgetBar } from '../core/budget.js';

function monthlyToCsv(data: MonthlyAggregate[], breakdown: boolean): string {
  const lines: string[] = [];

  if (breakdown) {
    lines.push('month,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,cost');
    for (const m of data) {
      for (const [model, agg] of Object.entries(m.models)) {
        lines.push(
          [
            m.month,
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
    lines.push('month,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,cost');
    for (const m of data) {
      lines.push(
        [
          m.month,
          m.tokens.input_tokens,
          m.tokens.output_tokens,
          m.tokens.cache_write_tokens,
          m.tokens.cache_read_tokens,
          m.tokens.total_tokens,
          m.cost.total_cost.toFixed(6),
        ].join(','),
      );
    }
  }

  return lines.join('\n');
}

function monthlyToTable(data: MonthlyAggregate[], breakdown: boolean): void {
  if (data.length === 0) {
    console.log(chalk.yellow('No data found for the specified range.'));
    return;
  }

  if (breakdown) {
    const table = new Table({
      head: ['Month', 'Model', 'Input', 'Output', 'Cache Write', 'Cache Read', 'Total', 'Cost'].map((h) =>
        chalk.cyan(h),
      ),
      colAligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: [], border: [] },
    });

    for (const m of data) {
      for (const [model, agg] of Object.entries(m.models)) {
        table.push([
          m.month,
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
      head: ['Month', 'Input', 'Output', 'Cache Write', 'Cache Read', 'Total', 'Cost'].map((h) => chalk.cyan(h)),
      colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: [], border: [] },
    });

    for (const m of data) {
      table.push([
        m.month,
        formatTokens(m.tokens.input_tokens),
        formatTokens(m.tokens.output_tokens),
        formatTokens(m.tokens.cache_write_tokens),
        formatTokens(m.tokens.cache_read_tokens),
        formatTokens(m.tokens.total_tokens),
        formatCost(m.cost.total_cost),
      ]);
    }

    console.log(table.toString());
  }

  // Budget indicator (current month only)
  const budgetConfig = loadBudgetConfig();
  if (budgetConfig.monthly != null) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthEntry = data.find((m) => m.month === currentMonth);
    const totalSpent = monthEntry?.cost.total_cost ?? 0;
    const status = calculateBudgetStatus(totalSpent, budgetConfig.monthly);
    console.log();
    console.log(`Monthly Budget: ${formatBudgetBar(status.percentage)} (${formatCost(status.spent)} / ${formatCost(status.budget)})`);
  }

  const totalCost = data.reduce((sum, m) => sum + m.cost.total_cost, 0);
  const totalTokens = data.reduce((sum, m) => sum + m.tokens.total_tokens, 0);
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.bold(`Total: ${formatTokens(totalTokens)} tokens, ${formatCost(totalCost)}`));
}

export function registerMonthlyCommand(program: Command): void {
  program
    .command('monthly')
    .description('Show monthly usage breakdown')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--breakdown', 'Show per-model breakdown')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
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
      const data = aggregateMonthly(filtered, mode, opts.timezone);

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
      } else if (opts.csv) {
        console.log(monthlyToCsv(data, opts.breakdown));
      } else {
        monthlyToTable(data, opts.breakdown);
      }
    });
}
