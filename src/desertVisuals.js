/**
 * 沙漠敌人图集适配器。只替换外观，既有碰撞、血条、沙暴淡化与招式预警仍由 battle.js 管理。
 * 图集为透明 3×3：沙蜂 / 掠沙者 / 沙丘龟；响尾炮 / 掘地者 / 沙蠕；旱魃 / 潜沙掘地者 / 潜沙沙蠕。
 * 返回 false 表示不是沙漠敌人或图集尚未就绪，调用者可继续走原有加载兜底。
 */

const ATLAS_PATH = "subpackages/pkg_assets/images/desert-enemies-atlas.png";
const TAU = Math.PI * 2;
const CELLS = {
  sandmite: 0,
  skimmer: 1,
  dunecrawler: 2,
  rattler: 3,
  burrower: 4,
  sandworm: 5,
  hanba: 6,
  burrowerUnder: 7,
  sandwormUnder: 8,
};
// 以最终 1254px 图集的透明边界为基准；生成图的行距并非严格三等分。
const SOURCE_BOUNDS = [
  [8, 24, 425, 372], [511, 11, 803, 412], [883, 4, 1204, 381],
  [20, 393, 384, 797], [470, 422, 785, 805], [878, 388, 1240, 787],
  [7, 795, 421, 1240], [493, 965, 758, 1168], [879, 784, 1246, 1245],
];

let atlasImage = null;
let atlasReady = false;
let atlasLoading = false;
let loadAttempts = 0;
let retryAt = 0;

function getAtlas() {
  if (atlasReady && atlasImage) return atlasImage;
  if (atlasLoading || loadAttempts >= 3 || Date.now() < retryAt) return null;
  if (typeof wx === "undefined" || typeof wx.createImage !== "function") return null;
  atlasLoading = true;
  loadAttempts += 1;
  try {
    const image = wx.createImage();
    atlasImage = image;
    image.onload = function onAtlasLoaded() {
      if (atlasImage !== image) return;
      atlasLoading = false;
      atlasReady = (image.naturalWidth || image.width) >= 3
        && (image.naturalHeight || image.height) >= 3;
      if (!atlasReady) retryAt = Date.now() + 4000;
    };
    image.onerror = function onAtlasFailed() {
      if (atlasImage !== image) return;
      atlasLoading = false;
      atlasReady = false;
      retryAt = Date.now() + 4000 * loadAttempts;
    };
    image.src = ATLAS_PATH;
  } catch (_) {
    atlasLoading = false;
    atlasReady = false;
    retryAt = Date.now() + 4000 * loadAttempts;
  }
  return atlasReady ? atlasImage : null;
}

function cellFor(enemy) {
  if (enemy.bossVariant === "hanba") return CELLS.hanba;
  if (enemy.type === "burrower" && enemy.burrowPhase === "under") return CELLS.burrowerUnder;
  if (enemy.type === "sandworm" || enemy.isSandworm) {
    return enemy.wormPhase === "under" || enemy.wormPhase === "telegraph"
      ? CELLS.sandwormUnder : CELLS.sandworm;
  }
  return Object.prototype.hasOwnProperty.call(CELLS, enemy.type) ? CELLS[enemy.type] : null;
}

