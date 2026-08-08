import { exercises, muscles } from '../data/exercises.js';

const allMuscles = Object.keys(muscles);
const DAY = 864e5;

export const trainingRules = {
  strength: {
    weeklySets: 6,
    compound: { sets: 3, reps: 5, intensity: 0.82, rest: 180 },
    accessory: { sets: 2, reps: 8, intensity: 0.72, rest: 90 },
    targetRir: 2,
  },
  muscle: {
    weeklySets: 10,
    compound: { sets: 3, reps: 8, intensity: 0.72, rest: 120 },
    accessory: { sets: 3, reps: 12, intensity: 0.65, rest: 75 },
    targetRir: 2,
  },
  fitness: {
    weeklySets: 6,
    compound: { sets: 2, reps: 12, intensity: 0.60, rest: 75 },
    accessory: { sets: 2, reps: 15, intensity: 0.55, rest: 60 },
    targetRir: 3,
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const levelVolumeMultiplier = { beginner: 0.7, intermediate: 1, advanced: 1.2 };

function plannedWeeklyFrequency(profile, weeklyDays) {
  if (profile.split === 'full') return weeklyDays;
  if (profile.split === 'upper-lower') return Math.max(1, Math.round(weeklyDays / 2));
  if (profile.split === 'ppl') return Math.max(1, Math.round(weeklyDays / 3));
  if (weeklyDays <= 3) return weeklyDays;
  return weeklyDays === 4 ? 2 : 3;
}

export function getWeeklyTargets(profile) {
  const rule = trainingRules[profile.goal] || trainingRules.muscle;
  const weeklyDays = clamp(Number(profile.weeklyDays) || 3, 2, 6);
  return {
    sets: clamp(Math.round(rule.weeklySets * (levelVolumeMultiplier[profile.level] || 1)), 4, 14),
    frequency: plannedWeeklyFrequency(profile, weeklyDays),
    weeklyDays,
  };
}

export const movementFamilies = [
  { id: 'push', patterns: ['horizontal-push', 'vertical-push'], muscles: ['chest', 'shoulders', 'triceps'] },
  { id: 'pull', patterns: ['horizontal-pull', 'vertical-pull'], muscles: ['back', 'biceps'] },
  { id: 'knee', patterns: ['squat', 'single-leg', 'knee-extension'], muscles: ['quads'] },
  { id: 'hip', patterns: ['hinge', 'hip-extension', 'knee-flexion'], muscles: ['hamstrings', 'glutes'] },
];

export function getMovementFamily(exercise) {
  return movementFamilies.find((family) => family.patterns.includes(exercise?.pattern))?.id || null;
}

export function willCompleteExercise(sets = [], setIndex) {
  return sets.length > 0 && sets.every((set, index) => index === setIndex || set.done);
}

export function estimateOneRepMax(weight, reps, rir = 0) {
  if (!Number.isFinite(Number(weight)) || Number(weight) <= 0 || !Number.isFinite(Number(reps)) || Number(reps) <= 0) return null;
  const recordedRir = rir === null || rir === undefined || rir === '' ? 2 : Number(rir);
  const effectiveReps = clamp(Number(reps) + (Number.isFinite(recordedRir) ? recordedRir : 2), 1, 30);
  return effectiveReps <= 10
    ? Number(weight) * (36 / (37 - effectiveReps))
    : Number(weight) * (1 + effectiveReps / 30);
}

function calibrationSets(completedSets) {
  const withRecordedRir = completedSets.filter((set) => set.rir !== null && set.rir !== undefined && set.rir !== '');
  return withRecordedRir.length ? withRecordedRir : completedSets;
}

export function getExerciseProgress(history = [], exerciseId) {
  const sessions = history
    .filter((workout) => workout.completedAt)
    .map((workout) => ({
      completedAt: workout.completedAt,
      item: workout.exercises.find((entry) => entry.exerciseId === exerciseId),
    }))
    .filter(({ item }) => item)
    .map(({ completedAt, item }) => {
      const completed = item.sets.filter((set) => set.done);
      const calibrated = calibrationSets(completed);
      const estimates = calibrated
        .map((set) => estimateOneRepMax(set.weight, set.reps, set.rir))
        .filter(Boolean);
      return {
        completedAt,
        e1rm: estimates.length ? Math.max(...estimates) : null,
        lastWeight: [...completed].reverse().find((set) => Number(set.weight) > 0)?.weight ?? null,
        repCapacity: Math.max(...calibrated.map((set) => {
          const rir = set.rir == null ? 2 : Number(set.rir);
          return Number(set.reps) + (Number.isFinite(rir) ? rir : 2);
        })),
        completedSets: completed.length,
      };
    })
    .filter((session) => session.completedSets)
    .sort((a, b) => a.completedAt - b.completedAt);

  const latest = sessions.at(-1);
  const previous = sessions.at(-2);
  return {
    sessions: sessions.length,
    latestE1rm: latest?.e1rm ?? null,
    bestE1rm: Math.max(0, ...sessions.map((session) => session.e1rm || 0)) || null,
    lastWeight: latest?.lastWeight ?? null,
    latestRepCapacity: latest?.repCapacity ?? null,
    trend: latest?.e1rm && previous?.e1rm ? (latest.e1rm - previous.e1rm) / previous.e1rm : null,
  };
}

export function getExerciseHistory(history = [], exerciseId) {
  const sessions = history
    .filter((workout) => workout.completedAt)
    .map((workout) => {
      const item = workout.exercises.find((entry) => entry.exerciseId === exerciseId);
      const sets = item?.sets.filter((set) => set.done) || [];
      if (!sets.length) return null;
      const estimates = calibrationSets(sets)
        .map((set) => estimateOneRepMax(set.weight, set.reps, set.rir))
        .filter(Boolean);
      const weightedSets = sets.filter((set) => Number(set.weight) > 0);
      return {
        workoutId: workout.id,
        completedAt: workout.completedAt,
        duration: workout.duration,
        sets,
        isFocus: Boolean(item.isFocus),
        bestE1rm: estimates.length ? Math.max(...estimates) : null,
        maxWeight: weightedSets.length ? Math.max(...weightedSets.map((set) => Number(set.weight))) : null,
        maxReps: Math.max(...sets.map((set) => Number(set.reps) || 0)),
        volume: weightedSets.reduce((sum, set) => sum + Number(set.weight) * Number(set.reps || 0), 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.completedAt - b.completedAt);

  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  const metric = ['external', 'per-dumbbell'].includes(exercise?.loadType) ? 'e1rm' : 'reps';
  const points = sessions
    .map((session) => ({
      completedAt: session.completedAt,
      value: metric === 'e1rm' ? session.bestE1rm : session.maxReps,
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
    totalVolume: sessions.reduce((sum, session) => sum + session.volume, 0),
    trend: latest && previous ? (latest - previous) / previous : null,
  };
}

export function getWeeklyMuscleLoad(history = [], now = Date.now()) {
  const volume = Object.fromEntries(allMuscles.map((muscle) => [muscle, 0]));
  const frequency = Object.fromEntries(allMuscles.map((muscle) => [muscle, 0]));

  history.filter((workout) => workout.completedAt && now - workout.completedAt <= 7 * DAY).forEach((workout) => {
    const workoutStimulus = Object.fromEntries(allMuscles.map((muscle) => [muscle, 0]));
    workout.exercises.forEach((item) => {
      const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
      if (!exercise) return;
      const completedSets = item.sets.filter((set) => set.done).length;
      if (!completedSets) return;
      workoutStimulus[exercise.primary] += completedSets;
      exercise.secondary.forEach((muscle) => { workoutStimulus[muscle] += completedSets * 0.5; });
    });
    allMuscles.forEach((muscle) => {
      volume[muscle] += workoutStimulus[muscle];
      if (workoutStimulus[muscle] >= 1) frequency[muscle] += 1;
    });
  });

  return {
    volume: Object.fromEntries(allMuscles.map((muscle) => [muscle, Math.round(volume[muscle] * 10) / 10])),
    frequency,
  };
}

export function getWeeklyMovementFrequency(history = [], now = Date.now()) {
  const frequency = Object.fromEntries(movementFamilies.map((family) => [family.id, 0]));
  history.filter((workout) => workout.completedAt && now - workout.completedAt <= 7 * DAY).forEach((workout) => {
    const covered = new Set();
    workout.exercises.forEach((item) => {
      if (!item.sets.some((set) => set.done)) return;
      const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
      const family = getMovementFamily(exercise);
      if (family) covered.add(family);
    });
    covered.forEach((family) => { frequency[family] += 1; });
  });
  return frequency;
}

function setEffort(set) {
  const recordedRir = set.rir === null || set.rir === undefined || set.rir === '' ? Number(set.targetRir ?? 2) : Number(set.rir);
  const rir = Number.isFinite(recordedRir) ? recordedRir : 2;
  const effortByRir = rir <= 0 ? 1.25 : rir === 1 ? 1.12 : rir === 2 ? 1 : rir === 3 ? 0.87 : 0.75;
  const targetReps = Number(set.targetReps) || Number(set.reps) || 1;
  const repFactor = clamp((Number(set.reps) || targetReps) / targetReps, 0.65, 1.35);
  return effortByRir * repFactor;
}

export function getRecovery(history = [], now = Date.now()) {
  const fatigue = Object.fromEntries(allMuscles.map((muscle) => [muscle, 0]));

  history.forEach((workout) => {
    if (!workout.completedAt) return;
    const ageHours = Math.max(0, (now - workout.completedAt) / 36e5);
    workout.exercises.forEach((item) => {
      const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
      if (!exercise) return;
      item.sets.filter((set) => set.done).forEach((set) => {
        const effort = setEffort(set);
        const recoveryWindow = 72 + 32 * effort;
        const remainingFatigue = clamp(1 - ageHours / recoveryWindow, 0, 1);
        const impact = 9 * effort * (exercise.compound ? 1.08 : 1) * remainingFatigue;
        fatigue[exercise.primary] += impact;
        exercise.secondary.forEach((muscle) => { fatigue[muscle] += impact * 0.45; });
      });
    });
  });

  return Object.fromEntries(allMuscles.map((muscle) => [muscle, Math.round(clamp(100 - fatigue[muscle], 0, 100))]));
}

function targetMuscles(profile, recovery, history, weeklyLoad) {
  const workoutCount = history.length;
  if (profile.split === 'adaptive' || profile.split === 'full') {
    return ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];
  }
  if (profile.split === 'upper-lower') {
    return workoutCount % 2 === 0
      ? ['chest', 'back', 'shoulders', 'biceps', 'triceps']
      : ['quads', 'hamstrings', 'glutes', 'calves', 'core'];
  }
  if (profile.split === 'ppl') {
    const days = [
      ['chest', 'shoulders', 'triceps'],
      ['back', 'biceps'],
      ['quads', 'hamstrings', 'glutes', 'calves'],
    ];
    return days[workoutCount % days.length];
  }

  return ['chest', 'back', 'quads', 'hamstrings', 'shoulders', 'core'];
}

function roundLoad(value, exercise) {
  const increment = exercise.loadType === 'per-dumbbell' || exercise.equipment.includes('kettlebell') ? 1 : 2.5;
  return Math.max(increment, Math.round(value / increment) * increment);
}

function prescribedWeight(exercise, progress, intensity) {
  if (!['external', 'per-dumbbell'].includes(exercise.loadType)) return 0;
  if (!progress.latestE1rm) return null;
  let recommendation = roundLoad(progress.latestE1rm * intensity, exercise);
  if (progress.lastWeight) {
    recommendation = clamp(recommendation, progress.lastWeight * 0.925, progress.lastWeight * 1.075);
    recommendation = roundLoad(recommendation, exercise);
  }
  return recommendation;
}

function prescribedSetCount(exercise, profile, context) {
  const targets = getWeeklyTargets(profile);
  const volumeDone = context.weeklyLoad?.volume?.[exercise.primary] || 0;
  const frequencyDone = context.weeklyLoad?.frequency?.[exercise.primary] || 0;
  const volumeGap = Math.max(0, targets.sets - volumeDone);
  const remainingExposures = Math.max(1, targets.frequency - frequencyDone);
  const distributedSets = volumeGap > 0 ? Math.ceil(volumeGap / remainingExposures) : 2;
  const readiness = context.recovery?.[exercise.primary] ?? 100;
  let maximum = context.targetMinutes <= 30 ? 2 : context.targetMinutes <= 45 ? 3 : exercise.compound ? 4 : 3;
  if (profile.level === 'beginner' || readiness < 50) maximum = 2;
  else if (readiness < 65) maximum = Math.min(maximum, 3);
  if (profile.level === 'advanced' && context.targetMinutes >= 40 && readiness >= 65) maximum = Math.max(maximum, 4);
  const minimum = targets.frequency >= 5 ? 1 : 2;
  return clamp(distributedSets, minimum, maximum);
}

function prescription(exercise, profile, history, context = {}) {
  const goal = trainingRules[profile.goal] || trainingRules.muscle;
  const rule = exercise.compound ? goal.compound : goal.accessory;
  const targetMinutes = context.targetMinutes || profile.duration || 45;
  const enrichedContext = { ...context, targetMinutes };
  const sets = prescribedSetCount(exercise, profile, enrichedContext);
  const readiness = context.recovery?.[exercise.primary] ?? 100;
  const targetRir = clamp(goal.targetRir + (readiness < 55 ? 1 : 0), 1, 4);
  const progress = getExerciseProgress(history, exercise.id);
  const adjustedIntensity = rule.intensity - Math.max(0, targetRir - goal.targetRir) * 0.03;
  const weight = prescribedWeight(exercise, progress, adjustedIntensity);
  const isRepOnly = !['external', 'per-dumbbell'].includes(exercise.loadType);
  const learnedReps = progress.latestRepCapacity == null
    ? rule.reps
    : Math.round((rule.reps + Math.max(3, progress.latestRepCapacity - targetRir)) / 2);
  const reps = isRepOnly ? clamp(learnedReps, 3, 30) : rule.reps;

  return {
    exerciseId: exercise.id,
    rest: rule.rest,
    targetRir,
    estimatedOneRepMax: progress.latestE1rm,
    needsInitialLoad: ['external', 'per-dumbbell'].includes(exercise.loadType) && weight == null,
    sets: Array.from({ length: sets }, () => ({
      targetReps: reps,
      targetWeight: weight,
      targetRir,
      reps,
      weight,
      rir: null,
      done: false,
    })),
  };
}

function estimateExerciseMinutes(exercise, profile, history, context) {
  const item = prescription(exercise, profile, history, context);
  const workSeconds = exercise.compound ? 42 : 35;
  return 1 + item.sets.length * workSeconds / 60 + Math.max(0, item.sets.length - 1) * item.rest / 60;
}

export function hasAvailableEquipment(exercise, profile) {
  const required = exercise.equipment.filter((item) => item !== 'bodyweight');
  if (required.length) return required.every((item) => profile.equipment.includes(item));
  return profile.equipment.includes('bodyweight');
}

const focusFamilies = [
  ['horizontal-push', 'vertical-push'],
  ['horizontal-pull', 'vertical-pull'],
  ['squat', 'hinge', 'single-leg', 'hip-extension'],
];

function focusRank(exercise) {
  const simpleNameBonus = exercise.name.trim().split(/\s+/).length <= 4 ? 2 : 0;
  return exercise.selectionPriority + simpleNameBonus;
}

export function getFocusCandidates(profile, family = null) {
  const patterns = family == null ? null : focusFamilies[family];
  return exercises
    .filter((exercise) => exercise.compound && hasAvailableEquipment(exercise, profile))
    .filter((exercise) => profile.preferences?.[exercise.id] !== 'exclude')
    .filter((exercise) => !patterns || patterns.includes(exercise.pattern))
    .sort((a, b) => focusRank(b) - focusRank(a) || a.name.localeCompare(b.name));
}

export function suggestFocusExercises(profile) {
  const selected = [];
  focusFamilies.forEach((_, family) => {
    const candidate = getFocusCandidates(profile, family)
      .find((exercise) => !selected.some((item) => item.variationGroup && item.variationGroup === exercise.variationGroup));
    if (candidate) selected.push(candidate);
  });
  return selected.map((exercise) => exercise.id);
}

export function getNextFocusExercise(profile, currentId, selectedIds = []) {
  const current = exercises.find((exercise) => exercise.id === currentId);
  const family = focusFamilies.findIndex((patterns) => patterns.includes(current?.pattern));
  const candidates = getFocusCandidates(profile, family >= 0 ? family : null)
    .filter((exercise) => exercise.id !== currentId && !selectedIds.includes(exercise.id));
  if (!candidates.length) return currentId;
  const currentIndex = Math.max(0, getFocusCandidates(profile, family >= 0 ? family : null).findIndex((exercise) => exercise.id === currentId));
  return candidates[currentIndex % candidates.length].id;
}

function selectWorkoutFocus(profile, history, targets) {
  if (profile.focusEnabled === false) return null;
  const ids = profile.focusExerciseIds?.length ? profile.focusExerciseIds : suggestFocusExercises(profile);
  const compatible = ids
    .map((id) => exercises.find((exercise) => exercise.id === id))
    .filter((exercise) => exercise && targets.includes(exercise.primary) && hasAvailableEquipment(exercise, profile))
    .filter((exercise) => profile.preferences?.[exercise.id] !== 'exclude');
  if (!compatible.length) return null;

  const lastPerformed = (exerciseId) => [...history].reverse()
    .find((workout) => workout.exercises?.some((item) => item.exerciseId === exerciseId))?.completedAt || 0;
  return compatible.sort((a, b) => lastPerformed(a.id) - lastPerformed(b.id))[0];
}

function scoreExercise(exercise, targets, profile, recovery, weeklyLoad, recentIds, chosen, random) {
  if (!targets.includes(exercise.primary)) return -1000;
  if (!hasAvailableEquipment(exercise, profile)) return -1000;
  if (chosen.some((item) => item.pattern === exercise.pattern)) return -500;
  if (exercise.variationGroup && chosen.some((item) => item.variationGroup === exercise.variationGroup)) return -500;

  const weeklyTargets = getWeeklyTargets(profile);
  const volumeNeed = clamp((weeklyTargets.sets - weeklyLoad.volume[exercise.primary]) / weeklyTargets.sets, 0, 1);
  const frequencyNeed = clamp((weeklyTargets.frequency - weeklyLoad.frequency[exercise.primary]) / weeklyTargets.frequency, 0, 1);
  const readiness = recovery[exercise.primary];
  let score = readiness * 0.25;
  score += volumeNeed * 35;
  score += frequencyNeed * 25;
  score += exercise.compound && chosen.length < 3 ? 12 : 6;
  score += exercise.selectionPriority;
  score -= chosen.filter((item) => item.primary === exercise.primary).length * 18;
  score += recentIds.includes(exercise.id) ? -10 : 4;
  if (readiness < 45) score -= (45 - readiness) * 1.5;
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

function adaptiveFamilyCount(weeklyDays) {
  if (weeklyDays <= 3) return movementFamilies.length;
  if (weeklyDays === 5) return 3;
  return 2;
}

function movementFamilyNeed(family, profile, recovery, weeklyLoad, movementFrequency) {
  const weeklyTargets = getWeeklyTargets(profile);
  const relevantMuscles = family.muscles.filter((muscle) => allMuscles.includes(muscle));
  const average = (selector) => relevantMuscles.reduce((sum, muscle) => sum + selector(muscle), 0) / relevantMuscles.length;
  return {
    frequencyGap: Math.max(0, weeklyTargets.frequency - movementFrequency[family.id]),
    volumeGap: average((muscle) => clamp((weeklyTargets.sets - weeklyLoad.volume[muscle]) / weeklyTargets.sets, 0, 1)),
    readiness: average((muscle) => recovery[muscle] / 100),
  };
}

function compareMovementFamilyNeed(a, b, profile, recovery, weeklyLoad, movementFrequency) {
  const needA = movementFamilyNeed(a, profile, recovery, weeklyLoad, movementFrequency);
  const needB = movementFamilyNeed(b, profile, recovery, weeklyLoad, movementFrequency);
  return needB.frequencyGap - needA.frequencyGap
    || needB.volumeGap - needA.volumeGap
    || needB.readiness - needA.readiness;
}

export function generateWorkout(profile, history = [], options = {}) {
  const recovery = getRecovery(history);
  const weeklyLoad = getWeeklyMuscleLoad(history);
  const weeklyMovementFrequency = getWeeklyMovementFrequency(history);
  let targets = options.targets || targetMuscles(profile, recovery, history, weeklyLoad);
  const recentIds = history.slice(-3).flatMap((workout) => workout.exercises.map((item) => item.exerciseId));
  const avoidIds = new Set(options.avoidExerciseIds || []);
  const targetMinutes = options.duration || profile.duration || 45;
  const prescriptionContext = { weeklyLoad, recovery, targetMinutes };
  const focus = selectWorkoutFocus(profile, history, targets);
  const chosen = focus ? [focus] : [];
  const random = seededRandom(Date.now() + (options.variation || 0));
  let usedMinutes = 5 + (focus ? estimateExerciseMinutes(focus, profile, history, prescriptionContext) : 0);

  const rankCandidates = (patterns = null) => exercises
    .filter((exercise) => profile.preferences?.[exercise.id] !== 'exclude' && !chosen.some((item) => item.id === exercise.id))
    .filter((exercise) => !avoidIds.has(exercise.id))
    .filter((exercise) => !patterns || patterns.includes(exercise.pattern))
    .map((exercise) => ({ exercise, score: scoreExercise(exercise, targets, profile, recovery, weeklyLoad, recentIds, chosen, random) }))
    .filter((item) => item.score > -100)
    .sort((a, b) => b.score - a.score);

  let requiredFamilies = movementFamilies.filter((family) => family.muscles.some((muscle) => targets.includes(muscle)));
  if (profile.split === 'adaptive' && !options.targets) {
    requiredFamilies = [...requiredFamilies]
      .sort((a, b) => compareMovementFamilyNeed(a, b, profile, recovery, weeklyLoad, weeklyMovementFrequency))
      .slice(0, adaptiveFamilyCount(getWeeklyTargets(profile).weeklyDays));
    targets = [...new Set([...requiredFamilies.flatMap((family) => family.muscles), 'calves', 'core'])];
  }
  requiredFamilies.forEach((family) => {
    if (chosen.some((exercise) => getMovementFamily(exercise) === family.id)) return;
    const next = rankCandidates(family.patterns)[0]?.exercise;
    if (!next) return;
    chosen.push(next);
    usedMinutes += estimateExerciseMinutes(next, profile, history, prescriptionContext);
  });

  while (usedMinutes < targetMinutes - 4 && chosen.length < 8) {
    const ranked = rankCandidates();
    if (!ranked.length) break;
    const next = ranked[0].exercise;
    const nextMinutes = estimateExerciseMinutes(next, profile, history, prescriptionContext);
    if (chosen.length >= requiredFamilies.length && usedMinutes + nextMinutes > targetMinutes + 2) break;
    chosen.push(next);
    usedMinutes += nextMinutes;
  }

  const weeklyTargets = getWeeklyTargets(profile);
  const coveredMovementFamilies = [...new Set(chosen.map((exercise) => getMovementFamily(exercise)).filter(Boolean))];

  return {
    id: `workout-${Date.now()}`,
    createdAt: Date.now(),
    duration: targetMinutes,
    targetMuscles: [...new Set(chosen.map((exercise) => exercise.primary))],
    focusExerciseId: focus?.id || null,
    exercises: chosen.map((exercise) => ({
      ...prescription(exercise, profile, history, prescriptionContext),
      isFocus: exercise.id === focus?.id,
    })),
    engine: {
      version: 4,
      weeklyVolumeBeforeWorkout: weeklyLoad.volume,
      weeklyFrequencyBeforeWorkout: weeklyLoad.frequency,
      weeklyMovementFrequencyBeforeWorkout: weeklyMovementFrequency,
      weeklyTargets,
      recoveryAtGeneration: recovery,
      movementFamilies: requiredFamilies.map((family) => family.id),
      unavailableMovementFamilies: requiredFamilies
        .map((family) => family.id)
        .filter((family) => !coveredMovementFamilies.includes(family)),
      evidenceProfile: 'ACSM-2026-PELLAND-2026-RIR',
    },
  };
}

export function getSimilarExercises(workout, exerciseId, profile) {
  const current = exercises.find((item) => item.id === exerciseId);
  if (!current) return [];
  const used = workout.exercises.map((item) => exercises.find((exercise) => exercise.id === item.exerciseId));
  return exercises
    .filter((exercise) => exercise.id !== exerciseId && exercise.primary === current.primary)
    .filter((exercise) => hasAvailableEquipment(exercise, profile))
    .filter((exercise) => !used.some((item) => item?.id === exercise.id || (exercise.variationGroup && item?.variationGroup === exercise.variationGroup)))
    .filter((exercise) => profile.preferences?.[exercise.id] !== 'exclude')
    .sort((a, b) => {
      const patternDifference = Number(b.pattern === current.pattern) - Number(a.pattern === current.pattern);
      const compoundDifference = Number(b.compound === current.compound) - Number(a.compound === current.compound);
      return patternDifference || compoundDifference || b.selectionPriority - a.selectionPriority || a.name.localeCompare(b.name);
    });
}

export function replaceExercise(workout, exerciseId, profile, history = [], replacementId = null) {
  const current = exercises.find((item) => item.id === exerciseId);
  if (!current) return workout;
  const alternatives = getSimilarExercises(workout, exerciseId, profile);
  if (!alternatives.length) return workout;
  const replacement = replacementId
    ? alternatives.find((exercise) => exercise.id === replacementId)
    : alternatives[0];
  if (!replacement) return workout;
  const replacingFocus = workout.focusExerciseId === exerciseId;
  const measuredWeeklyLoad = getWeeklyMuscleLoad(history);
  const prescriptionContext = {
    targetMinutes: workout.duration || profile.duration || 45,
    weeklyLoad: {
      volume: workout.engine?.weeklyVolumeBeforeWorkout || measuredWeeklyLoad.volume,
      frequency: workout.engine?.weeklyFrequencyBeforeWorkout || measuredWeeklyLoad.frequency,
    },
    recovery: workout.engine?.recoveryAtGeneration || getRecovery(history),
  };
  return {
    ...workout,
    exercises: workout.exercises.map((item) => item.exerciseId === exerciseId
      ? prescription(replacement, profile, history, prescriptionContext)
      : item),
    focusExerciseId: replacingFocus ? null : workout.focusExerciseId,
    targetMuscles: [...new Set(workout.exercises
      .map((item) => item.exerciseId === exerciseId ? replacement.primary : exercises.find((exercise) => exercise.id === item.exerciseId)?.primary)
      .filter(Boolean))],
  };
}

export function removeExercise(workout, exerciseId) {
  if (!workout?.exercises || workout.exercises.length <= 1) return workout;
  const remaining = workout.exercises.filter((item) => item.exerciseId !== exerciseId);
  return {
    ...workout,
    exercises: remaining,
    focusExerciseId: workout.focusExerciseId === exerciseId ? null : workout.focusExerciseId,
    targetMuscles: [...new Set(remaining
      .map((item) => exercises.find((exercise) => exercise.id === item.exerciseId)?.primary)
      .filter(Boolean))],
  };
}
