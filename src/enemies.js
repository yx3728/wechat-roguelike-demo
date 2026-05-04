/**
 * enemies.js
 * ----------------------------------------------------------------------------
 * 所有敌机定义、AI 移动、攻击逻辑。
 *
 * 每个敌机对象通用字段：
 *   type         "grunt" | "swift" | "tank" | "shooter" | "weaver" | "elite" | "boss"
 *   color        渲染颜色
 *   x, y, w, h   位置和尺寸（左上角坐标）
 *   hp / maxHp   血量
 *   speed        垂直下降速度（像素/帧）
 *   exp          击杀给予玩家的经验
 *   coin         击杀给予玩家的金币
 *   isElite      精英标记（高掉落率）
 *   isBoss       Boss 标记（特殊行为）
 *   fireCooldown 射击倒计时（毫秒）
 *   fireInterval 两次射击之间的间隔（毫秒，仅会射击的敌机用）
 *
 * 调整难度：
 *   - 改各 createXxx() 中的 hp / speed / size / exp / coin
 *   - 改 pickEnemyType / spawnEnemyForWave：敌人池仅按 waveIndex（1/2/3）对齐三阶段
 *   - 改 maybeFire 里 Boss 的弹幕模式
 * ----------------------------------------------------------------------------
 */

const { W, H } = require("./config.js");

// ============================================================================
// 各种敌机的工厂函数。level 是玩家当前等级，用来微调难度成长。
// ============================================================================

/** 普通敌机：直线下降，最常见 */
function createGrunt(level) {
  const size = 22 + Math.random() * 14;
  return {
    type: "grunt",
    color: "#ef4444",
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (1 + Math.floor(level / 4)) * 1000,       // 玩家每 4 级敌人 +1 HP
    maxHp: (1 + Math.floor(level / 4)) * 1000,
    speed: 1.5 + Math.random() * 1.0 + level * 0.04,
    vx: 0,
    exp: 5 + Math.floor(level / 4) * 2,
    coin: 1,
    fireCooldown: 0,
  };
}

/** 速攻型：体积小，速度快，HP 仅 1 */
function createSwift(level) {
  const size = 18 + Math.random() * 6;
  return {
    type: "swift",
    color: "#f59e0b",
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (1 + Math.floor(level / 3)) * 1000,
    maxHp: (1 + Math.floor(level / 3)) * 1000,
    speed: 3.2 + Math.random() * 0.8 + level * 0.05,
    vx: 0,
    exp: 6,
    coin: 1,
    fireCooldown: 0,
  };
}

/** 重装型：高 HP，速度慢，撞过来很烦人 */
function createTank(level) {
  const size = 36 + Math.random() * 10;
  return {
    type: "tank",
    color: "#7c3aed",
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (3 + Math.floor(level / 2)) * 1000,       // 玩家每 2 级 +1 HP（降低基础值）
    maxHp: (3 + Math.floor(level / 2)) * 1000,
    speed: 1.0 + level * 0.02,
    vx: 0,
    exp: 28,
    coin: 5,
    fireCooldown: 0,
  };
}

/** 射手型：到屏幕上方后会停下来左右移动并射击 */
function createShooter(level) {
  const size = 28;
  return {
    type: "shooter",
    color: "#10b981",
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (3 + Math.floor(level / 3)) * 1000,
    maxHp: (3 + Math.floor(level / 3)) * 1000,
    speed: 0.9,
    vx: 0,
    exp: 14,
    coin: 2,
    fireCooldown: 1500,    // 出生后 1.5 秒才开始第一次射击
    fireInterval: 1800,    // 之后每 1.8 秒射一发
  };
}

/** 蛇形：左右摆动下降 */
function createWeaver(level) {
  const size = 24;
  return {
    type: "weaver",
    color: "#c026d3", // 品红蛇：与玩家青蓝机型区分（原 #22d3ee 过近）
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (2 + Math.floor(level / 4)) * 1000,
    maxHp: (2 + Math.floor(level / 4)) * 1000,
    speed: 1.6 + level * 0.03,
    vx: 0,
    weavePhase: Math.random() * Math.PI * 2, // 摆动相位（让多个 weaver 不同步）
    exp: 10,
    coin: 1,
    fireCooldown: 0,
  };
}

