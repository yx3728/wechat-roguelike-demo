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
 * 每个词条都是一次性（同一局内只能拿一次）。
 *
 * 涉及到的 state 字段（在 battle.js 顶部初始化默认值）：
 *   shootInterval, bulletDamage, sideBullets, bulletPierceEnemies,
 *   maxHp, hp, magnetRange, hasRegen, regenIntervalMs,
 *   expMul, dropBase, dropLevelUpChance, coinsEarned,
 *   critRate, critMult, vampRate, bulletSizeMul, bulletSpeedMul,
 *   killHealChance, killCoinBonus, expOrbValueMul,
 *   shieldMaxHp, shieldHp, shieldDamageMul, shieldRegenPerSec,
 *   bossDmgMul, eliteDmgMul, thornReflectRate, onHitBombChance, onKillBombChance, onKillBombItemChance,
 *   overhealToShield, overhealToMaxHp, overhealToExp, magnetForceMul,
 *   timeflowShield（拾取半径内敌方位移减速）, turncoatShield / turncoatShieldAccMs（反间护盾）,
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

function addCritRateWithOverflow(s, addRate) {
  const cap = 0.95;
  const prev = Math.max(0, s.critRate || 0);
  const next = prev + Math.max(0, addRate || 0);
  const overflow = Math.max(0, next - cap);
  s.critRate = Math.min(cap, next);
  // 溢出暴击转爆伤：每溢出 1% 暴击 => +2% 暴伤倍率
  if (overflow > 0) s.critMult += overflow * 2;
}

function entry(rarity, id, name, desc, fn, prereq) {
  return {
    rarity,
    id,
    name,
    desc,
    apply(s) { fn(s); markPicked(s, id); },
    available(s) { return !isPicked(s, id) && !isBlocked(s, id) && hasPrereq(s, prereq); },
  };
}