function drawGroundContact(ctx, enemy, cx, cy, under, t) {
  const isBoss = enemy.bossVariant === "hanba";
  const airborne = enemy.type === "sandmite" || enemy.type === "skimmer";
  const radiusX = enemy.w * (isBoss ? 0.49 : 0.46);
  const radiusY = enemy.h * (under ? 0.18 : 0.15);
  ctx.save();
  ctx.globalAlpha *= under ? 0.10 : 0.20;
  ctx.fillStyle = "#1e1716";
  ctx.beginPath();
  ctx.ellipse(cx + (airborne ? 2 : 0), cy + enemy.h * (airborne ? 0.33 : 0.28),
    radiusX, radiusY, 0, 0, TAU);
  ctx.fill();

  // 极少的暗色沙痕贴着本体；不使用与实心弹幕近似的发光粒子。
  if (enemy.type !== "rattler" && !isBoss) {
    ctx.globalAlpha *= 0.85;
    ctx.strokeStyle = "#dbc49a";
    ctx.lineWidth = 1;
    const drift = Math.sin(t * 0.009 + enemy.x) * 1.3;
    for (let i = 0; i < 3; i += 1) {
      const y = cy - enemy.h * (0.15 + i * 0.18);
      const side = i % 2 ? 1 : -1;
      const x = cx + side * (enemy.w * (0.34 + i * 0.045) + drift);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - (enemy.vx || 0) * 0.45, y - 2 - i);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWormWarning(ctx, enemy, cx, cy, state) {
  if (enemy.wormPhase !== "telegraph") return;
  const progress = Math.max(0, Math.min(1, 1 - (enemy.wormTimer || 0) / 600));
  const radius = Math.max(enemy.w, enemy.h) * (0.68 - progress * 0.14);
  const motion = state.flashEffectsOn !== false;
  ctx.save();
  ctx.globalAlpha *= motion ? 0.65 + progress * 0.35 : 0.85;
  ctx.strokeStyle = "#ffe0a0";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius, radius * 0.7, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.78, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
  ctx.stroke();
  ctx.restore();
}

function drawBossSignals(ctx, enemy, cx, cy, state, spriteW, spriteH) {
  if (enemy.bossVariant !== "hanba") return;
  const reduced = state.flashEffectsOn === false;
  const t = state.elapsed || 0;
  const breaking = (enemy.hpBarBreakFlashMs || 0) > 0;
  if (enemy.preDiveWarn || breaking) {
    ctx.save();
    ctx.globalAlpha *= reduced ? 0.8 : (breaking ? 0.85 : 0.55 + Math.sin(t * 0.013) * 0.25);
    ctx.strokeStyle = breaking ? "#fff2d6" : "#ffe59a";
    ctx.lineWidth = breaking ? 3 : 2;
    // 四角压近本体表示蓄力/硬直，贴图仍保持可辨，不铺实心遮罩。
    const x = cx - spriteW * 0.43;
    const y = cy - spriteH * 0.43;
    const w = spriteW * 0.86;
    const h = spriteH * 0.86;
    const d = 11;
    ctx.beginPath();
    ctx.moveTo(x, y + d); ctx.lineTo(x, y); ctx.lineTo(x + d, y);
    ctx.moveTo(x + w - d, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + d);
    ctx.moveTo(x + w, y + h - d); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - d, y + h);
    ctx.moveTo(x + d, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - d);
    ctx.stroke();
    ctx.restore();
  }
  // 与旧 Boss renderer 相同的锁定线；旱魃场地技能仍由 drawHanbaTelegraphs 绘制。
  if (enemy.bossLaserWarn) {
    const angle = typeof enemy.bossLaserAng === "number" ? enemy.bossLaserAng : Math.PI / 2;
    const fromY = enemy.y + enemy.h;
    ctx.save();
    ctx.globalAlpha *= 0.65;
    ctx.strokeStyle = "#fca5a5";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(cx, fromY);
    ctx.lineTo(cx + Math.cos(angle) * 1200, fromY + Math.sin(angle) * 1200);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A shared atlas survives scene changes. Respect the caller's current fog alpha.
 * Returns true only after an actual image was drawn; callers keep their common HP bars.
 */
function drawDesertSprite(ctx, enemy, state) {
  if (!enemy || !(enemy.w > 0 && enemy.h > 0)) return false;
  const cell = cellFor(enemy);
  if (cell == null) return false;
  const atlas = getAtlas();
  if (!atlas) return false;
  const s = state || {};
  const t = s.flashEffectsOn === false ? 0 : (s.elapsed || 0);
  const cx = enemy.x + enemy.w / 2;
  const cy = enemy.y + enemy.h / 2;
  const isBoss = enemy.bossVariant === "hanba";
  const under = cell === CELLS.burrowerUnder || cell === CELLS.sandwormUnder;
  const airborne = enemy.type === "sandmite" || enemy.type === "skimmer";
  const warning = enemy.wormPhase === "telegraph";
  const scale = isBoss ? 1.25 : (enemy.type === "rattler" ? 1.3 : 1.20);
  const sourceScaleX = (atlas.naturalWidth || atlas.width) / 1254;
  const sourceScaleY = (atlas.naturalHeight || atlas.height) / 1254;
  const crop = SOURCE_BOUNDS[cell];
  const sourceX = crop[0] * sourceScaleX;
  const sourceY = crop[1] * sourceScaleY;
  const sourceW = (crop[2] - crop[0]) * sourceScaleX;
  const sourceH = (crop[3] - crop[1]) * sourceScaleY;
  const fit = Math.min(enemy.w * scale / sourceW, enemy.h * scale / sourceH);
  const spriteW = sourceW * fit;
  const spriteH = sourceH * fit;

  ctx.save();
  drawGroundContact(ctx, enemy, cx, cy, under, t);
  drawWormWarning(ctx, enemy, cx, cy, s);
  ctx.save();
  const bob = under || s.flashEffectsOn === false ? 0
    : Math.sin(t * (airborne ? 0.008 : 0.004) + enemy.x * 0.09) * (isBoss ? 0.8 : 0.55);
  ctx.translate(cx, cy + bob);
  const lean = under || isBoss ? 0
    : Math.max(-0.065, Math.min(0.065, (enemy.vx || 0) * 0.011));
  ctx.rotate(lean);
  if (enemy.type === "skimmer") ctx.rotate(enemy.vx < 0 ? Math.PI / 2 : -Math.PI / 2);
  if (enemy.type === "sandmite" && s.flashEffectsOn !== false) {
    ctx.scale(1 + Math.sin(t * 0.018 + enemy.x) * 0.025, 1);
  }
  if (under) ctx.globalAlpha *= warning ? 0.95 : 0.75;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(atlas, sourceX, sourceY, sourceW, sourceH,
    -spriteW / 2, -spriteH / 2, spriteW, spriteH);
  ctx.restore();
  drawBossSignals(ctx, enemy, cx, cy, s, spriteW, spriteH);
  ctx.restore();
  return true;
}

function paint(ctx, fill, edge, width) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = width || 2.4;
    ctx.stroke();
  }
}

function oval(ctx, x, y, rx, ry, fill, edge, width) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  paint(ctx, fill, edge, width);
}

