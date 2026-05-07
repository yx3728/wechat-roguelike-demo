/**
 * menu.js
 * ----------------------------------------------------------------------------
 * 主菜单场景：标题 / 金币 / 角色选择 / 天赋升级 / 开始游戏 / 重置存档。
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
const { CHARACTERS } = require("./characters.js");
const { TALENTS } = require("./talents.js");
const storage = require("./storage.js");
const audio = require("./audio.js");
const { UPGRADE_POOL, RARITY_COLORS } = require("./upgrades.js");

const UPGRADE_PICK_PAGE_SIZE = 9;

/** DEV「自选词条」卡片区纵向尺寸（必须与 getDevUpgradeNavRects / getDevUpgradeCardRect 一致） */
const DEV_NAV_H = 30;
const DEV_NAV_TO_GRID_GAP = 8;
const DEV_CARD_H = 34;
const DEV_CARD_ROW_GAP = 8;
const DEV_GRID_ROWS = 3;
function devPickCardsBlockHeight() {
  const gridH = DEV_GRID_ROWS * DEV_CARD_H + (DEV_GRID_ROWS - 1) * DEV_CARD_ROW_GAP;
  return DEV_NAV_H + DEV_NAV_TO_GRID_GAP + gridH + 16;
}

/** 临时开关：false 时隐藏整个 DEV 功能（入口、面板、触控） */
const DEV_ENABLED = false

/** DEV 面板：标题底部到首行控件之间留白（避免「开发者调试」与「起始等级」挤叠） */
const DEV_PANEL_BODY_TOP = 62;

/**
 * 创建菜单场景实例。
 * @param {object} options
 * @param {function} options.onStart  点击"开始游戏"时调用，参数为选中的 character
 */
