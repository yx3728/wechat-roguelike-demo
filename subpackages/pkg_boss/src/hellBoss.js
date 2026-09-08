/**
 * hellBoss.js — 阎罗（yama）
 * ----------------------------------------------------------------------------
 * 这个 Boss 的难度**由玩家在这场战斗里的表现决定**，不靠堆血量：
 *
 *   罪值 0–100（开局 20）：每次回魂 +15，每次镇魂 −6
 *     · 低罪（< 32）：只用「锁刑」，且阎罗**承伤 ×1.30**——打得干净有额外奖励
 *     · 高罪（≥ 32）：解锁「业火判决」，把玩家欠下的魂火一次性收走
 *     · 满罪（100）：立刻打出「无间」，之后重置为 50
 *
 * 走廊与位移预算都是**从真实发射出来的子弹上量的**（玩家为手指直接拖拽，按保守 700px/s）：
 *   · 锁刑：朝下的弹幕墙，缺口每一行都是 63px（已发货档位 45–89px 的紧端）
 *   · 一阶段 4 道 / 间隔 620ms / 摆幅 ±110px → 横移 209px 需 299ms，余量 299ms
 *   · 二阶段 6 道 / 间隔 480ms / 摆幅 ±140px → 横移 273px 需 390ms，余量 61ms（全作最紧）
 *   · 无间 3×4 两格安全，**至少一个安全格与玩家当前格相邻** → 最坏位移 248px
 * 这三条由 tests/hell.test.js 长期锁住；改数之前先看 docs/hell-map.md 第五节。
 * ----------------------------------------------------------------------------
 */
const { W, H } = require("../../../src/config.js");
const { igniteSoulfire } = require("../../../src/hellMechanics.js");

const HELL_BOSS_SEQUENCES = { 1: ["sentence", "hellfireVerdict"], 2: ["sentence", "hellfireVerdict", "avici"] };

/** 罪值阈值与承伤 */
const SIN_HIGH = 32;
const LOW_SIN_DAMAGE_MUL = 1.30;
/**
 * 锁刑：从阎罗身上放射、但**只朝下铺满玩家那一排**的弹幕墙，中间留一道缺口。
 *
 * 为什么不是整圈：竖屏里 Boss 在上、玩家在下，整圈弹幕的缺口一旦转到侧面，
 * 玩家那一排就是一堵没有缺口的墙——实测过，那不是难，是无解。
 * 改成朝下的扇形之后，缺口的**屏幕横坐标**就是玩家要读的唯一变量。
 */
