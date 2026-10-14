// Groups exist only in the current workout and are created by the user.
export function setSuperset(workout, exerciseId, partnerId = null) {
  const source = workout.exercises.find((item) => item.exerciseId === exerciseId);
  const partner = workout.exercises.find((item) => item.exerciseId === partnerId);
  if (!source || partnerId === exerciseId || (partnerId && !partner)) return workout;
  const group = partner?.supersetId || source.supersetId || `superset-${exerciseId}`;
  let exercises = workout.exercises.map((item) => {
    const joins = partner && (item.exerciseId === exerciseId || item.exerciseId === partnerId
      || (source.supersetId && item.supersetId === source.supersetId));
    if (joins) return { ...item, supersetId: group };
    if (!partner && item.exerciseId === exerciseId) {
      const { supersetId, ...single } = item;
      return single;
    }
    return item;
  });
  exercises = exercises.map((item) => {
    if (!item.supersetId || exercises.filter((entry) => entry.supersetId === item.supersetId).length > 1) return item;
    const { supersetId, ...single } = item;
    return single;
  });
  return { ...workout, exercises };
}

export function nextSupersetExercise(workout, item) {
  if (!item.supersetId) return null;
  const completedAfter = item.sets.filter((set) => set.done).length + 1;
  return workout.exercises.find((entry) => entry.exerciseId !== item.exerciseId
    && entry.supersetId === item.supersetId
    && entry.sets.some((set) => !set.done)
    && entry.sets.filter((set) => set.done).length < completedAfter) || null;
}
