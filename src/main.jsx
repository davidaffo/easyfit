import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { equipmentLabels, exerciseCatalogMeta, exercises, getExerciseName, muscles } from './data/exercises.js';
import {
  backupDownloadName,
  downloadWebDavBackup,
  parseBackup,
  serializeBackup,
  uploadWebDavBackup,
} from './data/backup.js';
import { getExerciseDetails } from './data/exerciseDetails.js';
import {
  advanceFocusCycles,
  calibrateBodyweightPrescription,
  generateWorkout,
  getFocusAnalytics,
  getExerciseHistory,
  getExercisePrescription,
  getNextFocusExercise,
  getRecovery,
  getSimilarExercises,
  getWorkoutSettingsFingerprint,
  isExerciseAllowed,
  removeExercise,
  replaceExercise,
  suggestFocusExercises,
  willCompleteExercise,
} from './engine/generator.js';
import './styles.css';

const defaultProfile = {
  goal: 'muscle',
  level: 'intermediate',
  equipment: ['bodyweight', 'dumbbells', 'bench'],
  duration: 45,
  targetRir: 2,
  setCaps: { compound: 3, accessory: 4 },
  setCapsVersion: 2,
  exerciseOverrides: {},
  cloud: { webDavUrl: '', webDavUsername: '' },
  split: 'adaptive',
  exerciseLanguage: 'en',
  focusEnabled: true,
  focusExerciseIds: [],
  focusCycleLength: 4,
  focusCycleStartedAt: {},
  exerciseFilters: { essentialCatalog: true, preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
  preferences: {},
};

const goalLabels = { muscle: 'Massa muscolare', strength: 'Forza', fitness: 'Forma fisica' };
const splitLabels = { adaptive: 'Multifrequenza adattiva', full: 'Full body', 'upper-lower': 'Upper / Lower', ppl: 'Push / Pull / Legs' };

function normalizeProfile(profile = {}) {
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const savedSetCaps = isObject(profile.setCaps) ? profile.setCaps : {};
  const shouldMigrateSetCaps = !profile.setCapsVersion
    && Number(savedSetCaps.compound) === 4
    && Number(savedSetCaps.accessory) === 3;
  return {
    ...defaultProfile,
    ...profile,
    equipment: Array.isArray(profile.equipment) && profile.equipment.length ? profile.equipment : defaultProfile.equipment,
    focusExerciseIds: Array.isArray(profile.focusExerciseIds) ? profile.focusExerciseIds : [],
    focusCycleLength: Math.min(8, Math.max(2, Number(profile.focusCycleLength) || 4)),
    focusCycleStartedAt: isObject(profile.focusCycleStartedAt) ? profile.focusCycleStartedAt : {},
    preferences: isObject(profile.preferences) ? profile.preferences : {},
    exerciseFilters: isObject(profile.exerciseFilters)
      ? { ...defaultProfile.exerciseFilters, ...profile.exerciseFilters }
      : defaultProfile.exerciseFilters,
    setCaps: shouldMigrateSetCaps ? defaultProfile.setCaps : { ...defaultProfile.setCaps, ...savedSetCaps },
    setCapsVersion: 2,
    exerciseOverrides: isObject(profile.exerciseOverrides) ? profile.exerciseOverrides : {},
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

  if (step === 0) {
    return <main className="onboarding hero-screen">
      <div className="onboarding-top"><Brand/><span className="eyebrow">IL TUO ALLENAMENTO, PRONTO</span></div>
      <div className="hero-visual" aria-hidden="true">
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
        <div className="hero-number">01</div>
        <div className="hero-card"><Icon name="spark"/><span>Creato per te</span><strong>45 min · Full body</strong></div>
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
      <button className="button primary wide sticky-action" disabled={!profile.equipment.length} onClick={() => setStep(3)}>Continua <Icon name="chevron"/></button>
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
      <div className="range-label"><label>Durata abituale</label><strong>{profile.duration} min</strong></div>
      <input type="range" min="25" max="75" step="5" value={profile.duration} onChange={(event) => setProfile({ ...profile, duration: Number(event.target.value) })}/>
      <div className="range-scale"><span>25 min</span><span>75 min</span></div>
    </section>
    <section className="form-section">
      <label>RIR target</label>
      <div className="segmented rir-segmented">{[0, 1, 2, 3, 4].map((rir) => <button key={rir} className={profile.targetRir === rir ? 'selected' : ''} onClick={() => setProfile({ ...profile, targetRir: rir })}>{rir === 4 ? '4+' : rir}</button>)}</div>
      <p className="form-help">0 significa cedimento. Fermarsi a 1–2 mantiene spesso lo stimolo con meno fatica.</p>
    </section>
    <section className="form-section">
      <label>Organizzazione</label>
      <div className="select-wrap">
        <select value={profile.split} onChange={(event) => setProfile({ ...profile, split: event.target.value })}>
          <option value="adaptive">Multifrequenza adattiva</option><option value="full">Full body</option><option value="upper-lower">Upper / Lower</option><option value="ppl">Push / Pull / Legs</option>
        </select><Icon name="chevron"/>
      </div>
    </section>
    <button className="button primary wide sticky-action" onClick={() => onDone(profile)}>Crea il mio workout <Icon name="spark"/></button>
  </main>;
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
  const [history, setHistory] = useState(() => load('easyfit-history', []));
  const [workout, setWorkout] = useState(() => {
    const saved = load('easyfit-workout', null);
    return saved?.exercises?.every((item) => exercises.some((exercise) => exercise.id === item.exerciseId)) ? saved : null;
  });
  const [view, setView] = useState('home');
  const [toast, setToast] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const previousWorkoutSettings = useRef(null);
  const settingsFingerprint = profile ? getWorkoutSettingsFingerprint(profile) : '';

  useEffect(() => { if (profile) localStorage.setItem('easyfit-profile', JSON.stringify(profile)); }, [profile]);
  useEffect(() => { localStorage.setItem('easyfit-history', JSON.stringify(history)); }, [history]);
  useEffect(() => {
    if (workout) localStorage.setItem('easyfit-workout', JSON.stringify(workout));
    else localStorage.removeItem('easyfit-workout');
  }, [workout]);
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
    if (!profile) {
      previousWorkoutSettings.current = null;
      return;
    }
    const previous = previousWorkoutSettings.current;
    previousWorkoutSettings.current = { fingerprint: settingsFingerprint, duration: profile.duration };
    if (!previous || previous.fingerprint === settingsFingerprint || !workout || view === 'workout') return;
    const duration = previous.duration !== profile.duration ? profile.duration : workout.duration;
    setWorkout(generateWorkout(profile, history, { duration, variation: Date.now() }));
    setToast('Impostazioni applicate: scheda aggiornata');
  }, [settingsFingerprint]);

  const finishOnboarding = (newProfile) => {
    previousWorkoutSettings.current = { fingerprint: getWorkoutSettingsFingerprint(newProfile), duration: newProfile.duration };
    setProfile(newProfile);
    setWorkout(generateWorkout(newProfile, []));
  };

  if (!profile) return <Onboarding onDone={finishOnboarding}/>;

  const createWorkout = (duration = profile.duration) => {
    setWorkout(generateWorkout(profile, history, { duration, variation: Date.now() }));
    setView('workout');
  };
  const showToast = (message) => setToast(message);
  const resetAppData = () => {
    ['easyfit-profile', 'easyfit-history', 'easyfit-workout'].forEach((key) => localStorage.removeItem(key));
    setWorkout(null);
    setHistory([]);
    setProfile(null);
    setView('home');
    setToast('');
  };
  const restoreBackup = (backup) => {
    const restoredWorkout = backup.workout?.exercises?.every((item) => exercises.some((exercise) => exercise.id === item.exerciseId))
      ? backup.workout
      : null;
    const restoredProfile = normalizeProfile(backup.profile);
    previousWorkoutSettings.current = { fingerprint: getWorkoutSettingsFingerprint(restoredProfile), duration: restoredProfile.duration };
    setProfile(restoredProfile);
    setHistory(backup.history);
    setWorkout(restoredWorkout);
    setView('home');
    return { skippedWorkout: Boolean(backup.workout && !restoredWorkout) };
  };

  return <div className="app-shell">
    {view === 'workout' && workout
      ? <WorkoutView workout={workout} setWorkout={setWorkout} profile={profile} setProfile={setProfile} history={history} showToast={showToast} onBack={() => setView('home')} onFinish={(completed) => {
          const nextHistory = [...history, completed];
          const focusUpdate = advanceFocusCycles(profile, nextHistory, completed);
          setHistory(nextHistory);
          setProfile(focusUpdate.profile);
          setWorkout(null);
          setView('home');
          showToast(focusUpdate.rotated.length ? 'Workout completato. Nuovo Focus Exercise scelto!' : 'Workout completato. Carichi ricalibrati!');
        }}/>
      : <>
        <div className="page-wrap">
          {view === 'home' && <Home profile={profile} history={history} workout={workout} onOpenWorkout={() => setView('workout')} onGenerate={createWorkout} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)}/>} 
          {view === 'recovery' && <Recovery history={history}/>} 
          {view === 'history' && <History history={history} profile={profile}/>}
          {view === 'profile' && <Profile profile={profile} setProfile={setProfile} history={history} workout={workout} onRestoreBackup={restoreBackup} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} showToast={showToast} onReset={resetAppData}/>}
        </div>
        <BottomNav view={view} setView={setView}/>
      </>}
    {toast && <div className="toast"><Icon name="check"/><span>{toast}</span></div>}
  </div>;
}

