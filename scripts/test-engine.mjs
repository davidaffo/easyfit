import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogExercises, exercises } from '../src/data/exercises.js';
import {
  BACKUP_FILENAME,
  MAX_BACKUP_BYTES,
  buildWebDavFileUrl,
  downloadWebDavBackup,
  parseBackup,
  serializeBackup,
  uploadWebDavBackup,
} from '../src/data/backup.js';
import { getExerciseDetails } from '../src/data/exerciseDetails.js';
import {
  ENGINE_VERSION,
  addWorkoutSet,
  calibrateBodyweightPrescription,
  estimatePrescriptionMinutes,
  estimateOneRepMax,
  generateWorkout,
  generateWorkoutAlternatives,
  getAvailableLoads,
  getEquipmentCoverage,
  getExerciseAnalytics,
  getExerciseContinuity,
  getExerciseHistory,
  getExerciseMuscleContributions,
  getExerciseVariantKey,
  getMovementFamily,
  getMuscleSelectionPriority,
  getMuscleTrainingStatus,
  getExerciseProgress,
  getExercisePrescription,
  getExerciseEffortClass,
  getRecovery,
  getSimilarExercises,
  getTrackedExerciseIds,
  getWeeklyMuscleLoad,
  getWeeklyMovementFrequency,
  getWeeklyTargets,
  getWorkoutCompositionLimits,
  getWorkoutSettingsFingerprint,
  getWorkoutExercise,
  trainingStyles,
  isExerciseAllowed,
  isCompatibleWorkout,
  isPreparedWorkoutStale,
  isEssentialExercise,
  isLowerBodyExercise,
  isReturningAfterBreak,
  isWorkoutActive,
  removeExercise,
  removeWorkoutSet,
  recalibrateTrainingTargets,
  rebuildWorkoutMetadata,
  replaceExercise,
  startWorkout,
  willCompleteExercise,
} from '../src/engine/generator.js';

const bench = exercises.find((exercise) => exercise.name === 'Bench Press');
assert(bench, 'The canonical English Bench Press must exist');
assert.equal(bench.translations.en, 'Bench Press');
assert.equal(catalogExercises.length, exercises.length, 'The runtime bundle must contain only explicitly reviewed exercises');
assert(catalogExercises.every((exercise) => exercise.generationEligible && exercise.pattern), 'Every bundled exercise must have explicit programming metadata');
assert(catalogExercises.every((exercise) => ['high-fatigue-compound', 'stable-compound', 'isolation'].includes(exercise.effortClass)), 'Every bundled exercise must declare its reviewed effort class');
assert(catalogExercises.every((exercise) => typeof exercise.intensifierEligible === 'boolean'), 'Every bundled exercise must declare intensifier eligibility explicitly');
assert(catalogExercises.filter((exercise) => exercise.effortClass === 'high-fatigue-compound').every((exercise) => !exercise.intensifierEligible), 'High-fatigue compounds must never be marked eligible for intensifiers');
const benchGuide = await getExerciseDetails(bench.wgerId, 'en');
assert(benchGuide.description.length > 100, 'The lazy wger guide must expose the English instructions');
assert(benchGuide.image?.startsWith('/exercise-images/'), 'The bundled wger guide must use a local exercise image');
for (const exercise of exercises) {
  const guide = await getExerciseDetails(exercise.wgerId, 'en');
  assert(guide?.description?.length >= 100 && guide?.image?.includes('/exercise-images/'), `Approved exercise ${exercise.name} must ship with a useful complete offline guide`);
  assert(!/fast movement|rapid movement|touches your neck|hands are behind your head/i.test(guide.description), `Approved guide ${exercise.name} must not retain unsafe or low-quality wording`);
  const imageBytes = await readFile(new URL(`../public${guide.image}`, import.meta.url));
  assert(imageBytes.length > 0, `Approved exercise ${exercise.name} must reference an image file that actually exists in the PWA`);
}
const serviceWorkerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
assert(serviceWorkerSource.includes('cache.addAll(images)'), 'The service worker install must fail atomically if any bundled guide image cannot be cached');
assert(!serviceWorkerSource.includes('Promise.allSettled(images'), 'Offline installation must not silently ignore missing guide images');
assert(serviceWorkerSource.includes("const CACHE = 'easyfit-v26'"), 'An engine/cache change must bump the offline cache version');
assert(serviceWorkerSource.includes("cache.delete(request)"), 'The current PWA cache must remove assets no longer present in the build or guide index');
assert(serviceWorkerSource.includes("requestUrl.origin !== self.location.origin"), 'The service worker must never intercept cross-origin WebDAV traffic');
assert(serviceWorkerSource.includes("headers.has('Authorization')"), 'Authenticated responses must never enter the PWA cache');
assert(serviceWorkerSource.includes("addEventListener('notificationclick'"), 'Recovery notifications must reopen the installed PWA when tapped');
assert(appSource.includes('createOscillator()') && appSource.includes('showNotification(title, options)'), 'The recovery timer must provide both an audible double beep and Web Notifications');
assert(!exercises.some((exercise) => exercise.wgerId === 458), 'Rep-based prescriptions must not include a time-based plank');
assert.equal(exercises.filter((exercise) => [659, 805, 1185].includes(exercise.wgerId)).length, 1, 'Near-identical cable triceps duplicates must collapse to one canonical exercise');
assert(!appSource.includes('Push / Pull / Legs') && !appSource.includes('Upper / Lower'), 'The app must expose only adaptive scheduling, without selectable split modes');
assert(appSource.includes('Proposta adattiva') && !appSource.includes("title: 'Spinta'"), 'Workout refresh must offer complete adaptive alternatives instead of targeted muscle splits');

const benchVariantProfile = {
  goal: 'muscle',
  equipment: ['barbell', 'bench'],
  preferences: {},
  exerciseFilters: { essentialCatalog: true },
};
const reviewedVariant = exercises.find((exercise) => exercise.name === 'Leg Curl');
const pressVariantCluster = exercises.filter((exercise) => getExerciseVariantKey(exercise) === getExerciseVariantKey(reviewedVariant));
assert(pressVariantCluster.length > 1, 'The approved catalog must retain reviewed microvariants');
assert.equal(pressVariantCluster.filter((exercise) => isEssentialExercise(exercise, { ...benchVariantProfile, equipment: ['machines'] })).length, 1, 'The essential catalog must retain one canonical representative');

const baseSet = { targetReps: 8, targetWeight: 60, targetRir: 2, weight: 60, done: true };
const preparedWorkout = { id: 'prepared', createdAt: Date.now(), exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, done: false }] }] };
assert.equal(isWorkoutActive(preparedWorkout), false, 'A generated but unopened workout must remain only prepared');
assert.equal(startWorkout({ id: 'empty', exercises: [] }), null, 'An empty workout must never be activated');
const activeWorkoutState = startWorkout(preparedWorkout, 123456);
assert.equal(activeWorkoutState.startedAt, 123456, 'Starting a workout must persist its start timestamp');
assert.equal(isWorkoutActive(activeWorkoutState), true, 'A started and unfinished workout must be recognized as active after reload');
assert.equal(isWorkoutActive({ ...activeWorkoutState, completedAt: 123999 }), false, 'A completed workout must no longer lock the app in training mode');
assert.equal(startWorkout({ ...activeWorkoutState, completedAt: 123999 }), null, 'A completed workout must never be reopened into an invalid view state');
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
assert(getWeeklyMuscleLoad(hardHistory).volume.chest > 2, 'Extra repetitions at failure must increase productive stimulus credit within the safety cap');
assert(getWeeklyMuscleLoad(hardHistory).volume.shoulders > 1, 'Indirect work must inherit fractional credit from actual repetition performance');
assert(getWeeklyMuscleLoad(hardHistory).frequency.shoulders > .99, 'Enough accumulated indirect work must count as an exposure without a weekly cliff');
assert.deepEqual(
  getExerciseMuscleContributions(bench),
  { chest: 1, shoulders: 0.5, triceps: 0.5 },
  'A bench set must credit every major trained muscle without treating them as equal direct sets',
);

const squat = exercises.find((exercise) => exercise.pattern === 'squat' && exercise.primary === 'quads');
assert(squat, 'A squat pattern must exist for contribution checks');
assert.equal(getExerciseMuscleContributions(squat).glutes, 0.5, 'Squats must credit meaningful glute stimulus');
assert.equal(getExerciseMuscleContributions(squat).hamstrings, undefined, 'Squats must not invent meaningful hamstring hypertrophy credit');

const oneSetHistory = structuredClone(hardHistory);
oneSetHistory[0].exercises[0].sets = oneSetHistory[0].exercises[0].sets.slice(0, 1);
assert.equal(getWeeklyMuscleLoad(oneSetHistory).volume.shoulders, 0.5, 'A single indirect set must retain fractional volume');
assert.equal(getWeeklyMuscleLoad(oneSetHistory).frequency.shoulders, 0, 'A token half-set must not inflate weekly frequency');
assert(getWeeklyMovementFrequency(oneSetHistory).push > .99, 'A completed push movement must count as one structural exposure');
const tokenMovementHistory = [{ completedAt: Date.now() - 1000, exercises: [{ exerciseId: bench.id, exerciseSnapshot: bench, sets: [{ ...baseSet, targetReps: 12, reps: 1, rir: 10 }] }] }];
assert.equal(getWeeklyMovementFrequency(tokenMovementHistory).push, 0, 'A token set must not count as a productive structural exposure');
const targetEffortSet = [{ completedAt: Date.now() - 1000, exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, reps: 8, rir: 2 }] }] }];
const failureEffortSet = [{ completedAt: Date.now() - 1000, exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, reps: 8, rir: 0 }] }] }];
assert.equal(getWeeklyMuscleLoad(failureEffortSet).volume.chest, getWeeklyMuscleLoad(targetEffortSet).volume.chest, 'Going closer to failure must raise fatigue without subtracting productive stimulus');

const futureHistory = [{
  completedAt: Date.now() + 30 * 864e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 5 }, () => ({ ...baseSet, reps: 12, rir: 0 })) }],
}];
assert.equal(getWeeklyMuscleLoad(futureHistory).volume.chest, 0, 'Future-dated workouts must never count toward current stimulus');
assert.equal(getWeeklyMovementFrequency(futureHistory).push, 0, 'Future-dated workouts must never count toward current frequency');
assert.equal(getRecovery(futureHistory).chest, 100, 'Future-dated workouts must never create current fatigue');
const zeroRepHistory = [{ completedAt: Date.now() - 1000, exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, reps: 0, done: true }] }] }];
assert.equal(getRecovery(zeroRepHistory).chest, 100, 'A completed marker with zero repetitions must not create fatigue');
const zeroRepStatus = getMuscleTrainingStatus({ goal: 'muscle', split: 'adaptive' }, zeroRepHistory);
assert.equal(zeroRepStatus.chest.lastStimulatedAt, null, 'Zero repetitions must not update muscle recency');
assert.equal(zeroRepStatus.chest.doseStimulus, 0, 'Zero repetitions must not create training-dose memory');

