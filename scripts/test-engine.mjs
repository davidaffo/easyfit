import assert from 'node:assert/strict';
import { exercises } from '../src/data/exercises.js';
import {
  BACKUP_FILENAME,
  buildWebDavFileUrl,
  downloadWebDavBackup,
  parseBackup,
  serializeBackup,
  uploadWebDavBackup,
} from '../src/data/backup.js';
import { getExerciseDetails } from '../src/data/exerciseDetails.js';
import {
  advanceFocusCycles,
  estimateOneRepMax,
  generateWorkout,
  getExerciseHistory,
  getFocusAnalytics,
  getFocusCycleProgress,
  getMovementFamily,
  getExerciseProgress,
  getExercisePrescription,
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

const backupState = {
  profile: { ...profile, cloud: { webDavUrl: 'https://cloud.example.test/remote.php/dav/files/user/Easyfit', webDavUsername: 'user', webDavPassword: 'app-password' } },
  history: hardHistory,
  workout: null,
};
const serializedBackup = serializeBackup(backupState);
const parsedBackup = parseBackup(serializedBackup);
assert.equal(parsedBackup.profile.cloud.webDavUrl, backupState.profile.cloud.webDavUrl, 'Backup round-trip must preserve the WebDAV URL');
assert.equal(parsedBackup.profile.cloud.webDavUsername, 'user', 'Backup round-trip must preserve the WebDAV username');
assert.equal(parsedBackup.profile.cloud.webDavPassword, undefined, 'Backup serialization must strip cloud password fields');
assert.deepEqual(parsedBackup.history[0].exercises, hardHistory[0].exercises, 'Backup round-trip must preserve completed exercises and sets');
assert.equal(parsedBackup.history[0].completedAt, hardHistory[0].completedAt, 'Backup round-trip must preserve workout dates');
assert.equal(parsedBackup.workout, null, 'Backup round-trip must preserve an empty active workout');
assert(!serializedBackup.includes('app-password'), 'Serialized backups must never invent or include a cloud password');
assert.throws(() => parseBackup('{broken'), /JSON valido/, 'Malformed JSON must be rejected');
assert.throws(() => parseBackup(JSON.stringify({ format: 'another-app', schemaVersion: 1 })), /backup Easyfit/, 'Foreign backup formats must be rejected');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 99, payload: {} })), /versione più recente/, 'Future schemas must not be imported silently');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: {}, history: [42], workout: null } })), /workout non validi/, 'Malformed history records must be rejected');
assert.equal(
  buildWebDavFileUrl('https://cloud.example.test/remote.php/dav/files/user/Easyfit/'),
  `https://cloud.example.test/remote.php/dav/files/user/Easyfit/${BACKUP_FILENAME}`,
  'The fixed backup filename must be appended to the WebDAV folder',
);

let uploadRequest;
await uploadWebDavBackup({
  folderUrl: 'https://cloud.example.test/remote.php/dav/files/user/Easyfit',
  username: 'user',
  password: 'app-password',
  serialized: serializedBackup,
  fetcher: async (url, options) => {
    uploadRequest = { url, options };
    return { ok: true, status: 201 };
  },
});
assert.equal(uploadRequest.options.method, 'PUT', 'Nextcloud upload must use WebDAV PUT');
assert.equal(uploadRequest.options.body, serializedBackup, 'Nextcloud upload must send the serialized backup unchanged');
assert(uploadRequest.options.headers.Authorization.startsWith('Basic '), 'Authenticated WebDAV must send Basic authorization');
assert.equal(uploadRequest.options.headers['X-Requested-With'], 'XMLHttpRequest', 'Writable public shares require the XMLHttpRequest header');

let downloadMethod;
const downloadedBackup = await downloadWebDavBackup({
  folderUrl: 'https://cloud.example.test/remote.php/dav/files/user/Easyfit',
  username: 'user',
  password: 'app-password',
  fetcher: async (_url, options) => {
    downloadMethod = options.method;
    return { ok: true, status: 200, text: async () => serializedBackup };
  },
});
assert.equal(downloadMethod, 'GET', 'Nextcloud restore must use WebDAV GET');
assert.deepEqual(parseBackup(downloadedBackup).history[0].exercises, hardHistory[0].exercises, 'A cloud download must remain a valid Easyfit backup');

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
assert.equal(adaptiveWorkout.engine.version, 5, 'The workout must preserve the evidence model version');
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
assert.equal(fatigueAdjusted.exercises[0].targetRir, 2, 'Readiness must not silently change the RIR explicitly chosen by the user');
assert.equal(fatigueAdjusted.exercises[0].sets.length, 2, 'Low readiness must cap per-exercise sets');

