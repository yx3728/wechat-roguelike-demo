# 战斗贴图覆盖清单

本清单以 `src/characters.js`、`src/enemies.js` 的注册表为准：10 个可选角色，20 种普通敌人、4 种精英和 7 个 Boss 形态，共 31 个注册敌人条目；另包含虚空召唤的镜像。开壳、潜沙和利维坦二阶段属于同一敌人的视觉状态，不重复计数。

## 角色与战机

菜单图标、战机图鉴和实战使用 `src/characterVisuals.js` 的同一映射。新战机均为机头朝上的俯视图。永雏塔菲沿用已有角色立绘。

| 角色 id | 名称 | 素材 | 视觉识别点 |
|---|---|---|---|
| `striker` | 破袭者 | `character_striker.png`，复用 | 青蓝色均衡战机 |
| `gunner` | 重炮手 | `characters-atlas.png`，第 1 块 | 橙色重型炮架、长主炮 |
| `scout` | 侦察兵 | 同上，第 2 块 | 紫色轻型机身、三炮口 |
| `warden` | 守望者 | 同上，第 3 块 | 绿色护盾翼、厚装甲 |
| `mechanic` | 机械师 | 同上，第 4 块 | 黄铜机体、工程机械臂、双圆形挂架 |
| `vampire` | 吸血鬼 | 同上，第 5 块 | 暗红蝠翼、红色吸血核心 |
| `taffy` | 永雏塔菲 | `character_taffy.png`，复用 | 已有粉色角色立绘 |
| `prism` | 棱镜 | `characters-atlas.png`，第 6 块 | 白金机身、虹彩水晶翼 |

| `windrunner` | 逐风者 | `character_windrunner.png` | 叶翼与双风轮，通关草原解锁 |
| `tidecaller` | 潮汐使 | `character_tidecaller.png` | 鳐翼、贝甲与珍珠核心，通关海洋解锁 |

所有文件位于 `subpackages/pkg_assets/images/`。现有卫星也继续复用：普通／机械师卫星为 `satellite_orbital.png`，吸血鬼卫星为 `satellite_vampire.png`。

## 敌人覆盖

`src/desertVisuals.js` 负责沙漠；`src/enemyTextures.js` 负责星空、海洋以及已有普通／精英敌机贴图。表内图块编号从 1 开始，是素材映射顺序，不要求图片按等分网格裁切。

| 地图 / 类别 | 注册 id | 贴图来源 |
|---|---|---|
| 星空普通 | `grunt` | `enemy_grunt.png`，复用 |
| 星空普通 | `swift` | `starfield-enemies-atlas.png`，第 1 块 |
| 星空普通 | `tank` | 同上，第 2 块 |
| 星空普通 | `shooter` | 同上，第 3 块 |
| 星空普通 | `weaver` | 同上，第 4 块 |
| 星空精英 | `elite` | `enemy_elite.png`，复用 |
| 星空 Boss | `crimson` | `starfield-enemies-atlas.png`，第 5 块 |
| 星空 Boss | `azure` | 同上，第 6 块 |
| 星空 Boss | `void` | 同上，第 7 块 |
| 星空 Boss 形态 | `voidCore` | 同上，第 8 块；保留核心入场缩放 |
| 沙漠普通 | `sandmite` | `desert-enemies-atlas.png`，第 1 块 |
| 沙漠普通 | `skimmer` | 同上，第 2 块 |
| 沙漠普通 | `dunecrawler` | 同上，第 3 块 |
| 沙漠普通 | `rattler` | 同上，第 4 块 |
| 沙漠普通 | `burrower` | 同上，第 5 块；潜沙使用第 8 块 |
| 沙漠精英 | `sandworm` | 同上，第 6 块；潜沙／破土预警使用第 9 块 |
| 沙漠 Boss | `hanba` | 同上，第 7 块 |
| 海洋普通 | `reefRay` | `ocean-enemies-atlas.png`，第 1 块 |
| 海洋普通 | `needlefish` | 同上，第 2 块 |
| 海洋普通 | `jellyfish` | 同上，第 3 块 |
| 海洋普通 | `armoredCrab` | 同上，第 4 块；开壳使用第 9 块 |
| 海洋普通 | `inkCuttlefish` | 同上，第 5 块 |
| 海洋精英 | `abyssalAngler` | 同上，第 6 块 |
| 海洋 Boss | `leviathan` | 同上，第 7 块；二阶段使用第 8 块 |
| 虚空召唤物，额外条目 | `mirror` / `isMirror` | `starfield-enemies-atlas.png`，第 9 块；保留入场淡入及本体警告 |