assert(
  getMuscleSelectionPriority('quads', { priority: 60 }) > getMuscleSelectionPriority('biceps', { priority: 60 }),
  'Large muscle groups must win ties when adaptive need is equal',
);
assert(
  getMuscleSelectionPriority('glutes', { priority: 90 }) > getMuscleSelectionPriority('quads', { priority: 10 }),
  'A genuinely undertrained smaller-priority muscle must outrank a large muscle that is already covered',
);

const easyHistory = structuredClone(hardHistory);
easyHistory[0].exercises[0].sets[1].rir = 4;
easyHistory[0].exercises[0].sets[1].reps = 8;
assert(getRecovery(hardHistory).chest < getRecovery(easyHistory).chest, 'Failure and extra reps must create more estimated fatigue');
const feedbackNow = Date.now();
assert(
  getRecovery([], feedbackNow, { recoveryFeedback: { chest: { adjustment: -20, updatedAt: feedbackNow } } }).chest
    < getRecovery([], feedbackNow).chest,
  'Subjective fatigue feedback must lower current readiness instead of being ignored',
);
assert(
  getRecovery([], feedbackNow + 48 * 36e5, { recoveryFeedback: { chest: { adjustment: -20, updatedAt: feedbackNow } } }).chest >= 95,
  'Subjective feedback must decay automatically rather than becoming permanent profile bias',
);

const statusNow = Date.now();
const row = exercises.find((exercise) => exercise.name === 'Bent Over Dumbbell Rows');
assert(row, 'A canonical row must exist for muscle-priority checks');
const stimulusHistory = [
  {
    id: 'old-pull-stimulus',
    completedAt: statusNow - 6 * 864e5,
    exercises: [{ exerciseId: row.id, sets: Array.from({ length: 2 }, () => ({ ...baseSet, reps: 8, done: true, rir: 2 })) }],
  },
  {
    id: 'recent-push-stimulus',
    completedAt: statusNow - 12 * 36e5,
    exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 3 }, () => ({ ...baseSet, reps: 8, done: true, rir: 2 })) }],
  },
];
const muscleStatus = getMuscleTrainingStatus({ goal: 'muscle', level: 'intermediate', split: 'adaptive' }, stimulusHistory, statusNow);
assert.equal(muscleStatus.back.cycleStimulus, 0, 'A fully recovered muscle must close its previous stimulus cycle');
assert.equal(muscleStatus.chest.cycleStimulus, 3, 'A recent primary stimulus must be visible in the current cycle');
assert.equal(muscleStatus.shoulders.cycleStimulus, 1.5, 'A new stimulus after a recovered gap must not revive secondary work from the previous cycle');
assert.equal(muscleStatus.back.cycleStartedAt, statusNow, 'A recovered muscle must expose the beginning of its new cycle');
assert.equal(muscleStatus.back.cycleComplete, true, 'The status must report that recovery closed the previous cycle');
assert(muscleStatus.back.doseStimulus > 0, 'Closing a fatigue cycle must retain decaying dose memory');
assert(muscleStatus.back.priority > muscleStatus.chest.priority, 'An older recovered and under-target muscle must outrank a recently trained muscle');
const expiredStatus = getMuscleTrainingStatus({ goal: 'muscle', level: 'intermediate', split: 'adaptive' }, [{ ...stimulusHistory[0], completedAt: statusNow - 8 * 864e5 }], statusNow);
assert.equal(expiredStatus.back.cycleStimulus, 0, 'Old work must leave the active cycle once the muscle is fully recovered');
assert.equal(expiredStatus.back.cycleStartedAt, statusNow, 'A completed recovery cycle must restart at the evaluation time');
const fadedHistory = [{ ...stimulusHistory[0], completedAt: statusNow - 8 * 864e5 }];
assert(getWeeklyMuscleLoad(fadedHistory, statusNow).volume.back > 0, 'Historical analytics may retain smoothly decayed work after the active recovery cycle closes');
assert(getWeeklyMovementFrequency(fadedHistory, statusNow).pull > 0, 'Movement recency must decay smoothly instead of crossing a seven-day cliff');

const completedQualityCycle = [{
  id: 'completed-quality-cycle',
  completedAt: statusNow - 8 * 864e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 7 }, () => ({ ...baseSet, reps: 8, rir: 2 })) }],
}];
assert.equal(
  getMuscleTrainingStatus({ goal: 'muscle', level: 'advanced', split: 'adaptive' }, completedQualityCycle, statusNow).chest.targetStimulus,
  8,
  'Completing one volume window alone must not auto-ratchet the next target without performance evidence',
);

const completedPoorCycle = structuredClone(completedQualityCycle);
completedPoorCycle[0].exercises[0].sets = Array.from({ length: 6 }, () => ({ ...baseSet, reps: 4, rir: 0 }));
assert.equal(
  getMuscleTrainingStatus({ goal: 'muscle', level: 'advanced', split: 'adaptive' }, completedPoorCycle, statusNow).chest.targetStimulus,
  8,
  'One poor window alone must not overreactively lower the next muscle target',
);

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
  Math.round((estimateOneRepMax(60, 20, 2) + estimateOneRepMax(60, 8, 2)) / 2),
  'Progression must use every completed set, applying target RIR when only the final set has an explicit value',
);

const preferences = Object.fromEntries(exercises.map((exercise) => [exercise.id, 'exclude']));
delete preferences[bench.id];
const profile = {
  goal: 'muscle',
  level: 'intermediate',
  equipment: ['barbell', 'bench', 'rack'],
  duration: 25,
  split: 'full',
  exerciseLanguage: 'en',
  loadInventory: { barbell: [60] },
  exerciseLoadInventory: {},
  preferences,
};
const stableCompound = exercises.find((exercise) => exercise.effortClass === 'stable-compound');
const isolation = exercises.find((exercise) => exercise.effortClass === 'isolation');
assert(stableCompound && isolation, 'The reviewed catalog must expose every effort class used by the style engine');
assert.equal(getExerciseEffortClass(bench), 'high-fatigue-compound', 'Bench Press must use the reviewed high-fatigue classification');
assert.deepEqual(getExercisePrescription({ ...profile, trainingStyle: 'intense' }, bench).targetRirs, [1, 0], 'The intense style must use two hard sets on high-fatigue compounds');
assert.equal(getExercisePrescription({ ...profile, trainingStyle: 'intense' }, bench).rest, 150, 'High-fatigue compounds must receive a practical rest interval in the intense style');
assert.deepEqual(getExercisePrescription({ ...profile, trainingStyle: 'intense' }, stableCompound).targetRirs, [1, 0], 'Stable compounds must retain the two-set intense prescription');
assert.equal(getExercisePrescription({ ...profile, trainingStyle: 'intense' }, stableCompound).rest, 120, 'Stable compounds may use less recovery than high-fatigue compounds');
assert.deepEqual(getExercisePrescription({ ...profile, trainingStyle: 'intense' }, isolation).targetRirs, [1, 1, 0], 'The intense style must reserve failure for the final accessory set');
assert.equal(getExercisePrescription({ ...profile, trainingStyle: 'intense' }, isolation).rest, 75, 'Hard isolation work must use a compact but usable recovery interval');
assert.deepEqual(getExercisePrescription({ ...profile, trainingStyle: 'balanced' }, bench).targetRirs, [2, 2, 1], 'The balanced style must distribute effort across three compound sets');
assert.deepEqual(getExercisePrescription({ ...profile, trainingStyle: 'volume' }, isolation).targetRirs, [2, 2, 1, 1], 'The volume style must keep four controlled isolation sets available');
assert.deepEqual(getExercisePrescription({ ...profile, goal: 'strength', trainingStyle: 'intense' }, bench).targetRirs, [2, 1], 'Strength training must keep high-fatigue compounds one RIR farther from failure');
assert.equal(getExercisePrescription({ ...profile, goal: 'strength', trainingStyle: 'intense' }, bench).rest, 180, 'Strength training must extend high-fatigue compound recovery');
assert.equal(Object.keys(trainingStyles).length, 3, 'The UI and engine must share exactly the three supported training styles');

const timedTwoSetBench = {
  rest: 150,
  sets: [
    { targetReps: 8, targetRir: 1 },
    { targetReps: 8, targetRir: 0 },
  ],
};
const timedThreeSetBench = {
  rest: 150,
  sets: [
    { targetReps: 8, targetRir: 2 },
    { targetReps: 8, targetRir: 2 },
    { targetReps: 8, targetRir: 1 },
  ],
};
assert(estimatePrescriptionMinutes(bench, timedThreeSetBench) > estimatePrescriptionMinutes(bench, timedTwoSetBench), 'Adding a work set and its recovery must increase the workout estimate');
assert(estimatePrescriptionMinutes(bench, timedTwoSetBench) > estimatePrescriptionMinutes(isolation, timedTwoSetBench), 'A high-fatigue compound must budget more setup and execution time than an isolation exercise with the same sets');
const activeLegacyBench = {
  id: 'legacy-bench', startedAt: Date.now() - 1000,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, done: true }] }],
};
assert.equal(isCompatibleWorkout(activeLegacyBench, { ...profile, equipment: ['barbell', 'bench'] }), true, 'An active known workout must survive stricter equipment rules introduced by an engine update');
assert.equal(isCompatibleWorkout({ ...activeLegacyBench, startedAt: null, exercises: [{ ...activeLegacyBench.exercises[0], sets: [{ ...baseSet, done: false }] }] }, { ...profile, equipment: ['barbell', 'bench'] }), false, 'An unopened incompatible workout may be regenerated safely');
assert.equal(isCompatibleWorkout({ ...activeLegacyBench, completedAt: Date.now() }), false, 'A completed workout must never be accepted as the current session');
assert.equal(isCompatibleWorkout({ ...activeLegacyBench, exercises: [{ exerciseId: bench.id, sets: [null] }] }, profile), false, 'A malformed current set must be rejected before it can crash the workout view');
const removedCatalogExercise = { id: 'removed-catalog-id', startedAt: Date.now() - 1000, exercises: [{ exerciseId: 'removed-id', sets: [{ ...baseSet, done: false }] }] };
assert.equal(isCompatibleWorkout(removedCatalogExercise, profile), true, 'An active workout must survive even if a catalog revision removed its exercise');
assert.equal(getWorkoutExercise(removedCatalogExercise.exercises[0]).legacy, true, 'A removed exercise must have a safe legacy display fallback');

