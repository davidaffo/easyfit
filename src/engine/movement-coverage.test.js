import { describe, expect, it } from 'vitest';
import { exercises } from '../data/exercises.js';
import {
  ENGINE_VERSION, SESSION_TIME_TOLERANCE_MINUTES, generateWorkout, generateWorkoutAlternatives,
  getAddableExercises, getExercisePrescription, getExerciseVariantKey, getMovementPatternLoad,
  getWorkoutCompositionLimits, getWorkoutExercise, isExerciseAllowed,
  isLowerBodyExercise, isPrimaryMovement, movementGroups, rebuildWorkoutMetadata,
} from './generator.js';

const day = 864e5;
const now = Date.UTC(2026, 9, 20);
const base = {
  goal: 'muscle', level: 'intermediate', duration: 45, trainingStyle: 'balanced',
  equipment: [...new Set(exercises.flatMap((exercise) => exercise.equipment))],
  loadInventory: { dumbbells: [5, 10, 15, 20], barbell: [20, 40, 60], kettlebell: [12, 16], ezbar: [20] },
  preferences: {}, exerciseFilters: { preferLoadedVariants: true },
  exerciseOverrides: {}, trainingAdaptation: {},
};
const only = (ids) => ({ ...base, preferences: Object.fromEntries(exercises.map((exercise) => [exercise.id,
  ids.includes(exercise.wgerId) ? 'normal' : 'exclude'])) });
const recorded = (exerciseId, completedAt = now - 3 * day, count = 3) => ({
  id: `${exerciseId}-${completedAt}`, completedAt,
  exercises: [{ exerciseId, sets: Array.from({ length: count }, () => ({
    done: true, weight: 20, targetWeight: 20, reps: 8, targetReps: 8, rir: 2, targetRir: 2,
  })) }],
});
const complete = (workout, completedAt) => ({ ...workout, completedAt,
  exercises: workout.exercises.map((item) => ({ ...item, sets: item.sets.map((set) => ({
    ...set, done: true, weight: set.weight ?? 10, rir: set.targetRir,
  })) })),
});
const patterns = (workout) => workout.exercises.map((item) => getWorkoutExercise(item).pattern);

