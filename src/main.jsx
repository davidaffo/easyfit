import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { equipmentLabels, exerciseCatalogMeta, exercises, getExerciseName, muscles } from './data/exercises.js';
import {
  BACKUP_FILENAME,
  MAX_BACKUP_BYTES,
  backupDownloadName,
  downloadWebDavBackup,
  isWorkoutRecord,
  parseBackup,
  serializeBackup,
  uploadWebDavBackup,
} from './data/backup.js';
import { getExerciseDetails } from './data/exerciseDetails.js';
import {
  ENGINE_VERSION,
  addWorkoutSet,
  calibrateBodyweightPrescription,
  generateWorkout,
  generateWorkoutAlternatives,
  getExerciseAnalytics,
  getEquipmentCoverage,
  getMuscleTrainingStatus,
  getExerciseHistory,
  getExercisePrescription,
  getTrackedExerciseIds,
  getRecovery,
  getSimilarExercises,
  getWorkoutExercise,
  isExerciseAllowed,
  isCompatibleWorkout,
  isPreparedWorkoutStale,
  isWorkoutActive,
  migrateWorkoutToCurrentEngine,
  removeExercise,
  removeWorkoutSet,
  recalibrateTrainingTargets,
  rebuildWorkoutMetadata,
  replaceExercise,
  startWorkout,
  trainingStyles,
  willCompleteExercise,
} from './engine/generator.js';
import './styles.css';

const defaultProfile = {
  goal: 'muscle',
  level: 'intermediate',
  equipment: ['bodyweight', 'dumbbells', 'bench'],
  loadInventory: { dumbbells: [], kettlebell: [], barbell: [], ezbar: [], machines: [], cables: [] },
  exerciseLoadInventory: {},
  recoveryFeedback: {},
  trainingAdaptation: {},
  duration: 45,
  trainingStyle: 'balanced',
  targetRir: 2,
  setCaps: { compound: 3, accessory: 4 },
  setCapsVersion: 2,
  exerciseOverrides: {},
  cloud: { webDavUrl: '', webDavUsername: '' },
  split: 'adaptive',
  exerciseLanguage: 'en',
  exerciseFilters: { preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
  preferences: {},
};

const goalLabels = { muscle: 'Massa muscolare', strength: 'Forza', fitness: 'Forma fisica' };
const trainingStyleSummaries = {
  intense: '2 serie multi · 3 accessori · molto vicine al limite',
  balanced: '3 serie · fatica ben distribuita',
  volume: '3–4 serie · maggiore margine',
};

function normalizeProfile(profile = {}) {
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const savedSetCaps = isObject(profile.setCaps) ? profile.setCaps : {};
  const shouldMigrateSetCaps = !profile.setCapsVersion
    && Number(savedSetCaps.compound) === 4
    && Number(savedSetCaps.accessory) === 3;
  const inferredTrainingStyle = Object.hasOwn(trainingStyles, profile.trainingStyle)
    ? profile.trainingStyle
    : Number(profile.targetRir) <= 1 && Number(savedSetCaps.compound) <= 2
      ? 'intense'
      : Number(profile.targetRir) >= 3 || Number(savedSetCaps.compound) >= 4
        ? 'volume'
        : 'balanced';
  const { focusEnabled, focusExerciseIds, focusCycleLength, focusCycleStartedAt, ...cleanProfile } = profile;
  const loadInventory = Object.fromEntries(Object.keys(defaultProfile.loadInventory).map((equipment) => [
    equipment,
    [...new Set((Array.isArray(profile.loadInventory?.[equipment]) ? profile.loadInventory[equipment] : [])
      .map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b),
  ]));
  const exerciseLoadInventory = Object.fromEntries(Object.entries(isObject(profile.exerciseLoadInventory) ? profile.exerciseLoadInventory : {})
    .map(([exerciseId, values]) => [exerciseId, [...new Set((Array.isArray(values) ? values : [])
      .map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b)])
    .filter(([, values]) => values.length));
  const supportedExerciseFilters = Object.fromEntries(Object.entries(isObject(profile.exerciseFilters) ? profile.exerciseFilters : {})
    .filter(([key]) => key !== 'essentialCatalog'));
  return {
    ...defaultProfile,
    ...cleanProfile,
    equipment: Array.isArray(profile.equipment) && profile.equipment.length ? profile.equipment : defaultProfile.equipment,
    loadInventory,
    exerciseLoadInventory,
    recoveryFeedback: isObject(profile.recoveryFeedback) ? profile.recoveryFeedback : {},
    trainingAdaptation: isObject(profile.trainingAdaptation) ? profile.trainingAdaptation : {},
    preferences: isObject(profile.preferences) ? profile.preferences : {},
    exerciseFilters: { ...defaultProfile.exerciseFilters, ...supportedExerciseFilters },
    setCaps: shouldMigrateSetCaps ? defaultProfile.setCaps : { ...defaultProfile.setCaps, ...savedSetCaps },
    setCapsVersion: 2,
    exerciseOverrides: isObject(profile.exerciseOverrides) ? profile.exerciseOverrides : {},
    trainingStyle: inferredTrainingStyle,
    split: 'adaptive',
    cloud: {
      webDavUrl: profile.cloud?.webDavUrl || '',
      webDavUsername: profile.cloud?.webDavUsername || '',
    },
  };
}

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function workoutSessionSeconds(workout) {
  if (Number.isFinite(Number(workout?.sessionDurationSeconds))) return Math.max(0, Number(workout.sessionDurationSeconds));
  const elapsed = Number(workout?.completedAt) - Number(workout?.startedAt) - Number(workout?.pausedDurationMs || 0);
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / 1000) : Math.max(60, Number(workout?.duration || 0) * 60);
}

function showRestNotification(restEndsAt, completed = false) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  const options = completed
    ? { body: 'Puoi iniziare la prossima serie.', tag: 'easyfit-rest', renotify: true, icon: `${import.meta.env.BASE_URL}icon-192.png` }
    : { body: `Termina alle ${new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(restEndsAt)}.`, tag: 'easyfit-rest', silent: true, icon: `${import.meta.env.BASE_URL}icon-192.png` };
  const title = completed ? 'Beep beep · recupero terminato' : 'Recupero in corso';
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, options)).catch(() => {});
  } else {
    try { new Notification(title, options); } catch { /* Unsupported notification surface. */ }
  }
}

function persist(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function persistAppStateAtomically(entries) {
  const previous = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]));
  try {
    entries.forEach(([key, value]) => {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    });
    return true;
  } catch {
    entries.forEach(([key]) => {
      try {
        const value = previous.get(key);
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // Best-effort rollback: the active workout is written last, so quota
        // failures cannot delete it before history and profile are durable.
      }
    });
    return false;
  }
}

function loadHistory() {
  const history = load('easyfit-history', []);
  if (!Array.isArray(history)) return [];
  return history.filter((workout) => isWorkoutRecord(workout)
    && Number.isFinite(Number(workout.completedAt))
    && Number(workout.completedAt) > 0);
}

function Icon({ name, size = 22 }) {
  const paths = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    body: <><circle cx="12" cy="4.5" r="2.5"/><path d="M8 9c1.2-1 6.8-1 8 0l1 5-3 1-.5 6h-3L10 15l-3-1 1-5Z"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 3.4-6 8-6s7.2 2 8 6"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    spark: <><path d="m12 3 1.4 4.1L17 9l-3.6 1.9L12 15l-1.4-4.1L7 9l3.6-1.9L12 3Z"/><path d="m18.5 15 .7 2.1L21 18l-1.8.9-.7 2.1-.7-2.1L16 18l1.8-.9.7-2.1Z"/></>,
    swap: <><path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="m18 7-3 3M6 17l3-3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></>,
    upload: <><path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M5 20h14"/></>,
    cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.9A6 6 0 0 0 6.2 9.2 4.5 4.5 0 0 0 7 18Z"/>,
    arrow: <><path d="M19 12H5m0 0 5-5m-5 5 5 5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4v1a4 4 0 0 0 4 4m8-5h4v1a4 4 0 0 1-4 4M12 13v4m-4 3h8"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6m4-6v6"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.2 9A7 7 0 0 0 6.1 6.1L4 9m2 6a7 7 0 0 0 11.9 2.9L20 15"/></>,
    guide: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><i/><i/><i/></span><span>easyfit</span></div>;
}

function useExerciseDetails(wgerId, language = 'en') {
  const [details, setDetails] = useState(null);
  useEffect(() => {
    let active = true;
    setDetails(null);
    getExerciseDetails(wgerId, language)
      .then((value) => { if (active) setDetails(value); });
    return () => { active = false; };
  }, [wgerId, language]);
  return details;
}

function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(defaultProfile);

  const toggleEquipment = (id) => {
    setProfile((current) => ({
      ...current,
      equipment: current.equipment.includes(id)
        ? current.equipment.filter((item) => item !== id)
        : [...current.equipment, id],
    }));
  };
  const missingLoadEquipment = Object.keys(defaultProfile.loadInventory)
    .filter((equipment) => !['machines', 'cables'].includes(equipment))
    .filter((equipment) => profile.equipment.includes(equipment) && !(profile.loadInventory?.[equipment] || []).length);
  const equipmentCoverage = getEquipmentCoverage(profile);
  const missingMovementFamilies = Object.entries(equipmentCoverage).filter(([, available]) => !available).map(([family]) => family);

  if (step === 0) {
    return <main className="onboarding hero-screen">
      <div className="onboarding-top"><Brand/><span className="eyebrow">IL TUO ALLENAMENTO, PRONTO</span></div>
      <div className="hero-visual" aria-hidden="true">
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
        <div className="hero-number">01</div>
        <div className="hero-card"><Icon name="spark"/><span>Creato per te</span><strong>45 min · Adattivo</strong></div>
      </div>
      <div className="hero-copy">
        <h1>Meno scelte.<br/><em>Più risultati.</em></h1>
        <p>Ogni volta che ti alleni, Easyfit decide cosa fare in base al tuo recupero e ai tuoi progressi.</p>
        <button className="button primary wide" onClick={() => setStep(1)}>Configura in 60 secondi <Icon name="chevron"/></button>
      </div>
    </main>;
  }

  if (step === 1) {
    return <main className="onboarding setup-screen">
      <SetupHeader step={1} title="Qual è il tuo obiettivo?" subtitle="Lo useremo per scegliere volume e intensità." onBack={() => setStep(0)}/>
      <div className="choice-list">
        {[
          ['muscle', 'Costruire muscoli', 'Volume bilanciato · 8–12 ripetizioni', '01'],
          ['strength', 'Diventare più forte', 'Carichi alti · recuperi più lunghi', '02'],
          ['fitness', 'Restare in forma', 'Ritmo sostenuto · più ripetizioni', '03'],
        ].map(([id, title, text, number]) => <button key={id} className={`choice-card ${profile.goal === id ? 'selected' : ''}`} onClick={() => setProfile({ ...profile, goal: id })}>
          <span className="choice-number">{number}</span><span><strong>{title}</strong><small>{text}</small></span><span className="radio"><i/></span>
        </button>)}
      </div>
      <button className="button primary wide sticky-action" onClick={() => setStep(2)}>Continua <Icon name="chevron"/></button>
    </main>;
  }

  if (step === 2) {
    return <main className="onboarding setup-screen">
      <SetupHeader step={2} title="Dove ti alleni?" subtitle="Mostreremo solo esercizi che puoi davvero fare." onBack={() => setStep(1)}/>
      <div className="equipment-grid">
        {Object.entries(equipmentLabels).map(([id, label]) => <button key={id} className={`equipment-chip ${profile.equipment.includes(id) ? 'selected' : ''}`} onClick={() => toggleEquipment(id)}>
          <span className="equipment-glyph">{id === 'bodyweight' ? '◯' : id === 'dumbbells' ? '━' : id === 'barbell' ? '═' : id === 'bench' ? '▰' : id === 'cables' ? '⌁' : id === 'machines' ? '▥' : '∩'}</span>
          <span>{label}</span><span className="mini-check"><Icon name="check" size={14}/></span>
        </button>)}
      </div>
      <WeightInventoryEditor profile={profile} setProfile={setProfile}/>
      {missingLoadEquipment.length > 0 && <p className="inventory-required">Seleziona almeno un carico per {missingLoadEquipment.map((id) => equipmentLabels[id]).join(', ')}.</p>}
      {missingMovementFamilies.length > 0 && <p className="inventory-required">Attrezzatura incompleta: mancano movimenti per {missingMovementFamilies.map((family) => ({ push: 'spinta', pull: 'tirata', knee: 'quadricipiti', hip: 'catena posteriore' })[family]).join(', ')}. Potrai comunque continuare: il generatore userà solo i movimenti disponibili.</p>}
      <button className="button primary wide sticky-action" disabled={!profile.equipment.length || missingLoadEquipment.length > 0} onClick={() => setStep(3)}>Continua <Icon name="chevron"/></button>
    </main>;
  }

  return <main className="onboarding setup-screen">
    <SetupHeader step={3} title="Ultimi dettagli" subtitle="Potrai cambiarli in qualsiasi momento." onBack={() => setStep(2)}/>
    <section className="form-section">
      <label>Esperienza</label>
      <div className="segmented">
        {[['beginner', 'Inizio ora'], ['intermediate', 'Intermedio'], ['advanced', 'Esperto']].map(([id, label]) => <button key={id} className={profile.level === id ? 'selected' : ''} onClick={() => setProfile({ ...profile, level: id })}>{label}</button>)}
      </div>
    </section>
    <section className="form-section">
      <div className="range-label"><label>Durata indicativa</label><strong>{profile.duration} min</strong></div>
      <input type="range" min="25" max="75" step="5" value={profile.duration} onChange={(event) => setProfile({ ...profile, duration: Number(event.target.value) })}/>
      <div className="range-scale"><span>25 min</span><span>75 min</span></div>
    </section>
    <section className="form-section">
      <label>Come ti piace allenarti?</label>
      <div className="training-style-list">{Object.entries(trainingStyles).map(([id, style]) => <button key={id} className={profile.trainingStyle === id ? 'selected' : ''} onClick={() => setProfile({ ...profile, trainingStyle: id })}>
        <span><strong>{style.label}{style.recommended ? ' · Consigliato' : ''}</strong><small>{trainingStyleSummaries[id]}</small></span><span className="radio"><i/></span>
      </button>)}</div>
      <p className="form-help">Easyfit traduce lo stile in serie, RIR e recuperi diversi per multiarticolari e isolamenti.</p>
    </section>
    <button className="button primary wide sticky-action" onClick={() => onDone(profile)}>Crea il mio workout <Icon name="spark"/></button>
  </main>;
}

