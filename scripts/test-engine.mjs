import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogExercises, exercises } from '../src/data/exercises.js';
import {
  BACKUP_FILENAME,
  backupStateFingerprint,
  buildWebDavFileUrl,
  createWebDavUploadQueue,
  downloadWebDavBackup,
  mergeBackupState,
  parseBackup,
  serializeBackup,
  synchronizeWebDavBackup,
  uploadWebDavBackup,
} from '../src/data/backup.js';
import { getExerciseDetails } from '../src/data/exerciseDetails.js';
import {
  ENGINE_VERSION,
  calibrateBodyweightPrescription,
  estimateOneRepMax,
  generateWorkout,
  getAvailableLoads,
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
  getRecovery,
  getSimilarExercises,
  getTrackedExerciseIds,
  getWeeklyMuscleLoad,
  getWeeklyMovementFrequency,
  getWeeklyTargets,
  getWorkoutCompositionLimits,
  getWorkoutSettingsFingerprint,
  isExerciseAllowed,
  isCompatibleWorkout,
  isEssentialExercise,
  isLowerBodyExercise,
  isReturningAfterBreak,
  isWorkoutActive,
  removeExercise,
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
const benchGuide = await getExerciseDetails(bench.wgerId, 'en');
assert(benchGuide.description.length > 100, 'The lazy wger guide must expose the English instructions');
assert(benchGuide.image?.startsWith('/exercise-images/'), 'The bundled wger guide must use a local exercise image');
for (const exercise of exercises) {
  const guide = await getExerciseDetails(exercise.wgerId, 'en');
  assert(guide?.description && guide?.image?.includes('/exercise-images/'), `Approved exercise ${exercise.name} must ship with its complete offline guide`);
}
const serviceWorkerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
assert(serviceWorkerSource.includes('cache.addAll(images)'), 'The service worker install must fail atomically if any bundled guide image cannot be cached');
assert(!serviceWorkerSource.includes('Promise.allSettled(images'), 'Offline installation must not silently ignore missing guide images');

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
assert.equal(getWeeklyMuscleLoad(hardHistory).volume.chest, 2, 'Failure must not reduce productive stimulus credit');
assert.equal(getWeeklyMuscleLoad(hardHistory).volume.shoulders, 1, 'Indirect work must use fractional-set credit');
assert.equal(getWeeklyMuscleLoad(hardHistory).frequency.shoulders, 1, 'Enough accumulated indirect work must count as an exposure');
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
assert.equal(getWeeklyMovementFrequency(oneSetHistory).push, 1, 'A completed push movement must count as one structural exposure');
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
assert.equal(muscleStatus.back.cycleStimulus, 2, 'The mobile stimulus cycle must count completed primary sets');
assert.equal(muscleStatus.chest.cycleStimulus, 3, 'A recent primary stimulus must be visible in the current cycle');
assert.equal(muscleStatus.shoulders.cycleStimulus, 2.5, 'Secondary work from different movement patterns must retain fractional stimulus');
assert.equal(muscleStatus.back.cycleStartedAt, statusNow - 10 * 864e5, 'The adaptive stimulus window must expose its ten-day fade horizon');
assert(muscleStatus.back.priority > muscleStatus.chest.priority, 'An older recovered and under-target muscle must outrank a recently trained muscle');
const expiredStatus = getMuscleTrainingStatus({ goal: 'muscle', level: 'intermediate', split: 'adaptive' }, [{ ...stimulusHistory[0], completedAt: statusNow - 8 * 864e5 }], statusNow);
assert(expiredStatus.back.cycleStimulus > 0 && expiredStatus.back.cycleStimulus < 2, 'Stimulus must fade after day seven instead of disappearing at a hard boundary');
assert.equal(expiredStatus.back.cycleStartedAt, statusNow - 10 * 864e5, 'The adaptive window must remain stable while old stimulus fades');
const fadedHistory = [{ ...stimulusHistory[0], completedAt: statusNow - 8 * 864e5 }];
assert.equal(getWeeklyMuscleLoad(fadedHistory, statusNow).volume.back, expiredStatus.back.cycleStimulus, 'Volume ranking and recovery screen must use the same fading stimulus clock');
assert.equal(getWeeklyMuscleLoad(fadedHistory, statusNow).frequency.back, expiredStatus.back.cycleExposures, 'Frequency ranking and recovery screen must use the same fading exposure clock');
assert.equal(getWeeklyMovementFrequency(fadedHistory, statusNow).pull, expiredStatus.back.cycleExposures, 'Movement rotation must use the same fading exposure clock as muscle status');

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
  preferences,
};
const activeLegacyBench = {
  id: 'legacy-bench', startedAt: Date.now() - 1000,
  exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, done: true }] }],
};
assert.equal(isCompatibleWorkout(activeLegacyBench, { ...profile, equipment: ['barbell', 'bench'] }), true, 'An active known workout must survive stricter equipment rules introduced by an engine update');
assert.equal(isCompatibleWorkout({ ...activeLegacyBench, startedAt: null, exercises: [{ ...activeLegacyBench.exercises[0], sets: [{ ...baseSet, done: false }] }] }, { ...profile, equipment: ['barbell', 'bench'] }), false, 'An unopened incompatible workout may be regenerated safely');
assert.equal(isCompatibleWorkout({ ...activeLegacyBench, completedAt: Date.now() }), false, 'A completed workout must never be accepted as the current session');

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
assert.throws(() => parseBackup(JSON.stringify({ format: 'easyfit-backup', schemaVersion: 1, payload: { profile: {}, history: [], workout: { exercises: [] } } })), /workout in corso non è valido/, 'An empty active workout must never be restorable');
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