function Home({ profile, history, workout, onOpenWorkout, onGenerate, installPrompt, onInstalled }) {
  const recovery = useMemo(() => getRecovery(history), [history]);
  const fresh = Object.entries(recovery).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const today = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const completedWeek = history.filter((item) => Date.now() - item.completedAt < 7 * 864e5).length;

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    onInstalled();
  };

  return <main className="dashboard">
    <header className="topbar"><Brand/><div className="top-actions">{installPrompt && <button className="icon-button install-button" onClick={install} aria-label="Installa Easyfit"><Icon name="download"/></button>}<button className="avatar">DA</button></div></header>
    <section className="welcome"><span className="eyebrow">{today.toUpperCase()}</span><h1>Ciao, sei pronto?</h1><p>{history.length ? `${completedWeek} allenament${completedWeek === 1 ? 'o' : 'i'} questa settimana. Continua così.` : 'Il tuo primo allenamento è già pronto.'}</p></section>

    <section className="recovery-strip">
      <div><span className="section-kicker">PIÙ RECUPERATI</span><div className="fresh-list">{fresh.map(([muscle, value]) => <span key={muscle}><i style={{ '--value': `${value * 3.6}deg` }}/><b>{muscles[muscle]}</b><small>{value}%</small></span>)}</div></div>
      <button className="round-arrow" aria-label="Vedi recupero"><Icon name="chevron"/></button>
    </section>

    {workout ? <WorkoutHero workout={workout} onOpen={onOpenWorkout} profile={profile}/> : <EmptyWorkout onGenerate={() => onGenerate(profile.duration)}/>} 

    <section className="quick-section">
      <div className="section-heading"><div><span className="section-kicker">REGOLA AL VOLO</span><h2>Quanto tempo hai?</h2></div><span>{profile.duration} min abituali</span></div>
      <div className="duration-row">{[30, 45, 60].map((duration) => <button key={duration} onClick={() => onGenerate(duration)}><Icon name="clock" size={19}/><strong>{duration}</strong><small>min</small></button>)}</div>
    </section>
  </main>;
}

function WorkoutHero({ workout, onOpen, profile }) {
  const names = workout.targetMuscles.slice(0, 3).map((item) => muscles[item]).join(' · ');
  return <section className="workout-hero">
    <div className="hero-noise"/><div className="workout-card-head"><span className="today-pill">OGGI</span><span>{splitLabels[profile.split]}</span></div>
    <div className="workout-card-copy"><h2>Il tuo workout<br/>è pronto.</h2><p>{names}</p></div>
    <div className="workout-meta"><span><b>{workout.duration}</b><small>minuti</small></span><i/><span><b>{workout.exercises.length}</b><small>esercizi</small></span><i/><span><b>{workout.exercises.reduce((sum, item) => sum + item.sets.length, 0)}</b><small>serie</small></span></div>
    <button className="button acid wide" onClick={onOpen}><span className="play-disc"><Icon name="play" size={18}/></span>Inizia allenamento</button>
  </section>;
}

