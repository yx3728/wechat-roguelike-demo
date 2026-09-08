/** 草原地形：草丛拦弹、可射断的根芽藤蔓、藏身伏击；不改变全局弹幕速度或收益。 */
const { W, H } = require("./config.js");
const COVER_LAYOUT = [[0.18, 0.43, 31], [0.76, 0.43, 34], [0.46, 0.60, 28], [0.18, 0.77, 33], [0.81, 0.78, 36]];
const COVER_REGEN_MS = 14000;
const ROOT_GROW_MS = 650;
const VINE_ACTIVE_MS = 5000;

function finite(n, fallback) { return Number.isFinite(n) ? n : fallback; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function ownerDead(owner) { return !!owner && ((Number.isFinite(owner.hp) && owner.hp <= 0) || owner.dead === true); }
function playerCenter(state, x, y) {
  const p = state.player || {};
  return { x: finite(x, finite(p.x, 0)) + finite(p.w, 0) / 2,
    y: finite(y, finite(p.y, 0)) + finite(p.h, 0) / 2,
    r: Math.max(0, Math.min(finite(p.w, 0), finite(p.h, 0)) / 2) };
}
function insideCover(state, cover) {
  if (!state.player || !cover.active || cover.hp <= 0) return false;
  const p = playerCenter(state);
  return Math.hypot(p.x - cover.x, p.y - cover.y) <= cover.r;
}
function nextId(state, kind) {
  const id = kind + "-" + state.grassHabitatNextId;
  state.grassHabitatNextId += 1;
  return id;
}
function makeCover(state, x, y, r) {
  const maxHp = 8 + Math.max(0, finite(state.grassCoverCapacityBonus, 0));
  return { id: nextId(state, "cover"), x, y, r, hp: maxHp, maxHp, active: true, regrowMs: 0 };
}

function initGrasslandHabitat(state, width, height) {
  if (state.grassHabitatReady) return;
  state.grassHabitatWidth = finite(width, W);
  state.grassHabitatHeight = finite(height, H);
  state.grassHabitatNextId = 1;
  state.grassCover = [];
  state.grassRootBuds = [];
  state.grassVines = [];
  state.grassHabitatReady = true;
  state.grassConcealed = false;
  state.grassConcealedCoverId = null;
  state.grassSnaredMs = 0;
  state.grassAmbushReady = false;
  state.grassPendingHeal = 0;
  state.grassPendingShield = 0;
  COVER_LAYOUT.forEach(([x, y, r]) => state.grassCover.push(makeCover(state,
    x * state.grassHabitatWidth, y * state.grassHabitatHeight, r)));
  refreshConcealment(state);
}

function refreshConcealment(state) {
  const cover = (state.grassCover || []).find((item) => insideCover(state, item));
  const concealed = !!cover;
  if (concealed && cover.id !== state.grassConcealedCoverId && state.grassAmbushDamageMul > 1) state.grassAmbushReady = true;
  if (!concealed) state.grassAmbushReady = false;
  state.grassConcealed = concealed;
  state.grassConcealedCoverId = cover ? cover.id : null;
}

function plantCover(state, x, y) {
  initGrasslandHabitat(state);
  if (state.grassCover.length >= 7) return null;
  const r = 32;
  const cover = makeCover(state, clamp(finite(x, W / 2), r, state.grassHabitatWidth - r),
    clamp(finite(y, H / 2), r, state.grassHabitatHeight - r), r);
  state.grassCover.push(cover);
  refreshConcealment(state);
  return cover;
}

function breakCover(state, cover) {
  if (!cover.active) return false;
  const player = playerCenter(state);
  if (state.player && Math.hypot(player.x - cover.x, player.y - cover.y) <= cover.r && state.grassCoverBreakShieldRatio > 0) {
    state.grassPendingShield += Math.max(0, finite(state.maxHp, 0)) * state.grassCoverBreakShieldRatio;
  }
  cover.hp = 0;
  cover.active = false;
  cover.regrowMs = COVER_REGEN_MS * Math.max(0.05, finite(state.grassCoverRegenMul, 1));
  refreshConcealment(state);
  return true;
}

function crushCover(state, x, y, radius) {
  if (!state.grassHabitatReady) return 0;
  let count = 0;
  (state.grassCover || []).forEach((cover) => {
    if (cover.active && Math.hypot(cover.x - x, cover.y - y) <= cover.r + Math.max(0, finite(radius, 0))) {
      if (breakCover(state, cover)) count += 1;
    }
  });
  return count;
}

function plantRootBud(state, x, y, owner) {
  initGrasslandHabitat(state);
  if (ownerDead(owner)) return null;
  const bud = { id: nextId(state, "bud"), kind: "rootBud", x: clamp(finite(x, W / 2), 12, state.grassHabitatWidth - 12),
    y: clamp(finite(y, H / 2), 12, state.grassHabitatHeight - 12), r: 12,
    hp: 3, maxHp: 3, active: false, growMs: ROOT_GROW_MS, lifeMs: 16000, owner: owner || null, hitFlashMs: 0 };
  state.grassRootBuds.push(bud);
  return bud;
}

function plantVine(state, a, b, owner) {
  initGrasslandHabitat(state);
  if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite) || ownerDead(owner)) return null;
  if ((a.kind === "rootBud" && a.hp <= 0) || (b.kind === "rootBud" && b.hp <= 0)) return null;
  const vine = { id: nextId(state, "vine"), a, b, owner: owner || null,
    growMs: ROOT_GROW_MS, lifeMs: VINE_ACTIVE_MS, active: false, width: 12 };
  state.grassVines.push(vine);
  return vine;
}

