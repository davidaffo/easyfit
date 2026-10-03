import React, { useEffect, useRef, useState } from 'react';

export function AppUpdate({ settings = false }) {
  const registration = useRef(null);
  const applying = useRef(false);
  const activationTimer = useRef(null);
  const [available, setAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let disposed = false;
    const cleanups = [];
    const serviceWorkers = navigator.serviceWorker;
    const wasControlled = Boolean(serviceWorkers.controller);
    const onControllerChange = () => {
      if (applying.current) {
        window.clearTimeout(activationTimer.current);
        applying.current = false;
        window.location.reload();
      }
      else if (wasControlled) setAvailable(true);
    };
    serviceWorkers.addEventListener('controllerchange', onControllerChange);
    serviceWorkers.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((next) => {
        if (disposed) return;
        registration.current = next;
        const detectWaiting = () => { if (next.waiting) setAvailable(true); };
        const watchInstalling = () => {
          const worker = next.installing;
          if (!worker) return;
          const onStateChange = () => {
            if (worker.state === 'installed' && serviceWorkers.controller) setAvailable(true);
          };
          worker.addEventListener('statechange', onStateChange);
          cleanups.push(() => worker.removeEventListener('statechange', onStateChange));
        };
        const check = () => {
          if (navigator.onLine && document.visibilityState === 'visible') {
            next.update().then(detectWaiting).catch(() => {});
          }
        };
        detectWaiting();
        watchInstalling();
        next.addEventListener('updatefound', watchInstalling);
        window.addEventListener('online', check);
        document.addEventListener('visibilitychange', check);
        const interval = window.setInterval(check, 30 * 60 * 1000);
        cleanups.push(() => {
          next.removeEventListener('updatefound', watchInstalling);
          window.removeEventListener('online', check);
          document.removeEventListener('visibilitychange', check);
          window.clearInterval(interval);
        });
        check();
      }).catch(() => { if (!disposed) setFeedback('Controllo aggiornamenti non disponibile.'); });
    return () => {
      disposed = true;
      window.clearTimeout(activationTimer.current);
      registration.current = null;
      serviceWorkers.removeEventListener('controllerchange', onControllerChange);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const checkForUpdate = async () => {
    if (!navigator.onLine) { setFeedback('Sei offline: controllo non disponibile.'); return; }
    if (!registration.current) { setFeedback('Controllo aggiornamenti non ancora disponibile.'); return; }
    setChecking(true);
    try {
      await registration.current.update();
      if (registration.current.waiting) setAvailable(true);
      setFeedback(registration.current.installing || registration.current.waiting
        ? 'Nuova versione in preparazione…' : 'Stai usando l’ultima versione.');
    } catch {
      setFeedback('Controllo aggiornamenti non riuscito. Riprova tra poco.');
    } finally { setChecking(false); }
  };

  const installUpdate = () => {
    setUpdating(true);
    setFeedback('');
    applying.current = true;
    const worker = registration.current?.waiting;
    if (!worker) { window.location.reload(); return; }
    try {
      activationTimer.current = window.setTimeout(() => {
        applying.current = false;
        if (worker.state === 'activated') { window.location.reload(); return; }
        setUpdating(false);
        setFeedback('Aggiornamento non riuscito. Riprova tra poco.');
      }, 10_000);
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      window.clearTimeout(activationTimer.current);
      applying.current = false;
      setUpdating(false);
      setFeedback('Aggiornamento non riuscito. Riprova tra poco.');
    }
  };

  return <>
    {available && <aside className="app-update-banner" role="alert">
      <div><strong>Nuova versione disponibile</strong><span>Aggiorna l’app per usare le ultime novità.</span>
        {feedback && <span role="status">{feedback}</span>}</div>
      <button type="button" onClick={installUpdate} disabled={updating}>{updating ? 'Aggiorno…' : 'Aggiorna ora'}</button>
    </aside>}
    {settings && <section className="app-update-settings">
      <strong>Aggiornamenti app</strong>
      <p>Il controllo è automatico. Puoi verificare anche manualmente.</p>
      <button type="button" onClick={available ? installUpdate : checkForUpdate} disabled={checking || updating}>
        {updating ? 'Aggiorno…' : checking ? 'Controllo…' : available ? 'Aggiorna ora' : 'Controlla aggiornamenti'}
      </button>
      {feedback && <p role="status">{feedback}</p>}
    </section>}
  </>;
}
