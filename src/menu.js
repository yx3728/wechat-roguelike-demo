/**
 * menu.js
 * ----------------------------------------------------------------------------
 * 主菜单场景：标题 / 金币 / 角色选择 / 天赋升级 / 地图选择 / 开始游戏 / 重置存档。
 *
 * 「天赋」与「地图」共用同一块可视区（getPanelViewport，即原天赋列表区域），
 * 横向滑动切换、上方角色选择不受影响；布局位置与改动前一致。
 * 地图定义见 maps.js；沙漠需击败隐藏 Boss 后才解锁并出现在列表里。
 *
 * 所有 UI 元素的位置都通过 getXxxRect() 函数返回矩形，
 *   - 调位置改这些函数即可
 *   - 想改字体大小，全局搜 ctx.font 直接改
 *   - 想换颜色，搜 ctx.fillStyle / strokeStyle
 *
 * 触摸事件按矩形命中判定（pointInRect）。所有点击区都对应一个 getXxxRect。
 *
 * 屏幕坐标系（适用本文件全部位置）：
 *   原点 (0,0) 在画布左上角。x 向右增大，y 向下增大。
 *   W = 屏幕宽，H = 屏幕高（来自 config.js）。
 * ----------------------------------------------------------------------------
 */

const { W, H } = require("./config.js");
const { CHARACTERS, isCharacterUnlocked } = require("./characters.js");
const { TALENTS } = require("./talents.js");
const storage = require("./storage.js");
const audio = require("./audio.js");
const { UPGRADE_POOL, RARITY_COLORS } = require("./upgrades.js");
const { MAPS, getVisibleMaps, resolveSelectedMap, getMapById, isMapUnlocked } = require("./maps.js");
const { BOSS_VARIANTS } = require("./enemies.js");
const { MECHANICS } = require("./mechanics.js");
const { drawOceanSwatch } = require("./oceanVisuals.js");
const { drawCharacterTexture } = require("./characterVisuals.js");
const { drawGrasslandSwatch, drawWindrunnerShape } = require("./grasslandVisuals.js");
const { drawTidecallerShape } = require("./tidecallerVisuals.js");

/**
 * ---------------------------------------------------------------------------
 *  开发者控制台（DEV）
 * ---------------------------------------------------------------------------
 *  结构：一份**声明式 schema**（DEV_SCHEMA）描述所有分组与行，
 *  布局引擎 devLayout() 把它算成一串矩形，绘制与点击**读同一份布局**——
 *  以前两边各写一遍、加一行就要重算一堆魔法数字，那是上一版最大的坑。
 *
 *  行类型：
 *    choice   单选（互斥），如起始等级 / 地图 / Boss 形态
 *    toggles  多个独立开关，如无敌 / 一击 / 十倍速
 *    actions  点一下就执行，如 +金币
 *    cards    词条自选网格（分页，只在需要时出现）
 *
 *  面板体可纵向滚动，所以加行不再受"必须塞进一屏"的限制。
 * ---------------------------------------------------------------------------
 */

/** 面板内边距与行度量 */
const DEV_PAD = 16;
const DEV_HEADER_H = 44;
const DEV_FOOTER_H = 54;
const DEV_ROW_LABEL_H = 20;      // 行标题占高
const DEV_BTN_H = 30;            // 选项按钮高
const DEV_ROW_GAP = 14;          // 行与行的间距
const DEV_SECTION_GAP = 18;      // 分组标题上方留白
const DEV_SECTION_H = 22;        // 分组标题占高
const DEV_BTN_GAP = 6;           // 同一行内按钮间距
const DEV_MAX_PER_LINE = 5;      // 一行最多几个按钮，超了自动换行

/** 词条自选网格 */
const DEV_CARD_H = 34;
const DEV_CARD_GAP = 8;
const DEV_CARD_COLS = 3;
const DEV_CARD_ROWS = 3;
const UPGRADE_PICK_PAGE_SIZE = DEV_CARD_COLS * DEV_CARD_ROWS;
const DEV_CARD_NAV_H = 30;

/**
  * DEV 功能（入口、面板、触控）是否可见。
  * 默认关闭；在设置面板里输入兑换码 912989446 后永久解锁（存档字段 devConsoleUnlocked）。
  * 想强制开启调试就把整个函数体改成 return true。
  */
function devEnabled() {
  return storage.get().devConsoleUnlocked === true;  return storage.get().devConsoleUnlocked === true;
}

/** DEV 面板：标题底部到首行控件之间留白（避免「开发者调试」与「起始等级」挤叠） */

/**
 * 创建菜单场景实例。
 * @param {object} options
 * @param {function} options.onStart  点击"开始游戏"时调用，参数为选中的 character
 */
