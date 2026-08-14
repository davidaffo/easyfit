export const BACKUP_FORMAT = 'easyfit-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_FILENAME = 'easyfit-backup.json';

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
      autoSync: Boolean(profile.cloud?.autoSync),
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

export function backupStateFingerprint(state) {
  const value = JSON.stringify({
    profile: state?.profile || null,
    history: state?.history || [],
    workout: state?.workout || null,
  });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export function isWorkoutRecord(workout) {
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
      && item.sets.every((set) => set && typeof set === 'object'))
  );
}

function normalizeWorkoutRecord(workout) {
  return {
    ...workout,
    duration: Number.isFinite(Number(workout.duration)) ? Number(workout.duration) : 0,
    targetMuscles: Array.isArray(workout.targetMuscles) ? workout.targetMuscles : [],
  };
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
  if (!Array.isArray(payload.history)) throw new BackupError('Lo storico del backup non è valido.');
  if (!payload.history.every((workout) => isWorkoutRecord(workout)
    && Number.isFinite(Number(workout.completedAt))
    && Number(workout.completedAt) > 0)) throw new BackupError('Lo storico contiene workout non validi.');
  if (payload.workout != null && !isWorkoutRecord(payload.workout)) throw new BackupError('Il workout in corso non è valido.');
  const history = payload.history.map(normalizeWorkoutRecord);
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
    profile: payload.profile,
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

export async function uploadWebDavBackup({ folderUrl, username = '', password = '', serialized, etag = null, createOnly = false, fetcher = fetch }) {
  const url = buildWebDavFileUrl(folderUrl);
  await webDavRequest(url, {
    method: 'PUT',
    headers: {
      ...webDavHeaders(username, password, true),
      ...(etag ? { 'If-Match': etag } : {}),
      ...(createOnly ? { 'If-None-Match': '*' } : {}),
    },
    body: serialized,
  }, fetcher);
  return url;
}

export async function downloadWebDavBackup({ folderUrl, username = '', password = '', fetcher = fetch }) {
  return (await fetchWebDavBackup({ folderUrl, username, password, fetcher })).serialized;
}

export async function fetchWebDavBackup({ folderUrl, username = '', password = '', fetcher = fetch }) {
  const url = buildWebDavFileUrl(folderUrl);
  const response = await webDavRequest(url, {
    method: 'GET',
    headers: webDavHeaders(username, password),
  }, fetcher);
  return {
    serialized: await response.text(),
    etag: response.headers?.get?.('etag') || null,
  };
}

export function createWebDavUploadQueue(uploader = uploadWebDavBackup) {
  let tail = Promise.resolve();
  return (request) => {
    const task = tail.catch(() => {}).then(() => uploader(request));
    tail = task;
    return task;
  };
}

export function mergeBackupState(localState, remoteBackup, options = {}) {
  const history = new Map();
  [...(remoteBackup?.history || []), ...(localState?.history || [])].forEach((workout) => {
    const fallbackKey = `${Number(workout.completedAt) || 0}:${(workout.exercises || []).map((item) => item.exerciseId).join(',')}`;
    const key = workout.id || fallbackKey;
    const previous = history.get(key);
    const previousSets = previous?.exercises?.reduce((sum, item) => sum + (item.sets || []).filter((set) => set.done).length, 0) || 0;
    const currentSets = workout?.exercises?.reduce((sum, item) => sum + (item.sets || []).filter((set) => set.done).length, 0) || 0;
    if (!previous || currentSets >= previousSets) history.set(key, workout);
  });
  const localWorkout = localState?.workout && !localState.workout.completedAt ? localState.workout : null;
  const remoteWorkout = remoteBackup?.workout && !remoteBackup.workout.completedAt ? remoteBackup.workout : null;
  // Never replace a session currently present on this device. A remote session is
  // adopted only when there is no local one, so a pull cannot interrupt training.
  const workout = localWorkout || remoteWorkout || null;
  return {
    profile: options.preferRemoteProfile
      ? remoteBackup?.profile || localState?.profile || null
      : localState?.profile || remoteBackup?.profile || null,
    history: [...history.values()].sort((a, b) => Number(a.completedAt) - Number(b.completedAt)),
    workout,
  };
}

export async function synchronizeWebDavBackup(request, attempts = 2) {
  const { folderUrl, username = '', password = '', state, fetcher = fetch } = request;
  let remote = null;
  let etag = null;
  let createOnly = false;
  try {
    const downloaded = await fetchWebDavBackup({ folderUrl, username, password, fetcher });
    remote = parseBackup(downloaded.serialized);
    etag = downloaded.etag;
  } catch (error) {
    if (error.code !== 'not-found') throw error;
    createOnly = true;
  }
  const merged = mergeBackupState(state, remote);
  const serialized = serializeBackup(merged);
  try {
    await uploadWebDavBackup({ folderUrl, username, password, serialized, etag, createOnly, fetcher });
  } catch (error) {
    if (error.code === 'conflict' && attempts > 1) return synchronizeWebDavBackup(request, attempts - 1);
    throw error;
  }
  return { state: merged, serialized };
}
