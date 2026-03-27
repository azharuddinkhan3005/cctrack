import { Command } from 'commander';
import { registerDailyCommand } from './commands/daily.js';
import { registerMonthlyCommand } from './commands/monthly.js';
import { registerSessionCommand } from './commands/session.js';
import { registerDashboardCommand, dashboardAction } from './commands/dashboard.js';
import { registerExportCommand } from './commands/export.js';
import { registerRoiCommand } from './commands/roi.js';
import { registerLiveCommand } from './commands/live.js';
import { registerPricingCommand } from './commands/pricing.js';
import { registerConfigCommand } from './commands/config.js';
import { registerBlocksCommand } from './commands/blocks.js';
import { registerStatuslineCommand } from './commands/statusline.js';
import { registerLimitsCommand } from './commands/limits.js';
import { initPricing } from './core/pricing.js';

// Kick off background pricing refresh (non-blocking)
initPricing().catch(() => {});

const program = new Command();

program
  .name('cctrack')
  .description('Claude Code usage analytics — accurate metrics and a beautiful HTML dashboard')
  .version('0.1.0')
  .addHelpText('after', `
Examples:
  cctrack                                     Open interactive HTML dashboard
  cctrack daily --since YYYY-MM-DD            Daily cost breakdown from a date
  cctrack blocks                              5-hour rolling window usage
  cctrack roi --plan max20                    ROI analysis vs Max 20 plan
  cctrack live                                Real-time terminal monitor
  cctrack statusline                          Compact status for tmux/editors
  cctrack config set budget.daily 50          Set daily budget alert at $50
`);

registerDailyCommand(program);
registerMonthlyCommand(program);
registerSessionCommand(program);
registerDashboardCommand(program);
registerExportCommand(program);
registerRoiCommand(program);
registerLiveCommand(program);
registerPricingCommand(program);
registerConfigCommand(program);
registerBlocksCommand(program);
registerStatuslineCommand(program);
registerLimitsCommand(program);

// Default action: run dashboard
program.action(async () => {
  await dashboardAction({});
});

program.parse();
