import curatedCatalog from '../generated/exercise-catalog.json' with { type: 'json' };

export const muscles = {
  chest: 'Petto',
  back: 'Schiena',
  shoulders: 'Spalle',
  biceps: 'Bicipiti',
  triceps: 'Tricipiti',
  quads: 'Quadricipiti',
  hamstrings: 'Femorali',
  glutes: 'Glutei',
  calves: 'Polpacci',
  core: 'Core',
};

export const equipmentLabels = {
  bodyweight: 'Corpo libero',
  dumbbells: 'Manubri',
  barbell: 'Bilanciere',
  bench: 'Panca',
  cables: 'Cavi',
  machines: 'Macchine',
  pullup: 'Sbarra',
  ezbar: 'Bilanciere EZ',
  kettlebell: 'Kettlebell',
  bands: 'Elastici',
  ball: 'Swiss ball',
  rack: 'Rack / supporti',
  abwheel: 'Ruota addominale',
  addedweight: 'Zavorra per dips e trazioni',
};

const weightedNames = {
  'wger-194': ['Weighted Dips', 'Dips zavorrati'],
  'wger-152': ['Weighted Chin Up', 'Chin-up zavorrati'],
  'wger-475': ['Weighted Pull-ups', 'Trazioni zavorrate'],
};
const weightedVariants = curatedCatalog.exercises.filter((exercise) => weightedNames[exercise.id]).map((exercise) => ({
  ...exercise,
  id: `${exercise.id}-weighted`,
  bodyweightExerciseId: exercise.id,
  name: weightedNames[exercise.id][0],
  translations: { en: weightedNames[exercise.id][0], it: weightedNames[exercise.id][1] },
  equipment: [...exercise.equipment, 'addedweight'],
  loadType: 'external',
  loadUnit: 'added-weight',
  loadMultiplier: 1,
}));
export const catalogExercises = [...curatedCatalog.exercises, ...weightedVariants];
export const exercises = catalogExercises.filter((exercise) => exercise.generationEligible);

export function getExerciseName(exercise, language = 'en') {
  return exercise?.translations?.[language] || exercise?.translations?.en || exercise?.name || '';
}

export const exerciseCatalogMeta = {
  source: curatedCatalog.source,
  sourceUrl: curatedCatalog.sourceUrl,
  syncedAt: curatedCatalog.syncedAt,
  curatedAt: curatedCatalog.curatedAt,
  total: curatedCatalog.sourceCount || curatedCatalog.count,
  eligible: exercises.length,
  italianTranslations: catalogExercises.filter((exercise) => exercise.translations.it).length,
};
