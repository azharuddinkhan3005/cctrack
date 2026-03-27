# cctrack

[![npm version](https://img.shields.io/npm/v/cctrack)](https://www.npmjs.com/package/cctrack)
[![license](https://img.shields.io/npm/l/cctrack)](https://github.com/azharuddinkhan3005/cctrack/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/cctrack)](https://nodejs.org)

Know exactly what Claude Code costs you. Accurate token tracking, cost breakdowns, and a beautiful interactive dashboard -- all from your local JSONL logs.

## What It Does

cctrack reads Claude Code's local usage logs and turns them into actionable analytics. It deduplicates requests, applies Anthropic's tiered pricing, and gives you cost breakdowns by day, session, project, and model -- in the terminal or as an interactive HTML dashboard.

<p align="center">
  <img src="assets/dashboard-hero.png" alt="cctrack dashboard overview" width="100%">
</p>

## Quick Start

```bash
npx cctrack@latest
```

That's it. Your dashboard opens in the browser with your full usage history.

To install globally:

```bash
npm install -g cctrack
```

## Dashboard Panels

The dashboard is a self-contained HTML file with 9 interactive panels. Filter by date range or project -- all panels update together. Supports dark and light mode.

### Cost Over Time

<img src="assets/panel-cost.png" alt="Cost Over Time" width="700">

Daily spend as bars with a cumulative cost trendline. Spot spending spikes and trends at a glance.

### Input / Output Tokens

<img src="assets/panel-io.png" alt="I/O Tokens" width="700">

Input vs. output token volume per day. See how much you're sending versus receiving.

### Cache Tokens

<img src="assets/panel-cache.png" alt="Cache Tokens" width="700">

Cache write vs. cache read volume over time. High cache reads relative to writes means you're getting good prompt caching value.

### Project Breakdown

<img src="assets/panel-project.png" alt="Project Breakdown" width="700">

Cost per project as a horizontal bar chart. Instantly see which projects consume the most.

### Model Distribution

<img src="assets/panel-model.png" alt="Model Distribution" width="700">

Spend split by model. Understand how your costs divide across Opus, Sonnet, Haiku, and others.

### Cache Reuse Efficiency

<img src="assets/panel-cache-eff.png" alt="Cache Efficiency" width="700">

Cache hit rate over time. Track whether your workflows are effectively reusing cached prompts.

### Usage Heatmap

<img src="assets/panel-heatmap.png" alt="Usage Heatmap" width="700">

Hour-of-day by day-of-week activity map. See when you use Claude Code the most.

### Sessions

<img src="assets/panel-sessions.png" alt="Sessions table" width="700">

Sortable table of every session with project, model, duration, request count, tokens, and cost.

### ROI Analysis

<img src="assets/panel-roi.png" alt="ROI Analysis" width="700">

Compares your projected monthly cost against Pro, Max 5x, and Max 20x subscription plans so you can see which plan gives you the best value.

## CLI Commands

| Command | Description |
|---|---|
| `cctrack` | Open interactive HTML dashboard (default) |
| `cctrack daily` | Daily usage breakdown with cost sparklines |
| `cctrack monthly` | Monthly aggregated view |
| `cctrack session` | Per-session breakdown with project and model |
| `cctrack blocks` | Usage grouped by 5-hour windows |
| `cctrack roi` | ROI analysis vs subscription plans |
| `cctrack live` | Real-time terminal monitor with burn rate |
| `cctrack statusline` | Compact one-line output for tmux/editors |
| `cctrack limits` | Rate limit analysis (billable token tracking) |
| `cctrack export csv` | Export per-request data as CSV |
| `cctrack export json` | Export structured JSON |
| `cctrack pricing list` | View all model prices |
| `cctrack config` | Manage budgets and settings |

## Terminal Output Examples

**Daily breakdown:**

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

**Session view:**

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

**Statusline (for tmux or editor status bars):**

```
$ cctrack statusline
$58.30 today │ opus-4.6 │ 99.9M tok │ █████░░░ 52% 5h (2h 15m)
```

## Options

Most commands accept these flags:

```
--since YYYY-MM-DD    Filter from date
--until YYYY-MM-DD    Filter to date
--project <name>      Filter by project
--mode <mode>         Cost mode: calculate (default), display, compare
--json                Output as JSON
--csv                 Output as CSV
--breakdown           Show per-model breakdown (daily/monthly)
```

## Budget Alerts

Set daily or monthly spending budgets:

```bash
cctrack config set budget.daily 100
cctrack config set budget.monthly 2000
```

The `daily` and `live` commands show a color-coded progress bar:

```
Daily Budget: ████████████░░░░░░░░ 62% ($62.00 / $100.00)
```

| Level | Threshold | Color |
|---|---|---|
| Safe | < 50% | Green |
| Warning | 50 -- 80% | Yellow |
| Critical | 80 -- 100% | Red |
| Exceeded | > 100% | Red (flashing) |

## How It Works

cctrack reads Claude Code's JSONL usage logs from `~/.claude/projects/` and processes them in five steps:

1. **Parse** -- Validates each JSONL entry against a Zod schema, skips non-usage entries
2. **Deduplicate** -- Removes duplicates using requestId > messageId > content hash (3-tier)
3. **Resolve projects** -- Maps filesystem paths to project names, handles subagent paths
4. **Calculate costs** -- Applies Anthropic's per-token pricing with tiered rates at the 200K threshold
5. **Aggregate** -- Builds daily, monthly, session, and project views in a single pass

## Known Limitations

cctrack is built on Claude Code's local JSONL logs and has inherent accuracy boundaries. We want to be upfront about what it can and cannot tell you.

### Billable tokens vs. total tokens

Anthropic does not count `cache_read` tokens toward rate limits -- only `input` and `cache_creation` tokens are billable. cctrack's `limits` command reports billable tokens using this formula. This matters because cache-heavy sessions can show 200M+ total tokens while only 2M are actually billable. **Cost calculations use all token types at their correct per-type rates, but rate limit analysis intentionally excludes cache_read.**

### Statusline data depends on your setup

`cctrack statusline` is designed to be used as a Claude Code statusline hook (configured via `.claude/settings.json`). When configured this way, it receives real rate limit data (`used_percentage`, `resets_at`) directly from Claude Code's stdin on every assistant message. **If you run `cctrack statusline` manually from a terminal, this real-time rate limit data is not available** -- you will only see cost and token data derived from JSONL logs.

### Blocks are approximations, not Anthropic's actual windows

`cctrack blocks` groups your usage into 5-hour windows to help you see usage patterns. These windows are based on your local timestamps and do not correspond to Anthropic's internal rate limit windows. Anthropic's rate limiting involves multiple overlapping systems that are not publicly documented and cannot be reconstructed from JSONL data alone.

### Rate limit prediction is uncalibrated

cctrack includes an EMA-based predictive model for rate limit estimation, but it requires calibration data (actual rate limit events) to be accurate. Most users -- especially those on Max plans -- rarely hit rate limits, so the model will have little or no calibration data. Treat its predictions as rough estimates, not precise forecasts.

### JSONL logs don't capture everything

- **Web usage** (claude.ai) shares the same rate limit pool but is not recorded in local JSONL files
- **Output token counts** in JSONL may undercount actual consumption in some cases
- **Plan changes** (e.g., switching from Pro to Max 5x) invalidate historical rate limit estimates
- **Extra usage credits** extend the effective limit dynamically and are not visible in logs

### Cost estimates vs. actual billing

cctrack uses Anthropic's publicly listed per-token prices. Your actual bill may differ due to volume discounts, enterprise agreements, or pricing changes not yet reflected in cctrack's bundled price table. Always verify against your Anthropic billing dashboard.

## Configuration

Config is stored at `~/.cctrack/config.json`:

```bash
cctrack config set budget.daily 100     # Daily budget in $
cctrack config set budget.monthly 2000  # Monthly budget in $
cctrack config get                      # View current config
cctrack config reset                    # Reset to defaults
```

**Environment variables:**

| Variable | Description | Default |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | Custom Claude config directory | `~/.claude` |

## Requirements

- Node.js >= 20
- Claude Code installed (with usage data in `~/.claude/projects/`)

## Privacy

cctrack processes all data locally on your machine. No usage data is ever transmitted to any server. The only network request is an optional fetch of Anthropic's public pricing page to keep model prices current -- no user data is sent.

## Disclaimer

cctrack is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.

Pricing data is sourced from Anthropic's publicly available pricing page and may not reflect the most current rates. Always verify costs against your actual Anthropic billing.

## Development

```bash
git clone https://github.com/azharuddinkhan3005/cctrack.git
cd cctrack
pnpm install
pnpm build
pnpm test           # 280 unit tests
pnpm test:e2e       # 14 browser tests
node dist/index.js daily
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.

## License

[MIT](LICENSE)

## Contributing

Issues and PRs welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.