function WeightInventoryEditor({ profile, setProfile }) {
  const [custom, setCustom] = useState({});
  const visible = Object.keys(defaultProfile.loadInventory)
    .filter((equipment) => !['machines', 'cables'].includes(equipment))
    .filter((equipment) => profile.equipment.includes(equipment));
  const usesExerciseSpecificLoads = profile.equipment.some((equipment) => ['machines', 'cables'].includes(equipment));
  const specific = Object.entries(profile.exerciseLoadInventory || {})
    .map(([exerciseId, loads]) => ({ exercise: exercises.find((item) => item.id === exerciseId), loads }))
    .filter(({ exercise, loads }) => exercise && loads.length && exercise.equipment.some((equipment) => profile.equipment.includes(equipment)));
  if (!visible.length && !usesExerciseSpecificLoads && !specific.length) return null;
  const remove = (equipment, load) => {
    const next = (profile.loadInventory?.[equipment] || []).filter((value) => value !== load);
    setProfile({ ...profile, loadInventory: { ...profile.loadInventory, [equipment]: next } });
  };
  const addCustom = (equipment) => {
    const value = Number(custom[equipment]);
    if (!Number.isFinite(value) || value <= 0) return;
    const next = [...new Set([...(profile.loadInventory?.[equipment] || []), value])].sort((a, b) => a - b);
    setProfile({ ...profile, loadInventory: { ...profile.loadInventory, [equipment]: next } });
    setCustom({ ...custom, [equipment]: '' });
  };
  const removeSpecific = (exerciseId, load) => {
    const exerciseLoadInventory = { ...(profile.exerciseLoadInventory || {}) };
    const next = (exerciseLoadInventory[exerciseId] || []).filter((value) => value !== load);
    if (next.length) exerciseLoadInventory[exerciseId] = next;
    else delete exerciseLoadInventory[exerciseId];
    setProfile({ ...profile, exerciseLoadInventory });
  };
  const addSpecific = (exerciseId) => {
    const value = Number(custom[exerciseId]);
    if (!Number.isFinite(value) || value <= 0) return;
    const next = [...new Set([...(profile.exerciseLoadInventory?.[exerciseId] || []), value])].sort((a, b) => a - b);
    setProfile({ ...profile, exerciseLoadInventory: { ...(profile.exerciseLoadInventory || {}), [exerciseId]: next } });
    setCustom({ ...custom, [exerciseId]: '' });
  };
  return <div className="load-inventory"><div><strong>Carichi disponibili</strong><small>La progressione userà soltanto i pesi che inserisci.</small></div>{visible.map((equipment) => <section key={equipment}>
    <label>{equipmentLabels[equipment]} · kg {equipment === 'dumbbells' ? 'per manubrio' : 'totali'}</label>
    <form className="custom-load" onSubmit={(event) => { event.preventDefault(); addCustom(equipment); }}><input aria-label={`Peso disponibile per ${equipmentLabels[equipment]}`} inputMode="decimal" type="number" min="0.5" max="1000" step="0.5" placeholder={equipment === 'dumbbells' ? 'Es. 10 kg per manubrio' : 'Es. 20 kg'} value={custom[equipment] || ''} onChange={(event) => setCustom({ ...custom, [equipment]: event.target.value })}/><button type="submit" disabled={!Number.isFinite(Number(custom[equipment])) || Number(custom[equipment]) <= 0}>Aggiungi</button></form>
    {(profile.loadInventory?.[equipment] || []).length
      ? <div className="load-chip-list saved-loads" aria-label={`Pesi salvati per ${equipmentLabels[equipment]}`}>{profile.loadInventory[equipment].map((load) => <button type="button" key={load} onClick={() => remove(equipment, load)} aria-label={`Rimuovi ${load} kg`}><strong>{load} kg</strong><span aria-hidden="true">×</span></button>)}</div>
      : <p className="empty-loads">Nessun peso inserito</p>}
  </section>)}{usesExerciseSpecificLoads && <p className="setting-help no-margin">Macchine e cavi hanno stack diversi: il carico viene chiesto e salvato separatamente alla prima esecuzione di ogni esercizio.</p>}{specific.map(({ exercise, loads }) => <section key={exercise.id}>
    <label>{getExerciseName(exercise, profile.exerciseLanguage)} · kg specifici</label>
    <form className="custom-load" onSubmit={(event) => { event.preventDefault(); addSpecific(exercise.id); }}><input aria-label={`Peso disponibile per ${getExerciseName(exercise, profile.exerciseLanguage)}`} inputMode="decimal" type="number" min="0.5" max="1000" step="0.5" placeholder="Es. 30 kg" value={custom[exercise.id] || ''} onChange={(event) => setCustom({ ...custom, [exercise.id]: event.target.value })}/><button type="submit" disabled={!Number.isFinite(Number(custom[exercise.id])) || Number(custom[exercise.id]) <= 0}>Aggiungi</button></form>
    <div className="load-chip-list saved-loads" aria-label={`Pesi salvati per ${getExerciseName(exercise, profile.exerciseLanguage)}`}>{loads.map((load) => <button type="button" key={load} onClick={() => removeSpecific(exercise.id, load)} aria-label={`Rimuovi ${load} kg da ${getExerciseName(exercise, profile.exerciseLanguage)}`}><strong>{load} kg</strong><span aria-hidden="true">×</span></button>)}</div>
  </section>)}</div>;
}

function SetupHeader({ step, title, subtitle, onBack }) {
  return <>
    <div className="setup-nav"><button className="icon-button" onClick={onBack}><Icon name="arrow"/></button><span>{step} / 3</span><Brand/></div>
    <div className="progress-track"><i style={{ width: `${step / 3 * 100}%` }}/></div>
    <header className="setup-header"><span className="eyebrow">IMPOSTAZIONI</span><h1>{title}</h1><p>{subtitle}</p></header>
  </>;
}

function App() {
  const [profile, setProfile] = useState(() => {
    const saved = load('easyfit-profile', null);
    return saved ? normalizeProfile(saved) : null;
  });
  const [history, setHistory] = useState(loadHistory);
  const [workout, setWorkout] = useState(() => {
    const saved = load('easyfit-workout', null);
    if (!isCompatibleWorkout(saved, profile)) return null;
    const hasRecordedSets = saved.exercises.some((item) => item.sets?.some((set) => set.done));
    const activeSaved = hasRecordedSets && !saved.startedAt ? startWorkout(saved, saved.createdAt) : saved;
    return migrateWorkoutToCurrentEngine(activeSaved, profile, history);
  });
  const [view, setView] = useState('home');
  const [toast, setToast] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const historyHydrated = useRef(false);

  useEffect(() => { if (profile && !persist('easyfit-profile', profile)) setToast('Spazio locale esaurito: esporta un backup'); }, [profile]);
  useEffect(() => {
    if (!historyHydrated.current) {
      historyHydrated.current = true;
      return;
    }
    if (!persist('easyfit-history', history)) setToast('Storico non salvato: esporta un backup e libera spazio');
  }, [history]);
  useEffect(() => {
    if (!persist('easyfit-workout', workout)) setToast('Workout non salvato: libera spazio prima di continuare');
  }, [workout]);
  useEffect(() => {
    // Versions before v16 could persist WebDAV credentials and sync metadata.
    // Manual backup never keeps secrets in browser storage.
    localStorage.removeItem('easyfit-webdav-secret');
    localStorage.removeItem('easyfit-webdav-synced-fingerprint');
  }, []);
  useEffect(() => {
    const handler = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', handler);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!profile || !workout || !isPreparedWorkoutStale(workout, profile, history)) return;
    let generatedProfileDuration = null;
    try {
      generatedProfileDuration = JSON.parse(workout.engine?.settingsFingerprint || '{}').duration;
    } catch {
      generatedProfileDuration = null;
    }
    const duration = Number(generatedProfileDuration) !== Number(profile.duration)
      ? profile.duration
      : workout.duration || profile.duration;
    const regenerated = generateWorkout(profile, history, { duration, variation: Date.now() });
    if (!isCompatibleWorkout(regenerated, profile)) {
      setWorkout(null);
      setToast('Workout precedente incompatibile: genera una nuova scheda');
      return;
    }
    setWorkout(regenerated);
    setToast('Scheda aggiornata con i dati più recenti');
  }, [profile, history, workout?.engine?.version, workout?.createdAt]);

  const finishOnboarding = (newProfile) => {
    setProfile(newProfile);
    setWorkout(generateWorkout(newProfile, []));
  };

  if (!profile) return <Onboarding onDone={finishOnboarding}/>;

  const createWorkout = (duration = profile.duration) => {
    const generated = generateWorkout(profile, history, { duration, variation: Date.now() });
    if (!generated.exercises.length || !generated.exercises.some((item) => item.sets.length)) {
      setToast(generated.engine?.recoveryBlocked
        ? 'Recupero insufficiente: oggi non viene forzato alcun gruppo muscolare'
        : 'Nessun esercizio compatibile: controlla attrezzatura ed esclusioni');
      return;
    }
    const activeWorkout = startWorkout(generated);
    if (!persist('easyfit-workout', activeWorkout)) setToast('Workout non salvato: libera spazio prima di continuare');
    setWorkout(activeWorkout);
    setView('workout');
  };
  const openWorkout = () => {
    if (!workout || workout.completedAt) {
      setWorkout(null);
      setView('home');
      setToast('La sessione era già conclusa ed è stata archiviata');
      return;
    }
    setWorkout((current) => {
      const prepared = isPreparedWorkoutStale(current, profile, history)
        ? generateWorkout(profile, history, { duration: current.duration || profile.duration, variation: Date.now() })
        : current;
      const resumedAt = Date.now();
      const activeWorkout = startWorkout(prepared);
      const resumedWorkout = activeWorkout?.pausedAt
        ? {
          ...activeWorkout,
          pausedDurationMs: Number(activeWorkout.pausedDurationMs || 0) + Math.max(0, resumedAt - Number(activeWorkout.pausedAt)),
          pausedAt: null,
        }
        : activeWorkout;
      if (resumedWorkout && !persist('easyfit-workout', resumedWorkout)) setToast('Workout non salvato: libera spazio prima di continuare');
      return resumedWorkout;
    });
    setView('workout');
  };
  const showToast = (message) => setToast(message);
  const discardWorkout = () => {
    if (!workout) return;
    const doneSets = workout.exercises.reduce((sum, item) => sum + item.sets.filter((set) => set.done).length, 0);
    if (!window.confirm(`Scartare questo workout${doneSets ? ` e le ${doneSets} serie registrate` : ''}? Non verrà aggiunto allo storico.`)) return;
    setWorkout(null);
    setView('home');
    setToast('Workout scartato');
  };
  const resetAppData = () => {
    ['easyfit-profile', 'easyfit-history', 'easyfit-workout', 'easyfit-webdav-secret', 'easyfit-webdav-synced-fingerprint'].forEach((key) => localStorage.removeItem(key));
    setWorkout(null);
    setHistory([]);
    setProfile(null);
    setView('home');
    setToast('');
  };
  const restoreBackup = (backup) => {
    const restoredProfile = normalizeProfile(backup.profile);
    const compatibleWorkout = isCompatibleWorkout(backup.workout, restoredProfile) ? backup.workout : null;
    const restoredWorkout = migrateWorkoutToCurrentEngine(compatibleWorkout, restoredProfile, backup.history);
    if (!persistAppStateAtomically([
      ['easyfit-profile', restoredProfile],
      ['easyfit-history', backup.history],
      ['easyfit-workout', restoredWorkout],
    ])) throw new Error('Spazio locale insufficiente: il backup non è stato applicato.');
    setProfile(restoredProfile);
    setHistory(backup.history);
    setWorkout(restoredWorkout);
    setView('home');
    return { skippedWorkout: Boolean(backup.workout && !restoredWorkout) };
  };

  return <div className="app-shell">
    {view === 'workout' && isWorkoutActive(workout)
      ? <WorkoutView workout={workout} setWorkout={setWorkout} profile={profile} setProfile={setProfile} history={history} showToast={showToast} onBack={() => setView('home')} onFinish={(completed) => {
          const nextHistory = [...history, completed];
          const nextProfile = recalibrateTrainingTargets(profile, nextHistory, completed.completedAt);
          if (!persistAppStateAtomically([
            ['easyfit-history', nextHistory],
            ['easyfit-profile', nextProfile],
            ['easyfit-workout', null],
          ])) {
            showToast('Workout non archiviato: libera spazio o esporta un backup');
            return;
          }
          setHistory(nextHistory);
          setProfile(nextProfile);
          setWorkout(null);
          setView('home');
          showToast('Workout completato. Carichi ricalibrati!');
        }}/>
      : <>
        <div className="page-wrap">
          {view === 'home' && <Home profile={profile} history={history} workout={workout} onOpenWorkout={openWorkout} onDiscardWorkout={discardWorkout} onGenerate={createWorkout} onShowRecovery={() => setView('recovery')} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)}/>}
          {view === 'recovery' && <Recovery history={history} profile={profile} setProfile={setProfile}/>}
          {view === 'history' && <History history={history} profile={profile}/>}
          {view === 'profile' && <Profile profile={profile} setProfile={setProfile} history={history} workout={workout} onRestoreBackup={restoreBackup} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} showToast={showToast} onReset={resetAppData}/>}
        </div>
        <BottomNav view={view} setView={setView}/>
      </>}
    {toast && <div className="toast"><Icon name="check"/><span>{toast}</span></div>}
  </div>;
}