function claw(ctx, x, y, direction, length, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + direction * 14, y + length * 0.32, x + direction * 3, y + length);
  ctx.quadraticCurveTo(x + direction * 3, y + length * 0.45, x - direction * 4, y + 4);
  ctx.closePath();
  paint(ctx, fill || "#ded0a4", "#544532", 1.5);
}

function limb(ctx, sx, sy, ex, ey, toeX, toeY, color, width) {
  ctx.strokeStyle = "#1d252b";
  ctx.lineWidth = width + 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(toeX, toeY); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawSandmiteShape(ctx, enemy, t) {
  // 两对叶脉翼 + 分节胸腹 + 足钩；身体仍沿原碰撞中心飞行。
  const flap = Math.sin(t * 0.018 + enemy.x) * 3;
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    ctx.moveTo(side * 7, -1);
    ctx.bezierCurveTo(side * 18, -24, side * 36, -42 + flap, side * 50, -38 + flap);
    ctx.bezierCurveTo(side * 49, -15, side * 22, -1, side * 7, 8);
    ctx.closePath();
    paint(ctx, "#d4cdac", "#796646", 2);
    ctx.beginPath();
    ctx.moveTo(side * 9, 3);
    ctx.bezierCurveTo(side * 33, -4, side * 42, 1, side * 48, 9 + flap);
    ctx.quadraticCurveTo(side * 28, 23, side * 8, 15);
    ctx.closePath();
    paint(ctx, "#b6ba99", "#796646", 2);
    ctx.strokeStyle = "#8c8a69"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(side * 11, 0); ctx.lineTo(side * 42, -31 + flap);
    ctx.moveTo(side * 17, -8); ctx.lineTo(side * 39, -14);
    ctx.moveTo(side * 12, 9); ctx.lineTo(side * 39, 9);
    ctx.stroke();
    for (let i = 0; i < 3; i += 1) {
      limb(ctx, side * 9, i * 9, side * (19 + i * 3), 10 + i * 9,
        side * (16 + i * 4), 24 + i * 9, "#ac996a", 2.4);
    }
  }
  for (let i = 0; i < 4; i += 1) oval(ctx, 0, -32 + i * 11, 6 + i * 2, 9, "#283b3e", "#b59056", 2);
  oval(ctx, 0, 12, 13, 16, "#3d4433", "#c7b58c", 2);
  oval(ctx, -8, 20, 4, 6, "#c6e96c", "#41522b", 1.5);
  oval(ctx, 8, 20, 4, 6, "#c6e96c", "#41522b", 1.5);
  claw(ctx, -5, 28, -1, 20, "#bcaa7c");
  claw(ctx, 5, 28, 1, 20, "#bcaa7c");
}

