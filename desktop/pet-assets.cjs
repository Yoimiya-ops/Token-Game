const defaultPetAssetId = 'default-cat';

const petAssets = [
  {
    id: defaultPetAssetId,
    label: '默认小猫',
    kind: 'css'
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
  }
];

function listPetAssets() {
  return petAssets.map((asset) => ({ ...asset }));
}

function getPetAssetById(id) {
  return listPetAssets().find((asset) => asset.id === id) ?? getPetAssetById(defaultPetAssetId);
}

function normalizePetAssetId(id) {
  return listPetAssets().some((asset) => asset.id === id) ? id : defaultPetAssetId;
}

module.exports = {
  defaultPetAssetId,
  getPetAssetById,
  listPetAssets,
  normalizePetAssetId
};
