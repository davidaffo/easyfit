import wgerCatalog from '../generated/wger-exercises.json' with { type: 'json' };

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
};

const muscleByWgerId = {
  1: 'biceps',
  2: 'shoulders',
  3: 'chest',
  4: 'chest',
  5: 'triceps',
  6: 'core',
  7: 'calves',
  8: 'glutes',
  9: 'back',
  10: 'quads',
  11: 'hamstrings',
  12: 'back',
  13: 'biceps',
  14: 'core',
  15: 'calves',
};

const muscleByCategory = {
  Abs: 'core',
  Arms: 'biceps',
  Back: 'back',
  Calves: 'calves',
  Chest: 'chest',
  Legs: 'quads',
  Shoulders: 'shoulders',
};

const equipmentMap = {
  'none (bodyweight exercise)': 'bodyweight',
  Dumbbell: 'dumbbells',
  'Cable machine': 'cables',
  Barbell: 'barbell',
  Bench: 'bench',
  'Incline bench': 'bench',
  'Pull-up bar': 'pullup',
  'SZ-Bar': 'ezbar',
  Kettlebell: 'kettlebell',
  'Resistance band': 'bands',
  'Gym mat': 'bodyweight',
  'Swiss Ball': 'ball',
};

const machineName = /machine|leg press|leg curl|leg extension|hackenschmidt|pec deck|butterfly|hyperextension/i;
const bodyweightName = /plank|crunch|sit.?up|push.?up|squat|lunge|bridge|raise|burpee|mountain climber|superman|dead bug|hollow hold/i;

function inferEquipment(item) {
  const mapped = item.equipment.map((name) => equipmentMap[name]).filter(Boolean);
  if (!mapped.length && machineName.test(item.name)) mapped.push('machines');
  if (!mapped.length && bodyweightName.test(item.name)) mapped.push('bodyweight');
  return [...new Set(mapped)];
}

function inferPattern(name, primary) {
  const value = name.toLowerCase();
  if (/leg curl/.test(value)) return 'knee-flexion';
  if (/leg extension/.test(value)) return 'knee-extension';
  if (/hip thrust|glute bridge/.test(value)) return 'hip-extension';
  if (/deadlift|good morning|pull through|kettlebell swing/.test(value)) return 'hinge';
  if (/lunge|split squat|step.?up|pistol squat|single.?leg squat/.test(value)) return 'single-leg';
  if (/squat|leg press|hack press/.test(value)) return 'squat';
  if (/calf|toe press/.test(value)) return 'calf-raise';
  if (/pulldown|pull.?up|chin.?up/.test(value)) return 'vertical-pull';
  if (/\brow|rowing/.test(value)) return 'horizontal-pull';
  if (/shoulder press|overhead press|military press|arnold press|handstand|pike push/.test(value)) return 'vertical-push';
  if (/bench press|chest press|push.?up|floor press/.test(value)) return 'horizontal-push';
  if (/chest fl|flye|crossover|pec deck/.test(value)) return 'chest-isolation';
  if (/face pull|reverse fly|rear delt/.test(value)) return 'rear-delt';
  if (/lateral raise|front raise|upright row/.test(value)) return 'shoulder-isolation';
  if (/tricep|pushdown|skull.?crusher|french press/.test(value)) return 'elbow-extension';
  if (/\bcurl/.test(value)) return 'elbow-flexion';
  if (/plank|dead bug|ab wheel|rollout|hollow/.test(value)) return 'anti-extension';
  if (/crunch|sit.?up|leg raise|knee raise/.test(value)) return 'trunk-flexion';
  return `${primary}-accessory`;
}

const compoundPatterns = new Set([
  'hinge', 'single-leg', 'squat', 'vertical-pull', 'horizontal-pull', 'vertical-push', 'horizontal-push', 'hip-extension',
]);
const primaryByPattern = {
  hinge: 'hamstrings',
  'single-leg': 'quads',
  squat: 'quads',
  'vertical-pull': 'back',
  'horizontal-pull': 'back',
  'vertical-push': 'shoulders',
  'horizontal-push': 'chest',
  'hip-extension': 'glutes',
  'knee-flexion': 'hamstrings',
  'knee-extension': 'quads',
  'calf-raise': 'calves',
  'elbow-flexion': 'biceps',
  'elbow-extension': 'triceps',
  'chest-isolation': 'chest',
  'rear-delt': 'shoulders',
  'shoulder-isolation': 'shoulders',
  'anti-extension': 'core',
  'trunk-flexion': 'core',
};

