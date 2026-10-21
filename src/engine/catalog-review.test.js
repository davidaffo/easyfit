import { describe, expect, it } from 'vitest';
import { exercises, equipmentLabels } from '../data/exercises.js';
import { getExerciseDetails } from '../data/exerciseDetails.js';
import { generateWorkout, getCanonicalExercise, getExerciseVariantKey, getSimilarExercises, getWorkoutExercise, isExerciseAllowed } from './generator.js';

const byId = (id) => exercises.find((exercise) => exercise.id === (typeof id === 'number' ? `wger-${id}` : id));
const profile = {
  goal: 'muscle', level: 'intermediate', duration: 45, trainingStyle: 'balanced',
  equipment: Object.keys(equipmentLabels), preferences: {}, exerciseFilters: {},
  loadInventory: { dumbbells: [10], barbell: [20], ezbar: [15], machines: [20], cables: [10] },
};
const now = Date.UTC(2026, 9, 21);
const distinctGroups = [
  [75, 537, 186], [73, 538, 185], [129, 1831], [238, 308], [1111, 1112],
  [567, 'wger-567-standing', 1968, 20], [566, 1893], [83, 84], [508, 1463],
  [475, 152, 1696], [723, 1127, 1136], [371, 1414], [203, 1640],
  [1366, 205, 206, 1651], [184, 1700, 630], [1652, 1736], [265, 1740],
  [364, 366], [487, 82, 828], [822, 222], [204, 202], [94, 465],
  [95, 275, 1493], [659, 1298, 1513], [1336, 655], [622, 590], [1243, 702],
  [167, 1772],
];

describe('reviewed catalog coverage', () => {
  it.each(distinctGroups.map((ids) => [ids.join(', '), ids]))('keeps useful variants distinct: %s', (_, ids) => {
    const group = ids.map(byId);
    expect(group.every(Boolean)).toBe(true);
    expect(new Set(group.map(getExerciseVariantKey)).size).toBe(group.length);
    for (const exercise of group) expect(getCanonicalExercise(exercise, profile).id).toBe(exercise.id);
  });

  it.each([20, 82, 84, 139, 172, 173, 185, 186, 202, 205, 246, 275, 294, 308, 366, 465, 590, 630, 702, 723, 828, 978, 1086, 1111, 1243, 1366, 1414, 1424, 1493, 1513, 1640, 1696, 1736, 1740, 1893, 1968, 'wger-567-standing'])(
    'can prescribe the reviewed variant %s with its actual equipment', (id) => {
      const exercise = byId(id);
      const only = { ...profile, equipment: exercise.equipment, preferences: Object.fromEntries(exercises.map((entry) => [entry.id, entry.id === exercise.id ? 'normal' : 'exclude'])) };
      const workout = generateWorkout(only, [], { now, targets: [exercise.primary] });
      expect(workout.exercises.map((item) => item.exerciseId)).toEqual([exercise.id]);
    },
  );

  it('offers all reviewed pulldown grips as replacements', () => {
    const source = byId(1136);
    const options = getSimilarExercises({ exercises: [{ exerciseId: source.id }] }, source.id, profile);
    expect(options.map((exercise) => exercise.id)).toEqual(expect.arrayContaining(['wger-723', 'wger-1127']));
  });

  it.each([[567, 'bench'], [566, 'bench'], [76, 'rack'], [1620, 'bench'], [194, 'dipbars'], [465, 'preacherbench']])(
    'requires %s support: %s', (id, support) => {
      const exercise = byId(id);
      expect(isExerciseAllowed(exercise, profile)).toBe(true);
      expect(isExerciseAllowed(exercise, { ...profile, equipment: profile.equipment.filter((item) => item !== support) })).toBe(false);
    },
  );

  it('keeps standing and seated press guides separate without reusing a seated picture', async () => {
    const standing = byId('wger-567-standing');
    const guide = await getExerciseDetails(standing.guideId);
    expect(guide.description).toContain('No bench is required');
    expect(guide.image).toBeNull();
    expect((await getExerciseDetails(567)).description).toContain('seated');
    const workout = generateWorkout({ ...profile, preferences: Object.fromEntries(exercises.map((entry) => [entry.id, entry.id === standing.id ? 'normal' : 'exclude'])) }, [], { now, targets: ['shoulders'] });
    expect(workout.exercises[0].exerciseSnapshot.guideId).toBe(standing.guideId);
  });

  it('preserves the retired duplicate leg curl in older history', () => {
    expect(exercises.some((exercise) => exercise.id === 'wger-365')).toBe(false);
    expect(getWorkoutExercise({ exerciseId: 'wger-365', sets: [] })).toMatchObject({ id: 'wger-365', pattern: 'knee-flexion', primary: 'hamstrings' });
  });

  it('has unique stable IDs and only recognized equipment', () => {
    expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(exercises.length);
    expect(new Set(exercises.map(getExerciseVariantKey)).size).toBe(exercises.length);
    expect(exercises.flatMap((exercise) => exercise.equipment).every((equipment) => Object.hasOwn(equipmentLabels, equipment))).toBe(true);
    expect(byId('wger-1696-weighted')).toMatchObject({ bodyweightExerciseId: 'wger-1696', loadUnit: 'added-weight' });
  });
});