const WAVE_BULLETS = 26;          // 一道墙的子弹数
const WAVE_GAP_PX = 59;           // 弹道间的空档；算上子弹直径后实测缺口 63px（玩家宽 32）
const WAVE_SPEED = 150;           // px/秒
const WAVE_SWING_P1 = 110;        // 一阶段缺口左右摆动幅度
const WAVE_SWING_P2 = 140;        // 二阶段摆得更开、间隔更短
/** 无间：3 列 × 4 行，2 格安全 */
const AVICI_COLS = 3;
const AVICI_ROWS = 4;
const AVICI_WARN_MS = 1500;
const AVICI_STRIKE_MS = 420;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function stepFor(dt) { return Math.min(3, Math.max(0, dt) / 16.667); }
function center(e) { return { x: e.x + e.w / 2, y: e.y + e.h / 2 }; }
function length(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function playerPoint(state) {
  const p = state && state.player;
  return p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : { x: W / 2, y: H * 0.72 };
}
function bounded(boss, p) {
  return { x: clamp(p.x, boss.w / 2 + 14, W - boss.w / 2 - 14),
    y: clamp(p.y, (boss.targetY || 90) + boss.h / 2, H * 0.42) };
}
function toward(boss, target, dt, speed) {
  const c = center(boss), d = length(c, target), amount = Math.min(d, speed * stepFor(dt));
  if (d > 0) { boss.x += ((target.x - c.x) / d) * amount; boss.y += ((target.y - c.y) / d) * amount; }
  return d <= amount + 0.01;
}

function init(boss) {
  boss.hellPhase = boss.hellPhase || 1;
  boss.hellState = boss.hellState || "idle";
  if (!Number.isFinite(boss.hellTimer)) boss.hellTimer = 900;
  boss.hellCooldowns = boss.hellCooldowns || { sentence: 0, hellfireVerdict: 0, avici: 0 };
  boss.hellClock = boss.hellClock || 0;
  boss.hellActionCounts = boss.hellActionCounts || { sentence: 0, hellfireVerdict: 0, avici: 0 };
  boss.hellWaveQueue = boss.hellWaveQueue || [];
  boss.hellVerdictQueue = boss.hellVerdictQueue || [];
}

function sinOf(state) {
  return Number.isFinite(state && state.hellSin) ? state.hellSin : 20;
}

/**
 * 招式评分。冷却中的跳过；满罪时「无间」压过一切。
 * 场上没有魂火时「业火判决」评分归零——不会空放。
 */
function chooseHellAttack(boss, state) {
  init(boss);
  const sin = sinOf(state);
  const fires = (state.hellSoulfires || []).length;
  if (sin >= 100 && boss.hellCooldowns.avici <= 0) return "avici";

  const scores = {
    sentence: 10,
    hellfireVerdict: sin >= SIN_HIGH && fires > 0 ? 8 + Math.min(10, fires * 1.6) : -99,
    avici: -99,
  };
  let best = null;
  let bestScore = -Infinity;
  Object.keys(scores).forEach((key) => {
    if (boss.hellCooldowns[key] > 0 || scores[key] < -10) return;
    let score = scores[key];
    if (!boss.hellActionCounts[key]) score += 2;
    if (boss.hellLastAttack === key) score -= 3;
    if (score > bestScore) { bestScore = score; best = key; }
  });
  return best;
}

function warnMsFor(boss, attack) {
  if (attack === "avici") return AVICI_WARN_MS;
  if (attack === "hellfireVerdict") return 1200;
  return boss.hellPhase >= 2 ? 850 : 1000;
}

/** 无间：挑两个安全格，硬约束是其中至少一个与玩家当前格相邻（含斜向） */
function planAvici(boss, state) {
  const p = playerPoint(state);
  const pc = clamp(Math.floor((p.x / W) * AVICI_COLS), 0, AVICI_COLS - 1);
  const pr = clamp(Math.floor((p.y / H) * AVICI_ROWS), 0, AVICI_ROWS - 1);
  const adjacent = [];
  for (let c = 0; c < AVICI_COLS; c += 1) {
    for (let r = 0; r < AVICI_ROWS; r += 1) {
      if (Math.abs(c - pc) <= 1 && Math.abs(r - pr) <= 1) adjacent.push({ c, r });
    }
  }
  const first = adjacent[Math.floor(Math.random() * adjacent.length)] || { c: pc, r: pr };
  const rest = [];
  for (let c = 0; c < AVICI_COLS; c += 1) {
    for (let r = 0; r < AVICI_ROWS; r += 1) {
      if (c !== first.c || r !== first.r) rest.push({ c, r });
    }
  }
  const second = rest[Math.floor(Math.random() * rest.length)] || first;
  boss.hellAviciSafe = [first, second];
  state.hellAviciSafe = boss.hellAviciSafe;
  state.hellAviciWarnMs = AVICI_WARN_MS;
  state.hellAviciWarnMaxMs = AVICI_WARN_MS;
}

function begin(boss, state, attack) {
  init(boss);
  boss.hellAttack = attack;
  boss.hellLastAttack = attack;
  boss.hellActionCounts[attack] = (boss.hellActionCounts[attack] || 0) + 1;
  boss.hellWarnMs = warnMsFor(boss, attack);
  boss.hellTimer = boss.hellWarnMs;
  boss.hellWarnProgress = 0;
  boss.hellState = "warn";
  boss.currentAttack = attack;
  if (attack === "avici") planAvici(boss, state);
  if (attack === "sentence") {
    // 缺口在两侧之间**来回摆**，不是单向转走：来回的横移距离恒定，玩家追得上；
    // 单向转走会让第 N 道墙的缺口离第 N−1 道越来越远，最后无解（实测过）。
    const waves = boss.hellPhase >= 2 ? 6 : 4;
    const spacing = boss.hellPhase >= 2 ? 480 : 620;
    const swing = boss.hellPhase >= 2 ? WAVE_SWING_P2 : WAVE_SWING_P1;
    const p = playerPoint(state);
    const home = clamp(p.x, swing + 40, W - swing - 40);
    boss.hellWaveQueue = [];
    for (let i = 0; i < waves; i += 1) {
      boss.hellWaveQueue.push({
        delayMs: i * spacing,
        gapX: clamp(home + (i % 2 === 0 ? -swing : swing), 34, W - 34),
      });
    }
  }
}

/**
 * 铺一道墙：子弹**平行下落**，不是从阎罗放射出去的扇形。
 *
 * 放射扇形的缺口会随高度收窄——实测在玩家上方 200px 处只剩 34px，比玩家本体宽不了多少，
 * 等于"站得靠上就必吃伤害"。平行下落让缺口在**每一行都是同一个宽度**，
 * 玩家读一次就够，也让 WAVE_GAP_PX 这个数字是可以直接量出来的。
 */
function fireSentenceWave(boss, state, fireFn, wave) {
  const c = center(boss);
  const speed = WAVE_SPEED / 60;              // px/帧（battle 按帧推进，60fps 基准）
  const half = WAVE_GAP_PX / 2;
  const span = W + 80;
  for (let i = 0; i < WAVE_BULLETS; i += 1) {
    const x = -40 + (span * i) / (WAVE_BULLETS - 1);
    if (Math.abs(x - wave.gapX) < half) continue;   // 缺口
    fireFn({
      x: x - 6, y: c.y + boss.h * 0.4, w: 12, h: 12,
      vx: 0, vy: speed,
      dmg: 1.4, color: "#ff3b30", hellBullet: true, hellWave: true,
    });
  }
}

function releaseAction(boss, state, fireFn) {
  const attack = boss.hellAttack;
  if (attack === "sentence") {
    boss.hellState = "cast";
    boss.hellCastMs = 0;
    return;
  }
  if (attack === "hellfireVerdict") {
    // 按距玩家由近及远依次点燃：不产生新弹幕，把欠的账收走
    const p = playerPoint(state);
    const list = (state.hellSoulfires || []).slice()
      .sort((a, b) => length(a, p) - length(b, p));
    boss.hellVerdictQueue = list;
    boss.hellVerdictTimer = 0;
    boss.hellState = "verdict";
    boss.hellTimer = 350 * list.length + 400;
    return;
  }
  if (attack === "avici") {
    boss.hellState = "strike";
    boss.hellTimer = AVICI_STRIKE_MS;
    state.hellAviciWarnMs = 0;
    state.hellAviciStrikeMs = AVICI_STRIKE_MS;
    const cw = W / AVICI_COLS, ch = H / AVICI_ROWS;
    const safe = boss.hellAviciSafe || [];
    for (let c = 0; c < AVICI_COLS; c += 1) {
      for (let r = 0; r < AVICI_ROWS; r += 1) {
        if (safe.some((s) => s.c === c && s.r === r)) continue;
        fireFn({
          x: c * cw, y: r * ch, w: cw, h: ch, vx: 0, vy: 0,
          dmg: 2.4, color: "#ff3b30", hellBullet: true, hellAvici: true,
          hellLinger: true, hellLingerMs: 0, hellBurnMs: AVICI_STRIKE_MS,
        });
      }
    }
    state.hellSin = 50;
    return;
  }
  boss.hellState = "idle";
}

function updateHellBoss(boss, delta, state, fireFn) {
  const dt = Math.max(0, delta);
  init(boss);
  boss.hellClock += dt;

  // 入场
  if (!boss.entered) {
    boss.y += boss.speed;
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY; boss.entered = true;
      boss.homeX = W / 2 - boss.w / 2; boss.homeY = boss.targetY;
      boss.hellState = "idle"; boss.hellTimer = 900;
    }
    return;
  }

  // 罪值决定承伤：打得干净的玩家面对的是一个多吃 30% 伤害的阎罗
  const sin = sinOf(state);
  boss.hellSinShown = sin;
  boss.damageTakenMul = sin < SIN_HIGH ? LOW_SIN_DAMAGE_MUL : 1;

  // 二阶段
  if (boss.hellPhase === 1 && boss.hp <= boss.maxHp * 0.5) {
    boss.hellPhase = 2;
    boss.hellState = "transition";
    boss.hellTimer = 1200;
    boss.hellWaveQueue = [];
    state.hellSinDecayMul = 0.6;
  }

  Object.keys(boss.hellCooldowns).forEach((key) => {
    boss.hellCooldowns[key] = Math.max(0, boss.hellCooldowns[key] - dt);
  });
  if (state.hellAviciWarnMs > 0) state.hellAviciWarnMs = Math.max(0, state.hellAviciWarnMs - dt);
  if (state.hellAviciStrikeMs > 0) state.hellAviciStrikeMs = Math.max(0, state.hellAviciStrikeMs - dt);

  if (boss.hellState === "transition") {
    boss.hellTimer -= dt;
    if (boss.hellTimer <= 0) { boss.hellState = "idle"; boss.hellTimer = 500; }
    return;
  }

  if (boss.hellState === "warn") {
    boss.hellTimer -= dt;
    boss.hellWarnProgress = clamp(1 - boss.hellTimer / Math.max(1, boss.hellWarnMs), 0, 1);
    // 预警期间不位移：读表的时候位置不能变
    if (boss.hellTimer <= 0) releaseAction(boss, state, fireFn);
    return;
  }

  if (boss.hellState === "cast") {
    boss.hellCastMs += dt;
    while (boss.hellWaveQueue.length > 0 && boss.hellWaveQueue[0].delayMs <= boss.hellCastMs) {
      fireSentenceWave(boss, state, fireFn, boss.hellWaveQueue.shift());
    }
    if (boss.hellWaveQueue.length === 0) {
      boss.hellState = "recover"; boss.hellTimer = 700;
      boss.hellCooldowns.sentence = boss.hellPhase >= 2 ? 6200 : 7500;
    }
    return;
  }

  if (boss.hellState === "verdict") {
    boss.hellTimer -= dt;
    boss.hellVerdictTimer -= dt;
    if (boss.hellVerdictTimer <= 0 && boss.hellVerdictQueue.length > 0) {
      igniteSoulfire(state, boss.hellVerdictQueue.shift());
      boss.hellVerdictTimer = 350;
    }
    if (boss.hellTimer <= 0 || (boss.hellVerdictQueue.length === 0 && boss.hellVerdictTimer <= 0)) {
      boss.hellVerdictQueue = [];
      boss.hellState = "recover"; boss.hellTimer = 800;
      boss.hellCooldowns.hellfireVerdict = boss.hellPhase >= 2 ? 11000 : 14000;
    }
    return;
  }

  if (boss.hellState === "strike") {
    boss.hellTimer -= dt;
    if (boss.hellTimer <= 0) {
      boss.hellState = "recover"; boss.hellTimer = 900;
      boss.hellCooldowns.avici = 16000;
      state.hellAviciSafe = null;
    }
    return;
  }

  if (boss.hellState === "recover") {
    boss.hellTimer -= dt;
    // 收招期间缓慢游走，玩家有输出窗口
    const p = playerPoint(state);
    toward(boss, bounded(boss, { x: W - p.x, y: (boss.targetY || 90) + boss.h / 2 + 30 }), dt, 1.1);
    if (boss.hellTimer <= 0) { boss.hellState = "idle"; boss.hellTimer = boss.hellPhase >= 2 ? 420 : 620; }
    return;
  }

  // idle：游走并挑下一招
  boss.hellTimer -= dt;
  const p = playerPoint(state);
  toward(boss, bounded(boss, { x: p.x, y: (boss.targetY || 90) + boss.h / 2 }), dt, 1.4);
  if (boss.hellTimer <= 0) {
    const attack = chooseHellAttack(boss, state);
    if (attack) begin(boss, state, attack);
    else boss.hellTimer = 400;
  }
}

module.exports = { updateHellBoss, HELL_BOSS_SEQUENCES, SIN_HIGH, LOW_SIN_DAMAGE_MUL,
  WAVE_BULLETS, WAVE_GAP_PX, WAVE_SWING_P1, WAVE_SWING_P2, AVICI_COLS, AVICI_ROWS, AVICI_WARN_MS };