function createMenuScene(options) {
  const { onStart } = options;
  const initSave = storage.get();
  audio.setEnabled(initSave.musicOn !== false);
  audio.setVolume(initSave.musicVolume == null ? 1 : initSave.musicVolume);
  // 进菜单：切换到普通 BGM（如果之前是 Boss BGM 会自动停下）；关音乐时 playBgm 内会直接 return）
  audio.playBgm();
  // 菜单整体下移量：按需求将除“最佳记录”和“开始游戏”外的元素下移 60
  const MENU_SHIFT_Y = 60;
  /** 每条天赋占位高度（与 getTalentRect 内 h + 间距对齐） */
  const TALENTS_ROW_STEP = 56;
  /** 每张地图卡占位高度（与 getMapRect 内 h + 间距对齐） */
  const MAPS_ROW_STEP = 76;
  /** 「天赋 ↔ 地图」分页：横向拖动超过该比例（相对屏宽）即翻页 */
  const PANEL_SWIPE_RATIO = 0.2;
  /** 翻页回弹/入场动画时长（毫秒） */
  const PANEL_SLIDE_MS = 180;
  /** 面板页序：0=天赋 1=地图 */
  const PANEL_PAGE_TALENTS = 0;
  const PANEL_PAGE_MAPS = 1;
  const PANEL_PAGE_COUNT = 2;
  const state = {
    selectedIndex: 0,    // 当前选中的角色卡片索引
    flashMessage: "",    // 短暂提示信息（如金币不足、已达上限）
    flashTimer: 0,       // 提示剩余显示时长（毫秒）
    charScrollX: 0,      // 角色列表横向滚动偏移（<=0）
    charTouchActive: false,
    charTouchLastX: 0,
    charTouchStartX: 0,
    charTouchStartY: 0,
    charTouchMoved: false,
    charTouchCandidateIndex: -1,

    /**
     * 天赋 / 地图分页（同一块可视区，横向滑动切换；角色选择始终在上方不受影响）
     *   panelPage      当前页：0=天赋 1=地图
     *   panelSlideX    横向偏移（拖拽跟手 + 翻页动画），0 表示停在当前页
     *   panelSlideFrom 动画起点，配合 panelSlideMs 做缓动
     *   panelAxis      本次拖拽已判定的方向：null 未定 / "x" 翻页 / "y" 滚动
     */
    panelPage: PANEL_PAGE_TALENTS,
    panelSlideX: 0,
    panelSlideFrom: 0,
    panelSlideMs: 0,
    panelAxis: null,
    panelDragging: false,

    /** 地图列表纵向滚动 */
    mapsScrollY: 0,
    /** 当前选中的地图 id（初值取存档，见 maps.js resolveSelectedMap） */
    selectedMapId: resolveSelectedMap(initSave).id,

    /** 天赋列表纵向滚动（可点区域不足时滚动，避免压住「开始游戏」） */
    talentsScrollY: 0,
    talentTouchActive: false,
    talentTouchLastY: 0,
    talentTouchStartX: 0,
    talentTouchStartY: 0,
    talentTouchMoved: false,
    touchLastX: 0,
    touchLastY: 0,
    settingsOpen: false,
    settingsDraggingVolume: false,

    // ---------- DEV 调试面板 ----------
    devOpen: false,
    devScrollY: 0,                 // 面板体纵向滚动
    devScrollActive: false,
    devScrollLastY: 0,
    devScrollMoved: false,
    devUpgradePage: 0,             // 词条自选：分页索引
    /** 词条自选面向谁：null 不显示 / "start" 起手词条 / "force" 本局必出 */
    devPickerTarget: null,
    debug: {
      startLevel: 5,
      startWave: 1,
      startBossVariant: "random",
      forceUpgradeIds: [],
      /** none | randomByLevel | pickCards */
      upgradeStartMode: "none",
      pickUpgradeIds: [],
      /** 以下三项仅「调试启动」时传入战斗 */
      godMode: false,
      oneHitKill: false,
      gameSpeed10x: false,
      /** 各机制的 DEV 强制态 { 机制id: 档位 }；档位见 mechanics.js devModes */
      mechanics: {},
    },
  };

  /**
   * DEV 控制台的全部内容都在这里声明。加一行只要往数组里加一项，
   * 布局、绘制、点击都会自动跟上——不需要再去改任何坐标。
   */
  const DEV_SCHEMA = [
    { type: "section", label: "开局设定" },
    {
      type: "choice", id: "level", label: "起始等级",
      options: [5, 6, 7, 8, 10, 15, 20].map((v) => ({ v, label: String(v) })),
      get: () => state.debug.startLevel,
      set: (v) => { state.debug.startLevel = v; },
    },
    {
      type: "choice", id: "wave", label: "起始阶段",
      options: [
        { v: 1, label: "阶段1" },
        { v: 2, label: "阶段2" },
        { v: 3, label: "Boss" },
      ],
      get: () => state.debug.startWave,
      set: (v) => { state.debug.startWave = v; },
    },
    {
      // 地图：直接改菜单选中的地图（与地图页共用 state.selectedMapId），
      // 未解锁的沙漠在 DEV 里也允许选——调试就是要能去没解锁的地方
      type: "choice", id: "map", label: "地图",
      options: () => MAPS.map((m) => ({ v: m.id, label: m.name })),
      get: () => state.selectedMapId,
      set: (v) => {
        state.selectedMapId = v;
        storage.unlockMap(v);
        storage.setSelectedMapId(v);
      },
    },
    {
      // 选项从 enemies.js 的 BOSS_VARIANTS 派生：加一个 Boss 只要在那边登记，
      // 这里自动出现，不会再有"菜单里能选但实际不生效"的漏改
      type: "choice", id: "boss", label: "Boss 形态",
      options: () => [{ v: "random", label: "随机" }].concat(
        BOSS_VARIANTS.filter((b) => b.forceable).map((b) => ({ v: b.id, label: b.name })),
      ),
      get: () => state.debug.startBossVariant,
      set: (v) => { state.debug.startBossVariant = v; },
    },

    { type: "section", label: "战场机制", visible: () => currentMapMechanics().length > 0 },

    { type: "section", label: "作弊开关" },
    {
      type: "toggles", id: "cheats", label: "本局生效",
      items: [
        { key: "godMode", label: "无敌" },
        { key: "oneHitKill", label: "一击必杀" },
        { key: "gameSpeed10x", label: "十倍速" },
      ],
      get: (k) => !!state.debug[k],
      set: (k) => { state.debug[k] = !state.debug[k]; },
    },

    { type: "section", label: "词条" },
    {
      type: "choice", id: "upgradeMode", label: "起手词条",
      options: [
        { v: "none", label: "无" },
        { v: "randomByLevel", label: "随机×等级" },
        { v: "pickCards", label: "自选" },
      ],
      get: () => state.debug.upgradeStartMode,
      set: (v) => {
        state.debug.upgradeStartMode = v;
        // 选「自选」就把词条网格切到起手词条，否则收起
        state.devPickerTarget = v === "pickCards" ? "start" : null;
        state.devUpgradePage = 0;
      },
    },
    {
      type: "choice", id: "forceMode", label: "本局必出",
      options: [
        { v: false, label: "关闭" },
        { v: true, label: "指定词条" },
      ],
      get: () => state.debug.forceUpgradeIds.length > 0 || state.devPickerTarget === "force",
      set: (v) => {
        if (v) {
          state.devPickerTarget = "force";
          state.devUpgradePage = 0;
        } else {
          state.debug.forceUpgradeIds = [];
          if (state.devPickerTarget === "force") {
            state.devPickerTarget = state.debug.upgradeStartMode === "pickCards" ? "start" : null;
          }
        }
      },
    },
    {
      // 词条自选网格：只在有目标时出现，标题会说明正在为谁选
      type: "cards", id: "picker",
      visible: () => state.devPickerTarget !== null,
      label: () => (state.devPickerTarget === "force"
        ? `选择「本局必出」词条（已选 ${state.debug.forceUpgradeIds.length}）`
        : `选择「起手」词条（已选 ${state.debug.pickUpgradeIds.length}）`),
      selectedIds: () => (state.devPickerTarget === "force"
        ? state.debug.forceUpgradeIds
        : state.debug.pickUpgradeIds),
      toggle: (id) => {
        const arr = state.devPickerTarget === "force"
          ? state.debug.forceUpgradeIds
          : state.debug.pickUpgradeIds;
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1); else arr.push(id);
      },
    },

    { type: "section", label: "存档" },
    {
      type: "actions", id: "coins", label: "金币",
      items: [
        { label: "+1000", run: () => { storage.addCoins(1000); flash("+1000 金币"); } },
        { label: "+1 万", run: () => { storage.addCoins(10000); flash("+10000 金币"); } },
        { label: "+100 万", run: () => { storage.addCoins(1000000); flash("+1000000 金币"); } },
      ],
    },
    {
      type: "actions", id: "unlockAll", label: "解锁",
      items: [
        {
          label: "全部角色",
          run: () => {
            CHARACTERS.forEach((c) => storage.unlockCharacter(c.id));
            flash("已解锁全部角色");
          },
        },
        {
          label: "全部地图",
          run: () => {
            MAPS.forEach((m) => storage.unlockMap(m.id));
            flash("已解锁全部地图");
          },
        },
      ],
    },
  ];

  /** 当前选中地图启用了哪些机制（有 devModes 的才需要在控制台露出） */
  function currentMapMechanics() {
    const m = getMapById(state.selectedMapId);
    const ids = Object.keys((m && m.mechanics) || {});
    return MECHANICS.filter((mc) => ids.indexOf(mc.id) >= 0 && mc.devModes);
  }

  /**
   * 实际渲染用的 schema：在「战场机制」分组后按当前地图动态插入机制行。
   * 换地图时行会自己跟着变——加一个新机制不用碰这里。
   */
  function devSchema() {
    const out = [];
    DEV_SCHEMA.forEach((row) => {
      out.push(row);
      if (row.type === "section" && row.label === "战场机制") {
        currentMapMechanics().forEach((mc) => {
          out.push({
            type: "choice",
            id: "mech_" + mc.id,
            label: mc.name,
            options: mc.devModes,
            get: () => state.debug.mechanics[mc.id] || "auto",
            set: (v) => { state.debug.mechanics[mc.id] = v; },
          });
        });
      }
    });
    return out;
  }

  /** 键必须与 tryRedeemByCode 一致：用户输入会 trim 并转成大写再查表 */
  const REDEEM_CODE_REWARDS = {
    // "WELCOME1000": { coins: 1000, msg: "欢迎礼包：+1000 金币" },
    // "ROGUELIKE2026": { coins: 2600, msg: "兑换成功：+2600 金币" },
    "114514": { coins: 114514, msg: "兑换成功：+114514 金币" },
    THELONGUSERNAME: { coins: 27782778, msg: "兑换成功：+27782778 金币" },
    "7777777": { unlockCharacterId: "prism", msg: "已解锁角色：棱镜" },
    "TAFFY": { unlockCharacterId: "taffy", msg: "已解锁角色：永雏塔菲" },
    /** 开发者控制台：解锁后主菜单右上角出现 DEV 入口 */
    "912989446": { unlockDevConsole: true, msg: "已解锁开发者控制台" },
  };

  const rememberedId = initSave.selectedCharacterId || "striker";
  let rememberedIndex = CHARACTERS.findIndex((c) => c.id === rememberedId);
  if (rememberedIndex < 0) rememberedIndex = 0;
  state.selectedIndex = rememberedIndex;
  alignSelectedCharacterToFirstSlot(initSave);

  /** 显示一段 1.5 秒的浮窗提示 */
  function flash(msg) {
    state.flashMessage = msg;
    state.flashTimer = 1500;
  }

  function isUnlocked(save, character) {
    return isCharacterUnlocked(save, character);
  }

  function characterUnlockHint(character) {
    return character.unlockHint || (character.unlockByCodeOnly
      ? `${character.name} 需要兑换码解锁` : `${character.name} 需要 ${character.unlockCost} 金币解锁`);
  }

  /** 菜单可见角色索引：兑换码专属角色未解锁前不展示 */
  function getVisibleCharacterIndices(save) {
    const s = save || storage.get();
    const arr = [];
    for (let i = 0; i < CHARACTERS.length; i += 1) {
      const c = CHARACTERS[i];
      if (c.unlockByCodeOnly && !isUnlocked(s, c)) continue;
      arr.push(i);
    }
    return arr;
  }

  // ==========================================================================
  //  布局矩形（位置/尺寸都在这里）—— 想调 UI 主要改这一块
  // ==========================================================================

  function getCharViewportRect() {
    const x = 20;
    const y = 110 + MENU_SHIFT_Y;
    const w = W - 40;
    const h = 130;
    return { x, y, w, h };
  }

  function getCharCardMetrics() {
    const viewport = getCharViewportRect();
    const gap = 10;
    const cardW = Math.max(120, Math.min(160, Math.floor(viewport.w * 0.42)));
    const cardH = viewport.h;
    const stride = cardW + gap;
    const period = Math.max(1, getVisibleCharacterIndices().length) * stride;
    return { viewport, gap, cardW, cardH, stride, period };
  }

  /** 将当前选中角色对齐到可滑动列表的第一个卡位（最左） */
  function alignSelectedCharacterToFirstSlot(save) {
    const visible = getVisibleCharacterIndices(save);
    if (!visible.length) return;
    const vi = visible.indexOf(state.selectedIndex);
    if (vi < 0) return;
    const m = getCharCardMetrics();
    state.charScrollX = -vi * m.stride;
    normalizeCharScroll();
  }

  function normalizeCharScroll() {
    const m = getCharCardMetrics();
    if (m.period <= 0) return;
    while (state.charScrollX <= -m.period) state.charScrollX += m.period;
    while (state.charScrollX > 0) state.charScrollX -= m.period;
  }

  function getCharCardRect(i, repeat) {
    const m = getCharCardMetrics();
    const x = m.viewport.x + state.charScrollX + i * m.stride + (repeat || 0) * m.period;
    const y = m.viewport.y;
    return { x, y, w: m.cardW, h: m.cardH };
  }

  function getTalentListTop() {
    return 280 + MENU_SHIFT_Y;
  }

  /** 「开始」按钮上方的天赋可视区高度（用于裁剪与滚动条范围） */
  function getTalentViewport() {
    const y = getTalentListTop();
    const bottom = getStartRect().y - 10;
    const h = Math.max(48, bottom - y);
    return { x: 0, y, w: W, h };
  }

  // ---------- 「天赋 ↔ 地图」分页 ----------

  /** 分页可视区（与天赋可视区同一块矩形，布局不变） */
  function getPanelViewport() {
    return getTalentViewport();
  }

  function isMapsPage() {
    return state.panelPage === PANEL_PAGE_MAPS;
  }

  /** 拖拽/动画中的另一页（只有两页，来回都指向对面那页） */
  function otherPanelPage() {
    return (state.panelPage + 1) % PANEL_PAGE_COUNT;
  }

  /**
   * 相邻页的绘制偏移：手指往右拖（slideX>0）时另一页从左侧进场，往左拖时从右侧进场。
   * 这样「右滑天赋栏」和反向滑动都能切到地图页。
   */
  function neighborPanelOffset() {
    if (state.panelSlideX === 0) return 0;
    return state.panelSlideX > 0 ? state.panelSlideX - W : state.panelSlideX + W;
  }

  /** 翻到指定页，并从当前拖拽位置缓动归位 */
  function goPanelPage(page) {
    if (page === state.panelPage) {
      state.panelSlideFrom = state.panelSlideX;
      state.panelSlideMs = PANEL_SLIDE_MS;
      return;
    }
    state.panelPage = page;
    // 换页后，新页此刻正处在 neighborPanelOffset() 的位置，从那里缓动到 0
    state.panelSlideX = neighborPanelOffset() === 0
      ? (state.panelSlideX > 0 ? -W : W)
      : neighborPanelOffset();
    state.panelSlideFrom = state.panelSlideX;
    state.panelSlideMs = PANEL_SLIDE_MS;
  }

  /** 每帧推进翻页缓动（easeOutCubic） */
  function stepPanelSlide(delta) {
    if (state.panelSlideMs <= 0) {
      if (!state.panelDragging) state.panelSlideX = 0;
      return;
    }
    state.panelSlideMs = Math.max(0, state.panelSlideMs - delta);
    const t = 1 - state.panelSlideMs / PANEL_SLIDE_MS;
    const eased = 1 - Math.pow(1 - t, 3);
    state.panelSlideX = state.panelSlideFrom * (1 - eased);
    if (state.panelSlideMs <= 0) state.panelSlideX = 0;
  }

  // ---------- 地图列表布局 ----------

  function mapsMaxScroll() {
    const v = getPanelViewport();
    return Math.max(0, getVisibleMaps(storage.get()).length * MAPS_ROW_STEP - v.h);
  }

  function clampMapsScroll() {
    const mx = mapsMaxScroll();
    if (state.mapsScrollY < 0) state.mapsScrollY = 0;
    else if (state.mapsScrollY > mx) state.mapsScrollY = mx;
  }

  /** 单张地图卡矩形（与天赋条同样的左右边距；dx 为翻页动画偏移） */
  function getMapRect(i, dx) {
    const top = getTalentListTop();
    return {
      x: 20 + (dx || 0),
      y: top + i * MAPS_ROW_STEP - state.mapsScrollY,
      w: W - 40,
      h: 68,
    };
  }

  function talentsMaxScroll() {
    const v = getTalentViewport();
    return Math.max(0, TALENTS.length * TALENTS_ROW_STEP - v.h);
  }

  function clampTalentsScroll() {
    const mx = talentsMaxScroll();
    if (state.talentsScrollY < 0) state.talentsScrollY = 0;
    else if (state.talentsScrollY > mx) state.talentsScrollY = mx;
  }

  /** 单条天赋矩形：左右各 20px 边距，垂直间距嵌入 TALENTS_ROW_STEP，本体高 50px */
  function getTalentRect(i, dx) {
    const x = 20 + (dx || 0);
    const top = getTalentListTop();
    const y = top + i * TALENTS_ROW_STEP - state.talentsScrollY;
    const w = W - 40;
    const h = 50;
    return { x, y, w, h };
  }

  /** 天赋升级按钮：贴在天赋条右侧，宽 80 高 34 */
  function getTalentButtonRect(i, dx) {
    const r = getTalentRect(i, dx);
    const bw = 80;
    return { x: r.x + r.w - bw - 8, y: r.y + 8, w: bw, h: r.h - 16 };
  }

  /** 天赋标题右侧「重置」按钮：重置全部天赋并退款 */
  function getTalentResetRect() {
    const w = 96;
    const h = 20;
    const y = 254 + MENU_SHIFT_Y;
    return { x: W - 20 - w, y, w, h };
  }

  /** 底部"开始游戏"按钮：屏幕底部往上 80px，居中 */
  function getStartRect() {
    const w = 220;
    const h = 56;
    return { x: W / 2 - w / 2, y: H - 80, w, h };
  }

  /** 右上角"重置存档"按钮（按需求暂时注释停用） */
  // function getResetRect() {
  //   return { x: W - 70, y: 14 + MENU_SHIFT_Y, w: 56, h: 30 };
  // }

  // ==========================================================================
  //  DEV 调试面板布局
  // ==========================================================================

  /** 主菜单右上角 DEV 入口按钮（占用原“重置存档”位置） */
  function getDevButtonRect() {
    return { x: W - 60, y: 24 + MENU_SHIFT_Y, w: 46, h: 26 };
  }

  /** 主菜单左上角金币卡片右侧「设置」按钮 */
  function getSettingsButtonRect() {
    const w = 58;
    const h = 26;
    return { x: W - 20 - w, y: 76 + MENU_SHIFT_Y, w, h };
  }

  function getSettingsPanelRect() {
    const w = Math.min(420, W - 40);
    const h = Math.min(380, H - 120);
    return { x: (W - w) / 2, y: 90 + MENU_SHIFT_Y * 0.4, w, h };
  }
  function getSettingsVolumeRowRect() {
    const p = getSettingsPanelRect();
    return { x: p.x + 18, y: p.y + 74, w: p.w - 36, h: 42 };
  }
  function getSettingsVolumeTrackRect() {
    const row = getSettingsVolumeRowRect();
    const muteW = 74;
    return { x: row.x + 10, y: row.y + 18, w: row.w - muteW - 30, h: 12 };
  }
  function getSettingsMuteRect() {
    const row = getSettingsVolumeRowRect();
    return { x: row.x + row.w - 74 - 10, y: row.y + 7, w: 74, h: 28 };
  }
  function getSettingsFlashRect() {
    const p = getSettingsPanelRect();
    return { x: p.x + 18, y: p.y + 132, w: p.w - 36, h: 40 };
  }
  function getSettingsBattleTexturesRect() {
    const p = getSettingsPanelRect();
    return { x: p.x + 18, y: p.y + 178, w: p.w - 36, h: 40 };
  }
  function getSettingsRedeemRect() {
    const p = getSettingsPanelRect();
    return { x: p.x + 18, y: p.y + 226, w: p.w - 36, h: 42 };
  }
  function getSettingsCloseRect() {
    const p = getSettingsPanelRect();
    return { x: p.x + p.w - 18 - 92, y: p.y + p.h - 18 - 36, w: 92, h: 36 };
  }

  function applyMusicVolumeByTouchX(x) {
    const tr = getSettingsVolumeTrackRect();
    const pct = (x - tr.x) / Math.max(1, tr.w);
    const vol = Math.max(0, Math.min(1, pct));
    storage.setMusicVolume(vol);
    audio.setVolume(vol);
  }

  function tryRedeemByCode(raw) {
    const code = String(raw || "").trim().toUpperCase();
    if (!code) {
      flash("兑换码为空");
      return;
    }
    const save = storage.get();
    if (save.redeemedCodes && save.redeemedCodes[code]) {
      flash("该兑换码已使用");
      return;
    }
    const reward = REDEEM_CODE_REWARDS[code];
    if (!reward) {
      flash("兑换码无效");
      return;
    }
    if (reward.coins > 0) storage.addCoins(reward.coins);
    if (reward.unlockCharacterId) storage.unlockCharacter(reward.unlockCharacterId);
    if (reward.unlockDevConsole) storage.setDevConsoleUnlocked(true);
    storage.setRedeemedCode(code, true);
    flash(reward.msg);
  }
  /** 调试面板整体矩形（覆盖菜单中部） */
  function getDevPanelRect() {
    const margin = 16;
    const top = 70 + MENU_SHIFT_Y;
    return { x: margin, y: top, w: W - margin * 2, h: H - top - 40 };
  }

  /** 面板体（可滚动区）：标题栏与底栏之间 */
  function getDevBodyRect() {
    const p = getDevPanelRect();
    return {
      x: p.x,
      y: p.y + DEV_HEADER_H,
      w: p.w,
      h: p.h - DEV_HEADER_H - DEV_FOOTER_H,
    };
  }

  function devUpgradePageCount() {
    return Math.max(1, Math.ceil(UPGRADE_POOL.length / UPGRADE_PICK_PAGE_SIZE));
  }

  /** schema 里的 options 允许写成函数（地图这类动态列表） */
  function devOptionsOf(row) {
    return typeof row.options === "function" ? row.options() : row.options;
  }
  function devLabelOf(row) {
    return typeof row.label === "function" ? row.label() : row.label;
  }

  /**
   * 布局引擎：把 DEV_SCHEMA 算成一串带坐标的元素。
   * **绘制与点击都读它**，所以两边永远不会不一致。
   * 返回 { items, contentH }；items 里每项都带 kind + 矩形。
   */
  function devLayout() {
    const body = getDevBodyRect();
    const innerX = body.x + DEV_PAD;
    const innerW = body.w - DEV_PAD * 2;
    const items = [];
    let y = body.y + 8 - state.devScrollY;

    devSchema().forEach((row) => {
      if (row.visible && !row.visible()) return;

      if (row.type === "section") {
        y += DEV_SECTION_GAP;
        items.push({ kind: "section", label: row.label, x: innerX, y });
        y += DEV_SECTION_H;
        return;
      }

      // 行标题
      items.push({ kind: "label", label: devLabelOf(row), x: innerX, y });
      y += DEV_ROW_LABEL_H;

      if (row.type === "cards") {
        // 分页导航
        const navW = 64;
        items.push({
          kind: "cardsNav", row,
          prev: { x: innerX, y, w: navW, h: DEV_CARD_NAV_H },
          next: { x: innerX + innerW - navW, y, w: navW, h: DEV_CARD_NAV_H },
          centerX: innerX + innerW / 2,
          centerY: y + DEV_CARD_NAV_H / 2,
        });
        y += DEV_CARD_NAV_H + DEV_CARD_GAP;

        const cw = (innerW - DEV_CARD_GAP * (DEV_CARD_COLS - 1)) / DEV_CARD_COLS;
        const page = Math.max(0, Math.min(state.devUpgradePage, devUpgradePageCount() - 1));
        const start = page * UPGRADE_PICK_PAGE_SIZE;
        for (let i = 0; i < UPGRADE_PICK_PAGE_SIZE; i += 1) {
          const u = UPGRADE_POOL[start + i];
          if (!u) break;
          const c = i % DEV_CARD_COLS;
          const r = Math.floor(i / DEV_CARD_COLS);
          items.push({
            kind: "card", row, upgrade: u,
            rect: {
              x: innerX + c * (cw + DEV_CARD_GAP),
              y: y + r * (DEV_CARD_H + DEV_CARD_GAP),
              w: cw, h: DEV_CARD_H,
            },
          });
        }
        y += DEV_CARD_ROWS * DEV_CARD_H + (DEV_CARD_ROWS - 1) * DEV_CARD_GAP + DEV_ROW_GAP;
        return;
      }

      // choice / toggles / actions 都是按钮行，按 DEV_MAX_PER_LINE 自动换行
      const cells = row.type === "choice" ? devOptionsOf(row)
        : row.type === "toggles" ? row.items
        : row.items;
      const perLine = Math.min(DEV_MAX_PER_LINE, cells.length);
      const lines = Math.ceil(cells.length / perLine);
      for (let li = 0; li < lines; li += 1) {
        const from = li * perLine;
        const slice = cells.slice(from, from + perLine);
        const bw = (innerW - DEV_BTN_GAP * (slice.length - 1)) / slice.length;
        slice.forEach((cell, i) => {
          items.push({
            kind: "btn", row, cell, cellIndex: from + i,
            rect: {
              x: innerX + i * (bw + DEV_BTN_GAP),
              y: y + li * (DEV_BTN_H + DEV_BTN_GAP),
              w: bw, h: DEV_BTN_H,
            },
          });
        });
      }
      y += lines * DEV_BTN_H + (lines - 1) * DEV_BTN_GAP + DEV_ROW_GAP;
    });

    const contentH = y + state.devScrollY - (body.y + 8);
    return { items, contentH, body };
  }

  function devMaxScroll() {
    const body = getDevBodyRect();
    const prev = state.devScrollY;
    state.devScrollY = 0;
    const h = devLayout().contentH;
    state.devScrollY = prev;
    return Math.max(0, h - body.h + 16);
  }

  function clampDevScroll() {
    const mx = devMaxScroll();
    if (state.devScrollY < 0) state.devScrollY = 0;
    else if (state.devScrollY > mx) state.devScrollY = mx;
  }

  // ---------- 底栏按钮 ----------
  function devFooterY() {
    const p = getDevPanelRect();
    return p.y + p.h - DEV_FOOTER_H + 8;
  }
  function getDevCancelRect() {
    const p = getDevPanelRect();
    return { x: p.x + DEV_PAD, y: devFooterY(), w: 88, h: 38 };
  }
  function getDevResetRect() {
    const p = getDevPanelRect();
    return { x: p.x + (p.w - 96) / 2, y: devFooterY(), w: 96, h: 38 };
  }
  function getDevStartRect() {
    const p = getDevPanelRect();
    return { x: p.x + p.w - DEV_PAD - 128, y: devFooterY(), w: 128, h: 38 };
  }

  // ==========================================================================
  //  生命周期：每帧 update / draw
  // ==========================================================================

  function update(delta) {
    const visible = getVisibleCharacterIndices();
    if (visible.length > 0 && visible.indexOf(state.selectedIndex) < 0) {
      const fallback = visible.indexOf(rememberedIndex) >= 0 ? rememberedIndex : visible[0];
      state.selectedIndex = fallback;
    }
    normalizeCharScroll();
    clampTalentsScroll();
    clampMapsScroll();
    if (devEnabled() && state.devOpen) clampDevScroll();
    stepPanelSlide(delta);
    state.flashTimer = Math.max(0, state.flashTimer - delta);
  }

  function draw(ctx) {
    // ---------- 背景 ----------
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, W, H);

    // 静态星点（菜单不滚动）
    ctx.fillStyle = "#1e293b";
    for (let i = 0; i < 50; i += 1) {
      const x = (i * 53) % W;
      const y = (i * 89) % H;
      ctx.fillRect(x, y, 2, 2);
    }

    // ---------- 标题 ----------
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 24px sans-serif"; // 标题字号 24
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("飞机大战但是海克斯版", W / 2, 50 + MENU_SHIFT_Y);

    // ---------- 最佳记录 ----------
    const save = storage.get();
    ctx.font = "13px sans-serif";        // 副标题字号 13
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(
      `最佳：Lv.${save.bestLevel}  击杀 ${save.bestKills}`,
      W / 2,
      54                                  // y=54
    );

    // ---------- 金币显示 ----------
    ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
    ctx.fillRect(20, 76 + MENU_SHIFT_Y, 130, 26);       // 左侧金币卡片
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 14px sans-serif";   // 金币数字字号 14
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`金币  ${save.coins}`, 20, 89 + MENU_SHIFT_Y);

    const muz = getSettingsButtonRect();
    ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
    ctx.fillRect(muz.x, muz.y, muz.w, muz.h);
    ctx.strokeStyle = "#334155";
    ctx.strokeRect(muz.x, muz.y, muz.w, muz.h);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("设置", muz.x + muz.w / 2, muz.y + muz.h / 2);

    // ---------- 重置存档按钮（按需求暂时注释停用） ----------
    // const reset = getResetRect();
    // ctx.fillStyle = "rgba(127, 29, 29, 0.55)";
    // ctx.fillRect(reset.x, reset.y, reset.w, reset.h);
    // ctx.fillStyle = "#fecaca";
    // ctx.font = "12px sans-serif";        // 重置按钮字号 12
    // ctx.textAlign = "center";
    // ctx.textBaseline = "middle";
    // ctx.fillText("重置存档", reset.x + reset.w / 2, reset.y + reset.h / 2);

    // ---------- 角色卡片（横向滑动） ----------
    const charViewport = getCharViewportRect();
    const charMetrics = getCharCardMetrics();
    ctx.save();
    ctx.beginPath();
    ctx.rect(charViewport.x, charViewport.y, charViewport.w, charViewport.h);
    ctx.clip();
    const leftBound = charViewport.x - charMetrics.cardW - charMetrics.gap;
    const rightBound = charViewport.x + charViewport.w + charMetrics.cardW + charMetrics.gap;
    const minRepeat = Math.floor((leftBound - (charViewport.x + state.charScrollX)) / charMetrics.period) - 1;
    const maxRepeat = Math.floor((rightBound - (charViewport.x + state.charScrollX)) / charMetrics.period) + 1;
    const visibleChars = getVisibleCharacterIndices(save);
    for (let repeat = minRepeat; repeat <= maxRepeat; repeat += 1) {
      visibleChars.forEach((charIdx, vi) => {
        const c = CHARACTERS[charIdx];
        const r = getCharCardRect(vi, repeat);
        if (r.x + r.w < charViewport.x - 2 || r.x > charViewport.x + charViewport.w + 2) return;
        const selected = charIdx === state.selectedIndex;
        const unlocked = isUnlocked(save, c);

      // 卡片背景与描边（选中变亮蓝）
      ctx.fillStyle = selected ? "#1e3a8a" : "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = selected ? "#60a5fa" : "#334155";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // 飞机图标（三角形，y 偏上 20px）
      const px = r.x + r.w / 2;
      const py = r.y + 20;
      if (drawCharacterTexture(ctx, c.id, px - 18, py - 5, 36, 42, save.battleTexturesOn === true, "menu")) {
        // 菜单与战斗共享角色素材。
      } else if (c.id === "windrunner") {
        drawWindrunnerShape(ctx, px - 18, py - 5, 36, 42, state);
      } else if (c.id === "tidecaller") {
        drawTidecallerShape(ctx, px - 18, py - 5, 36, 42, state);
      } else if (c.iconStyle === "rainbowTriangle") {
        const stripes = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
        const h = 28;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 14, py + h);
        ctx.lineTo(px + 14, py + h);
        ctx.closePath();
        ctx.clip();
        for (let si = 0; si < stripes.length; si += 1) {
          const y0 = py + (h * si) / stripes.length;
          const sh = h / stripes.length + 0.6;
          ctx.fillStyle = stripes[si];
          ctx.fillRect(px - 16, y0, 32, sh);
        }
        ctx.restore();
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 14, py + 28);
        ctx.lineTo(px + 14, py + 28);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.moveTo(px, py);             // 顶点
        ctx.lineTo(px - 14, py + 28);   // 左下
        ctx.lineTo(px + 14, py + 28);   // 右下
        ctx.closePath();
        ctx.fill();
      }

      // 角色名（粗体 15）
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(c.name, r.x + r.w / 2, r.y + 60);

      // 角色描述（11，支持 \n 手动换行；否则按宽度自动断行，最多两行）
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#cbd5e1";
      const desc = String(c.desc || "");
      const maxCharsPerLine = Math.floor(r.w / 11);
      const manualLines = desc.split("\n").filter((x) => x.length > 0);
      let line1 = manualLines[0] || "";
      let line2 = manualLines[1] || "";
      if (manualLines.length <= 1 && line1.length > maxCharsPerLine) {
        line2 = line1.slice(maxCharsPerLine);
        line1 = line1.slice(0, maxCharsPerLine);
      }
      ctx.fillText(line1, r.x + r.w / 2, r.y + 84);
      if (line2) ctx.fillText(line2, r.x + r.w / 2, r.y + 100);

      // 解锁状态标签
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (unlocked) {
        ctx.fillStyle = "#22c55e";
        ctx.fillText("已解锁", r.x + r.w / 2, r.y + r.h - 12);
      } else {
        ctx.fillStyle = "#fbbf24";
        if (c.unlockByMap) ctx.fillText(c.unlockHint, r.x + r.w / 2, r.y + r.h - 12);
        else if (c.unlockByCodeOnly) ctx.fillText("兑换码解锁", r.x + r.w / 2, r.y + r.h - 12);
        else ctx.fillText(`${c.unlockCost} 金币解锁`, r.x + r.w / 2, r.y + r.h - 12);
      }
      });
    }
    ctx.restore();

    // ---------- 分页区标题（天赋 ↔ 地图，横向滑动切换） ----------
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 16px sans-serif"; // 区块标题字号 16
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(isMapsPage() ? "地图" : "天赋", 20, 258 + MENU_SHIFT_Y);
    // 页码圆点（提示这块区域可以横滑）
    {
      const dotY = 258 + MENU_SHIFT_Y + 8;
      for (let i = 0; i < PANEL_PAGE_COUNT; i += 1) {
        ctx.fillStyle = i === state.panelPage ? "#e2e8f0" : "#475569";
        ctx.beginPath();
        ctx.arc(62 + i * 12, dotY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 「重置天赋」只属于天赋页
    if (!isMapsPage()) {
      const rr = getTalentResetRect();
      ctx.fillStyle = "#7f1d1d";
      ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
      ctx.strokeStyle = "#fca5a5";
      ctx.lineWidth = 1;
      ctx.strokeRect(rr.x, rr.y, rr.w, rr.h);
      ctx.fillStyle = "#fee2e2";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("重置天赋", rr.x + rr.w / 2, rr.y + rr.h / 2);
    }

    // ---------- 分页内容（天赋列表 / 地图列表，同一块可视区） ----------
    {
      const tp = getPanelViewport();
      ctx.save();
      ctx.beginPath();
      ctx.rect(tp.x, tp.y, tp.w, tp.h);
      ctx.clip();
      drawPanelPage(ctx, save, state.panelPage, state.panelSlideX);
      if (state.panelSlideX !== 0) {
        drawPanelPage(ctx, save, otherPanelPage(), neighborPanelOffset());
      }
      ctx.restore();
    }

    // ---------- 开始游戏按钮 ----------
    const start = getStartRect();
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(start.x, start.y, start.w, start.h);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif"; // 主按钮字号 18
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("开始游戏", start.x + start.w / 2, start.y + start.h / 2);

    // ---------- DEV 入口按钮 ----------
    if (devEnabled()) {
      const devBtn = getDevButtonRect();
      ctx.fillStyle = "rgba(124, 58, 237, 0.55)"; // 紫色（区别于其它按钮）
      ctx.fillRect(devBtn.x, devBtn.y, devBtn.w, devBtn.h);
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 1;
      ctx.strokeRect(devBtn.x, devBtn.y, devBtn.w, devBtn.h);
      ctx.fillStyle = "#ede9fe";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("DEV", devBtn.x + devBtn.w / 2, devBtn.y + devBtn.h / 2);
    }

    if (state.settingsOpen) {
      const p = getSettingsPanelRect();
      const saveNow = storage.get();
      const musicOn = saveNow.musicOn !== false;
      const flashOn = saveNow.flashEffectsOn !== false;
      const battleTexOn = saveNow.battleTexturesOn === true;
      const vol = saveNow.musicVolume == null ? 1 : saveNow.musicVolume;
      ctx.fillStyle = "rgba(2, 6, 23, 0.74)";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, p.w, p.h);

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("设置", p.x + 18, p.y + 14);

      const vr = getSettingsVolumeRowRect();
      ctx.fillStyle = "#111827";
      ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
      ctx.strokeStyle = "#334155";
      ctx.strokeRect(vr.x, vr.y, vr.w, vr.h);
      const tr = getSettingsVolumeTrackRect();
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`音乐音量 ${(vol * 100).toFixed(0)}%`, tr.x, vr.y + 4);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(tr.x, tr.y, tr.w, tr.h);
      ctx.strokeStyle = "#475569";
      ctx.strokeRect(tr.x, tr.y, tr.w, tr.h);
      const fillW = Math.max(0, Math.min(tr.w, tr.w * vol));
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(tr.x, tr.y, fillW, tr.h);
      const knobX = tr.x + fillW;
      ctx.fillStyle = "#dbeafe";
      ctx.fillRect(knobX - 4, tr.y - 4, 8, tr.h + 8);
      const muteR = getSettingsMuteRect();
      ctx.fillStyle = musicOn ? "#1d4ed8" : "#334155";
      ctx.fillRect(muteR.x, muteR.y, muteR.w, muteR.h);
      ctx.strokeStyle = musicOn ? "#60a5fa" : "#475569";
      ctx.strokeRect(muteR.x, muteR.y, muteR.w, muteR.h);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("静音", muteR.x + muteR.w / 2, muteR.y + muteR.h / 2);

      const flashR = getSettingsFlashRect();
      ctx.fillStyle = "#111827";
      ctx.fillRect(flashR.x, flashR.y, flashR.w, flashR.h);
      ctx.strokeStyle = "#334155";
      ctx.strokeRect(flashR.x, flashR.y, flashR.w, flashR.h);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("闪光特效", flashR.x + 10, flashR.y + flashR.h / 2);
      const flashToggleW = 74;
      const flashToggleH = 28;
      const flashToggleX = flashR.x + flashR.w - flashToggleW - 10;
      const flashToggleY = flashR.y + (flashR.h - flashToggleH) / 2;
      const flashBlocked = !flashOn;
      ctx.fillStyle = flashBlocked ? "#334155" : "#1d4ed8";
      ctx.fillRect(flashToggleX, flashToggleY, flashToggleW, flashToggleH);
      ctx.strokeStyle = flashBlocked ? "#475569" : "#60a5fa";
      ctx.strokeRect(flashToggleX, flashToggleY, flashToggleW, flashToggleH);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("开启", flashToggleX + flashToggleW / 2, flashToggleY + flashToggleH / 2);

      const texR = getSettingsBattleTexturesRect();
      ctx.fillStyle = "#111827";
      ctx.fillRect(texR.x, texR.y, texR.w, texR.h);
      ctx.strokeStyle = "#334155";
      ctx.strokeRect(texR.x, texR.y, texR.w, texR.h);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("战斗贴图", texR.x + 10, texR.y + texR.h / 2);
      const texToggleW = 74;
      const texToggleH = 28;
      const texToggleX = texR.x + texR.w - texToggleW - 10;
      const texToggleY = texR.y + (texR.h - texToggleH) / 2;
      const texOff = !battleTexOn;
      ctx.fillStyle = texOff ? "#334155" : "#1d4ed8";
      ctx.fillRect(texToggleX, texToggleY, texToggleW, texToggleH);
      ctx.strokeStyle = texOff ? "#475569" : "#60a5fa";
      ctx.strokeRect(texToggleX, texToggleY, texToggleW, texToggleH);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("开启", texToggleX + texToggleW / 2, texToggleY + texToggleH / 2);

      const rd = getSettingsRedeemRect();
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(rd.x, rd.y, rd.w, rd.h);
      ctx.strokeStyle = "#334155";
      ctx.strokeRect(rd.x, rd.y, rd.w, rd.h);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("兑换码", rd.x + rd.w / 2, rd.y + rd.h / 2);

      const closeR = getSettingsCloseRect();
      ctx.fillStyle = "#334155";
      ctx.fillRect(closeR.x, closeR.y, closeR.w, closeR.h);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("关闭", closeR.x + closeR.w / 2, closeR.y + closeR.h / 2);
    }

    // ---------- 临时提示（金币不足等） ----------
    if (state.flashTimer > 0 && state.flashMessage) {
      ctx.fillStyle = "rgba(2, 6, 23, 0.7)";
      ctx.fillRect(W / 2 - 110, H - 140, 220, 36); // 浮窗 220x36
      ctx.fillStyle = "#fff";
      ctx.font = "13px sans-serif";              // 浮窗字号 13
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(state.flashMessage, W / 2, H - 122);
    }

    // ---------- DEV 面板（覆盖在菜单之上） ----------
    if (devEnabled() && state.devOpen) {
      drawDevPanel(ctx);
    }
  }

  /**
   * 绘制 DEV 调试面板。
   *   - 起始等级预设 / 起始阶段
   *   - 起手升级：「无」「随机×等级」「自选词条（分页卡片）」
   *   - 重置存档 / 取消 / 开始
   */
  // ==========================================================================
  //  分页内容绘制（天赋 / 地图）—— dx 为翻页动画的横向偏移
  // ==========================================================================

  function drawPanelPage(ctx, save, page, dx) {
    if (page === PANEL_PAGE_MAPS) drawMapsPage(ctx, save, dx);
    else drawTalentsPage(ctx, save, dx);
  }

  function drawTalentsPage(ctx, save, dx) {
    TALENTS.forEach((t, i) => {
      const r = getTalentRect(i, dx);
      const lv = save.talents[t.id] || 0;
      const isMax = lv >= t.maxLevel;
      const maxLvText = Number.isFinite(t.maxLevel) ? String(t.maxLevel) : "∞";

      // 行背景
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // 名称 + 等级（粗体 14）
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`${t.name}  Lv.${lv}/${maxLvText}`, r.x + 10, r.y + 8);

      // 描述（11）
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(t.desc, r.x + 10, r.y + 28);

      // 升级按钮（绿色 / 满级灰）
      const btn = getTalentButtonRect(i, dx);
      ctx.fillStyle = isMax ? "#334155" : "#15803d";
      ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif"; // 按钮字号 12
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (isMax) {
        ctx.fillText("MAX", btn.x + btn.w / 2, btn.y + btn.h / 2);
      } else {
        ctx.fillText(`升级 ${t.cost(lv)}金`, btn.x + btn.w / 2, btn.y + btn.h / 2);
      }
    });
  }

  /** 地图卡左侧的色带缩略图：用该地图第一档主题色画背景 + 几粒远景颗粒 */
  function drawMapSwatch(ctx, map, x, y, w, h) {
    if (map.particle === "grassland") { drawGrasslandSwatch(ctx, x, y, w, h, map.themes[0]); return; }
    const theme = (map.themes && map.themes[0]) || { bg: "#020617", star: "#1e293b" };
    if (map.particle === "ocean") {
      drawOceanSwatch(ctx, x, y, w, h, theme);
      return;
    }
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = theme.star;
    for (let i = 0; i < 10; i += 1) {
      const px = x + ((i * 23) % Math.max(1, w - 3));
      const py = y + ((i * 37) % Math.max(1, h - 3));
      if (map.particle === "sand") ctx.fillRect(px, py, 3, 1);
      else ctx.fillRect(px, py, 2, 2);
    }
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  function drawMapsPage(ctx, save, dx) {
    const maps = getVisibleMaps(save);
    maps.forEach((m, i) => {
      const r = getMapRect(i, dx);
      const selected = m.id === state.selectedMapId;
      const unlocked = isMapUnlocked(save, m);

      // 卡片背景（选中时描边用地图主色）
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = selected ? (m.accent || "#38bdf8") : "#334155";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // 左侧色带缩略图
      drawMapSwatch(ctx, m, r.x + 10, r.y + 10, 64, r.h - 20);

      const textX = r.x + 86;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(m.name, textX, r.y + 12);

      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(unlocked ? m.desc : m.unlockHint, textX, r.y + 34);

      // 右上角状态徽标：使用中 / 点击选择
      const badgeW = 52;
      const badgeH = 20;
      const badgeX = r.x + r.w - badgeW - 10;
      const badgeY = r.y + 10;
      ctx.fillStyle = selected ? (m.accent || "#38bdf8") : "#334155";
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.fillStyle = selected ? "#0f172a" : "#cbd5e1";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(!unlocked ? "未解锁" : selected ? "使用中" : "选择", badgeX + badgeW / 2, badgeY + badgeH / 2);
    });

    // 列表底部提示：还有未解锁地图时给个方向（不剧透具体条件之外的信息）
    if (maps.length < MAPS.length) {
      const r = getMapRect(maps.length, dx);
      ctx.fillStyle = "#475569";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("？？？  击败隐藏 Boss 可解锁新战场", r.x + 4, r.y + 8);
    }
  }

  /** DEV 面板配色（集中在这里，改主题只动这一处） */
  const DEV_C = {
    scrim: "rgba(2, 6, 23, 0.82)",
    panel: "#0b1020",
    border: "#7c3aed",
    title: "#a78bfa",
    section: "#64748b",
    label: "#cbd5e1",
    btnBg: "#1e293b",
    btnLine: "#334155",
    btnText: "#94a3b8",
    onBg: "#312e81",
    onLine: "#a78bfa",
    onText: "#e9d5ff",
    coin: "#fbbf24",
  };

  function devDrawButton(ctx, r, label, on, textColor) {
    ctx.fillStyle = on ? DEV_C.onBg : DEV_C.btnBg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = on ? DEV_C.onLine : DEV_C.btnLine;
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = textColor || (on ? DEV_C.onText : DEV_C.btnText);
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  }

  function drawDevPanel(ctx) {
    const p = getDevPanelRect();
    const body = getDevBodyRect();

    ctx.fillStyle = DEV_C.scrim;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = DEV_C.panel;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = DEV_C.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    // ---------- 标题栏 ----------
    ctx.fillStyle = DEV_C.title;
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("开发者控制台", p.x + DEV_PAD, p.y + DEV_HEADER_H / 2);
    // 右侧摘要：一眼看出当前会以什么参数启动
    const sm = [];
    if (state.debug.godMode) sm.push("无敌");
    if (state.debug.oneHitKill) sm.push("秒杀");
    if (state.debug.gameSpeed10x) sm.push("10x");
    Object.keys(state.debug.mechanics).forEach((k) => {
      const v = state.debug.mechanics[k];
      if (v && v !== "auto") sm.push(k + ":" + v);
    });
    ctx.fillStyle = sm.length > 0 ? DEV_C.onText : DEV_C.section;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(
      sm.length > 0 ? sm.join(" · ") : "无作弊",
      p.x + p.w - DEV_PAD,
      p.y + DEV_HEADER_H / 2,
    );
    ctx.strokeStyle = DEV_C.btnLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, body.y);
    ctx.lineTo(p.x + p.w, body.y);
    ctx.stroke();

    // ---------- 面板体（裁剪 + 滚动） ----------
    ctx.save();
    ctx.beginPath();
    ctx.rect(body.x, body.y, body.w, body.h);
    ctx.clip();

    const { items } = devLayout();
    items.forEach((it) => {
      // 超出可视区的直接跳过，省绘制
      const topY = it.rect ? it.rect.y : it.y;
      if (topY > body.y + body.h + 40 || topY < body.y - 60) {
        if (it.kind !== "cardsNav") return;
      }

      if (it.kind === "section") {
        ctx.fillStyle = DEV_C.section;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(it.label, it.x, it.y);
        return;
      }
      if (it.kind === "label") {
        ctx.fillStyle = DEV_C.label;
        ctx.font = "13px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(it.label, it.x, it.y);
        return;
      }
      if (it.kind === "cardsNav") {
        const pg = Math.max(0, Math.min(state.devUpgradePage, devUpgradePageCount() - 1));
        devDrawButton(ctx, it.prev, "上一页", false);
        devDrawButton(ctx, it.next, "下一页", false);
        ctx.fillStyle = DEV_C.label;
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${pg + 1} / ${devUpgradePageCount()}`, it.centerX, it.centerY);
        return;
      }
      if (it.kind === "card") {
        const sel = it.row.selectedIds().indexOf(it.upgrade.id) >= 0;
        const r = it.rect;
        ctx.fillStyle = sel ? DEV_C.onBg : DEV_C.btnBg;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = sel ? DEV_C.onLine : DEV_C.btnLine;
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        // 左侧稀有度色条
        ctx.fillStyle = RARITY_COLORS[it.upgrade.rarity] || "#64748b";
        ctx.fillRect(r.x, r.y, 3, r.h);
        ctx.fillStyle = sel ? DEV_C.onText : "#cbd5e1";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        let nm = it.upgrade.name;
        if (nm.length > 7) nm = nm.slice(0, 7);
        ctx.fillText(nm, r.x + 8, r.y + r.h / 2);
        return;
      }
      if (it.kind === "btn") {
        const row = it.row;
        if (row.type === "choice") {
          devDrawButton(ctx, it.rect, it.cell.label, row.get() === it.cell.v);
        } else if (row.type === "toggles") {
          devDrawButton(ctx, it.rect, it.cell.label, row.get(it.cell.key));
        } else {
          devDrawButton(ctx, it.rect, it.cell.label, false, DEV_C.coin);
        }
      }
    });
    ctx.restore();

    // 滚动条（内容超出时才画）
    const maxS = devMaxScroll();
    if (maxS > 0) {
      const trackH = body.h - 12;
      const knobH = Math.max(28, trackH * (body.h / (body.h + maxS)));
      const t = state.devScrollY / maxS;
      ctx.fillStyle = "rgba(148,163,184,0.25)";
      ctx.fillRect(p.x + p.w - 5, body.y + 6, 3, trackH);
      ctx.fillStyle = "rgba(167,139,250,0.8)";
      ctx.fillRect(p.x + p.w - 5, body.y + 6 + (trackH - knobH) * t, 3, knobH);
    }

    // ---------- 底栏 ----------
    ctx.strokeStyle = DEV_C.btnLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, body.y + body.h);
    ctx.lineTo(p.x + p.w, body.y + body.h);
    ctx.stroke();

    const cancel = getDevCancelRect();
    devDrawButton(ctx, cancel, "关闭", false);
    const reset = getDevResetRect();
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(reset.x, reset.y, reset.w, reset.h);
    ctx.strokeStyle = "#fca5a5";
    ctx.lineWidth = 1;
    ctx.strokeRect(reset.x, reset.y, reset.w, reset.h);
    ctx.fillStyle = "#fee2e2";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("重置存档", reset.x + reset.w / 2, reset.y + reset.h / 2);
    const start = getDevStartRect();
    ctx.fillStyle = "#4c1d95";
    ctx.fillRect(start.x, start.y, start.w, start.h);
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.strokeRect(start.x, start.y, start.w, start.h);
    ctx.fillStyle = "#ede9fe";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("以调试启动", start.x + start.w / 2, start.y + start.h / 2);
  }

  function pointInRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function handleSettingsTouch(t) {
    const save = storage.get();
    state.settingsDraggingVolume = false;
    if (pointInRect(t.x, t.y, getSettingsCloseRect())) {
      state.settingsOpen = false;
      return;
    }
    if (pointInRect(t.x, t.y, getSettingsMuteRect())) {
      const nextOn = !(save.musicOn !== false);
      storage.setMusicOn(nextOn);
      audio.setEnabled(nextOn);
      if (nextOn) audio.playBgm();
      return;
    }
    if (pointInRect(t.x, t.y, getSettingsVolumeTrackRect())) {
      state.settingsDraggingVolume = true;
      applyMusicVolumeByTouchX(t.x);
      return;
    }
    if (pointInRect(t.x, t.y, getSettingsFlashRect())) {
      storage.setFlashEffectsOn(!(save.flashEffectsOn !== false));
      return;
    }
    if (pointInRect(t.x, t.y, getSettingsBattleTexturesRect())) {
      storage.setBattleTexturesOn(!(save.battleTexturesOn === true));
      return;
    }
    if (pointInRect(t.x, t.y, getSettingsRedeemRect())) {
      if (typeof wx !== "undefined" && typeof wx.showModal === "function") {
        wx.showModal({
          title: "兑换码",
          editable: true,
          placeholderText: "请输入兑换码",
          success(res) {
            if (res && res.confirm) {
              tryRedeemByCode(res.content || "");
            }
          },
        });
      } else {
        flash("当前环境不支持输入兑换码");
      }
      return;
    }
    const p = getSettingsPanelRect();
    if (!pointInRect(t.x, t.y, p)) {
      state.settingsOpen = false;
    }
  }

  function onTouchStart(t) {
    state.touchLastX = t.x;
    state.touchLastY = t.y;

    if (state.settingsOpen) {
      handleSettingsTouch(t);
      return;
    }

    // DEV 面板优先级最高（打开时全屏拦截）
    if (devEnabled() && state.devOpen) {
      handleDevTouch(t);
      return;
    }

    // 主菜单右上角的 DEV 入口
    if (devEnabled() && pointInRect(t.x, t.y, getDevButtonRect())) {
      state.devOpen = true;
      state.devScrollY = 0;
      return;
    }

    if (pointInRect(t.x, t.y, getSettingsButtonRect())) {
      state.settingsOpen = true;
      return;
    }

    // 天赋重置（重置全部天赋并按历史花费退款）；地图页不响应
    if (!isMapsPage() && pointInRect(t.x, t.y, getTalentResetRect())) {
      const save = storage.get();
      let refund = 0;
      let changed = false;
      TALENTS.forEach((talent) => {
        const lv = (save.talents && save.talents[talent.id]) || 0;
        if (lv <= 0) return;
        changed = true;
        for (let i = 0; i < lv; i += 1) refund += talent.cost(i);
      });
      if (!changed) {
        flash("当前无可重置天赋");
        return;
      }
      TALENTS.forEach((talent) => {
        storage.setTalent(talent.id, 0);
      });
      if (refund > 0) storage.addCoins(refund);
      flash(`天赋已重置，返还 ${refund} 金币`);
      return;
    }

    // 按优先级：角色（支持横向滑动）→ 天赋 → 开始
    const charViewport = getCharViewportRect();
    if (pointInRect(t.x, t.y, charViewport)) {
      const visibleChars = getVisibleCharacterIndices();
      state.charTouchActive = true;
      state.charTouchLastX = t.x;
      state.charTouchStartX = t.x;
      state.charTouchStartY = t.y;
      state.charTouchMoved = false;
      state.charTouchCandidateIndex = -1;
      const m = getCharCardMetrics();
      const leftBound = charViewport.x - m.cardW - m.gap;
      const rightBound = charViewport.x + charViewport.w + m.cardW + m.gap;
      const minRepeat = Math.floor((leftBound - (charViewport.x + state.charScrollX)) / m.period) - 1;
      const maxRepeat = Math.floor((rightBound - (charViewport.x + state.charScrollX)) / m.period) + 1;
      outer:
      for (let repeat = minRepeat; repeat <= maxRepeat; repeat += 1) {
        for (let i = 0; i < visibleChars.length; i += 1) {
          if (pointInRect(t.x, t.y, getCharCardRect(i, repeat))) {
            state.charTouchCandidateIndex = visibleChars[i];
            break outer;
          }
        }
      }
      return;
    }

    const tvp = getPanelViewport();
    if (pointInRect(t.x, t.y, tvp)) {
      state.talentTouchActive = true;
      state.talentTouchLastY = t.y;
      state.talentTouchStartX = t.x;
      state.talentTouchStartY = t.y;
      state.talentTouchMoved = false;
      state.panelAxis = null;
      state.panelDragging = false;
      state.panelSlideMs = 0; // 按下即打断进行中的翻页动画
      return;
    }

    if (pointInRect(t.x, t.y, getStartRect())) {
      const save = storage.get();
      const c = CHARACTERS[state.selectedIndex];
      if (!isUnlocked(save, c)) {
        flash(characterUnlockHint(c));
        return;
      }
      storage.setSelectedCharacterId(c.id);
      storage.setSelectedMapId(state.selectedMapId);
      onStart(c);
    }
  }

  function handleCharacterTap(index) {
    if (index < 0 || index >= CHARACTERS.length) return;
    const save = storage.get();
    const c = CHARACTERS[index];
    if (isUnlocked(save, c)) {
      state.selectedIndex = index;
      return;
    }
    if (c.unlockByCodeOnly || c.unlockByMap) {
      flash(characterUnlockHint(c));
      return;
    }
    const cost = c.unlockCost || 0;
    if (save.coins < cost) {
      flash(`金币不足 ${cost}`);
      return;
    }
    storage.spendCoins(cost);
    storage.unlockCharacter(c.id);
    state.selectedIndex = index;
    flash(`已解锁 ${c.name}`);
  }

  /** DEV 面板内部的点击命中：选项切换 + 三个底部按钮 */
  /**
   * DEV 面板点击。与绘制**共用 devLayout()**，所以按钮位置永远一致；
   * 上一版是绘制和点击各自算一遍坐标，改一处忘一处就会点不中。
   */
  function handleDevTouch(t) {
    // 底栏优先（不受滚动影响）
    if (pointInRect(t.x, t.y, getDevCancelRect())) {
      state.devOpen = false;
      return;
    }
    if (pointInRect(t.x, t.y, getDevResetRect())) {
      storage.reset();
      state.selectedIndex = 0;
      state.selectedMapId = resolveSelectedMap(storage.get()).id;
      flash("存档已重置");
      return;
    }
    if (pointInRect(t.x, t.y, getDevStartRect())) {
      const save = storage.get();
      const c = CHARACTERS[state.selectedIndex];
      if (!isUnlocked(save, c)) {
        flash(characterUnlockHint(c));
        return;
      }
      storage.setSelectedCharacterId(c.id);
      storage.setSelectedMapId(state.selectedMapId);
      state.devOpen = false;
      onStart(c, devDebugPayload());
      return;
    }

    // 面板体：先记下拖拽起点（滚动在 onTouchMove 里处理），点击在 onTouchEnd 判定
    const body = getDevBodyRect();
    if (pointInRect(t.x, t.y, body)) {
      state.devScrollActive = true;
      state.devScrollLastY = t.y;
      state.devScrollMoved = false;
      return;
    }
  }

  /** 面板体里的一次「点击」（拖拽结束且没怎么移动才算） */
  function handleDevBodyTap(x, y) {
    const body = getDevBodyRect();
    if (!pointInRect(x, y, body)) return;
    const { items } = devLayout();
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      if (it.kind === "btn" && pointInRect(x, y, it.rect)) {
        const row = it.row;
        if (row.type === "choice") row.set(it.cell.v);
        else if (row.type === "toggles") row.set(it.cell.key);
        else it.cell.run();
        clampDevScroll();
        return;
      }
      if (it.kind === "card" && pointInRect(x, y, it.rect)) {
        it.row.toggle(it.upgrade.id);
        return;
      }
      if (it.kind === "cardsNav") {
        if (pointInRect(x, y, it.prev)) {
          state.devUpgradePage = Math.max(0, state.devUpgradePage - 1);
          return;
        }
        if (pointInRect(x, y, it.next)) {
          state.devUpgradePage = Math.min(devUpgradePageCount() - 1, state.devUpgradePage + 1);
          return;
        }
      }
    }
  }

  function devDebugPayload(extra) {
    return Object.assign(
      {
        startLevel: state.debug.startLevel,
        startWave: state.debug.startWave,
        startBossVariant: state.debug.startBossVariant,
        forceUpgradeIds: state.debug.forceUpgradeIds.slice(),
        upgradeStartMode: state.debug.upgradeStartMode,
        pickUpgradeIds: state.debug.pickUpgradeIds.slice(),
        godMode: !!state.debug.godMode,
        oneHitKill: !!state.debug.oneHitKill,
        gameSpeed10x: !!state.debug.gameSpeed10x,
        mechanics: Object.assign({}, state.debug.mechanics),
      },
      extra || {},
    );
  }

  function onTouchMove(t) {
    state.touchLastX = t.x;
    state.touchLastY = t.y;

    // DEV 面板体：拖拽滚动。放在最前面，打开时独占拖拽
    if (devEnabled() && state.devOpen && state.devScrollActive) {
      const dy = t.y - state.devScrollLastY;
      state.devScrollLastY = t.y;
      if (Math.abs(dy) >= 1) state.devScrollMoved = true;
      state.devScrollY -= dy;
      clampDevScroll();
      return;
    }

    if (state.settingsOpen) {
      if (state.settingsDraggingVolume) {
        applyMusicVolumeByTouchX(t.x);
      }
      return;
    }

    if (state.talentTouchActive) {
      const dxTotal = t.x - state.talentTouchStartX;
      const dyTotal = t.y - state.talentTouchStartY;
      const dyStep = t.y - state.talentTouchLastY;
      state.talentTouchLastY = t.y;
      if (Math.abs(dxTotal) + Math.abs(dyTotal) >= 10) state.talentTouchMoved = true;

      // 首次明显位移时锁定方向：横向=翻页，纵向=滚动；本次拖拽内不再改判
      if (!state.panelAxis) {
        if (Math.abs(dxTotal) >= 12 && Math.abs(dxTotal) > Math.abs(dyTotal)) {
          state.panelAxis = "x";
          state.panelDragging = true;
        } else if (Math.abs(dyTotal) >= 8) {
          state.panelAxis = "y";
        }
      }

      if (state.panelAxis === "x") {
        state.panelSlideX = dxTotal;
      } else if (state.panelAxis === "y") {
        if (isMapsPage()) {
          state.mapsScrollY -= dyStep;
          clampMapsScroll();
        } else {
          state.talentsScrollY -= dyStep;
          clampTalentsScroll();
        }
      }
      return;
    }

    if (!state.charTouchActive) return;
    const dx = t.x - state.charTouchLastX;
    state.charTouchLastX = t.x;
    const dragDist = Math.abs(t.x - state.charTouchStartX) + Math.abs(t.y - state.charTouchStartY);
    if (dragDist >= 8) state.charTouchMoved = true;
    if (state.charTouchMoved) {
      state.charScrollX += dx;
      normalizeCharScroll();
    }
  }
  /** 天赋页：点击某条的升级按钮 */
  function handleTalentTap(x, y) {
    const save = storage.get();
    for (let idx = 0; idx < TALENTS.length; idx += 1) {
      const btn = getTalentButtonRect(idx);
      if (!pointInRect(x, y, btn)) continue;
      const talent = TALENTS[idx];
      const lv = save.talents[talent.id] || 0;
      if (lv >= talent.maxLevel) {
        flash("已达上限");
        return;
      }
      const cost = talent.cost(lv);
      if (save.coins < cost) {
        flash(`金币不足 ${cost}`);
        return;
      }
      storage.spendCoins(cost);
      storage.setTalent(talent.id, lv + 1);
      flash(`${talent.name} 升至 Lv.${lv + 1}`);
      return;
    }
  }

  /** 地图页：点击卡片切换本局战场（列表里只有已解锁地图，点了即可用） */
  function handleMapTap(x, y) {
    const maps = getVisibleMaps(storage.get());
    for (let i = 0; i < maps.length; i += 1) {
      if (!pointInRect(x, y, getMapRect(i))) continue;
      const m = maps[i];
      if (!isMapUnlocked(storage.get(), m)) { flash(m.unlockHint); return; }
      if (m.id === state.selectedMapId) return;
      state.selectedMapId = m.id;
      storage.setSelectedMapId(m.id);
      flash(`战场已切换：${m.name}`);
      return;
    }
  }

  function onTouchEnd() {
    state.settingsDraggingVolume = false;

    // DEV 面板体：没怎么移动就算一次点击（避免滚动时误触按钮）
    if (state.devScrollActive) {
      if (!state.devScrollMoved) handleDevBodyTap(state.touchLastX, state.touchLastY);
      state.devScrollActive = false;
      state.devScrollMoved = false;
      return;
    }
    if (state.talentTouchActive) {
      if (state.panelAxis === "x") {
        // 横向拖拽收手：超过阈值翻到另一页，否则回弹
        if (Math.abs(state.panelSlideX) >= W * PANEL_SWIPE_RATIO) {
          goPanelPage(otherPanelPage());
        } else {
          goPanelPage(state.panelPage);
        }
      } else if (!state.talentTouchMoved) {
        if (isMapsPage()) handleMapTap(state.touchLastX, state.touchLastY);
        else handleTalentTap(state.touchLastX, state.touchLastY);
      }
      state.talentTouchActive = false;
      state.talentTouchMoved = false;
      state.panelAxis = null;
      state.panelDragging = false;
    }

    if (state.charTouchActive && !state.charTouchMoved && state.charTouchCandidateIndex >= 0) {
      handleCharacterTap(state.charTouchCandidateIndex);
    }
    state.charTouchActive = false;
    state.charTouchCandidateIndex = -1;
  }

  return {
    update,
    draw,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}

module.exports = { createMenuScene };
