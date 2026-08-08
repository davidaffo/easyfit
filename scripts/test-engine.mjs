import assert from 'node:assert/strict';
import { exercises } from '../src/data/exercises.js';
import { getExerciseDetails } from '../src/data/exerciseDetails.js';
import {
  estimateOneRepMax,
  generateWorkout,
  getExerciseHistory,
  getMovementFamily,
  getExerciseProgress,
  getRecovery,
  getSimilarExercises,
  getWeeklyMuscleLoad,
  getWeeklyMovementFrequency,
  getWeeklyTargets,
  removeExercise,
  replaceExercise,
  suggestFocusExercises,
  willCompleteExercise,
} from '../src/engine/generator.js';

const bench = exercises.find((exercise) => exercise.name === 'Bench Press');
assert(bench, 'The canonical English Bench Press must exist');
assert.equal(bench.translations.en, 'Bench Press');
const benchGuide = await getExerciseDetails(bench.wgerId, 'en');
assert(benchGuide.description.length > 100, 'The lazy wger guide must expose the English instructions');
assert(benchGuide.image?.startsWith('/exercise-images/'), 'The bundled wger guide must use a local exercise image');

const baseSet = { targetReps: 8, targetWeight: 60, targetRir: 2, weight: 60, done: true };
assert.equal(willCompleteExercise([{ done: false }, { done: false }, { done: false }], 0), false, 'The first set must not trigger the RIR prompt');
assert.equal(willCompleteExercise([{ done: true }, { done: true }, { done: false }], 2), true, 'The final completed set must trigger one RIR prompt');
const hardHistory = [{
  id: 'hard-session',
  completedAt: Date.now() - 36e5,
  exercises: [{
    exerciseId: bench.id,
    sets: [
      { ...baseSet, reps: 8, rir: 2 },
      { ...baseSet, reps: 15, rir: 0 },
    ],
  }],
}];

assert(estimateOneRepMax(60, 15, 0) > estimateOneRepMax(60, 8, 2), 'Extra reps at failure must raise e1RM');
assert(getExerciseProgress(hardHistory, bench.id).latestE1rm > 80, 'History must use actual reps and RIR');
const benchHistory = getExerciseHistory(hardHistory, bench.id);
assert.equal(benchHistory.sessionCount, 1, 'Exercise history must count completed sessions');
assert.equal(benchHistory.totalSets, 2, 'Exercise history must expose the completed sets');
assert(benchHistory.bestE1rm > 80, 'Exercise history must expose the best estimated 1RM');
assert.equal(getWeeklyMuscleLoad(hardHistory).volume.chest, 2, 'Completed sets must count toward weekly primary volume');
assert.equal(getWeeklyMuscleLoad(hardHistory).volume.shoulders, 1, 'Indirect sets must count as half a set');
assert.equal(getWeeklyMuscleLoad(hardHistory).frequency.shoulders, 1, 'Two indirect sets must count as one meaningful exposure');

const oneSetHistory = structuredClone(hardHistory);
oneSetHistory[0].exercises[0].sets = oneSetHistory[0].exercises[0].sets.slice(0, 1);
assert.equal(getWeeklyMuscleLoad(oneSetHistory).volume.shoulders, 0.5, 'A single indirect set must retain fractional volume');
assert.equal(getWeeklyMuscleLoad(oneSetHistory).frequency.shoulders, 0, 'A token half-set must not inflate weekly frequency');
assert.equal(getWeeklyMovementFrequency(oneSetHistory).push, 1, 'A completed push movement must count as one structural exposure');

const easyHistory = structuredClone(hardHistory);
easyHistory[0].exercises[0].sets[1].rir = 4;
easyHistory[0].exercises[0].sets[1].reps = 8;
assert(getRecovery(hardHistory).chest < getRecovery(easyHistory).chest, 'Failure and extra reps must create more estimated fatigue');

const lastSetRirHistory = [{
  id: 'last-set-rir',
  completedAt: Date.now() - 36e5,
  exercises: [{
    exerciseId: bench.id,
    sets: [
      { ...baseSet, reps: 20, rir: null },
      { ...baseSet, reps: 8, rir: 2 },
    ],
  }],
}];
assert.equal(
  Math.round(getExerciseProgress(lastSetRirHistory, bench.id).latestE1rm),
  Math.round(estimateOneRepMax(60, 8, 2)),
  'When RIR is requested once, calibration must prefer the set with an actual RIR instead of inventing one for every set',
);

