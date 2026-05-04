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
      boss.attackBurstTimer = 240;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h / 2;
      const N = 14;
      const baseAng = boss.attackBurstCount * 0.35;
      boss.attackBurstCount += 1;
      for (let i = 0; i < N; i += 1) {
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
    update(boss, delta, state, fireFn) {
      boss.attackBurstTimer -= delta;
      if (boss.attackBurstTimer > 0) return;
      boss.attackBurstTimer = 380;

      // 一整道横排弹幕，留两个间隙位置
      const N = 12;
      const gap1 = Math.floor(Math.random() * N);
      let gap2 = (gap1 + 5 + Math.floor(Math.random() * 3)) % N;
      if (gap2 === gap1) gap2 = (gap1 + 6) % N;
      const cy = boss.y + boss.h;
      for (let i = 0; i < N; i += 1) {
        if (i === gap1 || i === gap2) continue;
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
      boss.attackBurstTimer = 110;
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h / 2;
      const N = 18;
      const baseAng = boss.attackBurstCount * 0.27;
      boss.attackBurstCount += 1;
      const v = boss.attackBurstCount % 2 === 0 ? 3.4 : 4.6;
      for (let i = 0; i < N; i += 1) {
        const ang = baseAng + (i / N) * Math.PI * 2;
        fireFn({
          x: cx - 4, y: cy, w: 7, h: 9,
          vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
          dmg: 1,
        });
      }
    },
    move(boss, delta) {
      roam(boss, delta, 1, 1.5, 1, 0.85);
    },
  },
};

const ATTACK_POOLS = {
  1: ["aimedTriple", "ringSpin", "fanSweep"],
  2: ["ringSpin", "fanSweep", "walledBarrier", "aimedTriple", "laserBeam"],
  3: ["crossSpiral", "diveBomb", "summonAdds", "fanSweep", "laserBeam", "walledBarrier"],
  4: ["omniBurst", "diveBomb", "crossSpiral", "ringSpin", "summonAdds", "walledBarrier", "laserBeam"],
};

function pickAttack(boss) {
  const ratio = boss.hp / boss.maxHp;
  let pool;
  if (ratio > 0.75) pool = ATTACK_POOLS[1];
  else if (ratio > 0.5) pool = ATTACK_POOLS[2];
  else if (ratio > 0.25) pool = ATTACK_POOLS[3];
  else pool = ATTACK_POOLS[4];

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
    }
    return;
  }

  if (!boss.currentAttack) {
    boss.attackTimer -= delta;
    defaultMove(boss, delta);
    if (boss.attackTimer <= 0) {
      boss.currentAttack = pickAttack(boss);
      boss.lastAttack = boss.currentAttack;
      boss.attackElapsed = 0;
      boss.attackBurstTimer = 0;
      boss.attackBurstCount = 0;
      boss.aiSubPhase = null;
      const a = ATTACKS[boss.currentAttack];
      if (a && a.onStart) a.onStart(boss);
    }
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
    boss.attackTimer = 500 + Math.random() * 600;
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
      for (let ti = 0; ti < targets.length; ti += 1) {
        const t = targets[ti];
        const ang = Math.atan2(t.y - bcY, t.x - bcX);
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

function pickAzureMode(boss) {
  const normals = ["rain", "rotor", "laneSweep"];
  const heavies = ["spinRam", "diveCrash", "sideColumns"];
  const canUseHeavy = (boss.azureNormalsSinceHeavy || 0) >= 2 && Math.random() < 0.35;
  const pool = canUseHeavy ? heavies : normals;
  const arr = pool.filter((m) => m !== boss.azureMode);
  const next = arr[Math.floor(Math.random() * arr.length)];
  if (heavies.indexOf(next) >= 0) boss.azureNormalsSinceHeavy = 0;
  else boss.azureNormalsSinceHeavy = (boss.azureNormalsSinceHeavy || 0) + 1;
  return next;
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
  boss.azureSpin += delta * 0.004;

  if (boss.azureModeElapsed >= modeDurations[boss.azureMode]) {
    boss.azureMode = pickAzureMode(boss);
    boss.azureModeElapsed = 0;
    boss.azureShotTimer = 0;
    boss.azureSub = null;
  }

  if (boss.azureMode === "rain") {
    const tx = boss.homeX + Math.sin(boss.azureSpin * 0.7) * 110;
    const ty = boss.homeY + Math.sin(boss.azureSpin * 1.1) * 10;
    moveToward(boss, tx, ty, 3.8);

    if (boss.azureShotTimer <= 0) {
      boss.azureShotTimer = 180;
      const base = Math.PI / 2 + (Math.random() - 0.5) * 0.2;
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
    const t = boss.azureModeElapsed / modeDurations.laneSweep;
    const tx = 20 + (W - boss.w - 40) * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
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
};
