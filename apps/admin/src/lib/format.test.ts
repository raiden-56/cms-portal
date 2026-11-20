import { describe, expect, it } from 'vitest';
import { actionVerb, compactNumber, formatBytes, humanize, initials, percent, relativeTime, shortDate, toLocalInput } from './format';

describe('formatters', () => {
  it('describes time relative to now', () => {
    expect(relativeTime(new Date())).toBe('just now');
    expect(relativeTime(new Date(Date.now() - 5 * 60_000))).toBe('5 minutes ago');
    expect(relativeTime(new Date(Date.now() + 2 * 86400_000 + 60_000))).toBe('in 2 days');
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime('not a date')).toBe('—');
  });

  it('formats short dates and datetime-local values', () => {
    expect(shortDate(new Date())).toMatch(/^Today \d{2}:\d{2}$/);
    expect(shortDate('2020-03-12T10:00:00Z')).toBe('12 Mar 2020');
    expect(toLocalInput('')).toBe('');
    expect(toLocalInput(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
  });

  it('formats numbers, sizes and percentages', () => {
    expect(compactNumber(950)).toBe('950');
    expect(compactNumber(12500)).toBe('12.5K');
    expect(compactNumber(null)).toBe('—');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(percent(0.1234)).toBe('12.3%');
    expect(percent(0.0004)).toBe('0.04%');
  });

  it('derives initials and readable labels', () => {
    expect(initials('Maya Okafor')).toBe('MO');
    expect(initials('  cher ')).toBe('C');
    expect(initials(null)).toBe('?');
    expect(humanize('entry.request_changes')).toBe('Request changes');
    expect(actionVerb('entry.published')).toBe('published');
    expect(actionVerb('custom.somethingNew')).toBe('something new');
  });
});