function EmptyWorkout({ onGenerate }) {
  return <section className="empty-workout"><span className="empty-icon"><Icon name="spark" size={30}/></span><h2>Pronto quando vuoi</h2><p>Genera un workout adatto al tuo recupero di oggi.</p><button className="button dark" onClick={onGenerate}>Genera workout</button></section>;
}

function WorkoutView({ workout, setWorkout, profile, setProfile, history, showToast, onBack, onFinish }) {
  const [rest, setRest] = useState(0);
  const [pendingSet, setPendingSet] = useState(null);
  const [historyExerciseId, setHistoryExerciseId] = useState(null);
  const [guideExerciseId, setGuideExerciseId] = useState(null);
  const [optionsExerciseId, setOptionsExerciseId] = useState(null);
  const [replacementExerciseId, setReplacementExerciseId] = useState(null);
  const [prescriptionExerciseId, setPrescriptionExerciseId] = useState(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const totalSets = workout.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const doneSets = workout.exercises.reduce((sum, item) => sum + item.sets.filter((set) => set.done).length, 0);

  useEffect(() => {
    if (!rest) return;
    const timer = setInterval(() => setRest((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [rest > 0]);

  const updateSet = (exerciseIndex, setIndex, patch) => {
    setWorkout((current) => ({ ...current, exercises: current.exercises.map((item, itemIndex) => itemIndex !== exerciseIndex ? item : { ...item, sets: item.sets.map((set, index) => index === setIndex ? { ...set, ...patch } : set) }) }));
  };
  const setInitialLoad = (exerciseIndex, weight) => {
    setWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((item, index) => index !== exerciseIndex ? item : {
        ...item,
        needsInitialLoad: false,
        sets: item.sets.map((set) => ({ ...set, weight, targetWeight: weight })),
      }),
    }));
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
      setRest(item.rest);
      return;
    }
    const completesExercise = willCompleteExercise(item.sets, setIndex);
    if (completesExercise) {
      setPendingSet({ exerciseIndex, setIndex, item, wasDone: false });
      return;
    }
    updateSet(exerciseIndex, setIndex, { done: true });
    setRest(item.rest);
  };
  const chooseRir = (rir) => {
    if (!pendingSet) return;
    updateSet(pendingSet.exerciseIndex, pendingSet.setIndex, { done: true, rir });
    if (!pendingSet.wasDone) setRest(pendingSet.item.rest);
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
    setWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((item) => {
        if (item.exerciseId !== exerciseId) return item;
        const hasCompletedSets = item.sets.some((set) => set.done);
        const visibleSets = hasCompletedSets ? item.sets : item.sets.slice(0, limits.maxSets);
        return {
          ...item,
          targetRir: limits.targetRir,
          repRange: { min: limits.minReps, max: limits.maxReps },
          progressionStep: 'custom',
          sets: visibleSets.map((set) => {
            const targetReps = Math.min(limits.maxReps, Math.max(limits.minReps, Number(set.targetReps) || limits.minReps));
            return {
              ...set,
              targetReps,
              targetRir: limits.targetRir,
              reps: set.done ? set.reps : Math.min(limits.maxReps, Math.max(limits.minReps, Number(set.reps) || targetReps)),
            };
          }),
        };
      }),
    }));
    setPrescriptionExerciseId(null);
    showToast(override ? 'Limiti esercizio aggiornati' : 'Limiti predefiniti ripristinati');
  };
  const replaceCurrentExercise = (exerciseId, selectedExerciseId) => {
    if (!canDiscardExercise(exerciseId)) return;
    const replacement = replaceExercise(workout, exerciseId, profile, history, selectedExerciseId);
    if (replacement === workout) {
      setReplacementExerciseId(null);
      return showToast('Nessuna alternativa compatibile disponibile');
    }
    setWorkout(replacement);
    setReplacementExerciseId(null);
    showToast('Esercizio sostituito con uno simile');
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
    setProfile((current) => ({
      ...current,
      preferences: { ...current.preferences, [exerciseId]: 'exclude' },
      focusExerciseIds: (current.focusExerciseIds || []).filter((id) => id !== exerciseId),
    }));
    if (workout.exercises.length > 1) setWorkout((current) => removeExercise(current, exerciseId));
    setOptionsExerciseId(null);
    showToast(workout.exercises.length > 1 ? 'Esercizio escluso e rimosso' : 'Esercizio escluso dai prossimi workout');
  };
  const refreshWorkout = () => {
    if (doneSets && !window.confirm('Rigenerando il workout perderai le serie già registrate. Continuare?')) return;
    const refreshed = generateWorkout(profile, history, {
      duration: workout.duration,
      targets: workout.targetMuscles,
      variation: Date.now(),
      avoidExerciseIds: workout.exercises.filter((item) => !item.isFocus).map((item) => item.exerciseId),
    });
    setWorkout(refreshed);
    setStartedAt(Date.now());
    setPendingSet(null);
    setRest(0);
    showToast('Workout aggiornato');
  };
  const complete = () => onFinish({ ...workout, startedAt, completedAt: Date.now() });

  return <main className="workout-view">
    <header className="workout-topbar"><button className="icon-button light" onClick={onBack}><Icon name="arrow"/></button><div><span>WORKOUT DI OGGI</span><strong>{workout.duration} min · {workout.exercises.length} esercizi</strong></div><button className="icon-button light" onClick={refreshWorkout} aria-label="Rigenera workout"><Icon name="refresh"/></button></header>
    <div className="workout-progress"><i style={{ width: `${(doneSets / totalSets) * 100}%` }}/></div>
    <section className="workout-title"><span className="eyebrow">{workout.engine?.returningFromBreak ? 'RIENTRO GRADUALE · VOLUME RIDOTTO' : 'CREATO SUL TUO RECUPERO'}</span><h1>{workout.targetMuscles.slice(0, 2).map((item) => muscles[item]).join(' + ')}</h1><p>{doneSets} di {totalSets} serie completate</p></section>
    <div className="exercise-list">
      {workout.exercises.map((item, exerciseIndex) => <ExerciseCard key={item.exerciseId} item={item} exerciseIndex={exerciseIndex} language={profile.exerciseLanguage} updateSet={updateSet} setInitialLoad={setInitialLoad} setInitialReps={setInitialReps} toggleSet={toggleSet} onRir={(setIndex) => setPendingSet({ exerciseIndex, setIndex, item, wasDone: item.sets[setIndex].done })} onGuide={() => setGuideExerciseId(item.exerciseId)} onHistory={() => setHistoryExerciseId(item.exerciseId)} onOptions={() => setOptionsExerciseId(item.exerciseId)}/>)}
    </div>
    <div className="finish-panel"><div><span>{Math.round(doneSets / totalSets * 100)}%</span><small>completato</small></div><button className="button acid" disabled={!doneSets} onClick={complete}><Icon name="trophy"/>Termina workout</button></div>
    {rest > 0 && <div className="rest-timer"><button onClick={() => setRest(0)}><Icon name="close" size={18}/></button><span>RECUPERO</span><strong>{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</strong><small>Prossima serie quando sei pronto</small><button className="skip-rest" onClick={() => setRest(0)}>Salta recupero</button></div>}
    {pendingSet && <RirSheet item={pendingSet.item} language={profile.exerciseLanguage} onChoose={chooseRir} onClose={() => setPendingSet(null)}/>} 
    {guideExerciseId && <ExerciseGuideSheet exerciseId={guideExerciseId} language={profile.exerciseLanguage} onClose={() => setGuideExerciseId(null)}/>} 
    {historyExerciseId && <ExerciseHistorySheet exerciseId={historyExerciseId} history={history} language={profile.exerciseLanguage} onClose={() => setHistoryExerciseId(null)}/>}
    {optionsExerciseId && <ExerciseActionsSheet exerciseId={optionsExerciseId} profile={profile} language={profile.exerciseLanguage} onPrescription={() => openPrescriptionEditor(optionsExerciseId)} onReplace={() => openReplacementPicker(optionsExerciseId)} onRemove={() => removeCurrentExercise(optionsExerciseId)} onExclude={() => excludeExercise(optionsExerciseId)} onClose={() => setOptionsExerciseId(null)}/>}
    {replacementExerciseId && <SimilarExerciseSheet workout={workout} exerciseId={replacementExerciseId} profile={profile} language={profile.exerciseLanguage} onChoose={(selectedId) => replaceCurrentExercise(replacementExerciseId, selectedId)} onClose={() => setReplacementExerciseId(null)}/>} 
    {prescriptionExerciseId && <ExercisePrescriptionSheet exerciseId={prescriptionExerciseId} profile={profile} language={profile.exerciseLanguage} onSave={(override) => saveExercisePrescription(prescriptionExerciseId, override)} onClose={() => setPrescriptionExerciseId(null)}/>}
  </main>;
}