const backupState = {
  profile: { ...profile, cloud: { webDavUrl: 'https://cloud.example.test/remote.php/dav/files/user/Easyfit', webDavUsername: 'user', webDavPassword: 'app-password', autoSync: true } },
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
const timedBackup = parseBackup(serializeBackup({
  profile,
  history: [{ ...hardHistory[0], sessionDurationSeconds: 1842, pausedDurationMs: 12_000 }],
  workout: null,
}));
assert.equal(timedBackup.history[0].sessionDurationSeconds, 1842, 'Backup round-trip must preserve measured session duration');
assert.equal(timedBackup.history[0].pausedDurationMs, 12_000, 'Backup round-trip must preserve excluded pause time');
const completedCurrentBackup = parseBackup(serializeBackup({
  ...backupState,
  workout: { ...hardHistory[0], id: 'completed-current', startedAt: hardHistory[0].completedAt - 1000 },
}));
assert.equal(completedCurrentBackup.workout, null, 'A completed current workout must be archived instead of being restored as active');
assert(completedCurrentBackup.history.some((item) => item.id === 'completed-current'), 'A completed current workout must not be lost while being archived');
assert(!serializedBackup.includes('app-password'), 'Serialized backups must never invent or include a cloud password');
assert.throws(() => parseBackup('{broken'), /JSON valido/, 'Malformed JSON must be rejected');
assert.throws(() => parseBackup(JSON.stringify({ format: 'another-app', schemaVersion: 1 })), /backup Easyfit/, 'Foreign backup formats must be rejected');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 99, payload: {} })), /versione più recente/, 'Future schemas must not be imported silently');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: {}, history: [42], workout: null } })), /workout non validi/, 'Malformed history records must be rejected');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: {}, history: [{ completedAt: 1, exercises: [{ exerciseId: 'bad', sets: [{ done: true, reps: 10000 }] }] }], workout: null } })), /workout non validi/, 'Out-of-range set values must be rejected before entering the engine');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: {}, history: [], workout: { exercises: [] } } })), /workout in corso non è valido/, 'An empty active workout must never be restorable');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: { duration: -999 }, history: [], workout: null } })), /25 e 75/, 'An imported profile must reject settings that could poison generation');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: { equipment: ['teleporter'] }, history: [], workout: null } })), /attrezzatura/, 'Unknown equipment identifiers must not enter generation through an imported backup');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: { exerciseLanguage: 'de' }, history: [], workout: null } })), /lingua/, 'Unsupported exercise languages must be rejected during import');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: [], history: [], workout: null } })), /profilo valido/, 'An array must never pass profile object validation');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: { trainingStyle: 'reckless' }, history: [], workout: null } })), /stile di allenamento/, 'Unknown training styles must never enter the engine through backup import');
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: {}, history: [{ id: 'bad-time', completedAt: -1, exercises: [{ exerciseId: bench.id, sets: [{ done: true, reps: 8 }] }] }], workout: null } })), /workout non validi/, 'Nonpositive workout timestamps must be rejected during import');
const normalizedProfileBackup = parseBackup(JSON.stringify({
  format: 'easyfit-backup',
  schemaVersion: 1,
  payload: {
    profile: { duration: '45', targetRir: '2', equipment: ['bodyweight', 'bodyweight'], setCaps: { compound: '3' }, loadInventory: { dumbbells: ['7.5'] }, exerciseLanguage: 'en' },
    history: [{ id: 'legacy-numeric-strings', completedAt: '1000', exercises: [{ exerciseId: bench.id, sets: [{ done: true, reps: '8', weight: '60', rir: '2', targetReps: '8' }] }] }],
    workout: null,
  },
}));
assert.equal(normalizedProfileBackup.profile.duration, 45, 'Legacy numeric profile values must be normalized once during import');
assert.equal(normalizedProfileBackup.profile.targetRir, 2, 'Imported target RIR must have one stable numeric representation');
assert.deepEqual(normalizedProfileBackup.profile.equipment, ['bodyweight'], 'Imported equipment must be normalized without duplicate identifiers');
assert.equal(normalizedProfileBackup.profile.setCaps.compound, 3, 'Imported set caps must be normalized to numbers');
assert.deepEqual(normalizedProfileBackup.profile.loadInventory.dumbbells, [7.5], 'Imported load inventories must contain numbers rather than numeric strings');
assert.equal(normalizedProfileBackup.history[0].completedAt, 1000, 'Imported workout timestamps must be normalized to numbers');
assert.deepEqual(
  { reps: normalizedProfileBackup.history[0].exercises[0].sets[0].reps, weight: normalizedProfileBackup.history[0].exercises[0].sets[0].weight, rir: normalizedProfileBackup.history[0].exercises[0].sets[0].rir },
  { reps: 8, weight: 60, rir: 2 },
  'Imported set performance must be normalized before it reaches history and progression',
);
const duplicatedHistoryBackup = parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile, history: [hardHistory[0], hardHistory[0]], workout: null } }));
assert.equal(duplicatedHistoryBackup.history.length, 1, 'Exact duplicate workouts must be removed during backup import instead of doubling training dose');
const conflictingDuplicate = structuredClone(hardHistory[0]);
conflictingDuplicate.exercises[0].sets[0].reps = 7;
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile, history: [hardHistory[0], conflictingDuplicate], workout: null } })), /stesso identificatore/, 'Different workouts sharing an ID must be rejected instead of silently losing one record');
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
await assert.rejects(() => downloadWebDavBackup({
  folderUrl: 'https://cloud.example.test/remote.php/dav/files/user/Easyfit',
  fetcher: async () => ({ ok: true, status: 200, headers: { get: () => String(MAX_BACKUP_BYTES + 1) }, text: async () => '' }),
}), /troppo grande/, 'A cloud backup must be size-limited before it is loaded into memory');

assert.equal(parseBackup(serializedBackup).profile.cloud.autoSync, undefined, 'Backups must not retain the retired automatic-sync setting');

assert.deepEqual(getWeeklyTargets(profile), { sets: 8, frequency: 2 }, 'Adaptive hypertrophy must start from a moderate dose and aim for two exposures');
assert.equal(getWeeklyTargets({ ...profile, level: 'beginner' }).sets, 8, 'A declared level alone must not arbitrarily change muscle volume');
assert.equal(getWeeklyTargets({ ...profile, level: 'advanced' }).sets, 8, 'Advanced users must earn added volume from completed data instead of receiving 12 sets by default');
const constrainedCadenceNow = Date.now();
const constrainedCadenceHistory = Array.from({ length: 6 }, (_, index) => ({
  id: `constrained-cadence-${index}`,
  completedAt: constrainedCadenceNow - (18 - index * 3) * 864e5,
  exercises: [{
    exerciseId: index % 2 === 0 ? squat.id : bench.id,
    sets: Array.from({ length: 3 }, () => ({ ...baseSet, reps: 8, rir: 2 })),
  }],
}));
const constrainedCadenceStatus = getMuscleTrainingStatus({ ...profile, preferences: {} }, constrainedCadenceHistory, constrainedCadenceNow);
assert.equal(constrainedCadenceStatus.quads.desiredStimulusTarget, 8, 'Cadence constraints must not rewrite the adaptive physiological target');
assert(constrainedCadenceStatus.quads.targetStimulus < constrainedCadenceStatus.quads.desiredStimulusTarget, 'A one-lower limit must expose a reachable operational target at a sparse observed cadence');
assert.equal(constrainedCadenceStatus.quads.targetStimulus, 2.5, 'A 25-minute workout must use the actual two-set lower-body capacity in its operational target');
assert.equal(constrainedCadenceStatus.quads.capacityAdjusted, true, 'Capacity-adjusted targets must be explicit rather than silently changing the displayed dose');
assert.equal(constrainedCadenceStatus.chest.targetStimulus, 2.5, 'Operational capacity must also cover upper-body muscles when cadence and session duration make the desired dose unreachable');
assert.equal(constrainedCadenceStatus.chest.capacityAdjusted, true, 'Capacity adjustment must apply consistently instead of being a lower-body-only exception');
const reviewedEquipment = [...new Set(exercises.flatMap((exercise) => exercise.equipment))];
const oneSetLowerOverrides = Object.fromEntries(exercises
  .filter((exercise) => isLowerBodyExercise(exercise) && getExerciseMuscleContributions(exercise).quads > 0)
  .map((exercise) => [exercise.id, { maxSets: 1 }]));
const overriddenCadenceStatus = getMuscleTrainingStatus({
  ...profile,
  duration: 45,
  equipment: reviewedEquipment,
  preferences: {},
  exerciseOverrides: oneSetLowerOverrides,
}, constrainedCadenceHistory, constrainedCadenceNow);
assert.equal(overriddenCadenceStatus.quads.targetStimulus, 1, 'The operational target must respect per-exercise set overrides instead of assuming three lower sets');
const beginnerCadenceStatus = getMuscleTrainingStatus({
  ...profile,
  level: 'beginner',
  duration: 45,
  equipment: reviewedEquipment,
  preferences: {},
}, constrainedCadenceHistory, constrainedCadenceNow);
assert.equal(beginnerCadenceStatus.quads.targetStimulus, 2.5, 'Beginner operational targets must use the same two-set safety ceiling as generation');
const decayedDoseNow = Date.now();
const decayedDoseHistory = [{
  id: 'decayed-dose',
  completedAt: decayedDoseNow - 7 * 864e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 12 }, () => ({ ...baseSet, reps: 8, rir: 2 })) }],
}];
const decayedDoseWorkout = generateWorkout(profile, decayedDoseHistory, { targets: ['chest'], duration: 25, now: decayedDoseNow });
assert.equal(decayedDoseWorkout.engine.cycleStimulusBeforeWorkout.chest, 0, 'Complete recovery may close the short fatigue cycle');
assert(decayedDoseWorkout.engine.doseStimulusBeforeWorkout.chest > 0, 'Closing fatigue must not erase the decaying training dose');
assert.equal(decayedDoseWorkout.exercises[0].sets.length, 2, 'Set prescription must fill the decayed dose gap instead of treating a recovered muscle as completely untrained');
const recalibrated = generateWorkout(profile, hardHistory, { targets: ['chest'], duration: 25 });
assert.equal(recalibrated.exercises[0].exerciseId, bench.id);
assert.equal(recalibrated.exercises[0].sets[0].weight, 60, 'One exceptional set must not raise load when every work set has not reached the top');
assert.equal(recalibrated.exercises[0].sets[0].reps, 9, 'Whole-session performance may still advance the repetition target conservatively');

const focusProfile = {
  ...profile,
  equipment: ['bodyweight', 'dumbbells', 'bench'],
  preferences: {},
  focusEnabled: true,
  focusExerciseIds: [],
};

assert(!catalogExercises.some((exercise) => /snatch|clean|jerk|thruster|burpee|glute bridge single-arm press/i.test(exercise.name)), 'Hybrid and powerlifting movements must not ship in the runtime catalog');
assert.deepEqual(
  [...new Set(exercises.filter((exercise) => exercise.pattern === 'chest-isolation').flatMap((exercise) => exercise.equipment))].sort(),
  ['bench', 'cables', 'dumbbells', 'machines'],
  'The reviewed catalog must provide canonical chest isolation for the supported loaded setups',
);

