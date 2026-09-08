/**
 * upgrades.js
 * ----------------------------------------------------------------------------
 * 局内升级池（"3 选 1"武器进化）。每次升级时按稀有度加权抽 3 个不重复词条。
 *
 * 稀有度颜色：
 *   green  低强度，常见
 *   blue   中强度
 *   purple 高强度
 *   orange 终极强度，稀有
 *
 * 抽取概率由 RARITY_WEIGHTS 决定，按词条稀有度参与加权随机。
 *
 * 词条默认一次性（同一局内只能拿一次）。少数标了 repeatable 的可以反复刷到、反复选：
 *   - 应急修复（heal_quick）    始终可选
 *   - 高级重掷（reroll_premium）仅在池中还有紫/橙可抽时出现
 * 可重复词条不写入 picked，也不受「剔除」与永雏塔菲重掷的自动剔除影响。
 * 当**不可重复**的词条全部拿完后，升级不再弹面板，改为每级自动补给（见 battle.js grantAutoLevelReward）。
 *
 * 涉及到的 state 字段（在 battle.js 顶部初始化默认值）：
 *   shootInterval, bulletDamage, sideBullets, bulletPierceEnemies,
 *   maxHp, hp, magnetRange, hasRegen, regenIntervalMs,
 *   expMul, dropBase, dropLevelUpChance, coinsEarned,
 *   levelUpSupply / levelUpSupplyTimer（空投信标：本局剩余时间内定期空投 LV+ 升级包）,
 *   critRate, critMult, critOverflowRate（溢出暴击累计，结算见 effectiveCritMult）,
 *   vampRate, bulletSizeMul, bulletSpeedMul,
 *   killHealChance, killCoinBonus, expOrbValueMul,
 *   shieldMaxHp, shieldHp, shieldDamageMul, shieldRegenPerSec,
 *   bossDmgMul, eliteDmgMul, thornReflectRate, onHitBombChance, onKillBombChance, onKillBombItemChance,
 *   overhealToShield, overhealToMaxHp, overhealToExp, magnetForceMul,
 *   timeflowShield（拾取半径内敌方位移减速）, turncoatShield / turncoatShieldAccMs（反间护盾）,
 *   ---- 沙漠专属（entry 的 options.maps 限定，见 maps.js）----
 *   stormFireRateMul（沙暴期射速倍率）, stormClearSight（沙暴期敌人不再随距离淡化）,
 *   heatDeathPerTenth（敌人每快 10% 移速的增伤）, quicksandBind（拾取范围内额外减速）,
 *   stormEyeRegenRatio（沙暴期每秒回血比例）, stormDurationMul（沙暴持续倍率）,
 *   stormDamageMul（沙暴期全伤害倍率）, stormCoinMul（沙暴期金币倍率）,
 *   erosionPerStack / erosionMaxStacks（风蚀：命中叠易伤层）,
 *   ---- 海洋专属（默认字段由 mechanics.js 的 tide 提供）----
 *   tideFireRateMul / tideExpMul（涨潮射速 / 拾取经验倍率）,
 *   tideDriftMul（海流推力倍率）, tideEndHealRatio（退潮回复最大生命比例）,
 *   tideDamageMul / tideEnemyBulletSpeedMul（涨潮全伤害 / 敌弹速度倍率）,
 *   tideHeart / tideHeartShieldRatio（涨潮清弹 / 护盾补充比例）,
 *   ---- 草原专属（默认字段由 grasslandMechanics.js 提供）----
 *   grassCoverCapacityBonus / grassCoverRegenMul（草丛耐久与恢复时间）,
 *   grassAmbushDamageMul / grassBudHealRatio / grassCoverBreakShieldRatio / grassSnareImmune,
 *   upgradeNextPanelPurplePlus（拾取「高级重掷」后，仅下一次三选一的首次抽卡必含紫/橙；同面板内重掷或剔除后不再保底）.
 * ----------------------------------------------------------------------------
 */

const RARITY_COLORS = {
  green: "#16a34a",
  blue: "#2563eb",
  purple: "#9333ea",
  orange: "#ea580c",
};

const RARITY_WEIGHTS = {
  green: 65,
  blue: 24,
  purple: 9,
  orange: 2,
};

function ensureMeta(state) {
  if (!state._upgradeMeta) {
    state._upgradeMeta = {
      picked: Object.create(null),
      blocked: Object.create(null), // 本局“出现后错过”的词条，不再进入候选池
    };
  }
  if (!state._upgradeMeta.blocked) state._upgradeMeta.blocked = Object.create(null);
  return state._upgradeMeta;
}
function isPicked(s, id) { return !!ensureMeta(s).picked[id]; }
function isBlocked(s, id) { return !!ensureMeta(s).blocked[id]; }
function markPicked(s, id) { ensureMeta(s).picked[id] = true; }

