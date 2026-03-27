# cctrack

[![npm version](https://img.shields.io/npm/v/cctrack)](https://www.npmjs.com/package/cctrack)
[![license](https://img.shields.io/npm/l/cctrack)](https://github.com/azharuddinkhan3005/cctrack/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/cctrack)](https://nodejs.org)

Claude Code usage analytics — accurate cost tracking and a beautiful interactive dashboard from your local JSONL files.

### Dashboard

<p align="center">
  <img src="assets/dashboard-dark.png" alt="cctrack dashboard — dark mode" width="100%">
</p>

<details>
<summary>Light mode</summary>
<p align="center">
  <img src="assets/dashboard-light.png" alt="cctrack dashboard — light mode" width="100%">
</p>
</details>

## Quick Start

```bash
npx cctrack@latest
```

Or install globally:

```bash
npm install -g cctrack
```

## Features

- **Accurate cost calculation** — 3-tier deduplication (requestId > messageId > hash), tiered pricing at 200K token threshold
- **14 Anthropic models** with 24 aliases, dynamic pricing with bundled fallback
- **Interactive HTML dashboard** — 12 panels, project/date filters, dark/light mode, ECharts charts
- **Per-project breakdown** — automatically resolves subagent paths to parent projects
- **Budget alerts** — 4-level system (safe/warning/critical/exceeded) with configurable daily/monthly budgets
- **5-hour window tracking** — usage patterns grouped by Anthropic-style time windows
- **ROI calculator** — compare API-equivalent cost against Pro/Max5/Max20 subscription plans
- **Real-time monitor** — live terminal display with burn rate projections
- **Rate limit intelligence** — tracks billable tokens (input + cache_creation, NOT cache_read)
- **Multiple output formats** — terminal tables, JSON, CSV for every command

## Commands

| Command | Description |
|---|---|
| `cctrack` | Open interactive HTML dashboard (default) |
| `cctrack daily` | Daily usage breakdown with cost sparklines |
| `cctrack monthly` | Monthly aggregated view |
| `cctrack session` | Per-session breakdown with multi-model indicator |
| `cctrack blocks` | Usage grouped by 5-hour windows |
| `cctrack roi --plan max5` | ROI analysis vs subscription plans |
| `cctrack export csv` | Export per-request data as CSV |
| `cctrack export json` | Export structured JSON |
| `cctrack live` | Real-time terminal monitor |
| `cctrack statusline` | Ultra-fast output for tmux/editors |
| `cctrack limits` | Rate limit analysis (billable token tracking) |
| `cctrack pricing list` | View all model prices |
| `cctrack config set budget.daily 100` | Set daily budget alert |

## Example Output

```
$ cctrack daily

┌────────────┬────────┬────────┬─────────────┬────────────┬────────┬──────────────────┐
│ Date       │  Input │ Output │ Cache Write │ Cache Read │  Total │             Cost │
├────────────┼────────┼────────┼─────────────┼────────────┼────────┼──────────────────┤
│ 2026-03-25 │  12.3K │  45.6K │        1.8M │     156.2M │ 158.1M │  $92.45 ████████ │
│ 2026-03-26 │   8.1K │  32.4K │        1.2M │      98.7M │  99.9M │  $58.30 █████░░░ │
└────────────┴────────┴────────┴─────────────┴────────────┴────────┴──────────────────┘
Daily Budget: ████████████░░░░░░░░ 58% ($58.30 / $100.00)
────────────────────────────────────────────────────────────
Total: 258.0M tokens, $150.75
Burn rate: $3.14/hr, $75.38/day → projected $2261.25/month
```

```
$ cctrack session

┌─────────────────┬─────────────┬─────────────┬──────────┬──────────┬────────┬─────────┐
│ Session ID      │ Project     │ Model       │ Duration │ Requests │ Tokens │    Cost │
├─────────────────┼─────────────┼─────────────┼──────────┼──────────┼────────┼─────────┤
│ a1b2c3d4-e5f... │ my-app      │ opus-4.6    │  18h 30m │      620 │ 210.5M │ $122.40 │
│ f6e5d4c3-b2a... │ my-api      │ sonnet-4.6  │   8h 15m │      195 │  47.5M │  $28.35 │
└─────────────────┴─────────────┴─────────────┴──────────┴──────────┴────────┴─────────┘
2 sessions, 815 requests, 258.0M tokens, $150.75
```

```
$ cctrack statusline
$58.30 today │ opus-4.6 │ 99.9M tok │ █████░░░ 52% 5h (2h 15m)
```

## Common Options

Most commands support these flags:

```text
--since YYYY-MM-DD    Filter from date
--until YYYY-MM-DD    Filter to date
--project <name>      Filter by project
--mode <mode>         Cost mode: calculate (default), display, compare
--json                Output as JSON
--csv                 Output as CSV
--breakdown           Show per-model breakdown (daily/monthly)
```

## Dashboard

![cctrack dashboard](screenshots/dashboard.png)

The dashboard is a self-contained HTML file with interactive ECharts charts:

- Cost over time (bar + cumulative line)
- Input/Output token breakdown
- Cache token breakdown
- Project breakdown
- Model distribution
- Cache reuse efficiency
- Usage heatmap (day of week × hour)
- Session table (sortable)
- ROI analysis

Filter by date range and project — all panels update together.

```bash
cctrack dashboard              # Open in browser
cctrack dashboard --save report.html  # Save to file
cctrack dashboard --json       # Get raw data
```

## Budget Alerts

Set a daily spending budget:

```bash
cctrack config set budget.daily 100
```

The daily and live commands show a color-coded progress bar:

```
Daily Budget: ████████████░░░░░░░░ 62% ($62.00 / $100.00)
```

Levels: green (<50%) → yellow (50-80%) → red (80-100%) → exceeded (>100%)

## How It Works

cctrack reads Claude Code's JSONL usage logs from `~/.claude/projects/` and:

1. **Parses** entries with Zod schema validation
2. **Deduplicates** using requestId > messageId > content hash
3. **Resolves projects** from the filesystem directory structure (handles subagent paths)
4. **Calculates costs** using bundled Anthropic pricing with tiered rates
5. **Aggregates** into daily/monthly/session/project views in a single pass

## Requirements

- Node.js >= 20
- Claude Code installed (with usage data in `~/.claude/projects/`)

## Configuration

Config stored at `~/.cctrack/config.json`:

```bash
cctrack config set budget.daily 100     # Daily budget in $
cctrack config set budget.monthly 2000  # Monthly budget in $
cctrack config get                      # View current config
cctrack config reset                    # Reset to defaults
```

## Environment Variables

- `CLAUDE_CONFIG_DIR` — Custom Claude config directory (default: `~/.claude`)

## Development

```bash
git clone https://github.com/azharuddinkhan3005/cctrack.git
cd cctrack
pnpm install
pnpm build
pnpm test           # 233 unit tests
pnpm test:e2e       # 14 browser tests
node dist/index.js daily
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide and architecture overview.

## Privacy

cctrack processes all data locally on your machine. No usage data is ever transmitted to any server. The only network request is an optional fetch of Anthropic's public pricing page to keep model prices current — no user data is sent.

## Disclaimer

cctrack is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.

Pricing data is sourced from Anthropic's publicly available pricing page and may not reflect the most current rates. Always verify costs against your actual Anthropic billing.

## License

[MIT](LICENSE)

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.