function Home({ profile, history, workout, onOpenWorkout, onDiscardWorkout, onGenerate, onShowRecovery, installPrompt, onInstalled }) {
  const trainingStatus = useMemo(() => getMuscleTrainingStatus(profile, history), [history, profile]);
  const currentPriorities = Object.entries(trainingStatus)
    .filter(([, item]) => !item.excluded)
    .sort((a, b) => b[1].priority - a[1].priority || b[1].recovery - a[1].recovery)
    .slice(0, 3);
  const today = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const completedWeek = history.filter((item) => item.completedAt <= Date.now() && Date.now() - item.completedAt < 7 * 864e5).length;

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    onInstalled();
  };

  return <main className="dashboard">
    <header className="topbar"><Brand/><div className="top-actions">{installPrompt && <button className="icon-button install-button" onClick={install} aria-label="Installa Easyfit"><Icon name="download"/></button>}<button className="avatar">DA</button></div></header>
    <section className="welcome"><span className="eyebrow">{today.toUpperCase()}</span><h1>Ciao, sei pronto?</h1><p>{history.length ? `${completedWeek} allenament${completedWeek === 1 ? 'o' : 'i'} questa settimana. Continua così.` : 'Il tuo primo allenamento è già pronto.'}</p></section>

    <section className="recovery-strip">
      <div><span className="section-kicker">PRIORITÀ DI OGGI</span><div className="fresh-list">{currentPriorities.map(([muscle, item]) => <span key={muscle}><i style={{ '--value': `${item.priority * 3.6}deg` }}/><b>{muscles[muscle]}</b><small>{item.priority}/100</small></span>)}</div></div>
      <button className="round-arrow" aria-label="Vedi recupero" onClick={onShowRecovery}><Icon name="chevron"/></button>
    </section>

    {workout ? <WorkoutHero workout={workout} onOpen={onOpenWorkout} onDiscard={onDiscardWorkout}/> : <EmptyWorkout onGenerate={() => onGenerate(profile.duration)}/>}

    {!isWorkoutActive(workout) && <section className="quick-section">
      <div className="section-heading"><div><span className="section-kicker">REGOLA AL VOLO</span><h2>Quanto tempo hai?</h2></div><span>{profile.duration} min abituali</span></div>
      <div className="duration-row">{[30, 45, 60].map((duration) => <button key={duration} onClick={() => onGenerate(duration)}><Icon name="clock" size={19}/><strong>{duration}</strong><small>min</small></button>)}</div>
    </section>}
  </main>;
}

function WorkoutHero({ workout, onOpen, onDiscard }) {
  const active = isWorkoutActive(workout);
  const estimatedMinutes = Number(workout.engine?.estimatedMinutes) || workout.duration;
  const names = workout.targetMuscles.slice(0, 3).map((item) => muscles[item]).join(' · ');
  return <section className="workout-hero">
    <div className="hero-noise"/><div className="workout-card-head"><span className="today-pill">{active ? 'IN CORSO' : 'OGGI'}</span><span>Multifrequenza adattiva</span></div>
    <div className="workout-card-copy"><h2>{active ? <>Workout<br/>in pausa.</> : <>Il tuo workout<br/>è pronto.</>}</h2><p>{names}</p></div>
    <div className="workout-meta"><span><b>~{estimatedMinutes}</b><small>minuti stimati</small></span><i/><span><b>{workout.exercises.length}</b><small>esercizi</small></span><i/><span><b>{workout.exercises.reduce((sum, item) => sum + item.sets.length, 0)}</b><small>serie</small></span></div>
    <div className="workout-hero-actions"><button className="button acid wide" onClick={onOpen}><span className="play-disc"><Icon name="play" size={18}/></span>{active ? 'Riprendi allenamento' : 'Inizia allenamento'}</button>{active && <button className="discard-workout" onClick={onDiscard}><Icon name="trash" size={16}/> Scarta workout</button>}</div>
  </section>;
}

function EmptyWorkout({ onGenerate }) {
  return <section className="empty-workout"><span className="empty-icon"><Icon name="spark" size={30}/></span><h2>Pronto quando vuoi</h2><p>Genera un workout adatto al tuo recupero di oggi.</p><button className="button dark" onClick={onGenerate}>Genera workout</button></section>;
}

function buildRefreshWorkoutOptions(profile, history, workout, seed) {
  const now = Date.now();
  const recovery = getRecovery(history, now, profile);
  const adaptiveProfile = { ...profile, split: 'adaptive' };
  return generateWorkoutAlternatives(adaptiveProfile, history, workout, { seed, now }).map((candidate, index) => {
    const readiness = candidate.targetMuscles.length
      ? Math.round(candidate.targetMuscles.reduce((sum, muscle) => sum + (recovery[muscle] || 0), 0) / candidate.targetMuscles.length)
      : 0;
    return {
      id: candidate.exercises.map((item) => item.exerciseId).sort().join('|'),
      title: `Proposta adattiva ${index + 1}`,
      text: candidate.targetMuscles.slice(0, 4).map((muscle) => muscles[muscle]).join(' · '),
      readiness,
      workout: candidate,
    };
  });
}

function RefreshWorkoutSheet({ profile, history, workout, seed, onChoose, onClose }) {
  const options = useMemo(
    () => buildRefreshWorkoutOptions(profile, history, workout, seed),
    [profile, history, workout.id, workout.duration, seed],
  );
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="refresh-workout-sheet" role="dialog" aria-modal="true" aria-label="Scegli un'alternativa adattiva">
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">REFRESH WORKOUT</span>
      <h2>Scegli una proposta adattiva</h2>
      <p>Sono alternative complete dello stesso motore: cambiano gli esercizi, non la logica basata su recupero, stimolo, recenza e rotazione.</p>
      <div className="refresh-type-list">{options.map((option) => <button key={option.id} onClick={() => onChoose(option)}>
        <div><strong>{option.title}</strong><small>{option.text}</small></div>
        <span><b>{option.readiness}%</b><small>recupero</small></span>
        <i>{option.workout.exercises.length} esercizi · ~{option.workout.engine.estimatedMinutes} min</i><Icon name="chevron" size={18}/>
      </button>)}</div>
      {!options.length && <p className="refresh-empty">Nessuna alternativa adattiva completa disponibile con il recupero attuale.</p>}
    </section>
  </div>;
}

function applyExercisePrescriptionLimits(item, limits) {
  const hasCompletedSets = item.sets.some((set) => set.done);
  const completedCount = item.sets.filter((set) => set.done).length;
  let unfinishedSlots = Math.max(0, limits.maxSets - completedCount);
  const visibleSets = hasCompletedSets
    ? item.sets.filter((set) => set.done || unfinishedSlots-- > 0)
    : item.sets.slice(0, limits.maxSets);
  const targetRirs = limits.targetRirs?.length
    ? (visibleSets.length === 1
      ? [limits.targetRirs.at(-1)]
      : [limits.targetRirs[0], ...limits.targetRirs.slice(-(visibleSets.length - 1))])
    : Array.from({ length: visibleSets.length }, () => limits.targetRir);
  return {
    ...item,
    targetRir: targetRirs.at(-1) ?? limits.targetRir,
    targetRirs,
    repRange: { min: limits.minReps, max: limits.maxReps },
    progressionStep: 'custom',
    sets: visibleSets.map((set, index) => {
      if (set.done) {
        return {
          ...set,
          targetRir: set.targetRir ?? item.targetRir,
        };
      }
      const targetReps = Math.min(limits.maxReps, Math.max(limits.minReps, Number(set.targetReps) || limits.minReps));
      return {
        ...set,
        targetReps,
        targetRir: targetRirs[index] ?? limits.targetRir,
        reps: Math.min(limits.maxReps, Math.max(limits.minReps, Number(set.reps) || targetReps)),
      };
    }),
  };
}

