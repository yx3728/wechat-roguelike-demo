/**
 * bossAi.js
 * ----------------------------------------------------------------------------
 * 终极 Boss 复杂 AI。包含 9 个招式，按血量百分比解锁不同招式池。
 *
 * 调整入口：
 *   - ATTACK_POOLS：四个阶段每个阶段可用招式
 *   - ATTACKS：每个招式的持续时间、子弹/移动逻辑
 *   - pickAttack：选招逻辑（默认按阶段池随机抽，但不会连出同一招）
 *   - updateBoss：被 battle.js 每帧调用的入口
 *
 * Boss 字段（在 enemies.js createBoss 中初始化）：
 *   entered           是否已入场
 *   homeX/homeY       默认停驻位置
 *   currentAttack     当前招式 id
 *   attackElapsed     当前招式已持续 ms
 *   attackTimer       下个招式倒计时（招式间空档）
 *   attackBurstTimer  招式内子弹时序计时
 *   attackBurstCount  招式内已发射波数
 *   aiSubPhase        招式内子状态（如冲撞的 anchor/diving/returning）
 *   movePhase         水平摆动相位
 * ----------------------------------------------------------------------------
 */

const { W, H } = require("../../../src/config.js");
const { updateGrasslandBoss, GRASS_BOSS_SEQUENCES } = require("./grasslandBoss.js");
const { updateHellBoss, HELL_BOSS_SEQUENCES } = require("./hellBoss.js");

// Boss 全屏活动范围（留 60px 给上方 HUD，底部留 180px 给玩家飞行）
const ROAM_TOP = 60;
const ROAM_BOTTOM_MARGIN = 180;

/** 引力陷阱 / 分身 出场渐变（不参与战斗逻辑常量导出） */
const VOID_TRAP_INTRO_MS = 900;
/** 持续时间结束后：退场渐变（缩放/淡出，与 HUD 绘制对齐） */
const VOID_TRAP_OUTRO_MS = 820;
const VOID_MIRROR_INTRO_MS = 760;

/** 已废弃：黑洞改为三球同时生成后飞向 Boss 公转（保留常量避免 pump 队列旧存档误用） */
const VOID_TRAP_STAGGER_SPAWN_MS = 480;

/** 虚空核心招式轮换：从 battle 写入 voidCoreCombatStartAt 起按全局 elapsed 切片（与过场对齐） */
const VOID_CORE_SLOT_MS = 2600;
/** 二阶段核心本体移动速度倍率（+60%） */
const VOID_CORE_MOVE_SPEED_MUL = 1.6;
/** 虚空核心血量阈值移速：<80% 再 +20%；<20% 在前者基础上再 +30% */
const VOID_CORE_SPEED_UP_LOW80 = 1.2;
const VOID_CORE_SPEED_UP_LOW20 = 1.3;
/** 低于该血量占比：招式轮换在四式基础上追加「场内随机冲撞」槽（仍为同一套时间切片） */
const VOID_CORE_RAM_SLOT_HP_RATIO = 0.5;
/** 冲撞模式基底步长（与 moveToward 一致，再叠 voidCoreMoveMul） */
const VOID_CORE_BERSERK_RAM_SPEED = 7.1;

function clearVoidGravityTrapsSpawnQueueOnly(boss) {
  boss._voidTrapSpawnQueue = null;
  boss._voidTrapSpawnTemplate = null;
  boss._voidTrapSpawnTimerMs = 0;
}

function clearVoidGravityTrapsFull(boss, state) {
  state.voidGravityTraps = [];
  clearVoidGravityTrapsSpawnQueueOnly(boss);
}

/** 逐个补全待生成的引力陷阱（与三连技能绑定在 boss._voidTrapSpawnQueue） */
function pumpVoidTrapSpawnQueue(boss, state, delta) {
  const q = boss._voidTrapSpawnQueue;
  const tmpl = boss._voidTrapSpawnTemplate;
  if (!q || q.length === 0 || !tmpl) return;
  const stagger = VOID_TRAP_STAGGER_SPAWN_MS;
  boss._voidTrapSpawnTimerMs = (boss._voidTrapSpawnTimerMs != null
    ? boss._voidTrapSpawnTimerMs
    : stagger) - delta;
  while (boss._voidTrapSpawnTimerMs <= 0 && q.length > 0) {
    const pt = q.shift();
    state.voidGravityTraps.push({
      x: pt.x,
      y: pt.y,
      r: tmpl.r,
      influenceR: tmpl.influenceR,
      strengthMul: tmpl.strengthMul,
      ms: tmpl.ms,
      introMsRemain: VOID_TRAP_INTRO_MS,
      introDurMs: VOID_TRAP_INTRO_MS,
    });
    boss._voidTrapSpawnTimerMs += stagger;
  }
  if (q.length === 0) clearVoidGravityTrapsSpawnQueueOnly(boss);
}

function getRoamBounds(boss) {
  return {
    minX: 10,
    maxX: W - boss.w - 10,
    minY: ROAM_TOP,
    maxY: H - boss.h - ROAM_BOTTOM_MARGIN,
  };
}

/**
 * Lissajous 风格 2D 漫游：先算目标点（cx,cy + sin），再以**有限速度**逼近，
 * 避免招式切换时不同振幅/频率导致目标点突变 → 视觉上的瞬移。
 */
function roam(boss, delta, fx, fy, ampXRatio, ampYRatio, phaseOffset, stepMul) {
  boss.movePhase += delta * 0.001;
  const b = getRoamBounds(boss);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const ampX = ((b.maxX - b.minX) / 2) * (ampXRatio == null ? 1 : ampXRatio);
  const ampY = ((b.maxY - b.minY) / 2) * (ampYRatio == null ? 0.7 : ampYRatio);
  const ph = phaseOffset || 0;
  const tx = cx + Math.sin(boss.movePhase * fx) * ampX;
  const ty = cy + Math.sin(boss.movePhase * fy + ph) * ampY;

  // 按帧时间限制最大移动距离（约 ~190 px/s），使位置变化连贯；stepMul 供二阶段核心加速漫游
  const sm = stepMul == null || stepMul <= 0 ? 1 : stepMul;
  const maxStep = (delta / 16) * 3 * sm;
  const dx = tx - boss.x;
  const dy = ty - boss.y;
  const len = Math.hypot(dx, dy);
  if (len <= maxStep || len === 0) {
    boss.x = tx;
    boss.y = ty;
  } else {
    boss.x += (dx / len) * maxStep;
    boss.y += (dy / len) * maxStep;
  }
}

function defaultMove(boss, delta) {
  roam(boss, delta, 1, 0.6, 1, 0.55, Math.PI / 2);
}

function aimAt(boss, state) {
  const cx = boss.x + boss.w / 2;
  const cy = boss.y + boss.h / 2;
  const px = state.player.x + state.player.w / 2;
  const py = state.player.y + state.player.h / 2;
  return Math.atan2(py - cy, px - cx);
}

// ---------------------------------------------------------------------------
//  热度网格（红 / 蓝 / 旱魃共用）
//  3×3 衰减网格记录玩家常待的位置，用来做"反制走位"：
//  缺口开在常驻区的反面、场地技盖在常驻区上。惩罚龟缩，但仍然全程有预警。
// ---------------------------------------------------------------------------

function ensureBossHeat(boss) {
  if (!boss.bossHeat) boss.bossHeat = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  return boss.bossHeat;
}

/** 每帧采样玩家所在格并整体衰减 */
function updateBossHeat(boss, delta, state) {
  const heat = ensureBossHeat(boss);
  const decay = Math.pow(0.9995, delta);
  for (let i = 0; i < 9; i += 1) heat[i] *= decay;
  const pl = state && state.player;
  if (!pl) return;
  const gx = clamp(Math.floor(((pl.x + pl.w / 2) / W) * 3), 0, 2);
  const gy = clamp(Math.floor(((pl.y + pl.h / 2) / H) * 3), 0, 2);
  heat[gy * 3 + gx] += delta;
}

/** 玩家最常待的列（0/1/2）——缺口就开在它的反面 */
function hottestColumn(boss) {
  const heat = ensureBossHeat(boss);
  let best = 0;
  let bestV = -1;
  for (let c = 0; c < 3; c += 1) {
    const v = heat[c] + heat[3 + c] + heat[6 + c];
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

/** 玩家常驻列的反面（0 或 2）；玩家在中间时随机取一侧 */
function coldColumn(boss) {
  const hot = hottestColumn(boss);
  if (hot === 0) return 2;
  if (hot === 2) return 0;
  return Math.random() < 0.5 ? 0 : 2;
}

/** 玩家最常待格子的中心点（像素）——场地技就盖这里 */
function hottestCell(boss) {
  const heat = ensureBossHeat(boss);
  let bi = 4;
  let bv = -1;
  for (let i = 0; i < 9; i += 1) if (heat[i] > bv) { bv = heat[i]; bi = i; }
  const gx = bi % 3;
  const gy = Math.floor(bi / 3);
  return { x: (gx + 0.5) * (W / 3), y: (gy + 0.5) * (H / 3) };
}

// ---------------------------------------------------------------------------
//  过热破绽（红 / 蓝 / 旱魃共用）
//  一整套连招打完后强制硬直：不出招、受到伤害翻倍（battle.js 读 damageTakenMul），
//  Boss 周围画脉动光环提示"现在可以打"。让战斗有"压制 → 破绽"的呼吸感。
// ---------------------------------------------------------------------------

function enterOverheat(boss, ms, dmgMul) {
  boss.overheatMs = ms;
  boss.overheatDmgMul = dmgMul;
  boss.hanbaOverheat = true;      // battle.js drawBossOverheat 读这个字段画光环
  boss.damageTakenMul = dmgMul;
}

/** 推进过热计时；返回 true 表示本帧仍在破绽中（调用方应直接 return） */
function tickOverheat(boss, delta) {
  if (!(boss.overheatMs > 0)) {
    if (boss.hanbaOverheat) {
      boss.hanbaOverheat = false;
      boss.damageTakenMul = 1;
    }
    return false;
  }
  boss.overheatMs -= delta;
  boss.hanbaOverheat = true;
  boss.damageTakenMul = boss.overheatDmgMul || 1.6;
  if (boss.overheatMs <= 0) {
    boss.overheatMs = 0;
    boss.hanbaOverheat = false;
    boss.damageTakenMul = 1;
    return false;
  }
  return true;
}

/**
 * ---------------------------------------------------------------------------
 *  弹幕可读性原则（改招式前先读这段）
 * ---------------------------------------------------------------------------
 *  "密"和"难"是两回事。可以很密，但必须始终存在一条**看得见、跟得上**的安全通道，
 *  否则玩家只能靠回血硬吃，走位就失去了意义。三条硬规矩：
 *
 *  1. 环形弹必须留缺口扇区（GAP），且缺口要**连续、缓慢移动**，不能每轮随机换位置。
 *  2. 每轮的旋转量要和弹间距成简单比例，否则后一环会把前一环的缝正好填死
 *     （反面教材：14 发环形、间距 0.449 rad，却每轮转 0.35 rad）。
 *  3. **不要用 Math.random 抖基准角**。随机 = 不可读 = 只能靠运气，
 *     要抖就用 elapsed 的正弦，玩家能预判。
 *
 *  减弹不是唯一解：加缺口的同时缩短发射间隔，总弹量不变、压力不变，但有解了。
 * ---------------------------------------------------------------------------
 */

/** 环形弹的缺口扇区：跳过从 gapStart 起连续 gapCount 发，形成一条可跟随的通道 */
function inGapSector(i, N, gapStart, gapCount) {
  for (let k = 0; k < gapCount; k += 1) {
    if (i === (((gapStart + k) % N) + N) % N) return true;
  }
  return false;
}

const ATTACKS = {
  // ---------- 阶段 1：基础压力 ----------
  aimedTriple: {
    duration: 1800,
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 320;
      if (boss.attackBurstCount >= 4) return;
      boss.attackBurstCount += 1;
      const ang = aimAt(boss, state);
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h;
      [-0.18, 0, 0.18].forEach((off) => {
        fireFn({
          x: cx - 4, y: cy, w: 8, h: 8,
          vx: Math.cos(ang + off) * 5,
          vy: Math.sin(ang + off) * 5,
          dmg: 1,
        });
      });
    },
    move: defaultMove,
  },

  ringSpin: {
    duration: 2400,
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      // 间隔 240→200：缺口少掉的弹量用更密的轮次补回来，总弹量反而略增
      boss.attackBurstTimer = 200;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h / 2;
      const N = 14;
      // 每轮正好转一个弹位（2π/N），缺口因此在空间上连成一条稳定的螺旋通道
      const baseAng = boss.attackBurstCount * ((Math.PI * 2) / N);
      // 缺口每 3 轮挪一位：够慢，玩家跟得上
      const gapStart = Math.floor(boss.attackBurstCount / 3);
      boss.attackBurstCount += 1;
      for (let i = 0; i < N; i += 1) {
        if (inGapSector(i, N, gapStart, 2)) continue;
        const ang = baseAng + (i / N) * Math.PI * 2;
        fireFn({
          x: cx - 4, y: cy, w: 7, h: 9,
          vx: Math.cos(ang) * 3.2, vy: Math.sin(ang) * 3.2,
          dmg: 1,
        });
      }
    },
    move(boss, delta) {
      roam(boss, delta, 0.8, 0.5, 1, 0.6);
    },
  },

  fanSweep: {
    duration: 2200,
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 80;
      const t = (boss.attackElapsed / 2200) * Math.PI * 2;
      const baseAng = Math.PI / 2 + Math.sin(t) * 0.8;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h;
      [-0.1, 0, 0.1].forEach((d) => {
        const ang = baseAng + d;
        fireFn({
          x: cx - 4, y: cy, w: 7, h: 9,
          vx: Math.cos(ang) * 4.5, vy: Math.sin(ang) * 4.5,
          dmg: 1,
        });
      });
    },
    move(boss, delta) {
      roam(boss, delta, 1.5, 0.9, 1, 0.5);
    },
  },

  // ---------- 阶段 2：节奏控制 ----------
  walledBarrier: {
    duration: 3000,
    onStart(boss) { boss.wallGap1 = undefined; boss.wallVolley = 0; },
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 300;

      // 一整道横排弹幕，留两个间隙。缺口**每轮只挪一格**（不再随机瞬移），
      // 这样连续几道墙的缝会连成一条斜向通道，玩家可以跟着走位穿过去。
      // 缺口宽度与漂移速度都要考虑"玩家同时面对两道墙"：
      //   · 1 格缺口（W/12≈32px）扣掉弹体与判定后可穿宽度几乎为零，看着有缝其实过不去；
      //   · 缺口每轮都漂 1 格的话，前后两道墙的缝错开，交集实测只剩 8px。
      // 所以：格数细分到 14（单格更窄）、缺口占 3 格（≈84px）、**每两轮才漂一格**。
      const N = 14;
      const GAP_W = 3;
      if (typeof boss.wallGap1 !== "number") {
        // 起手缺口开在玩家常驻列的反面：龟缩在角落会被逼着横穿全场
        const cold = coldColumn(boss);
        boss.wallGap1 = clamp(
          Math.floor(((cold + 0.5) / 3) * N) - 1,
          0, N - 1,
        );
        boss.wallGap2 = (boss.wallGap1 + 7) % N;
        boss.wallDrift = Math.random() < 0.5 ? -1 : 1;
        boss.wallVolley = 0;
      } else {
        boss.wallVolley = (boss.wallVolley || 0) + 1;
        if (boss.wallVolley % 2 === 0) {
          boss.wallGap1 = ((boss.wallGap1 + boss.wallDrift) % N + N) % N;
          boss.wallGap2 = ((boss.wallGap2 + boss.wallDrift) % N + N) % N;
        }
      }
      const cy = boss.y + boss.h;
      for (let i = 0; i < N; i += 1) {
        if (inGapSector(i, N, boss.wallGap1, GAP_W)) continue;
        if (inGapSector(i, N, boss.wallGap2, GAP_W)) continue;
        const x = (i + 0.5) * (W / N);
        fireFn({ x: x - 4, y: cy, w: 8, h: 8, vx: 0, vy: 4, dmg: 1 });
      }
    },
    move: defaultMove,
  },

  laserBeam: {
    duration: 2600,
    update(boss, delta, state, fireFn) {
      // 0~700ms 锁定瞄准（外部可读 boss.bossLaserWarn 显示警告）
      if (boss.attackElapsed < 700) {
        boss.bossLaserWarn = true;
        boss.bossLaserAng = aimAt(boss, state);
        return;
      }
      boss.bossLaserWarn = false;
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 55;
      const ang = boss.bossLaserAng;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h;
      [-0.04, 0, 0.04].forEach((d) => {
        fireFn({
          x: cx - 4, y: cy, w: 6, h: 8,
          vx: Math.cos(ang + d) * 7,
          vy: Math.sin(ang + d) * 7,
          dmg: 1,
        });
      });
    },
    move: defaultMove,
  },

  // ---------- 阶段 3：进阶招式 ----------
  crossSpiral: {
    duration: 3200,
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 130;
      const baseAng = boss.attackElapsed * 0.005;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h / 2;
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((off) => {
        const ang = baseAng + off;
        fireFn({
          x: cx - 4, y: cy, w: 8, h: 9,
          vx: Math.cos(ang) * 4, vy: Math.sin(ang) * 4,
          dmg: 1,
        });
      });
    },
    move(boss, delta) {
      roam(boss, delta, 1.2, 1.8, 0.9, 0.8);
    },
  },

  diveBomb: {
    duration: 2400,
    onStart(boss) {
      boss.aiSubPhase = "anchor";
      boss.aiSubTimer = 500;
    },
    update(boss, delta, state, fireFn) {
      // 收尾爆破：返回时绕一圈圆形弹
      if (boss.aiSubPhase === "returning" && boss.attackBurstCount === 0) {
        boss.attackBurstCount = 1;
        const cx = boss.x + boss.w / 2;
        const cy = boss.y + boss.h / 2;
        for (let i = 0; i < 14; i += 1) {
          const ang = (i / 14) * Math.PI * 2;
          fireFn({
            x: cx - 4, y: cy, w: 7, h: 9,
            vx: Math.cos(ang) * 3.6, vy: Math.sin(ang) * 3.6,
            dmg: 1,
          });
        }
      }
    },
    move(boss, delta, state) {
      const targetX = state.player.x + state.player.w / 2 - boss.w / 2;
      const targetY = state.player.y + state.player.h / 2 - boss.h / 2;

      if (boss.aiSubPhase === "anchor") {
        boss.preDiveWarn = true;
        boss.aiSubTimer -= delta;
        if (boss.aiSubTimer <= 0) {
          boss.dashTargetX = Math.max(20, Math.min(W - boss.w - 20, targetX));
          boss.dashTargetY = Math.max(40, Math.min(H - boss.h - 140, targetY));
          boss.aiSubPhase = "diving";
        }
        return;
      }

      if (boss.aiSubPhase === "diving") {
        const dx = boss.dashTargetX - boss.x;
        const dy = boss.dashTargetY - boss.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 9;
        if (len < speed) {
          boss.x = boss.dashTargetX;
          boss.y = boss.dashTargetY;
          boss.aiSubPhase = "returning";
          return;
        }
        boss.x += (dx / len) * speed;
        boss.y += (dy / len) * speed;
        return;
      }

      if (boss.aiSubPhase === "returning") {
        const dx = boss.homeX - boss.x;
        const dy = boss.homeY - boss.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 4.5;
        if (len < speed) {
          boss.x = boss.homeX;
          boss.y = boss.homeY;
        } else {
          boss.x += (dx / len) * speed;
          boss.y += (dy / len) * speed;
        }
      }
    },
  },

  summonAdds: {
    duration: 700,
    update(boss, delta, state, fireFn, spawnFn) {
      if (boss.attackBurstCount === 0) {
        boss.attackBurstCount = 1;
        const count = 3;
        for (let i = 0; i < count; i += 1) {
          if (typeof spawnFn === "function") spawnFn();
        }
      }
    },
    move: defaultMove,
  },

  // ---------- 阶段 4：濒死狂暴 ----------
  omniBurst: {
    duration: 4200,
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      // 残血期的绝望技，弹量最大，所以缺口必须最稳。
      //
      // 关键：缺口要定义在**世界坐标系**里，不能跟着环一起转。
      // 这一招同时有二三十代弹在飞，如果缺口随环旋转，各代楔形指向早已差出几百度，
      // 彼此把对方的缝填死（实测只剩 8~12px 可穿）。把缺口钉在世界角度上，
      // 所有世代让开的是**同一条走廊**，它只随时间缓慢摆动，玩家跟得住。
      boss.attackBurstTimer = 79;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h / 2;
      const N = 18;
      // 每轮转半个弹位：快慢两层交错成网格
      const baseAng = boss.attackBurstCount * ((Math.PI * 2) / N) * 0.5;
      // 世界坐标系里的走廊：朝下为中心，整招内缓慢左右摆约 ±60°
      const gapCenter = Math.PI / 2 + Math.sin(boss.attackElapsed * 0.00075) * 1.05;
      const GAP_HALF = 0.52;   // 半宽 ≈ 30°，总宽 ≈ 60°
      boss.attackBurstCount += 1;
      const v = boss.attackBurstCount % 2 === 0 ? 3.4 : 4.6;
      for (let i = 0; i < N; i += 1) {
        const ang = baseAng + (i / N) * Math.PI * 2;
        let d = ang - gapCenter;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < GAP_HALF) continue;
        fireFn({
          x: cx - 4, y: cy, w: 7, h: 9,
          vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
          dmg: 1,
        });
      }
    },
    // 走廊是以 Boss 当前位置为原点算的，所以放这招时**必须站定**：
    // 原本大幅漫游（振幅 1 / 1.5）会让先后发射的弹各自朝着不同原点扩散，
    // 世界坐标系里的那条走廊被自己的位移抹平（实测只剩 8px）。
    move(boss, delta) {
      roam(boss, delta, 0.35, 0.25, 0.18, 0.12, 0);
    },
  },
};

