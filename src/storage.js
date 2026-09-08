/**
 * storage.js
 * ----------------------------------------------------------------------------
 * 本地存档（永久保存）。基于 wx.getStorageSync / wx.setStorageSync。
 *
 * 存的是：
 *   - coins         金币（局外货币，用来买天赋）
 *   - talents       天赋等级（按 talent.id 索引）
 *   - bestKills     历史最佳击杀数
 *   - bestLevel     历史最佳等级
 *   - unlockedMaps  已解锁地图（见 maps.js；沙漠需击败隐藏 Boss）
 *   - selectedMapId 菜单里记住的地图选择
 *
 * 想清理玩家存档：菜单右上角"重置存档"按钮 → 调 reset()
 * 想换 key（避免老数据干扰）：改 STORAGE_KEY 即可
 * ----------------------------------------------------------------------------
 */

// 存档 key。如果以后改了存档结构想强制清旧档，把 v1 改成 v2 即可。
const STORAGE_KEY = "rogue_plane_save_v1";
const { MAPS } = require("./maps.js");
const { CHARACTERS } = require("./characters.js");

// 默认存档结构。新增天赋时记得在 talents 里加默认值（0）。
const DEFAULT_SAVE = {
  coins: 0,
  unlockedCharacters: {
    striker: true,
    gunner: false,
    scout: false,
    warden: false,
    mechanic: false,
    vampire: false,
    crusher: false,
    prism: false,
    taffy: false,
    windrunner: false,
    tidecaller: false,
  },
  talents: {
    vitality: 0,
    firepower: 0,
    agility: 0,
    wisdom: 0,
    luck: 0,
    reroll: 0,
    prune: 0,
    gravitation: 0,
    curse: 0,
  },
  /** 已解锁地图（见 maps.js）；星空默认可用，沙漠需击败隐藏 Boss（虚空线）*/
  unlockedMaps: {
    starfield: true,
    desert: false,
    ocean: true,
    grassland: false,
  },
  completedMaps: {},
  bestKills: 0,
  bestLevel: 0,
  /** 背景音乐开关（false=关；缺省 true 兼容旧存档） */
  musicOn: true,
  /** 背景音乐音量（0~1） */
  musicVolume: 1,
  /** 闪光特效开关（true=开） */
  flashEffectsOn: true,
  /** 角色、敌人和卫星的统一贴图开关；默认关闭，使用代码造型 */
  battleTexturesOn: false,
  /** 已兑换兑换码（防止重复领取） */
  redeemedCodes: {},
  /** 菜单默认选中的角色 id（用于记住上局选择） */
  selectedCharacterId: "striker",
  /** 菜单默认选中的地图 id（见 maps.js） */
  selectedMapId: "starfield",
  /** 开发者控制台是否已解锁（兑换码 912989446），解锁后主菜单右上角出现 DEV 入口 */
  devConsoleUnlocked: false,
};

function load() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && typeof raw === "object") {
      const merged = Object.assign({}, DEFAULT_SAVE, raw, {
        unlockedCharacters: Object.assign(
          {},
          DEFAULT_SAVE.unlockedCharacters,
          raw.unlockedCharacters || {}
        ),
        talents: Object.assign({}, DEFAULT_SAVE.talents, raw.talents || {}),
        unlockedMaps: Object.assign(
          {},
          DEFAULT_SAVE.unlockedMaps,
          raw.unlockedMaps || {}
        ),
        completedMaps: Object.assign({}, raw.completedMaps || {}),
      });
      Object.keys(merged.completedMaps).forEach((id) => {
        if (merged.completedMaps[id] === true) applyMapClearRewards(merged, id);
      });
      return merged;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_SAVE));
}

