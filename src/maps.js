/**
 * maps.js
 * ----------------------------------------------------------------------------
 * 地图注册表。每张地图**只声明"用哪些已注册的内容"**，不写任何玩法逻辑。
 *
 * ===========================  怎么加一张新地图  ===========================
 *   1. enemies.js  往 ENEMY_POOLS 加一个刷怪池；新杂兵登记进 ENEMY_FACTORIES；
 *                  新精英登记进 ELITE_FACTORIES；新 Boss 加进 BOSS_VARIANTS
 *   2. bossAi.js   给新 Boss 写 driver，并在 updateBoss 里按 bossVariant 分派
 *   3. mechanics.js 如果有新玩法机制，加一项（沙暴就是一个例子）
 *   4. maps.js     往 MAPS 加一项，把上面那些用 id 串起来
 *   5. storage.js  DEFAULT_SAVE.unlockedMaps 补一个默认值
 *
 *   battle.js / menu.js **都不用改**——它们只读注册表，没有任何写死的地图名。
 *   串错 id 会被 validateMaps() 当场抓出来（见文件底部），不会静默走默认值。
 * =========================================================================
 *
 * 字段说明：
 *   id / name / desc / accent      基本信息；accent 是菜单卡片选中态描边色
 *   unlockBy                       null 默认可用；"hiddenBoss" 需击败虚空线 Boss，
 *                                  解锁前**不在菜单展示**（与兑换码角色同一约定）
 *   enemyPool                      刷怪池名（enemies.js ENEMY_POOLS 的键）
 *   eliteType                      精英类型（enemies.js ELITE_FACTORIES 的键）
 *   bossVariant                    本图 Boss（enemies.js BOSS_VARIANTS 的 id）；
 *                                  写 "random" 表示在 randomBossPool 里随机
 *   randomBossPool                 bossVariant 为 "random" 时的候选
 *   mechanics                      { 机制id: 配置 }，见 mechanics.js
 *   themes                         背景色带，按波次循环 (waveIndex-1) % themes.length
 *                                    必填 bg / star，选填 ripple（配合 sandSea）
 *   sandSea                        true 时画俯视沙海地面质感
 *   particle                       战场渲染风格 "star" | "sand" | "ocean"
 *   loot                           掉落规则；不写就是"每只必掉经验球、道具率不打折"
 * ----------------------------------------------------------------------------
 */

const DEFAULT_MAP_ID = "starfield";

