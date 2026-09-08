/**
 * enemies.js
 * ----------------------------------------------------------------------------
 * 所有敌机定义、AI 移动、攻击逻辑。
 *
 * 每个敌机对象通用字段：
 *   type         星空："grunt" | "swift" | "tank" | "shooter" | "weaver"
 *                沙漠："sandmite" | "skimmer" | "dunecrawler" | "rattler" | "burrower"
 *                通用："elite" | "boss"
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
 *   untargetable true 时不可被击中也不参与撞机（掘地者潜沙期），battle.js 各碰撞处豁免
 *   deathBurst   >0 时死亡爆散该数量的环形弹（沙丘龟），钩子在 battle.js onEnemyDefeated
 *
 * 调整难度：
 *   - 改各 createXxx() 中的 hp / speed / size / exp / coin
 *   - 改 pickEnemyType / spawnEnemyForWave：敌人池仅按 waveIndex（1/2/3）对齐三阶段
 *   - 改 maybeFire 里 Boss 的弹幕模式
 * ----------------------------------------------------------------------------
 */

const { W, H } = require("./config.js");
const oceanEnemies = require("./oceanEnemies.js");
const grasslandEnemies = require("./grasslandEnemies.js");
const hellEnemies = require("./hellEnemies.js");

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

// ============================================================================
// 沙漠地图专属杂兵（与星空的五种一一对位，但处理方式各不相同）
//
// 配色规则：**不与星空敌人重复**，且必须压得住变亮的暖色沙地。
//   已占用（星空）：grunt #ef4444 红 / swift #f59e0b 琥珀 / tank #7c3aed 紫
//                   shooter #10b981 翠 / weaver #c026d3 品红 / elite #facc15 黄
//                   boss #dc2626 红 · #0ea5e9 天蓝 · #a855f7 亮紫
//   沙漠一律走冷色与骨白，与暖沙形成冷暖对比：
//   sandmite     沙蜂     编队斜切     对位 grunt
//   skimmer      掠沙者   侧边横掠     对位 swift
//   dunecrawler  沙丘龟   死亡尸爆     对位 tank
//   rattler      响尾炮   横扫弹墙     对位 shooter
//   burrower     掘地者   潜沙无敌窗口 对位 weaver
// ============================================================================

/**
 * 沙蜂：**速度极快、完全不开火**的纯冲撞型。成组斜向切入，
 * 碰到屏幕左右边界会反弹，所以会在视野里高速来回犁，靠速度和数量封走位。
 * 入场角度偏向横向，横速大于纵速——这样"很快"体现在穿梭上，而不是一秒就掉出屏幕。
 */
function createSandmite(level, formation) {
  const size = 20 + Math.random() * 8;
  const f = formation || {};
  // 编队共用同一入场角度；单独生成时随机一个
  const ang = typeof f.ang === "number" ? f.ang : (Math.random() < 0.5 ? -1 : 1) * (0.75 + Math.random() * 0.35);
  const speed = 4.0 + level * 0.06;
  return {
    type: "sandmite",
    color: "#84cc16",   // 酸橙绿：黄绿向，与 shooter 的蓝绿翠色分得开
    x: typeof f.x === "number" ? f.x : Math.random() * Math.max(1, W - size),
    y: typeof f.y === "number" ? f.y : -size - 10,
    w: size,
    h: size,
    hp: (1 + Math.floor(level / 4)) * 1000,
    maxHp: (1 + Math.floor(level / 4)) * 1000,
    speed: speed * Math.cos(ang),
    vx: speed * Math.sin(ang),
    exp: 5 + Math.floor(level / 4) * 2,
    coin: 1,
    fireCooldown: 0,
    /** 纯冲撞型：永不开火（含 battle.js 里"30 秒后普通敌人也单发射击"那条） */
    neverFires: true,
  };
}

/**
 * 掠沙者：全游戏唯一不从顶部进场的敌人。贴着屏幕下半从左右横掠而过，
 * 直接威胁玩家常驻的底部走位区。speed=0 + vx≠0 走 updateEnemy 的默认分支即是纯横移。
 */
