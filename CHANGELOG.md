# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-02

### Added

- **Session Detail View** -- `cctrackr session <id>` drills into a specific session showing per-request breakdown with timestamp, model, tokens, and cost. Supports prefix matching and `--limit`.
- **Agent/Subagent Hierarchy** -- `cctrackr session <id> --hierarchy` shows all subagents spawned in a session with their type and description.
- **Data Preservation** -- Parsed entries automatically cached to `~/.cctrackr/history/`. Survives Claude Code's 30-day log deletion. Transparent to all commands.
- **Pricing Snapshots** -- Cost calculations capture the exact rates used, so historical costs stay accurate after price changes.
- **MCP Server** -- `cctrackr mcp` starts a Model Context Protocol server for Claude Desktop integration. 7 tools covering daily usage, sessions, budgets, ROI, rate limits, and dashboard data.
- **Dashboard: Model Breakdown** -- Hover the multi-model badge to see per-model tokens, cost, and percentage.
- **Dashboard: Session Tooltips** -- Full session ID on hover with one-click copy.
- **Dashboard: Sort Indicators** -- Column headers show sort direction arrows.
- **Dashboard: Pricing Version** -- Footer shows which pricing data was used for calculations.

### Improved

- **Security** -- XSS hardening (quote escaping), symlink guard in filesystem walker, atomic cache writes, `pnpm audit` in CI, `.npmrc ignore-scripts`.
- **Dashboard Responsiveness** -- ResizeObserver ensures charts adapt when viewport changes without refresh.
- **Heatmap** -- Capped cell sizes for consistent proportions. Empty cells visible in dark mode.
- **Unified Data Pipeline** -- All commands refactored to use shared `loadData()` with cache integration.

### Changed

- New runtime dependency: `@modelcontextprotocol/sdk` (5 total production deps).
- 380 unit tests across 26 test files + 14 E2E tests.
- `test-helpers` excluded from published npm package.

## [0.1.0] - 2026-03-27

### Added

- **12 CLI commands**: daily, monthly, session, blocks, dashboard, export (csv/json), roi, live, statusline, pricing, config, limits
- **Interactive HTML dashboard** with ECharts — 12 panels, project/date filters, dark/light mode, per-project heatmaps
- **Accurate cost calculation** — 3-tier deduplication, tiered pricing at 200K token threshold, 14 Anthropic models with 24 aliases
- **Per-project breakdown** — filesystem-based project resolution, handles subagent paths
- **Budget alerts** — 4-level system (safe/warning/critical/exceeded), configurable daily/monthly budgets
- **5-hour window tracking** — usage patterns grouped by time windows
- **ROI calculator** — compare against Pro ($20), Max 5x ($100), Max 20x ($200) plans with fuzzy aliases
- **Real-time terminal monitor** — live display with burn rate and budget status
- **Statusline** — ultra-fast cached output for tmux/neovim/Claude Code hooks, captures rate_limits from stdin
- **Rate limit intelligence** — predictive EMA model, tracks billable tokens (input + cache_creation, excludes cache_read)
- **Multiple output formats** — terminal tables, JSON, CSV for every command
- **233 tests** — unit tests with vitest, E2E tests with Playwright
- **ARIA accessibility** in dashboard charts
- **Print support** — dashboard charts convert to images for printing
- **Colorblind-safe heatmap** — multi-hue gradient instead of single-color