/** 精英怪：金黄色，高 HP，会射击三连发（略大体型以贴合立绘碰撞） */
function createElite(level) {
  const size = 60;
  return {
    type: "elite",
    color: "#facc15",
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    // 调整为更平滑的成长，避免二波血量离谱
    hp: (5 + Math.floor(level * 0.7)) * 1000,
    maxHp: (5 + Math.floor(level * 0.7)) * 1000,
    speed: 1.1 + level * 0.02,
    vx: 0,
    exp: 40,
    coin: 8,
    fireCooldown: 1000,
    fireInterval: 1400,
    eliteBurstLeft: 3,      // 连续攻击次数（打完后进入暂停）
    eliteBurstMax: 3,
    eliteRestMs: 1000,      // 暂停 1 秒
    eliteRestLeft: 0,
    isElite: true,
  };
}

/**
 * Boss：复杂招式驱动，由 bossAi.js 处理。
 * 这里只负责构造初始字段。
 */
function createBoss(variant) {
  const size = 120;
  const bossVariant = variant || "crimson";
  const color = bossVariant === "azure" ? "#0ea5e9" : (bossVariant === "void" ? "#7c3aed" : "#dc2626");
  return {
    type: "boss",
    color,
    x: W / 2 - size / 2,
    y: -size - 10,
    w: size,
    h: size,
    // 固定血量：不随等级成长
    hp: 1920000,
    maxHp: 1920000,
    speed: 1.4,
    targetY: 90,
    vx: 0,
    movePhase: 0,
    exp: 0,
    coin: 800,

    // bossAi 字段
    entered: false,
    homeX: W / 2 - size / 2,
    homeY: 90,
    currentAttack: null,
    lastAttack: null,
    attackElapsed: 0,
    attackTimer: 800,
    attackBurstTimer: 0,
    attackBurstCount: 0,
    aiSubPhase: null,
    aiSubTimer: 0,
    dashTargetX: 0,
    dashTargetY: 0,
    bossLaserWarn: false,
    bossLaserAng: 0,
    bossVariant,

    isBoss: true,
  };
}

/** 虚空二阶段「本体」：更小、更快，由 bossAi updateBossVoidCore 驱动 */
function createVoidCoreBoss(cx, cy) {
  const size = 70;
  return {
    type: "boss",
    color: "#a855f7",
    x: cx - size / 2,
    y: cy - size / 2,
    w: size,
    h: size,
    hp: 2960000,
    maxHp: 2960000,
    speed: 3.76,
    vx: 0,
    vy: 0,
    exp: 0,
    coin: 800,
    entered: true,
    homeX: W / 2 - size / 2,
    homeY: 88,
    currentAttack: null,
    lastAttack: null,
    attackElapsed: 0,
    attackTimer: 900,
    attackBurstTimer: 0,
    attackBurstCount: 0,
    aiSubPhase: null,
    movePhase: 0,
    bossLaserWarn: false,
    bossLaserAng: 0,
    bossVariant: "voidCore",
    isBoss: true,
    isVoidCore: true,
    spinAngle: 0,
    chargeProgress: 0,
    coreIntroScale: 0,
    voidCorePulseCd: 0,
    voidCoreTentacleAng: 0,
    voidCoreTentacleCd: 0,
    voidCoreEdgeCd: 0,
    voidCoreSpiralCd: 0,
    voidCoreNovaCd: 0,
    voidCoreSnipeCd: 0,
    voidCoreSnipeFlashMs: 0,
    voidCorePulseWave: 0,
  };
}

// ============================================================================
// 普通波次的随机生成。权重越大越常出。
// ============================================================================

function pickEnemyType(wave) {
  // wave 对应 battle.waveIndex：波1grunt；波2+swift/weaver/tank；波3+shooter。
  const pool = [];
  if (wave >= 1) pool.push(["grunt", 5]);
  if (wave >= 2) pool.push(["swift", 2]);
  if (wave >= 2) pool.push(["weaver", 2]);
  if (wave >= 2) pool.push(["tank", 1]);
  if (wave >= 3) pool.push(["shooter", 2]);

  let total = 0;
  pool.forEach((p) => {
    total += p[1];
  });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= pool[i][1];
    if (r <= 0) return pool[i][0];
  }
  return "grunt";
}

