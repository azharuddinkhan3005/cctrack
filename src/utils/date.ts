export function toDateString(timestamp: string, timezone?: string): string {
  const date = new Date(timestamp);
  if (timezone) {
    return date.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
  }
  return date.toISOString().slice(0, 10);
}

export function toMonthString(timestamp: string, timezone?: string): string {
  return toDateString(timestamp, timezone).slice(0, 7);
}

export function getHourAndDay(timestamp: string, timezone?: string): { hour: number; day: number } {
  const date = new Date(timestamp);
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour');
    const dayPart = parts.find((p) => p.type === 'weekday');
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      hour: parseInt(hourPart?.value ?? '0', 10),
      day: dayMap[dayPart?.value ?? 'Sun'] ?? 0,
    };
  }
  return { hour: date.getUTCHours(), day: date.getUTCDay() };
}

export function isInRange(timestamp: string, since?: string, until?: string): boolean {
  const date = timestamp.slice(0, 10);
  if (since && date < since) return false;
  if (until && date > until) return false;
  return true;
}

// === In-source Tests ===

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('toDateString', () => {
    it('returns YYYY-MM-DD for UTC', () => {
      expect(toDateString('2025-03-25T10:00:00Z')).toBe('2025-03-25');
    });

    it('respects timezone', () => {
      // 23:00 UTC on Mar 25 = Mar 26 in IST (UTC+5:30)
      expect(toDateString('2025-03-25T23:00:00Z', 'Asia/Kolkata')).toBe('2025-03-26');
    });

    it('handles midnight boundary', () => {
      expect(toDateString('2025-03-25T00:00:00Z')).toBe('2025-03-25');
    });
  });

  describe('toMonthString', () => {
    it('returns YYYY-MM', () => {
      expect(toMonthString('2025-03-25T10:00:00Z')).toBe('2025-03');
    });

    it('respects timezone for month boundary', () => {
      // Mar 31 23:00 UTC = Apr 1 in IST
      expect(toMonthString('2025-03-31T23:00:00Z', 'Asia/Kolkata')).toBe('2025-04');
    });
  });

  describe('getHourAndDay', () => {
    it('returns UTC hour and day by default', () => {
      // 2025-03-25 is Tuesday (day=2)
      const result = getHourAndDay('2025-03-25T14:30:00Z');
      expect(result.hour).toBe(14);
      expect(result.day).toBe(2);
    });

    it('respects timezone', () => {
      // 14:00 UTC = 19:30 IST, still Tuesday
      const result = getHourAndDay('2025-03-25T14:00:00Z', 'Asia/Kolkata');
      expect(result.hour).toBe(19);
      expect(result.day).toBe(2);
    });

    it('handles day rollover with timezone', () => {
      // 20:00 UTC on Tuesday = 01:30 Wed IST
      const result = getHourAndDay('2025-03-25T20:00:00Z', 'Asia/Kolkata');
      expect(result.hour).toBe(1);
      expect(result.day).toBe(3); // Wednesday
    });

    it('handles Sunday correctly', () => {
      // 2025-03-23 is a Sunday
      const result = getHourAndDay('2025-03-23T10:00:00Z');
      expect(result.day).toBe(0);
    });
  });

  describe('isInRange', () => {
    it('returns true when no filters', () => {
      expect(isInRange('2025-03-25T10:00:00Z')).toBe(true);
    });

    it('filters by since', () => {
      expect(isInRange('2025-03-24T10:00:00Z', '2025-03-25')).toBe(false);
      expect(isInRange('2025-03-25T10:00:00Z', '2025-03-25')).toBe(true);
      expect(isInRange('2025-03-26T10:00:00Z', '2025-03-25')).toBe(true);
    });

    it('filters by until', () => {
      expect(isInRange('2025-03-26T10:00:00Z', undefined, '2025-03-25')).toBe(false);
      expect(isInRange('2025-03-25T10:00:00Z', undefined, '2025-03-25')).toBe(true);
    });

    it('filters by both since and until', () => {
      expect(isInRange('2025-03-25T10:00:00Z', '2025-03-25', '2025-03-25')).toBe(true);
      expect(isInRange('2025-03-24T10:00:00Z', '2025-03-25', '2025-03-26')).toBe(false);
      expect(isInRange('2025-03-27T10:00:00Z', '2025-03-25', '2025-03-26')).toBe(false);
    });

    it('includes entry at 23:59 on the same day', () => {
      expect(isInRange('2025-03-25T23:59:59Z', '2025-03-25', '2025-03-25')).toBe(true);
    });

    it('returns false when since > until (impossible range)', () => {
      expect(isInRange('2025-03-25T10:00:00Z', '2025-03-26', '2025-03-24')).toBe(false);
    });
  });
}
