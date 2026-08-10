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

function isWorkoutRecord(workout) {
  return Boolean(
    workout
    && typeof workout === 'object'
    && Array.isArray(workout.exercises)
    && workout.exercises.every((item) => item
      && typeof item === 'object'
      && typeof item.exerciseId === 'string'
      && Array.isArray(item.sets)
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
  if (!payload.history.every((workout) => isWorkoutRecord(workout) && Number.isFinite(Number(workout.completedAt)))) throw new BackupError('Lo storico contiene workout non validi.');
  if (payload.workout != null && !isWorkoutRecord(payload.workout)) throw new BackupError('Il workout in corso non è valido.');
  return {
    profile: payload.profile,
    history: payload.history.map(normalizeWorkoutRecord),
    workout: payload.workout ? normalizeWorkoutRecord(payload.workout) : null,
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
  if (!['https:', 'http:'].includes(url.protocol)) throw new BackupError('L’URL WebDAV deve usare HTTPS o HTTP.', 'invalid-url');
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
      throw new BackupError(`Nextcloud ha risposto con errore ${response.status}.`, 'webdav');
    }
    return response;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('Connessione WebDAV non riuscita. Controlla URL, rete e configurazione CORS di Nextcloud.', 'network');
  }
}

export async function uploadWebDavBackup({ folderUrl, username = '', password = '', serialized, fetcher = fetch }) {
  const url = buildWebDavFileUrl(folderUrl);
  await webDavRequest(url, {
    method: 'PUT',
    headers: webDavHeaders(username, password, true),
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
  return response.text();
}