function drawSkimmerShape(ctx, enemy, t) {
  // 横向掠行的长尾沙蜥，翼膜与头部朝向随真实 vx 翻转。
  ctx.save();
  if (enemy.vx < 0) ctx.scale(-1, 1);
  const sweep = Math.sin(t * 0.009 + enemy.y) * 3;
  ctx.beginPath();
  ctx.moveTo(-9, -7);
  ctx.bezierCurveTo(-30, -17, -43, 12 + sweep, -49, -19);
  ctx.bezierCurveTo(-43, 24, -21, 1, -8, 12);
  ctx.closePath();
  paint(ctx, "#693640", "#cb916a", 2);
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    ctx.moveTo(-11, side * 5);
    ctx.quadraticCurveTo(-18, side * 32, -29, side * 40);
    ctx.quadraticCurveTo(-10, side * 34, -6, side * 20);
    ctx.lineTo(13, side * 25);
    ctx.quadraticCurveTo(3, side * 11, 3, side * 6);
    ctx.closePath();
    paint(ctx, "#9b3e4a", "#d6a081", 2);
    limb(ctx, 14, side * 8, 23, side * 20, 35, side * 22, "#bead86", 3);
  }
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.bezierCurveTo(-15, -14, 11, -17, 29, -9);
  ctx.lineTo(47, 0);
  ctx.lineTo(29, 11);
  ctx.bezierCurveTo(11, 16, -15, 13, -22, 0);
  ctx.closePath();
  paint(ctx, "#344047", "#dcc8a1", 2.8);
  ctx.strokeStyle = "#c8b991"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(36, 0); ctx.stroke();
  for (let i = 0; i < 5; i += 1) {
    const x = -13 + i * 9;
    ctx.strokeStyle = "#75807a"; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x, -7); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.stroke();
  }
  oval(ctx, 29, -6, 4, 2.5, "#f4a966");
  oval(ctx, 29, 6, 4, 2.5, "#f4a966");
  ctx.restore();
}

function drawDunecrawlerShape(ctx, enemy, t) {
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i += 1) {
      const y = -20 + i * 20;
      const step = Math.sin(t * 0.005 + i * 2) * 1.8;
      oval(ctx, side * 32, y + step, 10, 10, "#34485a", "#ada787", 2);
      for (let j = 0; j < 2; j += 1) claw(ctx, side * (34 + j * 5), y + 4, side, 11, "#d6c799");
    }
  }
  oval(ctx, 0, 31, 13, 15, "#445669", "#ded0a5", 2.3);
  oval(ctx, -8, 35, 3, 3.5, "#efb06d");
  oval(ctx, 8, 35, 3, 3.5, "#efb06d");
  oval(ctx, 0, -5, 33, 36, "#283e55", "#cbb995", 3);
  ctx.strokeStyle = "#87988e"; ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-23, -22); ctx.lineTo(0, -29); ctx.lineTo(23, -22);
  ctx.moveTo(-29, -4); ctx.lineTo(-12, -13); ctx.lineTo(12, -13); ctx.lineTo(29, -4);
  ctx.moveTo(-27, 13); ctx.lineTo(-13, 7); ctx.lineTo(13, 7); ctx.lineTo(27, 13);
  ctx.moveTo(-13, 7); ctx.lineTo(-12, -13); ctx.lineTo(0, -29);
  ctx.moveTo(13, 7); ctx.lineTo(12, -13); ctx.lineTo(0, -29);
  ctx.moveTo(0, 9); ctx.lineTo(0, 25); ctx.stroke();
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i += 1) {
      const y = -27 + i * 20;
      ctx.beginPath();
      ctx.moveTo(side * 25, y + 5); ctx.quadraticCurveTo(side * 40, y, side * 32, y - 9);
      ctx.lineTo(side * 20, y - 2); ctx.closePath(); paint(ctx, "#d2c296", "#74664e", 1.6);
    }
  }
  claw(ctx, 0, -38, 1, -11, "#ded2ab");
}