| 草原普通 | `meadowHare` / `bladeMantis` / `lanternBeetle` / `thornBloom` / `galeFalcon` | `grassland-atlas.png` 第 1–5 块 |
| 草原精英 | `thunderBison` | 同上第 6 块 |
| 草原 Boss | `antlerKing` | 同上第 7 块，二阶段第 8 块 |

草原图集和两架通关奖励战机的来源与完整提示词见 [grassland-art.md](grassland-art.md)。草原使用 `src/grasslandTextures.js` 适配器。深渊灯鮟的贴图与代码造型都具有独立摆尾，头部／灯饵稳定，且没有场地预警标记。

镜像并非 `ENEMY_POOLS` 中的普通刷怪条目，按 `isMirror` 或 `type === "mirror"` 识别。虚空核心同时支持 `isVoidCore` 和 `bossVariant === "voidCore"`。

## 本轮新增图集与生成规格

| 文件 | 最终尺寸 | 文件字节数 | 内容 |
|---|---|---:|---|
| `subpackages/pkg_assets/images/characters-atlas.png` | 1254 × 1254，RGBA | 1,876,101 | 六架缺失的角色战机 |
| `subpackages/pkg_assets/images/ocean-enemies-atlas.png` | 1254 × 1254，RGBA | 2,032,242 | 六种海洋敌人、利维坦两阶段、堡礁蟹开壳 |
| `subpackages/pkg_assets/images/starfield-enemies-atlas.png` | 1254 × 1254，RGBA | 1,963,623 | 四种普通敌人、红／蓝／虚空 Boss、虚空核心、镜像 |

沙漠图集已经在前一轮美术更新中生成，本轮继续复用。其完整生成提示词与说明见 [desert-art.md](desert-art.md)。三个新增图集由内置 imagegen 生成；以下记录的是可复用的提示规格摘要，不是服务调用的逐字日志。

**角色图集提示规格**

Create one square transparent RGBA sprite atlas with exactly three columns and two rows of six isolated top-down player spaceships, all facing UP. Use detailed painted 2D game art, readable outlines, distinct silhouettes, generous transparent separation, and no labels, environment, grid, checkerboard, background color or watermark. In reading order: orange heavy gunner with a long central cannon; purple lightweight scout with three guns; green armored warden with shield wings; brass mechanic with articulated engineering arms and twin circular mounts; dark red vampire with bat wings and a blood-red core; white-and-gold prism craft with rainbow crystal wings. Keep every craft, engine flame and wing inside its own area. The surrounding pixels must have real alpha transparency.

**海洋图集提示规格**

Create one transparent RGBA 3-by-3 atlas of detailed top-down hostile sea creatures for a mobile roguelike shooter. No background, labels, cell dividers or baked checkerboard. Dark blue and teal anatomy with warm coral, ivory and amber danger accents; readable silhouettes at small sizes. Reading order: reef ray, slender needlefish, pulse jellyfish, closed armored crab, ink cuttlefish, abyssal angler elite, armored Leviathan phase one, split-armor Leviathan phase two with exposed glowing core, and the same crab with its shell open. Preserve visual identity between alternate forms and leave transparent padding around fins, tentacles and claws.

**星空图集提示规格**

Create one transparent RGBA 3-by-3 atlas of distinct hostile spacecraft and cosmic bosses for a top-down mobile shooter. Use painted 2D game sprites with mechanical detail, strong silhouettes and clear cores; no scenery, lettering, frame or checkerboard. Reading order: fast interceptor swift, heavy armored tank, gunship shooter, serpentine weaver, crimson boss, azure boss, purple Void boss, detached Void core and a spectral Void mirror. Keep all pieces isolated with transparent separation and preserve the shared visual family of Void, its core and its mirror.

