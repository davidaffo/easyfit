import { exercises, muscles } from '../data/exercises.js';

const allMuscles = Object.keys(muscles);
const DAY = 864e5;
const STIMULUS_MEMORY_DAYS = 21;
const STIMULUS_HALF_LIFE_DAYS = 7;
const CONTINUITY_HISTORY_DAYS = 90;
const CONTINUITY_BREAK_DAYS = 28;
const RECENT_VARIATION_DAYS = 7;
const EXERCISE_ROTATION_EXPOSURES = 4;
export const SESSION_TIME_TOLERANCE_MINUTES = 7;
export const ENGINE_VERSION = 40;

const muscleBaseImportance = {
  chest: 100,
  back: 100,
  quads: 100,
  hamstrings: 95,
  glutes: 85,
  shoulders: 85,
  biceps: 65,
  triceps: 65,
  calves: 50,
  core: 50,
};

export function getMuscleSelectionPriority(muscle, status = {}) {
  if (status.excluded) return 0;
  const adaptiveNeed = clamp(Number(status.priority) || 0, 0, 100);
  const structuralImportance = muscleBaseImportance[muscle] || 50;
  return Math.round(adaptiveNeed * 0.82 + structuralImportance * 0.18);
}

export const trainingRules = {
  strength: {
    baseCycleSets: 6,
    cycleSetRange: { min: 4, max: 8 },
    compound: { sets: 3, reps: 3, maxReps: 6, intensity: 0.82, rest: 180 },
    accessory: { sets: 2, reps: 6, maxReps: 10, intensity: 0.72, rest: 90 },
    targetRir: 2,
  },
  muscle: {
    baseCycleSets: 8,
    cycleSetRange: { min: 6, max: 10 },
    compound: { sets: 3, reps: 8, maxReps: 12, intensity: 0.72, rest: 120 },
    accessory: { sets: 3, reps: 10, maxReps: 15, intensity: 0.65, rest: 75 },
    targetRir: 2,
  },
  fitness: {
    baseCycleSets: 6,
    cycleSetRange: { min: 4, max: 8 },
    compound: { sets: 2, reps: 10, maxReps: 15, intensity: 0.60, rest: 75 },
    accessory: { sets: 2, reps: 12, maxReps: 20, intensity: 0.55, rest: 60 },
    targetRir: 3,
  },
};

export const trainingStyles = {
  intense: {
    label: 'Essenziale intenso',
    description: 'Due serie sui multiarticolari e tre sugli accessori, molto vicine al limite.',
    classes: {
      'high-fatigue-compound': { targetRirs: [1, 0], rest: 150 },
      'stable-compound': { targetRirs: [1, 0], rest: 120 },
      isolation: { targetRirs: [2, 1, 0], rest: 75 },
    },
  },
  balanced: {
    label: 'Equilibrato',
    description: 'Volume e sforzo bilanciati per progredire con fatica gestibile.',
    recommended: true,
    classes: {
      'high-fatigue-compound': { targetRirs: [2, 2, 1], rest: 180 },
      'stable-compound': { targetRirs: [2, 2, 1], rest: 150 },
      isolation: { targetRirs: [2, 1, 1], rest: 90 },
    },
  },
  volume: {
    label: 'Volume controllato',
    description: 'Più serie, mantenendo maggiore margine nelle ripetizioni.',
    classes: {
      'high-fatigue-compound': { targetRirs: [3, 3, 2], rest: 165 },
      'stable-compound': { targetRirs: [3, 2, 2], rest: 135 },
      isolation: { targetRirs: [2, 2, 1, 1], rest: 90 },
    },
  },
};

const validTrainingStyle = (value) => Object.hasOwn(trainingStyles, value) ? value : 'balanced';

export function getExerciseEffortClass(exercise) {
  return ['high-fatigue-compound', 'stable-compound', 'isolation'].includes(exercise?.effortClass)
    ? exercise.effortClass
    : exercise?.compound ? 'stable-compound' : 'isolation';
}

export function isPrimaryMovement(exercise) {
  return exercise?.sessionRole === 'primary' || Boolean(exercise?.compound);
}

function styleRuleFor(profile, exercise) {
  const style = trainingStyles[validTrainingStyle(profile.trainingStyle)];
  const effortClass = getExerciseEffortClass(exercise);
  const base = style.classes[effortClass];
  // Failure has no consistent strength advantage and is particularly costly
  // on high-fatigue compounds, so the strength goal keeps one extra RIR there.
  const targetRirs = profile.goal === 'strength' && effortClass === 'high-fatigue-compound'
    ? base.targetRirs.map((rir) => clamp(rir + 1, 0, 4))
    : base.targetRirs;
  const goalRestAdjustment = profile.goal === 'strength' ? 30 : profile.goal === 'fitness' ? -15 : 0;
  return {
    effortClass,
    targetRirs,
    rest: clamp(base.rest + goalRestAdjustment, 60, 300),
  };
}