function drawRattlerShape(ctx) {
  // 盘绕的蛇身横向铺开，双炮管取代旧矩形炮台。
  ctx.beginPath();
  ctx.ellipse(0, 4, 38, 30, 0, 0.15, TAU - 0.25);
  ctx.strokeStyle = "#162d39"; ctx.lineWidth = 17; ctx.stroke();
  ctx.strokeStyle = "#4c6268"; ctx.lineWidth = 12; ctx.stroke();
  for (let i = 0; i < 11; i += 1) {
    const a = 0.3 + i * 0.52;
    ctx.strokeStyle = i % 2 ? "#b2aa8b" : "#879783"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 31, 4 + Math.sin(a) * 24);
    ctx.lineTo(Math.cos(a) * 42, 4 + Math.sin(a) * 34); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-30, -1); ctx.bezierCurveTo(-41, -23, -21, -37, -29, -45);
  ctx.strokeStyle = "#a99a73"; ctx.lineWidth = 6; ctx.stroke();
  for (let i = 0; i < 3; i += 1) oval(ctx, -29 + i * 2, -42 + i * 5, 4, 3, "#d6c49d", "#5e5748", 1.3);
  ctx.beginPath();
  ctx.moveTo(0, -27); ctx.bezierCurveTo(-23, -27, -20, 4, -10, 13);
  ctx.lineTo(0, 23); ctx.lineTo(10, 13); ctx.bezierCurveTo(20, 4, 23, -27, 0, -27);
  ctx.closePath(); paint(ctx, "#263f4c", "#d4c096", 2.5);
  for (let side = -1; side <= 1; side += 2) {
    oval(ctx, side * 9, -5, 5, 4, "#f5b270", "#675039", 1.5);
    ctx.beginPath(); ctx.moveTo(side * 8, 8); ctx.lineTo(side * 12, 36);
    ctx.strokeStyle = "#b8a67e"; ctx.lineWidth = 10; ctx.stroke();
    ctx.strokeStyle = "#355d69"; ctx.lineWidth = 6; ctx.stroke();
    oval(ctx, side * 12, 36, 5.5, 5, "#142b33", "#d6b982", 1.8);
    oval(ctx, side * 12, 36, 2.7, 2.5, "#ffb16b");
  }
}

function drawBurrowerShape(ctx, t, under) {
  if (under) {
    oval(ctx, 0, 15, 41, 20, "#af8750", "#d7b47e", 2);
    oval(ctx, 0, 12, 25, 12, "#584839");
  }
  const legY = under ? 12 : 0;
  if (!under) {
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 3; i += 1) limb(ctx, side * 15, -21 + i * 13,
        side * 31, -22 + i * 16, side * 38, -9 + i * 16, "#a28866", 3);
    }
    oval(ctx, 0, -9, 22, 31, "#483b3d", "#d8c595", 2.5);
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath(); ctx.moveTo(side * 2, -36);
      ctx.bezierCurveTo(side * 29, -36, side * 26, -2, side * 5, 10);
      ctx.closePath(); paint(ctx, "#d7c89e", "#746b50", 2);
      ctx.strokeStyle = "#a69670"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(side * 10, -29); ctx.lineTo(side * 15, -18); ctx.lineTo(side * 8, -4); ctx.stroke();
    }
    oval(ctx, 0, -23, 6.5, 10, "#368e8f", "#a9c3ad", 1.5);
  }
  oval(ctx, 0, 17 + legY * 0.2, 14, 13, "#baa77e", "#e1d2a7", 2);
  oval(ctx, -8, 23, 3.5, 4, "#86c9bd", "#375657", 1.4);
  oval(ctx, 8, 23, 3.5, 4, "#86c9bd", "#375657", 1.4);
  for (let side = -1; side <= 1; side += 2) {
    const spread = under ? 0 : Math.sin(t * 0.006) * 1.6;
    ctx.beginPath();
    ctx.moveTo(side * 18, 13); ctx.quadraticCurveTo(side * 40, 6, side * (39 + spread), -20);
    ctx.quadraticCurveTo(side * 54, 17, side * 22, 46);
    ctx.quadraticCurveTo(side * 33, 27, side * 18, 13);
    ctx.closePath(); paint(ctx, "#ded0a8", "#7e7053", 2.2);
    ctx.strokeStyle = "#ae9b72"; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(side * 29, 16); ctx.lineTo(side * 35, 9); ctx.moveTo(side * 29, 27); ctx.lineTo(side * 35, 22); ctx.stroke();
  }
}