function WorkoutView({ workout, setWorkout, profile, setProfile, history, showToast, onBack, onFinish }) {
  const [rest, setRest] = useState(() => Math.max(0, Math.ceil((Number(workout.restEndsAt) - Date.now()) / 1000) || 0));
  const [pendingSet, setPendingSet] = useState(null);
  const [historyExerciseId, setHistoryExerciseId] = useState(null);
  const [guideExerciseId, setGuideExerciseId] = useState(null);
  const [optionsExerciseId, setOptionsExerciseId] = useState(null);
  const [replacementExerciseId, setReplacementExerciseId] = useState(null);
  const [excludeReplacementId, setExcludeReplacementId] = useState(null);
  const [prescriptionExerciseId, setPrescriptionExerciseId] = useState(null);
  const [refreshSeed, setRefreshSeed] = useState(null);
  const [startedAt] = useState(() => Number(workout.startedAt) || Date.now());
  const [sessionNow, setSessionNow] = useState(Date.now());
  const audioContextRef = useRef(null);
  const notifiedRestRef = useRef(null);
  const totalSets = workout.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const doneSets = workout.exercises.reduce((sum, item) => sum + item.sets.filter((set) => set.done).length, 0);
  const elapsedSeconds = Math.max(0, Math.floor((sessionNow - startedAt - Number(workout.pausedDurationMs || 0)) / 1000));

  useEffect(() => {
    const timer = setInterval(() => setSessionNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      audioContextRef.current?.close?.();
    };
  }, []);

  const playRestFinishedSound = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      context.resume?.();
      [0, .2].forEach((delay) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(.0001, context.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(.22, context.currentTime + delay + .01);
        gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + delay + .13);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(context.currentTime + delay);
        oscillator.stop(context.currentTime + delay + .14);
      });
    } catch { /* Audio is optional in restricted browser contexts. */ }
  };

  const clearRest = () => {
    setRest(0);
    setWorkout((current) => {
      const { restEndsAt, restDuration, ...next } = current;
      return next;
    });
  };
  const beginRest = (seconds) => {
    const restEndsAt = Date.now() + seconds * 1000;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !audioContextRef.current) {
      try { audioContextRef.current = new AudioContextClass(); } catch { /* Optional audio enhancement. */ }
    }
    audioContextRef.current?.resume?.().catch?.(() => {});
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') showRestNotification(restEndsAt);
      }).catch(() => {});
    } else {
      showRestNotification(restEndsAt);
    }
    setRest(seconds);
    setWorkout((current) => ({ ...current, restEndsAt, restDuration: seconds }));
  };
  useEffect(() => {
    const restEndsAt = Number(workout.restEndsAt);
    if (!restEndsAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
      setRest(remaining);
      if (!remaining) {
        if (notifiedRestRef.current !== restEndsAt) {
          notifiedRestRef.current = restEndsAt;
          playRestFinishedSound();
          showRestNotification(restEndsAt, true);
        }
        setWorkout((current) => {
          const { restEndsAt: expired, restDuration: expiredDuration, ...next } = current;
          return next;
        });
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [workout.restEndsAt]);

  const updateSet = (exerciseIndex, setIndex, patch, propagateFields = []) => {
    setWorkout((current) => ({ ...current, exercises: current.exercises.map((item, itemIndex) => itemIndex !== exerciseIndex ? item : {
      ...item,
      sets: item.sets.map((set, index) => {
        if (index === setIndex) return { ...set, ...patch };
        if (index < setIndex || set.done || !propagateFields.length) return set;
        return { ...set, ...Object.fromEntries(propagateFields.filter((field) => field in patch).map((field) => [field, patch[field]])) };
      }),
    }) }));
  };
  const changeSetCount = (exerciseIndex, direction) => {
    const currentItem = workout.exercises[exerciseIndex];
    const nextItem = direction > 0 ? addWorkoutSet(currentItem) : removeWorkoutSet(currentItem);
    if (nextItem === currentItem) {
      showToast(direction > 0 ? 'Massimo 6 serie per esercizio' : 'Puoi rimuovere solo l’ultima serie non completata');
      return;
    }
    setWorkout((current) => rebuildWorkoutMetadata({
      ...current,
      exercises: current.exercises.map((item, index) => index === exerciseIndex
        ? (direction > 0 ? addWorkoutSet(item) : removeWorkoutSet(item))
        : item),
    }));
  };
  const rememberExerciseLoad = (exerciseIndex, weight) => {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) return;
    const exercise = exercises.find((candidate) => candidate.id === workout.exercises[exerciseIndex]?.exerciseId);
    const equipment = ['dumbbells', 'kettlebell', 'barbell', 'ezbar', 'machines', 'cables']
      .find((id) => exercise?.equipment.includes(id));
    if (!exercise || !equipment) return;
    setProfile((current) => {
      if (['machines', 'cables'].includes(equipment)) {
        const currentLoads = current.exerciseLoadInventory?.[exercise.id] || [];
        if (currentLoads.some((load) => Math.abs(load - value) < .001)) return current;
        return {
          ...current,
          exerciseLoadInventory: {
            ...(current.exerciseLoadInventory || {}),
            [exercise.id]: [...currentLoads, value].sort((a, b) => a - b),
          },
        };
      }
      const currentLoads = current.loadInventory?.[equipment] || [];
      if (currentLoads.some((load) => Math.abs(load - value) < .001)) return current;
      return {
        ...current,
        loadInventory: {
          ...current.loadInventory,
          [equipment]: [...currentLoads, value].sort((a, b) => a - b),
        },
      };
    });
  };
  const setInitialLoad = (exerciseIndex, weight) => {
    rememberExerciseLoad(exerciseIndex, weight);
    setWorkout((current) => rebuildWorkoutMetadata({
      ...current,
      exercises: current.exercises.map((item, index) => index !== exerciseIndex ? item : {
        ...item,
        needsInitialLoad: false,
        sets: item.sets.map((set) => ({ ...set, weight, targetWeight: weight })),
      }),
    }));
  };
  const recordAvailableLoad = (exerciseIndex, weight) => {
    rememberExerciseLoad(exerciseIndex, weight);
  };
  const setInitialReps = (exerciseIndex, maximumReps) => {
    setWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((item, index) => index === exerciseIndex
        ? calibrateBodyweightPrescription(item, maximumReps)
        : item),
    }));
  };
  const toggleSet = (exerciseIndex, setIndex, item) => {
    const set = item.sets[setIndex];
    if (set.done) return updateSet(exerciseIndex, setIndex, { done: false });
    if (set.rir != null) {
      updateSet(exerciseIndex, setIndex, { done: true });
      beginRest(item.rest);
      return;
    }
    const completesExercise = willCompleteExercise(item.sets, setIndex);
    if (completesExercise) {
      setPendingSet({ exerciseIndex, setIndex, item, wasDone: false });
      return;
    }
    updateSet(exerciseIndex, setIndex, { done: true });
    beginRest(item.rest);
  };
  const chooseRir = (rir) => {
    if (!pendingSet) return;
    updateSet(pendingSet.exerciseIndex, pendingSet.setIndex, { done: true, rir });
    if (!pendingSet.wasDone) beginRest(pendingSet.item.rest);
    setPendingSet(null);
  };
  const canDiscardExercise = (exerciseId) => {
    const item = workout.exercises.find((entry) => entry.exerciseId === exerciseId);
    return !item?.sets.some((set) => set.done) || window.confirm('Questo esercizio contiene serie registrate. Vuoi eliminarle?');
  };
  const openReplacementPicker = (exerciseId) => {
    setOptionsExerciseId(null);
    setReplacementExerciseId(exerciseId);
  };
  const openPrescriptionEditor = (exerciseId) => {
    setOptionsExerciseId(null);
    setPrescriptionExerciseId(exerciseId);
  };
  const saveExercisePrescription = (exerciseId, override) => {
    const exerciseOverrides = { ...(profile.exerciseOverrides || {}) };
    if (override) exerciseOverrides[exerciseId] = override;
    else delete exerciseOverrides[exerciseId];
    const nextProfile = { ...profile, exerciseOverrides };
    const exercise = exercises.find((candidate) => candidate.id === exerciseId);
    const limits = getExercisePrescription(nextProfile, exercise);
    setProfile(nextProfile);
    setWorkout((current) => rebuildWorkoutMetadata({
      ...current,
      exercises: current.exercises.map((item) => {
        if (item.exerciseId !== exerciseId) return item;
        return applyExercisePrescriptionLimits(item, limits);
      }),
    }));
    setPrescriptionExerciseId(null);
    showToast(override ? 'Limiti esercizio aggiornati' : 'Limiti predefiniti ripristinati');
  };
  const replaceCurrentExercise = (exerciseId, selectedExerciseId) => {
    const isExclusion = excludeReplacementId === exerciseId;
    if (!isExclusion && !canDiscardExercise(exerciseId)) return;
    const nextProfile = isExclusion
      ? { ...profile, preferences: { ...profile.preferences, [exerciseId]: 'exclude' } }
      : profile;
    const replacement = replaceExercise(workout, exerciseId, nextProfile, history, selectedExerciseId);
    if (replacement === workout) {
      setReplacementExerciseId(null);
      setExcludeReplacementId(null);
      return showToast('Nessuna alternativa compatibile disponibile');
    }
    if (isExclusion) setProfile(nextProfile);
    setWorkout(replacement);
    setReplacementExerciseId(null);
    setExcludeReplacementId(null);
    showToast(isExclusion ? 'Esercizio escluso e sostituito' : 'Esercizio sostituito con uno simile');
  };
  const removeCurrentExercise = (exerciseId) => {
    if (workout.exercises.length <= 1) return showToast('Il workout deve avere almeno un esercizio');
    if (!canDiscardExercise(exerciseId)) return;
    setWorkout((current) => removeExercise(current, exerciseId));
    setOptionsExerciseId(null);
    showToast('Esercizio rimosso dal workout');
  };
  const excludeExercise = (exerciseId) => {
    if (!canDiscardExercise(exerciseId)) return;
    setOptionsExerciseId(null);
    setExcludeReplacementId(exerciseId);
    setReplacementExerciseId(exerciseId);
    showToast('Scegli un esercizio simile da usare al suo posto');
  };
  const refreshWorkout = (option) => {
    if (doneSets && !window.confirm('Rigenerando il workout perderai le serie già registrate. Continuare?')) return;
    const refreshed = option.workout;
    setWorkout({ ...refreshed, startedAt, pausedDurationMs: Number(workout.pausedDurationMs || 0) });
    setPendingSet(null);
    setRest(0);
    setRefreshSeed(null);
    showToast('Alternativa adattiva caricata');
  };
  const complete = () => {
    if (doneSets < totalSets && !window.confirm(`Hai completato ${doneSets} serie su ${totalSets}. Terminare e archiviare comunque il workout come parziale?`)) return;
    const completedAt = Date.now();
    const { restEndsAt, restDuration, pausedAt, ...completedWorkout } = workout;
    const sessionDurationSeconds = Math.max(0, Math.floor((completedAt - startedAt - Number(workout.pausedDurationMs || 0)) / 1000));
    onFinish({ ...completedWorkout, startedAt, completedAt, sessionDurationSeconds, completionRate: doneSets / totalSets });
  };
  const pauseWorkout = () => {
    setWorkout((current) => ({ ...current, pausedAt: Date.now() }));
    onBack();
  };

  return <main className="workout-view">
    <header className="workout-topbar"><button className="icon-button light" onClick={pauseWorkout} aria-label="Metti in pausa e torna indietro"><Icon name="arrow"/></button><div><span>WORKOUT DI OGGI</span><strong>{formatClock(elapsedSeconds)} · ~{workout.engine?.estimatedMinutes || workout.duration} min previsti</strong></div><button className="icon-button light" onClick={() => setRefreshSeed(Date.now())} aria-label="Scegli un'alternativa adattiva"><Icon name="refresh"/></button></header>
    <div className="workout-progress"><i style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }}/></div>
    <section className="workout-title"><span className="eyebrow">{workout.engine?.returningFromBreak ? 'RIENTRO GRADUALE · VOLUME RIDOTTO' : workout.engine?.maintenanceMode ? 'TARGET COPERTI · MANTENIMENTO' : 'CREATO SUL TUO RECUPERO'}</span><h1>{workout.targetMuscles.slice(0, 2).map((item) => muscles[item]).join(' + ')}</h1><p>{doneSets} di {totalSets} serie completate</p></section>
    <div className="exercise-list">
      {workout.exercises.map((item, exerciseIndex) => <ExerciseCard key={item.exerciseId} item={item} exerciseIndex={exerciseIndex} language={profile.exerciseLanguage} updateSet={updateSet} recordAvailableLoad={recordAvailableLoad} setInitialLoad={setInitialLoad} setInitialReps={setInitialReps} changeSetCount={changeSetCount} toggleSet={toggleSet} onRir={(setIndex) => setPendingSet({ exerciseIndex, setIndex, item, wasDone: item.sets[setIndex].done })} onGuide={() => setGuideExerciseId(item.exerciseId)} onHistory={() => setHistoryExerciseId(item.exerciseId)} onOptions={() => setOptionsExerciseId(item.exerciseId)}/>)}
    </div>
    <div className="finish-panel"><div><span>{totalSets ? Math.round(doneSets / totalSets * 100) : 0}%</span><small>completato</small></div><button className="button acid" disabled={!doneSets || !totalSets} onClick={complete}><Icon name="trophy"/>Termina workout</button></div>
    {rest > 0 && <div className="rest-timer"><div><span>RECUPERO</span><strong>{formatClock(rest)}</strong></div><span className="rest-timer-track"><i style={{ width: `${Math.max(0, Math.min(100, rest / Math.max(1, Number(workout.restDuration) || rest) * 100))}%` }}/></span><button className="skip-rest" onClick={clearRest}>Salta</button></div>}
    {pendingSet && <RirSheet item={pendingSet.item} language={profile.exerciseLanguage} onChoose={chooseRir} onClose={() => setPendingSet(null)}/>}
    {guideExerciseId && <ExerciseGuideSheet exerciseId={guideExerciseId} language={profile.exerciseLanguage} onClose={() => setGuideExerciseId(null)}/>}
    {historyExerciseId && <ExerciseHistorySheet exerciseId={historyExerciseId} history={history} language={profile.exerciseLanguage} onClose={() => setHistoryExerciseId(null)}/>}
    {optionsExerciseId && <ExerciseActionsSheet exerciseId={optionsExerciseId} profile={profile} language={profile.exerciseLanguage} onPrescription={() => openPrescriptionEditor(optionsExerciseId)} onReplace={() => openReplacementPicker(optionsExerciseId)} onRemove={() => removeCurrentExercise(optionsExerciseId)} onExclude={() => excludeExercise(optionsExerciseId)} onClose={() => setOptionsExerciseId(null)}/>}
    {replacementExerciseId && <SimilarExerciseSheet
      workout={workout}
      exerciseId={replacementExerciseId}
      profile={profile}
      language={profile.exerciseLanguage}
      onChoose={(selectedId) => replaceCurrentExercise(replacementExerciseId, selectedId)}
      onClose={() => { setReplacementExerciseId(null); setExcludeReplacementId(null); }}
    />}
    {prescriptionExerciseId && <ExercisePrescriptionSheet
      exerciseId={prescriptionExerciseId}
      profile={profile}
      language={profile.exerciseLanguage}
      onSave={(override) => saveExercisePrescription(prescriptionExerciseId, override)}
      onClose={() => setPrescriptionExerciseId(null)}
    />}
    {refreshSeed != null && <RefreshWorkoutSheet
      profile={profile}
      history={history}
      workout={workout}
      seed={refreshSeed}
      onChoose={refreshWorkout}
      onClose={() => setRefreshSeed(null)}
    />}
  </main>;
}

