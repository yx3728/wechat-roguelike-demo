/**
 * items.js
 * ----------------------------------------------------------------------------
 * 战斗中地面拾取物（道具 + 经验球）。被击杀时按概率掉落，被玩家拾取时触发效果。
 *
 * 经验球分级（按 expValue 价值递增，颜色和大小区分）：
 *   exp_small  绿 1 经验
 *   exp_medium 蓝 3 经验
 *   exp_large  紫 8 经验
 *   exp_huge   橙 20 经验
 *
 * 普通道具（按 weight 加权随机）：heart / bomb / magnet / coin。
 * 经验球的 weight=0，只能通过 createItem(x, y, "exp_xxx") 强制生成。
 *
 * 调整效果：去 battle.js 的 consumeItem(item) 改（LV+ 不走经验倍率，直接升级并清空经验条）。
 * ----------------------------------------------------------------------------
 */

const ITEM_TYPES = {
  exp_small:  { color: "#22c55e", label: "+1",  weight: 0, expValue: 1 },
  exp_medium: { color: "#3b82f6", label: "+3",  weight: 0, expValue: 3 },
  exp_large:  { color: "#a855f7", label: "+8",  weight: 0, expValue: 8 },
  exp_huge:   { color: "#f97316", label: "+20", weight: 0, expValue: 20 },

  heart:  { color: "#ef4444", label: "+HP", weight: 1 },
  bomb:   { color: "#fb923c", label: "BOM", weight: 1 },
  magnet: { color: "#60a5fa", label: "MAG", weight: 1 },
  coin:   { color: "#fbbf24", label: "$$",  weight: 4 },

  // weight=0 → 不进普通随机池，只能由 createItem(x,y,type) 强制生成
  // levelup(LV+)：仅「空投信标」词条生效后定期空投，或「战术学习III」按概率从尸体掉落；不再默认出现在 Boss 战
  // invincible(INV)：Boss 战周期掉落
  levelup:    { color: "#c4b5fd", label: "LV+", weight: 0 },
  invincible: { color: "#fde047", label: "INV", weight: 0 },
};

function pickItemType() {
  const entries = Object.entries(ITEM_TYPES).filter(([, v]) => v.weight > 0);
  let total = 0;
  entries.forEach(([, v]) => {
    total += v.weight;
  });
  let r = Math.random() * total;
  for (let i = 0; i < entries.length; i += 1) {
    r -= entries[i][1].weight;
    if (r <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

function sizeFor(t) {
  if (t === "exp_small") return 14;
  if (t === "exp_medium") return 18;
  if (t === "exp_large") return 22;
  if (t === "exp_huge") return 28;
  if (t === "levelup" || t === "invincible") return 26;
  return 20;
}

function createItem(x, y, type) {
  const t = type || pickItemType();
  const meta = ITEM_TYPES[t];
  const size = sizeFor(t);
  return {
    type: t,
    color: meta.color,
    label: meta.label,
    expValue: meta.expValue || 0,
    x: x - size / 2,
    y: y - size / 2,
    w: size,
    h: size,
    vy: 1.4,
    life: t.indexOf("exp_") === 0 ? 14000 : 8000,
    magnetTo: null,
  };
}

module.exports = {
  ITEM_TYPES,
  pickItemType,
  createItem,
};
