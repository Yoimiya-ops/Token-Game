const { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CUSTOM_ASSETS_FILE = 'custom-pets.json';
const CUSTOM_ASSETS_DIR = 'custom-pets';
const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng']);

function getCustomAssetsPath(userDataPath) {
  return path.join(userDataPath, CUSTOM_ASSETS_FILE);
}

function getCustomAssetsDir(userDataPath) {
  return path.join(userDataPath, CUSTOM_ASSETS_DIR);
}

function normalizeLabel(label, fallback) {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  return trimmed || fallback || '自定义桌宠';
}

function normalizeAsset(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (typeof value.id !== 'string' || !value.id.startsWith('custom-')) {
    return undefined;
  }

  if (typeof value.src !== 'string' || value.src.length === 0) {
    return undefined;
  }

  return {
    id: value.id,
    label: normalizeLabel(value.label, '自定义桌宠'),
    kind: 'image',
    src: value.src,
    custom: true
  };
}

function listCustomPetAssets(userDataPath) {
  const assetsPath = getCustomAssetsPath(userDataPath);
  if (!existsSync(assetsPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(assetsPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalizeAsset).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomPetAssets(userDataPath, assets) {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(getCustomAssetsPath(userDataPath), JSON.stringify(assets.map(normalizeAsset).filter(Boolean), null, 2));
}

function toFileUrl(filePath) {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function filePathFromAssetSrc(src) {
  if (typeof src !== 'string' || !src.startsWith('file://')) {
    return undefined;
  }

  return decodeURIComponent(src.slice('file://'.length));
}

function importCustomPetAsset(userDataPath, sourcePath, label) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported pet image: ${extension || 'unknown'}`);
  }

  const id = `custom-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const assetsDir = getCustomAssetsDir(userDataPath);
  const destination = path.join(assetsDir, `${id}${extension}`);
  const fallbackLabel = path.basename(sourcePath, path.extname(sourcePath));
  const asset = {
    id,
    label: normalizeLabel(label, fallbackLabel),
    kind: 'image',
    src: toFileUrl(destination),
    custom: true
  };

  mkdirSync(assetsDir, { recursive: true });
  copyFileSync(sourcePath, destination);
  saveCustomPetAssets(userDataPath, [...listCustomPetAssets(userDataPath), asset]);
  return asset;
}

function renameCustomPetAsset(userDataPath, id, label) {
  const assets = listCustomPetAssets(userDataPath);
  const index = assets.findIndex((asset) => asset.id === id);
  if (index === -1) {
    return undefined;
  }

  assets[index] = {
    ...assets[index],
    label: normalizeLabel(label, assets[index].label)
  };
  saveCustomPetAssets(userDataPath, assets);
  return assets[index];
}

function deleteCustomPetAsset(userDataPath, id) {
  const assets = listCustomPetAssets(userDataPath);
  const index = assets.findIndex((asset) => asset.id === id);
  if (index === -1) {
    return undefined;
  }

  const [deleted] = assets.splice(index, 1);
  saveCustomPetAssets(userDataPath, assets);

  const assetPath = filePathFromAssetSrc(deleted.src);
  const assetsDir = getCustomAssetsDir(userDataPath);
  if (assetPath && path.resolve(assetPath).startsWith(`${path.resolve(assetsDir)}${path.sep}`)) {
    rmSync(assetPath, { force: true });
  }

  return deleted;
}

module.exports = {
  deleteCustomPetAsset,
  importCustomPetAsset,
  listCustomPetAssets,
  renameCustomPetAsset
};
