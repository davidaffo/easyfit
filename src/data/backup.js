import { equipmentLabels } from './exercises.js';

export const BACKUP_FORMAT = 'easyfit-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_FILENAME = 'easyfit-backup.json';
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export class BackupError extends Error {
  constructor(message, code = 'invalid-backup') {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export function createBackup({ profile, history, workout }) {
  if (!profile || typeof profile !== 'object') throw new BackupError('Il profilo non è disponibile.');
  const safeProfile = {
    ...profile,
    cloud: {
      webDavUrl: profile.cloud?.webDavUrl || '',
      webDavUsername: profile.cloud?.webDavUsername || '',
    },
  };
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    payload: {
      profile: safeProfile,
      history: Array.isArray(history) ? history : [],
      workout: workout && typeof workout === 'object' ? workout : null,
    },
  };
}

export function serializeBackup(state) {
  return JSON.stringify(createBackup(state), null, 2);
}

export function isWorkoutRecord(workout) {
  const validOptionalNumber = (value, min, max) => value == null
    || (Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max);
  return Boolean(
    workout
    && typeof workout === 'object'
    && Array.isArray(workout.exercises)
    && workout.exercises.length > 0
    && workout.exercises.every((item) => item
      && typeof item === 'object'
      && typeof item.exerciseId === 'string'
      && Array.isArray(item.sets)
      && item.sets.length > 0
      && item.sets.every((set) => set
        && typeof set === 'object'
        && typeof set.done === 'boolean'
        && Number.isFinite(Number(set.reps))
        && Number(set.reps) >= 0
        && Number(set.reps) <= 100
        && validOptionalNumber(set.weight, 0, 1000)
        && validOptionalNumber(set.rir, 0, 10)
        && validOptionalNumber(set.targetReps, 0, 100)
        && validOptionalNumber(set.targetWeight, 0, 1000)
        && validOptionalNumber(set.targetRir, 0, 10)))
  );
}

function normalizeWorkoutRecord(workout) {
  return {
    ...workout,
    ...(workout.createdAt != null ? { createdAt: Number(workout.createdAt) } : {}),
    ...(workout.startedAt != null ? { startedAt: Number(workout.startedAt) } : {}),
    ...(workout.completedAt != null ? { completedAt: Number(workout.completedAt) } : {}),
    duration: Number.isFinite(Number(workout.duration)) ? Number(workout.duration) : 0,
    targetMuscles: Array.isArray(workout.targetMuscles) ? workout.targetMuscles : [],
    exercises: workout.exercises.map((item) => ({
      ...item,
      ...(item.initialLoad != null ? { initialLoad: Number(item.initialLoad) } : {}),
      ...(item.initialMaxReps != null ? { initialMaxReps: Number(item.initialMaxReps) } : {}),
      sets: item.sets.map((set) => ({
        ...set,
        reps: Number(set.reps),
        ...(set.weight != null ? { weight: Number(set.weight) } : {}),
        ...(set.rir != null ? { rir: Number(set.rir) } : {}),
        ...(set.targetReps != null ? { targetReps: Number(set.targetReps) } : {}),
        ...(set.targetWeight != null ? { targetWeight: Number(set.targetWeight) } : {}),
        ...(set.targetRir != null ? { targetRir: Number(set.targetRir) } : {}),
      })),
    })),
  };
}

function validNumericArray(value, { min = 0, max = 1000 } = {}) {
  return Array.isArray(value) && value.every((item) => Number.isFinite(Number(item))
    && Number(item) >= min && Number(item) <= max);
}

function validateBackupProfile(profile) {
  const objectOrMissing = (value) => value == null || (typeof value === 'object' && !Array.isArray(value));
  const knownEquipment = new Set(Object.keys(equipmentLabels));
  if (profile.goal != null && !['muscle', 'strength', 'fitness'].includes(profile.goal)) throw new BackupError('Il profilo contiene un obiettivo non valido.');
  if (profile.level != null && !['beginner', 'intermediate', 'advanced'].includes(profile.level)) throw new BackupError('Il profilo contiene un livello non valido.');
  if (profile.duration != null && (!Number.isFinite(Number(profile.duration)) || Number(profile.duration) < 25 || Number(profile.duration) > 75 || Number(profile.duration) % 5 !== 0)) {
    throw new BackupError('La durata nel profilo deve essere compresa tra 25 e 75 minuti.');
  }
  if (profile.targetRir != null && (!Number.isInteger(Number(profile.targetRir)) || Number(profile.targetRir) < 0 || Number(profile.targetRir) > 4)) {
    throw new BackupError('Il RIR target nel profilo non è valido.');
  }
  if (profile.equipment != null && (!Array.isArray(profile.equipment) || !profile.equipment.length
    || !profile.equipment.every((item) => typeof item === 'string' && knownEquipment.has(item)))) {
    throw new BackupError('L’attrezzatura nel profilo non è valida.');
  }
  if (profile.exerciseLanguage != null && !['en', 'it'].includes(profile.exerciseLanguage)) throw new BackupError('La lingua degli esercizi nel profilo non è valida.');
  ['preferences', 'exerciseFilters', 'exerciseOverrides', 'trainingAdaptation', 'recoveryFeedback', 'setCaps', 'cloud'].forEach((key) => {
    if (!objectOrMissing(profile[key])) throw new BackupError(`La sezione ${key} del profilo non è valida.`);
  });
  if (profile.setCaps && Object.values(profile.setCaps).some((value) => !Number.isFinite(Number(value)) || Number(value) < 1 || Number(value) > 6)) {
    throw new BackupError('I limiti delle serie nel profilo non sono validi.');
  }
  for (const inventoryName of ['loadInventory', 'exerciseLoadInventory']) {
    const inventory = profile[inventoryName];
    if (inventory == null) continue;
    if (!objectOrMissing(inventory) || Object.values(inventory).some((values) => !validNumericArray(values, { min: 0.01 }))) {
      throw new BackupError('L’inventario dei carichi nel profilo non è valido.');
    }
  }
  if (profile.cloud?.webDavUrl != null && typeof profile.cloud.webDavUrl !== 'string') throw new BackupError('L’URL WebDAV nel profilo non è valido.');
  if (profile.cloud?.webDavUsername != null && typeof profile.cloud.webDavUsername !== 'string') throw new BackupError('Lo username WebDAV nel profilo non è valido.');
}

function normalizeBackupProfile(profile) {
  const numericInventory = (inventory) => Object.fromEntries(Object.entries(inventory)
    .map(([key, values]) => [key, values.map(Number)]));
  return {
    ...profile,
    ...(profile.duration != null ? { duration: Number(profile.duration) } : {}),
    ...(profile.targetRir != null ? { targetRir: Number(profile.targetRir) } : {}),
    ...(profile.equipment ? { equipment: [...new Set(profile.equipment)] } : {}),
    ...(profile.setCaps ? { setCaps: Object.fromEntries(Object.entries(profile.setCaps).map(([key, value]) => [key, Number(value)])) } : {}),
    ...(profile.loadInventory ? { loadInventory: numericInventory(profile.loadInventory) } : {}),
    ...(profile.exerciseLoadInventory ? { exerciseLoadInventory: numericInventory(profile.exerciseLoadInventory) } : {}),
    ...(profile.cloud ? {
      cloud: {
        webDavUrl: profile.cloud.webDavUrl || '',
        webDavUsername: profile.cloud.webDavUsername || '',
      },
    } : {}),
  };
}

function deduplicateHistory(records) {
  const history = [];
  const seen = new Map();
  records.map(normalizeWorkoutRecord).forEach((workout) => {
    const key = typeof workout.id === 'string' && workout.id
      ? `id:${workout.id}`
      : `legacy:${workout.completedAt}:${JSON.stringify(workout.exercises)}`;
    const serialized = JSON.stringify(workout);
    if (seen.has(key)) {
      if (seen.get(key) !== serialized) throw new BackupError('Lo storico contiene workout diversi con lo stesso identificatore.');
      return;
    }
    seen.set(key, serialized);
    history.push(workout);
  });
  return history;
}

export function parseBackup(serialized) {
  let backup;
  try {
    backup = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  } catch {
    throw new BackupError('Il file non contiene JSON valido.');
  }
  if (!backup || backup.format !== BACKUP_FORMAT) throw new BackupError('Questo non è un backup Easyfit riconosciuto.');
  if (!Number.isInteger(backup.schemaVersion) || backup.schemaVersion < 1) throw new BackupError('Versione del backup non valida.');
  if (backup.schemaVersion > BACKUP_SCHEMA_VERSION) throw new BackupError('Il backup proviene da una versione più recente di Easyfit.', 'newer-schema');
  const payload = backup.payload;
  if (!payload || !payload.profile || typeof payload.profile !== 'object') throw new BackupError('Nel backup manca il profilo.');
  validateBackupProfile(payload.profile);
  if (!Array.isArray(payload.history)) throw new BackupError('Lo storico del backup non è valido.');
  if (!payload.history.every((workout) => isWorkoutRecord(workout)
    && Number.isFinite(Number(workout.completedAt))
    && Number(workout.completedAt) > 0)) throw new BackupError('Lo storico contiene workout non validi.');
  if (payload.workout != null && !isWorkoutRecord(payload.workout)) throw new BackupError('Il workout in corso non è valido.');
  const history = deduplicateHistory(payload.history);
  let workout = payload.workout ? normalizeWorkoutRecord(payload.workout) : null;
  if (workout?.completedAt) {
    if (!Number.isFinite(Number(workout.completedAt)) || Number(workout.completedAt) <= 0) {
      throw new BackupError('Il workout concluso nel backup non è valido.');
    }
    const alreadyArchived = history.some((entry) => (entry.id && workout.id
      ? entry.id === workout.id
      : Number(entry.completedAt) === Number(workout.completedAt)
        && entry.exercises.length === workout.exercises.length));
    if (!alreadyArchived) history.push(workout);
    workout = null;
  }
  return {
    profile: normalizeBackupProfile(payload.profile),
    history: history.sort((a, b) => Number(a.completedAt) - Number(b.completedAt)),
    workout,
    exportedAt: backup.exportedAt || null,
    schemaVersion: backup.schemaVersion,
  };
}

export function backupDownloadName(date = new Date()) {
  return `easyfit-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function buildWebDavFileUrl(folderUrl, filename = BACKUP_FILENAME) {
  let url;
  try {
    url = new URL(String(folderUrl).trim());
  } catch {
    throw new BackupError('Inserisci un URL WebDAV completo e valido.', 'invalid-url');
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new BackupError('WebDAV richiede HTTPS (HTTP è consentito solo in locale).', 'invalid-url');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(filename)}`;
  return url.toString();
}

function basicAuthorization(username, password) {
  if (!username && !password) return null;
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `Basic ${btoa(binary)}`;
}

function webDavHeaders(username, password, includeContentType = false) {
  const authorization = basicAuthorization(username, password);
  return {
    ...(authorization ? { Authorization: authorization } : {}),
    'X-Requested-With': 'XMLHttpRequest',
    ...(includeContentType ? {
      'Content-Type': 'application/json; charset=utf-8',
      'X-NC-WebDAV-AutoMkcol': '1',
    } : {}),
  };
}

async function webDavRequest(url, options, fetcher) {
  try {
    const response = await fetcher(url, options);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new BackupError('Accesso negato: controlla username e app password.', 'auth');
      if (response.status === 404) throw new BackupError('Backup o cartella WebDAV non trovati.', 'not-found');
      if (response.status === 412) throw new BackupError('Il backup cloud è cambiato su un altro dispositivo.', 'conflict');
      throw new BackupError(`Nextcloud ha risposto con errore ${response.status}.`, 'webdav');
    }
    return response;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('Connessione WebDAV non riuscita. Controlla URL, rete e configurazione CORS di Nextcloud.', 'network');
  }
}

export async function uploadWebDavBackup({ folderUrl, username = '', password = '', serialized, fetcher = fetch }) {
  if (new TextEncoder().encode(String(serialized)).byteLength > MAX_BACKUP_BYTES) {
    throw new BackupError('Il backup è troppo grande per essere caricato.', 'too-large');
  }
  const url = buildWebDavFileUrl(folderUrl);
  await webDavRequest(url, {
    method: 'PUT',
    headers: {
      ...webDavHeaders(username, password, true),
    },
    body: serialized,
  }, fetcher);
  return url;
}

export async function downloadWebDavBackup({ folderUrl, username = '', password = '', fetcher = fetch }) {
  const url = buildWebDavFileUrl(folderUrl);
  const response = await webDavRequest(url, {
    method: 'GET',
    headers: webDavHeaders(username, password),
  }, fetcher);
  const declaredSize = Number(response.headers?.get?.('Content-Length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BACKUP_BYTES) {
    throw new BackupError('Il backup cloud è troppo grande.', 'too-large');
  }
  const serialized = await response.text();
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) {
    throw new BackupError('Il backup cloud è troppo grande.', 'too-large');
  }
  return serialized;
}