function drawSandwormShape(ctx, t, under) {
  if (under) {
    oval(ctx, 0, 16, 45, 23, "#987044", "#c8a46b", 2);
    oval(ctx, 0, 10, 31, 18, "#5c503e", "#c4a776", 2);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath(); ctx.moveTo(-22 + i * 20, 0);
      ctx.quadraticCurveTo(-28 + i * 20, -18, -13 + i * 20, -24);
      ctx.lineTo(-9 + i * 20, 5); ctx.closePath(); paint(ctx, "#56626a", "#b8ad83", 2);
    }
    ctx.strokeStyle = "#dac08d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 19, 36, 15, 0, 0.2, Math.PI - 0.2); ctx.stroke();
    return;
  }
  for (let i = 0; i < 4; i += 1) {
    const y = -31 + i * 13;
    const x = Math.sin(i * 1.1 + t * 0.003) * (3 - i * 0.6);
    oval(ctx, x, y, 19 + i * 5, 14 + i * 2, "#35525b", "#b19362", 3);
    ctx.strokeStyle = "#6d8280"; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(x, y - 2, 15 + i * 5, 9, 0, Math.PI + 0.25, TAU - 0.25); ctx.stroke();
    for (let side = -1; side <= 1; side += 2) claw(ctx, x + side * (18 + i * 5), y - 4, side, -14, "#c9ae7a");
  }
  oval(ctx, 0, 17, 34, 28, "#a18b62", "#e7ca93", 3);
  oval(ctx, 0, 17, 27, 22, "#2c1e27", "#783b40", 3);
  for (let i = 0; i < 12; i += 1) {
    const a = i * TAU / 12;
    const x = Math.cos(a) * 27;
    const y = 17 + Math.sin(a) * 22;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a + 1.57) * 3, y + Math.sin(a + 1.57) * 3);
    ctx.quadraticCurveTo(x * 0.75, 17 + (y - 17) * 0.62, x * 0.65, 17 + (y - 17) * 0.60);
    ctx.lineTo(x - Math.cos(a + 1.57) * 3, y - Math.sin(a + 1.57) * 3);
    ctx.closePath(); paint(ctx, "#eee0b5", "#a28b61", 1.2);
  }
}

