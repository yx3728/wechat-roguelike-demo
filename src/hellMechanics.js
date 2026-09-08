/**
 * hellMechanics.js
 * ----------------------------------------------------------------------------
 * 地狱「业火回魂」：本作唯一一条由**玩家自己的击杀速率**驱动的压力轴。
 *
 *   杀死普通敌人 ──► 原地掉「魂火」──► 引信烧完 ──► 原地站起「亡魂」
 *                         │
 *                      玩家碰到 ──► 镇魂：+1 层业火（主炮增伤，会掉层）
 *
 * 两条设计红线，改数值时不要碰：
 *   1. **击杀亡魂不产生新魂火**——否则回路递归，场面永远收不回来。
 *   2. 魂火与亡魂都有硬上限——无论玩家 DPS 多离谱，场面有天花板。
 *      到达亡魂上限时，烧完的魂火直接消散，不再惩罚已经被淹的玩家。
 *
 * 本模块不认识敌人类型：回魂只往 state.hellRevenantQueue 里排一条请求，
 * 由 battle.js 取出来交给 hellEnemies.createRevenant。避免与 hellEnemies 循环依赖。
 * ----------------------------------------------------------------------------
 */
const { W, H } = require("./config.js");

/** 引信 4.5 秒（设计稿是 6.0，按"这一章要更难"整体收紧） */
const FUSE_MS = 4500;
/** 镇魂判定半径；「引魂」词条把它抬到 98 */
const BANK_RADIUS = 28;
/** 业火：每层增伤、层上限、每层独立寿命 */
const EMBER_DAMAGE_PER_STACK = 0.07;
const EMBER_MAX_STACKS = 6;
const EMBER_LIFE_MS = 4000;
/** 安全栏：场上魂火 / 亡魂的硬上限 */
const SOULFIRE_CAP = 14;
const REVENANT_CAP = 8;
/** 罪值：只有 Boss 战读它，但全程维护，便于测试与 DEV 观察 */
const SIN_START = 20;
const SIN_ON_RISE = 15;
const SIN_ON_BANK = -6;
const SIN_MAX = 100;