/** 战斗场景每次刷怪时调用：wave 决定类型池，level 微调各 createXxx 数值 */
function spawnEnemyForWave(wave, level) {
  const t = pickEnemyType(wave);
  switch (t) {
    case "swift":   return createSwift(level);
    case "tank":    return createTank(level);
    case "shooter": return createShooter(level);
    case "weaver":  return createWeaver(level);
    default:        return createGrunt(level);
  }
}

// ============================================================================
// 每帧调用：根据敌机类型推进位置 / AI
// ============================================================================

/**
 * 推进一个敌机的位置和 AI 状态。
 * @param {object} enemy
 * @param {number} delta  本帧时间（毫秒）
 * @param {object} state  战斗 state（用来读 elapsed 等）
 */
function updateEnemy(enemy, delta, state) {
  // Boss 由 bossAi.js 在 battle.js 中单独驱动
  if (enemy.isBoss) return;

  // 蛇形：sin 波摆动
  if (enemy.type === "weaver") {
    enemy.weavePhase += delta * 0.005;
    enemy.x += Math.sin(enemy.weavePhase) * 1.6; // 摆幅
    enemy.y += enemy.speed;
    return;
  }

  // 射手：先飞到 y=100 停下，再左右轻微浮动
  if (enemy.type === "shooter") {
    if (enemy.y < 100) {
      enemy.y += enemy.speed;
    } else {
      enemy.x += Math.sin(state.elapsed * 0.002) * 0.6;
    }
    return;
  }

  // 默认行为：直线下降
  enemy.y += enemy.speed;
  enemy.x += enemy.vx;
}

// ============================================================================
// 每帧调用：会射击的敌机/Boss 的开火逻辑
// ============================================================================

/**
 * 让能射击的敌机吐子弹。
 * @param {function} fireFn  传入子弹对象 { x, y, w, h, vx, vy, dmg } 添加到敌方弹幕池
 */
function maybeFire(enemy, delta, state, fireFn) {
  // Boss 弹幕逻辑已迁移到 bossAi.js
  if (enemy.isBoss) return;

  // ---------- 射手 / 精英 ----------
  if (enemy.type === "shooter" || enemy.type === "elite") {
    if (enemy.y < 60) return; // 还没到屏幕里就别射

    if (enemy.type === "elite") {
      // 精英节奏：连续攻击一段时间 -> 暂停 1 秒 -> 再攻击
      if (typeof enemy.eliteBurstLeft !== "number") enemy.eliteBurstLeft = 3;
      if (typeof enemy.eliteBurstMax !== "number") enemy.eliteBurstMax = 3;
      if (typeof enemy.eliteRestLeft !== "number") enemy.eliteRestLeft = 0;
      if (typeof enemy.eliteRestMs !== "number") enemy.eliteRestMs = 1000;

      if (enemy.eliteRestLeft > 0) {
        enemy.eliteRestLeft -= delta;
        if (enemy.eliteRestLeft > 0) return;
        // 休息结束后，给一个短前摇再继续攻击
        enemy.eliteBurstLeft = enemy.eliteBurstMax;
        enemy.fireCooldown = Math.max(200, enemy.fireInterval * 0.5);
      }
    }

    enemy.fireCooldown -= delta;
    if (enemy.fireCooldown > 0) return;
    enemy.fireCooldown = enemy.fireInterval;
    const cx = enemy.x + enemy.w / 2;
    const cy = enemy.y + enemy.h;

    if (enemy.type === "elite") {
      // 精英：3 路弹幕
      [-1, 0, 1].forEach((d) => {
        fireFn({ x: cx - 4, y: cy, w: 7, h: 12, vx: d * 1.6, vy: 4.5, dmg: 1 });
      });
      enemy.eliteBurstLeft -= 1;
      if (enemy.eliteBurstLeft <= 0) {
        enemy.eliteRestLeft = enemy.eliteRestMs;
      }
    } else {
      // 普通射手：单发直射
      fireFn({ x: cx - 4, y: cy, w: 7, h: 12, vx: 0, vy: 4.2, dmg: 1 });
    }
  }
}

module.exports = {
  spawnEnemyForWave,
  createGrunt,
  createSwift,
  createElite,
  createBoss,
  createVoidCoreBoss,
  updateEnemy,
  maybeFire,
};

