import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { equipmentLabels, exerciseCatalogMeta, exercises, getExerciseName, muscles } from './data/exercises.js';
import {
  generateWorkout,
  getExerciseHistory,
  getNextFocusExercise,
  getRecovery,
  hasAvailableEquipment,
  removeExercise,
  replaceExercise,
  suggestFocusExercises,
} from './engine/generator.js';
import './styles.css';

const defaultProfile = {
  goal: 'muscle',
  level: 'intermediate',
  equipment: ['bodyweight', 'dumbbells', 'bench'],
  duration: 45,
  split: 'adaptive',
  exerciseLanguage: 'en',
  focusEnabled: true,
  focusExerciseIds: [],
  preferences: {},
};

const goalLabels = { muscle: 'Massa muscolare', strength: 'Forza', fitness: 'Forma fisica' };
const splitLabels = { adaptive: 'Recupero', full: 'Full body', 'upper-lower': 'Upper / Lower', ppl: 'Push / Pull / Legs' };

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
    arrow: <><path d="M19 12H5m0 0 5-5m-5 5 5 5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4v1a4 4 0 0 0 4 4m8-5h4v1a4 4 0 0 1-4 4M12 13v4m-4 3h8"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6m4-6v6"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.2 9A7 7 0 0 0 6.1 6.1L4 9m2 6a7 7 0 0 0 11.9 2.9L20 15"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><i/><i/><i/></span><span>easyfit</span></div>;
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
      <label>Organizzazione</label>
      <div className="select-wrap">
        <select value={profile.split} onChange={(event) => setProfile({ ...profile, split: event.target.value })}>
          <option value="adaptive">In base al recupero</option><option value="full">Full body</option><option value="upper-lower">Upper / Lower</option><option value="ppl">Push / Pull / Legs</option>
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
    return saved ? { ...defaultProfile, ...saved } : null;
  });
  const [history, setHistory] = useState(() => load('easyfit-history', []));
  const [workout, setWorkout] = useState(() => {
    const saved = load('easyfit-workout', null);
    return saved?.exercises?.every((item) => exercises.some((exercise) => exercise.id === item.exerciseId)) ? saved : null;
  });
  const [view, setView] = useState('home');
  const [toast, setToast] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => { if (profile) localStorage.setItem('easyfit-profile', JSON.stringify(profile)); }, [profile]);
  useEffect(() => { localStorage.setItem('easyfit-history', JSON.stringify(history)); }, [history]);
  useEffect(() => {
    if (workout) localStorage.setItem('easyfit-workout', JSON.stringify(workout));
    else localStorage.removeItem('easyfit-workout');
  }, [workout]);
  useEffect(() => {
    const handler = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', handler);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  const finishOnboarding = (newProfile) => {
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

  return <div className="app-shell">
    {view === 'workout' && workout
      ? <WorkoutView workout={workout} setWorkout={setWorkout} profile={profile} setProfile={setProfile} history={history} showToast={showToast} onBack={() => setView('home')} onFinish={(completed) => {
          setHistory((current) => [...current, completed]); setWorkout(null); setView('home'); showToast('Workout completato. Carichi ricalibrati!');
        }}/>
      : <>
        <div className="page-wrap">
          {view === 'home' && <Home profile={profile} history={history} workout={workout} onOpenWorkout={() => setView('workout')} onGenerate={createWorkout} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)}/>} 
          {view === 'recovery' && <Recovery history={history}/>} 
          {view === 'history' && <History history={history}/>} 
          {view === 'profile' && <Profile profile={profile} setProfile={setProfile} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} showToast={showToast} onReset={resetAppData}/>} 
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
  const [optionsExerciseId, setOptionsExerciseId] = useState(null);
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
  const toggleSet = (exerciseIndex, setIndex, item) => {
    const set = item.sets[setIndex];
    if (set.done) return updateSet(exerciseIndex, setIndex, { done: false });
    if (set.rir != null) {
      updateSet(exerciseIndex, setIndex, { done: true });
      setRest(item.rest);
      return;
    }
    setPendingSet({ exerciseIndex, setIndex, item, wasDone: false });
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
  const replaceCurrentExercise = (exerciseId) => {
    if (!canDiscardExercise(exerciseId)) return;
    const replacement = replaceExercise(workout, exerciseId, profile, history);
    if (replacement === workout) {
      setOptionsExerciseId(null);
      return showToast('Nessuna alternativa compatibile disponibile');
    }
    setWorkout(replacement);
    setOptionsExerciseId(null);
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
    <section className="workout-title"><span className="eyebrow">CREATO SUL TUO RECUPERO</span><h1>{workout.targetMuscles.slice(0, 2).map((item) => muscles[item]).join(' + ')}</h1><p>{doneSets} di {totalSets} serie completate</p></section>
    <div className="exercise-list">
      {workout.exercises.map((item, exerciseIndex) => <ExerciseCard key={item.exerciseId} item={item} exerciseIndex={exerciseIndex} language={profile.exerciseLanguage} updateSet={updateSet} setInitialLoad={setInitialLoad} toggleSet={toggleSet} onRir={(setIndex) => setPendingSet({ exerciseIndex, setIndex, item, wasDone: item.sets[setIndex].done })} onHistory={() => setHistoryExerciseId(item.exerciseId)} onOptions={() => setOptionsExerciseId(item.exerciseId)}/>)}
    </div>
    <div className="finish-panel"><div><span>{Math.round(doneSets / totalSets * 100)}%</span><small>completato</small></div><button className="button acid" disabled={!doneSets} onClick={complete}><Icon name="trophy"/>Termina workout</button></div>
    {rest > 0 && <div className="rest-timer"><button onClick={() => setRest(0)}><Icon name="close" size={18}/></button><span>RECUPERO</span><strong>{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</strong><small>Prossima serie quando sei pronto</small><button className="skip-rest" onClick={() => setRest(0)}>Salta recupero</button></div>}
    {pendingSet && <RirSheet item={pendingSet.item} setIndex={pendingSet.setIndex} language={profile.exerciseLanguage} onChoose={chooseRir} onClose={() => setPendingSet(null)}/>} 
    {historyExerciseId && <ExerciseHistorySheet exerciseId={historyExerciseId} history={history} language={profile.exerciseLanguage} onClose={() => setHistoryExerciseId(null)}/>} 
    {optionsExerciseId && <ExerciseActionsSheet exerciseId={optionsExerciseId} language={profile.exerciseLanguage} onReplace={() => replaceCurrentExercise(optionsExerciseId)} onRemove={() => removeCurrentExercise(optionsExerciseId)} onExclude={() => excludeExercise(optionsExerciseId)} onClose={() => setOptionsExerciseId(null)}/>} 
  </main>;
}

function ExerciseCard({ item, exerciseIndex, language, updateSet, setInitialLoad, toggleSet, onRir, onHistory, onOptions }) {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
  const [initialLoad, setInitialLoadValue] = useState('');
  const usesWeight = ['external', 'per-dumbbell'].includes(exercise.loadType);
  const needsInitialLoad = usesWeight && item.sets.every((set) => set.weight == null);
  const submitInitialLoad = (event) => {
    event.preventDefault();
    const weight = Number(initialLoad);
    if (weight > 0) setInitialLoad(exerciseIndex, weight);
  };

  return <article className="exercise-card">
    <header><span className="exercise-index">{String(exerciseIndex + 1).padStart(2, '0')}</span><div><div className="exercise-name-row"><h2>{getExerciseName(exercise, language)}</h2>{item.isFocus && <span className="focus-badge">FOCUS</span>}</div><p>{muscles[exercise.primary]} · {item.sets.length} × {item.sets[0].targetReps || item.sets[0].reps} · RIR {item.targetRir}</p></div><button className="icon-button" onClick={onOptions} aria-label={`Opzioni per ${getExerciseName(exercise, language)}`}><Icon name="more" size={20}/></button></header>
    {needsInitialLoad ? <form className="initial-load" onSubmit={submitInitialLoad}>
      <div><span>PRIMA VOLTA</span><strong>Che carico vuoi usare?</strong><small>Scegli un peso con cui pensi di chiudere le serie a RIR {item.targetRir}.</small></div>
      <label><input autoFocus inputMode="decimal" type="number" min="0.5" step="0.5" placeholder="0" value={initialLoad} onChange={(event) => setInitialLoadValue(event.target.value)}/><span>kg {exercise.loadType === 'per-dumbbell' ? 'per manubrio' : ''}</span></label>
      <button className="button dark" disabled={Number(initialLoad) <= 0}>Imposta carico</button>
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
    <footer><span><Icon name="clock" size={16}/> {item.rest >= 60 ? `${Math.floor(item.rest / 60)}:${String(item.rest % 60).padStart(2, '0')}` : `${item.rest}s`} recupero{item.estimatedOneRepMax ? ` · e1RM ${Math.round(item.estimatedOneRepMax)} kg` : ''}</span><div className="exercise-actions"><button onClick={onHistory}><Icon name="history" size={15}/> Storico</button><button onClick={onOptions}>Opzioni <Icon name="more" size={15}/></button></div></footer>
  </article>;
}

function RirSheet({ item, setIndex, language, onChoose, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="rir-sheet" role="dialog" aria-modal="true" aria-label="Registra RIR">
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">SERIE {setIndex + 1} · {getExerciseName(exercise, language).toUpperCase()}</span>
      <h2>Quante ripetizioni<br/>avevi ancora?</h2>
      <p>Il RIR ricalibra il prossimo carico insieme alle ripetizioni realmente completate.</p>
      <div className="rir-options">
        {[[0, 'Cedimento'], [1, 'Una'], [2, 'Due'], [3, 'Tre'], [4, 'Quattro+']].map(([value, label]) => <button key={value} className={value === item.targetRir ? 'target' : ''} onClick={() => onChoose(value)}><strong>{value === 4 ? '4+' : value}</strong><small>{label}</small>{value === item.targetRir && <i>target</i>}</button>)}
      </div>
    </section>
  </div>;
}

function ExerciseActionsSheet({ exerciseId, language, onReplace, onRemove, onExclude, onClose }) {
  const exercise = exercises.find((candidate) => candidate.id === exerciseId);
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="exercise-actions-sheet" role="dialog" aria-modal="true" aria-label={`Opzioni ${getExerciseName(exercise, language)}`}>
      <button className="sheet-close" onClick={onClose}><Icon name="close" size={19}/></button>
      <span className="eyebrow">OPZIONI ESERCIZIO</span>
      <h2>{getExerciseName(exercise, language)}</h2>
      <p>La sostituzione mantiene lo stesso movimento quando possibile.</p>
      <div className="exercise-option-list">
        <button onClick={onReplace}><span><Icon name="swap"/></span><div><strong>Sostituisci con uno simile</strong><small>Stesso pattern muscolare e attrezzatura disponibile</small></div><Icon name="chevron" size={18}/></button>
        <button onClick={onRemove}><span><Icon name="trash"/></span><div><strong>Rimuovi da questo workout</strong><small>Potrà ricomparire nei prossimi allenamenti</small></div><Icon name="chevron" size={18}/></button>
        <button className="danger" onClick={onExclude}><span><Icon name="ban"/></span><div><strong>Non proporre più</strong><small>Lo esclude anche dai workout futuri</small></div><Icon name="chevron" size={18}/></button>
      </div>
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

function History({ history }) {
  const totalSets = history.reduce((sum, workout) => sum + workout.exercises.reduce((setSum, item) => setSum + item.sets.filter((set) => set.done).length, 0), 0);
  return <main className="standard-page"><PageHeader kicker="I TUOI PROGRESSI" title="Attività" subtitle="Ogni workout rende il prossimo più preciso."/>
    <section className="stats-grid"><div><strong>{history.length}</strong><span>Workout</span></div><div><strong>{totalSets}</strong><span>Serie totali</span></div><div><strong>{history.reduce((sum, item) => sum + item.duration, 0)}</strong><span>Minuti</span></div></section>
    <section className="history-list"><h2>Allenamenti recenti</h2>{history.length === 0 ? <div className="history-empty"><Icon name="history" size={30}/><strong>Qui vedrai i tuoi progressi</strong><p>Completa il primo workout per iniziare lo storico.</p></div> : [...history].reverse().map((workout) => <article key={workout.id + workout.completedAt}><div className="history-date"><strong>{new Intl.DateTimeFormat('it-IT', { day: '2-digit' }).format(workout.completedAt)}</strong><span>{new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(workout.completedAt)}</span></div><div><strong>{workout.targetMuscles.slice(0, 3).map((item) => muscles[item]).join(' · ')}</strong><span>{workout.duration} min · {workout.exercises.length} esercizi</span></div><Icon name="chevron"/></article>)}</section>
  </main>;
}

function FocusSettings({ profile, update }) {
  const availableSaved = (profile.focusExerciseIds || []).filter((id) => {
    const exercise = exercises.find((candidate) => candidate.id === id);
    return exercise && hasAvailableEquipment(exercise, profile) && profile.preferences?.[id] !== 'exclude';
  });
  const focusIds = [...new Set([...availableSaved, ...suggestFocusExercises(profile)])].slice(0, 3);
  const setEnabled = () => update({ focusEnabled: !profile.focusEnabled, focusExerciseIds: focusIds });
  const replaceFocus = (currentId) => {
    const replacement = getNextFocusExercise(profile, currentId, focusIds);
    update({ focusExerciseIds: focusIds.map((id) => id === currentId ? replacement : id) });
  };
  const regenerate = () => {
    const candidates = suggestFocusExercises(profile);
    const shifted = candidates.map((id, index) => getNextFocusExercise(profile, id, candidates.slice(index + 1)));
    update({ focusEnabled: true, focusExerciseIds: shifted });
  };

  return <section className="settings-group focus-settings">
    <div className="settings-title-row"><div><h2>Focus exercises</h2><p>Movimenti principali che tornano con continuità.</p></div><button className={`switch ${profile.focusEnabled ? 'on' : ''}`} role="switch" aria-checked={profile.focusEnabled} onClick={setEnabled}><i/></button></div>
    {profile.focusEnabled && <>
      <div className="focus-list">{focusIds.map((id) => {
        const exercise = exercises.find((candidate) => candidate.id === id);
        return <article key={id}><span className="focus-glyph"><Icon name="spark" size={17}/></span><div><strong>{getExerciseName(exercise, profile.exerciseLanguage)}</strong><small>{muscles[exercise.primary]} · {exercise.pattern.replaceAll('-', ' ')}</small></div><button onClick={() => replaceFocus(id)} aria-label={`Cambia ${getExerciseName(exercise, profile.exerciseLanguage)}`}><Icon name="swap" size={17}/></button></article>;
      })}</div>
      <button className="regenerate-focus" onClick={regenerate}><Icon name="swap" size={15}/> Cambia tutti</button>
      <p className="setting-help">Niente fasi: Easyfit inserisce un focus compatibile a inizio workout e lo ricalibra da peso, ripetizioni reali e RIR.</p>
    </>}
  </section>;
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

function Profile({ profile, setProfile, installPrompt, onInstalled, showToast, onReset }) {
  const [resetOpen, setResetOpen] = useState(false);
  const update = (patch) => { setProfile({ ...profile, ...patch }); showToast('Preferenze aggiornate'); };
  const toggleEquipment = (item) => {
    const equipment = profile.equipment.includes(item) ? profile.equipment.filter((id) => id !== item) : [...profile.equipment, item];
    if (!equipment.length) return showToast('Scegli almeno un tipo di attrezzatura');
    const nextProfile = { ...profile, equipment };
    const compatibleFocus = (profile.focusExerciseIds || []).filter((id) => {
      const exercise = exercises.find((candidate) => candidate.id === id);
      return exercise && hasAvailableEquipment(exercise, nextProfile) && nextProfile.preferences?.[id] !== 'exclude';
    });
    update({ equipment, focusExerciseIds: [...new Set([...compatibleFocus, ...suggestFocusExercises(nextProfile)])].slice(0, 3) });
  };
  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); onInstalled(); };
  return <main className="standard-page profile-page"><PageHeader kicker="PERSONALIZZAZIONE" title="Impostazioni" subtitle="Tutte le preferenze usate per creare i tuoi workout."/>
    {installPrompt && <button className="install-card" onClick={install}><span><Icon name="download"/></span><div><strong>Installa Easyfit</strong><small>Usala come un’app, anche offline</small></div><Icon name="chevron"/></button>}
    <SettingsGroup title="Obiettivo"><div className="settings-options">{Object.entries(goalLabels).map(([id, label]) => <button className={profile.goal === id ? 'selected' : ''} onClick={() => update({ goal: id })} key={id}>{label}<span><Icon name="check" size={14}/></span></button>)}</div></SettingsGroup>
    <SettingsGroup title="Esperienza"><div className="settings-options">{[['beginner', 'Principiante'], ['intermediate', 'Intermedio'], ['advanced', 'Esperto']].map(([id, label]) => <button className={profile.level === id ? 'selected' : ''} onClick={() => update({ level: id })} key={id}>{label}<span><Icon name="check" size={14}/></span></button>)}</div></SettingsGroup>
    <SettingsGroup title="Durata"><div className="range-label"><span>Tempo per workout</span><strong>{profile.duration} min</strong></div><input type="range" min="25" max="75" step="5" value={profile.duration} onChange={(event) => setProfile({ ...profile, duration: Number(event.target.value) })} onPointerUp={() => showToast('Durata aggiornata')}/></SettingsGroup>
    <SettingsGroup title="Split"><div className="select-wrap"><select value={profile.split} onChange={(event) => update({ split: event.target.value })}>{Object.entries(splitLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><Icon name="chevron"/></div></SettingsGroup>
    <FocusSettings profile={profile} update={update}/>
    <SettingsGroup title="Nomi degli esercizi"><div className="settings-options language-options">
      <button className={profile.exerciseLanguage === 'en' ? 'selected' : ''} onClick={() => update({ exerciseLanguage: 'en' })}>English <span><Icon name="check" size={14}/></span></button>
      <button className={profile.exerciseLanguage === 'it' ? 'selected' : ''} onClick={() => update({ exerciseLanguage: 'it' })}>Italiano, con fallback inglese <span><Icon name="check" size={14}/></span></button>
    </div><p className="setting-help">L’inglese è il nome canonico. {exerciseCatalogMeta.italianTranslations} esercizi hanno anche una traduzione italiana.</p></SettingsGroup>
    <SettingsGroup title="Attrezzatura"><div className="tag-list">{Object.entries(equipmentLabels).map(([id, label]) => <button key={id} className={profile.equipment.includes(id) ? 'selected' : ''} onClick={() => toggleEquipment(id)}>{label}{profile.equipment.includes(id) && <Icon name="check" size={14}/>}</button>)}</div></SettingsGroup>
    <ExcludedExercises profile={profile} update={update}/>
    <section className="settings-group danger-zone"><h2>Dati dell’app</h2><p>Cancella tutti i dati salvati su questo dispositivo e riapre la configurazione iniziale.</p><button onClick={() => setResetOpen(true)}><Icon name="trash" size={18}/><span><strong>Cancella tutti i dati</strong><small>Profilo, storico, carichi e preferenze</small></span><Icon name="chevron" size={17}/></button></section>
    <div className="catalog-credit">Catalogo: <a href="https://wger.de" target="_blank" rel="noreferrer">wger</a> · {exerciseCatalogMeta.eligible} esercizi compatibili · licenze indicate nei dati sorgente.</div>
    <div className="version">Easyfit MVP · Motore locale v0.2</div>
    {resetOpen && <ResetDataSheet onConfirm={onReset} onClose={() => setResetOpen(false)}/>} 
  </main>;
}

function SettingsGroup({ title, children }) { return <section className="settings-group"><h2>{title}</h2>{children}</section>; }
function PageHeader({ kicker, title, subtitle }) { return <header className="page-header"><Brand/><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></header>; }

function BottomNav({ view, setView }) {
  return <nav className="bottom-nav">{[
    ['home', 'home', 'Oggi'], ['recovery', 'body', 'Recupero'], ['history', 'history', 'Attività'], ['profile', 'settings', 'Impostazioni'],
  ].map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span><Icon name={icon}/></span><small>{label}</small></button>)}</nav>;
}

createRoot(document.getElementById('root')).render(<App/>);