const UPGRADE_POOL = [
  // ---------- 射速类 ----------
  entry("blue", "reroll_premium", "高级重掷", "下一次三选一中必含紫或橙色词条",
    (s) => { s.upgradeNextPanelPurplePlus = true; }),
  entry("green",  "fr_basic",       "急速射击",     "射速 +32%，子弹尺寸缩小10%",
    (s) => { applyFireRateMul(s, 1.32); s.bulletSizeMul *= 0.9; }),
  entry("green",  "fr_cool",        "急速射击II",   "射速 +64%，子弹尺寸再缩小10%",
    (s) => { applyFireRateMul(s, 1.64); s.bulletSizeMul *= 0.81; }, "fr_basic"),
  entry("blue",   "fr_turbo",       "急速射击III",  "射速 +128%，子弹尺寸再缩小10%",
    (s) => { applyFireRateMul(s, 1.28); s.bulletSizeMul *= 0.729; }, "fr_cool"),
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
  entry("orange", "dmg_xl", "高能弹芯IV",   "伤害 +100%",
    (s) => { s.bulletDamage *= 2; }, "dmg_l"),

  // ---------- 暴击类 ----------
  entry("green",  "crit_aim",  "瞄准训练",     "暴击率 +20%",
    (s) => { addCritRateWithOverflow(s, 0.20); }),
  entry("blue",   "crit_lethal", "瞄准训练II", "暴击率 +25%",
    (s) => { addCritRateWithOverflow(s, 0.25); }, "crit_aim"),
  entry("purple", "crit_master", "瞄准训练III","暴击率 +30%，暴击伤害 +50%",
    (s) => { addCritRateWithOverflow(s, 0.30); s.critMult *= 1.5; }, "crit_lethal"),
  entry("orange", "crit_apex",   "瞄准训练IV", "暴击率 +35%，暴击伤害 +100%",
    (s) => { addCritRateWithOverflow(s, 0.35); s.critMult *= 2; }, "crit_master"),

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
  entry("green",  "hp_plate",     "装甲板",     "最大HP +20%，并回复全部生命",
    (s) => {
      s.maxHp *= 1.2;
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
    }, "hp_heavy"),
  entry("blue",   "hp_heavy",     "装甲板II",   "最大HP再+30%，并回复全部生命",
    (s) => {
      s.maxHp *= 1.3;
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
    }, "hp_heavy"),
  entry("purple", "hp_unbroken",  "装甲板III",  "最大HP +40%，并回复全部生命",
    (s) => {
      s.maxHp *= 1.4;
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
    }, "hp_heavy"),
  entry("green",  "heal_quick",   "应急修复",   "立即回满生命，并获得一个等同最大生命值的护盾",
    (s) => {
      s.pendingUpgradeHeal = (s.pendingUpgradeHeal || 0) + s.maxHp;
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.maxHp);
    }),
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
  entry("blue",   "shield_basic",  "能量护盾", "获得等同最大生命值的护盾，且每秒自动修复 3%",
    (s) => {
      s.shieldMaxHp = s.maxHp;
      s.shieldHp = s.maxHp;
      s.shieldDamageMul = 2; // 护盾承受双倍伤害，避免“拿盾后几乎不掉血”
      s.shieldRegenPerSec = Math.max(s.shieldRegenPerSec || 0, 0.03);
    }),
  entry("purple", "shield_extra",  "能量护盾II",   "获得等同最大生命值的护盾，且每秒自动修复 6%",
    (s) => {
      s.shieldMaxHp = s.maxHp;
      s.shieldHp = s.maxHp;
      s.shieldDamageMul = 2;
      s.shieldRegenPerSec = Math.max(s.shieldRegenPerSec || 0, 0.06);
    }, "shield_basic"),
  entry("orange", "shield_rapid",  "能量护盾III",  "获得等同最大生命值的护盾，且每秒自动修复 15%",
    (s) => {
      s.shieldMaxHp = s.maxHp;
      s.shieldHp = s.maxHp;
      s.shieldDamageMul = 2;
      s.shieldRegenPerSec = Math.max(s.shieldRegenPerSec || 0, 0.15);
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
  entry("green",   "exp_smart",  "战术学习II",   "经验倍率 +200%",
    (s) => { s.expMul += 2; }, "exp_basic"),
  entry("purple", "exp_quantum", "战术学习III", "敌人阵亡时有 5% 概率掉落一枚升级道具（LV+）",
    (s) => { s.dropLevelUpChance = Math.min(1, (s.dropLevelUpChance || 0) + 0.05); }, "exp_smart"),
  // entry("blue",   "exp_orb",    "经验催化",     "经验球价值 +100%",
  //   (s) => { s.expOrbValueMul += 1; }),
  // entry("orange", "exp_orb_apex","经验催化II",  "经验球价值 +200%",
  //   (s) => { s.expOrbValueMul += 2; }, "exp_orb"),
  entry("blue",   "drop_basic", "战利品雷达",   "精英敌人必定掉落道具",
    (s) => { s.eliteGuaranteedDrop = true; }),
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
  entry("orange", "bullet_void", "虚空收割者", "弹道额外 +6，暴击率固定为95%\n但子弹伤害与射速均降低30%",
    (s) => {
      s.sideBullets += 6;
      s.critRate = 0.95;
      s.bulletDamage *= 0.7;
      s.shootInterval = Math.floor(s.shootInterval * 1.3);
    }, ["ms_split_l", "pc_pierce"]),
  entry("orange", "shield_absolute", "绝对领域", "最大生命与护盾翻倍，反伤倍率 +5\n自带范围减速与弹幕反间效果",
    (s) => {
      s.maxHp *= 2;
      s.shieldMaxHp = Math.max(s.shieldMaxHp || 0, s.maxHp);
      s.shieldHp = Math.max(s.shieldHp || 0, s.shieldMaxHp);
      s.thornReflectRate = (s.thornReflectRate || 0) + 5;
      s.timeflowShield = true;
      s.turncoatShield = true;
      if (typeof s.turncoatShieldAccMs !== "number") s.turncoatShieldAccMs = 0;
    }, ["shield_rapid", "thorn_blaze"]),
];

/**
 * 从可用升级里按稀有度加权抽 count 个不重复项。
 */
/** 是否仍有至少一条可抽取的局内进化（未满额时升级面板用） */
function hasAnyUpgradeAvailable(state) {
  for (let i = 0; i < UPGRADE_POOL.length; i += 1) {
    const u = UPGRADE_POOL[i];
    if (u.available(state)) return true;
  }
  return false;
}

function pickUpgrades(state, count) {
  const arr = UPGRADE_POOL.filter((u) => !u.available || u.available(state));
  const picked = [];
  while (arr.length > 0 && picked.length < count) {
    let total = 0;
    arr.forEach((u) => { total += RARITY_WEIGHTS[u.rarity] || 1; });
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < arr.length; i += 1) {
      r -= RARITY_WEIGHTS[arr[i].rarity] || 1;
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
};