const bodyweightPush = exercises.find((exercise) => exercise.loadType === 'bodyweight' && exercise.primary === 'chest' && exercise.pattern === 'horizontal-push');
assert(bodyweightPush, 'A bodyweight horizontal push must exist');
const loadedAlternativeProfile = {
  ...focusProfile,
  equipment: ['bodyweight', 'barbell', 'bench', 'rack'],
  loadInventory: { ...(focusProfile.loadInventory || {}), barbell: [20, 40, 60] },
  exerciseFilters: { preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
};
assert.equal(isExerciseAllowed(bench, { ...profile, equipment: ['barbell', 'bench'] }), false, 'Bench press must require actual rack supports, not only a loose bar and bench');
assert.equal(isExerciseAllowed(bodyweightPush, loadedAlternativeProfile), false, 'A bodyweight movement must be removable when a loaded equivalent is available');
assert.equal(isExerciseAllowed(bodyweightPush, { ...loadedAlternativeProfile, loadInventory: { barbell: [] } }), false, 'Compatible loaded equipment must suppress the duplicate bodyweight variant even before its first load calibration');
assert.equal(getEquipmentCoverage({ ...focusProfile, equipment: ['bodyweight'], exerciseFilters: { preferLoadedVariants: false } }).pull, false, 'Onboarding coverage must detect a bodyweight setup with no pulling movement');
const bodyweightCoverage = getEquipmentCoverage({ ...focusProfile, equipment: ['bodyweight'], exerciseFilters: { preferLoadedVariants: false } });
assert.equal(bodyweightCoverage.hip, true, 'A bodyweight-only setup must retain a real hip-extension option');
const gluteBridge = exercises.find((exercise) => exercise.wgerId === 265);
const boxSquat = exercises.find((exercise) => exercise.wgerId === 977);
const abWheel = exercises.find((exercise) => exercise.wgerId === 1573);
const bulgarianSquat = exercises.find((exercise) => exercise.wgerId === 1706);
const barbellShoulderPress = exercises.find((exercise) => exercise.wgerId === 566);
assert(gluteBridge && isExerciseAllowed(gluteBridge, { ...focusProfile, equipment: ['bodyweight'] }), 'Glute Bridge must be a reviewed bodyweight hip-extension exercise');
assert.equal(isExerciseAllowed(boxSquat, { ...focusProfile, equipment: ['bodyweight'] }), false, 'Box Squat must not be prescribed without an actual box or bench');
assert.equal(isExerciseAllowed(abWheel, { ...focusProfile, equipment: ['bodyweight'] }), false, 'Ab Wheel must not be prescribed unless the wheel is declared');
assert.equal(isExerciseAllowed(abWheel, { ...focusProfile, equipment: ['bodyweight', 'abwheel'] }), true, 'Declaring an ab wheel must enable the corresponding exercise');
assert.equal(bulgarianSquat.pattern, 'single-leg', 'Bulgarian Squat must be classified as a unilateral movement');
assert(bulgarianSquat.equipment.includes('bench'), 'Bulgarian Squat must require the support used by its execution');
assert.equal(isExerciseAllowed(barbellShoulderPress, { ...focusProfile, equipment: ['barbell'] }), false, 'Barbell Shoulder Press must not be prescribed without rack supports');
const gluteGuide = await getExerciseDetails(gluteBridge.wgerId, 'en');
assert.equal(gluteGuide.image, '/exercise-images/265.webp', 'The bodyweight Glute Bridge guide image must be bundled locally');
assert.equal(isExerciseAllowed(bodyweightPush, { ...loadedAlternativeProfile, exerciseFilters: { ...loadedAlternativeProfile.exerciseFilters, preferLoadedVariants: false } }), true, 'The user must be able to keep bodyweight alternatives');
assert.equal(row.equipment.includes('bench'), false, 'Unsupported Bent Over Dumbbell Rows must not require a bench absent from its reviewed execution');
assert.equal(getEquipmentCoverage({ ...focusProfile, equipment: ['dumbbells'], loadInventory: { dumbbells: [10] }, exerciseFilters: { essentialCatalog: true, preferLoadedVariants: false } }).pull, true, 'Dumbbells alone must provide the reviewed unsupported row and structural pulling coverage');

const allEquipment = [...new Set(exercises.flatMap((exercise) => exercise.equipment))];
assert(Object.values(getEquipmentCoverage({ ...focusProfile, equipment: allEquipment, exerciseFilters: { preferLoadedVariants: false } })).every(Boolean), 'A complete equipment setup must cover every structural movement family');
const styleGenerationBase = {
  ...focusProfile,
  equipment: allEquipment,
  duration: 45,
  exerciseFilters: { essentialCatalog: true, preferLoadedVariants: false, excludeDirectCore: false, excludeCalves: false },
};
const intenseGenerated = generateWorkout({ ...styleGenerationBase, trainingStyle: 'intense' }, [], { now: 1700000100000, variation: 73 });
const balancedGenerated = generateWorkout({ ...styleGenerationBase, trainingStyle: 'balanced' }, [], { now: 1700000100000, variation: 73 });
const volumeGenerated = generateWorkout({ ...styleGenerationBase, trainingStyle: 'volume' }, [], { now: 1700000100000, variation: 73 });
assert(intenseGenerated.exercises.every((item) => {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
  return item.sets.length <= (exercise.compound ? 2 : 3);
}), 'The intense style must use at most two compound sets and three accessory sets');
assert(intenseGenerated.exercises.filter((item) => !exercises.find((candidate) => candidate.id === item.exerciseId).compound)
  .every((item) => item.sets.length === 3), 'Every prescribed intense accessory must retain all three work sets after time fitting');
assert(intenseGenerated.exercises.every((item) => item.sets.map((set) => set.targetRir).at(-1) <= 1), 'Every intense prescription must finish close to the selected effort limit');
assert(balancedGenerated.exercises.some((item) => item.sets.length === 3), 'A regular balanced workout must retain a three-set prescription where the dose requires it');
assert(volumeGenerated.exercises.every((item) => item.sets.length <= getExercisePrescription({ ...styleGenerationBase, trainingStyle: 'volume' }, exercises.find((exercise) => exercise.id === item.exerciseId)).maxSets), 'Generated volume prescriptions must respect their exercise-class set ceiling');
for (const generated of [intenseGenerated, balancedGenerated, volumeGenerated]) {
  const recalculatedMinutes = 7 + generated.exercises.reduce((sum, item) => {
    const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
    return sum + estimatePrescriptionMinutes(exercise, item);
  }, 0);
  assert.equal(generated.engine.estimatedMinutes, Math.round(recalculatedMinutes), 'Displayed workout time must be derived from the actual prescribed sets and recovery intervals');
  assert(generated.engine.estimatedMinutes <= generated.duration + 5, 'Every style must remain inside the explicit five-minute scheduling tolerance');
}
const essentialMachinePresses = exercises.filter((exercise) => ['Chest Press', 'Hammerstrength Decline Chest Press'].includes(exercise.name) && isEssentialExercise(exercise, { ...focusProfile, equipment: allEquipment, exerciseFilters: { essentialCatalog: true, preferLoadedVariants: false } }));
assert.equal(essentialMachinePresses.length, 1, 'The essential catalog must collapse reviewed variants even when Wger omits variation_group');
const essentialCablePulldowns = exercises.filter((exercise) => ['Close-grip supinated lat pulldown', 'Neutral-grip chest pulldown'].includes(exercise.name) && isEssentialExercise(exercise, { ...focusProfile, equipment: allEquipment, exerciseFilters: { essentialCatalog: true, preferLoadedVariants: false } }));
assert.equal(essentialCablePulldowns.length, 1, 'Null Wger variation groups must not leak near-identical pulldowns into standard generation');
const essentialPullups = exercises.filter((exercise) => ['Chin Up', 'Pull-ups'].includes(exercise.name) && isEssentialExercise(exercise, { ...focusProfile, equipment: allEquipment, exerciseFilters: { essentialCatalog: true, preferLoadedVariants: false } }));
assert.equal(essentialPullups.length, 1, 'The essential catalog must collapse structurally identical pull-up grips regardless of inconsistent Wger variation groups');
const directCore = exercises.find((exercise) => exercise.primary === 'core' && exercise.equipment.every((item) => allEquipment.includes(item)));
const directCalves = exercises.find((exercise) => exercise.primary === 'calves' && exercise.equipment.every((item) => allEquipment.includes(item)));
const directFilterProfile = { ...focusProfile, equipment: allEquipment, exerciseFilters: { preferLoadedVariants: false, excludeDirectCore: true, excludeCalves: true } };
assert.equal(isExerciseAllowed(directCore, directFilterProfile), false, 'Direct abdominal exercises must support a global exclusion');
assert.equal(isExerciseAllowed(directCalves, directFilterProfile), false, 'Direct calf exercises must support a global exclusion');
const filteredMuscleStatus = getMuscleTrainingStatus(directFilterProfile, [], statusNow);
assert.equal(filteredMuscleStatus.core.priority, 0, 'An excluded direct muscle group must not appear as a training priority');
assert.equal(filteredMuscleStatus.calves.priority, 0, 'Excluded calves must not appear as a training priority');

const pullDaySeed = {
  id: 'previous-push-day', completedAt: Date.now() - 2 * 864e5,
  exercises: [{ exerciseId: bodyweightPush.id, sets: [{ targetReps: 8, reps: 8, targetRir: 2, rir: 2, done: true }] }],
};
const legacySplitValue = generateWorkout({ ...focusProfile, split: 'ppl', equipment: ['bodyweight'], exerciseFilters: { preferLoadedVariants: false } }, [pullDaySeed], { duration: 30, now: 1700000000000, variation: 9 });
const canonicalAdaptiveValue = generateWorkout({ ...focusProfile, split: 'adaptive', equipment: ['bodyweight'], exerciseFilters: { preferLoadedVariants: false } }, [pullDaySeed], { duration: 30, now: 1700000000000, variation: 9 });
assert.deepEqual(legacySplitValue.exercises, canonicalAdaptiveValue.exercises, 'Legacy split values must not alter the exclusively adaptive engine');

const hinge = exercises.find((exercise) => getMovementFamily(exercise) === 'hip' && exercise.compound);
assert(hinge, 'A compound hip movement must exist for recovery gating checks');
const exhaustedLowerHistory = [{
  id: 'exhausted-lower', completedAt: Date.now() - 36e5,
  exercises: [squat, hinge].map((exercise) => ({
    exerciseId: exercise.id,
    sets: Array.from({ length: 12 }, () => ({ targetReps: 8, reps: 8, targetRir: 2, rir: 0, weight: 50, done: true })),
  })),
}];
const recoveryGatedWorkout = generateWorkout({ ...focusProfile, split: 'adaptive', equipment: allEquipment, duration: 45 }, exhaustedLowerHistory, { duration: 45, variation: 818 });
assert(!recoveryGatedWorkout.exercises.some((item) => isLowerBodyExercise(exercises.find((exercise) => exercise.id === item.exerciseId))), 'Adaptive generation must not force a lower-body family below the readiness threshold');

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
  ['knee', 'pull'],
  'A short first workout must choose the globally highest-ranked compatible families',
);
assert(adaptiveWorkout.exercises.every((item) => item.sets.length === 2), 'Short sessions must spread volume instead of overloading one exercise');
assert(adaptiveWorkout.exercises.length <= 3, 'A 25–30 minute workout must contain at most three exercises');
assert.deepEqual(adaptiveWorkout.engine.composition, { compounds: 2, accessories: 1, lowerBody: 1, ...getWorkoutCompositionLimits(25) }, 'A short workout must balance two compounds with one accessory and only one leg exercise');
assert.equal(adaptiveWorkout.engine.version, ENGINE_VERSION, 'The workout must preserve the programming model version');
assert.deepEqual(adaptiveWorkout.engine.movementFamilies, ['knee', 'pull'], 'The workout must expose the selected adaptive families');
const sparseEquipmentWorkout = generateWorkout({ ...focusProfile, equipment: ['barbell', 'bench'], split: 'adaptive', duration: 30 }, [], { variation: 410 });
assert(sparseEquipmentWorkout.exercises.length > 0, 'Adaptive ranking must fall back to a family compatible with sparse equipment');
assert(sparseEquipmentWorkout.exercises.every((item) => isExerciseAllowed(exercises.find((exercise) => exercise.id === item.exerciseId), { ...focusProfile, equipment: ['barbell', 'bench'] })), 'Sparse-equipment fallback must remain executable');
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
assert.equal(adaptiveWithTwoLegacyDays.engine.movementFamilies.length, 2, 'A regular adaptive workout must select one upper and one lower family');
assert(adaptiveWithTwoLegacyDays.exercises.length <= 6, 'A first 45-minute workout must remain capped at six exercises');
assert(adaptiveWithTwoLegacyDays.engine.composition.compounds <= 2, 'A 45-minute workout must contain at most two compound exercises');
assert(adaptiveWithTwoLegacyDays.engine.estimatedMinutes <= 50, 'A 45-minute workout must respect the five-minute scheduling tolerance');
assert.deepEqual(getWeeklyTargets({ ...profile, split: 'ppl' }), getWeeklyTargets(profile), 'Retired split values must not alter adaptive dose targets');

