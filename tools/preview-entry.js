const canvas = document.getElementById("game");
const W = 390;
const H = 844;
const ctx = canvas.getContext("2d");
const storagePrefix = "ocean-preview:";
window.wx = {
  getWindowInfo: () => ({ windowWidth: W, windowHeight: H, pixelRatio: 1 }),
  getSystemInfoSync: () => ({ windowWidth: W, windowHeight: H, pixelRatio: 1 }),
  getStorageSync(key) { try { return JSON.parse(localStorage.getItem(storagePrefix + key)); } catch { return null; } },
  setStorageSync(key, value) { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); },
  createImage: () => new Image(),
  showModal(o) { const content = o.editable ? prompt(o.title, "") : ""; o.success({ confirm: o.editable ? content !== null : confirm(o.content || o.title), content }); },
};
const { createBattleScene } = require("../src/battle.js");
const { createMenuScene } = require("../src/menu.js");
const { CHARACTERS, isCharacterUnlocked } = require("../src/characters.js");
const { getMapById } = require("../src/maps.js");
const enemies = require("../src/enemies.js");
const { createEliteFor, createBoss } = enemies;
const { drawOceanBackground, drawOceanEnemy } = require("../src/oceanVisuals.js");
const { drawDesertEnemyVisual } = require("../src/desertVisuals.js");
const { drawEnemyTexture } = require("../src/enemyTextures.js");
const { drawCharacterTexture } = require("../src/characterVisuals.js");
const { drawGrasslandBackground, drawGrasslandEnemy } = require("../src/grasslandVisuals.js");
const { drawGrasslandTexture } = require("../src/grasslandTextures.js");
const storage = require("../src/storage.js");

// Only this browser preview uses the prefixed localStorage mock above.
storage.unlockMap("desert");
const MAP_PREVIEWS = {
  ocean: {
    name: "海洋", title: "海洋 · 归墟远征", galleryTitle: "归墟生物图鉴",
    description: "从珊瑚浅海驶入无光海沟。\n追随潮汐，迎战归墟之主。",
    tip: "涨潮横推机体，拾取经验 +20%", boss: "leviathan", bossName: "归墟 · 利维坦",
    bossDesc: "双阶段 Boss · 潮门 / 猎潮 / 破渊",
    upgrades: ["ocean_rapid", "ocean_stable_fin", "ocean_coral", "ocean_hunter", "ocean_ebb_mend", "ocean_heart", "dmg_s"],
    gallery: [
      ["reefRay", "礁翼鳐", "摆动下潜", enemies.createReefRay],
      ["needlefish", "刺潮针鱼", "蓄力冲刺", enemies.createNeedlefish],
      ["jellyfish", "脉冲水母", "环形散射", enemies.createJellyfish],
      ["armoredCrab", "堡礁蟹", "甲壳开合", enemies.createArmoredCrab],
      ["inkCuttlefish", "墨潮乌贼", "瞄准齐射", enemies.createInkCuttlefish],
      ["abyssalAngler", "深渊灯鮟", "精英 · 诱饵弹幕", (level) => createEliteFor("abyssalAngler", level)],
    ],
  },
  desert: {
    name: "沙漠", title: "沙漠 · 黄沙异兽", galleryTitle: "黄沙异兽图鉴",
    description: "沙蜂掠过，沙蠕破土。\n穿越暮色沙海，迎战旱魃。",
    tip: "沙暴降低视野，沙漠敌群各有独立造型", boss: "hanba", bossName: "旱魃",
    bossDesc: "沙漠 Boss · 风沙召唤 / 裂地突袭",
    upgrades: ["dust_headwind", "dust_mirage", "dust_erosion", "dust_quickbind", "dust_stormeye", "dmg_s", "shield_basic"],
    gallery: [
      ["sandmite", "沙蜂", "编队掠袭", enemies.createSandmite],
      ["skimmer", "掠沙者", "低空疾掠", enemies.createSkimmer],
      ["dunecrawler", "沙丘龟", "重甲爆散", enemies.createDunecrawler],
      ["rattler", "响尾炮", "横排弹墙", enemies.createRattler],
      ["burrower", "掘地者", "潜沙突袭", enemies.createBurrower],
      ["sandworm", "沙蠕", "精英 · 破土喷射", (level) => createEliteFor("sandworm", level)],
    ],
  },
  starfield: {
    name: "星空", title: "星空 · 深空机群", galleryTitle: "深空敌机图鉴",
    description: "穿过星云与机械机群。\n迎战红蓝主舰，追踪虚空之核。",
    tip: "满血击败红蓝主舰后，进入隐藏虚空战", boss: "crimson", bossName: "星空 Boss",
    bossDesc: "红 / 蓝 / 虚空 / 虚空二阶段",
    upgrades: ["fr_basic", "dmg_s", "ms_split_s", "shield_basic", "boss_hunter", "sat_orbit", "hp_plate"],
    gallery: [
      ["grunt", "普通敌机", "直线突击", enemies.createGrunt],
      ["swift", "速攻敌机", "高速突破", enemies.createSwift],
      ["tank", "重装敌机", "重甲推进", enemies.createTank],
      ["shooter", "射手敌机", "悬停炮击", enemies.createShooter],
      ["weaver", "蛇形敌机", "横向摆动", enemies.createWeaver],
      ["elite", "精英敌机", "三路弹幕", (level) => createEliteFor("elite", level)],
    ],
  },
};