function createSkimmer(level) {
  const size = 18 + Math.random() * 5;
  const fromLeft = Math.random() < 0.5;
  const spd = 4.5 + level * 0.03;
  return {
    type: "skimmer",
    color: "#e11d48",   // 玫红：与 grunt 正红、weaver 品红都拉得开；横掠极快需要最强辨识度
    x: fromLeft ? -size - 6 : W + 6,
    // 只在屏幕下半随机高度出现（玩家活动区）
    y: H * 0.5 + Math.random() * (H * 0.34),
    w: size,
    h: size,
    hp: (1 + Math.floor(level / 3)) * 1000,
    maxHp: (1 + Math.floor(level / 3)) * 1000,
    speed: 0,
    vx: fromLeft ? spd : -spd,
    exp: 6,
    coin: 1,
    fireCooldown: 0,
    neverFires: true,
  };
}

/** 沙丘龟：高血慢速，死亡瞬间爆散 8 发环形沙弹（钩子在 battle.js onEnemyDefeated） */
function createDunecrawler(level) {
  const size = 38 + Math.random() * 8;
  return {
    type: "dunecrawler",
    color: "#1e3a8a",   // 海军蓝：冷色重甲，在暖沙上最压得住体量
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (3 + Math.floor(level / 2)) * 1000,
    maxHp: (3 + Math.floor(level / 2)) * 1000,
    speed: 0.9,
    vx: 0,
    exp: 28,
    coin: 5,
    fireCooldown: 0,
    /** 死亡尸爆：环形弹数量（0 = 不爆） */
    deathBurst: 8,
  };
}

/** 响尾炮：飞到 y=100 停下，发射带缺口的横向弹墙缓慢下压，不能靠站位躲、必须找缺口 */
function createRattler(level) {
  const size = 30;
  return {
    type: "rattler",
    color: "#0e7490",   // 深青：冷钢炮台感；比 boss 天蓝更暗更沉，不会混
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size * 1.6,   // 横长条
    h: size * 0.7,
    hp: (3 + Math.floor(level / 3)) * 1000,
    maxHp: (3 + Math.floor(level / 3)) * 1000,
    speed: 0.9,
    vx: 0,
    exp: 14,
    coin: 2,
    fireCooldown: 1600,
    fireInterval: 2600,
  };
}

/**
 * 掘地者：潜沙循环，逼玩家掐时机而不是无脑扫射。
 *   burrowPhase "under" 潜行（半透明、untargetable：不可被击中也不碰撞）
 *               "up"    冒头（可击杀），冒头瞬间朝玩家方向冲刺
 * 沙暴期几乎看不见它，是沙暴期最大的威胁。
 */
function createBurrower(level) {
  const size = 26;
  return {
    type: "burrower",
    color: "#f5f5f4",   // 骨白：沙下生物；白色未被任何既有敌人占用
    x: Math.random() * Math.max(1, W - size),
    y: -size - 10,
    w: size,
    h: size,
    hp: (2 + Math.floor(level / 4)) * 1000,
    maxHp: (2 + Math.floor(level / 4)) * 1000,
    speed: 2.0,
    vx: 0,
    exp: 10,
    coin: 1,
    fireCooldown: 0,
    burrowPhase: "up",
    burrowTimer: 800,
    untargetable: false,
  };
}

