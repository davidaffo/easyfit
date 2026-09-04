const $ = (selector, root = document) => root.querySelector(selector);
const state = {
  data: null, selectedId: null, filter: 'all', query: '',
  filters: { language: 'all', equipment: 'all', muscle: 'all', category: 'all', kind: 'all', pattern: 'all', image: 'all', guide: 'all' },
};
const equipmentOptions = ['bodyweight', 'dumbbells', 'barbell', 'ezbar', 'kettlebell', 'cables', 'machines', 'bench', 'rack', 'pullup', 'bands', 'ball', 'abwheel'];
const muscleIds = { 1: 'biceps', 2: 'shoulders', 3: 'chest', 4: 'chest', 5: 'triceps', 6: 'core', 7: 'calves', 8: 'glutes', 9: 'back', 10: 'quads', 11: 'hamstrings', 12: 'back', 13: 'biceps', 14: 'core', 15: 'calves' };
const equipmentIds = { 'none (bodyweight exercise)': 'bodyweight', Dumbbell: 'dumbbells', 'Cable machine': 'cables', Barbell: 'barbell', Bench: 'bench', 'Incline bench': 'bench', 'Pull-up bar': 'pullup', 'SZ-Bar': 'ezbar', Kettlebell: 'kettlebell', 'Resistance band': 'bands', 'Gym mat': 'bodyweight', 'Swiss Ball': 'ball' };

async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Errore');
  return result;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function approved(id) { return Boolean(state.data.effective[id]); }
function changed(id) { return Object.hasOwn(state.data.overrides.exercises, id); }

function normalizedEquipment(item, effective) {
  return effective?.equipment || [...new Set(item.equipment.map((name) => equipmentIds[name]).filter(Boolean))];
}

function normalizedMuscles(item, effective) {
  return effective ? Object.keys(effective.muscleContributions || {}) : [...new Set([...item.muscles, ...item.secondaryMuscles].map((id) => muscleIds[id]).filter(Boolean))];
}

function guideState(item) {
  const description = String(state.data.runtimeDetails?.[item.wgerId]?.descriptions?.en || state.data.details[item.wgerId]?.descriptions?.en || '').trim();
  return !description ? 'missing' : description.length >= 100 ? 'complete' : 'short';
}