MAP_PREVIEWS.grassland = {
  name: "草原", title: "草原 · 苍岚草海", galleryTitle: "苍岚生物图鉴",
  description: "顺着草浪，追寻风的方向。\n穿过金穗原野，迎战苍岚鹿王。",
  tip: "侧风交替推动机体，起风时经验 +15%", boss: "antlerKing", bossName: "苍岚鹿王",
  bossDesc: "双阶段 Boss · 鹿角扇流 / 草印脉冲 / 风廊",
  upgrades: ["grass_tailwind", "grass_seed", "grass_roots", "grass_hunter", "grass_gale", "grass_bloom", "dmg_s"],
  gallery: [
    ["meadowHare", "疾草兔", "弧线跳跃", enemies.createMeadowHare],
    ["bladeMantis", "镰叶螳螂", "锁定冲锋", enemies.createBladeMantis],
    ["lanternBeetle", "荧甲虫", "甲壳脉冲", enemies.createLanternBeetle],
    ["thornBloom", "荆棘花", "种子扇流", enemies.createThornBloom],
    ["galeFalcon", "掠风隼", "曲线横掠", enemies.createGaleFalcon],
    ["thunderBison", "雷角野牛", "精英 · 蓄力冲刺", (level) => createEliteFor("thunderBison", level)],
  ],
};

const params = new URLSearchParams(location.search);
if (params.get("textures") === "on") storage.setBattleTexturesOn(true);
else if (params.get("textures") === "off") storage.setBattleTexturesOn(false);
const requestedMap = MAP_PREVIEWS[params.get("map")] ? params.get("map") : "ocean";
let selectedMap = mapUnlocked(requestedMap) ? requestedMap : "ocean";
let previewNotice = selectedMap !== requestedMap ? "通关海洋后解锁草原与潮汐使。草原通关后解锁逐风者。" : "";
let scene;
let mode = "play";
let lastTime = 0;
let galleryTime = 0;
let gallery = [];
let galleryBoss;
let starBosses = [];
let galleryScene;
let hangar = [];
let settledScene;

function mapUnlocked(id) {
  return !!(storage.get().unlockedMaps && storage.get().unlockedMaps[id]);
}

function fitPreview() {
  const controls = document.querySelector("aside").getBoundingClientRect().height + 24;
  document.documentElement.style.setProperty("--preview-controls-height", controls + "px");
}
window.addEventListener("resize", fitPreview);