const ATTACK_POOLS = {
  1: ["aimedTriple", "ringSpin", "fanSweep"],
  2: ["ringSpin", "fanSweep", "walledBarrier", "aimedTriple", "laserBeam"],
  3: ["crossSpiral", "diveBomb", "summonAdds", "fanSweep", "laserBeam", "walledBarrier"],
  4: ["omniBurst", "diveBomb", "crossSpiral", "ringSpin", "summonAdds", "walledBarrier", "laserBeam"],
};

/**
 * 红 Boss 的连招表。ATTACK_POOLS 保留（别处仍在引用），但实际调度走这里：
 * 招式成组打出，前一招把玩家赶进后一招的杀伤区，打完一整套进入过热破绽。
 */
const CLASSIC_COMBOS = {
  1: [
    { name: "试压", moves: ["aimedTriple"] },
    { name: "扫环", moves: ["fanSweep", "ringSpin"] },
  ],
  2: [
    { name: "扫环", moves: ["fanSweep", "ringSpin"] },
    { name: "封路", moves: ["walledBarrier", "aimedTriple"] },
    { name: "锁定", moves: ["laserBeam", "fanSweep"] },
  ],
  3: [
    { name: "封路改", moves: ["walledBarrier", "laserBeam"] },
    { name: "俯冲战术", moves: ["summonAdds", "diveBomb"] },
    { name: "十字压制", moves: ["crossSpiral", "fanSweep", "ringSpin"] },
    { name: "锁定改", moves: ["laserBeam", "diveBomb"] },
  ],
  4: [
    { name: "终末", moves: ["omniBurst", "diveBomb"] },
    { name: "绞索", moves: ["walledBarrier", "crossSpiral", "laserBeam"] },
    { name: "群压", moves: ["summonAdds", "omniBurst"] },
    { name: "十字终", moves: ["crossSpiral", "ringSpin", "diveBomb"] },
  ],
};

/** 每招的站位意图（归一化坐标）；null = 该招自带位移，不预站位 */
const CLASSIC_ANCHOR = {
  walledBarrier: { x: 0.5, y: 0.10 },   // 顶部，弹墙才铺得满
  ringSpin:      { x: 0.5, y: 0.34 },   // 中上，环形弹展开得开
  omniBurst:     { x: 0.5, y: 0.30 },
  crossSpiral:   { x: 0.5, y: 0.34 },
  fanSweep:      { x: 0.5, y: 0.16 },
  laserBeam:     null,
  aimedTriple:   null,
  diveBomb:      null,
  summonAdds:    { x: 0.5, y: 0.14 },
};

const CLASSIC_OVERHEAT_MS = 1300;
const CLASSIC_OVERHEAT_DMG_MUL = 1.6;

function classicTier(boss) {
  const ratio = boss.hp / Math.max(1, boss.maxHp);
  if (ratio > 0.75) return 1;
  if (ratio > 0.5) return 2;
  if (ratio > 0.25) return 3;
  return 4;
}

