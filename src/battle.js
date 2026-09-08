/**
 * battle.js
 * ============================================================================
 * 战斗场景：游戏的核心。包含玩家飞机、子弹、敌机、敌弹、道具、波次、Boss、
 * 升级面板、Game Over 面板的全部逻辑。
 *
 * 文件结构（按出现顺序）：
 *   1. 工具函数（rectHit / dist2）
 *   2. createBattleScene(options)            主入口工厂
 *      ├─ 初始化 state（属性 = 角色基础 + 局外天赋加成）
 *      ├─ fireBullets()                       玩家子弹生成
 *      ├─ 波次相关（startWave / endWaveAndRest / nextWave / spawnRegular / spawnBoss）
 *      ├─ 经验 / 升级（gainExp / openUpgradePanel / pickUpgrade）
 *      ├─ 道具（dropLootFromEnemy / dropBossLoot / consumeItem / triggerBomb）
 *      ├─ UI 矩形（getRestartRect / getMenuRect / getPauseRect / getUpgradeButtonRect）
 *      ├─ update(delta)                       每帧更新
 *      ├─ draw(ctx)                           每帧绘制（拆成多个 drawXxx）
 *      └─ 触摸事件（onTouchStart / Move / End）
 *
 * 屏幕坐标：原点 (0,0) 在画布左上角。x→右增大，y→下增大。W=屏宽，H=屏高。
 *
 * 想调玩法：
 *   - 玩家初始属性：见 createBattleScene 内 state 初始值
 *   - 刷怪节奏：见 update() 中的 spawnInterval 公式
 *   - 升级经验曲线：见 gainExp() 中 state.expToNext 公式
 *   - 道具掉落率：见 dropLootFromEnemy（state.dropBase 来自 menu 天赋 + 0.18 基础）
 *   - 金币结算：见 dropLootFromEnemy / dropBossLoot
 *   - HUD 字体/位置：drawHud / getPauseRect
 *   - 升级面板字体/位置：drawUpgradePanel / getUpgradeButtonRect
 *   - 结算字体/位置：drawGameOver / getRestartRect / getMenuRect
 * ============================================================================
 */

const {
  W,
  H,
  THEMES,
} = require("./config.js");
const {
  spawnEnemyForWave,
  createElite,
  createSandworm,
  createEliteFor,
  forceableBossIds,
  bossLeadsToHidden,
  bossIsContinuous,
  bossCoin,
  createBoss,
  createVoidCoreBoss,
  createSwift,
  createGrunt,
  createGaleFalcon,
  createThornBloom,
  updateEnemy,
  maybeFire,
} = require("./enemies.js");
const {
  pickUpgrades,
  RARITY_COLORS,
  UPGRADE_POOL,
  hasAnyUpgradeAvailable,
  grantRunCoins,
  effectiveCritMult,
} = require("./upgrades.js");
const { createItem } = require("./items.js");
const {
  resolveSelectedMap,
  pickMapBossVariant,
  mapsUnlockedByHiddenBoss,
} = require("./maps.js");
const { getMechanic, mechanicDefaults } = require("./mechanics.js");
const { drawOceanBackground, drawOceanEnemy, drawOceanOverlay } = require("./oceanVisuals.js");
const { drawDesertEnemyVisual } = require("./desertVisuals.js");
const { drawEnemyTexture } = require("./enemyTextures.js");
const { drawCharacterTexture } = require("./characterVisuals.js");
const { drawGrasslandBackground, drawGrasslandEnemy, drawGrasslandOverlay, drawWindrunnerShape } = require("./grasslandVisuals.js");
const { drawGrasslandTexture } = require("./grasslandTextures.js");
const { interceptGrassBullet, grassPlayerMoveMul, consumeGrassAmbush, consumeGrasslandRewards } = require("./grasslandMechanics.js");
const { grassDamageTakenMul } = require("./grasslandEnemies.js");
const { drawHellBackground, drawHellEnemy, drawHellBoss, drawHellOverlay } = require("./hellVisuals.js");
const { hellEmberDamageMul, consumeEmberGuard, consumeHellRevenantRequests,
  consumeHellQuellPoints, onRevenantKilled } = require("./hellMechanics.js");
const { createRevenant, onHellEnemyKilled, spawnSoulfireFor, updateHellBeams } = require("./hellEnemies.js");
const { chargeWindrunner, consumeWindVolley, drawWindCharge } = require("./windrunner.js");
const { drawTidecallerShape } = require("./tidecallerVisuals.js");
const { aggregateBonuses } = require("./talents.js");
const storage = require("./storage.js");
const audio = require("./audio.js");

let cachedUpdateBoss = null;
function getUpdateBoss() {
  if (cachedUpdateBoss) return cachedUpdateBoss;
  try {
    const mod = require("../subpackages/pkg_boss/game.js");
    if (mod && typeof mod.updateBoss === "function") {
      cachedUpdateBoss = mod.updateBoss;
      return cachedUpdateBoss;
    }
  } catch (e) {
    // 分包未就绪时兜底为空实现，避免模块初始化阶段直接崩溃。
  }
  return function noopUpdateBoss() {};
}

/** 本局累计：免费用尽后按顺序扣金币重掷，至多额外 3 次（跨多次升级共用） */
const UPGRADE_PAID_REROLL_MAX = 3;
const UPGRADE_PAID_REROLL_COSTS = [200, 400, 800];

/** 命中清屏（onHitBombChance）内置冷却，避免连续触发时全屏闪光刷屏 */
const ON_HIT_BULLET_CLEAR_CD_MS = 5000;

/** 隐藏虚空 Boss 入场全屏黑白爆闪演出（毫秒） */
const HIDDEN_VOID_STROBE_MS = 1100;

/** 虚空二阶段过场（毫秒）：白闪躯壳淡出 → 紫幕换 BGM → 碎块向心聚拢 → 核心显形与充能 */
const VOID_P2_MS_FLASH = 1100;
const VOID_P2_MS_PURPLE = 2100;
const VOID_P2_MS_CONVERGE = 1700;
const VOID_P2_MS_CHARGE = 2400;
const VOID_P2_MS_CONV_START = VOID_P2_MS_FLASH + VOID_P2_MS_PURPLE;
const VOID_P2_MS_CORE_SPAWN = VOID_P2_MS_CONV_START + VOID_P2_MS_CONVERGE;
const VOID_P2_MS_TOTAL = VOID_P2_MS_CORE_SPAWN + VOID_P2_MS_CHARGE;

/** 第二 / 三阶段开战时刻（毫秒，elapsed）：与等级无关 */
const WAVE2_START_MS = 60 * 1000;
const WAVE3_START_MS = 90 * 1000;

/** 全局基础刷怪频率：在 curse 加速之前统一提高 20%（间隔除以本值） */
const BASE_SPAWN_FREQ_BOOST = 1.2;

/** Boss 血条固定 5 层：同矩形重叠绘制，每层 20% maxHp；最上层从左扣血，右侧递进露出下层色 */
const BOSS_HP_BAR_LAYER_COUNT = 5;

/** 打掉一整层血条时的硬直与闪烁（毫秒） */
const BOSS_LAYER_BREAK_STUN_MS = 1000;
const BOSS_LAYER_BREAK_FLASH_MS = 520;
const BOSS_LAYER_BREAK_STUN_STACK_MS = 120;
const BOSS_LAYER_BREAK_STUN_CAP_MS = 1800;

/**
 * 5 层高对比色：[0]=最底层最先看到露边，…，[4]=最顶层先被扣窄
 */
const BOSS_HP_BAR_COLORS = [
  "#eab308",
  "#22d3ee",
  "#34d399",
  "#818cf8",
  "#fb7185",
];

// ============================================================================
// 工具函数
// ============================================================================

/** AABB 矩形碰撞检测（任一侧缺字段则视为不相交，避免稀疏数组或空引用崩溃） */
function rectHit(a, b) {
  if (!a || !b) return false;
  const ax = a.x; const ay = a.y; const aw = a.w; const ah = a.h;
  const bx = b.x; const by = b.y; const bw = b.w; const bh = b.h;
  if (
    typeof ax !== "number" || typeof ay !== "number" || typeof aw !== "number" || typeof ah !== "number"
    || typeof bx !== "number" || typeof by !== "number" || typeof bw !== "number" || typeof bh !== "number"
  ) return false;
  return (
    ax < bx + bw &&
    ax + aw > bx &&
    ay < by + bh &&
    ay + ah > by
  );
}

/** 两点欧氏距离的平方（避免开方，比较距离时更快） */
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** 与道具磁吸一致的拾取半径（像素，含磁吸道具全屏加成） */
function pickupRadiusPx(state) {
  return state.magnetRange + (state.magnetTimerMs > 0 ? 9999 : 0);
}

/** 「时间流护盾」：区域内敌机本体位移降为 50%（每帧对已集成位移缩放，等价于速度与轨迹减半） */
const TIMEFLOW_SHIELD_MOVE_MUL = 0.5;

/** 沙暴期远处敌人的最低透明度（越小越看不清） */
const SANDSTORM_MIN_ENEMY_ALPHA = 0.14;

/** 「反间护盾」：转化敌弹的周期间隔（毫秒） */
const TURNCOAT_SHIELD_INTERVAL_MS = 15000;

function applyTimeflowEnemyDisplacementSlow(state, enemy, prevX, prevY) {
  if (!state.timeflowShield || !enemy) return;
  const r = pickupRadiusPx(state);
  const rsq = r * r;
  const px = state.player.x + state.player.w / 2;
  const py = state.player.y + state.player.h / 2;
  const ecx = enemy.x + enemy.w / 2;
  const ecy = enemy.y + enemy.h / 2;
  if (dist2(px, py, ecx, ecy) >= rsq) return;
  enemy.x = prevX + (enemy.x - prevX) * TIMEFLOW_SHIELD_MOVE_MUL;
  enemy.y = prevY + (enemy.y - prevY) * TIMEFLOW_SHIELD_MOVE_MUL;
}