function updateUi() {
  const meta = MAP_PREVIEWS[selectedMap];
  const textures = storage.get().battleTexturesOn === true;
  document.title = mode === "hangar" ? "战机图鉴 · 全部机体" : meta.title;
  document.body.dataset.map = selectedMap;
  document.getElementById("map-title").textContent = mode === "hangar" ? "战机图鉴" : meta.title;
  document.getElementById("map-description").textContent = mode === "hangar"
    ? "十种机体，各有独立轮廓。\n通关海洋与草原，解锁两个新伙伴。" : meta.description;
  canvas.setAttribute("aria-label", mode === "hangar" ? "全部战机与解锁条件图鉴" : meta.name + "肉鸽射击游戏");
  document.querySelectorAll("button[data-map]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.map === selectedMap));
    button.setAttribute("aria-disabled", String(!mapUnlocked(button.dataset.map)));
    if (button.dataset.map === "grassland") button.textContent = mapUnlocked("grassland") ? "草原" : "草原 · 通关海洋解锁";
  });
  document.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  document.querySelector('[data-mode="play"]').textContent = "进入" + meta.name;
  document.querySelector('[data-mode="boss"]').textContent = selectedMap === "desert" ? "旱魃练习" : "Boss 练习";
  document.querySelector('[data-mode="gallery"]').textContent = meta.name + (selectedMap === "ocean" ? "生物" : "敌人") + "图鉴";
  document.getElementById("textures").textContent = "战斗贴图：" + (textures ? "开启" : "关闭");
  document.getElementById("textures").setAttribute("aria-pressed", String(textures));
  document.getElementById("texture-hint").textContent = "点击切换手绘贴图与代码绘制外观";
  document.getElementById("preview-notice").textContent = previewNotice;
  document.getElementById("map-tips").textContent = "鼠标或手指拖动机体 · 自动开火\n" + meta.tip + "\nBoss 练习提供 12 级构筑；图鉴放大展示造型。";
  const query = new URLSearchParams(location.search);
  query.set("map", selectedMap);
  query.set("mode", mode);
  history.replaceState(null, "", location.pathname + "?" + query);
  fitPreview();
}

function goBattle(character, debug) {
  scene = createBattleScene({ character: character || CHARACTERS[0], debug,
    onExit: (result) => result && result.restart ? goBattle(result.character, debug) : selectMode("menu") });
}

function startFromMenu(character, debug) {
  const save = storage.get();
  if (!mapUnlocked(save.selectedMapId) || !isCharacterUnlocked(save, character)) {
    previewNotice = character && character.unlockHint || "请先完成地图与角色的解锁条件。";
    updateUi();
    return;
  }
  selectedMap = MAP_PREVIEWS[save.selectedMapId] ? save.selectedMapId : "starfield";
  mode = debug && debug.startWave === 3 ? "boss" : "play";
  previewNotice = "";
  goBattle(character, debug);
  updateUi();
}

function buildGallery() {
  const meta = MAP_PREVIEWS[selectedMap];
  gallery = meta.gallery.map(([id, name, desc, make], index) => {
    const e = make(6);
    const cx = 98 + (index % 2) * 194;
    const cy = (selectedMap === "starfield" ? 130 : 150) + Math.floor(index / 2) * (selectedMap === "starfield" ? 137 : 156);
    e.x = cx - e.w / 2;
    e.y = cy - e.h / 2;
    e.wormPhase = "up";
    e.burrowPhase = "up";
    e.untargetable = false;
    const scale = Math.max(1.3, Math.min(2.6, 72 / Math.max(e.w, e.h)));
    return { e, name, desc, cx, cy, scale };
  });
  galleryBoss = createBoss(meta.boss, 10);
  galleryBoss.x = W / 2 - galleryBoss.w / 2;
  galleryBoss.y = 678 - galleryBoss.h / 2;
  galleryBoss.leviathanPhase = 2;
  if (selectedMap === "grassland") galleryBoss.grassPhase = 2;
  starBosses = ["crimson", "azure", "void", "voidCore", "mirror"].map((id, index) => {
    let e;
    if (id === "voidCore") e = enemies.createVoidCoreBoss(0, 0, 10);
    else if (id === "mirror") {
      const owner = createBoss("void", 10);
      // Mirror bodies are spawned inside Boss AI, outside the factory registry.
      e = { type: "mirror", isMirror: true, ownerBossRef: owner, color: "#94a3b8",
        w: owner.w * 0.72, h: owner.h * 0.72, hp: owner.maxHp / 30, maxHp: owner.maxHp / 30,
        mirrorIntroMsRemain: 0, mirrorIntroDurMs: 760 };
    } else e = createBoss(id, 10);
    const cx = index < 3 ? 65 + index * 130 : 130 + (index - 3) * 130;
    const cy = index < 3 ? 586 : 728;
    e.x = cx - e.w / 2;
    e.y = cy - e.h / 2;
    e.coreIntroScale = 1;
    return { e, cx, cy, name: ["红色主舰", "蓝色主舰", "虚空", "虚空二阶段", "虚空镜像"][index] };
  });
  // The preview bundler exposes the real renderer without changing game exports.
  galleryScene = createBattleScene({ character: CHARACTERS[0], onExit() {} });
}

