import type { Command } from 'commander';
import chalk from 'chalk';
import {
  loadBudgetConfig,
  saveBudgetConfig,
  loadFullConfig,
  saveFullConfig,
  resetConfig,
  getConfigPath,
} from '../core/budget.js';
import { formatCost } from '../utils/format.js';

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage cctrack configuration (budgets, etc.)');

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value (e.g. budget.daily 50)')
    .action((key: string, value: string) => {
      const numValue = Number(value);
      if (isNaN(numValue) || numValue < 0) {
        console.error(chalk.red(`Invalid value: ${value}. Must be a non-negative number.`));
        process.exit(1);
      }

      const parts = key.split('.');
      if (parts[0] === 'budget' && parts.length === 2) {
        const budgetKey = parts[1] as 'daily' | 'monthly' | 'block';
        if (!['daily', 'monthly', 'block'].includes(budgetKey)) {
          console.error(chalk.red(`Unknown budget key: ${budgetKey}. Valid keys: daily, monthly, block`));
          process.exit(1);
        }
        const config = loadBudgetConfig();
        config[budgetKey] = numValue;
        saveBudgetConfig(config);
        console.log(chalk.green(`Set ${key} = ${formatCost(numValue)}`));
      } else {
        console.error(chalk.red(`Unknown config key: ${key}`));
        console.error(chalk.dim('Valid keys: budget.daily, budget.monthly, budget.block'));
        process.exit(1);
      }
    });

  configCmd
    .command('get [key]')
    .description('Show current configuration')
    .action((key?: string) => {
      const config = loadFullConfig();
      const configPath = getConfigPath();

      if (key && key !== 'budget') {
        console.error(chalk.red(`Unknown config section: ${key}`));
        process.exit(1);
      }

      console.log(chalk.bold(`CCTrack Configuration`) + chalk.dim(` (${configPath})`));
      console.log();

      const budget = config.budget ?? {};
      console.log(chalk.bold('  Budget'));
      console.log(`    Daily:    ${budget.daily != null ? formatCost(budget.daily) + chalk.dim(' (alerts at 50%/80%/100%)') : chalk.dim('not set')}`);
      console.log(`    Monthly:  ${budget.monthly != null ? formatCost(budget.monthly) + chalk.dim(' (alerts at 50%/80%/100%)') : chalk.dim('not set')}`);
      console.log(`    Block:    ${budget.block != null ? formatCost(budget.block) : chalk.dim('not set')}`);
      console.log(chalk.dim('\n  Set with: cctrack config set budget.daily <dollars>'));
    });

  configCmd
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
      resetConfig();
      console.log(chalk.green('Configuration reset to defaults.'));
    });
}
