# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