function removeBud(state, bud, playerDestroyed) {
  bud.hp = 0;
  bud.active = false;
  bud.destroyed = true;
  state.grassRootBuds = state.grassRootBuds.filter((item) => item !== bud);
  state.grassVines = state.grassVines.filter((vine) => vine.a !== bud && vine.b !== bud
    && vine.a.id !== bud.id && vine.b.id !== bud.id);
  if (playerDestroyed && state.grassBudHealRatio > 0) {
    state.grassPendingHeal += Math.max(0, finite(state.maxHp, 0)) * state.grassBudHealRatio;
  }
}

/** 返回线段首次进入圆形碰撞区的比例；包含出生点位于圈内的情况。 */
function circleHitTime(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0, dy = y1 - y0, ox = x0 - cx, oy = y0 - cy;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (ox * dx + oy * dy), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** prevX/prevY 与 b.x/b.y 一样为子弹左上角；玩家弹穿草，只击毁敌方根芽。 */
function interceptGrassBullet(state, b, isPlayer, prevX, prevY) {
  if (!state.grassHabitatReady || !b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
  const hw = Math.max(0, finite(b.w, 0)) / 2, hh = Math.max(0, finite(b.h, 0)) / 2;
  const x0 = finite(prevX, b.x) + hw, y0 = finite(prevY, b.y) + hh;
  const x1 = b.x + hw, y1 = b.y + hh, padding = Math.max(hw, hh);
  const candidates = isPlayer ? state.grassRootBuds : state.grassCover;
  let first = null, firstTime = Infinity;
  candidates.forEach((target) => {
    if (target.hp <= 0 || (!isPlayer && !target.active) || (isPlayer && ownerDead(target.owner))) return;
    const t = circleHitTime(x0, y0, x1, y1, target.x, target.y, target.r + padding);
    if (t != null && t < firstTime) { first = target; firstTime = t; }
  });
  if (!first) return false;
  first.hp = Math.max(0, first.hp - 1);
  if (isPlayer) {
    first.hitFlashMs = 100;
    if (first.hp === 0) removeBud(state, first, true);
  } else if (first.hp === 0) breakCover(state, first);
  return true;
}

function pointSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}
function segmentsIntersect(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const determinant = rx * sy - ry * sx;
  if (Math.abs(determinant) < 1e-8) return false;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / determinant;
  const u = (qx * ry - qy * rx) / determinant;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function traceTouchesVine(from, to, vine, radius) {
  if (segmentsIntersect(from, to, vine.a, vine.b)) return true;
  const distance = Math.min(
    pointSegmentDistanceSquared(from.x, from.y, vine.a.x, vine.a.y, vine.b.x, vine.b.y),
    pointSegmentDistanceSquared(to.x, to.y, vine.a.x, vine.a.y, vine.b.x, vine.b.y),
    pointSegmentDistanceSquared(vine.a.x, vine.a.y, from.x, from.y, to.x, to.y),
    pointSegmentDistanceSquared(vine.b.x, vine.b.y, from.x, from.y, to.x, to.y));
  return distance <= (radius + vine.width / 2) ** 2;
}

/** 候选拖拽端点先经过此检测，快速拖动也不能跳过藤蔓；函数只设置减速，不造成伤害。 */
function grassPlayerMoveMul(state, fromX, fromY, toX, toY) {
  if (!state.grassHabitatReady) return 1;
  if (state.grassSnareImmune) { state.grassSnaredMs = 0; return 1; }
  const from = playerCenter(state, fromX, fromY), to = playerCenter(state, toX, toY);
  if ((state.grassVines || []).some((vine) => vine.active && traceTouchesVine(from, to, vine, from.r))) {
    state.grassSnaredMs = 600;
  }
  return state.grassSnaredMs > 0 ? 0.55 : 1;
}

function updateGrasslandHabitat(state, dt, width, height) {
  initGrasslandHabitat(state, width, height);
  const step = Math.max(0, finite(dt, 0));
  state.grassCover.forEach((cover) => {
    if (cover.active) return;
    cover.regrowMs = Math.max(0, cover.regrowMs - step);
    if (cover.regrowMs === 0) { cover.active = true; cover.hp = cover.maxHp; }
  });
  state.grassRootBuds.slice().forEach((bud) => {
    bud.growMs = Math.max(0, bud.growMs - step);
    bud.lifeMs -= step;
    bud.hitFlashMs = Math.max(0, bud.hitFlashMs - step);
    bud.active = bud.growMs === 0;
    if (ownerDead(bud.owner) || bud.lifeMs <= 0 || bud.hp <= 0) removeBud(state, bud, false);
  });
  state.grassVines = state.grassVines.filter((vine) => {
    if (ownerDead(vine.owner) || vine.a.destroyed || vine.b.destroyed) return false;
    const growth = Math.min(step, vine.growMs);
    vine.growMs -= growth;
    vine.lifeMs -= step - growth;
    vine.active = vine.growMs === 0;
    return vine.lifeMs > 0;
  });
  state.grassSnaredMs = Math.max(0, finite(state.grassSnaredMs, 0) - step);
  grassPlayerMoveMul(state);
  refreshConcealment(state);
}

/** 每次进入活草丛只储存藏身期间的一轮强化主炮；离开草丛即失效。 */
function consumeGrassAmbush(state) {
  if (!state.grassHabitatReady) return 1;
  refreshConcealment(state);
  if (!state.grassConcealed || !state.grassAmbushReady) return 1;
  state.grassAmbushReady = false;
  return Math.max(1, finite(state.grassAmbushDamageMul, 1));
}
function consumeGrasslandRewards(state) {
  const rewards = { healAmount: Math.max(0, finite(state.grassPendingHeal, 0)),
    shieldAmount: Math.max(0, finite(state.grassPendingShield, 0)) };
  state.grassPendingHeal = 0;
  state.grassPendingShield = 0;
  return rewards;
}

const grasslandHabitat = {
  id: "grasslandHabitat", name: "草原生态", devModes: null,
  fields: {
    grassCover: null, grassRootBuds: null, grassVines: null,
    grassHabitatReady: false, grassHabitatNextId: 1, grassConcealed: false, grassConcealedCoverId: null, grassSnaredMs: 0,
    grassCoverCapacityBonus: 0, grassCoverRegenMul: 1, grassAmbushDamageMul: 1, grassAmbushReady: false,
    grassBudHealRatio: 0, grassCoverBreakShieldRatio: 0, grassSnareImmune: false,
    grassPendingHeal: 0, grassPendingShield: 0,
  },
  update(state, dt) { updateGrasslandHabitat(state, dt, W, H); },
};

module.exports = { grasslandHabitat, initGrasslandHabitat, updateGrasslandHabitat,
  plantCover, crushCover, plantRootBud, plantVine, interceptGrassBullet,
  grassPlayerMoveMul, consumeGrassAmbush, consumeGrasslandRewards };
