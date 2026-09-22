import { describe, expect, it } from 'vitest';
import { efficiencyRating, endlessScore } from '../../src/model/score';
import { endlessView, formatClock, formatDelivered, formatDistance, formatInt, ratingView, ratingViewOf } from '../../src/ui/format';

describe('formatClock (sim-time timer display)', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(25.99)).toBe('0:25');
    expect(formatClock(59.999)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(3599.9)).toBe('59:59');
  });
  it('switches to h:mm:ss from one hour', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3661)).toBe('1:01:01');
  });
  it('truncates tenths (never runs ahead of the clock)', () => {
    expect(formatClock(25.36, { tenths: true })).toBe('0:25.3');
    expect(formatClock(25.99, { tenths: true })).toBe('0:25.9');
    expect(formatClock(0, { tenths: true })).toBe('0:00.0');
    // steps/60 float noise must not drop a tenth
    expect(formatClock(2370 / 60, { tenths: true })).toBe('0:39.5');
    expect(formatClock(0.3, { tenths: true })).toBe('0:00.3');
    expect(formatClock(59.95, { tenths: true })).toBe('0:59.9');
  });
  it('treats garbage as zero', () => {
    for (const v of [-1, NaN, Infinity, -Infinity]) expect(formatClock(v)).toBe('0:00');
  });
});

describe('number formatting', () => {
  it('formatInt adds separators', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(-1234)).toBe('-1,234');
    expect(formatInt(NaN)).toBe('0');
  });
  it('formatDistance floors metres', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(123.99)).toBe('123 m');
    expect(formatDistance(1500)).toBe('1,500 m');
    expect(formatDistance(-5)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
  });
  it('formatDelivered clamps to 0..15', () => {
    expect(formatDelivered(11)).toBe('11/15');
    expect(formatDelivered(20)).toBe('15/15');
    expect(formatDelivered(-1)).toBe('0/15');
    expect(formatDelivered(NaN)).toBe('0/15');
  });
});

describe('rating display + band boundaries', () => {
  it('bands: 32 red, 33 yellow, 66 yellow, 67 green (and extremes)', () => {
    expect(ratingViewOf(0).band).toBe('red');
    expect(ratingViewOf(32).band).toBe('red');
    expect(ratingViewOf(33).band).toBe('yellow');
    expect(ratingViewOf(66).band).toBe('yellow');
    expect(ratingViewOf(67).band).toBe('green');
    expect(ratingViewOf(100).band).toBe('green');
    expect(ratingViewOf(66).text).toBe('66%');
    expect(ratingViewOf(32).bandLabel).toBe('low');
  });

  it('ratingView uses model/score (original 66% screenshot: 0:25 x 11/15)', () => {
    const v = ratingView(25, 11);
    expect(v.rating).toBe(efficiencyRating(25, 11));
    expect(v).toMatchObject({ rating: 66, band: 'yellow', text: '66%' });
  });

  it('boundary runs land in the right band', () => {
    // 5/15 in par time -> 33 (yellow); 5/15 at 18 s -> round(97/3) = 32 (red)
    expect(ratingView(10, 5)).toMatchObject({ rating: 33, band: 'yellow' });
    expect(ratingView(18, 5)).toMatchObject({ rating: 32, band: 'red' });
    // 10/15 in par time -> 67 (green); 10/15 at 16 s -> 66 (yellow)
    expect(ratingView(14, 10)).toMatchObject({ rating: 67, band: 'green' });
    expect(ratingView(16, 10)).toMatchObject({ rating: 66, band: 'yellow' });
  });

  it('scoring boundary cases: 0 delivered, 15/15, >115 s', () => {
    expect(ratingView(10, 0)).toMatchObject({ rating: 0, band: 'red' });
    expect(ratingView(12, 15)).toMatchObject({ rating: 100, band: 'green' });
    expect(ratingView(130, 15)).toMatchObject({ rating: 0, band: 'red' });
  });
});

describe('endlessView', () => {
  it('score and bonus come from model/score endlessScore', () => {
    const v = endlessView(300, 5);
    expect(v.score).toBe(endlessScore(300, 5));
    expect(v.bonus).toBe(endlessScore(300, 5) - endlessScore(300, 0));
    expect(v.bonus).toBeGreaterThan(0);
    expect(v.distanceText).toBe('300 m');
    expect(endlessView(300, 0).bonus).toBe(0);
    expect(endlessView(100, 99).aboard).toBe(15);
  });
});