function pickClassicCombo(boss) {
  const pool = CLASSIC_COMBOS[classicTier(boss)] || CLASSIC_COMBOS[1];
  const cand = pool.filter((c) => c.name !== boss.lastComboName);
  const arr = cand.length > 0 ? cand : pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 站位：把归一化锚点转成目标点并逼近，返回是否已到位 */
function moveToAnchorTable(boss, delta, id, table) {
  const anchor = table[id];
  if (!anchor) return true;
  const b = getRoamBounds(boss);
  const tx = clamp(anchor.x * W - boss.w / 2, b.minX, b.maxX);
  const ty = clamp(anchor.y * H, b.minY, b.maxY);
  return moveToward(boss, tx, ty, (delta / 16) * 5.2);
}

function pickAttack(boss) {
  const pool = ATTACK_POOLS[classicTier(boss)];
  const last = boss.lastAttack;
  const candidates = pool.filter((id) => id !== last);
  const arr = candidates.length > 0 ? candidates : pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

function updateBossClassic(boss, delta, state, fireFn, spawnFn) {
  boss.preDiveWarn = false;
  // 入场
  if (!boss.entered) {
    boss.y += boss.speed;
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY;
      boss.entered = true;
      boss.homeX = W / 2 - boss.w / 2;
      boss.homeY = boss.targetY;
      boss.attackTimer = 600;
      boss.comboQueue = [];
      boss.inCombo = false;
    }
    return;
  }

  updateBossHeat(boss, delta, state);

  // ---------- 过热破绽：一整套连招打完后硬直 + 易伤 ----------
  if (boss.overheatMs > 0) {
    roam(boss, delta, 0.5, 0.3, 0.35, 0.2, 0);
    if (tickOverheat(boss, delta)) return;
    boss.attackTimer = 320;
    return;
  }
  tickOverheat(boss, delta);

  if (!boss.currentAttack) {
    boss.attackTimer -= delta;

    if (!boss.comboQueue || boss.comboQueue.length === 0) {
      // 一整套打完 → 破绽窗口
      if (boss.inCombo) {
        boss.inCombo = false;
        enterOverheat(boss, CLASSIC_OVERHEAT_MS, CLASSIC_OVERHEAT_DMG_MUL);
        return;
      }
      if (boss.attackTimer > 0) { defaultMove(boss, delta); return; }
      const combo = pickClassicCombo(boss);
      boss.lastComboName = combo.name;
      boss.comboName = combo.name;
      boss.comboQueue = combo.moves.slice();
      boss.inCombo = true;
    }

    const nextId = boss.comboQueue[0];
    // 先走到该招的站位，最多多花 900ms，超时直接起手避免卡住
    const ready = moveToAnchorTable(boss, delta, nextId, CLASSIC_ANCHOR);
    if (!ready && boss.attackTimer > -900) return;

    boss.comboQueue.shift();
    boss.currentAttack = nextId;
    boss.lastAttack = nextId;
    boss.attackElapsed = 0;
    boss.attackBurstTimer = 0;
    boss.attackBurstCount = 0;
    boss.aiSubPhase = null;
    const a = ATTACKS[boss.currentAttack];
    if (a && a.onStart) a.onStart(boss);
    return;
  }

  const atk = ATTACKS[boss.currentAttack];
  boss.attackElapsed += delta;

  if (atk.move) atk.move(boss, delta, state);
  if (atk.update) atk.update(boss, delta, state, fireFn, spawnFn);

  boss.x = Math.max(10, Math.min(W - boss.w - 10, boss.x));
  boss.y = Math.max(10, Math.min(H - boss.h - ROAM_BOTTOM_MARGIN, boss.y));

  if (boss.attackElapsed >= atk.duration) {
    boss.currentAttack = null;
    // 连招内部衔接短（读作"一整套"），套与套之间才留长间隔
    boss.attackTimer = boss.comboQueue && boss.comboQueue.length > 0
      ? 240
      : 500 + Math.random() * 600;
    boss.bossLaserWarn = false;
  }
}

function moveToward(boss, tx, ty, speed) {
  const dx = tx - boss.x;
  const dy = ty - boss.y;
  const len = Math.hypot(dx, dy) || 1;
  if (len <= speed) {
    boss.x = tx;
    boss.y = ty;
    return true;
  }
  boss.x += (dx / len) * speed;
  boss.y += (dy / len) * speed;
  return false;
}

function getVoidPhase(boss) {
  const ratio = boss.hp / Math.max(1, boss.maxHp);
  if (ratio > 0.75) return 1;
  if (ratio > 0.5) return 2;
  if (ratio > 0.25) return 3;
  return 4;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 虚空核心「场内随机冲撞」招式：画布内随机选点直线冲撞 + 散射 / 三联瞄准，
 * 在血量低于 VOID_CORE_RAM_SLOT_HP_RATIO 时作为轮换中的一格出现。
 */
function updateBossVoidCoreRamCharge(boss, delta, state, fireFn, voidCoreMoveMul) {
  const b = getRoamBounds(boss);
  if (typeof boss._voidCoreRamTimer !== "number") boss._voidCoreRamTimer = 0;
  boss._voidCoreRamTimer -= delta;

  const needPick =
    boss._voidCoreRamTx == null
    || boss._voidCoreRamTy == null
    || boss._voidCoreRamTimer <= 0;

  let arrived = false;
  if (!needPick && boss._voidCoreRamTx != null && boss._voidCoreRamTy != null) {
    arrived = moveToward(boss, boss._voidCoreRamTx, boss._voidCoreRamTy, VOID_CORE_BERSERK_RAM_SPEED * voidCoreMoveMul);
  }

  if (needPick || arrived) {
    boss._voidCoreRamTx = b.minX + Math.random() * Math.max(0.001, b.maxX - b.minX);
    boss._voidCoreRamTy = b.minY + Math.random() * Math.max(0.001, b.maxY - b.minY);
    boss._voidCoreRamTimer = 260 + Math.random() * 420;
    boss.preDiveWarn = true;
    boss._voidCoreRamWarnMs = 100 + Math.random() * 100;
  }

  if ((boss._voidCoreRamWarnMs || 0) > 0) {
    boss._voidCoreRamWarnMs = Math.max(0, boss._voidCoreRamWarnMs - delta);
  } else {
    boss.preDiveWarn = false;
  }

  boss.voidCoreTentacleAng = (boss.voidCoreTentacleAng || 0) + delta * 0.0058;

  if (typeof boss._voidCoreBerserkShotCd !== "number") boss._voidCoreBerserkShotCd = 0;
  boss._voidCoreBerserkShotCd -= delta;
  const bcx = boss.x + boss.w / 2;
  const bcy = boss.y + boss.h / 2;
  if (boss._voidCoreBerserkShotCd <= 0) {
    boss._voidCoreBerserkShotCd = 62 + Math.random() * 95;
    const n = 16 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i += 1) {
      const ang = boss.voidCoreTentacleAng + (i / n) * Math.PI * 2;
      const s = 3.05 + Math.random() * 1.15;
      fireFn({
        x: bcx - 3,
        y: bcy - 3,
        w: 6,
        h: 6,
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        dmg: 1,
      });
    }
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    const aim = Math.atan2(py - bcy, px - bcx);
    [-0.12, 0, 0.12].forEach((off) => {
      fireFn({
        x: bcx - 3.5,
        y: bcy - 3.5,
        w: 7,
        h: 7,
        vx: Math.cos(aim + off) * 5.05,
        vy: Math.sin(aim + off) * 5.05,
        dmg: 1,
      });
    });
  }
}

function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/** 玩家中心是否在最终审判安全区内 */
function playerCenterInVoidSafeZone(state, safe) {
  if (!state.player || !safe || safe.w <= 0 || safe.h <= 0) return false;
  const px = state.player.x + state.player.w / 2;
  const py = state.player.y + state.player.h / 2;
  return px >= safe.x && px <= safe.x + safe.w && py >= safe.y && py <= safe.y + safe.h;
}

/** 最终审判安全区：正方形，随机直到与 Boss（含外扩边距）不重叠 */
function pickVoidJudgementSafeZone(boss, safeSide) {
  const clearance = 36;
  const bossBox = {
    x: boss.x - clearance,
    y: boss.y - clearance,
    w: boss.w + clearance * 2,
    h: boss.h + clearance * 2,
  };
  const margin = 14;
  const safeW = safeSide;
  const safeH = safeSide;
  const maxX = W - safeW - margin;
  const maxY = H - safeH - margin;
  for (let k = 0; k < 70; k += 1) {
    const sx = margin + Math.random() * Math.max(1, maxX - margin);
    const sy = margin + Math.random() * Math.max(1, maxY - margin);
    const safe = { x: sx, y: sy, w: safeW, h: safeH };
    if (!rectsOverlap(safe, bossBox)) return safe;
  }
  const fallbacks = [
    { x: margin, y: H * 0.52, w: safeW, h: safeH },
    { x: W - safeW - margin, y: H * 0.52, w: safeW, h: safeH },
    { x: (W - safeW) / 2, y: H - safeH - margin - 80, w: safeW, h: safeH },
    { x: (W - safeW) / 2, y: margin + 40, w: safeW, h: safeH },
  ];
  for (let i = 0; i < fallbacks.length; i += 1) {
    if (!rectsOverlap(fallbacks[i], bossBox)) return fallbacks[i];
  }
  return { x: margin, y: margin, w: safeW, h: safeH };
}

function shuffleCellIndices(count) {
  const a = [];
  for (let i = 0; i < count; i += 1) a.push(i);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** 三颗小黑洞：在 3×2 分区_shuffle 选房生成；出场后飞向 Boss 周缘并公转 */
function spawnVoidGravityTrapsTriple(boss, state) {
  const marginX = 34;
  const marginTop = 70;
  const marginBot = H - 120;
  const usableW = Math.max(100, W - marginX * 2);
  const usableHt = Math.max(96, marginBot - marginTop);
  const cols = 3;
  const rows = 2;
  const cellW = usableW / cols;
  const cellH = usableHt / rows;
  const minSep = 86;
  const rCore = 16;
  const influenceR = 52;
  const strengthMul = 2.05;
  const durationMs = 5000;
  const orbitRadius = 74;
  const attachDurMs = 1050;

  const order = shuffleCellIndices(cols * rows);
  const centers = [];
  for (let t = 0; t < order.length && centers.length < 3; t += 1) {
    const idx = order[t];
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const baseX = marginX + col * cellW;
    const baseY = marginTop + row * cellH;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const px = clamp(
        baseX + cellW * (0.22 + Math.random() * 0.56),
        marginX + 14,
        W - marginX - 14,
      );
      const py = clamp(
        baseY + cellH * (0.22 + Math.random() * 0.56),
        marginTop + 12,
        marginBot - 12,
      );
      let separated = true;
      for (let s = 0; s < centers.length; s += 1) {
        if (Math.hypot(px - centers[s].x, py - centers[s].y) < minSep) {
          separated = false;
          break;
        }
      }
      if (!separated) continue;
      centers.push({ x: px, y: py });
      break;
    }
  }

  if (centers.length < 3) {
    const ax = marginX + cellW * 0.55;
    const bx = marginX + cellW * 1.55;
    const cx2 = marginX + cellW * 2.45;
    const yTop = marginTop + cellH * 0.5;
    const yBot = marginTop + cellH * 1.5;
    const backups = shuffleCellIndices(3).map((i) => ([
      { x: ax, y: yTop },
      { x: bx, y: yBot },
      { x: cx2, y: marginTop + cellH * 0.92 },
    ][i]));
    for (let bi = 0; bi < backups.length && centers.length < 3; bi += 1) {
      const q = backups[bi];
      let ok = true;
      for (let s = 0; s < centers.length; s += 1) {
        if (Math.hypot(q.x - centers[s].x, q.y - centers[s].y) < minSep) {
          ok = false;
          break;
        }
      }
      if (ok) centers.push(q);
    }
    for (let k = 0; centers.length < 3 && k < 8; k += 1) {
      centers.push({
        x: clamp(marginX + usableW * (0.22 + k * 0.18), 44, W - 44),
        y: clamp(marginTop + usableHt * (0.35 + (k % 3) * 0.22), marginTop + 16, marginBot - 16),
      });
    }
  }

  const trimmed = centers.slice(0, 3);
  if (trimmed.length === 0) return;

  clearVoidGravityTrapsSpawnQueueOnly(boss);
  boss._voidTrapSpawnTemplate = null;

  state.voidGravityTraps = trimmed.map((c, slot) => ({
    x: c.x,
    y: c.y,
    spawnX: c.x,
    spawnY: c.y,
    r: rCore,
    influenceR,
    strengthMul,
    ms: durationMs,
    introMsRemain: VOID_TRAP_INTRO_MS,
    introDurMs: VOID_TRAP_INTRO_MS,
    orbitBoss: boss,
    orbitSlot: slot,
    orbitRadius,
    orbitSpeed: 0.00185 + slot * 0.00006,
    attachDurMs,
    attachMsRemain: null,
    orbitAttached: false,
  }));
}

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** 黑洞：出场动画结束后飞向 Boss 周缘，再随 Boss 公转（供弯折弹幕用 x,y） */
function updateVoidTrapOrbitPositions(state, boss, delta) {
  if (!boss || boss.hp <= 0 || !state.voidGravityTraps || state.voidGravityTraps.length === 0) return;
  const bcx = boss.x + boss.w / 2;
  const bcy = boss.y + boss.h / 2;
  const traps = state.voidGravityTraps;
  for (let i = 0; i < traps.length; i += 1) {
    const t = traps[i];
    if (!t.orbitBoss || t.orbitBoss !== boss || t.spawnX == null) continue;
    const introRem = t.introMsRemain || 0;
    if (introRem > 0) {
      t.x = t.spawnX;
      t.y = t.spawnY;
      continue;
    }
    const slot = t.orbitSlot || 0;
    const R = t.orbitRadius != null ? t.orbitRadius : 74;
    const spd = t.orbitSpeed != null ? t.orbitSpeed : 0.00185;
    const ang = state.elapsed * spd + slot * ((Math.PI * 2) / 3);
    const ox = bcx + Math.cos(ang) * R;
    const oy = bcy + Math.sin(ang) * R;
    const dur = t.attachDurMs != null ? t.attachDurMs : 1050;
    if (t.attachMsRemain == null) t.attachMsRemain = dur;
    if (!t.orbitAttached) {
      t.attachMsRemain = Math.max(0, (t.attachMsRemain || 0) - delta);
      const u = smoothstep01(1 - (dur > 0 ? t.attachMsRemain / dur : 1));
      t.x = t.spawnX + (ox - t.spawnX) * u;
      t.y = t.spawnY + (oy - t.spawnY) * u;
      if (t.attachMsRemain <= 0) t.orbitAttached = true;
    } else {
      t.x = ox;
      t.y = oy;
    }
  }
}

function ensureVoidState(boss) {
  if (!Array.isArray(boss.hatredGrid) || boss.hatredGrid.length !== 24) boss.hatredGrid = new Array(24).fill(0);
  if (!boss.voidMarkedCells) boss.voidMarkedCells = Object.create(null);
  if (typeof boss.voidStayMs !== "number") boss.voidStayMs = 0;
  if (typeof boss.voidMarkCooldownMs !== "number") boss.voidMarkCooldownMs = 0;
  if (typeof boss.voidShotTimer !== "number") boss.voidShotTimer = 0;
  if (typeof boss.voidModeTimer !== "number") boss.voidModeTimer = 0;
  if (!boss.voidMode) boss.voidMode = "fanPredict";
  if (!boss.voidPlayerTrack) boss.voidPlayerTrack = { x: 0, y: 0, vx: 0, vy: 0 };
}

function updateVoidHatred(boss, state, delta) {
  const p = state.player;
  const col = clamp(Math.floor((p.x + p.w / 2) / (W / 4)), 0, 3);
  const row = clamp(Math.floor((p.y + p.h / 2) / (H / 6)), 0, 5);
  const idx = row * 4 + col;
  boss.hatredGrid[idx] += delta;
  if (boss.voidLastCell === idx) boss.voidStayMs += delta;
  else {
    boss.voidLastCell = idx;
    boss.voidStayMs = 0;
  }
  boss.voidMarkCooldownMs = Math.max(0, boss.voidMarkCooldownMs - delta);
  if (boss.voidStayMs >= 1000 && boss.voidMarkCooldownMs <= 0) {
    boss.voidMarkedCells[idx] = true;
    boss.voidMarkCooldownMs = 1200;
  }
}

function getHatredTargets(boss, topN) {
  return boss.hatredGrid
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, Math.max(1, topN || 3))
    .map(({ i }) => ({
      idx: i,
      x: (i % 4 + 0.5) * (W / 4),
      y: (Math.floor(i / 4) + 0.5) * (H / 6),
    }));
}

function getVoidMirror(state, boss) {
  for (let i = 0; i < state.enemies.length; i += 1) {
    const e = state.enemies[i];
    if (e && e.isMirror && e.ownerBossRef === boss) return e;
  }
  return null;
}

function fireVoid(boss, state, fireFn, bullet) {
  fireFn(bullet);
  const mirror = getVoidMirror(state, boss);
  if (!mirror || mirror.hp <= 0 || ((mirror.mirrorIntroMsRemain || 0) > 0)) return;
  const bx = mirror.x + mirror.w / 2 - bullet.w / 2;
  const by = mirror.y + mirror.h / 2 - bullet.h / 2;
  fireFn(Object.assign({}, bullet, { x: bx, y: by }));
}

function spawnVoidMirror(boss, state) {
  if (getVoidMirror(state, boss)) return;
  const hpRaw = Math.max(30000, Math.floor(boss.maxHp * 0.1));
  const hp = Math.max(1, Math.floor(hpRaw / 3));
  state.enemies.push({
    type: "mirror",
    isMirror: true,
    ownerBossRef: boss,
    color: "#94a3b8",
    x: W - boss.x - boss.w,
    y: boss.y,
    w: boss.w * 0.72,
    h: boss.h * 0.72,
    hp,
    maxHp: hp,
    speed: 0,
    exp: 0,
    coin: 0,
    noItemDrop: true,
    mirrorIntroMsRemain: VOID_MIRROR_INTRO_MS,
    mirrorIntroDurMs: VOID_MIRROR_INTRO_MS,
  });
}

function fireEdgeLock(boss, fireFn) {
  const gapSide = Math.floor(Math.random() * 4);
  const gapLane = Math.floor(Math.random() * 7);
  const lanes = 7;
  for (let i = 0; i < lanes; i += 1) {
    if (gapSide === 0 && i === gapLane) continue;
    fireFn({ x: (i + 0.5) * (W / lanes) - 3, y: -6, w: 6, h: 8, vx: 0, vy: 1.8, dmg: 1 });
  }
  for (let i = 0; i < lanes; i += 1) {
    if (gapSide === 1 && i === gapLane) continue;
    fireFn({ x: (i + 0.5) * (W / lanes) - 3, y: H + 6, w: 6, h: 8, vx: 0, vy: -1.8, dmg: 1 });
  }
  for (let i = 0; i < lanes; i += 1) {
    if (gapSide === 2 && i === gapLane) continue;
    fireFn({ x: -6, y: (i + 0.5) * (H / lanes) - 3, w: 8, h: 6, vx: 1.9, vy: 0, dmg: 1 });
  }
  for (let i = 0; i < lanes; i += 1) {
    if (gapSide === 3 && i === gapLane) continue;
    fireFn({ x: W + 6, y: (i + 0.5) * (H / lanes) - 3, w: 8, h: 6, vx: -1.9, vy: 0, dmg: 1 });
  }
}

/** 引力陷阱：每帧递减；范围内同时弯折敌弹与玩家弹（加速度与 delta 成正比） */
function bendBulletsTowardTraps(bulletArr, traps, dt, state) {
  for (let i = 0; i < bulletArr.length; i += 1) {
    const b = bulletArr[i];
    if (!b || typeof b.x !== "number") continue;
    if (state && b.judgementBolt && state.finalJudgementPetalMs > 0) continue;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    let ax = 0;
    let ay = 0;
    for (let j = 0; j < traps.length; j += 1) {
      const g = traps[j];
      if ((g.introMsRemain || 0) > 0 || (g.outroMsRemain || 0) > 0 || (g.ms ?? 0) <= 0) continue;
      const influence = g.influenceR != null ? g.influenceR : g.r * 1.55;
      const dx = g.x - bx;
      const dy = g.y - by;
      const d2 = dx * dx + dy * dy;
      if (d2 > influence * influence) continue;
      const dist = Math.sqrt(d2);
      let nx; let ny;
      if (dist < 3) {
        nx = dx || 1;
        ny = dy || 0.001;
      } else {
        nx = dx / dist;
        ny = dy / dist;
      }
      const edge = influence - dist;
      const falloff = edge / influence;
      const pull = g.strengthMul != null ? g.strengthMul : 1;
      const acc = pull * dt * Math.pow(falloff, 0.92) * (0.95 + falloff * 1.55);
      ax += nx * acc;
      ay += ny * acc;
    }
    b.vx += ax;
    b.vy += ay;
  }
}

function applyVoidGravityTraps(state, delta, boss) {
  if (!Array.isArray(state.voidGravityTraps)) state.voidGravityTraps = [];
  for (let i = state.voidGravityTraps.length - 1; i >= 0; i -= 1) {
    const t = state.voidGravityTraps[i];
    const intro = t.introMsRemain || 0;
    const outro = t.outroMsRemain || 0;
    if (intro > 0) {
      t.introMsRemain = Math.max(0, intro - delta);
    } else if (outro > 0) {
      t.outroMsRemain = Math.max(0, outro - delta);
      if ((t.outroMsRemain || 0) <= 0) state.voidGravityTraps.splice(i, 1);
    } else if ((t.ms || 0) > 0) {
      t.ms -= delta;
      if ((t.ms || 0) <= 0) {
        t.ms = 0;
        t.outroMsRemain = VOID_TRAP_OUTRO_MS;
        t.outroDurMs = VOID_TRAP_OUTRO_MS;
      }
    } else {
      state.voidGravityTraps.splice(i, 1);
    }
  }
  if (state.voidGravityTraps.length === 0) return;
  if (boss) updateVoidTrapOrbitPositions(state, boss, delta);
  const dt = delta / 16;
  const traps = state.voidGravityTraps;
  if (state.enemyBullets && state.enemyBullets.length > 0) bendBulletsTowardTraps(state.enemyBullets, traps, dt, state);
  if (state.bullets && state.bullets.length > 0) bendBulletsTowardTraps(state.bullets, traps, dt, state);
}