const preferences = Object.fromEntries(exercises.map((exercise) => [exercise.id, 'exclude']));
delete preferences[bench.id];
const profile = {
  goal: 'muscle',
  level: 'intermediate',
  weeklyDays: 3,
  equipment: ['barbell', 'bench'],
  duration: 25,
  split: 'full',
  exerciseLanguage: 'en',
  preferences,
};
assert.deepEqual(getWeeklyTargets(profile), { sets: 10, frequency: 3, weeklyDays: 3 }, 'Intermediate hypertrophy targets must distribute ten fractional sets over three exposures');
assert.equal(getWeeklyTargets({ ...profile, level: 'beginner' }).sets, 7, 'Beginner volume must start conservatively');
assert.equal(getWeeklyTargets({ ...profile, level: 'advanced' }).sets, 12, 'Advanced volume must rise without using an extreme target');
const recalibrated = generateWorkout(profile, hardHistory, { targets: ['chest'], duration: 25 });
assert.equal(recalibrated.exercises[0].exerciseId, bench.id);
assert(recalibrated.exercises[0].sets[0].weight > 60, 'Strong over-performance must raise the next prescribed load');

const focusProfile = {
  ...profile,
  equipment: ['bodyweight', 'dumbbells', 'bench'],
  preferences: {},
  focusEnabled: true,
  focusExerciseIds: [],
};

const adaptiveWorkout = generateWorkout({
  ...focusProfile,
  split: 'adaptive',
  focusEnabled: false,
  duration: 25,
}, [], { variation: 41 });
const adaptiveFamilies = new Set(adaptiveWorkout.exercises.map((item) => {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
  return getMovementFamily(exercise);
}));
assert.deepEqual(
  [...adaptiveFamilies].filter(Boolean).sort(),
  ['hip', 'knee', 'pull', 'push'],
  'Even a 25-minute adaptive workout must train push, pull, knee and hip patterns',
);
assert(adaptiveWorkout.exercises.every((item) => item.sets.length === 2), 'Short sessions must spread volume instead of overloading one exercise');
assert.equal(adaptiveWorkout.engine.version, 4, 'The workout must preserve the evidence model version');
assert.deepEqual(adaptiveWorkout.engine.movementFamilies, ['push', 'pull', 'knee', 'hip'], 'The workout must expose its structural constraints');

const sixDayAdaptive = generateWorkout({
  ...focusProfile,
  split: 'adaptive',
  focusEnabled: false,
  weeklyDays: 6,
  duration: 45,
}, [], { variation: 42 });
assert.equal(getWeeklyTargets({ ...focusProfile, split: 'adaptive', weeklyDays: 6 }).frequency, 3, 'Six adaptive days must plan three weekly exposures per group');
assert.equal(sixDayAdaptive.engine.movementFamilies.length, 2, 'Six training days must rotate two pattern families instead of forcing six full-body sessions');
assert.equal(getWeeklyTargets({ ...profile, split: 'ppl', weeklyDays: 3 }).frequency, 1, 'A three-day PPL must prescribe its weekly volume in the single planned exposure');

const sixDayHistory = [];
const sixDayFamilyCounts = { push: 0, pull: 0, knee: 0, hip: 0 };
for (let day = 0; day < 6; day += 1) {
  const generated = generateWorkout({ ...focusProfile, split: 'adaptive', focusEnabled: false, weeklyDays: 6 }, sixDayHistory, { variation: 100 + day });
  generated.engine.movementFamilies.forEach((family) => { sixDayFamilyCounts[family] += 1; });
  generated.completedAt = Date.now() - (6 - day) * 36e5;
  generated.exercises.forEach((item) => item.sets.forEach((set) => { set.done = true; set.rir = 2; }));
  sixDayHistory.push(generated);
}
assert.deepEqual(sixDayFamilyCounts, { push: 3, pull: 3, knee: 3, hip: 3 }, 'A six-day adaptive week must expose every movement family three times');

const highFatigueHistory = [{
  id: 'high-fatigue',
  completedAt: Date.now() - 36e5,
  exercises: [{
    exerciseId: bench.id,
    sets: Array.from({ length: 6 }, () => ({ ...baseSet, reps: 10, rir: 0 })),
  }],
}];
const fatigueAdjusted = generateWorkout(profile, highFatigueHistory, { targets: ['chest'], duration: 25 });
assert.equal(fatigueAdjusted.exercises[0].targetRir, 3, 'Low readiness must raise the target RIR instead of prescribing failure');
assert.equal(fatigueAdjusted.exercises[0].sets.length, 2, 'Low readiness must cap per-exercise sets');

