import { describe, expect, it } from 'vitest';
import { endlessCarryBonus, endlessScore } from '../../src/model/score';

describe('endlessCarryBonus', () => {
  it('is the aboard multiplier on top of raw distance', () => {
    expect(endlessCarryBonus(300, 0)).toBe(0);
    expect(endlessCarryBonus(300, 5)).toBe(endlessScore(300, 5) - endlessScore(300, 0));
    expect(endlessCarryBonus(300, 5)).toBe(30);
    expect(endlessCarryBonus(0, 15)).toBe(0);
  });
  it('clamps aboard and garbage like endlessScore', () => {
    expect(endlessCarryBonus(100, 99)).toBe(endlessCarryBonus(100, 15));
    expect(endlessCarryBonus(100, -3)).toBe(0);
    expect(endlessCarryBonus(NaN, 5)).toBe(0);
    expect(endlessCarryBonus(-50, 5)).toBe(0);
  });
});