/** 圆形与矩形碰撞 */
function circleRectHit(cx, cy, r, rect) {
  if (!rect || typeof rect.x !== "number" || typeof rect.w !== "number") return false;
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** 解析 #RRGGBB 为 [r,g,b] */
function hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 两个 #RRGGBB 按 t(0~1) 插值，返回 rgb(r,g,b) 字符串 */
function lerpHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(A[0] + (B[0] - A[0]) * k);
  const g = Math.round(A[1] + (B[1] - A[1]) * k);
  const bl = Math.round(A[2] + (B[2] - A[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

/** 把毫秒格式化为 mm:ss */
function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const mm = m < 10 ? `0${m}` : String(m);
  const ss = s < 10 ? `0${s}` : String(s);
  return `${mm}:${ss}`;
}

// ============================================================================
// 战斗场景工厂
// ============================================================================

/**
 * @param {object} options
 * @param {object} options.character  从菜单选中的角色（characters.js 的元素）
 * @param {function} options.onExit   退出战斗的回调，参数 { restart, character }
 *                                    restart=true 时直接重开同角色，否则回菜单
 */
function createBattleScene(options) {
  const { character, onExit, debug } = options;
  const UI_SHIFT_Y = 60;
  const isWarden = character && character.id === "warden";
  const isVampire = character && character.id === "vampire";
  const isMechanic = character && character.id === "mechanic";
  let forcedBossVariant = null; // "crimson" | "azure" | null(random)
  let forcedUpgradeIds = [];    // 本局必出升级 id 列表（每条保证至少出现一次）
  let vampireSatelliteImg = null;
  let vampireSatelliteImgReady = false;
  let orbitSatelliteImg = null;
  let orbitSatelliteImgReady = false;
  let satelliteTexturesRequested = false;

  function ensureSatelliteTextures() {
    if (satelliteTexturesRequested || !battleTexturesEnabled()
      || typeof wx === "undefined" || typeof wx.createImage !== "function") return;
    satelliteTexturesRequested = true;
    try {
      orbitSatelliteImg = wx.createImage();
      orbitSatelliteImg.onload = () => { orbitSatelliteImgReady = true; };
      orbitSatelliteImg.onerror = () => { orbitSatelliteImgReady = false; };
      orbitSatelliteImg.src = "subpackages/pkg_assets/images/satellite_orbital.png";
      if (isVampire) {
        vampireSatelliteImg = wx.createImage();
        vampireSatelliteImg.onload = () => { vampireSatelliteImgReady = true; };
        vampireSatelliteImg.onerror = () => { vampireSatelliteImgReady = false; };
        vampireSatelliteImg.src = "subpackages/pkg_assets/images/satellite_vampire.png";
      }
    } catch (e) {
      satelliteTexturesRequested = false;
    }
  }

  /** 所有战机、敌人和卫星统一遵循贴图开关。 */
  function battleTexturesEnabled() {
    return storage.get().battleTexturesOn === true;
  }

  // 把存档里的天赋等级转成战斗加成
  const save = storage.get();
  /** 本局地图（菜单里选、存档记住；见 maps.js）：决定背景色带与远景颗粒风格 */
  const battleMap = resolveSelectedMap(save);
  const mapThemes = (battleMap && battleMap.themes && battleMap.themes.length)
    ? battleMap.themes
    : THEMES;
  audio.setEnabled(save.musicOn !== false);
  audio.setVolume(save.musicVolume == null ? 1 : save.musicVolume);
  // 每局开场都从头播放 BGM（不沿用上一局播放进度）
  audio.stopAll();
  // 战斗场景默认走普通 BGM；进入第三阶段 / Boss 时再切到 bossbgm（关音乐时 play 内会直接 return）
  audio.playBgm();
  const bonuses = aggregateBonuses(save.talents);
  /** 局外诅咒天赋：敌方生命/伤害/刷怪频率分离倍率 */
  const curseEnemyHpMul = Math.max(0.001, 1 + (bonuses.curseEnemyHpPct || 0));
  const curseEnemyDmgMul = Math.max(0.001, 1 + (bonuses.curseEnemyDmgPct || 0));
  const curseSpawnMul = Math.max(0.001, 1 + (bonuses.curseSpawnPct || 0));

  // --------------------------------------------------------------------------
  // 战斗 state：所有跑动数据都放这里。绝大多数数值调整入口在这里。
  // --------------------------------------------------------------------------
  const state = {
    characterId: character && character.id, // 供局内升级判断（如机械师自带的卫星线与「轨道卫星」词条）

    windCharge: 0,
    windBurstMs: 0,
    tideVolleyCount: 0,
    newCharacterUnlockedName: "",

    // 计时器（毫秒）
    elapsed: 0,                          // 累计游玩时长
    waveIndex: 1,                        // 当前波次（从 1 开始）
    waveTimeLeft: 0,
    waveResting: false,
    waveRestLeft: 0,
    bossActive: false,
    spawnTimer: 0,                       // 距离下次刷怪的累计计时
    shootTimer: 0,                       // 距离下次玩家自动射击的累计计时
    regenTimer: 0,                       // 自动回血计时
    magnetTimerMs: 0,                    // 磁吸道具剩余持续时间
    invincibleMs: 0,                     // 暂时无敌剩余时间（拾取 INV 道具后）
    godMode: false,                      // DEV 调试：本局无敌（不受敌弹/撞机伤害）
    devOneHitKill: false,                 // DEV：伤害至少清空目标当前生命值（核心锁/Cutscene 除外）
    devTimeScale: 1,                     // DEV：逻辑时间缩放（如 10 倍速）
    /** DEV：各机制的强制态 { 机制id: "auto"|档位 }，见 mechanics.js devModes */
    devMechanics: {},

    bossDropTimer: 0,                    // Boss 战中道具周期掉落计时
    bossDropNextMs: 6000,                // 距离下次 Boss 战道具掉落的随机间隔
    bombFlashMs: 0,                      // 炸弹爆炸闪光剩余时间
    bombFlashColor: "rgba(255,255,255,0)",
    flashEffectsOn: save.flashEffectsOn !== false, // false 时屏蔽全屏闪光特效

    // 等级 / 击杀
    level: 1,
    exp: 0,
    expToNext: 5,                        // 第一次升级所需经验：5（约 5 个绿球）
    kills: 0,
    coinsEarned: 0,                      // 本局已赚金币（结算时累加到存档）
    /** 永雏塔菲：金币获取率 +1000% → 单笔金币×11（与角色描述一致） */
    coinGainMul: character && character.id === "taffy" ? 11 : 1,
    wave3BossSpawned: false,
    hiddenVoidConsumed: false,           // 本局已触发过「满血击败红/蓝 → 虚空」则不再重复
    hiddenVoidStrobeMs: 0,               // 隐藏虚空入场全屏黑白闪剩余时间

    // ---------- 玩家初始属性（角色 base + 天赋加成） ----------
    baseMaxHp: character.base.maxHp * (1 + (bonuses.hpPct || 0)), // 用于计算“血条随上限成长”的基准值
    maxHp: character.base.maxHp * (1 + (bonuses.hpPct || 0)),
    hp: character.base.maxHp * (1 + (bonuses.hpPct || 0)),
    bulletDamage: character.base.bulletDamage * (1 + (bonuses.dmgPct || 0)),
    shootInterval: Math.max(
      120,                               // 射击间隔下限 120ms（防止瞬移射击）
      Math.floor(character.base.shootInterval / (1 + (bonuses.fireRatePct || 0)))
    ),
    shootIntervalFloor: 80,              // 射速下限（默认 80ms；特定橙词条可下探）
    sideBullets: character.base.sideBullets,
    bulletPierceEnemies: !!character.base.bulletPierceEnemies,
    magnetRange: Math.round(40 * (1 + (bonuses.magnetPickupPct || 0))),
    curseEnemyHpMul,
    curseEnemyDmgMul,
    curseSpawnMul,
    contactDmgEnemy: 2000,                  // 兼容旧字段：撞机伤害改为按敌人类型固定值（见碰撞逻辑）
    hasRegen: isWarden,                  // 守望者自带每秒回血；其他角色默认无
    regenIntervalMs: isWarden ? 1000 : 12000, // 回血间隔（毫秒）
    regenHealRatio: isWarden ? 0.01 : 0,      // 比例乘以 baseMaxHp/秒（守望者 1%；其他角色默认 0，自动修复再叠加）

    // 经验/掉落倍率
    expMul: bonuses.expMul,              // 经验倍率（来自智慧天赋）
    dropBase: 0.05 + bonuses.dropBonus,  // 普通敌机基础掉落率（5% + 幸运加成）
    dropLevelUpChance: 0,               // 敌机阵亡时额外掉落 LV+ 道具概率（战术学习III）
    levelUpSupply: false,               // 「空投信标」：拾取后本局剩余时间内定期空投 LV+ 升级包
    levelUpSupplyTimer: 0,              // 空投计时
    levelUpSupplyNextMs: 40000,         // 距下次空投的随机间隔
    eliteGuaranteedDrop: false,          // 拿到“战利品雷达”后为 true（精英必掉道具）

    // ---------- 升级新机制（默认值，被 upgrades.js 中词条增益） ----------
    critRate: 0,                         // 暴击率 0~1
    critMult: 1.5,                       // 暴击倍率（连乘部分）
    critOverflowRate: 0,                 // 超过 95% 上限的暴击累计量；换算成爆伤加算，见 effectiveCritMult
    vampRate: isVampire ? 0.03 : 0,      // 吸血比例（吸血鬼自带 3%）
    vampPool: 0,                         // 吸血小数累积池
    bulletSizeMul: 1,                    // 子弹尺寸倍率
    bulletSpeedMul: 1,                   // 子弹速度倍率
    expOrbValueMul: 1,                   // 经验球价值倍率
    killHealChance: 0,                   // 击杀回血概率
    killHealRatio: 0,                    // 击杀回血比例（0.1 = 回复 10% 生命）
    killCoinBonus: 0,                    // 击杀获得额外金币
    onHitBombChance: 0,                  // 命中清弹概率
    onHitBulletClearCdUntilElapsed: 0,   // 命中清屏冷却：elapsed < 此值时不判定清屏
    onKillBombChance: 0,                 // 击杀清弹概率
    onKillBombItemChance: 0,           // 击杀时概率触发与「炸弹道具」相同的全屏爆炸（见 triggerBomb）
    bulletBreakBullets: false,           // 子弹可摧毁敌方弹幕（无坚不摧）
    satelliteCount: isMechanic ? 2 : (isVampire ? 1 : 0), // 机械师 2 颗；吸血鬼开局 1 颗
    satelliteDamagePerSec: isMechanic || isVampire ? 1500 : 0, // 与「轨道卫星」词条对齐的碰撞秒伤
    satelliteOrbitRadius: 38,            // 卫星轨道半径
    satelliteOrbitSpeed: 0.0045,         // 卫星角速度（弧度/毫秒）
    satelliteRadius: 6,                  // 卫星碰撞半径
    satelliteShotIntervalMs: 900,        // 卫星发射追踪弹间隔
    satelliteShotCooldownMs: 0,          // 卫星下次发射倒计时
    satelliteBreakBullets: false,        // 卫星可碰撞消除敌方弹幕（轨道卫星II）
    voidDarknessAlpha: 0,                // 虚空Boss黑化层透明度
    voidSafeZone: null,                  // 最终审判安全区提示
    voidGravityTraps: [],                // 虚空Boss引力陷阱（仅用于绘制/子弹弯折）
    voidFragments: [],                  // 一阶段躯壳爆碎粒子（过场用）
    voidFlashAlpha: 0,                  // 过场全屏白闪 0~1
    voidPhase2PurpleAlpha: 0,           // 过场紫幕浓度 0~1
    voidCoreUnlockAt: 0,               // 二阶段核心可受伤：elapsed 达到该值后受击
    voidCoreCombatStartAt: null,      // 过场彻底结束后写入，用于核心招式轮换与开火起点
    finalJudgementDangerMs: 0,           // >0：审判弹幕仍可造成伤害（喷发后短时）
    finalJudgementRushHangMs: 0,         // >0：未进安全区时清算弹幕全屏静置倒计时，结束后再飞向玩家
    finalJudgementPetalMs: 0,            // >0：审判余弹花瓣消散，无伤
    finalJudgementPetalMotionDone: false,
    overhealToShield: false,             // 超量血库：过量治疗转为护盾
    overhealToMaxHp: false,              // 超量血库II：过量治疗还永久提高生命上限
    overhealToExp: false,                // 超量血库III：过量治疗还转为经验
    bossDmgMul: 0.65,                       // 对 Boss 伤害倍率
    eliteDmgMul: 0.8,                      // 对精英伤害倍率
    thornReflectRate: 0,                 // 受击反弹比例（1=反弹 100% 受到伤害）
    pendingUpgradeHeal: 0,               // 升级词条累计的即时治疗，统一走 healPlayer 结算

    shieldMaxHp: 0,                      // 护盾上限（值）
    shieldHp: 0,                         // 当前护盾值
    shieldDamageMul: 1,                  // 护盾承伤倍率（2 = 同一伤害扣双倍护盾）
    shieldRegenPerSec: 0,                // 护盾每秒修复比例（0.1 = 每秒修 10% 上限）
    shieldFlashMs: 0,                    // 护盾抵挡时的闪光
    timeflowShield: false,               // 时间流护盾：拾取半径内敌人与敌弹位移减速（见 TIMEFLOW_SHIELD_MOVE_MUL）
    turncoatShield: false,               // 反间护盾：周期将拾取半径内敌弹转为追踪我方弹
    turncoatShieldAccMs: 0,              // 反间护盾：距下次转化的累计毫秒

    // 玩家飞机本体
    player: {
      x: W / 2 - 12,                     // 起始位置：水平居中
      y: H - 110,                        // 起始位置：屏幕底部往上 110
      w: 24,                             // 飞机宽
      h: 30,                             // 飞机高
      color: character.color,
    },

    // 各种实体数组（每帧动态变化）
    bullets: [],         // 玩家子弹
    enemies: [],         // 敌机/Boss/精英
    enemyBullets: [],    // 敌方子弹
    items: [],           // 道具掉落物

    // 触摸状态
    touchActive: false,
    touchOffsetX: 0,
    touchOffsetY: 0,

    // 暂停 / 结束 标记
    pausedForUpgrade: false,
    upgradePanelAnimMs: 0,               // 升级面板动画计时（暂停时也递增）
    autoRewardToastMs: 0,                // 进化池抽空后的"自动补给"HUD 提示剩余时长
    upgradeOptions: [],
    upgradeRerollLeft: Math.max(0, Math.floor(bonuses.rerollCount || 0)),
    upgradePruneLeft: Math.max(0, Math.floor(bonuses.pruneCount || 0)),
    upgradePruneArmed: false,            // 升级面板：已点击“剔除”，等待点选一个词条
    upgradePruneFx: null,                // 剔除碎裂动画：{ index, ms, total }
    upgradePaidRerollsUsed: 0,           // 本局已用付费重掷次数（≤3，各次升级面板共用）
    /** 拾取「高级重掷」后：仅下一次三选一的「首次」抽卡保底紫/橙；重掷或剔除后不再触发 */
    upgradeNextPanelPurplePlus: false,
    gameOver: false,
    win: false,                          // true=击败 Boss 胜利；false=死亡失败
    /** 通关结算页：击败虚空 Boss 后出现「无尽模式」入口（仅该局为 true） */
    offerEndlessAfterVoidWin: false,
    /** 无尽接续：敌人生命/伤害随玩家等级指数放大（公式见 ENDLESS_*_EXP_BASE） */
    endlessMode: false,
    /** 无尽下每完成一整圈回到阶段一（击退主Boss链）计数；用于刷小怪频率 ×1.2^N */
    endlessLapsCompleted: 0,
    endlessEnemyHpMulCached: 1,
    endlessEnemyDmgMulCached: 1,
    pauseRequested: false,

    // ---------- 本局地图（见 maps.js） ----------
    mapId: battleMap ? battleMap.id : "starfield",
    mapName: battleMap ? battleMap.name : "星空",
    mapParticle: battleMap && battleMap.particle ? battleMap.particle : "star",
    mapEnemyPool: (battleMap && battleMap.enemyPool) || "starfield",
    mapEliteType: (battleMap && battleMap.eliteType) || "elite",
    /** 本图启用的机制配置 { 机制id: cfg }，见 mechanics.js */
    mapMechanics: (battleMap && battleMap.mechanics) || {},
    /** Boss 战期间机制挂起（沙暴等交给 Boss 招式主动召唤） */
    mechanicsSuspended: false,
    mapSandSea: !!(battleMap && battleMap.sandSea),
    mapLoot: (battleMap && battleMap.loot) || null,

    // ---------- 旱魃（沙漠 Boss）写入的场地状态 ----------
    bossStormActive: false,              // Boss 主动召唤的沙暴
    bossStormAlpha: 0,
    bossStormVisionR: 0,
    quicksandZones: null,                // 生效中的流沙区（踩上去减速）
    quicksandWarnZones: null,            // 预警中的流沙区（尚不生效）
    hanbaDashWarn: null,                 // 尘暴冲撞的路径预警
    hanbaSpikeWarn: null,                // 裂地矛的升起预警
    hanbaVortexAt: null,                 // 旋沙中心

    // ---------- 机制字段（各机制自己声明默认值，见 mechanics.js） ----------
    ...mechanicDefaults(),
    /** 沙暴配置的快捷引用；没启用该机制时为 null */
    sandstormCfg: (battleMap && battleMap.mechanics && battleMap.mechanics.sandstorm) || null,
    tideCfg: (battleMap && battleMap.mechanics && battleMap.mechanics.tide) || null,
    grasslandCfg: (battleMap && battleMap.mechanics && battleMap.mechanics.grasslandHabitat) || null,
    hellCfg: (battleMap && battleMap.mechanics && battleMap.mechanics.hellfireRevenant) || null,

    /** Boss 出招期间为 true：同屏杂兵/精英停火，避免两层弹幕叠死安全走廊 */
    addFireSuppressed: false,

    // ---------- 沙漠专属词条（见 upgrades.js 的 options.maps 组） ----------
    stormFireRateMul: 1,        // 逆风者：沙暴期射速倍率
    stormClearSight: false,     // 沙镜 / 沙暴之眼：沙暴期敌人不再随距离淡化
    heatDeathPerTenth: 0,       // 热寂：敌人每快 10% 移速带来的增伤
    quicksandBind: false,       // 流沙缚：拾取范围内敌人额外减速
    stormEyeRegenRatio: 0,      // 沙暴之眼：沙暴期每秒回血比例
    stormEyeRegenAccMs: 0,
    stormDurationMul: 1,        // 旱魃之息：沙暴持续倍率
    stormDamageMul: 1,          // 旱魃之息：沙暴期全伤害倍率
    stormCoinMul: 1,            // 拾荒者：沙暴期拾取金币倍率
    erosionPerStack: 0,         // 风蚀：每层易伤
    erosionMaxStacks: 0,        // 风蚀：最大层数
    newMapUnlockedName: "",              // 本局新解锁的地图名（结算界面提示用）

    // 当前主题（每波切换，色带来自地图）
    theme: mapThemes[0],
    themeFrom: mapThemes[0],
    themeTo: mapThemes[0],
    themeBlendT: 1,                       // 0=from, 1=to
    themeBlendLeftMs: 0,                  // >0 时每帧推进 blend
  };

  /** 本局经济是否已写入存档；无尽接续后清零以便再次结算 */
  let runEconomySettled = false;
  if (state.characterId === "tidecaller") {
    state.shieldMaxHp = state.maxHp * 0.2;
    state.shieldHp = state.shieldMaxHp;
  }

  /** 超限血条叠层上限（与 drawHud 中叠条数量一致）；实际 hp/maxHp 不可超过基准 + 此层数倍率 */
  const MAX_OVERFLOW_HP_LAYERS = 10;

  function playerOverflowTotalHpCeiling(st) {
    const hpCap = Math.max(1, st.baseMaxHp);
    return hpCap * (1 + MAX_OVERFLOW_HP_LAYERS);
  }

  function clampPlayerHpToCeiling(st) {
    const ceiling = playerOverflowTotalHpCeiling(st);
    st.maxHp = Math.min(st.maxHp, ceiling);
    st.hp = Math.min(st.hp, st.maxHp);
  }

  // ==========================================================================
  //  玩家射击
  // ==========================================================================

  /**
   * 玩家自动开火。中央一发主弹，每多 1 sideBullets 在两侧各加一发，散开角度递增。
   * 子弹尺寸/速度/伤害都来自 state，方便升级后立刻生效。
   */
  function fireBullets() {
    const p = state.player;
    const cx = p.x + p.w / 2;
    const sz = state.bulletSizeMul;
    const sp = state.bulletSpeedMul;
    const windVolley = consumeWindVolley(state);
    const volleyDamage = state.bulletDamage * (windVolley ? 1.8 : 1) * consumeGrassAmbush(state)
      * hellEmberDamageMul(state);
    const volleyPierce = state.bulletPierceEnemies || windVolley;

    // 主弹
    const mainW = 6 * sz;
    const mainH = 12 * sz;
    state.bullets.push({
      x: cx - mainW / 2,
      // 子弹底边贴近机头上方，口径变大时也不会掉到机体下方
      y: p.y - mainH - 2,
      w: mainW,
      h: mainH,
      vx: 0,
      vy: -8.5 * sp,
      dmg: volleyDamage,
      windVolley,
      color: windVolley ? "#cef2a5" : undefined,
      pierceEnemies: volleyPierce,
      pierceLeft: 0,
    });

    // 两侧附加弹（每多一档 sideBullets，多一对左右弹）
    for (let i = 1; i <= state.sideBullets; i += 1) {
      const spread = 0.9 * i;
      const sw = 5 * sz;
      const sh = 10 * sz;
      state.bullets.push({
        x: cx - sw / 2 - i * 6,
        y: p.y - sh - 2,
        w: sw,
        h: sh,
        vx: -spread * sp,
        vy: -7.8 * sp,
        dmg: volleyDamage,
        windVolley,
        color: windVolley ? "#cef2a5" : undefined,
        pierceEnemies: volleyPierce,
        pierceLeft: 0,
      });
      state.bullets.push({
        x: cx - sw / 2 + i * 6,
        y: p.y - sh - 2,
        w: sw,
        h: sh,
        vx: spread * sp,
        vy: -7.8 * sp,
        dmg: volleyDamage,
        windVolley,
        color: windVolley ? "#cef2a5" : undefined,
        pierceEnemies: volleyPierce,
        pierceLeft: 0,
      });
    }
    appendTidecallerBolts();
  }

  function appendTidecallerBolts() {
    if (state.characterId !== "tidecaller") return;
    state.tideVolleyCount = (state.tideVolleyCount || 0) + 1;
    if (state.tideVolleyCount < 4) return;
    state.tideVolleyCount = 0;
    const p = state.player, cx = p.x + p.w / 2;
    const target = findNearestEnemy(cx, p.y);
    for (const side of [-1, 1]) {
      state.bullets.push({
        x: cx + side * 15 - 4, y: p.y - 8, w: 8, h: 14,
        vx: side * 2.1, vy: -6.6, dmg: state.bulletDamage * 1.4,
        pierceEnemies: false, pierceLeft: 0,
        homing: true, homingTurn: 0.13, homingSpeed: 7.2,
        homingTargetRef: target, tidecallerBolt: true, color: "#9aeeee",
      });
    }
  }

  function findNearestEnemy(cx, cy) {
    if (!state.enemies.length) return null;
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < state.enemies.length; i += 1) {
      const e = state.enemies[i];
      if (!e || typeof e.x !== "number") continue;
      const ex = e.x + e.w / 2;
      const ey = e.y + e.h / 2;
      const d2 = dist2(cx, cy, ex, ey);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  /** 无尽模式：enemyHp ∝ BASE^(Lv-1)（略高于敌弹/撞伤放大，拉长局时） */
  const ENDLESS_HP_EXP_BASE = 1.062;
  /** 无尽模式：敌弹与撞机伤害 ∝ BASE^(Lv-1) */
  const ENDLESS_DMG_EXP_BASE = 1.055;
  /** 无尽：每完成一个轮回（回到阶段一）小怪刷新频率再上 20%（乘在 curse 与小怪计时除数上） */
  const ENDLESS_LAP_SPAWN_MUL = 1.2;

  /**
   * 虚空线 Boss（隐藏 Boss）通关结算：
   *   1) 永久解锁「沙漠」地图（见 maps.js unlockBy: "hiddenBoss"）
   *   2) 返回是否需要在胜利界面询问接续无尽
   */
  function resolveBossVictory(enemy) {
    const expected = battleMap && (battleMap.bossVariant === enemy.bossVariant
      || (battleMap.bossVariant === "random" && ((battleMap.randomBossPool || []).includes(enemy.bossVariant) || isVoidLineBoss(enemy))));
    if (expected) {
      const rewards = storage.recordMapClear(state.mapId);
      if (rewards.maps.length) state.newMapUnlockedName = rewards.maps.map((m) => m.name).join("、");
      if (rewards.characters.length) state.newCharacterUnlockedName = rewards.characters.map((c) => c.name).join("、");
    }
    if (!isVoidLineBoss(enemy)) return false;
    // 解锁所有"以击败隐藏 Boss 为条件"的地图；不写死 id，加新图自动生效
    mapsUnlockedByHiddenBoss().forEach((m) => {
      if (storage.unlockMap(m.id)) state.newMapUnlockedName = m.name;
    });
    return true;
  }

  function isVoidLineBoss(enemy) {
    return !!enemy && (
      enemy.isVoidCore
      || enemy.bossVariant === "voidCore"
      || enemy.bossVariant === "void"
    );
  }

  function refreshEndlessScaling() {
    if (!state.endlessMode) {
      state.endlessEnemyHpMulCached = 1;
      state.endlessEnemyDmgMulCached = 1;
      return;
    }
    const L = Math.max(1, state.level);
    state.endlessEnemyHpMulCached = Math.pow(ENDLESS_HP_EXP_BASE, L - 1);
    state.endlessEnemyDmgMulCached = Math.pow(ENDLESS_DMG_EXP_BASE, L - 1);
  }

  /** 诅咒天赋：提高敌机/Boss（含虚空核心）生命上限与当前血量 */
  function applyEnemyCurseHp(enemy) {
    if (!enemy) return;
    const m = state.curseEnemyHpMul;
    if (m > 1) {
      enemy.hp = Math.max(1, Math.floor(enemy.hp * m));
      enemy.maxHp = Math.max(1, Math.floor(enemy.maxHp * m));
    }
    if (state.endlessMode) {
      const em = state.endlessEnemyHpMulCached || 1;
      if (em > 1) {
        enemy.hp = Math.max(1, Math.floor(enemy.hp * em));
        enemy.maxHp = Math.max(1, Math.floor(enemy.maxHp * em));
      }
    }
  }

  /** Boss 分段血条：固定 5 层，每层 maxHp 的 1/5（须在 curse 缩放 hp/maxHp 之后调用） */
  function initBossSegmentedHpBar(boss) {
    if (!boss || !boss.isBoss) return;
    const mh = Math.max(1, boss.maxHp);
    boss.bossHpBarLayers = BOSS_HP_BAR_LAYER_COUNT;
    boss.bossHpBarSegSize = mh / BOSS_HP_BAR_LAYER_COUNT;
    boss.layerBreakStunMs = 0;
    boss.hpBarBreakFlashMs = 0;
  }

  /**
   * 检测是否跨过至少一整层血条阈值；触发硬直与闪白反馈（不作用于 hp<=0 的瞬杀帧）
   */
  function notifyBossSegmentLayerBreak(boss, hpBefore) {
    if (!boss || !boss.isBoss || boss.isMirror || boss.hp <= 0) return;
    const seg = boss.bossHpBarSegSize;
    const layers = boss.bossHpBarLayers;
    if (!seg || layers !== BOSS_HP_BAR_LAYER_COUNT || seg <= 0) return;
    const ceilBefore = Math.ceil(hpBefore / seg);
    const ceilAfter = Math.ceil(boss.hp / seg);
    const breaks = ceilBefore - ceilAfter;
    if (breaks <= 0) return;
    const stun = Math.min(
      BOSS_LAYER_BREAK_STUN_CAP_MS,
      BOSS_LAYER_BREAK_STUN_MS + Math.min(breaks - 1, 5) * BOSS_LAYER_BREAK_STUN_STACK_MS,
    );
    boss.layerBreakStunMs = Math.max(boss.layerBreakStunMs || 0, stun);
    boss.hpBarBreakFlashMs = Math.max(boss.hpBarBreakFlashMs || 0, BOSS_LAYER_BREAK_FLASH_MS);
  }

  // ==========================================================================
  //  波次系统（普通波 / Boss 波 / 间隙）
  // ==========================================================================

  /** 第一波：普通敌机 */
  function spawnRegular() {
    const spawned = spawnEnemyForWave(
      state.waveIndex,
      Math.max(1, state.level),
      state.mapEnemyPool,
    );
    // 沙蜂是成组生成的，工厂会返回数组
    if (Array.isArray(spawned)) {
      spawned.forEach((one) => {
        applyEnemyCurseHp(one);
        state.enemies.push(one);
      });
      return;
    }
    const e = spawned;
    applyEnemyCurseHp(e);
    state.enemies.push(e);
  }

  /** 第二波：强化精英敌机（血厚+攻击频率高） */
  function spawnWave2Elite() {
    const elite = createEliteFor(state.mapEliteType, Math.max(4, state.level));
    elite.hp = Math.floor(elite.hp * 1.2);
    elite.maxHp = elite.hp;
    elite.speed += 0.2;
    elite.fireInterval = 650;
    elite.fireCooldown = 300;
    elite.coin += 4;
    applyEnemyCurseHp(elite);
    state.enemies.push(elite);
  }

  /** 第三波：超高难 Boss（由 bossAi.js 驱动） */
  /** 第三波主 Boss 仅红/蓝；虚空为隐藏 Boss（满血击败红/蓝后进入） */
  function spawnBoss() {
    const variant = forcedBossVariant || pickMapBossVariant(battleMap);
    const boss = createBoss(variant, Math.max(1, state.level));
    applyEnemyCurseHp(boss);
    initBossSegmentedHpBar(boss);
    // Boss 基础血量在 enemies.js 定义；诅咒天赋在此处叠乘
    boss.speed = 1.6;
    boss.homeY = boss.targetY;
    boss.coin = 300;
    state.enemies.push(boss);
    state.bossActive = true;
    state.wave3BossSpawned = true;
    // Boss 出场：每次都从头播放 boss BGM
    audio.stopAll();
    audio.playBossBgm();
  }

  function playerHpFullForHiddenVoidGate() {
    return state.maxHp > 0 && state.hp >= state.maxHp;
  }

  /** @returns {"voidPhase2"|"hiddenVoid"|"win"} */
  function resolvePrimaryBossDefeat(enemy) {
    if (enemy.bossVariant === "void" && !enemy.phase2Triggered) return "voidPhase2";
    if (enemy.isVoidCore || enemy.bossVariant === "voidCore") return "win";
    if (enemy.bossVariant === "void") return "win";
    /** 含无尽模式：满血击败红/蓝仍可进隐藏虚空，虚空线与核心击败后照旧回阶段一做周回 */
    if (
      bossLeadsToHidden(enemy.bossVariant)
      && playerHpFullForHiddenVoidGate()
      && !state.hiddenVoidConsumed
    ) {
      return "hiddenVoid";
    }
    return "win";
  }

  /** 满血击败红/蓝主 Boss 后接续虚空隐藏 Boss（不结算胜利） */
  function spawnHiddenVoidBoss() {
    state.hiddenVoidConsumed = true;
    state.hiddenVoidStrobeMs = HIDDEN_VOID_STROBE_MS;
    state.bullets = [];
    flashEnemyBulletClearIfAny();
    state.enemyBullets = [];
    const boss = createBoss("void", Math.max(1, state.level));
    applyEnemyCurseHp(boss);
    initBossSegmentedHpBar(boss);
    boss.speed = 1.6;
    boss.targetY = 90;
    boss.homeY = 90;
    boss.coin = 300;
    state.enemies.push(boss);
    state.bossActive = true;
    audio.stopAll();
    audio.playBossBgm();
    state.invincibleMs = Math.max(state.invincibleMs || 0, 1500);
  }

  /**
   * 无尽用：清空场上单位与虚空演出，回到阶段1…
   * @param completeRoundLap true=刚完成一整圈Boss链，小怪刷新频率再 ×1.2（叠乘）；false=仅切开无尽首跳
   */
  function performEndlessRoundResetToWave1(completeRoundLap) {
    if (completeRoundLap && state.endlessMode) {
      state.endlessLapsCompleted = (state.endlessLapsCompleted || 0) + 1;
    }
    refreshEndlessScaling();
    state.waveIndex = 1;
    state.waveTimeLeft = 0;
    state.waveResting = false;
    state.waveRestLeft = 0;
    state.bossActive = false;
    state.wave3BossSpawned = false;
    state.hiddenVoidConsumed = false;
    state.hiddenVoidStrobeMs = 0;
    state.spawnTimer = 0;
    state.elapsed = 0;
    state.bossDropTimer = 0;

    state.enemies = [];
    state.bullets = [];
    flashEnemyBulletClearIfAny();
    state.enemyBullets = [];
    state.items = [];

    state.voidDarknessAlpha = 0;
    state.voidSafeZone = null;
    state.voidGravityTraps = [];
    state.voidFragments = [];
    state.voidFlashAlpha = 0;
    state.voidPhase2PurpleAlpha = 0;
    state.voidCoreUnlockAt = 0;
    state.voidCoreCombatStartAt = null;
    state.finalJudgementDangerMs = 0;
    state.finalJudgementRushHangMs = 0;
    state.finalJudgementPetalMs = 0;
    state.finalJudgementPetalMotionDone = false;

    state.bombFlashMs = 0;
    applyTheme(true);
    startWave();
    audio.stopAll();
    audio.playBgm();
  }

  /**
   * 结算页点「无尽模式」：进入无尽周回（金币仍为整局一笔，仅死亡或回菜单/再来一局时 finishRun）。
   */
  function beginEndlessContinuation() {
    state.gameOver = false;
    state.win = false;
    state.offerEndlessAfterVoidWin = false;
    state.endlessMode = true;
    performEndlessRoundResetToWave1(false);
  }

  /** Boss 召唤小怪：支持默认冲撞型与“左右柱状普通敌人”两种模式 */
  function spawnBossAdd(boss, cfg) {
    if (cfg && cfg.pattern === "grassHerd") {
      if (state.enemies.filter((e) => e && !e.isBoss && e.hp > 0).length >= 4) return null;
      const make = cfg.type === "thornBloom" ? createThornBloom : createGaleFalcon;
      const add = make(Math.max(1, state.level));
      add.x = Math.max(8, Math.min(W - add.w - 8, cfg.x));
      add.y = Math.max(175, Math.min(H * 0.6, cfg.y));
      add.grassOwnerBoss = cfg.owner || boss;
      add.grassHerdAdd = true;
      applyEnemyCurseHp(add);
      state.enemies.push(add);
      return add;
    }
    if (cfg && cfg.pattern === "sideColumns") {
      const rows = Math.max(10, cfg.rows || 14);
      const gap = 26;
      for (let i = 0; i < rows; i += 1) {
        const y = -40 - i * gap;
        const left = createGrunt(Math.max(1, state.level));
        left.x = 6;
        left.y = y;
        left.vx = 0;
        left.speed = Math.max(3.8, left.speed * 1.75);
        left.noItemDrop = true; // 蓝 Boss 敌人柱：不掉经验球与道具
        const right = createGrunt(Math.max(1, state.level));
        right.x = W - right.w - 6;
        right.y = y - 10;
        right.vx = 0;
        right.speed = Math.max(3.8, right.speed * 1.75);
        right.noItemDrop = true; // 同上
        applyEnemyCurseHp(left);
        applyEnemyCurseHp(right);
        state.enemies.push(left, right);
      }
      return;
    }

    const add = createSwift(state.level + 5);
    add.x = Math.max(20, Math.min(W - add.w - 20, boss.x + (Math.random() - 0.5) * boss.w));
    add.y = boss.y + boss.h - 4;
    add.speed = 4 + Math.random();
    add.hp = Math.max(2, Math.floor((add.hp || 2) * 0.8));
    add.maxHp = add.hp;
    applyEnemyCurseHp(add);
    state.enemies.push(add);
  }

  /** 虚空Boss 最终审判：蓄力喷发 + 危险窗 + 花瓣期间不刷第三波小怪 */
  function isVoidFinalJudgementCrowdControlled(state) {
    if (
      (state.finalJudgementDangerMs || 0) > 0
      || (state.finalJudgementRushHangMs || 0) > 0
      || (state.finalJudgementPetalMs || 0) > 0
      || hasLethalJudgementRushBullets(state)
    ) return true;
    for (let i = 0; i < state.enemies.length; i += 1) {
      const e = state.enemies[i];
      if (e && e.isBoss && e.bossVariant === "void" && e.voidMode === "finalJudgement") return true;
    }
    return false;
  }

  /** 静置结束：清算弹一齐指向当前玩家中心发射（速度与伤害与 rush 词条一致的基础） */
  function armVoidJudgementRushBullets(state) {
    const player = state.player;
    const tcx = player.x + player.w / 2;
    const tcy = player.y + player.h / 2;
    state.enemyBullets.forEach((b) => {
      if (!b || !b.judgementBolt || !b.judgementRush || b.judgementRushArmed) return;
      const bcx = b.x + b.w / 2;
      const bcy = b.y + b.h / 2;
      const dx = tcx - bcx;
      const dy = tcy - bcy;
      const len = Math.hypot(dx, dy) || 1;
      const spd = 6.4 + Math.random() * 1.4;
      b.vx = (dx / len) * spd;
      b.vy = (dy / len) * spd;
      b.dmg = 1;
      b.judgementRushArmed = true;
    });
    state.finalJudgementDangerMs = 1050;
  }

  /** 未在安全区时的清算弹幕：仍存在已武装且 dmg>0 的最终审判弹时视为危险期未满 */
  function hasLethalJudgementRushBullets(state) {
    const arr = state.enemyBullets;
    for (let i = 0; i < arr.length; i += 1) {
      const b = arr[i];
      if (!b) continue;
      if (
        b.judgementBolt
        && b.judgementRush
        && b.judgementRushArmed
        && (b.dmg || 0) > 0
      ) return true;
    }
    return false;
  }

  /** 最终审判等特殊敌弹不可被反间护盾转化 */
  function isEnemyBulletProtectedFromTurncoat(b) {
    if (!b || !b.judgementBolt) return false;
    if ((state.finalJudgementPetalMs || 0) > 0) return true;
    if ((state.finalJudgementDangerMs || 0) > 0) return true;
    if ((state.finalJudgementRushHangMs || 0) > 0) return true;
    if (hasLethalJudgementRushBullets(state)) return true;
    if (b.judgementRush && !b.judgementRushArmed) return true;
    return false;
  }

  /** 拾取半径内敌弹 → 玩家阵营追踪弹，逐颗锁向就近敌机（无敌机则不转化） */
  function procTurncoatShield() {
    if (!state.turncoatShield || state.enemyBullets.length === 0) return;
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    const rsq = pickupRadiusPx(state) ** 2;
    const dmg = Math.max(1, Math.floor(state.bulletDamage / 3));
    const homingSpeed = 6.4;
    for (let i = state.enemyBullets.length - 1; i >= 0; i -= 1) {
      const eb = state.enemyBullets[i];
      if (!eb || typeof eb.x !== "number") continue;
      if (isEnemyBulletProtectedFromTurncoat(eb)) continue;
      const bw = eb.w != null ? eb.w : 6;
      const bh = eb.h != null ? eb.h : 6;
      const bx = eb.x + bw / 2;
      const by = eb.y + bh / 2;
      if (dist2(px, py, bx, by) >= rsq) continue;
      const target = findNearestEnemy(bx, by);
      if (!target) continue;
      state.enemyBullets.splice(i, 1);
      const tx = target.x + target.w / 2;
      const ty = target.y + target.h / 2;
      const dx = tx - bx;
      const dy = ty - by;
      const len = Math.hypot(dx, dy) || 1;
      state.bullets.push({
        x: eb.x,
        y: eb.y,
        w: bw,
        h: bh,
        vx: (dx / len) * homingSpeed * 0.8,
        vy: (dy / len) * homingSpeed * 0.8,
        dmg,
        pierceEnemies: false,
        pierceLeft: 0,
        homing: true,
        homingTurn: 0.2,
        homingSpeed,
        homingTargetRef: target,
        color: "#c4b5fd",
      });
    }
  }

  /**
   * Boss 战期间的"弹幕分层"：Boss 出招时，同屏杂兵与精英**停火**。
   *
   * 为什么需要：Boss 战每 1.2 秒还在刷怪（最多 4 只，15% 概率是精英），
   * 它们的弹幕和 Boss 招式叠在一起时，Boss 招式里精心留出的安全走廊会被填掉——
   * 走位路线直接失效，只剩"靠回血硬吃"一条路。
   *
   * 怎么做到不降压力：只是把两层弹幕**串行化**而不是删掉。
   *   · Boss 出招时杂兵不开火，但照样移动、照样撞人、照样得清；
   *   · Boss 招式之间的空隙、以及**过热破绽窗口**里，杂兵恢复开火——
   *     于是"趁破绽输出"本身带上了代价，破绽窗口不再是白送的。
   */
  function updateAddFireSuppression() {
    let suppressed = false;
    for (let i = 0; i < state.enemies.length; i += 1) {
      const e = state.enemies[i];
      if (!e || !e.isBoss || e.inCutscene) continue;
      // 过热破绽期不压制：这是玩家的输出窗口，也该有代价
      if (e.hanbaOverheat) continue;
      // 招式进行中（红/旱魃看 currentAttack；蓝的模式机常驻，看是否在重型模式）
      if (e.currentAttack) { suppressed = true; break; }
      // 常驻输出型（蓝的模式机、虚空线）没有出招间隙，全程压制
      if (bossIsContinuous(e.bossVariant) || e.isVoidCore) { suppressed = true; break; }
    }
    state.addFireSuppressed = suppressed;
  }

  // ==========================================================================
  //  沙暴：周期性风险窗口（平静 → 预警 → 沙暴 → 平静…）
  //  代价是视野收缩 + 敌人加速，回报是经验与掉落加成。
  //  Boss 战期间常规循环挂起，交给 Boss 招式主动召唤（第二批实现旱魃时接上）。
  // ==========================================================================

  function mechanicsSuspendedNow() {
    return !!(state.bossActive && state.wave3BossSpawned);
  }

  /**
   * 机制统一驱动：走一遍本图启用的机制，各自推进自己的 state 字段。
   * 加一个新机制 = mechanics.js 加一项 + 地图 mechanics 里引用，这里不用改。
   */
  function updateMechanics(dt) {
    const tideWasActive = state.tideActive;
    state.mechanicsSuspended = mechanicsSuspendedNow();
    const ids = Object.keys(state.mapMechanics);
    for (let i = 0; i < ids.length; i += 1) {
      const m = getMechanic(ids[i]);
      if (!m) continue;
      const cfg = state.mapMechanics[ids[i]];
      const devMode = (state.devMechanics && state.devMechanics[m.id]) || "auto";
      if (devMode !== "auto" && m.applyDev && m.applyDev(state, devMode, cfg)) continue;
      if (m.update) m.update(state, dt, cfg);
    }
    if (state.grasslandCfg) applyGrasslandRewards();
    if (state.hellCfg) { applyHellfireResults(dt); applyHellBeamDamage(dt); }
    // 潮汐在 Boss 战继续循环；收益、横流与海克斯在同一帧结算。
    if (!state.tideCfg) return;
    if (tideWasActive && !state.tideActive && state.tideEndHealRatio > 0) {
      healPlayer(state.maxHp * state.tideEndHealRatio);
    }
    if (!tideWasActive && state.tideActive && state.tideHeart) {
      state.enemyBullets = [];
      const gain = state.maxHp * state.tideHeartShieldRatio;
      state.shieldMaxHp = Math.max(state.shieldMaxHp, gain);
      state.shieldHp = Math.min(state.shieldMaxHp, state.shieldHp + gain);
      state.shieldFlashMs = state.flashEffectsOn ? 240 : 0;
    }
    if (state.tideActive) {
      const p = state.player;
      const prevX = p.x;
      const drift = state.tideDirection * state.tideCfg.driftPxPerSec * state.tideDriftMul * dt / 1000;
      p.x = Math.max(0, Math.min(W - p.w, p.x + drift));
      // 维持拖拽锚点，避免下一次触摸移动将洋流位移突然复位。
      if (state.touchActive) state.touchOffsetX -= p.x - prevX;
      chargeWindrunner(state, prevX, p.y);
    }
  }

  /**
   * 业火回魂的每帧结算：把机制排出来的请求兑现成战场上的东西。
   * 机制模块不认识敌人类型也不碰玩家坐标，那些都在这里做。
   */
  function applyHellfireResults(dt) {
    // 回魂：机制只排请求，这里才真的造出亡魂
    consumeHellRevenantRequests(state).forEach((req) => {
      state.enemies.push(createRevenant(req));
    });

    // 「镇魂爆」：每次镇魂在原地炸开
    const radius = state.hellQuellRadius || 0;
    if (radius > 0) {
      consumeHellQuellPoints(state).forEach((pt) => {
        const dmg = state.bulletDamage * (state.hellQuellDamageMul || 0);
        if (dmg <= 0) return;
        state.enemies.forEach((enemy) => {
          if (!enemy || enemy.hp <= 0) return;
          const ex = enemy.x + enemy.w / 2, ey = enemy.y + enemy.h / 2;
          if (Math.hypot(ex - pt.x, ey - pt.y) <= radius) enemy.hp -= dmg;
        });
      });
    }

    // 锁魂的链子：把玩家朝最近的魂火拖。与潮汐横流一样要维持拖拽锚点
    if (state.hellChain) {
      const p = state.player;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const dx = state.hellChain.x - cx, dy = state.hellChain.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const move = Math.min(d, (state.hellChain.strength * dt) / 1000);
        const prevX = p.x, prevY = p.y;
        p.x = Math.max(0, Math.min(W - p.w, p.x + (dx / d) * move));
        p.y = Math.max(0, Math.min(H - p.h, p.y + (dy / d) * move));
        if (state.touchActive) {
          state.touchOffsetX -= p.x - prevX;
          state.touchOffsetY -= p.y - prevY;
        }
        chargeWindrunner(state, prevX, prevY);
      }
      state.hellChainDraw = { fromX: state.hellChain.from.x, fromY: state.hellChain.from.y, toX: cx, toY: cy };
      state.hellChain = null;
    } else {
      state.hellChainDraw = null;
    }
  }

  /**
   * 业火射线的每帧结算。故意不自己写一套扣血：走与敌弹完全相同的
   * 无敌 → 「无罪」→ 护盾（双倍承伤 + 残余穿透）→ 生命 路径，
   * 否则护盾类词条对射线会莫名其妙地失效。
   */
  function applyHellBeamDamage(dt) {
    const raw = updateHellBeams(state, dt);
    if (raw <= 0) return;
    if (state.invincibleMs > 0 || state.godMode) return;
    if (tryEmberGuard()) return;

    let dmg = Math.max(1, Math.round(raw * 300 * state.curseEnemyDmgMul));
    if (state.endlessMode) {
      dmg = Math.max(1, Math.round(dmg * (state.endlessEnemyDmgMulCached || 1)));
    }
    if (state.shieldHp > 0) {
      const shieldMul = Math.max(1, state.shieldDamageMul || 1);
      const cost = dmg * shieldMul;
      state.shieldFlashMs = 240;
      if (state.shieldHp >= cost) { state.shieldHp -= cost; return; }
      dmg = Math.max(0, dmg - state.shieldHp / shieldMul);
      state.shieldHp = 0;
      if (dmg <= 0) return;
    }
    state.hp -= dmg;
    if (state.hp <= 0) {
      state.hp = 0;
      state.gameOver = true;
      finishRun();
    }
  }

  /**
   * 业火护：身上有业火就抵消一次伤害，并给一小段无敌帧。
   * 三条受伤路径（敌弹 / 撞机 / 业火射线）都走这一个入口，
   * 免得哪条漏掉之后"有业火却还是挨了打"。
   */
  function tryEmberGuard() {
    if (!state.hellCfg) return false;
    const iframe = consumeEmberGuard(state);
    if (iframe <= 0) return false;
    state.invincibleMs = Math.max(state.invincibleMs || 0, iframe);
    state.shieldFlashMs = state.flashEffectsOn ? 240 : 0;
    return true;
  }

  function applyGrasslandRewards() {
    const rewards = consumeGrasslandRewards(state);
    if (rewards.healAmount > 0) healPlayer(rewards.healAmount);
    if (rewards.shieldAmount > 0) {
      state.shieldMaxHp = Math.max(state.shieldMaxHp, rewards.shieldAmount);
      state.shieldHp = Math.min(state.shieldMaxHp, state.shieldHp + rewards.shieldAmount);
      state.shieldFlashMs = state.flashEffectsOn ? 240 : 0;
    }
  }

  function mapDamageMul() {
    return (state.tideActive ? (state.tideDamageMul || 1) : 1);
  }

  /**
   * Boss 战期间常规沙暴挂起，改由旱魃的招式召唤。
   * 两者取较强的一方生效，这样 P3 常驻弱沙暴与 callStorm 的浓沙暴能平滑衔接。
   */
  function applyBossStormOverride() {
    if (!state.sandstormCfg || !state.bossStormActive) return;
    const a = state.bossStormAlpha || 0;
    if (a > state.sandstormAlpha) {
      state.sandstormAlpha = a;
      state.sandstormVisionR = state.bossStormVisionR || state.sandstormCfg.visionR;
      state.sandstormActive = true;
      state.sandstormMoveMul = state.sandstormCfg.enemyMoveMul || 1;
      state.sandstormAimSpreadDeg = state.sandstormCfg.aimSpreadDeg || 0;
    }
  }

  /** 「风蚀」：命中后给敌人叠一层易伤，超时自动过期 */
  const EROSION_DURATION_MS = 4000;
  function applyErosionStack(enemy) {
    if (!(state.erosionPerStack > 0)) return;
    if (!enemy.erosionUntil || state.elapsed > enemy.erosionUntil) enemy.erosionStacks = 0;
    enemy.erosionStacks = Math.min(state.erosionMaxStacks || 0, (enemy.erosionStacks || 0) + 1);
    enemy.erosionUntil = state.elapsed + EROSION_DURATION_MS;
  }

  /** 目标身上的风蚀易伤倍率（过期即失效） */
  function erosionMul(enemy) {
    if (!(state.erosionPerStack > 0)) return 1;
    if (!enemy.erosionUntil || state.elapsed > enemy.erosionUntil) return 1;
    return 1 + (enemy.erosionStacks || 0) * state.erosionPerStack;
  }

  /**
   * 沙漠专属词条的伤害倍率：
   *   热寂     —— 敌人移速每高 10% 就 +heatDeathPerTenth 伤害（沙暴期敌人 ×1.5 移速 → +40%）
   *   旱魃之息 —— 沙暴期间全部伤害额外 ×stormDamageMul
   * 非沙漠地图这两个字段都取不到，恒返回 1。
   */
  function desertDamageMul() {
    let mul = 1;
    const per = state.heatDeathPerTenth || 0;
    if (per > 0) {
      const over = Math.max(0, (state.sandstormMoveMul || 1) - 1);
      mul *= 1 + (over / 0.1) * per;
    }
    if (state.sandstormActive && (state.stormDamageMul || 1) !== 1) {
      mul *= state.stormDamageMul;
    }
    return mul;
  }

  /** 沙暴期的收益加成（风险回报），无沙暴地图恒为 1 / 0 */
  function sandstormExpMul() {
    const cfg = state.sandstormCfg;
    return state.sandstormActive && cfg ? (cfg.expMul || 1) : 1;
  }
  function sandstormDropBonus() {
    const cfg = state.sandstormCfg;
    return state.sandstormActive && cfg ? (cfg.dropBonus || 0) : 0;
  }

  function applyTheme(instant) {
    const next = mapThemes[(state.waveIndex - 1) % mapThemes.length];
    if (instant || !state.theme) {
      state.theme = next;
      state.themeFrom = next;
      state.themeTo = next;
      state.themeBlendT = 1;
      state.themeBlendLeftMs = 0;
      return;
    }
    // 主题渐变（切波时更顺滑）
    state.themeFrom = state.themeTo || state.theme;
    state.themeTo = next;
    state.themeBlendT = 0;
    state.themeBlendLeftMs = 800; // 渐变时长（ms）
    state.theme = next;
  }

  function startWave() {
    applyTheme(false);
    state.waveResting = false;
    state.waveRestLeft = 0;
    state.spawnTimer = 0;
    if (state.waveIndex === 3 && !state.wave3BossSpawned) {
      spawnBoss();
    }
  }

  /**
   * 计算“下一级所需经验”：
   * - 常规：沿用旧曲线 floor(prev * 1.4 + 6)
   * - 特殊：按需求下调 Lv4/5/6 的门槛（更快过渡到中期）
   */
  function calcNextExpToNext(nextLevel, prevNeed) {
    if (nextLevel === 4) return 18; // 原本约 24
    if (nextLevel === 5) return 24; // 原本约 39
    if (nextLevel === 6) return 32; // 原本约 60
    return Math.floor(prevNeed * 1.4 + 6);
  }

  /**
   * 拾取经验球累加经验，达阈值则升级（弹三选一）。
   * 经验曲线：expToNext = floor(prev * 1.4 + 6)
   * 例：5 → 13 → 24 → 39 → 60 → 90 ...
   */
  function gainExp(amount) {
    const tideExp = state.tideActive && state.tideCfg
      ? (state.tideCfg.expMul || 1) * (state.tideExpMul || 1) : 1;
    const real = Math.max(1, Math.round(amount * state.expMul * sandstormExpMul() * tideExp));
    state.exp += real;
    while (state.exp >= state.expToNext) {
      state.exp -= state.expToNext;
      state.level += 1;
      state.expToNext = calcNextExpToNext(state.level + 1, state.expToNext);
      openUpgradePanel();
      if (state.pausedForUpgrade) break;   // 当帧只弹一次面板，剩余经验保留
    }
  }

  function isPurplePlusUpgrade(u) {
    return u && (u.rarity === "purple" || u.rarity === "orange");
  }

  function rarityRankForGuarantee(r) {
    const order = { green: 0, blue: 1, purple: 2, orange: 3 };
    return order[r] != null ? order[r] : 0;
  }

  /** 至少有一条紫或橙；无可用高稀有则不强求 */
  function injectPurplePlusIfNeeded(opts) {
    if (!opts || opts.length === 0) return opts;
    if (opts.some((u) => isPurplePlusUpgrade(u))) return opts;
    const highPool = UPGRADE_POOL.filter(
      (u) => (!u.available || u.available(state)) && isPurplePlusUpgrade(u)
    );
    if (highPool.length === 0) return opts;
    const used = new Set(opts.map((u) => u && u.id).filter(Boolean));
    let candidates = highPool.filter((u) => !used.has(u.id));
    if (candidates.length === 0) candidates = highPool.slice();
    let worstIdx = 0;
    for (let i = 1; i < opts.length; i += 1) {
      if (rarityRankForGuarantee(opts[i].rarity) < rarityRankForGuarantee(opts[worstIdx].rarity)) {
        worstIdx = i;
      }
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const next = opts.slice();
    next[worstIdx] = pick;
    return next;
  }

  function buildUpgradeOptions() {
    if (!hasAnyUpgradeAvailable(state)) {
      return buildPostPoolFallbackOptions();
    }
    if (!state._upgradeMeta) state._upgradeMeta = { picked: Object.create(null), blocked: Object.create(null) };
    if (!state._upgradeMeta.blocked) state._upgradeMeta.blocked = Object.create(null);
    const oneShotOrangeIds = ["bullet_void", "shield_absolute"];
    const applyPurpleGuarantee = !!state.upgradeNextPanelPurplePlus;
    let opts = pickUpgrades(state, 3);
    // 里程碑橙词条：满足构筑条件后“下一次升级”必出
    const pickedMap = (state._upgradeMeta && state._upgradeMeta.picked) || {};
    const blockedMap = (state._upgradeMeta && state._upgradeMeta.blocked) || {};
    const milestoneMusts = [];
    if (!pickedMap.bullet_void) {
      const u = UPGRADE_POOL.find((x) => x.id === "bullet_void");
      if (u && !blockedMap.bullet_void && (!u.available || u.available(state))) milestoneMusts.push(u);
    }
    if (!pickedMap.shield_absolute) {
      const u = UPGRADE_POOL.find((x) => x.id === "shield_absolute");
      if (u && !blockedMap.shield_absolute && (!u.available || u.available(state))) milestoneMusts.push(u);
    }
    for (let i = 0; i < milestoneMusts.length && i < Math.max(1, opts.length); i += 1) {
      const must = milestoneMusts[i];
      if (opts.some((u) => u.id === must.id)) continue;
      if (opts.length <= 0) opts = [must];
      else opts[i] = must;
    }
    if (forcedUpgradeIds.length > 0) {
      const pickedMapForced = (state._upgradeMeta && state._upgradeMeta.picked) || {};
      const missingMusts = [];
      forcedUpgradeIds.forEach((id) => {
        if (!id || pickedMapForced[id]) return;
        const must = UPGRADE_POOL.find((u) => u.id === id);
        if (!must) return;
        missingMusts.push(must);
      });
      // 从前往后覆盖，尽量把“还没出现过的必出词条”塞进本次 3 选项里
      for (let i = 0; i < missingMusts.length && i < Math.max(1, opts.length); i += 1) {
        const must = missingMusts[i];
        if (opts.some((u) => u.id === must.id)) continue;
        if (opts.length <= 0) opts = [must];
        else opts[i] = must;
      }
    }
    if (applyPurpleGuarantee) {
      opts = injectPurplePlusIfNeeded(opts);
      state.upgradeNextPanelPurplePlus = false;
    }
    // 一次机会机制：有前置的橙词条只要出现过（被重掷/跳过）即标记为 blocked，不再进入后续候选
    oneShotOrangeIds.forEach((id) => {
      if (pickedMap[id]) return;
      if (opts.some((u) => u && u.id === id)) state._upgradeMeta.blocked[id] = true;
    });
    return opts;
  }

  /** 棱镜特性：每局自动获得 7 条随机升级（能拿则拿） */
  function applyPrismStarterUpgrades() {
    if (state.characterId !== "prism") return;
    let times = 7;
    while (times > 0) {
      const opts = pickUpgrades(state, 1);
      if (!opts || !opts.length) break;
      opts[0].apply(state);
      times -= 1;
    }
  }

  /** 进化池抽空后每级自动发放的金币 */
  const AUTO_LEVEL_REWARD_COINS = 100;

  /**
   * 不可重复的进化全部拿完后，升级不再弹三选一，直接结算补给：
   * 回满生命（溢出照常走「超量血库」）+ 100 金币，并在 HUD 提示一行。
   */
  function grantAutoLevelReward() {
    healPlayer(state.maxHp);
    grantRunCoins(state, AUTO_LEVEL_REWARD_COINS);
    state.autoRewardToastMs = 1800;
  }

  function openUpgradePanel() {
    // 池已抽空：不打断游戏，直接自动补给（可重复词条不算"还有得选"，见 hasAnyUpgradeAvailable）
    if (!hasAnyUpgradeAvailable(state)) {
      grantAutoLevelReward();
      return;
    }
    state.pausedForUpgrade = true;
    state.upgradePruneArmed = false;
    state.upgradePruneFx = null;
    state.upgradeOptions = buildUpgradeOptions();
  }

  /** 将当前三选一（或更少）面板上出现的进化词条标记为「错过」，本局不再进入候选池（补给类 isPostPoolReward 除外） */
  function blockCurrentUpgradePanelAsUnpicked() {
    const opts = state.upgradeOptions;
    if (!opts || !opts.length) return;
    if (!state._upgradeMeta) state._upgradeMeta = { picked: Object.create(null), blocked: Object.create(null) };
    if (!state._upgradeMeta.blocked) state._upgradeMeta.blocked = Object.create(null);
    for (let i = 0; i < opts.length; i += 1) {
      const o = opts[i];
      if (!o || !o.id || o.isPostPoolReward || o.repeatable) continue;
      state._upgradeMeta.blocked[o.id] = true;
    }
  }

  /** 永雏塔菲：选定一条时，同屏其余进化词条视为未选并剔除（补给与可重复词条除外） */
  function blockTaffyUnpickedSiblings(pickedIndex) {
    if (state.characterId !== "taffy") return;
    const opts = state.upgradeOptions;
    if (!opts || !opts.length) return;
    if (!state._upgradeMeta) state._upgradeMeta = { picked: Object.create(null), blocked: Object.create(null) };
    if (!state._upgradeMeta.blocked) state._upgradeMeta.blocked = Object.create(null);
    for (let i = 0; i < opts.length; i += 1) {
      if (i === pickedIndex) continue;
      const o = opts[i];
      if (!o || !o.id || o.isPostPoolReward || o.repeatable) continue;
      state._upgradeMeta.blocked[o.id] = true;
    }
  }

  function rerollUpgradeOptions() {
    if (!state.pausedForUpgrade) return;
    if (!hasAnyUpgradeAvailable(state)) return;
    // 永雏塔菲：重掷不消耗次数与金币；重掷前当前屏上所有进化词条均视为未选并剔除
    if (state.characterId === "taffy") {
      blockCurrentUpgradePanelAsUnpicked();
      state.upgradePruneArmed = false;
      state.upgradeOptions = buildUpgradeOptions();
      return;
    }
    if (state.upgradeRerollLeft > 0) {
      state.upgradeRerollLeft -= 1;
      state.upgradePruneArmed = false;
      state.upgradeOptions = buildUpgradeOptions();
      return;
    }
    const used = state.upgradePaidRerollsUsed || 0;
    if (used >= UPGRADE_PAID_REROLL_MAX) return;
    const cost = UPGRADE_PAID_REROLL_COSTS[used];
    const runStart = Math.max(0, state.coinsEarned || 0);
    const wallet = Math.max(0, storage.get().coins || 0);
    if (runStart + wallet < cost) return;
    let due = cost;
    const takeRun = Math.min(due, runStart);
    state.coinsEarned = runStart - takeRun;
    due -= takeRun;
    if (due > 0 && !storage.spendCoins(due)) {
      state.coinsEarned = runStart;
      return;
    }
    state.upgradePaidRerollsUsed = used + 1;
    state.upgradePruneArmed = false;
    state.upgradeOptions = buildUpgradeOptions();
  }

  function armUpgradePrune() {
    if (!state.pausedForUpgrade) return;
    if (state.upgradePruneArmed) {
      state.upgradePruneArmed = false;
      return;
    }
    if ((state.upgradePruneLeft || 0) <= 0) return;
    state.upgradePruneArmed = true;
  }

  /** 剔除当前升级面板中的一条词条：本局不再出现，并立即继续游戏（不拿升级） */
  function pruneUpgrade(index) {
    if (!state.pausedForUpgrade) return;
    if ((state.upgradePruneLeft || 0) <= 0) return;
    const opt = state.upgradeOptions[index];
    // 可重复词条（应急修复 / 高级重掷）不可被剔除，否则"反复刷到"会被一次剔除废掉
    if (!opt || !opt.id || opt.isPostPoolReward || opt.repeatable) return;
    if (!state._upgradeMeta) state._upgradeMeta = { picked: Object.create(null), blocked: Object.create(null) };
    if (!state._upgradeMeta.blocked) state._upgradeMeta.blocked = Object.create(null);
    state._upgradeMeta.blocked[opt.id] = true;
    state.upgradePruneLeft -= 1;
    state.upgradePruneArmed = false;
    state.upgradePruneFx = { index, ms: 240, total: 240 };
  }

  function pickUpgrade(index) {
    const opt = state.upgradeOptions[index];
    if (!opt) return;
    state.upgradePruneArmed = false;
    blockTaffyUnpickedSiblings(index);
    const hadTurncoatShield = !!state.turncoatShield;
    opt.apply(state);
    if (!hadTurncoatShield && state.turncoatShield) {
      // 新拿到「反间护盾」时立即触发一次，并从 0 开始计下一次 15 秒周期
      state.turncoatShieldAccMs = 0;
      procTurncoatShield();
    }
    clampPlayerHpToCeiling(state);
    if (state.pendingUpgradeHeal > 0) {
      healPlayer(state.pendingUpgradeHeal);
      state.pendingUpgradeHeal = 0;
    }
    state.pausedForUpgrade = false;
    state.upgradeOptions = [];

    // 选完一档后如果累积经验仍超过下一档阈值，继续弹（连升）
    if (state.exp >= state.expToNext) {
      state.exp -= state.expToNext;
      state.level += 1;
      state.expToNext = calcNextExpToNext(state.level + 1, state.expToNext);
      openUpgradePanel();
    }
  }

  /** 进入第二波。注意：不清场上的敌人/敌弹/经验球，让它们自然过渡 */
  function goWave2() {
    state.waveIndex = 2;
    state.spawnTimer = 0;
    applyTheme(false);
  }

  /** 进入第三波（Boss）。同样不清场，但立即生成 Boss */
  function goWave3() {
    state.waveIndex = 3;
    state.spawnTimer = 0;
    applyTheme(false);
    startWave();
  }

  /**
   * 应用菜单页 DEV 面板传入的调试设置：
   *   d.startLevel          起始等级（>=1）
   *   d.startWave           起始波次（1/2/3）
   *   d.upgradeStartMode    "none" | "randomByLevel" | "pickCards"
   *   d.pickUpgradeIds      自选词条 id 列表（仅 pickCards 时有效）
   *   d.godMode             true 时本局不受敌弹与撞机伤害（DEV）
   *   d.oneHitKill          true 时主炮弹/卫星/反伤对敌伤害至少清空当前生命值（核心锁 Boss 演出期除外）（DEV）
   *   d.gameSpeed10x        true 时本局逻辑时间×10（与 god / oneHit 可叠加）（DEV）
   *   d.startBossVariant    "random" | "crimson" | "azure" | "void" | "voidCore"（红/蓝/虚空仅起始阶段=Boss 时生效；voidCore = 直入虚空二阶段核心，与起始波次可叠加并由本段逻辑覆盖）
   *   d.forceUpgradeIds     本局必出升级 id 列表（每条保证至少出现一次）
   *   d.startVoidPhase2     true：同上核心战（兼容旧字段；菜单现用 startBossVariant=voidCore）
   * 顺序：先应用起手升级 → 再设等级 → 再设波次 → 最后再处理「直入核心」覆盖。
   */
  function applyDebugStart(d) {
    if (!d) return;

    if (d.godMode) state.godMode = true;
    if (d.oneHitKill) state.devOneHitKill = true;
    state.devTimeScale = d.gameSpeed10x ? 10 : 1;
    // DEV 机制强制态：payload 里带的 mechanics 表直接铺进 state（见 mechanics.js devModes）
    if (d.mechanics && typeof d.mechanics === "object") {
      state.devMechanics = Object.assign({}, d.mechanics);
    }
    // 白名单从 enemies.js 的 BOSS_VARIANTS 派生，避免与 DEV 菜单里的清单走样
    forcedBossVariant = forceableBossIds().indexOf(d.startBossVariant) >= 0
      ? d.startBossVariant
      : null;
    if (Array.isArray(d.forceUpgradeIds) && d.forceUpgradeIds.length > 0) {
      const seen = {};
      forcedUpgradeIds = d.forceUpgradeIds.filter((id) => {
        if (typeof id !== "string" || !id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
    } else if (typeof d.forceUpgradeId === "string" && d.forceUpgradeId) {
      // 兼容旧字段
      forcedUpgradeIds = [d.forceUpgradeId];
    } else {
      forcedUpgradeIds = [];
    }

    const mode = d.upgradeStartMode || "none";
    if (mode === "randomByLevel" && d.startLevel > 1) {
      const n = Math.min(50, Math.max(0, d.startLevel - 1));
      let remaining = n;
      let safety = 200;
      while (remaining > 0 && safety > 0) {
        const opts = pickUpgrades(state, 1);
        if (!opts.length) break;
        opts[0].apply(state);
        remaining -= 1;
        safety -= 1;
      }
    } else if (mode === "pickCards" && Array.isArray(d.pickUpgradeIds) && d.pickUpgradeIds.length > 0) {
      d.pickUpgradeIds.forEach((id) => {
        const u = UPGRADE_POOL.find((x) => x.id === id);
        if (u) u.apply(state);
      });
    }

    if (d.startLevel && d.startLevel > 1) {
      let lv = 1;
      let need = state.expToNext;
      while (lv < d.startLevel) {
        lv += 1;
        need = calcNextExpToNext(lv + 1, need);
      }
      state.level = lv;
      state.expToNext = need;
      state.exp = 0;
    }

    if (d.startWave === 2) {
      state.waveIndex = 2;
      applyTheme(true);
    } else if (d.startWave === 3) {
      state.waveIndex = 3;
      applyTheme(true);
      if (!state.wave3BossSpawned) spawnBoss();
    }

    if (d.startVoidPhase2 || d.startBossVariant === "voidCore") {
      forcedBossVariant = null;
      state.waveIndex = 3;
      state.wave3BossSpawned = true;
      state.bossActive = true;
      state.hiddenVoidConsumed = true;
      state.enemies = state.enemies.filter((e) => e && !e.isBoss && !e.isMirror);
      state.items = [];
      state.bullets = [];
      flashEnemyBulletClearIfAny();
      state.enemyBullets = [];
      state.voidFragments = [];
      state.voidGravityTraps = [];
      state.voidFlashAlpha = 0;
      state.voidPhase2PurpleAlpha = 0;
      state.voidDarknessAlpha = 0;
      state.voidSafeZone = null;
      state.finalJudgementDangerMs = 0;
      state.finalJudgementRushHangMs = 0;
      state.finalJudgementPetalMs = 0;
      state.finalJudgementPetalMotionDone = false;

      applyTheme(true);
      const cx = W / 2;
      const cy = H * 0.36;
      const core = createVoidCoreBoss(cx, cy, Math.max(1, state.level));
      applyEnemyCurseHp(core);
      initBossSegmentedHpBar(core);
      core.entered = true;
      core.coreIntroScale = 1;
      core.chargeProgress = 1;
      state.enemies.push(core);
      state.voidCoreUnlockAt = state.elapsed;
      state.voidCoreCombatStartAt = state.elapsed;
      audio.stopAll();
      audio.playBossBgm();
    }

    clampPlayerHpToCeiling(state);
  }

  applyPrismStarterUpgrades();

  /**
   * 统一治疗入口：
   * - 默认：只回到当前 maxHp（且不超过超限血条条数上限对应的总血量）
   * - 超量血库 I：溢出治疗转为护盾上限与当前护盾
   * - 超量血库 II：溢出治疗在仍有上限空间时永久提高 maxHp（与 I 可叠加）
   * - 超量血库 III：溢出治疗再按比值转为经验（与 I/II 可叠加）
   */
  function healPlayer(amount) {
    if (amount <= 0) return;
    const ceiling = playerOverflowTotalHpCeiling(state);
    const effectiveMaxHp = Math.min(state.maxHp, ceiling);
    const nextHp = state.hp + amount;
    const overflow = Math.max(0, nextHp - effectiveMaxHp);
    state.hp = Math.min(effectiveMaxHp, nextHp);
    if (overflow > 0) {
      if (state.overhealToShield) {
        // 护盾上限与生命上限同源封顶，避免过量治疗把护盾无限撑大
        state.shieldMaxHp = Math.min(ceiling, state.shieldMaxHp + overflow);
        state.shieldHp = Math.min(state.shieldMaxHp, state.shieldHp + overflow);
      }
      if (state.overhealToMaxHp) {
        const room = ceiling - state.maxHp;
        const add = Math.min(overflow, Math.max(0, room));
        if (add > 0) {
          state.maxHp += add;
          state.hp += add;
        }
      }
      if (state.overhealToExp) {
        gainExp(Math.max(1, Math.round(overflow / 6)));
      }
    }
    clampPlayerHpToCeiling(state);
  }

  /** 进化池已抽空时：固定二选一补给（不写入 _upgradeMeta） */
  function buildPostPoolFallbackOptions() {
    return [
      {
        isPostPoolReward: true,
        rarity: "green",
        id: "_fallback_half_hp",
        name: "生命补给",
        desc: "恢复 50% 最大生命值",
        apply(s) {
          const amt = Math.max(0, Math.floor(s.maxHp * 0.5));
          if (amt > 0) healPlayer(amt);
        },
      },
      {
        isPostPoolReward: true,
        rarity: "blue",
        id: "_fallback_500_coin",
        name: "战利品",
        desc: "获得 500 金币",
        apply(s) {
          grantRunCoins(s, 500);
        },
      },
    ];
  }

  /**
   * 击杀回调：仅推进波次（按击杀数），不再触发升级 —— 升级只来自拾取经验球。
   */
  /** 旱魃「流沙陷阱」：玩家中心落在任一生效流沙区内时的移动倍率 */
  const QUICKSAND_MOVE_MUL = 0.55;
  function quicksandMoveMul() {
    const zones = state.quicksandZones;
    if (!zones || !zones.length) return 1;
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    for (let i = 0; i < zones.length; i += 1) {
      const z = zones[i];
      if (dist2(px, py, z.x, z.y) <= z.r * z.r) return QUICKSAND_MOVE_MUL;
    }
    return 1;
  }

  /** 「流沙缚」：拾取范围内的敌人本帧位移再 ×0.7（与时间流护盾叠乘） */
  const QUICKSAND_BIND_MUL = 0.7;
  function applyQuicksandBindSlow(enemy, prevX, prevY) {
    if (!state.quicksandBind) return;
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    const r = pickupRadiusPx(state);
    const ex = enemy.x + enemy.w / 2;
    const ey = enemy.y + enemy.h / 2;
    if (dist2(px, py, ex, ey) > r * r) return;
    enemy.x = prevX + (enemy.x - prevX) * QUICKSAND_BIND_MUL;
    enemy.y = prevY + (enemy.y - prevY) * QUICKSAND_BIND_MUL;
  }

  /** 沙蠕破土：在本体位置放一圈短程沙柱弹（接触判伤） */
  function resolveSandwormErupt(enemy) {
    if (!enemy || !enemy.wormEruptPending) return;
    enemy.wormEruptPending = 0;
    const cx = enemy.x + enemy.w / 2;
    const cy = enemy.y + enemy.h / 2;
    for (let i = 0; i < 10; i += 1) {
      const a = (Math.PI * 2 * i) / 10;
      state.enemyBullets.push({
        x: cx - 5, y: cy - 5, w: 10, h: 10,
        vx: Math.cos(a) * 3.6,
        vy: Math.sin(a) * 3.6,
        dmg: 1,
      });
    }
  }

  /** 沙丘龟死亡尸爆：以尸体为中心爆散一圈沙弹（deathBurst 决定数量） */
  function spawnDeathBurst(enemy) {
    const count = Math.max(0, Math.floor(enemy && enemy.deathBurst) || 0);
    if (count <= 0) return;
    const cx = enemy.x + enemy.w / 2;
    const cy = enemy.y + enemy.h / 2;
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count;
      state.enemyBullets.push({
        x: cx - 4, y: cy - 4, w: 8, h: 8,
        vx: Math.cos(a) * 2.8,
        vy: Math.sin(a) * 2.8,
        dmg: 300,   // 与普通敌弹同档（普通敌弹为 dmg:1 × 300）
      });
    }
  }

  function onEnemyDefeated(enemy, opts) {
    const skipKillBombItem = opts && opts.skipKillBombItem;
    spawnDeathBurst(enemy);
    // 击杀奖励（先于波次推进结算）
    // 金币改为仅靠拾取 coin 道具获得；击杀不再直接给金币
    if (state.killHealChance > 0 && Math.random() < state.killHealChance) {
      healPlayer(state.maxHp * (state.killHealRatio || 0));
    }
    if (state.onKillBombChance > 0 && Math.random() < state.onKillBombChance) {
      flashEnemyBulletClearIfAny();
      state.enemyBullets = [];
    }
    if (
      !skipKillBombItem
      && (state.onKillBombItemChance || 0) > 0
      && Math.random() < state.onKillBombItemChance
    ) {
      triggerBomb();
    }

    if (enemy.isBoss) return;
  }

  // ==========================================================================
  //  道具掉落 / 拾取
  // ==========================================================================

  /**
   * 掉落经验球（必掉，noItemDrop 除外）：
   *   普通敌机 → 70% 小绿球 / 30% 中蓝球
   *   精英敌机 → 60% 大紫球 / 40% 中蓝球
   * 另外按 dropChance 额外掉一件道具（heart/bomb/magnet/coin）；noItemDrop 时整块跳过。
   */
  function dropLootFromEnemy(enemy) {
    const cx = enemy.x + enemy.w / 2;
    const cy = enemy.y + enemy.h / 2;

    // 地狱：普通敌人原地留下魂火；亡魂被 spawnSoulfireFor 内部挡掉（回路不递归）
    if (state.hellCfg) {
      if (enemy.isHellRevenant) onRevenantKilled(state);
      else spawnSoulfireFor(enemy, state, state.level);
      onHellEnemyKilled(enemy, state);
    }

    // 沙漠：普通敌人不再每只必掉经验球（精英/Boss 不受限）
    const lootCfg = state.mapLoot;
    const expOrbChance = lootCfg && !enemy.isElite && !enemy.isBoss
      ? (lootCfg.expOrbChance != null ? lootCfg.expOrbChance : 1)
      : 1;
    if (!enemy.noItemDrop && (expOrbChance >= 1 || Math.random() < expOrbChance)) {
      let expType;
      if (enemy.isElite) {
        // 精英经验整体上调约 20%：提高高价值经验球占比
        expType = Math.random() < 0.85 ? "exp_large" : "exp_medium";
      } else {
        expType = Math.random() < 0.7 ? "exp_small" : "exp_medium";
      }
      state.items.push(createItem(cx, cy, expType));
    }

    let dropChance = (state.dropBase + sandstormDropBonus())
      * (lootCfg && lootCfg.dropMul != null ? lootCfg.dropMul : 1);
    if (enemy.noItemDrop) dropChance = 0;
    if (enemy.isElite && state.eliteGuaranteedDrop) dropChance = 1;
    if (Math.random() < dropChance) {
      state.items.push(createItem(cx + (Math.random() - 0.5) * 16, cy + 8));
    }
    if (
      !enemy.noItemDrop
      && (state.dropLevelUpChance || 0) > 0
      && Math.random() < state.dropLevelUpChance
    ) {
      state.items.push(createItem(cx + (Math.random() - 0.5) * 20, cy + 14, "levelup"));
    }
  }

  /** Boss 死亡：大量经验球 + 一些道具 */
  function dropBossLoot(enemy) {
    grantRunCoins(state, bossCoin(enemy && enemy.bossVariant));
    const cx = enemy.x + enemy.w / 2;
    const cy = enemy.y + enemy.h / 2;
    // 8 颗橙色巨经验球
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      state.items.push(createItem(cx + Math.cos(a) * 30, cy + Math.sin(a) * 22, "exp_huge"));
    }
    // 8 颗紫色大经验球
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
      state.items.push(createItem(cx + Math.cos(a) * 50, cy + Math.sin(a) * 36, "exp_large"));
    }
    // 6 件道具
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI * 2 * i) / 6;
      state.items.push(createItem(cx + Math.cos(a) * 70, cy + Math.sin(a) * 50));
    }
    if ((state.dropLevelUpChance || 0) > 0 && Math.random() < state.dropLevelUpChance) {
      state.items.push(createItem(cx + (Math.random() - 0.5) * 24, cy + 24, "levelup"));
    }
  }

  // ==========================================================================
  //  固定三波脚本（不使用经验升级面板）
  // ==========================================================================

  // ==========================================================================
  //  道具效果
  // ==========================================================================

  /** 拾取道具时执行对应效果 */
  function consumeItem(item) {
    if (item.type && item.type.indexOf("exp_") === 0) {
      const v = (item.expValue || 1) * state.expOrbValueMul;
      gainExp(v);
      return;
    }
    if (item.type === "heart") {
      healPlayer(1000);
    } else if (item.type === "bomb") {
      triggerBomb();
    } else if (item.type === "magnet") {
      // 磁吸道具：持续 5 秒
      state.magnetTimerMs = 5000;
    } else if (item.type === "coin") {
      // 拾荒者：击杀早已不直接给金币（金币只从 coin 道具来），所以加成接在拾取上
      const stormCoin = state.sandstormActive ? (state.stormCoinMul || 1) : 1;
      grantRunCoins(state, Math.round(30 * stormCoin));
    } else if (item.type === "levelup") {
      // 直接升一级：与经验条 / expMul 无关，拾取后本级进度清空为 0
      const prevNeed = state.expToNext;
      state.level += 1;
      state.exp = 0;
      state.expToNext = calcNextExpToNext(state.level + 1, prevNeed);
      openUpgradePanel();
    } else if (item.type === "invincible") {
      // 暂时无敌（5 秒）：碰撞与敌弹完全免伤
      state.invincibleMs = 5000;
    }
  }

  /** 清空敌弹前的全屏闪光（与炸弹共用 drawBombFlash，仅当场上确有敌弹时触发） */
  function flashEnemyBulletClearIfAny() {
    if (!state.flashEffectsOn) return;
    if (state.enemyBullets && state.enemyBullets.length > 0) {
      state.bombFlashMs = Math.max(state.bombFlashMs || 0, 280);
    }
  }

  /**
   * 炸弹效果：清空敌弹 + 普通敌机即死 + 精英扣当前生命 50% + Boss 扣固定血量。
   * 同时触发屏幕闪光（drawBombFlash）。
   */
  function triggerBomb() {
    state.bombFlashMs = state.flashEffectsOn ? 280 : 0; // 闪光持续 280ms
    state.enemyBullets = [];
    state.enemies.forEach((enemy) => {
      if (!enemy) return;
      if (enemy.isBoss) {
        if (enemy.inCutscene && enemy.voidShellCutscene) return;
        if (enemy.bossVariant === "void" && !enemy.phase2Triggered) {
          const hb = enemy.hp;
          enemy.hp -= 25000 * mapDamageMul();
          notifyBossSegmentLayerBreak(enemy, hb);
          if (enemy.hp <= 0) triggerVoidPhase2(enemy);
          return;
        }
        const hpBomb = enemy.hp;
        enemy.hp -= 25000 * mapDamageMul(); // 潮汐增伤也适用于炸弹
        notifyBossSegmentLayerBreak(enemy, hpBomb);
      } else if (enemy.isElite) {
        enemy.hp -= enemy.hp * Math.min(1, 0.5 * mapDamageMul());
      } else {
        enemy.hp = 0;
      }
    });

    const remaining = [];
    state.enemies.forEach((enemy) => {
      if (!enemy) return;
      if (enemy.hp <= 0 && !enemy.isBoss) {
        state.kills += 1;
        onEnemyDefeated(enemy, { skipKillBombItem: true });
        dropLootFromEnemy(enemy);
      } else {
        remaining.push(enemy);
      }
    });
    state.enemies = remaining;
    // 炸弹也能完成 Boss 击杀，不等待下一发主炮命中才结算。
    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = state.enemies[i];
      if (!enemy || !enemy.isBoss || enemy.hp > 0 || enemy.inCutscene) continue;
      const outcome = resolvePrimaryBossDefeat(enemy);
      if (outcome === "voidPhase2") { triggerVoidPhase2(enemy); continue; }
      state.kills += 1;
      dropBossLoot(enemy);
      state.enemies.splice(i, 1);
      if (outcome === "hiddenVoid") { spawnHiddenVoidBoss(); return; }
      if (state.endlessMode) { performEndlessRoundResetToWave1(true); return; }
      state.offerEndlessAfterVoidWin = resolveBossVictory(enemy);
      state.win = true;
      state.gameOver = true;
      if (!state.offerEndlessAfterVoidWin) finishRun();
      return;
    }
  }

  /** 虚空一阶段 HP 归零：进入二阶段过场，不胜利、不结算 */
  function triggerVoidPhase2(boss) {
    if (boss.phase2Triggered) return;
    boss.phase2Triggered = true;
    boss.inCutscene = true;
    boss.cutsceneTimer = 0;
    boss.voidShellCutscene = true;
    boss.hp = 1;
    boss.cutsceneAlpha = 1;
    boss.voidPhase2CoreSpawned = false;
    boss._voidPhase2BgmRestarted = false;
    flashEnemyBulletClearIfAny();
    state.enemyBullets = [];
    state.voidGravityTraps = [];
    state.finalJudgementDangerMs = 0;
    state.finalJudgementRushHangMs = 0;
    state.finalJudgementPetalMs = 0;
    state.finalJudgementPetalMotionDone = false;
    state.voidSafeZone = null;
    state.voidFragments = [];
    const cx = boss.x + boss.w / 2;
    const cy = boss.y + boss.h / 2;
    for (let i = 0; i < 36; i += 1) {
      const ang = (i / 36) * Math.PI * 2;
      const spd = 2.1 + Math.random() * 3.6;
      state.voidFragments.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 1,
        size: 5 + Math.random() * 9,
      });
    }
    state.voidFlashAlpha = 0;
    state.voidPhase2PurpleAlpha = 0;
    state.voidCoreUnlockAt = state.elapsed + VOID_P2_MS_TOTAL;
    state.voidCoreCombatStartAt = null;
    state.invincibleMs = Math.max(state.invincibleMs || 0, VOID_P2_MS_TOTAL + 500);
    state.voidDarknessAlpha = 0;
  }

  function updateVoidCutscene(boss, delta) {
    boss.cutsceneTimer = (boss.cutsceneTimer || 0) + delta;
    const t = boss.cutsceneTimer;
    const tcx = boss.x + boss.w / 2;
    const tcy = boss.y + boss.h / 2;

    if (state.voidFragments && state.voidFragments.length) {
      if (t < VOID_P2_MS_CONV_START) {
        state.voidFragments.forEach((f) => {
          f.x += f.vx * delta * 0.052;
          f.y += f.vy * delta * 0.052;
          f.vx *= 0.986;
          f.vy *= 0.986;
          f.life -= delta / 9000;
        });
      } else if (t < VOID_P2_MS_CORE_SPAWN) {
        const convT = Math.max(0, Math.min(1, (t - VOID_P2_MS_CONV_START) / VOID_P2_MS_CONVERGE));
        const k = (0.02 + convT * 0.068) * Math.min(1.1, delta / 16.67);
        state.voidFragments.forEach((f) => {
          const dx = tcx - f.x;
          const dy = tcy - f.y;
          const dist = Math.hypot(dx, dy);
          f.x += dx * Math.min(0.28, k);
          f.y += dy * Math.min(0.28, k);
          f.vx *= 0.88;
          f.vy *= 0.88;
          f.size *= 0.9972;
          if (dist < 5.5) f.life = 0;
        });
      }
      if (t >= VOID_P2_MS_CORE_SPAWN) {
        state.voidFragments = [];
      } else {
        state.voidFragments = state.voidFragments.filter((f) => f.life > 0.02 && f.size > 0.35);
      }
    }

    if (t < VOID_P2_MS_FLASH) {
      boss.cutsceneAlpha = 1 - t / VOID_P2_MS_FLASH;
      state.voidFlashAlpha = (t / VOID_P2_MS_FLASH) * 0.9;
      state.voidPhase2PurpleAlpha = 0;
    } else if (t < VOID_P2_MS_CONV_START) {
      boss.cutsceneAlpha = 0;
      const pu = t - VOID_P2_MS_FLASH;
      const puDur = VOID_P2_MS_PURPLE;
      state.voidFlashAlpha = Math.max(0, 0.9 - (pu / puDur) * 0.9);
      state.voidPhase2PurpleAlpha = (pu / puDur) * 0.64;
      if (t >= VOID_P2_MS_FLASH && !boss._voidPhase2BgmRestarted) {
        boss._voidPhase2BgmRestarted = true;
        audio.stopAll();
        audio.playBossBgm();
      }
    } else if (t < VOID_P2_MS_CORE_SPAWN) {
      boss.cutsceneAlpha = 0;
      state.voidFlashAlpha = 0;
      const cv = (t - VOID_P2_MS_CONV_START) / VOID_P2_MS_CONVERGE;
      state.voidPhase2PurpleAlpha = 0.64 - cv * (0.64 - 0.58);
    } else if (t < VOID_P2_MS_TOTAL) {
      boss.cutsceneAlpha = 0;
      state.voidFlashAlpha = 0;
      const ch = t - VOID_P2_MS_CORE_SPAWN;
      const chDur = VOID_P2_MS_CHARGE;
      state.voidPhase2PurpleAlpha = Math.max(0, 0.58 - (ch / chDur) * 0.34);
      if (!boss.voidPhase2CoreSpawned) {
        boss.voidPhase2CoreSpawned = true;
        const cx = boss.x + boss.w / 2;
        const cy = boss.y + boss.h / 2;
        const coreBoss = createVoidCoreBoss(cx, cy, Math.max(1, state.level));
        applyEnemyCurseHp(coreBoss);
        initBossSegmentedHpBar(coreBoss);
        state.enemies.push(coreBoss);
      }
      const prog = Math.max(0, Math.min(1, ch / chDur));
      state.enemies.forEach((e) => {
        if (e && e.isVoidCore) {
          e.chargeProgress = prog;
          e.coreIntroScale = prog;
        }
      });
    } else {
      state.voidPhase2PurpleAlpha = 0;
      state.voidFlashAlpha = 0;
      state.voidFragments = [];
      state.enemies = state.enemies.filter((e) => e && !e.voidShellCutscene);
      boss.inCutscene = false;
      state.voidCoreUnlockAt = state.elapsed;
      state.voidCoreCombatStartAt = state.elapsed;
    }
  }

  function drawVoidPhase2Cutscene(ctx) {
    const shell = state.enemies.find((e) => e.voidShellCutscene && e.inCutscene);
    const ct = shell ? (shell.cutsceneTimer || 0) : 0;
    const convU =
      ct < VOID_P2_MS_CONV_START
        ? 0
        : ct < VOID_P2_MS_CORE_SPAWN
          ? Math.max(0, Math.min(1, (ct - VOID_P2_MS_CONV_START) / VOID_P2_MS_CONVERGE))
          : 1;

    if (state.voidPhase2PurpleAlpha > 0.02) {
      ctx.fillStyle = `rgba(46, 16, 72, ${Math.max(0, Math.min(0.92, state.voidPhase2PurpleAlpha))})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (shell && ct >= VOID_P2_MS_CONV_START && ct < VOID_P2_MS_CORE_SPAWN) {
      const scx = shell.x + shell.w / 2;
      const scy = shell.y + shell.h / 2;
      const u = convU;
      const rForm = (1 - u) * 82 + u * 34;
      ctx.save();
      ctx.globalAlpha = 0.1 + u * 0.28;
      ctx.strokeStyle = "#fae8ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(scx, scy, rForm, state.elapsed * 0.002, Math.PI * 2 + state.elapsed * 0.002);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.07 + u * 0.16;
      ctx.fillStyle = "#581c87";
      ctx.beginPath();
      ctx.arc(scx, scy, rForm * (0.5 + u * 0.45), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (state.voidFragments && state.voidFragments.length) {
      state.voidFragments.forEach((f) => {
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
        const u = convU;
        const r = Math.round(216 + (124 - 216) * u);
        const g = Math.round(180 + (58 - 180) * u);
        const b = Math.round(254 + (237 - 254) * u);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        const s = f.size;
        ctx.fillRect(f.x - s / 2, f.y - s / 2, s, s);
      });
      ctx.globalAlpha = 1;
    }
    if (state.flashEffectsOn && (state.voidFlashAlpha || 0) > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, state.voidFlashAlpha))})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (shell && ct >= VOID_P2_MS_CORE_SPAWN && ct < VOID_P2_MS_TOTAL) {
      const core = state.enemies.find((e) => e.isVoidCore);
      if (core) {
        const cx = core.x + core.w / 2;
        const cy = core.y + core.h / 2;
        const pr = core.chargeProgress || 0;
        for (let ring = 0; ring < 3; ring += 1) {
          const r = 22 + pr * 48 * ((ring + 1) / 3);
          ctx.strokeStyle = `rgba(250, 232, 255, ${(0.55 - ring * 0.12) * pr})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r, state.elapsed * 0.002 + ring, Math.PI * 2 + state.elapsed * 0.002 + ring);
          ctx.stroke();
        }
      }
    }
  }

  // ==========================================================================
  //  UI 矩形（点击区域 + 绘制位置）
  // ==========================================================================

  /** Game Over 面板 - "再来一局"按钮：屏幕中心下方 30，宽 180 高 50 */
  function getRestartRect() {
    const w = 180;
    const h = 50;
    return { x: W / 2 - w / 2, y: H / 2 + 30 + UI_SHIFT_Y + (state.newCharacterUnlockedName ? 36 : 0), w, h };
  }

  /** Game Over 面板 - "回到菜单"按钮：在 restart 下方 60 处，宽 180 高 44 */
  function getMenuRect() {
    const w = 180;
    const h = 44;
    return { x: W / 2 - w / 2, y: H / 2 + 90 + UI_SHIFT_Y + (state.newCharacterUnlockedName ? 36 : 0), w, h };
  }

  /** 胜利且击败虚空 Boss 时：底部红色「无尽模式」 */
  function getEndlessRect() {
    const w = 200;
    const h = 48;
    return { x: W / 2 - w / 2, y: H / 2 + 142 + UI_SHIFT_Y + (state.newCharacterUnlockedName ? 36 : 0), w, h };
  }

  /** 战斗中右上角"退出"按钮（HUD 中），56x30 */
  function getPauseRect() {
    return { x: W - 70, y: 30 + UI_SHIFT_Y, w: 56, h: 30 };
  }

  /** 退出键左侧：音乐开/关（与退出同尺寸，便于点击） */
  function getBattleMusicRect() {
    const pr = getPauseRect();
    const gap = 8;
    const w = 56;
    return { x: pr.x - gap - w, y: pr.y, w, h: pr.h };
  }

  /**
   * 升级面板里 3 个选项按钮的矩形，以及包裹它们的整个面板矩形。
   * 设计：
   *   panelW = 屏幕宽 84%
   *   按钮高度 76，按钮间距 14，标题区高 60
   *   面板底部预留 52px 放「重选」按钮
   *   面板总高 = 标题 + (按钮高 + 间距) * 3 + 底部区
   *   面板垂直居中
   */
  function getUpgradeButtonRect(index) {
    const panelW = W * 0.84;
    const panelX = (W - panelW) / 2;
    const btnH = 76;
    const gap = 14;
    const titleH = 60;
    const footerH = 52;
    const optCount = Math.max(1, (state.upgradeOptions && state.upgradeOptions.length) || 3);
    const totalH = titleH + (btnH + gap) * optCount + footerH;
    const panelY = H / 2 - totalH / 2 + UI_SHIFT_Y;
    return {
      x: panelX + 16,
      y: panelY + titleH + index * (btnH + gap),
      w: panelW - 32,
      h: btnH,
      // 顺便把面板矩形也带上，避免 drawUpgradePanel 重复算
      panelX,
      panelY,
      panelW,
      panelH: totalH,
    };
  }

  function getUpgradeRerollRect() {
    const sample = getUpgradeButtonRect(0);
    const gap = 10;
    const w = (sample.panelW - 32 - gap) / 2;
    const h = 32;
    return {
      x: sample.panelX + 16,
      y: sample.panelY + sample.panelH - h - 12,
      w,
      h,
    };
  }

  function getUpgradePruneRect() {
    const rr = getUpgradeRerollRect();
    return { x: rr.x + rr.w + 10, y: rr.y, w: rr.w, h: rr.h };
  }

  // ==========================================================================
  //  每帧更新
  // ==========================================================================

  /**
   * 每帧推进战斗逻辑。delta 是本帧时长（毫秒）。
   * 顺序：
   *   1. 升级或 Game Over 时直接 return
   *   2. 推进波次 / 刷怪 / 玩家自动射击 / 自动回血
   *   3. 移动 + 出界回收：玩家子弹、敌机、敌弹、道具
   *   4. 碰撞处理：玩家子弹↔敌机、玩家↔道具、玩家↔敌弹、玩家↔敌机
   */
  function update(delta) {
    const dt =
      delta * Math.max(0.25, Math.min(120, Number(state.devTimeScale) || 1));
    state.upgradePanelAnimMs += dt;
    state.autoRewardToastMs = Math.max(0, (state.autoRewardToastMs || 0) - dt);
    state.hiddenVoidStrobeMs = Math.max(0, (state.hiddenVoidStrobeMs || 0) - dt);
    if (state.pausedForUpgrade && state.upgradePruneFx) {
      state.upgradePruneFx.ms = Math.max(0, state.upgradePruneFx.ms - dt);
      if (state.upgradePruneFx.ms <= 0) {
        state.upgradePruneFx = null;
        state.pausedForUpgrade = false;
        state.upgradeOptions = [];
      }
      return;
    }
    if (state.gameOver || state.pausedForUpgrade) return;

    refreshEndlessScaling();
    state.elapsed += dt;
    state.windBurstMs = Math.max(0, (state.windBurstMs || 0) - dt);
    state.bombFlashMs = Math.max(0, state.bombFlashMs - dt);
    state.magnetTimerMs = Math.max(0, state.magnetTimerMs - dt);

    // ---------- 背景渐变推进 ----------
    if (state.themeBlendLeftMs > 0) {
      state.themeBlendLeftMs = Math.max(0, state.themeBlendLeftMs - dt);
      const total = 800;
      state.themeBlendT = 1 - state.themeBlendLeftMs / total;
    } else {
      state.themeBlendT = 1;
    }

    // ---------- 波次推进：到达固定时点（不按等级）；诅咒天赋加快通用刷怪间隔 ----------
    if (state.waveIndex === 1 && state.elapsed >= WAVE2_START_MS) goWave2();
    if (state.waveIndex === 2 && state.elapsed >= WAVE3_START_MS) goWave3();

    const endlessSpawnBoost = state.endlessMode
      ? Math.pow(ENDLESS_LAP_SPAWN_MUL, Math.max(0, state.endlessLapsCompleted || 0))
      : 1;
    const spawnFreqMul = state.curseSpawnMul * endlessSpawnBoost;
    // ---------- 固定三波推进 ----------
    state.spawnTimer += dt;
    if (state.waveIndex === 1) {
      const spawnInterval = 900 / (spawnFreqMul * BASE_SPAWN_FREQ_BOOST);
      if (state.spawnTimer >= spawnInterval && state.enemies.length < 4) {
        state.spawnTimer = 0;
        spawnRegular();
      }
    } else if (state.waveIndex === 2) {
      const spawnInterval = 1200 / (spawnFreqMul * BASE_SPAWN_FREQ_BOOST);
      const eliteCount = state.enemies.filter((e) => e.isElite).length;
      const normalCount = state.enemies.filter((e) => !e.isBoss && !e.isElite).length;
      if (state.spawnTimer >= spawnInterval && eliteCount + normalCount < 5) {
        state.spawnTimer = 0;
        // 第二波混合刷怪：精英 + 普通
        if (eliteCount < 2 && Math.random() < 0.55) spawnWave2Elite();
        else spawnRegular();
      }
    } else if (state.waveIndex === 3) {
      if (!state.wave3BossSpawned) {
        spawnBoss();
      } else if (state.spawnTimer >= 1200 / (spawnFreqMul * BASE_SPAWN_FREQ_BOOST)) {
        state.spawnTimer = 0;
        if (!isVoidFinalJudgementCrowdControlled(state)) {
          const addCount = state.enemies.filter((e) => !e.isBoss).length;
          if (addCount < 4) {
            const roll = Math.random();
            if (roll < 0.15) spawnWave2Elite();
            else if (roll < 0.40) spawnRegular(); // wave=3 池含 shooter
          }
        }
      }
    }

    // ---------- 地图机制：在本帧射击前更新涨潮/退潮 ----------
    updateMechanics(dt);
    applyBossStormOverride();

    // ---------- 玩家自动射击 ----------
    // 逆风者：只在沙暴期生效，所以是结算时除以倍率，而不是永久改 shootInterval
    state.shootTimer += dt;
    const stormFire = state.sandstormActive ? (state.stormFireRateMul || 1) : 1;
    const tideFire = state.tideActive ? (state.tideFireRateMul || 1) : 1;
    const effInterval = Math.max(
      state.shootIntervalFloor || 80,
      state.shootInterval / (stormFire * tideFire),
    );
    if (state.shootTimer >= effInterval) {
      state.shootTimer = 0;
      fireBullets();
    }

    // ---------- 轨道卫星发射追踪弹 ----------
    if (state.satelliteCount > 0 && state.enemies.length > 0) {
      state.satelliteShotCooldownMs -= dt;
      if (state.satelliteShotCooldownMs <= 0) {
        state.satelliteShotCooldownMs = state.satelliteShotIntervalMs;
        const p = state.player;
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        const lockedTarget = findNearestEnemy(cx, cy); // 本轮卫星追踪弹统一锁定同一个目标
        const satStep = (Math.PI * 2) / Math.max(1, state.satelliteCount);
        for (let si = 0; si < state.satelliteCount; si += 1) {
          const ang = state.elapsed * state.satelliteOrbitSpeed + si * satStep;
          const sx = cx + Math.cos(ang) * state.satelliteOrbitRadius;
          const sy = cy + Math.sin(ang) * state.satelliteOrbitRadius;
          const tx = lockedTarget ? lockedTarget.x + lockedTarget.w / 2 : sx;
          const ty = lockedTarget ? lockedTarget.y + lockedTarget.h / 2 : sy - 100;
          const dx = tx - sx;
          const dy = ty - sy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = 6.2;
          state.bullets.push({
            x: sx - 3,
            y: sy - 5,
            w: 6,
            h: 10,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            dmg: Math.max(1, state.bulletDamage / 3),
            pierceEnemies: false,
            pierceLeft: 0,
            homing: true,
            homingTurn: 0.18,
            homingSpeed: speed,
            homingTargetRef: lockedTarget || null,
            color: state.characterId === "vampire" ? "#7c2335" : "#60a5fa",
            /** 吸血鬼卫星追踪弹：命中吸血单独 1%，不走主炮 vampRate */
            vampireSatelliteHoming: state.characterId === "vampire",
          });
        }
      }
    } else {
      state.satelliteShotCooldownMs = 0;
    }

    // ---------- Boss 出招时杂兵停火（弹幕分层，见 updateAddFireSuppression）----------
    updateAddFireSuppression();

    // ---------- 自动回血 ----------
    if (state.hasRegen) {
      state.regenTimer += dt;
      if (state.regenTimer >= state.regenIntervalMs) {
        state.regenTimer = 0;
        healPlayer(Math.max(1, state.baseMaxHp) * state.regenHealRatio);
      }
    }

    // ---------- 沙暴之眼：沙暴期每秒回血 ----------
    if (state.sandstormActive && (state.stormEyeRegenRatio || 0) > 0) {
      state.stormEyeRegenAccMs += dt;
      while (state.stormEyeRegenAccMs >= 1000) {
        state.stormEyeRegenAccMs -= 1000;
        healPlayer(Math.max(1, state.baseMaxHp) * state.stormEyeRegenRatio);
      }
    } else {
      state.stormEyeRegenAccMs = 0;
    }

    // ---------- 护盾修复 ----------
    if (state.shieldMaxHp > 0 && state.shieldHp < state.shieldMaxHp && state.shieldRegenPerSec > 0) {
      state.shieldHp = Math.min(
        state.shieldMaxHp,
        state.shieldHp + state.shieldMaxHp * state.shieldRegenPerSec * (dt / 1000)
      );
    }
    state.shieldFlashMs = Math.max(0, state.shieldFlashMs - dt);
    state.invincibleMs = Math.max(0, state.invincibleMs - dt);

    // ---------- 反间护盾 ----------
    if (state.turncoatShield) {
      state.turncoatShieldAccMs += dt;
      while (state.turncoatShieldAccMs >= TURNCOAT_SHIELD_INTERVAL_MS) {
        state.turncoatShieldAccMs -= TURNCOAT_SHIELD_INTERVAL_MS;
        procTurncoatShield();
      }
    }

    // ---------- Boss 战中周期性随机掉落道具（INV / 普通道具；LV+ 见「空投信标」） ----------
    if (state.bossActive && state.wave3BossSpawned) {
      state.bossDropTimer += dt;
      if (state.bossDropTimer >= state.bossDropNextMs) {
        state.bossDropTimer = 0;
        state.bossDropNextMs = 7000 + Math.floor(Math.random() * 6000); // 7~13s 随机
        // 掉落概率分布（总和 100）：无敌 28 / 治疗 23 / 磁吸 18 / 炸弹 18 / 金币 13
        // LV+ 不再默认掉落——只有拾取「空投信标」后才会由下面的空投逻辑给出
        const r = Math.random();
        let type;
        if (r < 0.28) type = "invincible";
        else if (r < 0.51) type = "heart";
        else if (r < 0.69) type = "magnet";
        else if (r < 0.87) type = "bomb";
        else type = "coin";
        const dropX = 30 + Math.random() * (W - 60);
        const dropY = -10;
        state.items.push(createItem(dropX, dropY, type));
      }
    }

    // ---------- 「空投信标」：拾取后本局剩余时间内不定期空投 LV+ 升级包 ----------
    if (state.levelUpSupply) {
      state.levelUpSupplyTimer += dt;
      if (state.levelUpSupplyTimer >= state.levelUpSupplyNextMs) {
        state.levelUpSupplyTimer = 0;
        state.levelUpSupplyNextMs = 35000 + Math.floor(Math.random() * 20000); // 35~55s 随机
        state.items.push(createItem(30 + Math.random() * (W - 60), -10, "levelup"));
      }
    }

    // ---------- 玩家子弹移动 + 出界销毁 ----------
    state.bullets.forEach((b) => {
      if (!b || typeof b.x !== "number") return;
      if (b.homing) {
        const target = b.homingTargetRef;
        // 追踪弹只跟首锁目标；若目标已死亡/移除，则保持当前轨迹继续飞行
        if (target && state.enemies.indexOf(target) >= 0) {
          const tx = target.x + target.w / 2;
          const ty = target.y + target.h / 2;
          const dx = tx - (b.x + b.w / 2);
          const dy = ty - (b.y + b.h / 2);
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = b.homingSpeed || 6.2;
          const desiredVx = (dx / len) * speed;
          const desiredVy = (dy / len) * speed;
          const turn = b.homingTurn || 0.18;
          b.vx += (desiredVx - b.vx) * turn;
          b.vy += (desiredVy - b.vy) * turn;
        }
      }
      const terrainPrevX = b.x, terrainPrevY = b.y;
      b.x += b.vx;
      b.y += b.vy;
      if (state.grasslandCfg && interceptGrassBullet(state, b, true, terrainPrevX, terrainPrevY)) b.grassConsumed = true;
    });
    state.bullets = state.bullets.filter(
      (b) => b && !b.grassConsumed
        && typeof b.x === "number"
        && typeof b.y === "number"
        && b.y > -20 && b.y < H + 20 && b.x > -20 && b.x < W + 20
    );

    // ---------- 敌机 AI / 移动 / 射击 ----------
    state.enemies.forEach((enemy) => {
      if (!enemy || typeof enemy.x !== "number") return;
      // 出生时刻：首次被处理的那一帧即出生帧。用它判断"30 秒后**新生成的**敌人才开火"，
      // 避免已经在场上的敌人到 30 秒突然一起开火。
      if (typeof enemy.spawnElapsed !== "number") enemy.spawnElapsed = state.elapsed;
      if (enemy.isMirror) {
        const owner = enemy.ownerBossRef;
        if (!owner || owner.hp <= 0) return;
        enemy.x = W - owner.x - enemy.w;
        enemy.y = owner.y + (owner.h - enemy.h) * 0.5;
        enemy.spinAngle = owner.spinAngle || 0;
        if (typeof enemy.mirrorIntroMsRemain === "number" && enemy.mirrorIntroMsRemain > 0) {
          enemy.mirrorIntroMsRemain = Math.max(0, enemy.mirrorIntroMsRemain - dt);
        }
        return;
      }
      if (enemy.isBoss) {
        if (enemy.inCutscene) {
          const prevX = enemy.x;
          const prevY = enemy.y;
          updateVoidCutscene(enemy, dt);
          applyTimeflowEnemyDisplacementSlow(state, enemy, prevX, prevY);
        } else {
          const prevX = enemy.x;
          const prevY = enemy.y;
          getUpdateBoss()(
            enemy,
            dt,
            state,
            (b) => {
              state.enemyBullets.push(
                Object.assign({}, b, { dmg: (b.dmg || 1) * 450 })
              );
            },
            (cfg) => spawnBossAdd(enemy, cfg)
          );
          applyTimeflowEnemyDisplacementSlow(state, enemy, prevX, prevY);
          const moved = Math.hypot(enemy.x - prevX, enemy.y - prevY);
          if (typeof enemy.spinAngle !== "number") enemy.spinAngle = 0;
          enemy.spinAngle += dt * 0.0018 + moved * 0.03;
        }
      } else {
        const prevX = enemy.x;
        const prevY = enemy.y;
        updateEnemy(enemy, dt, state);
        if (enemy.wormEruptPending) resolveSandwormErupt(enemy);
        // 沙暴：只放大本帧的位移量，不改敌弹速度
        const stormMul = state.sandstormMoveMul || 1;
        if (stormMul !== 1) {
          enemy.x = prevX + (enemy.x - prevX) * stormMul;
          enemy.y = prevY + (enemy.y - prevY) * stormMul;
        }
        // 流沙缚：拾取范围内额外减速 30%（与时间流护盾叠乘）
        applyQuicksandBindSlow(enemy, prevX, prevY);
        applyTimeflowEnemyDisplacementSlow(state, enemy, prevX, prevY);
        const pushEnemyBullet = (b) => {
          state.enemyBullets.push(
            Object.assign({}, b, { dmg: (b.dmg || 1) * 300 })
          );
        };

        // 原有：射手/精英的开火逻辑
        maybeFire(enemy, dt, state, pushEnemyBullet);

        // 开局 30 秒之后**新生成的**普通敌人会额外单发射击（响尾炮也算普通敌人，
        // 在自己的弹墙之外还会补这一发）。按出生时刻判定，已在场上的敌人不会突然开火。
        // 排除：精英 / 射手（有专职射击行为）/ 标了 neverFires 的纯冲撞型（沙蜂、掠沙者）
        const isNormalEnemy = !enemy.isElite && enemy.type !== "shooter" && !enemy.neverFires;
        if (isNormalEnemy && enemy.spawnElapsed >= 30000 && !state.addFireSuppressed) {
          if (typeof enemy.normalFireCooldown !== "number") {
            enemy.normalFireCooldown = 1000 + Math.random() * 800;
          }
          enemy.normalFireCooldown -= dt;
          if (enemy.normalFireCooldown <= 0 && enemy.y >= 40) {
            enemy.normalFireCooldown = 2200 + Math.random() * 900;
            const cx = enemy.x + enemy.w / 2;
            const cy = enemy.y + enemy.h;
            pushEnemyBullet({ x: cx - 4, y: cy, w: 7, h: 12, vx: 0, vy: 3.9, dmg: 1 });
          }
        }
      }
    });
    // Boss 不会因为出界被回收，普通敌机出底部就消失
    state.enemies = state.enemies.filter(
      (e) => e
        && typeof e.x === "number"
        && (e.isBoss
          || (e.isMirror && e.ownerBossRef && e.ownerBossRef.hp > 0)
          || (e.y < H + 60 && e.x > -80 && e.x < W + 80))
    );

    // ---------- 虚空 Boss：最终审判余弹 · 短暂危险期后进花瓣无伤消散 ----------
    let judgementBoltRemain = false;
    state.enemyBullets.forEach((bb) => {
      if (bb && bb.judgementBolt) judgementBoltRemain = true;
    });
    const petalWasLife = state.finalJudgementPetalMs > 0;

    const prevHang = state.finalJudgementRushHangMs || 0;
    if (prevHang > 0) {
      state.finalJudgementRushHangMs = Math.max(0, prevHang - dt);
      if (prevHang > 0 && state.finalJudgementRushHangMs <= 0) {
        armVoidJudgementRushBullets(state);
      }
    }

    if ((state.finalJudgementDangerMs || 0) > 0) {
      state.finalJudgementDangerMs = Math.max(0, state.finalJudgementDangerMs - dt);
    }

    const petalEligible =
      judgementBoltRemain
      && state.finalJudgementDangerMs <= 0
      && (state.finalJudgementRushHangMs || 0) <= 0
      && state.finalJudgementPetalMs <= 0
      && !hasLethalJudgementRushBullets(state);

    if (petalEligible) state.finalJudgementPetalMotionDone = false;
    const prevPetal = state.finalJudgementPetalMs;
    if (state.finalJudgementPetalMs > 0) state.finalJudgementPetalMs = Math.max(0, state.finalJudgementPetalMs - dt);

    const startPetalBurst =
      judgementBoltRemain
      && state.finalJudgementDangerMs <= 0
      && (state.finalJudgementRushHangMs || 0) <= 0
      && prevPetal <= 0
      && !hasLethalJudgementRushBullets(state);
    if (startPetalBurst) state.finalJudgementPetalMs = 3000;

    if (state.finalJudgementPetalMs > 0) {
      if (!state.finalJudgementPetalMotionDone && judgementBoltRemain) {
        state.finalJudgementPetalMotionDone = true;
        state.enemyBullets.forEach((b) => {
          if (!b || !b.judgementBolt) return;
          const drift = Math.random() * Math.PI * 2;
          const boost = 0.95 + Math.random() * 1.35;
          b.vx += Math.cos(drift) * boost;
          b.vy += Math.sin(drift) * boost - 0.75;
          b.dmg = 0;
          b._petalAng = Math.random() * Math.PI * 2;
          b._petalSpin = (Math.random() - 0.5) * 0.032;
          b._pw = b.w;
          b._ph = b.h;
        });
      }
      const frNorm = dt / 16;
      state.enemyBullets.forEach((b) => {
        if (!b || !b.judgementBolt || state.finalJudgementDangerMs > 0) return;
        b.vy += 0.045 * frNorm;
        b.vx *= 1 - Math.min(0.11, dt * 0.000065);
        b.vy *= 1 - Math.min(0.07, dt * 0.000045);
        b._petalAng = (b._petalAng || 0) + (b._petalSpin || 0) * frNorm * 1.05;
      });
    }
    if (petalWasLife && state.finalJudgementPetalMs <= 0) {
      state.enemyBullets = state.enemyBullets.filter((b) => b && !b.judgementBolt);
      state.finalJudgementPetalMotionDone = false;
      state.finalJudgementDangerMs = 0;
      state.finalJudgementRushHangMs = 0;
    }

    // ---------- 敌弹移动 + 出界 ----------
    const pCxTimeflow = state.player.x + state.player.w / 2;
    const pCyTimeflow = state.player.y + state.player.h / 2;
    const tfRsq = state.timeflowShield ? pickupRadiusPx(state) ** 2 : 0;
    state.enemyBullets.forEach((b) => {
      if (!b || typeof b.x !== "number") return;
      if (b.judgementBolt && b.judgementRush && !b.judgementRushArmed) return;
      let mul = 1;
      if (tfRsq > 0) {
        const bx = b.x + (b.w || 0) / 2;
        const by = b.y + (b.h || 0) / 2;
        if (dist2(pCxTimeflow, pCyTimeflow, bx, by) < tfRsq) mul = TIMEFLOW_SHIELD_MOVE_MUL;
      }
      const tideSpeed = state.tideActive ? (state.tideEnemyBulletSpeedMul || 1) : 1;
      const terrainPrevX = b.x, terrainPrevY = b.y;
      b.x += b.vx * mul * tideSpeed;
      b.y += b.vy * mul * tideSpeed;
      if (b.grassBall) {
        b.grassBallAngle = (b.grassBallAngle || 0) + b.vx * 0.05;
        if (b.x < 0 || b.x + b.w > W) {
          if (b.bounces > 0) {
            b.x = Math.max(0, Math.min(W - b.w, b.x));
            b.vx *= -1;
            b.bounces -= 1;
          } else b.grassConsumed = true;
        }
      }
      if (b.hellLinger) {
        // 炉火飞一段后停在原地烧；无间的判决格直接从"烧"这一相开始
        if (b.hellLingerMs > 0) {
          b.hellLingerMs -= dt;
          if (b.hellLingerMs <= 0) { b.vx = 0; b.vy = 0; }
        } else {
          b.hellBurnMs -= dt;
          if (b.hellBurnMs <= 0) b.grassConsumed = true;
        }
      }
      if (state.grasslandCfg && !b.grassConsumed && interceptGrassBullet(state, b, false, terrainPrevX, terrainPrevY)) b.grassConsumed = true;
    });
    if (state.grasslandCfg) applyGrasslandRewards();
    state.enemyBullets = state.enemyBullets.filter((b) => {
      if (!b || b.grassConsumed || typeof b.x !== "number" || typeof b.y !== "number") return false;
      if (b.judgementBolt && state.finalJudgementPetalMs > 0) {
        return b.y > -200 && b.y < H + 200 && b.x > -140 && b.x < W + 140;
      }
      // 未进安全区：清算弹沿直线飞过屏外再回收（勿用窄边距提前删）
      if (
        b.judgementBolt
        && b.judgementRush
        && b.judgementRushArmed
        && (
          (state.finalJudgementDangerMs || 0) > 0
          || (b.dmg || 0) > 0
        )
      ) {
        const pad = Math.max(220, Math.max(W, H) * 0.55);
        return b.x > -pad && b.x < W + pad && b.y > -pad && b.y < H + pad;
      }
      return b.y > -20 && b.y < H + 20 && b.x > -30 && b.x < W + 30;
    });

    // ---------- 轨道卫星 ↔ 敌方弹幕（轨道卫星II） ----------
    if (state.satelliteBreakBullets && state.satelliteCount > 0 && state.enemyBullets.length > 0) {
      const pCenterX = state.player.x + state.player.w / 2;
      const pCenterY = state.player.y + state.player.h / 2;
      const satStep = (Math.PI * 2) / Math.max(1, state.satelliteCount);
      const satPos = [];
      for (let si = 0; si < state.satelliteCount; si += 1) {
        const ang = state.elapsed * state.satelliteOrbitSpeed + si * satStep;
        satPos.push({
          x: pCenterX + Math.cos(ang) * state.satelliteOrbitRadius,
          y: pCenterY + Math.sin(ang) * state.satelliteOrbitRadius,
        });
      }
      for (let bi = state.enemyBullets.length - 1; bi >= 0; bi -= 1) {
        const eb = state.enemyBullets[bi];
        if (!eb || typeof eb.x !== "number") {
          state.enemyBullets.splice(bi, 1);
          continue;
        }
        if (
          eb.judgementBolt
          && (
            (state.finalJudgementPetalMs || 0) > 0
            || (state.finalJudgementDangerMs || 0) > 0
            || (state.finalJudgementRushHangMs || 0) > 0
            || hasLethalJudgementRushBullets(state)
          )
        ) continue;
        let broken = false;
        for (let si = 0; si < satPos.length; si += 1) {
          if (circleRectHit(satPos[si].x, satPos[si].y, state.satelliteRadius, eb)) {
            broken = true;
            break;
          }
        }
        if (broken) state.enemyBullets.splice(bi, 1);
      }
    }

    // ---------- 玩家子弹 ↔ 敌方弹幕（无坚不摧） ----------
    if (state.bulletBreakBullets && state.bullets.length > 0 && state.enemyBullets.length > 0) {
      for (let bi = state.bullets.length - 1; bi >= 0; bi -= 1) {
        const bullet = state.bullets[bi];
        if (!bullet || typeof bullet.x !== "number") {
          state.bullets.splice(bi, 1);
          continue;
        }
        let clearQuota = bullet.pierceEnemies
          ? 999
          : Math.max(1, (bullet.pierceLeft || 0) + 1);
        for (let ei = state.enemyBullets.length - 1; ei >= 0; ei -= 1) {
          if (clearQuota <= 0) break;
          const enemyBullet = state.enemyBullets[ei];
          if (!enemyBullet || typeof enemyBullet.x !== "number") {
            state.enemyBullets.splice(ei, 1);
            continue;
          }
          if (
            enemyBullet.judgementBolt
            && (
              (state.finalJudgementPetalMs || 0) > 0
              || (state.finalJudgementDangerMs || 0) > 0
              || (state.finalJudgementRushHangMs || 0) > 0
              || hasLethalJudgementRushBullets(state)
            )
          ) continue;
          if (!rectHit(bullet, enemyBullet)) continue;
          state.enemyBullets.splice(ei, 1);
          clearQuota -= 1;
        }
      }
    }

    // ---------- 道具下落 / 磁吸 ----------
    state.items.forEach((it) => {
      if (!it || typeof it.x !== "number") return;
      const px = state.player.x + state.player.w / 2;
      const py = state.player.y + state.player.h / 2;
      // 磁吸期内吸引范围扩大到全屏；否则用 magnetRange 范围圆
      const isMagnet = state.magnetTimerMs > 0 || it.magnetTo;
      const range = state.magnetRange + (state.magnetTimerMs > 0 ? 9999 : 0);
      const d2 = dist2(px, py, it.x + it.w / 2, it.y + it.h / 2);
      if (d2 < range * range || isMagnet) {
        const dx = px - (it.x + it.w / 2);
        const dy = py - (it.y + it.h / 2);
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const speed = 4.5; // 磁吸速度
        it.x += (dx / len) * speed;
        it.y += (dy / len) * speed;
      } else {
        it.y += it.vy;
      }
    });
    // 道具不再按时间自动消失，离开屏幕后才回收
    state.items = state.items.filter(
      (it) => it && typeof it.y === "number" && it.y < H + 30
    );

    // ---------- 玩家子弹 ↔ 敌机 ----------
    for (let bi = state.bullets.length - 1; bi >= 0; bi -= 1) {
      const bullet = state.bullets[bi];
      if (!bullet || typeof bullet.x !== "number") {
        state.bullets.splice(bi, 1);
        continue;
      }
      let removed = false;
      for (let ei = state.enemies.length - 1; ei >= 0; ei -= 1) {
        const enemy = state.enemies[ei];
        if (!enemy || typeof enemy.x !== "number") {
          state.enemies.splice(ei, 1);
          continue;
        }
        if (enemy.untargetable) continue;   // 掘地者潜沙期：子弹穿过去
        if (!rectHit(bullet, enemy)) continue;
        if (enemy.isBoss && enemy.inCutscene) continue;
        const voidCoreLocked = enemy.isVoidCore && state.elapsed < (state.voidCoreUnlockAt || 0);

        // 计算最终伤害：暴击 + 对 Boss/精英 倍率
        let dmg = bullet.dmg * grassDamageTakenMul(enemy, bullet);
        if (state.critRate > 0 && Math.random() < state.critRate) {
          dmg = Math.max(1, Math.floor(dmg * effectiveCritMult(state)));
        }
        if (enemy.isBoss) dmg = Math.max(1, Math.floor(dmg * state.bossDmgMul));
        else if (enemy.isElite) dmg = Math.max(1, Math.floor(dmg * state.eliteDmgMul));
        // Boss 自身的易伤窗口（旱魃过热破绽期 ×1.6），由 bossAi 写入
        if (enemy.damageTakenMul && enemy.damageTakenMul !== 1) {
          dmg = Math.max(1, Math.floor(dmg * enemy.damageTakenMul));
        }
        // 沙漠专属：热寂（敌人越快越吃伤）+ 旱魃之息（沙暴期全伤害加成）+ 风蚀（叠层易伤）
        const desertMul = desertDamageMul() * erosionMul(enemy) * mapDamageMul();
        if (desertMul !== 1) dmg = Math.max(1, Math.floor(dmg * desertMul));
        applyErosionStack(enemy);   // 本次命中后再叠层，所以第一发不吃自己的加成
        if (state.devOneHitKill && !voidCoreLocked && !enemy.inCutscene) {
          dmg = Math.max(dmg, Math.max(enemy.hp, 1));
        }

        const hpBefore = enemy.hp;
        if (!voidCoreLocked) {
          enemy.hp -= dmg;
          if (enemy.isBoss && !enemy.isMirror) notifyBossSegmentLayerBreak(enemy, hpBefore);
        }

        // 吸血：吸血鬼卫星追踪弹单独 1%；其余子弹走 vampRate
        const hpAfterHit = enemy.hp;
        const dealtBullet = voidCoreLocked ? 0 : Math.max(0, hpBefore - hpAfterHit);
        if (bullet.vampireSatelliteHoming && dealtBullet > 0) {
          healPlayer(dealtBullet * 0.01);
        } else if (state.vampRate > 0) {
          healPlayer(dealtBullet * state.vampRate);
        }
        if (
          state.elapsed >= (state.onHitBulletClearCdUntilElapsed || 0)
          && state.onHitBombChance > 0
          && Math.random() < state.onHitBombChance
        ) {
          flashEnemyBulletClearIfAny();
          state.enemyBullets = [];
          state.onHitBulletClearCdUntilElapsed = state.elapsed + ON_HIT_BULLET_CLEAR_CD_MS;
        }
        if (enemy.hp <= 0) {
          if (enemy.isMirror) {
            state.enemies.splice(ei, 1);
            removed = true;
            break;
          }
          if (enemy.isBoss) {
            const bossOut = resolvePrimaryBossDefeat(enemy);
            if (bossOut === "voidPhase2") {
              triggerVoidPhase2(enemy);
            } else if (bossOut === "hiddenVoid") {
              state.kills += 1;
              dropBossLoot(enemy);
              state.enemies.splice(ei, 1);
              spawnHiddenVoidBoss();
            } else {
              state.kills += 1;
              dropBossLoot(enemy);
              state.enemies.splice(ei, 1);
              if (state.endlessMode) {
                performEndlessRoundResetToWave1(true);
              } else {
                state.offerEndlessAfterVoidWin = resolveBossVictory(enemy);
                state.win = true;
                state.gameOver = true;
                if (!state.offerEndlessAfterVoidWin) finishRun();
              }
            }
          } else {
            state.enemies.splice(ei, 1);
            state.kills += 1;
            onEnemyDefeated(enemy);
            dropLootFromEnemy(enemy);
          }
        }

        // 子弹穿透：可穿透敌机时子弹保留；否则命中后即销毁
        if (bullet.pierceEnemies) {
          // 保留，直至飞出屏由 filter 回收
        } else {
          state.bullets.splice(bi, 1);
          removed = true;
        }
        if (removed) break;
      }
    }

    const p = state.player;

    // ---------- 轨道卫星 ↔ 敌机 ----------
    if (state.satelliteCount > 0 && state.satelliteDamagePerSec > 0) {
      const pCenterX = p.x + p.w / 2;
      const pCenterY = p.y + p.h / 2;
      const satStep = (Math.PI * 2) / Math.max(1, state.satelliteCount);
      for (let ei = state.enemies.length - 1; ei >= 0; ei -= 1) {
        const enemy = state.enemies[ei];
        if (!enemy || typeof enemy.x !== "number") {
          state.enemies.splice(ei, 1);
          continue;
        }
        let overlapCount = 0;
        for (let si = 0; si < state.satelliteCount; si += 1) {
          const ang = state.elapsed * state.satelliteOrbitSpeed + si * satStep;
          const sx = pCenterX + Math.cos(ang) * state.satelliteOrbitRadius;
          const sy = pCenterY + Math.sin(ang) * state.satelliteOrbitRadius;
          if (circleRectHit(sx, sy, state.satelliteRadius, enemy)) overlapCount += 1;
        }
        if (overlapCount <= 0) continue;
        if (enemy.isBoss && enemy.inCutscene) continue;
        const voidCoreLocked = enemy.isVoidCore && state.elapsed < (state.voidCoreUnlockAt || 0);
        if (voidCoreLocked) continue;
        let dmg = overlapCount * state.satelliteDamagePerSec * (dt / 1000) * mapDamageMul();
        if (enemy.damageTakenMul && enemy.damageTakenMul !== 1) dmg *= enemy.damageTakenMul;
        if (enemy.isBoss) dmg *= state.bossDmgMul;
        else if (enemy.isElite) dmg *= state.eliteDmgMul;
        if (state.devOneHitKill && !enemy.inCutscene) {
          dmg = Math.max(dmg, Math.max(enemy.hp, 1));
        }
        const hpBeforeSat = enemy.hp;
        enemy.hp -= dmg;
        if (enemy.isBoss && !enemy.isMirror) notifyBossSegmentLayerBreak(enemy, hpBeforeSat);
        // 吸血鬼：轨道卫星碰撞伤害额外 1% 转化为吸血（与主炮 vampRate 独立叠加）
        if (state.characterId === "vampire") {
          const dealtSat = Math.max(0, hpBeforeSat - enemy.hp);
          if (dealtSat > 0) healPlayer(dealtSat * 0.01);
        }
        if (enemy.hp <= 0) {
          if (enemy.isMirror) {
            state.enemies.splice(ei, 1);
            continue;
          }
          if (enemy.isBoss) {
            const bossOut = resolvePrimaryBossDefeat(enemy);
            if (bossOut === "voidPhase2") {
              triggerVoidPhase2(enemy);
              continue;
            }
            if (bossOut === "hiddenVoid") {
              state.kills += 1;
              dropBossLoot(enemy);
              state.enemies.splice(ei, 1);
              spawnHiddenVoidBoss();
              continue;
            }
            state.kills += 1;
            dropBossLoot(enemy);
            state.enemies.splice(ei, 1);
            if (state.endlessMode) {
              performEndlessRoundResetToWave1(true);
            } else {
              state.offerEndlessAfterVoidWin = resolveBossVictory(enemy);
              state.win = true;
              state.gameOver = true;
              if (!state.offerEndlessAfterVoidWin) finishRun();
            }
            return;
          }
          state.enemies.splice(ei, 1);
          state.kills += 1;
          onEnemyDefeated(enemy);
          dropLootFromEnemy(enemy);
        }
      }
    }

    // ---------- 玩家 ↔ 道具 ----------
    for (let i = state.items.length - 1; i >= 0; i -= 1) {
      const it = state.items[i];
      if (!it || typeof it.x !== "number") {
        state.items.splice(i, 1);
        continue;
      }
      if (rectHit(it, p)) {
        consumeItem(it);
        state.items.splice(i, 1);
      }
    }

    // ---------- 玩家 ↔ 敌弹 ----------
    for (let i = state.enemyBullets.length - 1; i >= 0; i -= 1) {
      const b = state.enemyBullets[i];
      if (!b || typeof b.x !== "number") {
        state.enemyBullets.splice(i, 1);
        continue;
      }
      if (!rectHit(b, p)) continue;
      if (b.judgementBolt && state.finalJudgementPetalMs > 0) continue;
      if (b.judgementBolt && b.judgementRush && !b.judgementRushArmed) continue;
      state.enemyBullets.splice(i, 1);

      // 暂时无敌：直接消弹不扣血；DEV 无敌同理
      if (state.invincibleMs > 0 || state.godMode) continue;
      // 「无罪」：业火满层时吃掉一次伤害并清空全部层数
      if ((b.dmg || 0) > 0 && tryEmberGuard()) continue;

      const rawBdmg = b.dmg || 0;
      let incomingBulletDmg =
        rawBdmg <= 0 ? 0 : Math.max(1, Math.round(rawBdmg * state.curseEnemyDmgMul));
      if (state.endlessMode && incomingBulletDmg > 0) {
        incomingBulletDmg = Math.max(
          1,
          Math.round(incomingBulletDmg * (state.endlessEnemyDmgMulCached || 1)),
        );
      }

      // 无伤弹（仅占位/演出）不参与扣护盾与生命
      if (incomingBulletDmg <= 0) continue;

      // 护盾优先抵挡（护盾承受双倍伤害）；护盾不足以吃下整发时，剩余伤害穿透到生命值，
      // 避免“只要护盾还剩 1 点就能完全免疫一发”导致护盾回复百分比几乎不影响强度
      if (state.shieldHp > 0) {
        const shieldMul = Math.max(1, state.shieldDamageMul || 1);
        const shieldCost = incomingBulletDmg * shieldMul;
        state.shieldFlashMs = 240;
        if (state.shieldHp >= shieldCost) {
          state.shieldHp -= shieldCost;
          continue;
        }
        // 残余护盾按承伤倍率折算成能挡下的伤害量，其余穿透
        incomingBulletDmg = Math.max(0, incomingBulletDmg - state.shieldHp / shieldMul);
        state.shieldHp = 0;
        if (incomingBulletDmg <= 0) continue;
      }
      state.hp -= incomingBulletDmg;
      if (state.hp <= 0) {
        state.hp = 0;
        state.gameOver = true;
        finishRun();
        return;
      }
    }

    // ---------- 玩家 ↔ 敌机（撞机） ----------
    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = state.enemies[i];
      if (!enemy || typeof enemy.x !== "number") {
        state.enemies.splice(i, 1);
        continue;
      }
      if (enemy.untargetable) continue;   // 掘地者潜沙期：不参与撞机
      if (!rectHit(enemy, p)) continue;
      if (enemy.isBoss && enemy.inCutscene) continue;
      if (enemy.isVoidCore && state.elapsed < (state.voidCoreUnlockAt || 0)) continue;
      const baseContactDmg = enemy.isBoss ? 6000 : (enemy.isElite ? 4000 : 2000);
      let incomingContactDmg = Math.max(1, Math.round(baseContactDmg * state.curseEnemyDmgMul));
      if (state.endlessMode) {
        incomingContactDmg = Math.max(
          1,
          Math.round(incomingContactDmg * (state.endlessEnemyDmgMulCached || 1)),
        );
      }

      // 反伤：按“实际受到的撞击伤害”比例反弹（不击杀 Boss 但能扣血）
      // 无敌道具生效期间不结算反伤——否则吃一个 INV 贴脸 Boss 就是每帧零代价输出
      if (state.thornReflectRate > 0 && state.invincibleMs <= 0) {
        let reflect = Math.max(1, Math.round(incomingContactDmg * state.thornReflectRate * mapDamageMul()));
        if (
          state.devOneHitKill
          && !(enemy.isVoidCore && state.elapsed < (state.voidCoreUnlockAt || 0))
          && !enemy.inCutscene
        ) {
          reflect = Math.max(reflect, Math.max(enemy.hp, 1));
        }
        const hpThorn = enemy.hp;
        enemy.hp -= reflect;
        if (enemy.isBoss && !enemy.isMirror) notifyBossSegmentLayerBreak(enemy, hpThorn);
        if (enemy.hp <= 0 && enemy.isBoss) {
          const bossOut = resolvePrimaryBossDefeat(enemy);
          if (bossOut === "voidPhase2") {
            triggerVoidPhase2(enemy);
            continue;
          }
          if (bossOut === "hiddenVoid") {
            state.kills += 1;
            dropBossLoot(enemy);
            state.enemies.splice(i, 1);
            spawnHiddenVoidBoss();
            continue;
          }
          state.kills += 1;
          dropBossLoot(enemy);
          state.enemies.splice(i, 1);
          if (state.endlessMode) {
            performEndlessRoundResetToWave1(true);
          } else {
            state.offerEndlessAfterVoidWin = resolveBossVictory(enemy);
            state.win = true;
            state.gameOver = true;
            if (!state.offerEndlessAfterVoidWin) finishRun();
          }
          return;
        }
        if (enemy.hp <= 0 && !enemy.isBoss) {
          state.enemies.splice(i, 1);
          state.kills += 1;
          onEnemyDefeated(enemy);
          dropLootFromEnemy(enemy);
          continue;
        }
      }

      // 暂时无敌：穿过敌机不扣血（普通敌机不消失，避免一闪过去清空）；DEV 无敌同理
      if (state.invincibleMs > 0 || state.godMode) continue;

      // 业火护：撞机是全场最疼的一下（2000），有业火时优先抵掉它
      if (tryEmberGuard()) continue;

      // 护盾抵挡撞击（护盾承受双倍伤害）；护盾不足以吃下整次撞击时，剩余伤害穿透到生命值
      if (state.shieldHp > 0) {
        const shieldMul = Math.max(1, state.shieldDamageMul || 1);
        const shieldCost = incomingContactDmg * shieldMul;
        state.shieldFlashMs = 240;
        if (state.shieldHp >= shieldCost) {
          state.shieldHp -= shieldCost;
          if (!enemy.isBoss) state.enemies.splice(i, 1);
          continue;
        }
        incomingContactDmg = Math.max(0, incomingContactDmg - state.shieldHp / shieldMul);
        state.shieldHp = 0;
        if (incomingContactDmg <= 0) {
          if (!enemy.isBoss) state.enemies.splice(i, 1);
          continue;
        }
      }

      if (!enemy.isBoss) state.enemies.splice(i, 1);
      state.hp -= incomingContactDmg;
      if (state.hp <= 0) {
        state.hp = 0;
        state.gameOver = true;
        finishRun();
        return;
      }
    }
  }

  // ==========================================================================
  //  结算（仅触发一次：写入金币和最佳记录）
  // ==========================================================================

  function finishRun() {
    if (runEconomySettled) return;
    runEconomySettled = true;
    storage.addCoins(state.coinsEarned);
    storage.recordRun(state.kills, state.level);
  }

  // ==========================================================================
  //  绘制（按 z-order 排：背景 → 道具 → 玩家 → 子弹 → 敌机 → 闪光 → HUD → 弹窗）
  // ==========================================================================

  /** 背景：纯色 + 70 个滚动小星点 */
  /** 主题里的某个可选颜色字段：两档之间插值；任一档没写就退回 fallback */
  function lerpThemeColor(key, fallback) {
    const a = state.themeFrom[key];
    const b = state.themeTo[key];
    if (!a && !b) return fallback;
    return lerpHex(a || b, b || a, state.themeBlendT);
  }

  /**
   * 俯视沙海：游戏是自上而下的俯视角，所以**不画地平线也不画侧视沙丘剪影**。
   * 地面质感只有一层：随时间向下漂移的风成沙纹，做出"机体在沙海上飞行"的感觉。
   */
  function drawSandSea(ctx, rippleColor) {
    const t = state.elapsed;

    // ---- 风成沙纹（细、稍快，是质感不是花纹，所以压低透明度）----
    const STEP = 26;
    const drift = (t * 0.03) % STEP;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = rippleColor;
    ctx.lineWidth = 1.5;
    for (let k = -1; k * STEP < H + STEP; k += 1) {
      const baseY = k * STEP + drift;
      const phase = k * 0.9;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 22) {
        const y = baseY
          + Math.sin(x * 0.013 + phase) * 5
          + Math.sin(x * 0.031 + phase * 1.7) * 2.2;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBackground(ctx) {
    if (state.mapParticle === "grassland") { drawGrasslandBackground(ctx, state, W, H); return; }
    if (state.mapParticle === "hell") { drawHellBackground(ctx, state, W, H); return; }
    if (state.mapParticle === "ocean") {
      drawOceanBackground(ctx, state, W, H);
      return;
    }
    const bg = lerpHex(state.themeFrom.bg, state.themeTo.bg, state.themeBlendT);
    const star = lerpHex(state.themeFrom.star, state.themeTo.star, state.themeBlendT);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 俯视沙海的地面质感画在颗粒之下（颗粒是被风吹起、掠过镜头的沙，应该压在最上层）
    if (state.mapSandSea) drawSandSea(ctx, lerpThemeColor("ripple", star));

    ctx.fillStyle = star;
    if (state.mapParticle === "sand") {
      // 沙漠：横向吹拂的沙粒，粗细与速度分三档，做出"风里的尘"的层次
      for (let i = 0; i < 70; i += 1) {
        const lane = i % 3;
        const spd = 0.11 + lane * 0.07;
        const x = (i * 37 + state.elapsed * spd) % W;
        const y = (i * 67 + state.elapsed * 0.02) % H;
        ctx.fillRect(x, y, 2 + lane, 1);
      }
    } else {
      // 星空：纵向下坠的星点
      for (let i = 0; i < 70; i += 1) {
        const x = (i * 37 + state.elapsed * 0.02) % W;
        const y = (i * 67 + state.elapsed * 0.1) % H;
        ctx.fillRect(x, y, 2, 2);
      }
    }

    if (state.voidDarknessAlpha > 0) {
      drawVisionVeil(ctx, "0, 0, 0", Math.min(0.9, state.voidDarknessAlpha), 92);
    }
  }

  /**
   * 视野受限幕：整屏铺一层色幕，再用 destination-out 在玩家周围挖一个带羽化的洞。
   * 虚空 Boss 与沙暴共用，只是颜色和半径不同。
   * @param {string} rgb    "r, g, b" 三元组
   * @param {number} alpha  幕的浓度
   * @param {number} radius 可视半径（px）
   */
  function drawVisionVeil(ctx, rgb, alpha, radius) {
    const a = Math.max(0, Math.min(1, alpha));
    if (a <= 0 || radius <= 0) return;
    const pl = state.player;
    const cx = pl.x + pl.w / 2;
    const cy = pl.y + pl.h / 2;
    ctx.save();
    ctx.fillStyle = `rgba(${rgb}, ${a})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "destination-out";
    // 中心全透明 → 边缘不挖，形成羽化的可视圈
    const g = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 沙暴期"看不清"的强度 0~1（随沙幕浓度缓入缓出）。
   * 视野受限不再用整块暗幕挖洞——那样又糙又挡视线；改为按距离降低**敌人**的透明度，
   * 远处的敌人在风沙里淡到几乎看不见，近处照常。敌弹始终全不透明，否则不公平。
   */
  function sandstormFogT() {
    const cfg = state.sandstormCfg;
    if (!cfg || !cfg.maxAlpha) return 0;
    return Math.max(0, Math.min(1, state.sandstormAlpha / cfg.maxAlpha));
  }

  /** 单个敌人在风沙里的透明度：近处 1，远处衰减到 SANDSTORM_MIN_ENEMY_ALPHA */
  function sandstormEnemyAlpha(enemy) {
    if (state.stormClearSight) return 1;   // 沙镜 / 沙暴之眼
    const t = sandstormFogT();
    if (t <= 0) return 1;
    const cfg = state.sandstormCfg;
    const near = cfg.visionR || 150;
    const far = near * 2.6;
    const pl = state.player;
    const dx = (enemy.x + enemy.w / 2) - (pl.x + pl.w / 2);
    const dy = (enemy.y + enemy.h / 2) - (pl.y + pl.h / 2);
    const d = Math.hypot(dx, dy);
    const k = Math.max(0, Math.min(1, (d - near) / Math.max(1, far - near)));
    return 1 - k * (1 - SANDSTORM_MIN_ENEMY_ALPHA) * t;
  }

  /** 旱魃过热破绽：Boss 周围一圈脉动光环，明确告诉玩家"现在可以打" */
  function drawBossOverheat(ctx) {
    for (let i = 0; i < state.enemies.length; i += 1) {
      const e = state.enemies[i];
      if (!e || !e.isBoss || !e.hanbaOverheat) continue;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      const pulse = 0.5 + 0.5 * Math.sin(state.elapsed * 0.02);
      const r = Math.max(e.w, e.h) * (0.66 + pulse * 0.16);
      ctx.save();
      ctx.globalAlpha = 0.28 + pulse * 0.34;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 3 + pulse * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.18 + pulse * 0.2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 旱魃的场地招式预警（画在敌人之下，避免盖住弹幕）：
   * 流沙区 / 裂地矛升起位置 / 尘暴冲撞路径 / 旋沙中心。
   */
  function drawHanbaTelegraphs(ctx) {
    const pulse = 0.55 + 0.45 * Math.sin(state.elapsed * 0.014);

    // 流沙区：预警期虚线圈，生效期实心暗斑
    const warn = state.quicksandWarnZones;
    const live = state.quicksandZones;
    if (warn) {
      ctx.save();
      ctx.globalAlpha = 0.35 + pulse * 0.35;
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      warn.forEach((z) => {
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }
    if (live) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = "#3b2a10";
      live.forEach((z) => {
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 2;
      live.forEach((z) => {
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }

    // 裂地矛：屏幕下缘将要升起的位置
    const sp = state.hanbaSpikeWarn;
    if (sp) {
      const step = W / (sp.n - 1);
      ctx.save();
      ctx.globalAlpha = 0.3 + pulse * 0.45;
      ctx.fillStyle = "#f59e0b";
      for (let i = 0; i < sp.n; i += 1) {
        if (i === sp.gap) continue;
        ctx.fillRect(i * step - 6, H - 6, 12, 6);
      }
      ctx.restore();
    }

    // 尘暴冲撞：路径线
    const dw = state.hanbaDashWarn;
    if (dw) {
      ctx.save();
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(dw.from.x, dw.from.y);
      ctx.lineTo(dw.to.x, dw.to.y);
      ctx.stroke();
      ctx.restore();
    }

    // 旋沙：中心向内的吸引提示
    const vx = state.hanbaVortexAt;
    if (vx) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2;
      for (let r = 1; r <= 3; r += 1) {
        const rad = 40 * r - ((state.elapsed * 0.06) % 40);
        if (rad <= 4) continue;
        ctx.beginPath();
        ctx.arc(vx.x, vx.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** 沙暴：极淡的暖色尘雾 + 预警期的边缘泛黄脉动（画在敌人与玩家之上、HUD 之下） */
  function drawSandstormVeil(ctx) {
    const cfg = state.sandstormCfg;
    if (!cfg) return;
    const t = sandstormFogT();
    if (t > 0) {
      // 只是一层很淡的尘雾，交代"空气里有沙"，不承担遮挡功能
      ctx.save();
      ctx.fillStyle = `rgba(${cfg.veilRgb || "120, 82, 28"}, ${(0.16 * t).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    const pulse = state.sandstormWarnPulse || 0;
    if (pulse > 0) {
      // 预警：四边内收的黄色辉光，提示玩家调整站位
      const band = 46;
      ctx.save();
      ctx.globalAlpha = 0.18 + pulse * 0.3;
      const mk = (x0, y0, x1, y1) => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, "rgba(245, 158, 11, 1)");
        g.addColorStop(1, "rgba(245, 158, 11, 0)");
        return g;
      };
      ctx.fillStyle = mk(0, 0, 0, band);       ctx.fillRect(0, 0, W, band);
      ctx.fillStyle = mk(0, H, 0, H - band);   ctx.fillRect(0, H - band, W, band);
      ctx.fillStyle = mk(0, 0, band, 0);       ctx.fillRect(0, 0, band, H);
      ctx.fillStyle = mk(W, 0, W - band, 0);   ctx.fillRect(W - band, 0, band, H);
      ctx.restore();
    }
  }

  function drawVoidTelegraphs(ctx) {
    /** smoothstep：用于出场 0→1 */
    function introEase01(uRaw) {
      const u = Math.max(0, Math.min(1, uRaw));
      return u * u * (3 - 2 * u);
    }
    if (state.voidGravityTraps && state.voidGravityTraps.length > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(state.elapsed * 0.006);
      state.voidGravityTraps.forEach((g) => {
        const rVis = g.r != null ? g.r : 52;
        const rOut = g.influenceR != null ? g.influenceR : rVis * 1.55;
        const dur = typeof g.introDurMs === "number" ? g.introDurMs : 900;
        const introRem = Math.max(0, g.introMsRemain || 0);
        const appearRaw = introRem > 0 ? 1 - introRem / Math.max(1, dur) : 1;
        const appear = introEase01(appearRaw);
        const outroDur = typeof g.outroDurMs === "number" ? g.outroDurMs : 820;
        const outroRem = Math.max(0, g.outroMsRemain || 0);
        const vanishRaw = outroRem > 0 ? 1 - outroRem / Math.max(1, outroDur) : 0;
        const vanish = introEase01(vanishRaw);
        const exitMul = 1 - vanish;

        ctx.save();

        ctx.globalCompositeOperation = "lighter";

        if ((appear < 0.98 && introRem > 0) || (outroRem > 0 && exitMul > 0.04)) {
          ctx.globalAlpha = 0.72 * pulse * (introRem > 0 ? appear * 1.08 : exitMul * 1.02);
          ctx.strokeStyle = "rgba(237, 233, 254, 0.92)";
          ctx.lineWidth = 2;
          ctx.setLineDash([14, 10]);
          ctx.beginPath();
          const spiral = introRem > 0
            ? state.elapsed * 0.002
            : Math.PI * 2 + state.elapsed * -0.0032 * (1 + vanish);
          ctx.arc(g.x, g.y, rOut * (introRem > 0 ? 0.55 + appear * 0.48 : 0.5 + exitMul * 0.52), spiral, Math.PI * 2 + spiral);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        const radScale = Math.max(0.1, appear) * Math.max(0.06, exitMul);
        const rFill = rOut * 1.08 * radScale;
        const grd = ctx.createRadialGradient(g.x, g.y, rVis * 0.09 * radScale, g.x, g.y, rFill);
        const baseA = introEase01(Math.min(1, appear * 1.15)) * exitMul;
        grd.addColorStop(0, `rgba(196, 181, 253, ${(0.22 + pulse * 0.12) * baseA})`);
        grd.addColorStop(0.45, `rgba(147, 51, 234, ${(0.12 + pulse * 0.08) * baseA})`);
        grd.addColorStop(1, "rgba(15, 23, 42, 0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(g.x, g.y, rFill, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(250, 250, 255, ${(0.35 + pulse * 0.2) * appear * exitMul})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 7]);
        ctx.beginPath();
        ctx.arc(g.x, g.y, (rVis + 4 + pulse * 6) * radScale, 0 + state.elapsed * 0.0018, Math.PI * 2 + state.elapsed * 0.0018);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(216, 180, 254, ${(0.55 + pulse * 0.2) * appear * exitMul})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y, rOut * radScale, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 255, 255, ${(0.5 + pulse * 0.35) * appear * exitMul})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, Math.max(3, rVis * 0.06) * radScale, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      });
    }
    if (state.voidSafeZone) {
      const z = state.voidSafeZone;
      const blink = Math.floor(state.elapsed / 100) % 2 === 0;
      ctx.strokeStyle = blink ? "rgba(34, 197, 94, 0.95)" : "rgba(34, 197, 94, 0.45)";
      ctx.lineWidth = 4;
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }
  }

  /** 玩家机体与无敌反馈，贴图关闭时使用代码外观。 */
  function drawPlayer(ctx) {
    const p = state.player;

    // 暂时无敌：金色光晕环 + 30Hz 闪烁
    if (state.invincibleMs > 0) {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const alpha = 0.35 + Math.sin(state.elapsed * 0.03) * 0.2;
      ctx.fillStyle = `rgba(253, 224, 71, ${Math.max(0, Math.min(1, alpha))})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();
    }

    if (drawCharacterTexture(ctx, state.characterId, p.x, p.y, p.w, p.h, battleTexturesEnabled(), "battle")) {
      // 绘制范围只影响外观，沿用原有碰撞盒。
    } else if (state.characterId === "windrunner") {
      drawWindrunnerShape(ctx, p.x - p.w * 0.3, p.y - p.h * 0.3, p.w * 1.6, p.h * 1.6, state);
    } else if (state.characterId === "tidecaller") {
      drawTidecallerShape(ctx, p.x - p.w * 0.3, p.y - p.h * 0.3, p.w * 1.6, p.h * 1.6, state);
    } else if (state.characterId === "prism") {
      const stripes = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2, p.y);
      ctx.lineTo(p.x, p.y + p.h);
      ctx.lineTo(p.x + p.w, p.y + p.h);
      ctx.closePath();
      ctx.clip();
      for (let si = 0; si < stripes.length; si += 1) {
        const y0 = p.y + (p.h * si) / stripes.length;
        const sh = p.h / stripes.length + 0.8;
        ctx.fillStyle = stripes[si];
        ctx.fillRect(p.x - 2, y0, p.w + 4, sh);
      }
      ctx.restore();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2, p.y);
      ctx.lineTo(p.x, p.y + p.h);
      ctx.lineTo(p.x + p.w, p.y + p.h);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2, p.y);     // 顶点
      ctx.lineTo(p.x, p.y + p.h);          // 左下
      ctx.lineTo(p.x + p.w, p.y + p.h);    // 右下
      ctx.closePath();
      ctx.fill();
    }
  }

  /** 地图专属生物外观与星空机体，共用血条、碰撞状态及战斗预警。 */
  function drawEnemies(ctx) {
    // 精英贴图仅视觉缩放（碰撞盒见 enemies.js createElite 的 w/h）；想调大小改此值
    const ELITE_TEX_SCALE = 3.5;
    state.enemies.forEach((enemy) => {
      if (!enemy || typeof enemy.x !== "number") return;
      // 沙暴：远处敌人在风沙里淡下去（Boss 不参与，否则打 Boss 会变成猜位置）
      const fogAlpha = enemy.isBoss ? 1 : sandstormEnemyAlpha(enemy);
      const foggy = fogAlpha < 1;
      if (foggy) {
        ctx.save();
        ctx.globalAlpha = fogAlpha;
      }
      ctx.fillStyle = enemy.color;
      const cx = enemy.x + enemy.w / 2;
      const cy = enemy.y + enemy.h / 2;

      const hellDrawn = drawHellBoss(ctx, enemy, state) || drawHellEnemy(ctx, enemy, state);
      const grassDrawn = hellDrawn
        || drawGrasslandTexture(ctx, enemy, state, battleTexturesEnabled()) || drawGrasslandEnemy(ctx, enemy, state);
      const desertDrawn = !grassDrawn && drawDesertEnemyVisual(ctx, enemy, state, battleTexturesEnabled());
      const textureDrawn = !grassDrawn && !desertDrawn && drawEnemyTexture(ctx, enemy, state, battleTexturesEnabled());
      const oceanDrawn = !grassDrawn && !desertDrawn && !textureDrawn && drawOceanEnemy(ctx, enemy, state);
      if (grassDrawn || desertDrawn || textureDrawn || oceanDrawn) {
        // 专属轮廓已绘制，继续使用下方共用血条。
      } else if (enemy.isBoss) {
        if (enemy.isVoidCore) {
          const scl = Math.max(
            0.2,
            Math.min(1, enemy.coreIntroScale != null ? enemy.coreIntroScale : 1)
          );
          const pr = Math.min(enemy.w, enemy.h) * 0.48 * scl;
          const pulse = 0.62 + 0.38 * Math.sin(state.elapsed * 0.0085);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(scl, scl);
          ctx.translate(-cx, -cy);
          const g = ctx.createRadialGradient(
            cx - pr * 0.28,
            cy - pr * 0.28,
            pr * 0.08,
            cx,
            cy,
            pr * 1.08
          );
          g.addColorStop(0, `rgba(250, 232, 255, ${0.88 * pulse})`);
          g.addColorStop(0.42, "#7c3aed");
          g.addColorStop(0.78, "#5b21b6");
          g.addColorStop(1, "#1e1b4b");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, pr, 0, Math.PI * 2);
          ctx.fill();
          if (enemy.voidRedWarn && Math.floor(state.elapsed / 70) % 2 === 0) {
            ctx.strokeStyle = "rgba(251, 113, 133, 0.92)";
            ctx.lineWidth = 3.5;
          } else {
            ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * pulse})`;
            ctx.lineWidth = 2.5;
          }
          ctx.beginPath();
          ctx.arc(cx, cy, pr, 0, Math.PI * 2);
          ctx.stroke();
          if ((enemy.hpBarBreakFlashMs || 0) > 0) {
            const u = enemy.hpBarBreakFlashMs / BOSS_LAYER_BREAK_FLASH_MS;
            ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.min(0.75, u * u) * 0.72})`;
            ctx.beginPath();
            ctx.arc(cx, cy, pr * 1.02, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else {
          ctx.save();
          if (enemy.voidShellCutscene && typeof enemy.cutsceneAlpha === "number") {
            ctx.globalAlpha *= Math.max(0, Math.min(1, enemy.cutsceneAlpha));
          }
          if (enemy.preDiveWarn) {
            const blinkOn = Math.floor(state.elapsed / 90) % 2 === 0;
            ctx.fillStyle = blinkOn ? "#fef08a" : enemy.color;
          } else if (enemy.voidRedWarn) {
            const blinkOn = Math.floor(state.elapsed / 70) % 2 === 0;
            ctx.fillStyle = blinkOn ? "#ef4444" : enemy.color;
          }
          // Boss：五边形
          const r = Math.min(enemy.w, enemy.h) * 0.48;
          const bossSpin = enemy.spinAngle || 0;
          ctx.beginPath();
          for (let i = 0; i < 5; i += 1) {
            const a = -Math.PI / 2 + bossSpin + (Math.PI * 2 * i) / 5;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();

          // 打掉一整层血条：Boss 躯干强闪（与 ai 硬直同期）
          if ((enemy.hpBarBreakFlashMs || 0) > 0) {
            const u = enemy.hpBarBreakFlashMs / BOSS_LAYER_BREAK_FLASH_MS;
            const flashA = 0.22 + Math.min(0.78, u * u) * 0.78;
            ctx.fillStyle = `rgba(255,255,255,${flashA})`;
            ctx.beginPath();
            for (let j = 0; j < 5; j += 1) {
              const aa = -Math.PI / 2 + bossSpin + (Math.PI * 2 * j) / 5;
              const ox = cx + Math.cos(aa) * r;
              const oy = cy + Math.sin(aa) * r;
              if (j === 0) ctx.moveTo(ox, oy);
              else ctx.lineTo(ox, oy);
            }
            ctx.closePath();
            ctx.fill();
          }

          // 激光预警线
          if (enemy.bossLaserWarn) {
            ctx.save();
            ctx.strokeStyle = "rgba(248, 113, 113, 0.55)";
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 6]);
            const ang = enemy.bossLaserAng || Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(cx, enemy.y + enemy.h);
            ctx.lineTo(cx + Math.cos(ang) * 1200, enemy.y + enemy.h + Math.sin(ang) * 1200);
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }
      } else if (enemy.isMirror) {
        const owner = enemy.ownerBossRef;
        if (owner && owner.voidRedWarn) {
          const blinkOn = Math.floor(state.elapsed / 70) % 2 === 0;
          ctx.fillStyle = blinkOn ? "#ef4444" : enemy.color;
        }
        const mdur = typeof enemy.mirrorIntroDurMs === "number" ? enemy.mirrorIntroDurMs : 760;
        const mRem = enemy.mirrorIntroMsRemain || 0;
        const uAppear = mRem > 0 ? Math.max(0, Math.min(1, 1 - mRem / Math.max(1, mdur))) : 1;
        const scl = uAppear * uAppear * (3 - 2 * uAppear);
        const alphaMul = mRem > 0 ? 0.22 + scl * 0.78 : 1;
        ctx.save();
        ctx.globalAlpha *= alphaMul;
        ctx.translate(cx, cy);
        ctx.scale(Math.max(0.12, scl), Math.max(0.12, scl));
        ctx.translate(-cx, -cy);
        // 虚空分身：与 Boss 同源五边形自转
        const r = Math.min(enemy.w, enemy.h) * 0.48;
        const bossSpin = enemy.spinAngle || 0;
        ctx.beginPath();
        for (let i = 0; i < 5; i += 1) {
          const a = -Math.PI / 2 + bossSpin + (Math.PI * 2 * i) / 5;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (enemy.isElite) {
        ctx.beginPath();
        ctx.moveTo(cx, enemy.y);
        ctx.lineTo(enemy.x + enemy.w, cy);
        ctx.lineTo(cx, enemy.y + enemy.h);
        ctx.lineTo(enemy.x, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y);
        ctx.lineTo(enemy.x + enemy.w, enemy.y);
        ctx.lineTo(cx, enemy.y + enemy.h);
        ctx.closePath();
        ctx.fill();
      }

      // 血条
      ctx.save();
      let mirrorHpFade = 1;
      if (enemy.isMirror && (enemy.mirrorIntroMsRemain || 0) > 0 && enemy.mirrorIntroDurMs) {
        const z = Math.max(0, Math.min(1, 1 - enemy.mirrorIntroMsRemain / enemy.mirrorIntroDurMs));
        mirrorHpFade = 0.42 + z * z * (3 - 2 * z) * 0.58;
      }
      ctx.globalAlpha *= mirrorHpFade;
      const hideVoidShellHpBar = enemy.isBoss && enemy.bossVariant === "void" && enemy.phase2Triggered;
      const shouldDrawBossHpBar = enemy.isBoss && !hideVoidShellHpBar;
      if (
        shouldDrawBossHpBar
        && enemy.bossHpBarLayers === BOSS_HP_BAR_LAYER_COUNT
        && enemy.bossHpBarSegSize > 0
        && enemy.maxHp > 0
      ) {
        const seg = enemy.bossHpBarSegSize;
        const bx = enemy.x;
        const bw = enemy.w;
        const barH = 6;
        const yBar = enemy.y - (grassDrawn || desertDrawn || textureDrawn ? 24 : 10);
        ctx.fillStyle = "rgba(2, 6, 23, 0.94)";
        ctx.fillRect(bx - 1, yBar - 1, bw + 2, barH + 2);
        ctx.strokeStyle = "rgba(148,163,184,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - 1, yBar - 1, bw + 2, barH + 2);
        /** tier s：[s*seg, (s+1)*seg]，自左对齐同框重叠 draw；s 越大叠在上层先变窄露出右侧下层 */
        const hpEff = Math.max(0, Math.min(enemy.hp, enemy.maxHp));
        for (let s = 0; s < BOSS_HP_BAR_LAYER_COUNT; s += 1) {
          const avail = hpEff <= s * seg ? 0 : Math.min(seg, hpEff - s * seg);
          const wFill = bw * (avail / seg);
          if (wFill <= 0) continue;
          ctx.fillStyle = BOSS_HP_BAR_COLORS[s] || "#94a3b8";
          ctx.fillRect(bx, yBar, wFill, barH);
        }
      } else if (shouldDrawBossHpBar) {
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(enemy.x, enemy.y - 6, enemy.w, 3);
        ctx.fillStyle = "#dc2626";
        ctx.fillRect(enemy.x, enemy.y - 6, enemy.w * ratio, 3);
      } else {
        // 普通敌人（grunt）血条位置单独偏移：
        // enemy.y - enemy.h 表示移动到敌人顶部之上 1 个“原始敌人高度”。
        // 想往下挪：改成 enemy.y - enemy.h + N（N 越大越靠下）
        // 想往上挪：改成 enemy.y - enemy.h - N（N 越大越靠上）
        // 精英血条：对齐「贴图视觉顶部」略上一点（勿再用 enemy.h*scale 顶到屏外）
        let hpBarY = grassDrawn || desertDrawn || textureDrawn ? enemy.y - Math.max(5, enemy.h * 0.12 + 3) : enemy.y;
        if (textureDrawn && enemy.type === "grunt") {
          hpBarY = enemy.y - enemy.h + 20;
        } else if (textureDrawn && enemy.type === "elite") {
          const eliteVisTop = cy - (enemy.h * ELITE_TEX_SCALE) / 2;
          hpBarY = eliteVisTop + 60;
        }
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(enemy.x, hpBarY, enemy.w, 3);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(enemy.x, hpBarY, enemy.w * ratio, 3);
      }
      ctx.restore();
      if (foggy) ctx.restore();
    });
  }

  /** 子弹：玩家弹黄色 / 敌弹粉色 */
  function drawBullets(ctx) {
    // 轨道卫星
    if (state.satelliteCount > 0) {
      ensureSatelliteTextures();
      const p = state.player;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const step = (Math.PI * 2) / Math.max(1, state.satelliteCount);
      for (let i = 0; i < state.satelliteCount; i += 1) {
        const ang = state.elapsed * state.satelliteOrbitSpeed + i * step;
        const sx = cx + Math.cos(ang) * state.satelliteOrbitRadius;
        const sy = cy + Math.sin(ang) * state.satelliteOrbitRadius;
        if (state.characterId === "vampire" && battleTexturesEnabled() && vampireSatelliteImg && vampireSatelliteImgReady) {
          const size = Math.max(18, state.satelliteRadius * 3.2);
          ctx.drawImage(vampireSatelliteImg, sx - size / 2, sy - size / 2, size, size);
        } else if (battleTexturesEnabled() && orbitSatelliteImg && orbitSatelliteImgReady) {
          const size = Math.max(40, state.satelliteRadius * 10);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ang + Math.PI / 2);
          ctx.drawImage(orbitSatelliteImg, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          ctx.fillStyle = "#67e8f9";
          ctx.beginPath();
          ctx.arc(sx, sy, state.satelliteRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    state.bullets.forEach((b) => {
      if (!b || typeof b.x !== "number") return;
      ctx.fillStyle = b.color || "#facc15";
      if (b.tidecallerBolt) {
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(b.x, b.y, b.w, b.h);
    });
    state.enemyBullets.forEach((b) => {
      if (!b || typeof b.x !== "number") return;
      if (b.grassBall) {
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.rotate(b.grassBallAngle || 0);
        ctx.fillStyle = "#65753b";
        ctx.strokeStyle = "#d6c674";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, b.w * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 6; i += 1) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath(); ctx.moveTo(-b.w * 0.32, 2); ctx.quadraticCurveTo(0, -b.h * 0.38, b.w * 0.3, 3); ctx.stroke();
        }
        ctx.restore();
        return;
      }
      if (b.grassFeather) {
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.rotate(Math.atan2(b.vy, b.vx) - Math.PI / 2);
        ctx.fillStyle = "#edc48a";
        ctx.beginPath(); ctx.moveTo(0, -b.h / 2); ctx.quadraticCurveTo(b.w, 0, 0, b.h / 2); ctx.quadraticCurveTo(-b.w, 0, 0, -b.h / 2); ctx.fill();
        ctx.restore();
        return;
      }
      if (b.oceanBullet || b.grassBullet) {
        // 实际命中框内绘制实心珠状弹；深色描边保证浪纹上仍可辨认。
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = b.color || "#ffad91";
        ctx.strokeStyle = "#3b2036";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return;
      }
      const petaling = Boolean(b.judgementBolt && state.finalJudgementPetalMs > 0);
      if (petaling) {
        ctx.save();
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(b._petalAng || 0);
        const t = Math.max(0.12, Math.min(1, state.finalJudgementPetalMs / 3000));
        ctx.globalAlpha = 0.2 + t * 0.75;
        const pw = Math.max(2, b._pw ?? b.w);
        const ph = Math.max(2, b._ph ?? b.h);
        ctx.scale(pw * 0.52, ph * 0.32);
        const rg = ctx.createRadialGradient(-0.42, -0.42, 0, 0, 0, 1.08);
        rg.addColorStop(0, "rgba(255, 250, 252, 0.95)");
        rg.addColorStop(0.45, "rgba(244, 114, 182, 0.75)");
        rg.addColorStop(1, "rgba(219, 39, 119, 0.12)");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        return;
      }
      ctx.fillStyle = "#f472b6";
      ctx.globalAlpha = 1;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    });
  }

  /** 道具：色块 + 中心 9px 黑色标签文字 */
  function drawItems(ctx) {
    state.items.forEach((it) => {
      if (!it || typeof it.x !== "number") return;
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = "#000";
      ctx.font = "bold 9px sans-serif";   // 道具标签字号 9
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.label, it.x + it.w / 2, it.y + it.h / 2 + 1);
    });
  }

  /**
   * 战斗 HUD（左上角信息板 + 右上角音乐 / 退出键）。
   * 信息板位置：左上 10,10，宽 240 高 116。
   * 字号：14（HUD 文字） / 12（磁吸提示） / 13（音乐·退出按钮）
   * 经验条位置：x=20, y=102, 宽 220 高 8
   */
  function drawHud(ctx) {
    // HP 条：基础满血=100%（240px）；超过基础上限后立即走“超限血条”
    const hpBaseW = 240;
    const hpCap = Math.max(1, state.baseMaxHp);
    const hpBarW = hpBaseW;
    const hudW = Math.max(260, hpBarW + 20);

    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(10, 10 + UI_SHIFT_Y, hudW, 96);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "14px sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const timerText = formatElapsed(state.elapsed);
    const endlessTag = state.endlessMode
      ? ` ·无尽${(state.endlessLapsCompleted || 0) > 0 ? `·轮回×${state.endlessLapsCompleted}` : ""}`
      : "";
    ctx.fillText(
      `Lv.${state.level}${endlessTag}  击杀 ${state.kills}  金币 ${state.coinsEarned}  时间 ${timerText}`,
      20,
      18 + UI_SHIFT_Y,
    );

    // 进化池抽空后的"自动补给"提示（不弹面板，所以要给一行反馈）
    if ((state.autoRewardToastMs || 0) > 0) {
      const a = Math.max(0, Math.min(1, state.autoRewardToastMs / 600));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`补给空投  生命全满  +${AUTO_LEVEL_REWARD_COINS} 金币`, 20, 112 + UI_SHIFT_Y);
      ctx.restore();
    }

    // 真实经验条：state.exp / state.expToNext
    const expProgress = Math.max(0, Math.min(1, state.exp / Math.max(1, state.expToNext)));

    // HP 红条
    const hpBarX = 20;
    const hpBarY = 44 + UI_SHIFT_Y;
    const hpBarH = 10;
    const baseHp = Math.max(0, Math.min(state.hp, hpCap));
    const baseRatio =
      state.maxHp > hpCap
        ? Math.max(0, Math.min(1, baseHp / hpCap))
        : Math.max(0, Math.min(1, state.hp / Math.max(1, state.maxHp)));
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(hpBarX, hpBarY, hpBarW * baseRatio, hpBarH);
    // 超出基础 100% 的部分：按层“向上叠加”，避免新层覆盖旧层颜色
    if (state.maxHp > hpCap) {
      const overflowHp = Math.max(0, state.hp - hpCap);
      const layerCap = hpCap; // 每层容量等于“基础 110% 这一整条”
      const layerColors = ["#a78bfa", "#38bdf8", "#f59e0b", "#34d399", "#f472b6"];
      const layerH = 3;
      const layerGap = 1;
      const rawLayerCount = Math.max(1, Math.ceil(overflowHp / Math.max(1, layerCap)));
      const layerCount = Math.min(MAX_OVERFLOW_HP_LAYERS, rawLayerCount);
      for (let layer = 0; layer < layerCount; layer += 1) {
        const usedBottom = overflowHp - layer * layerCap;
        if (usedBottom <= 0) break;
        const stackCapped = rawLayerCount > MAX_OVERFLOW_HP_LAYERS && layer === layerCount - 1;
        const ratio = stackCapped
          ? 1
          : Math.max(0, Math.min(1, usedBottom / Math.max(1, layerCap)));
        const c = layerColors[layer % layerColors.length];
        const y = hpBarY - (layer + 1) * (layerH + layerGap);
        // 层底轨道
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(hpBarX, y, hpBarW, layerH);
        // 当前层填充
        ctx.fillStyle = c;
        ctx.fillRect(hpBarX, y, hpBarW * ratio, layerH);
      }
    }

    // EXP 绿条
    const expBarX = 20;
    const expBarY = 64 + UI_SHIFT_Y;
    const expBarW = 240;
    const expBarH = 10;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(expBarX, expBarY, expBarW, expBarH);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(expBarX, expBarY, expBarW * expProgress, expBarH);

    // 护盾条（在 EXP 下方）
    if (state.shieldMaxHp > 0) {
      const shieldRatio = Math.max(0, Math.min(1, state.shieldHp / Math.max(1, state.shieldMaxHp)));
      const shieldX = 20;
      const shieldY = 84 + UI_SHIFT_Y;
      const shieldW = 240;
      const shieldH = 8;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(shieldX, shieldY, shieldW, shieldH);
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(shieldX, shieldY, shieldW * shieldRatio, shieldH);
    }

    // 右上角：音乐切换 + 退出
    const muz = getBattleMusicRect();
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.fillRect(muz.x, muz.y, muz.w, muz.h);
    ctx.fillStyle = audio.getEnabled() ? "#86efac" : "#94a3b8";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(audio.getEnabled() ? "音乐" : "静音", muz.x + muz.w / 2, muz.y + muz.h / 2);

    const pauseR = getPauseRect();
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.fillRect(pauseR.x, pauseR.y, pauseR.w, pauseR.h);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("退出", pauseR.x + pauseR.w / 2, pauseR.y + pauseR.h / 2);
  }

  /** 波间休息提示横幅（屏幕中央） */
  function drawWaveBanner(ctx) {
    if (!state.waveResting) return;

    ctx.fillStyle = "rgba(2, 6, 23, 0.55)";
    ctx.fillRect(0, H / 2 - 50 + UI_SHIFT_Y, W, 100);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 22px sans-serif";              // 主标语字号 22
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `第 ${state.waveIndex + 1} 阶段即将开始`,
      W / 2,
      H / 2 - 12 + UI_SHIFT_Y
    );

    ctx.font = "14px sans-serif";                   // 倒计时字号 14
    ctx.fillText(
      `准备... ${Math.ceil(state.waveRestLeft / 1000)}`,
      W / 2,
      H / 2 + 16 + UI_SHIFT_Y
    );
  }

  /**
   * 升级 3 选 1 面板：屏幕暗化 + 中央卡片。
   * 字号：标题 18 / 选项名 16 / 选项描述 13
   * 选项按钮：getUpgradeButtonRect(i) 决定位置
   */
  function drawUpgradePanel(ctx) {
    // 暗化背景
    ctx.fillStyle = "rgba(2, 6, 23, 0.78)";
    ctx.fillRect(0, 0, W, H);

    // 卡片底
    const sample = getUpgradeButtonRect(0);
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.fillRect(sample.panelX, sample.panelY, sample.panelW, sample.panelH);
    ctx.strokeRect(sample.panelX, sample.panelY, sample.panelW, sample.panelH);

    // 标题
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const titleLine =
      state.upgradeOptions[0] && state.upgradeOptions[0].isPostPoolReward
        ? `升级 Lv.${state.level}！进化已满，选择一项补给`
        : `升级 Lv.${state.level}！选择一项进化`;
    ctx.fillText(titleLine, W / 2, sample.panelY + 16);
    if (state.upgradePruneArmed) {
      ctx.fillStyle = "#fef3c7";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("剔除模式：点击任一进化将其从本局中移除", W / 2, sample.panelY + 38);
    }

    // 3 个选项按钮
    state.upgradeOptions.forEach((opt, i) => {
      const r = getUpgradeButtonRect(i);
      const animT = state.upgradePanelAnimMs || 0;
      const shakeX = state.upgradePruneArmed ? Math.sin(animT * 0.045 + i * 1.7) * 1.9 : 0;
      const shakeY = state.upgradePruneArmed ? Math.cos(animT * 0.029 + i * 1.3) * 1.6 : 0;
      const pruneFx = state.upgradePruneFx;
      if (pruneFx && pruneFx.index === i) {
        const progress = 1 - (pruneFx.ms / Math.max(1, pruneFx.total));
        const cols = 10;
        const rows = 10;
        const pw = r.w / cols;
        const ph = r.h / rows;
        const ps = Math.max(1, Math.min(pw, ph) * 0.45); // 细细的正方体颗粒
        for (let yy = 0; yy < rows; yy += 1) {
          for (let xx = 0; xx < cols; xx += 1) {
            const id = yy * cols + xx;
            const a = (id / (cols * rows)) * Math.PI * 2 + 0.35 + Math.sin(id * 2.17) * 0.18;
            const sp = 20 + id * 1.5;
            const dx = Math.cos(a) * sp * progress;
            const dy = Math.sin(a) * sp * progress - 22 * progress;
            const cx = r.x + (xx + 0.5) * pw + dx + shakeX;
            const cy = r.y + (yy + 0.5) * ph + dy + shakeY;
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - progress * 1.12);
            ctx.fillStyle = RARITY_COLORS[opt.rarity] || "#1d4ed8";
            ctx.fillRect(
              cx - ps / 2,
              cy - ps / 2,
              ps,
              ps
            );
            ctx.restore();
          }
        }
        return;
      }
      ctx.fillStyle = RARITY_COLORS[opt.rarity] || "#1d4ed8";
      ctx.fillRect(r.x + shakeX, r.y + shakeY, r.w, r.h);

      // 名字（粗体 16，距顶部 24）
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opt.name, r.x + shakeX + r.w / 2, r.y + shakeY + 24);

      // 描述（13，支持 \n 分行；首行距顶部 50）
      ctx.font = "13px sans-serif";
      ctx.fillStyle = "#dbeafe";
      const descLines = String(opt.desc || "").split("\n");
      const lineH = 16;
      descLines.forEach((line, li) => {
        ctx.fillText(line, r.x + shakeX + r.w / 2, r.y + shakeY + 50 + li * lineH);
      });
    });

    const rr = getUpgradeRerollRect();
    const canFree = state.upgradeRerollLeft > 0 || state.characterId === "taffy";
    const paidIdx = state.upgradePaidRerollsUsed || 0;
    const nextCost =
      !canFree && paidIdx < UPGRADE_PAID_REROLL_MAX
        ? UPGRADE_PAID_REROLL_COSTS[paidIdx]
        : null;
    const runCoins = state.coinsEarned || 0;
    const walletCoins = Math.max(0, storage.get().coins || 0);
    const totalCoins = runCoins + walletCoins;
    const canPaid =
      !canFree
      && paidIdx < UPGRADE_PAID_REROLL_MAX
      && totalCoins >= (nextCost || 0);
    const canReroll = canFree || canPaid;
    let rrLabel;
    if (canFree) rrLabel = "重掷（免费）";
    else if (paidIdx >= UPGRADE_PAID_REROLL_MAX) rrLabel = "本局重掷已用尽";
    else {
      rrLabel = `重掷\n（${nextCost}金币 剩余${totalCoins}）`;
    }

    ctx.fillStyle = canReroll ? "#ca8a04" : "#713f12";
    ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
    ctx.strokeStyle = canReroll ? "#fde047" : "#a16207";
    ctx.lineWidth = 1;
    ctx.strokeRect(rr.x, rr.y, rr.w, rr.h);
    ctx.fillStyle = canReroll ? "#fef9c3" : "#fde68a";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(rrLabel, rr.x + rr.w / 2, rr.y + rr.h / 2);

    const pr = getUpgradePruneRect();
    const canPrune = (state.upgradePruneLeft || 0) > 0;
    const pruneLabel = state.upgradePruneArmed
      ? `剔除中（剩余 ${state.upgradePruneLeft}）`
      : `剔除（剩余 ${state.upgradePruneLeft}）`;
    ctx.fillStyle = state.upgradePruneArmed
      ? "#991b1b"
      : (canPrune ? "#7f1d1d" : "#3f3f46");
    ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
    ctx.strokeStyle = state.upgradePruneArmed
      ? "#fca5a5"
      : (canPrune ? "#f87171" : "#71717a");
    ctx.lineWidth = 1;
    ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
    ctx.fillStyle = canPrune ? "#fee2e2" : "#d4d4d8";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pruneLabel, pr.x + pr.w / 2, pr.y + pr.h / 2);
  }

  /**
   * Game Over 结算页。
   * 字号：标题 28 / 数据行 16 / 按钮 16/14
   */
  function drawGameOver(ctx) {
    ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
    ctx.fillRect(0, 0, W, H);

    // 标题（屏幕中心往上 70）
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.win ? "你赢了！" : "游戏结束", W / 2, H / 2 - 70 + UI_SHIFT_Y);

    // 数据行（中心上 30）
    ctx.font = "16px sans-serif";
    ctx.fillText(
      `阶段 ${state.waveIndex}    Lv.${state.level}    击杀 ${state.kills}`,
      W / 2,
      H / 2 - 30 + UI_SHIFT_Y
    );

    // 金币结算（中心上 4）
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`本局获得金币 +${state.coinsEarned}`, W / 2, H / 2 - 4 + UI_SHIFT_Y);

    // 新地图解锁提示（击败隐藏 Boss 后解锁「沙漠」）
    if (state.newMapUnlockedName) {
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(`已解锁新地图：${state.newMapUnlockedName}`, W / 2, H / 2 + 22 + UI_SHIFT_Y);
      ctx.font = "16px sans-serif";
    }

    if (state.newCharacterUnlockedName) {
      ctx.fillStyle = "#bce9cc";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(`已解锁新角色：${state.newCharacterUnlockedName}`, W / 2, H / 2 + 44 + UI_SHIFT_Y);
    }

    // "再来一局"主按钮（getRestartRect）
    const re = getRestartRect();
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(re.x, re.y, re.w, re.h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("再来一局", W / 2, re.y + re.h / 2);

    // "回到菜单"次按钮（getMenuRect）
    const me = getMenuRect();
    ctx.fillStyle = "#334155";
    ctx.fillRect(me.x, me.y, me.w, me.h);
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.fillText("回到菜单", W / 2, me.y + me.h / 2);

    if (state.win && state.offerEndlessAfterVoidWin) {
      const eg = getEndlessRect();
      ctx.fillStyle = "#b91c1c";
      ctx.fillRect(eg.x, eg.y, eg.w, eg.h);
      ctx.strokeStyle = "#fecaca";
      ctx.lineWidth = 2;
      ctx.strokeRect(eg.x, eg.y, eg.w, eg.h);
      ctx.fillStyle = "#fef2f2";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("无尽模式", eg.x + eg.w / 2, eg.y + eg.h / 2);
    }
  }

  /** 炸弹爆炸时的全屏黄色闪光（透明度从 0.6 衰减到 0） */
  function drawBombFlash(ctx) {
    if (!state.flashEffectsOn || state.bombFlashMs <= 0) return;
    const a = Math.min(0.6, state.bombFlashMs / 280);
    ctx.fillStyle = `rgba(255, 247, 158, ${a})`;
    ctx.fillRect(0, 0, W, H);
  }

  /** 隐藏虚空入场：全屏剧烈黑白交替闪（叠在画面上、HUD 之下） */
  function drawHiddenVoidIntroStrobe(ctx) {
    if (!state.flashEffectsOn) return;
    const ms = state.hiddenVoidStrobeMs || 0;
    if (ms <= 0) return;
    const total = HIDDEN_VOID_STROBE_MS;
    const progress = 1 - ms / total;
    const e = state.elapsed;
    const intv = Math.max(22, 40 - progress * 20);
    const phase = Math.floor(e / intv) % 2;
    const flick = 0.82 + 0.14 * Math.sin(e * 0.09);
    const alpha = Math.min(0.94, flick + 0.06 * (1 - progress));
    ctx.save();
    ctx.fillStyle = phase === 0 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(0, 0, W, H);
    if ((Math.floor(e / 31) ^ Math.floor(e / 53)) % 2 === 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.18 + 0.22 * (1 - progress)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** 总绘制入口（按 z-order 串起来） */
  function draw(ctx) {
    drawBackground(ctx);
    if (state.mapParticle === "ocean") drawOceanOverlay(ctx, state, W, H);
    if (state.mapParticle === "grassland") drawGrasslandOverlay(ctx, state, W, H);
    if (state.mapParticle === "hell") drawHellOverlay(ctx, state, W, H);
    drawHanbaTelegraphs(ctx);
    drawItems(ctx);
    drawBullets(ctx);
    drawPlayer(ctx);
    drawEnemies(ctx);
    drawBossOverheat(ctx);
    drawVoidPhase2Cutscene(ctx);
    drawVoidTelegraphs(ctx);
    drawSandstormVeil(ctx);   // 沙幕压在敌人/玩家之上、HUD 之下
    drawBombFlash(ctx);
    drawHiddenVoidIntroStrobe(ctx);
    drawHud(ctx);
    drawWindCharge(ctx, state, W, H);
    if (state.pausedForUpgrade) drawUpgradePanel(ctx);
    if (state.gameOver) drawGameOver(ctx);
  }

  // ==========================================================================
  //  触摸输入
  // ==========================================================================

  function pointInRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /**
   * 触摸开始：根据当前状态决定行为。
   *   1. Game Over：点 restart/menu 按钮
   *   2. 升级面板：点 3 个选项之一
   *   3. 战斗中：点退出键 → 回菜单；其他位置 → 开始拖拽
   */
  function onTouchStart(t) {
    if (state.gameOver) {
      if (pointInRect(t.x, t.y, getRestartRect())) {
        finishRun();
        onExit({ restart: true, character });
      } else if (state.win && state.offerEndlessAfterVoidWin && pointInRect(t.x, t.y, getEndlessRect())) {
        /** 不进 finishRun：无尽周回金币与最佳记录仅在死亡或退回菜单/再来一局时结算 */
        beginEndlessContinuation();
      } else if (pointInRect(t.x, t.y, getMenuRect())) {
        finishRun();
        onExit({ restart: false });
      }
      return;
    }

    if (state.pausedForUpgrade) {
      if (state.upgradePruneFx) return;
      if (pointInRect(t.x, t.y, getUpgradeRerollRect())) {
        rerollUpgradeOptions();
        return;
      }
      if (pointInRect(t.x, t.y, getUpgradePruneRect())) {
        armUpgradePrune();
        return;
      }
      for (let i = 0; i < state.upgradeOptions.length; i += 1) {
        if (pointInRect(t.x, t.y, getUpgradeButtonRect(i))) {
          if (state.upgradePruneArmed) pruneUpgrade(i);
          else pickUpgrade(i);
          return;
        }
      }
      state.upgradePruneArmed = false;
      return;
    }

    if (pointInRect(t.x, t.y, getBattleMusicRect())) {
      const save = storage.get();
      const wasOn = save.musicOn !== false;
      storage.setMusicOn(!wasOn);
      audio.setEnabled(!wasOn);
      if (!wasOn) {
        if (state.waveIndex >= 3 && state.bossActive) audio.playBossBgm();
        else audio.playBgm();
      }
      return;
    }

    if (pointInRect(t.x, t.y, getPauseRect())) {
      finishRun();
      onExit({ restart: false });
      return;
    }

    // 全屏任意位置按下都可进入拖拽模式
    state.touchActive = true;
    state.touchOffsetX = t.x - state.player.x;
    state.touchOffsetY = t.y - state.player.y;
  }

  /** 拖拽中：飞机跟随手指偏移，并夹紧到屏幕内 */
  function onTouchMove(t) {
    if (!state.touchActive || state.pausedForUpgrade || state.gameOver) return;
    let nx = t.x - state.touchOffsetX;
    let ny = t.y - state.touchOffsetY;
    // 流沙：踩在旱魃标记的区域里时，本次拖动只走一部分（手感上像被拖住）
    const mul = quicksandMoveMul() * grassPlayerMoveMul(state, state.player.x, state.player.y, Math.max(0, Math.min(W - state.player.w, nx)), Math.max(0, Math.min(H - state.player.h, ny)));
    if (mul < 1) {
      nx = state.player.x + (nx - state.player.x) * mul;
      ny = state.player.y + (ny - state.player.y) * mul;
    }
    nx = Math.max(0, Math.min(W - state.player.w, nx));
    ny = Math.max(0, Math.min(H - state.player.h, ny));
    const fromX = state.player.x, fromY = state.player.y;
    state.player.x = nx;
    state.player.y = ny;
    chargeWindrunner(state, fromX, fromY);
  }

  function onTouchEnd() {
    state.touchActive = false;
  }

  // 进入场景立刻启动第 1 波（首次不做渐变）
  applyTheme(true);
  startWave();

  // 应用 DEV 面板传入的调试参数（在 startWave 之后，以便覆盖默认波次/Boss）
  applyDebugStart(debug);
  clampPlayerHpToCeiling(state);

  return {
    update,
    draw,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}

module.exports = { createBattleScene };
