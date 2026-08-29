// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App, applyExercisePrescriptionLimits } from './main.jsx';
import { generateWorkout, startWorkout } from './engine/generator.js';

const profile = {
  goal: 'muscle',
  level: 'intermediate',
  equipment: ['bodyweight', 'dumbbells', 'bench', 'barbell', 'rack', 'cables', 'machines', 'pullup'],
  loadInventory: {
    dumbbells: [10, 12], kettlebell: [], barbell: [20, 40, 60], ezbar: [], machines: [20, 30], cables: [10, 15],
  },
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
  exerciseFilters: { essentialCatalog: true, preferLoadedVariants: true, excludeDirectCore: false, excludeCalves: false },
  preferences: {},
};

function saveState({ workout = null, history = [], savedProfile = profile } = {}) {
  localStorage.setItem('easyfit-profile', JSON.stringify(savedProfile));
  localStorage.setItem('easyfit-history', JSON.stringify(history));
  if (workout) localStorage.setItem('easyfit-workout', JSON.stringify(workout));
}

function activeWorkout(extra = {}) {
  const generated = generateWorkout(profile, [], { now: 1700000000000, variation: 81, duration: 45 });
  return { ...startWorkout(generated, Date.now()), ...extra };
}

function readyWorkout(extra = {}) {
  const workout = activeWorkout(extra);
  return {
    ...workout,
    exercises: workout.exercises.map((item) => ({
      ...item,
      needsInitialLoad: false,
      needsInitialReps: false,
      sets: item.sets.map((set) => ({
        ...set,
        weight: set.weight ?? 10,
        targetWeight: set.targetWeight ?? 10,
      })),
    })),
  };
}

