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
  calibrateBodyweightPrescription,
  estimateOneRepMax,
  generateWorkout,
  getExerciseHistory,
  getExerciseVariantKey,
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
  getWorkoutCompositionLimits,
  getWorkoutSettingsFingerprint,
  isExerciseAllowed,
  isEssentialExercise,
  isReturningAfterBreak,
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

const benchVariantProfile = {
  goal: 'muscle',
  equipment: ['barbell', 'bench'],
  preferences: {},
  exerciseFilters: { essentialCatalog: true },
};
const benchVariantCluster = exercises.filter((exercise) => getExerciseVariantKey(exercise) === getExerciseVariantKey(bench));
assert(benchVariantCluster.length > 3, 'The catalog must expose the bench microvariants used by the essential catalog test');
assert.equal(benchVariantCluster.filter((exercise) => isEssentialExercise(exercise, benchVariantProfile)).length, 1, 'The essential catalog must retain one canonical barbell bench variant');

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

assert.deepEqual(getWeeklyTargets(profile), { sets: 10, frequency: 2 }, 'Adaptive hypertrophy targets must aim for two exposures without asking for planned training days');
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

const snatch = exercises.find((exercise) => /dumbbell snatch/i.test(exercise.name));
assert(snatch, 'The catalog must contain the hybrid movement used by the filter test');
assert.equal(isExerciseAllowed(snatch, { ...focusProfile, goal: 'muscle' }), false, 'Snatches and similar hybrid power movements must be excluded from hypertrophy workouts');
assert.equal(isExerciseAllowed(snatch, { ...focusProfile, goal: 'fitness' }), true, 'The automatic hybrid filter must remain specific to the muscle-building goal');
const combinedLift = exercises.find((exercise) => /glute bridge single-arm press/i.test(exercise.name));
assert(combinedLift, 'The catalog must contain the combined lift used by the filter test');
assert.equal(isExerciseAllowed(combinedLift, { ...focusProfile, goal: 'muscle' }), false, 'Exercises that combine unrelated lifts must be excluded from hypertrophy workouts');

const bodyweightPush = exercises.find((exercise) => exercise.loadType === 'bodyweight' && exercise.primary === 'chest' && exercise.pattern === 'horizontal-push');
assert(bodyweightPush, 'A bodyweight horizontal push must exist');
const loadedAlternativeProfile = {
  ...focusProfile,
  equipment: ['bodyweight', 'barbell', 'bench'],
  exerciseFilters: { preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
};
assert.equal(isExerciseAllowed(bodyweightPush, loadedAlternativeProfile), false, 'A bodyweight movement must be removable when a loaded equivalent is available');
assert.equal(isExerciseAllowed(bodyweightPush, { ...loadedAlternativeProfile, exerciseFilters: { ...loadedAlternativeProfile.exerciseFilters, preferLoadedVariants: false } }), true, 'The user must be able to keep bodyweight alternatives');

const allEquipment = [...new Set(exercises.flatMap((exercise) => exercise.equipment))];
const directCore = exercises.find((exercise) => exercise.primary === 'core' && exercise.equipment.every((item) => allEquipment.includes(item)));
const directCalves = exercises.find((exercise) => exercise.primary === 'calves' && exercise.equipment.every((item) => allEquipment.includes(item)));
const directFilterProfile = { ...focusProfile, equipment: allEquipment, exerciseFilters: { preferLoadedVariants: false, excludeDirectCore: true, excludeCalves: true } };
assert.equal(isExerciseAllowed(directCore, directFilterProfile), false, 'Direct abdominal exercises must support a global exclusion');
assert.equal(isExerciseAllowed(directCalves, directFilterProfile), false, 'Direct calf exercises must support a global exclusion');

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
  ['pull', 'push'],
  'A short first workout must select two coherent movement families instead of training everything',
);
assert(adaptiveWorkout.exercises.every((item) => item.sets.length === 2), 'Short sessions must spread volume instead of overloading one exercise');
assert(adaptiveWorkout.exercises.length <= 3, 'A 25–30 minute workout must contain at most three exercises');
assert.deepEqual(adaptiveWorkout.engine.composition, { compounds: 2, accessories: 1, ...getWorkoutCompositionLimits(25) }, 'A short workout must balance two compounds with one accessory');
assert.equal(adaptiveWorkout.engine.version, 6, 'The workout must preserve the evidence model version');
assert.deepEqual(adaptiveWorkout.engine.movementFamilies, ['push', 'pull'], 'The workout must expose its structural constraints');
const filteredAdaptive = generateWorkout({ ...directFilterProfile, goal: 'muscle', split: 'adaptive', focusEnabled: false, duration: 60 }, [], { variation: 44 });
assert(filteredAdaptive.exercises.every((item) => {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
  return exercise.primary !== 'core' && exercise.primary !== 'calves' && !/snatch|clean|jerk|thruster|burpee/i.test(exercise.name);
}), 'The generated hypertrophy workout must enforce global filters and exclude hybrid power movements');