describe('direct movement coverage', () => {
  it('does not treat indirect muscle stimulus as another movement exposure', () => {
    const history = [recorded('wger-73'), recorded('wger-1652')];
    const saved = JSON.stringify(history);
    const load = getMovementPatternLoad(history, now);
    expect(load['horizontal-push'].frequency).toBeGreaterThan(0);
    expect(load.hinge.frequency).toBeGreaterThan(0);
    for (const pattern of ['vertical-push', 'knee-flexion', 'hip-extension', 'calf-raise']) {
      expect(load[pattern]).toBeUndefined();
    }
    expect(JSON.stringify(history)).toBe(saved);
  });

  it('counts productive completed work once per pattern per session and decays it', () => {
    const workout = recorded('wger-73', now - 7 * day);
    workout.exercises.push(structuredClone(workout.exercises[0]));
    const preview = recorded('wger-567');
    delete preview.completedAt;
    const skipped = recorded('wger-567');
    skipped.exercises[0].sets.forEach((set) => { set.done = false; });
    const insufficient = recorded('wger-364');
    insufficient.exercises[0].sets.forEach((set) => { set.reps = 1; });
    const load = getMovementPatternLoad([workout, preview, skipped, insufficient, recorded('wger-487', now + day)], now);
    expect(Object.keys(load)).toEqual(['horizontal-push']);
    expect(load['horizontal-push'].frequency).toBeCloseTo(.5);
    expect(load['horizontal-push'].volume).toBeCloseTo(3);
    const old = getMovementPatternLoad([recorded('wger-73', now - 24 * day)], now)['horizontal-push'];
    expect(old.frequency).toBe(0);
    expect(old.lastPerformedAt).toBe(now - 24 * day);
  });

  it('plans horizontal and vertical presses independently even with shared shoulder stimulus', () => {
    const profile = only([73, 75, 567, 348, 238]);
    const workout = generateWorkout(profile, [recorded('wger-73')], { now, duration: 30 });
    expect(getWorkoutExercise(workout.exercises[0]).pattern).toBe('vertical-push');
    expect(patterns(workout)).toEqual(expect.arrayContaining(['horizontal-push', 'vertical-push']));
    expect(workout.engine.movementGroups).toEqual(expect.arrayContaining(['horizontal-push', 'vertical-push']));
  });

  it('can combine a row and a vertical pull in one session', () => {
    const workout = generateWorkout(only([81, 475, 92]), [], { now, duration: 45 });
    expect(patterns(workout)).toEqual(expect.arrayContaining(['horizontal-pull', 'vertical-pull']));
  });

  it('reserves a separate glute movement after hinge work instead of rotating only deadlift variants', () => {
    const workout = generateWorkout(only([1652, 1642, 364]), [recorded('wger-1652')], { now, duration: 30 });
    expect(patterns(workout)).toContain('hip-extension');
    expect(patterns(workout)).not.toContain('hinge');
    expect(workout.engine.movementGroups).toContain('glutes');
  });

  it('allows lower isolations and calves alongside lower primaries, also in manual additions', () => {
    const profile = only([1652, 567, 364, 369, 146]);
    const workout = generateWorkout(profile, [], { now, duration: 45 });
    expect(patterns(workout)).toEqual(expect.arrayContaining(['hinge', 'knee-flexion', 'knee-extension', 'calf-raise']));
    const primaryOnly = { ...workout, exercises: workout.exercises.filter((item) => isPrimaryMovement(getWorkoutExercise(item))) };
    const addable = getAddableExercises(primaryOnly, profile).map((exercise) => exercise.pattern);
    expect(addable).toEqual(expect.arrayContaining(['knee-flexion', 'knee-extension', 'calf-raise']));
    expect(workout.engine.estimatedMinutes).toBeLessThanOrEqual(45 + SESSION_TIME_TOLERANCE_MINUTES);
  });

  it('does not keep rotating chest isolations while skipping available presses', () => {
    const profile = { ...base, trainingStyle: 'intense', duration: 45 };
    const history = [];
    for (let index = 0; index < 32; index += 1) {
      const time = now + index * day;
      const workout = generateWorkout(profile, history, { now: time, variation: 1 });
      const selected = workout.exercises.map(getWorkoutExercise);
      const load = getMovementPatternLoad(history, time);
      if (selected.some((exercise) => exercise.pattern === 'chest-isolation')) {
        const hasPress = selected.some((exercise) => exercise.pattern === 'horizontal-push' && isPrimaryMovement(exercise));
        expect(hasPress || (load['horizontal-push']?.frequency || 0) > (load['chest-isolation']?.frequency || 0)).toBe(true);
      }
      history.push(complete(workout, time + 3600000));
    }
    expect(history.some((workout) => patterns(workout).includes('horizontal-push'))).toBe(true);
  });

  it('retains chest isolation when every chest base is excluded', () => {
    const workout = generateWorkout(only([238, 308]), [], { now, targets: ['chest'], duration: 30 });
    expect(patterns(workout)).toContain('chest-isolation');
  });

  it('keeps distinct metadata after edits and includes the new engine version', () => {
    const workout = generateWorkout(only([73, 567, 348]), [], { now, duration: 30 });
    const edited = rebuildWorkoutMetadata({ ...workout, exercises: workout.exercises.filter((item) => getWorkoutExercise(item).pattern !== 'vertical-push') });
    expect(edited.engine.movementGroups).toEqual(['horizontal-push']);
    expect(workout.engine.version).toBe(ENGINE_VERSION);
  });

  it('retains direct leg-curl work even when hinges have saturated the shared muscle dose', () => {
    const history = [1, 2, 3].map((days) => recorded('wger-1652', now - days * day, 6));
    const workout = generateWorkout(only([73, 567, 364, 146]), history, { now, duration: 45 });
    const curl = workout.exercises.find((item) => getWorkoutExercise(item).pattern === 'knee-flexion');
    expect(curl).toBeDefined();
    expect(curl.sets).toHaveLength(2);
  });

  it('preserves the planned movement coverage when refreshing the whole workout', () => {
    const seed = 42;
    const workout = generateWorkout(base, [], { now, variation: seed });
    const alternatives = generateWorkoutAlternatives(base, [], workout, { now, seed });
    expect(alternatives.length).toBeGreaterThan(0);
    for (const candidate of alternatives) {
      expect([...candidate.engine.movementGroups].sort()).toEqual([...workout.engine.movementGroups].sort());
      expect(candidate.engine.estimatedMinutes).toBeLessThanOrEqual(base.duration + SESSION_TIME_TOLERANCE_MINUTES);
    }
  });

  it('uses the strict shoulder press without automatically rotating in a push press', () => {
    const strictPress = exercises.find((exercise) => exercise.wgerId === 567);
    expect(exercises.some((exercise) => exercise.wgerId === 478)).toBe(false);
    const workout = generateWorkout(only([478, 567]), [recorded('wger-567')], { now, duration: 30 });
    expect(getWorkoutExercise(workout.exercises[0]).wgerId).toBe(strictPress.wgerId);
    expect(getWorkoutExercise(workout.exercises[0]).executionVariant).not.toBe('push-press');
  });

  it('offers the standard unsupported row and keeps the underhand grip distinct', () => {
    const standard = exercises.find((exercise) => exercise.wgerId === 508);
    const underhand = exercises.find((exercise) => exercise.wgerId === 1463);
    expect(standard.equipment).toEqual(['dumbbells']);
    expect(standard.loadMultiplier).toBe(2);
    expect(getExerciseVariantKey(standard)).not.toBe(getExerciseVariantKey(underhand));
    const workout = generateWorkout(only([508, 1463]), [], { now, duration: 30 });
    expect(workout.exercises[0].exerciseId).toBe(standard.id);
  });

  for (const duration of [30, 45, 60]) {
    for (const gapDays of [1, 3, 7]) {
      it.each(['balanced', 'intense', 'volume'])(`covers every compatible primary movement at ${duration} minutes, every ${gapDays} days, style %s`, (trainingStyle) => {
        const profile = { ...base, duration, trainingStyle };
        const history = [];
        const counts = Object.fromEntries(movementGroups.map((group) => [group.id, 0]));
        const direct = {};
        for (let index = 0; index < 32; index += 1) {
          const time = now + index * gapDays * day;
          const workout = generateWorkout(profile, history, { now: time, variation: 42 });
          const selected = workout.exercises.map(getWorkoutExercise);
          workout.engine.movementGroups.forEach((group) => { counts[group] += 1; });
          selected.forEach((exercise) => { direct[exercise.pattern] = (direct[exercise.pattern] || 0) + 1; });
          const limits = getWorkoutCompositionLimits(duration);
          expect(workout.engine.estimatedMinutes).toBeLessThanOrEqual(duration + SESSION_TIME_TOLERANCE_MINUTES);
          expect(workout.exercises.length).toBeLessThanOrEqual(limits.maxExercises);
          expect(selected.filter(isPrimaryMovement).length).toBeLessThanOrEqual(limits.maxCompounds);
          expect(selected.filter((exercise) => isPrimaryMovement(exercise) && isLowerBodyExercise(exercise)).length).toBeLessThanOrEqual(duration <= 30 ? 1 : 2);
          expect(selected.every((exercise) => isExerciseAllowed(exercise, profile))).toBe(true);
          expect(workout.exercises.every((item) => item.sets.length >= 2
            && item.sets.length <= getExercisePrescription(profile, getWorkoutExercise(item)).maxSets)).toBe(true);
          history.push(complete(workout, time + 3600000));
        }
        for (const [group, count] of Object.entries(counts)) expect(count, group).toBeGreaterThanOrEqual(4);
        if (duration >= 45) {
          for (const pattern of ['knee-flexion', 'knee-extension', 'calf-raise', 'shoulder-isolation', 'rear-delt']) {
            expect(direct[pattern] || 0, pattern).toBeGreaterThan(0);
          }
        }
      });
    }
  }
});
