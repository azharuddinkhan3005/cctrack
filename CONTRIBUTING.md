# Contributing to cctrack

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/azharuddinkhan3005/cctrack.git
cd cctrack

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test          # Unit tests (vitest)
pnpm test:e2e      # Browser tests (Playwright)
pnpm test:all      # Both

# Type check
pnpm typecheck

# Run the CLI locally
node dist/index.js daily
node dist/index.js dashboard
```

## Project Structure

```
src/
  core/         Engine: parser, dedup, pricing, calculator, aggregator,
                burnrate, budget, rate-model, cache, data-pipeline,
                hierarchy, types
  commands/     13 CLI commands (daily, monthly, session, blocks, dashboard,
                export, roi, live, statusline, pricing, config, limits, mcp)
  mcp/          MCP server: server.ts (tool handlers), index.ts (entry point)
  utils/        Helpers: fs (project resolution), format (cost/tokens/csv),
                date (timezone)
pricing/        Bundled Anthropic model pricing data
tests/          Playwright E2E tests for the dashboard
```

## How It Works

1. **Parse** — Read JSONL files from `~/.claude/projects/`, validate with Zod, skip non-usage entries
2. **Deduplicate** — requestId > messageId > content hash (3-tier)
3. **Resolve projects** — Map file paths to project names via filesystem directory structure
4. **Calculate costs** — Tiered pricing at 200K token threshold, per-model rates, pricing snapshots
5. **Cache** — Save parsed entries to `~/.cctrackr/history/` for data preservation
6. **Aggregate** — Single-pass into daily/monthly/session/project/model views
7. **Render** — Terminal tables, JSON, CSV, MCP, or interactive HTML dashboard

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests for your changes
4. Run `pnpm test` and `pnpm typecheck` — both must pass
5. Run `pnpm build` to verify the build succeeds
6. Submit a pull request

## Guidelines

- Keep changes focused — one feature or fix per PR
- Add tests for new functionality
- Follow existing code patterns (ESM imports, in-source vitest tests)
- Use `formatCost`, `formatTokens`, `shortenModelName` from `utils/format.ts` for consistency
- Use `parseCostMode` for any command that accepts `--mode`
- Use `loadData()` from `core/data-pipeline.ts` for data loading (not raw parse/dedup)
- When adding MCP tools, add handler in `src/mcp/server.ts` and tests in `src/mcp/server-handlers.test.ts`
- Run the full test suite before submitting

## Reporting Issues

When filing a bug report, please include:
- Your Node.js version (`node --version`)
- Your OS (macOS / Linux / Windows)
- The command you ran and its output
- The expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