/** 虚空最终审判：蓄力喷发 + 喷发后危险窗 + 花瓣消散期间，不产生引力陷阱也不弯折弹幕 */
function isVoidJudgementCrowdControlled(state, boss) {
  return boss.voidMode === "finalJudgement"
    || (state.finalJudgementDangerMs || 0) > 0
    || (state.finalJudgementPetalMs || 0) > 0
    || (state.finalJudgementRushHangMs || 0) > 0;
}

function updateBossVoid(boss, delta, state, fireFn) {
  boss.preDiveWarn = false;
  boss.voidRedWarn = false;
  ensureVoidState(boss);

  if (!boss.entered) {
    boss.y += boss.speed;
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY;
      boss.entered = true;
      boss.homeX = W / 2 - boss.w / 2;
      boss.homeY = boss.targetY;
      boss.voidMode = "fanPredict";
      boss.voidModeTimer = 2400;
      boss.voidShotTimer = 0;
      boss.voidMirrorCdMs = 5000;
      boss.voidTrapCdMs = 2600;
      boss.voidTeleportLeft = 0;
      boss.voidFinalCdMs = 4500;
      boss._lastMirrorAlive = false;
    }
    return;
  }

  const phase = getVoidPhase(boss);
  state.voidDarknessAlpha = phase >= 4 ? 0.75 : 0;
  if (phase < 4) state.voidSafeZone = null;

  // 分身无论被何种方式击落（弹道/卫星/撞击/反伤），都通过「存活边沿」统一触发本体硬直
  const mirror = getVoidMirror(state, boss);
  if (boss._lastMirrorAlive && !mirror) boss.voidStunMs = 800;
  boss._lastMirrorAlive = !!mirror;

  pumpVoidTrapSpawnQueue(boss, state, delta);

  if (typeof boss.voidStunMs !== "number") boss.voidStunMs = 0;
  if (boss.voidStunMs > 0) {
    boss.voidStunMs = Math.max(0, boss.voidStunMs - delta);
    boss.voidRedWarn = true;
    const fjTimers = (state.finalJudgementDangerMs || 0) > 0
      || (state.finalJudgementPetalMs || 0) > 0
      || (state.finalJudgementRushHangMs || 0) > 0;
    if (fjTimers) clearVoidGravityTrapsFull(boss, state);
    else applyVoidGravityTraps(state, delta, boss);
    return;
  }

  updateVoidHatred(boss, state, delta);

  // 记录玩家运动趋势，用于预判弹
  const p = state.player;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  if (!boss.voidPlayerTrackInit) {
    boss.voidPlayerTrack.x = cx;
    boss.voidPlayerTrack.y = cy;
    boss.voidPlayerTrackInit = true;
  } else {
    boss.voidPlayerTrack.vx = cx - boss.voidPlayerTrack.x;
    boss.voidPlayerTrack.vy = cy - boss.voidPlayerTrack.y;
    boss.voidPlayerTrack.x = cx;
    boss.voidPlayerTrack.y = cy;
  }

  // 阶段3：弹幕继承（在场子弹持续加速；审判弹在喷发后危险窗+花瓣期内不继承，减负+防失控）
  if (phase >= 3 && state.enemyBullets && state.enemyBullets.length > 0) {
    const mul = 1 + 0.05 * (delta / 1000);
    const skipJudgementInherit =
      (state.finalJudgementDangerMs || 0) > 0
      || (state.finalJudgementPetalMs || 0) > 0
      || (state.finalJudgementRushHangMs || 0) > 0;
    for (let i = 0; i < state.enemyBullets.length; i += 1) {
      const eb = state.enemyBullets[i];
      if (eb.judgementBolt && skipJudgementInherit) continue;
      eb.vx *= mul;
      eb.vy *= mul;
    }
  }

  const enrage = phase >= 4 ? (1 + (1 - boss.hp / Math.max(1, boss.maxHp))) : 1; // 回光返照：掉血越多射速越快
  boss.voidShotTimer -= delta;
  boss.voidModeTimer -= delta;
  boss.voidMirrorCdMs = Math.max(0, (boss.voidMirrorCdMs || 0) - delta);
  boss.voidTrapCdMs = Math.max(0, (boss.voidTrapCdMs || 0) - delta);
  boss.voidFinalCdMs = Math.max(0, (boss.voidFinalCdMs || 0) - delta);

  // 阶段4关键技：最终审判（仅由独立 CD 触发，不与随机池混在一起，保证必设 safeZone）
  if (phase >= 4 && boss.voidFinalCdMs <= 0 && boss.voidMode !== "finalJudgement") {
    boss.voidMode = "finalJudgement";
    boss.voidModeTimer = 3000;
    boss.voidShotTimer = 0;
    boss.voidTeleportSub = null;
    boss.voidTeleportWarnMs = 0;
    const safeSide = Math.min(W, H) * 0.18;
    state.voidSafeZone = pickVoidJudgementSafeZone(boss, safeSide);
    clearVoidGravityTrapsFull(boss, state);
  }

  if (boss.voidModeTimer <= 0) {
    boss.voidTeleportSub = null;
    boss.voidTeleportWarnMs = 0;
    const pools = {
      1: ["fanPredict", "edgeLock"],
      2: ["fanPredict", "edgeLock", "mirror", "gravity"],
      3: ["fanPredict", "edgeLock", "mirror", "gravity", "phaseShift", "hatredBurst"],
      4: ["fanPredict", "edgeLock", "gravity", "phaseShift", "hatredBurst"],
    };
    const arr = pools[phase];
    boss.voidMode = arr[Math.floor(Math.random() * arr.length)];
    boss.voidModeTimer = 2500 + Math.random() * 1800;
    boss.voidShotTimer = 0;
    if (boss.voidMode === "phaseShift") boss.voidTeleportLeft = 3;
  }

  const roamSpeed = phase === 1 ? 2.8 : (phase === 2 ? 3.8 : 4.6);
  if (boss.voidMode !== "finalJudgement") {
    const tx = boss.homeX + Math.sin((state.elapsed || 0) * 0.0014) * 120;
    const ty = boss.homeY + Math.sin((state.elapsed || 0) * 0.0021) * 26;
    moveToward(boss, tx, ty, roamSpeed);
  }

  if (boss.voidMode === "fanPredict") {
    if (boss.voidShotTimer <= 0) {
      boss.voidShotTimer = 320 / enrage;
      const bcX = boss.x + boss.w / 2;
      const bcY = boss.y + boss.h;
      const curAng = Math.atan2(cy - bcY, cx - bcX);
      const predX = cx + boss.voidPlayerTrack.vx * 18;
      const predY = cy + boss.voidPlayerTrack.vy * 18;
      const predAng = Math.atan2(predY - bcY, predX - bcX);
      [-0.15, 0, 0.15].forEach((d) => {
        fireVoid(boss, state, fireFn, { x: bcX - 3, y: bcY, w: 6, h: 8, vx: Math.cos(curAng + d) * 4.4, vy: Math.sin(curAng + d) * 4.4, dmg: 1 });
        fireVoid(boss, state, fireFn, { x: bcX - 3, y: bcY, w: 6, h: 8, vx: Math.cos(predAng + d) * 4.4, vy: Math.sin(predAng + d) * 4.4, dmg: 1 });
      });
    }
  } else if (boss.voidMode === "edgeLock") {
    if (boss.voidShotTimer <= 0) {
      boss.voidShotTimer = 900 / enrage;
      fireEdgeLock(boss, fireFn);
    }
  } else if (boss.voidMode === "mirror") {
    if (boss.voidMirrorCdMs <= 0) {
      spawnVoidMirror(boss, state);
      boss.voidMirrorCdMs = 10000;
    }
    if (boss.voidShotTimer <= 0) {
      boss.voidShotTimer = 260 / enrage;
      const ang = aimAt(boss, state);
      const bcX = boss.x + boss.w / 2;
      const bcY = boss.y + boss.h;
      [-0.08, 0, 0.08].forEach((d) => {
        fireVoid(boss, state, fireFn, { x: bcX - 3, y: bcY, w: 6, h: 8, vx: Math.cos(ang + d) * 4.8, vy: Math.sin(ang + d) * 4.8, dmg: 1 });
      });
    }
  } else if (boss.voidMode === "gravity") {
    if (boss.voidTrapCdMs <= 0 && !isVoidJudgementCrowdControlled(state, boss)) {
      spawnVoidGravityTrapsTriple(boss, state);
      boss.voidTrapCdMs = 7500;
    }
    if (boss.voidShotTimer <= 0) {
      boss.voidShotTimer = 300 / enrage;
      const bcX = boss.x + boss.w / 2;
      const bcY = boss.y + boss.h;
      const ang = aimAt(boss, state);
      fireVoid(boss, state, fireFn, { x: bcX - 3, y: bcY, w: 6, h: 8, vx: Math.cos(ang) * 4.1, vy: Math.sin(ang) * 4.1, dmg: 1 });
    }
  } else if (boss.voidMode === "phaseShift") {
    if (!boss.voidTeleportSub) boss.voidTeleportSub = "warn";
    if (boss.voidTeleportSub === "warn") {
      boss.voidRedWarn = true;
      if (!boss.voidTeleportWarnMs) boss.voidTeleportWarnMs = 300;
      boss.voidTeleportWarnMs -= delta;
      if (boss.voidTeleportWarnMs <= 0) {
        boss.voidTeleportSub = "jump";
        boss.voidTeleportWarnMs = 0;
      }
    } else if (boss.voidTeleportSub === "jump") {
      boss.x = clamp(Math.random() * (W - boss.w), 10, W - boss.w - 10);
      boss.y = clamp(60 + Math.random() * (H * 0.4), ROAM_TOP, H - boss.h - ROAM_BOTTOM_MARGIN);
      const bcX = boss.x + boss.w / 2;
      const bcY = boss.y + boss.h / 2;
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        fireVoid(boss, state, fireFn, { x: bcX - 3, y: bcY, w: 6, h: 8, vx: Math.cos(a) * 4.4, vy: Math.sin(a) * 4.4, dmg: 1 });
      }
      boss.voidTeleportLeft -= 1;
      if (boss.voidTeleportLeft <= 0) {
        boss.voidModeTimer = 0;
        boss.voidTeleportSub = null;
      } else {
        boss.voidTeleportSub = "warn";
        boss.voidTeleportWarnMs = 300;
      }
    }
  } else if (boss.voidMode === "hatredBurst") {
    if (boss.voidShotTimer <= 0) {
      boss.voidShotTimer = 700 / enrage;
      const targets = getHatredTargets(boss, 4);
      const bcX = boss.x + boss.w / 2;
      const bcY = boss.y + boss.h / 2;
      // 仇恨点常常落在相邻格，几组扇形会几乎重叠：弹量翻倍但威胁不变，
      // 只是把安全走廊填死。按发射角去重，重叠的那几组直接省掉。
      const MIN_SEP = 0.34;   // 约 19°：小于这个夹角的扇形视为同一束
      const usedAngs = [];
      for (let ti = 0; ti < targets.length; ti += 1) {
        const t = targets[ti];
        const ang = Math.atan2(t.y - bcY, t.x - bcX);
        let tooClose = false;
        for (let u = 0; u < usedAngs.length; u += 1) {
          let d = ang - usedAngs[u];
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) < MIN_SEP) { tooClose = true; break; }
        }
        if (tooClose) continue;
        usedAngs.push(ang);
        for (let k = -1; k <= 1; k += 1) {
          fireVoid(boss, state, fireFn, { x: bcX - 3, y: bcY, w: 6, h: 8, vx: Math.cos(ang + k * 0.1) * 5.2, vy: Math.sin(ang + k * 0.1) * 5.2, dmg: 1 });
        }
      }
    }
  } else if (boss.voidMode === "finalJudgement") {
    boss.voidRedWarn = true;
    if (boss.voidModeTimer <= 40) {
      const safe = state.voidSafeZone || { x: -1000, y: -1000, w: 0, h: 0 };
      const hidInSafe = playerCenterInVoidSafeZone(state, safe);
      const stepX = Math.max(32, Math.round(W / 14));
      const stepY = Math.max(40, Math.round(H / 18));
      for (let x = 0; x <= W; x += stepX) {
        for (let y = 0; y <= H; y += stepY) {
          if (x >= safe.x && x <= safe.x + safe.w && y >= safe.y && y <= safe.y + safe.h) continue;
          let vx;
          let vy;
          let dmgOut;
          if (hidInSafe) {
            vx = (Math.random() - 0.5) * 1.3;
            vy = 2.4 + Math.random() * 0.8;
            dmgOut = 1;
          } else {
            vx = 0;
            vy = 0;
            dmgOut = 0;
          }
          const payload = {
            x: x - 3,
            y: y - 3,
            w: 6,
            h: 8,
            vx,
            vy,
            dmg: dmgOut,
            judgementBolt: true,
            judgementRush: !hidInSafe,
          };
          if (!hidInSafe) payload.judgementRushArmed = false;
          fireFn(payload);
        }
      }
      state.voidSafeZone = null;
      if (hidInSafe) {
        state.finalJudgementRushHangMs = 0;
        state.finalJudgementDangerMs = 0;
        state.finalJudgementPetalMs = 3000;
        state.finalJudgementPetalMotionDone = false;
      } else {
        state.finalJudgementRushHangMs = 1000;
        state.finalJudgementDangerMs = 0;
        state.finalJudgementPetalMs = 0;
        state.finalJudgementPetalMotionDone = false;
      }
      boss.voidFinalCdMs = 9000;
      boss.voidModeTimer = 0;
      boss.voidTeleportSub = null;
      boss.voidTeleportWarnMs = 0;
      boss.voidMode = "fanPredict";
    }
  }

  if (isVoidJudgementCrowdControlled(state, boss)) clearVoidGravityTrapsFull(boss, state);
  else applyVoidGravityTraps(state, delta, boss);

  boss.x = clamp(boss.x, 10, W - boss.w - 10);
  boss.y = clamp(boss.y, ROAM_TOP, H - boss.h - ROAM_BOTTOM_MARGIN);
  boss.bossLaserWarn = false;
}

