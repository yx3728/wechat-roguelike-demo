/**
 * characters.js
 * ----------------------------------------------------------------------------
 * 分包资源命名：
 *   贴图 pkg_assets/images/
 *     - 角色：character_<角色id>.png（例 character_striker.png、character_taffy.png）
 *     - 敌人：enemy_<用途>.png（例 enemy_grunt.png、enemy_elite.png）
 *     - 卫星等：satellite_<角色或用途>.png（例 satellite_orbital.png、satellite_vampire.png）
 *   音频 pkg_audio/audio/
 *     - audio_bgm_main.mp3（菜单与普通波）、audio_bgm_boss.mp3（Boss 战）
 *   一律小写英文 + 下划线，禁止随机串文件名。
 *
 * 可选飞机角色定义。菜单里横向排成 3 张卡片。
 *
 * 想新增角色：往 CHARACTERS 数组里加一项。
 *   注意：菜单卡片宽度是按 `(W - 40 - 20) / 3` 算的（见 menu.js getCharCardRect）。
 *   超过 3 个角色时需要在 menu.js 里改卡片排版逻辑。
 *
 * base 字段会作为战斗开始时的初始属性，叠加上"局外天赋"的加成（详见 battle.js 头部）。
 *   - maxHp           初始最大生命
 *   - bulletDamage    单发子弹伤害
 *   - shootInterval   射击间隔（毫秒），越小越快
 *   - sideBullets     初始两侧附加子弹数（每侧）
 *   - bulletPierceEnemies  为 true 时主炮子弹可穿透敌机（与「穿透核心」相同规则）
 * ----------------------------------------------------------------------------
 */

const CHARACTERS = [
  {
    id: "striker",
    name: "破袭者",
    desc: "均衡型，无短板",
    unlockCost: 0,
    iconStyle: "strikerPortrait", // 菜单小图用分包立绘；加载失败时回退三角 + color
    color: "#38bdf8", // 飞机三角颜色（菜单和战斗中通用）
    base: {
      maxHp: 3000,
      bulletDamage: 1000,
      shootInterval: 420,
      sideBullets: 0,
      bulletPierceEnemies: false,
    },
  },
  {
    id: "gunner",
    name: "重炮手",
    desc: "起始子弹伤害较高，但生命较低",
    unlockCost: 599,
    color: "#f97316",
    base: {
      maxHp: 2000,
      bulletDamage: 1600,
      shootInterval: 500,
      sideBullets: 0,
      bulletPierceEnemies: false,
    },
  },
  {
    id: "scout",
    name: "侦察兵",
    desc: "射速更快，初始弹道为3",
    unlockCost: 12000,
    color: "#a78bfa",
    base: {
      maxHp: 1999,
      bulletDamage: 600,
      shootInterval: 380,
      sideBullets: 1,
      bulletPierceEnemies: false,
    },
  },
  {
    id: "warden",
    name: "守望者",
    desc: "血厚耐打，子弹可穿透敌机\n自动回血",
    unlockCost: 29999,
    color: "#22c55e",
    base: {
      maxHp: 4500,
      bulletDamage: 1000,
      shootInterval: 460,
      sideBullets: 0,
      bulletPierceEnemies: true,
    },
  },
  {
    id: "mechanic",
    name: "机械师",
    desc: "初始 2 颗轨道卫星\n卫星可发射伤害略低的追踪弹",
    unlockCost: 39999,
    color: "#ca8a04",
    base: {
      maxHp: 2600,
      bulletDamage: 920,
      shootInterval: 440,
      sideBullets: 0,
      bulletPierceEnemies: false,
    },
  },
  {
    id: "vampire",
    name: "吸血鬼",
    desc: "自带 3% 吸血，开局自带 1 颗\n附带 1% 吸血的轨道卫星",
    unlockCost: 44444,
    color: "#7f1d1d",
    base: {
      maxHp: 2200,
      bulletDamage: 920,
      shootInterval: 400,
      sideBullets: 0,
      bulletPierceEnemies: false,
    },
  },
  {
    id: "taffy",
    name: "永雏塔菲",
    desc: "兑换码特典\n轻量机体",
    unlockCost: 0,
    unlockByCodeOnly: true,
    iconStyle: "taffyPortrait",
    color: "#fda4af",
    base: {
      maxHp: 2600,
      bulletDamage: 980,
      shootInterval: 400,
      sideBullets: 0,
      bulletPierceEnemies: false,
    },
  },
  {
    id: "prism",
    name: "棱镜",
    desc: "基础属性较低\n开局自带7种随机升级",
    unlockCost: 0,
    unlockByCodeOnly: true, // 仅可通过兑换码解锁
    iconStyle: "rainbowTriangle",
    color: "#ffffff",
    base: {
      maxHp: 777,
      bulletDamage: 277,
      shootInterval: 430,
      sideBullets: 0,
      bulletPierceEnemies: false,
    },
  },
];

module.exports = { CHARACTERS };
