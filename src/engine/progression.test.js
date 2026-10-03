import { describe, expect, it } from 'vitest';
import { calculateProgression } from './progression.js';

const set = (overrides = {}) => ({ done: true, targetWeight: 60, weight: 60, targetReps: 8, reps: 8, targetRir: 2, rir: 2, ...overrides });
const calculate = (overrides = {}) => calculateProgression({
  sets: [set(), set()], usesWeight: true, loads: [50, 60, 61, 70],
  limits: { minReps: 8, maxReps: 12 }, targetRirs: [2, 2], workingWeight: 60,
  estimateMax: (weight, reps, rir) => weight * (1 + (reps + rir) / 30),
  estimateReps: (max, weight) => (max / weight - 1) * 30,
  ...overrides,
});

describe('prescription decisions', () => {
  it('reduces reps at the same load before considering a lower load', () => {
    for (const reps of [8, 9, 10, 11]) {
      const next = calculate({ sets: [set({ targetReps: 12, reps }), set({ targetReps: 12, reps })], decision: 'recalibrate-down' });
      expect(next.weight).toBe(60);
      expect(next.targetReps).toEqual([reps, reps]);
    }
  });
  it('uses recorded capacity at the same load without estimating it again', () => {
    const next = calculate({ sets: [set({ targetReps: 12, reps: 9, rir: 1 }), set({ targetReps: 12, reps: 9, rir: 1 })], decision: 'recalibrate-down', estimateMax: () => { throw new Error('Unnecessary strength estimate'); } });
    expect(next.weight).toBe(60);
    expect(next.targetReps).toEqual([8, 8]);
  });
  it('drops load only below the rep floor and restarts at that floor', () => {
    const next = calculate({ sets: [set({ targetReps: 12, reps: 5 }), set({ targetReps: 12, reps: 5 })], decision: 'recalibrate-down' });
    expect(next.weight).toBe(50);
    expect(next.targetReps).toEqual([8, 8]);
  });
  it('retains the current load at six or seven reps below the nominal range', () => {
    for (const reps of [6, 7]) {
      const next = calculate({ sets: [set({ reps }), set({ reps })], decision: 'recalibrate-down' });
      expect(next.weight).toBe(60);
      expect(next.targetReps).toEqual([reps, reps]);
    }
  });
  it('respects a custom recalibration minimum', () => {
    const next = calculate({ sets: [set({ reps: 7 }), set({ reps: 7 })], decision: 'recalibrate-down', limits: { minReps: 8, maxReps: 12, recalibrationMinReps: 8 } });
    expect(next.weight).toBe(50);
    expect(next.targetReps).toEqual([8, 8]);
  });
  it('uses recent demonstrated reps instead of erasing them after one poor session', () => {
    const next = calculate({
      sets: [set({ reps: 6, targetReps: 11 }), set({ reps: 6, targetReps: 11 })],
      decision: 'recalibrate-down',
      recentSessions: [{ sets: [set({ reps: 10, targetReps: 10 }), set({ reps: 10, targetReps: 10 })] }],
    });
    expect(next.weight).toBe(60);
    expect(next.targetReps).toEqual([10, 10]);
    expect(next.reason).toBe('recent-level-preserved');
  });
  it('allows regression after consecutive failed comparable sessions', () => {
    const next = calculate({ sets: [set({ reps: 6 }), set({ reps: 6 })], decision: 'recalibrate-down', recentSessions: [
      { sets: [set({ reps: 10 }), set({ reps: 10 })] },
      { sets: [set({ reps: 7 }), set({ reps: 7 })] },
    ] });
    expect(next.weight).toBe(60);
    expect(next.targetReps).toEqual([6, 6]);
  });
  it('does not use fewer sets, different loads or excessive effort as proof', () => {
    for (const recorded of [[set({ reps: 10 })], [set({ weight: 50, reps: 10 }), set({ weight: 50, reps: 10 })], [set({ reps: 8, rir: 0 }), set({ reps: 8, rir: 0 })]]) {
      const next = calculate({ sets: [set({ reps: 6 }), set({ reps: 6 })], decision: 'recalibrate-down', recentSessions: [{ sets: recorded }] });
      expect(next.targetReps).toEqual([6, 6]);
    }
  });
  it('advances prescribed repetitions once regardless of uneven extra reps', () => {
    for (let first = 8; first <= 20; first++) {
      for (let second = 8; second <= 20; second++) {
        const next = calculate({ sets: [set({ reps: first }), set({ reps: second })] });
        expect(next.targetReps).toEqual([9, 9]);
        expect(next.weight).toBe(60);
      }
    }
  });
  it('does not allow another set to compensate for missed reps or effort', () => {
    for (const failed of [{ reps: 7 }, { rir: 1 }, { done: false }, { reps: 0 }]) {
      const next = calculate({ sets: [set(failed), set({ reps: 20, rir: 4 })] });
      expect(next.targetReps).toEqual([8, 8]);
      expect(next.step).toBe('hold');
    }
  });
  it('uses the completion RIR without requiring reports on every earlier set', () => {
    expect(calculate({ sets: [set({ rir: null }), set()] }).step).toBe('reps');
    expect(calculate({ sets: [set({ rir: null }), set({ rir: null })] }).step).toBe('hold');
  });
  it('does not increase reps while adding sets', () => {
    expect(calculate({ targetRirs: [2, 2, 2] }).targetReps).toEqual([8, 8, 8]);
  });
  it('increases load only after prescribed top-range completion', () => {
    expect(calculate({ sets: [set({ reps: 12 }), set({ reps: 12 })] }).weight).toBe(60);
    const next = calculate({ sets: [set({ reps: 12, targetReps: 12 }), set({ reps: 12, targetReps: 12 })] });
    expect(next.weight).toBe(61);
    expect(next.targetReps).toEqual([8, 8]);
    expect(calculate({ sets: [set({ reps: 12, targetReps: 12 }), set({ reps: 12, targetReps: 12 })], loads: [60, 70] }).weight).toBe(60);
  });
  it('honors an explicit hold even after load and rep shortfalls', () => {
    const next = calculate({ sets: [set({ reps: 5, weight: 50 }), set({ targetReps: 9, reps: 6, weight: 50 })], workingWeight: 50, decision: 'maintain-prescription' });
    expect(next.weight).toBe(60);
    expect(next.targetReps).toEqual([8, 9]);
  });
  it('recalibrates from the weakest comparable set, without saved maxima', () => {
    const next = calculate({ sets: [set({ reps: 5, rir: 0 }), set({ reps: 20 })], decision: 'recalibrate-down' });
    expect(next.weight).toBe(50);
    expect(next.step).toBe('performance-adjustment');
    expect(calculate({ sets: [set({ reps: 5, rir: 0 }), set({ reps: 20 })], decision: 'recalibrate-down', loads: [60] }).weight).toBeNull();
  });
  it('does not resurrect a removed load or round it upward', () => {
    expect(calculate({ loads: [50, 70] }).weight).toBe(50);
    expect(calculate({ loads: [61] }).weight).toBeNull();
    expect(calculate({ loads: [] }).weight).toBeNull();
  });
  it('detects changed effort in earlier sets even with unchanged final RIR', () => {
    expect(calculate({ targetRirs: [3, 2] }).step).toBe('effort-adjustment');
  });
  it('keeps bodyweight progression independent of load inventory', () => {
    const next = calculate({ usesWeight: false, loads: [], workingWeight: null, sets: [set({ weight: 0 }), set({ weight: 0 })] });
    expect(next.weight).toBe(0);
    expect(next.targetReps).toEqual([9, 9]);
  });
});