/** 虚空二阶段「本体」：脉冲 / 漩涡压境 / 螺旋绞杀 / 新星爆发 四式轮换；血低于阈值时插入随机冲撞一格 */
function updateBossVoidCore(boss, delta, state, fireFn) {
  boss.preDiveWarn = false;
  boss.voidRedWarn = false;
  if ((boss.voidCoreSnipeFlashMs || 0) > 0) {
    boss.voidCoreSnipeFlashMs = Math.max(0, boss.voidCoreSnipeFlashMs - delta);
    boss.voidRedWarn = true;
  }

  if (state.voidCoreCombatStartAt == null) {
    return;
  }
  if (state.elapsed < (state.voidCoreUnlockAt || 0)) {
    return;
  }

  boss.coreIntroScale = 1;
  boss.chargeProgress = 1;
  state.voidDarknessAlpha = 0;
  state.voidSafeZone = null;

  const hpRatio = (boss.maxHp > 0) ? (boss.hp / boss.maxHp) : 1;
  let voidCoreMoveMul = VOID_CORE_MOVE_SPEED_MUL;
  if (hpRatio < 0.2) voidCoreMoveMul *= VOID_CORE_SPEED_UP_LOW80 * VOID_CORE_SPEED_UP_LOW20;
  else if (hpRatio < 0.8) voidCoreMoveMul *= VOID_CORE_SPEED_UP_LOW80;

  const slotCount = hpRatio < VOID_CORE_RAM_SLOT_HP_RATIO ? 5 : 4;
  const slot = Math.floor(
    (state.elapsed - state.voidCoreCombatStartAt) / VOID_CORE_SLOT_MS
  ) % slotCount;
  if (
    slot !== (boss._voidCoreLastSlot ?? -1)
    || slotCount !== (boss._voidCoreLastSlotCount ?? -1)
  ) {
    boss._voidCoreLastSlot = slot;
    boss._voidCoreLastSlotCount = slotCount;
    boss.voidCorePulseCd = 0;
    boss.voidCoreTentacleCd = 0;
    boss.voidCoreEdgeCd = 0;
    boss.voidCoreSpiralCd = 0;
    boss.voidCoreNovaCd = 0;
    boss.voidCoreSnipeCd = 400;
    boss.voidCoreSnipeFlashMs = 0;
  }

  if (typeof boss.voidCorePulseCd !== "number") boss.voidCorePulseCd = 0;
  if (typeof boss.voidCoreTentacleCd !== "number") boss.voidCoreTentacleCd = 0;
  if (typeof boss.voidCoreEdgeCd !== "number") boss.voidCoreEdgeCd = 0;
  if (typeof boss.voidCoreSpiralCd !== "number") boss.voidCoreSpiralCd = 0;
  if (typeof boss.voidCoreNovaCd !== "number") boss.voidCoreNovaCd = 0;
  if (typeof boss.voidCoreSnipeCd !== "number") boss.voidCoreSnipeCd = 0;

  boss.voidCorePulseCd -= delta;
  boss.voidCoreTentacleCd -= delta;
  boss.voidCoreEdgeCd -= delta;
  if (!(slotCount === 5 && slot === 4)) {
    boss.voidCoreTentacleAng = (boss.voidCoreTentacleAng || 0) + delta * 0.0024;
  }
  const tcx = W / 2 - boss.w / 2;
  const tcy = H * 0.36 - boss.h / 2;
  const bcx = boss.x + boss.w / 2;
  const bcy = boss.y + boss.h / 2;

  if (slotCount === 5 && slot === 4) {
    updateBossVoidCoreRamCharge(boss, delta, state, fireFn, voidCoreMoveMul);
  } else if (slot === 0) {
    roam(boss, delta, 1.18, 0.8, 0.9, 0.5, 0, voidCoreMoveMul);
    if (boss.voidCorePulseCd <= 0) {
      boss.voidCorePulseCd = 520;
      boss.voidCorePulseWave = (boss.voidCorePulseWave || 0) + 1;
      const n = 28;
      const emitRing = (phaseOff, spdMul) => {
        const spd = 3.55 * spdMul;
        for (let i = 0; i < n; i += 1) {
          const ang = phaseOff + (i / n) * Math.PI * 2;
          fireFn({
            x: bcx - 3,
            y: bcy - 3,
            w: 6,
            h: 6,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            dmg: 1,
          });
        }
      };
      emitRing(0, 1);
      if (boss.voidCorePulseWave % 3 === 0) {
        emitRing(Math.PI / n, 1.14);
      }
    }
  } else if (slot === 1) {
    moveToward(boss, tcx, tcy, 2.45 * voidCoreMoveMul);
    if (boss.voidCoreEdgeCd <= 0) {
      boss.voidCoreEdgeCd = 68;
      const side = Math.floor(Math.random() * 4);
      if (side === 0) {
        const x = Math.random() * Math.max(1, W - 12);
        fireFn({
          x,
          y: -10,
          w: 6,
          h: 6,
          vx: (Math.random() - 0.5) * 0.42,
          vy: 3.15,
          dmg: 1,
        });
      } else if (side === 1) {
        const x = Math.random() * Math.max(1, W - 12);
        fireFn({
          x,
          y: H + 4,
          w: 6,
          h: 6,
          vx: (Math.random() - 0.5) * 0.42,
          vy: -3.15,
          dmg: 1,
        });
      } else if (side === 2) {
        const y = Math.random() * Math.max(1, H - 12);
        fireFn({
          x: -10,
          y,
          w: 6,
          h: 6,
          vx: 3.05,
          vy: (Math.random() - 0.5) * 0.42,
          dmg: 1,
        });
      } else {
        const y = Math.random() * Math.max(1, H - 12);
        fireFn({
          x: W + 4,
          y,
          w: 6,
          h: 6,
          vx: -3.05,
          vy: (Math.random() - 0.5) * 0.42,
          dmg: 1,
        });
      }
    }
    if (boss.voidCoreTentacleCd <= 0) {
      boss.voidCoreTentacleCd = 95;
      for (let k = 0; k < 8; k += 1) {
        const ang = boss.voidCoreTentacleAng + (k / 8) * Math.PI * 2;
        fireFn({
          x: bcx - 2.5,
          y: bcy - 2.5,
          w: 5,
          h: 5,
          vx: Math.cos(ang) * 4.65,
          vy: Math.sin(ang) * 4.65,
          dmg: 1,
        });
      }
      if (Math.random() < 0.35) {
        for (let k = 0; k < 8; k += 1) {
          const ang = boss.voidCoreTentacleAng + Math.PI / 8 + (k / 8) * Math.PI * 2;
          fireFn({
            x: bcx - 2.5,
            y: bcy - 2.5,
            w: 4,
            h: 4,
            vx: Math.cos(ang) * 3.95,
            vy: Math.sin(ang) * 3.95,
            dmg: 1,
          });
        }
      }
    }
  } else if (slot === 2) {
    boss.voidCoreSpiralCd -= delta;
    boss.voidCoreSnipeCd -= delta;
    roam(boss, delta, 1.35, 1.05, 0.82, 0.46, Math.PI / 5, voidCoreMoveMul);
    if (boss.voidCoreSpiralCd <= 0) {
      boss.voidCoreSpiralCd = 48;
      if (typeof boss.voidCoreSpiralShoot !== "number") boss.voidCoreSpiralShoot = 0;
      boss.voidCoreSpiralShoot += 0.38;
      const px = state.player.x + state.player.w / 2;
      const py = state.player.y + state.player.h / 2;
      const aim = Math.atan2(py - bcy, px - bcx);
      const ang = boss.voidCoreSpiralShoot * 1.85 + aim * 0.28;
      fireFn({
        x: bcx - 2.5,
        y: bcy - 2.5,
        w: 5,
        h: 5,
        vx: Math.cos(ang) * 4.25,
        vy: Math.sin(ang) * 4.25,
        dmg: 1,
      });
    }
    if (boss.voidCoreSnipeCd <= 0) {
      boss.voidCoreSnipeCd = 680 + Math.random() * 220;
      const px = state.player.x + state.player.w / 2;
      const py = state.player.y + state.player.h / 2;
      const dx = px - bcx;
      const dy = py - bcy;
      const len = Math.hypot(dx, dy) || 1;
      boss.voidCoreSnipeFlashMs = 160;
      fireFn({
        x: bcx - 4,
        y: bcy - 4,
        w: 9,
        h: 9,
        vx: (dx / len) * 6.4,
        vy: (dy / len) * 6.4,
        dmg: 1,
      });
    }
  } else {
    boss.voidCoreNovaCd -= delta;
    moveToward(boss, tcx, tcy, 2.05 * voidCoreMoveMul);
    if (boss.voidCorePulseCd <= 0) {
      boss.voidCorePulseCd = 340;
      const px = state.player.x + state.player.w / 2;
      const py = state.player.y + state.player.h / 2;
      const dx = px - bcx;
      const dy = py - bcy;
      const len = Math.hypot(dx, dy) || 1;
      for (let q = -2; q <= 2; q += 1) {
        const ang = Math.atan2(dy, dx) + q * 0.22;
        fireFn({
          x: bcx - 3,
          y: bcy - 3,
          w: 6,
          h: 6,
          vx: Math.cos(ang) * 3.85,
          vy: Math.sin(ang) * 3.85,
          dmg: 1,
        });
      }
    }
    if (boss.voidCoreNovaCd <= 0) {
      boss.voidCoreNovaCd = 920;
      const rings = [
        { n: 18, s: 2.9 },
        { n: 22, s: 3.55 },
        { n: 26, s: 4.15 },
      ];
      const rot = boss.voidCoreTentacleAng * 0.45;
      rings.forEach((ring) => {
        for (let i = 0; i < ring.n; i += 1) {
          const ang = rot + (i / ring.n) * Math.PI * 2;
          fireFn({
            x: bcx - 3,
            y: bcy - 3,
            w: 6,
            h: 6,
            vx: Math.cos(ang) * ring.s,
            vy: Math.sin(ang) * ring.s,
            dmg: 1,
          });
        }
      });
    }
  }

  boss.x = clamp(boss.x, 10, W - boss.w - 10);
  boss.y = clamp(boss.y, ROAM_TOP, H - boss.h - ROAM_BOTTOM_MARGIN);
  boss.bossLaserWarn = false;
}

/**
 * 蓝 Boss 的模式序列。原本是"从普通池或重型池里随机挑一个"，
 * 现在成套编排：前一个模式把玩家赶到某处，后一个模式往那里打，
 * 整套结束进入过热破绽。
 */
const AZURE_SEQUENCES = [
  // 逼到边 → 横扫：rotor 把人挤开，laneSweep 沿着走位带扫过去
  { name: "扫边", moves: ["rotor", "laneSweep"] },
  // 压制 → 突进：rain 压住走位空间，紧接着高速冲撞
  { name: "压进", moves: ["rain", "spinRam"] },
  // 分割 → 下砸：双侧柱把场地切窄，再下砸中路
  { name: "切场", moves: ["sideColumns", "diveCrash"] },
  // 三段常规：给玩家可读的喘息节奏，不至于全是重型
  { name: "巡弋", moves: ["laneSweep", "rain", "rotor"] },
  { name: "追猎", moves: ["rotor", "diveCrash"] },
];

const AZURE_OVERHEAT_MS = 1300;
const AZURE_OVERHEAT_DMG_MUL = 1.6;

