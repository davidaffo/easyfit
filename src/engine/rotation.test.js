import { describe, expect, it } from 'vitest';
import { exercises } from '../data/exercises.js';
import { generateWorkout, getExerciseProgress, getExerciseRotationBlocks } from './generator.js';

const day = 864e5;
const now = Date.UTC(2026, 9, 10);
const pair = ['wger-73', 'wger-75'];
const nextPair = ['wger-537', 'wger-538'];
const key = 'chest:horizontal-push:primary';
const profileFor = (ids = [...pair, ...nextPair]) => ({
  goal: 'muscle', level: 'intermediate', duration: 30, trainingStyle: 'balanced',
  equipment: ['bodyweight', 'barbell', 'dumbbells', 'bench', 'rack'],
  loadInventory: { barbell: [20, 40, 60], dumbbells: [10, 20] },
  preferences: Object.fromEntries(exercises.map((exercise) => [exercise.id, ids.includes(exercise.id) ? 'normal' : 'exclude'])),
  exerciseFilters: {}, exerciseOverrides: {}, trainingAdaptation: {},
});
const historyFor = (ids) => ids.map((exerciseId, index) => ({
  id: `session-${index}`, completedAt: now - (ids.length - index) * 3 * day,
  exercises: [{ exerciseId, sets: [
    { done: true, weight: 20, targetWeight: 20, reps: 8, targetReps: 8, rir: 2, targetRir: 2 },
  ] }],
}));
const repeatedPair = (ids, repetitions = 4) => Array.from({ length: repetitions }, () => ids).flat();
const generate = (profile, history, variation = 1) => generateWorkout(profile, history, { now, variation, targets: ['chest'], duration: 30 });

