import { spawn } from 'node:child_process';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curatedExercises, loadCatalogRegistry } from '../../scripts/curated-exercises.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const staticRoot = resolve(root, 'tools/catalog-editor');
const sourcePath = resolve(root, 'src/generated/wger-exercises.json');
const detailsPath = resolve(root, 'src/generated/wger-exercise-details.json');
const runtimeDetailsPath = resolve(root, 'src/generated/exercise-details.json');
const overridesPath = resolve(root, 'scripts/catalog-overrides.json');
const port = Number(process.env.EASYFIT_CATALOG_PORT) || 4178;
const muscles = ['chest', 'back', 'quads', 'hamstrings', 'glutes', 'shoulders', 'biceps', 'triceps', 'calves', 'core'];
const effortClasses = ['high-fatigue-compound', 'stable-compound', 'isolation'];
const loadTypes = ['external', 'per-dumbbell', 'bodyweight', 'reps-only'];
let runningAction = null;

async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Payload troppo grande');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateDocument(document, sourceIds) {
  if (!document || document.schemaVersion !== 1 || !document.exercises || Array.isArray(document.exercises)) {
    throw new Error('Formato override non valido');
  }
  for (const [id, entry] of Object.entries(document.exercises)) {
    if (!sourceIds.has(Number(id))) throw new Error(`Wger ID ${id} non presente nel dataset sorgente`);
    if (typeof entry.enabled !== 'boolean') throw new Error(`${id}: enabled deve essere booleano`);
    if (!entry.enabled) continue;
    const effective = { ...(curatedExercises[id] || {}), ...(entry.programming || {}) };
    if (!effective.pattern?.trim() || !muscles.includes(effective.primary)) throw new Error(`${id}: pattern o muscolo primario non valido`);
    if (typeof effective.compound !== 'boolean' || !effortClasses.includes(effective.effortClass)) throw new Error(`${id}: classe di esercizio non valida`);
    if (!Array.isArray(effective.equipment) || !effective.equipment.length) throw new Error(`${id}: seleziona almeno un'attrezzatura`);
    if (!loadTypes.includes(effective.loadType)) throw new Error(`${id}: tipo di carico non valido`);
    if (!Number.isFinite(Number(effective.loadMultiplier)) || Number(effective.loadMultiplier) <= 0) throw new Error(`${id}: moltiplicatore carico non valido`);
    if (!Number.isFinite(Number(effective.selectionPriority))) throw new Error(`${id}: priorità non valida`);
    if (!effective.muscleContributions || Number(effective.muscleContributions[effective.primary]) <= 0) throw new Error(`${id}: manca il contributo del muscolo primario`);
    for (const [muscle, contribution] of Object.entries(effective.muscleContributions || {})) {
      if (!muscles.includes(muscle) || Number(contribution) <= 0 || Number(contribution) > 1) throw new Error(`${id}: contributo ${muscle} non valido`);
    }
    if (effective.effortClass === 'high-fatigue-compound' && effective.intensifierEligible !== false) {
      throw new Error(`${id}: un multiarticolare ad alta fatica non può usare intensificatori`);
    }
    if (entry.guide?.image && !String(entry.guide.image).startsWith('/exercise-images/')) {
      throw new Error(`${id}: un override immagine deve essere un asset locale /exercise-images/...`);
    }
    if (entry.guide?.image && (!entry.guide.imageAttribution?.licenseName || !entry.guide.imageAttribution?.author)) {
      throw new Error(`${id}: indica autore e licenza dell'immagine locale`);
    }
  }
}

async function catalogPayload() {
  const [source, details, runtimeDetails, registry] = await Promise.all([jsonFile(sourcePath), jsonFile(detailsPath), jsonFile(runtimeDetailsPath), loadCatalogRegistry()]);
  return {
    source: source.exercises,
    details: details.exercises,
    runtimeDetails: runtimeDetails.exercises,
    base: curatedExercises,
    effective: registry.curatedExercises,
    overrides: registry.overrides,
    options: { muscles, effortClasses, loadTypes },
  };
}

async function saveOverrides(document) {
  const source = await jsonFile(sourcePath);
  validateDocument(document, new Set(source.exercises.map((item) => item.wgerId)));
  const stamp = new Date().toISOString().replaceAll(':', '-');
  await copyFile(overridesPath, resolve('/tmp', `easyfit-catalog-overrides-${stamp}.json`)).catch(() => {});
  const temporary = `${overridesPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`);
  await rename(temporary, overridesPath);
}

function runAction(action) {
  if (runningAction?.status === 'running') throw new Error(`Operazione già in corso: ${runningAction.name}`);
  const args = action === 'sync' ? ['run', 'sync:wger'] : ['run', 'curate:exercises'];
  const child = spawn('npm', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { name: action, status: 'running', output: '', startedAt: Date.now() };
  runningAction = state;
  const append = (chunk) => { state.output = `${state.output}${chunk}`.slice(-30_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('close', (code) => {
    state.status = code === 0 ? 'done' : 'failed';
    state.code = code;
    state.finishedAt = Date.now();
    setTimeout(() => { if (runningAction === state) runningAction = null; }, 5 * 60_000);
  });
  return state;
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

const server = createServer(async (request, response) => {
  try {
    const host = String(request.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(response, 403, { error: 'Solo accesso locale' });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/api/catalog') return send(response, 200, await catalogPayload());
    if (request.method === 'GET' && url.pathname === '/api/action') return send(response, 200, runningAction || { status: 'idle' });
    if (request.method === 'PUT' && url.pathname === '/api/overrides') {
      const document = await bodyJson(request);
      await saveOverrides(document);
      return send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/action/')) {
      const action = url.pathname.split('/').at(-1);
      if (!['curate', 'sync'].includes(action)) return send(response, 404, { error: 'Azione sconosciuta' });
      return send(response, 202, runAction(action));
    }
    if (request.method === 'GET' && staticFiles[url.pathname]) {
      const [filename, type] = staticFiles[url.pathname];
      return send(response, 200, await readFile(resolve(staticRoot, filename), 'utf8'), type);
    }
    return send(response, 404, { error: 'Non trovato' });
  } catch (error) {
    return send(response, 400, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Easyfit Catalog Editor: http://127.0.0.1:${port}`);
  console.log('Solo sviluppo locale: Ctrl+C per arrestare.');
});