## 裁切与尺寸规则

- 裁切来自最终 PNG 的实际透明边界，不根据提示词中的目标分辨率直接计算。生成服务给出的网格间距可能不均匀。
- 角色参考尺寸为 1254 × 1254；六个 `[x0, y0, x1, y1]` 裁切框依次为 `[12,11,423,617]`、`[448,53,809,615]`、`[835,28,1239,616]`、`[6,635,430,1245]`、`[427,631,832,1216]`、`[817,615,1254,1246]`。保存到 `characterVisuals.js` 的 `ATLAS_CROPS`。
- 海洋和星空边界登记在 `enemyTextures.js` 的 `ATLAS_LAYOUTS`，以图片宽高的比例存储；沙漠使用 `desertVisuals.js` 的 `SOURCE_BOUNDS`。
- 更换原图后必须重新测量 alpha 边界，检查翼尖、尾焰、口器是否完整，且裁切框不含相邻角色。不能仅更改文件名而沿用旧框。
- 所有新图集等比绘制，菜单／图鉴在指定矩形内居中；角色实战按适配器的视觉倍率居中。缩放、呼吸与侧倾不改 `x/y/w/h`、碰撞、射击原点或移动规则。
- 棋盘格如果已经写进像素就不是透明图片，应更换合格输出。角色最终图集已确认包含真实 alpha=0 像素，而非纯色背景或棋盘图案。

## 加载、开关与回退

`drawCharacterTexture(ctx, id, x, y, w, h, enabled, variant)` 仅在 `enabled === true` 时请求或绘制素材。默认、`menu`、`gallery` 模式在给定矩形内等比适配；`battle` 模式把矩形视为玩家碰撞盒，使用破袭者 2.8、永雏塔菲 2.35、其余战机 1.9 的视觉倍率。

同一角色素材在菜单和战斗间共享图片缓存，六架新战机只请求一张图集。敌人适配器也按素材共享缓存。正在加载时不重复请求；失败后有延迟重试，最多尝试三次。未知 id、未加载或失败的贴图返回 `false`，调用者继续绘制代码外观。

关闭贴图后，角色和敌人的适配器不创建 `wx.Image`、不设置新的图片地址，也不调用 `drawImage`；已加载资源可保留在缓存中，供再次开启时复用。沙漠继续使用有翅膀、甲壳、腿爪、炮口和口器的新 Canvas 生物造型，海洋使用现有 Canvas 海洋生物造型，其他角色／星空敌人使用游戏的代码外观。

`battle.js` 在真正需要绘制卫星、且贴图已开启时才调用 `ensureSatelliteTextures()`。卫星图片在当前战斗场景中缓存；失败时保留原有圆形卫星外观。其加载逻辑独立于带三次重试的图集缓存。

无敌光环、护盾、沙暴淡化、激光瞄准、潜沙预警和海洋场地预警仍由代码绘制。贴图切换不会删除这些战斗提示。

## 集成检查与验证

`menu.js` 的全部角色图标统一调用 `drawCharacterTexture(..., save.battleTexturesOn === true, "menu")`；`battle.js` 的全部玩家机体统一调用该适配器的 `battle` 模式。旧的永雏塔菲无条件绘制分支和场景创建时的角色图片预加载已经移除。

敌人绘制顺序是沙漠完整渲染器、通用敌人贴图适配器、海洋代码渲染器，再到原有星空代码回退；各分支仍使用共享血条和碰撞规则。

运行覆盖测试：

```sh
node --test tests/*.test.js
```

本轮完整运行 77 项测试，全部通过；其中 `texture-coverage.test.js` 的 6 项覆盖测试从真实注册表生成 10 个角色、31 个敌人条目及镜像，检查菜单／战斗／图鉴素材、替代形态、源矩形边界、开关后即时切换，以及机械师／吸血鬼卫星。十架战机的浏览器图鉴已检查；微信端加载、触控和帧率仍需在微信开发者工具与真机上验证。

本地预览运行 `node tools/preview.js`，在 `http://127.0.0.1:4178/` 选择四张地图的生物图鉴或十架战机图鉴，并切换贴图开关比较同一渲染路径。