describe('exercise rotation blocks', () => {
  it('keeps A and B through four exposures each without admitting a third exercise early', () => {
    const profile = profileFor();
    const history = historyFor(repeatedPair(pair, 3));
    const block = getExerciseRotationBlocks(history, profile, now)[key];
    expect(block.number).toBe(1);
    expect(block.exerciseIds).toEqual(pair);
    expect(block.exposures).toEqual({ 'wger-73': 3, 'wger-75': 3 });
    for (const variation of [1, 5, 42, 81]) {
      expect(generate(profile, history, variation).exercises.every((item) => pair.includes(item.exerciseId))).toBe(true);
      expect(generate(profile, history, variation).exercises.length).toBeGreaterThan(0);
    }
  });

  it('lets the unfinished member reach four before switching the pair', () => {
    const profile = profileFor();
    const history = historyFor([...repeatedPair(pair, 3), pair[0]]);
    expect(getExerciseRotationBlocks(history, profile, now)[key].number).toBe(1);
    expect(generate(profile, history).exercises[0].exerciseId).toBe(pair[1]);
  });

  it('switches A/B to C/D and starts fresh counters while preserving performance', () => {
    const profile = profileFor();
    const history = historyFor(repeatedPair(pair));
    const saved = JSON.stringify(history);
    const strength = getExerciseProgress(history, pair[0], now);
    const block = getExerciseRotationBlocks(history, profile, now)[key];
    expect(block.number).toBe(2);
    expect(block.previousExerciseIds).toEqual(pair);
    expect(block.exerciseIds).toEqual(nextPair);
    expect(block.exposures).toEqual({ 'wger-537': 0, 'wger-538': 0 });
    const workout = generate(profile, history);
    expect(workout.exercises.length).toBeGreaterThan(0);
    expect(workout.exercises.every((item) => nextPair.includes(item.exerciseId))).toBe(true);
    expect(workout.engine.rotationBlocks[key].number).toBe(2);
    expect(workout.exercises[0].rotation).toEqual({ block: 2, completedExposures: 0, targetExposures: 4 });
    expect(getExerciseProgress(history, pair[0], now)).toEqual(strength);
    expect(JSON.stringify(history)).toBe(saved);
  });

  it('can return to the first pair in the third block with new exposure counts', () => {
    const history = historyFor([...repeatedPair(pair), ...repeatedPair(nextPair)]);
    const block = getExerciseRotationBlocks(history, profileFor(), now)[key];
    expect(block.number).toBe(3);
    expect([...block.exerciseIds].sort()).toEqual([...pair].sort());
    expect(Object.values(block.exposures)).toEqual([0, 0]);
    expect(generate(profileFor(), history).exercises.every((item) => pair.includes(item.exerciseId))).toBe(true);
    const nextHistory = historyFor([...repeatedPair(pair), ...repeatedPair(nextPair), pair[0]]);
    expect(getExerciseRotationBlocks(nextHistory, profileFor(), now)[key].exposures[pair[0]]).toBe(1);
  });

  it('finishes a four-session block when both exercises are performed in each session', () => {
    const history = historyFor(Array(4).fill(pair[0]));
    history.forEach((workout) => {
      workout.exercises.push({ ...structuredClone(workout.exercises[0]), exerciseId: pair[1] });
    });
    const block = getExerciseRotationBlocks(history, profileFor(), now)[key];
    expect(block.number).toBe(2);
    expect(block.exerciseIds).toEqual(nextPair);
    expect(Object.values(block.exposures)).toEqual([0, 0]);
    const following = { id: 'next-block', completedAt: now, exercises: nextPair.map((exerciseId) => ({
      ...structuredClone(history[0].exercises[0]), exerciseId,
    })) };
    const continued = getExerciseRotationBlocks([...history, following], profileFor(), now)[key];
    expect(continued.number).toBe(2);
    expect(Object.values(continued.exposures)).toEqual([1, 1]);
  });

  it('reuses one member when only three alternatives exist', () => {
    const block = getExerciseRotationBlocks(historyFor(repeatedPair(pair)), profileFor([...pair, nextPair[0]]), now)[key];
    expect(block.exerciseIds).toEqual([nextPair[0], pair[0]]);
    expect(Object.values(block.exposures)).toEqual([0, 0]);
  });

  it('keeps training possible with a single compatible exercise', () => {
    const profile = profileFor([pair[0]]);
    const history = historyFor(Array(4).fill(pair[0]));
    expect(getExerciseRotationBlocks(history, profile, now)[key].exerciseIds).toEqual([pair[0]]);
    expect(generate(profile, history).exercises[0].exerciseId).toBe(pair[0]);
  });

  it('does not advance counters for previews, skipped sets or insufficient work', () => {
    const history = historyFor([pair[0]]);
    const invalid = historyFor([pair[1], pair[1], pair[1]]);
    delete invalid[0].completedAt;
    invalid[1].exercises[0].sets[0].done = false;
    invalid[2].exercises[0].sets[0].reps = 1;
    const profile = profileFor();
    const before = getExerciseRotationBlocks(history, profile, now);
    generate(profile, history, 1);
    generate(profile, history, 2);
    expect(getExerciseRotationBlocks([...history, ...invalid], profile, now)).toEqual(before);
  });

  it('supports a manual substitution without losing the other member’s completed work', () => {
    const history = historyFor([pair[0], pair[1], pair[0], pair[1], pair[0], nextPair[0]]);
    const block = getExerciseRotationBlocks(history, profileFor(), now)[key];
    expect(block.exerciseIds).toEqual([pair[0], nextPair[0]]);
    expect(block.exposures[pair[0]]).toBe(3);
    expect(block.exposures[nextPair[0]]).toBe(1);
  });

  it('counts a completed exercise once per session and resets after a long break', () => {
    const history = historyFor([pair[0]]);
    history[0].exercises.push(structuredClone(history[0].exercises[0]));
    expect(getExerciseRotationBlocks(history, profileFor(), now)[key].exposures[pair[0]]).toBe(1);
    expect(getExerciseRotationBlocks(history, profileFor(), now + 29 * day)).toEqual({});
  });
});
