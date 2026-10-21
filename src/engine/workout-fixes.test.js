import { describe, expect, it } from 'vitest';
import { exercises } from '../data/exercises.js';
import { generateWorkout, getAvailableLoads, getExercisePrescription, getWorkoutCompletionInsights, getSimilarLoadReference } from './generator.js';
import { setSuperset, nextSupersetExercise } from './supersets.js';

const exercise = exercises.find((entry) => entry.loadType === 'external');
const item = (reps, extra = {}) => ({ exerciseId: exercise.id, sets: reps.map((reps) => ({ done: true, reps, weight: 60, rir: 0, targetRir: 2 })), ...extra });
describe('adaptive intense accessory sets', () => {
  const curl = exercises.find((entry) => entry.wgerId === 92);
  const profile = {
    goal: 'muscle', level: 'intermediate', trainingStyle: 'intense',
    equipment: ['dumbbells'],
    preferences: Object.fromEntries(exercises.map((entry) => [entry.id, entry.id === curl.id ? 'normal' : 'exclude'])),
  };
  it.each([[30, [2, 0]], [45, [2, 1, 0]]])('adapts to %i minutes while keeping the final set at failure', (duration, rirs) => {
    const workout = generateWorkout({ ...profile, duration }, [], { now: Date.UTC(2026, 9, 21), targets: ['biceps'] });
    expect(workout.exercises).toHaveLength(1);
    expect(workout.exercises[0].sets.map((set) => set.targetRir)).toEqual(rirs);
    expect(workout.exercises[0].minimumTimeFitSets).toBe(1);
  });
  it('respects a one-set accessory limit', () => {
    const workout = generateWorkout({ ...profile, duration: 30, exerciseOverrides: { [curl.id]: { maxSets: 1 } } }, [], {
      now: Date.UTC(2026, 9, 21), targets: ['biceps'],
    });
    expect(workout.exercises[0].sets.map((set) => set.targetRir)).toEqual([0]);
  });
});
describe('bodyweight rep progression', () => {
  const dips = exercises.find((entry) => entry.name === 'Dips');
  const now = Date.UTC(2026, 9, 16);
  const profile = {
    goal: 'muscle', level: 'intermediate', duration: 30, trainingStyle: 'intense',
    equipment: ['bodyweight', 'dipbars'], exerciseFilters: {},
    preferences: Object.fromEntries(exercises.map((entry) => [entry.id, entry.id === dips.id ? 'normal' : 'exclude'])),
  };
  const history = (rir) => [{
    id: 'previous-dips', completedAt: now - 3 * 864e5,
    exercises: [{ exerciseId: dips.id, sets: [1, 0].map((targetRir, index) => ({
      done: true, weight: 0, targetWeight: 0, reps: 13, targetReps: 12,
      targetRir, rir: index === 1 ? rir : null,
    })) }],
  }];
  it.each([[1, 14], [2, 14], [0, 13]])('prescribes %i RIR performance as %i reps after 13+13 dips', (rir, expected) => {
    const next = generateWorkout(profile, history(rir), { now, targets: ['triceps'], duration: 30 });
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].exerciseId).toBe(dips.id);
    expect(next.exercises[0].sets.map((set) => set.targetReps)).toEqual([expected, expected]);
  });
  it('keeps explicit rep caps and external-load rep ranges', () => {
    expect(getExercisePrescription({ ...profile, exerciseOverrides: { [dips.id]: { maxReps: 12 } } }, dips).maxReps).toBe(12);
    const loaded = exercises.find((entry) => entry.loadType === 'external' && entry.primary === 'chest' && entry.compound);
    expect(getExercisePrescription(profile, loaded).maxReps).toBe(12);
  });
  const withWeight = (extra = {}) => ({
    ...profile, equipment: ['bodyweight', 'dipbars', 'addedweight'], loadInventory: { addedweight: [2.5, 5, 10] },
    preferences: { ...profile.preferences, [`${dips.id}-weighted`]: 'normal' }, ...extra,
  });
  it('offers weighted dips only after reaching the rep ceiling with reserve', () => {
    const next = generateWorkout(withWeight(), history(1), { now, targets: ['triceps'], duration: 30 });
    expect(next.exercises.map((item) => item.exerciseId)).toEqual([`${dips.id}-weighted`]);
    expect(next.exercises[0].needsInitialLoad).toBe(true);
    expect(next.exercises[0].sets.map((set) => set.targetReps)).toEqual([8, 8]);
    expect(getAvailableLoads(exercises.find((entry) => entry.id === `${dips.id}-weighted`), withWeight())).toEqual([2.5, 5, 10]);
  });
  it.each([
    { equipment: ['bodyweight', 'dipbars'] },
    { loadInventory: { addedweight: [] } },
    { preferences: { ...profile.preferences } },
  ])('keeps bodyweight progression when weighted equipment or loads are missing, or the variant is excluded: %o', (extra) => {
    const next = generateWorkout(withWeight(extra), history(1), { now, targets: ['triceps'], duration: 30 });
    expect(next.exercises.map((item) => item.exerciseId)).toEqual([dips.id]);
    expect(next.exercises[0].sets.map((set) => set.targetReps)).toEqual([14, 14]);
  });
  it('does not switch at failure or before completing the ceiling', () => {
    const belowCeiling = history(1);
    belowCeiling[0].exercises[0].sets.forEach((set) => { set.reps = 11; set.targetReps = 11; });
    for (const recorded of [history(0), belowCeiling, []]) {
      const next = generateWorkout(withWeight(), recorded, { now, targets: ['triceps'], duration: 30 });
      expect(next.exercises.map((item) => item.exerciseId)).toEqual([dips.id]);
    }
  });
  it('continues progression from the separate weighted history', () => {
    const recorded = [...history(1), {
      id: 'weighted-dips', completedAt: now - 864e5,
      exercises: [{ exerciseId: `${dips.id}-weighted`, sets: [1, 0].map((targetRir) => ({
        done: true, weight: 5, targetWeight: 5, reps: 8, targetReps: 8, rir: 1, targetRir,
      })) }],
    }];
    const next = generateWorkout(withWeight(), recorded, { now, targets: ['triceps'], duration: 30 });
    expect(next.exercises.map((item) => item.exerciseId)).toEqual([`${dips.id}-weighted`]);
    expect(next.exercises[0].sets.map((set) => [set.targetReps, set.targetWeight])).toEqual([[9, 5], [9, 5]]);
  });
  it.each(['wger-152', 'wger-475'])('requires a bar and available added weights for %s', (exerciseId) => {
    const preferences = Object.fromEntries(exercises.map((entry) => [entry.id,
      [exerciseId, `${exerciseId}-weighted`].includes(entry.id) ? 'normal' : 'exclude']));
    const pullProfile = withWeight({ equipment: ['bodyweight', 'pullup', 'addedweight'], preferences });
    const recorded = history(1);
    recorded[0].exercises[0].exerciseId = exerciseId;
    const options = { now, targets: ['back'], duration: 30 };
    expect(generateWorkout(pullProfile, recorded, options).exercises.map((item) => item.exerciseId)).toEqual([`${exerciseId}-weighted`]);
    expect(generateWorkout({ ...pullProfile, equipment: ['bodyweight', 'addedweight'] }, recorded, options).exercises).toEqual([]);
    expect(generateWorkout({ ...pullProfile, loadInventory: {} }, recorded, options).exercises.map((item) => item.exerciseId)).toEqual([exerciseId]);
  });
});
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
