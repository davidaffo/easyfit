import { execFile } from 'node:child_process';
import { access, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { curatedExercises, curatedGuideImageOverrides } from './curated-exercises.mjs';

const run = promisify(execFile);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'src/generated/wger-exercises.json');
const detailsPath = resolve(root, 'src/generated/wger-exercise-details.json');
const imagesDirectory = resolve(root, 'public/exercise-images');
const imagesIndexPath = resolve(imagesDirectory, 'index.json');
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

async function fetchImage(url, attempt = 1) {
  const response = await fetch(url, { headers: { Accept: 'image/*', 'User-Agent': 'Easyfit exercise sync' } });
  if (!response.ok) {
    if (attempt < 4) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1000));
      return fetchImage(url, attempt + 1);
    }
    throw new Error(`wger returned ${response.status} for image ${url}`);
  }
  return response.arrayBuffer();
}

function imageExtension(url) {
  const match = new URL(url).pathname.match(/\.(png|jpe?g|webp|gif)$/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'webp';
}

async function localizeImage(item) {
  if (!item.details.image) return null;
  const extension = imageExtension(item.details.image);
  const sourceFilename = `${item.core.wgerId}.source.${extension}`;
  const sourcePath = resolve(imagesDirectory, sourceFilename);
  let filename = `${item.core.wgerId}.webp`;
  let outputPath = resolve(imagesDirectory, filename);
  const bytes = await fetchImage(item.details.image);
  await writeFile(sourcePath, Buffer.from(bytes));
  try {
    await run('magick', [sourcePath, '-auto-orient', '-resize', '900x700>', '-strip', '-quality', '78', outputPath]);
  } catch {
    filename = `${item.core.wgerId}.${extension}`;
    outputPath = resolve(imagesDirectory, filename);
    await writeFile(outputPath, Buffer.from(bytes));
  } finally {
    await unlink(sourcePath).catch(() => {});
  }
  item.details.image = `/exercise-images/${filename}`;
  return item.details.image;
}

async function clearGeneratedImages(keepPublicPaths) {
  const keep = new Set(keepPublicPaths.map((path) => path.split('/').at(-1)));
  const filenames = await readdir(imagesDirectory);
  await Promise.all(filenames.filter((filename) => filename !== 'index.json' && !keep.has(filename)).map((filename) => unlink(resolve(imagesDirectory, filename))));
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
await mkdir(imagesDirectory, { recursive: true });
const curatedLocalImages = Object.values(curatedGuideImageOverrides);
await Promise.all(curatedLocalImages.map((publicPath) => access(resolve(imagesDirectory, publicPath.split('/').at(-1)))));
const approvedIds = new Set(Object.keys(curatedExercises).map(Number));
const imageItems = normalized.filter((item) => approvedIds.has(item.core.wgerId) && item.details.image);
const localImages = [...curatedLocalImages];
for (let index = 0; index < imageItems.length; index += 4) {
  const downloaded = await Promise.all(imageItems.slice(index, index + 4).map(localizeImage));
  localImages.push(...downloaded.filter(Boolean));
  process.stdout.write(`\rDownloaded ${records.length} exercises · ${Math.min(index + 4, imageItems.length)}/${imageItems.length} optimized images`);
}
await clearGeneratedImages(localImages);

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
const indexedImages = [...new Set(localImages)].sort();
await writeFile(imagesIndexPath, `${JSON.stringify(indexedImages, null, 2)}\n`);
process.stdout.write(`\nSaved ${exercises.length} English exercises, details and ${indexedImages.length} local images\n`);
