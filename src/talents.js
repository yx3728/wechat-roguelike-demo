/**
 * talents.js
 * ----------------------------------------------------------------------------
 * 局外天赋（永久升级，跨局保留）。在主菜单"开始游戏"按钮上方升级。
 *
 * 调整玩法：
 *   - maxLevel：单条天赋的最高等级
 *   - cost(lv)：从 lv 升到 lv+1 的金币花费（lv 是当前等级，0 表示初次升级）
 *   - bonus(lv)：在 lv 等级时给战斗状态的加成。最终结果由 aggregateBonuses 累加。
 *
 * 加成字段含义（在 battle.js 头部叠加到初始属性）：
 *   hpPct              初始最大 HP 加成（加法，0.1 = +10%）
 *   dmgPct             初始子弹伤害加成（加法，0.03 = +3%）
 *   fireRatePct        初始射速加成（加法，0.05 = +5%）
 *   expMul             经验倍率（乘法叠加，如 1.1 * 1.1 = 1.21）
 *   dropBonus          基础掉落率 +N（小数，0.04 = +4%）
 *   magnetPickupPct    起始拾取范围（像素基准 40）：总倍率 1 + 本字段（加法，0.15 = +15%）
 *   curseEnemyHpPct    敌方生命倍率系数：1 + curseEnemyHpPct（加法，每层天赋 +5%）
 *   curseEnemyDmgPct   敌方伤害倍率系数：1 + curseEnemyDmgPct（加法，每层天赋 +8%）
 *   curseSpawnPct      刷怪频率倍率系数：1 + curseSpawnPct（加法，每层天赋 +10%，用于缩短刷怪间隔）
 *
 * 想加新天赋类型：
 *   1) 在数组里加一项，bonus(lv) 返回新字段
 *   2) 在 aggregateBonuses 的 acc 里加默认值
 *   3) 在 battle.js createBattleScene 里读取并应用 bonuses.xxx
 *   4) 在 storage.js DEFAULT_SAVE.talents 里加默认 0
 * ----------------------------------------------------------------------------
 */

const TALENTS = [
  {
    id: "vitality",
    name: "体魄",
    desc: "起始最大生命 +10%",
    maxLevel: 5,
    cost(lv) { return [150, 600, 1400, 2800, 5000][lv]; }, // 150 / 600 / 1400 / 2800 / 5000
    bonus(lv) { return { hpPct: lv * 0.1 }; },
  },
  {
    id: "firepower",
    name: "火力",
    desc: "起始子弹伤害 +3%",
    maxLevel: 5,
    cost(lv) { return [180, 700, 1600, 3200, 5800][lv]; }, // 180 / 700 / 1600 / 3200 / 5800
    bonus(lv) { return { dmgPct: lv * 0.03 }; },
  },
  {
    id: "agility",
    name: "敏捷",
    desc: "射速 +5%",
    maxLevel: 5,
    cost(lv) { return [120, 480, 1100, 2200, 4000][lv]; }, // 120 / 480 / 1100 / 2200 / 4000
    bonus(lv) { return { fireRatePct: lv * 0.05 }; },
  },
  {
    id: "wisdom",
    name: "智慧",
    desc: "经验获取 +10%",
    maxLevel: 5,
    cost(lv) { return [100, 350, 800, 1600, 3000][lv]; }, // 100 / 350 / 800 / 1600 / 3000
    bonus(lv) { return { expMul: 1 + lv * 0.1 }; },
  },
  {
    id: "luck",
    name: "幸运",
    desc: "道具掉落率 +4%",
    maxLevel: 5,
    cost(lv) { return [100, 350, 800, 1600, 3000][lv]; }, // 100 / 350 / 800 / 1600 / 3000
    bonus(lv) { return { dropBonus: lv * 0.04 }; },
  },
  {
    id: "reroll",
    name: "重掷",
    desc: "每级 +1 次局内升级重随机机会",
    maxLevel: 3,
    cost(lv) { return [300, 1200, 3000][lv]; }, // 300 / 1200 / 3000
    bonus(lv) { return { rerollCount: lv }; },
  },
  {
    id: "prune",
    name: "剔除",
    desc: "每级 +1 次局内剔除机会",
    maxLevel: 3,
    cost(lv) { return [280, 1100, 2800][lv]; },
    bonus(lv) { return { pruneCount: lv }; },
  },
  {
    id: "gravitation",
    name: "引力",
    desc: "起始拾取范围 +15%/级",
    maxLevel: 5,
    cost(lv) { return [140, 520, 1200, 2400, 4500][lv]; },
    bonus(lv) { return { magnetPickupPct: lv * 0.15 }; },
  },
  {
    id: "curse",
    name: "诅咒",
    desc: "每级：敌方生命 +5%，敌方伤害 +8%，刷怪频率 +10%",
    maxLevel: Infinity,
    cost(lv) {
      const preset = [110, 420, 1000, 2000, 3800];
      if (lv < preset.length) return preset[lv];
      // 5 级后按约 1.35 倍递增，保持无限可买且成本持续抬升
      return Math.floor(preset[preset.length - 1] * Math.pow(1.35, lv - (preset.length - 1)));
    },
    bonus(lv) {
      return {
        curseEnemyHpPct: lv * 0.05,
        curseEnemyDmgPct: lv * 0.08,
        curseSpawnPct: lv * 0.10,
      };
    },
  },
];

/**
 * 把存档里的天赋等级聚合成战斗用的加成对象。
 * 加法字段累加，expMul 用乘法连乘。
 */
function aggregateBonuses(talentLevels) {
  const acc = {
    hpPct: 0,
    dmgPct: 0,
    fireRatePct: 0,
    expMul: 1,
    dropBonus: 0,
    rerollCount: 0,
    pruneCount: 0,
    magnetPickupPct: 0,
    curseEnemyHpPct: 0,
    curseEnemyDmgPct: 0,
    curseSpawnPct: 0,
  };
  TALENTS.forEach((t) => {
    const lv = talentLevels[t.id] || 0;
    if (lv <= 0) return;
    const b = t.bonus(lv);
    Object.keys(b).forEach((k) => {
      if (k === "expMul") {
        acc[k] *= b[k];
      } else {
        acc[k] = (acc[k] || 0) + (b[k] || 0);
      }
    });
  });
  return acc;
}

module.exports = {
  TALENTS,
  aggregateBonuses,
};
