const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const bounded = (value, min, max) => Math.max(min, Math.min(max, Math.floor(value + .001)));
const same = (a, b) => Math.abs(Number(a) - Number(b)) < .001;

// One decision produces both load and repetitions. Stored strength estimates
// are analytics, not instructions. Recent comparable sessions can protect an
// established level during recalibration after an isolated poor session.
export function calculateProgression({ sets = [], recentSessions = [], decision, usesWeight, loads = [], limits, targetRirs, workingWeight, estimateMax, estimateReps }) {
  const count = targetRirs.length;
  const result = (weight, reps, step, reason) => ({
    weight, reps, targetReps: Array(count).fill(reps), step, reason,
  });
  const completed = sets.filter((set) => set.done);
  const targets = sets.map((set) => Number(set.targetReps)).filter(positive);
  const baseline = bounded(targets.length ? Math.min(...targets) : limits.minReps, 1, limits.maxReps);
  if (!completed.length) return result(usesWeight ? null : 0, limits.minReps, 'start', 'no-history');

  const available = [...new Set(loads.filter(positive).map(Number))].sort((a, b) => a - b);
  let weight = usesWeight ? Number(workingWeight) : 0;
  if (usesWeight && (!positive(weight) || !available.length)) {
    return result(null, limits.minReps, 'recalibrate-load', 'missing-load');
  }
  const relevant = usesWeight ? completed.filter((set) => same(set.weight, weight)) : completed;
  const prescribedWeight = sets.map((set) => Number(set.targetWeight ?? set.weight)).find(positive);
  if (decision === 'maintain-prescription' && (!usesWeight || available.some((load) => same(load, prescribedWeight)))) {
    const held = result(usesWeight ? prescribedWeight : 0, baseline, 'hold', 'maintain-requested');
    if (targets.length === count) held.targetReps = targets.map((reps) => bounded(reps, 1, limits.maxReps));
    return held;
  }
  if (usesWeight && !available.some((load) => same(load, weight))) {
    const lower = available.filter((load) => load < weight).at(-1);
    return result(lower ?? null, baseline, lower ? 'load-adjustment' : 'recalibrate-load', 'inventory-changed');
  }

  const previousRirs = sets.map((set) => Number(set.targetRir ?? 2));
  // A changed set count changes the RIR distribution; compare the final effort
  // as well as every position when the number of sets is unchanged.
  const effortChanged = !same(previousRirs.at(-1), targetRirs.at(-1))
    || (sets.length === count && previousRirs.some((rir, index) => !same(rir, targetRirs[index])));
  const loadChanged = usesWeight && completed.some((set) => !same(set.weight, set.targetWeight ?? set.weight));
  const hasTargets = targets.length === sets.length;
  const recalibrationMin = usesWeight ? Math.min(limits.minReps, limits.recalibrationMinReps ?? 6) : 1;
  const rirOf = (set) => set.rir != null && Number.isFinite(Number(set.rir))
    ? Number(set.rir) : Number(set.targetRir ?? 2);
  const capacityAt = (load) => relevant.map((set) => {
    const rir = decision === 'recalibrate-down' ? Math.min(rirOf(set), Number(set.targetRir ?? 2)) : rirOf(set);
    // At the recorded load use the observed reps directly. Converting through
    // a strength estimate can round across formula boundaries and drop a rep.
    return usesWeight && !same(load, set.weight)
      ? estimateReps(estimateMax(Number(set.weight), Number(set.reps), rir), load)
      : Number(set.reps) + rir;
  }).filter((value) => value != null && Number.isFinite(value));
  const supportedAt = (load) => {
    const capacities = capacityAt(load);
    return capacities.length ? Math.floor(Math.min(...capacities.map((capacity, index) => (
      capacity - Number(effortChanged ? Math.max(...targetRirs) : relevant[index]?.targetRir ?? 2)
    ))) + .001) : 0;
  };

  if (effortChanged || loadChanged || !hasTargets || decision === 'recalibrate-down') {
    let supported = supportedAt(weight);
    let recentLevelProtected = false;
    if (decision === 'recalibrate-down' && !effortChanged && !loadChanged && hasTargets) {
      const comparable = recentSessions.filter((session) => session.sets.length >= count
        && session.sets.every((set) => set.done && positive(set.reps)
          && (!usesWeight || same(set.weight, weight))));
      const missedTarget = (recorded) => recorded.some((set) => !set.done
        || Number(set.reps) < Number(set.targetReps)
        || rirOf(set) < Number(set.targetRir ?? 2));
      const repeatedShortfall = comparable.length > 0 && missedTarget(sets)
        && missedTarget(comparable.at(-1).sets);
      if (!repeatedShortfall) {
        const demonstrated = comparable.map((session) => Math.floor(Math.min(...session.sets.map((set, index) => (
          Number(set.reps) + Math.min(rirOf(set), Number(set.targetRir ?? 2))
          - Number(targetRirs[Math.min(index, count - 1)] ?? limits.targetRir ?? 2)
        ))) + .001));
        const recentFloor = Math.max(0, ...demonstrated);
        recentLevelProtected = recentFloor > supported;
        supported = Math.max(supported, recentFloor);
      }
    }
    if (usesWeight && supported < recalibrationMin) {
      const lower = available.filter((load) => load < weight).reverse().find((load) => supportedAt(load) >= limits.minReps);
      if (!lower) return result(null, limits.minReps, 'recalibrate-load', 'no-supported-load');
      weight = lower;
      // Only lower the load after exhausting the rep range at the current
      // load. Restart at the minimum instead of filling the new capacity.
      supported = limits.minReps;
    }
    if (decision === 'recalibrate-down' && hasTargets && !recentLevelProtected) supported = Math.min(supported, baseline);
    const step = effortChanged ? 'effort-adjustment' : loadChanged ? 'load-adjustment' : 'performance-adjustment';
    return result(weight, bounded(supported, recalibrationMin, limits.maxReps), step,
      effortChanged ? 'effort-changed' : loadChanged ? 'performed-load-changed' : recentLevelProtected ? 'recent-level-preserved' : 'recalibration');
  }

  // Extra reps on one set cannot compensate for a missed set or lower RIR.
  // The UI requests RIR only on exercise completion. Earlier unreported RIR
  // uses the prescribed value; require at least one actual effort report.
  const allMet = sets.every((set) => set.done && positive(set.reps)
    && Number(set.reps) >= Number(set.targetReps)
    && rirOf(set) >= Number(set.targetRir ?? 2)
    && (!usesWeight || same(set.weight, weight)))
    && sets.some((set) => set.rir != null && set.rir !== '' && Number.isFinite(Number(set.rir)));
  if (!allMet) return result(weight, baseline, 'hold', 'target-not-completed');
  if (count > sets.length) return result(weight, baseline, 'hold', 'sets-added');

  const atTop = sets.every((set) => Number(set.targetReps) >= limits.maxReps && Number(set.reps) >= limits.maxReps);
  if (atTop && usesWeight) {
    const next = available.find((load) => load > weight + .001);
    if (next && (next - weight) / weight <= .1 && supportedAt(next) >= limits.minReps) {
      return result(next, limits.minReps, 'load', 'range-completed');
    }
  }
  return result(weight, bounded(baseline + 1, 1, limits.maxReps), baseline >= limits.maxReps ? 'top' : 'reps',
    baseline >= limits.maxReps ? 'range-completed' : 'all-sets-completed');
}
