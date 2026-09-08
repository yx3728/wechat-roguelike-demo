/**
 * 菜单与战斗共用的角色贴图适配器。贴图关闭时不创建 Image、不发起资源请求。
 * 既有破袭者 / 永雏塔菲复用单图；其他六架战机共用 characters-atlas.png。
 * 只绘制，不改人物属性、玩家碰撞盒、朝向或存档；加载失败时由调用者绘制代码外观。
 */

const ASSET_ROOT = "subpackages/pkg_assets/images/";
const ATLAS_PATH = ASSET_ROOT + "characters-atlas.png";
const CHARACTER_TEXTURE_IDS = Object.freeze([
  "striker", "gunner", "scout", "warden", "mechanic", "vampire", "taffy", "prism", "windrunner", "tidecaller",
]);

const TEXTURES = {
  striker: { path: ASSET_ROOT + "character_striker.png", battleScale: 2.8 },
  gunner: { path: ATLAS_PATH, cell: 0, battleScale: 1.9 },
  scout: { path: ATLAS_PATH, cell: 1, battleScale: 1.9 },
  warden: { path: ATLAS_PATH, cell: 2, battleScale: 1.9 },
  mechanic: { path: ATLAS_PATH, cell: 3, battleScale: 1.9 },
  vampire: { path: ATLAS_PATH, cell: 4, battleScale: 1.9 },
  taffy: { path: ASSET_ROOT + "character_taffy.png", battleScale: 2.35 },
  prism: { path: ATLAS_PATH, cell: 5, battleScale: 1.9 },
  windrunner: { path: ASSET_ROOT + "character_windrunner.png", battleScale: 2.1 },
  tidecaller: { path: ASSET_ROOT + "character_tidecaller.png", battleScale: 2.1 },
};

// 最终 1254×1254 RGBA 图集的实测透明边界；不能按均匀网格裁掉翼尖与尾焰。
const ATLAS_CROPS = [
  [12, 11, 423, 617], [448, 53, 809, 615], [835, 28, 1239, 616],
  [6, 635, 430, 1245], [427, 631, 832, 1216], [817, 615, 1254, 1246],
];
const ATLAS_REFERENCE_SIZE = { width: 1254, height: 1254 };
const cache = Object.create(null);

function imageSize(image) {
  return {
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0,
  };
}

function loadImage(path) {
  let entry = cache[path];
  if (entry && entry.ready) return entry.image;
  if (entry && (entry.loading || entry.attempts >= 3 || Date.now() < entry.retryAt)) return null;
  if (typeof wx === "undefined" || typeof wx.createImage !== "function") return null;
  if (!entry) {
    entry = { image: null, ready: false, loading: false, attempts: 0, retryAt: 0 };
    cache[path] = entry;
  }
  entry.loading = true;
  entry.attempts += 1;
  function failed() {
    entry.loading = false;
    entry.ready = false;
    entry.retryAt = Date.now() + 4000 * entry.attempts;
  }
  try {
    const image = wx.createImage();
    entry.image = image;
    image.onload = function onCharacterImageLoaded() {
      if (entry.image !== image) return;
      const size = imageSize(image);
      if (!(size.width > 0 && size.height > 0)) { failed(); return; }
      entry.loading = false;
      entry.ready = true;
    };
    image.onerror = function onCharacterImageFailed() {
      if (entry.image === image) failed();
    };
    image.src = path;
  } catch (_) {
    failed();
  }
  return entry.ready ? entry.image : null;
}

function sourceRect(texture, image) {
  const size = imageSize(image);
  if (texture.cell == null) return { x: 0, y: 0, w: size.width, h: size.height };
  if (ATLAS_CROPS) {
    const crop = ATLAS_CROPS[texture.cell];
    const scaleX = size.width / ATLAS_REFERENCE_SIZE.width;
    const scaleY = size.height / ATLAS_REFERENCE_SIZE.height;
    return {
      x: crop[0] * scaleX, y: crop[1] * scaleY,
      w: (crop[2] - crop[0]) * scaleX, h: (crop[3] - crop[1]) * scaleY,
    };
  }
  const cellW = size.width / 3;
  const cellH = size.height / 2;
  // 标准模板每格预留 48px 安全边距，只去掉外围一半，避免裁断炮管与尾焰。
  const padX = cellW * (24 / 512);
  const padY = cellH * (24 / 512);
  return {
    x: (texture.cell % 3) * cellW + padX,
    y: Math.floor(texture.cell / 3) * cellH + padY,
    w: cellW - padX * 2, h: cellH - padY * 2,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} characterId CHARACTERS 中的 id
 * @param {number} x 左上角坐标；battle 模式传玩家碰撞盒坐标
 * @param {number} y
 * @param {number} w 可用绘图区宽；battle 模式传玩家碰撞盒宽
 * @param {number} h
 * @param {boolean} enabled 只有严格 true 才允许创建或绘制图片
 * @param {string} [variant] "battle" 使用受控的视觉放大；其他值在给定矩形内等比居中
 * @returns {boolean} 图片已绘制则 true；关闭、未知、加载中或失败则 false
 */
function drawCharacterTexture(ctx, characterId, x, y, w, h, enabled, variant) {
  if (enabled !== true || !(w > 0 && h > 0)) return false;
  if (![x, y, w, h].every(Number.isFinite)) return false;
  if (!Object.prototype.hasOwnProperty.call(TEXTURES, characterId)) return false;
  const texture = TEXTURES[characterId];
  const image = loadImage(texture.path);
  if (!image) return false;
  const source = sourceRect(texture, image);
  if (!(source.w > 0 && source.h > 0)) return false;
  const visualScale = variant === "battle" ? texture.battleScale : 1;
  const fit = Math.min(w * visualScale / source.w, h * visualScale / source.h);
  const drawW = source.w * fit;
  const drawH = source.h * fit;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, source.x, source.y, source.w, source.h,
    x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
  ctx.restore();
  return true;
}

module.exports = { drawCharacterTexture, CHARACTER_TEXTURE_IDS };
