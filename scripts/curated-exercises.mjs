import { readFile } from 'node:fs/promises';

// Registro revisionato manualmente. Le chiavi sono ID stabili Wger: nessuna
// classificazione automatica dal nome puo rendere un esercizio prescrivibile.
const C = {
  // Direct sets count as 1 and meaningful indirect work as 0.5. These are
  // evidence categories, not invented exercise-specific precision.
  hp: ['horizontal-push', 'chest', true, { chest: 1, shoulders: .5, triceps: .5 }],
  vp: ['vertical-push', 'shoulders', true, { shoulders: 1, triceps: .5, chest: .25 }],
  hr: ['horizontal-pull', 'back', true, { back: 1, biceps: .5, shoulders: .25 }],
  vr: ['vertical-pull', 'back', true, { back: 1, biceps: .5 }],
  sq: ['squat', 'quads', true, { quads: 1, glutes: .5 }],
  sl: ['single-leg', 'quads', true, { quads: 1, glutes: .5 }],
  hi: ['hinge', 'hamstrings', true, { hamstrings: 1, glutes: .5, back: .5 }],
  he: ['hip-extension', 'glutes', true, { glutes: 1, hamstrings: .5 }],
  cf: ['chest-isolation', 'chest', false, { chest: 1 }],
  rd: ['rear-delt', 'shoulders', false, { shoulders: 1, back: .25 }],
  sr: ['shoulder-isolation', 'shoulders', false, { shoulders: 1 }],
  ef: ['elbow-flexion', 'biceps', false, { biceps: 1 }],
  ee: ['elbow-extension', 'triceps', false, { triceps: 1 }],
  kf: ['knee-flexion', 'hamstrings', false, { hamstrings: 1 }],
  ke: ['knee-extension', 'quads', false, { quads: 1 }],
  cr: ['calf-raise', 'calves', false, { calves: 1 }],
  ae: ['anti-extension', 'core', false, { core: 1 }],
  tf: ['trunk-flexion', 'core', false, { core: 1 }],
  sp: ['straight-arm-pull', 'back', false, { back: 1 }],
};

function item(shape, equipment, priority = 10, extra = {}) {
  const [pattern, primary, compound, muscleContributions] = C[shape];
  const loadType = extra.loadType || (equipment.includes('dumbbells') ? 'per-dumbbell'
    : equipment.some((value) => ['barbell', 'ezbar', 'cables', 'machines', 'kettlebell'].includes(value)) ? 'external'
      : equipment.includes('bodyweight') ? 'bodyweight' : 'reps-only');
  const loadMultiplier = extra.loadMultiplier ?? (loadType === 'per-dumbbell' ? 2 : 1);
  const effortClass = extra.effortClass || (compound ? 'stable-compound' : 'isolation');
  return {
    pattern,
    primary,
    compound,
    muscleContributions,
    equipment,
    loadType,
    loadMultiplier,
    effortClass,
    sessionRole: extra.sessionRole || (compound ? 'primary' : 'accessory'),
    intensifierEligible: effortClass !== 'high-fatigue-compound',
    selectionPriority: priority,
    ...extra,
  };
}

