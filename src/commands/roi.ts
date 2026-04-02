import type { Command } from 'commander';
import chalk from 'chalk';
import type { CostMode, SubscriptionPlan } from '../core/types.js';
import { PLAN_COSTS } from '../core/types.js';
import { loadData } from '../core/data-pipeline.js';
import { filterEntries } from '../core/aggregator.js';
import { processEntry } from '../core/calculator.js';
import { formatCost, parseCostMode } from '../utils/format.js';

export function registerRoiCommand(program: Command): void {
  program
    .command('roi')
    .description('Calculate ROI vs API-equivalent cost')
    .option('--plan <plan>', 'Subscription plan: pro ($20), max5 ($100), max20 ($200)', 'max5')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for filtering')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const { entries: unique } = await loadData({ since: opts.since, until: opts.until });
      const filtered = filterEntries(unique, {
        since: opts.since,
        until: opts.until,
        project: opts.project,
        timezone: opts.timezone,
      });

      if (filtered.length === 0) {
        console.log(chalk.yellow('No data found for the specified range.'));
        return;
      }

      // Accept fuzzy plan names
      const planAliases: Record<string, SubscriptionPlan> = {
        pro: 'pro', '20': 'pro',
        max5: 'max5', 'max-5x': 'max5', '100': 'max5', max: 'max5',
        max20: 'max20', 'max-20x': 'max20', '200': 'max20',
      };
      const plan = planAliases[opts.plan?.toLowerCase() ?? 'max5'] as SubscriptionPlan | undefined;
      if (!plan) {
        console.error(chalk.red(`Unknown plan: ${opts.plan}. Choose from: pro ($20), max5 ($100), max20 ($200)`));
        process.exit(1);
      }

      const mode = parseCostMode(opts.mode);
      const subscriptionCost = PLAN_COSTS[plan];

      // Calculate totals
      let totalApiCost = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheWriteTokens = 0;
      let totalCacheReadTokens = 0;
      let totalTokens = 0;

      for (const entry of filtered) {
        const result = processEntry(entry, mode);
        totalApiCost += result.calculatedCost.total_cost;
        totalInputTokens += result.tokens.input_tokens;
        totalOutputTokens += result.tokens.output_tokens;
        totalCacheWriteTokens += result.tokens.cache_write_tokens;
        totalCacheReadTokens += result.tokens.cache_read_tokens;
        totalTokens += result.tokens.total_tokens;
      }

      // Calculate date range for projections
      const sorted = [...filtered].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const firstDate = new Date(sorted[0].timestamp);
      const lastDate = new Date(sorted[sorted.length - 1].timestamp);
      const daysSpan = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

      const avgDailyCost = totalApiCost / daysSpan;
      const projectedMonthlyCost = avgDailyCost * 30;
      const savings = totalApiCost - subscriptionCost;

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              plan,
              subscription_cost: subscriptionCost,
              api_equivalent_cost: totalApiCost,
              savings,
              savings_percentage: totalApiCost > 0 ? ((savings / totalApiCost) * 100) : 0,
              days_analyzed: daysSpan,
              avg_daily_cost: avgDailyCost,
              projected_monthly_cost: projectedMonthlyCost,
              total_tokens: totalTokens,
              token_breakdown: {
                input: totalInputTokens,
                output: totalOutputTokens,
                cache_write: totalCacheWriteTokens,
                cache_read: totalCacheReadTokens,
              },
              request_count: filtered.length,
            },
            null,
            2,
          ),
        );
        return;
      }

      // Terminal output
      console.log(chalk.bold('\n  ROI Analysis\n'));
      console.log(chalk.dim(`  Plan: ${plan} (${formatCost(subscriptionCost)}/mo)`));
      console.log(chalk.dim(`  Period: ${sorted[0].timestamp.slice(0, 10)} to ${sorted[sorted.length - 1].timestamp.slice(0, 10)} (${daysSpan} days)`));
      console.log(chalk.dim(`  Requests: ${filtered.length.toLocaleString()}\n`));

      const w = 24;
      console.log(`  ${'Total tokens'.padEnd(w)} ${chalk.white(totalTokens.toLocaleString())}`);
      console.log(`  ${'API-equivalent cost'.padEnd(w)} ${chalk.white(formatCost(totalApiCost))}`);
      console.log(`  ${'Subscription cost'.padEnd(w)} ${chalk.white(formatCost(subscriptionCost))}`);

      if (savings > 0) {
        console.log(`  ${'Savings'.padEnd(w)} ${chalk.green(formatCost(savings))} ${chalk.green(`(${((savings / totalApiCost) * 100).toFixed(0)}%)`)}`);
      } else {
        const loss = Math.abs(savings);
        console.log(`  ${'Loss'.padEnd(w)} ${chalk.red(formatCost(loss))} ${chalk.red('(subscription > API cost)')}`);
      }

      console.log('');
      console.log(`  ${'Avg daily API cost'.padEnd(w)} ${chalk.white(formatCost(avgDailyCost))}`);
      console.log(`  ${'Projected monthly'.padEnd(w)} ${chalk.white(formatCost(projectedMonthlyCost))}`);

      // Break-even indicator
      if (projectedMonthlyCost > subscriptionCost) {
        console.log(chalk.green(`\n  Subscription is worth it at projected usage.`));
      } else {
        console.log(chalk.yellow(`\n  API costs are lower than your subscription at current usage.`));
      }

      console.log('');
    });
}