function pickAzureSequence(boss) {
  const cand = AZURE_SEQUENCES.filter((s) => s.name !== boss.azureSeqName);
  const arr = cand.length > 0 ? cand : AZURE_SEQUENCES;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 取序列里的下一个模式；序列走完返回 null（调用方据此进入过热） */
function pickAzureMode(boss) {
  if (boss.azureQueue && boss.azureQueue.length > 0) return boss.azureQueue.shift();
  return null;
}

/**
 * 第二类 Boss（azure）：高速冲撞 / 下砸 / 双侧柱状召唤 + 原有三种弹幕
 */
function updateBossAzure(boss, delta, state, fireFn, spawnFn) {
  // 入场流程保持一致
  boss.preDiveWarn = false;
  if (!boss.entered) {
    boss.y += boss.speed;
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY;
      boss.entered = true;
      boss.homeX = W / 2 - boss.w / 2;
      boss.homeY = boss.targetY;
      boss.azureQueue = ["rotor", "laneSweep"];
      boss.azureSeqName = "扫边";
      boss.azureMode = "rain";
      boss.azureModeElapsed = 0;
      boss.azureShotTimer = 0;
      boss.azureSpin = 0;
      boss.azureSub = null;
      boss.azureTargetX = boss.homeX;
      boss.azureTargetY = boss.homeY;
      boss.azureNormalsSinceHeavy = 1;
    }
    return;
  }

  const modeDurations = {
    rain: 5200,
    rotor: 4800,
    laneSweep: 4600,
    spinRam: 4200,
    diveCrash: 3800,
    sideColumns: 10200,
  };
  boss.azureModeElapsed += delta;
  boss.azureShotTimer -= delta;
  updateBossHeat(boss, delta, state);

  // 过热破绽：硬直不出招、受到伤害翻倍，玩家的输出窗口
  if (boss.overheatMs > 0) {
    moveToward(boss, boss.homeX, boss.homeY, 1.2);
    if (tickOverheat(boss, delta)) return;
  }
  tickOverheat(boss, delta);

  boss.azureSpin += delta * 0.004;

  if (boss.azureModeElapsed >= modeDurations[boss.azureMode]) {
    const next = pickAzureMode(boss);
    if (next) {
      boss.azureMode = next;
      boss.azureModeElapsed = 0;
      boss.azureShotTimer = 0;
      boss.azureSub = null;
    } else {
      // 一整套模式序列打完 → 过热破绽（不出招、易伤）
      enterOverheat(boss, AZURE_OVERHEAT_MS, AZURE_OVERHEAT_DMG_MUL);
      const seq = pickAzureSequence(boss);
      boss.azureSeqName = seq.name;
      boss.azureQueue = seq.moves.slice();
      boss.azureMode = boss.azureQueue.shift();
      boss.azureModeElapsed = 0;
      boss.azureShotTimer = 0;
      boss.azureSub = null;
      return;
    }
  }

  if (boss.azureMode === "rain") {
    const tx = boss.homeX + Math.sin(boss.azureSpin * 0.7) * 110;
    const ty = boss.homeY + Math.sin(boss.azureSpin * 1.1) * 10;
    moveToward(boss, tx, ty, 3.8);

    if (boss.azureShotTimer <= 0) {
      boss.azureShotTimer = 180;
      // 原本是 Math.random() 抖基准角 —— 随机就读不出来，只能靠运气。
      // 改成随时间正弦扫动：覆盖范围一样，但玩家能预判下一发往哪偏。
      const base = Math.PI / 2 + Math.sin(boss.azureModeElapsed * 0.0042) * 0.26;
      [-0.22, -0.1, 0, 0.1, 0.22].forEach((off) => {
        const ang = base + off;
        fireFn({
          x: boss.x + boss.w / 2 - 4, y: boss.y + boss.h, w: 7, h: 9,
          vx: Math.cos(ang) * 3.6, vy: Math.sin(ang) * 5.3,
          dmg: 1,
        });
      });
    }
  } else if (boss.azureMode === "rotor") {
    const tx = boss.homeX + Math.sin(boss.azureSpin * 0.9) * 70;
    const ty = boss.homeY + Math.cos(boss.azureSpin * 1.2) * 16;
    moveToward(boss, tx, ty, 3.6);

    if (boss.azureShotTimer <= 0) {
      boss.azureShotTimer = 115;
      const base = boss.azureSpin;
      const arms = [0, Math.PI];
      arms.forEach((arm) => {
        for (let i = -1; i <= 1; i += 1) {
          const ang = base + arm + i * 0.13;
          fireFn({
            x: boss.x + boss.w / 2 - 4, y: boss.y + boss.h / 2, w: 7, h: 9,
            vx: Math.cos(ang) * 4.4, vy: Math.sin(ang) * 4.4,
            dmg: 1,
          });
        }
      });
    }
  } else if (boss.azureMode === "laneSweep") {
    // 扫动区间偏向玩家常驻列：龟缩在一侧会被反复扫到，但仍是可预判的正弦往返
    const t = boss.azureModeElapsed / modeDurations.laneSweep;
    const bias = (hottestColumn(boss) - 1) * 0.18;   // -0.18 / 0 / +0.18
    const center = clamp(0.5 + bias, 0.22, 0.78);
    const tx = 20 + (W - boss.w - 40) * clamp(center + 0.5 * Math.sin(t * Math.PI * 2), 0, 1);
    const ty = boss.homeY - 8;
    moveToward(boss, tx, ty, 4.2);

    if (boss.azureShotTimer <= 0) {
      boss.azureShotTimer = 270;
      [-0.12, 0, 0.12].forEach((d) => {
        const ang = Math.PI / 2 + d;
        fireFn({
          x: boss.x + boss.w / 2 - 4, y: boss.y + boss.h, w: 8, h: 8,
          vx: Math.cos(ang) * 2.8, vy: Math.sin(ang) * 5.8,
          dmg: 1,
        });
      });
    }
  } else if (boss.azureMode === "spinRam") {
    // 冲撞前短暂预警（与绘制层 preDiveWarn 对齐：金黄闪烁）
    const RAM_WARN_MS = 520;
    if (!boss.azureSub) {
      boss.azureSub = "warn";
      boss.azureBurstLeft = 3;
      boss.azureRamWarnActive = false;
      boss.azureTargetX = boss.homeX;
      boss.azureTargetY = boss.homeY;
    }
    if (boss.azureSub === "warn") {
      if (!boss.azureRamWarnActive) {
        boss.azureRamWarnActive = true;
        boss.azureRamWarnMs = RAM_WARN_MS;
        const px = state.player.x + state.player.w / 2 - boss.w / 2;
        const py = state.player.y + state.player.h / 2 - boss.h / 2;
        boss.azureTargetX = Math.max(10, Math.min(W - boss.w - 10, px));
        boss.azureTargetY = Math.max(40, Math.min(H - boss.h - ROAM_BOTTOM_MARGIN, py));
      }
      boss.azureRamWarnMs -= delta;
      boss.preDiveWarn = true;
      if (boss.azureRamWarnMs <= 0) {
        boss.azureSub = "dash";
        boss.azureRamWarnActive = false;
      }
    } else if (boss.azureSub === "dash") {
      if (moveToward(boss, boss.azureTargetX, boss.azureTargetY, 11.5)) {
        boss.azureBurstLeft -= 1;
        if (boss.azureBurstLeft > 0) {
          boss.azureSub = "warn";
          boss.azureRamWarnActive = false;
        } else {
          boss.azureSub = "return";
          boss.azureTargetX = boss.homeX;
          boss.azureTargetY = boss.homeY;
        }
      }
    } else if (boss.azureSub === "return") {
      moveToward(boss, boss.azureTargetX, boss.azureTargetY, 5.6);
    }
    if (boss.azureShotTimer <= 0) {
      boss.azureShotTimer = 105;
      const base = boss.azureSpin * 2.2;
      for (let i = 0; i < 6; i += 1) {
        const ang = base + (i / 6) * Math.PI * 2;
        fireFn({
          x: boss.x + boss.w / 2 - 4, y: boss.y + boss.h / 2, w: 6, h: 8,
          vx: Math.cos(ang) * 3.8, vy: Math.sin(ang) * 3.8, dmg: 1,
        });
      }
    }
  } else if (boss.azureMode === "diveCrash") {
    if (!boss.azureSub) {
      boss.azureSub = "prep";
    }
    if (boss.azureSub === "prep") {
      boss.preDiveWarn = true;
      moveToward(boss, boss.homeX, boss.homeY - 20, 4.2);
      if (boss.azureModeElapsed > 650) boss.azureSub = "drop";
    } else if (boss.azureSub === "drop") {
      boss.y += 14.5;
      boss.x += Math.sin(boss.azureSpin * 2) * 1.4;
      if (boss.y >= H - boss.h - 120) {
        // 下砸到底后，偶尔进入“底部来回晃动 + 持续射击”阶段
        if (Math.random() < 0.38) {
          boss.azureSub = "bottomSweep";
          boss.azureBottomHold = 1400 + Math.random() * 900;
          boss.azureShotTimer = 0;
        } else {
          boss.azureSub = "rebound";
        }
        for (let i = 0; i < 18; i += 1) {
          const ang = (i / 18) * Math.PI * 2;
          fireFn({
            x: boss.x + boss.w / 2 - 4, y: boss.y + boss.h / 2, w: 7, h: 9,
            vx: Math.cos(ang) * 4.2, vy: Math.sin(ang) * 4.2, dmg: 1,
          });
        }
      }
    } else if (boss.azureSub === "bottomSweep") {
      const floorY = H - boss.h - 120;
      boss.y = floorY;
      // 底部横向晃动
      const tx = boss.homeX + Math.sin(boss.azureSpin * 2.6) * 120;
      moveToward(boss, tx, floorY, 6.6);
      // 持续扇形向上/斜上喷射，制造贴底压制
      if (boss.azureShotTimer <= 0) {
        boss.azureShotTimer = 120;
        const cx = boss.x + boss.w / 2;
        const cy = boss.y + boss.h / 2;
        [-1, -0.6, -0.25, 0.25, 0.6, 1].forEach((k) => {
          const ang = -Math.PI / 2 + k * 0.45;
          fireFn({
            x: cx - 4, y: cy, w: 7, h: 8,
            vx: Math.cos(ang) * 4.6, vy: Math.sin(ang) * 4.6,
            dmg: 1,
          });
        });
      }
      boss.azureBottomHold -= delta;
      if (boss.azureBottomHold <= 0) {
        boss.azureSub = "rebound";
      }
    } else {
      moveToward(boss, boss.homeX, boss.homeY, 6.2);
    }
  } else if (boss.azureMode === "sideColumns") {
    moveToward(boss, boss.homeX, boss.homeY - 6, 3.8);
    // 敌人柱：持续约 10 秒，按固定节奏不断从两侧下压
    if (typeof boss.azureColumnTimer !== "number") boss.azureColumnTimer = 0;
    boss.azureColumnTimer -= delta;
    if (boss.azureColumnTimer <= 0 && typeof spawnFn === "function") {
      boss.azureColumnTimer = 320;
      spawnFn({ pattern: "sideColumns", rows: 16 });
    }
    if (boss.azureShotTimer <= 0) {
      boss.azureShotTimer = 430;
      for (let i = -2; i <= 2; i += 1) {
        const ang = Math.PI / 2 + i * 0.08;
        fireFn({
          x: boss.x + boss.w / 2 - 4, y: boss.y + boss.h, w: 7, h: 9,
          vx: Math.cos(ang) * 2.1, vy: Math.sin(ang) * 5.0, dmg: 1,
        });
      }
    }
  }

  if (boss.azureMode !== "sideColumns") boss.azureColumnTimer = 0;
  boss.x = Math.max(10, Math.min(W - boss.w - 10, boss.x));
  boss.y = Math.max(10, Math.min(H - boss.h - ROAM_BOTTOM_MARGIN, boss.y));
  boss.bossLaserWarn = false;
}

// ============================================================================
//  沙漠 Boss「旱魃」
//  招式结构沿用 ATTACKS 的 { duration, update, move }，但独立成池，
//  因为它要控制地图的沙暴（callStorm 会写 state.bossStorm*）。
//  三阶段按 HP 比例切池；P3 常驻弱沙暴 + 招式间隔 ×0.7。
// ============================================================================

/** 旱魃主动召唤的沙暴：写 state.bossStorm*，由 battle.js 与常规沙暴取较强者 */
function setBossStorm(state, on, alpha, visionR) {
  if (!state.sandstormCfg) return;   // 非沙漠地图不生效
  state.bossStormActive = !!on;
  state.bossStormAlpha = on ? alpha : 0;
  state.bossStormVisionR = on ? visionR : 0;
}

const HANBA_ATTACKS = {
  // ---------- 裂地矛：屏幕下缘升起 7 根沙矛，随机留 1 个缺口 ----------
  spikeRow: {
    duration: 2200,
    onStart(boss) {
      // 矛数随阶段递增；缺口开在玩家常驻列的**反面**，逼他离开舒适区
      boss.hanbaSpikeN = hanbaPhase(boss) >= 3 ? 11 : (hanbaPhase(boss) >= 2 ? 9 : 7);
      const hot = hottestColumn(boss);
      const away = hot === 0 ? 2 : (hot === 2 ? 0 : (Math.random() < 0.5 ? 0 : 2));
      const N = boss.hanbaSpikeN;
      const lo = Math.max(1, Math.floor((away / 3) * N));
      const hi = Math.min(N - 2, Math.ceil(((away + 1) / 3) * N) - 1);
      boss.hanbaGap = lo + Math.floor(Math.random() * Math.max(1, hi - lo + 1));
      // 缺口宽度必须随矛数一起加宽：N=11 时单格只有 W/10≈39px，
      // 扣掉弹体与机体判定后只剩 11px，看着有缝其实过不去（与 walledBarrier 同一个坑）。
      boss.hanbaGapW = N >= 11 ? 3 : (N >= 9 ? 2 : 2);
      boss.hanbaFired = false;
      boss.hanbaVolley = 0;
    },
    update(boss, delta, state, fireFn) {
      const N = boss.hanbaSpikeN || 7;
      state.hanbaSpikeWarn = boss.attackElapsed < 900
        ? { n: N, gap: boss.hanbaGap, gapW: boss.hanbaGapW || 2 }
        : null;
      if (boss.attackElapsed < 900) return;
      const step = W / (N - 1);
      const gapW = boss.hanbaGapW || 2;
      const fire = (gap) => {
        for (let i = 0; i < N; i += 1) {
          if (inGapSector(i, N, gap, gapW)) continue;
          fireFn({ x: i * step - 5, y: H - 10, w: 10, h: 26, vx: 0, vy: -6.4, dmg: 1 });
        }
      };
      if (!boss.hanbaFired) {
        boss.hanbaFired = true;
        boss.hanbaVolley = 1;
        fire(boss.hanbaGap);
        return;
      }
      // P3：第二波错位补刀，缺口换到另一侧，逼玩家二次移动
      if (hanbaPhase(boss) >= 3 && boss.hanbaVolley === 1 && boss.attackElapsed >= 1650) {
        boss.hanbaVolley = 2;
        const alt = boss.hanbaGap < N / 2 ? N - 1 - gapW : 0;
        state.hanbaSpikeWarn = null;
        fire(alt);
      }
    },
    onEnd(boss, state) { state.hanbaSpikeWarn = null; },
    move: defaultMove,
  },

  // ---------- 横扫沙墙：11 发一排从上压下，带 2 个随机缺口 ----------
  sandWall: {
    duration: 2600,
    onStart(boss) {
      // 两个缺口都开在玩家常驻列的反面：龟缩在角落会被直接封死
      const hot = hottestColumn(boss);
      const away = hot === 0 ? 2 : (hot === 2 ? 0 : (Math.random() < 0.5 ? 0 : 2));
      const lo = Math.max(1, Math.floor((away / 3) * 11));
      const hi = Math.min(9, Math.ceil(((away + 1) / 3) * 11) - 1);
      boss.hanbaGaps = Object.create(null);
      let guard = 0;
      while (Object.keys(boss.hanbaGaps).length < 2 && guard < 60) {
        boss.hanbaGaps[lo + Math.floor(Math.random() * Math.max(1, hi - lo + 1))] = true;
        guard += 1;
      }
      boss.hanbaWaves = 0;
      boss.hanbaWaveMax = hanbaPhase(boss) >= 3 ? 3 : 2;
      boss.attackBurstTimer = 0;
    },
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = hanbaPhase(boss) >= 3 ? 680 : 900;
      if (boss.hanbaWaves >= (boss.hanbaWaveMax || 2)) return;
      boss.hanbaWaves += 1;
      const N = 11;
      const step = W / (N - 1);
      for (let i = 0; i < N; i += 1) {
        if (boss.hanbaGaps[i]) continue;
        fireFn({ x: i * step - 5, y: boss.y + boss.h, w: 10, h: 14, vx: 0, vy: 2.9, dmg: 1 });
      }
    },
    move: defaultMove,
  },

  // ---------- 旋沙：把玩家往中心拉，同时环形弹 ----------
  vortex: {
    duration: 3000,
    onStart(boss) { boss.hanbaRing = 0; boss.attackBurstTimer = 0; },
    update(boss, delta, state, fireFn) {
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h / 2;
      // 吸引：每帧把玩家往 Boss 中心拽一点（不夺走控制权，玩家仍可拖动对抗）
      const pl = state.player;
      if (pl) {
        const dx = cx - (pl.x + pl.w / 2);
        const dy = cy - (pl.y + pl.h / 2);
        const len = Math.hypot(dx, dy) || 1;
        const pull = (hanbaPhase(boss) >= 3 ? 0.085 : 0.055) * delta;
        pl.x = Math.max(0, Math.min(W - pl.w, pl.x + (dx / len) * pull));
        pl.y = Math.max(0, Math.min(H - pl.h, pl.y + (dy / len) * pull));
      }
      state.hanbaVortexAt = { x: cx, y: cy };
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 700;
      const N = 16;
      const base = boss.hanbaRing * 0.22;
      boss.hanbaRing += 1;
      for (let i = 0; i < N; i += 1) {
        const a = base + (Math.PI * 2 * i) / N;
        fireFn({ x: cx - 4, y: cy - 4, w: 8, h: 8, vx: Math.cos(a) * 3.4, vy: Math.sin(a) * 3.4, dmg: 1 });
      }
      // P3：叠一圈反向旋转的慢环，交叉出网格状缝隙
      if (hanbaPhase(boss) >= 3) {
        for (let i = 0; i < N; i += 1) {
          const a = -base * 1.6 + (Math.PI * 2 * (i + 0.5)) / N;
          fireFn({ x: cx - 4, y: cy - 4, w: 8, h: 8, vx: Math.cos(a) * 2.3, vy: Math.sin(a) * 2.3, dmg: 1 });
        }
      }
    },
    onEnd(boss, state) { state.hanbaVortexAt = null; },
    move: defaultMove,
  },

  // ---------- 流沙陷阱：场上 3 块区域，踩上去移速 ×0.55 ----------
  quicksand: {
    duration: 5000,
    onStart(boss) {
      // 第一块**盖在玩家常驻格上**（惩罚龟缩），其余两块随机撒开断退路
      const hot = hottestCell(boss);
      boss.hanbaZones = [{
        x: clamp(hot.x, 50, W - 50),
        y: clamp(hot.y, H * 0.3, H - 60),
        r: 74,
      }];
      for (let i = 0; i < 2; i += 1) {
        boss.hanbaZones.push({
          x: 40 + Math.random() * Math.max(1, W - 80),
          y: H * 0.42 + Math.random() * (H * 0.44),
          r: 62 + Math.random() * 26,
        });
      }
    },
    update(boss, delta, state) {
      // 前 1000ms 只是预警；之后写入 state 供 battle.js 减速与绘制
      const armed = boss.attackElapsed >= 1000;
      state.quicksandZones = armed ? boss.hanbaZones : null;
      state.quicksandWarnZones = armed ? null : boss.hanbaZones;
    },
    onEnd(boss, state) {
      state.quicksandZones = null;
      state.quicksandWarnZones = null;
    },
    move: defaultMove,
  },

  // ---------- 尘暴冲撞：三段冲刺，每段先画 500ms 路径预警 ----------
  duneCharge: {
    duration: 3400,
    onStart(boss) {
      boss.hanbaDash = 0;
      boss.hanbaDashMax = hanbaPhase(boss) >= 3 ? 4 : (hanbaPhase(boss) >= 2 ? 3 : 2);
      boss.hanbaDashPhase = "warn";
      boss.hanbaDashTimer = hanbaPhase(boss) >= 3 ? 380 : 500;
      boss.hanbaDashTo = null;
    },
    update(boss, delta, state) {
      if (boss.hanbaDashPhase === "done") return;
      boss.hanbaDashTimer -= delta;
      if (boss.hanbaDashPhase === "warn") {
        if (!boss.hanbaDashTo) {
          const pl = state.player;
          boss.hanbaDashTo = pl
            ? { x: pl.x + pl.w / 2 - boss.w / 2, y: pl.y + pl.h / 2 - boss.h / 2 }
            : { x: W / 2 - boss.w / 2, y: H * 0.6 };
        }
        state.hanbaDashWarn = {
          from: { x: boss.x + boss.w / 2, y: boss.y + boss.h / 2 },
          to: { x: boss.hanbaDashTo.x + boss.w / 2, y: boss.hanbaDashTo.y + boss.h / 2 },
        };
        if (boss.hanbaDashTimer <= 0) {
          boss.hanbaDashPhase = "dash";
          boss.hanbaDashTimer = 420;
          state.hanbaDashWarn = null;
        }
        return;
      }
      const to = boss.hanbaDashTo;
      if (to) moveToward(boss, to.x, to.y, 17);
      if (boss.hanbaDashTimer <= 0) {
        boss.hanbaDash += 1;
        boss.hanbaDashTo = null;
        boss.hanbaDashPhase = boss.hanbaDash >= (boss.hanbaDashMax || 3) ? "done" : "warn";
        boss.hanbaDashTimer = hanbaPhase(boss) >= 3 ? 380 : 500;
      }
    },
    onEnd(boss, state) { state.hanbaDashWarn = null; },
    move() {},
  },

  // ---------- 沙暴召唤：主动拉起沙暴，自身半透明，只放追踪弹 ----------
  callStorm: {
    duration: 6000,
    onStart(boss) { boss.hanbaVeiled = true; boss.attackBurstTimer = 0; },
    update(boss, delta, state, fireFn) {
      setBossStorm(state, true, 0.7, 130);
      boss.hanbaVeiled = true;
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 500;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h;
      const ang = aimAt(boss, state);
      [-0.22, 0, 0.22].forEach((off) => {
        fireFn({
          x: cx - 4, y: cy, w: 9, h: 9,
          vx: Math.cos(ang + off) * 4.4,
          vy: Math.sin(ang + off) * 4.4,
          dmg: 1,
        });
      });
    },
    onEnd(boss, state) {
      boss.hanbaVeiled = false;
      setBossStorm(state, false, 0, 0);
    },
    move: defaultMove,
  },
};