const upperBodyFatigue = [{
  id: 'upper-body-fatigue',
  completedAt: Date.now() - 36e5,
  exercises: [bench, row].map((exercise) => ({
    exerciseId: exercise.id,
    sets: Array.from({ length: 6 }, () => ({ ...baseSet, reps: 10, rir: 0 })),
  })),
}];
const lowerPriorityWorkout = generateWorkout({
  ...focusProfile,
  split: 'adaptive',
  focusEnabled: false,
  duration: 60,
}, upperBodyFatigue, { variation: 46 });
assert(
  !(lowerPriorityWorkout.engine.movementFamilies.includes('knee') && lowerPriorityWorkout.engine.movementFamilies.includes('hip')),
  'An adaptive workout must rotate knee- and hip-dominant training instead of stacking both heavy lower-body families',
);
const shortLowerPriorityWorkout = generateWorkout({
  ...focusProfile,
  split: 'adaptive',
  focusEnabled: false,
  duration: 25,
}, upperBodyFatigue, { variation: 47 });
assert(shortLowerPriorityWorkout.exercises.length <= 3, 'The forced lower-priority workout must remain short');
assert.equal(
  shortLowerPriorityWorkout.exercises
    .map((item) => exercises.find((exercise) => exercise.id === item.exerciseId))
    .filter(isLowerBodyExercise).length,
  1,
  'A three-exercise adaptive workout with lower-body priority must contain exactly one leg exercise',
);

const legExtension = exercises.find((exercise) => exercise.pattern === 'knee-extension' && exercise.primary === 'quads');
assert(legExtension, 'A direct quadriceps exercise must exist for adaptive muscle-priority checks');
const saturatedQuadsHistory = [{
  id: 'saturated-quads',
  completedAt: Date.now() - 36e5,
  exercises: [{
    exerciseId: legExtension.id,
    sets: Array.from({ length: 8 }, () => ({ ...baseSet, reps: 10, rir: 0 })),
  }],
}];
const gluteOpportunityWorkout = generateWorkout({
  ...focusProfile,
  equipment: [...new Set([...focusProfile.equipment, 'machines'])],
  split: 'adaptive',
  focusEnabled: false,
  duration: 25,
}, saturatedQuadsHistory, { variation: 48 });
assert(gluteOpportunityWorkout.engine.movementFamilies.includes('hip'), 'Fresh glutes and hamstrings must be eligible when quadriceps are already saturated');
assert(!gluteOpportunityWorkout.engine.movementFamilies.includes('knee'), 'Large-muscle preference must not keep selecting quadriceps after their need has been covered');

const settingsFingerprint = getWorkoutSettingsFingerprint(focusProfile);
assert.equal(getWorkoutSettingsFingerprint({ ...focusProfile, exerciseLanguage: 'it', cloud: { webDavUrl: 'https://example.test' } }), settingsFingerprint, 'Language and cloud settings must not invalidate an existing workout');
assert.notEqual(getWorkoutSettingsFingerprint({ ...focusProfile, targetRir: 1 }), settingsFingerprint, 'A training setting such as target RIR must invalidate an existing workout');
assert.notEqual(getWorkoutSettingsFingerprint({ ...focusProfile, exerciseFilters: { excludeDirectCore: true } }), settingsFingerprint, 'Exercise filters must invalidate an existing workout');
const preparedAt = Date.now() - 2 * 36e5;
const freshPrepared = generateWorkout(focusProfile, [], { now: preparedAt, variation: 1 });
assert.equal(isPreparedWorkoutStale(freshPrepared, focusProfile, [], preparedAt + 1000), false, 'A newly prepared workout must remain reusable');
assert.equal(isPreparedWorkoutStale(freshPrepared, { ...focusProfile, targetRir: 1 }, [], preparedAt + 1000), true, 'Changed training settings must stale a prepared workout');
assert.equal(isPreparedWorkoutStale(freshPrepared, focusProfile, [{ ...hardHistory[0], completedAt: preparedAt + 1000 }], preparedAt + 2000), true, 'New completed training data must stale an older prepared workout');
assert.equal(isPreparedWorkoutStale({ ...freshPrepared, startedAt: preparedAt + 500 }, { ...focusProfile, targetRir: 1 }, [], preparedAt + 1000), false, 'An opened workout must never be regenerated underneath the user');

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

const overPerformedHistory = [{
  id: 'over-performed-reps',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 3 }, () => ({
    ...baseSet, targetReps: 8, reps: 10, targetRir: 2, rir: 2,
  })) }],
}];
const overPerformedProgress = generateWorkout(profile, overPerformedHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(overPerformedProgress.sets[0].weight, 60, 'Exceeding prescribed reps must retain the load actually performed');
assert.equal(overPerformedProgress.sets[0].reps, 10, 'The next prescription must anchor to demonstrated reps instead of adding one to the stale old target');
assert.equal(overPerformedProgress.progressionStep, 'performance-reps', 'A multi-rep calibration must not display a false +1 rep badge');

const slightlyUnderPerformedHistory = [{
  id: 'slightly-under-performed-reps',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 3 }, () => ({
    ...baseSet, targetReps: 10, reps: 9, targetRir: 2, rir: 2,
  })) }],
}];
const slightlyUnderProgress = generateWorkout({ ...profile, loadInventory: { barbell: [50, 60] } }, slightlyUnderPerformedHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(slightlyUnderProgress.sets[0].weight, 60, 'Missing one repetition must not cause an unnecessary load drop');
assert.equal(slightlyUnderProgress.sets[0].reps, 9, 'A small shortfall must be reflected directly in the next repetition target');
assert.equal(slightlyUnderProgress.progressionStep, 'regress-reps');

const doseWorkout = (id, reps) => ({
  id,
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, targetReps: 10, reps, targetRir: 2, rir: 2 }] }],
});
const underDose = getWeeklyMuscleLoad([doseWorkout('under-dose', 5)]).volume.chest;
const exactDose = getWeeklyMuscleLoad([doseWorkout('exact-dose', 10)]).volume.chest;
const overDose = getWeeklyMuscleLoad([doseWorkout('over-dose', 12)]).volume.chest;
assert(underDose < exactDose && exactDose < overDose, 'Adaptive volume must use actual repetitions above and below the prescription');