function buildHangar() {
  const summaries = {
    striker: "均衡突击", gunner: "重型炮火", scout: "三路速射", warden: "穿透与修复",
    mechanic: "双轨卫星", vampire: "吸血追踪", taffy: "金币增幅", prism: "随机进化",
    tidecaller: "护盾 · 追踪潮弹", windrunner: "移动蓄风 · 强化齐射",
  };
  hangar = CHARACTERS.map((character, index) => {
    const columns = 3;
    const rowStart = Math.floor(index / columns) * columns;
    const rowCount = Math.min(columns, CHARACTERS.length - rowStart);
    return {
      character, summary: summaries[character.id] || character.desc.split("\n")[0],
      cx: W / 2 + ((index % columns) - (rowCount - 1) / 2) * 128,
      cy: 130 + Math.floor(index / columns) * 186,
      renderer: createBattleScene({ character, onExit() {} }),
    };
  });
}

function selectMode(next) {
  if (!mapUnlocked(selectedMap)) {
    selectedMap = "ocean";
    previewNotice = "通关海洋后解锁草原与潮汐使。草原通关后解锁逐风者。";
  }
  mode = ["play", "boss", "gallery", "hangar", "menu"].includes(next) ? next : "play";
  storage.setSelectedMapId(selectedMap);
  if (mode === "menu") scene = createMenuScene({ onStart: startFromMenu });
  else if (mode === "gallery") buildGallery();
  else if (mode === "hangar") buildHangar();
  else goBattle(CHARACTERS[0], mode === "boss" ? {
    startWave: 3, startLevel: 12, upgradeStartMode: "pickCards", pickUpgradeIds: MAP_PREVIEWS[selectedMap].upgrades,
  } : null);
  updateUi();
}

function selectMap(next) {
  if (!MAP_PREVIEWS[next]) return;
  if (!mapUnlocked(next)) {
    previewNotice = "通关海洋后解锁草原与潮汐使。草原通关后解锁逐风者。";
    updateUi();
    return;
  }
  previewNotice = "";
  selectedMap = next;
  selectMode(mode);
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => selectMode(button.dataset.mode)));
document.querySelectorAll("button[data-map]").forEach((button) => button.addEventListener("click", () => selectMap(button.dataset.map)));
document.getElementById("textures").addEventListener("click", () => {
  storage.setBattleTexturesOn(storage.get().battleTexturesOn !== true);
  updateUi();
});

