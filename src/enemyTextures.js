/**
 * 海洋与星空缺失敌人的共享图集。只画本体和原有星空 Boss 的身体信号；
 * 海洋场地预警仍由 oceanVisuals.drawOceanOverlay 绘制，血条/碰撞仍归 battle。
 * texturesEnabled=false 在图片访问之前返回；未加载或加载失败交回程序绘制兜底。
 */
const TAU = Math.PI * 2;
const ATLAS_LAYOUTS = {
  ocean: {
    path: "subpackages/pkg_assets/images/ocean-enemies-atlas.png",
    slots: ["reefRay", "needlefish", "jellyfish", "armoredCrab", "inkCuttlefish",
      "abyssalAngler", "leviathan1", "leviathan2", "armoredCrabOpen"],
    bounds: [
      [18, 0, 423, 403], [552, 0, 704, 418], [874, 8, 1230, 418],
      [22, 430, 410, 790], [498, 416, 768, 795], [890, 416, 1223, 801],
      [0, 786, 433, 1254], [432, 790, 840, 1254], [850, 832, 1240, 1218],
    ].map((box) => box.map((coordinate) => coordinate / 1254)),
  },
  starfield: {
    path: "subpackages/pkg_assets/images/starfield-enemies-atlas.png",
    slots: ["swift", "tank", "shooter", "weaver", "crimson", "azure", "void", "voidCore", "mirror"],
    bounds: [
      [49, 49, 372, 350], [462, 0, 792, 350], [862, 40, 1223, 347],
      [85, 375, 339, 806], [418, 348, 837, 801], [854, 369, 1233, 822],
      [0, 810, 420, 1235], [470, 810, 787, 1235], [835, 825, 1254, 1254],
    ].map((box) => box.map((coordinate) => coordinate / 1254)),
  },
};
const OCEAN_SLOTS = { reefRay: 0, needlefish: 1, jellyfish: 2, armoredCrab: 3, inkCuttlefish: 4, abyssalAngler: 5 };
const STARFIELD_SLOTS = { swift: 0, tank: 1, shooter: 2, weaver: 3 };
const STARFIELD_BOSSES = { crimson: 4, azure: 5, void: 6, voidCore: 7 };
const EXISTING_ENEMY_IMAGES = {
  grunt: { path: "subpackages/pkg_assets/images/enemy_grunt.png", single: true, scale: 3 },
  elite: { path: "subpackages/pkg_assets/images/enemy_elite.png", single: true, scale: 3.5 },
};
const atlasCache = Object.create(null);

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function finite(value, fallback) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function owns(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

function pickSprite(enemy) {
  if (enemy.isMirror || enemy.type === "mirror") return { atlas: "starfield", slot: 8 };
  if (enemy.isVoidCore) return { atlas: "starfield", slot: 7 };
  if (enemy.bossVariant === "leviathan") {
    const second = enemy.leviathanPhase === 2
      || (enemy.leviathanPhase == null && enemy.maxHp > 0 && enemy.hp <= enemy.maxHp * 0.5);
    return { atlas: "ocean", slot: second ? 7 : 6 };
  }
  if (owns(STARFIELD_BOSSES, enemy.bossVariant)) return { atlas: "starfield", slot: STARFIELD_BOSSES[enemy.bossVariant] };
  if (owns(OCEAN_SLOTS, enemy.type)) {
    return { atlas: "ocean", slot: enemy.type === "armoredCrab" && enemy.oceanShellOpen ? 8 : OCEAN_SLOTS[enemy.type] };
  }
  if (owns(STARFIELD_SLOTS, enemy.type)) return { atlas: "starfield", slot: STARFIELD_SLOTS[enemy.type] };
  if (owns(EXISTING_ENEMY_IMAGES, enemy.type)) return { atlas: enemy.type, slot: 0 };
  return null;
}

function getAtlas(key) {
  const entry = atlasCache[key] || (atlasCache[key] = { image: null, ready: false, loading: false, attempts: 0, retryAt: 0 });
  if (entry.ready && entry.image) return entry.image;
  if (entry.loading || entry.attempts >= 3 || Date.now() < entry.retryAt) return null;
  if (typeof wx === "undefined" || typeof wx.createImage !== "function") return null;
  entry.loading = true;
  entry.attempts += 1;
  try {
    const image = wx.createImage();
    entry.image = image;
    image.onload = function loaded() {
      if (entry.image !== image) return;
      entry.loading = false;
      entry.ready = finite(image.naturalWidth || image.width, 0) >= 3
        && finite(image.naturalHeight || image.height, 0) >= 3;
      if (!entry.ready) entry.retryAt = Date.now() + 4000;
    };
    image.onerror = function failed() {
      if (entry.image !== image) return;
      entry.loading = false;
      entry.ready = false;
      entry.retryAt = Date.now() + 4000 * entry.attempts;
    };
    image.src = (ATLAS_LAYOUTS[key] || EXISTING_ENEMY_IMAGES[key]).path;
  } catch (_) {
    entry.loading = false;
    entry.ready = false;
    entry.retryAt = Date.now() + 4000 * entry.attempts;
  }
  return entry.ready ? entry.image : null;
}

function sourceRect(atlas, slot, layout) {
  const width = atlas.naturalWidth || atlas.width;
  const height = atlas.naturalHeight || atlas.height;
  if (layout.single) return [0, 0, width, height];
  // 按透明轮廓测量的裁剪；生成图的行距不严格等分。
  if (layout.bounds && layout.bounds[slot]) {
    const b = layout.bounds[slot];
    return [b[0] * width, b[1] * height, (b[2] - b[0]) * width, (b[3] - b[1]) * height];
  }
  const cellW = width / 3, cellH = height / 3;
  const padding = 0.025;
  return [(slot % 3 + padding) * cellW, (Math.floor(slot / 3) + padding) * cellH,
    cellW * (1 - padding * 2), cellH * (1 - padding * 2)];
}

function applyOceanPose(ctx, enemy, state) {
  const reduced = state.flashEffectsOn === false;
  const t = reduced ? 0 : finite(state.elapsed, 0);
  if (enemy.bossVariant === "leviathan") {
    const phase = reduced ? 0 : finite(enemy.leviathanSwimPhase, t * 0.005);
    const thrust = reduced ? 0 : clamp(finite(enemy.leviathanThrust, 0.3), 0, 1);
    const bank = reduced ? 0 : clamp(finite(enemy.leviathanBank, Math.sin(phase * 0.55) * 0.025), -0.12, 0.12);
    // 纹理模式沿用身体侧倾、呼吸和推进压缩，不能退化为悬停静态贴纸。
    ctx.rotate(bank);
    const breath = Math.sin(phase * 0.70) * 0.015;
    const finBeat = Math.sin(phase * 1.9) * (0.008 + thrust * 0.013);
    ctx.scale(1 + breath + finBeat, 1 - breath * 0.4 + thrust * 0.018);
    if (enemy.leviathanState !== "warn" && enemy.leviathanMotionPhase !== "hold") {
      ctx.translate(Math.sin(phase * 0.55) * 0.7, Math.sin(phase) * 0.85);
    }
    return;
  }
  if (enemy.type === "needlefish" && (enemy.oceanAttackPhase === "warn" || enemy.oceanAttackPhase === "dash")) {
    ctx.rotate(finite(enemy.oceanAimAngle, Math.PI / 2) - Math.PI / 2);
  } else if (enemy.type === "reefRay") {
    const flap = Math.sin(t * 0.009 + enemy.x * 0.03);
    ctx.scale(1 + flap * 0.045, 1 - flap * 0.022);
    ctx.rotate(clamp(finite(enemy.vx, 0) * 0.03, -0.07, 0.07));
  } else if (enemy.type === "jellyfish") {
    const pulse = Math.sin(t * 0.006);
    ctx.scale(1 + pulse * 0.026, 1 - pulse * 0.035);
  } else if (enemy.type === "inkCuttlefish") {
    const jet = enemy.oceanAttackPhase === "volley" && !reduced ? Math.sin(t * 0.020) * 0.04 : 0;
    ctx.scale(1 - jet * 0.4, 1 + jet);
  }
}

function drawAnglerTexture(ctx, atlas, source, width, height, enemy, state) {
  if (state.flashEffectsOn === false) {
    ctx.drawImage(atlas, ...source, -width / 2, -height / 2, width, height);
    return;
  }
  const phase = finite(state.elapsed, 0) * 0.0034 + enemy.x * 0.01;
  const amplitude = Math.min(3.4, enemy.w * 0.05);
  const bands = 16;
  // 原图朝下，前半段是尾鳍/尾柄。变形在 48% 高度前收敛到零，灯饵与嘴部保持稳定。
  for (let i = 0; i < bands; i += 1) {
    const from = i / bands, to = (i + 1) / bands, middle = (from + to) / 2;
    const tail = Math.max(0, 1 - middle / 0.48);
    const shift = Math.sin(phase - tail * 0.55) * amplitude * tail * tail;
    // 接缝仅重叠 0.15px；同一原图连续采样，透明鳍尖不会被单独裁断。
    const overlap = i < bands - 1 ? Math.min(0.15, height / bands * 0.04) : 0;
    ctx.drawImage(atlas, source[0], source[1] + source[3] * from, source[2], source[3] * (to - from + overlap / height),
      -width / 2 + shift, -height / 2 + height * from, width, height * (to - from) + overlap);
  }
}

function applyStarfieldPose(ctx, enemy, state) {
  const t = state.flashEffectsOn === false ? 0 : finite(state.elapsed, 0);
  if (enemy.isMirror || enemy.type === "mirror") {
    const duration = Math.max(1, finite(enemy.mirrorIntroDurMs, 760));
    const remain = Math.max(0, finite(enemy.mirrorIntroMsRemain, 0));
    const progress = clamp(1 - remain / duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    ctx.globalAlpha *= remain > 0 ? 0.22 + eased * 0.78 : 1;
    ctx.scale(Math.max(0.12, eased), Math.max(0.12, eased));
    ctx.rotate(state.flashEffectsOn === false ? 0 : finite(enemy.spinAngle, t * 0.001) * 0.14);
  } else if (enemy.isVoidCore || enemy.bossVariant === "voidCore") {
    const intro = clamp(finite(enemy.coreIntroScale, 1), 0.20, 1);
    const pulse = 1 + Math.sin(t * 0.008) * 0.035;
    ctx.scale(intro * pulse, intro * pulse);
    ctx.rotate(state.flashEffectsOn === false ? 0 : finite(enemy.spinAngle, t * 0.002) * 0.16);
  } else if (enemy.isBoss) {
    if (enemy.voidShellCutscene) ctx.globalAlpha *= clamp(finite(enemy.cutsceneAlpha, 1), 0, 1);
    const pulse = Math.sin(t * 0.0038) * 0.016;
    ctx.scale(1 + pulse, 1 - pulse * 0.45);
    ctx.rotate(enemy.bossVariant === "void" ? Math.sin(t * 0.0016) * 0.08 : Math.sin(t * 0.001) * 0.028);
  } else if (enemy.type === "weaver") {
    ctx.rotate(Math.sin(t * 0.005 + finite(enemy.weavePhase, 0)) * 0.10);
  } else {
    ctx.rotate(clamp(finite(enemy.vx, 0) * 0.022, -0.08, 0.08));
  }
}

function drawStarfieldSignals(ctx, enemy, state) {
  if (!enemy.isBoss && !enemy.isMirror && enemy.type !== "mirror") return;
  const cx = enemy.x + enemy.w / 2, cy = enemy.y + enemy.h / 2;
  const ownerWarn = enemy.ownerBossRef && enemy.ownerBossRef.voidRedWarn;
  if (enemy.preDiveWarn || enemy.voidRedWarn || ownerWarn || enemy.hpBarBreakFlashMs > 0) {
    ctx.save();
    const reduced = state.flashEffectsOn === false;
    ctx.globalAlpha *= reduced ? 0.8 : 0.68 + Math.sin(finite(state.elapsed, 0) * 0.014) * 0.18;
    ctx.strokeStyle = enemy.hpBarBreakFlashMs > 0 ? "#fff2df" : enemy.preDiveWarn ? "#ffe59a" : "#ffa493";
    ctx.lineWidth = enemy.hpBarBreakFlashMs > 0 ? 2.5 : 1.8;
    ctx.beginPath();
    ctx.ellipse(cx, cy, enemy.w * 0.57, enemy.h * 0.57, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  if (enemy.bossLaserWarn) {
    const angle = finite(enemy.bossLaserAng, Math.PI / 2);
    ctx.save();
    ctx.globalAlpha *= 0.65;
    ctx.strokeStyle = "#fca5a5";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(cx, enemy.y + enemy.h);
    ctx.lineTo(cx + Math.cos(angle) * 1200, enemy.y + enemy.h + Math.sin(angle) * 1200);
    ctx.stroke();
    ctx.restore();
  }
}

function drawEnemyTexture(ctx, enemy, state, texturesEnabled) {
  if (!texturesEnabled || !enemy) return false;
  if (![enemy.x, enemy.y, enemy.w, enemy.h].every(Number.isFinite) || enemy.w <= 0 || enemy.h <= 0) return false;
  const sprite = pickSprite(enemy);
  if (!sprite) return false;
  const atlas = getAtlas(sprite.atlas);
  if (!atlas) return false;
  const s = state || {};
  const layout = ATLAS_LAYOUTS[sprite.atlas] || EXISTING_ENEMY_IMAGES[sprite.atlas];
  const source = sourceRect(atlas, sprite.slot, layout);
  const isLarge = enemy.isBoss || enemy.isMirror || enemy.type === "mirror" || enemy.bossVariant === "leviathan";
  const scale = layout.scale || (isLarge ? 1.18 : 1.30);
  let width = enemy.w * scale, height = enemy.h * scale;
  if (!layout.single) {
    // 保留针鱼/蛇形/核心等不同长宽比，避免把细长生物压成方块。
    const fit = Math.min(width / source[2], height / source[3]);
    width = source[2] * fit;
    height = source[3] * fit;
  }
  let drawn = false;
  ctx.save();
  try {
    ctx.translate(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2);
    if (sprite.atlas === "ocean") applyOceanPose(ctx, enemy, s);
    else applyStarfieldPose(ctx, enemy, s);
    ctx.imageSmoothingEnabled = true;
    if (enemy.type === "abyssalAngler") drawAnglerTexture(ctx, atlas, source, width, height, enemy, s);
    else ctx.drawImage(atlas, source[0], source[1], source[2], source[3], -width / 2, -height / 2, width, height);
    drawn = true;
  } catch (_) {
    // 暂时不可用的图片不阻断整帧；程序轮廓仍可呈现敌人与碰撞位置。
  } finally {
    ctx.restore();
  }
  if (drawn && sprite.atlas === "starfield") drawStarfieldSignals(ctx, enemy, s);
  return drawn;
}

module.exports = { drawEnemyTexture, ATLAS_LAYOUTS, EXISTING_ENEMY_IMAGES };