const uploadOrder = [];
let releaseFirst;
const firstUploadGate = new Promise((resolve) => { releaseFirst = resolve; });
const queuedUpload = createWebDavUploadQueue(async ({ serialized }) => {
  uploadOrder.push(`start-${serialized}`);
  if (serialized === 'old') await firstUploadGate;
  uploadOrder.push(`end-${serialized}`);
});
const oldUpload = queuedUpload({ serialized: 'old' });
const newUpload = queuedUpload({ serialized: 'new' });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(uploadOrder, ['start-old'], 'A newer WebDAV upload must wait while an older request is still in flight');
releaseFirst();
await Promise.all([oldUpload, newUpload]);
assert.deepEqual(uploadOrder, ['start-old', 'end-old', 'start-new', 'end-new'], 'WebDAV writes must finish in state order so stale data cannot overwrite a newer backup');

const remoteOne = { ...hardHistory[0], id: 'remote-one', completedAt: Date.now() - 3000 };
const remoteTwo = { ...hardHistory[0], id: 'remote-two', completedAt: Date.now() - 2000 };
let conditionalGets = 0;
let conditionalPuts = 0;
let finalConditionalUpload;
const conditionalSync = await synchronizeWebDavBackup({
  folderUrl: 'https://cloud.example.test/remote.php/dav/files/user/Easyfit',
  username: 'user',
  password: 'app-password',
  state: { profile, history: hardHistory, workout: null },
  fetcher: async (_url, options) => {
    if (options.method === 'GET') {
      conditionalGets += 1;
      const remoteHistory = conditionalGets === 1 ? [remoteOne] : [remoteOne, remoteTwo];
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'etag' ? `etag-${conditionalGets}` : null },
        text: async () => serializeBackup({ profile, history: remoteHistory, workout: null }),
      };
    }
    conditionalPuts += 1;
    if (conditionalPuts === 1) return { ok: false, status: 412 };
    finalConditionalUpload = options;
    return { ok: true, status: 204 };
  },
});
assert.equal(conditionalGets, 2, 'A WebDAV conflict must re-read the newer remote state before retrying');
assert.equal(finalConditionalUpload.headers['If-Match'], 'etag-2', 'A synchronized upload must be conditional on the remote revision it merged');
assert.equal(conditionalSync.state.history.length, 3, 'Conflict retry must preserve local history and every remote revision');

