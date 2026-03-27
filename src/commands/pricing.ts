import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getAllPricing, getPricingInfo, updatePricing } from '../core/pricing.js';
import { formatCost } from '../utils/format.js';

export function registerPricingCommand(program: Command): void {
  const cmd = program.command('pricing').description('View and update model pricing data');

  cmd
    .command('list')
    .description('List all known model prices')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const info = getPricingInfo();
      const data = getAllPricing();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.bold('Model Pricing'));
      console.log(chalk.dim(`Source: ${info.source} | ${info.modelCount} models | version: ${info.version} | cache: ${info.cacheAge}\n`));

      const sorted = Object.entries(data.models).sort(([a], [b]) => a.localeCompare(b));

      const table = new Table({
        head: ['Model', 'Input/M', 'Output/M', 'Cache W/M', 'Cache R/M', 'Context'].map((h) => chalk.cyan(h)),
        colAligns: ['left', 'right', 'right', 'right', 'right', 'right'],
        style: { head: [], border: [] },
      });

      for (const [id, p] of sorted) {
        const tiered = p.input_cost_per_million_above_200k ? chalk.yellow(' *') : '';
        table.push([
          id + tiered,
          formatCost(p.input_cost_per_million),
          formatCost(p.output_cost_per_million),
          formatCost(p.cache_creation_cost_per_million),
          formatCost(p.cache_read_cost_per_million),
          `${(p.context_window / 1000).toFixed(0)}K`,
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim('\n* = tiered pricing above 200K context'));

      // Show aliases
      console.log(chalk.bold('\nAliases'));
      const aliasSorted = Object.entries(data.aliases).sort(([a], [b]) => a.localeCompare(b));
      for (const [alias, target] of aliasSorted) {
        console.log(`  ${chalk.white(alias)} ${chalk.dim('→')} ${target}`);
      }
    });

  cmd
    .command('update')
    .description('Fetch latest pricing from Anthropic and update cache')
    .action(async () => {
      console.log(chalk.dim('Fetching pricing from Anthropic...'));
      const { data, newModels, source } = await updatePricing();

      console.log(chalk.green(`Pricing updated: ${Object.keys(data.models).length} models (${source})`));

      if (newModels.length > 0) {
        console.log(chalk.yellow(`\nNew models discovered:`));
        for (const m of newModels) {
          console.log(`  + ${chalk.cyan(m)}`);
        }
      }

      const info = getPricingInfo();
      console.log(chalk.dim(`\nCache: ${info.cacheAge}`));
    });

  cmd
    .command('status')
    .description('Show pricing source and cache status')
    .action(async () => {
      const info = getPricingInfo();
      console.log(`Source:   ${chalk.white(info.source)}`);
      console.log(`Models:   ${chalk.white(info.modelCount.toString())}`);
      console.log(`Version:  ${chalk.white(info.version)}`);
      console.log(`Cache:    ${chalk.white(info.cacheAge)}`);
    });

  // Default: show status
  cmd.action(async () => {
    await cmd.commands.find((c) => c.name() === 'status')?.parseAsync(['node', 'cctrack', 'pricing', 'status']);
  });
}
