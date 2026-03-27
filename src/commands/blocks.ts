import type { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CostMode, UsageEntry, BlockAggregate, AggregatedEntry } from '../core/types.js';
import { BLOCK_DURATION_MS } from '../core/types.js';
import { getProjectDirs, findJsonlFiles } from '../utils/fs.js';
import { parseAllFiles } from '../core/parser.js';
import { deduplicateEntries } from '../core/dedup.js';
import { filterEntries, emptyAggregate, accumulate } from '../core/aggregator.js';
import { processEntry, addTokens, addCosts } from '../core/calculator.js';
import { formatCost, formatTokens, formatDuration, parseCostMode } from '../utils/format.js';
import { getRateLimits } from './statusline.js';

/**
 * Group entries into 5-hour rolling blocks.
 * Current block: [now - 5h, now]
 * Previous blocks: 5-hour windows going backwards.
 */
function aggregateBlocks(entries: UsageEntry[], mode: CostMode, numBlocks: number = 10): BlockAggregate[] {
  const now = Date.now();
  const oldestBlock = now - numBlocks * BLOCK_DURATION_MS;

  // Initialize all blocks
  const blockMap = new Map<number, BlockAggregate>();
  for (let i = 0; i < numBlocks; i++) {
    const blockEnd = now - i * BLOCK_DURATION_MS;
    const blockStart = blockEnd - BLOCK_DURATION_MS;
    blockMap.set(i, {
      block_start: new Date(blockStart).toISOString(),
      block_end: new Date(blockEnd).toISOString(),
      block_index: i,
      is_current: i === 0,
      time_remaining_ms: i === 0 ? blockEnd - now : 0,
      ...emptyAggregate(),
      models: {},
    });
  }

  // Single pass: assign each entry to its block by index
  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp).getTime();
    if (entryTime < oldestBlock || entryTime > now) continue;

    const blockIndex = Math.floor((now - entryTime) / BLOCK_DURATION_MS);
    if (blockIndex < 0 || blockIndex >= numBlocks) continue;

    const block = blockMap.get(blockIndex)!;
    const model = entry.message.model ?? 'unknown';
    const result = processEntry(entry, mode);
    accumulate(block, result);

    if (!block.models[model]) block.models[model] = emptyAggregate();
    const modelAgg = block.models[model];
    modelAgg.tokens = addTokens(modelAgg.tokens, result.tokens);
    modelAgg.cost = addCosts(modelAgg.cost, result.cost);
    modelAgg.request_count++;
  }

  return Array.from(blockMap.values());
}

/**
 * Build a progress bar using Unicode block characters.
 * Green <50%, Yellow 50-80%, Red >80%.
 */
function buildProgressBar(percentage: number, width: number = 20): string {
  const pct = Math.min(Math.max(percentage, 0), 100);
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;

  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  if (pct > 80) return chalk.red(bar);
  if (pct >= 50) return chalk.yellow(bar);
  return chalk.green(bar);
}

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