export const curatedExercises = {
  // Spinta orizzontale
  73: item('hp', ['barbell', 'bench', 'rack'], 16, { effortClass: 'high-fatigue-compound' }),
  75: item('hp', ['dumbbells', 'bench'], 15),
  537: item('hp', ['dumbbells', 'bench'], 14, { executionVariant: 'incline' }),
  538: item('hp', ['barbell', 'bench', 'rack'], 14, { executionVariant: 'incline', effortClass: 'high-fatigue-compound' }),
  185: item('hp', ['barbell', 'bench', 'rack'], 12, { executionVariant: 'decline', effortClass: 'high-fatigue-compound' }),
  186: item('hp', ['dumbbells', 'bench'], 12, { executionVariant: 'decline' }),
  1084: item('hp', ['dumbbells'], 13),
  129: item('hp', ['machines'], 13),
  1831: item('hp', ['machines'], 12, { executionVariant: 'decline' }),
  1551: item('hp', ['bodyweight'], 14),
  1112: item('hp', ['bodyweight', 'bench'], 10, { executionVariant: 'feet-elevated' }),
  1111: item('hp', ['bodyweight', 'bench'], 12, { executionVariant: 'hands-elevated' }),
  1086: item('hp', ['bodyweight'], 12, { executionVariant: 'close-grip', primary: 'triceps', muscleContributions: { triceps: 1, chest: .5, shoulders: .25 } }),

  // Preserve meaningful changes in bench angle and equipment.
  238: item('cf', ['dumbbells', 'bench'], 14),
  308: item('cf', ['dumbbells', 'bench'], 12, { executionVariant: 'incline' }),
  237: item('cf', ['cables'], 14, { loadMultiplier: 2, loadUnit: 'per-stack' }),
  135: item('cf', ['machines'], 13),

  // Spinta verticale
  567: item('vp', ['dumbbells', 'bench'], 15, { executionVariant: 'seated', translations: { en: 'Seated Dumbbell Shoulder Press', it: 'Shoulder press con manubri da seduto' } }),
  1968: item('vp', ['dumbbells'], 14, { executionVariant: 'single-arm-standing', loadMultiplier: 1, loadUnit: 'single-dumbbell', translations: { en: 'Standing Single-Arm Dumbbell Shoulder Press', it: 'Shoulder press in piedi con un manubrio' } }),
  20: item('vp', ['dumbbells', 'bench'], 12, { executionVariant: 'arnold', translations: { en: 'Arnold Press', it: 'Arnold press' } }),
  543: item('vp', ['machines'], 13),
  566: item('vp', ['barbell', 'bench', 'rack'], 15, { executionVariant: 'seated', effortClass: 'high-fatigue-compound', translations: { en: 'Seated Barbell Shoulder Press', it: 'Shoulder press con bilanciere da seduto' } }),
  1893: item('vp', ['barbell', 'rack'], 16, { executionVariant: 'standing', effortClass: 'high-fatigue-compound', translations: { en: 'Standing Barbell Overhead Press', it: 'Military press in piedi con bilanciere' } }),
  454: item('vp', ['bodyweight'], 10, { muscleContributions: { shoulders: 1, triceps: .5, chest: .25, core: .25 } }),

  // Tirata orizzontale
  83: item('hr', ['barbell'], 16, { effortClass: 'high-fatigue-compound', translations: { en: 'Bent-Over Barbell Row', it: 'Rematore con bilanciere, presa prona' } }),
  84: item('hr', ['barbell'], 13, { executionVariant: 'underhand-grip', effortClass: 'high-fatigue-compound', translations: { en: 'Underhand Barbell Row', it: 'Rematore con bilanciere, presa supina' } }),
  81: item('hr', ['dumbbells', 'bench'], 15, {
    name: 'One-Arm Dumbbell Row on Bench',
    translations: { en: 'One-Arm Dumbbell Row on Bench', it: 'Rematore con un manubrio su panca' },
    executionVariant: 'single-arm-supported', loadMultiplier: 1, loadUnit: 'single-dumbbell',
  }),
  // The generic Wger Row entry is reviewed here as an ordinary bilateral
  // dumbbell row, with explicit equipment and an app-owned execution guide.
  508: item('hr', ['dumbbells'], 16, {
    name: 'Standing Dumbbell Row',
    translations: { en: 'Standing Dumbbell Row', it: 'Rematore in piedi con manubri' },
    effortClass: 'high-fatigue-compound', executionVariant: 'neutral-grip',
  }),
  1463: item('hr', ['dumbbells'], 13, {
    name: 'Standing Dumbbell Row (Underhand)',
    translations: { en: 'Standing Dumbbell Row (Underhand)', it: 'Rematore in piedi con manubri, presa supina' },
    effortClass: 'high-fatigue-compound', executionVariant: 'underhand-grip',
  }),
  310: item('hr', ['dumbbells', 'bench'], 14, { executionVariant: 'chest-supported', translations: { en: 'Chest-Supported Dumbbell Row', it: 'Rematore con manubri e petto su panca' } }),
  394: item('hr', ['cables'], 14),
  512: item('hr', ['machines'], 13),

  // Tirata verticale
  475: item('vr', ['pullup'], 16, { loadType: 'bodyweight', executionVariant: 'overhand-grip' }),
  152: item('vr', ['pullup'], 15, { loadType: 'bodyweight', executionVariant: 'underhand-grip' }),
  1696: item('vr', ['pullup'], 14, { loadType: 'bodyweight', executionVariant: 'neutral-grip', translations: { en: 'Neutral-Grip Pull-ups', it: 'Trazioni a presa neutra' } }),
  1127: item('vr', ['cables'], 13, { executionVariant: 'underhand-grip' }),
  1136: item('vr', ['cables'], 15, { executionVariant: 'neutral-grip' }),
  723: item('vr', ['cables'], 16, { executionVariant: 'overhand-grip', translations: { en: 'Wide-Grip Lat Pulldown', it: 'Lat machine a presa prona larga' } }),

  // Accosciata e lavoro unilaterale
  // Box squats (977, 397, 1948) are deliberately omitted. Keep an ordinary
  // bodyweight squat instead of requiring a box for the basic squat option.
  1801: item('sq', ['barbell', 'rack'], 16, { effortClass: 'high-fatigue-compound' }),
  371: item('sq', ['machines'], 15),
  1414: item('sq', ['machines'], 14, { executionVariant: 'hack-squat', translations: { en: 'Machine Hack Squat', it: 'Hack squat alla macchina' } }),
  1312: item('sq', ['bodyweight'], 13, { name: 'Bodyweight Squat', translations: { en: 'Bodyweight Squat', it: 'Squat a corpo libero' } }),
  257: item('sq', ['barbell', 'rack'], 14, { executionVariant: 'front', effortClass: 'high-fatigue-compound' }),
  1706: item('sl', ['dumbbells', 'bench'], 13, { effortClass: 'high-fatigue-compound' }),
  203: item('sq', ['dumbbells'], 15, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  1640: item('sq', ['dumbbells'], 13, { executionVariant: 'front-rack', translations: { en: 'Double-Dumbbell Front Squat', it: 'Front squat con due manubri' }, effortClass: 'high-fatigue-compound' }),
  1366: item('sl', ['dumbbells'], 13, { executionVariant: 'split-squat', effortClass: 'high-fatigue-compound', translations: { en: 'Dumbbell Split Squat', it: 'Split squat con manubri' } }),
  205: item('sl', ['dumbbells'], 13, { executionVariant: 'forward-lunge', effortClass: 'high-fatigue-compound', translations: { en: 'Dumbbell Forward Lunge', it: 'Affondi avanti con manubri' } }),
  1830: item('sl', ['barbell', 'rack'], 12, { effortClass: 'high-fatigue-compound' }),
  206: item('sl', ['dumbbells'], 14, { effortClass: 'high-fatigue-compound' }),
  1651: item('sl', ['dumbbells'], 13, { executionVariant: 'reverse-lunge', effortClass: 'high-fatigue-compound' }),
  984: item('sl', ['bodyweight'], 12),

  // Hinge ed estensione d'anca
  1652: item('hi', ['dumbbells'], 15, { effortClass: 'high-fatigue-compound' }),
  184: item('hi', ['barbell'], 13, { effortClass: 'high-fatigue-compound' }),
  1700: item('hi', ['barbell'], 14, { executionVariant: 'romanian', effortClass: 'high-fatigue-compound' }),
  630: item('hi', ['barbell'], 12, { executionVariant: 'sumo', effortClass: 'high-fatigue-compound', muscleContributions: { hamstrings: 1, glutes: .5, quads: .5, back: .5 }, translations: { en: 'Sumo Deadlift', it: 'Stacco sumo con bilanciere' } }),
  1736: item('hi', ['dumbbells'], 12, { executionVariant: 'single-leg', loadMultiplier: 1, loadUnit: 'single-dumbbell', effortClass: 'high-fatigue-compound', translations: { en: 'Single-Leg Dumbbell Romanian Deadlift', it: 'Stacco rumeno su una gamba con un manubrio' } }),
  1003: item('hi', ['kettlebell'], 13, { effortClass: 'high-fatigue-compound' }),
  1642: item('he', ['dumbbells', 'bench'], 13, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  294: item('he', ['barbell', 'bench'], 15, { translations: { en: 'Barbell Hip Thrust', it: 'Hip thrust con bilanciere' } }),
  265: item('he', ['bodyweight'], 15),
  1740: item('he', ['bodyweight'], 12, { executionVariant: 'single-leg', translations: { en: 'Single-Leg Glute Bridge', it: 'Ponte glutei su una gamba' } }),

  // Accessori
  364: item('kf', ['machines'], 15, { executionVariant: 'lying', translations: { en: 'Lying Leg Curl', it: 'Leg curl da sdraiato' } }),
  366: item('kf', ['machines'], 14, { executionVariant: 'seated', translations: { en: 'Seated Leg Curl', it: 'Leg curl da seduto' } }),
  369: item('ke', ['machines'], 15),
  348: item('sr', ['dumbbells'], 15),
  1378: item('sr', ['cables'], 13),
  1654: item('sr', ['machines'], 13),
  822: item('rd', ['cables'], 14, { loadMultiplier: 2, loadUnit: 'per-stack' }),
  222: item('rd', ['cables'], 13, { executionVariant: 'face-pull', translations: { en: 'Cable Face Pull', it: 'Face pull ai cavi' } }),
  139: item('rd', ['machines'], 14, { translations: { en: 'Reverse Pec Deck', it: 'Aperture posteriori alla macchina' } }),
  487: item('rd', ['dumbbells', 'bench'], 13, { executionVariant: 'seated', translations: { en: 'Seated Dumbbell Reverse Fly', it: 'Alzate posteriori con manubri da seduto' } }),
  82: item('rd', ['dumbbells'], 14, { executionVariant: 'standing', translations: { en: 'Standing Dumbbell Reverse Fly', it: 'Alzate posteriori con manubri in piedi' } }),
  828: item('rd', ['dumbbells', 'bench'], 12, { executionVariant: 'chest-supported', translations: { en: 'Chest-Supported Dumbbell Reverse Fly', it: 'Alzate posteriori con petto su panca' } }),
  1726: item('sp', ['cables'], 14),
  161: item('sp', ['dumbbells', 'bench'], 11, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell', muscleContributions: { back: 1, chest: .5 } }),
  91: item('ef', ['barbell'], 13),
  92: item('ef', ['dumbbells'], 15),
  272: item('ef', ['dumbbells'], 14, { executionVariant: 'hammer', translations: { en: 'Hammer Curls', it: 'Hammer curl con manubri' } }),
  204: item('ef', ['dumbbells', 'bench'], 13),
  202: item('ef', ['dumbbells', 'bench'], 12, { executionVariant: 'concentration', loadMultiplier: 1, loadUnit: 'single-dumbbell', translations: { en: 'Dumbbell Concentration Curl', it: 'Curl concentrato con un manubrio' } }),
  465: item('ef', ['ezbar', 'preacherbench'], 12, { executionVariant: 'preacher', translations: { en: 'EZ-Bar Preacher Curl', it: 'Curl Scott con bilanciere EZ' } }),
  1424: item('ef', ['machines'], 14, { translations: { en: 'Machine Biceps Curl', it: 'Curl bicipiti alla macchina' } }),
  94: item('ef', ['ezbar'], 14),
  95: item('ef', ['cables'], 14),
  275: item('ef', ['cables'], 13, { executionVariant: 'hammer', translations: { en: 'Cable Rope Hammer Curl', it: 'Hammer curl con corda ai cavi' } }),
  1493: item('ef', ['cables'], 12, { executionVariant: 'bayesian', translations: { en: 'Bayesian Cable Curl', it: 'Curl Bayesian ai cavi' } }),
  50: item('ee', ['barbell'], 12),
  76: item('ee', ['barbell', 'bench', 'rack'], 13, { pattern: 'horizontal-push', compound: true, muscleContributions: { triceps: 1, chest: .5, shoulders: .25 }, effortClass: 'stable-compound' }),
  1336: item('ee', ['dumbbells'], 13, { executionVariant: 'overhead', loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  245: item('ee', ['dumbbells', 'bench'], 14),
  246: item('ee', ['ezbar', 'bench'], 13, { executionVariant: 'lying', translations: { en: 'EZ-Bar Skullcrusher', it: 'French press con bilanciere EZ su panca' } }),
  655: item('ee', ['dumbbells'], 12, { executionVariant: 'kickback', loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  659: item('ee', ['cables'], 15),
  1298: item('ee', ['cables'], 12, { executionVariant: 'cross-body', loadMultiplier: 2, loadUnit: 'per-stack' }),
  1513: item('ee', ['cables'], 14, { executionVariant: 'overhead', translations: { en: 'Overhead Cable Triceps Extension', it: 'Estensioni tricipiti sopra la testa ai cavi' } }),
  194: item('ee', ['bodyweight', 'dipbars'], 13, { pattern: 'horizontal-push', compound: true, muscleContributions: { triceps: 1, chest: .5, shoulders: .25 }, effortClass: 'stable-compound', loadType: 'bodyweight' }),
  622: item('cr', ['machines'], 14, { executionVariant: 'standing', translations: { en: 'Standing Machine Calf Raise', it: 'Calf raise in piedi alla macchina' } }),
  1243: item('cr', ['bodyweight'], 14, { translations: { en: 'Bodyweight Standing Calf Raise', it: 'Calf raise in piedi a corpo libero' } }),
  702: item('cr', ['bodyweight'], 12, { executionVariant: 'single-leg', translations: { en: 'Single-Leg Calf Raise', it: 'Calf raise su una gamba' } }),
  1620: item('cr', ['dumbbells', 'bench'], 13, { executionVariant: 'seated', loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  590: item('cr', ['machines'], 13, { executionVariant: 'seated', translations: { en: 'Seated Machine Calf Raise', it: 'Calf raise da seduto alla macchina' } }),
  146: item('cr', ['machines'], 13),
  1573: item('ae', ['bodyweight', 'abwheel'], 14),
  167: item('tf', ['bodyweight'], 14),
  1648: item('tf', ['dumbbells'], 12, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  172: item('tf', ['machines'], 13, { translations: { en: 'Machine Crunch', it: 'Crunch alla macchina' } }),
  173: item('tf', ['cables'], 14, { translations: { en: 'Cable Crunch', it: 'Crunch ai cavi' } }),
  1772: item('tf', ['bodyweight'], 12, { executionVariant: 'reverse-crunch', translations: { en: 'Reverse Crunch', it: 'Crunch inverso' } }),
  978: item('tf', ['pullup'], 12, { loadType: 'bodyweight', executionVariant: 'hanging-knee-raise', translations: { en: 'Hanging Knee Raise', it: 'Sollevamento ginocchia alla sbarra' } }),
};

// Keep the established seated Wger identity intact. A reviewed local variant
// has its own stable ID and guide instead of borrowing the seated illustration.
export const curatedExerciseVariants = [{
  baseWgerId: 567,
  id: 'wger-567-standing',
  name: 'Standing Dumbbell Shoulder Press',
  translations: { en: 'Standing Dumbbell Shoulder Press', it: 'Shoulder press con manubri in piedi' },
  equipment: ['dumbbells'],
  executionVariant: 'standing',
  descriptionEn: 'Stand holding a dumbbell at each shoulder, with the feet planted and the trunk braced. Press both dumbbells overhead without bending the knees, pushing with the legs or arching the lower back. Lower under control to shoulder height. Keep the wrists above the elbows and work within a comfortable range. No bench is required. Record the weight of one dumbbell.',
}];

// Local assets reviewed and owned by the app must survive a Wger refresh.
// Keeping this registry next to the catalog makes the sync and curator share
// one source of truth instead of relying on files that happen to exist.
export const curatedGuideImageOverrides = {
  265: '/exercise-images/265.webp',
  245: '/exercise-images/245.svg',
  655: '/exercise-images/655.svg',
};

export const curatedGuideImageAttributionOverrides = {
  265: { author: 'Easyfit', sourceUrl: '', licenseName: 'Easyfit original asset', licenseUrl: '' },
  245: {
    author: 'Everkinetic',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lying_triceps_extension_with_dumbbells_1.svg',
    licenseName: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
  655: {
    author: 'Everkinetic',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Triceps_kickback_with_dumbbell_1.svg',
    licenseName: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
};

const editorOverridesUrl = new URL('./catalog-overrides.json', import.meta.url);

/**
 * Merge the reviewed base registry with developer-editor changes. The PWA never
 * reads this file at runtime: the result is materialized into generated JSON by
 * the curation scripts, keeping production small and completely offline.
 */
export async function loadCatalogRegistry() {
  let document = { schemaVersion: 1, exercises: {} };
  try {
    document = JSON.parse(await readFile(editorOverridesUrl, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const registry = { ...curatedExercises };
  const guideDescriptions = {};
  const guideImages = { ...curatedGuideImageOverrides };
  const guideImageAttributions = { ...curatedGuideImageAttributionOverrides };
  for (const [id, entry] of Object.entries(document.exercises || {})) {
    if (entry.enabled === false) {
      delete registry[id];
      continue;
    }
    if (entry.programming) registry[id] = { ...(registry[id] || {}), ...entry.programming };
    if (entry.guide?.descriptionEn?.trim()) guideDescriptions[id] = entry.guide.descriptionEn.trim();
    if (entry.guide?.image?.trim()) guideImages[id] = entry.guide.image.trim();
    if (entry.guide?.imageAttribution) guideImageAttributions[id] = entry.guide.imageAttribution;
  }
  return { curatedExercises: registry, guideDescriptions, guideImages, guideImageAttributions, overrides: document };
}
