# 草原与通关奖励角色素材

使用内置 Image Gen 生成，所有发布图片保留原图尺寸及 RGBA 透明通道。透明区域按实际 alpha 检查；不把棋盘格或背景渐变当作透明图使用。带有背景的候选图没有复制进游戏。

| 发布文件 | 原始输出文件 | 尺寸 | 文件大小 |
|---|---|---|---:|
| `subpackages/pkg_assets/images/grassland-atlas.png` | `exec-155365ca-d3b3-4c97-bd7e-352535a758dd.png` | 1254 × 1254 | 2,054,319 字节 |
| `subpackages/pkg_assets/images/character_tidecaller.png` | `exec-31b2f305-e483-43d4-837a-6234ffa0b49b.png` | 1199 × 1312 | 1,432,184 字节 |
| `subpackages/pkg_assets/images/character_windrunner.png` | `exec-9b3a48f1-30a0-46a6-9d56-04f50ce072a3.png` | 1254 × 1254 | 1,453,321 字节 |

原始输出目录：`C:/Users/joeys/.codex/generated_images/01a07e13-44bd-7442-81c8-4b02a2e7e425/`。游戏通过实测裁切矩形引用草原图集前八个区域；第九个机体草图未使用，逐风者使用独立图片以保留完整机头与翼尖。

## 草原图集提示词

> A transparent-background game sprite sheet of NINE distinct fantasy grassland creatures and one spacecraft as the ninth item, top-down view for a polished 2D mobile vertical shooter. Square canvas with THREE columns by THREE rows, each subject fully separated with empty transparent padding. Hand-painted detailed fantasy videogame cutout sprites, sharp silhouettes, dark outlines, gold/emerald/ivory/lime palette, cohesive with richly illustrated ocean monster sprites. All eight enemies face DOWN toward bottom of canvas, viewed from above. Row1 left meadow hare: moss-green rabbit with long golden ear blades, crouching hind legs and white fluffy tail; middle blade mantis: bright leaf-green praying mantis with two distinctive large curved scythe forearms and delicate insect legs; right lantern beetle: jade armored beetle with six legs, thick split wingcase and a warm amber glowing abdomen. Row2 left thorn bloom: rooted carnivorous prairie flower, dusty rose petals, thorny curling vines and central amber seedpod; middle gale falcon: tawny ivory hawk with broad spread wings, dark striped feather tips and teal wind plumage; right thunder bison: bulky shaggy forest-brown buffalo with large swept golden horns, four hooves and a teal glowing forehead. Row3 left BOSS antler king phase1: majestic white and moss-green stag viewed top down, four visible articulated legs, magnificent branching golden antlers spreading sideways, emerald shoulder armor, green leaf mane, a cyan chest gem; middle SAME stag phase2: same silhouette and anatomy with amber-gold fiery leaf mane, bright amber cracked chest gem and glowing golden antlers. Row3 right PLAYER spacecraft faces UP: sleek ivory and teal aircraft with elegant leaf-shaped swept wings, two gold wind turbines, narrow arrowhead nose, compact turquoise engine exhaust, clean top-down sci-fi mechanical craft, no pilot. Large size for all subjects with 10 percent transparent padding in each cell. Only the nine isolated sprites. Transparent background, no scenery, no text, no labels.

## 潮汐使提示词

> One isolated player spaceship game sprite on a transparent background. Top-down orthographic view facing UP for a premium hand-painted 2D mobile vertical shooter. Ocean themed Tidecaller craft: elegant manta-ray silhouette, two broad curved turquoise hydrofoil wings swept backward, ivory scallop shell armor overlapping on the central fuselage, gold coral fin details, one large luminous pale-blue pearl reactor, narrow aquamarine arrowhead nose at the TOP, two compact blue water-jet engines at the BOTTOM. Distinct sci-fi mechanical spaceship with biological ocean-inspired armor, not a real fish. Intricate but clear polished illustrated game asset, dark crisp outlines, readable turquoise ivory and warm gold color blocks, pleasing proportions, fully symmetrical left and right. Isolated cutout craft alone, full silhouette visible centered with 12 percent empty transparent padding, transparent background, no environment, no water surface, no shadow, no text.

## 逐风者提示词

> Transparent background. Square game SPRITE PNG, isolated cutout only, actual alpha transparency around the object. One top-down PLAYER aircraft facing UP, center on a square canvas: ivory and jade Windrunner spacecraft with broad leaf-shaped emerald wings, two circular gold turbine fans, pointed white nose and short attached turquoise twin exhaust flames. Fully separated silhouette, no ambient background color, no glowing atmosphere. Painted 2D fantasy sci-fi videogame sprite with crisp dark outline, polished detailed metal and leaf-inspired armor. Broad compact fighter shape, wings spread almost as wide as craft height, natural detailed curves. Generous blank transparent margin around all edges. Entire aircraft fully visible. A technical game sprite cutout on transparent background. Nothing except the single aircraft.

## 绘制约束

敌人、Boss 和角色均保留不依赖图片的 Canvas 造型。关闭贴图时不创建图片；贴图尚未加载时也能用代码造型完成战斗。鹿王两阶段有独立贴图，鹿角、身体和蹄部摆动由绘制层实现，不改变伤害判定。场地引导使用留白、细线和运动，避免在战斗中叠加“安全缺口”等说明文字。
