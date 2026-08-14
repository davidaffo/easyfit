import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { curatedExercises } from './curated-exercises.mjs';

const sourcePath = new URL('../src/generated/wger-exercises.json', import.meta.url);
const detailsPath = new URL('../src/generated/wger-exercise-details.json', import.meta.url);
const outputPath = new URL('../src/generated/exercise-catalog.json', import.meta.url);
const appDetailsPath = new URL('../src/generated/exercise-details.json', import.meta.url);
const imageIndexPath = new URL('../public/exercise-images/index.json', import.meta.url);
const imageDirectory = new URL('../public/exercise-images/', import.meta.url);
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const details = JSON.parse(await readFile(detailsPath, 'utf8'));

const muscleByWgerId = {
  1: 'biceps', 2: 'shoulders', 3: 'chest', 4: 'chest', 5: 'triceps', 6: 'core', 7: 'calves',
  8: 'glutes', 9: 'back', 10: 'quads', 11: 'hamstrings', 12: 'back', 13: 'biceps', 14: 'core', 15: 'calves',
};
const muscleByCategory = { Abs: 'core', Arms: 'biceps', Back: 'back', Calves: 'calves', Chest: 'chest', Legs: 'quads', Shoulders: 'shoulders' };
const equipmentMap = {
  'none (bodyweight exercise)': 'bodyweight', Dumbbell: 'dumbbells', 'Cable machine': 'cables', Barbell: 'barbell',
  Bench: 'bench', 'Incline bench': 'bench', 'Pull-up bar': 'pullup', 'SZ-Bar': 'ezbar', Kettlebell: 'kettlebell',
  'Resistance band': 'bands', 'Gym mat': 'bodyweight', 'Swiss Ball': 'ball',
};

function rawMetadata(item) {
  const direct = item.muscles.map((id) => muscleByWgerId[id]).filter(Boolean);
  const primary = direct[0] || muscleByCategory[item.category] || null;
  return {
    primary,
    secondary: [...new Set([
      ...direct.slice(1),
      ...item.secondaryMuscles.map((id) => muscleByWgerId[id]).filter(Boolean),
    ])].filter((muscle) => muscle !== primary),
    equipment: [...new Set(item.equipment.map((name) => equipmentMap[name]).filter(Boolean))],
  };
}

const catalog = source.exercises
  .filter((item) => item.category !== 'Cardio')
  .map((item) => {
    const raw = rawMetadata(item);
    const approved = curatedExercises[item.wgerId];
    return {
      id: `wger-${item.wgerId}`,
      wgerId: item.wgerId,
      name: item.name,
      translations: item.translations,
      ...raw,
      muscleContributions: raw.primary ? { [raw.primary]: 1 } : {},
      pattern: null,
      compound: false,
      selectionPriority: 0,
      loadType: raw.equipment.includes('bodyweight') ? 'bodyweight' : 'reps-only',
      minutes: 6,
      variationGroup: item.variationGroup,
      license: item.license,
      source: 'wger',
      generationEligible: false,
      ...(approved ? {
        ...approved,
        secondary: Object.keys(approved.muscleContributions).filter((muscle) => muscle !== approved.primary),
        minutes: approved.compound ? 9 : 6,
        generationEligible: true,
      } : {}),
    };
  });

const missing = Object.keys(curatedExercises).filter((id) => !catalog.some((item) => item.wgerId === Number(id)));
if (missing.length) throw new Error(`Curated Wger IDs missing from source: ${missing.join(', ')}`);
const incompleteGuides = Object.keys(curatedExercises).filter((id) => {
  const guide = details.exercises[String(id)];
  return !guide?.image || !guide?.descriptions?.en;
});
if (incompleteGuides.length) throw new Error(`Curated Wger IDs without bundled English guide and image: ${incompleteGuides.join(', ')}`);

const eligibleCatalog = catalog.filter((item) => item.generationEligible);
const eligibleIds = new Set(eligibleCatalog.map((item) => String(item.wgerId)));
const appDetails = {
  source: details.source,
  syncedAt: details.syncedAt,
  exercises: Object.fromEntries(Object.entries(details.exercises).filter(([id]) => eligibleIds.has(id))),
};
const output = {
  source: source.source,
  sourceUrl: source.sourceUrl,
  syncedAt: source.syncedAt,
  curatedAt: new Date().toISOString(),
  schemaVersion: 2,
  curation: 'explicit-wger-id-registry',
  sourceCount: catalog.length,
  count: eligibleCatalog.length,
  eligible: eligibleCatalog.length,
  exercises: eligibleCatalog,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(appDetailsPath, `${JSON.stringify(appDetails, null, 2)}\n`);
const appImages = Object.values(appDetails.exercises).map((item) => item.image).filter(Boolean).sort();
await writeFile(imageIndexPath, `${JSON.stringify(appImages, null, 2)}\n`);
const keptImageNames = new Set(appImages.map((path) => path.split('/').at(-1)));
const imageFiles = await readdir(imageDirectory);
await Promise.all(imageFiles
  .filter((filename) => filename !== 'index.json' && !keptImageNames.has(filename))
  .map((filename) => unlink(new URL(filename, imageDirectory))));
console.log(`Curated ${output.sourceCount} source exercises into ${output.eligible} app-ready exercises and offline guides.`);