const MAPS = [
  {
    id: "starfield",
    name: "星空",
    desc: "默认战场。深空星云，随波次推进变换色调。",
    accent: "#38bdf8",
    unlockBy: null,
    unlockHint: "",

    enemyPool: "starfield",
    eliteType: "elite",
    bossVariant: "random",
    randomBossPool: ["crimson", "azure"],
    mechanics: {},

    particle: "star",
    themes: [
      { bg: "#020617", star: "#1e293b" }, // 深蓝（默认）
      { bg: "#0b0420", star: "#3b1d6b" }, // 紫色星云
      { bg: "#031918", star: "#0f5c4a" }, // 绿色星云
      { bg: "#1a0606", star: "#7f1d1d" }, // 红色火域
    ],
  },

  {
    id: "desert",
    name: "沙漠",
    desc: "风沙战场。热浪与横掠的沙尘，日落到入夜逐波推进。",
    accent: "#f59e0b",
    unlockBy: "hiddenBoss",
    unlockHint: "击败隐藏 Boss「虚空」后解锁",

    enemyPool: "desert",
    eliteType: "sandworm",
    bossVariant: "hanba",

    /**
     * 沙暴：周期性风险窗口。视野受限（远处敌人淡化）+ 敌人加速是代价，
     * 经验与掉落加成是回报，目的是让玩家主动想在沙暴里战斗。
     * Boss 战期间常规循环挂起，改由旱魃的招式主动召唤。
     */
    mechanics: {
      sandstorm: {
        calmMs: 22000,
        warnMs: 2000,
        activeMs: 12000,
        veilRgb: "120, 82, 28",
        maxAlpha: 0.66,
        visionR: 150,
        enemyMoveMul: 1.5,
        expMul: 1.5,
        dropBonus: 0.10,
        aimSpreadDeg: 8,
      },
    },

    particle: "sand",
    sandSea: true,
    /** 沙漠资源更紧：普通敌人不再每只都掉经验球，道具率也砍到三成 */
    loot: {
      expOrbChance: 0.5,
      dropMul: 0.3,
    },
    /** 俯视沙海：bg 沙面底色，ripple 风成沙纹（质感不是花纹），star 被风吹起的沙粒 */
    themes: [
      { bg: "#4a3117", ripple: "#5c3d1d", star: "#e8bc70" }, // 暮色沙丘
      { bg: "#6b4d22", ripple: "#7d5b2a", star: "#f7dda0" }, // 正午黄沙
      { bg: "#5a2510", ripple: "#6d2f15", star: "#f0894a" }, // 赤色沙暴
      { bg: "#221c14", ripple: "#2b241a", star: "#b9a689" }, // 夜漠
    ],
  },
  {
    id: "ocean",
    name: "海洋",
    desc: "穿越珊瑚浅海，潜入归墟。涨潮横推机体，经验 +20%。",
    accent: "#5eead4",
    unlockBy: null,
    unlockHint: "",
    enemyPool: "ocean",
    eliteType: "abyssalAngler",
    bossVariant: "leviathan",
    mechanics: {
      tide: {
        calmMs: 14000,
        warnMs: 2200,
        activeMs: 8000,
        driftPxPerSec: 24,
        expMul: 1.2,
      },
    },
    particle: "ocean",
    themes: [
      { bg: "#063b4b", star: "#75dfd0", ripple: "#1d7b86" },
      { bg: "#082d43", star: "#62bfcf", ripple: "#175b79" },
      { bg: "#071a32", star: "#4987ad", ripple: "#173a5e" },
    ],
  },
  {
    id: "grassland",
    name: "草原",
    desc: "穿过草丛掩体与交错兽径，挑战护群鹿王。",
    accent: "#c7df7b",
    unlockBy: "mapClear",
    unlockMapId: "ocean",
    unlockHint: "通关海洋后解锁",
    showLocked: true,
    enemyPool: "grassland",
    eliteType: "thunderBison",
    bossVariant: "antlerKing",
    mechanics: {
      grasslandHabitat: {},
    },
    particle: "grassland",
    themes: [
      { bg: "#263f2d", star: "#c6da8b", ripple: "#567342" },
      { bg: "#3c4b2b", star: "#e4cf83", ripple: "#738450" },
      { bg: "#172f2b", star: "#a8dbb0", ripple: "#365c45" },
    ],
  },
  {
    id: "hell",
    name: "地狱",
    desc: "杀死的每一个敌人都会站起来。收走魂火，或者面对它。",
    accent: "#ff6b3d",
    unlockBy: "mapClear",
    unlockMapId: "grassland",
    unlockHint: "通关草原后解锁",
    showLocked: true,
    enemyPool: "hell",
    eliteType: "warden",
    bossVariant: "yama",
    /**
     * 业火回魂：本作唯一由**玩家自己的击杀速率**驱动的压力轴。
     * Boss 战期间**不挂起**（沙暴是挂起的）——这不是天气，是玩家自己的经济，
     * 而且阎罗的「业火判决」直接拿它做文章。
     */
    mechanics: {
      hellfireRevenant: {},
    },
    particle: "hell",
    /** 地狱资源最紧：经验球一半概率，道具率砍到四分之一 */
    loot: {
      expOrbChance: 0.5,
      dropMul: 0.25,
    },
    /** 四条底色都是低彩度暗色，把全部饱和度让给危险色（见 docs/hell-map.md 第三节） */
    themes: [
      { bg: "#241f2b", ripple: "#2e2736", star: "#c9b8d6" }, // 熄炉
      { bg: "#2c2622", ripple: "#382f29", star: "#d8c6ae" }, // 焦土
      { bg: "#1d2620", ripple: "#26332c", star: "#b3c9bb" }, // 硫沼
      { bg: "#332330", ripple: "#402c3c", star: "#dcbcd2" }, // 裂隙
    ],
  },
];

