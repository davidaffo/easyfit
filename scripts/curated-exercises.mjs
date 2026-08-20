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
    intensifierEligible: effortClass !== 'high-fatigue-compound',
    selectionPriority: priority,
    ...extra,
  };
}

export const curatedExercises = {
  // Spinta orizzontale
  73: item('hp', ['barbell', 'bench', 'rack'], 16, { effortClass: 'high-fatigue-compound' }),
  75: item('hp', ['dumbbells', 'bench'], 15),
  129: item('hp', ['machines'], 13),
  1831: item('hp', ['machines'], 12),
  1551: item('hp', ['bodyweight'], 14),
  1112: item('hp', ['bodyweight', 'bench'], 10),

  // Isolamento petto: una variante canonica per attrezzatura, senza microvarianti.
  238: item('cf', ['dumbbells', 'bench'], 14),
  237: item('cf', ['cables'], 14),
  135: item('cf', ['machines'], 13),

  // Spinta verticale
  567: item('vp', ['dumbbells'], 15),
  566: item('vp', ['barbell', 'rack'], 16, { effortClass: 'high-fatigue-compound' }),
  454: item('vp', ['bodyweight'], 10, { muscleContributions: { shoulders: 1, triceps: .5, chest: .25, core: .25 } }),

  // Tirata orizzontale
  83: item('hr', ['barbell'], 16, { effortClass: 'high-fatigue-compound' }),
  81: item('hr', ['dumbbells'], 15),
  394: item('hr', ['cables'], 14),
  512: item('hr', ['machines'], 13),

  // Tirata verticale
  475: item('vr', ['pullup'], 16, { loadType: 'bodyweight' }),
  152: item('vr', ['pullup'], 15, { loadType: 'bodyweight' }),
  1127: item('vr', ['cables'], 13),
  1136: item('vr', ['cables'], 15),

  // Accosciata e lavoro unilaterale
  1801: item('sq', ['barbell', 'rack'], 16, { effortClass: 'high-fatigue-compound' }),
  371: item('sq', ['machines'], 15),
  977: item('sq', ['bodyweight', 'bench'], 13),
  1706: item('sl', ['dumbbells', 'bench'], 13, { effortClass: 'high-fatigue-compound' }),
  203: item('sq', ['dumbbells'], 15, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  1830: item('sl', ['barbell', 'rack'], 12, { effortClass: 'high-fatigue-compound' }),
  206: item('sl', ['dumbbells'], 14, { effortClass: 'high-fatigue-compound' }),
  984: item('sl', ['bodyweight'], 12),

  // Hinge ed estensione d'anca
  1652: item('hi', ['dumbbells'], 15, { effortClass: 'high-fatigue-compound' }),
  184: item('hi', ['barbell'], 13, { effortClass: 'high-fatigue-compound' }),
  1003: item('hi', ['kettlebell'], 13, { effortClass: 'high-fatigue-compound' }),
  1642: item('he', ['dumbbells', 'bench'], 13, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  265: item('he', ['bodyweight'], 15),

  // Accessori
  364: item('kf', ['machines'], 15),
  365: item('kf', ['machines'], 12),
  369: item('ke', ['machines'], 15),
  348: item('sr', ['dumbbells'], 15),
  1378: item('sr', ['cables'], 13),
  1654: item('sr', ['machines'], 13),
  822: item('rd', ['cables'], 14),
  1726: item('sp', ['cables'], 14),
  161: item('sp', ['dumbbells', 'bench'], 11, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell', muscleContributions: { back: 1, chest: .5 } }),
  91: item('ef', ['barbell'], 13),
  92: item('ef', ['dumbbells'], 15),
  94: item('ef', ['ezbar'], 14),
  95: item('ef', ['cables'], 14),
  50: item('ee', ['barbell'], 12),
  1336: item('ee', ['dumbbells'], 13, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  659: item('ee', ['cables'], 15),
  622: item('cr', ['bodyweight'], 14),
  1620: item('cr', ['dumbbells'], 13, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
  146: item('cr', ['machines'], 13),
  1573: item('ae', ['bodyweight', 'abwheel'], 14),
  167: item('tf', ['bodyweight'], 14),
  1648: item('tf', ['dumbbells'], 12, { loadType: 'external', loadMultiplier: 1, loadUnit: 'single-dumbbell' }),
};

// Local assets reviewed and owned by the app must survive a Wger refresh.
// Keeping this registry next to the catalog makes the sync and curator share
// one source of truth instead of relying on files that happen to exist.
export const curatedGuideImageOverrides = {
  265: '/exercise-images/265.webp',
};
