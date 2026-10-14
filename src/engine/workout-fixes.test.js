import { describe, expect, it } from 'vitest';
import { exercises } from '../data/exercises.js';
import { getWorkoutCompletionInsights, getSimilarLoadReference } from './generator.js';
import { setSuperset, nextSupersetExercise } from './supersets.js';

const exercise = exercises.find((entry) => entry.loadType === 'external');
const item = (reps, extra = {}) => ({ exerciseId: exercise.id, sets: reps.map((reps) => ({ done: true, reps, weight: 60, rir: 0, targetRir: 2 })), ...extra });
describe('observed completion performance', () => {
  it.each([[[8, 9], [9, 9]], [[12, 12, 13], [13, 13, 13]]])('recognizes %s to %s even when calibration decreases', (before, after) => {
    const previous = { id: 'before', completedAt: Date.now() - 1000, exercises: [item(before)] };
    const current = { id: 'after', completedAt: Date.now(), exercises: [item(after, { performanceCalibration: { estimatedMaximum: 70, previousMaximum: 80, change: -.05 } })] };
    const result = getWorkoutCompletionInsights(current, [previous, current]);
    expect(result.counts.improved).toBe(1);
    expect(result.items[0].maximumChange).toBeGreaterThan(0);
  });
  it('does not turn more sets into improved performance per set', () => {
    const before = { id: 'before', completedAt: Date.now() - 1000, exercises: [item([8, 8])] };
    const after = { id: 'after', completedAt: Date.now(), exercises: [item([8, 8, 8])] };
    expect(getWorkoutCompletionInsights(after, [before]).counts.maintained).toBe(1);
  });
  it('finds a compatible actual load reference without prescribing it', () => {
    const pair = exercises.flatMap((a) => {
      const b = exercises.find((b) => a.id !== b.id && a.primary === b.primary && a.pattern === b.pattern && a.loadType === b.loadType && a.loadUnit === b.loadUnit);
      return b && a.loadType === 'per-dumbbell' ? [[a, b]] : [];
    })[0];
    const [target, reference] = pair;
    const history = [{ id: 'reference', completedAt: Date.now() - 1000, exercises: [{ ...item([10, 10]), exerciseId: reference.id }] }];
    expect(getSimilarLoadReference(target.id, history)).toMatchObject({ exercise: { id: reference.id }, weight: 60 });
    expect(getSimilarLoadReference(target.id, [])).toBeNull();
  });
});
describe('manual supersets', () => {
  const workout = () => ({ exercises: ['a', 'b', 'c'].map((exerciseId) => ({ exerciseId, sets: [{ done: false }, { done: false }] })) });
  it('creates, extends and removes a group only when selected', () => {
    let current = workout();
    expect(current.exercises.every((entry) => !entry.supersetId)).toBe(true);
    current = setSuperset(current, 'a', 'b');
    current = setSuperset(current, 'c', 'a');
    expect(new Set(current.exercises.map((entry) => entry.supersetId)).size).toBe(1);
    current = setSuperset(current, 'c');
    expect(current.exercises[2].supersetId).toBeUndefined();
    current = setSuperset(current, 'a');
    expect(current.exercises.every((entry) => !entry.supersetId)).toBe(true);
  });
  it('rests only once partners have completed the round, including unequal set counts', () => {
    const current = setSuperset(workout(), 'a', 'b');
    expect(nextSupersetExercise(current, current.exercises[0]).exerciseId).toBe('b');
    current.exercises[0].sets[0].done = true;
    expect(nextSupersetExercise(current, current.exercises[1])).toBeNull();
    current.exercises[1].sets.forEach((set) => { set.done = true; });
    expect(nextSupersetExercise(current, current.exercises[0])).toBeNull();
  });
});