const mergedCloud = mergeBackupState(
  { profile, history: hardHistory, workout: activeWorkoutState },
  { profile: {}, history: [{ ...hardHistory[0], id: 'remote-session', completedAt: Date.now() - 1000 }], workout: { id: 'remote-active', createdAt: Date.now(), exercises: [{ exerciseId: bench.id, sets: [{ ...baseSet, done: false }] }] } },
);
assert.equal(mergedCloud.history.length, 2, 'Automatic cloud pull must merge non-duplicate history instead of replacing local data');
assert.equal(mergedCloud.workout.id, activeWorkoutState.id, 'Automatic cloud pull must never replace the workout active on this device');
assert.equal(mergeBackupState({ profile, history: [], workout: null }, { profile: { goal: 'strength' }, history: [], workout: null }, { preferRemoteProfile: true }).profile.goal, 'strength', 'A clean device must be able to restore cloud settings automatically');
assert.equal(backupStateFingerprint({ profile, history: hardHistory, workout: null }), backupStateFingerprint({ profile, history: hardHistory, workout: null }), 'Cloud conflict detection must use a stable local-state fingerprint');

assert.deepEqual(getWeeklyTargets(profile), { sets: 8, frequency: 2 }, 'Adaptive hypertrophy must start from a moderate dose and aim for two exposures');
assert.equal(getWeeklyTargets({ ...profile, level: 'beginner' }).sets, 8, 'A declared level alone must not arbitrarily change muscle volume');
assert.equal(getWeeklyTargets({ ...profile, level: 'advanced' }).sets, 8, 'Advanced users must earn added volume from completed data instead of receiving 12 sets by default');
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

const bodyweightPush = exercises.find((exercise) => exercise.loadType === 'bodyweight' && exercise.primary === 'chest' && exercise.pattern === 'horizontal-push');
assert(bodyweightPush, 'A bodyweight horizontal push must exist');
const loadedAlternativeProfile = {
  ...focusProfile,
  equipment: ['bodyweight', 'barbell', 'bench', 'rack'],
  exerciseFilters: { preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
};
assert.equal(isExerciseAllowed(bench, { ...profile, equipment: ['barbell', 'bench'] }), false, 'Bench press must require actual rack supports, not only a loose bar and bench');
assert.equal(isExerciseAllowed(bodyweightPush, loadedAlternativeProfile), false, 'A bodyweight movement must be removable when a loaded equivalent is available');
assert.equal(isExerciseAllowed(bodyweightPush, { ...loadedAlternativeProfile, exerciseFilters: { ...loadedAlternativeProfile.exerciseFilters, preferLoadedVariants: false } }), true, 'The user must be able to keep bodyweight alternatives');

const allEquipment = [...new Set(exercises.flatMap((exercise) => exercise.equipment))];
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
const unavailablePullDay = generateWorkout({ ...focusProfile, split: 'ppl', equipment: ['bodyweight'], exerciseFilters: { preferLoadedVariants: false } }, [pullDaySeed], { duration: 30 });
assert.equal(unavailablePullDay.exercises.length, 0, 'A Pull day with no compatible pull exercise must not silently fall back to a Push exercise');

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
  ['knee', 'push'],
  'A short first workout must give one large lower-body group and one upper-body family the initial tie-break',
);
assert(adaptiveWorkout.exercises.every((item) => item.sets.length === 2), 'Short sessions must spread volume instead of overloading one exercise');
assert(adaptiveWorkout.exercises.length <= 3, 'A 25–30 minute workout must contain at most three exercises');
assert.deepEqual(adaptiveWorkout.engine.composition, { compounds: 2, accessories: 1, lowerBody: 1, ...getWorkoutCompositionLimits(25) }, 'A short workout must balance two compounds with one accessory and only one leg exercise');
assert.equal(adaptiveWorkout.engine.version, ENGINE_VERSION, 'The workout must preserve the evidence model version');
assert.deepEqual(adaptiveWorkout.engine.movementFamilies, ['push', 'knee'], 'The workout must expose one upper and one lower family');
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
assert(adaptiveWithTwoLegacyDays.engine.estimatedMinutes <= 47, 'A 45-minute workout must respect the time budget');
assert.equal(getWeeklyTargets({ ...profile, split: 'ppl' }).frequency, 2, 'PPL must target two weekly exposures when repeated');

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
const inventoriedProfile = { ...profile, loadInventory: { barbell: [60, 61, 62.5] } };
assert.deepEqual(getAvailableLoads(bench, inventoriedProfile), [60, 61, 62.5], 'The engine must read the user’s actual available barbell loads');
const inventoriedProgress = generateWorkout(inventoriedProfile, loadProgressHistory, { targets: ['chest'], duration: 25 }).exercises[0];
assert.equal(inventoriedProgress.sets[0].weight, 61, 'Load progression must choose the smallest real available weight instead of a fixed increment');

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