/** 按局内 coinGainMul 增加本局金币（如永雏塔菲 +1000% → 11×） */
function grantRunCoins(s, base) {
  const n = Math.floor(Number(base));
  if (!s || !Number.isFinite(n) || n <= 0) return;
  const raw = Number(s.coinGainMul);
  const mul = Number.isFinite(raw) && raw > 0 ? raw : 1;
  s.coinsEarned = (s.coinsEarned || 0) + Math.floor(n * mul);
}

/** 机械师出生即有 2 颗卫星等价于已拥有「轨道卫星」基础效果，可直接解锁「轨道卫星II」 prerequisite */
function hasMechanicStarterSatellites(s) {
  return s.characterId === "mechanic"
    && (s.satelliteCount || 0) >= 2
    && (s.satelliteDamagePerSec || 0) >= 1500;
}

function hasPrereq(s, prereq) {
  if (!prereq) return true;
  if (Array.isArray(prereq)) {
    for (let i = 0; i < prereq.length; i += 1) {
      if (!hasPrereq(s, prereq[i])) return false;
    }
    return true;
  }
  if (isPicked(s, prereq)) return true;
  if (prereq === "sat_orbit" && hasMechanicStarterSatellites(s)) return true;
  return false;
}

function getShootIntervalFloor(s) {
  const f = Number(s && s.shootIntervalFloor);
  return Number.isFinite(f) ? Math.max(1, f) : 80;
}

function applyFireRateMul(s, mul) {
  if (!s || !mul || mul <= 0) return;
  s.shootInterval = Math.max(getShootIntervalFloor(s), Math.floor(s.shootInterval / mul));
}

/** 溢出暴击换算爆伤的比率：每溢出 1% 暴击 => +1.5% 暴伤（加算，不参与 critMult 的连乘） */
const CRIT_OVERFLOW_TO_MULT = 1.5;

function addCritRateWithOverflow(s, addRate) {
  const cap = 0.95;
  const prev = Math.max(0, s.critRate || 0);
  const next = prev + Math.max(0, addRate || 0);
  const overflow = Math.max(0, next - cap);
  s.critRate = Math.min(cap, next);
  // 只累计溢出量，换算放到 effectiveCritMult 里统一结算。
  // 若在这里直接 critMult += ...，后续词条的 critMult *= N 会把这部分一起放大，
  // 导致同一组词条换个拾取顺序结果就不同（旧实现满构筑爆伤会在 4.80 ~ 5.87 之间漂）。
  if (overflow > 0) s.critOverflowRate = (s.critOverflowRate || 0) + overflow;
}

/** 结算用的实际爆伤倍率：连乘所得的 critMult + 溢出暴击换算出的加算部分 */
function effectiveCritMult(s) {
  const raw = Number(s && s.critMult);
  const base = Number.isFinite(raw) ? raw : 1;
  const overflow = Math.max(0, Number(s && s.critOverflowRate) || 0);
  return base + overflow * CRIT_OVERFLOW_TO_MULT;
}

/**
 * @param options.repeatable  true = 可反复刷到并反复选择（不写入 picked，也不受剔除影响）
 * @param options.availableIf 额外可用条件；返回 false 时不进候选池
 */
/**
 * @param options.repeatable  可重复拾取（不记 picked、不吃 blocked）
 * @param options.availableIf 额外的可用条件
 * @param options.maps        限定地图 id 数组；**不填 = 全地图通用**。
 *                            填了之后只在 state.mapId 命中时才进候选池，
 *                            用来做地图专属词条（见沙漠那一组）。
 */
function entry(rarity, id, name, desc, fn, prereq, options) {
  const opts = options || {};
  const repeatable = !!opts.repeatable;
  const maps = Array.isArray(opts.maps) && opts.maps.length > 0 ? opts.maps : null;
  return {
    rarity,
    id,
    name,
    desc,
    repeatable,
    maps,
    apply(s) { fn(s); if (!repeatable) markPicked(s, id); },
    available(s) {
      // 可重复词条既不记 picked 也不吃 blocked，否则"反复刷到"会被一次剔除/塔菲重掷废掉
      if (!repeatable && (isPicked(s, id) || isBlocked(s, id))) return false;
      // 地图专属：只在对应地图出现
      if (maps && maps.indexOf(s && s.mapId) < 0) return false;
      if (!hasPrereq(s, prereq)) return false;
      if (opts.availableIf && !opts.availableIf(s)) return false;
      return true;
    },
  };
}

