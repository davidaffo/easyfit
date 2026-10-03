// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AppUpdate } from './AppUpdate.jsx';

let registration;
let serviceWorkers;
beforeEach(() => {
  vi.stubEnv('DEV', false);
  registration = Object.assign(new EventTarget(), {
    waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined),
  });
  serviceWorkers = Object.assign(new EventTarget(), {
    controller: {}, register: vi.fn().mockResolvedValue(registration),
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorkers });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  delete navigator.serviceWorker;
  delete navigator.onLine;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test('a waiting release is offered and activated only after clicking', async () => {
  const worker = { postMessage: vi.fn(), state: 'installed' };
  registration.waiting = worker;
  render(<AppUpdate/>);
  const button = await screen.findByRole('button', { name: 'Aggiorna ora' });
  expect(worker.postMessage).not.toHaveBeenCalled();
  expect(serviceWorkers.register).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' });
  act(() => button.click());
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  expect(screen.getByRole('button', { name: 'Aggiorno…' }).disabled).toBe(true);
});

test('an update installed while the app is open triggers the prompt', async () => {
  render(<AppUpdate/>);
  await waitFor(() => expect(registration.update).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).toBeNull();
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  act(() => {
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.state = 'installed';
    registration.waiting = worker;
    worker.dispatchEvent(new Event('statechange'));
  });
  expect(screen.getByRole('button', { name: 'Aggiorna ora' })).toBeTruthy();
});

test('the first installation does not request a reload', async () => {
  serviceWorkers.controller = null;
  registration.installing = Object.assign(new EventTarget(), { state: 'installing' });
  render(<AppUpdate/>);
  await waitFor(() => expect(registration.update).toHaveBeenCalled());
  act(() => {
    registration.installing.state = 'installed';
    registration.installing.dispatchEvent(new Event('statechange'));
    serviceWorkers.dispatchEvent(new Event('controllerchange'));
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('manual checks report offline and returning online checks again', async () => {
  render(<AppUpdate settings/>);
  await waitFor(() => expect(registration.update).toHaveBeenCalled());
  registration.update.mockClear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  act(() => screen.getByRole('button', { name: 'Controlla aggiornamenti' }).click());
  expect(screen.getByRole('status').textContent).toContain('Sei offline');
  expect(registration.update).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1));
  cleanup();
  act(() => window.dispatchEvent(new Event('online')));
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('a worker that fails to activate allows retry instead of blocking the button', async () => {
  registration.waiting = { postMessage: vi.fn(), state: 'installed' };
  render(<AppUpdate/>);
  const button = await screen.findByRole('button', { name: 'Aggiorna ora' });
  vi.useFakeTimers();
  act(() => button.click());
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole('button', { name: 'Aggiorna ora' }).disabled).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('Aggiornamento non riuscito');
});
