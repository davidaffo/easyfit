import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { loadCatalogRegistry } from './curated-exercises.mjs';

const sourcePath = new URL('../src/generated/wger-exercises.json', import.meta.url);
const detailsPath = new URL('../src/generated/wger-exercise-details.json', import.meta.url);
const outputPath = new URL('../src/generated/exercise-catalog.json', import.meta.url);
const appDetailsPath = new URL('../src/generated/exercise-details.json', import.meta.url);
const imageIndexPath = new URL('../public/exercise-images/index.json', import.meta.url);
const imageDirectory = new URL('../public/exercise-images/', import.meta.url);
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const details = JSON.parse(await readFile(detailsPath, 'utf8'));
const registry = await loadCatalogRegistry();
const curatedExercises = registry.curatedExercises;
const curatedGuideImageOverrides = registry.guideImages;

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
const englishGuideOverrides = {
  95: `Stand tall facing a low cable with the handle held at shoulder width. Keep the ribs down, shoulders relaxed, and elbows close to the torso. Curl the handle by bending only the elbows until the forearms approach the upper arms. Pause without letting the elbows drift forward, then lower the load under control to full elbow extension. Avoid swinging or using momentum.`,
  91: `Stand with the feet stable and hold the barbell around shoulder width. Brace the trunk, keep the shoulders down, and hold the elbows close to the sides. Curl the bar by flexing the elbows without leaning back or driving the elbows forward. Stop before the shoulders take over, then lower the bar slowly to full extension while keeping the wrists neutral.`,
  92: `Stand or sit with one dumbbell in each hand, arms extended and palms initially facing inward. Keep the upper arms close to the torso and curl the dumbbells with a controlled motion, rotating the palms upward if comfortable. Pause near the top without moving the elbows forward, then lower slowly until the elbows are fully extended. Do not swing the torso.`,
  94: `Stand upright holding the EZ bar with a comfortable angled grip. Brace the trunk and keep the elbows close to the sides. Curl the bar by bending the elbows while keeping the shoulders quiet and the wrists aligned with the forearms. Pause briefly near the top, then lower the bar under control to full extension. Avoid leaning backward or accelerating the weight.`,
  167: `Lie on your back with the knees bent and feet supported. Place the fingertips lightly beside the head or cross the arms over the chest without pulling on the neck. Exhale and curl the ribs toward the pelvis until the shoulder blades lift from the floor. Keep the lower back comfortably supported, pause, and lower slowly. Use a small controlled range rather than momentum.`,
  237: `Set both pulleys around chest height and take one handle in each hand. Step forward into a stable staggered stance with the torso upright and a slight bend in the elbows. Bring the handles together in a wide arc without shrugging or changing the elbow angle. Pause when the hands meet, then return under control until the chest is comfortably stretched.`,
  265: `Lie on your back with the knees bent, feet flat around hip width, and arms relaxed beside the torso. Brace the abdomen gently and press through the whole foot to lift the hips. Stop when the knees, hips, and shoulders form a straight line without arching the lower back. Pause while contracting the glutes, then lower the pelvis under control. Keep the knees tracking over the feet throughout the repetition.`,
  394: `Sit at the low-row station with the feet braced and knees slightly bent. Hold the handle, lengthen the spine, and keep the ribs stacked over the pelvis. Initiate the pull by drawing the shoulder blades back, then bring the handle toward the lower ribs without leaning backward. Pause briefly and return under control until the arms are extended without rounding the lower back.`,
  454: `Start in a pike position with the hips high, hands slightly wider than shoulder width, and head between the arms. Bend the elbows and lower the crown of the head toward the floor while keeping the hips elevated. Press the floor away until the elbows are straight again. Elevating the feet increases the load, but keep the range controlled and avoid collapsing through the lower back.`,
  475: `Hang from the bar with an overhand grip slightly wider than shoulder width. Brace the trunk and begin by drawing the shoulder blades down, then pull until the chin clears the bar while keeping the chest lifted. Avoid kicking, swinging, or forcing the head forward. Lower under control to straight arms and a stable shoulder position before starting the next repetition.`,
};
const forbiddenGuidePhrases = ['fast movement', 'rapid movement', 'touches your neck', 'hands are behind your head'];

function curatedGuide(id) {
  const guide = details.exercises[String(id)];
  if (!guide) return guide;
  return {
    ...guide,
    descriptions: { ...guide.descriptions, ...((registry.guideDescriptions[id] || englishGuideOverrides[id]) ? { en: registry.guideDescriptions[id] || englishGuideOverrides[id] } : {}) },
    image: curatedGuideImageOverrides[id] || guide.image,
    imageAttribution: registry.guideImageAttributions[id] || guide.imageAttribution || null,
    descriptionSource: registry.guideDescriptions[id] || englishGuideOverrides[id] ? 'easyfit-curated' : 'wger',
    imageSource: curatedGuideImageOverrides[id] ? 'easyfit-curated' : 'wger',
  };
}

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
const plainGuideText = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const incompleteGuides = Object.keys(curatedExercises).filter((id) => {
  const guide = curatedGuide(id);
  const description = plainGuideText(guide?.descriptions?.en);
  return description.length < 100
    || forbiddenGuidePhrases.some((phrase) => description.toLowerCase().includes(phrase));
});
if (incompleteGuides.length) throw new Error(`Curated Wger IDs without a useful bundled English guide: ${incompleteGuides.join(', ')}`);

const eligibleCatalog = catalog.filter((item) => item.generationEligible);
const invalidProgrammingMetadata = eligibleCatalog.filter((item) => (
  !['high-fatigue-compound', 'stable-compound', 'isolation'].includes(item.effortClass)
  || typeof item.intensifierEligible !== 'boolean'
  || (item.effortClass === 'high-fatigue-compound' && item.intensifierEligible)
));
if (invalidProgrammingMetadata.length) {
  throw new Error(`Curated exercises with invalid effort metadata: ${invalidProgrammingMetadata.map((item) => item.wgerId).join(', ')}`);
}
const eligibleIds = new Set(eligibleCatalog.map((item) => String(item.wgerId)));
const appDetails = {
  source: details.source,
  syncedAt: details.syncedAt,
  exercises: Object.fromEntries(Object.entries(details.exercises)
    .filter(([id]) => eligibleIds.has(id))
    .map(([id]) => [id, curatedGuide(id)])),
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