/** 池中是否还有可抽的紫/橙词条（「高级重掷」的存在意义） */
function hasPurplePlusAvailable(s) {
  for (let i = 0; i < UPGRADE_POOL.length; i += 1) {
    const u = UPGRADE_POOL[i];
    if (u.rarity !== "purple" && u.rarity !== "orange") continue;
    if (u.available(s)) return true;
  }
  return false;
}

const UPGRADE_POOL = [
  // ---------- 射速类 ----------
  entry("blue", "reroll_premium", "高级重掷", "下一次三选一中必含紫或橙色词条",
    (s) => { s.upgradeNextPanelPurplePlus = true; }, null,
    { repeatable: true, availableIf: hasPurplePlusAvailable }),
  entry("green",  "fr_basic",       "急速射击",     "射速 +25%，子弹尺寸缩小10%",
    (s) => { applyFireRateMul(s, 1.25); s.bulletSizeMul *= 0.9; }),
  entry("green",  "fr_cool",        "急速射击II",   "射速 +50%，子弹尺寸再缩小19%",
    (s) => { applyFireRateMul(s, 1.5); s.bulletSizeMul *= 0.81; }, "fr_basic"),
  // 三条拿满：1.25 × 1.5 × 1.6 = 初始射速的 3 倍
  entry("blue",   "fr_turbo",       "急速射击III",  "射速 +60%，子弹尺寸再缩小27%",
    (s) => { applyFireRateMul(s, 1.6); s.bulletSizeMul *= 0.729; }, "fr_cool"),
  // entry("purple", "fr_overload",    "急速射击IV",   "射速 +17%",
  //   (s) => { s.shootInterval = Math.max(80, Math.floor(s.shootInterval / 1.17)); }, "fr_turbo"),
  // entry("orange", "fr_chronoBoost", "急速射击V",    "射速 +24%",
  //   (s) => { s.shootInterval = Math.max(70, Math.floor(s.shootInterval / 1.24)); }, "fr_overload"),

  // ---------- 子弹形态 ----------
  entry("green",  "bs_size_s", "大口径弹",     "子弹尺寸变大100%",
    (s) => { s.bulletSizeMul *= 2; }),
  entry("blue",   "bs_size_m", "大口径弹II",   "子弹尺寸再变大150%",
    (s) => { s.bulletSizeMul *= 2.5; }, "bs_size_s"),
  // entry("green",  "bs_spd_s",  "高速火药",     "子弹速度 +20%",
  //   (s) => { s.bulletSpeedMul *= 1.2; }),
  // entry("blue",   "bs_spd_m",  "高速火药II",   "子弹速度再+35%",
  //   (s) => { s.bulletSpeedMul *= 1.35; }, "bs_spd_s"),
  entry("blue",   "sat_orbit", "轨道卫星",     "在机体周围追加 2 颗可发射伤害略低的追踪弹的卫星\n其伤害受益于你的伤害",
    (s) => {
      s.satelliteCount = (s.satelliteCount || 0) + 2;
      s.satelliteDamagePerSec = Math.max(s.satelliteDamagePerSec || 0, 1500);
    }),
  entry("purple", "sat_orbit_2", "轨道卫星II", "卫星数量翻倍，卫星可碰撞消除敌方弹幕",
    (s) => {
      s.satelliteCount = (s.satelliteCount || 0) * 2;
      s.satelliteBreakBullets = true;
    }, "sat_orbit"),
  entry("orange", "bullet_crush", "无坚不摧",   "你的子弹能够摧毁敌方弹幕",
    (s) => { s.bulletBreakBullets = true; }),

  // ---------- 弹道类 ----------
  entry("green",  "ms_split_s", "分裂弹幕",   "弹道变为3发",
    (s) => { s.sideBullets = Math.min(8, s.sideBullets + 1); }),
  entry("blue",   "ms_split_m", "分裂弹幕II", "弹道变为5发",
    (s) => { s.sideBullets = Math.min(8, s.sideBullets + 1); }, "ms_split_s"),
  entry("purple", "ms_split_l", "分裂弹幕III","弹道变为9发",
    (s) => { s.sideBullets = Math.min(8, s.sideBullets + 2); }, "ms_split_m"),
  entry("green", "pc_pierce", "穿透核心", "你的子弹可穿透敌机，直至飞出屏幕",
    (s) => { s.bulletPierceEnemies = true; }),

  // ---------- 伤害类 ----------
  entry("green",  "dmg_s",  "高能弹芯",     "伤害 +12%",
    (s) => { s.bulletDamage *= 1.12; }),
  entry("blue",   "dmg_m",  "高能弹芯II",   "伤害 +20%",
    (s) => { s.bulletDamage *= 1.2; }, "dmg_s"),
  entry("purple", "dmg_l",  "高能弹芯III",  "伤害 +50%",
    (s) => { s.bulletDamage *= 1.5; }, "dmg_m"),
  entry("orange", "dmg_xl", "高能弹芯IV",   "伤害 +75%",
    (s) => { s.bulletDamage *= 1.75; }, "dmg_l"),

  // ---------- 暴击类 ----------
  entry("green",  "crit_aim",  "瞄准训练",     "暴击率 +20%",
    (s) => { addCritRateWithOverflow(s, 0.20); }),
  entry("blue",   "crit_lethal", "瞄准训练II", "暴击率 +25%",
    (s) => { addCritRateWithOverflow(s, 0.25); }, "crit_aim"),
  entry("purple", "crit_master", "瞄准训练III","暴击率 +30%，暴击伤害 +50%",
    (s) => { addCritRateWithOverflow(s, 0.30); s.critMult *= 1.5; }, "crit_lethal"),
  entry("orange", "crit_apex",   "瞄准训练IV", "暴击率 +35%，暴击伤害 +70%",
    (s) => { addCritRateWithOverflow(s, 0.35); s.critMult *= 1.7; }, "crit_master"),

  // ---------- 对 Boss/精英 ----------
  entry("blue",   "boss_hunter",   "屠龙战术",   "对 Boss 伤害 +30%",
    (s) => { s.bossDmgMul *= 1.3; }),
  // entry("purple", "boss_slayer",   "屠龙战术II", "对 Boss 伤害 +60%",
  //   (s) => { s.bossDmgMul *= 1.6; }, "boss_hunter"),
  entry("blue",   "elite_hunter",  "精英猎手",   "对精英伤害 +40%",
    (s) => { s.eliteDmgMul *= 1.4; }),
  entry("orange", "tyrant_breaker","王座破坏者", "对精英和Boss造成双倍伤害",
    (s) => { s.eliteDmgMul *= 2; s.bossDmgMul *= 2; }),

  // ---------- 生存类 ----------
  entry("green",  "hp_plate",     "装甲板",     "最大HP +15%，并回复全部生命",
    (s) => {
      s.maxHp *= 1.15;
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
    }),
  entry("blue",   "hp_heavy",     "装甲板II",   "最大HP再+20%，并回复全部生命",
    (s) => {
      s.maxHp *= 1.2;
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
    }, "hp_plate"),
  entry("purple", "hp_unbroken",  "装甲板III",  "最大HP +25%，并回复全部生命",
    (s) => {
      s.maxHp *= 1.25;
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
    }, "hp_heavy"),
  entry("green",  "heal_quick",   "应急修复",   "立即回满生命，并获得一个等同最大生命值的护盾",
    (s) => {
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.maxHp);
    }, null, { repeatable: true }),
  // entry("blue",   "heal_full",    "应急修复II", "立即回满生命，并获得一个等同最大生命值的护盾",
  //   (s) => { s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp; }, "heal_quick"),
  entry("blue",   "regen_basic",  "自动修复",   "每秒回复 1% 基础生命值",
    (s) => {
      s.hasRegen = true;
      s.regenIntervalMs = Math.min(s.regenIntervalMs, 1000);
      s.regenHealRatio = (s.regenHealRatio || 0) + 0.01;
    }),
  entry("purple", "regen_nano",   "自动修复II", "每秒再回复 4% 基础生命值",
    (s) => {
      s.hasRegen = true;
      s.regenIntervalMs = Math.min(s.regenIntervalMs, 1000);
      s.regenHealRatio = (s.regenHealRatio || 0) + 0.04;
    }, "regen_basic"),

  // ---------- 护盾类 ----------
  entry("blue",   "shield_basic",  "能量护盾", "获得等同最大生命值的护盾，且每秒自动修复 1.5%",
    (s) => {
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.maxHp);
      s.shieldDamageMul = 2; // 护盾承受双倍伤害，避免“拿盾后几乎不掉血”
      s.shieldRegenPerSec = Math.max(s.shieldRegenPerSec || 0, 0.015);
    }),
  entry("purple", "shield_extra",  "能量护盾II",   "获得等同最大生命值的护盾，且每秒自动修复 3%",
    (s) => {
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.maxHp);
      s.shieldDamageMul = 2;
      s.shieldRegenPerSec = Math.max(s.shieldRegenPerSec || 0, 0.03);
    }, "shield_basic"),
  entry("orange", "shield_rapid",  "能量护盾III",  "获得等同最大生命值的护盾，且每秒自动修复 7.5%",
    (s) => {
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.maxHp);
      s.shieldDamageMul = 2;
      s.shieldRegenPerSec = Math.max(s.shieldRegenPerSec || 0, 0.075);
    }, "shield_extra"),
  entry("purple", "timeflow_shield", "时间流护盾", "靠近你的敌人与子弹将被减速50%\n范围等于你的拾取范围",
    (s) => { s.timeflowShield = true; }),
  entry("purple", "turncoat_shield", "反间护盾", "每15秒，将你附近的弹幕射向离你最近的敌人\n范围等于你的拾取范围",
    (s) => {
      s.turncoatShield = true;
      s.turncoatShieldAccMs = 0;
    }),

  // ---------- 反伤类 ----------
  entry("green",  "thorn_static", "静电护甲",   "受到伤害后对敌人造成等量伤害",
    (s) => { s.thornReflectRate = Math.max(s.thornReflectRate || 0, 1); }),
  entry("blue",   "thorn_blaze",  "静电护甲II", "受到伤害后对敌人造成双倍伤害",
    (s) => { s.thornReflectRate = Math.max(s.thornReflectRate || 0, 2); }, "thorn_static"),

  // ---------- 资源类（磁吸 / 经验 / 掉落 / 金币） ----------
  entry("green",  "mag_basic",  "磁吸装置",     "拾取范围 +175%",
    (s) => { s.magnetRange += 175; }),
  entry("blue",   "mag_well",   "磁吸装置II",   "拾取范围 +300%",
    (s) => { s.magnetRange += 300; }, "mag_basic"),
  entry("purple", "mag_hole",   "磁吸装置III",  "全屏磁吸",
    (s) => { s.magnetRange += 9999; }, "mag_well"),
  entry("green",  "exp_basic",  "战术学习",     "经验倍率 +100%",
    (s) => { s.expMul += 1; }),
  entry("blue",   "exp_smart",  "战术学习II",   "经验倍率 +150%",
    (s) => { s.expMul += 1.5; }, "exp_basic"),
  entry("purple", "exp_quantum", "战术学习III", "敌人阵亡时有 5% 概率掉落一枚升级道具（LV+）",
    (s) => { s.dropLevelUpChance = Math.min(1, (s.dropLevelUpChance || 0) + 0.05); }, "exp_smart"),
  // entry("blue",   "exp_orb",    "经验催化",     "经验球价值 +100%",
  //   (s) => { s.expOrbValueMul += 1; }),
  // entry("orange", "exp_orb_apex","经验催化II",  "经验球价值 +200%",
  //   (s) => { s.expOrbValueMul += 2; }, "exp_orb"),
  entry("blue",   "drop_basic", "战利品雷达",   "精英敌人必定掉落道具",
    (s) => { s.eliteGuaranteedDrop = true; }),
  entry("purple", "supply_beacon", "空投信标", "本局对战的剩余时间内，战场会不定期空投升级包（LV+）",
    (s) => {
      s.levelUpSupply = true;
      s.levelUpSupplyTimer = 0;
    }),
  entry("green",  "coin_small", "赏金协议",     "立即获得 150 金币",
    (s) => { grantRunCoins(s, 150); }),
  entry("blue", "coin_big",   "赏金协议II",   "立即获得 400 金币",
    (s) => { grantRunCoins(s, 400); }, "coin_small"),

  // ---------- 击杀效果类 ----------
  entry("blue",   "kill_blood",  "鲜血学者",     "吸血 +1%",
    (s) => { s.vampRate += 0.01; }),
  entry("purple", "kill_butcher","鲜血学者II",   "吸血 +5%",
    (s) => { s.vampRate += 0.05; }, "kill_blood"),
  entry("purple", "kill_pulse", "清除脉冲",      "攻击命中时有 0.05% 概率清屏弹幕",
    (s) => { s.onHitBombChance = Math.min(1, (s.onHitBombChance || 0) + 0.0005); }),
  // entry("purple", "kill_pulse_2", "清除脉冲II",    "攻击命中时有 0.5% 概率清屏弹幕",
    // (s) => { s.onHitBombChance = Math.min(1, (s.onHitBombChance || 0) + 0.005); }, "kill_pulse"),
  entry("blue", "kill_pulse_3", "爆炸脉冲",   "击杀敌人时有 10% 概率触发一次爆炸",
    (s) => { s.onKillBombItemChance = Math.min(1, (s.onKillBombItemChance || 0) + 0.1); }),
  entry("blue", "heal_overflow", "超量血库",    "你的过量治疗将转变成护盾值",
    (s) => { s.overhealToShield = true; }),
  entry("purple", "heal_overflow_2", "超量血库II", "你的过量治疗还将永久提高血量上限",
    (s) => { s.overhealToMaxHp = true; }, "heal_overflow"),
  entry("purple", "heal_overflow_3", "超量血库III", "你的过量治疗还将增加经验值",
    (s) => { s.overhealToExp = true; }, "heal_overflow_2"),

  // ---------- 沙漠专属（options.maps 限定，只在沙漠地图出现） ----------
  // 六条全部围绕沙暴：要么对抗它（沙镜 / 沙暴之眼），要么押注它（逆风者 / 热寂 / 旱魃之息）。
  // 注意：视野受限的实现是"远处敌人随距离淡化"（不是暗幕挖洞），所以相关词条改的是淡化本身。
  entry("green", "dust_headwind", "逆风者", "沙暴期间射速 +40%",
    (s) => { s.stormFireRateMul = Math.max(s.stormFireRateMul || 1, 1.4); },
    null, { maps: ["desert"] }),

  entry("green", "dust_scavenger", "拾荒者", "沙暴期间拾取的金币 +200%",
    (s) => { s.stormCoinMul = Math.max(s.stormCoinMul || 1, 3); },
    null, { maps: ["desert"] }),

  entry("blue", "dust_mirage", "沙镜", "沙暴期间敌人不再随距离在风沙里淡化",
    (s) => { s.stormClearSight = true; },
    null, { maps: ["desert"] }),

  entry("blue", "dust_erosion", "风蚀", "命中使目标受到的伤害 +12%\n可叠 3 层，持续 4 秒",
    (s) => {
      s.erosionPerStack = Math.max(s.erosionPerStack || 0, 0.12);
      s.erosionMaxStacks = Math.max(s.erosionMaxStacks || 0, 3);
    },
    null, { maps: ["desert"] }),

  entry("purple", "dust_heatdeath", "热寂", "敌人移速每高 10%，你对其伤害 +8%\n（沙暴期敌人加速 50%，即全体 +40%）",
    (s) => { s.heatDeathPerTenth = (s.heatDeathPerTenth || 0) + 0.08; },
    null, { maps: ["desert"] }),

  entry("purple", "dust_quickbind", "流沙缚", "你的拾取范围内，敌人额外减速 30%\n与时间流护盾叠乘",
    (s) => { s.quicksandBind = true; },
    null, { maps: ["desert"] }),

  entry("orange", "dust_stormeye", "沙暴之眼", "沙暴期间视野完全不受影响\n且每秒回复 2% 最大生命",
    (s) => {
      s.stormClearSight = true;
      s.stormEyeRegenRatio = Math.max(s.stormEyeRegenRatio || 0, 0.02);
    },
    "dust_mirage", { maps: ["desert"] }),

  entry("orange", "dust_drought", "旱魃之息", "沙暴持续时间 +50%\n且沙暴期间你的全部伤害 +60%",
    (s) => {
      s.stormDurationMul = Math.max(s.stormDurationMul || 1, 1.5);
      s.stormDamageMul = Math.max(s.stormDamageMul || 1, 1.6);
    },
    null, { maps: ["desert"] }),

  // ---------- 草原专属：草丛庇护、根芽反制与入草伏击 ----------
  entry("blue", "grass_cover", "密叶屏障", "所有草丛可多抵挡 4 发敌弹\n现存草丛与兔子新种的草丛均生效",
    (s) => {
      s.grassCoverCapacityBonus = (s.grassCoverCapacityBonus || 0) + 4;
      (s.grassCover || []).forEach((cover) => {
        cover.maxHp += 4;
        if (cover.active) cover.hp += 4;
      });
    }, null, { maps: ["grassland"] }),

  entry("green", "grass_regrowth", "宿根复生", "被破坏的草丛恢复时间 -40%\n14 秒缩短至 8.4 秒",
    (s) => {
      s.grassCoverRegenMul = (s.grassCoverRegenMul || 1) * 0.6;
      (s.grassCover || []).forEach((cover) => { if (!cover.active) cover.regrowMs *= 0.6; });
    }, null, { maps: ["grassland"] }),

  entry("purple", "grass_ambush", "伏草一击", "每次进入草丛后，藏身期间\n首轮主炮伤害 +40%",
    (s) => { s.grassAmbushDamageMul = 1.4; }, null, { maps: ["grassland"] }),

  entry("blue", "grass_pruning", "斩芽回春", "每击毁一枚敌方根芽\n回复 3% 最大生命",
    (s) => { s.grassBudHealRatio = 0.03; }, null, { maps: ["grassland"] }),

  entry("orange", "grass_shelter", "庇护余韧", "你所在的草丛被破坏时\n获得 5% 最大生命的护盾",
    (s) => { s.grassCoverBreakShieldRatio = 0.05; }, null, { maps: ["grassland"] }),

  entry("blue", "grass_freestep", "断藤步", "免疫藤蔓缠绕与拖拽减速",
    (s) => { s.grassSnareImmune = true; s.grassSnaredMs = 0; }, null, { maps: ["grassland"] }),

  // ---------- 地狱专属：全部围绕魂火回路（收得更容易 / 烧得更慢 / 把镇魂换成别的东西）----------
  entry("blue", "hell_draw", "引魂", "镇魂判定半径 28 → 98 像素\n走近即收，不必精确压上",
    (s) => { s.hellBankRadius = Math.max(s.hellBankRadius || 28, 98); },
    null, { maps: ["hell"] }),

  entry("blue", "hell_reprieve", "缓刑", "所有魂火引信 +2.0 秒\n现存与新掉落的都生效",
    (s) => {
      s.hellFuseBonusMs = (s.hellFuseBonusMs || 0) + 2000;
      (s.hellSoulfires || []).forEach((f) => { f.fuseMs += 2000; f.fuseMaxMs += 2000; });
    }, null, { maps: ["hell"] }),

  entry("green", "hell_emberhold", "余烬不熄", "业火层上限 6 → 9\n每层计时 4.0 → 5.5 秒",
    (s) => { s.hellEmberMax = 9; s.hellEmberLifeMs = 5500; },
    null, { maps: ["hell"] }),

  entry("purple", "hell_quell", "镇魂爆", "每次镇魂在原地炸开\n对 90 像素内敌人造成主炮伤害 ×2.5",
    (s) => { s.hellQuellRadius = 90; s.hellQuellDamageMul = 2.5; },
    null, { maps: ["hell"] }),

  entry("orange", "hell_absolution", "无罪", "业火满层时免疫一次伤害\n触发后清空全部业火层，冷却 12 秒",
    (s) => { s.hellAbsolution = true; s.hellAbsolutionCdMs = 0; },
    null, { maps: ["hell"] }),

  entry("blue", "hell_pardon", "赦令", "击杀亡魂返还 1 层业火\n打扫失败也有回收路径",
    (s) => { s.hellPardon = true; }, null, { maps: ["hell"] }),

  // ---------- 海洋专属：利用涨潮爆发，或将涨退潮转化为生存资源 ----------
  entry("green", "ocean_rapid", "涨潮快射", "涨潮期间射速 +30%",
    (s) => { s.tideFireRateMul = Math.max(s.tideFireRateMul || 1, 1.3); },
    null, { maps: ["ocean"] }),

  entry("green", "ocean_scavenger", "潮汐拾荒", "涨潮期间拾取的经验 +50%",
    (s) => { s.tideExpMul = Math.max(s.tideExpMul || 1, 1.5); },
    null, { maps: ["ocean"] }),

  entry("blue", "ocean_stable_fin", "稳流鳍", "免疫海流推动\n你的子弹速度永久 +15%",
    (s) => {
      s.tideDriftMul = 0;
      s.bulletSpeedMul = (s.bulletSpeedMul || 1) * 1.15;
    },
    null, { maps: ["ocean"] }),

  entry("blue", "ocean_ebb_mend", "退潮回生", "每次涨潮结束，回复 6% 最大生命",
    (s) => { s.tideEndHealRatio = Math.max(s.tideEndHealRatio || 0, 0.06); },
    null, { maps: ["ocean"] }),

  entry("purple", "ocean_coral", "珊瑚共鸣", "涨潮期间你的全部伤害 +25%",
    (s) => { s.tideDamageMul = (s.tideDamageMul || 1) * 1.25; },
    null, { maps: ["ocean"] }),

  entry("purple", "ocean_hunter", "深海猎手", "对精英和 Boss 的伤害 +25%",
    (s) => {
      s.eliteDmgMul = (s.eliteDmgMul || 1) * 1.25;
      s.bossDmgMul = (s.bossDmgMul || 1) * 1.25;
    },
    null, { maps: ["ocean"] }),

  entry("orange", "ocean_storm_surge", "风暴潮", "涨潮期间你的全部伤害 +60%\n但敌方子弹速度也 +25%",
    (s) => {
      s.tideDamageMul = (s.tideDamageMul || 1) * 1.6;
      s.tideEnemyBulletSpeedMul = Math.max(s.tideEnemyBulletSpeedMul || 1, 1.25);
    },
    "ocean_rapid", { maps: ["ocean"] }),

  entry("orange", "ocean_heart", "潮汐之心", "每次涨潮清除全屏敌弹\n补充 20% 最大生命的护盾，不超过护盾上限",
    (s) => {
      s.tideHeart = true;
      s.tideHeartShieldRatio = Math.max(s.tideHeartShieldRatio || 0, 0.2);
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp * s.tideHeartShieldRatio);
    },
    null, { maps: ["ocean"] }),

  // ---------- 复合特殊类 ----------
  entry("blue",   "mix_fire",     "火控协同",   "伤害 +8%、射速 +15%",
    (s) => { s.bulletDamage *= 1.08; applyFireRateMul(s, 1.15); }),
  entry("purple", "mix_vulcan",   "火控协同II", "伤害 +16%、射速 +30%",
    (s) => { s.bulletDamage *= 1.16; applyFireRateMul(s, 1.3); }, "mix_fire"),
  entry("green",   "mix_econ",     "战地经济学", "立即获得 200 金币、道具掉落率 +15%",
    (s) => { grantRunCoins(s, 200); s.dropBase += 0.15; }),
  entry("purple", "mix_terminal", "终端优化",   "伤害 +15%、暴击率 +25%",
    (s) => { s.bulletDamage *= 1.15; addCritRateWithOverflow(s, 0.25); }),
  entry("orange", "mix_perfect",  "完美机师",   "获得全属性提升",
    (s) => {
      s.bulletDamage *= 1.25;
      applyFireRateMul(s, 1.25);
      s.maxHp *= 1.25;
      addCritRateWithOverflow(s, 0.25);
      s.magnetRange += 175;
      s.dropBase += 0.25;
      s.expMul += 0.35;
    }),
  // entry("orange", "mix_ascend",   "神格降临",   "伤害 -50%、射速 +1000%\n最大HP +50%、吸血 +1%",
  entry("orange", "mix_ascend",   "神格降临",   "伤害 -50%、射速 +1000%",
    (s) => {
      s.shootIntervalFloor = Math.min(getShootIntervalFloor(s), 30);
      s.bulletDamage *= 0.5;
      applyFireRateMul(s, 10);
      // s.maxHp *= 1.5;
      // s.vampRate += 0.01;
    }),
  entry("orange", "bullet_void", "虚空收割者", "弹道额外 +4，暴击率固定为95%\n但子弹伤害与射速均降低30%",
    (s) => {
      s.sideBullets = Math.min(8, s.sideBullets + 4);
      s.critRate = 0.95;
      s.bulletDamage *= 0.7;
      s.shootInterval = Math.floor(s.shootInterval * 1.3);
    }, ["ms_split_l", "pc_pierce"]),
  entry("orange", "shield_absolute", "绝对领域", "最大生命与护盾翻倍，反伤倍率 +3\n自带范围减速与弹幕反间效果",
    (s) => {
      s.maxHp *= 2;
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.shieldMaxHp);
      s.thornReflectRate = (s.thornReflectRate || 0) + 3;
      s.timeflowShield = true;
      s.turncoatShield = true;
      if (typeof s.turncoatShieldAccMs !== "number") s.turncoatShieldAccMs = 0;
    }, ["shield_rapid", "thorn_blaze"]),
];