function getMapById(id) {
  for (let i = 0; i < MAPS.length; i += 1) {
    if (MAPS[i].id === id) return MAPS[i];
  }
  return null;
}

/** 默认地图（星空）；找不到时兜底返回列表第一项 */
function getDefaultMap() {
  return getMapById(DEFAULT_MAP_ID) || MAPS[0];
}

function isMapUnlocked(save, map) {
  if (!map) return false;
  if (!map.unlockBy) return true;
  return !!(save && save.unlockedMaps && save.unlockedMaps[map.id]);
}

/** 菜单可见地图：需解锁的地图在解锁前不展示 */
function getVisibleMaps(save) {
  return MAPS.filter((m) => !m.unlockBy || m.showLocked || isMapUnlocked(save, m));
}

/** 存档里记着的地图；已失效或未解锁时回落到默认地图 */
function resolveSelectedMap(save) {
  const m = getMapById(save && save.selectedMapId);
  if (m && isMapUnlocked(save, m)) return m;
  return getDefaultMap();
}

/** 击败隐藏 Boss 后应解锁的地图（从 unlockBy 反查，不写死 id） */
function mapsUnlockedByHiddenBoss() {
  return MAPS.filter((m) => m.unlockBy === "hiddenBoss");
}

/** 本图这一局要打的 Boss（bossVariant 为 "random" 时在候选里随机） */
function pickMapBossVariant(map) {
  if (!map) return "crimson";
  if (map.bossVariant !== "random") return map.bossVariant;
  const pool = map.randomBossPool && map.randomBossPool.length > 0
    ? map.randomBossPool
    : ["crimson"];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 引用校验：地图串错 id 时当场报出来，而不是静默走默认值。
 * 由 t_content 测试台调用；也可以在开发期于 game.js 启动时跑一次。
 * 传入各注册表（避免 maps.js 反向依赖 enemies.js 造成循环引用）。
 */
function validateMaps(reg) {
  const errors = [];
  const pools = reg.enemyPools || {};
  const elites = reg.eliteFactories || {};
  const bosses = (reg.bossVariants || []).map((b) => b.id);
  const mechanicIds = (reg.mechanics || []).map((m) => m.id);

  MAPS.forEach((m) => {
    const at = `地图「${m.name}」(${m.id})`;
    if (!m.enemyPool || !pools[m.enemyPool]) {
      errors.push(`${at} 的 enemyPool "${m.enemyPool}" 未在 ENEMY_POOLS 注册`);
    }
    if (!m.eliteType || !elites[m.eliteType]) {
      errors.push(`${at} 的 eliteType "${m.eliteType}" 未在 ELITE_FACTORIES 注册`);
    }
    if (m.bossVariant === "random") {
      const pool = m.randomBossPool || [];
      if (pool.length === 0) errors.push(`${at} bossVariant 为 random 但没写 randomBossPool`);
      pool.forEach((b) => {
        if (bosses.indexOf(b) < 0) errors.push(`${at} randomBossPool 里的 "${b}" 未在 BOSS_VARIANTS 注册`);
      });
    } else if (bosses.indexOf(m.bossVariant) < 0) {
      errors.push(`${at} 的 bossVariant "${m.bossVariant}" 未在 BOSS_VARIANTS 注册`);
    }
    Object.keys(m.mechanics || {}).forEach((k) => {
      if (mechanicIds.indexOf(k) < 0) errors.push(`${at} 的机制 "${k}" 未在 MECHANICS 注册`);
    });
    if (!Array.isArray(m.themes) || m.themes.length === 0) {
      errors.push(`${at} 没有 themes 色带`);
    }
  });
  return errors;
}

module.exports = {
  MAPS,
  DEFAULT_MAP_ID,
  getMapById,
  getDefaultMap,
  isMapUnlocked,
  getVisibleMaps,
  resolveSelectedMap,
  pickMapBossVariant,
  mapsUnlockedByHiddenBoss,
  validateMaps,
};