function ExercisePreview({ source, name, onOpen }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [source]);
  const showImage = source && !failed;
  return <button className={`exercise-preview ${showImage ? '' : 'no-image'}`} onClick={onOpen} aria-label={`Apri guida ${name}`}>{showImage ? <img src={source} alt={`Esecuzione di ${name}`} loading="lazy" onError={() => setFailed(true)}/> : <span className="guide-only"><Icon name="guide" size={22}/><b>Guida esercizio</b></span>}<span><Icon name="guide" size={15}/> Apri guida</span></button>;
}

function SetNumberInput({ value, min, max, step, inputMode, label, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const commit = () => {
    if (draft === '' || !Number.isFinite(Number(draft))) {
      setDraft(value ?? '');
      return;
    }
    const normalized = Math.max(min, Math.min(max, Number(draft)));
    setDraft(normalized);
    if (normalized !== Number(value)) onCommit(normalized);
  };
  return <input
    aria-label={label}
    type="text"
    min={min}
    max={max}
    step={step}
    inputMode={inputMode}
    value={draft}
    onFocus={(event) => event.currentTarget.select()}
    onClick={(event) => event.currentTarget.select()}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
  />;
}

function ExerciseCard({ item, exerciseIndex, language, updateSet, recordAvailableLoad, setInitialLoad, setInitialReps, changeSetCount, toggleSet, onRir, onGuide, onHistory, onOptions }) {
  const exercise = getWorkoutExercise(item);
  const currentCatalogExercise = exercises.some((candidate) => candidate.id === item.exerciseId);
  const details = useExerciseDetails(currentCatalogExercise ? exercise.wgerId : null, 'en');
  const [initialLoad, setInitialLoadValue] = useState('');
  const [initialReps, setInitialRepsValue] = useState('');
  const usesWeight = ['external', 'per-dumbbell'].includes(exercise.loadType);
  const needsInitialLoad = usesWeight && item.sets.every((set) => set.weight == null);
  const submitInitialLoad = (event) => {
    event.preventDefault();
    const weight = Number(initialLoad);
    if (weight > 0) setInitialLoad(exerciseIndex, weight);
  };
  const submitInitialReps = (event) => {
    event.preventDefault();
    const repetitions = Number(initialReps);
    if (repetitions > 0) setInitialReps(exerciseIndex, repetitions);
  };

  return <article className="exercise-card">
    <header><span className="exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</span><div><div className="exercise-name-row"><h2>{getExerciseName(exercise, language)}</h2>{item.progressionStep === 'reps' && <span className="progression-badge">+1 REP</span>}{item.progressionStep === 'performance-reps' && <span className="progression-badge">REPS RICALIBRATE</span>}{item.progressionStep === 'load' && <span className="progression-badge load">+ CARICO</span>}</div><p>{muscles[exercise.primary] || 'Esercizio salvato'} · {item.sets.length} × {item.sets[0].targetReps || item.sets[0].reps}{item.calibrationBelowRange ? ' · range adattato alla capacità' : item.repRange ? ` · range ${item.repRange.min}–${item.repRange.max}` : ''} · RIR {item.targetRir}</p></div>{currentCatalogExercise && <button className="icon-button" onClick={onOptions} aria-label={`Opzioni per ${getExerciseName(exercise, language)}`}><Icon name="more" size={20}/></button>}</header>
    {currentCatalogExercise && <ExercisePreview source={details?.image} name={getExerciseName(exercise, language)} onOpen={onGuide}/>}
    {needsInitialLoad ? <form className="initial-load" onSubmit={submitInitialLoad}>
      <div><span>PRIMA VOLTA</span><strong>Che carico vuoi usare?</strong><small>Scegli un peso con cui pensi di chiudere le serie a RIR {item.targetRir}.</small></div>
      <label><input autoFocus inputMode="decimal" type="number" min="0.5" max="1000" step="0.5" placeholder="0" value={initialLoad} onChange={(event) => setInitialLoadValue(event.target.value)}/><span>kg {exercise.loadType === 'per-dumbbell' ? 'per manubrio' : exercise.loadUnit === 'single-dumbbell' ? 'del manubrio' : ''}</span></label>
      <button className="button dark" disabled={Number(initialLoad) <= 0}>Imposta carico</button>
    </form> : item.needsInitialReps ? <form className="initial-load bodyweight-calibration" onSubmit={submitInitialReps}>
      <div><span>CALIBRAZIONE INIZIALE</span><strong>Quante ripetizioni massime?</strong><small>Inserisci quante ripetizioni pulite riusciresti a fare arrivando a cedimento. Easyfit sottrae il RIR target e rispetta il limite dell’esercizio.</small></div>
      <label><input autoFocus inputMode="numeric" type="number" min="1" max="100" step="1" placeholder="0" value={initialReps} onChange={(event) => setInitialRepsValue(event.target.value)}/><span>reps</span></label>
      <button className="button dark" disabled={Number(initialReps) <= 0}>Calibra serie</button>
    </form> : <>
      <div className="set-head"><span>SET</span><span>KG</span><span>REPS</span><span>RIR</span><span>FATTO</span></div>
      <div className="sets">{item.sets.map((set, setIndex) => <div className={`set-row ${set.done ? 'done' : ''}`} key={setIndex}>
        <strong>{setIndex + 1}</strong>
        {!usesWeight ? <span className="bodyweight-value">{exercise.loadType === 'bodyweight' ? 'Corpo' : '—'}</span> : <SetNumberInput
          value={set.weight}
          min={0}
          max={1000}
          step={0.5}
          inputMode="decimal"
          label={`Peso set ${setIndex + 1}`}
          onCommit={(weight) => {
            updateSet(exerciseIndex, setIndex, { weight }, ['weight']);
            recordAvailableLoad(exerciseIndex, weight);
          }}
        />}
        <SetNumberInput value={set.reps} min={0} max={100} step={1} inputMode="numeric" label={`Ripetizioni set ${setIndex + 1}`} onCommit={(reps) => updateSet(exerciseIndex, setIndex, { reps }, ['reps'])}/>
        <button className={`rir-value ${set.rir != null ? 'recorded' : ''}`} aria-label={`RIR set ${setIndex + 1}: ${set.rir == null ? `target ${set.targetRir}` : set.rir}`} onClick={() => onRir(setIndex)}>{set.rir == null ? `T${set.targetRir}` : set.rir === 4 ? '4+' : set.rir}</button>
        <button className="set-check" onClick={() => toggleSet(exerciseIndex, setIndex, item)}><Icon name="check" size={18}/></button>
      </div>)}</div>
      <div className="manual-set-controls"><button onClick={() => changeSetCount(exerciseIndex, -1)} disabled={item.sets.length <= 1 || item.sets.at(-1).done}>− Serie</button><span>{item.sets.length} serie</span><button onClick={() => changeSetCount(exerciseIndex, 1)} disabled={item.sets.length >= 6}>+ Serie</button></div>
    </>}
    <footer><span><Icon name="clock" size={16}/> {item.rest >= 60 ? `${Math.floor(item.rest / 60)}:${String(item.rest % 60).padStart(2, '0')}` : `${item.rest}s`} recupero{item.estimatedOneRepMax ? ` · e1RM ${Math.round(item.estimatedOneRepMax)} kg` : ''}</span>{currentCatalogExercise && <div className="exercise-actions"><button onClick={onGuide}><Icon name="guide" size={15}/> Guida</button><button onClick={onHistory}><Icon name="history" size={15}/> Storico</button><button onClick={onOptions} aria-label="Opzioni"><Icon name="more" size={15}/></button></div>}</footer>
  </article>;
}

function RirSheet({ item, language, onChoose, onClose }) {
  const exercise = getWorkoutExercise(item);
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="rir-sheet" role="dialog" aria-modal="true" aria-label="Registra RIR">
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">FINE ESERCIZIO · {getExerciseName(exercise, language).toUpperCase()}</span>
      <h2>Quante ripetizioni avevi<br/>ancora nell’ultima serie?</h2>
      <p>Lo chiediamo una sola volta per ricalibrare il prossimo carico insieme alle ripetizioni realmente completate. Puoi sempre correggere il RIR di una singola serie.</p>
      <div className="rir-options">
        {[[0, 'Cedimento'], [1, 'Una'], [2, 'Due'], [3, 'Tre'], [4, 'Quattro+']].map(([value, label]) => <button key={value} className={value === item.targetRir ? 'target' : ''} onClick={() => onChoose(value)}><strong>{value === 4 ? '4+' : value}</strong><small>{label}</small>{value === item.targetRir && <i>target</i>}</button>)}
      </div>
    </section>
  </div>;
}

function ExerciseGuideSheet({ exerciseId, language, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  const details = useExerciseDetails(exercise.wgerId, 'en');
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [details?.image]);
  const equipment = exercise.equipment.map((id) => equipmentLabels[id] || id).join(' · ');

  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="guide-sheet" role="dialog" aria-modal="true" aria-label={`Guida ${getExerciseName(exercise, language)}`}>
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">GUIDA ESERCIZIO</span>
      <h2>{getExerciseName(exercise, language)}</h2>
      <p>{muscles[exercise.primary]} · {equipment}</p>
      {details?.image && !imageFailed ? <div className="guide-image"><img src={details.image} alt={`Esecuzione di ${getExerciseName(exercise, language)}`} onError={() => setImageFailed(true)}/></div> : <div className="guide-image-placeholder"><Icon name="guide" size={31}/><span>Immagine non disponibile</span></div>}
      <section className="guide-copy"><span className="section-kicker">ESECUZIONE · {details?.descriptionSource === 'easyfit-curated' ? 'GUIDA CURATA EASYFIT' : 'FONTE INGLESE WGER'}</span>{details ? (details.description ? <p>{details.description}</p> : <p className="guide-missing">La spiegazione non è disponibile.</p>) : <p className="guide-missing">Caricamento della guida…</p>}</section>
      <footer className="guide-source"><span>Esercizio: <a href="https://wger.de" target="_blank" rel="noreferrer">wger</a>{details?.descriptionSource === 'easyfit-curated' ? ' · istruzioni revisionate da Easyfit' : ''}</span>{exercise.license && <span>Testo: {exercise.license.name}{exercise.license.author ? ` · ${exercise.license.author}` : ''}</span>}{details?.image && details.imageAttribution && <span>Immagine: {details.imageAttribution.sourceUrl ? <a href={details.imageAttribution.sourceUrl} target="_blank" rel="noreferrer">{details.imageAttribution.author || 'fonte'}</a> : details.imageAttribution.author}{details.imageAttribution.licenseName ? ' · ' : ''}{details.imageAttribution.licenseUrl ? <a href={details.imageAttribution.licenseUrl} target="_blank" rel="noreferrer">{details.imageAttribution.licenseName}</a> : details.imageAttribution.licenseName}</span>}</footer>
    </section>
  </div>;
}

function ExerciseActionsSheet({ exerciseId, profile, language, onPrescription, onReplace, onRemove, onExclude, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  const limits = getExercisePrescription(profile, exercise);
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="exercise-actions-sheet" role="dialog" aria-modal="true" aria-label={`Opzioni ${getExerciseName(exercise, language)}`}>
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">OPZIONI ESERCIZIO</span>
      <h2>{getExerciseName(exercise, language)}</h2>
      <p>La sostituzione mantiene lo stesso movimento quando possibile.</p>
      <div className="exercise-option-list">
        <button onClick={onPrescription}><span><Icon name="settings"/></span><div><strong>Personalizzazione avanzata</strong><small>Max {limits.maxSets} serie · {limits.minReps}–{limits.maxReps} reps · RIR {limits.targetRirs.join(' → ')}</small></div><Icon name="chevron" size={18}/></button>
        <button onClick={onReplace}><span><Icon name="swap"/></span><div><strong>Sostituisci con uno simile</strong><small>Stesso pattern muscolare e attrezzatura disponibile</small></div><Icon name="chevron" size={18}/></button>
        <button onClick={onRemove}><span><Icon name="trash"/></span><div><strong>Rimuovi da questo workout</strong><small>Potrà ricomparire nei prossimi allenamenti</small></div><Icon name="chevron" size={18}/></button>
        <button className="danger" onClick={onExclude}><span><Icon name="ban"/></span><div><strong>Non proporre più</strong><small>Lo esclude anche dai workout futuri</small></div><Icon name="chevron" size={18}/></button>
      </div>
    </section>
  </div>;
}

function ExercisePrescriptionSheet({ exerciseId, profile, language, onSave, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  const current = getExercisePrescription(profile, exercise);
  const saved = profile.exerciseOverrides?.[exerciseId];
  const [maxSets, setMaxSets] = useState(current.maxSets);
  const [minReps, setMinReps] = useState(current.minReps);
  const [maxReps, setMaxReps] = useState(current.maxReps);
  const [targetRir, setTargetRir] = useState(saved?.targetRir ?? 'global');
  const changeMinReps = (value) => {
    const next = Math.min(49, Math.max(1, Number(value) || 1));
    setMinReps(next);
    if (next > maxReps) setMaxReps(next);
  };
  const changeMaxReps = (value) => setMaxReps(Math.min(50, Math.max(minReps, Number(value) || minReps)));
  const save = () => onSave({
    maxSets,
    minReps,
    maxReps,
    ...(targetRir === 'global' ? {} : { targetRir: Number(targetRir) }),
  });

  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="prescription-sheet" role="dialog" aria-modal="true" aria-label={`Limiti ${getExerciseName(exercise, language)}`}>
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">LIMITI ESERCIZIO</span>
      <h2>{getExerciseName(exercise, language)}</h2>
      <p>La doppia progressione sale prima nelle ripetizioni, poi nel carico.</p>
      <div className="prescription-controls">
        <div className="limit-row"><div><strong>Serie massime</strong><small>Il motore può usarne meno</small></div><div className="stepper"><button onClick={() => setMaxSets(Math.max(1, maxSets - 1))}>−</button><b>{maxSets}</b><button onClick={() => setMaxSets(Math.min(6, maxSets + 1))}>+</button></div></div>
        <div className="limit-row rep-limit-row"><div><strong>Intervallo ripetizioni</strong><small>Aumentano una alla volta</small></div><div className="rep-limit-inputs"><label><span>MIN</span><input type="number" inputMode="numeric" min="1" max="49" value={minReps} onChange={(event) => changeMinReps(event.target.value)}/></label><i>–</i><label><span>MAX</span><input type="number" inputMode="numeric" min={minReps} max="50" value={maxReps} onChange={(event) => changeMaxReps(event.target.value)}/></label></div></div>
        <div className="rir-limit"><div><strong>RIR target</strong><small>Può seguire lo stile o usare un valore specifico</small></div><div className="rir-choice"><button className={targetRir === 'global' ? 'selected' : ''} onClick={() => setTargetRir('global')}>Stile · {current.targetRirs.join('→')}</button>{[0, 1, 2, 3, 4].map((rir) => <button key={rir} className={targetRir === rir ? 'selected' : ''} onClick={() => setTargetRir(rir)}>{rir === 4 ? '4+' : rir}</button>)}</div></div>
      </div>
      <p className="failure-note">RIR 0 è consentito: aumenta però la fatica e non garantisce più crescita rispetto a fermarsi vicino al cedimento.</p>
      <div className="prescription-actions"><button className="button dark" onClick={save}>Salva limiti</button>{saved && <button onClick={() => onSave(null)}>Ripristina default</button>}</div>
    </section>
  </div>;
}

function SimilarExerciseSheet({ workout, exerciseId, profile, language, onChoose, onClose }) {
  const [query, setQuery] = useState('');
  const current = exercises.find((candidate) => candidate.id === exerciseId);
  const alternatives = useMemo(() => getSimilarExercises(workout, exerciseId, profile), [workout, exerciseId, profile]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = alternatives.filter((exercise) => {
    if (!normalizedQuery) return true;
    const equipment = exercise.equipment.map((id) => equipmentLabels[id] || id).join(' ');
    return `${exercise.name} ${getExerciseName(exercise, language)} ${equipment}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const exact = filtered.filter((exercise) => exercise.pattern === current.pattern);
  const related = filtered.filter((exercise) => exercise.pattern !== current.pattern);
  const renderGroup = (title, items) => items.length > 0 && <section className="similar-group">
    <h3>{title}<span>{items.length}</span></h3>
    <div className="similar-list">{items.map((exercise) => <button key={exercise.id} onClick={() => onChoose(exercise.id)}>
      <span className="similar-glyph"><Icon name="swap" size={16}/></span>
      <div><strong>{getExerciseName(exercise, language)}</strong><small>{muscles[exercise.primary]} · {exercise.equipment.map((id) => equipmentLabels[id] || id).join(' + ')}</small></div>
      <Icon name="chevron" size={17}/>
    </button>)}</div>
  </section>;

  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="similar-sheet" role="dialog" aria-modal="true" aria-label={`Sostituisci ${getExerciseName(current, language)}`}>
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">SOSTITUISCI ESERCIZIO</span>
      <h2>Scegli l’alternativa</h2>
      <p>Al posto di <strong>{getExerciseName(current, language)}</strong></p>
      <label className="similar-search"><span>CERCA</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome o attrezzatura"/></label>
      {filtered.length ? <div className="similar-results">{renderGroup('Stesso movimento', exact)}{renderGroup('Stesso gruppo muscolare', related)}</div> : <div className="similar-empty"><Icon name="swap" size={27}/><strong>Nessuna alternativa trovata</strong><span>Prova un’altra ricerca o modifica l’attrezzatura.</span></div>}
    </section>
  </div>;
}

function ExerciseTrend({ points, metric }) {
  const visible = points.slice(-10);
  if (visible.length < 2) return <div className="trend-empty">Servono almeno due sessioni per mostrare il trend.</div>;
  const values = visible.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, max * 0.08, 1);
  const coordinates = visible.map((point, index) => ({
    x: 12 + index * (296 / (visible.length - 1)),
    y: 86 - ((point.value - min) / spread) * 64,
    ...point,
  }));

  return <div className="trend-chart">
    <div className="trend-label"><span>ULTIME {visible.length} SESSIONI</span><strong>{Math.round(values.at(-1) * 10) / 10} {metric === 'e1rm' ? 'kg e1RM' : 'reps'}</strong></div>
    <svg viewBox="0 0 320 100" role="img" aria-label="Andamento dell'esercizio">
      <path d="M12 86H308M12 54H308M12 22H308" className="chart-grid"/>
      <polyline points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')} className="chart-line"/>
      {coordinates.map(({ x, y, completedAt }) => <circle key={completedAt} cx={x} cy={y} r="3.5"/>)}
    </svg>
  </div>;
}

function ExerciseHistorySheet({ exerciseId, history, language, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  const stats = useMemo(() => getExerciseHistory(history, exerciseId), [history, exerciseId]);
  const weighted = stats.metric === 'e1rm';
  const formatDate = (value) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(value);

  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="history-sheet" role="dialog" aria-modal="true" aria-label={`Storico ${getExerciseName(exercise, language)}`}>
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">STORICO ESERCIZIO</span>
      <h2>{getExerciseName(exercise, language)}</h2>
      <p>{muscles[exercise.primary]} · dati calcolati sulle serie completate</p>
      {stats.sessionCount === 0 ? <div className="exercise-history-empty"><Icon name="history" size={31}/><strong>Nessuna sessione precedente</strong><span>La prima comparirà qui appena termini il workout.</span></div> : <>
        <div className="exercise-stats">
          <div><strong>{stats.sessionCount}</strong><span>Sessioni</span></div>
          <div><strong>{weighted ? `${Math.round(stats.bestE1rm)} kg` : stats.maxReps}</strong><span>{weighted ? 'Miglior e1RM' : 'Max reps'}</span></div>
          <div><strong>{stats.totalSets}</strong><span>Serie</span></div>
        </div>
        <ExerciseTrend points={stats.points} metric={stats.metric}/>
        <div className="exercise-session-list">
          <h3>Sessioni precedenti <small>Più recente per prima</small></h3>
          {[...stats.sessions].reverse().map((session) => <article key={session.workoutId + session.completedAt}>
            <header><strong>{formatDate(session.completedAt)}</strong><span>{session.sets.length} {session.sets.length === 1 ? 'serie' : 'serie'}</span></header>
            <div className="exercise-set-history" role="table" aria-label={`Serie del ${formatDate(session.completedAt)}`}>
              <div className="exercise-set-history-head" role="row"><span>Serie</span><span>Peso</span><span>Reps</span><span>RIR</span></div>
              {session.sets.map((set, index) => {
                const actualRir = set.rir;
                const displayedRir = actualRir ?? set.targetRir;
                return <div className="exercise-set-history-row" role="row" key={`${session.workoutId}-${index}`}>
                  <strong>{index + 1}</strong>
                  <span>{weighted ? (Number(set.weight) > 0 ? `${set.weight} kg` : '—') : 'Corpo'}</span>
                  <span>{Number(set.reps) || '—'}</span>
                  <span className={actualRir == null && displayedRir != null ? 'target-value' : ''}>{displayedRir == null ? '—' : displayedRir === 4 ? '4+' : displayedRir}{actualRir == null && displayedRir != null && <small>target</small>}</span>
                </div>;
              })}
            </div>
            {session.bestE1rm && <footer>e1RM migliore: {Math.round(session.bestE1rm * 10) / 10} kg</footer>}
          </article>)}
        </div>
      </>}
    </section>
  </div>;
}

function Recovery({ history, profile, setProfile }) {
  const status = useMemo(() => getMuscleTrainingStatus(profile, history), [profile, history]);
  const sorted = Object.entries(status)
    .filter(([, item]) => !item.excluded)
    .sort((a, b) => b[1].priority - a[1].priority || b[1].recovery - a[1].recovery);
  const averageRecovery = Math.round(sorted.reduce((sum, [, item]) => sum + item.recovery, 0) / sorted.length);
  const priorities = sorted.filter(([, item]) => item.priority >= 45).slice(0, 3).map(([muscle]) => muscles[muscle]);
  const lastStimulusLabel = (hours) => hours == null ? 'Mai stimolato' : hours < 24 ? 'Stimolato oggi' : hours < 48 ? 'Stimolato ieri' : `${Math.floor(hours / 24)} giorni fa`;
  const statusLabel = (item) => item.recovery < 55 ? 'In recupero' : item.priority >= 65 ? 'Priorità alta' : item.doseStimulus >= item.targetStimulus ? 'Target raggiunto' : 'Disponibile';
  const adjustRecovery = (muscle, amount) => setProfile((current) => ({
    ...current,
    recoveryFeedback: {
      ...current.recoveryFeedback,
      [muscle]: { adjustment: Math.max(-20, Math.min(20, Number(current.recoveryFeedback?.[muscle]?.adjustment || 0) + amount)), updatedAt: Date.now() },
    },
  }));
  return <main className="standard-page"><PageHeader kicker="IL TUO CORPO" title="Recupero e stimolo" subtitle="Disponibilità, lavoro accumulato e tempo dall’ultimo stimolo."/>
    <section className="recovery-summary"><div className="recovery-score"><span>{averageRecovery}<small>%</small></span><p>Recupero medio</p></div><div><strong>{priorities.length ? `Priorità: ${priorities.join(', ')}` : 'Recupera prima del prossimo stimolo.'}</strong><p>La priorità non usa soltanto il recupero: aumenta quando manca dose recente o il muscolo non viene stimolato da più tempo.</p></div></section>
    <section className="muscle-list training-status-list"><div className="list-caption"><span>GRUPPO MUSCOLARE · MEMORIA ADATTIVA</span><span>PRIORITÀ</span></div>{sorted.map(([muscle, item]) => <div className="muscle-row" key={muscle}><span className="muscle-dot" style={{ opacity: Math.max(.35, item.recovery / 100) }}/><div><div className="muscle-status-title"><strong>{muscles[muscle]}</strong><small>{statusLabel(item)}</small></div><div className="status-bars"><span className="recovery-bar" title="Recupero"><i style={{ width: `${item.recovery}%` }}/></span><span className="stimulus-bar" title="Dose recente"><i style={{ width: `${Math.min(100, item.doseStimulus / item.targetStimulus * 100)}%` }}/></span></div><small className="muscle-status-meta">Recupero stimato {item.recovery}% · Dose recente {item.doseStimulus}/{item.targetStimulus} serie equivalenti{item.capacityAdjusted ? ` · target operativo su ${item.desiredStimulusTarget} desiderate` : ''} · {lastStimulusLabel(item.hoursSinceStimulus)}</small><div className="recovery-feedback"><span>Percezione:</span><button onClick={() => adjustRecovery(muscle, -10)}>Più affaticato</button><button onClick={() => adjustRecovery(muscle, 10)}>Più fresco</button></div></div><b>{item.priority}</b></div>)}</section>
    <div className="status-legend"><span><i/>Recupero</span><span><i/>Stimolo accumulato</span><span>Priorità 0–100</span></div>
    <p className="info-note">Fatica e dose usano due orologi distinti: il recupero può tornare completo, mentre lo stimolo recente sfuma gradualmente per mantenere target e rotazione anche tra sedute distanti. Quando il limite di un solo esercizio lower rende il target desiderato incompatibile con la cadenza osservata, l’app mostra e usa un target operativo raggiungibile. Il recupero è arrotondato e resta una stima, non un dato medico; i pulsanti correggono temporaneamente l’algoritmo e il loro effetto si dimezza ogni 24 ore.</p>
  </main>;
}

function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) return '—';
  const percentage = Math.round(value * 1000) / 10;
  return `${percentage > 0 ? '+' : ''}${percentage}%`;
}

function formatVolume(value) {
  if (!Number(value)) return '—';
  return value >= 1000 ? `${Math.round(value / 100) / 10} t` : `${Math.round(value)} kg`;
}

function History({ history, profile }) {
  const [tab, setTab] = useState('summary');
  const [historyExerciseId, setHistoryExerciseId] = useState(null);
  const trackedIds = useMemo(() => getTrackedExerciseIds(history), [history]);
  const analytics = useMemo(() => getExerciseAnalytics(history, trackedIds), [history, trackedIds.join('|')]);
  const validHistory = history.filter((workout) => Number(workout.completedAt) > 0 && Number(workout.completedAt) <= Date.now());
  const totalSets = validHistory.reduce((sum, workout) => sum + workout.exercises.reduce((setSum, item) => setSum + item.sets.filter((set) => set.done).length, 0), 0);
  const maxWeeklyVolume = Math.max(1, ...analytics.items.flatMap((item) => [item.currentWeek.volume, item.previousWeek.volume]));
  const exerciseFor = (item) => exercises.find((exercise) => exercise.id === item.exerciseId);
  const metricLabel = (item, value) => value
    ? `${Math.round(value * 10) / 10} ${item.metric === 'e1rm' ? 'kg e1RM' : 'reps stimate'}`
    : 'Nessun dato';

  return <main className="standard-page progress-page"><PageHeader kicker="I TUOI PROGRESSI" title="Progressi" subtitle="Forza, volume e record calcolati dalle serie completate."/>
    <nav className="progress-tabs" aria-label="Sezioni progressi">{[
      ['summary', 'Riepilogo'], ['strength', 'Forza'], ['volume', 'Volume'], ['records', 'Record'], ['activity', 'Attività'],
    ].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>

    {tab === 'summary' && <>
      <section className="weekly-progress-card">
        <span className="section-kicker">ULTIMI 7 GIORNI · ESERCIZI RICORRENTI</span>
        <div className="weekly-progress-main"><div><strong>{formatPercent(analytics.week.strengthChange)}</strong><span>forza stimata vs settimana precedente</span></div><Icon name="trophy" size={30}/></div>
        <div className="weekly-progress-stats"><div><strong>{analytics.week.trackedSessions}</strong><span>Esecuzioni</span></div><div><strong>{analytics.week.sets}</strong><span>Serie</span></div><div><strong>{formatVolume(analytics.week.volume)}</strong><span>Volume</span></div></div>
        {analytics.week.strengthChange === null && <p>Il confronto apparirà quando gli stessi esercizi avranno dati in entrambe le settimane.</p>}
      </section>
      <section className="focus-progress-list">
        <div className="section-heading compact"><div><span className="section-kicker">CONTINUITÀ AUTOMATICA</span><h2>Esercizi ricorrenti</h2></div><span>ultimi registrati</span></div>
        {analytics.items.map((item) => {
          const exercise = exerciseFor(item);
          const latest = item.stats.points.at(-1)?.value;
          return <button key={item.exerciseId} className="focus-progress-card" onClick={() => setHistoryExerciseId(item.exerciseId)}>
            <div className="focus-progress-head"><span className="focus-glyph"><Icon name="spark" size={16}/></span><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{muscles[exercise.primary]}</small></div><Icon name="chevron" size={17}/></div>
            <div className="focus-cycle-row"><span>L’engine alterna varianti compatibili in multifrequenza e ne misura fino a quattro utilizzi.</span></div>
            <div className="focus-metric-row"><span><small>VALORE ATTUALE</small><strong>{metricLabel(item, latest)}</strong></span><span className={item.overallStrengthChange > 0 ? 'positive' : ''}><small>DA INIZIO STORICO</small><strong>{formatPercent(item.overallStrengthChange)}</strong></span></div>
          </button>;
        })}
      </section>
    </>}

    {tab === 'strength' && <section className="progress-section">
      <div className="progress-intro"><span className="section-kicker">FORZA STIMATA</span><h2>Andamento degli esercizi ricorrenti</h2><p>L’e1RM combina peso, ripetizioni e RIR; a corpo libero viene stimata la capacità massima come ripetizioni eseguite più RIR. Sono confronti personali, non massimali realmente testati.</p></div>
      {analytics.items.map((item) => {
        const exercise = exerciseFor(item);
        const latest = item.stats.points.at(-1)?.value;
        return <article className="metric-panel" key={item.exerciseId}>
          <button className="metric-panel-head" onClick={() => setHistoryExerciseId(item.exerciseId)}><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{metricLabel(item, latest)}</small></div><span className={item.weeklyStrengthChange > 0 ? 'positive' : ''}>{formatPercent(item.weeklyStrengthChange)} questa settimana</span></button>
          <ExerciseTrend points={item.stats.points} metric={item.metric}/>
        </article>;
      })}
    </section>}

    {tab === 'volume' && <section className="progress-section">
      <div className="volume-total"><div><span className="section-kicker">VOLUME TRACCIATO · 7 GIORNI</span><strong>{formatVolume(analytics.week.volume)}</strong></div><span className={analytics.week.volumeChange > 0 ? 'positive' : ''}>{formatPercent(analytics.week.volumeChange)}<small>vs settimana scorsa</small></span></div>
      <div className="volume-list">{analytics.items.map((item) => {
        const exercise = exerciseFor(item);
        return <article key={item.exerciseId}><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><span>{item.currentWeek.sets} serie</span></div><div className="volume-bars"><span><i style={{ width: `${item.currentWeek.volume / maxWeeklyVolume * 100}%` }}/></span><small>{formatVolume(item.currentWeek.volume)}</small><span className="previous"><i style={{ width: `${item.previousWeek.volume / maxWeeklyVolume * 100}%` }}/></span><small>{formatVolume(item.previousWeek.volume)}</small></div></article>;
      })}</div>
      <div className="volume-legend"><span><i/>Questa settimana</span><span><i/>Precedente</span></div>
      <p className="info-note">Il volume è peso × ripetizioni delle serie completate. Per gli esercizi a corpo libero, dove il carico corporeo non è registrato, serie e ripetizioni restano le metriche principali.</p>
    </section>}

    {tab === 'records' && <section className="progress-section records-section">
      <div className="progress-intro"><span className="section-kicker">MIGLIORI PRESTAZIONI</span><h2>Record personali</h2><p>I record si aggiornano automaticamente alla chiusura del workout.</p></div>
      {analytics.items.map((item) => {
        const exercise = exerciseFor(item);
        return <button className="record-card" key={item.exerciseId} onClick={() => setHistoryExerciseId(item.exerciseId)}><header><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{item.stats.sessionCount} sessioni registrate</small></div><Icon name="chevron" size={17}/></header><div><span><strong>{item.stats.bestE1rm ? `${Math.round(item.stats.bestE1rm * 10) / 10} kg` : '—'}</strong><small>e1RM</small></span><span><strong>{item.stats.maxWeight ? `${item.stats.maxWeight} kg` : '—'}</strong><small>Carico max</small></span><span><strong>{item.stats.maxReps || '—'}</strong><small>Reps max</small></span><span><strong>{formatVolume(item.bestSessionVolume)}</strong><small>Volume sessione</small></span></div></button>;
      })}
    </section>}

    {tab === 'activity' && <>
      <section className="stats-grid"><div><strong>{validHistory.length}</strong><span>Workout</span></div><div><strong>{totalSets}</strong><span>Serie totali</span></div><div><strong>{validHistory.reduce((sum, item) => sum + Math.max(1, Math.round(workoutSessionSeconds(item) / 60)), 0)}</strong><span>Minuti</span></div></section>
      <section className="history-list"><h2>Allenamenti recenti</h2>{validHistory.length === 0 ? <div className="history-empty"><Icon name="history" size={30}/><strong>Qui vedrai i tuoi progressi</strong><p>Completa il primo workout per iniziare lo storico.</p></div> : [...validHistory].reverse().map((workout) => <article key={workout.id + workout.completedAt}><div className="history-date"><strong>{new Intl.DateTimeFormat('it-IT', { day: '2-digit' }).format(workout.completedAt)}</strong><span>{new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(workout.completedAt)}</span></div><div><strong>{workout.targetMuscles.slice(0, 3).map((item) => muscles[item]).join(' · ')}</strong><span>{formatClock(workoutSessionSeconds(workout))} · {workout.exercises.length} esercizi</span></div><Icon name="chevron"/></article>)}</section>
    </>}
    {historyExerciseId && <ExerciseHistorySheet
      exerciseId={historyExerciseId}
      history={history}
      language={profile.exerciseLanguage}
      onClose={() => setHistoryExerciseId(null)}
    />}
  </main>;
}

function ExerciseFilterSettings({ profile, update }) {
  const filters = { ...defaultProfile.exerciseFilters, ...(profile.exerciseFilters || {}) };
  const toggle = (key) => update({ exerciseFilters: { ...filters, [key]: !filters[key] } });
  const items = [
    ['preferLoadedVariants', 'Evita corpo libero duplicato', 'Se esiste una variante caricabile compatibile con la tua attrezzatura, usa quella.'],
    ['excludeDirectCore', 'Escludi addominali diretti', 'Niente crunch, plank o altri esercizi con il core come target principale.'],
    ['excludeCalves', 'Escludi polpacci diretti', 'Rimuove calf raise e lavoro specifico per i polpacci.'],
  ];
  return <SettingsGroup title="Filtri automatici"><div className="filter-settings">{items.map(([key, title, text]) => <div key={key}><div><strong>{title}</strong><small>{text}</small></div><button className={`switch ${filters[key] ? 'on' : ''}`} role="switch" aria-checked={filters[key]} onClick={() => toggle(key)}><i/></button></div>)}</div><p className="setting-help">Il generatore usa soltanto esercizi presenti nel registro revisionato: movimenti olimpici, balistici, ibridi o ambigui non sono prescrivibili in nessuna modalità. Il lavoro diretto per i polpacci resta attivo di default perché gli altri esercizi spesso non forniscono uno stimolo sufficiente; puoi comunque disattivarlo qui.</p></SettingsGroup>;
}

function ExcludedExercises({ profile, update }) {
  const excluded = Object.entries(profile.preferences || {})
    .filter(([, preference]) => preference === 'exclude')
    .map(([id]) => exercises.find((exercise) => exercise.id === id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const restore = (exerciseId) => {
    const preferences = { ...profile.preferences };
    delete preferences[exerciseId];
    update({ preferences });
  };

  return <SettingsGroup title={`Esercizi esclusi${excluded.length ? ` · ${excluded.length}` : ''}`}>
    {excluded.length ? <div className="excluded-list">{excluded.map((exercise) => <article key={exercise.id}><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{muscles[exercise.primary]}</small></div><button onClick={() => restore(exercise.id)}>Ripristina</button></article>)}</div> : <p className="setting-help no-margin">Nessun esercizio escluso. Puoi escluderne uno dal menu durante il workout.</p>}
  </SettingsGroup>;
}

function ResetDataSheet({ onConfirm, onClose }) {
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="reset-sheet" role="alertdialog" aria-modal="true" aria-label="Cancella tutti i dati">
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">OPERAZIONE IRREVERSIBILE</span>
      <h2>Ripartire da zero?</h2>
      <p>Verranno cancellati profilo, impostazioni, workout in corso, storico, carichi appresi ed esercizi esclusi.</p>
      <div className="reset-actions"><button className="button reset-danger" onClick={onConfirm}><Icon name="trash"/> Cancella tutti i dati</button><button className="button reset-cancel" onClick={onClose}>Annulla</button></div>
    </section>
  </div>;
}

function downloadBackupFile(serialized) {
  const blob = new Blob([serialized], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupDownloadName();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatBackupDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'data sconosciuta';
}

function BackupSheet({ profile, history, workout, onRestore, onSaveCloud, showToast, onClose }) {
  const [folderUrl, setFolderUrl] = useState(profile.cloud?.webDavUrl || '');
  const [username, setUsername] = useState(profile.cloud?.webDavUsername || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const currentState = { profile, history, workout };

  const saveConnection = () => {
    onSaveCloud({ webDavUrl: folderUrl.trim(), webDavUsername: username.trim() });
  };
  const upload = async () => {
    if (!window.confirm(`Caricare il backup corrente su Nextcloud? L'eventuale ${BACKUP_FILENAME} esistente verrà sostituito.`)) return;
    setBusy('upload');
    setMessage('');
    try {
      saveConnection();
      const backupProfile = {
        ...profile,
        cloud: { webDavUrl: folderUrl.trim(), webDavUsername: username.trim() },
      };
      await uploadWebDavBackup({
        folderUrl,
        username,
        password,
        serialized: serializeBackup({ ...currentState, profile: backupProfile }),
      });
      setMessage('Backup caricato su Nextcloud. Il file precedente è stato sostituito.');
      showToast('Backup caricato su Nextcloud');
    } catch (error) {
      setMessage(error.message || 'Caricamento non riuscito.');
    } finally {
      setBusy('');
    }
  };
  const restore = async () => {
    setBusy('download');
    setMessage('');
    try {
      saveConnection();
      const serialized = await downloadWebDavBackup({ folderUrl, username, password });
      const backup = parseBackup(serialized);
      backup.profile.cloud = { webDavUrl: folderUrl.trim(), webDavUsername: username.trim() };
      const date = formatBackupDate(backup.exportedAt);
      if (!window.confirm(`Ripristinare il backup Nextcloud del ${date}? I dati locali attuali verranno sostituiti.`)) return;
      const result = onRestore(backup);
      showToast(result.skippedWorkout ? 'Backup ripristinato; workout incompatibile ignorato' : 'Backup Nextcloud ripristinato');
    } catch (error) {
      setMessage(error.message || 'Ripristino non riuscito.');
    } finally {
      setBusy('');
    }
  };

  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="cloud-backup-sheet" role="dialog" aria-modal="true" aria-label="Backup Nextcloud">
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">BACKUP CLOUD · WEBDAV</span>
      <h2>Nextcloud</h2>
      <p>Easyfit salva un solo file chiamato <strong>easyfit-backup.json</strong> nella cartella indicata.</p>
      <div className="cloud-fields">
        <label><span>URL CARTELLA WEBDAV</span><input type="url" inputMode="url" value={folderUrl} onChange={(event) => setFolderUrl(event.target.value)} placeholder="https://cloud.example.com/remote.php/dav/files/utente/Easyfit/"/></label>
        <label><span>USERNAME</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="utente"/></label>
        <label><span>APP PASSWORD</span><input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} onBlur={saveConnection} placeholder="Richiesta per questa operazione"/></label>
      </div>
      <p className="cloud-security"><Icon name="check" size={15}/> Upload e ripristino avvengono solo quando premi il relativo pulsante. L’app password resta in memoria soltanto finché questo pannello è aperto.</p>
      {message && <div className="cloud-message">{message}</div>}
      <div className="cloud-actions">
        <button className="button dark" disabled={!folderUrl.trim() || busy} onClick={upload}><Icon name="upload" size={18}/>{busy === 'upload' ? 'Caricamento…' : 'Carica / sovrascrivi'}</button>
        <button className="button cloud-restore" disabled={!folderUrl.trim() || busy} onClick={restore}><Icon name="download" size={18}/>{busy === 'download' ? 'Download…' : 'Ripristina dal cloud'}</button>
      </div>
      <small className="cloud-help">Usa l’URL mostrato in Nextcloud → File → Impostazioni WebDAV e una app password. Le condivisioni pubbliche scrivibili possono usare `/public.php/dav/files/TOKEN`; se protette, usa `anonymous` come username e la password della condivisione.</small>
    </section>
  </div>;
}

function Profile({ profile, setProfile, history, workout, onRestoreBackup, installPrompt, onInstalled, showToast, onReset }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const equipmentCoverage = getEquipmentCoverage(profile);
  const missingMovementFamilies = Object.entries(equipmentCoverage).filter(([, available]) => !available).map(([family]) => family);
  const update = (patch) => { setProfile({ ...profile, ...patch }); showToast('Preferenze aggiornate'); };
  const toggleEquipment = (item) => {
    const equipment = profile.equipment.includes(item) ? profile.equipment.filter((id) => id !== item) : [...profile.equipment, item];
    if (!equipment.length) return showToast('Scegli almeno un tipo di attrezzatura');
    update({ equipment });
  };
  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); onInstalled(); };
  const exportBackup = () => {
    downloadBackupFile(serializeBackup({ profile, history, workout }));
    showToast('Backup esportato');
  };
  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return showToast('Il file di backup è troppo grande');
    try {
      const backup = parseBackup(await file.text());
      const date = formatBackupDate(backup.exportedAt);
      if (!window.confirm(`Importare il backup del ${date}? Profilo, storico e workout locali verranno sostituiti.`)) return;
      const result = onRestoreBackup(backup);
      showToast(result.skippedWorkout ? 'Backup importato; workout incompatibile ignorato' : 'Backup importato');
    } catch (error) {
      showToast(error.message || 'Backup non valido');
    }
  };
  return <main className="standard-page profile-page"><PageHeader kicker="PERSONALIZZAZIONE" title="Impostazioni" subtitle="Tutte le preferenze usate per creare i tuoi workout."/>
    {installPrompt && <button className="install-card" onClick={install}><span><Icon name="download"/></span><div><strong>Installa Easyfit</strong><small>Usala come un’app, anche offline</small></div><Icon name="chevron"/></button>}
    <SettingsGroup title="Obiettivo"><div className="settings-options">{Object.entries(goalLabels).map(([id, label]) => <button className={profile.goal === id ? 'selected' : ''} onClick={() => update({ goal: id })} key={id}>{label}<span><Icon name="check" size={14}/></span></button>)}</div></SettingsGroup>
    <SettingsGroup title="Esperienza"><div className="settings-options">{[['beginner', 'Principiante'], ['intermediate', 'Intermedio'], ['advanced', 'Esperto']].map(([id, label]) => <button className={profile.level === id ? 'selected' : ''} onClick={() => update({ level: id })} key={id}>{label}<span><Icon name="check" size={14}/></span></button>)}</div></SettingsGroup>
    <SettingsGroup title="Stile di allenamento"><div className="training-style-list settings-style-list">{Object.entries(trainingStyles).map(([id, style]) => <button key={id} className={profile.trainingStyle === id ? 'selected' : ''} onClick={() => update({ trainingStyle: id })}>
      <span><strong>{style.label}{style.recommended ? ' · Consigliato' : ''}</strong><small>{trainingStyleSummaries[id]}<br/>{style.description}</small></span><span className="radio"><i/></span>
    </button>)}</div><p className="setting-help">Lo stile controlla automaticamente serie, prossimità al cedimento e recuperi. I multiarticolari ad alta fatica restano più prudenti degli esercizi stabili e degli isolamenti.</p></SettingsGroup>
    <SettingsGroup title="Durata"><div className="range-label"><span>Durata indicativa del workout</span><strong>{profile.duration} min</strong></div><input type="range" min="25" max="75" step="5" value={profile.duration} onChange={(event) => setProfile({ ...profile, duration: Number(event.target.value) })} onPointerUp={() => showToast('Durata aggiornata')}/><p className="setting-help">È un obiettivo indicativo: l’engine può superarlo fino a 5 minuti per non tagliare serie o esercizi sensati. La scheda mostra sempre la stima reale.</p></SettingsGroup>
    <SettingsGroup title="Nomi degli esercizi"><div className="settings-options language-options">
      <button className={profile.exerciseLanguage === 'en' ? 'selected' : ''} onClick={() => update({ exerciseLanguage: 'en' })}>English <span><Icon name="check" size={14}/></span></button>
      <button className={profile.exerciseLanguage === 'it' ? 'selected' : ''} onClick={() => update({ exerciseLanguage: 'it' })}>Italiano, con fallback inglese <span><Icon name="check" size={14}/></span></button>
    </div><p className="setting-help">L’inglese è il nome canonico. {exerciseCatalogMeta.italianTranslations} esercizi hanno anche una traduzione italiana.</p></SettingsGroup>
    <SettingsGroup title="Attrezzatura"><div className="tag-list">{Object.entries(equipmentLabels).map(([id, label]) => <button key={id} className={profile.equipment.includes(id) ? 'selected' : ''} onClick={() => toggleEquipment(id)}>{label}{profile.equipment.includes(id) && <Icon name="check" size={14}/>}</button>)}</div><WeightInventoryEditor profile={profile} setProfile={setProfile}/>{missingMovementFamilies.length > 0 && <p className="inventory-required">Configurazione incompleta: non puoi eseguire {missingMovementFamilies.map((family) => ({ push: 'spinte', pull: 'tirate', knee: 'movimenti per quadricipiti', hip: 'movimenti per catena posteriore' })[family]).join(', ')}. Il generatore userà soltanto le famiglie realmente disponibili.</p>}</SettingsGroup>
    <ExerciseFilterSettings profile={profile} update={update}/>
    <ExcludedExercises profile={profile} update={update}/>
    <SettingsGroup title="Backup e cloud"><div className="backup-options"><button onClick={exportBackup}><span><Icon name="download" size={18}/></span><div><strong>Esporta backup</strong><small>Scarica profilo, storico, workout e preferenze</small></div></button><label><input type="file" accept="application/json,.json" onChange={importBackup}/><span><Icon name="upload" size={18}/></span><div><strong>Importa backup</strong><small>Controlla il file prima di sostituire i dati</small></div></label><button onClick={() => setBackupOpen(true)}><span><Icon name="cloud" size={18}/></span><div><strong>Nextcloud</strong><small>{profile.cloud?.webDavUrl ? 'Connessione WebDAV configurata' : 'Carica o ripristina direttamente dal cloud'}</small></div></button></div><p className="setting-help">Il backup è un JSON versionato. Non contiene immagini del catalogo né credenziali cloud.</p></SettingsGroup>
    <section className="settings-group danger-zone"><h2>Dati dell’app</h2><p>Cancella tutti i dati salvati su questo dispositivo e riapre la configurazione iniziale.</p><button onClick={() => setResetOpen(true)}><Icon name="trash" size={18}/><span><strong>Cancella tutti i dati</strong><small>Profilo, storico, carichi e preferenze</small></span><Icon name="chevron" size={17}/></button></section>
    <div className="catalog-credit">Catalogo: <a href="https://wger.de" target="_blank" rel="noreferrer">wger</a> · {exerciseCatalogMeta.eligible} esercizi compatibili · licenze indicate nei dati sorgente.</div>
    <div className="version">Easyfit · Motore locale v{ENGINE_VERSION}</div>
    {resetOpen && <ResetDataSheet onConfirm={onReset} onClose={() => setResetOpen(false)}/>}
    {backupOpen && <BackupSheet profile={profile} history={history} workout={workout} onRestore={onRestoreBackup} onSaveCloud={(cloud) => setProfile({ ...profile, cloud })} showToast={showToast} onClose={() => setBackupOpen(false)}/>}
  </main>;
}

function SettingsGroup({ title, children }) { return <section className="settings-group"><h2>{title}</h2>{children}</section>; }
function PageHeader({ kicker, title, subtitle }) { return <header className="page-header"><Brand/><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></header>; }

function BottomNav({ view, setView }) {
  return <nav className="bottom-nav">{[
    ['home', 'home', 'Oggi'], ['recovery', 'body', 'Recupero'], ['history', 'history', 'Progressi'], ['profile', 'settings', 'Impostazioni'],
  ].map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span><Icon name={icon}/></span><small>{label}</small></button>)}</nav>;
}

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<App/>);

export { App, WeightInventoryEditor, WorkoutView, applyExercisePrescriptionLimits };
