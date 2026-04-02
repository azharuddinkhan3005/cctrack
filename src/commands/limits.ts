import type { Command } from 'commander';
import chalk from 'chalk';
import type { CostMode } from '../core/types.js';
import { loadData } from '../core/data-pipeline.js';
import { predictUtilization, loadModel, loadEvents, currentWindowConsumption } from '../core/rate-model.js';
import { formatTokens, formatDuration, parseCostMode } from '../utils/format.js';

function buildBar(pct: number, width: number = 30): string {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  if (pct >= 80) return chalk.red(bar);
  if (pct >= 50) return chalk.yellow(bar);
  return chalk.green(bar);
}

export function registerLimitsCommand(program: Command): void {
  program
    .command('limits')
    .description('Predict rate limit utilization from your usage patterns')
    .option('--json', 'Output as JSON')
    .option('--mode <mode>', 'Cost mode', 'calculate')
    .action(async (opts) => {
      const { entries: unique } = await loadData();

      const mode = parseCostMode(opts.mode);

      // Determine primary model (most recent)
      const sorted = [...unique].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const primaryModel = sorted[0]?.message.model ?? 'claude-opus-4-6';

      // Get prediction
      const prediction = predictUtilization(unique, primaryModel);
      const consumption = currentWindowConsumption(unique);
      const model = loadModel();
      const events = loadEvents();

      if (opts.json) {
        console.log(JSON.stringify({ prediction, consumption, model, events_count: events.length }, null, 2));
        return;
      }

      console.log(chalk.bold('Rate Limit Analysis'));
      console.log(chalk.dim(`Model: ${primaryModel} (${prediction.model_family})`));
      console.log('');

      // Current 5-hour window consumption
      console.log(chalk.bold('Current 5-Hour Window'));
      console.log(`  Billable tokens:  ${chalk.white(formatTokens(consumption.billable_tokens))} ${chalk.dim('(input + cache_creation, excludes cache_read)')}`);
      console.log(`  Total tokens:     ${chalk.white(formatTokens(consumption.total_tokens))}`);
      console.log(`  Requests:         ${chalk.white(consumption.requests.toString())}`);
      console.log('');

      if (prediction.source === 'calibrated') {
        console.log(chalk.bold('Estimated Utilization') + chalk.dim(` (${prediction.calibration_events} calibration events, ${Math.round(prediction.confidence * 100)}% confidence)`));
        console.log(`  ${buildBar(prediction.estimated_utilization)} ${chalk.white(prediction.estimated_utilization.toFixed(1) + '%')}`);
        console.log(`  Estimated limit:  ${chalk.white(formatTokens(prediction.estimated_limit))} billable tokens / 5h`);

        if (prediction.minutes_to_limit !== null) {
          if (prediction.minutes_to_limit === 0) {
            console.log(`  Time to limit:    ${chalk.red('NOW — you may be rate limited')}`);
          } else {
            const color = prediction.minutes_to_limit < 30 ? chalk.red : prediction.minutes_to_limit < 60 ? chalk.yellow : chalk.green;
            console.log(`  Time to limit:    ${color(formatDuration(prediction.minutes_to_limit * 60 * 1000))}`);
          }
        }
      } else {
        console.log(chalk.bold('Estimated Utilization'));
        console.log(chalk.dim('  No calibration data yet. The model learns when you hit rate limits.'));
        console.log(chalk.dim('  Keep using Claude Code normally — the first time you hit a limit,'));
        console.log(chalk.dim('  cctrack will record it and start predicting.'));
        console.log('');
        console.log(chalk.dim('  To see your actual limits right now, use:'));
        console.log(chalk.dim('    /usage in Claude Code'));
      }

      console.log('');

      // Historical calibration events
      if (events.length > 0) {
        console.log(chalk.bold('Rate Limit History'));
        const recent = events.slice(-5).reverse();
        for (const e of recent) {
          const date = e.timestamp.slice(0, 16).replace('T', ' ');
          console.log(`  ${chalk.dim(date)} ${e.model} — ${formatTokens(e.input_tokens_in_window)} billable tokens`);
          if (e.reset_time) console.log(`    ${chalk.dim('Reset: ' + e.reset_time)}`);
        }
      } else {
        console.log(chalk.dim('No rate limit events recorded yet.'));
      }
    });
}