/**
 * 从可用升级里按稀有度加权抽 count 个不重复项。
 */
/**
 * 是否仍有至少一条**不可重复**的进化可抽。
 * 可重复词条（应急修复 / 高级重掷）永远在池里，不能拿它们判断"池已抽空"，
 * 否则升级面板会永远弹下去。返回 false 即进入自动补给模式（见 battle.js openUpgradePanel）。
 */
function hasAnyUpgradeAvailable(state) {
  for (let i = 0; i < UPGRADE_POOL.length; i += 1) {
    const u = UPGRADE_POOL[i];
    if (u.repeatable) continue;
    if (u.available(state)) return true;
  }
  return false;
}

/**
 * 地图专属词条的权重补偿。
 * 沙漠池 = 62 条通用 + 6 条专属，如果按同稀有度等权抽，专属条目单条出率只有 1/68，
 * 一局下来大概率一条都见不到，等于白做。乘这个系数让它们真的能出现，
 * 但仍受稀有度权重约束（橙的专属条目照样很稀有）。
 */
const MAP_EXCLUSIVE_WEIGHT_MUL = 2;

function upgradeWeight(u) {
  const base = RARITY_WEIGHTS[u.rarity] || 1;
  return u.maps ? base * MAP_EXCLUSIVE_WEIGHT_MUL : base;
}

function pickUpgrades(state, count) {
  const arr = UPGRADE_POOL.filter((u) => !u.available || u.available(state));
  const picked = [];
  while (arr.length > 0 && picked.length < count) {
    let total = 0;
    arr.forEach((u) => { total += upgradeWeight(u); });
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < arr.length; i += 1) {
      r -= upgradeWeight(arr[i]);
      if (r <= 0) { idx = i; break; }
    }
    picked.push(arr[idx]);
    arr.splice(idx, 1);
  }
  return picked;
}

module.exports = {
  RARITY_COLORS,
  UPGRADE_POOL,
  pickUpgrades,
  hasAnyUpgradeAvailable,
  grantRunCoins,
  effectiveCritMult,
};