function populateFilterOptions() {
  const populate = (id, values, labels = {}) => {
    const select = $(`#filter-${id}`);
    const selected = state.filters[id];
    select.innerHTML = '<option value="all">Qualsiasi</option>' + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value)}</option>`).join('');
    select.value = values.includes(selected) ? selected : 'all';
    state.filters[id] = select.value;
  };
  populate('equipment', [...new Set(state.data.source.flatMap((item) => normalizedEquipment(item, state.data.effective[item.wgerId])))].sort());
  populate('muscle', state.data.options.muscles);
  populate('category', [...new Set(state.data.source.map((item) => item.category).filter(Boolean))].sort());
  populate('pattern', [...new Set(Object.values(state.data.effective).map((item) => item.pattern).filter(Boolean))].sort());
}

function renderList() {
  const query = state.query.toLocaleLowerCase();
  const items = state.data.source.filter((item) => {
    const effective = state.data.effective[item.wgerId];
    const details = state.data.details[item.wgerId] || {};
    const names = Object.values(item.translations || {}).join(' ');
    const matches = !query || `${item.name} ${names} ${item.wgerId} ${item.category}`.toLocaleLowerCase().includes(query);
    const status = state.filter === 'all' || (state.filter === 'approved' && approved(item.wgerId)) || (state.filter === 'unapproved' && !approved(item.wgerId)) || (state.filter === 'changed' && changed(item.wgerId));
    const language = state.filters.language === 'all' || Boolean(item.translations?.[state.filters.language]?.trim());
    const equipment = state.filters.equipment === 'all' || normalizedEquipment(item, effective).includes(state.filters.equipment);
    const muscle = state.filters.muscle === 'all' || normalizedMuscles(item, effective).includes(state.filters.muscle);
    const category = state.filters.category === 'all' || item.category === state.filters.category;
    const kind = state.filters.kind === 'all'
      || (state.filters.kind === 'unclassified' && !effective)
      || (state.filters.kind === 'compound' && effective?.compound === true)
      || (state.filters.kind === 'accessory' && effective?.compound === false);
    const pattern = state.filters.pattern === 'all' || effective?.pattern === state.filters.pattern;
    const image = state.filters.image === 'all'
      || (state.filters.image === 'with' && Boolean(details.image))
      || (state.filters.image === 'without' && !details.image)
      || (state.filters.image === 'local' && String(details.image || '').startsWith('/exercise-images/'))
      || (state.filters.image === 'remote' && /^https?:\/\//.test(String(details.image || '')));
    const guide = state.filters.guide === 'all' || guideState(item) === state.filters.guide;
    return matches && status && language && equipment && muscle && category && kind && pattern && image && guide;
  });
  $('#count').textContent = `${items.length} esercizi · ${Object.keys(state.data.effective).length} approvati`;
  $('#list').innerHTML = items.map((item) => {
    const localizedName = state.filters.language !== 'all' ? item.translations?.[state.filters.language] : null;
    const displayName = localizedName || item.name;
    const sourceName = localizedName && localizedName !== item.name ? ` · EN: ${item.name}` : '';
    return `<button data-id="${item.wgerId}" class="${state.selectedId === item.wgerId ? 'selected' : ''}"><span class="status ${approved(item.wgerId) ? 'ok' : ''}"></span><span><strong>${escapeHtml(displayName)}</strong><small>#${item.wgerId} · ${escapeHtml(item.category)}${escapeHtml(sourceName)}</small></span>${changed(item.wgerId) ? '<i>EDIT</i>' : ''}</button>`;
  }).join('');
  $('#list').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => select(Number(button.dataset.id))));
}

function inferred(item) {
  const primary = muscleIds[item.muscles[0]] || ({ Abs: 'core', Arms: 'biceps', Back: 'back', Calves: 'calves', Chest: 'chest', Legs: 'quads', Shoulders: 'shoulders' })[item.category] || 'chest';
  const equipment = [...new Set(item.equipment.map((name) => equipmentIds[name]).filter(Boolean))];
  const loadType = equipment.includes('dumbbells') ? 'per-dumbbell' : equipment.some((value) => ['barbell', 'ezbar', 'kettlebell', 'cables', 'machines'].includes(value)) ? 'external' : equipment.includes('bodyweight') ? 'bodyweight' : 'reps-only';
  return { pattern: '', primary, compound: false, muscleContributions: { [primary]: 1 }, equipment, loadType, loadMultiplier: loadType === 'per-dumbbell' ? 2 : 1, effortClass: 'isolation', intensifierEligible: true, selectionPriority: 10 };
}

