import { describe, expect, it } from 'vitest';
import { isFinalSetBelowTarget } from './generator.js';

const set = (extra = {}) => ({
  done: true, weight: 30, targetWeight: 30, reps: 13, targetReps: 13, ...extra,
});
const belowTarget = (sets) => isFinalSetBelowTarget({ sets }, sets.length - 1, { done: true });

describe('volume shortfall after a manual load increase', () => {
  it.each([8, 10])('does not interpret %s reps at a heavier load as fatigue against the old 13-rep target', (reps) => {
    expect(belowTarget([set({ weight: 35, reps })])).toBe(false);
  });

  it('still detects a shortfall at the same or a reduced load', () => {
    expect(belowTarget([set({ reps: 8 })])).toBe(true);
    expect(belowTarget([set({ weight: 25, reps: 8 })])).toBe(true);
  });

  it('still detects missed reps on other sets after a load increase', () => {
    expect(belowTarget([set({ weight: 35, reps: 10 }), set({ reps: 3 })])).toBe(true);
  });

  it('does not exempt a heavier set with no completed repetitions', () => {
    expect(belowTarget([set({ weight: 35, reps: 0 })])).toBe(true);
  });

  it('checks only when the exercise is completed and includes the final override', () => {
    expect(isFinalSetBelowTarget({ sets: [set({ done: false }), set({ done: false })] }, 0)).toBe(false);
    expect(isFinalSetBelowTarget({ sets: [set({ reps: 8 })] }, 0, { weight: 35 })).toBe(false);
  });
});
