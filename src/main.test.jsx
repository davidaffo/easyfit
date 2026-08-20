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
  return { ...startWorkout(generated, 1700000001000), ...extra };
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
    await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
    expect(screen.getByText('RECUPERO')).toBeTruthy();
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

test('a load entered during a workout is added to the available inventory', async () => {
  const user = userEvent.setup();
  saveState({ workout: activeWorkout() });
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
  const calibrationInput = screen.getAllByRole('spinbutton', { name: /^kg/ })[0];
  await user.type(calibrationInput, '12');
  await user.click(within(calibrationInput.closest('form')).getByRole('button', { name: 'Imposta carico' }));
  const weightInput = screen.getAllByRole('spinbutton', { name: 'Peso set 1' })[0];
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