function drawHanbaShape(ctx, enemy, t) {
  // 角冠、披肩、甲片和长爪让旱魃拥有可辨认的躯体，不再是五边形 Boss。
  const molten = enemy.hanbaOverheat ? "#ffdb91" : "#ee9869";
  ctx.beginPath(); ctx.moveTo(-20, -26); ctx.lineTo(-34, -8);
  ctx.quadraticCurveTo(-43, 29, -24, 46); ctx.lineTo(-14, 35); ctx.lineTo(0, 49);
  ctx.lineTo(14, 35); ctx.lineTo(24, 46); ctx.quadraticCurveTo(43, 29, 34, -8); ctx.lineTo(20, -26);
  ctx.closePath(); paint(ctx, "#693746", "#ad6c61", 1.6);
  for (let side = -1; side <= 1; side += 2) {
    oval(ctx, side * 27, -10, 15, 18, "#3c5063", "#cfc5a2", 2.2);
    oval(ctx, side * 35, 10, 10, 15, "#465c6e", "#b4b49b", 1.8);
    oval(ctx, side * 37, 25, 10, 9, "#514e4b", "#c6b88f", 1.8);
    claw(ctx, side * 34, 28, -side, 18, "#e5d5a9");
    claw(ctx, side * 41, 24, side, 21, "#d8c79d");
    ctx.beginPath(); ctx.moveTo(side * 20, -19); ctx.lineTo(side * 32, -33);
    ctx.quadraticCurveTo(side * 33, -22, side * 41, -22); ctx.lineTo(side * 36, -9); ctx.closePath();
    paint(ctx, "#d2c39b", "#77684e", 1.6);
  }
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.bezierCurveTo(-25, -25, -21, 12, -12, 28);
  ctx.lineTo(0, 35); ctx.lineTo(12, 28); ctx.bezierCurveTo(21, 12, 25, -25, 0, -24); ctx.closePath();
  paint(ctx, "#344957", "#d0bf97", 2);
  for (let i = 0; i < 3; i += 1) {
    const y = i * 10 - 7;
    ctx.strokeStyle = "#a2b1a7"; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-15, y); ctx.lineTo(-4, y + 5); ctx.lineTo(0, y + 2);
    ctx.lineTo(4, y + 5); ctx.lineTo(15, y); ctx.stroke();
  }
  ctx.strokeStyle = molten; ctx.lineWidth = 2.3;
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(-3, -3); ctx.lineTo(2, 6); ctx.lineTo(-3, 13); ctx.lineTo(0, 23); ctx.stroke();
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    ctx.moveTo(side * 7, -24);
    ctx.bezierCurveTo(side * 27, -27, side * 35, -32, side * 31, -48);
    ctx.quadraticCurveTo(side * 27, -39, side * 20, -39);
    ctx.lineTo(side * 19, -50); ctx.lineTo(side * 11, -36);
    ctx.quadraticCurveTo(side * 5, -35, side * 4, -29);
    ctx.closePath(); paint(ctx, "#e0d2ae", "#857452", 1.6);
  }
  ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(-12, -29);
  ctx.quadraticCurveTo(-17, -12, 0, -1); ctx.quadraticCurveTo(17, -12, 12, -29); ctx.closePath();
  paint(ctx, "#c9b88e", "#4b4d47", 2);
  ctx.strokeStyle = "#7a7761"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(-3, -26); ctx.lineTo(0, -18); ctx.lineTo(0, -9); ctx.stroke();
  oval(ctx, -7, -19, 3.7, 2.4, molten);
  oval(ctx, 7, -19, 3.7, 2.4, molten);
  if (enemy.hanbaOverheat) {
    const pulse = 2.5 + Math.sin(t * 0.005) * 0.5;
    oval(ctx, 0, 9, pulse, 4, "#ffdfaa");
  }
}

function drawDesertProcedural(ctx, enemy, state) {
  if (!enemy || !(enemy.w > 0 && enemy.h > 0) || cellFor(enemy) == null) return false;
  const s = state || {};
  const t = s.flashEffectsOn === false ? 0 : (s.elapsed || 0);
  const cx = enemy.x + enemy.w / 2;
  const cy = enemy.y + enemy.h / 2;
  const isBoss = enemy.bossVariant === "hanba";
  const under = enemy.burrowPhase === "under" || enemy.wormPhase === "under" || enemy.wormPhase === "telegraph";
  ctx.save();
  drawGroundContact(ctx, enemy, cx, cy, under, t);
  drawWormWarning(ctx, enemy, cx, cy, s);
  ctx.save();
  ctx.translate(cx, cy);
  const scale = isBoss ? 1.13 : 1;
  ctx.scale(enemy.w * scale / 100, enemy.h * scale / 100);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (under) ctx.globalAlpha *= enemy.wormPhase === "telegraph" ? 0.95 : 0.76;
  if (isBoss) drawHanbaShape(ctx, enemy, t);
  else if (enemy.type === "sandmite") drawSandmiteShape(ctx, enemy, t);
  else if (enemy.type === "skimmer") drawSkimmerShape(ctx, enemy, t);
  else if (enemy.type === "dunecrawler") drawDunecrawlerShape(ctx, enemy, t);
  else if (enemy.type === "rattler") drawRattlerShape(ctx);
  else if (enemy.type === "burrower") drawBurrowerShape(ctx, t, under);
  else drawSandwormShape(ctx, t, under);
  ctx.restore();
  drawBossSignals(ctx, enemy, cx, cy, s, enemy.w * scale, enemy.h * scale);
  ctx.restore();
  return true;
}

/** 贴图关闭时绝不访问或创建 Image；加载/失败时也始终有完整的生物造型。 */
function drawDesertEnemyVisual(ctx, enemy, state, texturesEnabled) {
  if (!enemy || cellFor(enemy) == null) return false;
  if (texturesEnabled === true && drawDesertSprite(ctx, enemy, state)) return true;
  return drawDesertProcedural(ctx, enemy, state);
}

module.exports = { drawDesertSprite, drawDesertEnemyVisual };