function createMenuScene(options) {
  const { onStart } = options;
  let strikerMenuIconImg = null;
  let strikerMenuIconReady = false;
  let taffyMenuIconImg = null;
  let taffyMenuIconReady = false;
  if (typeof wx !== "undefined" && typeof wx.createImage === "function") {
    try {
      strikerMenuIconImg = wx.createImage();
      strikerMenuIconImg.onload = () => { strikerMenuIconReady = true; };
      strikerMenuIconImg.onerror = () => { strikerMenuIconReady = false; };
      strikerMenuIconImg.src = "subpackages/pkg_assets/images/character_striker.png";
    } catch (e) {
      strikerMenuIconImg = null;
      strikerMenuIconReady = false;
    }
    try {
      taffyMenuIconImg = wx.createImage();
      taffyMenuIconImg.onload = () => { taffyMenuIconReady = true; };
      taffyMenuIconImg.onerror = () => { taffyMenuIconReady = false; };
      taffyMenuIconImg.src = "subpackages/pkg_assets/images/character_taffy.png";
    } catch (e) {
      taffyMenuIconImg = null;
      taffyMenuIconReady = false;
    }
  }
  const initSave = storage.get();
  audio.setEnabled(initSave.musicOn !== false);
  audio.setVolume(initSave.musicVolume == null ? 1 : initSave.musicVolume);
  // 进菜单：切换到普通 BGM（如果之前是 Boss BGM 会自动停下）；关音乐时 playBgm 内会直接 return）
  audio.playBgm();
  // 菜单整体下移量：按需求将除“最佳记录”和“开始游戏”外的元素下移 60
  const MENU_SHIFT_Y = 60;
  /** 每条天赋占位高度（与 getTalentRect 内 h + 间距对齐） */
  const TALENTS_ROW_STEP = 56;
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
    devUpgradePage: 0, // 起手升级自选：分页索引
    devUpgradePickerTarget: null, // null | "startPick" | "forcePick"
    debug: {
      startLevel: 5,
      startWave: 1,
      startBossVariant: "random",
      forceUpgradeIds: [],
      /** none | randomByLevel | pickCards —— 「随机×等级」= 抽取约 (起始等级−1) 条加权随机起手升级 */
      upgradeStartMode: "none",
      pickUpgradeIds: [],
      /** 仅「以调试启动」传入战斗：无伤（敌弹 / 撞击） */
      godMode: false,
      /** 玩家炮弹与轨道卫星等对敌伤害至少清空当前生命值（虚空核心解锁前无效） */
      oneHitKill: false,
      /** 战斗逻辑时间缩放×10（与无敌/一击互不排斥） */
      gameSpeed10x: false,
    },
  };

  const LEVEL_PRESETS = [5, 6, 7, 8, 10, 15, 20];
  const WAVE_PRESETS = [
    { v: 1, label: "阶段1" },
    { v: 2, label: "阶段2" },
    { v: 3, label: "Boss" },
  ];
  const BOSS_VARIANT_PRESETS = [
    { v: "random", label: "随机Boss" },
    { v: "crimson", label: "红Boss" },
    { v: "azure", label: "蓝Boss" },
    { v: "void", label: "虚空Boss" },
    /** 直接进入虚空二阶段核心战（与起始阶段可同时设；仍以调试启动进战斗） */
    { v: "voidCore", label: "虚空二阶段" },
  ];
  const UPGRADE_MODE_PRESETS = [
    { mode: "none", label: "无" },
    { mode: "randomByLevel", label: "随机×等级" },
    { mode: "pickCards", label: "自选词条" },
  ];
  const FORCE_UPGRADE_ACTIONS = [
    { a: "off", label: "关闭" },
    { a: "pick", label: "菜单选取" },
  ];
  /** 键必须与 tryRedeemByCode 一致：用户输入会 trim 并转成大写再查表 */
  const REDEEM_CODE_REWARDS = {
    // "WELCOME1000": { coins: 1000, msg: "欢迎礼包：+1000 金币" },
    // "ROGUELIKE2026": { coins: 2600, msg: "兑换成功：+2600 金币" },
    "114514": { coins: 114514, msg: "兑换成功：+114514 金币" },
    THELONGUSERNAME: { coins: 27782778, msg: "兑换成功：+27782778 金币" },
    "7777777": { unlockCharacterId: "prism", msg: "已解锁角色：棱镜" },
    "TAFFY": { unlockCharacterId: "taffy", msg: "已解锁角色：永雏塔菲" },
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
    if (character.unlockByCodeOnly) {
      return !!(save.unlockedCharacters && save.unlockedCharacters[character.id]);
    }
    if (!character.unlockCost || character.unlockCost <= 0) return true;
    return !!(save.unlockedCharacters && save.unlockedCharacters[character.id]);
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
  function getTalentRect(i) {
    const x = 20;
    const top = getTalentListTop();
    const y = top + i * TALENTS_ROW_STEP - state.talentsScrollY;
    const w = W - 40;
    const h = 50;
    return { x, y, w, h };
  }

  /** 天赋升级按钮：贴在天赋条右侧，宽 80 高 34 */
  function getTalentButtonRect(i) {
    const r = getTalentRect(i);
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

  /** 调试面板整体矩形（覆盖菜单中部） */
  function getDevPanelRect() {
    const margin = 16;
    const top = 70 + MENU_SHIFT_Y;
    // 下边距稍收，让给面板本体（自选词条卡片区可以更靠下占位）
    return { x: margin, y: top, w: W - margin * 2, h: H - top - 40 };
  }

  /** 一行预设按钮里的第 i 个按钮矩形 */
  function devRowRect(rowY, count, i) {
    const panel = getDevPanelRect();
    const padX = 16;
    const inner = panel.w - padX * 2;
    const gap = 6;
    const bw = (inner - gap * (count - 1)) / count;
    return { x: panel.x + padX + i * (bw + gap), y: rowY, w: bw, h: 30 };
  }

  /** 各行 Y（金币在自选卡片区之上；自选词条区在 pickCards 时向下锚定以利用面板下方空间） */
  function devRowYs() {
    const panel = getDevPanelRect();
    const base = panel.y + DEV_PANEL_BODY_TOP;
    const rowStep = 58;
    const levelRow = base;
    const waveRow = base + rowStep;
    const bossRow = waveRow + rowStep;
    const modeRow = bossRow + rowStep;
    const godRow = modeRow + rowStep;
    const forceRow = godRow + rowStep;
    // 「本局必出升级」行与金币行之间留白（hints 注释掉后也保留间距，便于以后恢复文案）
    const forceStatusReserve = 52;
    const coinsGapBelowForceStatus = 14;
    const coinsRow =
      forceRow + 0 + forceStatusReserve + coinsGapBelowForceStatus;
    const hintY = coinsRow + 36;
    const pickCards = state.debug.upgradeStartMode === "pickCards";
    const forcePick = state.devUpgradePickerTarget === "forcePick";
    const footerY = panel.y + panel.h - 50;
    const showCards = pickCards || forcePick;
    const cardBlockH = showCards ? devPickCardsBlockHeight() : 0;
    let cardsTop = hintY + (showCards ? 14 : 22);
    if (showCards) {
      const minTop = hintY + 26;
      const anchorTop = footerY - 12 - cardBlockH;
      cardsTop = Math.max(minTop, anchorTop);
      if (cardsTop + cardBlockH > footerY - 10) {
        cardsTop = footerY - 12 - cardBlockH;
      }
    }
    return {
      panel,
      base,
      level: levelRow,
      wave: waveRow,
      boss: bossRow,
      mode: modeRow,
      god: godRow,
      force: forceRow,
      hintY,
      cardsTop,
      coins: coinsRow,
      footer: footerY,
      pickCards,
      forcePick,
      showCards,
    };
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
    storage.setRedeemedCode(code, true);
    flash(reward.msg);
  }

  /** 起手升级分页：上一页／下一页 */
  function getDevUpgradeNavRects() {
    const ys = devRowYs();
    const { panel } = ys;
    const y = ys.cardsTop;
    const bw = Math.min(100, Math.floor(panel.w / 5));
    const h = DEV_NAV_H;
    return {
      prev: { x: panel.x + 16, y, w: bw, h },
      next: { x: panel.x + panel.w - 16 - bw, y, w: bw, h },
    };
  }

  /** slot 0~8 → 卡片矩形（自选词条 3×3） */
  function getDevUpgradeCardRect(slot) {
    const ys = devRowYs();
    const innerX = ys.panel.x + 16;
    const innerW = ys.panel.w - 32;
    const gap = DEV_CARD_ROW_GAP;
    const col = slot % 3;
    const row = Math.floor(slot / 3);
    const cw = (innerW - gap * 2) / 3;
    const ch = DEV_CARD_H;
    const x = innerX + col * (cw + gap);
    const y =
      ys.cardsTop +
      DEV_NAV_H +
      DEV_NAV_TO_GRID_GAP +
      row * (ch + DEV_CARD_ROW_GAP);
    return { x, y, w: cw, h: ch };
  }

  /** 起手升级页数（用于分页） */
  function devUpgradePageCount() {
    return Math.max(1, Math.ceil(UPGRADE_POOL.length / UPGRADE_PICK_PAGE_SIZE));
  }

  function getDevCancelRect() {
    const w = 90;
    const h = 38;
    return { x: devRowYs().panel.x + 16, y: devRowYs().footer, w, h };
  }

  function getDevStartRect() {
    const w = 130;
    const h = 38;
    return { x: devRowYs().panel.x + devRowYs().panel.w - 16 - w, y: devRowYs().footer, w, h };
  }

  function getDevResetRect() {
    const w = 96;
    const h = 38;
    return { x: devRowYs().panel.x + (devRowYs().panel.w - w) / 2, y: devRowYs().footer, w, h };
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
      if (c.iconStyle === "strikerPortrait" && save.battleTexturesOn === true && strikerMenuIconImg && strikerMenuIconReady) {
        const iw = 36;
        const ih = 42;
        ctx.drawImage(strikerMenuIconImg, px - iw / 2, py - 5, iw, ih);
      } else if (c.iconStyle === "taffyPortrait" && save.battleTexturesOn === true && taffyMenuIconImg && taffyMenuIconReady) {
        const iw = 34;
        const ih = 40;
        ctx.drawImage(taffyMenuIconImg, px - iw / 2, py - 4, iw, ih);
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
        if (c.unlockByCodeOnly) ctx.fillText("兑换码解锁", r.x + r.w / 2, r.y + r.h - 12);
        else ctx.fillText(`${c.unlockCost} 金币解锁`, r.x + r.w / 2, r.y + r.h - 12);
      }
      });
    }
    ctx.restore();

    // ---------- 天赋区域标题 ----------
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 16px sans-serif"; // 区块标题字号 16
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("天赋", 20, 258 + MENU_SHIFT_Y);
    {
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

    // ---------- 天赋列表（可纵向滚动） ----------
    {
      const tp = getTalentViewport();
      ctx.save();
      ctx.beginPath();
      ctx.rect(tp.x, tp.y, tp.w, tp.h);
      ctx.clip();
      TALENTS.forEach((t, i) => {
        const r = getTalentRect(i);
        const lv = save.talents[t.id] || 0;
        const isMax = lv >= t.maxLevel;
        const maxLvText = Number.isFinite(t.maxLevel) ? String(t.maxLevel) : "∞";

        // 行背景
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#334155";
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
        const btn = getTalentButtonRect(i);
        ctx.fillStyle = isMax ? "#334155" : "#15803d";
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px sans-serif"; // 按钮字号 12
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (isMax) {
          ctx.fillText("MAX", btn.x + btn.w / 2, btn.y + btn.h / 2);
        } else {
          ctx.fillText(
            `升级 ${t.cost(lv)}金`,
            btn.x + btn.w / 2,
            btn.y + btn.h / 2
          );
        }
      });
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
    if (DEV_ENABLED) {
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
    if (DEV_ENABLED && state.devOpen) {
      drawDevPanel(ctx);
    }
  }

  /**
   * 绘制 DEV 调试面板。
   *   - 起始等级预设 / 起始阶段
   *   - 起手升级：「无」「随机×等级」「自选词条（分页卡片）」
   *   - 重置存档 / 取消 / 开始
   */
  function drawDevPanel(ctx) {
    // 半透明遮罩
    ctx.fillStyle = "rgba(2, 6, 23, 0.78)";
    ctx.fillRect(0, 0, W, H);

    const panel = getDevPanelRect();
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 2;
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

    // 标题
    ctx.fillStyle = "#a78bfa";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("开发者调试 (DEV)", panel.x + 16, panel.y + 10);

    const ys = devRowYs();

    // 行 1：起始等级
    drawDevRow(
      ctx,
      "起始等级",
      ys.panel.x + 16,
      ys.level - 22,
      LEVEL_PRESETS,
      ys.level,
      (v) => v === state.debug.startLevel,
      (v) => String(v)
    );

    // 行 2：起始阶段
    drawDevRow(
      ctx,
      "起始阶段",
      ys.panel.x + 16,
      ys.wave - 22,
      WAVE_PRESETS,
      ys.wave,
      (item) => item.v === state.debug.startWave,
      (item) => item.label
    );

    // 行 3：Boss 形态（红/蓝/虚空仅起始阶段=Boss 时生效；「虚空二阶段」始终直达核心战）
    drawDevRow(
      ctx,
      "Boss形态",
      ys.panel.x + 16,
      ys.boss - 22,
      BOSS_VARIANT_PRESETS,
      ys.boss,
      (item) => state.debug.startBossVariant === item.v,
      (item) => item.label
    );

    // 行 4：起手升级模式（无 / 按等级随机 / 自选卡片）
    drawDevRow(
      ctx,
      "起手升级",
      ys.panel.x + 16,
      ys.mode - 22,
      UPGRADE_MODE_PRESETS,
      ys.mode,
      (item) => state.debug.upgradeStartMode === item.mode,
      (item) => item.label
    );

    // 本局调试：三张独立卡片，互不为排他选项（均仅「调试启动」时传入战斗）
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("本局调试", ys.panel.x + 16, ys.god - 22);
    const devHudCards = [
      { toggle: () => !!state.debug.godMode, label: "无敌模式" },
      { toggle: () => !!state.debug.oneHitKill, label: "一击必杀" },
      { toggle: () => !!state.debug.gameSpeed10x, label: "游戏十倍速" },
    ];
    devHudCards.forEach((card, i) => {
      const r = devRowRect(ys.god, devHudCards.length, i);
      const on = card.toggle();
      ctx.fillStyle = on ? "#312e81" : "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = on ? "#a78bfa" : "#334155";
      ctx.lineWidth = on ? 2 : 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = on ? "#e9d5ff" : "#94a3b8";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(card.label, r.x + r.w / 2, r.y + r.h / 2);
    });

    // 本局必出升级（仅保证“出现”一次，不强制自动选择）
    drawDevRow(
      ctx,
      "本局必出升级",
      ys.panel.x + 16,
      ys.force - 22,
      FORCE_UPGRADE_ACTIONS,
      ys.force,
      (item) => item.a === "off" && state.debug.forceUpgradeIds.length <= 0,
      (item) => item.label
    );
    /*
    const forceCount = state.debug.forceUpgradeIds.length;
    const forced = forceCount > 0
      ? UPGRADE_POOL.filter((u) => state.debug.forceUpgradeIds.indexOf(u.id) >= 0)
      : [];
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      forceCount > 0
        ? `当前：已选 ${forceCount} 条（${forced.slice(0, 2).map((u) => u.name).join(" / ")}${forceCount > 2 ? " ..." : ""}）`
        : "当前：关闭",
      ys.panel.x + 16,
      ys.force + 34
    );
    */

    // 金币预设（存档 +1000 / +10000）
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("金币", ys.panel.x + 16, ys.coins - 22);
    [
      { label: "+1000", value: 1000 },
      { label: "+10000", value: 10000 },
    ].forEach((c, i) => {
      const r = devRowRect(ys.coins, 2, i);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#334155";
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.label, r.x + r.w / 2, r.y + r.h / 2);
    });

    /*
    // 说明行
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (ys.forcePick) {
      ctx.fillText(`「本局必出升级」：已选 ${forceCount} 条，点下方卡片可多选／取消`, ys.panel.x + 16, ys.hintY);
    } else if (state.debug.upgradeStartMode === "randomByLevel") {
      const n = Math.min(50, Math.max(0, state.debug.startLevel - 1));
      ctx.fillText(`「随机×等级」：起手按稀有度加权随机约 ${n} 条升级（≈起始等级−1）`, ys.panel.x + 16, ys.hintY);
    } else if (state.debug.upgradeStartMode === "pickCards") {
      ctx.fillText(
        `「自选词条」：已选 ${state.debug.pickUpgradeIds.length} 条，点此下方卡片可多选／翻页`,
        ys.panel.x + 16,
        ys.hintY
      );
    } else {
      ctx.fillText("「无」：不开局发放起手升级。", ys.panel.x + 16, ys.hintY);
    }
    */

    // 自选词条：分页导航 + 3×3 卡片
    if (ys.showCards) {
      const nav = getDevUpgradeNavRects();
      const pg = Math.max(0, Math.min(state.devUpgradePage, devUpgradePageCount() - 1));
      state.devUpgradePage = pg;

      ctx.fillStyle = "#334155";
      ctx.fillRect(nav.prev.x, nav.prev.y, nav.prev.w, nav.prev.h);
      ctx.fillRect(nav.next.x, nav.next.y, nav.next.w, nav.next.h);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("◀上一页", nav.prev.x + nav.prev.w / 2, nav.prev.y + nav.prev.h / 2);
      ctx.fillText("下一页▶", nav.next.x + nav.next.w / 2, nav.next.y + nav.next.h / 2);

      ctx.fillStyle = "#64748b";
      ctx.font = "bold 12px sans-serif";
      const midCx = nav.prev.x + nav.prev.w + (nav.next.x - (nav.prev.x + nav.prev.w)) / 2;
      ctx.fillText(`${pg + 1}/${devUpgradePageCount()}`, midCx, nav.prev.y + nav.prev.h / 2);

      const startIdx = pg * UPGRADE_PICK_PAGE_SIZE;
      for (let s = 0; s < UPGRADE_PICK_PAGE_SIZE; s += 1) {
        const ui = UPGRADE_POOL[startIdx + s];
        if (!ui) break;
        const r = getDevUpgradeCardRect(s);
        const picked = ys.forcePick
          ? state.debug.forceUpgradeIds.indexOf(ui.id) >= 0
          : state.debug.pickUpgradeIds.indexOf(ui.id) >= 0;
        const rim = RARITY_COLORS[ui.rarity] || "#64748b";
        ctx.fillStyle = picked ? "#312e81" : "#1e293b";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = picked ? "#e879f9" : rim;
        ctx.lineWidth = picked ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = rim;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const shortName = ui.name.length > 8 ? `${ui.name.slice(0, 7)}…` : ui.name;
        ctx.fillText(shortName, r.x + r.w / 2, r.y + 4);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px monospace";
        ctx.textBaseline = "bottom";
        ctx.fillText(ui.id.slice(0, 8), r.x + r.w / 2, r.y + r.h - 4);
      }
    }

    // 底部按钮：取消 / 重置存档 / 开始
    const cancelR = getDevCancelRect();
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(cancelR.x, cancelR.y, cancelR.w, cancelR.h);
    ctx.strokeStyle = "#475569";
    ctx.strokeRect(cancelR.x, cancelR.y, cancelR.w, cancelR.h);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("取消", cancelR.x + cancelR.w / 2, cancelR.y + cancelR.h / 2);

    const resetR = getDevResetRect();
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(resetR.x, resetR.y, resetR.w, resetR.h);
    ctx.strokeStyle = "#fca5a5";
    ctx.strokeRect(resetR.x, resetR.y, resetR.w, resetR.h);
    ctx.fillStyle = "#fee2e2";
    ctx.fillText("重置存档", resetR.x + resetR.w / 2, resetR.y + resetR.h / 2);

    const startR = getDevStartRect();
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(startR.x, startR.y, startR.w, startR.h);
    ctx.fillStyle = "#fff";
    ctx.fillText("以调试启动", startR.x + startR.w / 2, startR.y + startR.h / 2);
  }

  /** 绘制一行（标签 + 一组按钮，可选中态） */
  function drawDevRow(ctx, label, labelX, labelY, items, rowY, isSelected, getLabel) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, labelX, labelY);

    items.forEach((item, i) => {
      const r = devRowRect(rowY, items.length, i);
      const sel = isSelected(item);
      ctx.fillStyle = sel ? "#1d4ed8" : "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = sel ? "#60a5fa" : "#334155";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = sel ? "#fff" : "#cbd5e1";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(getLabel(item), r.x + r.w / 2, r.y + r.h / 2);
    });
  }

  // ==========================================================================
  //  触摸输入
  // ==========================================================================

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
    if (DEV_ENABLED && state.devOpen) {
      handleDevTouch(t);
      return;
    }

    // 主菜单右上角的 DEV 入口
    if (DEV_ENABLED && pointInRect(t.x, t.y, getDevButtonRect())) {
      state.devOpen = true;
      return;
    }

    if (pointInRect(t.x, t.y, getSettingsButtonRect())) {
      state.settingsOpen = true;
      return;
    }

    // 天赋重置（重置全部天赋并按历史花费退款）
    if (pointInRect(t.x, t.y, getTalentResetRect())) {
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

    const tvp = getTalentViewport();
    if (pointInRect(t.x, t.y, tvp)) {
      state.talentTouchActive = true;
      state.talentTouchLastY = t.y;
      state.talentTouchStartX = t.x;
      state.talentTouchStartY = t.y;
      state.talentTouchMoved = false;
      return;
    }

    if (pointInRect(t.x, t.y, getStartRect())) {
      const save = storage.get();
      const c = CHARACTERS[state.selectedIndex];
      if (!isUnlocked(save, c)) {
        flash(c.unlockByCodeOnly ? `${c.name} 需要兑换码解锁` : `${c.name} 需要 ${c.unlockCost} 金币解锁`);
        return;
      }
      storage.setSelectedCharacterId(c.id);
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
    if (c.unlockByCodeOnly) {
      flash(`${c.name} 需要兑换码解锁`);
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
  function handleDevTouch(t) {
    const ys = devRowYs();

    // 行 1：起始等级
    for (let i = 0; i < LEVEL_PRESETS.length; i += 1) {
      const r = devRowRect(ys.level, LEVEL_PRESETS.length, i);
      if (pointInRect(t.x, t.y, r)) {
        state.debug.startLevel = LEVEL_PRESETS[i];
        return;
      }
    }

    // 行 2：起始阶段
    for (let i = 0; i < WAVE_PRESETS.length; i += 1) {
      const r = devRowRect(ys.wave, WAVE_PRESETS.length, i);
      if (pointInRect(t.x, t.y, r)) {
        state.debug.startWave = WAVE_PRESETS[i].v;
        return;
      }
    }

    // 行 3：Boss 形态
    for (let i = 0; i < BOSS_VARIANT_PRESETS.length; i += 1) {
      const r = devRowRect(ys.boss, BOSS_VARIANT_PRESETS.length, i);
      if (!pointInRect(t.x, t.y, r)) continue;
      state.debug.startBossVariant = BOSS_VARIANT_PRESETS[i].v;
      return;
    }

    // 行 4：起手升级模式（无 / 随机×等级 / 自选词条）
    for (let i = 0; i < UPGRADE_MODE_PRESETS.length; i += 1) {
      const r = devRowRect(ys.mode, UPGRADE_MODE_PRESETS.length, i);
      if (!pointInRect(t.x, t.y, r)) continue;
      const nextMode = UPGRADE_MODE_PRESETS[i].mode;
      if (state.debug.upgradeStartMode === "pickCards" && nextMode !== "pickCards") {
        state.debug.pickUpgradeIds = [];
      }
      state.debug.upgradeStartMode = nextMode;
      if (nextMode !== "pickCards" && state.devUpgradePickerTarget === "startPick") {
        state.devUpgradePickerTarget = null;
      }
      if (nextMode === "pickCards") state.devUpgradePickerTarget = "startPick";
      state.devUpgradePage = Math.max(
        0,
        Math.min(state.devUpgradePage, devUpgradePageCount() - 1)
      );
      return;
    }

    // 本局调试：三卡各自开关
    for (let i = 0; i < 3; i += 1) {
      const r = devRowRect(ys.god, 3, i);
      if (!pointInRect(t.x, t.y, r)) continue;
      if (i === 0) state.debug.godMode = !state.debug.godMode;
      else if (i === 1) state.debug.oneHitKill = !state.debug.oneHitKill;
      else state.debug.gameSpeed10x = !state.debug.gameSpeed10x;
      return;
    }

    // 本局必出升级
    for (let i = 0; i < FORCE_UPGRADE_ACTIONS.length; i += 1) {
      const r = devRowRect(ys.force, FORCE_UPGRADE_ACTIONS.length, i);
      if (!pointInRect(t.x, t.y, r)) continue;
      const a = FORCE_UPGRADE_ACTIONS[i].a;
      if (a === "off") {
        state.debug.forceUpgradeIds = [];
        if (state.devUpgradePickerTarget === "forcePick") {
          state.devUpgradePickerTarget = state.debug.upgradeStartMode === "pickCards" ? "startPick" : null;
        }
      } else if (a === "pick") {
        state.devUpgradePickerTarget = "forcePick";
      }
      return;
    }

    // 金币预设（直接改存档）；先于分页导航与自选卡片区判定
    const coinPresets = [1000, 10000];
    for (let i = 0; i < coinPresets.length; i += 1) {
      const r = devRowRect(ys.coins, 2, i);
      if (pointInRect(t.x, t.y, r)) {
        storage.addCoins(coinPresets[i]);
        flash(`+${coinPresets[i]} 金币`);
        return;
      }
    }

    // 自选词条分页 + 卡片多选
    if (ys.showCards) {
      const nav = getDevUpgradeNavRects();
      if (pointInRect(t.x, t.y, nav.prev)) {
        state.devUpgradePage = Math.max(0, state.devUpgradePage - 1);
        return;
      }
      if (pointInRect(t.x, t.y, nav.next)) {
        state.devUpgradePage = Math.min(devUpgradePageCount() - 1, state.devUpgradePage + 1);
        return;
      }
      const pg = Math.max(0, Math.min(state.devUpgradePage, devUpgradePageCount() - 1));
      state.devUpgradePage = pg;
      const startIdx = pg * UPGRADE_PICK_PAGE_SIZE;
      for (let s = 0; s < UPGRADE_PICK_PAGE_SIZE; s += 1) {
        const ui = UPGRADE_POOL[startIdx + s];
        if (!ui) break;
        const r = getDevUpgradeCardRect(s);
        if (!pointInRect(t.x, t.y, r)) continue;
        if (ys.forcePick) {
          const ids = state.debug.forceUpgradeIds;
          const ix = ids.indexOf(ui.id);
          if (ix >= 0) ids.splice(ix, 1);
          else ids.push(ui.id);
        } else {
          const ids = state.debug.pickUpgradeIds;
          const ix = ids.indexOf(ui.id);
          if (ix >= 0) ids.splice(ix, 1);
          else ids.push(ui.id);
        }
        return;
      }
    }

    // 取消
    if (pointInRect(t.x, t.y, getDevCancelRect())) {
      state.devOpen = false;
      return;
    }

    // 重置存档
    if (pointInRect(t.x, t.y, getDevResetRect())) {
      storage.reset();
      flash("存档已重置");
      return;
    }

    /** 拼装当前 DEV 调试参数对象 */
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
        },
        extra || {},
      );
    }

    // 以调试参数启动
    if (pointInRect(t.x, t.y, getDevStartRect())) {
      const save = storage.get();
      const c = CHARACTERS[state.selectedIndex];
      if (!isUnlocked(save, c)) {
        flash(c.unlockByCodeOnly ? `${c.name} 需要兑换码解锁` : `${c.name} 需要 ${c.unlockCost} 金币解锁`);
        return;
      }
      storage.setSelectedCharacterId(c.id);
      state.devOpen = false;
      onStart(c, devDebugPayload());
    }
  }

  function onTouchMove(t) {
    state.touchLastX = t.x;
    state.touchLastY = t.y;

    if (state.settingsOpen) {
      if (state.settingsDraggingVolume) {
        applyMusicVolumeByTouchX(t.x);
      }
      return;
    }

    if (state.talentTouchActive) {
      const dy = t.y - state.talentTouchLastY;
      state.talentTouchLastY = t.y;
      const dragDist = Math.abs(t.x - state.talentTouchStartX)
        + Math.abs(t.y - state.talentTouchStartY);
      if (dragDist >= 10) state.talentTouchMoved = true;
      state.talentsScrollY -= dy;
      clampTalentsScroll();
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
  function onTouchEnd() {
    state.settingsDraggingVolume = false;
    if (state.talentTouchActive) {
      if (!state.talentTouchMoved) {
        const save = storage.get();
        for (let idx = 0; idx < TALENTS.length; idx += 1) {
          const btn = getTalentButtonRect(idx);
          if (!pointInRect(state.touchLastX, state.touchLastY, btn)) continue;
          const talent = TALENTS[idx];
          const lv = save.talents[talent.id] || 0;
          if (lv >= talent.maxLevel) {
            flash("已达上限");
            break;
          }
          const cost = talent.cost(lv);
          if (save.coins < cost) {
            flash(`金币不足 ${cost}`);
            break;
          }
          storage.spendCoins(cost);
          storage.setTalent(talent.id, lv + 1);
          flash(`${talent.name} 升至 Lv.${lv + 1}`);
          break;
        }
      }
      state.talentTouchActive = false;
      state.talentTouchMoved = false;
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
