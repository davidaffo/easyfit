import assert from 'node:assert/strict';
import { exercises } from '../src/data/exercises.js';
import {
  estimateOneRepMax,
  generateWorkout,
  getExerciseHistory,
  getExerciseProgress,
  getRecovery,
  getWeeklyMuscleLoad,
  removeExercise,
  replaceExercise,
  suggestFocusExercises,
} from '../src/engine/generator.js';

const bench = exercises.find((exercise) => exercise.name === 'Bench Press');
assert(bench, 'The canonical English Bench Press must exist');
assert.equal(bench.translations.en, 'Bench Press');

const baseSet = { targetReps: 8, targetWeight: 60, targetRir: 2, weight: 60, done: true };
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

const easyHistory = structuredClone(hardHistory);
easyHistory[0].exercises[0].sets[1].rir = 4;
easyHistory[0].exercises[0].sets[1].reps = 8;
assert(getRecovery(hardHistory).chest < getRecovery(easyHistory).chest, 'Failure and extra reps must create more estimated fatigue');

const preferences = Object.fromEntries(exercises.map((exercise) => [exercise.id, 'exclude']));
delete preferences[bench.id];
const profile = {
  goal: 'muscle',
  level: 'intermediate',
  equipment: ['barbell', 'bench'],
  duration: 25,
  split: 'full',
  exerciseLanguage: 'en',
  preferences,
};
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
const similarWorkout = replaceExercise(focusWorkout, currentFocusExercise.id, focusProfile, []);
const similarExercise = exercises.find((exercise) => exercise.id === similarWorkout.exercises[0].exerciseId);
assert.notEqual(similarExercise.id, currentFocusExercise.id, 'Similar replacement must select a different exercise');
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

console.log('Engine checks passed: catalog, focus, edit/exclude/refresh, exercise history, e1RM, RIR, recovery, weekly volume and progression.');