/** 掘地者的潜/现时长（沙暴期潜行缩短 40%，破土更频繁） */
const BURROW_UNDER_MS = 1200;
const BURROW_UP_MS = 800;

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
    hp: (50 + Math.floor(level * 0.7)) * 1000,
    maxHp: (50 + Math.floor(level * 0.7)) * 1000,
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
 * 沙漠精英「沙蠕」：星空精英是"从上方降下来的高血射手"，沙蠕反过来——
 * 它大部分时间不在场上，在沙下移动，只在破土的窗口里可以被打。
 * 战斗节奏从"持续输出"变成"抓窗口爆发"。
 *
 * 四个阶段循环（wormPhase）：
 *   under   潜行：地面留下一道朝玩家移动的沙痕，本体不可被击中（untargetable）
 *   telegraph 破土预警：沙痕停下、该处地面隆起闪烁
 *   erupt   破土：该位置升起沙柱，接触判伤（沙柱由 battle.js 转成一圈敌弹）
 *   up      露出：可被击杀，周期吐 5 路扇形沙弹
 *
 * 血量与星空精英同档，难度来自窗口而不是血条。
 */
const WORM_UNDER_MS = 2000;
const WORM_TELEGRAPH_MS = 600;
const WORM_UP_MS = 3000;
const WORM_FAN_INTERVAL_MS = 1100;

function createSandworm(level) {
  const size = 62;
  return {
    type: "sandworm",
    color: "#facc15",
    x: Math.random() * Math.max(1, W - size),
    y: H * 0.34 + Math.random() * (H * 0.24),
    w: size,
    h: size,
    hp: (50 + Math.floor(level * 0.7)) * 1000,
    maxHp: (50 + Math.floor(level * 0.7)) * 1000,
    speed: 1.6,
    vx: 0,
    exp: 40,
    coin: 8,
    fireCooldown: WORM_FAN_INTERVAL_MS,
    fireInterval: WORM_FAN_INTERVAL_MS,
    isElite: true,
    /** 沙蠕专属状态 */
    isSandworm: true,
    wormPhase: "under",
    wormTimer: WORM_UNDER_MS,
    /** >0 时 battle.js 在本体位置放一圈沙柱伤害，随后清零 */
    wormEruptPending: 0,
    untargetable: true,
  };
}

/** 沙蠕：潜行→预警→破土→露出 的循环。返回 true 表示本帧发生了破土 */
function updateSandworm(enemy, delta, state) {
  const stormOn = !!(state && state.sandstormActive);
  enemy.wormTimer -= delta;

  if (enemy.wormPhase === "under") {
    // 沙痕朝玩家缓慢移动（本体不可击中）
    enemy.untargetable = true;
    const pl = state && state.player;
    if (pl) {
      const tx = pl.x + pl.w / 2 - enemy.w / 2;
      const ty = pl.y + pl.h / 2 - enemy.h / 2 - 120;
      const dx = tx - enemy.x;
      const dy = ty - enemy.y;
      const len = Math.hypot(dx, dy) || 1;
      enemy.x += (dx / len) * enemy.speed;
      enemy.y += (dy / len) * enemy.speed * 0.7;
    }
    enemy.x = Math.max(0, Math.min(W - enemy.w, enemy.x));
    enemy.y = Math.max(60, Math.min(H - enemy.h - 40, enemy.y));
    if (enemy.wormTimer <= 0) {
      enemy.wormPhase = "telegraph";
      enemy.wormTimer = WORM_TELEGRAPH_MS;
    }
    return false;
  }

  if (enemy.wormPhase === "telegraph") {
    // 停下蓄力，位置锁定，仍不可被击中
    enemy.untargetable = true;
    if (enemy.wormTimer <= 0) {
      enemy.wormPhase = "up";
      enemy.wormTimer = WORM_UP_MS;
      enemy.untargetable = false;
      enemy.wormEruptPending = 1;      // 交给 battle.js 生成沙柱
      enemy.fireCooldown = WORM_FAN_INTERVAL_MS * 0.5;
      return true;
    }
    return false;
  }

  // up：露出，可被击杀
  enemy.untargetable = false;
  if (enemy.wormTimer <= 0) {
    enemy.wormPhase = "under";
    // 沙暴期潜行缩短 40%，破土更频繁
    enemy.wormTimer = WORM_UNDER_MS * (stormOn ? 0.6 : 1);
    enemy.untargetable = true;
  }
  return false;
}