function ExercisePreview({ source, name, onOpen }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [source]);
  if (!source || failed) return null;
  return <button className="exercise-preview" onClick={onOpen} aria-label={`Apri guida ${name}`}><img src={source} alt={`Esecuzione di ${name}`} loading="lazy" onError={() => setFailed(true)}/><span><Icon name="guide" size={15}/> Apri guida</span></button>;
}

function ExerciseCard({ item, exerciseIndex, language, updateSet, setInitialLoad, setInitialReps, toggleSet, onRir, onGuide, onHistory, onOptions }) {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
  const details = useExerciseDetails(exercise.wgerId, 'en');
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
    <header><span className="exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</span><div><div className="exercise-name-row"><h2>{getExerciseName(exercise, language)}</h2>{item.isFocus && <span className="focus-badge">FOCUS</span>}{item.progressionStep === 'reps' && <span className="progression-badge">+1 REP</span>}{item.progressionStep === 'load' && <span className="progression-badge load">+ CARICO</span>}</div><p>{muscles[exercise.primary]} · {item.sets.length} × {item.sets[0].targetReps || item.sets[0].reps}{item.repRange ? ` · range ${item.repRange.min}–${item.repRange.max}` : ''} · RIR {item.targetRir}</p></div><button className="icon-button" onClick={onOptions} aria-label={`Opzioni per ${getExerciseName(exercise, language)}`}><Icon name="more" size={20}/></button></header>
    <ExercisePreview source={details?.image} name={getExerciseName(exercise, language)} onOpen={onGuide}/>
    {needsInitialLoad ? <form className="initial-load" onSubmit={submitInitialLoad}>
      <div><span>PRIMA VOLTA</span><strong>Che carico vuoi usare?</strong><small>Scegli un peso con cui pensi di chiudere le serie a RIR {item.targetRir}.</small></div>
      <label><input autoFocus inputMode="decimal" type="number" min="0.5" step="0.5" placeholder="0" value={initialLoad} onChange={(event) => setInitialLoadValue(event.target.value)}/><span>kg {exercise.loadType === 'per-dumbbell' ? 'per manubrio' : ''}</span></label>
      <button className="button dark" disabled={Number(initialLoad) <= 0}>Imposta carico</button>
    </form> : item.needsInitialReps ? <form className="initial-load bodyweight-calibration" onSubmit={submitInitialReps}>
      <div><span>CALIBRAZIONE INIZIALE</span><strong>Quante ripetizioni massime?</strong><small>Inserisci quante ripetizioni pulite riusciresti a fare arrivando a cedimento. Easyfit sottrae il RIR target e rispetta il limite dell’esercizio.</small></div>
      <label><input autoFocus inputMode="numeric" type="number" min="1" max="100" step="1" placeholder="0" value={initialReps} onChange={(event) => setInitialRepsValue(event.target.value)}/><span>reps</span></label>
      <button className="button dark" disabled={Number(initialReps) <= 0}>Calibra serie</button>
    </form> : <>
      <div className="set-head"><span>SET</span><span>KG</span><span>REPS</span><span>RIR</span><span>FATTO</span></div>
      <div className="sets">{item.sets.map((set, setIndex) => <div className={`set-row ${set.done ? 'done' : ''}`} key={setIndex}>
        <strong>{setIndex + 1}</strong>
        {!usesWeight ? <span className="bodyweight-value">{exercise.loadType === 'bodyweight' ? 'Corpo' : '—'}</span> : <input aria-label={`Peso set ${setIndex + 1}`} inputMode="decimal" value={set.weight ?? ''} onChange={(event) => updateSet(exerciseIndex, setIndex, { weight: event.target.value === '' ? null : Number(event.target.value) })}/>} 
        <input aria-label={`Ripetizioni set ${setIndex + 1}`} inputMode="numeric" value={set.reps} onChange={(event) => updateSet(exerciseIndex, setIndex, { reps: Number(event.target.value) })}/>
        <button className={`rir-value ${set.rir != null ? 'recorded' : ''}`} onClick={() => onRir(setIndex)}>{set.rir == null ? '—' : set.rir === 4 ? '4+' : set.rir}</button>
        <button className="set-check" onClick={() => toggleSet(exerciseIndex, setIndex, item)}><Icon name="check" size={18}/></button>
      </div>)}</div>
    </>}
    <footer><span><Icon name="clock" size={16}/> {item.rest >= 60 ? `${Math.floor(item.rest / 60)}:${String(item.rest % 60).padStart(2, '0')}` : `${item.rest}s`} recupero{item.estimatedOneRepMax ? ` · e1RM ${Math.round(item.estimatedOneRepMax)} kg` : ''}</span><div className="exercise-actions"><button onClick={onGuide}><Icon name="guide" size={15}/> Guida</button><button onClick={onHistory}><Icon name="history" size={15}/> Storico</button><button onClick={onOptions} aria-label="Opzioni"><Icon name="more" size={15}/></button></div></footer>
  </article>;
}

