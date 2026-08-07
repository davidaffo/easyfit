import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'src/generated/wger-exercises.json');
const detailsPath = resolve(root, 'src/generated/wger-exercise-details.json');
const apiRoot = 'https://wger.de/api/v2/exerciseinfo/?language=2&limit=100';

function plainText(html = '') {
  return html
    .replace(/<li>/gi, '• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function translation(item, language) {
  return item.translations.find((entry) => entry.language === language && entry.name?.trim());
}

function normalize(item) {
  const english = translation(item, 2);
  const italian = translation(item, 13);
  if (!english) return null;

  return {
    core: {
      wgerId: item.id,
      name: english.name.trim(),
      translations: {
        en: english.name.trim(),
        ...(italian ? { it: italian.name.trim() } : {}),
      },
      category: item.category?.name || '',
      muscles: item.muscles.map(({ id }) => id),
      secondaryMuscles: item.muscles_secondary.map(({ id }) => id),
      equipment: item.equipment.map(({ name }) => name),
      variationGroup: item.variation_group,
      license: item.license ? {
        name: item.license.short_name,
        url: item.license.url,
        author: item.license_author || english.license_author || '',
      } : null,
    },
    details: {
      uuid: item.uuid,
      descriptions: {
        en: plainText(english.description),
        ...(italian ? { it: plainText(italian.description) } : {}),
      },
      image: item.images.find((image) => image.is_main)?.image || item.images[0]?.image || null,
      sourceUpdatedAt: item.last_update_global,
    },
  };
}

async function fetchPage(url, attempt = 1) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Easyfit exercise sync' } });
  if (!response.ok) {
    if (attempt < 4) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1000));
      return fetchPage(url, attempt + 1);
    }
    throw new Error(`wger returned ${response.status} for ${url}`);
  }
  return response.json();
}

const records = [];
let next = apiRoot;

while (next) {
  const page = await fetchPage(next);
  records.push(...page.results);
  next = page.next;
  process.stdout.write(`\rDownloaded ${records.length}/${page.count} exercises`);
}

const normalized = records.map(normalize).filter(Boolean).sort((a, b) => a.core.name.localeCompare(b.core.name));
const exercises = normalized.map((item) => item.core);
const payload = {
  source: 'wger',
  sourceUrl: 'https://wger.de',
  language: 'en',
  syncedAt: new Date().toISOString(),
  count: exercises.length,
  exercises,
};
const details = {
  source: 'wger',
  syncedAt: payload.syncedAt,
  exercises: Object.fromEntries(normalized.map((item) => [item.core.wgerId, item.details])),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(detailsPath, `${JSON.stringify(details, null, 2)}\n`);
process.stdout.write(`\nSaved ${exercises.length} English exercises and lazy details to src/generated\n`);