const adaptiveWithTwoLegacyDays = generateWorkout({
  ...focusProfile,
  split: 'adaptive',
  focusEnabled: false,
  weeklyDays: 2,
  duration: 45,
}, [], { variation: 42 });
const adaptiveWithSixLegacyDays = generateWorkout({ ...focusProfile, split: 'adaptive', focusEnabled: false, weeklyDays: 6, duration: 45 }, [], { variation: 42 });
assert.deepEqual(adaptiveWithSixLegacyDays.engine.movementFamilies, adaptiveWithTwoLegacyDays.engine.movementFamilies, 'Legacy planned-day values must no longer change an adaptive workout');
assert.equal(adaptiveWithTwoLegacyDays.engine.movementFamilies.length, 3, 'A regular 45-minute workout must select three movement families');
assert(adaptiveWithTwoLegacyDays.exercises.length <= 6, 'A first 45-minute workout must remain capped at six exercises');
assert(adaptiveWithTwoLegacyDays.engine.composition.compounds <= 3, 'A 45-minute workout must contain at most three compound exercises');
assert(adaptiveWithTwoLegacyDays.engine.composition.accessories >= 2, 'A 45-minute workout must retain room for at least two accessories');
assert.equal(getWeeklyTargets({ ...profile, split: 'ppl' }).frequency, 1, 'PPL must retain one target exposure per rotation');

const settingsFingerprint = getWorkoutSettingsFingerprint(focusProfile);
assert.equal(getWorkoutSettingsFingerprint({ ...focusProfile, exerciseLanguage: 'it', cloud: { webDavUrl: 'https://example.test' } }), settingsFingerprint, 'Language and cloud settings must not invalidate an existing workout');
assert.notEqual(getWorkoutSettingsFingerprint({ ...focusProfile, targetRir: 1 }), settingsFingerprint, 'A training setting such as target RIR must invalidate an existing workout');
assert.notEqual(getWorkoutSettingsFingerprint({ ...focusProfile, exerciseFilters: { excludeDirectCore: true } }), settingsFingerprint, 'Exercise filters must invalidate an existing workout');

adaptiveWithTwoLegacyDays.completedAt = Date.now() - 36e5;
adaptiveWithTwoLegacyDays.exercises.forEach((item) => item.sets.forEach((set) => { set.done = true; set.rir = 2; }));
const nextAdaptive = generateWorkout({ ...focusProfile, split: 'adaptive', focusEnabled: false, duration: 45 }, [adaptiveWithTwoLegacyDays], { variation: 43 });
assert(new Set([...adaptiveWithTwoLegacyDays.engine.movementFamilies, ...nextAdaptive.engine.movementFamilies]).size === 4, 'The next workout must rotate in the movement family omitted from the previous one');

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

const staleHistory = structuredClone(hardHistory);
staleHistory[0].completedAt = Date.now() - 11 * 864e5;
assert.equal(isReturningAfterBreak(staleHistory), true, 'More than ten days without training must trigger gradual return mode');
const returnWorkout = generateWorkout({ ...profile, duration: 60 }, staleHistory, { targets: ['chest'], duration: 60 });
assert.equal(returnWorkout.engine.returningFromBreak, true, 'The workout must expose gradual return mode');
assert(returnWorkout.exercises.every((item) => item.sets.length <= 2), 'Gradual return mode must cap each exercise at two sets');

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
const allSimilarChoices = getSimilarExercises(focusWorkout, currentFocusExercise.id, focusProfile, { includeVariants: true });
assert(allSimilarChoices.length > similarChoices.length, 'The replacement picker must keep microvariants available behind an explicit expansion');
assert.equal(new Set(similarChoices.map(getExerciseVariantKey)).size, similarChoices.length, 'The default replacement list must contain only one representative per variant family');
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
const uncalibratedBodyWorkout = generateWorkout({ ...profile, equipment: ['bodyweight'], preferences: bodyPreferences }, [], { targets: ['quads'], duration: 25 });
assert.equal(uncalibratedBodyWorkout.exercises[0].needsInitialReps, true, 'A first-time bodyweight exercise must request a repetition calibration');
const calibratedBodyweight = calibrateBodyweightPrescription(uncalibratedBodyWorkout.exercises[0], 20);
assert.equal(calibratedBodyweight.needsInitialReps, false, 'Submitting maximum repetitions must complete bodyweight calibration');
assert(calibratedBodyweight.sets.every((set) => set.reps === Math.min(18, calibratedBodyweight.repRange.max)), 'Calibration must subtract target RIR and respect the exercise repetition cap');
const bodyWorkout = generateWorkout({ ...profile, equipment: ['bodyweight'], preferences: bodyPreferences }, bodyweightHistory, { targets: ['quads'], duration: 25 });
assert(bodyWorkout.exercises[0].sets[0].reps > 8, 'Bodyweight reps must adapt to demonstrated capacity');

console.log('Checks passed: backup/WebDAV, guides, adaptive rotation, exercise filters, bodyweight calibration, gradual return, focus analytics, double progression, custom limits, exact RIR and workout editing.');