const saturatedChestHistory = [1, 2].map((offset) => ({
  id: `saturated-chest-${offset}`,
  completedAt: Date.now() - offset * 864e5,
  exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 4 }, () => ({ ...baseSet, reps: 8, rir: 2 })) }],
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
assert.equal(continuity[continuityPattern].exposures, 3, 'Continuity must count consecutive exposures of the same movement pattern');
const continuityWorkout = generateWorkout(focusProfile, continuityHistory, { targets: ['chest'], duration: 30, now: continuityNow });
assert(continuityWorkout.exercises.some((item) => item.exerciseId === continuityExerciseId), 'A useful compatible exercise must recur long enough to measure progress');
assert(!continuityWorkout.exercises.some((item) => 'isFocus' in item), 'Generated exercises must no longer carry Focus state');
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
assert.equal(getMuscleTrainingStatus(adaptedProfile, improvingHistory, adaptationNow).chest.targetStimulus, 8, 'Generation status must read the stable adaptive target');
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

const excludedContinuityWorkout = generateWorkout({ ...focusProfile, preferences: { [currentExercise.id]: 'exclude' } }, continuityHistory, { targets: [currentExercise.primary], duration: 25 });
assert(!excludedContinuityWorkout.exercises.some((item) => item.exerciseId === currentExercise.id), 'Excluded exercises must not return even when continuity would otherwise prefer them');

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
assert.equal(calibratedBodyweight.sets[0].reps, Math.min(18, calibratedBodyweight.repRange.max), 'Calibration must subtract target RIR and respect the exercise repetition cap');
assert(calibratedBodyweight.sets.every((set, index, sets) => index === 0 || set.reps <= sets[index - 1].reps), 'Bodyweight calibration must account for fatigue across sets');
const weakBodyweightCalibration = calibrateBodyweightPrescription(uncalibratedBodyWorkout.exercises[0], 5);
assert.equal(weakBodyweightCalibration.sets[0].reps, 3, 'Bodyweight calibration must never prescribe more than tested maximum minus target RIR');
assert.equal(weakBodyweightCalibration.calibrationBelowRange, true, 'A capacity below the nominal range must remain visible without falsifying the prescription');
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
      assert(generated.engine.estimatedMinutes <= duration + 2, 'Stress generation must respect the selected duration');
      assert(generated.exercises.every((item) => item.sets.length > 0), 'Stress generation must never emit an exercise without sets');
      assert(!(families.has('knee') && families.has('hip')), 'Stress generation must not combine both lower-body families');
      if (generated.exercises.length <= 3) assert(generatedExercises.filter(isLowerBodyExercise).length <= 1, 'A short workout must contain at most one leg exercise');
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
  const counts = Object.values(durationCounts);
  assert(Math.max(...counts) - Math.min(...counts) <= 2, `${duration}-minute adaptive scheduling must not privilege upper-body families`);
}

console.log('Checks passed: strict state/backup, offline guides, time budgets, balanced adaptive rotation, real-load progression, bounded volume, equipment, editing and longitudinal stress.');