function drawDesertGalleryBackground(state) {
  ctx.fillStyle = state.theme.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = "#d6b680";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.10;
  for (let i = 0; i < 17; i += 1) {
    const y = i * 56;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(W * 0.3, y - 14, W * 0.65, y + 16, W, y - 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGalleryEnemy(enemy, state, cx, cy, scale) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  // Existing PNGs use larger battle scales; normalize the gallery view only.
  const oldScale = enemy.type === "grunt" ? 3 : enemy.type === "elite" ? 3.5 : 1;
  const textureEnemy = oldScale === 1 ? enemy : Object.assign({}, enemy, {
    x: cx - enemy.w / oldScale / 2, y: cy - enemy.h / oldScale / 2,
    w: enemy.w / oldScale, h: enemy.h / oldScale,
  });
  const textured = drawGrasslandTexture(ctx, textureEnemy, state, storage.get().battleTexturesOn === true)
    || drawEnemyTexture(ctx, textureEnemy, state, storage.get().battleTexturesOn === true);
  if (textured) {
    // The same texture adapter also draws existing grunt/elite portraits.
  } else if (selectedMap === "desert") drawDesertEnemyVisual(ctx, enemy, state, storage.get().battleTexturesOn === true);
  else if (selectedMap === "ocean") drawOceanEnemy(ctx, enemy, state);
  else if (selectedMap === "grassland") drawGrasslandEnemy(ctx, enemy, state);
  else {
    const actual = galleryScene.__state;
    actual.elapsed = state.elapsed;
    actual.enemies = [enemy];
    galleryScene.__drawEnemies(ctx);
  }
  ctx.restore();
}

function drawGallery(dt) {
  galleryTime += dt;
  const meta = MAP_PREVIEWS[selectedMap];
  const state = { elapsed: galleryTime, theme: getMapById(selectedMap).themes[0],
    flashEffectsOn: !matchMedia("(prefers-reduced-motion: reduce)").matches };
  if (selectedMap === "desert") drawDesertGalleryBackground(state);
  else if (selectedMap === "ocean") drawOceanBackground(ctx, state, W, H);
  else if (selectedMap === "grassland") drawGrasslandBackground(ctx, state, W, H);
  else {
    ctx.fillStyle = state.theme.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#485d84";
    for (let i = 0; i < 54; i += 1) ctx.fillRect((i * 137) % W, (i * 193) % H, 1, 1);
  }
  ctx.fillStyle = "#fff4e6";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(meta.galleryTitle, W / 2, 54);
  gallery.forEach(({ e, name, desc, cx, cy, scale }) => {
    drawGalleryEnemy(e, state, cx, cy, scale);
    ctx.fillStyle = "#fff4e6";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(name, cx, cy + (selectedMap === "starfield" ? 54 : 62));
    ctx.fillStyle = selectedMap === "desert" ? "#dec7a9" : "#adcbce";
    ctx.font = "12px sans-serif";
    ctx.fillText(desc, cx, cy + (selectedMap === "starfield" ? 75 : 84));
  });
  if (selectedMap === "starfield") {
    ctx.fillStyle = "#afbddf";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("主舰与隐藏 Boss", W / 2, 524);
    starBosses.forEach(({ e, cx, cy, name }) => {
      drawGalleryEnemy(e, state, cx, cy, 76 / Math.max(e.w, e.h));
      ctx.fillStyle = "#f5eaff";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(name, cx, cy + 55);
    });
    return;
  }
  drawGalleryEnemy(galleryBoss, state, W / 2, 678, 1.35);
  ctx.fillStyle = "#ffd3a3";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(meta.bossName, W / 2, 790);
  ctx.fillStyle = selectedMap === "desert" ? "#dec7a9" : "#adcbce";
  ctx.font = "12px sans-serif";
  ctx.fillText(meta.bossDesc, W / 2, 816);
}

function drawHangar(dt) {
  galleryTime += dt;
  ctx.fillStyle = "#0b1321";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#edf4ff";
  ctx.font = "bold 21px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("战机图鉴", W / 2, 45);
  hangar.forEach(({ character, summary, cx, cy, renderer }) => {
    const textured = drawCharacterTexture(ctx, character.id, cx - 38, cy - 48, 76, 92,
      storage.get().battleTexturesOn === true, "gallery");
    if (!textured) {
      const actual = renderer.__state;
      actual.elapsed = galleryTime;
      actual.player.x = cx - actual.player.w / 2;
      actual.player.y = cy - actual.player.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(2.2, 2.2);
      ctx.translate(-cx, -cy);
      renderer.__drawPlayer(ctx);
      ctx.restore();
    }
    ctx.fillStyle = "#edf4ff";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(character.name, cx, cy + 59);
    ctx.fillStyle = "#a0b1cd";
    ctx.font = "10px sans-serif";
    ctx.fillText(summary, cx, cy + 77);
    const unlocked = isCharacterUnlocked(storage.get(), character);
    ctx.fillStyle = unlocked ? "#9bcab4" : "#d5bc8f";
    ctx.fillText(unlocked ? "已解锁" : character.unlockHint
      || (character.unlockByCodeOnly ? "兑换码解锁" : "金币解锁"), cx, cy + 96);
  });
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height, id: event.pointerId };
}
canvas.addEventListener("pointerdown", (event) => { canvas.setPointerCapture(event.pointerId); if (mode !== "gallery" && mode !== "hangar") scene.onTouchStart(point(event)); });
canvas.addEventListener("pointermove", (event) => { if (mode !== "gallery" && mode !== "hangar") scene.onTouchMove(point(event)); });
for (const event of ["pointerup", "pointercancel"]) canvas.addEventListener(event, () => { if (mode !== "gallery" && mode !== "hangar") scene.onTouchEnd(); });
window.oceanPreview = { selectMode, selectMap, get scene() { return scene; }, get mode() { return mode; }, get map() { return selectedMap; } };
selectMode(params.get("mode") || "play");
function frame(now) {
  const dt = Math.min(50, lastTime ? now - lastTime : 16.67);
  lastTime = now;
  if (mode === "gallery") drawGallery(dt);
  else if (mode === "hangar") drawHangar(dt);
  else {
    scene.update(dt); scene.draw(ctx);
    if (scene.__state && scene.__state.gameOver && settledScene !== scene) {
      settledScene = scene;
      updateUi();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