/** 一次落盘同时保存通关记录、地图与角色奖励；再次领取不重复提示。 */
function applyMapClearRewards(data, mapId) {
  const rewards = { maps: [], characters: [] };
  MAPS.forEach((map) => {
    if (map.unlockBy !== "mapClear" || map.unlockMapId !== mapId || data.unlockedMaps[map.id]) return;
    data.unlockedMaps[map.id] = true;
    rewards.maps.push({ id: map.id, name: map.name });
  });
  CHARACTERS.forEach((character) => {
    if (character.unlockByMap !== mapId || data.unlockedCharacters[character.id]) return;
    data.unlockedCharacters[character.id] = true;
    rewards.characters.push({ id: character.id, name: character.name });
  });
  return rewards;
}

function save(data) {
  try {
    wx.setStorageSync(STORAGE_KEY, data);
  } catch (e) {}
}

const cache = load();

module.exports = {
  recordMapClear(id) {
    if (!MAPS.some((map) => map.id === id)) return { maps: [], characters: [] };
    cache.completedMaps[id] = true;
    const rewards = applyMapClearRewards(cache, id);
    save(cache);
    return rewards;
  },
  /** 获取当前存档对象（直接持有引用，但建议只读） */
  get() {
    return cache;
  },

  /** 增加金币并立即落盘 */
  addCoins(n) {
    cache.coins += n;
    save(cache);
  },

  /** 扣除金币（不够返回 false） */
  spendCoins(n) {
    if (cache.coins < n) return false;
    cache.coins -= n;
    save(cache);
    return true;
  },

  /** 设置某个天赋等级 */
  setTalent(id, lv) {
    cache.talents[id] = lv;
    save(cache);
  },

  /** 角色解锁（永久） */
  unlockCharacter(id) {
    if (!cache.unlockedCharacters) cache.unlockedCharacters = {};
    cache.unlockedCharacters[id] = true;
    save(cache);
  },

  /** 记住菜单默认选中角色 */
  setSelectedCharacterId(id) {
    if (!id) return;
    cache.selectedCharacterId = String(id);
    save(cache);
  },

  /** 地图解锁（永久）。返回 true 表示这次才真正解锁（用于结算界面提示） */
  unlockMap(id) {
    if (!id) return false;
    if (!cache.unlockedMaps || typeof cache.unlockedMaps !== "object") {
      cache.unlockedMaps = {};
    }
    if (cache.unlockedMaps[id]) return false;
    cache.unlockedMaps[id] = true;
    save(cache);
    return true;
  },

  /** 记住菜单默认选中地图 */
  setSelectedMapId(id) {
    if (!id) return;
    cache.selectedMapId = String(id);
    save(cache);
  },

  /** 开发者控制台解锁开关（持久化；兑换码 912989446 触发） */
  setDevConsoleUnlocked(on) {
    cache.devConsoleUnlocked = !!on;
    save(cache);
  },

  /** 背景音乐开关（持久化） */
  setMusicOn(on) {
    cache.musicOn = !!on;
    save(cache);
  },

  /** 背景音乐音量（0~1，持久化） */
  setMusicVolume(v) {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
    cache.musicVolume = clamped;
    save(cache);
  },

  /** 闪光特效开关（持久化） */
  setFlashEffectsOn(on) {
    cache.flashEffectsOn = !!on;
    save(cache);
  },

  /** 战斗内装饰贴图开关（持久化）；关时敌人等有几何回退的用形状绘制 */
  setBattleTexturesOn(on) {
    cache.battleTexturesOn = !!on;
    save(cache);
  },

  /** 兑换码标记为已使用（持久化） */
  setRedeemedCode(code, used) {
    if (!cache.redeemedCodes || typeof cache.redeemedCodes !== "object") {
      cache.redeemedCodes = {};
    }
    cache.redeemedCodes[String(code || "")] = !!used;
    save(cache);
  },

  /** 记录一次跑图的最佳成绩（取较大值） */
  recordRun(kills, level) {
    if (kills > cache.bestKills) cache.bestKills = kills;
    if (level > cache.bestLevel) cache.bestLevel = level;
    save(cache);
  },

  /** 清档：恢复到 DEFAULT_SAVE */
  reset() {
    Object.assign(cache, JSON.parse(JSON.stringify(DEFAULT_SAVE)));
    save(cache);
  },
};