// ============================================================================
//  Boss 注册表
//  加一个新 Boss 时**只改这里**：颜色、DEV 控制台里的显示名、能否被强制指定，
//  都从这张表读。battle.js 的强制白名单与 menu.js 的 DEV 选项也是从它派生的，
//  所以不会出现"菜单里能选、实际不生效"那种漏改。
//  （招式逻辑仍在 bossAi.js，按 bossVariant 分派。）
// ============================================================================
/**
 * 字段：
 *   forceable       DEV 控制台能否强制指定
 *   leadsToHidden   满血击败它是否触发隐藏 Boss（虚空线）
 *   continuous      招式机是"常驻输出型"（没有 currentAttack 的间隙），
 *                   battle.js 的杂兵停火判定据此处理
 *   coin            击败掉落金币；不写走默认 800
 */
const BOSS_VARIANTS = [
  { id: "crimson", name: "红", color: "#dc2626", forceable: true, leadsToHidden: true },
  { id: "azure", name: "蓝", color: "#0ea5e9", forceable: true, leadsToHidden: true, continuous: true, coin: 1000 },
  { id: "hanba", name: "旱魃", color: "#94a3b8", forceable: true },
  { id: "leviathan", name: "归墟·利维坦", color: "#5eead4", forceable: true, coin: 1000 },
  { id: "antlerKing", name: "苍岚鹿王", color: "#bbd784", forceable: true, coin: 1200 },
  { id: "yama", name: "阎罗", color: "#171418", forceable: true, coin: 1400 },
  { id: "void", name: "虚空", color: "#7c3aed", forceable: true, continuous: true },
  { id: "voidCore", name: "虚空二阶段", color: "#a855f7", forceable: true, continuous: true },
];

/** 满血击败后会接隐藏 Boss 的那些 variant */
function bossLeadsToHidden(id) {
  const b = getBossVariant(id);
  return !!(b && b.leadsToHidden);
}
/** 常驻输出型 Boss（没有出招间隙） */
function bossIsContinuous(id) {
  const b = getBossVariant(id);
  return !!(b && b.continuous);
}
/** 击败掉落金币 */
function bossCoin(id) {
  const b = getBossVariant(id);
  return (b && b.coin) || 800;
}

function getBossVariant(id) {
  for (let i = 0; i < BOSS_VARIANTS.length; i += 1) {
    if (BOSS_VARIANTS[i].id === id) return BOSS_VARIANTS[i];
  }
  return null;
}

/** DEV 控制台可强制指定的 Boss（menu.js 与 battle.js 都读它，避免两份清单走样） */
function forceableBossIds() {
  return BOSS_VARIANTS.filter((b) => b.forceable).map((b) => b.id);
}

/**
 * Boss：复杂招式驱动，由 bossAi.js 处理。
 * 这里只负责构造初始字段。
 */