const foundationalNames = new Set([
  'Bench Press', 'Barbell Full Squat', 'Deadlifts', 'Romanian Deadlift', 'Barbell Romanian Deadlift (RDL)',
  'Barbell Row (Overhand)', 'Bent Over Rowing', 'Pull-ups', 'Chin-ups', 'Lat Pulldown', 'Leg Press',
  'Dumbbell Shoulder Press', 'Military Press', 'Lateral Raises', 'Dumbbell Biceps Curl', 'Triceps Pushdown',
  'Leg Curl', 'Leg Extension', 'Hip Thrust', 'Calf Raises', 'Plank', 'Crunches', 'Push-ups',
  'Push-Up', 'Bodyweight Squat HD', 'Dumbbell Goblet Squat', 'Bent Over Dumbbell Rows',
  'Dumbbell Romanian Deadlift', 'Shoulder Press, Dumbbells', 'No Leg Drive Dumbbell Chest Press',
]);
const familiarMovement = /bench press|chest press|push.?up|shoulder press|overhead press|military press|lateral raise|pull.?up|chin.?up|pulldown|\brow|squat|leg press|deadlift|hip thrust|glute bridge|lunge|leg curl|leg extension|calf raise|biceps curl|triceps|pushdown|plank|crunch/i;

function selectionPriority(item) {
  let priority = foundationalNames.has(item.name) ? 14 : familiarMovement.test(item.name) ? 8 : 0;
  if (!item.muscles.length) priority -= 7;
  if (/\b(left|right)\b|rehab|mobility|stretch|warm.?up|activation|neck|wrist/i.test(item.name)) priority -= 6;
  if (/dragon|pseudo|one armed|clap|three-point|rotation|pancake/i.test(item.name)) priority -= 5;
  priority -= Math.max(0, item.name.trim().split(/\s+/).length - 6);
  return Math.max(-10, Math.min(16, priority));
}

function normalizeExercise(item) {
  const primaryMuscles = item.muscles.map((muscleId) => muscleByWgerId[muscleId]).filter(Boolean);
  const catalogPrimary = primaryMuscles[0] || muscleByCategory[item.category];
  const pattern = inferPattern(item.name, catalogPrimary);
  const primary = primaryByPattern[pattern] || catalogPrimary;
  const secondary = [...new Set([
    ...primaryMuscles,
    ...item.secondaryMuscles.map((muscleId) => muscleByWgerId[muscleId]).filter(Boolean),
  ])].filter((muscle) => muscle !== primary);
  const equipment = inferEquipment(item);
  const compound = compoundPatterns.has(pattern);
  const hasExternalLoad = equipment.some((value) => ['dumbbells', 'barbell', 'cables', 'machines', 'ezbar', 'kettlebell'].includes(value));
  const loadType = hasExternalLoad
    ? (equipment.includes('dumbbells') ? 'per-dumbbell' : 'external')
    : equipment.some((value) => ['bands', 'ball'].includes(value)) ? 'reps-only' : 'bodyweight';

  return {
    id: `wger-${item.wgerId}`,
    wgerId: item.wgerId,
    name: item.name,
    translations: item.translations,
    primary,
    secondary,
    equipment,
    pattern,
    compound,
    selectionPriority: selectionPriority(item),
    loadType,
    minutes: compound ? 9 : 6,
    variationGroup: item.variationGroup,
    license: item.license,
    source: 'wger',
  };
}

export const exercises = wgerCatalog.exercises
  .filter((item) => item.category !== 'Cardio')
  .map(normalizeExercise)
  .filter((exercise) => exercise.primary && exercise.equipment.length);

export function getExerciseName(exercise, language = 'en') {
  return exercise?.translations?.[language] || exercise?.translations?.en || exercise?.name || '';
}

export const exerciseCatalogMeta = {
  source: wgerCatalog.source,
  sourceUrl: wgerCatalog.sourceUrl,
  syncedAt: wgerCatalog.syncedAt,
  total: wgerCatalog.count,
  eligible: exercises.length,
  italianTranslations: wgerCatalog.exercises.filter((exercise) => exercise.translations.it).length,
};