function RirSheet({ item, language, onChoose, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
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
      <section className="guide-copy"><span className="section-kicker">ESECUZIONE · FONTE INGLESE</span>{details ? (details.description ? <p>{details.description}</p> : <p className="guide-missing">Wger non contiene ancora una spiegazione per questo esercizio.</p>) : <p className="guide-missing">Caricamento della guida…</p>}</section>
      <footer className="guide-source"><span>Fonte: <a href="https://wger.de" target="_blank" rel="noreferrer">wger</a></span>{exercise.license && <span>{exercise.license.name}{exercise.license.author ? ` · ${exercise.license.author}` : ''}</span>}</footer>
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
        <button onClick={onPrescription}><span><Icon name="settings"/></span><div><strong>Limiti e progressione</strong><small>Max {limits.maxSets} serie · {limits.minReps}–{limits.maxReps} reps · RIR {limits.targetRir}</small></div><Icon name="chevron" size={18}/></button>
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
        <div className="rir-limit"><div><strong>RIR target</strong><small>Può usare quello globale o uno specifico</small></div><div className="rir-choice"><button className={targetRir === 'global' ? 'selected' : ''} onClick={() => setTargetRir('global')}>Globale · {profile.targetRir}</button>{[0, 1, 2, 3, 4].map((rir) => <button key={rir} className={targetRir === rir ? 'selected' : ''} onClick={() => setTargetRir(rir)}>{rir === 4 ? '4+' : rir}</button>)}</div></div>
      </div>
      <p className="failure-note">RIR 0 è consentito: aumenta però la fatica e non garantisce più crescita rispetto a fermarsi vicino al cedimento.</p>
      <div className="prescription-actions"><button className="button dark" onClick={save}>Salva limiti</button>{saved && <button onClick={() => onSave(null)}>Ripristina default</button>}</div>
    </section>
  </div>;
}

function SimilarExerciseSheet({ workout, exerciseId, profile, language, onChoose, onClose }) {
  const [query, setQuery] = useState('');
  const [showVariants, setShowVariants] = useState(false);
  const current = exercises.find((candidate) => candidate.id === exerciseId);
  const essentialAlternatives = useMemo(() => getSimilarExercises(workout, exerciseId, profile), [workout, exerciseId, profile]);
  const allAlternatives = useMemo(() => getSimilarExercises(workout, exerciseId, profile, { includeVariants: true }), [workout, exerciseId, profile]);
  const alternatives = showVariants || query.trim() ? allAlternatives : essentialAlternatives;
  const hiddenVariantCount = Math.max(0, allAlternatives.length - essentialAlternatives.length);
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
      {hiddenVariantCount > 0 && <button className={`variant-toggle ${showVariants ? 'active' : ''}`} onClick={() => setShowVariants((value) => !value)}><span><Icon name="more" size={17}/><span><strong>{showVariants ? 'Nascondi microvarianti' : 'Mostra tutte le varianti'}</strong><small>{hiddenVariantCount} alternative simili {showVariants ? 'visibili' : 'nascoste'}</small></span></span><Icon name="chevron" size={16}/></button>}
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
          <h3>Sessioni recenti</h3>
          {[...stats.sessions].reverse().slice(0, 8).map((session) => <article key={session.workoutId + session.completedAt}>
            <div><strong>{formatDate(session.completedAt)}</strong>{session.isFocus && <span className="focus-badge">FOCUS</span>}</div>
            <p>{session.sets.map((set) => `${Number(set.weight) > 0 ? `${set.weight} kg` : 'Corpo'} × ${set.reps} · RIR ${set.rir == null ? '—' : set.rir === 4 ? '4+' : set.rir}`).join('  /  ')}</p>
            {session.bestE1rm && <small>e1RM migliore: {Math.round(session.bestE1rm * 10) / 10} kg</small>}
          </article>)}
        </div>
      </>}
    </section>
  </div>;
}