function select(id) {
  state.selectedId = id;
  renderList();
  const item = state.data.source.find((candidate) => candidate.wgerId === id);
  const detail = state.data.details[id] || { descriptions: {} };
  const override = state.data.overrides.exercises[id] || {};
  const effective = structuredClone(state.data.effective[id] || inferred(item));
  const enabled = approved(id);
  const description = override.guide?.descriptionEn ?? detail.descriptions?.en ?? '';
  const image = override.guide?.image ?? detail.image ?? '';
  const attribution = override.guide?.imageAttribution ?? detail.imageAttribution ?? {};
  $('#editor').innerHTML = `<form>
    <div class="title"><div><span>WGER #${id} · ${escapeHtml(item.category)}</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.equipment.join(' · ') || 'Nessuna attrezzatura sorgente')}</p></div><label class="enable"><input name="enabled" type="checkbox" ${enabled ? 'checked' : ''}><span>Prescrivibile</span></label></div>
    <div class="grid">
      <label><span>Pattern di movimento</span><input name="pattern" required value="${escapeHtml(effective.pattern)}" placeholder="es. elbow-extension"></label>
      <label><span>Muscolo primario</span><select name="primary">${state.data.options.muscles.map((value) => `<option ${value === effective.primary ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label><span>Classe di fatica</span><select name="effortClass">${state.data.options.effortClasses.map((value) => `<option ${value === effective.effortClass ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label><span>Tipo di carico</span><select name="loadType">${state.data.options.loadTypes.map((value) => `<option ${value === effective.loadType ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label><span>Moltiplicatore carico</span><input name="loadMultiplier" type="number" min="0.1" step="0.1" value="${effective.loadMultiplier ?? 1}"></label>
      <label><span>Priorità selezione</span><input name="selectionPriority" type="number" min="0" max="30" value="${effective.selectionPriority ?? 10}"></label>
    </div>
    <div class="checks"><label><input name="compound" type="checkbox" ${effective.compound ? 'checked' : ''}> Multiarticolare</label><label><input name="intensifierEligible" type="checkbox" ${effective.intensifierEligible ? 'checked' : ''}> Intensificatori ammessi</label></div>
    <fieldset><legend>Attrezzatura compatibile</legend><div class="chips">${equipmentOptions.map((value) => `<label><input name="equipment" type="checkbox" value="${value}" ${effective.equipment?.includes(value) ? 'checked' : ''}><span>${value}</span></label>`).join('')}</div></fieldset>
    <fieldset><legend>Contributi muscolari <small>0–1 per serie</small></legend><div class="contributions">${state.data.options.muscles.map((muscle) => `<label><span>${muscle}</span><input name="muscle-${muscle}" type="number" min="0" max="1" step="0.05" value="${effective.muscleContributions?.[muscle] || ''}" placeholder="0"></label>`).join('')}</div></fieldset>
    <fieldset><legend>Guida offline</legend><label><span>Descrizione inglese (override opzionale)</span><textarea name="descriptionEn" rows="6">${escapeHtml(description)}</textarea></label><label><span>Immagine opzionale (URL Wger prima della sync, percorso /exercise-images dopo)</span><input name="image" value="${escapeHtml(image)}"></label>${image ? `<img src="${escapeHtml(image)}" alt="Anteprima">` : '<p class="warning">Immagine assente: l’esercizio resta utilizzabile e mostrerà la guida testuale.</p>'}<div class="grid attribution"><label><span>Autore immagine</span><input name="imageAuthor" value="${escapeHtml(attribution.author || '')}"></label><label><span>Nome licenza</span><input name="imageLicenseName" value="${escapeHtml(attribution.licenseName || '')}" placeholder="es. CC BY 4.0"></label><label><span>URL licenza</span><input name="imageLicenseUrl" type="url" value="${escapeHtml(attribution.licenseUrl || '')}"></label><label><span>Pagina fonte</span><input name="imageSourceUrl" type="url" value="${escapeHtml(attribution.sourceUrl || '')}"></label></div></fieldset>
    <div class="footer"><button type="button" id="revert" ${changed(id) ? '' : 'disabled'}>Rimuovi override</button><button class="primary" type="submit">Salva modifica</button></div>
  </form>`;
  $('form', $('#editor')).addEventListener('submit', saveCurrent);
  $('#revert').addEventListener('click', revertCurrent);
}

async function saveDocument() {
  await api('/api/overrides', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.data.overrides) });
  state.data = await api('/api/catalog');
  populateFilterOptions();
  renderList();
  select(state.selectedId);
}

async function saveCurrent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = String(state.selectedId);
  const enabled = form.has('enabled');
  const contributions = Object.fromEntries(state.data.options.muscles.map((muscle) => [muscle, Number(form.get(`muscle-${muscle}`))]).filter(([, value]) => value > 0));
  const entry = { enabled };
  if (enabled) entry.programming = {
    pattern: String(form.get('pattern')).trim(), primary: form.get('primary'), compound: form.has('compound'), muscleContributions: contributions,
    equipment: form.getAll('equipment'), loadType: form.get('loadType'), loadMultiplier: Number(form.get('loadMultiplier')),
    effortClass: form.get('effortClass'), intensifierEligible: form.has('intensifierEligible'), selectionPriority: Number(form.get('selectionPriority')),
  };
  const descriptionEn = String(form.get('descriptionEn')).trim();
  const image = String(form.get('image')).trim();
  const sourceGuide = state.data.details[id] || { descriptions: {} };
  const descriptionOverride = descriptionEn && descriptionEn !== String(sourceGuide.descriptions?.en || '').trim();
  const imageOverride = image && image !== String(sourceGuide.image || '').trim();
  if (descriptionOverride || imageOverride) entry.guide = { ...(descriptionOverride ? { descriptionEn } : {}), ...(imageOverride ? {
    image,
    imageAttribution: {
      author: String(form.get('imageAuthor')).trim(), licenseName: String(form.get('imageLicenseName')).trim(),
      licenseUrl: String(form.get('imageLicenseUrl')).trim(), sourceUrl: String(form.get('imageSourceUrl')).trim(),
    },
  } : {}) };
  state.data.overrides.exercises[id] = entry;
  try { await saveDocument(); flash('Modifica salvata. Esegui Sync + genera per materializzarla.'); } catch (error) { flash(error.message, true); }
}

async function revertCurrent() {
  delete state.data.overrides.exercises[state.selectedId];
  try { await saveDocument(); flash('Override rimosso.'); } catch (error) { flash(error.message, true); }
}

function flash(message, error = false) {
  let node = $('.toast');
  if (!node) { node = document.createElement('div'); node.className = 'toast'; document.body.append(node); }
  node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 3500);
}

async function action(name) {
  $('#console').classList.remove('hidden');
  $('#console pre').textContent = 'Avvio…';
  try {
    await api(`/api/action/${name}`, { method: 'POST' });
    const timer = setInterval(async () => {
      const result = await api('/api/action');
      $('#console pre').textContent = result.output || result.status;
      $('#console pre').scrollTop = $('#console pre').scrollHeight;
      if (['done', 'failed', 'idle'].includes(result.status)) { clearInterval(timer); state.data = await api('/api/catalog'); renderList(); if (state.selectedId) select(state.selectedId); }
    }, 700);
  } catch (error) { $('#console pre').textContent = error.message; }
}

async function init() {
  state.data = await api('/api/catalog');
  populateFilterOptions();
  renderList();
  $('#search').addEventListener('input', (event) => { state.query = event.target.value; renderList(); });
  $('.filters').addEventListener('click', (event) => { if (!event.target.dataset.filter) return; state.filter = event.target.dataset.filter; $('.filters .active')?.classList.remove('active'); event.target.classList.add('active'); renderList(); });
  document.querySelectorAll('.catalog-filter').forEach((select) => select.addEventListener('change', () => {
    state.filters[select.id.replace('filter-', '')] = select.value;
    renderList();
  }));
  $('#reset-filters').addEventListener('click', () => {
    state.query = '';
    $('#search').value = '';
    state.filter = 'all';
    $('.filters .active')?.classList.remove('active');
    $('.filters [data-filter="all"]').classList.add('active');
    Object.keys(state.filters).forEach((key) => { state.filters[key] = 'all'; $(`#filter-${key}`).value = 'all'; });
    renderList();
  });
  $('#build').addEventListener('click', () => action('curate'));
  $('#sync').addEventListener('click', () => action('sync'));
  $('#close-console').addEventListener('click', () => $('#console').classList.add('hidden'));
}

init().catch((error) => { $('#editor').innerHTML = `<div class="placeholder error">${escapeHtml(error.message)}</div>`; });
