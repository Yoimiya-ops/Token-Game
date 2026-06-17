const defaultPetAssetId = 'default-cat';
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deleteCustomPetAsset, listCustomPetAssets } = require('./custom-pet-assets.cjs');

const DELETED_BUILT_IN_ASSETS_FILE = 'deleted-built-in-pets.json';
const RENAMED_BUILT_IN_ASSETS_FILE = 'renamed-built-in-pets.json';

const petAssets = [
  {
    id: defaultPetAssetId,
    label: '默认小猫',
    kind: 'image',
    src: './assets/processed/default-cat.webp'
  },
  {
    id: 'red-swords',
    label: '红衣双剑角色',
    kind: 'image',
    src: './assets/processed/red-swords.png'
  },
  {
    id: 'pink-sword',
    label: '粉发大剑角色',
    kind: 'image',
    src: './assets/processed/pink-sword.png'
  },
  {
    id: 'pink-white-dress',
    label: '粉发白裙角色',
    kind: 'image',
    src: './assets/processed/pink-white-dress.webp'
  }
];

function getDeletedBuiltInAssetIds(userDataPath) {
  if (!userDataPath) {
    return new Set();
  }

  const filePath = path.join(userDataPath, DELETED_BUILT_IN_ASSETS_FILE);
  if (!existsSync(filePath)) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDeletedBuiltInAssetIds(userDataPath, ids) {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(path.join(userDataPath, DELETED_BUILT_IN_ASSETS_FILE), JSON.stringify([...ids], null, 2));
}

function normalizeLabel(label, fallback) {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  return trimmed || fallback;
}

function getRenamedBuiltInAssetLabels(userDataPath) {
  if (!userDataPath) {
    return {};
  }

  const filePath = path.join(userDataPath, RENAMED_BUILT_IN_ASSETS_FILE);
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry) => typeof entry[0] === 'string' && typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function saveRenamedBuiltInAssetLabels(userDataPath, labels) {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(path.join(userDataPath, RENAMED_BUILT_IN_ASSETS_FILE), JSON.stringify(labels, null, 2));
}

function listPetAssets(userDataPath) {
  const deletedBuiltInAssetIds = getDeletedBuiltInAssetIds(userDataPath);
  const renamedBuiltInAssetLabels = getRenamedBuiltInAssetLabels(userDataPath);
  const builtInAssets = petAssets
    .filter((asset) => asset.id === defaultPetAssetId || !deletedBuiltInAssetIds.has(asset.id))
    .map((asset) => ({ ...asset, label: renamedBuiltInAssetLabels[asset.id] ?? asset.label }));
  return userDataPath ? [...builtInAssets, ...listCustomPetAssets(userDataPath)] : builtInAssets;
}

function getPetAssetById(id, userDataPath) {
  return listPetAssets(userDataPath).find((asset) => asset.id === id) ?? getPetAssetById(defaultPetAssetId);
}

function normalizePetAssetId(id, userDataPath) {
  if (typeof id === 'string' && id.startsWith('custom-') && userDataPath) {
    return listCustomPetAssets(userDataPath).some((asset) => asset.id === id) ? id : defaultPetAssetId;
  }

  return listPetAssets(userDataPath).some((asset) => asset.id === id) ? id : defaultPetAssetId;
}

function deletePetAsset(userDataPath, id) {
  if (!userDataPath || id === defaultPetAssetId) {
    return undefined;
  }

  if (typeof id === 'string' && id.startsWith('custom-')) {
    return deleteCustomPetAsset(userDataPath, id);
  }

  const asset = petAssets.find((candidate) => candidate.id === id);
  if (!asset) {
    return undefined;
  }

  const deletedBuiltInAssetIds = getDeletedBuiltInAssetIds(userDataPath);
  deletedBuiltInAssetIds.add(id);
  saveDeletedBuiltInAssetIds(userDataPath, deletedBuiltInAssetIds);
  return { ...asset };
}

function renamePetAsset(userDataPath, id, label) {
  if (!userDataPath) {
    return undefined;
  }

  if (typeof id === 'string' && id.startsWith('custom-')) {
    const { renameCustomPetAsset } = require('./custom-pet-assets.cjs');
    return renameCustomPetAsset(userDataPath, id, label);
  }

  const asset = petAssets.find((candidate) => candidate.id === id);
  if (!asset) {
    return undefined;
  }

  const nextLabel = normalizeLabel(label, asset.label);
  const renamedBuiltInAssetLabels = getRenamedBuiltInAssetLabels(userDataPath);
  renamedBuiltInAssetLabels[id] = nextLabel;
  saveRenamedBuiltInAssetLabels(userDataPath, renamedBuiltInAssetLabels);
  return { ...asset, label: nextLabel };
}

module.exports = {
  deletePetAsset,
  defaultPetAssetId,
  getPetAssetById,
  listPetAssets,
  normalizePetAssetId,
  renamePetAsset
};