const suggestedFocus = suggestFocusExercises(focusProfile);
assert.equal(suggestedFocus.length, 3, 'A compatible push, pull and lower-body focus should be suggested');
const focusWorkout = generateWorkout({ ...focusProfile, focusExerciseIds: suggestedFocus }, [], {
  targets: ['chest', 'back', 'quads', 'hamstrings', 'glutes'],
  duration: 30,
});
assert.equal(focusWorkout.exercises[0].isFocus, true, 'The compatible focus must be first in the workout');
assert(suggestedFocus.includes(focusWorkout.exercises[0].exerciseId), 'The workout focus must come from the persistent selection');

const firstNonFocusId = focusWorkout.exercises.find((item) => !item.isFocus)?.exerciseId;
assert(firstNonFocusId, 'The focus workout must contain another exercise for edit checks');
const withoutExercise = removeExercise(focusWorkout, firstNonFocusId);
assert.equal(withoutExercise.exercises.length, focusWorkout.exercises.length - 1, 'Removing an exercise must only change the current workout');
assert(!withoutExercise.exercises.some((item) => item.exerciseId === firstNonFocusId), 'The removed exercise must leave the current workout');

const currentFocusExercise = exercises.find((exercise) => exercise.id === focusWorkout.exercises[0].exerciseId);
const similarChoices = getSimilarExercises(focusWorkout, currentFocusExercise.id, focusProfile);
assert(similarChoices.length > 1, 'The replacement picker must receive a list of compatible alternatives');
const selectedSimilar = similarChoices.find((exercise) => exercise.pattern === currentFocusExercise.pattern);
const similarWorkout = replaceExercise(focusWorkout, currentFocusExercise.id, focusProfile, [], selectedSimilar.id);
const similarExercise = exercises.find((exercise) => exercise.id === similarWorkout.exercises[0].exerciseId);
assert.equal(similarExercise.id, selectedSimilar.id, 'Replacement must use the exercise explicitly selected by the user');
assert.equal(similarExercise.pattern, currentFocusExercise.pattern, 'Similar replacement must preserve the movement pattern when possible');

const refreshedWorkout = generateWorkout({ ...focusProfile, focusExerciseIds: suggestedFocus }, [], {
  targets: focusWorkout.targetMuscles,
  duration: focusWorkout.duration,
  avoidExerciseIds: focusWorkout.exercises.filter((item) => !item.isFocus).map((item) => item.exerciseId),
});
const oldNonFocus = new Set(focusWorkout.exercises.filter((item) => !item.isFocus).map((item) => item.exerciseId));
assert(!refreshedWorkout.exercises.some((item) => !item.isFocus && oldNonFocus.has(item.exerciseId)), 'Workout refresh must avoid the previous non-focus exercises');

const excludedFocusWorkout = generateWorkout({
  ...focusProfile,
  focusExerciseIds: [currentFocusExercise.id],
  preferences: { [currentFocusExercise.id]: 'exclude' },
}, [], { targets: [currentFocusExercise.primary], duration: 25 });
assert(!excludedFocusWorkout.exercises.some((item) => item.exerciseId === currentFocusExercise.id), 'Excluded exercises must not return, even when previously selected as focus');

const bodyweight = exercises.find((exercise) => exercise.loadType === 'bodyweight' && exercise.primary === 'quads' && /squat/i.test(exercise.name));
assert(bodyweight, 'A bodyweight squat must exist');
const bodyweightHistory = [{
  id: 'bodyweight-session',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bodyweight.id, sets: [{ targetReps: 8, reps: 20, weight: 0, rir: 0, done: true }] }],
}];
const bodyPreferences = Object.fromEntries(exercises.map((exercise) => [exercise.id, 'exclude']));
delete bodyPreferences[bodyweight.id];
const bodyWorkout = generateWorkout({ ...profile, equipment: ['bodyweight'], preferences: bodyPreferences }, bodyweightHistory, { targets: ['quads'], duration: 25 });
assert(bodyWorkout.exercises[0].sets[0].reps > 8, 'Bodyweight reps must adapt to demonstrated capacity');

console.log('Engine checks passed: guides, multifrequency structure, fractional volume, readiness, focus, edit/exclude/refresh, RIR and progression.');
