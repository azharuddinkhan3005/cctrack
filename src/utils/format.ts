export function formatCost(cost: number): string {
  if (cost < 0) return `-$${Math.abs(cost).toFixed(2)}`;
  if (cost < 0.01 && cost > 0) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Validate CostMode from CLI input. Returns valid mode or exits with error. */
export function parseCostMode(input: string | undefined): 'calculate' | 'display' | 'compare' {
  const mode = input ?? 'calculate';
  if (mode === 'calculate' || mode === 'display' || mode === 'compare') return mode;
  console.error(`Invalid mode: "${mode}". Choose from: calculate, display, compare`);
  process.exit(1);
}

/** Escape a value for CSV: wrap in quotes if it contains comma, quote, or newline */
export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('formatCost', () => {
    it('formats zero as $0.00', () => expect(formatCost(0)).toBe('$0.00'));
    it('formats sub-cent with 4 decimals', () => expect(formatCost(0.0012)).toBe('$0.0012'));
    it('formats $0.0099 with 4 decimals', () => expect(formatCost(0.0099)).toBe('$0.0099'));
    it('formats $0.01 with 2 decimals', () => expect(formatCost(0.01)).toBe('$0.01'));
    it('formats $1.50 with 2 decimals', () => expect(formatCost(1.5)).toBe('$1.50'));
    it('formats large cost', () => expect(formatCost(1234.56)).toBe('$1234.56'));
    it('formats negative cost with minus before $', () => expect(formatCost(-5)).toBe('-$5.00'));
  });

  describe('formatTokens', () => {
    it('formats millions', () => expect(formatTokens(1_500_000)).toBe('1.5M'));
    it('formats thousands', () => expect(formatTokens(1_500)).toBe('1.5K'));
    it('formats small numbers as-is', () => expect(formatTokens(999)).toBe('999'));
    it('formats zero', () => expect(formatTokens(0)).toBe('0'));
  });

  describe('formatDuration', () => {
    it('formats seconds', () => expect(formatDuration(5000)).toBe('5s'));
    it('formats minutes', () => expect(formatDuration(125_000)).toBe('2m 5s'));
    it('formats hours', () => expect(formatDuration(3_725_000)).toBe('1h 2m'));
    it('formats zero', () => expect(formatDuration(0)).toBe('0s'));
  });

  describe('csvEscape', () => {
    it('passes plain text through', () => expect(csvEscape('hello')).toBe('hello'));
    it('wraps text with comma', () => expect(csvEscape('a,b')).toBe('"a,b"'));
    it('escapes double quotes', () => expect(csvEscape('say "hi"')).toBe('"say ""hi"""'));
    it('wraps text with newline', () => expect(csvEscape('a\nb')).toBe('"a\nb"'));
  });

  describe('shortenModelName', () => {
    it('shortens opus-4.6', () => expect(shortenModelName('claude-opus-4-6-20260205')).toBe('opus-4.6'));
    it('shortens sonnet-4.6', () => expect(shortenModelName('claude-sonnet-4-6-20260217')).toBe('sonnet-4.6'));
    it('shortens opus-4', () => expect(shortenModelName('claude-opus-4-20250514')).toBe('opus-4'));
    it('shortens haiku-4.5', () => expect(shortenModelName('claude-haiku-4-5-20251001')).toBe('haiku-4.5'));
    it('shortens legacy sonnet-3.5', () => expect(shortenModelName('claude-3-5-sonnet-20241022')).toBe('sonnet-3.5'));
    it('strips claude- prefix for unknown', () => expect(shortenModelName('claude-custom-model')).toBe('custom-model'));
    it('returns non-claude model as-is', () => expect(shortenModelName('gpt-4')).toBe('gpt-4'));
  });

  describe('parseCostMode', () => {
    it('accepts calculate', () => expect(parseCostMode('calculate')).toBe('calculate'));
    it('accepts display', () => expect(parseCostMode('display')).toBe('display'));
    it('accepts compare', () => expect(parseCostMode('compare')).toBe('compare'));
    it('defaults to calculate', () => expect(parseCostMode(undefined)).toBe('calculate'));
  });

}

/** Shorten Claude model names for display: claude-opus-4-6-20260205 → opus-4.6 */
export function shortenModelName(model: string): string {
  const map: Record<string, string> = {
    'claude-opus-4-6': 'opus-4.6',
    'claude-sonnet-4-6': 'sonnet-4.6',
    'claude-opus-4-5': 'opus-4.5',
    'claude-sonnet-4-5': 'sonnet-4.5',
    'claude-haiku-4-5': 'haiku-4.5',
    'claude-opus-4': 'opus-4',
    'claude-sonnet-4': 'sonnet-4',
    'claude-3-7-sonnet': 'sonnet-3.7',
    'claude-3-5-sonnet': 'sonnet-3.5',
    'claude-3-5-haiku': 'haiku-3.5',
    'claude-3-opus': 'opus-3',
    'claude-3-sonnet': 'sonnet-3',
    'claude-3-haiku': 'haiku-3',
  };
  for (const [prefix, short] of Object.entries(map)) {
    if (model.startsWith(prefix)) return short;
  }
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