export function targetRirsForSetCount(targetRirs, count) {
  if (count <= 0) return [];
  if (count === 1) return [targetRirs.at(-1)];
  if (targetRirs.length <= 1) return Array.from({ length: count }, () => targetRirs[0] ?? 2);
  // Preserve the intended effort curve when the user changes set count. For
  // example, 2→1→0 becomes 2→1→1→0 with four sets instead of 2→1→0→0.
  return Array.from({ length: count }, (_, index) => {
    const position = index * (targetRirs.length - 1) / (count - 1);
    const before = Math.floor(position);
    const after = Math.ceil(position);
    if (before === after) return targetRirs[before];
    const interpolated = targetRirs[before] + (targetRirs[after] - targetRirs[before]) * (position - before);
    return clamp(Math.round(interpolated), 0, 4);
  });
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function plannedCycleFrequency(profile) {
  return 2;
}

export function getWeeklyTargets(profile) {
  const rule = trainingRules[profile.goal] || trainingRules.muscle;
  return {
    sets: rule.baseCycleSets,
    frequency: plannedCycleFrequency(profile),
  };
}

export function getExerciseMuscleContributions(exercise) {
  if (!exercise) return {};
  return Object.fromEntries(
    Object.entries(exercise.muscleContributions || {}).filter(
      ([muscle, contribution]) => allMuscles.includes(muscle) && Number(contribution) > 0,
    ),
  );
}

export const movementFamilies = [
  { id: 'push', patterns: ['horizontal-push', 'vertical-push', 'chest-isolation', 'shoulder-isolation', 'elbow-extension'], muscles: ['chest', 'shoulders', 'triceps'], primaryMuscles: ['chest', 'shoulders'] },
  { id: 'pull', patterns: ['horizontal-pull', 'vertical-pull', 'straight-arm-pull', 'rear-delt', 'elbow-flexion'], muscles: ['back', 'biceps'], primaryMuscles: ['back'] },
  { id: 'knee', patterns: ['squat', 'single-leg', 'knee-extension'], muscles: ['quads'], primaryMuscles: ['quads'] },
  { id: 'hip', patterns: ['hinge', 'hip-extension', 'knee-flexion'], muscles: ['hamstrings', 'glutes'], primaryMuscles: ['hamstrings', 'glutes'] },
];

export function getMovementFamily(exercise) {
  return movementFamilies.find((family) => family.patterns.includes(exercise?.pattern))?.id || null;
}

export function isLowerBodyExercise(exercise) {
  return ['knee', 'hip'].includes(getMovementFamily(exercise))
    || ['quads', 'hamstrings', 'glutes', 'calves'].includes(exercise?.primary);
}

export function willCompleteExercise(sets = [], setIndex) {
  return sets.length > 0 && sets.every((set, index) => index === setIndex || set.done);
}

export function isFinalSetBelowTarget(item, setIndex, setOverride = {}) {
  const sets = item?.sets || [];
  if (!sets.length || setIndex !== sets.length - 1 || !willCompleteExercise(sets, setIndex)) return false;
  const set = { ...sets[setIndex], ...setOverride };
  const performedReps = Math.max(0, Number(set.reps) || 0);
  const targetReps = Math.max(0, Number(set.targetReps) || 0);
  const performedWeight = Math.max(0, Number(set.weight) || 0);
  const targetWeight = Math.max(0, Number(set.targetWeight ?? set.weight) || 0);
  if (!targetReps) return false;
  return targetWeight > 0
    ? performedWeight * performedReps < targetWeight * targetReps - .001
    : performedReps < targetReps;
}

export function isWorkoutActive(workout) {
  return Boolean(workout?.startedAt && !workout.completedAt);
}

export function startWorkout(workout, startedAt = Date.now()) {
  const canStart = workout && Array.isArray(workout.exercises) && workout.exercises.length > 0
    && workout.exercises.every((item) => Array.isArray(item.sets) && item.sets.length > 0);
  if (!canStart || workout.completedAt || isWorkoutActive(workout)) return workout?.completedAt ? null : canStart ? workout : null;
  return { ...workout, startedAt: Number(startedAt) || Date.now() };
}

function resolveRecordedExercise(item) {
  const current = exercises.find((exercise) => exercise.id === item?.exerciseId);
  if (current) return current;
  const snapshot = item?.exerciseSnapshot;
  return snapshot
    && typeof snapshot.id === 'string'
    && typeof snapshot.name === 'string'
    && typeof snapshot.primary === 'string'
    && Array.isArray(snapshot.equipment)
    ? snapshot
    : null;
}

export function getWorkoutExercise(item) {
  return resolveRecordedExercise(item) || {
    id: item?.exerciseId || 'legacy-exercise',
    name: `Legacy exercise (${item?.exerciseId || 'unknown'})`,
    translations: {},
    primary: 'core',
    equipment: [],
    pattern: 'legacy',
    compound: false,
    loadType: item?.sets?.some((set) => Number(set.weight) > 0) ? 'external' : 'bodyweight',
    loadUnit: 'total',
    muscleContributions: {},
    legacy: true,
  };
}

export function isCompatibleWorkout(workout, profile = null) {
  const validRecord = Boolean(workout
    && typeof workout === 'object'
    && Array.isArray(workout.exercises)
    && workout.exercises.length
    && workout.exercises.every((item) => typeof item?.exerciseId === 'string'
      && Array.isArray(item.sets) && item.sets.length
      && item.sets.every((set) => set
        && typeof set === 'object'
        && typeof set.done === 'boolean'
        && (set.reps == null || (Number.isFinite(Number(set.reps)) && Number(set.reps) >= 0 && Number(set.reps) <= 100))
        && (set.weight == null || (Number.isFinite(Number(set.weight)) && Number(set.weight) >= 0 && Number(set.weight) <= 1000))
        && (set.rir == null || (Number.isFinite(Number(set.rir)) && Number(set.rir) >= 0 && Number(set.rir) <= 10)))));
  if (!validRecord || workout.completedAt) return false;
  const hasRecordedSets = workout.exercises.some((item) => item.sets.some((set) => set?.done));
  const mustPreserveSession = Boolean(workout.startedAt || hasRecordedSets);
  return workout.exercises.every((item) => {
    const exercise = resolveRecordedExercise(item);
    if (!exercise) return mustPreserveSession;
    return !profile || mustPreserveSession || isExerciseAllowed(exercise, profile);
  });
}

function stimulusWindowWeight(completedAt, now) {
  const age = (now - Number(completedAt)) / DAY;
  if (!Number.isFinite(age) || age < 0 || age > STIMULUS_MEMORY_DAYS) return 0;
  return 2 ** (-age / STIMULUS_HALF_LIFE_DAYS);
}

export function estimateOneRepMax(weight, reps, rir = 0) {
  if (!Number.isFinite(Number(weight)) || Number(weight) <= 0 || !Number.isFinite(Number(reps)) || Number(reps) <= 0) return null;
  const recordedRir = rir === null || rir === undefined || rir === '' ? 2 : Number(rir);
  const effectiveReps = clamp(Number(reps) + (Number.isFinite(recordedRir) ? recordedRir : 2), 1, 30);
  return effectiveReps <= 10
    ? Number(weight) * (36 / (37 - effectiveReps))
    : Number(weight) * (1 + effectiveReps / 30);
}

function estimateEffectiveReps(oneRepMax, weight) {
  const maximum = Number(oneRepMax);
  const load = Number(weight);
  if (!Number.isFinite(maximum) || !Number.isFinite(load) || maximum <= 0 || load <= 0 || maximum < load) return null;
  const ratio = maximum / load;
  const effectiveReps = ratio <= 4 / 3
    ? 37 - 36 / ratio
    : 30 * (ratio - 1);
  return clamp(effectiveReps, 1, 30);
}

function validCompletedWorkout(workout, now = Date.now()) {
  const completedAt = Number(workout?.completedAt);
  return Number.isFinite(completedAt) && completedAt > 0 && completedAt <= now;
}

function recordedRir(set, fallback = 2) {
  const value = set?.rir === null || set?.rir === undefined || set?.rir === ''
    ? Number(set?.targetRir ?? fallback)
    : Number(set.rir);
  return Number.isFinite(value) ? clamp(value, 0, 10) : fallback;
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function observedWeeklySessionRate(history, now) {
  const dates = history
    .filter((workout) => validCompletedWorkout(workout, now) && workout.completedAt >= now - 42 * DAY)
    .map((workout) => Number(workout.completedAt))
    .sort((a, b) => a - b);
  if (dates.length < 3) return null;
  const gaps = dates.slice(1)
    .map((date, index) => (date - dates[index]) / DAY)
    .filter((gap) => gap > 0);
  const typicalGap = median(gaps);
  return typicalGap ? clamp(7 / typicalGap, 0.5, 7) : null;
}

function exerciseSetCapacity(exercise, muscle, profile, history, now) {
  const targetMinutes = Number(profile.duration) || 45;
  let maximum = getExercisePrescription(profile, exercise).maxSets;
  if (targetMinutes <= 30 || isReturningAfterBreak(history, now) || profile.level === 'beginner') maximum = Math.min(maximum, 2);
  return maximum * Number(getExerciseMuscleContributions(exercise)[muscle] || 0);
}

function muscleSessionCapacity(muscle, profile, history, now) {
  if (!Array.isArray(profile.equipment)) return 0;
  const candidates = exercises
    .filter((exercise) => Number(getExerciseMuscleContributions(exercise)[muscle]) > 0)
    .filter((exercise) => isExerciseAllowed(exercise, profile) && isEssentialExercise(exercise, profile));
  const capacities = candidates.map((exercise) => ({
    exercise,
    capacity: exerciseSetCapacity(exercise, muscle, profile, history, now),
  }));
  if (['quads', 'hamstrings', 'glutes'].includes(muscle)) {
    // The session-wide lower-body guard permits only one lower exercise.
    return Math.max(0, ...capacities.filter(({ exercise }) => isLowerBodyExercise(exercise)).map(({ capacity }) => capacity));
  }
  const compound = Math.max(0, ...capacities.filter(({ exercise }) => exercise.compound).map(({ capacity }) => capacity));
  const accessory = Math.max(0, ...capacities.filter(({ exercise }) => !exercise.compound).map(({ capacity }) => capacity));
  return compound + accessory;
}

function expectedFamilyShare(muscle, targetMinutes) {
  if (muscle === 'core' || muscle === 'calves') return Number(targetMinutes) >= 40 ? .5 : .15;
  if (muscle === 'glutes') return Number(targetMinutes) >= 60 ? .75 : .6;
  if (Number(targetMinutes) >= 60 && ['chest', 'shoulders', 'triceps', 'back', 'biceps'].includes(muscle)) return 1;
  return .5;
}

function constraintAdjustedTarget(muscle, desiredTarget, profile, history, now) {
  const weeklySessions = observedWeeklySessionRate(history, now);
  if (!weeklySessions) return desiredTarget;
  const sessionCapacity = muscleSessionCapacity(muscle, profile, history, now);
  const familyShare = expectedFamilyShare(muscle, profile.duration);
  const feasibleDose = Math.round(weeklySessions * familyShare * sessionCapacity * 2) / 2;
  return Math.min(desiredTarget, Math.max(0.5, feasibleDose));
}

export function getExerciseProgress(history = [], exerciseId, now = Date.now()) {
  const sessions = history
    .filter((workout) => validCompletedWorkout(workout, now))
    .map((workout) => ({
      completedAt: workout.completedAt,
      item: workout.exercises.find((entry) => entry.exerciseId === exerciseId),
    }))
    .filter(({ item }) => item)
    .map(({ completedAt, item }) => {
      const completed = item.sets.filter((set) => set.done);
      const estimates = completed
        .map((set) => estimateOneRepMax(set.weight, set.reps, recordedRir(set)))
        .filter(Boolean);
      const weighted = completed.filter((set) => Number(set.weight) > 0);
      // A prescription must always start from a load the user actually lifted.
      // Choose the most represented work-set load; on a tie, the last performed
      // load wins (normally the user's final working load after warm-ups).
      const loadGroups = new Map();
      weighted.forEach((set, index) => {
        const weight = Number(set.weight);
        const group = loadGroups.get(weight) || { weight, count: 0, lastIndex: -1 };
        group.count += 1;
        group.lastIndex = index;
        loadGroups.set(weight, group);
      });
      const modalWorkingWeight = [...loadGroups.values()]
        .sort((a, b) => b.count - a.count || b.lastIndex - a.lastIndex)[0]?.weight ?? null;
      const finalWeight = weighted.at(-1)?.weight == null ? null : Number(weighted.at(-1).weight);
      const finalTargetWeight = weighted.at(-1)?.targetWeight == null ? null : Number(weighted.at(-1).targetWeight);
      // A deliberate load reduction on a later work set is performance
      // evidence, not a warm-up. Prefer it over the modal load so the next
      // session cannot ignore that the original prescription was excessive.
      const reducedFinalLoad = finalWeight != null && modalWorkingWeight != null
        && finalWeight < modalWorkingWeight * .97
        && (finalTargetWeight == null || finalWeight < finalTargetWeight * .97);
      const workingWeight = reducedFinalLoad ? finalWeight : modalWorkingWeight;
      const comparableSets = workingWeight == null
        ? completed
        : completed.filter((set) => Math.abs(Number(set.weight) - workingWeight) / workingWeight <= 0.03);
      const repCapacities = comparableSets.map((set) => Number(set.reps) + recordedRir(set));
      const performedReps = comparableSets.map((set) => Number(set.reps)).filter((value) => value > 0);
      const performedRepsBySet = comparableSets.map((set) => Number(set.reps)).filter((value) => value > 0);
      const targetRepsBySet = comparableSets.map((set) => Number(set.targetReps)).filter((value) => value > 0);
      const targetRirs = comparableSets.map((set) => Number(set.targetRir ?? 2));
      const supportedReps = comparableSets.map((set, index) => repCapacities[index] - targetRirs[index]);
      const prescribedSets = Math.max(completed.length, item.sets?.length || 0);
      const completionRate = prescribedSets ? completed.length / prescribedSets : 0;
      const performedRepVolume = completed.reduce((sum, set) => sum + Math.max(0, Number(set.reps) || 0), 0);
      const prescribedRepVolume = (item.sets || []).reduce((sum, set) => sum + Math.max(0, Number(set.targetReps) || 0), 0);
      const performedLoadVolume = completed.reduce((sum, set) => (
        sum + Math.max(0, Number(set.weight) || 0) * Math.max(0, Number(set.reps) || 0)
      ), 0);
      const prescribedLoadVolume = (item.sets || []).reduce((sum, set) => {
        const targetWeight = Number(set.targetWeight ?? set.weight) || 0;
        return sum + Math.max(0, targetWeight) * Math.max(0, Number(set.targetReps) || 0);
      }, 0);
      const repVolumeRatio = prescribedRepVolume > 0 ? performedRepVolume / prescribedRepVolume : null;
      const loadVolumeRatio = prescribedLoadVolume > 0 ? performedLoadVolume / prescribedLoadVolume : null;
      const finalSet = completed.at(-1);
      const finalCapacity = finalSet ? Number(finalSet.reps || 0) + recordedRir(finalSet) : null;
      const finalTargetCapacity = finalSet
        ? Number(finalSet.targetReps || finalSet.reps || 0) + Number(finalSet.targetRir ?? 2)
        : null;
      const finalEstimate = finalSet
        ? estimateOneRepMax(finalSet.weight, finalSet.reps, recordedRir(finalSet))
        : null;
      const finalTargetEstimate = finalSet
        ? estimateOneRepMax(
          Number(finalSet.targetWeight ?? finalSet.weight),
          Number(finalSet.targetReps ?? finalSet.reps),
          Number(finalSet.targetRir ?? 2),
        )
        : null;
      const effectiveVolumeRatio = weighted.length && loadVolumeRatio != null ? loadVolumeRatio : repVolumeRatio;
      const finalPerformanceSurplus = (
        finalCapacity != null && finalTargetCapacity != null && finalCapacity > finalTargetCapacity + .25
      ) || (
        finalEstimate != null && finalTargetEstimate != null && finalEstimate > finalTargetEstimate * 1.01
      );
      const positiveEvidence = completionRate >= .8 && (
        Number(effectiveVolumeRatio) >= 1.025
        || finalPerformanceSurplus
      );
      const negativeEvidence = Number.isFinite(Number(effectiveVolumeRatio))
        && Number(effectiveVolumeRatio) < .975
        && finalCapacity != null && finalTargetCapacity != null
        && finalCapacity < finalTargetCapacity - .25;
      const repCapacityEstimate = finalPerformanceSurplus
        ? finalCapacity
        : median(repCapacities);
      const sessionE1rm = estimates.length
        ? finalPerformanceSurplus ? finalEstimate : median(estimates)
        : null;
      const storedDecision = item.performanceCalibration?.decision;
      const maintainedPrescription = storedDecision === 'maintain-prescription';
      return {
        completedAt,
        storedPerformance: item.performanceCalibration,
        calibrationDecision: storedDecision || null,
        e1rm: sessionE1rm,
        bestE1rm: estimates.length ? Math.max(...estimates) : null,
        finalE1rm: finalEstimate,
        finalTargetE1rm: finalTargetEstimate,
        repCapacityEstimate,
        positiveEvidence,
        negativeEvidence,
        finalCapacity,
        finalTargetCapacity,
        lastWeight: maintainedPrescription
          ? Number(item.performanceCalibration?.prescribedWeight) || workingWeight
          : workingWeight,
        targetWeight: median(comparableSets.map((set) => Number(set.targetWeight)).filter((value) => value > 0)),
        targetReps: median(comparableSets.map((set) => Number(set.targetReps)).filter((value) => value > 0)),
        supportedReps: median(supportedReps),
        minimumSupportedReps: supportedReps.length ? Math.min(...supportedReps) : null,
        performedReps: median(performedReps),
        minimumPerformedReps: performedReps.length ? Math.min(...performedReps) : null,
        performedRepsBySet,
        targetRepsBySet,
        repCapacities,
        targetRirs,
        targetRir: median(targetRirs),
        completionRate,
        completedSets: completed.length,
        repVolumeRatio,
        loadVolumeRatio,
        finalPerformanceSurplus,
      };
    })
    .filter((session) => session.completedSets)
    .sort((a, b) => a.completedAt - b.completedAt);

  let rollingE1rm = null;
  let rollingRepCapacity = null;
  sessions.forEach((session) => {
    const storedMaximum = Number(session.storedPerformance?.estimatedMaximum);
    const storedKind = session.storedPerformance?.kind;
    if (Number.isFinite(storedMaximum) && storedMaximum > 0 && ['e1rm', 'rep-capacity'].includes(storedKind)) {
      session.previousPerformanceMax = Number(session.storedPerformance.previousMaximum) || rollingE1rm || rollingRepCapacity || null;
      session.performanceMax = storedMaximum;
      session.performanceMaxChange = Number.isFinite(Number(session.storedPerformance.change))
        ? Number(session.storedPerformance.change)
        : session.previousPerformanceMax
          ? (storedMaximum - session.previousPerformanceMax) / session.previousPerformanceMax
          : null;
      if (storedKind === 'e1rm') rollingE1rm = storedMaximum;
      else rollingRepCapacity = storedMaximum;
      return;
    }
    session.previousPerformanceMax = rollingE1rm ?? rollingRepCapacity;
    if (session.e1rm != null) {
      if (rollingE1rm == null) rollingE1rm = session.e1rm;
      else if (session.positiveEvidence) rollingE1rm = Math.max(rollingE1rm, session.e1rm);
      else if (session.negativeEvidence) rollingE1rm = Math.max(session.e1rm, rollingE1rm * .95);
      session.performanceMax = rollingE1rm;
    } else if (session.repCapacityEstimate != null) {
      if (rollingRepCapacity == null) rollingRepCapacity = session.repCapacityEstimate;
      else if (session.positiveEvidence) rollingRepCapacity = Math.max(rollingRepCapacity, session.repCapacityEstimate);
      else if (session.negativeEvidence) rollingRepCapacity = Math.max(session.repCapacityEstimate, rollingRepCapacity - 1);
      session.performanceMax = rollingRepCapacity;
    }
    session.performanceMaxChange = session.previousPerformanceMax && session.performanceMax
      ? (session.performanceMax - session.previousPerformanceMax) / session.previousPerformanceMax
      : null;
  });

  const latest = sessions.at(-1);
  const previous = sessions.at(-2);
  return {
    sessions: sessions.length,
    latestE1rm: latest?.e1rm != null ? latest?.performanceMax ?? latest.e1rm : null,
    latestSessionE1rm: latest?.e1rm ?? null,
    latestRepCapacity: latest?.e1rm == null ? latest?.performanceMax ?? null : null,
    previousPerformanceMax: latest?.previousPerformanceMax ?? null,
    latestPerformanceMaxChange: latest?.performanceMaxChange ?? null,
    latestPositiveEvidence: latest?.positiveEvidence ?? false,
    latestNegativeEvidence: latest?.negativeEvidence ?? false,
    latestFinalCapacity: latest?.finalCapacity ?? null,
    latestFinalTargetCapacity: latest?.finalTargetCapacity ?? null,
    bestE1rm: Math.max(0, ...sessions.map((session) => session.bestE1rm || 0)) || null,
    lastWeight: latest?.lastWeight ?? null,
    latestTargetWeight: latest?.targetWeight ?? null,
    latestTargetReps: latest?.targetReps ?? null,
    latestSupportedReps: latest?.supportedReps ?? null,
    minimumSupportedReps: latest?.minimumSupportedReps ?? null,
    latestPerformedReps: latest?.performedReps ?? null,
    minimumPerformedReps: latest?.minimumPerformedReps ?? null,
    latestPerformedRepsBySet: latest?.performedRepsBySet || [],
    latestTargetRepsBySet: latest?.targetRepsBySet || [],
    latestRepCapacities: latest?.repCapacities || [],
    latestTargetRirs: latest?.targetRirs || [],
    latestTargetRir: latest?.targetRir ?? null,
    latestCompletionRate: latest?.completionRate ?? null,
    latestRepVolumeRatio: latest?.repVolumeRatio ?? null,
    latestLoadVolumeRatio: latest?.loadVolumeRatio ?? null,
    latestFinalPerformanceSurplus: latest?.finalPerformanceSurplus ?? false,
    latestCalibrationDecision: latest?.calibrationDecision ?? null,
    trend: latest?.performanceMaxChange ?? (latest?.e1rm && previous?.e1rm ? (latest.e1rm - previous.e1rm) / previous.e1rm : null),
  };
}

export function finalizeWorkoutPerformance(workout, history = []) {
  if (!validCompletedWorkout(workout, Number(workout?.completedAt) || Date.now())) return workout;
  const combinedHistory = [...history.filter((entry) => entry !== workout && entry.id !== workout.id), workout];
  return {
    ...workout,
    exercises: workout.exercises.map((item) => {
      if (!(item.sets || []).some((set) => set.done)) return item;
      const exercise = resolveRecordedExercise(item);
      const progress = getExerciseProgress(combinedHistory, item.exerciseId, workout.completedAt);
      const kind = ['external', 'per-dumbbell'].includes(exercise?.loadType) ? 'e1rm' : 'rep-capacity';
      const maintainPrescription = item.underperformanceDecision === 'maintain';
      const reducePrescription = item.underperformanceDecision === 'recalibrate';
      const previousProgress = maintainPrescription || reducePrescription
        ? getExerciseProgress(history, item.exerciseId, workout.completedAt)
        : null;
      const finalSet = (item.sets || []).filter((set) => set.done).at(-1);
      const prescribedMaximum = kind === 'e1rm'
        ? estimateOneRepMax(
          Number(finalSet?.targetWeight ?? finalSet?.weight),
          Number(finalSet?.targetReps ?? finalSet?.reps),
          Number(finalSet?.targetRir ?? 2),
        )
        : Number(finalSet?.targetReps ?? finalSet?.reps) + Number(finalSet?.targetRir ?? 2);
      const previousMaximum = kind === 'e1rm'
        ? previousProgress?.latestE1rm
        : previousProgress?.latestRepCapacity;
      const conservativeFinalRir = Math.min(recordedRir(finalSet), Number(finalSet?.targetRir ?? 2));
      const reducedMaximum = kind === 'e1rm'
        ? estimateOneRepMax(finalSet?.weight, finalSet?.reps, conservativeFinalRir)
        : Number(finalSet?.reps || 0) + conservativeFinalRir;
      const measuredMaximum = kind === 'e1rm' ? progress.latestE1rm : progress.latestRepCapacity;
      const estimatedMaximum = maintainPrescription
        ? Number(previousMaximum) || Number(item.performanceEvidence?.estimatedMaximum) || prescribedMaximum
        : reducePrescription
          ? Math.min(...[measuredMaximum, reducedMaximum].map(Number).filter((value) => Number.isFinite(value) && value > 0))
          : measuredMaximum;
      if (!Number.isFinite(Number(estimatedMaximum)) || Number(estimatedMaximum) <= 0) return item;
      const calibrationChange = maintainPrescription
        ? 0
        : reducePrescription && Number(previousMaximum) > 0
          ? (estimatedMaximum - Number(previousMaximum)) / Number(previousMaximum)
          : progress.latestPerformanceMaxChange;
      return {
        ...item,
        underperformanceDecision: maintainPrescription ? 'maintain' : item.underperformanceDecision,
        performanceCalibration: {
          version: 1,
          kind,
          estimatedMaximum,
          previousMaximum: maintainPrescription ? estimatedMaximum : progress.previousPerformanceMax,
          change: calibrationChange,
          positiveEvidence: maintainPrescription || reducePrescription ? false : progress.latestPositiveEvidence,
          negativeEvidence: maintainPrescription ? false : reducePrescription || progress.latestNegativeEvidence,
          repVolumeRatio: progress.latestRepVolumeRatio,
          loadVolumeRatio: progress.latestLoadVolumeRatio,
          ...(maintainPrescription ? {
            decision: 'maintain-prescription',
            prescribedWeight: Number(finalSet?.targetWeight ?? finalSet?.weight) || null,
            prescribedReps: Number(finalSet?.targetReps ?? finalSet?.reps) || null,
          } : reducePrescription ? { decision: 'recalibrate-down' } : {}),
          updatedAt: workout.completedAt,
        },
      };
    }),
  };
}

function completedExercisePerformance(item) {
  const exercise = resolveRecordedExercise(item);
  const completedSets = (item?.sets || []).filter((set) => set.done);
  const weighted = ['external', 'per-dumbbell'].includes(exercise?.loadType);
  const marks = completedSets.map((set) => weighted
    ? estimateOneRepMax(set.weight, set.reps, recordedRir(set))
    : Number(set.reps || 0) + recordedRir(set)).filter((value) => Number.isFinite(value) && value > 0);
  const volume = completedSets.reduce((sum, set) => {
    const repetitions = Math.max(0, Number(set.reps) || 0);
    if (!weighted) return sum + repetitions;
    return sum + Math.max(0, Number(set.weight) || 0) * repetitions * (Number(exercise?.loadMultiplier) || 1);
  }, 0);
  return {
    exercise,
    completedSets,
    bestMark: marks.length ? Math.max(...marks) : null,
    volume,
    weighted,
  };
}

export function getWorkoutCompletionInsights(workout, history = []) {
  const items = (workout?.exercises || []).map((item) => {
    const current = completedExercisePerformance(item);
    if (!current.completedSets.length || !current.exercise) return null;
    const previousSessions = history
      .filter((entry) => validCompletedWorkout(entry, Number(workout?.completedAt) || Date.now()))
      .map((entry) => ({
        completedAt: Number(entry.completedAt),
        item: entry.exercises?.find((candidate) => candidate.exerciseId === item.exerciseId),
      }))
      .filter(({ item: previousItem }) => previousItem)
      .map(({ completedAt, item: previousItem }) => ({ completedAt, ...completedExercisePerformance(previousItem) }))
      .filter((session) => session.completedSets.length)
      .sort((a, b) => a.completedAt - b.completedAt);
    const previous = previousSessions.at(-1);
    const previousBest = Math.max(0, ...previousSessions.map((session) => session.bestMark || 0)) || null;
    const calibration = item.performanceCalibration || {};
    const currentMaximum = Number(calibration.estimatedMaximum) || current.bestMark;
    const previousMaximum = Number(calibration.previousMaximum) || null;
    const maximumChange = Number.isFinite(Number(calibration.change))
      ? Number(calibration.change)
      : currentMaximum && previousMaximum ? (currentMaximum - previousMaximum) / previousMaximum : null;
    const status = !previousSessions.length || !previousMaximum
      ? 'baseline'
      : maximumChange > .005
        ? 'improved'
        : maximumChange < -.005
          ? 'declined'
          : 'maintained';
    const volumeChange = previous?.volume > 0 ? (current.volume - previous.volume) / previous.volume : null;
    return {
      exerciseId: item.exerciseId,
      exercise: current.exercise,
      status,
      currentMaximum,
      previousMaximum,
      maximumChange,
      currentVolume: current.volume,
      previousVolume: previous?.volume ?? null,
      volumeChange,
      weighted: current.weighted,
      isRecord: previousBest != null && current.bestMark > previousBest * 1.005,
      decision: calibration.decision || null,
    };
  }).filter(Boolean);
  const comparableChanges = items
    .filter((item) => item.status !== 'baseline' && Number.isFinite(item.maximumChange))
    .map((item) => item.maximumChange);
  const counts = {
    improved: items.filter((item) => item.status === 'improved').length,
    declined: items.filter((item) => item.status === 'declined').length,
    maintained: items.filter((item) => item.status === 'maintained').length,
    baseline: items.filter((item) => item.status === 'baseline').length,
    records: items.filter((item) => item.isRecord).length,
  };
  return {
    items,
    counts,
    averageChange: comparableChanges.length
      ? comparableChanges.reduce((sum, value) => sum + value, 0) / comparableChanges.length
      : null,
    bestImprovement: items.filter((item) => item.status === 'improved')
      .sort((a, b) => b.maximumChange - a.maximumChange)[0] || null,
  };
}

export function getExerciseHistory(history = [], exerciseId, now = Date.now()) {
  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  const sessions = history
    .filter((workout) => validCompletedWorkout(workout, now))
    .map((workout) => {
      const item = workout.exercises.find((entry) => entry.exerciseId === exerciseId);
      const sets = item?.sets.filter((set) => set.done) || [];
      if (!sets.length) return null;
      const estimates = sets
        .map((set) => estimateOneRepMax(set.weight, set.reps, recordedRir(set)))
        .filter(Boolean);
      const weightedSets = sets.filter((set) => Number(set.weight) > 0);
      return {
        workoutId: workout.id,
        completedAt: workout.completedAt,
        duration: workout.duration,
        sets,
        bestE1rm: estimates.length ? Math.max(...estimates) : null,
        maxWeight: weightedSets.length ? Math.max(...weightedSets.map((set) => Number(set.weight))) : null,
        maxReps: Math.max(...sets.map((set) => Number(set.reps) || 0)),
        estimatedMaxReps: Math.max(...sets.map((set) => Number(set.reps || 0) + recordedRir(set))),
        volume: weightedSets.reduce((sum, set) => sum + Number(set.weight) * Number(set.reps || 0) * Number(exercise?.loadMultiplier || 1), 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.completedAt - b.completedAt);

  const metric = ['external', 'per-dumbbell'].includes(exercise?.loadType) ? 'e1rm' : 'rep-capacity';
  const points = sessions
    .map((session) => ({
      completedAt: session.completedAt,
      value: metric === 'e1rm' ? session.bestE1rm : session.estimatedMaxReps,
    }))
    .filter((point) => Number(point.value) > 0);
  const latest = points.at(-1)?.value ?? null;
  const previous = points.at(-2)?.value ?? null;

  return {
    sessions,
    points,
    metric,
    sessionCount: sessions.length,
    totalSets: sessions.reduce((sum, session) => sum + session.sets.length, 0),
    bestE1rm: Math.max(0, ...sessions.map((session) => session.bestE1rm || 0)) || null,
    maxWeight: Math.max(0, ...sessions.map((session) => session.maxWeight || 0)) || null,
    maxReps: Math.max(0, ...sessions.map((session) => session.maxReps || 0)) || null,
    bestRepCapacity: Math.max(0, ...sessions.map((session) => session.estimatedMaxReps || 0)) || null,
    totalVolume: sessions.reduce((sum, session) => sum + session.volume, 0),
    trend: latest && previous ? (latest - previous) / previous : null,
  };
}

function setStimulusQuality(set) {
  const targetReps = Number(set.targetReps);
  const completedReps = Number(set.reps);
  if (!Number.isFinite(completedReps) || completedReps <= 0) return 0;
  // Anchor adaptive dose to the actual/prescribed repetition ratio. The cap
  // keeps a single exceptional set from dominating the next sessions.
  const repQuality = targetReps > 0
    ? clamp(completedReps / targetReps, 0.25, 1.15)
    : 1;
  const rir = recordedRir(set);
  // Effective dose is not binary. A set stopped at 3 RIR must not receive the
  // same credit as a set taken to the prescribed 0 RIR, otherwise the adaptive
  // target cannot react when the user deliberately (or necessarily) stops early.
  const proximityQuality = rir <= 2 ? 1 : rir === 3 ? .75 : rir === 4 ? .6 : rir === 5 ? .5 : .4;
  return repQuality * proximityQuality;
}

function setAdherenceQuality(set) {
  const targetReps = Math.max(1, Number(set.targetReps) || Number(set.reps) || 1);
  const repAdherence = clamp(1 - Math.abs(Number(set.reps || 0) - targetReps) / targetReps, 0, 1);
  const targetRir = Number(set.targetRir ?? 2);
  const rir = recordedRir(set, targetRir);
  const rirAdherence = clamp(1 - Math.abs(rir - targetRir) / 3, 0, 1);
  return repAdherence * .65 + rirAdherence * .35;
}

function getWorkoutMuscleStimulusDetails(workout) {
  const details = Object.fromEntries(allMuscles.map((muscle) => [muscle, { stimulus: 0, potential: 0, adherence: 0 }]));
  (workout.exercises || []).forEach((item) => {
    const exercise = resolveRecordedExercise(item);
    if (!exercise) return;
    const contributions = getExerciseMuscleContributions(exercise);
    (item.sets || []).filter((set) => set.done).forEach((set) => {
      const stimulusQuality = setStimulusQuality(set);
      if (stimulusQuality <= 0) return;
      const adherenceQuality = setAdherenceQuality(set);
      Object.entries(contributions).forEach(([muscle, contribution]) => {
        details[muscle].stimulus += contribution * stimulusQuality;
        details[muscle].potential += contribution;
        details[muscle].adherence += contribution * adherenceQuality;
      });
    });
  });
  return details;
}

function getWorkoutMuscleStimulus(workout) {
  const details = getWorkoutMuscleStimulusDetails(workout);
  return Object.fromEntries(allMuscles.map((muscle) => [muscle, details[muscle].stimulus]));
}

export function getWeeklyMuscleLoad(history = [], now = Date.now()) {
  const volume = Object.fromEntries(allMuscles.map((muscle) => [muscle, 0]));
  const frequency = Object.fromEntries(allMuscles.map((muscle) => [muscle, 0]));

  history.filter((workout) => validCompletedWorkout(workout, now)).forEach((workout) => {
    const windowWeight = stimulusWindowWeight(workout.completedAt, now);
    if (!windowWeight) return;
    const workoutStimulus = getWorkoutMuscleStimulus(workout);
    allMuscles.forEach((muscle) => {
      volume[muscle] += workoutStimulus[muscle] * windowWeight;
      if (workoutStimulus[muscle] >= 0.75) frequency[muscle] += windowWeight;
    });
  });

  return {
    volume: Object.fromEntries(allMuscles.map((muscle) => [muscle, Math.round(volume[muscle] * 10) / 10])),
    frequency,
  };
}

export function getWeeklyMovementFrequency(history = [], now = Date.now()) {
  const frequency = Object.fromEntries(movementFamilies.map((family) => [family.id, 0]));
  history.filter((workout) => validCompletedWorkout(workout, now)).forEach((workout) => {
    const windowWeight = stimulusWindowWeight(workout.completedAt, now);
    if (!windowWeight) return;
    const covered = new Set();
    workout.exercises.forEach((item) => {
      if (!item.sets.some((set) => set.done)) return;
      const exercise = resolveRecordedExercise(item);
      const family = getMovementFamily(exercise);
      const productiveStimulus = item.sets
        .filter((set) => set.done)
        .reduce((sum, set) => sum + setStimulusQuality(set), 0);
      if (family && productiveStimulus >= .75) covered.add(family);
    });
    covered.forEach((family) => { frequency[family] += windowWeight; });
  });
  return frequency;
}

function exerciseSessionMetric(item, exercise) {
  const sets = (item?.sets || []).filter((set) => set.done && Number(set.reps) > 0);
  if (!sets.length) return null;
  const loaded = ['external', 'per-dumbbell'].includes(exercise.loadType);
  const values = sets.map((set) => loaded
    ? estimateOneRepMax(set.weight, set.reps, recordedRir(set))
    : Number(set.reps) + recordedRir(set)).filter((value) => Number(value) > 0);
  return median(values);
}

function musclePerformanceTrend(history, muscle, now) {
  const byExercise = new Map();
  history.filter((workout) => validCompletedWorkout(workout, now) && workout.completedAt >= now - 28 * DAY)
    .forEach((workout) => (workout.exercises || []).forEach((item) => {
      const exercise = resolveRecordedExercise(item);
      if (exercise?.primary !== muscle) return;
      const value = exerciseSessionMetric(item, exercise);
      if (!value) return;
      const entries = byExercise.get(exercise.id) || [];
      entries.push({ completedAt: workout.completedAt, value });
      byExercise.set(exercise.id, entries);
    }));
  const trends = [];
  byExercise.forEach((entries) => {
    const recent = entries.filter((entry) => entry.completedAt >= now - 14 * DAY).map((entry) => entry.value);
    const previous = entries.filter((entry) => entry.completedAt < now - 14 * DAY).map((entry) => entry.value);
    if (!recent.length || !previous.length) return;
    const currentValue = median(recent);
    const previousValue = median(previous);
    if (previousValue > 0) trends.push((currentValue - previousValue) / previousValue);
  });
  return median(trends);
}

function buildMuscleEvents(history, now) {
  const events = Object.fromEntries(allMuscles.map((muscle) => [muscle, []]));
  history.filter((workout) => validCompletedWorkout(workout, now))
    .sort((a, b) => a.completedAt - b.completedAt)
    .forEach((workout) => {
      const details = getWorkoutMuscleStimulusDetails(workout);
      allMuscles.forEach((muscle) => {
        if (details[muscle].potential > 0) events[muscle].push({ completedAt: workout.completedAt, ...details[muscle] });
      });
    });
  return events;
}

export function recalibrateTrainingTargets(profile, history = [], now = Date.now()) {
  const rule = trainingRules[profile.goal] || trainingRules.muscle;
  const events = buildMuscleEvents(history, now);
  const previousState = profile.trainingAdaptation || {};
  const trainingAdaptation = { ...previousState };

  allMuscles.forEach((muscle) => {
    const previous = previousState[muscle];
    const target = clamp(Number(previous?.target) || rule.baseCycleSets, rule.cycleSetRange.min, rule.cycleSetRange.max);
    const lastEvaluatedAt = Number(previous?.lastEvaluatedAt);
    if (!Number.isFinite(lastEvaluatedAt) || lastEvaluatedAt <= 0 || lastEvaluatedAt > now) {
      trainingAdaptation[muscle] = { target, lastEvaluatedAt: now, lastChangeAt: now, lastChange: 0 };
      return;
    }
    if (now - lastEvaluatedAt < 7 * DAY) return;
    const window = events[muscle].filter((event) => event.completedAt > lastEvaluatedAt && event.completedAt <= now);
    const stimulus = window.reduce((sum, event) => sum + event.stimulus, 0);
    const potential = window.reduce((sum, event) => sum + event.potential, 0);
    const adherence = potential ? window.reduce((sum, event) => sum + event.adherence, 0) / potential : null;
    const performanceTrend = musclePerformanceTrend(history, muscle, now);
    const primaryExposures = history.filter((workout) => validCompletedWorkout(workout, now)
      && workout.completedAt > lastEvaluatedAt
      && (workout.exercises || []).some((item) => {
        const exercise = resolveRecordedExercise(item);
        return exercise?.primary === muscle && (item.sets || []).some((set) => set.done);
      })).length;
    // Sparse or purely indirect observations are not enough to change a dose.
    // Keep the old evaluation boundary so evidence can accumulate.
    if (primaryExposures < 3 || potential < target * .65) return;
    let change = 0;
    const lastChangeAt = Number(previous?.lastChangeAt) || lastEvaluatedAt;
    const changeCooldownComplete = now - lastChangeAt >= 21 * DAY;
    // Progress means that the present dose is working, not that it must grow.
    // Add one set only after a well-tolerated plateau with enough observations.
    if (changeCooldownComplete && stimulus >= target * .85 && adherence >= .82 && performanceTrend != null
      && performanceTrend >= -.01 && performanceTrend <= .01) change = 1;
    if ((potential >= target * .7 && adherence != null && adherence < .62) || (performanceTrend != null && performanceTrend <= -.04)) change = -1;
    trainingAdaptation[muscle] = {
      target: clamp(target + change, rule.cycleSetRange.min, rule.cycleSetRange.max),
      lastEvaluatedAt: now,
      lastChangeAt: change ? now : lastChangeAt,
      lastChange: change,
      lastStimulus: Math.round(stimulus * 10) / 10,
      lastAdherence: adherence == null ? null : Math.round(adherence * 100) / 100,
      lastPerformanceTrend: performanceTrend,
    };
  });
  return { ...profile, trainingAdaptation };
}

export function getMuscleTrainingStatus(profile, history = [], now = Date.now()) {
  const baseTarget = getWeeklyTargets(profile);
  const rule = trainingRules[profile.goal] || trainingRules.muscle;
  const events = buildMuscleEvents(history, now);

  return Object.fromEntries(allMuscles.map((muscle) => {
    const rememberedEvents = events[muscle].filter((event) => now - event.completedAt <= STIMULUS_MEMORY_DAYS * DAY);
    const lastMeaningful = [...rememberedEvents].reverse().find((event) => event.stimulus >= 1) || rememberedEvents.at(-1);
    const hoursSinceStimulus = lastMeaningful ? Math.max(0, (now - lastMeaningful.completedAt) / 36e5) : null;
    // Training demand is now intentionally derived from performed stimulus
    // only. The 21-day memory decays smoothly, so neither a calendar week nor
    // an estimated biological recovery score can hide otherwise valid work.
    const doseStimulus = rememberedEvents.reduce(
      (sum, event) => sum + event.stimulus * stimulusWindowWeight(event.completedAt, now),
      0,
    );
    const doseExposures = rememberedEvents.reduce(
      (sum, event) => sum + (event.stimulus >= .75 ? stimulusWindowWeight(event.completedAt, now) : 0),
      0,
    );
    const adaptiveTarget = clamp(Number(profile.trainingAdaptation?.[muscle]?.target) || baseTarget.sets, rule.cycleSetRange.min, rule.cycleSetRange.max);
    const operationalTarget = constraintAdjustedTarget(muscle, adaptiveTarget, profile, history, now);
    const performanceTrend = musclePerformanceTrend(history, muscle, now);
    const volumeNeed = clamp((operationalTarget - doseStimulus) / operationalTarget, 0, 1);
    const frequencyNeed = clamp((baseTarget.frequency - doseExposures) / baseTarget.frequency, 0, 1);
    const recencyNeed = hoursSinceStimulus == null ? 1 : clamp((hoursSinceStimulus - 48) / (7 * 24 - 48), 0, 1);
    const weights = profile.goal === 'strength'
      ? { volume: .45, frequency: .3, recency: .25 }
      : profile.goal === 'muscle'
        ? { volume: .6, frequency: .15, recency: .25 }
        : { volume: .5, frequency: .25, recency: .25 };
    const demand = volumeNeed * weights.volume + frequencyNeed * weights.frequency + recencyNeed * weights.recency;
    const excluded = (muscle === 'core' && profile.exerciseFilters?.excludeDirectCore)
      || (muscle === 'calves' && profile.exerciseFilters?.excludeCalves);
    return [muscle, {
      priority: excluded ? 0 : Math.round(clamp(demand * 100, 0, 100)),
      excluded,
      // Legacy aliases are kept in serialized workouts so old backups can be
      // migrated, but they contain the same stimulus-window data.
      cycleStimulus: Math.round(doseStimulus * 10) / 10,
      doseStimulus: Math.round(doseStimulus * 10) / 10,
      targetStimulus: operationalTarget,
      desiredStimulusTarget: adaptiveTarget,
      capacityAdjusted: operationalTarget < adaptiveTarget,
      cycleExposures: Math.round(doseExposures * 100) / 100,
      doseExposures: Math.round(doseExposures * 100) / 100,
      targetExposures: baseTarget.frequency,
      cycleStartedAt: rememberedEvents[0]?.completedAt || now,
      cycleEndsAt: now,
      lastStimulatedAt: lastMeaningful?.completedAt || null,
      hoursSinceStimulus: hoursSinceStimulus == null ? null : Math.round(hoursSinceStimulus),
      volumeNeed,
      frequencyNeed,
      recencyNeed,
      performanceTrend,
    }];
  }));
}

function targetMuscles() {
  return [...allMuscles];
}

const loadEquipmentOrder = ['dumbbells', 'kettlebell', 'barbell', 'ezbar', 'machines', 'cables'];

function loadEquipment(exercise) {
  return loadEquipmentOrder.find((equipment) => exercise.equipment.includes(equipment)) || null;
}

export function getAvailableLoads(exercise, profile = {}) {
  const equipment = loadEquipment(exercise);
  const values = ['machines', 'cables'].includes(equipment)
    ? profile.exerciseLoadInventory?.[exercise.id]
    : profile.loadInventory?.[equipment];
  return [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
}

function roundLoad(value, exercise, profile) {
  const available = getAvailableLoads(exercise, profile);
  if (available.length) return available.reduce((closest, load) => (
    Math.abs(load - value) < Math.abs(closest - value) ? load : closest
  ), available[0]);
  return null;
}

function reconcilePerformedLoad(value, exercise, profile) {
  const performed = Number(value);
  const available = getAvailableLoads(exercise, profile);
  if (!performed) return { weight: null, adjusted: false, unsafeIncrease: false };
  if (!available.length) return { weight: null, adjusted: true, unsafeIncrease: false };
  const exact = available.find((load) => Math.abs(load - performed) < .001);
  if (exact) return { weight: exact, adjusted: false, unsafeIncrease: false };
  const lower = available.filter((load) => load < performed).at(-1);
  if (lower) return { weight: lower, adjusted: true, unsafeIncrease: false };
  const next = available[0];
  return { weight: next, adjusted: true, unsafeIncrease: (next - performed) / performed > .1 };
}

function nextAvailableLoad(exercise, profile, current) {
  const available = getAvailableLoads(exercise, profile);
  if (available.length) return available.find((load) => load > current + 0.001) ?? null;
  return null;
}

function completedRepRangeTop(progress, limits) {
  const performed = progress.latestPerformedRepsBySet || [];
  const capacities = progress.latestRepCapacities || [];
  const prescribedRirs = progress.latestTargetRirs || [];
  if (!performed.length || progress.latestCompletionRate < 1) return false;
  return performed.every((reps, index) => {
    const targetRir = Number(prescribedRirs[index] ?? limits.targetRir ?? 2);
    return Number(reps) >= limits.maxReps
      && Number(capacities[index]) >= limits.maxReps + targetRir;
  });
}

export function getExercisePrescription(profile, exercise) {
  const goal = trainingRules[profile.goal] || trainingRules.muscle;
  const rule = exercise.compound ? goal.compound : goal.accessory;
  const override = profile.exerciseOverrides?.[exercise.id] || {};
  const styleRule = styleRuleFor(profile, exercise);
  const legacyTypeCap = exercise.compound ? profile.setCaps?.compound : profile.setCaps?.accessory;
  const styleEnabled = Object.hasOwn(trainingStyles, profile.trainingStyle);
  const defaultMaxSets = styleEnabled
    ? styleRule.targetRirs.length
    : Number(legacyTypeCap) || (exercise.compound ? 3 : 4);
  const minReps = clamp(Number(override.minReps) || rule.reps, 1, 50);
  const maxSets = clamp(Number(override.maxSets) || defaultMaxSets, 1, 6);
  const targetRirs = override.targetRir != null
    ? Array.from({ length: maxSets }, () => clamp(Number(override.targetRir), 0, 4))
    : styleEnabled
      ? targetRirsForSetCount(styleRule.targetRirs, maxSets)
      : Array.from({ length: maxSets }, () => clamp(profile.targetRir ?? goal.targetRir, 0, 4));
  const requestedMaxReps = Number(override.maxReps) || rule.maxReps;
  // Long lower-body compound sets taken to failure have a disproportionate
  // systemic/cardiorespiratory cost. Keep the automatic prescription at ten
  // reps when its final set targets 0 RIR. An explicit exercise override still
  // wins, because it is an intentional user decision rather than an engine default.
  const automaticFailureCap = override.maxReps == null
    && exercise.compound
    && isLowerBodyExercise(exercise)
    && targetRirs.includes(0)
    ? 10
    : 50;
  const maxReps = clamp(Math.min(requestedMaxReps, automaticFailureCap), minReps, 50);
  return {
    minReps,
    maxReps,
    maxSets,
    targetRir: targetRirs.at(-1),
    targetRirs,
    rest: styleEnabled ? styleRule.rest : rule.rest,
    effortClass: styleRule.effortClass,
    customRir: override.targetRir ?? null,
  };
}

function doubleProgression(exercise, profile, progress, limits, intensity, setCount) {
  const usesWeight = ['external', 'per-dumbbell'].includes(exercise.loadType);
  const desiredRirs = targetRirsForSetCount(limits.targetRirs, Math.max(1, setCount));
  const desiredFinalRir = Number(desiredRirs.at(-1) ?? limits.targetRir ?? 2);
  const previousFinalRir = Number(progress.latestTargetRirs?.at(-1) ?? progress.latestTargetRir);
  const effortChanged = progress.sessions > 0 && Number.isFinite(previousFinalRir)
    && Math.abs(previousFinalRir - desiredFinalRir) >= .5;
  const performanceChange = Number(progress.latestPerformanceMaxChange);
  const performanceStep = effortChanged
    ? 'effort-adjustment'
    : performanceChange > .005
      ? 'max-increase'
      : performanceChange < -.005
        ? 'max-decrease'
        : progress.sessions ? 'hold' : 'start';

  if (!usesWeight) {
    if (!progress.sessions || progress.latestRepCapacity == null) {
      return { weight: 0, reps: limits.minReps, step: 'start' };
    }
    const supportedReps = Math.floor(Number(progress.latestRepCapacity) - desiredFinalRir + .001);
    return {
      weight: 0,
      reps: clamp(supportedReps, 1, limits.maxReps),
      step: supportedReps >= limits.maxReps ? 'top' : performanceStep,
    };
  }

  const reconciledLoad = progress.lastWeight
    ? reconcilePerformedLoad(progress.lastWeight, exercise, profile)
    : { weight: null, adjusted: false, unsafeIncrease: false };
  const lastAvailableWeight = reconciledLoad.weight;
  if (reconciledLoad.unsafeIncrease) {
    return { weight: null, reps: limits.minReps, step: 'recalibrate-load' };
  }
  if (!progress.sessions || !progress.latestE1rm) return { weight: null, reps: limits.minReps, step: 'start' };
  if (lastAvailableWeight && reconciledLoad.adjusted) {
    return {
      weight: lastAvailableWeight,
      reps: clamp(Math.round(Number(progress.latestPerformedReps) || Number(progress.latestTargetReps) || limits.minReps), limits.minReps, limits.maxReps),
      step: 'load-adjustment',
    };
  }

  let weight = lastAvailableWeight || roundLoad(progress.latestE1rm * intensity, exercise, profile);
  if (!weight) return { weight: null, reps: limits.minReps, step: 'recalibrate-load' };

  const repsAt = (load) => {
    const capacity = estimateEffectiveReps(progress.latestE1rm, load);
    return capacity == null ? 0 : Math.floor(capacity - desiredFinalRir + .001);
  };
  let supportedReps = repsAt(weight);

  if (supportedReps < limits.minReps) {
    const lowerLoads = getAvailableLoads(exercise, profile).filter((load) => load < weight - .001);
    const executableLoad = [...lowerLoads].reverse().find((load) => repsAt(load) >= limits.minReps);
    if (!executableLoad) return { weight: null, reps: limits.minReps, step: 'recalibrate-load' };
    weight = executableLoad;
    supportedReps = repsAt(weight);
    return {
      weight,
      reps: clamp(supportedReps, limits.minReps, limits.maxReps),
      step: effortChanged ? 'effort-adjustment' : 'performance-adjustment',
    };
  }

  if (supportedReps >= limits.maxReps) {
    // Estimated strength may raise the repetition prescription, but it may
    // not skip the double-progression ladder. Increase load only after every
    // prescribed work set actually reaches the top of the range at the
    // required RIR. A new load always restarts from the bottom of the range.
    if (completedRepRangeTop(progress, limits)) {
      const nextLoad = nextAvailableLoad(exercise, profile, weight);
      const relativeIncrease = nextLoad ? (nextLoad - weight) / weight : null;
      if (nextLoad && relativeIncrease <= .1 && repsAt(nextLoad) >= limits.minReps) {
        return {
          weight: nextLoad,
          reps: limits.minReps,
          step: 'load',
        };
      }
    }
    return { weight, reps: limits.maxReps, step: performanceChange > .005 ? 'max-increase' : 'top' };
  }

  return {
    weight,
    reps: clamp(supportedReps, limits.minReps, limits.maxReps),
    step: reconciledLoad.adjusted ? 'load-adjustment' : performanceStep,
  };
}

function gradualRepTargets(progression, progress, setCount, limits, targetRirs) {
  const uniformTargets = Array.from({ length: setCount }, () => progression.reps);
  const previousReps = progress.latestPerformedRepsBySet || [];
  const previousTargets = progress.latestTargetRepsBySet || [];
  if (!setCount || !previousReps.length || previousReps.length !== previousTargets.length
    || ['load', 'load-adjustment', 'effort-adjustment', 'performance-adjustment', 'recalibrate-load'].includes(progression.step)) {
    return uniformTargets;
  }
  const sameLoad = Number(progression.weight || 0) === 0
    || Math.abs(Number(progression.weight) - Number(progress.lastWeight)) / Math.max(1, Number(progress.lastWeight)) <= .03;
  const performedLoadOverride = Number(progress.latestTargetWeight) > 0 && Number(progress.lastWeight) > 0
    && Math.abs(Number(progress.latestTargetWeight) - Number(progress.lastWeight)) / Number(progress.lastWeight) > .03;
  const previousRirs = progress.latestTargetRirs || [];
  const sameEffort = previousRirs.length > 0 && targetRirs.length > 0
    && Math.abs(Number(previousRirs.at(-1)) - Number(targetRirs.at(-1))) < .5;
  if (!sameLoad || !sameEffort || performedLoadOverride) return uniformTargets;

  const performedTotal = previousReps.reduce((sum, reps) => sum + Math.max(0, Number(reps) || 0), 0);
  const previousTargetTotal = previousTargets.reduce((sum, reps) => sum + Math.max(0, Number(reps) || 0), 0);
  const uniformTotal = Number(progression.reps) * setCount;
  const failedPreviousTarget = performedTotal < previousTargetTotal;
  if (failedPreviousTarget) {
    // A failed prescription can never produce a larger prescription at the
    // same load and effort. "Stanco" repeats the previous target exactly;
    // downward recalibration may use at most the volume actually completed.
    const maximumNextTotal = progress.latestCalibrationDecision === 'recalibrate-down'
      ? performedTotal
      : previousTargetTotal;
    if (previousTargets.length === setCount && uniformTotal >= maximumNextTotal && maximumNextTotal === previousTargetTotal) {
      return previousTargets.map((reps) => clamp(reps, 1, limits.maxReps));
    }
    const nextTotal = Math.min(uniformTotal, maximumNextTotal);
    const base = Math.floor(nextTotal / setCount);
    const remainder = nextTotal % setCount;
    return Array.from({ length: setCount }, (_, index) => clamp(
      base + (index < remainder ? 1 : 0),
      1,
      limits.maxReps,
    ));
  }

  const performedCapacityTotal = (progress.latestRepCapacities || []).reduce((sum, capacity) => sum + Number(capacity || 0), 0);
  const targetCapacityTotal = previousTargets.reduce((sum, reps, index) => (
    sum + Number(reps) + Number(previousRirs[index] ?? limits.targetRir ?? 2)
  ), 0);
  const metPreviousTarget = progress.latestCompletionRate >= 1
    && performedTotal >= previousTargetTotal
    && performedCapacityTotal >= targetCapacityTotal;
  // Retain repetitions already demonstrated at the prescribed effort, even
  // when the saved target lagged behind the user's actual performance.
  const demonstratedReps = previousReps.map((reps, index) => Math.min(
    Number(reps),
    Math.floor(Number(progress.latestRepCapacities?.[index] || 0) - Number(previousRirs[index] ?? limits.targetRir ?? 2) + .001),
  ));
  if (previousReps.length === setCount) {
    const calibratedBelowRange = Math.max(...previousTargets) < limits.minReps;
    if (calibratedBelowRange && !progress.latestPositiveEvidence) {
      return previousTargets.map((reps) => clamp(reps, 1, limits.maxReps));
    }
    if (!metPreviousTarget) {
      return previousTargets.map((reps) => clamp(reps, 1, limits.maxReps));
    }
    // Classic double progression: once every set meets both reps and RIR,
    // advance exactly one repetition level. The load gate above takes over
    // only after every set has actually reached the top of the range.
    return previousTargets.map((reps, index) => clamp(Math.max(Number(reps) + 1, demonstratedReps[index]), 1, limits.maxReps));
  }

  if (previousReps.length !== setCount) {
    const previousTargetLevel = median(previousTargets);
    const nextLevel = metPreviousTarget
      ? Math.min(Math.max(Number(previousTargetLevel) + 1, Math.min(...demonstratedReps)), limits.maxReps)
      : Math.min(Number(previousTargetLevel), limits.maxReps);
    return Array.from({ length: setCount }, () => clamp(nextLevel, 1, limits.maxReps));
  }
  return uniformTargets;
}

function prescribedSetCount(exercise, profile, context, limits) {
  const defaultTargets = getWeeklyTargets(profile);
  const contributions = Object.entries(getExerciseMuscleContributions(exercise))
    .filter(([muscle]) => !context.muscleStatus?.[muscle]?.excluded)
    .filter(([muscle]) => !context.targetMuscles?.length || context.targetMuscles.includes(muscle));
  const contributionTotal = contributions.reduce((sum, [, contribution]) => sum + contribution, 0) || 1;
  const weightedAverage = (selector) => contributions.reduce(
    (sum, [muscle, contribution]) => sum + selector(muscle) * contribution,
    0,
  ) / contributionTotal;
  const volumeGap = Math.max(0, weightedAverage((muscle) => {
    const target = context.muscleStatus?.[muscle]?.targetStimulus || defaultTargets.sets;
    return target - (context.weeklyLoad?.volume?.[muscle] || 0);
  }));
  const frequencyGap = Math.max(0, weightedAverage((muscle) => {
    const target = context.muscleStatus?.[muscle]?.targetExposures || defaultTargets.frequency;
    return target - (context.weeklyLoad?.frequency?.[muscle] || 0);
  }));
  const remainingExposures = Math.max(1, Math.min(frequencyGap || 1, context.expectedUpcomingExposures || 1));
  const distributedSets = volumeGap > 0.25 ? Math.ceil(volumeGap / remainingExposures) : frequencyGap > 0 ? 1 : 0;
  const intenseStyleSets = profile.trainingStyle === 'intense' && !context.returningFromBreak
    ? Math.min(limits.maxSets, exercise.compound ? 2 : 3)
    : null;
  if (intenseStyleSets && distributedSets > 0) return intenseStyleSets;
  let maximum = context.targetMinutes <= 30 ? 2 : context.targetMinutes <= 45 ? 3 : exercise.compound ? 3 : 4;
  maximum = Math.min(maximum, limits.maxSets);
  if (context.returningFromBreak) maximum = Math.min(maximum, 2);
  if (profile.level === 'beginner') maximum = Math.min(maximum, 2);
  if (!context.returningFromBreak && profile.level === 'advanced' && context.targetMinutes >= 40) {
    maximum = Math.min(limits.maxSets, Math.max(maximum, 4));
  }
  if (distributedSets === 0) return context.allowMaintenance
    ? intenseStyleSets || Math.min(limits.maxSets, exercise.compound ? 2 : 1)
    : 0;
  const minimum = exercise.compound ? Math.min(2, limits.maxSets) : distributedSets === 1 ? 1 : 2;
  return clamp(distributedSets, Math.min(minimum, maximum), maximum);
}

function prescription(exercise, profile, history, context = {}) {
  const goal = trainingRules[profile.goal] || trainingRules.muscle;
  const rule = exercise.compound ? goal.compound : goal.accessory;
  const targetMinutes = context.targetMinutes || profile.duration || 45;
  const enrichedContext = { ...context, targetMinutes };
  const limits = getExercisePrescription(profile, exercise);
  const sets = prescribedSetCount(exercise, profile, enrichedContext, limits);
  const targetRir = limits.targetRir;
  const progress = getExerciseProgress(history, exercise.id, context.now || Date.now());
  const adjustedIntensity = rule.intensity - Math.max(0, targetRir - goal.targetRir) * 0.03;
  const progression = doubleProgression(exercise, profile, progress, limits, adjustedIntensity, sets);
  const targetRirs = targetRirsForSetCount(limits.targetRirs, sets);
  const targetReps = gradualRepTargets(progression, progress, sets, limits, targetRirs);
  const previousTargetLevel = Math.max(0, ...(progress.latestTargetRepsBySet || []).map(Number));
  const nextTargetLevel = Math.max(0, ...targetReps.map(Number));
  const progressionStep = progression.step === 'hold' && previousTargetLevel > 0 && nextTargetLevel > previousTargetLevel
    ? 'reps'
    : progression.step;

  return {
    exerciseId: exercise.id,
    exerciseSnapshot: {
      id: exercise.id,
      wgerId: exercise.wgerId,
      name: exercise.name,
      translations: exercise.translations,
      primary: exercise.primary,
      equipment: exercise.equipment,
      pattern: exercise.pattern,
      compound: exercise.compound,
      loadType: exercise.loadType,
      loadUnit: exercise.loadUnit,
      loadMultiplier: exercise.loadMultiplier,
      effortClass: exercise.effortClass,
      sessionRole: exercise.sessionRole,
      intensifierEligible: exercise.intensifierEligible,
      muscleContributions: exercise.muscleContributions,
      license: exercise.license,
    },
    rest: limits.rest,
    targetRir: targetRirs.at(-1) ?? targetRir,
    targetRirs,
    repRange: { min: limits.minReps, max: limits.maxReps },
    progressionStep,
    performanceEvidence: progress.sessions ? {
      repVolumeRatio: progress.latestRepVolumeRatio,
      loadVolumeRatio: progress.latestLoadVolumeRatio,
      completionRate: progress.latestCompletionRate,
      estimatedMaximum: progress.latestE1rm ?? progress.latestRepCapacity,
      previousMaximum: progress.previousPerformanceMax,
      maximumChange: progress.latestPerformanceMaxChange,
      positiveEvidence: progress.latestPositiveEvidence,
      negativeEvidence: progress.latestNegativeEvidence,
    } : null,
    minimumTimeFitSets: profile.trainingStyle === 'intense'
      ? Math.min(sets, exercise.compound ? 2 : 3)
      : exercise.compound ? Math.min(sets, 2) : 1,
    estimatedOneRepMax: progress.latestE1rm,
    needsInitialLoad: ['external', 'per-dumbbell'].includes(exercise.loadType) && progression.weight == null,
    needsInitialReps: exercise.loadType === 'bodyweight' && progress.sessions === 0,
    sets: Array.from({ length: sets }, (_, index) => ({
      targetReps: targetReps[index] ?? progression.reps,
      targetWeight: progression.weight,
      targetRir: targetRirs[index] ?? targetRir,
      reps: targetReps[index] ?? progression.reps,
      weight: progression.weight,
      rir: null,
      done: false,
    })),
  };
}

export function calibrateBodyweightPrescription(item, maximumReps) {
  const testedMaximum = clamp(Math.round(Number(maximumReps) || 0), 1, 100);
  const nominalMinimum = Number(item.repRange?.min) || 1;
  const maximum = Number(item.repRange?.max) || 50;
  const targetRirs = targetRirsForSetCount(
    item.targetRirs?.length ? item.targetRirs : [item.targetRir || 0],
    item.sets.length,
  );
  return {
    ...item,
    needsInitialReps: false,
    calibrationMaxReps: testedMaximum,
    calibrationBelowRange: testedMaximum - targetRirs[0] < nominalMinimum,
    progressionStep: 'calibrated',
    sets: item.sets.map((set, index) => ({
      ...set,
      targetRir: targetRirs[index],
      targetReps: clamp(testedMaximum - targetRirs[index] - index, 1, maximum),
      reps: clamp(testedMaximum - targetRirs[index] - index, 1, maximum),
      weight: 0,
      targetWeight: 0,
    })),
  };
}

export function estimatePrescriptionMinutes(exercise, item) {
  const timeProfiles = {
    'high-fatigue-compound': { setupSeconds: 210, secondsPerRep: 4, setTransitionSeconds: 12 },
    'stable-compound': { setupSeconds: 150, secondsPerRep: 3.5, setTransitionSeconds: 10 },
    isolation: { setupSeconds: 90, secondsPerRep: 3, setTransitionSeconds: 8 },
  };
  const profile = timeProfiles[getExerciseEffortClass(exercise)];
  const workSeconds = item.sets.reduce((sum, set) => {
    const repetitions = clamp(Number(set.targetReps ?? set.reps) || 1, 1, 50);
    const grindingAllowance = Number(set.targetRir) <= 0 ? 8 : Number(set.targetRir) <= 1 ? 4 : 0;
    return sum + profile.setTransitionSeconds + repetitions * profile.secondsPerRep + grindingAllowance;
  }, 0);
  const restSeconds = item.sets.slice(0, -1).reduce(
    (sum, set) => sum + Number(set.restAfter ?? item.rest ?? 0),
    0,
  );
  return (profile.setupSeconds + workSeconds + restSeconds) / 60;
}

export function hasAvailableEquipment(exercise, profile) {
  const required = exercise.equipment.filter((item) => item !== 'bodyweight');
  if (required.length) return required.every((item) => profile.equipment.includes(item));
  return profile.equipment.includes('bodyweight');
}

function hasLoadedEquivalent(exercise, profile) {
  if (exercise.loadType !== 'bodyweight') return false;
  return exercises.some((candidate) => candidate.id !== exercise.id
    && candidate.primary === exercise.primary
    && candidate.pattern === exercise.pattern
    && ['external', 'per-dumbbell'].includes(candidate.loadType)
    && hasAvailableEquipment(candidate, profile)
    && profile.preferences?.[candidate.id] !== 'exclude');
}

export function isExerciseAllowed(exercise, profile) {
  if (!exercise?.generationEligible || !hasAvailableEquipment(exercise, profile)) return false;
  if (profile.preferences?.[exercise.id] === 'exclude') return false;
  const filters = profile.exerciseFilters || {};
  if (filters.excludeDirectCore && exercise.primary === 'core') return false;
  if (filters.excludeCalves && exercise.primary === 'calves') return false;
  if (filters.preferLoadedVariants && hasLoadedEquivalent(exercise, profile)) return false;
  return true;
}

export function getEquipmentCoverage(profile) {
  return Object.fromEntries(movementFamilies.map((family) => [family.id, exercises.some((exercise) => (
    exercise.compound
    && family.patterns.includes(exercise.pattern)
    && isExerciseAllowed(exercise, profile)
    && isEssentialExercise(exercise, profile)
  ))]));
}

export function getExerciseVariantKey(exercise) {
  const equipment = [...(exercise.equipment || [])].sort().join('+');
  return `variant:${exercise.primary}:${exercise.pattern}:${equipment}:${exercise.loadType}`;
}

function canonicalScore(exercise, profile) {
  const preference = profile.preferences?.[exercise.id] === 'more' ? 30 : profile.preferences?.[exercise.id] === 'less' ? -20 : 0;
  return preference + exercise.selectionPriority * 3;
}

export function getCanonicalExercise(exercise, profile) {
  if (!exercise) return exercise;
  const key = getExerciseVariantKey(exercise);
  return exercises
    .filter((candidate) => getExerciseVariantKey(candidate) === key && isExerciseAllowed(candidate, profile))
    .sort((a, b) => canonicalScore(b, profile) - canonicalScore(a, profile) || a.name.localeCompare(b.name))[0] || exercise;
}

export function isEssentialExercise(exercise, profile) {
  // Kept as a compatibility export for old backups/tests. The old
  // "essential catalog" filter was too destructive and is no longer applied.
  return Boolean(exercise);
}

export function getExerciseContinuity(history = [], now = Date.now()) {
  const state = {};
  [...history]
    .filter((workout) => validCompletedWorkout(workout, now) && now - workout.completedAt <= CONTINUITY_HISTORY_DAYS * DAY)
    .sort((a, b) => a.completedAt - b.completedAt)
    .forEach((workout) => {
      (workout.exercises || []).forEach((item) => {
        if (!(item.sets || []).some((set) => set.done && setStimulusQuality(set) >= .7)) return;
        const exercise = resolveRecordedExercise(item);
        if (!exercise) return;
        const previous = state[exercise.pattern];
        const interrupted = previous && workout.completedAt - previous.lastPerformedAt > CONTINUITY_BREAK_DAYS * DAY;
        const previousExercises = interrupted ? {} : previous?.exercises || {};
        const previousExercise = previousExercises[exercise.id];
        const exerciseState = {
          exposures: (previousExercise?.exposures || 0) + 1,
          lastPerformedAt: workout.completedAt,
        };
        state[exercise.pattern] = {
          exerciseId: exercise.id,
          lastExerciseId: exercise.id,
          exposures: exerciseState.exposures,
          lastPerformedAt: workout.completedAt,
          exercises: { ...previousExercises, [exercise.id]: exerciseState },
        };
      });
    });
  Object.keys(state).forEach((pattern) => {
    if (now - state[pattern].lastPerformedAt > CONTINUITY_BREAK_DAYS * DAY) delete state[pattern];
  });
  return state;
}

export function getTrackedExerciseIds(history = [], limit = 6, now = Date.now()) {
  const tracked = new Map();
  history.filter((workout) => validCompletedWorkout(workout, now)).forEach((workout) => {
    (workout.exercises || []).forEach((item) => {
      if (!(item.sets || []).some((set) => set.done) || !exercises.some((exercise) => exercise.id === item.exerciseId)) return;
      const previous = tracked.get(item.exerciseId) || { sessions: 0, lastPerformedAt: 0 };
      tracked.set(item.exerciseId, { sessions: previous.sessions + 1, lastPerformedAt: Math.max(previous.lastPerformedAt, workout.completedAt) });
    });
  });
  return [...tracked.entries()]
    .sort(([, a], [, b]) => Number(b.sessions >= 2) - Number(a.sessions >= 2) || b.lastPerformedAt - a.lastPerformedAt)
    .slice(0, limit)
    .map(([exerciseId]) => exerciseId);
}

function percentChange(current, previous) {
  return Number(current) > 0 && Number(previous) > 0 ? (current - previous) / previous : null;
}

function summarizeSessions(sessions = []) {
  return {
    sessions: sessions.length,
    sets: sessions.reduce((sum, session) => sum + session.sets.length, 0),
    volume: sessions.reduce((sum, session) => sum + session.volume, 0),
    bestE1rm: Math.max(0, ...sessions.map((session) => session.bestE1rm || 0)) || null,
    maxReps: Math.max(0, ...sessions.map((session) => session.maxReps || 0)) || null,
    bestRepCapacity: Math.max(0, ...sessions.map((session) => session.estimatedMaxReps || 0)) || null,
  };
}

export function getExerciseAnalytics(history = [], exerciseIds = [], options = {}) {
  const now = Number(options.now) || Date.now();
  const currentWeekStart = now - 7 * DAY;
  const previousWeekStart = now - 14 * DAY;
  const uniqueIds = [...new Set(exerciseIds)].filter((id) => exercises.some((exercise) => exercise.id === id));

  const items = uniqueIds.map((exerciseId) => {
    const exercise = exercises.find((candidate) => candidate.id === exerciseId);
    const stats = getExerciseHistory(history, exerciseId, now);
    const current = summarizeSessions(stats.sessions.filter((session) => session.completedAt >= currentWeekStart && session.completedAt <= now));
    const previous = summarizeSessions(stats.sessions.filter((session) => session.completedAt >= previousWeekStart && session.completedAt < currentWeekStart));
    const currentStrength = stats.metric === 'e1rm' ? current.bestE1rm : current.bestRepCapacity;
    const previousStrength = stats.metric === 'e1rm' ? previous.bestE1rm : previous.bestRepCapacity;
    const first = stats.points[0]?.value ?? null;
    const latest = stats.points.at(-1)?.value ?? null;
    return {
      exerciseId,
      metric: stats.metric,
      stats,
      currentWeek: current,
      previousWeek: previous,
      weeklyStrengthChange: percentChange(currentStrength, previousStrength),
      overallStrengthChange: percentChange(latest, first),
      volumeChange: percentChange(current.volume, previous.volume),
      bestSessionVolume: Math.max(0, ...stats.sessions.map((session) => session.volume || 0)),
      loadType: exercise.loadType,
    };
  });

  const comparableStrength = items.map((item) => item.weeklyStrengthChange).filter((value) => value !== null);
  const currentVolume = items.reduce((sum, item) => sum + item.currentWeek.volume, 0);
  const previousVolume = items.reduce((sum, item) => sum + item.previousWeek.volume, 0);
  return {
    items,
    week: {
      trackedSessions: items.reduce((sum, item) => sum + item.currentWeek.sessions, 0),
      sets: items.reduce((sum, item) => sum + item.currentWeek.sets, 0),
      volume: currentVolume,
      previousVolume,
      volumeChange: percentChange(currentVolume, previousVolume),
      strengthChange: comparableStrength.length
        ? comparableStrength.reduce((sum, value) => sum + value, 0) / comparableStrength.length
        : null,
    },
  };
}

function scoreExercise(exercise, targets, profile, weeklyLoad, muscleStatus, continuity, chosen, random) {
  if (!targets.includes(exercise.primary)) return -1000;
  if (!isExerciseAllowed(exercise, profile)) return -1000;
  if (chosen.some((item) => item.pattern === exercise.pattern)) return -500;
  if (exercise.variationGroup && chosen.some((item) => item.variationGroup === exercise.variationGroup)) return -500;

  const defaultTargets = getWeeklyTargets(profile);
  const contributions = Object.entries(getExerciseMuscleContributions(exercise))
    .filter(([muscle]) => !muscleStatus[muscle]?.excluded);
  const contributionTotal = contributions.reduce((sum, [, contribution]) => sum + contribution, 0) || 1;
  const contributionAverage = (selector) => contributions.reduce(
    (sum, [muscle, contribution]) => sum + selector(muscle) * contribution,
    0,
  ) / contributionTotal;
  const volumeNeed = contributionAverage((muscle) => {
    const target = muscleStatus[muscle]?.targetStimulus || defaultTargets.sets;
    return clamp((target - (weeklyLoad.volume[muscle] || 0)) / target, 0, 1);
  });
  const frequencyNeed = contributionAverage((muscle) => clamp(
    (defaultTargets.frequency - (weeklyLoad.frequency[muscle] || 0)) / defaultTargets.frequency, 0, 1,
  ));
  const trainingPriority = contributionAverage((muscle) => getMuscleSelectionPriority(muscle, muscleStatus[muscle]));
  let score = trainingPriority * .45;
  score += volumeNeed * (profile.goal === 'muscle' ? 38 : 30);
  score += frequencyNeed * (profile.goal === 'strength' ? 28 : profile.goal === 'muscle' ? 17 : 24);
  score += exercise.compound && chosen.length < 3 ? 12 : 6;
  score += exercise.selectionPriority;
  score -= chosen.filter((item) => item.primary === exercise.primary).length * 18;
  if (!exercise.compound && chosen.some((item) => item.compound
    && Number(getExerciseMuscleContributions(item)[exercise.primary] || 0) >= .35)) {
    score -= 16;
  }
  const patternContinuity = continuity[exercise.pattern];
  const exerciseContinuity = patternContinuity?.exercises?.[exercise.id];
  if (exerciseContinuity) {
    score += exerciseContinuity.exposures < EXERCISE_ROTATION_EXPOSURES ? 20 : 0;
  }
  score += profile.preferences?.[exercise.id] === 'more' ? 12 : 0;
  score += profile.preferences?.[exercise.id] === 'less' ? -15 : 0;
  score += random() * 4;
  return score;
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function isReturningAfterBreak(history = [], now = Date.now()) {
  const lastWorkout = [...history]
    .filter((workout) => validCompletedWorkout(workout, now))
    .sort((a, b) => b.completedAt - a.completedAt)[0];
  return Boolean(lastWorkout && now - lastWorkout.completedAt > 10 * DAY);
}

function expectedUpcomingExposures(history, now) {
  const dates = history.filter((workout) => validCompletedWorkout(workout, now) && workout.completedAt >= now - 28 * DAY)
    .map((workout) => workout.completedAt).sort((a, b) => a - b);
  if (dates.length < 3) return 1;
  const gaps = dates.slice(1).map((date, index) => (date - dates[index]) / DAY);
  return median(gaps) <= 4 ? 2 : 1;
}

function auxiliaryTarget(profile, muscleStatus) {
  return ['core', 'calves']
    .filter((muscle) => !(muscle === 'core' && profile.exerciseFilters?.excludeDirectCore))
    .filter((muscle) => !(muscle === 'calves' && profile.exerciseFilters?.excludeCalves))
    .sort((a, b) => muscleStatus[b].priority - muscleStatus[a].priority)[0] || null;
}

function movementFamilyNeed(family, profile, weeklyLoad, movementFrequency, muscleStatus) {
  const weeklyTargets = getWeeklyTargets(profile);
  // Direct arm work is ranked later as complementary work. It must not dilute
  // the need of the large muscle that makes a movement family selectable.
  const relevantMuscles = (family.primaryMuscles || family.muscles).filter((muscle) => allMuscles.includes(muscle));
  const average = (selector) => relevantMuscles.reduce((sum, muscle) => sum + selector(muscle), 0) / relevantMuscles.length;
  const need = {
    priority: average((muscle) => getMuscleSelectionPriority(muscle, muscleStatus[muscle]) / 100),
    frequencyGap: Math.max(0, weeklyTargets.frequency - movementFrequency[family.id]),
    volumeGap: average((muscle) => muscleStatus[muscle]?.volumeNeed
      ?? clamp((weeklyTargets.sets - weeklyLoad.volume[muscle]) / weeklyTargets.sets, 0, 1)),
  };
  return {
    ...need,
    score: need.priority * .6 + need.volumeGap * .25
      + need.frequencyGap / Math.max(1, weeklyTargets.frequency) * .15,
  };
}

function compareMovementFamilyNeed(a, b, profile, weeklyLoad, movementFrequency, muscleStatus) {
  const needA = movementFamilyNeed(a, profile, weeklyLoad, movementFrequency, muscleStatus);
  const needB = movementFamilyNeed(b, profile, weeklyLoad, movementFrequency, muscleStatus);
  return needB.score - needA.score || a.id.localeCompare(b.id);
}

function getAvailableAdaptiveFamilies(profile, weeklyLoad, movementFrequency, muscleStatus, targetMinutes, avoidIds = new Set()) {
  const ranked = [...movementFamilies]
    .sort((a, b) => compareMovementFamilyNeed(a, b, profile, weeklyLoad, movementFrequency, muscleStatus));
  const available = ranked.filter((family) => exercises.some((exercise) => isPrimaryMovement(exercise)
    && !avoidIds.has(exercise.id)
    && family.patterns.includes(exercise.pattern)
    && isExerciseAllowed(exercise, profile)
    && isEssentialExercise(exercise, profile)));
  // Keep the complete urgency queue. Session composition decides how many
  // entries fit; truncating it here used to strand otherwise valid third
  // exercises and made the UI falsely report only two urgent families.
  return available;
}

function plannedFamiliesFromUrgencyQueue(families, targetMinutes) {
  const limit = getWorkoutCompositionLimits(targetMinutes).desiredPrimaryMovements;
  const selected = [];
  for (const family of families) {
    const lower = ['knee', 'hip'].includes(family.id);
    if (lower && selected.some((item) => ['knee', 'hip'].includes(item.id))) continue;
    selected.push(family);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function getAdaptiveTrainingOverview(profile, history = [], targetMinutes = profile?.duration || 45, now = Date.now()) {
  const muscleStatus = getMuscleTrainingStatus({ ...profile, duration: targetMinutes }, history, now);
  const doseLoad = {
    volume: Object.fromEntries(allMuscles.map((muscle) => [muscle, muscleStatus[muscle].doseStimulus])),
    frequency: Object.fromEntries(allMuscles.map((muscle) => [muscle, muscleStatus[muscle].doseExposures])),
  };
  const movementFrequency = getWeeklyMovementFrequency(history, now);
  const families = getAvailableAdaptiveFamilies(profile, doseLoad, movementFrequency, muscleStatus, targetMinutes)
    .map((family) => ({ ...family, need: movementFamilyNeed(family, profile, doseLoad, movementFrequency, muscleStatus) }));
  return { muscleStatus, families, plannedFamilies: plannedFamiliesFromUrgencyQueue(families, targetMinutes) };
}

export function getWorkoutCompositionLimits(targetMinutes = 45) {
  const minutes = Number(targetMinutes) || 45;
  if (minutes <= 30) return { maxExercises: 3, maxCompounds: 3, desiredPrimaryMovements: 2, desiredAccessories: 1 };
  if (minutes < 60) return { maxExercises: 6, maxCompounds: 3, desiredPrimaryMovements: 2, desiredAccessories: 2 };
  if (minutes <= 60) return { maxExercises: 7, maxCompounds: 3, desiredPrimaryMovements: 3, desiredAccessories: 2 };
  return { maxExercises: 8, maxCompounds: 3, desiredPrimaryMovements: 3, desiredAccessories: 3 };
}

function fitPrescriptionToMinutes(exercise, item, remainingMinutes) {
  const minimumSetCount = Math.min(item.sets.length, Math.max(1, Number(item.minimumTimeFitSets) || 1));
  for (let setCount = item.sets.length; setCount >= minimumSetCount; setCount -= 1) {
    const targetRirs = targetRirsForSetCount(item.targetRirs || [item.targetRir], setCount);
    const candidate = {
      ...item,
      targetRir: targetRirs.at(-1),
      targetRirs,
      sets: item.sets.slice(0, setCount).map((set, index) => ({
        ...set,
        targetRir: targetRirs[index],
      })),
    };
    if (estimatePrescriptionMinutes(exercise, candidate) <= remainingMinutes + .001) return candidate;
  }
  return null;
}

function sortedRecord(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
}

export function getWorkoutSettingsFingerprint(profile = {}) {
  return JSON.stringify({
    goal: profile.goal,
    level: profile.level,
    trainingStyle: validTrainingStyle(profile.trainingStyle),
    equipment: [...(profile.equipment || [])].sort(),
    duration: Number(profile.duration) || 45,
    targetRir: profile.targetRir,
    setCaps: sortedRecord(profile.setCaps),
    exerciseOverrides: sortedRecord(profile.exerciseOverrides),
    loadInventory: sortedRecord(profile.loadInventory),
    exerciseLoadInventory: sortedRecord(profile.exerciseLoadInventory),
    exerciseFilters: sortedRecord(profile.exerciseFilters),
    preferences: sortedRecord(profile.preferences),
  });
}

export function isPreparedWorkoutStale(workout, profile, history = [], now = Date.now()) {
  if (!workout || workout.completedAt || isWorkoutActive(workout)) return false;
  if (workout.engine?.version !== ENGINE_VERSION) return true;
  if (workout.engine?.settingsFingerprint !== getWorkoutSettingsFingerprint(profile)) return true;
  const createdAt = Number(workout.createdAt) || 0;
  if (!createdAt || Number(now) - createdAt > DAY) return true;
  return history.some((entry) => validCompletedWorkout(entry, now)
    && Number(entry.completedAt) > createdAt);
}

export function generateWorkout(profile, history = [], options = {}) {
  const now = Number(options.now) || Date.now();
  const targetMinutes = options.duration || profile.duration || 45;
  const muscleStatus = getMuscleTrainingStatus({ ...profile, duration: targetMinutes }, history, now);
  const weeklyLoad = getWeeklyMuscleLoad(history, now);
  const cycleLoad = {
    volume: Object.fromEntries(allMuscles.map((muscle) => [muscle, muscleStatus[muscle].cycleStimulus])),
    frequency: Object.fromEntries(allMuscles.map((muscle) => [muscle, muscleStatus[muscle].cycleExposures])),
  };
  const cycleLoadBeforeWorkout = {
    volume: { ...cycleLoad.volume },
    frequency: { ...cycleLoad.frequency },
  };
  const doseLoad = {
    volume: Object.fromEntries(allMuscles.map((muscle) => [muscle, muscleStatus[muscle].doseStimulus])),
    frequency: Object.fromEntries(allMuscles.map((muscle) => [muscle, muscleStatus[muscle].doseExposures])),
  };
  const doseLoadBeforeWorkout = {
    volume: { ...doseLoad.volume },
    frequency: { ...doseLoad.frequency },
  };
  const doseMovementFrequency = getWeeklyMovementFrequency(history, now);
  let targets = options.targets || targetMuscles();
  const continuity = getExerciseContinuity(history, now);
  const avoidIds = new Set(options.avoidExerciseIds || []);
  const returningFromBreak = isReturningAfterBreak(history, now);
  const prescriptionContext = {
    weeklyLoad: doseLoad,
    muscleStatus,
    targetMinutes,
    returningFromBreak,
    expectedUpcomingExposures: expectedUpcomingExposures(history, now),
    now,
    targetMuscles: targets,
  };
  let requiredFamilies = movementFamilies.filter((family) => family.muscles.some((muscle) => targets.includes(muscle)));
  if (!options.targets) {
    requiredFamilies = getAvailableAdaptiveFamilies(profile, doseLoad, doseMovementFrequency, muscleStatus, targetMinutes, avoidIds);
    targets = [...new Set(requiredFamilies.flatMap((family) => family.muscles))];
    const auxiliary = targetMinutes >= 40 ? auxiliaryTarget(profile, muscleStatus) : null;
    if (auxiliary) targets.push(auxiliary);
  }
  prescriptionContext.targetMuscles = targets;
  const accessoryTargets = [...new Set([...targets, 'biceps', 'triceps'])]
    .filter((muscle) => !muscleStatus[muscle]?.excluded);
  const chosen = [];
  const prescriptions = new Map();
  const plannedExposureMuscles = new Set();
  const random = seededRandom(now + (options.variation || 0));
  const compositionLimits = getWorkoutCompositionLimits(targetMinutes);
  const { maxExercises, maxCompounds, desiredPrimaryMovements } = compositionLimits;
  const plannedFamilies = [];
  const unavailableMovementFamilies = [];
  let usedMinutes = 7;
  let maintenanceMode = false;

  const addExercise = (exercise, allowMaintenance = false, exerciseTargets = targets, guaranteeMinimum = false) => {
    const prescribed = prescription(exercise, profile, history, {
      ...prescriptionContext,
      allowMaintenance,
      targetMuscles: exerciseTargets,
    });
    if (!prescribed.sets.length) return false;
    const item = guaranteeMinimum
      ? prescribed
      : fitPrescriptionToMinutes(
        exercise,
        prescribed,
        targetMinutes + SESSION_TIME_TOLERANCE_MINUTES - usedMinutes,
      );
    if (!item) return false;
    chosen.push(exercise);
    prescriptions.set(exercise.id, item);
    Object.entries(getExerciseMuscleContributions(exercise)).forEach(([muscle, contribution]) => {
      doseLoad.volume[muscle] = (doseLoad.volume[muscle] || 0) + item.sets.length * contribution;
      if (!plannedExposureMuscles.has(muscle) && item.sets.length * contribution >= .75) {
        doseLoad.frequency[muscle] = (doseLoad.frequency[muscle] || 0) + 1;
        plannedExposureMuscles.add(muscle);
      }
    });
    usedMinutes += estimatePrescriptionMinutes(exercise, item);
    return true;
  };

  const rankCandidates = (patterns = null, scoringTargets = targets) => {
    const eligible = exercises
    .filter((exercise) => profile.preferences?.[exercise.id] !== 'exclude' && !chosen.some((item) => item.id === exercise.id))
    .filter((exercise) => isExerciseAllowed(exercise, profile))
    .filter((exercise) => isEssentialExercise(exercise, profile))
    .filter((exercise) => !avoidIds.has(exercise.id))
    .filter((exercise) => {
      if (!isLowerBodyExercise(exercise)) return true;
      const currentLowerBodyCount = chosen.filter(isLowerBodyExercise).length;
      return currentLowerBodyCount < 1;
    })
    .filter((exercise) => !patterns || patterns.includes(exercise.pattern));
    const varied = eligible.filter((exercise) => {
      const patternState = continuity[exercise.pattern];
      const repeatedRecently = patternState?.lastExerciseId === exercise.id
        && now - patternState.lastPerformedAt <= RECENT_VARIATION_DAYS * DAY;
      if (!repeatedRecently) return true;
      return !eligible.some((alternative) => alternative.pattern === exercise.pattern && alternative.id !== exercise.id);
    });
    // Prefer another plane of motion within the same family before swapping
    // grips or machines inside the recently trained pattern. Matching the
    // compound/accessory class prevents an isolation candidate from emptying
    // the main-movement pool. If no complement is compatible, normal
    // same-pattern rotation remains available.
    const complementary = patterns?.length > 1 ? varied.filter((exercise) => {
      const patternWasRecent = now - Number(continuity[exercise.pattern]?.lastPerformedAt || 0) <= RECENT_VARIATION_DAYS * DAY;
      if (!patternWasRecent) return true;
      return !varied.some((alternative) => alternative.compound === exercise.compound
        && alternative.primary === exercise.primary
        && alternative.pattern !== exercise.pattern
        && now - Number(continuity[alternative.pattern]?.lastPerformedAt || 0) > RECENT_VARIATION_DAYS * DAY);
    }) : varied;
    const complementaryPool = complementary.length ? complementary : varied;
    const rotationEligible = complementaryPool.filter((exercise) => {
      const exposures = continuity[exercise.pattern]?.exercises?.[exercise.id]?.exposures || 0;
      if (exposures < EXERCISE_ROTATION_EXPOSURES) return true;
      return !complementaryPool.some((alternative) => alternative.pattern === exercise.pattern
        && alternative.id !== exercise.id
        && (continuity[alternative.pattern]?.exercises?.[alternative.id]?.exposures || 0) < EXERCISE_ROTATION_EXPOSURES);
    });
    const pool = rotationEligible.length ? rotationEligible : complementaryPool.length ? complementaryPool : eligible;
    return pool.map((exercise) => ({ exercise, score: scoreExercise(exercise, scoringTargets, profile, doseLoad, muscleStatus, continuity, chosen, random) }))
    .filter((item) => item.score > -100)
    .sort((a, b) => b.score - a.score);
  };

  const wasUsedRecently = (exercise) => Object.values(continuity).some((patternState) => (
    now - Number(patternState.exercises?.[exercise.id]?.lastPerformedAt || 0) <= RECENT_VARIATION_DAYS * DAY
  ));
  const rankAccessoryCandidates = () => {
    const ranked = rankCandidates(null, accessoryTargets)
      .filter(({ exercise }) => !isPrimaryMovement(exercise))
      .filter(({ exercise }) => {
        if (['biceps', 'triceps', 'core', 'calves'].includes(exercise.primary)) return true;
        const family = getMovementFamily(exercise);
        return !family || chosen.some((selected) => isPrimaryMovement(selected) && getMovementFamily(selected) === family);
      });
    const fresh = ranked.filter(({ exercise }) => !wasUsedRecently(exercise));
    // An exact accessory is not repeated in the same seven-day window merely
    // because its pattern has no near-identical substitute. Rotate to another
    // useful accessory; repeat only when no compatible fresh option exists.
    return fresh.length ? fresh : ranked;
  };

  requiredFamilies.forEach((family) => {
    if (plannedFamilies.length >= Math.min(maxCompounds, desiredPrimaryMovements)) return;
    if (chosen.filter(isPrimaryMovement).length >= Math.min(maxCompounds, desiredPrimaryMovements)) return;
    if (chosen.some((exercise) => getMovementFamily(exercise) === family.id)) return;
    const compatibleCompounds = rankCandidates(family.patterns)
      .map(({ exercise }) => exercise)
      .filter(isPrimaryMovement);
    if (!compatibleCompounds.length) {
      const hasCompatibleExercise = exercises.some((exercise) => isPrimaryMovement(exercise)
        && family.patterns.includes(exercise.pattern)
        && targets.includes(exercise.primary)
        && isExerciseAllowed(exercise, profile)
        && isEssentialExercise(exercise, profile));
      if (!hasCompatibleExercise) unavailableMovementFamilies.push(family.id);
      return;
    }
    if (compatibleCompounds.some((exercise) => addExercise(exercise))) plannedFamilies.push(family);
  });

  // Composition is a hard ordering rule, not merely a scoring preference.
  // In particular, a short session must reserve its scarce slots for useful
  // primary movements before chest/arm isolations are allowed to fill it.
  // If the normal adaptive dose is already covered, use the minimum
  // maintenance dose for the next urgent compatible family instead of
  // returning an accessory-only workout.
  const minimumPrimaryMovements = Math.min(desiredPrimaryMovements, maxExercises);
  while (chosen.filter(isPrimaryMovement).length < minimumPrimaryMovements) {
    const primaryFallbacks = requiredFamilies
      .flatMap((family) => rankCandidates(family.patterns).map((candidate) => ({ ...candidate, family })))
      .filter(({ exercise }) => isPrimaryMovement(exercise))
      .sort((a, b) => b.score - a.score);
    const next = primaryFallbacks[0];
    if (!next) break;
    if (!addExercise(next.exercise, true, targets)) {
      avoidIds.add(next.exercise.id);
      continue;
    }
    maintenanceMode = true;
    if (!plannedFamilies.some((family) => family.id === next.family.id)) plannedFamilies.push(next.family);
  }

  while (chosen.filter((exercise) => !isPrimaryMovement(exercise)).length < compositionLimits.desiredAccessories
    && chosen.length < maxExercises) {
    const ranked = rankAccessoryCandidates();
    if (!ranked.length) break;
    const next = ranked[0].exercise;
    const nextItem = prescription(next, profile, history, { ...prescriptionContext, targetMuscles: accessoryTargets });
    if (!nextItem.sets.length) {
      avoidIds.add(next.id);
      continue;
    }
    if (!addExercise(next, false, accessoryTargets)) {
      avoidIds.add(next.id);
      continue;
    }
  }

  while (usedMinutes < targetMinutes - 2 && chosen.length < maxExercises) {
    const ranked = rankAccessoryCandidates();
    if (!ranked.length) break;
    const next = ranked[0].exercise;
    const nextItem = prescription(next, profile, history, { ...prescriptionContext, targetMuscles: accessoryTargets });
    if (!nextItem.sets.length) {
      avoidIds.add(next.id);
      continue;
    }
    if (!addExercise(next, false, accessoryTargets)) break;
  }

  // Two movements do not make a useful normal session. If the adaptive dose
  // is already covered, add one compatible maintenance accessory rather than
  // returning an accidentally truncated workout. Equipment, lower-body and
  // time guards are still enforced.
  const minimumExerciseCount = Math.min(3, maxExercises);
  while (chosen.length < minimumExerciseCount) {
    const ranked = rankAccessoryCandidates();
    const fallbackPrimaries = requiredFamilies
      .flatMap((family) => rankCandidates(family.patterns))
      .filter(({ exercise }) => isPrimaryMovement(exercise));
    const next = (ranked[0] || fallbackPrimaries[0])?.exercise;
    if (!next) break;
    const wasEmpty = chosen.length === 0;
    if (!addExercise(next, true, accessoryTargets, true)) {
      avoidIds.add(next.id);
      continue;
    }
    if (wasEmpty) maintenanceMode = true;
  }

  if (!chosen.length) {
    const fallbackPool = exercises
      .filter((exercise) => isExerciseAllowed(exercise, profile) && isEssentialExercise(exercise, profile))
      .filter((exercise) => targets.includes(exercise.primary));
    const preferredFallbacks = fallbackPool.filter((exercise) => targets.includes(exercise.primary));
    const fallback = (preferredFallbacks.length ? preferredFallbacks : fallbackPool)
      .sort((a, b) => Number(isPrimaryMovement(b)) - Number(isPrimaryMovement(a)) || b.selectionPriority - a.selectionPriority)[0];
    if (fallback) {
      maintenanceMode = addExercise(fallback, true);
      const family = movementFamilies.find((candidate) => candidate.id === getMovementFamily(fallback));
      if (family) plannedFamilies.push(family);
    }
  }

  const weeklyTargets = getWeeklyTargets(profile);
  const coveredMovementFamilies = [...new Set(chosen.map((exercise) => getMovementFamily(exercise)).filter(Boolean))];
  const compoundCount = chosen.filter((exercise) => exercise.compound).length;
  const primaryMovementCount = chosen.filter(isPrimaryMovement).length;

  return {
    id: `workout-${now}-${Math.round((options.variation || 0) * 1000)}`,
    createdAt: now,
    duration: targetMinutes,
    targetMuscles: [...new Set(chosen.map((exercise) => exercise.primary))],
    exercises: chosen.map((exercise) => prescriptions.get(exercise.id)),
    engine: {
      version: ENGINE_VERSION,
      weeklyVolumeBeforeWorkout: weeklyLoad.volume,
      weeklyFrequencyBeforeWorkout: weeklyLoad.frequency,
      cycleStimulusBeforeWorkout: cycleLoadBeforeWorkout.volume,
      cycleFrequencyBeforeWorkout: cycleLoadBeforeWorkout.frequency,
      doseStimulusBeforeWorkout: doseLoadBeforeWorkout.volume,
      doseFrequencyBeforeWorkout: doseLoadBeforeWorkout.frequency,
      weeklyMovementFrequencyBeforeWorkout: doseMovementFrequency,
      weeklyTargets,
      muscleStatusAtGeneration: muscleStatus,
      movementFamilies: plannedFamilies.map((family) => family.id),
      composition: {
        compounds: compoundCount,
        primaryMovements: primaryMovementCount,
        accessories: chosen.length - primaryMovementCount,
        lowerBody: chosen.filter(isLowerBodyExercise).length,
        ...compositionLimits,
      },
      settingsFingerprint: getWorkoutSettingsFingerprint(profile),
      returningFromBreak,
      unavailableMovementFamilies: [...new Set(unavailableMovementFamilies.filter((family) => !coveredMovementFamilies.includes(family)))],
      maintenanceMode,
      estimatedMinutes: Math.round(usedMinutes),
      timeToleranceMinutes: SESSION_TIME_TOLERANCE_MINUTES,
      evidenceProfile: 'V39-PRIMARY-FIRST-COMPOSITION',
    },
  };
}

function conservativeUnfinishedValue(previous, generated, targetKey, valueKey) {
  const numeric = (value) => value === null || value === undefined || value === '' ? null : Number(value);
  const previousValue = numeric(previous?.[valueKey]);
  const generatedValue = numeric(generated?.[valueKey]);
  const previousTarget = numeric(previous?.[targetKey]);
  const manuallyChanged = previousValue !== null && Number.isFinite(previousValue)
    && (previousTarget === null || !Number.isFinite(previousTarget) || Math.abs(previousValue - previousTarget) > .001);
  if (manuallyChanged) return previousValue;
  if (previousValue === null || !Number.isFinite(previousValue)) return generatedValue !== null && Number.isFinite(generatedValue) ? generatedValue : generated?.[valueKey] ?? null;
  if (generatedValue === null || !Number.isFinite(generatedValue)) return previousValue;
  return Math.min(previousValue, generatedValue);
}

function mergeCurrentExercise(previous, generated) {
  const hasProtectedState = previous.sets.some((set) => set.done
    || set.rir != null
    || (set.weight != null && Number(set.weight) !== Number(set.targetWeight))
    || (set.reps != null && Number(set.reps) !== Number(set.targetReps)));
  const setCount = hasProtectedState
    ? Math.max(previous.sets.length, generated.sets.length)
    : generated.sets.length;
  const sets = Array.from({ length: setCount }, (_, index) => {
    const oldSet = previous.sets[index];
    const newSet = generated.sets[index] || generated.sets.at(-1);
    if (oldSet?.done) return oldSet;
    if (!oldSet) return { ...newSet };
    return {
      ...newSet,
      weight: conservativeUnfinishedValue(oldSet, newSet, 'targetWeight', 'weight'),
      reps: conservativeUnfinishedValue(oldSet, newSet, 'targetReps', 'reps'),
      rir: oldSet.rir ?? null,
      done: false,
    };
  });
  return {
    ...generated,
    sets,
    targetRirs: sets.map((set) => set.targetRir),
    targetRir: sets.at(-1)?.targetRir ?? generated.targetRir,
  };
}

export function migrateWorkoutToCurrentEngine(workout, profile, history = [], now = Date.now()) {
  if (!workout || workout.completedAt || workout.engine?.version === ENGINE_VERSION) return workout;
  if (!isCompatibleWorkout(workout, profile)) return null;
  const targets = [...new Set((workout.targetMuscles || []).filter((muscle) => allMuscles.includes(muscle)))];
  const generated = generateWorkout(profile, history, {
    duration: workout.duration || profile.duration,
    variation: Number(workout.createdAt) || Number(now),
    now,
    ...(targets.length ? { targets } : {}),
  });
  if (!generated.exercises.length) return workout;

  const previousById = new Map(workout.exercises.map((item) => [item.exerciseId, item]));
  const migratedExercises = generated.exercises.map((item) => {
    const previous = previousById.get(item.exerciseId);
    return previous ? mergeCurrentExercise(previous, item) : item;
  });

  workout.exercises.forEach((previous, previousIndex) => {
    if (!previous.sets.some((set) => set.done)) return;
    if (migratedExercises.some((item) => item.exerciseId === previous.exerciseId)) return;
    const previousExercise = resolveRecordedExercise(previous);
    const samePatternIndex = migratedExercises.findIndex((item) => (
      resolveRecordedExercise(item)?.pattern === previousExercise?.pattern
    ));
    if (samePatternIndex >= 0) migratedExercises[samePatternIndex] = previous;
    else migratedExercises.splice(Math.min(previousIndex, migratedExercises.length), 0, previous);
  });

  const migrated = rebuildWorkoutMetadata({
    ...generated,
    id: workout.id,
    createdAt: workout.createdAt || generated.createdAt,
    startedAt: workout.startedAt,
    pausedAt: workout.pausedAt,
    pausedDurationMs: Number(workout.pausedDurationMs || 0),
    restEndsAt: workout.restEndsAt,
    restDuration: workout.restDuration,
    exercises: migratedExercises,
    engine: {
      ...generated.engine,
      migratedFromVersion: workout.engine?.version ?? null,
      migratedAt: Number(now),
    },
  });
  return isCompatibleWorkout(migrated, profile) ? migrated : workout;
}

export function generateWorkoutAlternatives(profile, history, workout, { seed = Date.now(), now = Date.now(), limit = 3 } = {}) {
  if (!workout?.exercises?.length) return [];
  const oldExerciseIds = workout.exercises.map((item) => item.exerciseId);
  const oldSignature = [...oldExerciseIds].sort().join('|');
  const minimumExerciseCount = Math.min(3, getWorkoutCompositionLimits(workout.duration || profile.duration || 45).maxExercises);
  const requestedMinutes = Number(workout.duration || profile.duration || 45);
  const currentEstimatedMinutes = Number(workout.engine?.estimatedMinutes || requestedMinutes);
  const minimumEstimatedMinutes = Math.min(requestedMinutes * .75, currentEstimatedMinutes * .85);
  const reference = generateWorkout(profile, history, { duration: workout.duration, variation: seed, now });
  const requiredFamilySignature = [...(reference.engine?.movementFamilies || [])].sort().join('|');
  const alternatives = [];
  const signatures = new Set([oldSignature]);
  for (let attempt = 0; attempt < 18 && alternatives.length < limit; attempt += 1) {
    const avoidPrevious = attempt < 8;
    const candidate = generateWorkout(profile, history, {
      duration: workout.duration,
      variation: seed + attempt * 997,
      now,
      ...(avoidPrevious ? { avoidExerciseIds: oldExerciseIds } : {}),
    });
    if (!isCompatibleWorkout(candidate, profile)
      || candidate.exercises.length < minimumExerciseCount
      || Number(candidate.engine?.estimatedMinutes || 0) < minimumEstimatedMinutes
      || candidate.engine?.unavailableMovementFamilies?.length
      || [...(candidate.engine?.movementFamilies || [])].sort().join('|') !== requiredFamilySignature) continue;
    const signature = candidate.exercises.map((item) => item.exerciseId).sort().join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    alternatives.push(candidate);
  }
  return alternatives;
}

export function rebuildWorkoutMetadata(workout) {
  if (!workout?.exercises) return workout;
  const selected = workout.exercises
    .map(resolveRecordedExercise)
    .filter(Boolean);
  const compositionLimits = getWorkoutCompositionLimits(workout.duration);
  const movementFamilyIds = [...new Set(selected.map(getMovementFamily).filter(Boolean))];
  const estimatedMinutes = 7 + workout.exercises.reduce((sum, item) => {
    const exercise = resolveRecordedExercise(item);
    return exercise ? sum + estimatePrescriptionMinutes(exercise, item) : sum;
  }, 0);
  return {
    ...workout,
    targetMuscles: [...new Set(selected.map((exercise) => exercise.primary))],
    engine: {
      ...(workout.engine || {}),
      movementFamilies: movementFamilyIds,
      composition: {
        compounds: selected.filter((exercise) => exercise.compound).length,
        primaryMovements: selected.filter(isPrimaryMovement).length,
        accessories: selected.filter((exercise) => !isPrimaryMovement(exercise)).length,
        lowerBody: selected.filter(isLowerBodyExercise).length,
        ...compositionLimits,
      },
      estimatedMinutes: Math.round(estimatedMinutes),
    },
  };
}

export function getSimilarExercises(workout, exerciseId, profile, options = {}) {
  const current = exercises.find((item) => item.id === exerciseId);
  if (!current) return [];
  const targetMuscle = current.primary;
  const used = workout.exercises
    .filter((item) => item.exerciseId !== exerciseId)
    .map((item) => exercises.find((exercise) => exercise.id === item.exerciseId));
  const broadCandidates = exercises
    .filter((exercise) => exercise.id !== exerciseId
      && Number(getExerciseMuscleContributions(exercise)[targetMuscle] || 0) > 0)
    .filter((exercise) => isExerciseAllowed(exercise, profile))
    .filter((exercise) => !used.some((item) => item?.id === exercise.id || getExerciseVariantKey(item) === getExerciseVariantKey(exercise)))
    .sort((a, b) => {
      const replacementTier = (exercise) => exercise.pattern === current.pattern ? 0 : exercise.primary === targetMuscle ? 1 : 2;
      const tierDifference = replacementTier(a) - replacementTier(b);
      const roleDifference = Number(b.sessionRole === current.sessionRole) - Number(a.sessionRole === current.sessionRole);
      const compoundDifference = Number(b.compound === current.compound) - Number(a.compound === current.compound);
      const contributionDifference = Number(getExerciseMuscleContributions(b)[targetMuscle] || 0)
        - Number(getExerciseMuscleContributions(a)[targetMuscle] || 0);
      return tierDifference || roleDifference || compoundDifference || contributionDifference
        || canonicalScore(b, profile) - canonicalScore(a, profile) || a.name.localeCompare(b.name);
    });
  return broadCandidates;
}

export function replaceExercise(workout, exerciseId, profile, history = [], replacementId = null) {
  const current = exercises.find((item) => item.id === exerciseId);
  if (!current) return workout;
  const alternatives = getSimilarExercises(workout, exerciseId, profile, { includeVariants: true });
  if (!alternatives.length) return workout;
  const replacement = replacementId
    ? alternatives.find((exercise) => exercise.id === replacementId)
    : alternatives[0];
  if (!replacement) return workout;
  const measuredWeeklyLoad = getWeeklyMuscleLoad(history);
  const prescriptionContext = {
    targetMinutes: workout.duration || profile.duration || 45,
    weeklyLoad: {
      volume: workout.engine?.doseStimulusBeforeWorkout || workout.engine?.cycleStimulusBeforeWorkout || workout.engine?.weeklyVolumeBeforeWorkout || measuredWeeklyLoad.volume,
      frequency: workout.engine?.doseFrequencyBeforeWorkout || workout.engine?.cycleFrequencyBeforeWorkout || workout.engine?.weeklyFrequencyBeforeWorkout || measuredWeeklyLoad.frequency,
    },
    muscleStatus: workout.engine?.muscleStatusAtGeneration || getMuscleTrainingStatus(profile, history),
    returningFromBreak: workout.engine?.returningFromBreak || isReturningAfterBreak(history),
  };
  const currentItem = workout.exercises.find((item) => item.exerciseId === exerciseId);
  const replacementItem = prescription(replacement, profile, history, { ...prescriptionContext, allowMaintenance: true });
  const replacementLimits = getExercisePrescription(profile, replacement);
  const desiredSetCount = Math.min(
    replacementLimits.maxSets,
    Math.max(1, currentItem?.sets?.length || replacementItem.sets.length),
  );
  const template = replacementItem.sets[0];
  const alignedReplacement = {
    ...replacementItem,
    sets: Array.from({ length: desiredSetCount }, (_, index) => replacementItem.sets[index] || { ...template }),
  };
  return rebuildWorkoutMetadata({
    ...workout,
    exercises: workout.exercises.map((item) => item.exerciseId === exerciseId
      ? alignedReplacement
      : item),
  });
}

export function removeExercise(workout, exerciseId) {
  if (!workout?.exercises || workout.exercises.length <= 1) return workout;
  const remaining = workout.exercises.filter((item) => item.exerciseId !== exerciseId);
  return rebuildWorkoutMetadata({
    ...workout,
    exercises: remaining,
  });
}

export function getAddableExercises(workout, profile) {
  if (!workout?.exercises || workout.exercises.length >= 8) return [];
  const used = workout.exercises.map(resolveRecordedExercise).filter(Boolean);
  const hasLower = used.some(isLowerBodyExercise);
  return exercises
    .filter((exercise) => profile.preferences?.[exercise.id] !== 'exclude')
    .filter((exercise) => isExerciseAllowed(exercise, profile) && isEssentialExercise(exercise, profile))
    .filter((exercise) => !used.some((item) => item.id === exercise.id || getExerciseVariantKey(item) === getExerciseVariantKey(exercise)))
    .filter((exercise) => !hasLower || !isLowerBodyExercise(exercise))
    .sort((a, b) => Number(workout.targetMuscles?.includes(b.primary)) - Number(workout.targetMuscles?.includes(a.primary))
      || Number(isPrimaryMovement(b)) - Number(isPrimaryMovement(a))
      || b.selectionPriority - a.selectionPriority
      || a.name.localeCompare(b.name));
}

export function addExerciseToWorkout(workout, exerciseId, profile, history = [], now = Date.now()) {
  const exercise = getAddableExercises(workout, profile).find((candidate) => candidate.id === exerciseId);
  if (!exercise) return workout;
  const measured = getWeeklyMuscleLoad(history, now);
  const plannedVolume = {
    ...(workout.engine?.doseStimulusBeforeWorkout || workout.engine?.cycleStimulusBeforeWorkout || measured.volume),
  };
  const plannedFrequency = {
    ...(workout.engine?.doseFrequencyBeforeWorkout || workout.engine?.cycleFrequencyBeforeWorkout || measured.frequency),
  };
  workout.exercises.forEach((item) => {
    const currentExercise = resolveRecordedExercise(item);
    if (!currentExercise) return;
    Object.entries(getExerciseMuscleContributions(currentExercise)).forEach(([muscle, contribution]) => {
      plannedVolume[muscle] = (plannedVolume[muscle] || 0) + item.sets.length * contribution;
      if (item.sets.length * contribution >= .75) plannedFrequency[muscle] = (plannedFrequency[muscle] || 0) + 1;
    });
  });
  const item = prescription(exercise, profile, history, {
    targetMinutes: workout.duration || profile.duration || 45,
    weeklyLoad: { volume: plannedVolume, frequency: plannedFrequency },
    muscleStatus: workout.engine?.muscleStatusAtGeneration || getMuscleTrainingStatus(profile, history, now),
    returningFromBreak: workout.engine?.returningFromBreak || isReturningAfterBreak(history, now),
    expectedUpcomingExposures: expectedUpcomingExposures(history, now),
    targetMuscles: [exercise.primary],
    allowMaintenance: true,
    now,
  });
  if (!item.sets.length) return workout;
  return rebuildWorkoutMetadata({
    ...workout,
    exercises: [...workout.exercises, item],
    engine: { ...(workout.engine || {}), manuallyEdited: true },
  });
}

function recalculateItemRirs(item, count, profile, exercise) {
  const prescribed = profile && exercise
    ? getExercisePrescription(profile, exercise).targetRirs
    : item.targetRirs || item.sets.map((set) => set.targetRir ?? item.targetRir ?? 2);
  return targetRirsForSetCount(prescribed, count);
}

export function addWorkoutSet(item, profile = null, exercise = null) {
  if (!item?.sets?.length || item.sets.length >= 6) return item;
  const source = item.sets.at(-1);
  const targetRirs = recalculateItemRirs(item, item.sets.length + 1, profile, exercise);
  const targetRir = targetRirs.at(-1);
  const nextSet = {
    ...source,
    targetRir,
    reps: Number(source.reps ?? source.targetReps) || 0,
    weight: source.weight ?? source.targetWeight ?? null,
    rir: null,
    done: false,
  };
  const sets = [...item.sets, nextSet].map((set, index) => set.done ? set : { ...set, targetRir: targetRirs[index] });
  return { ...item, sets, targetRirs, targetRir: targetRirs.at(-1) };
}

export function removeWorkoutSet(item, profile = null, exercise = null) {
  if (!item?.sets?.length || item.sets.length <= 1 || item.sets.at(-1).done) return item;
  const remaining = item.sets.slice(0, -1);
  const targetRirs = recalculateItemRirs(item, remaining.length, profile, exercise);
  const sets = remaining.map((set, index) => set.done ? set : { ...set, targetRir: targetRirs[index] });
  return { ...item, sets, targetRirs, targetRir: targetRirs.at(-1) ?? sets.at(-1).targetRir };
}