const loadProgressHistory = [{
  id: 'load-progress',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, targetReps: 12, reps: 12, rir: 2 }] }],
}];
const loadProgress = generateWorkout(profile, loadProgressHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(loadProgress.sets[0].weight, 60, 'The engine must not invent a heavier load when the available inventory is empty');
assert.equal(loadProgress.sets[0].reps, 12, 'Without a real higher load, the prescription must remain at the top of the range');
assert.equal(loadProgress.progressionStep, 'top');
const exactLoadHistory = structuredClone(loadProgressHistory);
exactLoadHistory[0].exercises[0].sets[0].weight = 61.2;
const exactLoadProgress = generateWorkout({ ...profile, loadInventory: { barbell: [] } }, exactLoadHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(exactLoadProgress.sets[0].weight, null, 'Clearing an inventory must request recalibration instead of resurrecting a removed load');
assert.equal(exactLoadProgress.needsInitialLoad, true, 'An exercise without any declared available load must visibly request a new load');
const inventoriedProfile = { ...profile, loadInventory: { barbell: [60, 61, 62.5] } };
assert.deepEqual(getAvailableLoads(bench, inventoriedProfile), [60, 61, 62.5], 'The engine must read the user’s actual available barbell loads');
const inventoriedProgress = generateWorkout(inventoriedProfile, loadProgressHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(inventoriedProgress.sets[0].weight, 61, 'Load progression must choose the smallest real available weight instead of a fixed increment');
const dumbbellCurl = exercises.find((exercise) => exercise.name === 'Biceps Curls With Dumbbell');
const manualCurlProfile = {
  ...profile,
  trainingStyle: 'intense',
  equipment: ['dumbbells'],
  loadInventory: { dumbbells: [17] },
  preferences: Object.fromEntries(exercises.map((exercise) => [exercise.id, exercise.id === dumbbellCurl.id ? 'normal' : 'exclude'])),
  exerciseOverrides: { [dumbbellCurl.id]: { minReps: 8, maxReps: 12 } },
};
const manualCurlHistory = [{
  id: 'manual-curl-load',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: dumbbellCurl.id, sets: Array.from({ length: 3 }, (_, index) => ({
    done: true, weight: 17, targetWeight: 15, targetReps: 8, reps: 10,
    targetRir: [1, 1, 0][index], rir: [1, 1, 0][index],
  })) }],
}];
const manualCurlProgress = generateWorkout(manualCurlProfile, manualCurlHistory, { targets: ['biceps'], duration: 30 }).exercises[0];
assert.equal(manualCurlProgress.sets[0].weight, 17, 'A manually performed and inventoried dumbbell load must override the older target weight');
assert.equal(manualCurlProgress.sets[0].reps, 10, 'Manual reps at the overridden load must calibrate the next prescription from actual performance');
assert.deepEqual(manualCurlProgress.targetRirs, [1, 1, 0], 'Intense accessories must use failure only on their final set');
const failureStyleHistory = [{
  id: 'failure-style-history',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [
    { ...baseSet, weight: 60, targetWeight: 60, targetReps: 8, reps: 8, targetRir: 0, rir: 0 },
    { ...baseSet, weight: 60, targetWeight: 60, targetReps: 8, reps: 8, targetRir: 0, rir: 0 },
  ] }],
}];
const easierStyleProfile = {
  ...profile,
  trainingStyle: 'volume',
  loadInventory: { barbell: [50, 60] },
};
const recalibratedStyleWorkout = generateWorkout(easierStyleProfile, failureStyleHistory, { targets: ['chest'], duration: 45 }).exercises[0];
assert.equal(recalibratedStyleWorkout.sets[0].weight, 50, 'Moving from failure work to a higher-RIR style must choose a real lower load when the demonstrated capacity no longer supports the rep range');
assert.equal(recalibratedStyleWorkout.progressionStep, 'effort-adjustment', 'A style switch must be recorded as effort recalibration, not ordinary progression');
assert.deepEqual(recalibratedStyleWorkout.targetRirs, [3, 3, 2], 'The recalibrated workout must retain the complete new per-set RIR sequence');
const unavailableStyleLoad = generateWorkout({ ...easierStyleProfile, loadInventory: { barbell: [60] } }, failureStyleHistory, { targets: ['chest'], duration: 45 }).exercises[0];
assert.equal(unavailableStyleLoad.needsInitialLoad, true, 'If no safe lower load exists after an effort-style change, the app must request recalibration instead of inventing a weight');
assert.equal(unavailableStyleLoad.progressionStep, 'recalibrate-load');
const chestPress = exercises.find((exercise) => exercise.name === 'Chest Press');
const legPress = exercises.find((exercise) => exercise.name === 'Leg Press');
const machineInventoryProfile = {
  ...profile,
  equipment: ['machines'],
  loadInventory: { machines: [999] },
  exerciseLoadInventory: { [chestPress.id]: [20, 25], [legPress.id]: [80, 90] },
};
assert.deepEqual(getAvailableLoads(chestPress, machineInventoryProfile), [20, 25], 'Machine stacks must be remembered per exercise');
assert.deepEqual(getAvailableLoads(legPress, machineInventoryProfile), [80, 90], 'Different machines must never share a fictitious global stack');
assert.deepEqual(getAvailableLoads(chestPress, { ...machineInventoryProfile, exerciseLoadInventory: {} }), [], 'A retired global machine inventory must not resurrect removed exercise loads');

const unevenProgressHistory = [{
  id: 'uneven-progress',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [
    { ...baseSet, targetReps: 12, reps: 5, rir: 2 },
    { ...baseSet, targetReps: 12, reps: 5, rir: 2 },
    { ...baseSet, targetReps: 12, reps: 12, rir: 2 },
  ] }],
}];
const unevenProgress = generateWorkout(profile, unevenProgressHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(unevenProgress.sets[0].weight, 60, 'One good final set must never hide two failed work sets and trigger a load increase');
assert.notEqual(unevenProgress.progressionStep, 'load', 'Load progression must evaluate the whole prescription');

const mixedLoadHistory = [{
  id: 'mixed-loads',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bench.id, sets: [60, 70].map((weight) => ({ ...baseSet, weight, reps: 8, targetReps: 8, rir: 2 })) }],
}];
const mixedLoadProgress = getExerciseProgress(mixedLoadHistory, bench.id);
assert.equal(mixedLoadProgress.lastWeight, 70, 'A mixed-load session must select a load actually performed, never an arithmetic midpoint');
assert.equal(mixedLoadProgress.latestTargetReps, 8, 'The selected real load must retain its comparable repetition evidence');
const removedLoadPrescription = generateWorkout({ ...profile, loadInventory: { barbell: [60, 65] } }, mixedLoadHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(removedLoadPrescription.sets[0].weight, 65, 'If equipment availability changes, the next prescription must use an available load');
const unavailablePerformedLoad = [{
  id: 'unavailable-performed-load', completedAt: Date.now() - 1000,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, weight: 68, reps: 8, targetReps: 8, rir: 2 }] }],
}];
const safeInventoryAdjustment = generateWorkout({ ...profile, loadInventory: { barbell: [60, 70] } }, unavailablePerformedLoad, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(safeInventoryAdjustment.sets[0].weight, 60, 'Removing a performed load must select a lower available load, never silently round upward');
assert.equal(safeInventoryAdjustment.sets[0].reps, 8, 'Changing inventory must hold repetitions instead of progressing load and reps together');
assert.equal(safeInventoryAdjustment.progressionStep, 'load-adjustment');
const reducedDuringSessionHistory = [{
  id: 'reduced-during-session', completedAt: Date.now() - 1000,
  exercises: [{ exerciseId: bench.id, sets: [
    { ...baseSet, weight: 60, targetWeight: 60, reps: 8, targetReps: 8, rir: 2 },
    { ...baseSet, weight: 60, targetWeight: 60, reps: 7, targetReps: 8, rir: 1 },
    { ...baseSet, weight: 50, targetWeight: 60, reps: 8, targetReps: 8, rir: 1 },
  ] }],
}];
assert.equal(getExerciseProgress(reducedDuringSessionHistory, bench.id).lastWeight, 50, 'A deliberate final work-set load reduction must not be hidden by the modal earlier load');
const reducedNextWorkout = generateWorkout({ ...profile, loadInventory: { barbell: [50, 60] } }, reducedDuringSessionHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(reducedNextWorkout.sets[0].weight, 50, 'The next workout must start from the reduced executable load');
const missedRepsHistory = [{
  id: 'missed-reps', completedAt: Date.now() - 1000,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 3 }, () => ({ ...baseSet, weight: 60, targetWeight: 60, reps: 5, targetReps: 8, rir: 0 })) }],
}];
const missedRepsAdjustment = generateWorkout({ ...profile, loadInventory: { barbell: [50, 60] } }, missedRepsHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(missedRepsAdjustment.sets[0].weight, 50, 'Significant repetition underperformance must use the next real lower load');
assert.equal(missedRepsAdjustment.progressionStep, 'performance-adjustment');

const saturatedChestHistory = [1, 3, 5].map((offset) => ({
  id: `saturated-chest-${offset}`,
  completedAt: Date.now() - offset * 864e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 5 }, () => ({ ...baseSet, reps: 8, rir: 2 })) }],
}));
const maintenanceWorkout = generateWorkout(profile, saturatedChestHistory, { targets: ['chest'], duration: 25 });
assert.equal(maintenanceWorkout.exercises.length, 1, 'A valid generated workout must never be empty when compatible exercises exist');
assert.equal(maintenanceWorkout.exercises[0].sets.length, 1, 'Covered targets must receive only a maintenance set, not arbitrary volume');
assert.equal(maintenanceWorkout.engine.maintenanceMode, true, 'The engine must explicitly expose its maintenance fallback');

const customProfile = {
  ...profile,
  targetRir: 0,
  setCaps: { compound: 4, accessory: 3 },
  exerciseOverrides: { [bench.id]: { minReps: 5, maxReps: 7, maxSets: 1, targetRir: 1 } },
};
assert.deepEqual(
  Object.fromEntries(Object.entries(getExercisePrescription(customProfile, bench)).filter(([key]) => ['minReps', 'maxReps', 'maxSets', 'targetRir', 'customRir'].includes(key))),
  { minReps: 5, maxReps: 7, maxSets: 1, targetRir: 1, customRir: 1 },
  'Per-exercise limits must override the global prescription',
);
assert.deepEqual(getExercisePrescription(customProfile, bench).targetRirs, [1], 'A per-exercise RIR override must replace the complete style sequence');
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

const continuityNow = Date.now();
const continuitySeed = generateWorkout(focusProfile, [], { targets: ['chest'], duration: 30, now: continuityNow - 4 * 864e5 });
const continuityExerciseId = continuitySeed.exercises[0].exerciseId;
const continuityHistory = Array.from({ length: 3 }, (_, index) => ({
  id: `continuity-${index}`,
  completedAt: continuityNow - (3 - index) * 864e5,
  exercises: [{ exerciseId: continuityExerciseId, sets: [{ targetReps: 8, reps: 8 + index, weight: 20, rir: 2, done: true }] }],
}));
const continuity = getExerciseContinuity(continuityHistory);
const continuityPattern = exercises.find((exercise) => exercise.id === continuityExerciseId).pattern;
assert.equal(continuity[continuityPattern].exercises[continuityExerciseId].exposures, 3, 'Continuity must count each exercise exposure inside its movement-pattern pool');
const continuityWorkout = generateWorkout(focusProfile, continuityHistory, { targets: ['chest'], duration: 30, now: continuityNow });
assert(!continuityWorkout.exercises.some((item) => item.exerciseId === continuityExerciseId), 'Multifrequency must not repeat the exercise used most recently when a compatible pattern alternative exists');
assert(continuityWorkout.exercises.some((item) => exercises.find((exercise) => exercise.id === item.exerciseId)?.pattern === continuityPattern), 'Multifrequency variation must preserve the requested movement pattern');
const onlyContinuityExercise = Object.fromEntries(exercises.map((exercise) => [exercise.id, exercise.id === continuityExerciseId ? 'normal' : 'exclude']));
const noAlternativeWorkout = generateWorkout({ ...focusProfile, preferences: onlyContinuityExercise }, continuityHistory, { targets: ['chest'], duration: 30, now: continuityNow });
assert(noAlternativeWorkout.exercises.some((item) => item.exerciseId === continuityExerciseId), 'The same exercise may repeat when no compatible alternative is actually available');
assert(!continuityWorkout.exercises.some((item) => 'isFocus' in item), 'Generated exercises must no longer carry Focus state');
const completedContinuityHistory = [43, 29, 15, 1].map((daysAgo, index) => ({
  id: `completed-continuity-${index}`,
  completedAt: continuityNow - daysAgo * 864e5,
  exercises: [{ exerciseId: continuityExerciseId, sets: [{ targetReps: 8, reps: 8 + index, weight: 20, rir: 2, done: true }] }],
}));
assert.equal(getExerciseContinuity(completedContinuityHistory, continuityNow)[continuityPattern].exercises[continuityExerciseId].exposures, 4, 'Four uses must remain measurable even at a sparse five-to-seven-day training cadence');
const rotatedContinuityWorkout = generateWorkout(focusProfile, completedContinuityHistory, { targets: ['chest'], duration: 30, now: continuityNow, variation: 991 });
assert(!rotatedContinuityWorkout.exercises.some((item) => item.exerciseId === continuityExerciseId), 'After four measured exposures the engine must rotate the exercise instead of pinning it forever');
assert.deepEqual(getExerciseContinuity(continuityHistory, continuityNow + 40 * 864e5), {}, 'Exercise continuity must expire after a long interruption');