function formatBlockTime(isoString: string): string {
  const date = new Date(isoString);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

function displayBlocks(blocks: BlockAggregate[]): void {
  // Show real rate limits if available (from statusline capture)
  const rateLimits = getRateLimits();
  if (rateLimits) {
    console.log(chalk.bold('Anthropic Rate Limits') + chalk.dim(` (via ${rateLimits.source}, ${rateLimits.captured_at.slice(11, 19)} UTC)`));
    const showWindow = (label: string, w: { used_percentage: number; resets_at: number } | undefined) => {
      if (!w) return;
      const pct = w.used_percentage;
      const resetMs = w.resets_at * 1000 - Date.now();
      const resetStr = resetMs > 0 ? formatDuration(resetMs) : 'now';
      const color = pct >= 80 ? chalk.red : pct >= 50 ? chalk.yellow : chalk.green;
      const bar = '\u2588'.repeat(Math.round(pct / 5)) + '\u2591'.repeat(20 - Math.round(pct / 5));
      console.log(`  ${label.padEnd(16)} ${color(bar)} ${color(pct.toFixed(1).padStart(5) + '%')} | resets in ${resetStr}`);
    };
    showWindow('Session (5h)', rateLimits.five_hour);
    showWindow('Weekly (all)', rateLimits.seven_day);
    showWindow('Weekly (Sonnet)', rateLimits.seven_day_sonnet);
    showWindow('Weekly (Opus)', rateLimits.seven_day_opus);
    if (rateLimits.extra_usage) {
      const eu = rateLimits.extra_usage;
      const pct = eu.utilization;
      const color = pct >= 80 ? chalk.red : pct >= 50 ? chalk.yellow : chalk.green;
      const resetMs = eu.resets_at * 1000 - Date.now();
      const resetStr = resetMs > 0 ? formatDuration(resetMs) : 'now';
      console.log(`  ${'Extra usage'.padEnd(16)} ${color('$' + eu.spent.toFixed(2) + ' / $' + eu.limit.toFixed(0))} (${pct.toFixed(0)}%) | resets in ${resetStr}`);
    }
    console.log('');
  }

  if (blocks.length === 0) {
    console.log(chalk.yellow('No usage recorded in the last 50 hours.'));
    console.log(chalk.dim('Start a Claude Code session and data will appear here.'));
    return;
  }

  const current = blocks[0];

  // Last 5 Hours summary
  console.log(chalk.bold('Last 5 Hours'));
  if (current.request_count === 0) {
    console.log(chalk.dim('  No requests in this window.\n'));
  } else {
    console.log(`  ${chalk.white(formatCost(current.cost.total_cost))} spent | ${chalk.white(current.request_count.toString())} requests`);
    console.log(
      `  Input: ${chalk.white(formatTokens(current.tokens.input_tokens))} | ` +
        `Output: ${chalk.white(formatTokens(current.tokens.output_tokens))} | ` +
        `Cache: ${chalk.white(formatTokens(current.tokens.cache_read_tokens))}`,
    );
  }

  // Recent blocks table
  const pastBlocks = blocks.filter((b) => !b.is_current && b.request_count > 0);
  if (pastBlocks.length > 0) {
    console.log(chalk.bold('\nPrevious 5-Hour Windows'));

    const table = new Table({
      head: ['Window Start', 'Requests', 'Tokens', 'Cost'].map((h) => chalk.cyan(h)),
      colAligns: ['left', 'right', 'right', 'right'],
      style: { head: [], border: [] },
    });

    for (const block of pastBlocks) {
      table.push([
        formatBlockTime(block.block_start),
        block.request_count.toString(),
        formatTokens(block.tokens.total_tokens),
        formatCost(block.cost.total_cost),
      ]);
    }

    console.log(table.toString());
  }

  console.log(chalk.dim('\nNote: These are your usage patterns grouped by 5-hour windows.'));
  console.log(chalk.dim('They do not reflect Anthropic\'s actual rate limit calculations.'));
}

async function loadAndDisplay(mode: CostMode, opts: { since?: string; until?: string; project?: string }): Promise<void> {
  const dirs = getProjectDirs();
  const files = findJsonlFiles(dirs);

  if (files.length === 0) {
    console.log(chalk.yellow('No JSONL files found. Waiting for data...'));
    return;
  }

  const { entries } = await parseAllFiles(files);
  const unique = deduplicateEntries(entries);
  const filtered = filterEntries(unique, {
    since: opts.since,
    until: opts.until,
    project: opts.project,
  });

  const blocks = aggregateBlocks(filtered, mode);

  displayBlocks(blocks);
}

export function registerBlocksCommand(program: Command): void {
  program
    .command('blocks')
    .description('Show usage grouped by 5-hour windows')
    .option('--json', 'Output as JSON')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--live', 'Auto-refresh every 5 seconds')
    .action(async (opts) => {
      const mode = parseCostMode(opts.mode);

      if (opts.json) {
        const dirs = getProjectDirs();
        const files = findJsonlFiles(dirs);
        const { entries } = await parseAllFiles(files);
        const unique = deduplicateEntries(entries);
        const filtered = filterEntries(unique, {
          since: opts.since,
          until: opts.until,
        });
        const blocks = aggregateBlocks(filtered, mode);
        console.log(JSON.stringify(blocks, null, 2));
        return;
      }

      if (opts.live) {
        // Initial render
        clearScreen();
        await loadAndDisplay(mode, opts);

        const timer = setInterval(async () => {
          try {
            clearScreen();
            await loadAndDisplay(mode, opts);
            console.log(chalk.dim('\nPress Ctrl+C to exit'));
          } catch {
            // Silently continue on transient errors
          }
        }, 5000);

        process.on('SIGINT', () => {
          clearInterval(timer);
          clearScreen();
          console.log(chalk.dim('Block monitor stopped.'));
          process.exit(0);
        });
      } else {
        await loadAndDisplay(mode, opts);
      }
    });
}
