# 武器美术

使用内置 imagegen 生成，与现有青玉聚宝盆保持材质一致；没有沿用示例角色。

- 原始 3 列 × 5 行透明图集：`desktop/pet/assets/source/weapons.png`
- 运行时 15 张透明 WebP：`desktop/pet/assets/processed/weapons/w1-sword.webp` 至 `w5-spear.webp`
- 预处理：`scripts/process-weapon-assets.mjs`。按透明行间隙切图，裁去空白并归一为 192 × 224；保留 alpha，无创意性重绘。

生成提示词：

```text
Use case: stylized-concept
Asset type: transparent weapon inventory sprite atlas for a Chinese xianxia desktop game.
Make exactly FIFTEEN distinct weapons laid out in a strict, evenly spaced 3-column by 5-row grid. Every cell equal size, every weapon centered inside its own cell with at least 14 percent empty margin on all sides. Portrait canvas 1536x2560. Transparent background. No cell borders, no background, no text, no labels, no numbers, no characters, no hands. The entire weapon including handles and pommels must fit inside its cell. No overlaps.
Column 1: straight Chinese jian swords, point UP.
Column 2: curved Chinese dao sabers, point UP.
Column 3: long Chinese spears, point UP.
Top row: humble ordinary iron/steel weapons with brown leather wrapping, understated.
Second row: uncommon celadon jade fittings, jade green accents, slightly more refined.
Third row: rare silver and frost-blue crystal fittings, elegant magical blue accents.
Fourth row: epic purple amethyst and dark polished metal, ornate intricate but still readable.
Fifth bottom row: legendary luminous antique gold with white jade inlays and tiny red silk tassels, majestic.
Each row should be a visibly more extraordinary tier, not only a recolor. Premium painterly 3D game inventory art with believable metal, jade and crystal surfaces, matching a finely carved celadon jade treasure basin. Strong silhouette readable at 70 px. Sharp edges, no fuzzy aura outside weapon, no background glow, no floating orbs. Front view with slight dimensional shading. Entire 3x5 atlas, not a single weapon. Real alpha transparency.
```

界面图标来自本机已安装 Lucide 1.8.0 的原始图标节点。选用数据在 apps/web/src/lucide-icons.json，许可证在同目录 lucide-LICENSE，并随发行包分发。