function finite(n, fallback) { return Number.isFinite(n) ? n : fallback; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function playerCenter(state) {
  const p = (state && state.player) || {};
  return { x: finite(p.x, W / 2) + finite(p.w, 0) / 2, y: finite(p.y, H * 0.8) + finite(p.h, 0) / 2 };
}

function liveRevenants(state) {
  return (state.enemies || []).filter((e) => e && e.isHellRevenant && e.hp > 0).length;
}

function initHellfire(state) {
  if (state.hellReady) return;
  state.hellReady = true;
  state.hellSoulfires = [];
  state.hellRevenantQueue = [];
  state.hellEmber = [];
  state.hellNextId = 1;
  state.hellSin = SIN_START;
  state.hellBankFlash = null;
  state.hellRiseFlash = null;
}

/** 罪值只能从这两个事件走，测试会锁住这一点 */
function addSin(state, amount) {
  state.hellSin = clamp(finite(state.hellSin, SIN_START) + amount, 0, SIN_MAX);
}

function fuseMulFor(state) {
  return Math.max(0.1, finite(state.hellFuseMul, 1));
}

/**
 * 掉一团魂火。fuseMs 缺省用全局引信；焦骨传更短的值（教玩家"这个得马上收"）。
 * enemy 里带的尺寸只用来给亡魂定型，不会引用敌人本体（避免持有已死对象）。
 */
function dropSoulfire(state, x, y, options) {
  initHellfire(state);
  const opts = options || {};
  const base = finite(opts.fuseMs, FUSE_MS) * fuseMulFor(state) + finite(state.hellFuseBonusMs, 0);
  const fuse = Math.max(300, base);
  const fire = {
    id: state.hellNextId,
    x: clamp(finite(x, W / 2), 14, W - 14),
    y: clamp(finite(y, H / 2), 14, H - 14),
    fuseMs: fuse,
    fuseMaxMs: fuse,
    srcMaxHp: Math.max(1000, finite(opts.srcMaxHp, 3000)),
    srcW: clamp(finite(opts.srcW, 26), 16, 48),
    srcH: clamp(finite(opts.srcH, 28), 16, 48),
    level: Math.max(1, finite(opts.level, 1)),
    pulse: 0,
  };
  state.hellNextId += 1;
  state.hellSoulfires.push(fire);
  // 超过上限：最老的一团立刻回魂（不是静默删除，玩家看得见后果）
  while (state.hellSoulfires.length > SOULFIRE_CAP) igniteSoulfire(state, state.hellSoulfires[0]);
  return fire;
}

/** 引信立刻烧完。到达亡魂上限时只是消散——不给已经被淹的玩家再加一只 */
function igniteSoulfire(state, fire) {
  const index = state.hellSoulfires.indexOf(fire);
  if (index < 0) return false;
  state.hellSoulfires.splice(index, 1);
  const queued = (state.hellRevenantQueue || []).length;
  if (liveRevenants(state) + queued >= REVENANT_CAP) return false;
  state.hellRevenantQueue.push({
    x: fire.x, y: fire.y, srcMaxHp: fire.srcMaxHp, srcW: fire.srcW, srcH: fire.srcH, level: fire.level,
  });
  addSin(state, SIN_ON_RISE);
  state.hellRiseFlash = { x: fire.x, y: fire.y, ms: 380 };
  state.hellRiseCount = finite(state.hellRiseCount, 0) + 1;
  return true;
}

/** 烙印使的印记、阎罗的业火判决都走这里：范围内的魂火立刻点燃 */
function igniteSoulfiresAt(state, x, y, radius) {
  if (!state.hellReady) return 0;
  const r = Math.max(0, finite(radius, 0));
  let count = 0;
  state.hellSoulfires.slice().forEach((fire) => {
    if (Math.hypot(fire.x - finite(x, 0), fire.y - finite(y, 0)) <= r) {
      if (igniteSoulfire(state, fire)) count += 1;
    }
  });
  return count;
}

/** 刑官死亡：全场引信统一跳到剩余 ms（够收身边几个，不够收完全场） */
function snapAllFuses(state, ms) {
  if (!state.hellReady) return 0;
  const target = Math.max(0, finite(ms, 0));
  let count = 0;
  (state.hellSoulfires || []).forEach((fire) => {
    if (fire.fuseMs > target) { fire.fuseMs = target; count += 1; }
  });
  return count;
}

/** 镇魂：+1 层业火，罪值下降；「镇魂爆」由 battle.js 读 hellBankFlash 结算 */
function bankSoulfire(state, fire) {
  const index = state.hellSoulfires.indexOf(fire);
  if (index < 0) return false;
  state.hellSoulfires.splice(index, 1);
  const max = Math.max(1, finite(state.hellEmberMax, EMBER_MAX_STACKS));
  const life = Math.max(500, finite(state.hellEmberLifeMs, EMBER_LIFE_MS));
  state.hellEmber.push(life);
  while (state.hellEmber.length > max) state.hellEmber.shift();
  addSin(state, SIN_ON_BANK * Math.max(0.1, finite(state.hellSinDecayMul, 1)));
  state.hellBankFlash = { x: fire.x, y: fire.y, ms: 260 };
  state.hellBankCount = finite(state.hellBankCount, 0) + 1;
  state.hellQuellPending = (state.hellQuellPending || []);
  if (state.hellQuellRadius > 0) state.hellQuellPending.push({ x: fire.x, y: fire.y });
  return true;
}

function emberStacks(state) {
  return ((state && state.hellEmber) || []).length;
}

/** 主炮增伤：连击表，不是被动 */
function hellEmberDamageMul(state) {
  if (!state || !state.hellReady) return 1;
  return 1 + emberStacks(state) * Math.max(0, finite(state.hellEmberPerStack, EMBER_DAMAGE_PER_STACK));
}

/** 「无罪」：满层时免疫一次伤害并清空业火。返回 true 表示这次伤害被吃掉了 */
function consumeHellAbsolution(state) {
  if (!state || !state.hellReady || !state.hellAbsolution) return false;
  if (finite(state.hellAbsolutionCdMs, 0) > 0) return false;
  const max = Math.max(1, finite(state.hellEmberMax, EMBER_MAX_STACKS));
  if (emberStacks(state) < max) return false;
  state.hellEmber = [];
  state.hellAbsolutionCdMs = 12000;
  state.hellAbsolutionFlashMs = 420;
  return true;
}

/** 「赦令」：击杀亡魂返还一层业火。仍然**不产生魂火** */
function onRevenantKilled(state) {
  if (!state || !state.hellReady || !state.hellPardon) return;
  const max = Math.max(1, finite(state.hellEmberMax, EMBER_MAX_STACKS));
  const life = Math.max(500, finite(state.hellEmberLifeMs, EMBER_LIFE_MS));
  state.hellEmber.push(life);
  while (state.hellEmber.length > max) state.hellEmber.shift();
}

/** battle.js 每帧取走待生成的亡魂请求 */
function consumeHellRevenantRequests(state) {
  if (!state || !state.hellReady) return [];
  const queue = state.hellRevenantQueue || [];
  state.hellRevenantQueue = [];
  return queue;
}

/** battle.js 每帧取走「镇魂爆」的爆点 */
function consumeHellQuellPoints(state) {
  if (!state || !state.hellReady) return [];
  const queue = state.hellQuellPending || [];
  state.hellQuellPending = [];
  return queue;
}

function updateHellfire(state, dt) {
  initHellfire(state);
  const step = Math.max(0, finite(dt, 0));
  const bankR = Math.max(6, finite(state.hellBankRadius, BANK_RADIUS));
  const p = playerCenter(state);

  state.hellAbsolutionCdMs = Math.max(0, finite(state.hellAbsolutionCdMs, 0) - step);
  state.hellAbsolutionFlashMs = Math.max(0, finite(state.hellAbsolutionFlashMs, 0) - step);
  if (state.hellBankFlash) {
    state.hellBankFlash.ms -= step;
    if (state.hellBankFlash.ms <= 0) state.hellBankFlash = null;
  }
  if (state.hellRiseFlash) {
    state.hellRiseFlash.ms -= step;
    if (state.hellRiseFlash.ms <= 0) state.hellRiseFlash = null;
  }

  // 业火：每层独立计时，掉层不是整体清零
  for (let i = state.hellEmber.length - 1; i >= 0; i -= 1) {
    state.hellEmber[i] -= step;
    if (state.hellEmber[i] <= 0) state.hellEmber.splice(i, 1);
  }

  // 刑官光环：范围内的引信按 2× 烧
  const wardens = (state.enemies || []).filter((e) => e && e.hellWardenAura > 0 && e.hp > 0);

  state.hellSoulfires.slice().forEach((fire) => {
    fire.pulse = (fire.pulse + step * 0.006) % (Math.PI * 2);
    let rate = 1;
    for (let i = 0; i < wardens.length; i += 1) {
      const wc = { x: wardens[i].x + wardens[i].w / 2, y: wardens[i].y + wardens[i].h / 2 };
      if (Math.hypot(wc.x - fire.x, wc.y - fire.y) <= wardens[i].hellWardenAura) { rate = 2; break; }
    }
    fire.burning = rate > 1;
    fire.fuseMs -= step * rate;
    if (Math.hypot(p.x - fire.x, p.y - fire.y) <= bankR) { bankSoulfire(state, fire); return; }
    if (fire.fuseMs <= 0) igniteSoulfire(state, fire);
  });

  state.hellEmberStacks = emberStacks(state);
  state.hellEmberMul = hellEmberDamageMul(state);
  state.hellSoulfireCount = state.hellSoulfires.length;
  state.hellRevenantCount = liveRevenants(state);
}

const hellfireRevenant = {
  id: "hellfireRevenant",
  name: "业火回魂",
  devModes: [
    { v: "auto", label: "正常回路" },
    { v: "purge", label: "清空场面" },
    { v: "flood", label: "引信立刻烧完" },
  ],
  fields: {
    hellReady: false,
    hellSoulfires: null,
    hellRevenantQueue: null,
    hellQuellPending: null,
    hellEmber: null,
    hellNextId: 1,
    hellSin: SIN_START,
    hellBankCount: 0,
    hellRiseCount: 0,
    hellEmberStacks: 0,
    hellEmberMul: 1,
    hellSoulfireCount: 0,
    hellRevenantCount: 0,
    hellBankFlash: null,
    hellRiseFlash: null,
    // 词条写入的调节量
    hellBankRadius: BANK_RADIUS,
    hellFuseBonusMs: 0,
    hellFuseMul: 1,
    hellEmberMax: EMBER_MAX_STACKS,
    hellEmberLifeMs: EMBER_LIFE_MS,
    hellEmberPerStack: EMBER_DAMAGE_PER_STACK,
    hellQuellRadius: 0,
    hellQuellDamageMul: 0,
    hellAbsolution: false,
    hellAbsolutionCdMs: 0,
    hellAbsolutionFlashMs: 0,
    hellPardon: false,
    hellSinDecayMul: 1,
  },
  applyDev(state, mode) {
    initHellfire(state);
    if (mode === "purge") {
      state.hellSoulfires = [];
      state.hellRevenantQueue = [];
      return true;
    }
    if (mode === "flood") {
      state.hellSoulfires.slice().forEach((fire) => igniteSoulfire(state, fire));
      return false;
    }
    return false;
  },
  update(state, dt) { updateHellfire(state, dt); },
};

module.exports = {
  hellfireRevenant,
  initHellfire,
  updateHellfire,
  dropSoulfire,
  igniteSoulfire,
  igniteSoulfiresAt,
  snapAllFuses,
  bankSoulfire,
  emberStacks,
  hellEmberDamageMul,
  consumeHellAbsolution,
  onRevenantKilled,
  consumeHellRevenantRequests,
  consumeHellQuellPoints,
  FUSE_MS,
  BANK_RADIUS,
  EMBER_MAX_STACKS,
  EMBER_LIFE_MS,
  SOULFIRE_CAP,
  REVENANT_CAP,
  SIN_START,
  SIN_ON_RISE,
  SIN_ON_BANK,
};