beforeEach(() => {
  const values = new Map();
  const storage = {
    clear: () => values.clear(),
    getItem: (key) => values.has(key) ? values.get(key) : null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
    get length() { return values.size; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  vi.stubGlobal('localStorage', storage);
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(cleanup);

describe('critical workout lifecycle', () => {
  test('an active workout survives navigation and reload state without exposing generation', async () => {
    const user = userEvent.setup();
    saveState({ workout: activeWorkout({ restEndsAt: Date.now() + 60_000 }) });
    render(<App/>);

    expect(screen.getByRole('heading', { name: /Workoutin pausa/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Genera workout' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
    expect(screen.getByText('RECUPERO')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Metti in pausa e torna indietro' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('easyfit-workout')).pausedAt).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
    expect(screen.getByText('RECUPERO')).toBeTruthy();
    await waitFor(() => {
      const resumed = JSON.parse(localStorage.getItem('easyfit-workout'));
      expect(resumed.pausedAt).toBeNull();
      expect(resumed.pausedDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  test('a partial workout requires confirmation and is archived with its completion rate', async () => {
    const user = userEvent.setup();
    const workout = activeWorkout();
    workout.exercises[0].sets[0] = { ...workout.exercises[0].sets[0], done: true, rir: 2 };
    saveState({ workout });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App/>);
    await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
    await user.click(screen.getByRole('button', { name: /Termina workout/ }));
    expect(confirmation).toHaveBeenCalledOnce();
    expect(screen.getByText(/serie completate/)).toBeTruthy();

    confirmation.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /Termina workout/ }));
    await waitFor(() => {
      const history = JSON.parse(localStorage.getItem('easyfit-history'));
      expect(history).toHaveLength(1);
      expect(history[0].completionRate).toBeGreaterThan(0);
      expect(history[0].completionRate).toBeLessThan(1);
      expect(history[0].sessionDurationSeconds).toBeGreaterThanOrEqual(0);
      expect(localStorage.getItem('easyfit-workout')).toBeNull();
    });
  });

  test('a storage failure keeps the completed workout active and does not create a partial archive', async () => {
    const user = userEvent.setup();
    const workout = activeWorkout();
    workout.exercises[0].sets[0] = { ...workout.exercises[0].sets[0], done: true, rir: 2 };
    saveState({ workout });
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = vi.fn((key, value) => {
      if (key === 'easyfit-history') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      originalSetItem(key, value);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App/>);

    await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
    await user.click(screen.getByRole('button', { name: /Termina workout/ }));

    expect(await screen.findByText(/Workout non archiviato/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Termina workout/ })).toBeTruthy();
    expect(localStorage.getItem('easyfit-workout')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('easyfit-history'))).toHaveLength(0);
  });
});

test('a manually added dumbbell load is immediately visible and persisted', async () => {
  const user = userEvent.setup();
  saveState({ savedProfile: { ...profile, loadInventory: { ...profile.loadInventory, dumbbells: [] } } });
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Impostazioni' }));
  const input = screen.getByRole('spinbutton', { name: 'Peso disponibile per Manubri' });
  await user.type(input, '12.5');
  await user.click(within(input.closest('form')).getByRole('button', { name: 'Aggiungi' }));
  expect(screen.getByRole('button', { name: 'Rimuovi 12.5 kg' })).toBeTruthy();
  await waitFor(() => expect(JSON.parse(localStorage.getItem('easyfit-profile')).loadInventory.dumbbells).toContain(12.5));
});

test('training style replaces global RIR and set-cap controls and persists as one choice', async () => {
  const user = userEvent.setup();
  saveState();
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Impostazioni' }));
  expect(screen.getByRole('heading', { name: 'Stile di allenamento' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'RIR target' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Limite serie per esercizio' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Essenziale intenso/ }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem('easyfit-profile')).trainingStyle).toBe('intense'));
});

test('disabled core and calves never appear in today priorities or recovery details', async () => {
  const user = userEvent.setup();
  saveState({ savedProfile: {
    ...profile,
    exerciseFilters: { ...profile.exerciseFilters, excludeDirectCore: true, excludeCalves: true },
  } });
  render(<App/>);
  expect(screen.getByText('PRIORITÀ DI OGGI')).toBeTruthy();
  expect(screen.queryByText('PIÙ RECUPERATI')).toBeNull();
  expect(screen.queryByText('Core')).toBeNull();
  expect(screen.queryByText('Polpacci')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Vedi recupero' }));
  expect(screen.queryByText('Core')).toBeNull();
  expect(screen.queryByText('Polpacci')).toBeNull();
});

test('a load entered during a workout is added to the available inventory', async () => {
  const user = userEvent.setup();
  saveState({ workout: activeWorkout() });
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
  const calibrationInput = screen.getAllByRole('spinbutton', { name: /^kg/ })[0];
  await user.type(calibrationInput, '12');
  await user.click(within(calibrationInput.closest('form')).getByRole('button', { name: 'Imposta carico' }));
  const weightInput = screen.getAllByRole('textbox', { name: 'Peso set 1' })[0];
  await user.clear(weightInput);
  await user.type(weightInput, '14');
  await user.tab();
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem('easyfit-profile'));
    expect(Object.values(saved.loadInventory).some((loads) => loads.includes(14))).toBe(true);
  });
});

test('bodyweight-only onboarding warns about reduced coverage but does not trap the user', async () => {
  const user = userEvent.setup();
  render(<App/>);
  await user.click(screen.getByRole('button', { name: /Configura in 60 secondi/ }));
  await user.click(screen.getByRole('button', { name: /Continua/ }));
  await user.click(screen.getByRole('button', { name: /Manubri/ }));
  await user.click(screen.getByRole('button', { name: /Panca/ }));
  expect(screen.getByText(/Attrezzatura incompleta/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Continua/ }));
  expect(screen.getByRole('heading', { name: 'Ultimi dettagli' })).toBeTruthy();
});

test('loading filters malformed history without silently overwriting the original storage value', async () => {
  localStorage.setItem('easyfit-profile', JSON.stringify(profile));
  const original = JSON.stringify([{ legacy: true, raw: 'preserve-for-recovery' }]);
  localStorage.setItem('easyfit-history', original);
  render(<App/>);
  await waitFor(() => expect(screen.getByRole('heading', { name: /Ciao, sei pronto/ })).toBeTruthy());
  expect(localStorage.getItem('easyfit-history')).toBe(original);
});

test('changing prescription limits never rewrites completed-set evidence', () => {
  const item = {
    targetRir: 2,
    repRange: { min: 8, max: 12 },
    sets: [
      { done: true, reps: 7, targetReps: 8, targetRir: 2, rir: null, weight: 60 },
      { done: false, reps: 8, targetReps: 8, targetRir: 2, rir: null, weight: 60 },
    ],
  };
  const updated = applyExercisePrescriptionLimits(item, { minReps: 10, maxReps: 15, maxSets: 4, targetRir: 0 });
  expect(updated.sets[0]).toEqual(item.sets[0]);
  expect(updated.sets[1]).toMatchObject({ done: false, reps: 10, targetReps: 10, targetRir: 0 });
  expect(updated.targetRir).toBe(0);
});

test('editing a set replaces the selected number and propagates only to later unfinished sets', async () => {
  const user = userEvent.setup();
  saveState({ workout: readyWorkout() });
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
  const firstCard = screen.getAllByRole('article')[0];
  const first = within(firstCard).getByRole('textbox', { name: 'Ripetizioni set 1' });
  const second = within(firstCard).getByRole('textbox', { name: 'Ripetizioni set 2' });
  const third = within(firstCard).getByRole('textbox', { name: 'Ripetizioni set 3' });
  const firstValue = first.value;
  await user.click(second);
  await user.type(second, '6');
  await user.tab();
  expect(first.value).toBe(firstValue);
  expect(second.value).toBe('6');
  expect(third.value).toBe('6');
  const saved = JSON.parse(localStorage.getItem('easyfit-workout'));
  expect(saved.exercises[0].sets[0].reps).toBe(Number(firstValue));
  expect(saved.exercises[0].sets[1].reps).toBe(6);
  expect(saved.exercises[0].sets[2].reps).toBe(6);
});

test('work sets can be appended and the final unfinished set removed manually', async () => {
  const user = userEvent.setup();
  saveState({ workout: readyWorkout() });
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
  const firstCard = screen.getAllByRole('article')[0];
  const originalInputs = within(firstCard).getAllByRole('textbox', { name: /Ripetizioni set/ }).length;
  await user.click(within(firstCard).getByRole('button', { name: '+ Serie' }));
  expect(within(firstCard).getAllByRole('textbox', { name: /Ripetizioni set/ })).toHaveLength(originalInputs + 1);
  await user.click(within(firstCard).getByRole('button', { name: '− Serie' }));
  expect(within(firstCard).getAllByRole('textbox', { name: /Ripetizioni set/ })).toHaveLength(originalInputs);
});

test('excluding an exercise requires choosing and installs a similar replacement', async () => {
  const user = userEvent.setup();
  const workout = activeWorkout();
  const excludedId = workout.exercises[0].exerciseId;
  saveState({ workout });
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
  await user.click(screen.getAllByRole('button', { name: /Opzioni per/ })[0]);
  await user.click(screen.getByRole('button', { name: /Non proporre più/ }));
  const dialog = screen.getByRole('dialog', { name: /Sostituisci/ });
  const choice = dialog.querySelector('.similar-list button');
  expect(choice).toBeTruthy();
  await user.click(choice);
  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem('easyfit-profile')).preferences[excludedId]).toBe('exclude');
    expect(JSON.parse(localStorage.getItem('easyfit-workout')).exercises.some((item) => item.exerciseId === excludedId)).toBe(false);
  });
});

test('reducing max sets preserves completed evidence but removes future excess sets', () => {
  const item = {
    targetRir: 2,
    repRange: { min: 8, max: 12 },
    sets: [
      { done: true, reps: 8, targetReps: 8, targetRir: 2, rir: 2 },
      { done: false, reps: 8, targetReps: 8, targetRir: 2, rir: null },
      { done: false, reps: 8, targetReps: 8, targetRir: 2, rir: null },
    ],
  };
  const updated = applyExercisePrescriptionLimits(item, { minReps: 8, maxReps: 12, maxSets: 1, targetRir: 2 });
  expect(updated.sets).toEqual([item.sets[0]]);
});
