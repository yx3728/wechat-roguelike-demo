/**
 * config.js
 * ----------------------------------------------------------------------------
 * 全局配置常量。所有"游戏节奏 / 屏幕尺寸 / 主题色"相关的全局参数都放在这里。
 *
 * 想调节奏 / 难度 / 视觉风格，优先改本文件。
 * ----------------------------------------------------------------------------
 */

/**
 * 获取当前设备的逻辑屏幕尺寸和像素比。
 * - windowWidth / windowHeight 是逻辑像素（CSS 像素），用于布局
 * - pixelRatio 是物理像素比，用于让 canvas 在高分屏上不糊
 *
 * 兼容处理：新基础库使用 wx.getWindowInfo()，老基础库回退到 wx.getSystemInfoSync()。
 */
function getWindowSize() {
  try {
    if (typeof wx.getWindowInfo === "function") {
      const info = wx.getWindowInfo();
      return {
        width: info.windowWidth,
        height: info.windowHeight,
        dpr: info.pixelRatio || 1,
      };
    }
  } catch (e) {}
  const sys = wx.getSystemInfoSync();
  return {
    width: sys.windowWidth,
    height: sys.windowHeight,
    dpr: sys.pixelRatio || 1,
  };
}

const win = getWindowSize();

module.exports = {
  // ---------- 屏幕 ----------
  W: win.width,        // 画布宽度（逻辑像素），UI 坐标都基于它
  H: win.height,       // 画布高度（逻辑像素）
  DPR: win.dpr,        // 物理像素比，仅 game.js 内部用一次

  // ---------- 升级经验曲线 ----------
  // 第 1 级 → 第 2 级所需经验，后续按 expToNext = floor(expToNext * 1.25 + 8) 递增
  // 想让游戏更"快升级"就调小，想更慢就调大
  BASE_EXP: 20,

  // ---------- 波次（Wave）节奏 ----------
  WAVE_DURATION_MS: 30000,   // 普通波持续时间（毫秒）。30000 = 30 秒
  WAVE_REST_MS: 2500,        // 波次之间的休息时间（毫秒），期间显示"准备倒计时"
  BOSS_WAVE_INTERVAL: 5,     // 每隔几波出现一次 Boss（5 = 第 5/10/15... 波是 Boss）

  // ---------- 主题（背景色） ----------
  // 每经过一波切换一种主题：bg=背景色，star=远景小星点颜色
  // 数组长度任意，超过会循环：(waveIndex - 1) % THEMES.length
  THEMES: [
    { bg: "#020617", star: "#1e293b" }, // 深蓝（默认）
    { bg: "#0b0420", star: "#3b1d6b" }, // 紫色星云
    { bg: "#031918", star: "#0f5c4a" }, // 绿色星云
    { bg: "#1a0606", star: "#7f1d1d" }, // 红色火域
  ],
};