const gradualProgressHistory = [{
  id: 'gradual-progress',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, targetReps: 8, reps: 8, rir: 2 }] }],
}];
const gradualProgress = generateWorkout(profile, gradualProgressHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(gradualProgress.sets[0].weight, 60, 'Double progression must keep load while the top of the rep range is not reached');
assert.equal(gradualProgress.sets[0].reps, 9, 'Double progression must add exactly one target repetition');
assert.equal(gradualProgress.progressionStep, 'reps');

const loadProgressHistory = [{
  id: 'load-progress',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, targetReps: 12, reps: 12, rir: 2 }] }],
}];
const loadProgress = generateWorkout(profile, loadProgressHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(loadProgress.sets[0].weight, 62.5, 'Reaching the top of the range at target RIR must add the smallest barbell increment');
assert.equal(loadProgress.sets[0].reps, 8, 'A load increase must restart from the bottom of the rep range');
assert.equal(loadProgress.progressionStep, 'load');

const customProfile = {
  ...profile,
  targetRir: 0,
  setCaps: { compound: 4, accessory: 3 },
  exerciseOverrides: { [bench.id]: { minReps: 5, maxReps: 7, maxSets: 1, targetRir: 1 } },
};
assert.deepEqual(
  getExercisePrescription(customProfile, bench),
  { minReps: 5, maxReps: 7, maxSets: 1, targetRir: 1, customRir: 1 },
  'Per-exercise limits must override the global prescription',
);
assert.equal(
  getExercisePrescription({ ...profile, setCaps: { compound: 2, accessory: 1 } }, bench).maxSets,
  2,
  'The global compound set cap must apply when an exercise has no override',
);
const customWorkout = generateWorkout(customProfile, [], { targets: ['chest'], duration: 60 }).exercises[0];
assert.equal(customWorkout.sets.length, 1, 'The per-exercise set cap must be enforced');
assert.deepEqual(customWorkout.repRange, { min: 5, max: 7 }, 'The custom rep range must be stored in the workout');
assert.equal(customWorkout.targetRir, 1, 'The exercise-specific RIR must override global RIR 0');

const failureProfile = { ...profile, targetRir: 0 };
const failureWorkout = generateWorkout(failureProfile, highFatigueHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(failureWorkout.targetRir, 0, 'RIR 0 must remain available even when readiness is low');
assert(failureWorkout.sets.every((set) => set.targetRir === 0), 'Every prescribed set must expose the selected RIR target');

const suggestedFocus = suggestFocusExercises(focusProfile);
assert.equal(suggestedFocus.length, 3, 'A compatible push, pull and lower-body focus should be suggested');
const focusWorkout = generateWorkout({ ...focusProfile, focusExerciseIds: suggestedFocus }, [], {
  targets: ['chest', 'back', 'quads', 'hamstrings', 'glutes'],
  duration: 30,
});
assert.equal(focusWorkout.exercises[0].isFocus, true, 'The compatible focus must be first in the workout');
assert(suggestedFocus.includes(focusWorkout.exercises[0].exerciseId), 'The workout focus must come from the persistent selection');

const focusCycleHistory = Array.from({ length: 4 }, (_, index) => ({
  id: `focus-cycle-${index}`,
  completedAt: Date.now() - (4 - index) * 864e5,
  exercises: [{
    exerciseId: suggestedFocus[0],
    isFocus: true,
    sets: [{ targetReps: 8, reps: 8 + index, weight: 20, rir: 2, done: true }],
  }],
}));
assert.deepEqual(
  getFocusCycleProgress(focusCycleHistory, suggestedFocus[0], 0, 4),
  { completed: 4, target: 4, remaining: 0 },
  'A focus cycle must complete after four actual focus exposures',
);
const focusRotation = advanceFocusCycles(
  { ...focusProfile, focusExerciseIds: suggestedFocus, focusCycleLength: 4 },
  focusCycleHistory,
  focusCycleHistory.at(-1),
);
assert.equal(focusRotation.rotated.length, 1, 'The completed focus family must rotate after its fourth exposure');
assert.notEqual(focusRotation.profile.focusExerciseIds[0], suggestedFocus[0], 'Focus rotation must choose another compatible exercise');

const analyticsNow = Date.now();
const analyticsHistory = [
  { id: 'previous-week', completedAt: analyticsNow - 9 * 864e5, exercises: [{ exerciseId: bench.id, isFocus: true, sets: [{ ...baseSet, weight: 60, reps: 8, rir: 2 }] }] },
  { id: 'current-week', completedAt: analyticsNow - 2 * 864e5, exercises: [{ exerciseId: bench.id, isFocus: true, sets: [{ ...baseSet, weight: 62.5, reps: 8, rir: 2 }] }] },
];
const focusAnalytics = getFocusAnalytics(analyticsHistory, [bench.id], { now: analyticsNow, cycleLength: 4 });
assert.equal(focusAnalytics.week.focusSessions, 1, 'The weekly summary must count current-week focus sessions');
assert(focusAnalytics.week.strengthChange > 0, 'The weekly summary must compare estimated strength with the previous week');
assert(focusAnalytics.week.volumeChange > 0, 'The weekly summary must compare completed training volume');

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

console.log('Checks passed: backup/WebDAV, guides, multifrequency, focus cycles and analytics, fractional volume, double progression, custom limits, exact RIR and workout editing.');