function Recovery({ history }) {
  const recovery = useMemo(() => getRecovery(history), [history]);
  const sorted = Object.entries(recovery).sort((a, b) => b[1] - a[1]);
  return <main className="standard-page"><PageHeader kicker="IL TUO CORPO" title="Recupero" subtitle="Una stima basata sugli ultimi allenamenti."/>
    <section className="recovery-summary"><div className="recovery-score"><span>{Math.round(sorted.reduce((sum, [, value]) => sum + value, 0) / sorted.length)}<small>%</small></span><p>Recupero medio</p></div><div><strong>Sei in buona forma.</strong><p>I muscoli più freschi avranno priorità nel prossimo workout.</p></div></section>
    <section className="muscle-list"><div className="list-caption"><span>GRUPPO MUSCOLARE</span><span>RECUPERO</span></div>{sorted.map(([muscle, value]) => <div className="muscle-row" key={muscle}><span className="muscle-dot" style={{ opacity: Math.max(.35, value / 100) }}/><div><strong>{muscles[muscle]}</strong><span className="recovery-bar"><i style={{ width: `${value}%` }}/></span></div><b>{value}%</b></div>)}</section>
    <p className="info-note">Il recupero è una stima, non un dato medico. Ascolta sempre il tuo corpo e riduci l’intensità in caso di dolore o affaticamento.</p>
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

function FocusCycleDots({ cycle }) {
  return <span className="cycle-dots" aria-label={`${cycle.completed} esecuzioni su ${cycle.target}`}>
    {Array.from({ length: cycle.target }, (_, index) => <i key={index} className={index < cycle.completed ? 'done' : ''}/>)}
  </span>;
}

function History({ history, profile }) {
  const [tab, setTab] = useState('summary');
  const [historyExerciseId, setHistoryExerciseId] = useState(null);
  const focusIds = useMemo(() => [...new Set([
    ...(profile.focusExerciseIds || []),
    ...suggestFocusExercises(profile),
  ])].filter((id) => exercises.some((exercise) => exercise.id === id)).slice(0, 3), [profile]);
  const analytics = useMemo(() => getFocusAnalytics(history, focusIds, {
    cycleLength: profile.focusCycleLength,
    cycleStartedAt: profile.focusCycleStartedAt,
  }), [history, focusIds.join('|'), profile.focusCycleLength, profile.focusCycleStartedAt]);
  const totalSets = history.reduce((sum, workout) => sum + workout.exercises.reduce((setSum, item) => setSum + item.sets.filter((set) => set.done).length, 0), 0);
  const maxWeeklyVolume = Math.max(1, ...analytics.items.flatMap((item) => [item.currentWeek.volume, item.previousWeek.volume]));
  const exerciseFor = (item) => exercises.find((exercise) => exercise.id === item.exerciseId);
  const metricLabel = (item, value) => value
    ? `${Math.round(value * 10) / 10} ${item.metric === 'e1rm' ? 'kg e1RM' : 'reps'}`
    : 'Nessun dato';

  return <main className="standard-page progress-page"><PageHeader kicker="I TUOI PROGRESSI" title="Progressi" subtitle="Forza, volume e record calcolati dalle serie completate."/>
    <nav className="progress-tabs" aria-label="Sezioni progressi">{[
      ['summary', 'Riepilogo'], ['strength', 'Forza'], ['volume', 'Volume'], ['records', 'Record'], ['activity', 'Attività'],
    ].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>

    {tab === 'summary' && <>
      <section className="weekly-progress-card">
        <span className="section-kicker">ULTIMI 7 GIORNI · FOCUS</span>
        <div className="weekly-progress-main"><div><strong>{formatPercent(analytics.week.strengthChange)}</strong><span>forza stimata vs settimana precedente</span></div><Icon name="trophy" size={30}/></div>
        <div className="weekly-progress-stats"><div><strong>{analytics.week.focusSessions}</strong><span>Esecuzioni</span></div><div><strong>{analytics.week.sets}</strong><span>Serie</span></div><div><strong>{formatVolume(analytics.week.volume)}</strong><span>Volume</span></div></div>
        {analytics.week.strengthChange === null && <p>Il confronto apparirà quando lo stesso focus avrà dati sia in questa settimana sia nella precedente.</p>}
      </section>
      <section className="focus-progress-list">
        <div className="section-heading compact"><div><span className="section-kicker">CICLO CORRENTE</span><h2>Focus Exercises</h2></div><span>{profile.focusCycleLength || 4} esecuzioni</span></div>
        {analytics.items.map((item) => {
          const exercise = exerciseFor(item);
          const latest = item.stats.points.at(-1)?.value;
          return <button key={item.exerciseId} className="focus-progress-card" onClick={() => setHistoryExerciseId(item.exerciseId)}>
            <div className="focus-progress-head"><span className="focus-glyph"><Icon name="spark" size={16}/></span><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{muscles[exercise.primary]}</small></div><Icon name="chevron" size={17}/></div>
            <div className="focus-cycle-row"><FocusCycleDots cycle={item.cycle}/><span>{item.cycle.remaining ? `${item.cycle.remaining} prima del cambio` : 'Cambio al prossimo completamento'}</span></div>
            <div className="focus-metric-row"><span><small>VALORE ATTUALE</small><strong>{metricLabel(item, latest)}</strong></span><span className={item.overallStrengthChange > 0 ? 'positive' : ''}><small>DA INIZIO STORICO</small><strong>{formatPercent(item.overallStrengthChange)}</strong></span></div>
          </button>;
        })}
      </section>
    </>}

    {tab === 'strength' && <section className="progress-section">
      <div className="progress-intro"><span className="section-kicker">FORZA STIMATA</span><h2>Andamento dei focus</h2><p>L’e1RM combina peso, ripetizioni e RIR. È utile per confrontarti con te stesso, non è un massimale realmente testato.</p></div>
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
      <div className="volume-total"><div><span className="section-kicker">VOLUME FOCUS · 7 GIORNI</span><strong>{formatVolume(analytics.week.volume)}</strong></div><span className={analytics.week.volumeChange > 0 ? 'positive' : ''}>{formatPercent(analytics.week.volumeChange)}<small>vs settimana scorsa</small></span></div>
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
      <section className="stats-grid"><div><strong>{history.length}</strong><span>Workout</span></div><div><strong>{totalSets}</strong><span>Serie totali</span></div><div><strong>{history.reduce((sum, item) => sum + item.duration, 0)}</strong><span>Minuti</span></div></section>
      <section className="history-list"><h2>Allenamenti recenti</h2>{history.length === 0 ? <div className="history-empty"><Icon name="history" size={30}/><strong>Qui vedrai i tuoi progressi</strong><p>Completa il primo workout per iniziare lo storico.</p></div> : [...history].reverse().map((workout) => <article key={workout.id + workout.completedAt}><div className="history-date"><strong>{new Intl.DateTimeFormat('it-IT', { day: '2-digit' }).format(workout.completedAt)}</strong><span>{new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(workout.completedAt)}</span></div><div><strong>{workout.targetMuscles.slice(0, 3).map((item) => muscles[item]).join(' · ')}</strong><span>{workout.duration} min · {workout.exercises.length} esercizi</span></div><Icon name="chevron"/></article>)}</section>
    </>}
    {historyExerciseId && <ExerciseHistorySheet
      exerciseId={historyExerciseId}
      history={history}
      language={profile.exerciseLanguage}
      onClose={() => setHistoryExerciseId(null)}
    />}
  </main>;
}

function FocusSettings({ profile, update }) {
  const availableSaved = (profile.focusExerciseIds || []).filter((id) => {
    const exercise = exercises.find((candidate) => candidate.id === id);
    return exercise && isExerciseAllowed(exercise, profile);
  });
  const focusIds = [...new Set([...availableSaved, ...suggestFocusExercises(profile)])].slice(0, 3);
  const setEnabled = () => update(profile.focusEnabled ? { focusEnabled: false } : {
    focusEnabled: true,
    focusExerciseIds: focusIds,
    focusCycleStartedAt: Object.fromEntries(focusIds.map((id) => [id, Date.now()])),
  });
  const replaceFocus = (currentId) => {
    const replacement = getNextFocusExercise(profile, currentId, focusIds);
    update({
      focusExerciseIds: focusIds.map((id) => id === currentId ? replacement : id),
      focusCycleStartedAt: { ...(profile.focusCycleStartedAt || {}), [replacement]: Date.now() },
    });
  };
  const regenerate = () => {
    const candidates = suggestFocusExercises(profile);
    const shifted = candidates.map((id, index) => getNextFocusExercise(profile, id, candidates.slice(index + 1)));
    update({
      focusEnabled: true,
      focusExerciseIds: shifted,
      focusCycleStartedAt: Object.fromEntries(shifted.map((id) => [id, Date.now()])),
    });
  };

  return <section className="settings-group focus-settings">
    <div className="settings-title-row"><div><h2>Focus exercises</h2><p>Movimenti principali che tornano con continuità.</p></div><button className={`switch ${profile.focusEnabled ? 'on' : ''}`} role="switch" aria-checked={profile.focusEnabled} onClick={setEnabled}><i/></button></div>
    {profile.focusEnabled && <>
      <div className="focus-list">{focusIds.map((id) => {
        const exercise = exercises.find((candidate) => candidate.id === id);
        return <article key={id}><span className="focus-glyph"><Icon name="spark" size={17}/></span><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{muscles[exercise.primary]} · {exercise.pattern.replaceAll('-', ' ')}</small></div><button onClick={() => replaceFocus(id)} aria-label={`Cambia ${getExerciseName(exercise, profile.exerciseLanguage)}`}><Icon name="swap" size={17}/></button></article>;
      })}</div>
      <div className="focus-cycle-setting"><div><strong>Durata del ciclo</strong><small>Numero di esecuzioni prima del cambio automatico</small></div><div className="stepper"><button onClick={() => update({ focusCycleLength: Math.max(2, (profile.focusCycleLength || 4) - 1) })}>−</button><b>{profile.focusCycleLength || 4}</b><button onClick={() => update({ focusCycleLength: Math.min(8, (profile.focusCycleLength || 4) + 1) })}>+</button></div></div>
      <button className="regenerate-focus" onClick={regenerate}><Icon name="swap" size={15}/> Cambia tutti</button>
      <p className="setting-help">Di default ogni focus resta per 4 esecuzioni, circa un mese se ricorre una volta a settimana. Poi viene sostituito automaticamente con un movimento della stessa famiglia.</p>
    </>}
  </section>;
}

function ExerciseFilterSettings({ profile, update }) {
  const filters = { ...defaultProfile.exerciseFilters, ...(profile.exerciseFilters || {}) };
  const toggle = (key) => update({ exerciseFilters: { ...filters, [key]: !filters[key] } });
  const items = [
    ['essentialCatalog', 'Catalogo essenziale', 'Propone una sola versione rappresentativa per ogni famiglia, pattern e attrezzatura.'],
    ['preferLoadedVariants', 'Evita corpo libero duplicato', 'Se esiste una variante caricabile compatibile con la tua attrezzatura, usa quella.'],
    ['excludeDirectCore', 'Escludi addominali diretti', 'Niente crunch, plank o altri esercizi con il core come target principale.'],
    ['excludeCalves', 'Escludi polpacci diretti', 'Rimuove calf raise e lavoro specifico per i polpacci.'],
  ];
  return <SettingsGroup title="Filtri automatici"><div className="filter-settings">{items.map(([key, title, text]) => <div key={key}><div><strong>{title}</strong><small>{text}</small></div><button className={`switch ${filters[key] ? 'on' : ''}`} role="switch" aria-checked={filters[key]} onClick={() => toggle(key)}><i/></button></div>)}</div><p className="setting-help">In modalità Massa, movimenti olimpici, balistici e ibridi come snatch, clean, jerk, thruster e burpee sono esclusi automaticamente. Il lavoro diretto per i polpacci resta attivo di default perché gli altri esercizi spesso non forniscono uno stimolo sufficiente; puoi comunque disattivarlo qui.</p></SettingsGroup>;
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
      <p>Verranno cancellati profilo, impostazioni, workout in corso, storico, carichi appresi, Focus Exercises ed esercizi esclusi.</p>
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

  const saveConnection = () => onSaveCloud({ webDavUrl: folderUrl.trim(), webDavUsername: username.trim() });
  const upload = async () => {
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
        <label><span>APP PASSWORD</span><input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Non viene salvata"/></label>
      </div>
      <p className="cloud-security"><Icon name="check" size={15}/> URL e username vengono ricordati. L’app password resta soltanto in questa schermata e non entra nel backup.</p>
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
  const update = (patch) => { setProfile({ ...profile, ...patch }); showToast('Preferenze aggiornate'); };
  const toggleEquipment = (item) => {
    const equipment = profile.equipment.includes(item) ? profile.equipment.filter((id) => id !== item) : [...profile.equipment, item];
    if (!equipment.length) return showToast('Scegli almeno un tipo di attrezzatura');
    const nextProfile = { ...profile, equipment };
    const compatibleFocus = (profile.focusExerciseIds || []).filter((id) => {
      const exercise = exercises.find((candidate) => candidate.id === id);
      return exercise && isExerciseAllowed(exercise, nextProfile);
    });
    update({ equipment, focusExerciseIds: [...new Set([...compatibleFocus, ...suggestFocusExercises(nextProfile)])].slice(0, 3) });
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
    if (file.size > 20 * 1024 * 1024) return showToast('Il file di backup è troppo grande');
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
    <SettingsGroup title="RIR target"><div className="rir-setting">{[0, 1, 2, 3, 4].map((rir) => <button key={rir} className={profile.targetRir === rir ? 'selected' : ''} onClick={() => update({ targetRir: rir })}><strong>{rir === 4 ? '4+' : rir}</strong><small>{rir === 0 ? 'Cedimento' : `${rir} in riserva`}</small></button>)}</div><p className="setting-help">È il target globale. RIR 0 resta disponibile, ma 1–2 offre normalmente un rapporto stimolo/fatica migliore. Puoi cambiarlo per un singolo esercizio dal suo menu.</p></SettingsGroup>
    <SettingsGroup title="Limiti serie"><div className="type-cap-list">{[['compound', 'Multiarticolari'], ['accessory', 'Isolamento e accessori']].map(([type, label]) => <div key={type}><span>{label}</span><div className="stepper"><button onClick={() => update({ setCaps: { ...profile.setCaps, [type]: Math.max(1, profile.setCaps[type] - 1) } })}>−</button><b>{profile.setCaps[type]}</b><button onClick={() => update({ setCaps: { ...profile.setCaps, [type]: Math.min(6, profile.setCaps[type] + 1) } })}>+</button></div></div>)}</div><p className="setting-help">Sono tetti massimi: durata, volume e prontezza possono comunque prescrivere meno serie.</p></SettingsGroup>
    <SettingsGroup title="Durata"><div className="range-label"><span>Tempo per workout</span><strong>{profile.duration} min</strong></div><input type="range" min="25" max="75" step="5" value={profile.duration} onChange={(event) => setProfile({ ...profile, duration: Number(event.target.value) })} onPointerUp={() => showToast('Durata aggiornata')}/></SettingsGroup>
    <SettingsGroup title="Split"><div className="select-wrap"><select value={profile.split} onChange={(event) => update({ split: event.target.value })}>{Object.entries(splitLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><Icon name="chevron"/></div></SettingsGroup>
    <FocusSettings profile={profile} update={update}/>
    <SettingsGroup title="Nomi degli esercizi"><div className="settings-options language-options">
      <button className={profile.exerciseLanguage === 'en' ? 'selected' : ''} onClick={() => update({ exerciseLanguage: 'en' })}>English <span><Icon name="check" size={14}/></span></button>
      <button className={profile.exerciseLanguage === 'it' ? 'selected' : ''} onClick={() => update({ exerciseLanguage: 'it' })}>Italiano, con fallback inglese <span><Icon name="check" size={14}/></span></button>
    </div><p className="setting-help">L’inglese è il nome canonico. {exerciseCatalogMeta.italianTranslations} esercizi hanno anche una traduzione italiana.</p></SettingsGroup>
    <SettingsGroup title="Attrezzatura"><div className="tag-list">{Object.entries(equipmentLabels).map(([id, label]) => <button key={id} className={profile.equipment.includes(id) ? 'selected' : ''} onClick={() => toggleEquipment(id)}>{label}{profile.equipment.includes(id) && <Icon name="check" size={14}/>}</button>)}</div></SettingsGroup>
    <ExerciseFilterSettings profile={profile} update={update}/>
    <ExcludedExercises profile={profile} update={update}/>
    <SettingsGroup title="Backup e cloud"><div className="backup-options"><button onClick={exportBackup}><span><Icon name="download" size={18}/></span><div><strong>Esporta backup</strong><small>Scarica profilo, storico, workout e preferenze</small></div></button><label><input type="file" accept="application/json,.json" onChange={importBackup}/><span><Icon name="upload" size={18}/></span><div><strong>Importa backup</strong><small>Controlla il file prima di sostituire i dati</small></div></label><button onClick={() => setBackupOpen(true)}><span><Icon name="cloud" size={18}/></span><div><strong>Nextcloud</strong><small>{profile.cloud?.webDavUrl ? 'Connessione WebDAV configurata' : 'Carica o ripristina direttamente dal cloud'}</small></div></button></div><p className="setting-help">Il backup è un JSON versionato. Non contiene immagini del catalogo né credenziali cloud.</p></SettingsGroup>
    <section className="settings-group danger-zone"><h2>Dati dell’app</h2><p>Cancella tutti i dati salvati su questo dispositivo e riapre la configurazione iniziale.</p><button onClick={() => setResetOpen(true)}><Icon name="trash" size={18}/><span><strong>Cancella tutti i dati</strong><small>Profilo, storico, carichi e preferenze</small></span><Icon name="chevron" size={17}/></button></section>
    <div className="catalog-credit">Catalogo: <a href="https://wger.de" target="_blank" rel="noreferrer">wger</a> · {exerciseCatalogMeta.eligible} esercizi compatibili · licenze indicate nei dati sorgente.</div>
    <div className="version">Easyfit MVP · Motore locale v0.6</div>
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

createRoot(document.getElementById('root')).render(<App/>);