/** 三阶段招式池：P1 只有可躲的定式，P2 加限制走位的，P3 全放开 */
const HANBA_POOLS = {
  1: ["spikeRow", "sandWall", "vortex"],
  2: ["spikeRow", "sandWall", "vortex", "quicksand", "duneCharge", "callStorm"],
  3: ["spikeRow", "sandWall", "vortex", "quicksand", "duneCharge", "callStorm"],
};

function hanbaPhase(boss) {
  const r = boss.hp / Math.max(1, boss.maxHp);
  if (r > 0.6) return 1;
  if (r > 0.25) return 2;
  return 3;
}

/**
 * ---------------------------------------------------------------------------
 *  旱魃 AI：连招驱动，而不是"随机抽一招"
 * ---------------------------------------------------------------------------
 *  四条机制让它不再是老虎机：
 *
 *  1) 连招序列（HANBA_COMBOS）
 *     招式成组打出，前一招把玩家赶到后一招的杀伤区。玩家学会的是"读连招"，
 *     而不是背单招。每条连招都有名字，方便以后单独调。
 *
 *  2) 站位意图（COMBO_ANCHOR / moveToAnchor）
 *     每招开打前先移动到有意义的位置（沙墙去顶部、旋沙去正中、冲撞去侧翼），
 *     不再是无差别漫游。
 *
 *  3) 反制走位（热度网格 hanbaHeat）
 *     用 3×3 衰减热度记录玩家常待的格子：流沙**盖在**常驻区，
 *     沙墙与裂地矛的缺口**开在远离**常驻区的一侧。惩罚龟缩，但仍有预警可躲。
 *
 *  4) 过热破绽（overheat）
 *     一整条连招打完后强制硬直 1400ms，期间不出招、受到伤害 ×1.6。
 *     战斗因此有了"压制 → 破绽"的呼吸感，也让爆发构筑有明确的输出窗口。
 *
 *  另有怒气打断：单招期间被打掉超过 8% 最大生命，立刻中断当前招式改为冲撞反击。
 * ---------------------------------------------------------------------------
 */

/** 过热窗口时长与易伤倍率（battle.js 读 boss.damageTakenMul） */
const HANBA_OVERHEAT_MS = 1400;
const HANBA_OVERHEAT_DMG_MUL = 1.6;
/** 单招期间掉血超过该比例即触发怒气打断 */
const HANBA_ENRAGE_HP_RATIO = 0.08;

/**
 * 连招表。每条是一串招式 id，按顺序打完算一轮，然后进入过热破绽。
 * 设计意图写在注释里，方便后面单独调某一条。
 */
const HANBA_COMBOS = {
  1: [
    // 驱赶：沙墙从上压下把人挤到底部，紧接着底部升矛
    { name: "驱赶", moves: ["sandWall", "spikeRow"] },
    // 碾磨：旋沙把人拽向中心，随后中心区环形弹继续压
    { name: "碾磨", moves: ["vortex", "sandWall"] },
    // 试探：单招，给玩家喘息，也让 P1 不至于全是连招
    { name: "试探", moves: ["spikeRow"] },
  ],
  2: [
    // 围困：先标流沙盖住玩家常驻区，再往那里冲撞
    { name: "围困", moves: ["quicksand", "duneCharge"] },
    // 驱赶·改：多一段冲撞收尾
    { name: "驱赶改", moves: ["sandWall", "spikeRow", "duneCharge"] },
    // 碾磨·改：旋沙拽入后直接冲撞
    { name: "碾磨改", moves: ["vortex", "duneCharge"] },
    { name: "沙牢", moves: ["quicksand", "sandWall"] },
  ],
  3: [
    // 天罚：沙暴致盲 + 冲撞，P3 的招牌
    { name: "天罚", moves: ["callStorm", "duneCharge"] },
    // 绞杀：三段全场压制
    { name: "绞杀", moves: ["vortex", "spikeRow", "sandWall"] },
    { name: "流沙葬", moves: ["quicksand", "vortex", "duneCharge"] },
    { name: "驱赶终", moves: ["sandWall", "duneCharge", "spikeRow"] },
  ],
};

/** 每招的站位意图：开打前先挪到这里（返回归一化坐标 0~1） */
const COMBO_ANCHOR = {
  sandWall:   { x: 0.5,  y: 0.10 },   // 顶部正中，弹墙才铺得满
  spikeRow:   { x: 0.5,  y: 0.22 },   // 待在上方，避开自己放的矛
  vortex:     { x: 0.5,  y: 0.42 },   // 屏幕正中，吸引力才有意义
  quicksand:  { x: 0.5,  y: 0.20 },
  duneCharge: null,                    // 冲撞自带位移，不预站位
  callStorm:  { x: 0.5,  y: 0.28 },
};

// ---------------------------------------------------------------------------
//  连招调度
// ---------------------------------------------------------------------------

function pickHanbaCombo(boss) {
  const pool = HANBA_COMBOS[hanbaPhase(boss)] || HANBA_COMBOS[1];
  const cand = pool.filter((c) => c.name !== boss.lastComboName);
  const arr = cand.length > 0 ? cand : pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

function beginHanbaAttack(boss, state, id) {
  boss.currentAttack = id;
  boss.lastAttack = id;
  boss.attackElapsed = 0;
  boss.attackBurstTimer = 0;
  boss.attackBurstCount = 0;
  boss.hanbaHpAtMoveStart = boss.hp;
  const a = HANBA_ATTACKS[id];
  if (a && a.onStart) a.onStart(boss, state);
}

/** 站位：把 anchor 归一化坐标转成目标点并逼近，返回是否已到位 */
function moveToAnchor(boss, delta, id) {
  const anchor = COMBO_ANCHOR[id];
  if (!anchor) return true;
  const b = getRoamBounds(boss);
  const tx = clamp(anchor.x * W - boss.w / 2, b.minX, b.maxX);
  const ty = clamp(anchor.y * H, b.minY, b.maxY);
  return moveToward(boss, tx, ty, (delta / 16) * 5.2);
}

function updateBossHanba(boss, delta, state, fireFn, spawnFn) {
  // 入场
  if (!boss.entered) {
    boss.y += boss.speed;
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY;
      boss.entered = true;
      boss.homeX = W / 2 - boss.w / 2;
      boss.homeY = boss.targetY;
      boss.hanbaQueue = [];
      boss.hanbaState = "idle";
      boss.hanbaStateTimer = 500;
    }
    return;
  }

  updateBossHeat(boss, delta, state);
  const phase = hanbaPhase(boss);

  // 阶段推进时清空当前连招，让新阶段的招式池立刻生效
  if (boss.hanbaPhaseSeen !== phase) {
    boss.hanbaPhaseSeen = phase;
    if (phase >= 2 && !boss.hanbaP2Announced) {
      // 进 P2 的瞬间强制天罚开场：沙暴召唤 + 冲撞，作为阶段转换的演出与警告
      boss.hanbaP2Announced = true;
      boss.hanbaQueue = ["callStorm", "duneCharge"];
      boss.lastComboName = "天罚";
      boss.hanbaState = "idle";
      boss.hanbaStateTimer = 0;
      if (boss.currentAttack) {
        const cur = HANBA_ATTACKS[boss.currentAttack];
        if (cur && cur.onEnd) cur.onEnd(boss, state);
        boss.currentAttack = null;
      }
    }
  }

  // P3 常驻弱沙暴（callStorm 生效期间由招式覆盖成更浓的）
  if (phase >= 3 && boss.currentAttack !== "callStorm") {
    setBossStorm(state, true, 0.35, 220);
  }

  // ---------- 过热破绽：不出招、易伤（共用 tickOverheat）----------
  if (boss.hanbaState === "overheat") {
    roam(boss, delta, 0.5, 0.3, 0.35, 0.2, 0);
    if (tickOverheat(boss, delta)) return;
    boss.hanbaState = "idle";
    boss.hanbaStateTimer = phase >= 3 ? 260 : 420;
    return;
  }
  tickOverheat(boss, delta);

  // ---------- 连招间的空档：补队列 / 站位 ----------
  if (!boss.currentAttack) {
    boss.hanbaStateTimer -= delta;

    if (!boss.hanbaQueue || boss.hanbaQueue.length === 0) {
      // 一整条连招打完 → 过热破绽
      if (boss.hanbaState === "combo") {
        boss.hanbaState = "overheat";
        enterOverheat(boss, HANBA_OVERHEAT_MS, HANBA_OVERHEAT_DMG_MUL);
        return;
      }
      if (boss.hanbaStateTimer > 0) { defaultMove(boss, delta); return; }
      const combo = pickHanbaCombo(boss);
      boss.lastComboName = combo.name;
      boss.hanbaComboName = combo.name;
      boss.hanbaQueue = combo.moves.slice();
      boss.hanbaState = "combo";
    }

    const nextId = boss.hanbaQueue[0];
    // 站位到位（或本招不需要站位）后才起手
    const ready = moveToAnchor(boss, delta, nextId);
    if (!ready && boss.hanbaStateTimer > -900) return;   // 最多多花 900ms 走位，避免卡住
    boss.hanbaQueue.shift();
    beginHanbaAttack(boss, state, nextId);
    return;
  }

  // ---------- 招式执行 ----------
  const atk = HANBA_ATTACKS[boss.currentAttack];
  boss.attackElapsed += delta;
  if (atk.move) atk.move(boss, delta, state);
  if (atk.update) atk.update(boss, delta, state, fireFn, spawnFn);

  boss.x = Math.max(10, Math.min(W - boss.w - 10, boss.x));
  boss.y = Math.max(10, Math.min(H - boss.h - ROAM_BOTTOM_MARGIN, boss.y));

  // 怒气打断：单招期间被打掉一大块血，立刻中断改为冲撞反击
  const lost = (boss.hanbaHpAtMoveStart || boss.hp) - boss.hp;
  if (
    boss.currentAttack !== "duneCharge"
    && lost > boss.maxHp * HANBA_ENRAGE_HP_RATIO
  ) {
    if (atk.onEnd) atk.onEnd(boss, state);
    boss.hanbaQueue = boss.hanbaQueue || [];
    boss.hanbaQueue.unshift("duneCharge");
    boss.currentAttack = null;
    boss.hanbaStateTimer = 120;
    return;
  }

  if (boss.attackElapsed >= atk.duration) {
    if (atk.onEnd) atk.onEnd(boss, state);
    boss.currentAttack = null;
    // 连招内部衔接很短（读作"一套连招"），P3 再快 30%
    const gapMul = phase >= 3 ? 0.7 : 1;
    boss.hanbaStateTimer = (boss.hanbaQueue && boss.hanbaQueue.length > 0 ? 220 : 420) * gapMul;
  }
}

// ============================================================================
// 海洋 Boss「归墟·利维坦」：潮门 → 锁定扇流 → 破海冲撞。
// 每轮只执行一种危险图案；潮门会等最后一排离场后再换招，安全航道不会被下一招封死。
// 50% 血量进入二阶段：短暂停火清除自身余弹，增加齐射/冲撞次数，保留完整预警时间。
// ============================================================================
const LEVIATHAN_SEQUENCES = {
  1: ["tideGate", "abyssFan", "breach"],
  2: ["tideGate", "breach", "abyssFan", "breach"],
};

function leviathanSwimBounds(boss) {
  const minY = Math.min(boss.targetY || 224, H - boss.h - 80);
  return {
    minX: 16, maxX: Math.max(16, W - boss.w - 16), minY,
    maxY: Math.max(minY, Math.min(H * 0.38, H - boss.h - 130)),
  };
}

/** 只驱动小幅侧倾与鳍尾节奏；碰撞始终使用原始 w/h。 */
function leviathanMotionPose(boss, delta, phase, vx, vy) {
  const blend = 1 - Math.exp(-Math.max(0, delta) / 140);
  boss.leviathanMotionPhase = phase;
  const bank = clamp(vx * 0.033, -0.12, 0.12);
  const thrust = phase === "windup" ? 0.25 + (boss.leviathanWarnProgress || 0) * 0.55
    : clamp(0.16 + Math.hypot(vx, vy) * 0.075, 0.16, 1);
  boss.leviathanBank = (boss.leviathanBank || 0) + (bank - (boss.leviathanBank || 0)) * blend;
  boss.leviathanThrust = (boss.leviathanThrust || 0) + (thrust - (boss.leviathanThrust || 0)) * blend;
}

function nextLeviathanAnchor(boss) {
  const bounds = leviathanSwimBounds(boss);
  const index = boss.leviathanAnchorIndex || 0;
  boss.leviathanAnchorIndex = index + 1;
  // 交替穿越不同深度的宽幅航线，不追玩家，也不在每招后回到正中。
  const xs = [0.12, 0.88, 0.26, 0.80, 0.18, 0.92];
  const ys = [0.20, 0.72, 0.42, 0.88, 0.58, 0.26];
  boss.leviathanDriftTarget = {
    x: bounds.minX + (bounds.maxX - bounds.minX) * xs[index % xs.length],
    y: bounds.minY + (bounds.maxY - bounds.minY) * ys[index % ys.length],
  };
  return boss.leviathanDriftTarget;
}