function createBoss(variant, level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  const size = 120;
  const bossVariant = variant || "crimson";
  // 配色从 BOSS_VARIANTS 注册表读（旱魃用石灰白：风干的骨与石，
  // 与其余 Boss 及所有杂兵都不重色，冷灰压在暖色沙地上也最醒目）
  const meta = getBossVariant(bossVariant);
  const color = (meta && meta.color) || "#dc2626";
  return {
    type: "boss",
    color,
    x: W / 2 - size / 2,
    y: -size - 10,
    w: size,
    h: size,
    /**
     * 血量按"正常成长的玩家五分钟左右打完"定标（原来是 192，实测要 19~28 分钟）。
     *
     * 定标依据：正常玩家在 Boss 出场（第 90 秒）时约 Lv.8~9、手上 8 个词条、
     * 对 Boss DPS 4.5k~13k（不同角色差异很大）。四条成长路线的模型均值 309 秒。
     * 想改快慢就动这里的常数 15：它基本线性对应 TTK。
     */
    hp: (15 + Math.floor(lv / 2)) * 100000,
    maxHp: (15 + Math.floor(lv / 2)) * 100000,
    speed: 3.4,
    targetY: bossVariant === "leviathan" ? 224 : bossVariant === "antlerKing" ? 220 : 90,
    vx: 0,
    movePhase: 0,
    exp: 0,
    coin: bossVariant === "antlerKing" ? 1200 : bossVariant === "yama" ? 1400 : 800,

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
function createVoidCoreBoss(cx, cy, level) {
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  const size = 70;
  return {
    type: "boss",
    color: "#a855f7",
    x: cx - size / 2,
    y: cy - size / 2,
    w: size,
    h: size,
    /**
     * 二阶段本体。玩家打到这里已经先过了一个主 Boss、成长更高，
     * 所以系数比主 Boss 高一档；模型均值 347 秒。
     */
    hp: (22 + Math.floor(lv * 0.8)) * 100000,
    maxHp: (22 + Math.floor(lv * 0.8)) * 100000,
    speed: 6.76,
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

// ============================================================================
//  刷怪池表 + 敌人工厂表
//  加一张新地图时**只改这两张表**：往 ENEMY_POOLS 加一个键、把新敌人登记进
//  ENEMY_FACTORIES 即可。pickEnemyType / spawnEnemyForWave 不用动。
//  每项 { type, weight, minWave }：minWave 表示第几阶段起才会刷。
// ============================================================================
const ENEMY_POOLS = {
  starfield: [
    { type: "grunt", weight: 5, minWave: 1 },
    { type: "swift", weight: 2, minWave: 2 },
    { type: "weaver", weight: 2, minWave: 2 },
    { type: "tank", weight: 1, minWave: 2 },
    { type: "shooter", weight: 2, minWave: 3 },
  ],
  desert: [
    { type: "sandmite", weight: 5, minWave: 1 },
    { type: "skimmer", weight: 2, minWave: 2 },
    { type: "burrower", weight: 2, minWave: 2 },
    { type: "dunecrawler", weight: 1, minWave: 2 },
    { type: "rattler", weight: 2, minWave: 3 },
  ],
  ocean: [
    { type: "reefRay", weight: 5, minWave: 1 },
    { type: "needlefish", weight: 2, minWave: 1 },
    { type: "jellyfish", weight: 2, minWave: 2 },
    { type: "armoredCrab", weight: 1, minWave: 2 },
    { type: "inkCuttlefish", weight: 2, minWave: 3 },
  ],
  hell: [
    { type: "cinderHusk", weight: 5, minWave: 1 },
    { type: "soulPicker", weight: 3, minWave: 1 },
    { type: "brandBearer", weight: 2, minWave: 2 },
    { type: "chainWarden", weight: 2, minWave: 2 },
    { type: "forgeGullet", weight: 2, minWave: 3 },
  ],
  grassland: [
    { type: "meadowHare", weight: 5, minWave: 1 },
    { type: "bladeMantis", weight: 2, minWave: 1 },
    { type: "lanternBeetle", weight: 1, minWave: 2 },
    { type: "galeFalcon", weight: 2, minWave: 2 },
    { type: "thornBloom", weight: 2, minWave: 3 },
  ],
};

/** 敌人类型 → 工厂。沙蜂返回的是数组（编队），battle.js 的 spawnRegular 会处理 */
const ENEMY_FACTORIES = {
  grunt: createGrunt,
  swift: createSwift,
  tank: createTank,
  shooter: createShooter,
  weaver: createWeaver,
  sandmite: createSandmiteFormation,
  skimmer: createSkimmer,
  dunecrawler: createDunecrawler,
  rattler: createRattler,
  burrower: createBurrower,
  reefRay: oceanEnemies.createReefRay,
  needlefish: oceanEnemies.createNeedlefish,
  jellyfish: oceanEnemies.createJellyfish,
  armoredCrab: oceanEnemies.createArmoredCrab,
  inkCuttlefish: oceanEnemies.createInkCuttlefish,
  meadowHare: grasslandEnemies.createMeadowHare,
  bladeMantis: grasslandEnemies.createBladeMantis,
  lanternBeetle: grasslandEnemies.createLanternBeetle,
  thornBloom: grasslandEnemies.createThornBloom,
  galeFalcon: grasslandEnemies.createGaleFalcon,
  cinderHusk: hellEnemies.createCinderHusk,
  soulPicker: hellEnemies.createSoulPicker,
  brandBearer: hellEnemies.createBrandBearer,
  chainWarden: hellEnemies.createChainWarden,
  forgeGullet: hellEnemies.createForgeGullet,
};

function resolvePool(poolName) {
  return ENEMY_POOLS[poolName] || ENEMY_POOLS.starfield;
}

function pickEnemyType(wave, poolName) {
  const entries = resolvePool(poolName).filter((e) => wave >= e.minWave);
  const pool = entries.map((e) => [e.type, e.weight]);
  if (pool.length === 0) return resolvePool(poolName)[0].type;

  let total = 0;
  pool.forEach((p) => {
    total += p[1];
  });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= pool[i][1];
    if (r <= 0) return pool[i][0];
  }
  return pool[0][0];
}

/**
 * 战斗场景每次刷怪时调用：wave 决定类型池，level 微调各 createXxx 数值。
 * @param {string} poolName 地图刷怪池（maps.js enemyPool）；缺省走星空
 * @returns 单个敌机对象，或多个（沙蜂编队）组成的数组
 */
function spawnEnemyForWave(wave, level, poolName) {
  const t = pickEnemyType(wave, poolName);
  const make = ENEMY_FACTORIES[t] || ENEMY_FACTORIES[resolvePool(poolName)[0].type];
  return make(level);
}

/** 沙蜂编队：3~5 只共用同一斜向角度，横向依次排开一起切入 */
function createSandmiteFormation(level) {
  const count = 3 + Math.floor(Math.random() * 3);
  const ang = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.35);
  const step = 30;
  // 让整队斜着排开后仍大致落在屏内
  const spanW = step * (count - 1);
  const x0 = 10 + Math.random() * Math.max(1, W - 40 - spanW);
  const arr = [];
  for (let i = 0; i < count; i += 1) {
    arr.push(createSandmite(level, {
      ang,
      x: x0 + i * step,
      y: -28 - i * 22,
    }));
  }
  return arr;
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

  if (enemy.isOcean) {
    oceanEnemies.updateOceanEnemy(enemy, delta, state);
    return;
  }
  if (enemy.isGrassland) {
    grasslandEnemies.updateGrasslandEnemy(enemy, delta, state);
    return;
  }
  if (enemy.isHell) {
    hellEnemies.updateHellEnemy(enemy, delta, state);
    return;
  }

  // 掘地者：潜行（不可被击中）↔ 冒头（可击杀），冒头瞬间朝玩家方向冲刺
  if (enemy.type === "burrower") {
    const stormOn = !!(state && state.sandstormActive);
    enemy.burrowTimer -= delta;
    if (enemy.burrowTimer <= 0) {
      if (enemy.burrowPhase === "up") {
        enemy.burrowPhase = "under";
        // 沙暴期潜行缩短 40%，破土更频繁
        enemy.burrowTimer = BURROW_UNDER_MS * (stormOn ? 0.6 : 1);
        enemy.untargetable = true;
      } else {
        enemy.burrowPhase = "up";
        enemy.burrowTimer = BURROW_UP_MS;
        enemy.untargetable = false;
        // 破土瞬间朝玩家方向定一次冲刺向量
        const p = state && state.player;
        if (p) {
          const dx = (p.x + p.w / 2) - (enemy.x + enemy.w / 2);
          enemy.vx = Math.max(-2.6, Math.min(2.6, dx * 0.02));
        }
      }
    }
    // 潜行期下潜更快但不左右移动，冒头期才追玩家
    if (enemy.burrowPhase === "under") {
      enemy.y += enemy.speed * 0.55;
    } else {
      enemy.y += enemy.speed;
      enemy.x += enemy.vx;
    }
    return;
  }

  // 沙蠕（沙漠精英）：潜行 / 预警 / 破土 / 露出 循环
  if (enemy.isSandworm) {
    updateSandworm(enemy, delta, state);
    return;
  }

  // 沙蜂：斜向下行，撞到屏幕左右边界反弹（不飞出视野）
  if (enemy.type === "sandmite") {
    enemy.y += enemy.speed;
    enemy.x += enemy.vx;
    if (enemy.x <= 0) {
      enemy.x = 0;
      enemy.vx = Math.abs(enemy.vx);
    } else if (enemy.x + enemy.w >= W) {
      enemy.x = W - enemy.w;
      enemy.vx = -Math.abs(enemy.vx);
    }
    return;
  }

  // 响尾炮：与射手同样先到 y=100 停下，再左右轻微浮动
  if (enemy.type === "rattler") {
    if (enemy.y < 100) enemy.y += enemy.speed;
    else enemy.x += Math.sin(state.elapsed * 0.0018) * 0.7;
    return;
  }

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
/** 沙暴期敌方射击的随机偏移（弧度）；沙暴里敌人也看不清，给玩家一点喘息 */
function stormAimJitter(state) {
  if (!state || !state.sandstormActive) return 0;
  const deg = state.sandstormAimSpreadDeg || 0;
  if (deg <= 0) return 0;
  return (Math.random() * 2 - 1) * deg * Math.PI / 180;
}

function maybeFire(enemy, delta, state, fireFn) {
  // Boss 弹幕逻辑已迁移到 bossAi.js
  if (enemy.isBoss) return;

  // Boss 出招期间杂兵与精英停火（见 battle.js updateAddFireSuppression）。
  // 冷却继续走，所以停火结束时不会攒出一次齐射。
  if (state && state.addFireSuppressed) {
    if (typeof enemy.fireCooldown === "number" && enemy.fireInterval) {
      enemy.fireCooldown = Math.max(0, enemy.fireCooldown - delta);
    }
    return;
  }

  if (enemy.isOcean) {
    oceanEnemies.maybeFireOceanEnemy(enemy, delta, state, fireFn);
    return;
  }
  if (enemy.isGrassland) {
    grasslandEnemies.maybeFireGrasslandEnemy(enemy, delta, state, fireFn);
    return;
  }
  if (enemy.isHell) {
    hellEnemies.maybeFireHellEnemy(enemy, delta, state, fireFn);
    return;
  }

  // ---------- 沙蠕：只在露出期吐 5 路扇形沙弹 ----------
  if (enemy.isSandworm) {
    if (enemy.wormPhase !== "up") return;
    enemy.fireCooldown -= delta;
    if (enemy.fireCooldown > 0) return;
    enemy.fireCooldown = enemy.fireInterval;
    const cx = enemy.x + enemy.w / 2;
    const cy = enemy.y + enemy.h;
    const jitter = stormAimJitter(state);
    [-0.49, -0.245, 0, 0.245, 0.49].forEach((off) => {
      const a = Math.PI / 2 + off + jitter;
      fireFn({
        x: cx - 4, y: cy, w: 8, h: 10,
        vx: Math.cos(a) * 4.2,
        vy: Math.sin(a) * 4.2,
        dmg: 1,
      });
    });
    return;
  }

  // ---------- 响尾炮：带缺口的横向弹墙，缓慢下压 ----------
  if (enemy.type === "rattler") {
    if (enemy.y < 60) return;
    enemy.fireCooldown -= delta;
    if (enemy.fireCooldown > 0) return;
    enemy.fireCooldown = enemy.fireInterval;
    const SHOTS = 9;
    const GAPS = 2;
    // 每次随机挑 2 个缺口位（不取两端，免得贴边白嫖）
    const gapSet = Object.create(null);
    while (Object.keys(gapSet).length < GAPS) {
      gapSet[1 + Math.floor(Math.random() * (SHOTS - 2))] = true;
    }
    const stepX = W / (SHOTS - 1);
    const jitter = stormAimJitter(state);
    for (let i = 0; i < SHOTS; i += 1) {
      if (gapSet[i]) continue;
      fireFn({
        x: i * stepX - 4,
        y: enemy.y + enemy.h,
        w: 8, h: 10,
        vx: Math.sin(jitter) * 2.4,
        vy: 2.4,
        dmg: 1,
      });
    }
    return;
  }

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
      const jitterE = stormAimJitter(state);
      [-1, 0, 1].forEach((d) => {
        fireFn({ x: cx - 4, y: cy, w: 7, h: 12, vx: d * 1.6 + Math.sin(jitterE) * 3, vy: 4.5, dmg: 1 });
      });
      enemy.eliteBurstLeft -= 1;
      if (enemy.eliteBurstLeft <= 0) {
        enemy.eliteRestLeft = enemy.eliteRestMs;
      }
    } else {
      // 普通射手：单发直射（沙暴期带随机偏移）
      fireFn({ x: cx - 4, y: cy, w: 7, h: 12, vx: Math.sin(stormAimJitter(state)) * 4.2, vy: 4.2, dmg: 1 });
    }
  }
}

/** 精英工厂表：地图用 maps.js 的 eliteType 指名要哪一种 */
const ELITE_FACTORIES = {
  elite: createElite,
  sandworm: createSandworm,
  abyssalAngler: oceanEnemies.createAbyssalAngler,
  thunderBison: grasslandEnemies.createThunderBison,
  warden: hellEnemies.createWarden,
};

function createEliteFor(eliteType, level) {
  const make = ELITE_FACTORIES[eliteType] || ELITE_FACTORIES.elite;
  return make(level);
}

module.exports = {
  BOSS_VARIANTS,
  getBossVariant,
  forceableBossIds,
  bossLeadsToHidden,
  bossIsContinuous,
  bossCoin,
  ENEMY_POOLS,
  ENEMY_FACTORIES,
  ELITE_FACTORIES,
  createEliteFor,
  createRevenant: hellEnemies.createRevenant,
  onHellEnemyKilled: hellEnemies.onHellEnemyKilled,
  spawnSoulfireFor: hellEnemies.spawnSoulfireFor,
  spawnEnemyForWave,
  createGrunt,
  createSwift,
  createTank,
  createShooter,
  createWeaver,
  createElite,
  createBoss,
  createVoidCoreBoss,
  updateEnemy,
  maybeFire,
  // 沙漠杂兵（battle.js 的 Boss 召唤小怪等场合可直接取用）
  createSandworm,
  createSandmite,
  createSandmiteFormation,
  createSkimmer,
  createDunecrawler,
  createRattler,
  createBurrower,
  createReefRay: oceanEnemies.createReefRay,
  createNeedlefish: oceanEnemies.createNeedlefish,
  createJellyfish: oceanEnemies.createJellyfish,
  createArmoredCrab: oceanEnemies.createArmoredCrab,
  createInkCuttlefish: oceanEnemies.createInkCuttlefish,
  createAbyssalAngler: oceanEnemies.createAbyssalAngler,
  createMeadowHare: grasslandEnemies.createMeadowHare,
  createBladeMantis: grasslandEnemies.createBladeMantis,
  createLanternBeetle: grasslandEnemies.createLanternBeetle,
  createThornBloom: grasslandEnemies.createThornBloom,
  createGaleFalcon: grasslandEnemies.createGaleFalcon,
  createThunderBison: grasslandEnemies.createThunderBison,
  createCinderHusk: hellEnemies.createCinderHusk,
  createSoulPicker: hellEnemies.createSoulPicker,
  createBrandBearer: hellEnemies.createBrandBearer,
  createChainWarden: hellEnemies.createChainWarden,
  createForgeGullet: hellEnemies.createForgeGullet,
  createWarden: hellEnemies.createWarden,
};