const adaptationNow = Date.now();
const improvingHistory = [
  { id: 'adapt-old', completedAt: adaptationNow - 20 * 864e5, exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 4 }, () => ({ ...baseSet, reps: 8, weight: 50, rir: 2 })) }] },
  { id: 'adapt-new-1', completedAt: adaptationNow - 6 * 864e5, exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 4 }, () => ({ ...baseSet, reps: 8, weight: 55, rir: 2 })) }] },
  { id: 'adapt-new-2', completedAt: adaptationNow - 5 * 864e5, exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 4 }, () => ({ ...baseSet, reps: 8, weight: 55, rir: 2 })) }] },
];
const adaptationProfile = { ...profile, trainingAdaptation: { chest: { target: 8, lastEvaluatedAt: adaptationNow - 8 * 864e5 } } };
const adaptedProfile = recalibrateTrainingTargets(adaptationProfile, improvingHistory, adaptationNow);
assert.equal(adaptedProfile.trainingAdaptation.chest.target, 8, 'Improvement must confirm the current dose instead of automatically raising it');
const adaptedStatus = getMuscleTrainingStatus(adaptedProfile, improvingHistory, adaptationNow).chest;
assert.equal(adaptedStatus.desiredStimulusTarget, 8, 'Generation status must preserve the stable physiological target');
assert.equal(adaptedStatus.targetStimulus, 1, 'Generation must expose a separate operational target when observed cadence cannot deliver the desired dose');
assert.equal(recalibrateTrainingTargets(adaptedProfile, improvingHistory, adaptationNow + 864e5).trainingAdaptation.chest.target, 8, 'Adaptive volume must not reset or re-evaluate every render');

const analyticsNow = Date.now();
const analyticsHistory = [
  { id: 'previous-week', completedAt: analyticsNow - 9 * 864e5, exercises: [{ exerciseId: bench.id, isFocus: true, sets: [{ ...baseSet, weight: 60, reps: 8, rir: 2 }] }] },
  { id: 'current-week', completedAt: analyticsNow - 2 * 864e5, exercises: [{ exerciseId: bench.id, isFocus: true, sets: [{ ...baseSet, weight: 62.5, reps: 8, rir: 2 }] }] },
];
const exerciseAnalytics = getExerciseAnalytics(analyticsHistory, [bench.id], { now: analyticsNow });
assert.equal(exerciseAnalytics.week.trackedSessions, 1, 'The weekly summary must count current-week recurring exercise sessions');
assert(exerciseAnalytics.week.strengthChange > 0, 'The weekly summary must compare estimated strength with the previous week');
assert(exerciseAnalytics.week.volumeChange > 0, 'The weekly summary must compare completed training volume');
assert.deepEqual(getTrackedExerciseIds(analyticsHistory), [bench.id], 'Recurring exercise analytics must be derived from history without profile Focus state');

const editingWorkout = generateWorkout(focusProfile, [], { targets: ['chest', 'back', 'quads'], duration: 45, now: continuityNow + 1 });
const removableId = editingWorkout.exercises.at(-1)?.exerciseId;
assert(removableId, 'The generated workout must contain an exercise for edit checks');
const withoutExercise = removeExercise(editingWorkout, removableId);
assert.equal(withoutExercise.exercises.length, editingWorkout.exercises.length - 1, 'Removing an exercise must only change the current workout');
assert(!withoutExercise.exercises.some((item) => item.exerciseId === removableId), 'The removed exercise must leave the current workout');
assert.equal(withoutExercise.engine.composition.compounds + withoutExercise.engine.composition.accessories, withoutExercise.exercises.length, 'Removing an exercise must rebuild composition metadata');
assert.deepEqual(withoutExercise.engine.movementFamilies, [...new Set(withoutExercise.exercises.map((item) => getMovementFamily(exercises.find((exercise) => exercise.id === item.exerciseId))).filter(Boolean))], 'Removing an exercise must rebuild movement-family metadata');
const editableSetItem = editingWorkout.exercises[0];
const withManualSet = addWorkoutSet(editableSetItem);
assert.equal(withManualSet.sets.length, editableSetItem.sets.length + 1, 'A manual set must be appended to the selected exercise');
assert.equal(withManualSet.sets.at(-1).done, false, 'A manually appended set must start unfinished');
assert.equal(withManualSet.sets.at(-1).rir, null, 'A manually appended set must not copy recorded effort');
assert.equal(removeWorkoutSet(withManualSet).sets.length, editableSetItem.sets.length, 'The final unfinished set must be removable');
assert.equal(removeWorkoutSet({ ...withManualSet, sets: withManualSet.sets.map((set, index) => index === withManualSet.sets.length - 1 ? { ...set, done: true } : set) }).sets.length, withManualSet.sets.length, 'Completed-set evidence must never be removed by the manual set control');

const currentExercise = exercises.find((exercise) => exercise.id === editingWorkout.exercises[0].exerciseId);
const similarChoices = getSimilarExercises(editingWorkout, currentExercise.id, focusProfile);
assert(similarChoices.length > 1, 'The replacement picker must receive a list of compatible alternatives');
const allSimilarChoices = getSimilarExercises(editingWorkout, currentExercise.id, focusProfile, { includeVariants: true });
assert(allSimilarChoices.length >= similarChoices.length, 'Expanding reviewed variants must never remove compatible alternatives');
assert.equal(new Set(similarChoices.map(getExerciseVariantKey)).size, similarChoices.length, 'The default replacement list must contain only one representative per variant family');
const selectedSimilar = similarChoices[0];
const similarWorkout = replaceExercise(editingWorkout, currentExercise.id, focusProfile, [], selectedSimilar.id);
const similarExercise = exercises.find((exercise) => exercise.id === similarWorkout.exercises[0].exerciseId);
assert.equal(similarExercise.id, selectedSimilar.id, 'Replacement must use the exercise explicitly selected by the user');
assert.equal(similarExercise.pattern, currentExercise.pattern, 'Similar replacement must preserve the movement pattern when possible');
assert.equal(similarWorkout.exercises[0].sets.length, editingWorkout.exercises[0].sets.length, 'A selected replacement must preserve the safe set count of the current slot');
assert.deepEqual(rebuildWorkoutMetadata(similarWorkout).engine.composition, similarWorkout.engine.composition, 'Edited workout metadata must be stable when rebuilt');
const cappedReplacementProfile = { ...focusProfile, exerciseOverrides: { [selectedSimilar.id]: { maxSets: 1 } } };
const cappedReplacement = replaceExercise(editingWorkout, currentExercise.id, cappedReplacementProfile, [], selectedSimilar.id);
assert.equal(cappedReplacement.exercises[0].sets.length, 1, 'Replacement must respect the selected exercise set cap');

const refreshedWorkout = generateWorkout(focusProfile, [], {
  targets: editingWorkout.targetMuscles,
  duration: editingWorkout.duration,
  avoidExerciseIds: editingWorkout.exercises.map((item) => item.exerciseId),
});
const oldExercises = new Set(editingWorkout.exercises.map((item) => item.exerciseId));
assert(!refreshedWorkout.exercises.some((item) => oldExercises.has(item.exerciseId)), 'Workout refresh must avoid the previous exercises');
const completeAlternatives = generateWorkoutAlternatives({ ...focusProfile, equipment: allEquipment, duration: 60 }, [], generateWorkout({ ...focusProfile, equipment: allEquipment, duration: 60 }, [], { duration: 60, now: continuityNow + 20, variation: 20 }), { now: continuityNow + 20, seed: 21 });
assert(completeAlternatives.length > 0, 'Refresh must provide at least one genuinely different adaptive alternative when the catalog permits it');
assert(completeAlternatives.every((candidate) => candidate.engine.estimatedMinutes >= candidate.duration * .75), 'Refresh must never label a severely under-filled workout as a complete alternative');
const fitnessThirtyProfile = { ...focusProfile, goal: 'fitness', equipment: allEquipment, duration: 30, exerciseFilters: { essentialCatalog: true, preferLoadedVariants: false, excludeDirectCore: false, excludeCalves: false } };
const fitnessThirtyWorkout = generateWorkout(fitnessThirtyProfile, [], { duration: 30, now: continuityNow + 30, variation: 30 });
const fitnessThirtyAlternatives = generateWorkoutAlternatives(fitnessThirtyProfile, [], fitnessThirtyWorkout, { now: continuityNow + 30, seed: 31 });
assert(fitnessThirtyAlternatives.length > 0, 'A valid 30-minute fitness workout must expose adaptive refresh alternatives');
assert(fitnessThirtyAlternatives.every((candidate) => candidate.engine.estimatedMinutes >= fitnessThirtyWorkout.engine.estimatedMinutes * .85), 'Refresh alternatives must remain comparable to the actual current workout duration');

const excludedContinuityWorkout = generateWorkout({ ...focusProfile, preferences: { [currentExercise.id]: 'exclude' } }, continuityHistory, { targets: [currentExercise.primary], duration: 25 });
assert(!excludedContinuityWorkout.exercises.some((item) => item.exerciseId === currentExercise.id), 'Excluded exercises must not return even when continuity would otherwise prefer them');

