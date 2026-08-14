import detailsCatalog from '../generated/exercise-details.json' with { type: 'json' };

export async function getExerciseDetails(wgerId, language = 'en') {
  const details = detailsCatalog.exercises[String(wgerId)] || null;
  if (!details) return null;
  const baseUrl = import.meta.env?.BASE_URL;
  return {
    ...details,
    image: details.image
      ? baseUrl ? `${baseUrl}${details.image.replace(/^\//, '')}` : details.image
      : null,
    description: details.descriptions?.[language] || details.descriptions?.en || '',
  };
}