/** 速度平滑趋近航点，转身带惯性；settle 时停稳再开始下一条预警。 */
function swimLeviathan(boss, delta, settle) {
  let target = boss.leviathanDriftTarget || nextLeviathanAnchor(boss);
  const step = Math.min(3, Math.max(0, delta) / 16.667);
  const bounds = leviathanSwimBounds(boss);
  let dx = target.x - boss.x, dy = target.y - boss.y;
  if (!settle && Math.hypot(dx, dy) < 20) {
    target = nextLeviathanAnchor(boss);
    dx = target.x - boss.x; dy = target.y - boss.y;
  }
  const distance = Math.hypot(dx, dy);
  const speed = Math.min(3.25, distance * (settle ? 0.07 : 0.10));
  const phase = boss.leviathanSwimPhase || 0;
  const undulation = settle ? 0 : Math.sin(phase * 0.73) * 0.20;
  const desiredX = distance > 0 ? dx / distance * speed : 0;
  const desiredY = (distance > 0 ? dy / distance * speed : 0) + undulation;
  const blend = 1 - Math.exp(-Math.max(0, delta) / 175);
  boss.leviathanVx = (boss.leviathanVx || 0) + (desiredX - (boss.leviathanVx || 0)) * blend;
  boss.leviathanVy = (boss.leviathanVy || 0) + (desiredY - (boss.leviathanVy || 0)) * blend;
  // 调试生成或旧状态可在航带之外；只限制继续远离，不把本体瞬间吸到边界。
  boss.x = clamp(boss.x + boss.leviathanVx * step, Math.min(boss.x, bounds.minX), Math.max(boss.x, bounds.maxX));
  boss.y = clamp(boss.y + boss.leviathanVy * step, Math.min(boss.y, bounds.minY), Math.max(boss.y, bounds.maxY));
  leviathanMotionPose(boss, delta, "glide", boss.leviathanVx, boss.leviathanVy);
  if (settle && distance < 3 && Math.hypot(boss.leviathanVx, boss.leviathanVy) < 0.30) {
    boss.leviathanVx = 0;
    boss.leviathanVy = 0;
    return true;
  }
  return false;
}

/** 冲撞结束后沿弧线游回上方，不瞬移、不把回程当第二次追击。 */
function beginLeviathanReturn(boss) {
  const target = nextLeviathanAnchor(boss);
  const bounds = leviathanSwimBounds(boss);
  const side = target.x >= boss.x ? 1 : -1;
  boss.leviathanReturn = {
    fromX: boss.x, fromY: boss.y,
    controlX: clamp(boss.x + side * 74, bounds.minX, bounds.maxX),
    controlY: Math.max(bounds.minY, boss.y - 26),
    toX: target.x, toY: target.y, elapsed: 0,
    duration: Math.max(1250, Math.hypot(target.x - boss.x, target.y - boss.y) * 5.5),
  };
  boss.leviathanVx = 0;
  boss.leviathanVy = 0;
}

function returnLeviathan(boss, delta) {
  const curve = boss.leviathanReturn;
  if (!curve) return true;
  curve.elapsed += delta;
  const linear = clamp(curve.elapsed / curve.duration, 0, 1);
  const t = linear * linear * (3 - 2 * linear);
  const inv = 1 - t;
  const previousX = boss.x, previousY = boss.y;
  boss.x = inv * inv * curve.fromX + 2 * inv * t * curve.controlX + t * t * curve.toX;
  boss.y = inv * inv * curve.fromY + 2 * inv * t * curve.controlY + t * t * curve.toY;
  const step = Math.max(0.01, Math.max(0, delta) / 16.667);
  leviathanMotionPose(boss, delta, "return", (boss.x - previousX) / step, (boss.y - previousY) / step);
  if (linear < 1) return false;
  boss.leviathanReturn = null;
  return true;
}

function leviathanShot(fireFn, x, y, angle, speed, size, color, gate) {
  fireFn({
    x: x - size / 2, y: y - size / 2, w: size, h: size,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    dmg: 1, color: color || "#fb927b", oceanBullet: true, leviathanBullet: true,
    leviathanGate: !!gate,
  });
}

function lockLeviathanTarget(boss, state) {
  const p = state && state.player;
  const px = p ? p.x + p.w / 2 : W / 2;
  const py = p ? p.y + p.h / 2 : H * 0.82;
  boss.leviathanAimAngle = Math.atan2(py - boss.y - boss.h / 2, px - boss.x - boss.w / 2);
  boss.leviathanDashTo = {
    x: clamp(px, boss.w / 2 + 12, W - boss.w / 2 - 12),
    y: clamp(py, boss.h / 2 + 80, H * 0.62),
  };
}

function beginLeviathanWarning(boss, state, attack) {
  boss.currentAttack = attack;
  boss.leviathanAttack = attack;
  boss.leviathanState = "warn";
  boss.attackElapsed = 0;
  boss.leviathanWarnMs = attack === "tideGate" ? 1100 : 900;
  boss.leviathanTimer = boss.leviathanWarnMs;
  boss.leviathanWarnProgress = 0;
  boss.leviathanVolley = 0;
  boss.attackBurstTimer = 0;
  boss.damageTakenMul = 1;
  boss.leviathanVx = 0;
  boss.leviathanVy = 0;
  boss.leviathanDriftTarget = null;
  boss.leviathanWarnOrigin = { x: boss.x + boss.w / 2, y: boss.y + boss.h / 2 };
  lockLeviathanTarget(boss, state);
  if (attack === "tideGate") {
    // 航道宽度已包括机体和弹体余量；相邻弹体不会侵入标示的安全区。
    boss.leviathanGateIndex = ((boss.leviathanGateIndex || 0) + 1) % 3;
    boss.leviathanGapX = W * [0.26, 0.5, 0.74][boss.leviathanGateIndex];
    boss.leviathanGapW = Math.max(108, W * 0.28);
    boss.leviathanWallY = boss.y + boss.h;
  }
}

function finishLeviathanAttack(boss) {
  const returning = boss.leviathanAttack === "breach";
  boss.currentAttack = null;
  boss.leviathanState = "recover";
  boss.leviathanTimer = 1400;
  boss.leviathanWarnProgress = 0;
  boss.leviathanDashTo = null;
  if (returning) beginLeviathanReturn(boss);
  // 沿用既有易伤/光环机制，给爆发构筑清晰的输出窗口。
  enterOverheat(boss, 1400, 1.5);
}

function updateBossLeviathan(boss, delta, state, fireFn) {
  const step = Math.min(3, Math.max(0, delta) / 16.667);
  boss.leviathanAge = (boss.leviathanAge || 0) + delta;
  boss.leviathanPulse = 0.5 + Math.sin(boss.leviathanAge * 0.0045) * 0.5;
  boss.leviathanSwimPhase = (boss.leviathanSwimPhase || 0)
    + delta * 0.0045 * (0.8 + (boss.leviathanThrust || 0) * 0.9);
  if (!boss.leviathanState) {
    boss.leviathanPhase = 1;
    boss.leviathanState = "idle";
    boss.leviathanTimer = 800;
    boss.leviathanSequenceIndex = 0;
  }
  if (!boss.entered) {
    boss.y += boss.speed * step;
    leviathanMotionPose(boss, delta, "approach", 0, boss.speed);
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY;
      boss.entered = true;
    }
    return;
  }

  const phase = boss.hp / Math.max(1, boss.maxHp) <= 0.5 ? 2 : 1;
  if (phase === 2 && boss.leviathanPhase !== 2) {
    boss.leviathanPhase = 2;
    boss.leviathanState = "transition";
    boss.leviathanTimer = 1500;
    boss.leviathanSequenceIndex = 0;
    boss.currentAttack = null;
    boss.leviathanAttack = null;
    boss.leviathanDashTo = null;
    boss.leviathanWarnProgress = 0;
    boss.damageTakenMul = 1;
    boss.overheatMs = 0;
    boss.hanbaOverheat = false;
    if (boss.y > leviathanSwimBounds(boss).maxY) beginLeviathanReturn(boss);
    else boss.leviathanDriftTarget = null;
    if (Array.isArray(state.enemyBullets)) {
      state.enemyBullets = state.enemyBullets.filter((b) => !b.leviathanBullet);
    }
    return;
  }

  if (boss.leviathanState === "transition" || boss.leviathanState === "recover" || boss.leviathanState === "idle") {
    boss.leviathanTimer -= delta;
    tickOverheat(boss, delta);
    if (boss.leviathanReturn && !returnLeviathan(boss, delta)) return;
    const settled = swimLeviathan(boss, delta, true);
    if (boss.leviathanTimer > 0 || !settled) return;
    const seq = LEVIATHAN_SEQUENCES[boss.leviathanPhase];
    const next = seq[boss.leviathanSequenceIndex % seq.length];
    boss.leviathanSequenceIndex += 1;
    boss.leviathanDashCount = 0;
    beginLeviathanWarning(boss, state, next);
    return;
  }

  if (boss.leviathanState === "warn") {
    // 锁定后不追踪，也不移动本体；位移与瞄准线完全一致。
    boss.leviathanTimer -= delta;
    boss.leviathanWarnProgress = clamp(1 - boss.leviathanTimer / boss.leviathanWarnMs, 0, 1);
    leviathanMotionPose(boss, delta, "windup", 0, 0);
    if (boss.leviathanTimer > 0) return;
    boss.leviathanState = boss.leviathanAttack === "breach" ? "dash" : "fire";
    boss.attackElapsed = 0;
    boss.attackBurstTimer = 0;
    return;
  }

  boss.attackElapsed += delta;
  if (boss.leviathanAttack === "tideGate") {
    const maxWaves = phase === 2 ? 3 : 2;
    const interval = phase === 2 ? 580 : 720;
    const speed = phase === 2 ? 3.0 : 2.6;
    let emitted = false;
    boss.attackBurstTimer -= delta;
    if (boss.attackBurstTimer <= 0 && boss.leviathanVolley < maxWaves) {
      boss.attackBurstTimer = interval;
      boss.leviathanVolley += 1;
      emitted = true;
      const count = Math.max(9, Math.ceil(W / 26));
      for (let i = 0; i <= count; i += 1) {
        const x = i * W / count;
        if (Math.abs(x - boss.leviathanGapX) <= boss.leviathanGapW / 2 + 5) continue;
        leviathanShot(fireFn, x, boss.leviathanWallY, Math.PI / 2, speed, 9, null, true);
      }
    }
    if (boss.leviathanVolley >= maxWaves && !emitted) swimLeviathan(boss, delta, false);
    else leviathanMotionPose(boss, delta, "hold", 0, 0);
    const exitMs = (H + 70 - boss.leviathanWallY) / speed * 16.667;
    const gateVisible = Array.isArray(state.enemyBullets)
      && state.enemyBullets.some((b) => b.leviathanGate && b.y < H + 30 && b.x > -30 && b.x < W + 30);
    // 实际弹体也必须离场：低帧率 / 时间流护盾减速时不能只依赖 60fps 的估计。
    if (boss.attackElapsed > (maxWaves - 1) * interval + exitMs + 150 && !gateVisible) finishLeviathanAttack(boss);
    return;
  }

  if (boss.leviathanAttack === "abyssFan") {
    // 扇流瞄准的是预警开始时的位置；玩家横移即可躲过整轮。
    const maxWaves = phase === 2 ? 4 : 3;
    let emitted = false;
    boss.attackBurstTimer -= delta;
    if (boss.attackBurstTimer <= 0 && boss.leviathanVolley < maxWaves) {
      boss.attackBurstTimer = 560;
      boss.leviathanVolley += 1;
      emitted = true;
      const half = phase === 2 ? 3 : 2;
      for (let i = -half; i <= half; i += 1) {
        leviathanShot(fireFn, boss.x + boss.w / 2, boss.y + boss.h / 2,
          boss.leviathanAimAngle + i * 0.23, 3.05, 8, "#ffd5ad");
      }
    }
    if (boss.leviathanVolley >= maxWaves && !emitted) swimLeviathan(boss, delta, false);
    else leviathanMotionPose(boss, delta, "hold", 0, 0);
    const fanVisible = Array.isArray(state.enemyBullets)
      && state.enemyBullets.some((b) => b.leviathanBullet && !b.leviathanGate
        && b.y > -30 && b.y < H + 30 && b.x > -30 && b.x < W + 30);
    // 扇流也按实际离场衔接：低帧率 / 弹速减慢时不能让冲撞追上仍在场内的余弹。
    if (boss.attackElapsed >= 2700 && !fanVisible) finishLeviathanAttack(boss);
    return;
  }

  if (boss.leviathanAttack === "breach") {
    const target = boss.leviathanDashTo;
    const dx = target.x - boss.w / 2 - boss.x;
    const dy = target.y - boss.h / 2 - boss.y;
    const distance = Math.hypot(dx, dy);
    // 先加速、近目标时收鳍减速；危险路径仍是预警锁定的直线。
    const speed = 1.45 + 10.7 * Math.min(1, boss.attackElapsed / 140, distance / 64);
    const beforeX = boss.x, beforeY = boss.y;
    const arrived = moveToward(boss, target.x - boss.w / 2, target.y - boss.h / 2, speed * step);
    leviathanMotionPose(boss, delta, "dash", (boss.x - beforeX) / Math.max(0.01, step), (boss.y - beforeY) / Math.max(0.01, step));
    if (!arrived && boss.attackElapsed < 1800) return;
    boss.leviathanDashCount += 1;
    if (phase === 2 && boss.leviathanDashCount < 2) {
      beginLeviathanWarning(boss, state, "breach");
    } else finishLeviathanAttack(boss);
  }
}

function updateBoss(boss, delta, state, fireFn, spawnFn) {
  if (boss.inCutscene) return;

  // 打掉一整层血条：全局硬直窗口（不写招式、不改位置），与白闪一起在 battle.drawEnemies 表现
  if ((boss.hpBarBreakFlashMs || 0) > 0) {
    boss.hpBarBreakFlashMs = Math.max(0, boss.hpBarBreakFlashMs - delta);
  }
  if ((boss.layerBreakStunMs || 0) > 0) {
    boss.layerBreakStunMs = Math.max(0, boss.layerBreakStunMs - delta);
    return;
  }

  if (boss.bossVariant === "leviathan") {
    updateBossLeviathan(boss, delta, state, fireFn);
    return;
  }
  if (boss.bossVariant === "antlerKing") {
    updateGrasslandBoss(boss, delta, state, fireFn, spawnFn);
    return;
  }
  if (boss.bossVariant === "yama") {
    updateHellBoss(boss, delta, state, fireFn, spawnFn);
    return;
  }
  if (boss.bossVariant === "hanba") {
    updateBossHanba(boss, delta, state, fireFn, spawnFn);
    return;
  }
  if (boss.bossVariant === "voidCore") {
    updateBossVoidCore(boss, delta, state, fireFn);
    return;
  }
  if (boss.bossVariant === "azure") {
    updateBossAzure(boss, delta, state, fireFn, spawnFn);
    return;
  }
  if (boss.bossVariant === "void") {
    updateBossVoid(boss, delta, state, fireFn, spawnFn);
    return;
  }
  state.voidDarknessAlpha = 0;
  state.voidSafeZone = null;
  state.finalJudgementDangerMs = 0;
  state.finalJudgementRushHangMs = 0;
  state.finalJudgementPetalMs = 0;
  state.finalJudgementPetalMotionDone = false;
  updateBossClassic(boss, delta, state, fireFn, spawnFn);
}

module.exports = {
  updateBoss,
  ATTACKS,
  ATTACK_POOLS,
  CLASSIC_COMBOS,
  AZURE_SEQUENCES,
  HANBA_ATTACKS,
  HANBA_POOLS,
  HANBA_COMBOS,
  LEVIATHAN_SEQUENCES,
  GRASS_BOSS_SEQUENCES,
  HELL_BOSS_SEQUENCES,
};