const bodyweight = exercises.find((exercise) => exercise.loadType === 'bodyweight' && exercise.primary === 'quads' && exercise.equipment.every((item) => item === 'bodyweight'));
assert(bodyweight, 'A bodyweight-only quadriceps exercise must exist');
const bodyweightHistory = [{
  id: 'bodyweight-session',
  completedAt: Date.now() - 36e5,
  exercises: [{ exerciseId: bodyweight.id, sets: [{ targetReps: 8, reps: 20, weight: 0, rir: 0, done: true }] }],
}];
const bodyweightCapacityHistory = [
  { id: 'bodyweight-capacity-old', completedAt: Date.now() - 9 * 864e5, exercises: [{ exerciseId: bodyweight.id, sets: [{ targetReps: 10, reps: 10, weight: 0, rir: 0, done: true }] }] },
  { id: 'bodyweight-capacity-new', completedAt: Date.now() - 2 * 864e5, exercises: [{ exerciseId: bodyweight.id, sets: [{ targetReps: 10, reps: 10, weight: 0, rir: 4, done: true }] }] },
];
const bodyweightCapacityStats = getExerciseHistory(bodyweightCapacityHistory, bodyweight.id);
assert.equal(bodyweightCapacityStats.metric, 'rep-capacity', 'Bodyweight progress must be expressed as estimated repetition capacity');
assert.deepEqual(bodyweightCapacityStats.points.map((point) => point.value), [10, 14], 'Bodyweight repetition capacity must combine completed reps and recorded RIR');
assert.equal(bodyweightCapacityStats.trend, 0.4, 'Equal completed reps with more reserve must count as measurable bodyweight progress');
const bodyPreferences = Object.fromEntries(exercises.map((exercise) => [exercise.id, 'exclude']));
delete bodyPreferences[bodyweight.id];
const uncalibratedBodyWorkout = generateWorkout({ ...profile, equipment: ['bodyweight'], preferences: bodyPreferences }, [], { targets: ['quads'], duration: 25 });
assert.equal(uncalibratedBodyWorkout.exercises[0].needsInitialReps, true, 'A first-time bodyweight exercise must request a repetition calibration');
const calibratedBodyweight = calibrateBodyweightPrescription(uncalibratedBodyWorkout.exercises[0], 20);
assert.equal(calibratedBodyweight.needsInitialReps, false, 'Submitting maximum repetitions must complete bodyweight calibration');
assert.equal(calibratedBodyweight.sets[0].reps, Math.min(18, calibratedBodyweight.repRange.max), 'Calibration must subtract target RIR and respect the exercise repetition cap');
assert(calibratedBodyweight.sets.every((set, index, sets) => index === 0 || set.reps <= sets[index - 1].reps), 'Bodyweight calibration must account for fatigue across sets');
const styleCalibratedBodyweight = calibrateBodyweightPrescription({
  ...uncalibratedBodyWorkout.exercises[0],
  targetRir: 1,
  targetRirs: [2, 2, 1],
  sets: Array.from({ length: 3 }, (_, index) => ({ ...uncalibratedBodyWorkout.exercises[0].sets[0], targetRir: [2, 2, 1][index] })),
}, 20);
assert.deepEqual(styleCalibratedBodyweight.sets.map((set) => set.reps), [18, 17, 17].map((reps) => Math.min(reps, styleCalibratedBodyweight.repRange.max)), 'Bodyweight calibration must combine each set’s own style RIR with conservative inter-set fatigue');
const weakBodyweightCalibration = calibrateBodyweightPrescription(uncalibratedBodyWorkout.exercises[0], 5);
assert.equal(weakBodyweightCalibration.sets[0].reps, 3, 'Bodyweight calibration must never prescribe more than tested maximum minus target RIR');
assert.equal(weakBodyweightCalibration.calibrationBelowRange, true, 'A capacity below the nominal range must remain visible without falsifying the prescription');
const weakCalibrationHistory = [{
  id: 'weak-bodyweight-calibration',
  completedAt: Date.now() - 1000,
  exercises: [{ ...weakBodyweightCalibration, sets: weakBodyweightCalibration.sets.map((set) => ({ ...set, rir: 2, done: true })) }],
}];
const weakNextWorkout = generateWorkout({ ...profile, equipment: ['bodyweight'], preferences: bodyPreferences }, weakCalibrationHistory, { targets: ['quads'], duration: 25 });
assert(weakNextWorkout.exercises[0].sets[0].reps <= 3, 'A low bodyweight calibration must persist into the following session instead of jumping to the nominal minimum');
assert(Number.isInteger(weakNextWorkout.exercises[0].sets[0].reps), 'Bodyweight progression must always prescribe an integer repetition target');
const bodyWorkout = generateWorkout({ ...profile, equipment: ['bodyweight'], preferences: bodyPreferences }, bodyweightHistory, { targets: ['quads'], duration: 25 });
assert(bodyWorkout.exercises[0].sets[0].reps > 8, 'Bodyweight reps must adapt to demonstrated capacity');

const goblet = exercises.find((exercise) => exercise.name === 'Dumbbell Goblet Squat');
const gobletStats = getExerciseHistory([{
  id: 'single-dumbbell-volume', completedAt: Date.now() - 1000,
  exercises: [{ exerciseId: goblet.id, sets: [{ weight: 20, reps: 10, targetReps: 10, targetRir: 2, rir: 2, done: true }] }],
}], goblet.id);
assert.equal(gobletStats.totalVolume, 200, 'A single-dumbbell movement must not double its tonnage');

for (const goal of ['muscle', 'strength', 'fitness']) {
  for (const duration of [25, 30, 45, 60, 75]) {
    for (let variation = 0; variation < 20; variation += 1) {
      const stressProfile = {
        ...focusProfile,
        goal,
        duration,
        equipment: allEquipment,
        exerciseFilters: {
          essentialCatalog: variation % 2 === 0,
          preferLoadedVariants: variation % 3 === 0,
          excludeDirectCore: variation % 7 === 0,
          excludeCalves: variation % 11 === 0,
        },
      };
      const generated = generateWorkout(stressProfile, [], { now: 1700000000000 + variation, variation });
      const limits = getWorkoutCompositionLimits(duration);
      const generatedExercises = generated.exercises.map((item) => exercises.find((exercise) => exercise.id === item.exerciseId));
      const families = new Set(generatedExercises.map(getMovementFamily));
      assert(generated.exercises.length > 0 && generated.exercises.length <= limits.maxExercises, 'Stress generation must always return a bounded non-empty workout');
      assert(generated.engine.composition.compounds <= limits.maxCompounds, 'Stress generation must respect compound caps');
      assert(generated.engine.estimatedMinutes <= duration + 5, 'Stress generation must respect the five-minute scheduling tolerance');
      assert(generated.exercises.every((item) => item.sets.length > 0), 'Stress generation must never emit an exercise without sets');
      assert(!(families.has('knee') && families.has('hip')), 'Stress generation must not combine both lower-body families');
      assert(generatedExercises.filter(isLowerBodyExercise).length <= 1, 'Every adaptive workout must contain at most one lower-body exercise');
    }
  }
}

let longitudinalProfile = {
  ...focusProfile,
  goal: 'muscle',
  split: 'adaptive',
  duration: 45,
  equipment: allEquipment,
  exerciseFilters: { essentialCatalog: true, preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
  trainingAdaptation: {},
};
const longitudinalHistory = [];
const familyCounts = Object.fromEntries(['push', 'pull', 'knee', 'hip'].map((family) => [family, 0]));
const simulationStart = 1700000000000;
for (let session = 0; session < 40; session += 1) {
  const now = simulationStart + session * 3 * 864e5;
  const generated = generateWorkout(longitudinalProfile, longitudinalHistory, { now, variation: session });
  generated.engine.movementFamilies.forEach((family) => { familyCounts[family] += 1; });
  const completed = {
    ...generated,
    startedAt: now,
    completedAt: now + 40 * 60_000,
    exercises: generated.exercises.map((item) => ({
      ...item,
      sets: item.sets.map((set) => ({ ...set, weight: set.weight ?? 20, reps: set.reps, rir: set.targetRir, done: true })),
    })),
  };
  longitudinalHistory.push(completed);
  longitudinalProfile = recalibrateTrainingTargets(longitudinalProfile, longitudinalHistory, completed.completedAt);
}
const structuralCounts = Object.values(familyCounts);
assert(Math.max(...structuralCounts) - Math.min(...structuralCounts) <= 1, 'Long-term adaptive scheduling must balance push, pull, knee and hip exposure');
assert(Object.values(longitudinalProfile.trainingAdaptation).every((state) => state.target <= 10), 'Automatic hypertrophy volume must remain inside the conservative evidence cap');

for (const gapDays of [5, 7]) {
  const cadenceHistory = [];
  const cadenceCounts = Object.fromEntries(['push', 'pull', 'knee', 'hip'].map((family) => [family, 0]));
  const cadenceProfile = { ...longitudinalProfile, duration: 45, trainingAdaptation: {} };
  for (let session = 0; session < 40; session += 1) {
    const now = simulationStart + session * gapDays * 864e5;
    const generated = generateWorkout(cadenceProfile, cadenceHistory, { now, variation: session + gapDays * 100 });
    generated.engine.movementFamilies.forEach((family) => { cadenceCounts[family] += 1; });
    cadenceHistory.push({
      ...generated,
      startedAt: now,
      completedAt: now + 40 * 60_000,
      exercises: generated.exercises.map((item) => ({
        ...item,
        sets: item.sets.map((set) => ({ ...set, weight: set.weight ?? 20, reps: set.reps, rir: set.targetRir, done: true })),
      })),
    });
  }
  const counts = Object.values(cadenceCounts);
  assert(Math.min(...counts) > 0, `${gapDays}-day cadence must train every movement family`);
  assert(Math.max(...counts) - Math.min(...counts) <= 2, `${gapDays}-day cadence must retain balanced adaptive rotation after full recovery`);
}

for (const duration of [60, 75]) {
  const durationHistory = [];
  const durationCounts = Object.fromEntries(['push', 'pull', 'knee', 'hip'].map((family) => [family, 0]));
  let durationProfile = { ...longitudinalProfile, duration, trainingAdaptation: {} };
  for (let session = 0; session < 40; session += 1) {
    const now = simulationStart + session * 3 * 864e5;
    const generated = generateWorkout(durationProfile, durationHistory, { now, variation: session + duration });
    generated.engine.movementFamilies.forEach((family) => { durationCounts[family] += 1; });
    const completed = {
      ...generated,
      startedAt: now,
      completedAt: now + 40 * 60_000,
      exercises: generated.exercises.map((item) => ({
        ...item,
        sets: item.sets.map((set) => ({ ...set, weight: set.weight ?? 20, reps: set.reps, rir: set.targetRir, done: true })),
      })),
    };
    durationHistory.push(completed);
    durationProfile = recalibrateTrainingTargets(durationProfile, durationHistory, completed.completedAt);
  }
  assert(Math.abs(durationCounts.push - durationCounts.pull) <= 2, `${duration}-minute adaptive scheduling must balance push and pull`);
  assert(Math.abs(durationCounts.knee - durationCounts.hip) <= 2, `${duration}-minute adaptive scheduling must alternate the two lower-body families`);
  assert.equal(durationCounts.knee + durationCounts.hip, 40, `${duration}-minute workouts must contain exactly one lower-body movement family per session`);
}

console.log('Checks passed: strict state/backup, offline guides, time budgets, balanced adaptive rotation, real-load progression, bounded volume, equipment, editing and longitudinal stress.');
