import detailsCatalog from '../generated/wger-exercise-details.json' with { type: 'json' };

export async function getExerciseDetails(wgerId, language = 'en') {
  const details = detailsCatalog.exercises[String(wgerId)] || null;
  if (!details) return null;
  return {
    ...details,
    description: details.descriptions?.[language] || details.descriptions?.en || '',
  };
}
