export const DATABASE_NAME = 'easyfit';
export const STATE_STORE = 'state';
const stateKeys = ['easyfit-profile', 'easyfit-history', 'easyfit-workout'];

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('Salvataggio interrotto'));
    transaction.onerror = () => {}; // The abort event reports transaction failures.
  });
}

export async function openAppStorage() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STATE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Chiudi le altre schede di Easyfit e riprova.'));
  });
  db.onversionchange = () => db.close();

  const read = async () => {
    const transaction = db.transaction(STATE_STORE, 'readonly');
    const done = transactionDone(transaction);
    const values = new Map();
    for (const key of stateKeys) {
      const request = transaction.objectStore(STATE_STORE).get(key);
      request.onsuccess = () => values.set(key, request.result);
    }
    await done;
    return values;
  };
  const write = async (entries) => {
    const transaction = db.transaction(STATE_STORE, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(STATE_STORE);
      for (const [key, value] of entries) {
        if (value == null) store.delete(key);
        else store.put(value, key);
      }
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  };

  try {
    const saved = await read();
    const legacy = [];
    for (const key of stateKeys) {
      // Only import missing records. A newer IndexedDB value always wins.
      if (saved.get(key) !== undefined) continue;
      let raw;
      try { raw = localStorage.getItem(key); } catch { continue; }
      if (raw == null) continue;
      // Invalid legacy JSON is left intact for recovery.
      try { legacy.push([key, JSON.parse(raw)]); } catch { /* Preserve the source. */ }
    }
    if (legacy.length) await write(legacy);
    for (const [key, value] of legacy) saved.set(key, value);
    // Remove the old copy only after the migration transaction commits.
    for (const key of stateKeys) {
      if (saved.get(key) !== undefined) {
        try { localStorage.removeItem(key); } catch { /* IndexedDB is already durable. */ }
      }
    }
    return {
      load: (key, fallback) => saved.get(key) ?? fallback,
      persist: async (key, value) => {
        try { await write([[key, value]]); return true; } catch { return false; }
      },
      persistAppStateAtomically: async (entries) => {
        try { await write(entries); return true; } catch { return false; }
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function requestPersistentStorage() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* Optional browser support. */ }
}
