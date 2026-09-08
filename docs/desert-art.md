# 沙漠敌人美术更新

沙漠保留原有五种普通敌人、沙蠕精英和旱魃 Boss 的行为与碰撞范围，提供两套外观。

- **关闭贴图**：`src/desertVisuals.js` 通过 Canvas 路径绘制翅膀、甲壳、分节身体、腿爪、炮口和沙虫口器，不加载或绘制精灵图集。
- **开启贴图**：使用透明 PNG 图集；图片加载期间使用同一套 Canvas 外观。潜沙和露出阶段有独立图像，预警仍由代码绘制。
- 设置沿用菜单「贴图」开关，默认关闭。旧存档与战斗数值保留。

## 图集

文件：`subpackages/pkg_assets/images/desert-enemies-atlas.png`，1254 × 1254，RGBA，2,417,277 字节。由内置 imagegen 生成，未使用 API/CLI 回退。保留原始透明度；源矩形以实际 alpha 连通区域的边界登记，避免依赖生成图不完全均匀的网格。

图集内依次包含沙蜂、掠沙者、沙丘龟、响尾炮、掘地者、沙蠕、旱魃，以及掘地者／沙蠕的潜沙状态。

## 生成提示词

Create ONE production-ready transparent sprite atlas PNG for a Chinese top-down mobile roguelike shooter, replacing crude geometric desert enemies with beautifully painted detailed game creatures. This is a single technical asset: a square 1536x1536 atlas, EXACTLY 3 columns x 3 rows equal 512x512 cells, no visible grid, no lettering, no labels, NO shadows outside sprites, genuinely transparent RGBA background, no checkerboard baked in. Each creature centered exactly in its cell with 48px transparent padding from every cell edge, entirely contained in that cell, all facing DOWN toward bottom of page, consistent straight overhead camera. Art style high quality hand-painted 2D stylized game sprites, readable dark ink outlines, sculpted chitin, bone armor, jewel glints and mechanical details, NOT geometric icons, NOT simple polygons, NOT cute emoji, NOT realistic photography. Desert hostile creature palette bone ivory, oxidized teal, dark plum and burnt vermilion, strong contrast against brown sand. Row1 col1: sand wasp, six articulated legs, four translucent wings, segmented dark armored abdomen and acid lime eyes; row1 col2: fast sand skimmer, elongated six-legged desert lizard/raptor with crimson membranous fins and tapered tail; row1 col3: dune tortoise, bulky dark slate-blue spiked shell with ivory scutes and orange cracks, four clawed feet and small horned head. Row2 col1: rattlesnake artillery, coiled armored viper with ivory segmented rattle and integrated twin cannon fangs pointed down; row2 col2: burrowing beetle, compact ivory plated digging creature, serrated shovel forelimbs, dark maroon underbody and teal jewel abdomen; row2 col3: elite sandworm emerging, enormous ringed open maw with many ivory teeth, dark teal segmented armored body curled behind the head, copper spikes. Row3 col1: desert boss Hanba drought demon, imposing front-down overhead hunched undead skeletal beast with broad bone antler crown, weathered stone armor, crimson cracked heart and two vast claw arms, strong readable silhouette; row3 col2: SAME burrowing beetle as row2 col2 but partially buried, body hidden except ivory digging horns and a few sand grains, transparent surround; row3 col3: SAME elite sandworm as row2 col3, mouth closed and body coiled resting, transparent surround. Creature anatomy and intricate painterly shading should read beautifully at 64-160 pixels display size. Fill roughly 80% of each cell with the character, keep strict regular aligned cell centers. Absolutely no environment, terrain disk, text, watermark, frame, cell divider or background color.

生成尺寸与提示指定尺寸不同，因此渲染读取实际图片尺寸与已核验的裁切区域。

## 本地查看

运行 `node tools/preview.js`，打开 `http://127.0.0.1:4178/?map=desert&mode=gallery`。切换贴图开关，可比较代码绘制与精灵图集。试玩页使用独立浏览器存档，不改变微信存档。
