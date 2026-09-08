/** 草原共用图集。关闭贴图时不访问图片；加载中/失败交回无图代码外观。 */
const GRASSLAND_ATLAS_LAYOUT = {
  path: "subpackages/pkg_assets/images/grassland-atlas.png",
  slots: ["meadowHare", "bladeMantis", "lanternBeetle", "thornBloom", "galeFalcon", "thunderBison", "antlerKing1", "antlerKing2", "windrunner"],
  // 实测 1254² 透明边界。第九格仅保留元数据；角色使用独立、未裁翼尖的 PNG。
  bounds: [
    [106, 0, 319, 388], [455, 0, 800, 387], [919, 5, 1206, 348],
    [48, 387, 382, 750], [390, 388, 865, 750], [906, 348, 1212, 777],
    [0, 750, 429, 1245], [430, 750, 844, 1251], [860, 777, 1246, 1247],
  ].map((box) => box.map((value) => value / 1254)),
};
const SLOTS = Object.assign(Object.create(null), { meadowHare: 0, bladeMantis: 1, lanternBeetle: 2, thornBloom: 3, galeFalcon: 4, thunderBison: 5 });
let cached = null;
function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, finite(value, 0))); }
function getAtlas() {
  if (cached && cached.ready) return cached.image;
  if (cached && (cached.loading || cached.attempts >= 3 || Date.now() < cached.retryAt)) return null;
  if (typeof wx === "undefined" || typeof wx.createImage !== "function") return null;
  if (!cached) cached = { image: null, loading: false, ready: false, attempts: 0, retryAt: 0 };
  const entry = cached;
  entry.loading = true; entry.attempts += 1;
  function failed() {
    entry.loading = false; entry.ready = false;
    entry.retryAt = Date.now() + 4000 * entry.attempts;
  }
  try {
    const image = wx.createImage(); entry.image = image;
    image.onload = function loaded() {
      if (entry.image !== image) return;
      if (!((image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0)) { failed(); return; }
      entry.loading = false; entry.ready = true;
    };
    image.onerror = function error() { if (entry.image === image) failed(); };
    image.src = GRASSLAND_ATLAS_LAYOUT.path;
  } catch (_) { failed(); }
  return entry.ready ? entry.image : null;
}

function drawBossBody(ctx, image, src, width, height, gait, moving) {
  // 连续薄带变形让大鹿角、肩背与下方蹄部依次跟随步态，原图透明轮廓完整保留。
  // 相邻带略重叠以避免 Canvas 取样缝；动态幅度始终小于可视宽度的 1.5%。
  if (!moving) { ctx.drawImage(image, ...src, -width / 2, -height / 2, width, height); return; }
  const bands = 12;
  for (let i = 0; i < bands; i += 1) {
    const from = i / bands, to = (i + 1) / bands;
    const mid = (from + to) / 2;
    const sway = Math.sin(gait - mid * 1.9) * width * (mid < 0.6 ? 0.008 : 0.012);
    const expand = 1 + Math.sin(gait * 0.8 - mid) * (mid < 0.52 ? 0.012 : 0.006);
    const overlap = i < bands - 1 ? Math.min(0.3, height / bands * 0.06) : 0;
    const sourceOverlap = overlap / height * src[3];
    ctx.drawImage(image, src[0], src[1] + src[3] * from, src[2], src[3] * (to - from) + sourceOverlap,
      -width * expand / 2 + sway, -height / 2 + height * from, width * expand, height * (to - from) + overlap);
  }
}

/** ctx retains its incoming alpha/styles. Shared HP bars and field warnings remain with battle/grasslandVisuals. */
function drawGrasslandTexture(ctx, enemy, state, enabled) {
  if (enabled !== true || !enemy || !(enemy.w > 0 && enemy.h > 0)
    || !Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) return false;
  const boss = enemy.bossVariant === "antlerKing";
  const slot = boss ? (enemy.grassPhase === 2 ? 7 : 6) : SLOTS[enemy.type];
  if (slot == null) return false;
  const image = getAtlas(); if (!image) return false;
  const atlasW = image.naturalWidth || image.width, atlasH = image.naturalHeight || image.height;
  const b = GRASSLAND_ATLAS_LAYOUT.bounds[slot];
  const src = [b[0] * atlasW, b[1] * atlasH, (b[2] - b[0]) * atlasW, (b[3] - b[1]) * atlasH];
  const s = state || {}, moving = s.flashEffectsOn !== false, t = moving ? finite(s.elapsed, 0) : 0;
  const gait = moving ? finite(enemy.grassSwimPhase, t * 0.005) : 0;
  const bossScale = boss ? 1.10 : 1.12;
  const scale = Math.min(enemy.w * bossScale / src[2], enemy.h * bossScale / src[3]);
  const width = src[2] * scale, height = src[3] * scale;
  const warn = enemy.grassState === "warn" ? clamp(enemy.grassWarnProgress, 0, 1) : 0;
  let bank = 0, bob = 0, sx = 1, sy = 1;
  if (boss) {
    bank = moving ? clamp(finite(enemy.grassBank, Math.sin(gait * 0.5) * 0.035), -0.12, 0.12) : 0;
    bob = moving ? Math.sin(gait * 2) * enemy.h * 0.012 : 0;
    sy = 1 - warn * 0.025 + (moving ? Math.sin(gait) * 0.01 : 0);
  } else if (enemy.type === "meadowHare") {
    const hop = moving ? finite(enemy.grassHop, (Math.sin(t * 0.011) + 1) / 2) : 0;
    bob = -hop * enemy.h * 0.025; sx = 1 - hop * 0.025; sy = 1 + hop * 0.025;
  } else if (enemy.type === "galeFalcon") {
    const sweep = moving ? finite(enemy.grassSweepPhase, t * 0.006) : 0;
    bank = Math.sin(sweep) * 0.09; sx = 1 + Math.sin(t * 0.014) * 0.04;
  } else if (enemy.type === "lanternBeetle") {
    sx = enemy.grassShellOpen ? 1.055 : 0.96;
    bob = moving ? Math.sin(t * 0.008) * enemy.h * 0.012 : 0;
  } else if (enemy.type === "thornBloom") {
    bank = moving ? Math.sin(t * 0.002) * 0.065 : 0;
    sx = sy = 1 + (moving ? Math.sin(t * 0.005) * 0.018 : 0);
  } else {
    bank = moving ? Math.sin(t * 0.007) * 0.035 : 0;
    bob = moving ? Math.sin(t * 0.013) * enemy.h * 0.014 : 0;
  }
  ctx.save();
  try {
    ctx.translate(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2 + bob); ctx.rotate(bank); ctx.scale(sx, sy);
    ctx.imageSmoothingEnabled = true;
    if (boss) drawBossBody(ctx, image, src, width, height, gait, moving);
    else ctx.drawImage(image, ...src, -width / 2, -height / 2, width, height);
    return true;
  } catch (_) { return false; }
  finally { ctx.restore(); }
}

module.exports = { drawGrasslandTexture, GRASSLAND_ATLAS_LAYOUT };
