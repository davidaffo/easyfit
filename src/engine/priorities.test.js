import { describe, expect, it } from 'vitest';
import { generateWorkout, getAdaptiveTrainingOverview, isLowerBodyExercise, SESSION_TIME_TOLERANCE_MINUTES } from './generator.js';

const now = Date.UTC(2026, 9, 10);
const day = 864e5;
const profile = {
  goal: 'muscle', level: 'intermediate', duration: 30, trainingStyle: 'balanced',
  equipment: ['dumbbells', 'bodyweight'], loadInventory: { dumbbells: [10, 20] },
  preferences: {}, exerciseFilters: { excludeDirectCore: true, excludeCalves: true },
  exerciseOverrides: {}, trainingAdaptation: {},
};
const item = (exerciseId, count) => ({ exerciseId, sets: Array.from({ length: count }, () => ({
  done: true, weight: 20, targetWeight: 20, reps: 10, targetReps: 10, rir: 2, targetRir: 2,
})) });
const history = [
  ...[1, 3, 5].map((days) => ({ id: `trained-quads-and-glutes-${days}`, completedAt: now - days * day, exercises: [item('wger-203', 6)] })),
  { id: 'upper-body', completedAt: now - 2 * day, exercises: [item('wger-194', 1), item('wger-81', 1), item('wger-348', 1)] },
];

describe('anatomical training urgency', () => {
  it('does not average urgent hamstrings away when glutes have already received enough work', () => {
    const overview = getAdaptiveTrainingOverview(profile, history, 30, now);
    expect(overview.muscleStatus.hamstrings.priority).toBe(100);
    expect(overview.muscleStatus.glutes.priority).toBeLessThan(20);
    expect(overview.muscleStatus.chest.priority).toBeLessThan(100);
    expect(overview.muscleStatus.back.priority).toBeLessThan(100);
    expect(overview.families[0].id).toBe('hip');
    expect(overview.plannedFamilies.some((family) => family.id === 'hip')).toBe(true);
    for (const variation of [1, 5, 81]) {
      const workout = generateWorkout(profile, history, { now, duration: 30, variation });
      expect(workout.exercises.some((exercise) => exercise.exerciseSnapshot.primary === 'hamstrings')).toBe(true);
      expect(workout.exercises.filter((exercise) => isLowerBodyExercise(exercise.exerciseSnapshot))).toHaveLength(1);
      expect(workout.engine.estimatedMinutes).toBeLessThanOrEqual(30 + SESSION_TIME_TOLERANCE_MINUTES);
    }
  });

  it('can select an urgent leg curl when no compound hip exercise is compatible', () => {
    const machineProfile = { ...profile, equipment: ['machines'], loadInventory: {} };
    const machineHistory = [
      ...[1, 3, 5].map((days) => ({ id: `legs-${days}`, completedAt: now - days * day, exercises: [item('wger-371', 6)] })),
      { id: 'upper', completedAt: now - 2 * day, exercises: [item('wger-129', 1), item('wger-512', 1), item('wger-1654', 1)] },
    ];
    const overview = getAdaptiveTrainingOverview(machineProfile, machineHistory, 30, now);
    expect(overview.families[0].id).toBe('hip');
    const workout = generateWorkout(machineProfile, machineHistory, { now, duration: 30 });
    expect(workout.exercises.some((exercise) => [364, 365].includes(exercise.exerciseSnapshot.wgerId))).toBe(true);
    expect(workout.engine.unavailableMovementFamilies).not.toContain('hip');
    expect(workout.engine.estimatedMinutes).toBeLessThanOrEqual(30 + SESSION_TIME_TOLERANCE_MINUTES);
  });

  it('still lets a well-trained lower body yield to more urgent upper-body work', () => {
    const saturated = [{ id: 'lower', completedAt: now - day,
      exercises: [item('wger-203', 6), item('wger-1652', 6)],
    }];
    const workout = generateWorkout(profile, saturated, { now, duration: 30 });
    expect(workout.exercises.some((exercise) => isLowerBodyExercise(exercise.exerciseSnapshot))).toBe(false);
  });
});
