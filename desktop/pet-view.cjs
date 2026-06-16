function resolvePetViewState(asset) {
  if (asset?.kind === 'image') {
    return {
      bodyKind: 'image',
      activeAssetId: asset.id,
      imageSrc: asset.src
    };
  }

  return {
    bodyKind: 'css',
    activeAssetId: asset?.id ?? 'default-cat',
    imageSrc: ''
  };
}

module.exports = {
  resolvePetViewState
};
